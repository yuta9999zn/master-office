import { eq } from 'drizzle-orm';
import { between } from '@workos/shared';
import { DEFAULT_STATUSES } from '../tasks/tasks.service';
import type { Db } from './client';
import * as s from './schema';

type User = typeof s.users.$inferSelect;

/**
 * Tasks demo data after "over view.png" (§72): the "Website Revamp" Kanban board (ITM Japan) and the "Branch 625
 * System" plan with phases and subtasks for the Gantt view, plus a few personal tasks.
 */
export async function seedTasks(db: Db, workspaceId: string, u: Record<string, User>, spaceId: (name: string) => string) {
  const project = async (space: string, name: string, key: string, color: string, owner: string) => {
    const [p] = await db.insert(s.projects).values({ workspaceId, spaceId: spaceId(space), name, key, color, statuses: DEFAULT_STATUSES, createdBy: u[owner].id }).returning();
    return p;
  };
  const last = new Map<string, string>();
  async function task(p: typeof s.projects.$inferSelect | null, o: { title: string; status: string; tags?: string[]; priority?: 'low' | 'medium' | 'high' | 'urgent'; who?: string; start?: string; due?: string; progress?: number; parent?: string; by: string; desc?: string; doneOn?: string }) {
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
        createdBy: u[o.by].id,
        createdAt: new Date(`${o.start ?? '2026-09-10'}T01:00:00Z`).toISOString(),
      })
      .returning();
    await db.insert(s.taskEvents).values({ taskId: t.id, actorId: u[o.by].id, kind: 'change', data: { created: true }, createdAt: t.createdAt });
    return t;
  }

  // Kanban: Website Revamp.
  const web = await project('ITM Japan', 'Website Revamp', 'WEB', '#7c3aed', 'fujita');
  await task(web, { title: 'Design new homepage', status: 'todo', tags: ['UI/UX'], priority: 'high', who: 'minh', due: '2026-10-09', by: 'fujita' });
  await task(web, { title: 'Build user authentication', status: 'todo', tags: ['Backend'], priority: 'high', who: 'ken', due: '2026-10-12', by: 'fujita' });
  await task(web, { title: 'Prepare marketing assets', status: 'todo', tags: ['Marketing'], priority: 'medium', who: 'mika', due: '2026-10-16', by: 'claudia' });
  const booking = await task(web, { title: 'Implement booking system', status: 'doing', tags: ['Development'], priority: 'high', who: 'fujita', start: '2026-09-21', due: '2026-10-08', by: 'fujita', desc: 'Online booking for all branches: calendar, staff selection, confirmation e-mail.' });
  for (const [i, t] of ['Booking calendar', 'Staff selection', 'Confirmation e-mail', 'Cancellation flow', 'Admin overview'].entries())
    await task(web, { title: t, status: i < 3 ? 'done' : 'todo', parent: booking.id, who: i % 2 ? 'ken' : 'fujita', by: 'fujita', doneOn: '2026-10-01' });
  const api = await task(web, { title: 'API integration (payment)', status: 'doing', tags: ['Development'], priority: 'medium', who: 'ken', due: '2026-10-11', by: 'fujita' });
  for (const [i, t] of ['Choose provider', 'Sandbox keys', 'Webhooks', 'Refunds'].entries()) await task(web, { title: t, status: i < 1 ? 'done' : 'todo', parent: api.id, who: 'ken', by: 'fujita', doneOn: '2026-10-02' });
  await task(web, { title: 'Testing & QA', status: 'doing', tags: ['QA'], priority: 'medium', who: 'mika', due: '2026-10-10', by: 'fujita' });
  await task(web, { title: 'Create content for branch 625', status: 'review', tags: ['Content'], priority: 'medium', who: 'sora', due: '2026-10-07', by: 'claudia' });
  await task(web, { title: 'Design logo variations', status: 'review', tags: ['Design'], priority: 'low', who: 'minh', due: '2026-10-05', by: 'fujita' });
  await task(web, { title: 'Setup server environment', status: 'done', tags: ['DevOps'], priority: 'low', who: 'ken', due: '2026-09-20', doneOn: '2026-09-19', by: 'fujita' });
  await task(web, { title: 'Requirements document', status: 'done', tags: ['Product'], priority: 'low', who: 'fujita', due: '2026-09-19', doneOn: '2026-09-19', by: 'fujita' });
  await task(web, { title: 'Initial wireframe', status: 'done', tags: ['Design'], priority: 'low', who: 'minh', due: '2026-09-18', doneOn: '2026-09-21', by: 'fujita' });

  // Gantt: Branch 625 System.
  const sys = await project('Branch 625', 'Branch 625 System', 'B625', '#ef4444', 'sora');
  const phase = async (title: string, start: string, due: string, items: [string, string, string, number, string][]) => {
    const total = items.length;
    const doneCount = items.filter((i) => i[3] === 100).length;
    const parent = await task(sys, { title, status: doneCount === total ? 'done' : items.some((i) => i[3] > 0) ? 'doing' : 'todo', start, due, by: 'sora', who: 'sora' });
    for (const [t, s1, d1, pct, who] of items) await task(sys, { title: t, status: pct === 100 ? 'done' : pct > 0 ? 'doing' : 'todo', start: s1, due: d1, progress: pct, parent: parent.id, who, by: 'sora' });
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
    ['UAT', '2026-10-20', '2026-10-30', 0, 'sora'],
  ]);
  await phase('Deployment', '2026-11-01', '2026-11-05', [['Production release', '2026-11-01', '2026-11-05', 0, 'ken']]);

  // Personal tasks of Claudia.
  await task(null, { title: 'Review Q4 budget', status: 'todo', priority: 'high', who: 'claudia', due: '2026-10-07', by: 'claudia' });
  await task(null, { title: 'Prepare all-hands slides', status: 'doing', priority: 'medium', who: 'claudia', due: '2026-10-09', by: 'claudia' });
}
