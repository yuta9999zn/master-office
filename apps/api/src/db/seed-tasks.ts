import { and, eq, sql } from 'drizzle-orm';
import { between, DEFAULT_DOD, WORKFLOWS } from '@workos/shared';
import { DEFAULT_STATUSES } from '../tasks/tasks.service';
import type { Db } from './client';
import * as s from './schema';

type User = typeof s.users.$inferSelect;

/**
 * Tasks demo data after "over view.png" (§72, §76): "Website Revamp" (ITM Japan, Scrum — epics, stories with points,
 * a request queue) and "Branch 625 System" (Waterfall — phases, tasks, a milestone, dependencies), plus personal tasks.
 */
export async function seedTasks(db: Db, workspaceId: string, u: Record<string, User>, spaceId: (name: string) => string) {
  const project = async (space: string, name: string, key: string, color: string, owner: string, methodology: 'scrum' | 'kanban' | 'waterfall' | 'hybrid' = 'kanban', workflow: 'software' | 'waterfall' | 'scrum' = 'scrum') => {
    const statuses = WORKFLOWS.find((w) => w.id === workflow)?.statuses ?? DEFAULT_STATUSES;
    const [p] = await db.insert(s.projects).values({ workspaceId, spaceId: spaceId(space), name, key, color, statuses, workflow, methodology, dod: DEFAULT_DOD, leadId: u[owner].id, createdBy: u[owner].id }).returning();
    return p;
  };
  const last = new Map<string, string>();
  type Type = 'phase' | 'epic' | 'story' | 'task' | 'bug' | 'subtask' | 'milestone';
  async function task(p: typeof s.projects.$inferSelect | null, o: { title: string; status: string; type?: Type; points?: number; triage?: boolean; reporter?: string; tags?: string[]; priority?: 'low' | 'medium' | 'high' | 'urgent'; who?: string; start?: string; due?: string; progress?: number; parent?: string; by: string; desc?: string; doneOn?: string }) {
    let number: number | null = null;
    if (p) {
      const [c] = await db.update(s.projects).set({ counter: p.counter + 1 }).where(eq(s.projects.id, p.id)).returning();
      p.counter = c.counter;
      number = c.counter;
    }
    const key = `${p?.id ?? 'me'}:${o.status}`;
    const position = between(last.get(key) ?? null, null);
    last.set(key, position);
    const done = o.status === 'done';
    const [t] = await db
      .insert(s.tasks)
      .values({
        workspaceId,
        projectId: p?.id ?? null,
        number,
        parentId: o.parent ?? null,
        type: o.type ?? (o.parent ? 'subtask' : 'task'),
        storyPoints: o.points ?? null,
        triage: !!o.triage,
        reporterId: u[o.reporter ?? o.by].id,
        title: o.title,
        description: o.desc ?? null,
        status: o.status,
        priority: o.priority ?? 'none',
        assigneeId: o.who ? u[o.who].id : null,
        tags: o.tags ?? [],
        startDate: o.start ?? null,
        dueDate: o.due ?? null,
        progress: o.progress ?? (done ? 100 : 0),
        position,
        completedAt: done ? new Date(`${o.doneOn ?? o.due ?? '2026-09-20'}T08:00:00Z`).toISOString() : null,
        resolution: done ? 'done' : null,
        createdBy: u[o.by].id,
        createdAt: new Date(`${o.start ?? '2026-09-10'}T01:00:00Z`).toISOString(),
      })
      .returning();
    await db.insert(s.taskEvents).values({ taskId: t.id, actorId: u[o.by].id, kind: 'change', data: { created: true }, createdAt: t.createdAt });
    return t;
  }

  // Scrum: Website Revamp — epics, stories / tasks / bugs with points, requests waiting in triage (§76).
  const web = await project('ITM Japan', 'Website Revamp', 'WEB', '#7c3aed', 'fujita', 'scrum', 'software');
  const brand = await task(web, { title: 'Brand refresh', type: 'epic', status: 'doing', by: 'fujita', who: 'minh', start: '2026-09-15', due: '2026-10-16', desc: 'New look for the site: homepage, logo, campaign assets.' });
  const bookingEpic = await task(web, { title: 'Online booking', type: 'epic', status: 'doing', by: 'fujita', who: 'fujita', start: '2026-09-21', due: '2026-10-20', desc: 'Customers book visits online at every branch.' });
  const platform = await task(web, { title: 'Platform', type: 'epic', status: 'doing', by: 'fujita', who: 'ken', start: '2026-09-15', due: '2026-10-15' });
  await task(web, { title: 'Design new homepage', type: 'story', points: 5, parent: brand.id, status: 'todo', tags: ['UI/UX'], priority: 'high', who: 'minh', due: '2026-10-09', by: 'fujita' });
  await task(web, { title: 'Build user authentication', type: 'story', points: 8, parent: platform.id, status: 'todo', tags: ['Backend'], priority: 'high', who: 'ken', due: '2026-10-12', by: 'fujita' });
  await task(web, { title: 'Prepare marketing assets', type: 'task', points: 3, parent: brand.id, status: 'todo', tags: ['Marketing'], priority: 'medium', who: 'mika', due: '2026-10-16', by: 'claudia' });
  const booking = await task(web, { title: 'Implement booking system', type: 'story', points: 13, parent: bookingEpic.id, status: 'doing', tags: ['Development'], priority: 'high', who: 'fujita', start: '2026-09-21', due: '2026-10-08', by: 'fujita', desc: 'Online booking for all branches: calendar, staff selection, confirmation e-mail.' });
  for (const [i, t] of ['Booking calendar', 'Staff selection', 'Confirmation e-mail', 'Cancellation flow', 'Admin overview'].entries())
    await task(web, { title: t, status: i < 3 ? 'done' : 'todo', parent: booking.id, who: i % 2 ? 'ken' : 'fujita', by: 'fujita', doneOn: '2026-10-01' });
  const api = await task(web, { title: 'API integration (payment)', type: 'story', points: 8, parent: bookingEpic.id, status: 'doing', tags: ['Development'], priority: 'medium', who: 'ken', due: '2026-10-11', by: 'fujita' });
  for (const [i, t] of ['Choose provider', 'Sandbox keys', 'Webhooks', 'Refunds'].entries()) await task(web, { title: t, status: i < 1 ? 'done' : 'todo', parent: api.id, who: 'ken', by: 'fujita', doneOn: '2026-10-02' });
  await task(web, { title: 'Testing & QA', type: 'task', points: 5, parent: platform.id, status: 'doing', tags: ['QA'], priority: 'medium', who: 'mika', due: '2026-10-10', by: 'fujita' });
  await task(web, { title: 'Create content for branch 625', type: 'task', points: 3, parent: brand.id, status: 'review', tags: ['Content'], priority: 'medium', who: 'sora', due: '2026-10-07', by: 'claudia' });
  await task(web, { title: 'Design logo variations', type: 'story', points: 3, parent: brand.id, status: 'review', tags: ['Design'], priority: 'low', who: 'minh', due: '2026-10-05', by: 'fujita' });
  await task(web, { title: 'Setup server environment', type: 'task', points: 2, parent: platform.id, status: 'done', tags: ['DevOps'], priority: 'low', who: 'ken', due: '2026-09-20', doneOn: '2026-09-19', by: 'fujita' });
  await task(web, { title: 'Requirements document', type: 'task', points: 2, parent: platform.id, status: 'done', tags: ['Product'], priority: 'low', who: 'fujita', due: '2026-09-19', doneOn: '2026-09-19', by: 'fujita' });
  await task(web, { title: 'Initial wireframe', type: 'story', points: 3, parent: brand.id, status: 'done', tags: ['Design'], priority: 'low', who: 'minh', due: '2026-09-18', doneOn: '2026-09-21', by: 'fujita' });
  await task(web, { title: 'Log in and book with LINE', type: 'story', triage: true, reporter: 'hana', status: 'todo', by: 'hana', desc: 'Customers ask to log in and book with their LINE account.' });
  await task(web, { title: 'Booking page is slow on mobile', type: 'bug', triage: true, reporter: 'yuki', status: 'todo', priority: 'high', by: 'yuki', desc: 'Takes about 8 s to load on 4G at Branch 575.' });

  // Quality (§76): acceptance criteria and time logged on the booking story.
  await db
    .update(s.tasks)
    .set({
      criteria: [
        { id: 'c1', text: 'Given a free slot, when the customer books, then the slot is held for 10 minutes', done: true },
        { id: 'c2', text: 'Given a booking, when it is confirmed, then the customer gets a confirmation e-mail', done: true },
        { id: 'c3', text: 'Given a booking, when the customer cancels 24 h before, then no fee is charged', done: false },
      ],
      dodDone: ['Code reviewed', 'Tests pass'],
      estimateMinutes: 40 * 60,
    })
    .where(eq(s.tasks.id, booking.id));
  await db.insert(s.taskWorklogs).values([
    { taskId: booking.id, userId: u.fujita.id, minutes: 6 * 60, day: '2026-09-29', note: 'Calendar component' },
    { taskId: booking.id, userId: u.ken.id, minutes: 4 * 60, day: '2026-09-30', note: 'Staff selection API' },
    { taskId: booking.id, userId: u.fujita.id, minutes: 5 * 60, day: '2026-10-01', note: 'Confirmation e-mail' },
  ]);

  // Sprints (§76): Sprint 1 closed with its retrospective, Sprint 2 running now, Sprint 3 planned, one item in the backlog.
  const ymd = (d: Date) => d.toISOString().slice(0, 10);
  const s2Start = new Date(Date.now() - 9 * 86400_000);
  const shift = (d: Date, n: number) => new Date(d.getTime() + n * 86400_000);
  const [s1] = await db
    .insert(s.sprints)
    .values({ projectId: web.id, name: 'WEB Sprint 1', goal: 'Foundations: server, requirements, wireframes', startDate: ymd(shift(s2Start, -14)), endDate: ymd(shift(s2Start, -1)), state: 'closed', committedPoints: 10, committedCount: 4, completedPoints: 7, completedCount: 3, startedAt: shift(s2Start, -14).toISOString(), completedAt: shift(s2Start, -1).toISOString(), createdBy: u.fujita.id })
    .returning();
  const [s2] = await db
    .insert(s.sprints)
    .values({ projectId: web.id, name: 'WEB Sprint 2', goal: 'Customers can book a visit online', startDate: ymd(s2Start), endDate: ymd(shift(s2Start, 13)), state: 'active', committedPoints: 37, committedCount: 6, startedAt: s2Start.toISOString(), createdBy: u.fujita.id })
    .returning();
  const [s3] = await db
    .insert(s.sprints)
    .values({ projectId: web.id, name: 'WEB Sprint 3', goal: 'Sign-in and payments', startDate: ymd(shift(s2Start, 14)), endDate: ymd(shift(s2Start, 27)), createdBy: u.fujita.id })
    .returning();
  const plan = async (sprintId: string, titles: string[]) => {
    for (const title of titles) await db.update(s.tasks).set({ sprintId }).where(and(eq(s.tasks.projectId, web.id), eq(s.tasks.title, title)));
  };
  await plan(s1.id, ['Setup server environment', 'Requirements document', 'Initial wireframe']);
  await plan(s2.id, ['Design new homepage', 'Implement booking system', 'API integration (payment)', 'Testing & QA', 'Create content for branch 625', 'Design logo variations']);
  await plan(s3.id, ['Build user authentication']);
  // Backlog order = board order.
  await db.execute(sql`UPDATE tasks SET rank = position WHERE project_id = ${web.id}`);
  await db.insert(s.retroItems).values([
    { sprintId: s1.id, kind: 'good', body: 'Wireframes reviewed early with the branches', authorId: u.minh.id, votes: [u.fujita.id, u.ken.id, u.mika.id] },
    { sprintId: s1.id, kind: 'improve', body: 'Requirements changed in the middle of the sprint', authorId: u.ken.id, votes: [u.fujita.id] },
    { sprintId: s1.id, kind: 'action', body: 'Freeze the sprint scope after planning', authorId: u.fujita.id, votes: [u.ken.id, u.minh.id] },
  ]);

  // Gantt: Branch 625 System.
  const sys = await project('Branch 625', 'Branch 625 System', 'B625', '#ef4444', 'sora', 'waterfall', 'waterfall');
  const byTitle = new Map<string, string>();
  const phase = async (title: string, start: string, due: string, items: [string, string, string, number, string][]) => {
    const total = items.length;
    const doneCount = items.filter((i) => i[3] === 100).length;
    const parent = await task(sys, { title, type: 'phase', status: doneCount === total ? 'done' : items.some((i) => i[3] > 0) ? 'doing' : 'todo', start, due, by: 'sora', who: 'sora' });
    for (const [t, s1, d1, pct, who] of items) {
      const milestone = t.startsWith('◆ ');
      const row = await task(sys, { title: milestone ? t.slice(2) : t, type: milestone ? 'milestone' : 'task', status: pct === 100 ? 'done' : pct > 0 ? 'doing' : 'todo', start: s1, due: d1, progress: pct, parent: parent.id, who, by: 'sora' });
      byTitle.set(row.title, row.id);
    }
  };
  await phase('Planning', '2026-09-01', '2026-09-10', [
    ['Requirements gathering', '2026-09-01', '2026-09-05', 100, 'sora'],
    ['Stakeholder review', '2026-09-06', '2026-09-10', 100, 'mika'],
  ]);
  await phase('Design', '2026-09-11', '2026-09-22', [
    ['UI/UX design', '2026-09-11', '2026-09-20', 80, 'minh'],
    ['System architecture', '2026-09-15', '2026-09-22', 60, 'ken'],
  ]);
  await phase('Development', '2026-09-23', '2026-10-20', [
    ['Frontend development', '2026-09-23', '2026-10-10', 30, 'minh'],
    ['Backend development', '2026-09-25', '2026-10-15', 20, 'ken'],
    ['API integration', '2026-10-01', '2026-10-20', 0, 'ken'],
  ]);
  await phase('Testing', '2026-10-15', '2026-10-30', [
    ['System testing', '2026-10-15', '2026-10-25', 0, 'mika'],
    ['UAT', '2026-10-26', '2026-10-30', 0, 'sora'],
  ]);
  await phase('Deployment', '2026-11-01', '2026-11-05', [
    ['Production release', '2026-11-01', '2026-11-05', 0, 'ken'],
    ['◆ Go-live', '2026-11-05', '2026-11-05', 0, 'sora'],
  ]);
  // Finish-to-start dependencies.
  for (const [a, b] of [
    ['Backend development', 'API integration'],
    ['System testing', 'UAT'],
    ['UAT', 'Production release'],
    ['Production release', 'Go-live'],
  ])
    await db.insert(s.taskLinks).values({ fromId: byTitle.get(a)!, toId: byTitle.get(b)!, kind: 'blocks', createdBy: u.sora.id });

  // Personal tasks of Claudia.
  await task(null, { title: 'Review Q4 budget', status: 'todo', priority: 'high', who: 'claudia', due: '2026-10-07', by: 'claudia' });
  await task(null, { title: 'Prepare all-hands slides', status: 'doing', priority: 'medium', who: 'claudia', due: '2026-10-09', by: 'claudia' });
}
