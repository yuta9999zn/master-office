import { BadRequestException, Injectable, Logger, NotFoundException, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import {
  ACTION_TYPES,
  automationOf,
  branchEdges,
  evaluateCondition,
  hasFlow,
  outgoing,
  readFlow,
  render,
  renderObject,
  renderValue,
  validateAutomation,
  writeFlow,
  INFO_MAP,
  PAGE_ORDER,
  PAGES_MAP,
  NODES_MAP,
  EDGES_MAP,
  type AutomationRole,
  type FlowNode,
  type PlainFlow,
  type Schedule,
} from '@workos/flow-model';
import { and, asc, desc, eq, inArray, isNotNull, lte, sql } from 'drizzle-orm';
import * as Y from 'yjs';
import { ApprovalsService } from '../approvals/approvals.service';
import { BaseService } from '../base/base.service';
import { ChatService } from '../chat/chat.service';
import { CollabService } from '../collab/collab.service';
import type { Actor } from '../common/current-user';
import { loadUsers } from '../common/users';
import type { Db } from '../db/client';
import { InjectDb } from '../db/db.module';
import { flowRuns, flowTriggers, resources, users } from '../db/schema';
import { DocStore } from '../docs/doc-store';
import { MailService } from '../mail/mail.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PermissionsService } from '../permissions/permissions.service';
import { TasksService } from '../tasks/tasks.service';
import { nextRun, validSchedule } from '../sheets/macro-triggers.service';
import { flowHooks, type FlowHookEvent } from './flow-hooks';

type RunRow = typeof flowRuns.$inferSelect;
type TriggerRow = typeof flowTriggers.$inferSelect;

export interface FlowRunStep {
  nodeId: string;
  name: string;
  role: AutomationRole;
  type: string;
  status: 'ok' | 'error' | 'waiting' | 'passed';
  startedAt: string;
  finishedAt?: string;
  output?: unknown;
  error?: string;
  /** Which way a condition went. */
  branch?: 'yes' | 'no';
}

const TICK_MS = 30_000;
/** A run visits at most this many shapes (loops in a diagram must end). */
const MAX_STEPS = 200;
const WEBHOOK_TIMEOUT_MS = 10_000;

/**
 * Runs flows (docs/ARCHITECTURE.md §77, batch 2). The diagram is the program: trigger shapes start a run, the run
 * walks the connectors, actions call the other modules as the flow's owner, conditions pick the Yes / No connector,
 * "Wait" parks the run until its time. Every run keeps its steps for the Runs tab.
 */
@Injectable()
export class FlowRunnerService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(FlowRunnerService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private ticking = false;
  private readonly onHook = (ev: FlowHookEvent) => void this.fire(ev).catch((e: Error) => this.log.warn(`fire ${ev.type}: ${e.message}`));

  constructor(
    @InjectDb() private readonly db: Db,
    private readonly store: DocStore,
    private readonly collab: CollabService,
    private readonly perms: PermissionsService,
    private readonly moduleRef: ModuleRef,
  ) {}

  onModuleInit() {
    this.store.onSaved((id, doc) => (hasFlow(doc) ? this.syncTriggers(id, readFlow(doc)) : undefined));
    flowHooks.on('fire', this.onHook);
    this.timer = setInterval(() => void this.tick().catch((e: Error) => this.log.error(`tick: ${e.stack ?? e.message}`)), TICK_MS);
    void this.recoverInterrupted().catch((e: Error) => this.log.warn(`recover runs: ${e.message}`));
  }

  /** Runs that were mid-flight when the process stopped can never continue (one process holds them): mark them so. */
  private async recoverInterrupted() {
    const rows = await this.db
      .update(flowRuns)
      .set({ status: 'failed', error: 'Interrupted by a server restart', finishedAt: new Date().toISOString(), pending: [] })
      .where(eq(flowRuns.status, 'running'))
      .returning({ id: flowRuns.id, flowId: flowRuns.flowId });
    if (rows.length) this.log.warn(`${rows.length} flow run(s) were interrupted by the restart and marked failed`);
    for (const r of rows) this.collab.notify(r.flowId, { type: 'runs' });
  }

  onModuleDestroy() {
    flowHooks.off('fire', this.onHook);
    if (this.timer) clearInterval(this.timer);
  }

  // ── Trigger index ─────────────────────────────────────────────────────────

  /** Mirrors the flow's trigger shapes into flow_triggers (after every save, and after an import). */
  async syncTriggers(flowId: string, f: PlainFlow) {
    const [r] = await this.db.select({ workspaceId: resources.workspaceId }).from(resources).where(eq(resources.id, flowId));
    if (!r) return;
    const existing = await this.db.select().from(flowTriggers).where(eq(flowTriggers.flowId, flowId));
    const wanted = f.nodes.filter((n) => automationOf(n).role === 'trigger' && automationOf(n).type);
    const keep = new Set(wanted.map((n) => n.id));
    const gone = existing.filter((e) => !keep.has(e.nodeId)).map((e) => e.nodeId);
    if (gone.length) await this.db.delete(flowTriggers).where(and(eq(flowTriggers.flowId, flowId), inArray(flowTriggers.nodeId, gone)));
    for (const n of wanted) {
      const a = automationOf(n);
      const prev = existing.find((e) => e.nodeId === n.id);
      const schedule = a.type === 'schedule' ? (a.config.schedule as Schedule | undefined) : undefined;
      const scheduleChanged = JSON.stringify(prev?.config?.schedule ?? null) !== JSON.stringify(schedule ?? null);
      const nextRunAt =
        a.type !== 'schedule' || !schedule || !validSchedule(schedule)
          ? null
          : prev?.nextRunAt && !scheduleChanged && prev.enabled === f.info.automation
            ? prev.nextRunAt
            : nextRun(schedule).toISOString();
      const row = { workspaceId: r.workspaceId, pageId: n.page, type: a.type, config: a.config, enabled: f.info.automation, nextRunAt, updatedAt: new Date().toISOString() };
      await this.db
        .insert(flowTriggers)
        .values({ flowId, nodeId: n.id, ...row })
        .onConflictDoUpdate({ target: [flowTriggers.flowId, flowTriggers.nodeId], set: row });
    }
  }

  /** An event from another module: start every enabled flow whose trigger matches. */
  async fire(ev: FlowHookEvent) {
    const rows = await this.db.select().from(flowTriggers).where(and(eq(flowTriggers.workspaceId, ev.workspaceId), eq(flowTriggers.type, ev.type), eq(flowTriggers.enabled, true)));
    // A flow never restarts itself from its own actions (a record it stamps, a task it creates…); chains between flows are fine.
    const hits = rows.filter((t) => t.flowId !== ev.origin?.flowId && matches(t.type, t.config, ev.payload));
    await Promise.all(hits.map((t) => this.start(t.flowId, t.nodeId, t.type, ev.payload, null).catch((e: Error) => this.log.warn(`flow ${t.flowId}: ${e.message}`))));
    return hits.length;
  }

  async tick() {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const now = new Date().toISOString();
      const due = await this.db
        .select()
        .from(flowTriggers)
        .where(and(eq(flowTriggers.enabled, true), eq(flowTriggers.type, 'schedule'), isNotNull(flowTriggers.nextRunAt), lte(flowTriggers.nextRunAt, now)))
        .orderBy(asc(flowTriggers.nextRunAt));
      for (const t of due) {
        const s = t.config.schedule as Schedule | undefined;
        // Claim the slot first so a second API instance does not run it too.
        const claimed = await this.db
          .update(flowTriggers)
          .set({ nextRunAt: s && validSchedule(s) ? nextRun(s).toISOString() : null })
          .where(and(eq(flowTriggers.flowId, t.flowId), eq(flowTriggers.nodeId, t.nodeId), eq(flowTriggers.nextRunAt, t.nextRunAt!)))
          .returning({ flowId: flowTriggers.flowId });
        if (claimed.length) await this.start(t.flowId, t.nodeId, 'schedule', { at: now, schedule: s ?? null }, null).catch((e: Error) => this.log.warn(`schedule ${t.flowId}: ${e.message}`));
      }
      const waiting = await this.db.select().from(flowRuns).where(and(eq(flowRuns.status, 'waiting'), isNotNull(flowRuns.resumeAt), lte(flowRuns.resumeAt, now)));
      for (const run of waiting) await this.resume(run).catch((e: Error) => this.log.warn(`resume ${run.id}: ${e.message}`));
    } finally {
      this.ticking = false;
    }
  }

  // ── Runs ──────────────────────────────────────────────────────────────────

  private async loadFlow(flowId: string): Promise<PlainFlow | null> {
    const state = (await this.collab.currentState(flowId)) ?? (await this.store.load(flowId));
    if (!state) return null;
    const doc = new Y.Doc();
    Y.applyUpdate(doc, state);
    return readFlow(doc);
  }

  /** The flow's owner — actions run as them. */
  private async ownerOf(flowId: string): Promise<{ actor: Actor; name: string; spaceId: string | null }> {
    const [r] = await this.db
      .select({ ownerId: resources.ownerId, workspaceId: resources.workspaceId, name: resources.name, spaceId: resources.spaceId })
      .from(resources)
      .where(eq(resources.id, flowId));
    if (!r) throw new NotFoundException('Flow not found');
    const [u] = await this.db.select({ name: users.name }).from(users).where(eq(users.id, r.ownerId));
    return { actor: { id: r.ownerId, name: u?.name ?? 'Flow', workspaceId: r.workspaceId }, name: r.name, spaceId: r.spaceId };
  }

  /** Starts a run at a trigger shape and walks the diagram until it ends or waits. */
  async start(flowId: string, triggerNodeId: string, triggerType: string, payload: Record<string, unknown>, runBy: string | null): Promise<RunRow> {
    const f = await this.loadFlow(flowId);
    if (!f) throw new NotFoundException('Flow has no content');
    const trigger = f.nodes.find((n) => n.id === triggerNodeId);
    if (!trigger) throw new BadRequestException('The trigger shape no longer exists');
    const owner = await this.ownerOf(flowId);
    const [run] = await this.db
      .insert(flowRuns)
      .values({
        flowId,
        workspaceId: owner.actor.workspaceId,
        pageId: trigger.page,
        triggerNodeId,
        triggerType,
        trigger: payload,
        status: 'running',
        steps: [{ nodeId: trigger.id, name: trigger.text || 'Trigger', role: 'trigger', type: triggerType, status: 'ok', startedAt: new Date().toISOString(), finishedAt: new Date().toISOString() } satisfies FlowRunStep],
        context: { trigger: payload, steps: {}, flow: { id: flowId, name: owner.name } },
        pending: outgoing(f, trigger.id).map((e) => e.to),
        runBy,
      })
      .returning();
    this.collab.notify(flowId, { type: 'runs' });
    return this.walkSafely(run, f, owner.actor);
  }

  /** `walk` only guards the actions; a condition, a template or a DB write that throws must still end the run. */
  private async walkSafely(run: RunRow, f: PlainFlow, actor: Actor): Promise<RunRow> {
    try {
      return await this.walk(run, f, actor);
    } catch (e) {
      this.log.error(`run ${run.id} of flow ${run.flowId}: ${(e as Error).stack ?? (e as Error).message}`);
      return this.finish(run, 'failed', `Internal error: ${(e as Error).message}`.slice(0, 500));
    }
  }

  /** Continues a waiting run (its time came, or someone pressed Continue). */
  async resume(run: RunRow): Promise<RunRow> {
    const f = await this.loadFlow(run.flowId);
    if (!f) return this.finish(run, 'failed', 'Flow has no content');
    const owner = await this.ownerOf(run.flowId);
    const [claimed] = await this.db.update(flowRuns).set({ status: 'running', resumeAt: null }).where(and(eq(flowRuns.id, run.id), eq(flowRuns.status, 'waiting'))).returning();
    if (!claimed) return run;
    const steps = claimed.steps as unknown as FlowRunStep[];
    const last = steps[steps.length - 1];
    if (last?.status === 'waiting') {
      last.status = 'ok';
      last.finishedAt = new Date().toISOString();
    }
    return this.walkSafely({ ...claimed, steps: steps as unknown as Record<string, unknown>[] }, f, owner.actor);
  }

  private async walk(run: RunRow, f: PlainFlow, runAs: Actor): Promise<RunRow> {
    const steps = run.steps as unknown as FlowRunStep[];
    const ctx = run.context as { trigger: unknown; steps: Record<string, unknown>; flow: unknown };
    const queue = [...run.pending];
    const visits = new Map<string, number>();
    let waitingFor: { at: string; pending: string[] } | null = null;
    let error: string | null = null;
    while (queue.length && !waitingFor && !error) {
      if (steps.length >= MAX_STEPS) {
        error = `Stopped after ${MAX_STEPS} steps — the diagram loops.`;
        break;
      }
      const id = queue.shift()!;
      const n = f.nodes.find((x) => x.id === id);
      if (!n) continue;
      const seen = (visits.get(id) ?? 0) + 1;
      visits.set(id, seen);
      if (seen > 20) {
        error = `“${n.text || n.shape}” ran 20 times — the diagram loops.`;
        break;
      }
      const a = automationOf(n);
      const step: FlowRunStep = { nodeId: id, name: n.text.trim() || n.shape, role: a.role, type: a.type, status: 'ok', startedAt: new Date().toISOString() };
      const next = outgoing(f, id);
      if (a.role === 'condition') {
        const yes = evaluateCondition(a.config, ctx);
        step.branch = yes ? 'yes' : 'no';
        step.output = { result: yes, left: renderValue(String(a.config.left ?? ''), ctx), right: renderValue(String(a.config.right ?? ''), ctx) };
        queue.push(...branchEdges(next, yes).map((e) => e.to));
      } else if (a.role === 'action') {
        try {
          const out = await flowHooks.origin.run({ flowId: run.flowId, runId: run.id }, () => this.act(a.type, a.config, ctx, { runAs, flowId: run.flowId, runId: run.id, node: n }));
          if (out && typeof out === 'object' && '__wait' in out) {
            step.status = 'waiting';
            step.output = { until: (out as { __wait: string }).__wait };
            waitingFor = { at: (out as { __wait: string }).__wait, pending: next.map((e) => e.to) };
          } else {
            step.output = out ?? null;
            ctx.steps[id] = out ?? {};
            queue.push(...next.map((e) => e.to));
          }
        } catch (e) {
          step.status = 'error';
          step.error = (e as Error).message?.slice(0, 500) ?? String(e);
          error = `“${step.name}”: ${step.error}`;
        }
      } else {
        // A documentation step (or a second trigger shape): pass through.
        step.status = 'passed';
        queue.push(...next.map((e) => e.to));
      }
      step.finishedAt = new Date().toISOString();
      steps.push(step);
      await this.db.update(flowRuns).set({ steps: steps as unknown as Record<string, unknown>[], context: ctx as unknown as Record<string, unknown> }).where(eq(flowRuns.id, run.id));
    }
    if (waitingFor) {
      const [row] = await this.db
        .update(flowRuns)
        .set({ status: 'waiting', resumeAt: waitingFor.at, pending: waitingFor.pending })
        .where(eq(flowRuns.id, run.id))
        .returning();
      this.collab.notify(run.flowId, { type: 'runs' });
      return row;
    }
    return this.finish({ ...run, steps: steps as unknown as Record<string, unknown>[] }, error ? 'failed' : 'succeeded', error);
  }

  private async finish(run: RunRow, status: 'succeeded' | 'failed', error: string | null) {
    const [row] = await this.db
      .update(flowRuns)
      .set({ status, error, finishedAt: new Date().toISOString(), pending: [], resumeAt: null })
      .where(eq(flowRuns.id, run.id))
      .returning();
    this.collab.notify(run.flowId, { type: 'runs' });
    return row;
  }

  // ── Actions ───────────────────────────────────────────────────────────────

  private async act(type: string, cfg: Record<string, unknown>, ctx: unknown, env: { runAs: Actor; flowId: string; runId: string; node: FlowNode }): Promise<unknown> {
    const def = ACTION_TYPES.find((t) => t.id === type);
    if (!def) throw new Error(type ? `Unknown action "${type}"` : 'This action has no type yet');
    for (const k of def.required) if (cfg[k] === undefined || cfg[k] === null || cfg[k] === '') throw new Error(`"${k}" is not set`);
    const str = (k: string) => render(cfg[k], ctx);
    switch (type) {
      case 'mail.send': {
        const to = str('to')
          .split(/[,;]/)
          .map((s) => s.trim())
          .filter(Boolean);
        if (!to.length) throw new Error('No recipient (the "to" template came out empty)');
        const subject = str('subject');
        const text = str('body');
        const id = await this.moduleRef.get(MailService, { strict: false }).send({ kind: 'flow.action', to: to.join(', '), subject, text, resourceId: env.flowId });
        return { to, subject, delivered: !!id, messageId: id };
      }
      case 'notify': {
        const ids = new Set<string>((cfg.userIds as string[] | undefined) ?? []);
        if (cfg.toTrigger !== false) for (const p of ['trigger.respondent.id', 'trigger.submitter.id', 'trigger.by.id', 'trigger.assigneeId']) {
          const v = renderValue(`{{${p}}}`, ctx);
          if (typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v)) ids.add(v);
        }
        if (!ids.size) throw new Error('Nobody to notify: pick people, or make sure the trigger carries a person');
        const title = str('title').slice(0, 200);
        await this.moduleRef.get(NotificationsService, { strict: false }).notify(env.runAs, ids, { kind: 'flow.run', title, body: str('body').slice(0, 1000) || null, url: String(cfg.url ? str('url') : `/flow/${env.flowId}?tab=runs`), resourceId: env.flowId });
        return { userIds: [...ids], title };
      }
      case 'task.create': {
        const t = await this.moduleRef.get(TasksService, { strict: false }).create(env.runAs, {
          projectId: String(cfg.projectId),
          title: str('title').slice(0, 300) || 'Task from flow',
          description: cfg.description ? str('description') : null,
          assigneeId: cfg.assigneeId ? String(renderValue(cfg.assigneeId, ctx) || '') || null : null,
          priority: (cfg.priority as 'low' | 'medium' | 'high' | 'urgent' | undefined) || undefined,
          dueDate: cfg.dueInDays ? new Date(Date.now() + Number(cfg.dueInDays) * 86_400_000).toISOString().slice(0, 10) : undefined,
        });
        return { taskId: t.id, number: (t as { number?: number }).number ?? null, title: t.title, url: `/tasks?project=${t.projectId}&task=${t.id}` };
      }
      case 'base.createRecord': {
        const [rec] = await this.moduleRef.get(BaseService, { strict: false }).createRecords(env.runAs, String(cfg.tableId), [{ values: renderObject(cfg.values as Record<string, unknown>, ctx) }]);
        return { recordId: rec.id, autoNumber: rec.autoNumber };
      }
      case 'base.updateRecord': {
        const id = str('recordId').trim();
        if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error(`"${id || '(empty)'}" is not a record id`);
        const [rec] = await this.moduleRef.get(BaseService, { strict: false }).updateRecords(env.runAs, [{ id, values: renderObject(cfg.values as Record<string, unknown>, ctx) }]);
        return { recordId: rec.id };
      }
      case 'approval.submit': {
        const r = await this.moduleRef.get(ApprovalsService, { strict: false }).submit(env.runAs, { templateId: String(cfg.templateId), values: renderObject(cfg.values as Record<string, unknown>, ctx) });
        return { requestId: r.id, serial: r.serial, url: `/approvals?r=${r.id}` };
      }
      case 'chat.send': {
        const m = await this.moduleRef.get(ChatService, { strict: false }).send(env.runAs, String(cfg.conversationId), { body: str('body').slice(0, 4000) });
        return { messageId: m.id, conversationId: String(cfg.conversationId) };
      }
      case 'delay': {
        const minutes = Number(renderValue(cfg.minutes, ctx));
        if (!Number.isFinite(minutes) || minutes < 0 || minutes > 60 * 24 * 30) throw new Error('Wait needs a number of minutes (up to 30 days)');
        return { __wait: new Date(Date.now() + minutes * 60_000).toISOString() };
      }
      case 'webhook': {
        const url = str('url').trim();
        if (!/^https?:\/\//i.test(url)) throw new Error('The URL must start with http:// or https://');
        const host = new URL(url).hostname;
        if (process.env.FLOW_WEBHOOK_ALLOW_LOCAL !== '1' && /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.0\.0\.0|\[?::1)/i.test(host)) throw new Error('Webhooks to local addresses are off (FLOW_WEBHOOK_ALLOW_LOCAL=1 allows them)');
        const body = cfg.body ? renderObject(cfg.body as Record<string, unknown>, ctx) : { trigger: (ctx as { trigger: unknown }).trigger, steps: (ctx as { steps: unknown }).steps };
        const res = await fetch(url, { method: String(cfg.method ?? 'POST'), headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS) });
        const text = (await res.text().catch(() => '')).slice(0, 2000);
        if (!res.ok) throw new Error(`The server answered ${res.status}`);
        return { status: res.status, response: text };
      }
    }
    throw new Error(`Unknown action "${type}"`);
  }

  // ── API for the Runs tab ──────────────────────────────────────────────────

  async automation(actor: Actor, flowId: string) {
    await this.perms.require(actor, flowId, 'viewer');
    const f = await this.loadFlow(flowId);
    if (!f) return { enabled: false, problems: [], triggers: [], counts: { total: 0, running: 0, waiting: 0, failed: 0 } };
    const triggers = await this.db.select().from(flowTriggers).where(eq(flowTriggers.flowId, flowId));
    const [c] = await this.db
      .select({
        total: sql<number>`count(*)::int`,
        running: sql<number>`count(*) filter (where ${flowRuns.status} = 'running')::int`,
        waiting: sql<number>`count(*) filter (where ${flowRuns.status} = 'waiting')::int`,
        failed: sql<number>`count(*) filter (where ${flowRuns.status} = 'failed')::int`,
      })
      .from(flowRuns)
      .where(eq(flowRuns.flowId, flowId));
    return {
      enabled: f.info.automation,
      problems: validateAutomation(f),
      triggers: triggers.map((t) => ({ nodeId: t.nodeId, type: t.type, config: t.config, enabled: t.enabled, nextRunAt: t.nextRunAt, name: f.nodes.find((n) => n.id === t.nodeId)?.text ?? '' })),
      counts: c,
    };
  }

  async runs(actor: Actor, flowId: string, limit = 50) {
    await this.perms.require(actor, flowId, 'viewer');
    const rows = await this.db.select().from(flowRuns).where(eq(flowRuns.flowId, flowId)).orderBy(desc(flowRuns.startedAt)).limit(Math.min(200, limit));
    return this.dtos(rows);
  }

  async run(actor: Actor, flowId: string, runId: string) {
    await this.perms.require(actor, flowId, 'viewer');
    const [row] = await this.db.select().from(flowRuns).where(and(eq(flowRuns.id, runId), eq(flowRuns.flowId, flowId)));
    if (!row) throw new NotFoundException('Run not found');
    return (await this.dtos([row]))[0];
  }

  /** "Run now": starts the flow by hand at a manual trigger (or the given trigger shape), with optional input. */
  async runNow(actor: Actor, flowId: string, input: { nodeId?: string | null; input?: Record<string, unknown> }) {
    await this.perms.require(actor, flowId, 'editor');
    const f = await this.loadFlow(flowId);
    if (!f) throw new NotFoundException('Flow has no content');
    const triggers = f.nodes.filter((n) => automationOf(n).role === 'trigger');
    const node = input.nodeId ? triggers.find((n) => n.id === input.nodeId) : (triggers.find((n) => automationOf(n).type === 'manual') ?? triggers[0]);
    if (!node) throw new BadRequestException(triggers.length ? 'That shape is not a trigger' : 'Give one shape the Trigger role first (Automation tab)');
    const type = automationOf(node).type || 'manual';
    const payload = type === 'manual' ? { by: { id: actor.id, name: actor.name }, input: input.input ?? {}, at: new Date().toISOString() } : { ...(input.input ?? {}), test: true, by: { id: actor.id, name: actor.name }, at: new Date().toISOString() };
    const row = await this.start(flowId, node.id, type, payload, actor.id);
    return (await this.dtos([row]))[0];
  }

  async resumeNow(actor: Actor, flowId: string, runId: string) {
    await this.perms.require(actor, flowId, 'editor');
    const [row] = await this.db.select().from(flowRuns).where(and(eq(flowRuns.id, runId), eq(flowRuns.flowId, flowId)));
    if (!row) throw new NotFoundException('Run not found');
    if (row.status !== 'waiting') throw new BadRequestException('Only a waiting run can be continued');
    return (await this.dtos([await this.resume(row)]))[0];
  }

  async cancel(actor: Actor, flowId: string, runId: string) {
    await this.perms.require(actor, flowId, 'editor');
    const [row] = await this.db
      .update(flowRuns)
      .set({ status: 'cancelled', finishedAt: new Date().toISOString(), resumeAt: null, pending: [] })
      .where(and(eq(flowRuns.id, runId), eq(flowRuns.flowId, flowId), inArray(flowRuns.status, ['waiting', 'running'])))
      .returning();
    if (!row) throw new BadRequestException('Only a waiting run can be cancelled');
    this.collab.notify(flowId, { type: 'runs' });
    return (await this.dtos([row]))[0];
  }

  /** Replaces the diagram with a PlainFlow (the .json export) for everyone connected, then re-indexes triggers. */
  async importFlow(actor: Actor, flowId: string, f: PlainFlow) {
    await this.perms.require(actor, flowId, 'editor');
    if (!Array.isArray(f.nodes) || !Array.isArray(f.edges) || !Array.isArray(f.pages) || !f.pages.length) throw new BadRequestException('Not a flow export');
    await this.collab.transact(flowId, { id: actor.id, name: actor.name }, (doc) => {
      const info = doc.getMap(INFO_MAP);
      for (const k of [...info.keys()]) info.delete(k);
      const order = doc.getArray<string>(PAGE_ORDER);
      order.delete(0, order.length);
      for (const name of [PAGES_MAP, NODES_MAP, EDGES_MAP]) {
        const m = doc.getMap(name);
        for (const k of [...m.keys()]) m.delete(k);
      }
      writeFlow(doc, f);
    });
    await this.syncTriggers(flowId, f);
    return { ok: true, nodes: f.nodes.length };
  }

  /** Flips Automation on / off from the API (the UI writes info.automation through Yjs; this is for scripts / tests). */
  async setEnabled(actor: Actor, flowId: string, enabled: boolean) {
    await this.perms.require(actor, flowId, 'editor');
    await this.collab.transact(flowId, { id: actor.id, name: actor.name }, (doc) => doc.getMap(INFO_MAP).set('automation', enabled));
    const f = await this.loadFlow(flowId);
    if (f) await this.syncTriggers(flowId, { ...f, info: { ...f.info, automation: enabled } });
    return this.automation(actor, flowId);
  }

  private async dtos(rows: RunRow[]) {
    const people = await loadUsers(this.db, rows.map((r) => r.runBy).filter((x): x is string => !!x));
    return rows.map((r) => ({
      id: r.id,
      flowId: r.flowId,
      pageId: r.pageId,
      triggerNodeId: r.triggerNodeId,
      triggerType: r.triggerType,
      trigger: r.trigger,
      status: r.status,
      steps: r.steps as unknown as FlowRunStep[],
      error: r.error,
      runBy: r.runBy ? (people.get(r.runBy) ?? null) : null,
      startedAt: r.startedAt,
      finishedAt: r.finishedAt,
      resumeAt: r.resumeAt,
    }));
  }
}

/** Does an event belong to this trigger? (the form, table, template, project or mailbox it was set up for) */
function matches(type: string, cfg: Record<string, unknown>, p: Record<string, unknown>): boolean {
  const same = (k: string, pk = k) => !cfg[k] || cfg[k] === p[pk];
  switch (type) {
    case 'form.submitted':
      return same('formId');
    case 'base.recordCreated':
    case 'base.recordUpdated':
      return same('tableId');
    case 'approval.finished':
      return same('templateId') && same('status');
    case 'task.statusChanged':
      return same('projectId') && same('toStatus', 'to');
    case 'mail.received':
      return same('mailboxId');
    default:
      return false;
  }
}

