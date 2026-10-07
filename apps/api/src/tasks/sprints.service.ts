import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { sprintWord, WORK_TYPES, zonedToUtc, type CeremonyKind, type CeremonyPlan, type RetroItemView, type SprintReport, type SprintView, type TaskView, type VelocityRow } from '@workos/shared';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { CalendarService } from '../calendar/calendar.service';
import type { Actor } from '../common/current-user';
import { loadUsers } from '../common/users';
import type { Db } from '../db/client';
import { InjectDb } from '../db/db.module';
import { projects, retroItems, sprints, tasks, users } from '../db/schema';
import { TasksService } from './tasks.service';

type SprintRow = typeof sprints.$inferSelect;
type Proj = typeof projects.$inferSelect;

const DAY = 86_400_000;
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const today = () => new Date().toISOString().slice(0, 10);
const work = sql.join(WORK_TYPES.map((t) => sql`${t}`), sql`, `);

/**
 * Scrum (docs/ARCHITECTURE.md §76, batch 2): sprints of a project — planned, one active, closed. Starting a sprint
 * snapshots what the team committed to and can put the ceremonies in Calendar with a Kaori Meet room: Sprint
 * Planning on the first day, a 15-minute Daily Scrum every working day, Sprint Review and Retrospective on the last.
 * Completing one moves unfinished issues on. Reports: burndown and velocity. The retrospective board turns action
 * items into issues.
 */
