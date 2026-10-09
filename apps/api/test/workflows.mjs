// Workflows integration test (§76): professional status sets (software development with QA, bug tracking,
// waterfall, scrum, basic), enforced transitions, resolutions, switching workflows without losing issues, custom
// statuses, and logging a bug that blocks the issue it was found on.   node apps/api/test/workflows.mjs
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
const uid = (key) => users.find((u) => u.email === `${key}@hanami.example`).id;
const [mika, fujita, ken] = ['mika', 'fujita', 'ken'].map(uid);
const spaces = (await call('GET', '/spaces', { user: fujita })).data;
const itm = spaces.find((s) => s.name === 'Mirai Systems').id;
const n = Date.now() % 100000;
const move = (id, status, user = fujita) => call('PATCH', `/tasks/${id}`, { user, body: { status } });

// ── Presets ─────────────────────────────────────────────────────────────────
const sw = (await call('POST', '/tasks/projects', { user: fujita, body: { spaceId: itm, name: `Shop ${n}`, key: `SW${n}`, methodology: 'scrum' } })).data;
check('new agile projects get the software development workflow, enforced', sw.workflow === 'software' && sw.strictWorkflow && sw.statuses.map((s) => s.id).join() === 'todo,doing,review,ready_qa,testing,fixing,retest,uat,ready_release,done,cancelled', sw.statuses?.map((s) => s.id));
const wf = (await call('POST', '/tasks/projects', { user: fujita, body: { spaceId: itm, name: `Fitout ${n}`, key: `WF${n}`, methodology: 'waterfall' } })).data;
check('waterfall projects get the stage-gate workflow', wf.workflow === 'waterfall' && wf.statuses.some((s) => s.name === 'Approved') && wf.statuses.some((s) => s.name === 'On Hold'));
const bugp = (await call('POST', '/tasks/projects', { user: fujita, body: { spaceId: itm, name: `Defects ${n}`, key: `BG${n}`, workflow: 'bug' } })).data;
check('the bug tracking workflow', bugp.statuses.map((s) => s.name).join() === "New,Confirmed,In Progress,Fixed,Retest,Reopened,Verified,Closed,Won't Fix", bugp.statuses.map((s) => s.name));

// ── Enforced transitions ────────────────────────────────────────────────────
const story = (await call('POST', '/tasks', { user: fujita, body: { projectId: sw.id, title: 'Checkout page', type: 'story', storyPoints: 5 } })).data;
const skip = await move(story.id, 'done');
check('a strict workflow refuses skipping steps', skip.status === 400 && skip.data.message === '"To Do" cannot move to "Done" in this workflow', skip.data);
let ok = true;
for (const st of ['doing', 'review', 'ready_qa', 'testing', 'fixing', 'retest', 'uat', 'ready_release']) ok = ok && (await move(story.id, st)).status === 200;
check('… and follows its path: dev → code review → QA → fixing → retest → UAT → release', ok);
const done = await move(story.id, 'done');
check('released and done', done.status === 200 && !!done.data.completedAt && done.data.resolution === 'done');
const reopen = await move(story.id, 'fixing');
check('reopening a done issue for a fix', reopen.status === 200 && reopen.data.completedAt === null && reopen.data.resolution === null);
const t2 = (await call('POST', '/tasks', { user: fujita, body: { projectId: sw.id, title: 'Old banner', type: 'task' } })).data;
const cancel = await move(t2.id, 'cancelled');
check('cancelling closes with resolution "cancelled"', cancel.data.resolution === 'cancelled' && !!cancel.data.completedAt);
const b1 = (await call('POST', '/tasks', { user: fujita, body: { projectId: bugp.id, title: 'Price rounding', type: 'bug' } })).data;
check('bug lifecycle: New cannot jump to Fixed', (await move(b1.id, 'fixed')).status === 400);
for (const st of ['confirmed', 'doing', 'fixed', 'retest', 'reopened', 'doing', 'fixed', 'retest', 'verified']) await move(b1.id, st);
const closed = await move(b1.id, 'done');
check('… confirm, fix, retest, reopen, fix, retest, verify, close', closed.status === 200 && closed.data.status === 'done' && !!closed.data.completedAt);
const wont = (await call('POST', '/tasks', { user: fujita, body: { projectId: bugp.id, title: 'Font looks thin', type: 'bug' } })).data;
check("won't fix is a resolution", (await move(wont.id, 'wontfix')).data.resolution === 'wontfix');

// ── Switching workflows, strictness, custom statuses ────────────────────────
const t3 = (await call('POST', '/tasks', { user: fujita, body: { projectId: sw.id, title: 'Search page', type: 'story' } })).data;
for (const st of ['doing', 'review', 'ready_qa', 'testing']) await move(t3.id, st);
check('only the lead switches the workflow', (await call('PATCH', `/tasks/projects/${sw.id}`, { user: mika, body: { workflow: 'scrum' } })).status === 403);
await call('PATCH', `/tasks/projects/${sw.id}`, { user: fujita, body: { workflow: 'scrum' } });
const after = (await call('GET', `/tasks?project=${sw.id}`, { user: fujita })).data;
const proj = (await call('GET', '/tasks/projects', { user: fujita })).data.find((p) => p.id === sw.id);
check('switching to Scrum (simple): 4 statuses', proj.workflow === 'scrum' && proj.statuses.length === 4);
check('… issues keep their place by kind (In Testing → In Progress, Cancelled → Done)', after.find((t) => t.id === t3.id).status === 'doing' && after.find((t) => t.id === t2.id).status === 'done', after.map((t) => [t.title, t.status]));
await call('PATCH', `/tasks/projects/${sw.id}`, { user: fujita, body: { strictWorkflow: false, workflow: 'software' } });
check('with strictness off any move is allowed', (await move(t3.id, 'done')).status === 200);
const bad = await call('PATCH', `/tasks/projects/${sw.id}`, { user: fujita, body: { statuses: [{ id: 'todo', name: 'Open', color: '#64748b', category: 'todo', next: ['ghost'] }, { id: 'done', name: 'Done', color: '#10b981', category: 'done' }] } });
check('custom transitions must point at real statuses', bad.status === 400);

// ── Logging a bug on an issue ───────────────────────────────────────────────
const epic = (await call('POST', '/tasks', { user: fujita, body: { projectId: sw.id, title: 'Payments', type: 'epic' } })).data;
const s2 = (await call('POST', '/tasks', { user: fujita, body: { parentId: epic.id, title: 'Pay by card', type: 'story' } })).data;
const bug = await call('POST', `/tasks/${s2.id}/bugs`, { user: fujita, body: { title: 'Card form rejects valid expiry', assigneeId: ken } });
check('logging a bug found on a story', bug.status === 201 && bug.data.type === 'bug' && bug.data.parentId === epic.id && bug.data.priority === 'high' && bug.data.tags.includes('bug') && bug.data.assignee?.id === ken, bug.data);
const s2d = (await call('GET', `/tasks/${s2.id}`, { user: fujita })).data;
check('… the bug blocks the story until fixed', s2d.blockedBy === 1 && s2d.links.some((l) => l.kind === 'blocks' && l.direction === 'in' && l.task.id === bug.data.id));
check('viewers cannot log bugs', (await call('POST', `/tasks/${s2.id}/bugs`, { user: uid('hana'), body: { title: 'x' } })).status === 403);

console.log(failures ? `\n${failures} failed` : '\nall workflow checks passed');
process.exit(failures ? 1 : 0);
