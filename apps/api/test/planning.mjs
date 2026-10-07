// Planning (§76): a project has epics, an epic has sprints; tasks wait in Not Started and become Created when
// they are planned into a sprint (joining its epic), then follow the workflow (In Progress, In Review, Approved,
// On Hold, Recheck, Completed, Cancelled).   node apps/api/test/planning.mjs
const API = process.env.API_URL ?? 'http://localhost:4000';
let failures = 0;
const check = (name, cond, extra) => {
  console.log(`${cond ? '✓' : '✗'} ${name}${cond ? '' : ' ' + JSON.stringify(extra ?? '')}`);
  if (!cond) failures++;
};
async function call(method, path, { user, body } = {}) {
  const headers = {};
  if (user) headers['x-user-id'] = user;
  if (body) headers['content-type'] = 'application/json';
  const res = await fetch(API + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null };
}
const users = (await call('GET', '/users')).data;
const fujita = users.find((u) => u.email === 'fujita@kaori.jp').id;
const spaces = (await call('GET', '/spaces', { user: fujita })).data;
const n = Date.now() % 100000;
const proj = (await call('POST', '/tasks/projects', { user: fujita, body: { spaceId: spaces.find((s) => s.name === 'ITM Japan').id, name: `Branch rollout ${n}`, key: `PL${n}`, methodology: 'waterfall' } })).data;
await call('PATCH', `/tasks/projects/${proj.id}`, { user: fujita, body: { strictWorkflow: false } });
check('the workflow: Not Started, Created, In Progress, In Review, Approved, On Hold, Recheck, Completed, Cancelled', proj.statuses.map((s) => s.name).join() === 'Not Started,Created,In Progress,In Review,Approved,On Hold,Recheck,Completed,Cancelled', proj.statuses.map((s) => s.name));

const mk = async (body) => (await call('POST', '/tasks', { user: fujita, body: { projectId: proj.id, ...body } })).data;
const pos = await mk({ title: 'POS system', type: 'epic' });
const training = await mk({ title: 'Staff training', type: 'epic' });
const s1 = (await call('POST', `/tasks/projects/${proj.id}/sprints`, { user: fujita, body: { epicId: pos.id, startDate: '2026-11-02', days: 10 } })).data;
check('a sprint belongs to an epic and is named after it', s1.epicId === pos.id && s1.name === 'POS system · Sprint 1' && s1.endDate === '2026-11-11', s1);
const s2 = (await call('POST', `/tasks/projects/${proj.id}/sprints`, { user: fujita, body: { epicId: pos.id } })).data;
check('the epic’s next sprint starts the day after its last one', s2.name === 'POS system · Sprint 2' && s2.startDate === '2026-11-12', s2);
const t1 = (await call('POST', `/tasks/projects/${proj.id}/sprints`, { user: fujita, body: { epicId: training.id, startDate: '2026-11-02', days: 14 } })).data;
check('another epic numbers its own sprints', t1.name === 'Staff training · Sprint 1', t1);
const other = (await call('POST', '/tasks/projects', { user: fujita, body: { spaceId: spaces.find((s) => s.name === 'ITM Japan').id, name: `Other ${n}`, key: `PO${n}`, methodology: 'waterfall' } })).data;
const foreign = (await call('POST', '/tasks', { user: fujita, body: { projectId: other.id, title: 'Elsewhere', type: 'epic' } })).data;
check('a sprint takes only an epic of its project', (await call('POST', `/tasks/projects/${proj.id}/sprints`, { user: fujita, body: { epicId: foreign.id } })).status === 400);

const a = await mk({ title: 'Install terminals', type: 'task' });
const b = await mk({ title: 'Configure receipts', type: 'task' });
check('new tasks wait in Not Started', a.status === 'todo' && !a.sprintId);
const planned = (await call('PATCH', `/tasks/${a.id}`, { user: fujita, body: { sprintId: s1.id } })).data;
check('planned into a sprint: Created, and part of the sprint’s epic', planned.status === 'created' && planned.sprintId === s1.id && planned.parentId === pos.id, planned);
const back = (await call('PATCH', `/tasks/${a.id}`, { user: fujita, body: { sprintId: null } })).data;
check('taken out before work started: Not Started again', back.status === 'todo' && back.sprintId === null, back);
await call('PATCH', `/tasks/${a.id}`, { user: fujita, body: { sprintId: s1.id } });
const working = (await call('PATCH', `/tasks/${a.id}`, { user: fujita, body: { status: 'doing' } })).data;
const kept = (await call('PATCH', `/tasks/${a.id}`, { user: fujita, body: { sprintId: s2.id } })).data;
check('work in progress keeps its status when it moves to another sprint', working.status === 'doing' && kept.status === 'doing' && kept.sprintId === s2.id, kept);
const direct = await mk({ title: 'Print manuals', type: 'task', sprintId: t1.id });
check('a task created straight into a sprint starts as Created', direct.status === 'created', direct);
const flow = ['review', 'recheck', 'doing', 'review', 'approved', 'done'];
let last = null;
for (const st of flow) last = (await call('PATCH', `/tasks/${a.id}`, { user: fujita, body: { status: st } })).data;
check('the issue goes through review, recheck, approval to Completed', last.status === 'done' && last.completedAt !== null, last);

await call('PATCH', `/tasks/${b.id}`, { user: fujita, body: { sprintId: s1.id } });
check('each epic runs its own sprint', (await call('POST', `/tasks/sprints/${s1.id}/start`, { user: fujita, body: {} })).data.state === 'active' && (await call('POST', `/tasks/sprints/${t1.id}/start`, { user: fujita, body: {} })).data.state === 'active');
const busy = await call('POST', `/tasks/sprints/${s2.id}/start`, { user: fujita, body: {} });
check('… but one at a time within an epic', busy.status === 400 && busy.data.message === `Complete ${s1.name} first`, busy.data);

console.log(failures ? `\n${failures} check(s) failed` : '\nall planning checks passed');
process.exit(failures ? 1 : 0);
