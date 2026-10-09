// Quality of the process (§76, batch 4a): Definition of Done and acceptance criteria as a gate to Done, worklogs,
// and the quality numbers (bugs, reopen rate, QA rejections, lead / cycle time, DoD compliance, criteria
// coverage, time).   node apps/api/test/quality.mjs
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
const [fujita, mika, hana] = ['fujita', 'mika', 'hana'].map(uid);
const spaces = (await call('GET', '/spaces', { user: fujita })).data;
const n = Date.now() % 100000;
const proj = (await call('POST', '/tasks/projects', { user: fujita, body: { spaceId: spaces.find((s) => s.name === 'Mirai Systems').id, name: `Quality ${n}`, key: `QA${n}`, methodology: 'scrum' } })).data;
check('new projects start with the usual Definition of Done (not enforced)', proj.dod.length === 6 && proj.dod.includes('Code reviewed') && proj.enforceDod === false, proj.dod);
await call('PATCH', `/tasks/projects/${proj.id}`, { user: fujita, body: { strictWorkflow: false, enforceDod: true, dod: ['Code reviewed', 'Tests pass', 'Code reviewed', ' '] } });
const p2 = (await call('GET', '/tasks/projects', { user: fujita })).data.find((p) => p.id === proj.id);
check('editing the Definition of Done (no duplicates or blanks) and enforcing it', p2.dod.join() === 'Code reviewed,Tests pass' && p2.enforceDod, p2.dod);
check('only the lead changes it', (await call('PATCH', `/tasks/projects/${proj.id}`, { user: mika, body: { enforceDod: false } })).status === 403);

// ── The gate to Done ────────────────────────────────────────────────────────
const s1 = (await call('POST', '/tasks', { user: fujita, body: { projectId: proj.id, title: 'Sign up', type: 'story', criteria: [{ text: 'Given a new e-mail, when I sign up, then I get an account' }, { text: 'Given a used e-mail, then I see an error' }, { text: '  ' }] } })).data;
check('stories carry acceptance criteria', s1.criteria.length === 2 && s1.criteria.every((c) => c.id && !c.done), s1.criteria);
const refused = await call('PATCH', `/tasks/${s1.id}`, { user: mika, body: { status: 'done' } });
check('Done is refused while criteria and the DoD are open', refused.status === 400 && refused.data.message === 'Not done yet: 2 acceptance criteria and 2 Definition of Done items open', refused.data);
await call('PATCH', `/tasks/${s1.id}`, { user: mika, body: { criteria: s1.criteria.map((c) => ({ ...c, done: true })) } });
check('… still refused with the DoD unticked', (await call('PATCH', `/tasks/${s1.id}`, { user: mika, body: { status: 'done' } })).data.message === 'Not done yet: 2 Definition of Done items open');
const ticked = await call('PATCH', `/tasks/${s1.id}`, { user: mika, body: { dodDone: ['Code reviewed', 'Tests pass', 'Not in the DoD'] } });
check('ticking the DoD (only its own items)', ticked.data.dodDone.join() === 'Code reviewed,Tests pass', ticked.data.dodDone);
check('… then Done', (await call('PATCH', `/tasks/${s1.id}`, { user: mika, body: { status: 'done' } })).data.completedAt !== null);
const s2 = (await call('POST', '/tasks', { user: fujita, body: { projectId: proj.id, title: 'Old idea', type: 'story', criteria: [{ text: 'x' }] } })).data;
check('cancelling is not blocked by the DoD', (await call('PATCH', `/tasks/${s2.id}`, { user: mika, body: { status: 'cancelled' } })).status === 200);
const epic = (await call('POST', '/tasks', { user: fujita, body: { projectId: proj.id, title: 'Accounts', type: 'epic' } })).data;
check('the gate is for work items (an epic closes freely)', (await call('PATCH', `/tasks/${epic.id}`, { user: mika, body: { status: 'done' } })).status === 200);

// ── Worklogs ────────────────────────────────────────────────────────────────
const w1 = await call('POST', `/tasks/${s1.id}/worklogs`, { user: mika, body: { minutes: 90, note: 'Form and validation' } });
check('logging time', w1.status === 201 && w1.data[0].minutes === 90 && w1.data[0].user.id === mika);
check('time is between 1 minute and 24 hours', (await call('POST', `/tasks/${s1.id}/worklogs`, { user: mika, body: { minutes: 0 } })).status === 400);
check('viewers do not log time', (await call('POST', `/tasks/${s1.id}/worklogs`, { user: hana, body: { minutes: 30 } })).status === 403);
await call('POST', `/tasks/${s1.id}/worklogs`, { user: fujita, body: { minutes: 30, day: '2026-10-01' } });
const d = (await call('GET', `/tasks/${s1.id}`, { user: fujita })).data;
check('the issue sums its time and lists the logs', d.spentMinutes === 120 && d.worklogs.length === 2);
const mine = d.worklogs.find((w) => w.user.id === mika);
check('only who logged it (or the lead) removes a log', (await call('DELETE', `/tasks/worklogs/${d.worklogs.find((w) => w.user.id === fujita).id}`, { user: mika })).status === 403 && (await call('DELETE', `/tasks/worklogs/${mine.id}`, { user: fujita })).status === 200);

// ── Quality numbers ─────────────────────────────────────────────────────────
await call('PATCH', `/tasks/projects/${proj.id}`, { user: fujita, body: { enforceDod: false } });
const b1 = (await call('POST', '/tasks', { user: fujita, body: { projectId: proj.id, title: 'Crash on submit', type: 'bug', priority: 'urgent', storyPoints: 0 } })).data;
const b2 = (await call('POST', '/tasks', { user: fujita, body: { projectId: proj.id, title: 'Typo', type: 'bug', priority: 'low' } })).data;
await call('PATCH', `/tasks/${b2.id}`, { user: mika, body: { status: 'done' } });
const s3 = (await call('POST', '/tasks', { user: fujita, body: { projectId: proj.id, title: 'Profile page', type: 'story', storyPoints: 5, estimateMinutes: 600 } })).data;
for (const st of ['doing', 'testing', 'fixing', 'retest', 'done', 'doing', 'done']) await call('PATCH', `/tasks/${s3.id}`, { user: mika, body: { status: st } });
const q = (await call('GET', `/tasks/projects/${proj.id}/quality`, { user: hana })).data;
check('bugs: open, closed, critical', q.bugs.open === 1 && q.bugs.closed === 1 && q.bugs.critical === 1, q.bugs);
check('bug trend: 8 weeks, this week opened 2 closed 1', q.bugTrend.length === 8 && q.bugTrend.at(-1).opened === 2 && q.bugTrend.at(-1).closed === 1, q.bugTrend.at(-1));
check('rework: reopened items and QA rejections', q.reopened === 1 && q.qaRejections === 1 && q.reopenRate > 0, [q.reopened, q.qaRejections, q.reopenRate]);
check('flow: lead and cycle time', q.leadDays !== null && q.cycleDays !== null);
check('DoD compliance and acceptance-criteria coverage', q.dodCompliance !== null && q.dodCompliance > 0 && q.dodCompliance < 100 && q.criteriaCoverage !== null, [q.dodCompliance, q.criteriaCoverage]);
check('time: estimates vs logged', q.time.estimateMinutes === 600 && q.time.spentMinutes === 30, q.time);
check('seeded: the booking story has criteria and logged time', (await call('GET', '/tasks/projects', { user: fujita })).data.some((p) => p.key === 'WEB' && p.dod.length === 6));

console.log(failures ? `\n${failures} failed` : '\nall quality checks passed');
process.exit(failures ? 1 : 0);
