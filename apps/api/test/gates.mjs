// Waterfall / hybrid (§76, batch 4b): phase stage gates (exit criteria → approval request → every approver approves,
// one rejection sends it back) holding phases from Done, and the project's finish-to-start links for the Gantt.
//   node apps/api/test/gates.mjs
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
const uid = (key) => users.find((u) => u.email === `${key}@kaori.jp`).id;
const [fujita, mika, hana] = ['fujita', 'mika', 'hana'].map(uid);
const spaces = (await call('GET', '/spaces', { user: fujita })).data;
const spaceId = spaces.find((s) => s.name === 'ITM Japan').id;
const n = Date.now() % 100000;
const proj = (await call('POST', '/tasks/projects', { user: fujita, body: { spaceId, name: `Gates ${n}`, key: `GT${n}`, methodology: 'waterfall' } })).data;
await call('PATCH', `/tasks/projects/${proj.id}`, { user: fujita, body: { strictWorkflow: false } });
const gateBells = async (user, title) => (await call('GET', '/notifications?limit=100', { user })).data.filter((x) => x.kind === 'task.gate' && x.title.includes(title));

// ── Exit criteria and the request ───────────────────────────────────────────
const title = `Design ${n}`;
const phase = (await call('POST', '/tasks', { user: fujita, body: { projectId: proj.id, title, type: 'phase', startDate: '2026-11-02', dueDate: '2026-11-20', criteria: [{ text: 'Design reviewed' }, { text: 'Customer signed off' }] } })).data;
check('a phase has a gate, not requested yet', phase.gate?.status === 'none' && phase.gate.approvers.length === 0, phase.gate);
const story = (await call('POST', '/tasks', { user: fujita, body: { projectId: proj.id, title: 'Wireframes', type: 'task', parentId: phase.id } })).data;
check('other issues have no gate', story.gate === null);
check('only phases have gates', (await call('POST', `/tasks/${story.id}/gate/request`, { user: fujita, body: {} })).data.message === 'Gates are for phases');
const early = await call('POST', `/tasks/${phase.id}/gate/request`, { user: mika, body: {} });
check('the gate waits for every exit criterion', early.status === 400 && early.data.message === '2 exit criteria still open', early.data);
const closing = await call('PATCH', `/tasks/${phase.id}`, { user: fujita, body: { status: 'done' } });
check('a waterfall phase cannot be Completed without an approved gate', closing.status === 400 && closing.data.message === 'Get the phase gate approved before closing the phase', closing.data);
const met = (await call('PATCH', `/tasks/${phase.id}`, { user: mika, body: { criteria: phase.criteria.map((c) => ({ ...c, done: true })) } })).data;
check('meeting the exit criteria', met.criteria.every((c) => c.done));
check('viewers cannot ask for the gate', (await call('POST', `/tasks/${phase.id}/gate/request`, { user: hana, body: {} })).status === 403);
const req = await call('POST', `/tasks/${phase.id}/gate/request`, { user: mika, body: { approverIds: [fujita, mika], note: 'Design pack attached' } });
check('asking two approvers', req.status === 200 && req.data.gate.status === 'requested' && req.data.gate.approvers.map((u) => u.id).sort().join() === [fujita, mika].sort().join(), req.data);
check('the approvers get a bell (not the one who asked)', (await gateBells(fujita, `approve the exit of phase "${title}"`)).length === 1 && (await gateBells(mika, `approve the exit of phase "${title}"`)).length === 0);
const asked = (await gateBells(fujita, `approve the exit of phase "${title}"`))[0];
check('… which opens the phase on the Gantt', asked.url === `/tasks?project=${proj.id}&view=gantt&task=${phase.id}` && asked.body === 'Design pack attached', asked);