@Injectable()
export class SprintsService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly tasksSvc: TasksService,
    private readonly calendar: CalendarService,
  ) {}

  private async sprint(actor: Actor, id: string, need: 'read' | 'comment' | 'write' = 'read') {
    const [sp] = await this.db.select().from(sprints).where(eq(sprints.id, id));
    if (!sp) throw new NotFoundException('Sprint not found');
    const { p, perms } = await this.tasksSvc.projectAccess(actor, sp.projectId, need);
    return { sp, p, perms };
  }

  private async dtos(rows: SprintRow[]): Promise<SprintView[]> {
    if (!rows.length) return [];
    const counts = await this.db.execute<{ sprint_id: string; total: string; done: string; points: string; done_points: string }>(sql`
      SELECT sprint_id, count(*) AS total, count(*) FILTER (WHERE completed_at IS NOT NULL) AS done,
             coalesce(sum(story_points), 0) AS points, coalesce(sum(story_points) FILTER (WHERE completed_at IS NOT NULL), 0) AS done_points
      FROM tasks WHERE type IN (${work}) AND sprint_id IN (${sql.join(rows.map((r) => sql`${r.id}`), sql`, `)}) GROUP BY sprint_id`);
    return rows.map((r) => {
      const c = counts.rows.find((x) => x.sprint_id === r.id);
      return {
        id: r.id,
        projectId: r.projectId,
        epicId: r.epicId,
        name: r.name,
        goal: r.goal,
        startDate: r.startDate,
        endDate: r.endDate,
        state: r.state,
        ceremonies: r.ceremonies as SprintView['ceremonies'],
        counts: { total: Number(c?.total ?? 0), done: Number(c?.done ?? 0), points: Number(c?.points ?? 0), donePoints: Number(c?.done_points ?? 0) },
        committedPoints: r.committedPoints,
        completedPoints: r.completedPoints,
        committedCount: r.committedCount,
        completedCount: r.completedCount,
        startedAt: r.startedAt,
        completedAt: r.completedAt,
      };
    });
  }

  async list(actor: Actor, projectId: string) {
    await this.tasksSvc.projectAccess(actor, projectId);
    const rows = await this.db.select().from(sprints).where(eq(sprints.projectId, projectId)).orderBy(asc(sprints.startDate), asc(sprints.createdAt));
    return this.dtos(rows);
  }

  /** A new sprint: the day after the last one ends (or today), for the project's usual length. */
  async create(actor: Actor, projectId: string, input: { name?: string; goal?: string | null; startDate?: string; days?: number; epicId?: string | null }) {
    const { p } = await this.tasksSvc.projectAccess(actor, projectId, 'write');
    const epic = input.epicId ? await this.epic(projectId, input.epicId) : null;
    // An epic's sprints follow one another; numbering is per epic.
    const all = await this.db
      .select()
      .from(sprints)
      .where(and(eq(sprints.projectId, projectId), epic ? eq(sprints.epicId, epic.id) : isNull(sprints.epicId)))
      .orderBy(desc(sprints.endDate));
    const start = input.startDate ?? (all[0] ? addDays(all[0].endDate, 1) : today());
    const days = input.days ?? p.sprintDays;
    if (days < 1 || days > 60) throw new BadRequestException('A sprint lasts 1 to 60 days');
    const word = sprintWord(p.methodology);
    const [row] = await this.db
      .insert(sprints)
      .values({ projectId, epicId: epic?.id ?? null, name: input.name?.trim() || (epic ? `${epic.title} · ${word} ${all.length + 1}` : `${p.key} ${word} ${all.length + 1}`), goal: input.goal?.trim() || null, startDate: start, endDate: addDays(start, days - 1), createdBy: actor.id })
      .returning();
    await this.tasksSvc.notifyProject(projectId);
    return (await this.dtos([row]))[0];
  }

  /** An epic of the project (sprints belong to epics). */
  private async epic(projectId: string, id: string) {
    const [e] = await this.db.select({ id: tasks.id, title: tasks.title, type: tasks.type, projectId: tasks.projectId }).from(tasks).where(eq(tasks.id, id));
    if (!e || e.projectId !== projectId || e.type !== 'epic') throw new BadRequestException('Sprints belong to an epic of this project');
    return e;
  }

  async update(actor: Actor, id: string, input: { name?: string; goal?: string | null; startDate?: string; days?: number; endDate?: string; epicId?: string | null }) {
    const { sp } = await this.sprint(actor, id, 'write');
    if (sp.state === 'closed') throw new BadRequestException('That sprint is closed');
    const start = input.startDate ?? sp.startDate;
    const end = input.endDate ?? (input.days ? addDays(start, input.days - 1) : input.startDate ? addDays(start, (Date.parse(sp.endDate) - Date.parse(sp.startDate)) / DAY) : sp.endDate);
    if (end < start) throw new BadRequestException('The sprint ends before it starts');
    const [row] = await this.db
      .update(sprints)
      .set({
        name: input.name?.trim() || sp.name,
        goal: input.goal !== undefined ? input.goal?.trim() || null : sp.goal,
        startDate: start,
        endDate: end,
        ...(input.epicId !== undefined ? { epicId: input.epicId ? (await this.epic(sp.projectId, input.epicId)).id : null } : {}),
      })
      .where(eq(sprints.id, id))
      .returning();
    await this.tasksSvc.notifyProject(sp.projectId);
    return (await this.dtos([row]))[0];
  }

  /** Deletes a planned sprint; its issues go back to the backlog. */
  async remove(actor: Actor, id: string) {
    const { sp } = await this.sprint(actor, id, 'write');
    if (sp.state !== 'planned') throw new BadRequestException('Only planned sprints are deleted');
    await this.db.delete(sprints).where(eq(sprints.id, id));
    await this.tasksSvc.notifyProject(sp.projectId);
  }

  private async sprintIssues(sprintId: string) {
    return this.db
      .select()
      .from(tasks)
      .where(and(eq(tasks.sprintId, sprintId), sql`${tasks.type} IN (${work})`))
      .orderBy(asc(tasks.rank));
  }

  async start(actor: Actor, id: string, input: { startDate?: string; days?: number; goal?: string | null; ceremonies?: CeremonyPlan }) {
    const { sp, p } = await this.sprint(actor, id, 'write');
    if (sp.state !== 'planned') throw new BadRequestException(`The sprint is already ${sp.state}`);
    // One running sprint per epic (and one for the sprints without an epic).
    const [active] = await this.db
      .select({ id: sprints.id, name: sprints.name })
      .from(sprints)
      .where(and(eq(sprints.projectId, sp.projectId), eq(sprints.state, 'active'), sp.epicId ? eq(sprints.epicId, sp.epicId) : isNull(sprints.epicId)));
    if (active) throw new BadRequestException(`Complete ${active.name} first`);
    const issues = await this.sprintIssues(id);
    if (!issues.length) throw new BadRequestException('Plan some issues into the sprint first');
    const start = input.startDate ?? sp.startDate;
    const end = input.days ? addDays(start, input.days - 1) : input.startDate ? addDays(start, (Date.parse(sp.endDate) - Date.parse(sp.startDate)) / DAY) : sp.endDate;
    const [row] = await this.db
      .update(sprints)
      .set({
        state: 'active',
        startDate: start,
        endDate: end,
        goal: input.goal !== undefined ? input.goal?.trim() || null : sp.goal,
        startedAt: new Date().toISOString(),
        committedPoints: issues.reduce((n, t) => n + (t.storyPoints ?? 0), 0),
        committedCount: issues.length,
      })
      .where(eq(sprints.id, id))
      .returning();
    let ceremonies: Record<string, string> = {};
    if (input.ceremonies?.schedule) {
      ceremonies = await this.scheduleCeremonies(actor, p, row, issues.map((t) => t.assigneeId), input.ceremonies);
      await this.db.update(sprints).set({ ceremonies }).where(eq(sprints.id, id));
    }
    await this.tasksSvc.notifyProject(sp.projectId);
    return (await this.dtos([{ ...row, ceremonies }]))[0];
  }

  /**
   * The Scrum events of a sprint in Calendar — the project space's team calendar when you may add to it, else your
   * own — each with a Kaori Meet room, inviting the lead and everyone with an issue in the sprint.
   */
  private async scheduleCeremonies(actor: Actor, p: Proj, sp: SprintRow, assignees: (string | null)[], plan: CeremonyPlan) {
    const cals = await this.calendar.list(actor);
    const cal = cals.find((c) => c.kind === 'space' && c.spaceId === p.spaceId && c.perms.write) ?? cals.find((c) => c.kind === 'user' && c.perms.write);
    if (!cal) return {};
    const tz = cal.timezone || 'Asia/Tokyo';
    const guestIds = [...new Set([...(plan.guests ?? [p.leadId, ...assignees]), p.leadId].filter((x): x is string => !!x && x !== actor.id))];
    const guestRows = guestIds.length ? await this.db.select({ email: users.email, name: users.name }).from(users).where(inArray(users.id, guestIds)) : [];
    const guests = guestRows.map((g) => ({ email: g.email, name: g.name }));
    const at = (day: string, hm: string) => {
      const [y, m, d] = day.split('-').map(Number);
      const [h, mi] = hm.split(':').map(Number);
      return zonedToUtc(y, m, d, h, mi, tz);
    };
    const plus = (date: Date, minutes: number) => new Date(date.getTime() + minutes * 60_000).toISOString();
    const weeks = Math.max(1, Math.round(((Date.parse(sp.endDate) - Date.parse(sp.startDate)) / DAY + 1) / 7));
    const link = `/tasks?project=${p.id}&view=sprints&sprint=${sp.id}`;
    const goal = sp.goal ? `Sprint goal: ${sp.goal}\n\n` : '';
    const make = async (kind: CeremonyKind, title: string, start: Date, minutes: number, description: string, recurrence: import('@workos/shared').Recurrence | null = null) => {
      const ev = await this.calendar.create(actor, {
        calendarId: cal.id,
        title: `${sp.name} · ${title}`,
        description,
        start: start.toISOString(),
        end: plus(start, minutes),
        timezone: tz,
        recurrence,
        meeting: { provider: 'kaori' },
        guests,
        notify: true,
        message: `${title} for ${sp.name} (${p.name}).`,
      });
      return [kind, ev.id] as [CeremonyKind, string];
    };
    const daily = plan.dailyTime ?? p.dailyTime;
    const out: [CeremonyKind, string][] = [];
    // AI-DLC bolt: people validate the AI's plan at the kickoff and its output at the review; no daily for a bolt of days.
    if (p.methodology === 'ai-dlc') {
      out.push(await make('planning', 'Bolt Kickoff', at(sp.startDate, '10:00'), 30, `${goal.replace('Sprint goal', 'Bolt goal')}Review and approve the plan the AI proposes for this bolt: units, design steps, tests.\nBacklog: ${link}`));
      out.push(await make('review', 'Bolt Review', at(sp.endDate, '15:00'), 30, `${goal.replace('Sprint goal', 'Bolt goal')}Validate what was generated: demo, code review findings, test results; accept or send back.\nReport: ${link}`));
      out.push(await make('retro', 'Bolt Retrospective', at(sp.endDate, '15:30'), 15, `What worked with the AI (prompts, context, reviews), what to change for the next bolt.\nRetro board: ${link}&tab=retro`));
      return Object.fromEntries(out);
    }
    // Planning: first day, about 2 hours per two weeks (Scrum Guide: up to 8 hours for a month).
    out.push(await make('planning', 'Sprint Planning', at(sp.startDate, '10:00'), 60 * weeks, `${goal}Decide what the sprint delivers and how: define and split the tasks.\nBacklog: ${link}`));
    // Daily Scrum: 15 minutes, Monday to Friday, from the second day to the last.
    const second = addDays(sp.startDate, 1);
    if (second <= sp.endDate)
      out.push(await make('daily', 'Daily Scrum', at(second, daily), 15, `${goal}15 minutes: progress toward the goal, plan for the day, blockers.\nBoard: /tasks?project=${p.id}&view=board`, { freq: 'weekly', interval: 1, byDay: [1, 2, 3, 4, 5], until: sp.endDate }));
    // Review then Retrospective on the last day.
    out.push(await make('review', 'Sprint Review', at(sp.endDate, '13:30'), 60 * weeks, `${goal}Show what was done; report to the stakeholders and adapt the backlog.\nReport: ${link}`));
    out.push(await make('retro', 'Sprint Retrospective', at(sp.endDate, '16:00'), 45 * weeks, `What went well, what to improve, actions for the next sprint.\nRetro board: ${link}&tab=retro`));
    return Object.fromEntries(out);
  }

  /** Closes the active sprint; unfinished issues go to another sprint or back to the backlog. */
  async complete(actor: Actor, id: string, input: { moveTo?: string | null }) {
    const { sp } = await this.sprint(actor, id, 'write');
    if (sp.state !== 'active') throw new BadRequestException('Only the active sprint is completed');
    if (input.moveTo) {
      const [to] = await this.db.select().from(sprints).where(eq(sprints.id, input.moveTo));
      if (!to || to.projectId !== sp.projectId || to.state !== 'planned') throw new BadRequestException('Move unfinished issues to a planned sprint of this project');
    }
    const issues = await this.sprintIssues(id);
    const done = issues.filter((t) => t.completedAt);
    const open = issues.filter((t) => !t.completedAt);
    await this.db.transaction(async (tx) => {
      if (open.length) await tx.update(tasks).set({ sprintId: input.moveTo ?? null }).where(inArray(tasks.id, open.map((t) => t.id)));
      await tx
        .update(sprints)
        .set({ state: 'closed', completedAt: new Date().toISOString(), completedPoints: done.reduce((n, t) => n + (t.storyPoints ?? 0), 0), completedCount: done.length })
        .where(eq(sprints.id, id));
    });
    // A sprint ended early: the daily standups stop.
    const dailyId = (sp.ceremonies as Record<string, string>).daily;
    if (dailyId && today() < sp.endDate) await this.calendar.update(actor, dailyId, { recurrence: { freq: 'weekly', interval: 1, byDay: [1, 2, 3, 4, 5], until: today() } }).catch(() => undefined);
    await this.tasksSvc.notifyProject(sp.projectId);
    const [row] = await this.db.select().from(sprints).where(eq(sprints.id, id));
    return { sprint: (await this.dtos([row]))[0], moved: open.length };
  }

  /** Burndown (remaining work per day against the ideal line) and what got done. */
  async report(actor: Actor, id: string): Promise<SprintReport> {
    const { sp } = await this.sprint(actor, id);
    const issues = await this.sprintIssues(id);
    const usePoints = issues.some((t) => (t.storyPoints ?? 0) > 0);
    const size = (t: (typeof issues)[number]) => (usePoints ? t.storyPoints ?? 0 : 1);
    const total = sp.state === 'planned' ? issues.reduce((n, t) => n + size(t), 0) : (usePoints ? sp.committedPoints : sp.committedCount) ?? issues.reduce((n, t) => n + size(t), 0);
    const n = Math.round((Date.parse(sp.endDate) - Date.parse(sp.startDate)) / DAY) + 1;
    const last = sp.completedAt ? sp.completedAt.slice(0, 10) : today();
    const burndown = Array.from({ length: n }, (_, i) => {
      const day = addDays(sp.startDate, i);
      const remaining = day > last || sp.state === 'planned' ? null : issues.filter((t) => !t.completedAt || t.completedAt.slice(0, 10) > day).reduce((s, t) => s + size(t), 0);
      return { day, remaining, ideal: Math.round((total * (1 - (n > 1 ? i / (n - 1) : 1))) * 10) / 10 };
    });
    const views = await this.tasksSvc.viewsOf(actor, issues);
    return { sprint: (await this.dtos([sp]))[0], unit: usePoints ? 'points' : 'issues', burndown, done: views.filter((t) => t.completedAt), notDone: views.filter((t) => !t.completedAt) };
  }

  /** Committed vs completed over the last closed sprints. */
  async velocity(actor: Actor, projectId: string): Promise<VelocityRow[]> {
    await this.tasksSvc.projectAccess(actor, projectId);
    const rows = await this.db
      .select()
      .from(sprints)
      .where(and(eq(sprints.projectId, projectId), eq(sprints.state, 'closed')))
      .orderBy(desc(sprints.completedAt))
      .limit(8);
    return rows.reverse().map((r) => ({ sprintId: r.id, name: r.name, committed: r.committedPoints ?? 0, completed: r.completedPoints ?? 0 }));
  }

  // ── Retrospective ─────────────────────────────────────────────────────────

  private async retroDtos(actor: Actor, rows: (typeof retroItems.$inferSelect)[], projectKey: string) {
    const people = await loadUsers(this.db, rows.map((r) => r.authorId));
    const taskIds = rows.map((r) => r.taskId).filter((x): x is string => !!x);
    const linked = taskIds.length ? await this.db.select({ id: tasks.id, number: tasks.number, completedAt: tasks.completedAt }).from(tasks).where(inArray(tasks.id, taskIds)) : [];
    return rows.map(
      (r): RetroItemView => {
        const t = linked.find((x) => x.id === r.taskId);
        return {
          id: r.id,
          kind: r.kind,
          body: r.body,
          author: r.authorId ? people.get(r.authorId) ?? null : null,
          votes: r.votes.length,
          voted: r.votes.includes(actor.id),
          task: t ? { id: t.id, ref: t.number ? `${projectKey}-${t.number}` : null, done: !!t.completedAt } : null,
          createdAt: r.createdAt,
        };
      },
    );
  }

  async retro(actor: Actor, sprintId: string) {
    const { p } = await this.sprint(actor, sprintId);
    const rows = await this.db.select().from(retroItems).where(eq(retroItems.sprintId, sprintId)).orderBy(asc(retroItems.createdAt));
    return this.retroDtos(actor, rows, p.key);
  }

  async addRetro(actor: Actor, sprintId: string, input: { kind: 'good' | 'improve' | 'action'; body: string }) {
    const { sp, p } = await this.sprint(actor, sprintId, 'comment');
    if (sp.state === 'planned') throw new BadRequestException('The retrospective opens when the sprint starts');
    const body = input.body.trim();
    if (!body) throw new BadRequestException('Write something');
    const [row] = await this.db.insert(retroItems).values({ sprintId, kind: input.kind, body: body.slice(0, 2000), authorId: actor.id }).returning();
    await this.tasksSvc.notifyProject(sp.projectId);
    return (await this.retroDtos(actor, [row], p.key))[0];
  }

  private async retroItem(actor: Actor, itemId: string, need: 'read' | 'comment' | 'write') {
    const [item] = await this.db.select().from(retroItems).where(eq(retroItems.id, itemId));
    if (!item) throw new NotFoundException('Card not found');
    return { item, ...(await this.sprint(actor, item.sprintId, need)) };
  }

  async vote(actor: Actor, itemId: string) {
    const { item, p, sp } = await this.retroItem(actor, itemId, 'comment');
    const votes = item.votes.includes(actor.id) ? item.votes.filter((v) => v !== actor.id) : [...item.votes, actor.id];
    const [row] = await this.db.update(retroItems).set({ votes }).where(eq(retroItems.id, itemId)).returning();
    await this.tasksSvc.notifyProject(sp.projectId);
    return (await this.retroDtos(actor, [row], p.key))[0];
  }

  async removeRetro(actor: Actor, itemId: string) {
    const { item, perms, sp } = await this.retroItem(actor, itemId, 'comment');
    if (item.authorId !== actor.id && !perms.manage) throw new ForbiddenException('Only the author removes a card');
    await this.db.delete(retroItems).where(eq(retroItems.id, itemId));
    await this.tasksSvc.notifyProject(sp.projectId);
  }

  /** An action item becomes an issue in the backlog (or the next planned sprint). */
  async actionToTask(actor: Actor, itemId: string, input: { assigneeId?: string | null; sprintId?: string | null }): Promise<TaskView> {
    const { item, sp, p } = await this.retroItem(actor, itemId, 'write');
    if (item.kind !== 'action') throw new BadRequestException('Only action items become issues');
    if (item.taskId) throw new BadRequestException('Already an issue');
    const t = await this.tasksSvc.create(actor, { projectId: p.id, type: 'task', title: item.body.split('\n')[0].slice(0, 200), description: `Action item from the ${sp.name} retrospective.\n\n${item.body}`, assigneeId: input.assigneeId ?? null, sprintId: input.sprintId ?? null, tags: ['retro'] });
    await this.db.update(retroItems).set({ taskId: t.id }).where(eq(retroItems.id, itemId));
    return t;
  }

  /** The planned sprint coming next (for "move unfinished issues to"). */
  async nextPlanned(projectId: string) {
    const [n] = await this.db.select().from(sprints).where(and(eq(sprints.projectId, projectId), eq(sprints.state, 'planned'), isNull(sprints.completedAt))).orderBy(asc(sprints.startDate)).limit(1);
    return n ?? null;
  }
}
