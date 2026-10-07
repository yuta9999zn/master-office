import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  between,
  can,
  canTransition,
  childTypeOf,
  WORKFLOWS,
  type WorkflowId,
  ISSUE_RANK,
  WORK_TYPES,
  type IssueLinkKind,
  type IssueType,
  type Methodology,
  type Project,
  type ProjectStats,
  type Role,
  type TaskDetail,
  type TaskInput,
  type TaskLinkView,
  type TaskStatus,
  type TaskView,
} from '@workos/shared';
import { and, asc, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { ChatService } from '../chat/chat.service';
import type { Actor } from '../common/current-user';
import { loadUsers } from '../common/users';
import { config } from '../config';
import type { Db, Tx } from '../db/client';
import { InjectDb } from '../db/db.module';
import { messages, projects, resources, sprints, taskDocs, taskEvents, taskLinks, tasks, taskWatchers, workspaceMembers } from '../db/schema';
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
const NONE = '00000000-0000-0000-0000-000000000000';
/** SQL list of the work types (stories, tasks, bugs). */
const workTypes = sql.join(WORK_TYPES.map((t) => sql`${t}`), sql`, `);

/**
 * Tasks (docs/ARCHITECTURE.md §72, issues §76). Projects live in spaces and follow the space role — viewer reads
 * (and may file requests into the intake queue), commenter discusses, editor creates and changes issues, admin (or
 * the project's creator) manages statuses and settings. Issues form a hierarchy (phase › epic › story / task / bug /
 * milestone › subtask), link to each other (blocks, relates, duplicates) and have watchers. Personal tasks (no
 * project) belong to their creator and their assignee.
 */
@Injectable()
export class TasksService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly perms: PermissionsService,
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimeService,
    private readonly chat: ChatService,
  ) {}

  // ── Projects ──────────────────────────────────────────────────────────────

  private projectPerms(p: Proj, actor: Actor, role: Role | null | undefined) {
    return { read: can(role, 'viewer'), comment: can(role, 'commenter'), write: can(role, 'editor'), manage: can(role, 'admin') || ((p.createdBy === actor.id || p.leadId === actor.id) && can(role, 'editor')) };
  }

  private async project(actor: Actor, id: string, need: 'read' | 'comment' | 'write' | 'manage' = 'read', tx: Tx = this.db) {
    const [p] = await tx.select().from(projects).where(eq(projects.id, id));
    if (!p || p.workspaceId !== actor.workspaceId) throw new NotFoundException('Project not found');
    const role = (await this.perms.spaceRoles(actor, tx)).get(p.spaceId);
    const perms = this.projectPerms(p, actor, role);
    if (!perms.read) throw new NotFoundException('Project not found');
    if (!perms[need]) throw new ForbiddenException({ comment: 'You cannot comment here', write: 'Your role in the space lets you see this project, not change it', manage: 'Only space admins or the project lead change project settings', read: '' }[need]);
    return { p, perms };
  }

  async projects(actor: Actor, spaceId?: string): Promise<Project[]> {
    const roles = await this.perms.spaceRoles(actor);
    const visible = [...roles].filter(([id, r]) => can(r, 'viewer') && (!spaceId || id === spaceId)).map(([id]) => id);
    if (!visible.length) return [];
    const rows = await this.db.select().from(projects).where(and(inArray(projects.spaceId, visible), isNull(projects.archivedAt))).orderBy(asc(projects.name));
    if (!rows.length) return [];
    const counts = await this.db.execute<{ project_id: string; total: string; done: string; overdue: string; triage: string }>(sql`
      SELECT project_id,
             count(*) FILTER (WHERE NOT triage AND type IN (${workTypes})) AS total,
             count(*) FILTER (WHERE NOT triage AND type IN (${workTypes}) AND completed_at IS NOT NULL) AS done,
             count(*) FILTER (WHERE NOT triage AND type IN (${workTypes}) AND completed_at IS NULL AND due_date < ${today()}) AS overdue,
             count(*) FILTER (WHERE triage) AS triage
      FROM tasks WHERE project_id IN (${sql.join(rows.map((r) => sql`${r.id}`), sql`, `)}) GROUP BY project_id`);
    const by = new Map(counts.rows.map((c) => [c.project_id, c]));
    const leads = await loadUsers(this.db, rows.map((r) => r.leadId ?? r.createdBy));
    return rows.map((p) => this.projectDto(p, actor, roles.get(p.spaceId), leads, by.get(p.id)));
  }

  private projectDto(p: Proj, actor: Actor, role: Role | null | undefined, people: Map<string, import('@workos/shared').UserSummary>, c?: { total: string; done: string; overdue: string; triage: string }): Project {
    const lead = p.leadId ?? p.createdBy;
    return {
      id: p.id,
      key: p.key,
      name: p.name,
      description: p.description,
      color: p.color,
      spaceId: p.spaceId,
      statuses: p.statuses,
      methodology: p.methodology,
      lead: lead ? people.get(lead) ?? null : null,
      intakeOpen: p.intakeOpen,
      sprintDays: p.sprintDays,
      dailyTime: p.dailyTime,
      wipLimits: p.wipLimits,
      workflow: p.workflow,
      strictWorkflow: p.strictWorkflow,
      perms: this.projectPerms(p, actor, role),
      counts: { total: Number(c?.total ?? 0), done: Number(c?.done ?? 0), overdue: Number(c?.overdue ?? 0), triage: Number(c?.triage ?? 0) },
    };
  }

  async createProject(
    actor: Actor,
    input: { spaceId: string; name: string; key?: string; color?: string; description?: string | null; methodology?: Methodology; workflow?: Exclude<WorkflowId, 'custom'>; strictWorkflow?: boolean },
  ) {
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
      .values({
        workspaceId: actor.workspaceId,
        spaceId: input.spaceId,
        name,
        key,
        color: input.color ?? '#2563eb',
        description: input.description?.trim() || null,
        ...this.workflowFor(input.workflow ?? (input.methodology === 'waterfall' ? 'waterfall' : 'software'), input.strictWorkflow),
        methodology: input.methodology ?? 'kanban',
        leadId: actor.id,
        createdBy: actor.id,
      })
      .returning();
    return this.projectDto(p, actor, role, await loadUsers(this.db, [actor.id]));
  }

  async updateProject(
    actor: Actor,
    id: string,
    input: {
      name?: string;
      color?: string;
      description?: string | null;
      statuses?: TaskStatus[];
      archived?: boolean;
      methodology?: Methodology;
      leadId?: string | null;
      intakeOpen?: boolean;
      sprintDays?: number;
      dailyTime?: string;
      wipLimits?: Record<string, number>;
      workflow?: WorkflowId;
      strictWorkflow?: boolean;
    },
  ) {
    const { p } = await this.project(actor, id, 'manage');
    const set: Partial<Proj> = {};
    if (input.name !== undefined) set.name = input.name.trim() || p.name;
    if (input.color) set.color = input.color;
    if (input.description !== undefined) set.description = input.description?.trim() || null;
    if (input.archived !== undefined) set.archivedAt = input.archived ? new Date().toISOString() : null;
    if (input.methodology) set.methodology = input.methodology;
    if (input.intakeOpen !== undefined) set.intakeOpen = input.intakeOpen;
    if (input.sprintDays !== undefined) set.sprintDays = input.sprintDays;
    if (input.strictWorkflow !== undefined) set.strictWorkflow = input.strictWorkflow;
    // A professional workflow replaces the statuses (unless they come customised along with it).
    if (input.workflow && input.workflow !== 'custom' && !input.statuses) input.statuses = this.workflowFor(input.workflow).statuses;
    if (input.workflow) set.workflow = input.workflow;
    else if (input.statuses) set.workflow = 'custom';
    if (input.dailyTime !== undefined) set.dailyTime = input.dailyTime;
    if (input.wipLimits !== undefined) set.wipLimits = Object.fromEntries(Object.entries(input.wipLimits).filter(([k, v]) => (input.statuses ?? p.statuses).some((x) => x.id === k) && v > 0));
    if (input.leadId !== undefined) set.leadId = input.leadId ? await this.checkAssignee(actor, p, input.leadId, this.db) : null;
    await this.db.transaction(async (tx) => {
      if (input.statuses) {
        const list = input.statuses.map((s) => ({
          id: s.id.trim(),
          name: s.name.trim() || s.id,
          color: s.color,
          category: s.category,
          ...(s.next?.length ? { next: [...new Set(s.next)] } : {}),
          ...(s.category === 'done' && s.resolution ? { resolution: s.resolution } : {}),
        }));
        if (!list.length || new Set(list.map((s) => s.id)).size !== list.length) throw new BadRequestException('Statuses need distinct ids');
        if (!list.some((s) => s.category === 'done')) throw new BadRequestException('Keep at least one "done" status');
        for (const st of list) if (st.next?.some((n) => !list.some((x) => x.id === n))) throw new BadRequestException(`"${st.name}" moves to a status that does not exist`);
        set.statuses = list;
        // Issues in a removed status go to the first status of the same kind (to do / in progress / done).
        for (const gone of p.statuses.filter((s) => !list.some((x) => x.id === s.id))) {
          const to = list.find((x) => x.category === gone.category) ?? list[0];
          await tx.update(tasks).set({ status: to.id }).where(and(eq(tasks.projectId, id), eq(tasks.status, gone.id)));
        }
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
    const projMap = projs ?? new Map((await this.db.select().from(projects).where(inArray(projects.id, [...new Set(rows.map((r) => r.projectId).filter((x): x is string => !!x))].concat([NONE])))).map((p) => [p.id, p]));
    const ids = rows.map((r) => r.id);
    const idList = sql.join(ids.map((x) => sql`${x}`), sql`, `);
    const [subs, comments, blockers] = await Promise.all([
      this.db.execute<{ parent_id: string; total: string; done: string }>(sql`SELECT parent_id, count(*) AS total, count(*) FILTER (WHERE completed_at IS NOT NULL) AS done FROM tasks WHERE parent_id IN (${idList}) GROUP BY parent_id`),
      this.db.execute<{ task_id: string; n: string }>(sql`SELECT task_id, count(*) AS n FROM task_events WHERE kind = 'comment' AND task_id IN (${idList}) GROUP BY task_id`),
      this.db.execute<{ to_id: string; n: string }>(sql`SELECT l.to_id, count(*) AS n FROM task_links l JOIN tasks b ON b.id = l.from_id WHERE l.kind = 'blocks' AND b.completed_at IS NULL AND l.to_id IN (${idList}) GROUP BY l.to_id`),
    ]);
    const people = await loadUsers(this.db, [...rows.map((r) => r.assigneeId), ...rows.map((r) => r.createdBy), ...rows.map((r) => r.reporterId)]);
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
        type: t.type,
        title: t.title,
        description: t.description,
        status: t.status,
        priority: t.priority,
        assignee: t.assigneeId ? people.get(t.assigneeId) ?? null : null,
        reporter: t.reporterId ? people.get(t.reporterId) ?? null : null,
        storyPoints: t.storyPoints,
        estimateMinutes: t.estimateMinutes,
        triage: t.triage,
        resolution: t.resolution,
        source: (t.source as TaskView['source']) ?? null,
        blockedBy: Number(blockers.rows.find((x) => x.to_id === t.id)?.n ?? 0),
        sprintId: t.sprintId,
        rank: t.rank,
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

  async get(actor: Actor, id: string): Promise<TaskDetail> {
    const t = await this.load(id);
    const p = await this.access(actor, t, 'read');
    const [view] = await this.views(actor, [t]);
    const children = await this.db.select().from(tasks).where(eq(tasks.parentId, id)).orderBy(asc(tasks.position));
    const ev = await this.db.select().from(taskEvents).where(eq(taskEvents.taskId, id)).orderBy(asc(taskEvents.createdAt));
    const watchers = await this.db.select({ id: taskWatchers.userId }).from(taskWatchers).where(eq(taskWatchers.taskId, id));
    const people = await loadUsers(this.db, [...ev.map((e) => e.actorId), ...watchers.map((w) => w.id)]);
    // Ancestors, top first.
    const ancestors: TaskDetail['ancestors'] = [];
    let up = t.parentId;
    for (let i = 0; up && i < 5; i++) {
      const a = await this.load(up).catch(() => null);
      if (!a) break;
      ancestors.unshift({ id: a.id, ref: p && a.number ? `${p.key}-${a.number}` : null, title: a.title, type: a.type });
      up = a.parentId;
    }
    return {
      ...view,
      statuses: p?.statuses ?? PERSONAL_STATUSES,
      children: await this.views(actor, children),
      events: ev.map((e) => ({ id: e.id, kind: e.kind, actor: e.actorId ? people.get(e.actorId) ?? null : null, body: e.body, data: e.data, createdAt: e.createdAt })),
      ancestors,
      links: await this.linksOf(actor, id),
      watchers: watchers.map((w) => people.get(w.id)!).filter(Boolean),
      watching: watchers.some((w) => w.id === actor.id),
      docs: await this.docsOf(actor, id),
    };
  }

  /** Documents an issue traces to; ones the viewer cannot open show locked. */
  async docsOf(actor: Actor, taskId: string) {
    const rows = await this.db
      .select({ r: resources })
      .from(taskDocs)
      .innerJoin(resources, eq(resources.id, taskDocs.resourceId))
      .where(and(eq(taskDocs.taskId, taskId), isNull(resources.trashedAt)))
      .orderBy(asc(taskDocs.createdAt));
    const roles = await this.perms.rolesFor(actor, rows.map((x) => x.r));
    return rows.map(({ r }) => ({ id: r.id, name: r.name, type: r.type, accessible: can(roles.get(r.id), 'viewer') }));
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

  /** A child's type must sit below its parent's (phase › epic › story / task / bug / milestone › subtask). */
  private checkHierarchy(type: IssueType, parent: Task | null, personal: boolean) {
    if (personal && type !== 'task' && type !== 'subtask') throw new BadRequestException('Personal tasks are tasks and subtasks');
    if (type === 'subtask' && !parent) throw new BadRequestException('A subtask needs a parent');
    if (!parent) return;
    if (ISSUE_RANK[parent.type] >= ISSUE_RANK[type]) throw new BadRequestException(`A ${type} cannot go under a ${parent.type}`);
    if (type === 'subtask' && ISSUE_RANK[parent.type] !== 2) throw new BadRequestException('Subtasks go under stories, tasks or bugs');
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

  private estimate(n: number | null | undefined, max: number, what: string) {
    if (n === undefined) return undefined;
    if (n === null) return null;
    if (!Number.isInteger(n) || n < 0 || n > max) throw new BadRequestException(`${what} must be a whole number from 0 to ${max}`);
    return n;
  }

  async create(actor: Actor, input: TaskInput, opts: { request?: boolean } = {}): Promise<TaskView> {
    const title = input.title.trim();
    if (!title) throw new BadRequestException('A task needs a title');
    let source: TaskView['source'] = null;
    if (input.source) {
      // Made from a chat message: you must be able to read it.
      const conv = await this.chat.peek(actor, input.source.conversationId);
      const [m] = conv ? await this.db.select({ id: messages.id }).from(messages).where(and(eq(messages.id, input.source.messageId), eq(messages.conversationId, input.source.conversationId))) : [];
      if (!m) throw new NotFoundException('Message not found');
      source = { kind: 'chat', conversationId: input.source.conversationId, messageId: input.source.messageId };
    }
    const row = await this.db.transaction(async (tx) => {
      let p: Proj | null = null;
      let parent: Task | null = null;
      if (input.parentId) {
        parent = await this.load(input.parentId, tx);
        p = await this.access(actor, parent, opts.request ? 'read' : 'write', tx);
        input.projectId = parent.projectId;
      } else if (input.projectId) p = (await this.project(actor, input.projectId, opts.request ? 'read' : 'write', tx)).p;
      const type: IssueType = input.type ?? (parent ? childTypeOf(parent.type) : 'task');
      this.checkHierarchy(type, parent, !p);
      const statuses = this.statusesOf(p);
      const status = input.status && statuses.some((s) => s.id === input.status) ? input.status : statuses[0].id;
      let number: number | null = null;
      if (p) {
        const [c] = await tx.update(projects).set({ counter: sql`${projects.counter} + 1` }).where(eq(projects.id, p.id)).returning({ n: projects.counter });
        number = c.n;
      }
      const target = statuses.find((s) => s.id === status);
      const done = target?.category === 'done';
      const [t] = await tx
        .insert(tasks)
        .values({
          workspaceId: actor.workspaceId,
          projectId: p?.id ?? null,
          number,
          parentId: parent?.id ?? null,
          type,
          title,
          description: input.description?.trim() || null,
          status,
          priority: input.priority ?? 'none',
          assigneeId: await this.checkAssignee(actor, p, input.assigneeId, tx),
          reporterId: (await this.checkAssignee(actor, p, input.reporterId, tx)) ?? actor.id,
          storyPoints: this.estimate(input.storyPoints, 1000, 'Story points') ?? null,
          estimateMinutes: this.estimate(input.estimateMinutes, 100_000, 'The estimate') ?? null,
          triage: !!opts.request,
          source,
          tags: [...new Set((input.tags ?? []).map((x) => x.trim()).filter(Boolean))].slice(0, 10),
          startDate: input.startDate ?? null,
          dueDate: type === 'milestone' ? input.dueDate ?? input.startDate ?? null : input.dueDate ?? null,
          progress: Math.min(100, Math.max(0, input.progress ?? 0)),
          position: await this.positionFor(tx, p?.id ?? null, status, input.before, input.after, actor.id),
          sprintId: p && input.sprintId && WORK_TYPES.includes(type) ? await this.checkSprint(tx, p.id, input.sprintId) : null,
          rank: p ? await this.rankFor(tx, p.id, input.rankAfter, input.rankBefore) : 'm',
          completedAt: done ? new Date().toISOString() : null,
          resolution: done ? target?.resolution ?? 'done' : null,
          createdBy: actor.id,
        })
        .returning();
      if (t.startDate && t.dueDate && t.dueDate < t.startDate) throw new BadRequestException('The due date is before the start');
      await tx.insert(taskEvents).values({ taskId: t.id, actorId: actor.id, kind: 'change', data: { created: true, ...(opts.request ? { request: true } : {}), ...(source ? { fromChat: true } : {}) } });
      // The reporter and the assignee follow the issue.
      const follow = [...new Set([t.reporterId, t.assigneeId].filter((x): x is string => !!x))];
      if (follow.length) await tx.insert(taskWatchers).values(follow.map((userId) => ({ taskId: t.id, userId }))).onConflictDoNothing();
      return { t, p };
    });
    const { t, p } = row;
    if (t.assigneeId) await this.notifyAssigned(actor, t);
    if (opts.request && p) {
      const lead = p.leadId ?? p.createdBy;
      if (lead)
        await this.notifications
          .notify(actor, [lead], { kind: 'task.request', title: `${actor.name} filed a request in ${p.name}: "${t.title}"`, body: t.description?.slice(0, 200) ?? null, url: `/tasks?project=${p.id}&view=intake&task=${t.id}` })
          .catch(() => undefined);
    }
    if (source && p) {
      const url = `${config.webOrigin}/tasks?project=${p.id}&task=${t.id}`;
      await this.chat.send(actor, source.conversationId, { body: `📋 Created ${p.key}-${t.number}: ${t.title} — ${url}`, threadRootId: source.messageId }).catch(() => undefined);
    }
    await this.changed(t.projectId, t);
    return (await this.views(actor, [t]))[0];
  }

  /** A request for the intake queue: anyone who can see the project (when intake is open). */
  async request(actor: Actor, projectId: string, input: { title: string; description?: string | null; type?: IssueType; priority?: TaskInput['priority'] }) {
    const { p, perms } = await this.project(actor, projectId, 'read');
    if (!p.intakeOpen && !perms.write) throw new ForbiddenException('This project does not take requests');
    const type = input.type && WORK_TYPES.includes(input.type) ? input.type : 'task';
    return this.create(actor, { projectId, title: input.title, description: input.description, type, priority: input.priority }, { request: true });
  }

  /** Declines a request from the intake queue (closes it, says why). */
  async decline(actor: Actor, id: string, reason: string) {
    const t = await this.load(id);
    const p = await this.access(actor, t, 'write');
    if (!t.triage) throw new BadRequestException('Only requests in triage are declined');
    const done = this.statusesOf(p).find((s) => s.category === 'done')!;
    const now = new Date().toISOString();
    await this.db.transaction(async (tx) => {
      await tx.update(tasks).set({ triage: false, status: done.id, completedAt: now, resolution: 'declined', updatedAt: now }).where(eq(tasks.id, id));
      await tx.insert(taskEvents).values({ taskId: id, actorId: actor.id, kind: 'change', data: { declined: true }, body: reason.trim() || null });
    });
    if (t.reporterId)
      await this.notifications
        .notify(actor, [t.reporterId], { kind: 'task.request', title: `${actor.name} declined your request "${t.title}"`, body: reason.trim() || null, url: `/tasks?project=${t.projectId}&task=${t.id}` })
        .catch(() => undefined);
    await this.changed(t.projectId, t);
    return (await this.views(actor, [await this.load(id)]))[0];
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
      if (input.reporterId !== undefined) put('reporterId', await this.checkAssignee(actor, p, input.reporterId, tx));
      if (input.storyPoints !== undefined) put('storyPoints', this.estimate(input.storyPoints, 1000, 'Story points') ?? null);
      if (input.estimateMinutes !== undefined) put('estimateMinutes', this.estimate(input.estimateMinutes, 100_000, 'The estimate') ?? null);
      if (input.triage === false && before.triage) put('triage', false);
      // Planning: into a sprint (or back to the backlog), and the order there.
      if (input.sprintId !== undefined && before.projectId) {
        const type = input.type ?? before.type;
        if (input.sprintId && !WORK_TYPES.includes(type)) throw new BadRequestException('Only stories, tasks and bugs go into sprints');
        put('sprintId', input.sprintId ? await this.checkSprint(tx, before.projectId, input.sprintId) : null);
      }
      if (before.projectId && (input.rankAfter !== undefined || input.rankBefore !== undefined || set.sprintId !== undefined)) {
        set.rank = await this.rankFor(tx, before.projectId, input.rankAfter, input.rankBefore);
      }
      // Moving in the hierarchy (into an epic, under another phase…) or changing the type.
      if (input.parentId !== undefined || input.type !== undefined) {
        const parentId = input.parentId !== undefined ? input.parentId : before.parentId;
        const type = input.type ?? before.type;
        let parent: Task | null = null;
        if (parentId) {
          if (parentId === id) throw new BadRequestException('An issue cannot be its own parent');
          parent = await this.load(parentId, tx);
          if (parent.projectId !== before.projectId) throw new BadRequestException('The parent must be in the same project');
          for (let up: string | null = parent.parentId, i = 0; up && i < 6; i++) {
            if (up === id) throw new BadRequestException('That would put the issue inside itself');
            up = (await this.load(up, tx)).parentId;
          }
        }
        this.checkHierarchy(type, parent, !p);
        const kids = await tx.select({ type: tasks.type }).from(tasks).where(eq(tasks.parentId, id));
        if (kids.some((k) => ISSUE_RANK[k.type] <= ISSUE_RANK[type])) throw new BadRequestException(`Its children cannot go under a ${type}`);
        put('parentId', parent?.id ?? null);
        put('type', type);
      }
      if (input.status !== undefined) {
        if (!statuses.some((s) => s.id === input.status)) throw new BadRequestException('Unknown status');
        // A strict workflow only allows its transitions (Code Review → Ready for QA, In Testing → Fixing…).
        if (p?.strictWorkflow && !canTransition(statuses, before.status, input.status)) {
          const name = (x: string) => statuses.find((s) => s.id === x)?.name ?? x;
          throw new BadRequestException(`"${name(before.status)}" cannot move to "${name(input.status)}" in this workflow`);
        }
        put('status', input.status);
        const target = statuses.find((s) => s.id === input.status)!;
        const done = target.category === 'done';
        if (done && !before.completedAt) set.completedAt = new Date().toISOString();
        if (done) set.resolution = target.resolution ?? 'done';
        if (!done && before.completedAt) {
          set.completedAt = null;
          set.resolution = null;
        }
        if (before.triage) set.triage = false;
      }
      if (input.before !== undefined || input.after !== undefined || set.status) {
        set.position = await this.positionFor(tx, before.projectId, (set.status as string) ?? before.status, input.before, input.after, before.createdBy ?? actor.id);
      }
      const start = (set.startDate !== undefined ? set.startDate : before.startDate) as string | null;
      const due = (set.dueDate !== undefined ? set.dueDate : before.dueDate) as string | null;
      if (start && due && due < start) throw new BadRequestException('The due date is before the start');
      const [row] = await tx.update(tasks).set(set).where(eq(tasks.id, id)).returning();
      // Moving a card is not news; other changes go to the activity trail.
      const logged = Object.fromEntries(Object.entries(changes).filter(([k]) => k !== 'position' && k !== 'rank'));
      if (before.triage && row.triage === false) logged.accepted = [true, true];
      if (Object.keys(logged).length) await tx.insert(taskEvents).values({ taskId: id, actorId: actor.id, kind: 'change', data: logged });
      if (row.assigneeId && row.assigneeId !== before.assigneeId) await tx.insert(taskWatchers).values({ taskId: id, userId: row.assigneeId }).onConflictDoNothing();
      return row;
    });
    if (next.assigneeId && next.assigneeId !== before.assigneeId) await this.notifyAssigned(actor, next);
    if (before.triage && !next.triage && next.reporterId && next.resolution !== 'declined')
      await this.notifications
        .notify(actor, [next.reporterId], { kind: 'task.request', title: `${actor.name} accepted your request "${next.title}"`, body: null, url: `/tasks?project=${next.projectId}&task=${next.id}` })
        .catch(() => undefined);
    await this.changed(next.projectId, next);
    return (await this.views(actor, [next]))[0];
  }

  /** Statuses (and strictness) of a professional workflow. */
  private workflowFor(id: Exclude<WorkflowId, 'custom'>, strict?: boolean) {
    const w = WORKFLOWS.find((x) => x.id === id) ?? WORKFLOWS[0];
    return { workflow: w.id, statuses: w.statuses, strictWorkflow: strict ?? ['software', 'bug', 'waterfall'].includes(w.id) };
  }

  /**
   * Logs a bug found while working on (or testing) an issue: a Bug in the same epic, which blocks the issue until it
   * is fixed.
   */
  async logBug(actor: Actor, id: string, input: { title: string; description?: string | null; priority?: TaskInput['priority']; assigneeId?: string | null }) {
    const t = await this.load(id);
    await this.access(actor, t, 'write');
    if (!t.projectId) throw new BadRequestException('Bugs are logged on project issues');
    // Put it in the closest epic (or phase) above the issue.
    let parentId: string | null = null;
    for (let up = t.parentId, i = 0; up && i < 4; i++) {
      const a = await this.load(up);
      if (ISSUE_RANK[a.type] < 2) {
        parentId = a.id;
        break;
      }
      up = a.parentId;
    }
    if (!parentId && ISSUE_RANK[t.type] < 2) parentId = t.id;
    const bug = await this.create(actor, { projectId: t.projectId, parentId, type: 'bug', title: input.title, description: input.description ?? null, priority: input.priority ?? 'high', assigneeId: input.assigneeId ?? null, sprintId: t.sprintId, tags: ['bug'] });
    if (ISSUE_RANK[t.type] >= 2 && t.type !== 'subtask') await this.link(actor, bug.id, { toId: t.id, kind: 'blocks' });
    else await this.link(actor, bug.id, { toId: t.id, kind: 'relates' });
    return bug;
  }

  /** A sprint of this project that is not closed. */
  private async checkSprint(tx: Tx, projectId: string, sprintId: string) {
    const [sp] = await tx.select().from(sprints).where(eq(sprints.id, sprintId));
    if (!sp || sp.projectId !== projectId) throw new BadRequestException('Unknown sprint');
    if (sp.state === 'closed') throw new BadRequestException('That sprint is closed');
    return sp.id;
  }

  /** Backlog / sprint order: between two issues, or after the last one. */
  private async rankFor(tx: Tx, projectId: string, after?: string | null, before?: string | null) {
    if (after || before) {
      const ids = [after, before].filter((x): x is string => !!x);
      const rows = await tx.select({ id: tasks.id, rank: tasks.rank }).from(tasks).where(inArray(tasks.id, ids));
      const r = (id?: string | null) => (id ? rows.find((x) => x.id === id)?.rank ?? null : null);
      const a = r(after);
      const b = r(before);
      // Equal neighbours (old data) would leave no room: fall back to just after the upper one.
      return a !== null && b !== null && a >= b ? between(a, null) : between(a, b);
    }
    const [last] = await tx.select({ rank: tasks.rank }).from(tasks).where(eq(tasks.projectId, projectId)).orderBy(desc(tasks.rank)).limit(1);
    return between(last?.rank ?? null, null);
  }

  // ── For the sprint service ────────────────────────────────────────────────

  projectAccess(actor: Actor, id: string, need: 'read' | 'comment' | 'write' | 'manage' = 'read') {
    return this.project(actor, id, need);
  }

  viewsOf(actor: Actor, rows: Task[]) {
    return this.views(actor, rows);
  }

  notifyProject(projectId: string) {
    return this.changed(projectId);
  }

  /** Breaks an issue down: one child per line (epic → stories, story / task / bug → subtasks, phase → tasks). */
  async breakdown(actor: Actor, id: string, input: { titles: string[]; type?: IssueType }) {
    const parent = await this.load(id);
    await this.access(actor, parent, 'write');
    const titles = input.titles.map((x) => x.trim()).filter(Boolean);
    if (!titles.length) throw new BadRequestException('Write at least one line');
    if (titles.length > 50) throw new BadRequestException('At most 50 at a time');
    const out: TaskView[] = [];
    for (const title of titles) out.push(await this.create(actor, { parentId: id, title, type: input.type ?? childTypeOf(parent.type) }));
    return out;
  }

  async remove(actor: Actor, id: string) {
    const t = await this.load(id);
    await this.access(actor, t, 'write');
    await this.db.delete(tasks).where(eq(tasks.id, id));
    await this.changed(t.projectId, t);
  }

  // ── Links & watchers ──────────────────────────────────────────────────────

  private async linksOf(actor: Actor, id: string): Promise<TaskLinkView[]> {
    const rows = await this.db.select().from(taskLinks).where(or(eq(taskLinks.fromId, id), eq(taskLinks.toId, id)));
    if (!rows.length) return [];
    const otherIds = rows.map((l) => (l.fromId === id ? l.toId : l.fromId));
    const others = await this.db.select().from(tasks).where(inArray(tasks.id, otherIds));
    const projs = new Map((await this.db.select().from(projects).where(inArray(projects.id, [...new Set(others.map((o) => o.projectId).filter((x): x is string => !!x))].concat([NONE])))).map((p) => [p.id, p]));
    const out: TaskLinkView[] = [];
    for (const l of rows) {
      const o = others.find((x) => x.id === (l.fromId === id ? l.toId : l.fromId));
      if (!o || !(await this.access(actor, o, 'read').then(() => true, () => false))) continue;
      const p = o.projectId ? projs.get(o.projectId) : null;
      out.push({ id: l.id, kind: l.kind, direction: l.fromId === id ? 'out' : 'in', task: { id: o.id, ref: p && o.number ? `${p.key}-${o.number}` : null, title: o.title, type: o.type, status: o.status, done: !!o.completedAt, projectId: o.projectId } });
    }
    return out;
  }

  async link(actor: Actor, id: string, input: { toId: string; kind: IssueLinkKind }) {
    if (id === input.toId) throw new BadRequestException('An issue cannot link to itself');
    const a = await this.load(id);
    await this.access(actor, a, 'write');
    const b = await this.load(input.toId);
    await this.access(actor, b, 'read');
    if (input.kind === 'blocks') {
      // No cycles of "blocks": walk what b blocks.
      const seen = new Set<string>();
      const stack = [b.id];
      while (stack.length) {
        const cur = stack.pop()!;
        if (cur === a.id) throw new BadRequestException('That would make the two issues wait for each other');
        if (seen.has(cur)) continue;
        seen.add(cur);
        const next = await this.db.select({ to: taskLinks.toId }).from(taskLinks).where(and(eq(taskLinks.fromId, cur), eq(taskLinks.kind, 'blocks')));
        stack.push(...next.map((n) => n.to));
      }
    }
    await this.db.insert(taskLinks).values({ fromId: id, toId: input.toId, kind: input.kind, createdBy: actor.id }).onConflictDoNothing();
    await this.db.insert(taskEvents).values({ taskId: id, actorId: actor.id, kind: 'change', data: { linked: [input.kind, input.toId] } });
    await this.changed(a.projectId, a);
    if (b.projectId !== a.projectId) await this.changed(b.projectId, b);
    return this.linksOf(actor, id);
  }

  async unlink(actor: Actor, id: string, linkId: string) {
    const t = await this.load(id);
    await this.access(actor, t, 'write');
    const [l] = await this.db.select().from(taskLinks).where(eq(taskLinks.id, linkId));
    if (!l || (l.fromId !== id && l.toId !== id)) throw new NotFoundException('Link not found');
    await this.db.delete(taskLinks).where(eq(taskLinks.id, linkId));
    await this.changed(t.projectId, t);
    return this.linksOf(actor, id);
  }

  async watch(actor: Actor, id: string, on: boolean) {
    const t = await this.load(id);
    await this.access(actor, t, 'read');
    if (on) await this.db.insert(taskWatchers).values({ taskId: id, userId: actor.id }).onConflictDoNothing();
    else await this.db.delete(taskWatchers).where(and(eq(taskWatchers.taskId, id), eq(taskWatchers.userId, actor.id)));
    return { watching: on };
  }

  async comment(actor: Actor, id: string, body: string) {
    const t = await this.load(id);
    await this.access(actor, t, 'comment');
    const text = body.trim();
    if (!text) throw new BadRequestException('Write something');
    const [e] = await this.db.insert(taskEvents).values({ taskId: id, actorId: actor.id, kind: 'comment', body: text }).returning();
    const p = t.projectId ? (await this.db.select().from(projects).where(eq(projects.id, t.projectId)))[0] : null;
    const ref = p && t.number ? `${p.key}-${t.number} ` : '';
    const watchers = await this.db.select({ id: taskWatchers.userId }).from(taskWatchers).where(eq(taskWatchers.taskId, id));
    await this.notifications
      .notify(actor, [t.assigneeId, t.createdBy, t.reporterId, ...watchers.map((w) => w.id)].filter((x): x is string => !!x), {
        kind: 'task.comment',
        title: `${actor.name} commented on ${ref}"${t.title}"`,
        body: text,
        url: `/tasks?${t.projectId ? `project=${t.projectId}&` : ''}task=${t.id}`,
      })
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
    const rows = await this.db
      .select()
      .from(tasks)
      .where(and(eq(tasks.projectId, projectId), eq(tasks.triage, false), sql`${tasks.type} IN (${workTypes})`));
    const done = rows.filter((t) => t.completedAt && t.resolution !== 'declined');
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
