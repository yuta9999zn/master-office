import { BadRequestException, ConflictException, ForbiddenException, HttpException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { swallow } from '../common/errors';
import {
  APPROVAL_FIELD_TYPES,
  approvalConditionHolds,
  approvalSerial,
  approvalValueText,
  can,
  type ApprovalBox,
  type ApprovalCounts,
  type ApprovalEventView,
  type ApprovalField,
  type ApprovalRequestDetail,
  type ApprovalRequestSummary,
  type ApprovalRouteStep,
  type ApprovalStep,
  type ApprovalStepView,
  type ApprovalTaskStatus,
  type ApprovalTemplate,
  type UserSummary,
} from '@workos/shared';
import { and, desc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import { CalendarService } from '../calendar/calendar.service';
import { flowHooks } from '../flow/flow-hooks';
import type { Actor } from '../common/current-user';
import { loadUsers } from '../common/users';
import type { Db, Tx } from '../db/client';
import { InjectDb } from '../db/db.module';
import { aclEntries, approvalEvents, approvalRequests, approvalTasks, approvalTemplates, resources, users, workspaceMembers, resourceColumns } from '../db/schema';
import { NotificationsService } from '../notifications/notifications.service';
import { PermissionsService } from '../permissions/permissions.service';
import { RealtimeService } from '../realtime/realtime.service';
import { ResourcesService } from '../resources/resources.service';

type TemplateRow = typeof approvalTemplates.$inferSelect;
type RequestRow = typeof approvalRequests.$inferSelect;
type TaskRow = typeof approvalTasks.$inferSelect;

export interface TemplateInput {
  name: string;
  description?: string | null;
  category?: string;
  icon?: string;
  color?: string;
  fields: ApprovalField[];
  steps: ApprovalStep[];
  admins?: string[];
  onApproved?: { calendarOoo?: { fieldId: string } } | null;
  enabled?: boolean;
}

/** What to tell people once a transaction has committed. */
interface Effects {
  pending: string[];
  cc: string[];
  finished: 'approved' | 'rejected' | null;
}
const noEffects = (): Effects => ({ pending: [], cc: [], finished: null });

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const REMIND_EVERY_MS = 10 * 60_000;

/**
 * Approvals (docs/ARCHITECTURE.md §74), after Lark Approval. Workspace owners / admins (and a template's own
 * admins) design templates — a form and a process of steps (approve or CC; fixed people, the submitter's manager
 * one or two levels up, people the submitter picks, or a person field; "and" or "or" sign-off; an optional
 * condition on an answer). Submitting resolves the route once; steps then open one after another. Everyone on a
 * request that has reached them, the submitter and the template's managers can see it.
 */
@Injectable()
export class ApprovalsService {
  private readonly log = new Logger('Approvals');
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimeService,
    private readonly perms: PermissionsService,
    private readonly resources: ResourcesService,
    private readonly calendar: CalendarService,
  ) {}

  // ── Who manages ───────────────────────────────────────────────────────────

  private async wsAdmin(actor: Actor, tx: Tx = this.db) {
    const [m] = await tx
      .select({ role: workspaceMembers.role })
      .from(workspaceMembers)
      .where(and(eq(workspaceMembers.workspaceId, actor.workspaceId), eq(workspaceMembers.userId, actor.id)));
    return m?.role === 'owner' || m?.role === 'admin';
  }

  private manages(t: TemplateRow, actor: Actor, wsAdmin: boolean) {
    return wsAdmin || t.admins.includes(actor.id);
  }

  private async workspaceUserIds(actor: Actor, ids: string[], tx: Tx = this.db) {
    const uniq = [...new Set(ids)];
    if (!uniq.length) return [];
    const rows = await tx
      .select({ id: workspaceMembers.userId })
      .from(workspaceMembers)
      .where(and(eq(workspaceMembers.workspaceId, actor.workspaceId), inArray(workspaceMembers.userId, uniq)));
    return uniq.filter((u) => rows.some((r) => r.id === u));
  }

  // ── Templates ─────────────────────────────────────────────────────────────

  private async templateDtos(actor: Actor, rows: TemplateRow[]): Promise<ApprovalTemplate[]> {
    const admin = await this.wsAdmin(actor);
    const people = await loadUsers(this.db, rows.flatMap((t) => t.admins));
    return rows.map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      category: t.category,
      icon: t.icon,
      color: t.color,
      fields: t.fields as ApprovalField[],
      steps: t.steps as ApprovalStep[],
      admins: t.admins.map((u) => people.get(u)!).filter(Boolean),
      onApproved: (t.onApproved as ApprovalTemplate['onApproved']) ?? null,
      enabled: t.enabled,
      canManage: this.manages(t, actor, admin),
      updatedAt: t.updatedAt,
    }));
  }

  /** Templates people can submit (enabled), plus — for those who manage them — disabled ones. */
  async templates(actor: Actor): Promise<ApprovalTemplate[]> {
    const rows = await this.db
      .select()
      .from(approvalTemplates)
      .where(eq(approvalTemplates.workspaceId, actor.workspaceId))
      .orderBy(approvalTemplates.category, approvalTemplates.position, approvalTemplates.name);
    return (await this.templateDtos(actor, rows)).filter((t) => t.enabled || t.canManage);
  }

  private async templateRow(actor: Actor, id: string, tx: Tx = this.db) {
    const [t] = await tx.select().from(approvalTemplates).where(eq(approvalTemplates.id, id));
    if (!t || t.workspaceId !== actor.workspaceId) throw new NotFoundException('Approval template not found');
    return t;
  }

  async template(actor: Actor, id: string) {
    const t = await this.templateRow(actor, id);
    const [dto] = await this.templateDtos(actor, [t]);
    if (!dto.enabled && !dto.canManage) throw new NotFoundException('Approval template not found');
    return dto;
  }

  private async checkTemplate(actor: Actor, input: TemplateInput) {
    const name = input.name.trim();
    if (!name) throw new BadRequestException('A template needs a name');
    const ids = new Set<string>();
    for (const f of input.fields) {
      if (!f.id || ids.has(f.id)) throw new BadRequestException('Fields need distinct ids');
      ids.add(f.id);
      if (!APPROVAL_FIELD_TYPES.includes(f.type)) throw new BadRequestException(`Unknown field type ${f.type}`);
      if (!f.label.trim()) throw new BadRequestException('Every field needs a label');
      if ((f.type === 'select' || f.type === 'multiselect') && !f.options?.filter((o) => o.trim()).length) throw new BadRequestException(`"${f.label}" needs options`);
    }
    if (!input.steps.some((s) => s.type === 'approve')) throw new BadRequestException('The process needs at least one approval step');
    const stepIds = new Set<string>();
    for (const s of input.steps) {
      if (!s.id || stepIds.has(s.id)) throw new BadRequestException('Steps need distinct ids');
      stepIds.add(s.id);
      if (!s.name.trim()) throw new BadRequestException('Every step needs a name');
      const a = s.approvers;
      if (a.kind === 'users') {
        if (!a.userIds.length) throw new BadRequestException(`Choose who approves "${s.name}"`);
        if ((await this.workspaceUserIds(actor, a.userIds)).length !== new Set(a.userIds).size) throw new BadRequestException('Approvers must be in the workspace');
      }
      if (a.kind === 'field' && input.fields.find((f) => f.id === a.fieldId)?.type !== 'person') throw new BadRequestException(`"${s.name}" must point at a person field`);
      if (s.condition && !input.fields.some((f) => f.id === s.condition!.fieldId)) throw new BadRequestException(`The condition of "${s.name}" uses a missing field`);
    }
    const ooo = input.onApproved?.calendarOoo?.fieldId;
    if (ooo && input.fields.find((f) => f.id === ooo)?.type !== 'daterange') throw new BadRequestException('The calendar entry needs a date range field');
    const admins = await this.workspaceUserIds(actor, input.admins ?? []);
    return {
      name: name.slice(0, 120),
      description: input.description?.trim() || null,
      category: input.category?.trim().slice(0, 40) || 'General',
      icon: input.icon?.slice(0, 40) || 'file-check',
      color: input.color?.slice(0, 20) || '#2563eb',
      fields: input.fields.map((f) => ({ ...f, label: f.label.trim(), options: f.options?.map((o) => o.trim()).filter(Boolean) })),
      steps: input.steps.map((s) => ({ ...s, name: s.name.trim() })),
      admins,
      onApproved: ooo ? { calendarOoo: { fieldId: ooo } } : null,
      enabled: input.enabled ?? true,
    };
  }

  async createTemplate(actor: Actor, input: TemplateInput) {
    if (!(await this.wsAdmin(actor))) throw new ForbiddenException('Workspace admins create approval templates');
    const clean = await this.checkTemplate(actor, input);
    const [t] = await this.db
      .insert(approvalTemplates)
      .values({ ...clean, workspaceId: actor.workspaceId, createdBy: actor.id })
      .returning();
    return (await this.templateDtos(actor, [t]))[0];
  }

  async updateTemplate(actor: Actor, id: string, input: Partial<TemplateInput>) {
    const t = await this.templateRow(actor, id);
    if (!this.manages(t, actor, await this.wsAdmin(actor))) throw new ForbiddenException('Only the template\'s admins change it');
    const clean = await this.checkTemplate(actor, {
      name: input.name ?? t.name,
      description: input.description !== undefined ? input.description : t.description,
      category: input.category ?? t.category,
      icon: input.icon ?? t.icon,
      color: input.color ?? t.color,
      fields: input.fields ?? (t.fields as ApprovalField[]),
      steps: input.steps ?? (t.steps as ApprovalStep[]),
      admins: input.admins ?? t.admins,
      onApproved: input.onApproved !== undefined ? input.onApproved : (t.onApproved as TemplateInput['onApproved']),
      enabled: input.enabled ?? t.enabled,
    });
    const [row] = await this.db
      .update(approvalTemplates)
      .set({ ...clean, updatedAt: new Date().toISOString() })
      .where(eq(approvalTemplates.id, id))
      .returning();
    return (await this.templateDtos(actor, [row]))[0];
  }

  async deleteTemplate(actor: Actor, id: string) {
    const t = await this.templateRow(actor, id);
    if (!(await this.wsAdmin(actor))) throw new ForbiddenException('Workspace admins delete approval templates');
    const [used] = await this.db.select({ id: approvalRequests.id }).from(approvalRequests).where(eq(approvalRequests.templateId, t.id)).limit(1);
    if (used) throw new ConflictException('This template has requests — turn it off instead');
    await this.db.delete(approvalTemplates).where(eq(approvalTemplates.id, id));
  }

  // ── Answers ───────────────────────────────────────────────────────────────

  /** Checks and normalises the answers; files must be the submitter's own uploads. */
  private async cleanValues(actor: Actor, fields: ApprovalField[], values: Record<string, unknown>) {
    const out: Record<string, unknown> = {};
    for (const f of fields) {
      let v = values[f.id];
      const empty = v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length);
      if (empty) {
        if (f.required) throw new BadRequestException(`"${f.label}" is required`);
        continue;
      }
      const bad = () => new BadRequestException(`"${f.label}" is not valid`);
      switch (f.type) {
        case 'text':
        case 'textarea':
          if (typeof v !== 'string') throw bad();
          v = v.trim().slice(0, f.type === 'text' ? 500 : 5000);
          if (!v && f.required) throw new BadRequestException(`"${f.label}" is required`);
          break;
        case 'number':
        case 'money': {
          const n = typeof v === 'number' ? v : Number(v);
          if (!Number.isFinite(n) || (f.type === 'money' && n < 0)) throw bad();
          v = f.type === 'money' ? Math.round(n * 100) / 100 : n;
          break;
        }
        case 'date':
          if (typeof v !== 'string' || !DAY.test(v)) throw bad();
          break;
        case 'daterange': {
          const r = v as { start?: unknown; end?: unknown };
          if (typeof r?.start !== 'string' || typeof r.end !== 'string' || !DAY.test(r.start) || !DAY.test(r.end)) throw bad();
          if (r.end < r.start) throw new BadRequestException(`"${f.label}": the end is before the start`);
          v = { start: r.start, end: r.end };
          break;
        }
        case 'select':
          if (!f.options?.includes(String(v))) throw bad();
          v = String(v);
          break;
        case 'multiselect':
          if (!Array.isArray(v) || v.some((x) => !f.options?.includes(String(x)))) throw bad();
          v = [...new Set(v.map(String))];
          break;
        case 'person':
          if (typeof v !== 'string' || !(await this.workspaceUserIds(actor, [v])).length) throw bad();
          break;
        case 'files': {
          if (!Array.isArray(v) || v.length > 20) throw bad();
          const ids = [...new Set(v.map(String))];
          const rows = await this.db.select({ id: resources.id, ownerId: resources.ownerId, ws: resources.workspaceId }).from(resources).where(inArray(resources.id, ids));
          if (rows.length !== ids.length || rows.some((r) => r.ownerId !== actor.id || r.ws !== actor.workspaceId)) throw new BadRequestException(`"${f.label}": attach files you uploaded`);
          v = ids;
          break;
        }
      }
      out[f.id] = v;
    }
    return out;
  }

  /** The submitter's manager, or the manager's manager. */
  private async manager(userId: string, level: 1 | 2, tx: Tx = this.db): Promise<string | null> {
    let cur: string | null = userId;
    for (let i = 0; i < level && cur; i++) {
      const [u] = await tx.select({ managerId: users.managerId }).from(users).where(eq(users.id, cur));
      cur = u?.managerId ?? null;
    }
    return cur;
  }

  /** Resolves every step for these answers: who is asked, or why the step is skipped. */
  private async route(actor: Actor, fields: ApprovalField[], steps: ApprovalStep[], values: Record<string, unknown>, picks: Record<string, string[]>): Promise<ApprovalRouteStep[]> {
    const out: ApprovalRouteStep[] = [];
    for (const s of steps) {
      const base = { stepId: s.id, name: s.name, type: s.type, mode: s.mode } as const;
      if (!approvalConditionHolds(s.condition, fields, values)) {
        out.push({ ...base, userIds: [], skipped: 'Condition not met' });
        continue;
      }
      let ids: string[] = [];
      const a = s.approvers;
      if (a.kind === 'users') ids = a.userIds;
      else if (a.kind === 'manager') {
        const m = await this.manager(actor.id, a.level);
        ids = m ? [m] : [];
      } else if (a.kind === 'field') ids = typeof values[a.fieldId] === 'string' ? [values[a.fieldId] as string] : [];
      else ids = picks[s.id] ?? [];
      ids = await this.workspaceUserIds(actor, ids);
      if (a.kind === 'pick' && !ids.length) out.push({ ...base, userIds: [], skipped: null, needsPick: true });
      else out.push({ ...base, userIds: ids, skipped: ids.length ? null : a.kind === 'manager' ? 'No manager on file' : 'Nobody to ask' });
    }
    return out;
  }

  /** The route as it would be for these answers (shown while filling the form). Invalid answers count as empty. */
  async preview(actor: Actor, templateId: string, values: Record<string, unknown>, picks: Record<string, string[]>) {
    const t = await this.templateRow(actor, templateId);
    const route = await this.route(actor, t.fields as ApprovalField[], t.steps as ApprovalStep[], values ?? {}, picks ?? {});
    const people = await loadUsers(this.db, route.flatMap((r) => r.userIds));
    return { route, people: [...people.values()] };
  }

  /** An attachment for a request: uploaded to the submitter's "Approval attachments" folder in My Files. */
  async upload(actor: Actor, file: Express.Multer.File | undefined) {
    if (!file) throw new BadRequestException('No file');
    const [f] = await this.db
      .select({ id: resources.id })
      .from(resources)
      .where(
        and(
          eq(resources.ownerId, actor.id),
          eq(resources.type, 'folder'),
          isNull(resources.parentId),
          isNull(resources.spaceId),
          isNull(resources.trashedAt),
          sql`${resources.metadata}->>'approvalFiles' = 'true'`,
        ),
      );
    let folder = f?.id;
    if (!folder) {
      folder = (await this.resources.create(actor, { name: 'Approval attachments', type: 'folder' })).id;
      await this.db.update(resources).set({ metadata: { approvalFiles: true } }).where(eq(resources.id, folder));
    }
    return this.resources.upload(actor, file, { parentId: folder });
  }

  // ── Submitting & moving through the steps ─────────────────────────────────

  async submit(actor: Actor, input: { templateId: string; values: Record<string, unknown>; picks?: Record<string, string[]> }) {
    const t = await this.templateRow(actor, input.templateId);
    if (!t.enabled) throw new BadRequestException('This approval is turned off');
    const fields = t.fields as ApprovalField[];
    const values = await this.cleanValues(actor, fields, input.values ?? {});
    const route = await this.route(actor, fields, t.steps as ApprovalStep[], values, input.picks ?? {});
    const pick = route.find((r) => r.needsPick);
    if (pick) throw new BadRequestException(`Choose who approves "${pick.name}"`);
    if (!route.some((r) => r.type === 'approve' && !r.skipped)) throw new BadRequestException('Nobody can approve this request — ask the template admin');
    const { req, effects } = await this.db.transaction(async (tx) => {
      // One numbering per workspace.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${'approvals:' + actor.workspaceId}))`);
      const [{ n }] = (await tx.execute<{ n: number }>(sql`SELECT coalesce(max(serial), 0) + 1 AS n FROM approval_requests WHERE workspace_id = ${actor.workspaceId}`)).rows;
      const [req] = await tx
        .insert(approvalRequests)
        .values({ workspaceId: actor.workspaceId, templateId: t.id, serial: Number(n), title: `${t.name} — ${actor.name}`, fields, values, route, submittedBy: actor.id })
        .returning();
      const tasks = route.flatMap((r, i) => (r.skipped ? [] : r.userIds.map((userId) => ({ requestId: req.id, stepIndex: i, userId, kind: r.type }))));
      if (tasks.length) await tx.insert(approvalTasks).values(tasks);
      await tx.insert(approvalEvents).values({ requestId: req.id, actorId: actor.id, kind: 'submitted' });
      const effects = await this.advance(tx, req, 0);
      return { req, effects };
    });
    await this.after(actor, req.id, effects);
    return this.get(actor, req.id);
  }

  /**
   * Opens steps from `from` on: CC steps are delivered and passed, an approval step waits for its people (the
   * submitter's own part is approved automatically). Past the last step the request is approved.
   */
  private async advance(tx: Tx, req: RequestRow, from: number): Promise<Effects> {
    const fx = noEffects();
    const route = req.route as ApprovalRouteStep[];
    const now = new Date().toISOString();
    for (let i = from; i < route.length; i++) {
      const st = route[i];
      if (st.skipped) continue;
      const rows = await tx.select().from(approvalTasks).where(and(eq(approvalTasks.requestId, req.id), eq(approvalTasks.stepIndex, i)));
      if (!rows.length) continue;
      if (st.type === 'cc') {
        await tx.update(approvalTasks).set({ status: 'cc', activatedAt: now }).where(and(eq(approvalTasks.requestId, req.id), eq(approvalTasks.stepIndex, i)));
        await tx.insert(approvalEvents).values({ requestId: req.id, kind: 'cc', stepIndex: i, data: { userIds: rows.map((r) => r.userId) } });
        await this.grantFiles(tx, req, rows.map((r) => r.userId));
        fx.cc.push(...rows.map((r) => r.userId));
        continue;
      }
      await tx
        .update(approvalTasks)
        .set({ status: 'pending', activatedAt: now })
        .where(and(eq(approvalTasks.requestId, req.id), eq(approvalTasks.stepIndex, i), eq(approvalTasks.status, 'waiting')));
      const own = rows.find((r) => r.userId === req.submittedBy);
      if (own) {
        await tx.update(approvalTasks).set({ status: 'approved', auto: true, actedAt: now }).where(eq(approvalTasks.id, own.id));
        await tx.insert(approvalEvents).values({ requestId: req.id, actorId: req.submittedBy, kind: 'approved', stepIndex: i, data: { auto: true } });
      }
      if (await this.stepDone(tx, req.id, i, st.mode)) continue;
      const pending = rows.filter((r) => r.userId !== req.submittedBy).map((r) => r.userId);
      await tx.update(approvalRequests).set({ currentStep: i }).where(eq(approvalRequests.id, req.id));
      await this.grantFiles(tx, req, pending);
      fx.pending.push(...pending);
      return fx;
    }
    await tx.update(approvalRequests).set({ status: 'approved', currentStep: route.length, finishedAt: now }).where(eq(approvalRequests.id, req.id));
    await tx.insert(approvalEvents).values({ requestId: req.id, kind: 'finished', data: { status: 'approved' } });
    fx.finished = 'approved';
    return fx;
  }

  /** "or": one approval closes the step (the others are skipped); "and": everyone has approved. */
  private async stepDone(tx: Tx, requestId: string, step: number, mode: 'and' | 'or') {
    const rows = await tx.select().from(approvalTasks).where(and(eq(approvalTasks.requestId, requestId), eq(approvalTasks.stepIndex, step)));
    const live = rows.filter((r) => r.status !== 'transferred' && r.status !== 'skipped');
    const done = mode === 'or' ? live.some((r) => r.status === 'approved') : live.length > 0 && live.every((r) => r.status === 'approved');
    if (done && mode === 'or')
      await tx
        .update(approvalTasks)
        .set({ status: 'skipped' })
        .where(and(eq(approvalTasks.requestId, requestId), eq(approvalTasks.stepIndex, step), eq(approvalTasks.status, 'pending')));
    return done;
  }

  /** People who must look at a request can open its attachments (the submitter's own uploads). */
  private async grantFiles(tx: Tx, req: RequestRow, userIds: string[]) {
    const ids = (req.fields as ApprovalField[]).filter((f) => f.type === 'files').flatMap((f) => (req.values[f.id] as string[] | undefined) ?? []);
    const to = [...new Set(userIds)].filter((u) => u !== req.submittedBy);
    if (!ids.length || !to.length) return;
    await tx
      .insert(aclEntries)
      .values(ids.flatMap((resourceId) => to.map((u) => ({ resourceId, principalType: 'user' as const, principalId: u, role: 'viewer' as const, createdBy: req.submittedBy }))))
      .onConflictDoNothing();
  }

  /** Bells, realtime, the calendar entry — after the transaction. */
  private async after(actor: Actor, requestId: string, fx: Effects) {
    const [req] = await this.db.select().from(approvalRequests).where(eq(approvalRequests.id, requestId));
    const [t] = await this.db.select().from(approvalTemplates).where(eq(approvalTemplates.id, req.templateId));
    const people = await loadUsers(this.db, [req.submittedBy]);
    const submitter = people.get(req.submittedBy)!;
    const url = `/approvals?r=${req.id}`;
    const summary = this.summaryText(req, await loadUsers(this.db, this.personIds(req)));
    if (fx.pending.length)
      await this.notifications.notify(actor, fx.pending, { kind: 'approval.pending', title: `${submitter.name} asks for your approval: ${t.name}`, body: summary, url }).catch(() => undefined);
    if (fx.cc.length) await this.notifications.notify(actor, fx.cc, { kind: 'approval.cc', title: `${t.name} from ${submitter.name} (CC)`, body: summary, url }).catch(() => undefined);
    if (fx.finished) {
      await this.notifications
        .notify(actor, [req.submittedBy], { kind: 'approval.result', title: `Your ${t.name.toLowerCase()} was ${fx.finished}`, body: `${approvalSerial(req.serial)} · ${summary}`, url })
        .catch(() => undefined);
      if (fx.finished === 'approved') await this.onApproved(t, req, submitter).catch(swallow(this.log, `after approval of ${approvalSerial(req.serial)}`));
      // Flows that start when a request is decided (§77 batch 2): values by field label.
      const fields = (t.fields as { id: string; label: string }[]) ?? [];
      flowHooks.fire('approval.finished', req.workspaceId, {
        requestId: req.id,
        templateId: t.id,
        templateName: t.name,
        serial: req.serial,
        status: fx.finished,
        submitter: { id: submitter.id, name: submitter.name, email: submitter.email },
        decidedBy: { id: actor.id, name: actor.name },
        values: Object.fromEntries(fields.map((f) => [f.label || f.id, req.values[f.id]])),
        valuesById: req.values,
      });
    }
    await this.changed(req.id);
  }

  /** A leave (or any template with a date range set up for it) goes into the submitter's calendar as Out of office. */
  private async onApproved(t: TemplateRow, req: RequestRow, submitter: UserSummary) {
    const fieldId = (t.onApproved as ApprovalTemplate['onApproved'])?.calendarOoo?.fieldId;
    const r = fieldId ? (req.values[fieldId] as { start: string; end: string } | undefined) : undefined;
    if (!r) return;
    const who: Actor = { id: submitter.id, name: submitter.name, workspaceId: req.workspaceId };
    const cal = await this.calendar.ensurePersonal(who);
    const tz = (cal as { timezone?: string | null }).timezone || 'Asia/Tokyo';
    const end = new Date(Date.parse(`${r.end}T00:00:00Z`) + 86400_000).toISOString().slice(0, 10);
    await this.calendar.create(who, {
      calendarId: cal.id,
      kind: 'ooo',
      title: `Out of office · ${t.name}`,
      description: `Approved ${approvalSerial(req.serial)}: /approvals?r=${req.id}`,
      start: `${r.start}T12:00:00Z`,
      end: `${end}T12:00:00Z`,
      allDay: true,
      timezone: tz,
      notify: false,
    });
  }

  private async changed(requestId: string) {
    const [req] = await this.db.select().from(approvalRequests).where(eq(approvalRequests.id, requestId));
    const tasks = await this.db.select({ userId: approvalTasks.userId }).from(approvalTasks).where(eq(approvalTasks.requestId, requestId));
    this.realtime.publish([req.submittedBy, ...tasks.map((x) => x.userId)], { type: 'approvals.changed', requestId });
  }

  private async lockPending(tx: Tx, actor: Actor, id: string) {
    const [req] = (await tx.execute<Record<string, unknown>>(sql`SELECT id FROM approval_requests WHERE id = ${id} FOR UPDATE`)).rows;
    if (!req) throw new NotFoundException('Request not found');
    const [row] = await tx.select().from(approvalRequests).where(eq(approvalRequests.id, id));
    if (row.workspaceId !== actor.workspaceId) throw new NotFoundException('Request not found');
    return row;
  }

  private async myPendingTask(tx: Tx, actor: Actor, req: RequestRow) {
    if (req.status !== 'pending') throw new ConflictException(`This request is already ${req.status}`);
    const [task] = await tx
      .select()
      .from(approvalTasks)
      .where(and(eq(approvalTasks.requestId, req.id), eq(approvalTasks.stepIndex, req.currentStep), eq(approvalTasks.userId, actor.id), eq(approvalTasks.status, 'pending')));
    if (!task) {
      if (!(await this.visible(actor, req, tx))) throw new NotFoundException('Request not found');
      throw new ForbiddenException('This request is not waiting for you');
    }
    return task;
  }

  async approve(actor: Actor, id: string, comment?: string | null) {
    const effects = await this.db.transaction(async (tx) => {
      const req = await this.lockPending(tx, actor, id);
      const task = await this.myPendingTask(tx, actor, req);
      const now = new Date().toISOString();
      await tx.update(approvalTasks).set({ status: 'approved', comment: comment?.trim() || null, actedAt: now }).where(eq(approvalTasks.id, task.id));
      await tx.insert(approvalEvents).values({ requestId: id, actorId: actor.id, kind: 'approved', stepIndex: task.stepIndex, body: comment?.trim() || null });
      const step = (req.route as ApprovalRouteStep[])[task.stepIndex];
      if (!(await this.stepDone(tx, id, task.stepIndex, step.mode))) return noEffects();
      return this.advance(tx, req, task.stepIndex + 1);
    });
    await this.after(actor, id, effects);
    return this.get(actor, id);
  }

  async reject(actor: Actor, id: string, comment: string) {
    if (!comment?.trim()) throw new BadRequestException('Say why you reject it');
    await this.db.transaction(async (tx) => {
      const req = await this.lockPending(tx, actor, id);
      const task = await this.myPendingTask(tx, actor, req);
      const now = new Date().toISOString();
      await tx.update(approvalTasks).set({ status: 'rejected', comment: comment.trim(), actedAt: now }).where(eq(approvalTasks.id, task.id));
      await tx.update(approvalTasks).set({ status: 'skipped' }).where(and(eq(approvalTasks.requestId, id), eq(approvalTasks.status, 'pending')));
      await tx.update(approvalRequests).set({ status: 'rejected', finishedAt: now }).where(eq(approvalRequests.id, id));
      await tx.insert(approvalEvents).values([
        { requestId: id, actorId: actor.id, kind: 'rejected', stepIndex: task.stepIndex, body: comment.trim() },
        { requestId: id, kind: 'finished', data: { status: 'rejected' } },
      ]);
    });
    await this.after(actor, id, { pending: [], cc: [], finished: 'rejected' });
    return this.get(actor, id);
  }

  /** Hands one's part of the current step to someone else. */
  async transfer(actor: Actor, id: string, toUserId: string, comment?: string | null) {
    const effects = await this.db.transaction(async (tx) => {
      const req = await this.lockPending(tx, actor, id);
      const task = await this.myPendingTask(tx, actor, req);
      if (toUserId === actor.id) throw new BadRequestException('Choose someone else');
      if (!(await this.workspaceUserIds(actor, [toUserId], tx)).length) throw new BadRequestException('That person is not in the workspace');
      const [already] = await tx
        .select({ id: approvalTasks.id })
        .from(approvalTasks)
        .where(and(eq(approvalTasks.requestId, id), eq(approvalTasks.stepIndex, task.stepIndex), eq(approvalTasks.userId, toUserId), inArray(approvalTasks.status, ['pending', 'approved'])));
      if (already) throw new BadRequestException('They are already on this step');
      const now = new Date().toISOString();
      await tx.update(approvalTasks).set({ status: 'transferred', transferredTo: toUserId, comment: comment?.trim() || null, actedAt: now }).where(eq(approvalTasks.id, task.id));
      await tx.insert(approvalTasks).values({ requestId: id, stepIndex: task.stepIndex, userId: toUserId, kind: 'approve', status: 'pending', activatedAt: now });
      await tx.insert(approvalEvents).values({ requestId: id, actorId: actor.id, kind: 'transferred', stepIndex: task.stepIndex, body: comment?.trim() || null, data: { to: toUserId } });
      await this.grantFiles(tx, req, [toUserId]);
      return { pending: [toUserId], cc: [], finished: null } satisfies Effects;
    });
    await this.after(actor, id, effects);
    return this.get(actor, id);
  }

  async withdraw(actor: Actor, id: string) {
    await this.db.transaction(async (tx) => {
      const req = await this.lockPending(tx, actor, id);
      if (req.submittedBy !== actor.id) throw new ForbiddenException('Only the submitter withdraws a request');
      if (req.status !== 'pending') throw new ConflictException(`This request is already ${req.status}`);
      await tx.update(approvalTasks).set({ status: 'skipped' }).where(and(eq(approvalTasks.requestId, id), eq(approvalTasks.status, 'pending')));
      await tx.update(approvalRequests).set({ status: 'withdrawn', finishedAt: new Date().toISOString() }).where(eq(approvalRequests.id, id));
      await tx.insert(approvalEvents).values({ requestId: id, actorId: actor.id, kind: 'withdrawn' });
    });
    await this.changed(id);
    return this.get(actor, id);
  }

  /** The submitter nudges the people the request waits on (at most every 10 minutes). */
  async remind(actor: Actor, id: string) {
    const req = await this.requestRow(actor, id);
    if (req.submittedBy !== actor.id) throw new ForbiddenException('Only the submitter sends reminders');
    if (req.status !== 'pending') throw new ConflictException(`This request is already ${req.status}`);
    if (req.remindedAt && Date.now() - Date.parse(req.remindedAt) < REMIND_EVERY_MS) throw new HttpException('You reminded them a moment ago', 429);
    const pending = await this.db
      .select({ userId: approvalTasks.userId })
      .from(approvalTasks)
      .where(and(eq(approvalTasks.requestId, id), eq(approvalTasks.status, 'pending')));
    await this.db.update(approvalRequests).set({ remindedAt: new Date().toISOString() }).where(eq(approvalRequests.id, id));
    await this.db.insert(approvalEvents).values({ requestId: id, actorId: actor.id, kind: 'reminded' });
    const [t] = await this.db.select().from(approvalTemplates).where(eq(approvalTemplates.id, req.templateId));
    await this.notifications
      .notify(actor, pending.map((p) => p.userId), { kind: 'approval.pending', title: `${actor.name} reminded you to review: ${t.name}`, body: approvalSerial(req.serial), url: `/approvals?r=${id}` })
      .catch(() => undefined);
    await this.changed(id);
    return { reminded: pending.length };
  }

  async comment(actor: Actor, id: string, body: string) {
    const text = body?.trim();
    if (!text) throw new BadRequestException('Write a comment');
    const req = await this.requestRow(actor, id);
    await this.db.insert(approvalEvents).values({ requestId: id, actorId: actor.id, kind: 'comment', body: text.slice(0, 4000) });
    const involved = await this.db
      .select({ userId: approvalTasks.userId })
      .from(approvalTasks)
      .where(and(eq(approvalTasks.requestId, id), ne(approvalTasks.status, 'waiting')));
    const [t] = await this.db.select().from(approvalTemplates).where(eq(approvalTemplates.id, req.templateId));
    await this.notifications
      .notify(actor, [req.submittedBy, ...involved.map((i) => i.userId)], { kind: 'approval.comment', title: `${actor.name} commented on ${t.name} ${approvalSerial(req.serial)}`, body: text.slice(0, 200), url: `/approvals?r=${id}` })
      .catch(() => undefined);
    await this.changed(id);
    return this.get(actor, id);
  }

  // ── Reading ───────────────────────────────────────────────────────────────

  /** Submitter, people the request has reached, the template's managers. */
  /** May this person see the request? (flow triggers run with the flow owner's rights, §85 B) */
  async canSeeRequest(actor: Actor, requestId: string) {
    const [req] = await this.db.select().from(approvalRequests).where(eq(approvalRequests.id, requestId));
    return !!req && this.visible(actor, req);
  }

  private async visible(actor: Actor, req: RequestRow, tx: Tx = this.db) {
    if (req.workspaceId !== actor.workspaceId) return false;
    if (req.submittedBy === actor.id) return true;
    const [task] = await tx
      .select({ id: approvalTasks.id })
      .from(approvalTasks)
      .where(and(eq(approvalTasks.requestId, req.id), eq(approvalTasks.userId, actor.id), ne(approvalTasks.status, 'waiting')))
      .limit(1);
    if (task) return true;
    const [t] = await tx.select().from(approvalTemplates).where(eq(approvalTemplates.id, req.templateId));
    return !!t && this.manages(t, actor, await this.wsAdmin(actor, tx));
  }

  private async requestRow(actor: Actor, id: string) {
    const [req] = await this.db.select().from(approvalRequests).where(eq(approvalRequests.id, id));
    if (!req || !(await this.visible(actor, req))) throw new NotFoundException('Request not found');
    return req;
  }

  private personIds(req: RequestRow) {
    return (req.fields as ApprovalField[]).filter((f) => f.type === 'person').map((f) => req.values[f.id] as string | undefined);
  }

  private summaryText(req: RequestRow, people: Map<string, UserSummary>) {
    return this.summary(req, people)
      .map((s) => `${s.label}: ${s.value}`)
      .join(' · ');
  }

  private summary(req: RequestRow, people: Map<string, UserSummary>) {
    return (req.fields as ApprovalField[])
      .filter((f) => f.type !== 'files' && f.type !== 'textarea' && req.values[f.id] !== undefined)
      .slice(0, 3)
      .map((f) => ({ label: f.label, value: approvalValueText(f, req.values[f.id], people) }));
  }

  private async summaries(actor: Actor, rows: RequestRow[]): Promise<ApprovalRequestSummary[]> {
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const templates = await this.db.select().from(approvalTemplates).where(inArray(approvalTemplates.id, [...new Set(rows.map((r) => r.templateId))]));
    const pending = await this.db
      .select({ requestId: approvalTasks.requestId, userId: approvalTasks.userId })
      .from(approvalTasks)
      .where(and(inArray(approvalTasks.requestId, ids), eq(approvalTasks.status, 'pending')));
    const people = await loadUsers(this.db, [...rows.map((r) => r.submittedBy), ...pending.map((p) => p.userId), ...rows.flatMap((r) => this.personIds(r))]);
    return rows.map((r) => {
      const t = templates.find((x) => x.id === r.templateId)!;
      const waiting = r.status === 'pending' ? pending.filter((p) => p.requestId === r.id) : [];
      return {
        id: r.id,
        serial: approvalSerial(r.serial),
        title: r.title,
        template: { id: t.id, name: t.name, icon: t.icon, color: t.color },
        submitter: people.get(r.submittedBy)!,
        status: r.status,
        submittedAt: r.submittedAt,
        finishedAt: r.finishedAt,
        summary: this.summary(r, people),
        waitingOn: waiting.map((p) => people.get(p.userId)!).filter(Boolean),
        mine: waiting.some((p) => p.userId === actor.id),
      };
    });
  }

  async list(actor: Actor, box: ApprovalBox, q: { templateId?: string; status?: string; search?: string }): Promise<ApprovalRequestSummary[]> {
    const conds = [eq(approvalRequests.workspaceId, actor.workspaceId)];
    const taskWhere = (status: ApprovalTaskStatus[], extra = sql`true`) =>
      sql`EXISTS (SELECT 1 FROM approval_tasks x WHERE x.request_id = ${approvalRequests.id} AND x.user_id = ${actor.id} AND x.status IN (${sql.join(status.map((s) => sql`${s}`), sql`, `)}) AND ${extra})`;
    if (box === 'pending') conds.push(eq(approvalRequests.status, 'pending'), taskWhere(['pending']));
    else if (box === 'processed') conds.push(taskWhere(['approved', 'rejected', 'transferred'], sql`x.auto = false`));
    else if (box === 'submitted') conds.push(eq(approvalRequests.submittedBy, actor.id));
    else if (box === 'cc') conds.push(taskWhere(['cc']));
    else {
      const admin = await this.wsAdmin(actor);
      if (!admin) {
        const mine = await this.db
          .select({ id: approvalTemplates.id })
          .from(approvalTemplates)
          .where(and(eq(approvalTemplates.workspaceId, actor.workspaceId), sql`${actor.id} = ANY(${approvalTemplates.admins})`));
        if (!mine.length) return [];
        conds.push(inArray(approvalRequests.templateId, mine.map((m) => m.id)));
      }
    }
    if (q.templateId) conds.push(eq(approvalRequests.templateId, q.templateId));
    if (q.status && ['pending', 'approved', 'rejected', 'withdrawn'].includes(q.status)) conds.push(eq(approvalRequests.status, q.status as RequestRow['status']));
    const rows = await this.db.select().from(approvalRequests).where(and(...conds)).orderBy(desc(approvalRequests.submittedAt)).limit(200);
    const out = await this.summaries(actor, rows);
    const needle = q.search?.trim().toLowerCase();
    if (!needle) return out;
    return out.filter((r) => [r.title, r.serial, r.submitter.name, ...r.summary.map((s) => s.value)].some((x) => x.toLowerCase().includes(needle)));
  }

  async counts(actor: Actor): Promise<ApprovalCounts> {
    const [row] = (
      await this.db.execute<{ pending: string; cc: string }>(sql`
        SELECT count(*) FILTER (WHERE t.status = 'pending' AND r.status = 'pending') AS pending,
               count(*) FILTER (WHERE t.status = 'cc' AND t.activated_at > now() - interval '7 days') AS cc
        FROM approval_tasks t JOIN approval_requests r ON r.id = t.request_id
        WHERE t.user_id = ${actor.id} AND r.workspace_id = ${actor.workspaceId}`)
    ).rows;
    const admin = await this.wsAdmin(actor);
    const [managed] = admin
      ? [true]
      : await this.db
          .select({ id: approvalTemplates.id })
          .from(approvalTemplates)
          .where(and(eq(approvalTemplates.workspaceId, actor.workspaceId), sql`${actor.id} = ANY(${approvalTemplates.admins})`))
          .limit(1);
    return { pending: Number(row?.pending ?? 0), cc: Number(row?.cc ?? 0), admin, manages: !!managed };
  }

  async get(actor: Actor, id: string): Promise<ApprovalRequestDetail> {
    const req = await this.requestRow(actor, id);
    const [summary] = await this.summaries(actor, [req]);
    const tasks = await this.db.select().from(approvalTasks).where(eq(approvalTasks.requestId, id)).orderBy(approvalTasks.stepIndex);
    const events = await this.db.select().from(approvalEvents).where(eq(approvalEvents.requestId, id)).orderBy(approvalEvents.createdAt);
    const fields = req.fields as ApprovalField[];
    const fileIds = fields.filter((f) => f.type === 'files').flatMap((f) => (req.values[f.id] as string[] | undefined) ?? []);
    const people = await loadUsers(this.db, [
      req.submittedBy,
      ...tasks.flatMap((t) => [t.userId, t.transferredTo]),
      ...events.map((e) => e.actorId),
      ...events.map((e) => (e.data as { to?: string }).to),
      ...this.personIds(req),
    ]);
    const fileRows = fileIds.length ? await this.db.select(resourceColumns).from(resources).where(inArray(resources.id, fileIds)) : [];
    const roles = await this.perms.rolesFor(actor, fileRows);
    const route = req.route as ApprovalRouteStep[];
    const steps: ApprovalStepView[] = route.map((r, index) => {
      const mine = tasks.filter((t) => t.stepIndex === index);
      const state: ApprovalStepView['state'] = r.skipped
        ? 'skipped'
        : mine.some((t) => t.status === 'rejected')
          ? 'rejected'
          : mine.length && mine.every((t) => t.status === 'waiting')
            ? 'upcoming'
            : mine.some((t) => t.status === 'pending') && req.status === 'pending'
              ? 'active'
              : r.type === 'cc' || mine.some((t) => t.status === 'approved')
                ? 'done'
                : req.status === 'pending'
                  ? 'upcoming'
                  : 'skipped';
      return {
        index,
        name: r.name,
        type: r.type,
        mode: r.mode,
        state,
        note: r.skipped,
        people: mine.map((t: TaskRow) => ({
          user: people.get(t.userId)!,
          status: t.status,
          comment: t.comment,
          actedAt: t.actedAt,
          auto: t.auto,
          transferredTo: t.transferredTo ? people.get(t.transferredTo) ?? null : null,
        })),
      };
    });
    const myTask = tasks.find((t) => t.userId === actor.id && t.status === 'pending' && t.stepIndex === req.currentStep);
    return {
      ...summary,
      fields,
      values: req.values,
      people: [...people.values()],
      files: fileRows.map((f) => ({ id: f.id, name: f.name, type: f.type, accessible: can(roles.get(f.id), 'viewer') && !f.trashedAt })),
      steps,
      events: events.map(
        (e): ApprovalEventView => ({
          id: e.id,
          actor: e.actorId ? people.get(e.actorId) ?? null : null,
          kind: e.kind as ApprovalEventView['kind'],
          stepIndex: e.stepIndex,
          body: e.body,
          data: e.data,
          createdAt: e.createdAt,
        }),
      ),
      perms: {
        approve: req.status === 'pending' && !!myTask,
        withdraw: req.status === 'pending' && req.submittedBy === actor.id,
        remind: req.status === 'pending' && req.submittedBy === actor.id,
        comment: true,
      },
    };
  }
}