// ── Decisions ───────────────────────────────────────────────────────────────
check('only approvers decide', (await call('POST', `/tasks/${phase.id}/gate/decide`, { user: hana, body: { decision: 'approve' } })).status === 403);
check('a rejection needs a reason', (await call('POST', `/tasks/${phase.id}/gate/decide`, { user: mika, body: { decision: 'reject' } })).data.message === 'Say why the gate is rejected');
const one = (await call('POST', `/tasks/${phase.id}/gate/decide`, { user: fujita, body: { decision: 'approve', comment: 'Looks good' } })).data;
check('one of two approvals keeps it waiting', one.gate.status === 'requested' && one.gate.decisions.length === 1 && one.gate.decisions[0].user.id === fujita && one.gate.decisions[0].comment === 'Looks good', one.gate);
check('… and the phase still cannot close', (await call('PATCH', `/tasks/${phase.id}`, { user: fujita, body: { status: 'done' } })).status === 400);
const rej = (await call('POST', `/tasks/${phase.id}/gate/decide`, { user: mika, body: { decision: 'reject', comment: 'Missing the error states' } })).data;
check('one rejection rejects the gate', rej.gate.status === 'rejected' && rej.gate.decisions.length === 2, rej.gate);
check('the lead hears about it', (await gateBells(fujita, `The gate of phase "${title}" was rejected`)).length === 1);
check('nothing is waiting any more', (await call('POST', `/tasks/${phase.id}/gate/decide`, { user: fujita, body: { decision: 'approve' } })).data.message === 'No gate approval is waiting');
const again = (await call('POST', `/tasks/${phase.id}/gate/request`, { user: mika, body: { approverIds: [fujita, mika] } })).data;
check('asking again starts fresh', again.gate.status === 'requested' && again.gate.decisions.length === 0);
await call('POST', `/tasks/${phase.id}/gate/decide`, { user: fujita, body: { decision: 'approve' } });
const ok = (await call('POST', `/tasks/${phase.id}/gate/decide`, { user: mika, body: { decision: 'approve' } })).data;
check('every approver approves → approved', ok.gate.status === 'approved', ok.gate);
const done = await call('PATCH', `/tasks/${phase.id}`, { user: fujita, body: { status: 'done' } });
check('… and the phase closes', done.status === 200 && done.data.completedAt !== null, done.data);
const events = (await call('GET', `/tasks/${phase.id}`, { user: fujita })).data.events;
check('the gate history is in the activity', events.filter((e) => e.data?.gate).length === 6, events.map((e) => e.data));

// ── Reopening an exit criterion withdraws the gate ──────────────────────────
const p2 = (await call('POST', '/tasks', { user: fujita, body: { projectId: proj.id, title: `Build ${n}`, type: 'phase', criteria: [{ text: 'Code complete', done: true }] } })).data;
const def = (await call('POST', `/tasks/${p2.id}/gate/request`, { user: mika, body: {} })).data;
check('without a choice the project lead approves', def.gate.approvers.length === 1 && def.gate.approvers[0].id === fujita, def.gate);
const reopened = (await call('PATCH', `/tasks/${p2.id}`, { user: mika, body: { criteria: [{ ...def.criteria[0], done: false }] } })).data;
check('reopening an exit criterion withdraws the request', reopened.gate.status === 'none' && reopened.gate.decisions.length === 0, reopened.gate);

// ── Agile projects close phases freely ──────────────────────────────────────
const agile = (await call('POST', '/tasks/projects', { user: fujita, body: { spaceId, name: `Gates agile ${n}`, key: `GA${n}`, methodology: 'kanban' } })).data;
await call('PATCH', `/tasks/projects/${agile.id}`, { user: fujita, body: { strictWorkflow: false } });
const ap = (await call('POST', '/tasks', { user: fujita, body: { projectId: agile.id, title: 'Discovery', type: 'phase' } })).data;
check('kanban phases need no gate', (await call('PATCH', `/tasks/${ap.id}`, { user: fujita, body: { status: 'done' } })).status === 200);

// ── Finish-to-start links for the Gantt ─────────────────────────────────────
const a = (await call('POST', '/tasks', { user: fujita, body: { projectId: proj.id, title: 'Database schema', startDate: '2026-11-02', dueDate: '2026-11-06' } })).data;
const b = (await call('POST', '/tasks', { user: fujita, body: { projectId: proj.id, title: 'API', startDate: '2026-11-05', dueDate: '2026-11-12' } })).data;
const c = (await call('POST', '/tasks', { user: fujita, body: { projectId: proj.id, title: 'Notes', startDate: '2026-11-05' } })).data;
await call('POST', `/tasks/${a.id}/links`, { user: fujita, body: { toId: b.id, kind: 'blocks' } });
await call('POST', `/tasks/${a.id}/links`, { user: fujita, body: { toId: c.id, kind: 'relates' } });
const links = await call('GET', `/tasks/projects/${proj.id}/links`, { user: hana });
check('the project lists its blocking links (readers too)', links.status === 200 && links.data.length === 1 && links.data[0].fromId === a.id && links.data[0].toId === b.id, links.data);
const moved = (await call('PATCH', `/tasks/${b.id}`, { user: fujita, body: { startDate: '2026-11-09', dueDate: '2026-11-16' } })).data;
check('moving a bar changes both dates', moved.startDate === '2026-11-09' && moved.dueDate === '2026-11-16', moved);

console.log(failures ? `\n${failures} check(s) failed` : '\nall gate checks passed');
process.exit(failures ? 1 : 0);
