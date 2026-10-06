// Tasks integration test (§72): projects in spaces and their roles, numbered tasks, board moves (fractional
// positions), status → done, subtasks, assignment and comments with notifications, personal tasks, statuses,
// dashboard numbers.   node apps/api/test/tasks.mjs   (fresh seed)
const API = process.env.API_URL ?? 'http://localhost:4000';
let failures = 0;
const check = (name, cond, extra) => {
  console.log(`${cond ? '✓' : '✗'} ${name}${cond ? '' : ' ' + JSON.stringify(extra ?? '')}`);
  if (!cond) failures++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function call(method, path, { user, body } = {}) {
  const headers = {};
  if (user) headers['x-user-id'] = user;
  if (body) headers['content-type'] = 'application/json';
  const res = await fetch(API + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null };
}
const users = (await call('GET', '/users')).data;
const uid = (key) => users.find((u) => u.email === `${key}@kaori.jp`).id;
const [claudia, hana, mika, ken, fujita, rina, minh] = ['claudia', 'hana', 'mika', 'ken', 'fujita', 'rina', 'minh'].map(uid);
const list = async (user, project) => (await call('GET', `/tasks?project=${project}`, { user })).data;
const inbox = async (user) => (await call('GET', '/notifications?unread=1', { user })).data;

const ps = (await call('GET', '/tasks/projects', { user: claudia })).data;
const web = ps.find((p) => p.key === 'WEB');
const sys = ps.find((p) => p.key === 'B625');
check('projects of the spaces you see, with counts', !!web && !!sys && web.counts.total === 11 && web.counts.done === 3 && web.statuses.length === 11 && web.workflow === 'software', ps.map((p) => [p.key, p.counts]));
const board = await list(claudia, web.id);
const booking = board.find((t) => t.title === 'Implement booking system');
check('tasks carry their reference and subtask progress', booking.ref.startsWith('WEB-') && booking.subtasks.total === 5 && booking.subtasks.done === 3 && booking.progress === 60, booking);
check('cards come in board order inside each column', board.filter((t) => t.status === 'todo' && ['story', 'task', 'bug'].includes(t.type) && !t.triage).map((t) => t.title).slice(0, 3).join() === 'Design new homepage,Build user authentication,Prepare marketing assets');

// ── Roles ───────────────────────────────────────────────────────────────────
const asHana = (await call('GET', '/tasks/projects', { user: hana })).data.find((p) => p.id === web.id);
check('people who only view the space read the project but cannot change it', asHana?.perms.read && !asHana.perms.write, asHana?.perms);
check('… creating is refused', (await call('POST', '/tasks', { user: hana, body: { projectId: web.id, title: 'x' } })).status === 403);
const created = await call('POST', '/tasks', { user: mika, body: { projectId: web.id, title: 'Write FAQ page', priority: 'medium', assigneeId: minh, tags: ['Content', 'Content'], dueDate: '2026-10-20' } });
check('editors create tasks with the next number, last in the first column', created.status === 201 && created.data.ref === `WEB-${board.length + 1}` && created.data.status === 'todo' && created.data.tags.join() === 'Content', created.data);
await sleep(300);
check('the assignee is told', (await inbox(minh)).some((n) => n.kind === 'task.assigned' && n.title.includes('"Write FAQ page"')));
check('the due date cannot be before the start', (await call('POST', '/tasks', { user: mika, body: { projectId: web.id, title: 'x', startDate: '2026-10-10', dueDate: '2026-10-01' } })).status === 400);

// ── Moving on the board ─────────────────────────────────────────────────────
const todo = (await list(claudia, web.id)).filter((t) => t.status === 'todo' && !t.parentId);
const [a, b] = todo;
const moved = await call('PATCH', `/tasks/${created.data.id}`, { user: mika, body: { status: 'todo', after: a.id, before: b.id } });
check('a card dropped between two others lands between them', moved.status === 200 && moved.data.position > a.position && moved.data.position < b.position, [a.position, moved.data.position, b.position]);
const done = await call('PATCH', `/tasks/${created.data.id}`, { user: mika, body: { status: 'done' } });
check('moving to a "done" column completes the task', done.data.completedAt && done.data.progress === 100);
const back = await call('PATCH', `/tasks/${created.data.id}`, { user: mika, body: { status: 'doing' } });
check('… and out of it reopens it', back.data.completedAt === null);
const detail = (await call('GET', `/tasks/${created.data.id}`, { user: claudia })).data;
check('the activity trail records the changes', detail.events.some((e) => e.kind === 'change' && e.data.status?.[1] === 'done') && detail.statuses.length === 11, detail.events.map((e) => e.data));

// ── Subtasks, comments ──────────────────────────────────────────────────────
const sub = await call('POST', '/tasks', { user: mika, body: { parentId: created.data.id, title: 'Collect questions' } });
check('subtasks join their parent\'s project', sub.status === 201 && sub.data.projectId === web.id && sub.data.parentId === created.data.id);
check('subtasks have no subtasks', (await call('POST', '/tasks', { user: mika, body: { parentId: sub.data.id, title: 'x' } })).status === 400);
await call('PATCH', `/tasks/${sub.data.id}`, { user: mika, body: { status: 'done' } });
check('a parent shows its subtasks\' share done', (await call('GET', `/tasks/${created.data.id}`, { user: mika })).data.progress === 100);
const c = await call('POST', `/tasks/${created.data.id}/comments`, { user: fujita, body: { body: 'Please include pricing questions.' } });
await sleep(300);
check('commenting notifies the assignee and the creator', c.status === 201 && (await inbox(minh)).some((n) => n.kind === 'task.comment') && (await inbox(mika)).some((n) => n.kind === 'task.comment' && n.body === 'Please include pricing questions.'));
check('viewers who cannot comment are refused', (await call('POST', `/tasks/${created.data.id}/comments`, { user: rina, body: { body: 'x' } })).status === 403);

// ── Assignment rules, private spaces ────────────────────────────────────────
const spaces = (await call('GET', '/spaces', { user: claudia })).data;
const hrProj = await call('POST', '/tasks/projects', { user: rina, body: { spaceId: spaces.find((s) => s.name === 'HR').id, name: 'Hiring 2027', key: 'HIRE' } });
check('editors of a space create projects, with the software workflow enforced', hrProj.status === 201 && hrProj.data.key === 'HIRE' && hrProj.data.workflow === 'software' && hrProj.data.strictWorkflow && hrProj.data.statuses.some((x) => x.id === 'retest'), hrProj.data);
check('keys are unique', (await call('POST', '/tasks/projects', { user: rina, body: { spaceId: spaces.find((s) => s.name === 'HR').id, name: 'Other', key: 'HIRE' } })).status === 400);
check('tasks can only be assigned to people who see the project', (await call('POST', '/tasks', { user: rina, body: { projectId: hrProj.data.id, title: 'x', assigneeId: ken } })).status === 400);
check('private projects are invisible to outsiders', !(await call('GET', '/tasks/projects', { user: ken })).data.some((p) => p.key === 'HIRE') && (await call('GET', `/tasks?project=${hrProj.data.id}`, { user: ken })).status === 404);

// ── Statuses ────────────────────────────────────────────────────────────────
const statuses = [...web.statuses.filter((s) => s.id !== 'review').map((s) => ({ ...s, next: s.next?.filter((n) => n !== 'review') })), { id: 'blocked', name: 'Blocked', color: '#ef4444', category: 'doing' }];
check('members cannot change the columns', (await call('PATCH', `/tasks/projects/${web.id}`, { user: mika, body: { statuses } })).status === 403);
check('the project owner changes the columns', (await call('PATCH', `/tasks/projects/${web.id}`, { user: fujita, body: { statuses } })).status === 204);
const afterCols = await list(claudia, web.id);
check('tasks of a removed status move to the first status of the same kind', !afterCols.some((t) => t.status === 'review') && afterCols.find((t) => t.title === 'Design logo variations').status === 'doing');
check('changed columns make the workflow custom', (await call('GET', '/tasks/projects', { user: claudia })).data.find((p) => p.id === web.id).workflow === 'custom');
check('a "done" column must remain', (await call('PATCH', `/tasks/projects/${web.id}`, { user: fujita, body: { statuses: statuses.filter((s) => s.category !== 'done') } })).status === 400);

// ── Personal tasks ──────────────────────────────────────────────────────────
const mine = (await call('GET', '/tasks?mine=1', { user: claudia })).data;
check('My tasks: personal tasks and those assigned to me', mine.some((t) => t.title === 'Review Q4 budget' && t.projectId === null) && mine.every((t) => t.projectId === null || t.assignee?.id === claudia));
const personal = mine.find((t) => t.title === 'Review Q4 budget');
check('other people cannot open your personal tasks', (await call('GET', `/tasks/${personal.id}`, { user: ken })).status === 404);
const p2 = await call('POST', '/tasks', { user: ken, body: { title: 'Order cleaning supplies', dueDate: '2026-10-08' } });
check('anyone keeps personal tasks', p2.status === 201 && p2.data.projectId === null && p2.data.ref === null);

// ── Dashboard ───────────────────────────────────────────────────────────────
const st = (await call('GET', `/tasks/projects/${sys.id}/stats`, { user: claudia })).data;
check('dashboard numbers (work items, not phases or milestones)', st.total === 10 && st.done === 2 && st.completionRate === 20 && st.byStatus.length === 7 && st.trend.length === 30 && st.people.length >= 1, st);
check('removing a task', (await call('DELETE', `/tasks/${p2.data.id}`, { user: ken })).status === 204 && (await call('GET', `/tasks/${p2.data.id}`, { user: ken })).status === 404);
void claudia;

console.log(failures ? `\n${failures} check(s) failed` : '\nall tasks checks passed');
process.exit(failures ? 1 : 0);
