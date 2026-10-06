import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { between, can, type Project, type ProjectStats, type Role, type TaskEventView, type TaskInput, type TaskStatus, type TaskView } from '@workos/shared';
import { and, asc, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import type { Actor } from '../common/current-user';
import { loadUsers } from '../common/users';
import type { Db, Tx } from '../db/client';
import { InjectDb } from '../db/db.module';
import { projects, spaceMembers, taskEvents, tasks, workspaceMembers } from '../db/schema';
import { NotificationsService } from '../notifications/notifications.service';
import { PermissionsService } from '../permissions/permissions.service';
import { RealtimeService } from '../realtime/realtime.service';

type Proj = typeof projects.$inferSelect;
type Task = typeof tasks.$inferSelect;

export const DEFAULT_STATUSES: TaskStatus[] = [
  { id: 'todo', name: 'To Do', color: '#64748b', category: 'todo' },
  { id: 'doing', name: 'In Progress', color: '#2563eb', category: 'doing' },
  { id: 'review', name: 'Review', color: '#8b5cf6', category: 'doing' },
  { id: 'done', name: 'Done', color: '#10b981', category: 'done' },
];
const PERSONAL_STATUSES: TaskStatus[] = [
  { id: 'todo', name: 'To Do', color: '#64748b', category: 'todo' },
  { id: 'doing', name: 'In Progress', color: '#2563eb', category: 'doing' },
  { id: 'done', name: 'Done', color: '#10b981', category: 'done' },
];

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Tasks (docs/ARCHITECTURE.md §72). Projects live in spaces and follow the space role — viewer reads, commenter
 * discusses, editor creates and changes tasks, admin (or the project's creator) manages statuses and settings.
 * Personal tasks (no project) belong to their creator and their assignee.
 */
@Injectable()
export class TasksService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly perms: PermissionsService,
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimeService,
  ) {}

  // ── Projects ──────────────────────────────────────────────────────────────

  private projectPerms(p: Proj, actor: Actor, role: Role | null | undefined) {
    return { read: can(role, 'viewer'), comment: can(role, 'commenter'), write: can(role, 'editor'), manage: can(role, 'admin') || (p.createdBy === actor.id && can(role, 'editor')) };
  }

  private async project(actor: Actor, id: string, need: 'read' | 'comment' | 'write' | 'manage' = 'read', tx: Tx = this.db) {
    const [p] = await tx.select().from(projects).where(eq(projects.id, id));
    if (!p || p.workspaceId !== actor.workspaceId) throw new NotFoundException('Project not found');
    const role = (await this.perms.spaceRoles(actor, tx)).get(p.spaceId);
    const perms = this.projectPerms(p, actor, role);
    if (!perms.read) throw new NotFoundException('Project not found');
    if (!perms[need]) throw new ForbiddenException({ comment: 'You cannot comment here', write: 'Your role in the space lets you see this project, not change it', manage: 'Only space admins or the project owner change project settings', read: '' }[need]);
    return { p, perms };
  }

  async projects(actor: Actor, spaceId?: string): Promise<Project[]> {
    const roles = await this.perms.spaceRoles(actor);
    const visible = [...roles].filter(([id, r]) => can(r, 'viewer') && (!spaceId || id === spaceId)).map(([id]) => id);
    if (!visible.length) return [];
    const rows = await this.db.select().from(projects).where(and(inArray(projects.spaceId, visible), isNull(projects.archivedAt))).orderBy(asc(projects.name));
    if (!rows.length) return [];
    const counts = await this.db.execute<{ project_id: string; total: string; done: string; overdue: string }>(sql`
      SELECT project_id, count(*) AS total, count(*) FILTER (WHERE completed_at IS NOT NULL) AS done,
             count(*) FILTER (WHERE completed_at IS NULL AND due_date < ${today()}) AS overdue
      FROM tasks WHERE parent_id IS NULL AND project_id IN (${sql.join(rows.map((r) => sql`${r.id}`), sql`, `)}) GROUP BY project_id`);
    const by = new Map(counts.rows.map((c) => [c.project_id, c]));
    return rows.map((p) => this.projectDto(p, actor, roles.get(p.spaceId), by.get(p.id)));
  }

  private projectDto(p: Proj, actor: Actor, role: Role | null | undefined, c?: { total: string; done: string; overdue: string }): Project {
    return {
      id: p.id,
      key: p.key,
      name: p.name,
      description: p.description,
      color: p.color,
      spaceId: p.spaceId,
      statuses: p.statuses,
      perms: this.projectPerms(p, actor, role),
      counts: { total: Number(c?.total ?? 0), done: Number(c?.done ?? 0), overdue: Number(c?.overdue ?? 0) },
    };
  }

  async createProject(actor: Actor, input: { spaceId: string; name: string; key?: string; color?: string; description?: string | null }) {
    const role = await this.perms.requireSpace(actor, input.spaceId, 'viewer');
    if (!can(role, 'editor')) throw new ForbiddenException('Editors of the space create projects');
    const name = input.name.trim();
    if (!name) throw new BadRequestException('A project needs a name');
    const key = (input.key?.trim() || name.replace(/[^A-Za-z0-9 ]/g, '').split(/\s+/).map((w) => w[0]).join('').slice(0, 4) || 'PRJ').toUpperCase();
    if (!/^[A-Z][A-Z0-9]{1,9}$/.test(key)) throw new BadRequestException('The key is 2–10 letters or digits, starting with a letter');
    const [taken] = await this.db.select({ id: projects.id }).from(projects).where(and(eq(projects.workspaceId, actor.workspaceId), eq(projects.key, key)));
    if (taken) throw new BadRequestException(`The key ${key} is already used`);
    const [p] = await this.db
      .insert(projects)
      .values({ workspaceId: actor.workspaceId, spaceId: input.spaceId, name, key, color: input.color ?? '#2563eb', description: input.description?.trim() || null, statuses: DEFAULT_STATUSES, createdBy: actor.id })
      .returning();
    return this.projectDto(p, actor, role);
  }

  async updateProject(actor: Actor, id: string, input: { name?: string; color?: string; description?: string | null; statuses?: TaskStatus[]; archived?: boolean }) {
    const { p } = await this.project(actor, id, 'manage');
    const set: Partial<Proj> = {};
    if (input.name !== undefined) set.name = input.name.trim() || p.name;
    if (input.color) set.color = input.color;
    if (input.description !== undefined) set.description = input.description?.trim() || null;
    if (input.archived !== undefined) set.archivedAt = input.archived ? new Date().toISOString() : null;
    await this.db.transaction(async (tx) => {
      if (input.statuses) {
        const list = input.statuses.map((s) => ({ id: s.id.trim(), name: s.name.trim() || s.id, color: s.color, category: s.category }));
        if (!list.length || new Set(list.map((s) => s.id)).size !== list.length) throw new BadRequestException('Statuses need distinct ids');
        if (!list.some((s) => s.category === 'done')) throw new BadRequestException('Keep at least one "done" status');
        set.statuses = list;
        // Tasks in a removed column go to the first one.
        const gone = p.statuses.filter((s) => !list.some((x) => x.id === s.id)).map((s) => s.id);
        if (gone.length) await tx.update(tasks).set({ status: list[0].id }).where(and(eq(tasks.projectId, id), inArray(tasks.status, gone)));
      }
      if (Object.keys(set).length) await tx.update(projects).set(set).where(eq(projects.id, id));
    });
    await this.changed(id);
  }

  // ── Tasks ─────────────────────────────────────────────────────────────────

  /** What the actor may do with a task: through its project, or as creator / assignee of a personal task. */
  private async access(actor: Actor, t: Task, need: 'read' | 'comment' | 'write', tx: Tx = this.db) {
    if (t.workspaceId !== actor.workspaceId) throw new NotFoundException('Task not found');
    if (t.projectId) return (await this.project(actor, t.projectId, need, tx)).p;
    if (t.createdBy !== actor.id && t.assigneeId !== actor.id) throw new NotFoundException('Task not found');
    return null;
  }

  private async load(id: string, tx: Tx = this.db) {
    const [t] = await tx.select().from(tasks).where(eq(tasks.id, id));
    if (!t) throw new NotFoundException('Task not found');
    return t;
  }

  async list(actor: Actor, q: { projectId?: string; mine?: boolean; parentId?: string }): Promise<TaskView[]> {
    let rows: Task[];
    let proj: Proj | null = null;
    let canEdit = false;
    if (q.projectId) {
      const r = await this.project(actor, q.projectId);
      proj = r.p;
      canEdit = r.perms.write;
      rows = await this.db.select().from(tasks).where(eq(tasks.projectId, q.projectId)).orderBy(asc(tasks.position));
    } else if (q.mine) {
      // Assigned to me (in projects I can still see) and my personal tasks.
      const all = await this.db
        .select()
        .from(tasks)
        .where(and(eq(tasks.workspaceId, actor.workspaceId), or(eq(tasks.assigneeId, actor.id), and(isNull(tasks.projectId), eq(tasks.createdBy, actor.id)))))
        .orderBy(asc(tasks.dueDate), asc(tasks.position));
      const projIds = [...new Set(all.map((t) => t.projectId).filter((x): x is string => !!x))];
      const ok = new Set<string>();
      for (const id of projIds) if (await this.project(actor, id).then(() => true, () => false)) ok.add(id);
      rows = all.filter((t) => !t.projectId || ok.has(t.projectId));
    } else throw new BadRequestException('Give a project, or ask for your tasks');
    return this.views(actor, rows, proj ? new Map([[proj.id, proj]]) : undefined, canEdit);
  }

  private async views(actor: Actor, rows: Task[], projs?: Map<string, Proj>, canEditAll?: boolean): Promise<TaskView[]> {
    if (!rows.length) return [];
    const projMap = projs ?? new Map((await this.db.select().from(projects).where(inArray(projects.id, [...new Set(rows.map((r) => r.projectId).filter((x): x is string => !!x))].concat(['00000000-0000-0000-0000-000000000000'])))).map((p) => [p.id, p]));
    const ids = rows.map((r) => r.id);
    const [subs, comments] = await Promise.all([
      this.db.execute<{ parent_id: string; total: string; done: string }>(sql`SELECT parent_id, count(*) AS total, count(*) FILTER (WHERE completed_at IS NOT NULL) AS done FROM tasks WHERE parent_id IN (${sql.join(ids.map((x) => sql`${x}`), sql`, `)}) GROUP BY parent_id`),
      this.db.execute<{ task_id: string; n: string }>(sql`SELECT task_id, count(*) AS n FROM task_events WHERE kind = 'comment' AND task_id IN (${sql.join(ids.map((x) => sql`${x}`), sql`, `)}) GROUP BY task_id`),
    ]);
    const people = await loadUsers(this.db, [...rows.map((r) => r.assigneeId), ...rows.map((r) => r.createdBy)]);
    const roles = canEditAll === undefined ? await this.perms.spaceRoles(actor) : null;
    return rows.map((t) => {
      const p = t.projectId ? projMap.get(t.projectId) : null;
      const sub = subs.rows.find((x) => x.parent_id === t.id);
      const total = Number(sub?.total ?? 0);
      const done = Number(sub?.done ?? 0);
      const canEdit = canEditAll ?? (p ? can(roles!.get(p.spaceId), 'editor') : t.createdBy === actor.id || t.assigneeId === actor.id);
      return {
        id: t.id,
        projectId: t.projectId,
        ref: p && t.number ? `${p.key}-${t.number}` : null,
        parentId: t.parentId,
        title: t.title,
        description: t.description,
        status: t.status,
        priority: t.priority,
        assignee: t.assigneeId ? people.get(t.assigneeId) ?? null : null,
        tags: t.tags,
        startDate: t.startDate,
        dueDate: t.dueDate,
        progress: total ? Math.round((done / total) * 100) : t.completedAt ? 100 : t.progress,
        position: t.position,
        completedAt: t.completedAt,
        createdBy: t.createdBy ? people.get(t.createdBy) ?? null : null,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
        subtasks: { total, done },
        comments: Number(comments.rows.find((x) => x.task_id === t.id)?.n ?? 0),
        canEdit,
      };
    });
  }

  async get(actor: Actor, id: string): Promise<TaskView & { events: TaskEventView[]; children: TaskView[]; statuses: TaskStatus[] }> {
    const t = await this.load(id);
    const p = await this.access(actor, t, 'read');
    const [view] = await this.views(actor, [t]);
    const children = await this.db.select().from(tasks).where(eq(tasks.parentId, id)).orderBy(asc(tasks.position));
    const ev = await this.db.select().from(taskEvents).where(eq(taskEvents.taskId, id)).orderBy(asc(taskEvents.createdAt));
    const people = await loadUsers(this.db, ev.map((e) => e.actorId));
    return {
      ...view,
      statuses: p?.statuses ?? PERSONAL_STATUSES,
      children: await this.views(actor, children),
      events: ev.map((e) => ({ id: e.id, kind: e.kind, actor: e.actorId ? people.get(e.actorId) ?? null : null, body: e.body, data: e.data, createdAt: e.createdAt })),
    };
  }

  private statusesOf(p: Proj | null) {
    return p?.statuses ?? PERSONAL_STATUSES;
  }

  private async checkAssignee(actor: Actor, p: Proj | null, userId: string | null | undefined, tx: Tx) {
    if (!userId) return null;
    if (p) {
      const role = (await this.perms.spaceRoles({ id: userId, name: '', workspaceId: actor.workspaceId }, tx)).get(p.spaceId);
      if (!can(role, 'viewer')) throw new BadRequestException('Assign the task to someone who can see the project');
    } else {
      const [m] = await tx.select().from(workspaceMembers).where(and(eq(workspaceMembers.workspaceId, actor.workspaceId), eq(workspaceMembers.userId, userId)));
      if (!m) throw new BadRequestException('Assign the task to someone in the workspace');
    }
    return userId;
  }

  private async positionFor(tx: Tx, projectId: string | null, status: string, before?: string | null, after?: string | null, ownerId?: string) {
    if (before || after) {
      const ids = [before, after].filter((x): x is string => !!x);
      const rows = await tx.select({ id: tasks.id, position: tasks.position }).from(tasks).where(inArray(tasks.id, ids));
      const pos = (id?: string | null) => (id ? rows.find((r) => r.id === id)?.position ?? null : null);
      // `after` = the card above, `before` = the card below.
      return between(pos(after), pos(before));
    }
    const [last] = await tx
      .select({ position: tasks.position })
      .from(tasks)
      .where(and(projectId ? eq(tasks.projectId, projectId) : and(isNull(tasks.projectId), eq(tasks.createdBy, ownerId!)), eq(tasks.status, status)))
      .orderBy(desc(tasks.position))
      .limit(1);
    return between(last?.position ?? null, null);
  }

  async create(actor: Actor, input: TaskInput): Promise<TaskView> {
    const title = input.title.trim();
    if (!title) throw new BadRequestException('A task needs a title');
    const row = await this.db.transaction(async (tx) => {
      let p: Proj | null = null;
      if (input.parentId) {
        const parent = await this.load(input.parentId, tx);
        p = await this.access(actor, parent, 'write', tx);
        if (parent.parentId) throw new BadRequestException('Subtasks cannot have subtasks');
        input.projectId = parent.projectId;
      } else if (input.projectId) p = (await this.project(actor, input.projectId, 'write', tx)).p;
      const statuses = this.statusesOf(p);
      const status = input.status && statuses.some((s) => s.id === input.status) ? input.status : statuses[0].id;
      let number: number | null = null;
      if (p) {
        const [c] = await tx.update(projects).set({ counter: sql`${projects.counter} + 1` }).where(eq(projects.id, p.id)).returning({ n: projects.counter });
        number = c.n;
      }
      const done = statuses.find((s) => s.id === status)?.category === 'done';
      const [t] = await tx
        .insert(tasks)
        .values({
          workspaceId: actor.workspaceId,
          projectId: p?.id ?? null,
          number,
          parentId: input.parentId ?? null,
          title,
          description: input.description?.trim() || null,
          status,
          priority: input.priority ?? 'none',
          assigneeId: await this.checkAssignee(actor, p, input.assigneeId, tx),
          tags: [...new Set((input.tags ?? []).map((x) => x.trim()).filter(Boolean))].slice(0, 10),
          startDate: input.startDate ?? null,
          dueDate: input.dueDate ?? null,
          progress: Math.min(100, Math.max(0, input.progress ?? 0)),
          position: await this.positionFor(tx, p?.id ?? null, status, input.before, input.after, actor.id),
          completedAt: done ? new Date().toISOString() : null,
          createdBy: actor.id,
        })
        .returning();
      if (t.startDate && t.dueDate && t.dueDate < t.startDate) throw new BadRequestException('The due date is before the start');
      await tx.insert(taskEvents).values({ taskId: t.id, actorId: actor.id, kind: 'change', data: { created: true } });
      return t;
    });
    if (row.assigneeId) await this.notifyAssigned(actor, row);
    await this.changed(row.projectId, row);
    return (await this.views(actor, [row]))[0];
  }

  async update(actor: Actor, id: string, input: Partial<TaskInput>): Promise<TaskView> {
    const before = await this.load(id);
    const next = await this.db.transaction(async (tx) => {
      const p = await this.access(actor, before, 'write', tx);
      const statuses = this.statusesOf(p);
      const set: Partial<Task> = { updatedAt: new Date().toISOString() };
      const changes: Record<string, [unknown, unknown]> = {};
      const put = <K extends keyof Task>(k: K, v: Task[K]) => {
        if (JSON.stringify(before[k]) !== JSON.stringify(v)) {
          set[k] = v;
          changes[k as string] = [before[k], v];
        }
      };
      if (input.title !== undefined) put('title', input.title.trim() || before.title);
      if (input.description !== undefined) put('description', input.description?.trim() || null);
      if (input.priority) put('priority', input.priority);
      if (input.tags) put('tags', [...new Set(input.tags.map((x) => x.trim()).filter(Boolean))].slice(0, 10));
      if (input.startDate !== undefined) put('startDate', input.startDate);
      if (input.dueDate !== undefined) put('dueDate', input.dueDate);
      if (input.progress !== undefined) put('progress', Math.min(100, Math.max(0, input.progress)));
      if (input.assigneeId !== undefined) put('assigneeId', await this.checkAssignee(actor, p, input.assigneeId, tx));
      if (input.status !== undefined) {
        if (!statuses.some((s) => s.id === input.status)) throw new BadRequestException('Unknown status');
        put('status', input.status);
        const done = statuses.find((s) => s.id === input.status)!.category === 'done';
        if (done && !before.completedAt) set.completedAt = new Date().toISOString();
        if (!done && before.completedAt) set.completedAt = null;
      }
      if (input.before !== undefined || input.after !== undefined || set.status) {
        set.position = await this.positionFor(tx, before.projectId, (set.status as string) ?? before.status, input.before, input.after, before.createdBy ?? actor.id);
      }
      const start = (set.startDate ?? before.startDate) as string | null;
      const due = (set.dueDate ?? before.dueDate) as string | null;
      if (start && due && due < start) throw new BadRequestException('The due date is before the start');
      const [row] = await tx.update(tasks).set(set).where(eq(tasks.id, id)).returning();
      // Moving a card is not news; other changes go to the activity trail.
      const logged = Object.fromEntries(Object.entries(changes).filter(([k]) => k !== 'position'));
      if (Object.keys(logged).length) await tx.insert(taskEvents).values({ taskId: id, actorId: actor.id, kind: 'change', data: logged });
      return row;
    });
    if (next.assigneeId && next.assigneeId !== before.assigneeId) await this.notifyAssigned(actor, next);
    await this.changed(next.projectId, next);
    return (await this.views(actor, [next]))[0];
  }

  async remove(actor: Actor, id: string) {
    const t = await this.load(id);
    await this.access(actor, t, 'write');
    await this.db.delete(tasks).where(eq(tasks.id, id));
    await this.changed(t.projectId, t);
  }

  async comment(actor: Actor, id: string, body: string) {
    const t = await this.load(id);
    await this.access(actor, t, 'comment');
    const text = body.trim();
    if (!text) throw new BadRequestException('Write something');
    const [e] = await this.db.insert(taskEvents).values({ taskId: id, actorId: actor.id, kind: 'comment', body: text }).returning();
    const p = t.projectId ? (await this.db.select().from(projects).where(eq(projects.id, t.projectId)))[0] : null;
    const ref = p && t.number ? `${p.key}-${t.number} ` : '';
    await this.notifications
      .notify(actor, [t.assigneeId, t.createdBy].filter((x): x is string => !!x), { kind: 'task.comment', title: `${actor.name} commented on ${ref}"${t.title}"`, body: text, url: `/tasks?${t.projectId ? `project=${t.projectId}&` : ''}task=${t.id}` })
      .catch(() => undefined);
    await this.changed(t.projectId, t);
    return { id: e.id };
  }

  private async notifyAssigned(actor: Actor, t: Task) {
    if (!t.assigneeId) return;
    const p = t.projectId ? (await this.db.select().from(projects).where(eq(projects.id, t.projectId)))[0] : null;
    const ref = p && t.number ? `${p.key}-${t.number} ` : '';
    await this.notifications
      .notify(actor, [t.assigneeId], { kind: 'task.assigned', title: `${actor.name} assigned ${ref}"${t.title}" to you`, body: t.dueDate ? `Due ${t.dueDate}` : null, url: `/tasks?${t.projectId ? `project=${t.projectId}&` : ''}task=${t.id}` })
      .catch(() => undefined);
  }

  /** Screens showing the project (everyone who can read its space) or the personal task's two people refresh. */
  private async changed(projectId: string | null, t?: Task) {
    let ids: string[] = [];
    if (projectId) {
      const [p] = await this.db.select().from(projects).where(eq(projects.id, projectId));
      if (p) ids = await this.perms.spaceReaders(p.spaceId);
    }
    if (t) ids.push(...[t.createdBy, t.assigneeId].filter((x): x is string => !!x));
    this.realtime.publish(ids, { type: 'tasks.changed', projectId });
  }

  // ── Dashboard ─────────────────────────────────────────────────────────────

  async stats(actor: Actor, projectId: string): Promise<ProjectStats> {
    const { p } = await this.project(actor, projectId);
    const rows = await this.db.select().from(tasks).where(and(eq(tasks.projectId, projectId), isNull(tasks.parentId)));
    const done = rows.filter((t) => t.completedAt);
    const withDue = done.filter((t) => t.dueDate);
    const onTime = withDue.filter((t) => t.completedAt!.slice(0, 10) <= t.dueDate!);
    const cycles = done.map((t) => (new Date(t.completedAt!).getTime() - new Date(t.createdAt).getTime()) / 86_400_000);
    const days = Array.from({ length: 30 }, (_, i) => new Date(Date.now() - (29 - i) * 86_400_000).toISOString().slice(0, 10));
    const people = await loadUsers(this.db, rows.map((t) => t.assigneeId));
    const byPerson = new Map<string, { assigned: number; done: number; onTime: number }>();
    for (const t of rows) {
      if (!t.assigneeId) continue;
      const s = byPerson.get(t.assigneeId) ?? { assigned: 0, done: 0, onTime: 0 };
      s.assigned++;
      if (t.completedAt) {
        s.done++;
        if (!t.dueDate || t.completedAt.slice(0, 10) <= t.dueDate) s.onTime++;
      }
      byPerson.set(t.assigneeId, s);
    }
    return {
      total: rows.length,
      done: done.length,
      completionRate: rows.length ? Math.round((done.length / rows.length) * 100) : 0,
      onTimeRate: withDue.length ? Math.round((onTime.length / withDue.length) * 100) : 100,
      avgCycleDays: cycles.length ? Math.round((cycles.reduce((a, b) => a + b, 0) / cycles.length) * 10) / 10 : null,
      overdue: rows.filter((t) => !t.completedAt && t.dueDate && t.dueDate < today()).length,
      byStatus: p.statuses.map((s) => ({ status: s.id, name: s.name, color: s.color, count: rows.filter((t) => t.status === s.id).length })),
      trend: days.map((d) => ({ day: d, created: rows.filter((t) => t.createdAt.slice(0, 10) === d).length, completed: done.filter((t) => t.completedAt!.slice(0, 10) === d).length })),
      people: [...byPerson].map(([id, s]) => ({ user: people.get(id)!, ...s })).filter((x) => x.user).sort((a, b) => b.assigned - a.assigned),
    };
  }
}
