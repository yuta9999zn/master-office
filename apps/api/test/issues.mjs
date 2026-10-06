// Issues integration test (§76, Jira-style tasks, batch 1): issue types and the hierarchy (phase › epic › story / task /
// bug / milestone › subtask), moving issues, breaking work down, the intake queue (request → accept / decline),
// links and dependencies (blocks, cycles), watchers, tasks made from chat messages, methodology and lead.
// node apps/api/test/issues.mjs   (fresh seed)
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
const [claudia, hana, mika, ken, fujita] = ['claudia', 'hana', 'mika', 'ken', 'fujita'].map(uid);
const inbox = async (user) => (await call('GET', '/notifications?unread=1', { user })).data;
const list = async (user, project) => (await call('GET', `/tasks?project=${project}`, { user })).data;
const get = async (user, id) => (await call('GET', `/tasks/${id}`, { user })).data;
const make = (user, body) => call('POST', '/tasks', { user, body });

const ps = (await call('GET', '/tasks/projects', { user: fujita })).data;
const web = ps.find((p) => p.key === 'WEB');
const sys = ps.find((p) => p.key === 'B625');
check('projects say how they are run and who leads them', web.methodology === 'scrum' && web.lead?.id === fujita && web.intakeOpen && sys.methodology === 'waterfall', [web.methodology, web.lead, sys.methodology]);
const all0 = await list(fujita, web.id);
const work0 = all0.filter((t) => ['story', 'task', 'bug'].includes(t.type) && !t.triage);
check('counts are work items; requests wait apart', web.counts.total === work0.length && web.counts.done === work0.filter((t) => t.completedAt).length && web.counts.triage === all0.filter((t) => t.triage).length && web.counts.triage >= 2, web.counts);

// ── Types and the hierarchy ─────────────────────────────────────────────────
const items = await list(fujita, web.id);
const epic = items.find((t) => t.title === 'Online booking');
const booking = items.find((t) => t.title === 'Implement booking system');
const cal = items.find((t) => t.title === 'Booking calendar');
check('epics hold stories, stories hold subtasks', epic.type === 'epic' && booking.type === 'story' && booking.parentId === epic.id && booking.storyPoints === 13 && cal.type === 'subtask' && cal.parentId === booking.id);
const d = await get(fujita, cal.id);
check('an issue knows its ancestors', d.ancestors.map((a) => a.title).join(' › ') === 'Online booking › Implement booking system' && d.ancestors[0].type === 'epic', d.ancestors);
check('a subtask needs a parent', (await make(mika, { projectId: web.id, title: 'x', type: 'subtask' })).status === 400);
check('a story cannot go under a story', (await make(mika, { parentId: booking.id, title: 'x', type: 'story' })).status === 400);
check('subtasks go under work items only', (await make(mika, { parentId: epic.id, title: 'x', type: 'subtask' })).status === 400);
const child = await make(mika, { parentId: epic.id, title: 'Reminder SMS before visits' });
check('a new child of an epic is a story by default', child.status === 201 && child.data.type === 'story' && child.data.parentId === epic.id, child.data);
check('story points are whole numbers', (await make(mika, { projectId: web.id, title: 'x', storyPoints: -1 })).status === 400);
const phase = await make(fujita, { projectId: web.id, type: 'phase', title: 'Phase 2 — Loyalty', startDate: '2026-11-01', dueDate: '2026-12-15' });
check('hybrid: a project can also have phases', phase.status === 201 && phase.data.type === 'phase');
const loyalty = await make(fujita, { parentId: phase.data.id, type: 'epic', title: 'Loyalty points' });
check('… with epics inside', loyalty.status === 201 && loyalty.data.parentId === phase.data.id);
check('an epic cannot go under a story', (await make(fujita, { parentId: booking.id, type: 'epic', title: 'x' })).status === 400);
const moved = await call('PATCH', `/tasks/${child.data.id}`, { user: mika, body: { parentId: loyalty.data.id } });
check('moving a story to another epic', moved.status === 200 && moved.data.parentId === loyalty.data.id);
check('no issue inside itself', (await call('PATCH', `/tasks/${loyalty.data.id}`, { user: fujita, body: { parentId: child.data.id } })).status === 400);
check('an epic with stories cannot become a story', (await call('PATCH', `/tasks/${loyalty.data.id}`, { user: fujita, body: { type: 'story' } })).status === 400);
check('personal tasks are tasks', (await make(ken, { title: 'x', type: 'epic' })).status === 400);

// ── Breaking work down ──────────────────────────────────────────────────────
const bd = await call('POST', `/tasks/${child.data.id}/breakdown`, { user: mika, body: { titles: ['Pick SMS provider', '', 'Template text', 'Opt-out link'] } });
check('breaking a story down makes subtasks, one per line', bd.status === 201 && bd.data.length === 3 && bd.data.every((t) => t.type === 'subtask' && t.parentId === child.data.id), bd.data?.map((t) => t.type));
const bdEpic = await call('POST', `/tasks/${loyalty.data.id}/breakdown`, { user: fujita, body: { titles: ['Earn points', 'Redeem points'] } });
check('breaking an epic down makes stories', bdEpic.data.every((t) => t.type === 'story'));
check('viewers cannot break things down', (await call('POST', `/tasks/${child.data.id}/breakdown`, { user: hana, body: { titles: ['x'] } })).status === 403);

// ── Intake ──────────────────────────────────────────────────────────────────
check('viewers cannot create issues directly', (await make(hana, { projectId: web.id, title: 'x' })).status === 403);
const req = await call('POST', `/tasks/projects/${web.id}/requests`, { user: hana, body: { title: 'Gift cards on the website', description: 'Customers ask for gift cards.', type: 'story' } });
check('anyone who sees the project files a request', req.status === 201 && req.data.triage === true && req.data.reporter?.id === hana && req.data.type === 'story', req.data);
await sleep(300);
check('the project lead hears about it', (await inbox(fujita)).some((n) => n.kind === 'task.request' && n.title === 'Hana Lee filed a request in Website Revamp: "Gift cards on the website"'));
check('the request is counted apart', (await call('GET', '/tasks/projects', { user: fujita })).data.find((p) => p.id === web.id).counts.triage === web.counts.triage + 1);
const acc = await call('PATCH', `/tasks/${req.data.id}`, { user: fujita, body: { triage: false, assigneeId: mika, storyPoints: 5, parentId: loyalty.data.id } });
check('accepting a request puts it on the backlog', acc.status === 200 && acc.data.triage === false && acc.data.assignee?.id === mika && acc.data.parentId === loyalty.data.id, acc.data);
await sleep(300);
check('… and tells the requester', (await inbox(hana)).some((n) => n.kind === 'task.request' && n.title === 'Fujita Sota accepted your request "Gift cards on the website"'));
const req2 = (await call('POST', `/tasks/projects/${web.id}/requests`, { user: hana, body: { title: 'Dark mode', type: 'story' } })).data;
check('only editors decline', (await call('POST', `/tasks/${req2.id}/decline`, { user: hana, body: { reason: 'x' } })).status === 403);
const dec = await call('POST', `/tasks/${req2.id}/decline`, { user: fujita, body: { reason: 'Not this year.' } });
check('declining closes the request with a reason', dec.status === 200 && dec.data.resolution === 'declined' && !!dec.data.completedAt && !dec.data.triage);
await sleep(300);
check('… and tells the requester', (await inbox(hana)).some((n) => n.title === 'Fujita Sota declined your request "Dark mode"' && n.body === 'Not this year.'));
check('declining works on requests only', (await call('POST', `/tasks/${booking.id}/decline`, { user: fujita, body: {} })).status === 400);
await call('PATCH', `/tasks/projects/${web.id}`, { user: fujita, body: { intakeOpen: false } });
check('the lead can close the intake', (await call('POST', `/tasks/projects/${web.id}/requests`, { user: hana, body: { title: 'x' } })).status === 403);
await call('PATCH', `/tasks/projects/${web.id}`, { user: fujita, body: { intakeOpen: true, methodology: 'hybrid' } });
check('… and change the methodology', (await call('GET', '/tasks/projects', { user: fujita })).data.find((p) => p.id === web.id).methodology === 'hybrid');
check('only the lead or admins change settings', (await call('PATCH', `/tasks/projects/${web.id}`, { user: mika, body: { methodology: 'kanban' } })).status === 403);

// ── Links and dependencies ──────────────────────────────────────────────────
const sysItems = await list(fujita, sys.id);
const apiTask = sysItems.find((t) => t.title === 'API integration');
check('seeded dependencies: API integration waits for backend', apiTask.blockedBy === 1 && sysItems.find((t) => t.title === 'Go-live').type === 'milestone' && sysItems.find((t) => t.title === 'Planning').type === 'phase');
const A = (await make(mika, { projectId: web.id, title: 'Payment provider contract', type: 'task' })).data;
const B = (await make(mika, { projectId: web.id, title: 'Go live with payments', type: 'task' })).data;
const l1 = await call('POST', `/tasks/${A.id}/links`, { user: mika, body: { toId: B.id, kind: 'blocks' } });
check('A blocks B', l1.status === 201 && l1.data[0].kind === 'blocks' && l1.data[0].direction === 'out');
check('B now waits on A', (await get(mika, B.id)).blockedBy === 1 && (await get(mika, B.id)).links[0].direction === 'in');
check('no waiting in a circle', (await call('POST', `/tasks/${B.id}/links`, { user: mika, body: { toId: A.id, kind: 'blocks' } })).status === 400);
check('no link to itself', (await call('POST', `/tasks/${A.id}/links`, { user: mika, body: { toId: A.id, kind: 'relates' } })).status === 400);
await call('PATCH', `/tasks/${A.id}`, { user: mika, body: { status: 'done' } });
check('finishing A frees B', (await get(mika, B.id)).blockedBy === 0);
const rel = await call('POST', `/tasks/${B.id}/links`, { user: mika, body: { toId: booking.id, kind: 'relates' } });
check('relates-to links', rel.data.some((l) => l.kind === 'relates' && l.task.id === booking.id));
const linkId = rel.data.find((l) => l.kind === 'relates').id;
check('removing a link', (await call('DELETE', `/tasks/${B.id}/links/${linkId}`, { user: mika })).data.every((l) => l.kind !== 'relates'));
check('viewers cannot link', (await call('POST', `/tasks/${B.id}/links`, { user: hana, body: { toId: booking.id, kind: 'relates' } })).status === 403);

// ── Watchers ────────────────────────────────────────────────────────────────
check('reporter and assignee follow automatically', (await get(fujita, req.data.id)).watchers.map((w) => w.id).sort().join() === [hana, mika].sort().join());
await call('POST', `/tasks/${booking.id}/watch`, { user: claudia, body: { on: true } });
check('watching an issue', (await get(claudia, booking.id)).watching === true);
await call('POST', `/tasks/${booking.id}/comments`, { user: mika, body: { body: 'Staff selection is merged.' } });
await sleep(300);
check('watchers hear about comments', (await inbox(claudia)).some((n) => n.kind === 'task.comment' && n.body === 'Staff selection is merged.'));
await call('POST', `/tasks/${booking.id}/watch`, { user: claudia, body: { on: false } });
check('unwatching', (await get(claudia, booking.id)).watching === false);

// ── From chat ───────────────────────────────────────────────────────────────
const dm = (await call('POST', '/chat/conversations', { user: fujita, body: { kind: 'dm', userId: ken } })).data;
const msg = (await call('POST', `/chat/conversations/${dm.id}/messages`, { user: ken, body: { body: 'The booking confirmation mail has the wrong time zone.' } })).data;
const fromChat = await make(fujita, { projectId: web.id, title: 'Confirmation mail shows wrong time zone', type: 'bug', source: { kind: 'chat', conversationId: dm.id, messageId: msg.id } });
check('a bug made from a chat message remembers it', fromChat.status === 201 && fromChat.data.type === 'bug' && fromChat.data.source?.messageId === msg.id, fromChat.data);
const thread = (await call('GET', `/chat/messages/${msg.id}/thread`, { user: ken })).data;
check('… and answers in the message thread', thread?.replies?.some((r) => r.body.startsWith(`📋 Created ${fromChat.data.ref}`)), thread);
check('only from messages you can read', (await make(mika, { projectId: web.id, title: 'x', source: { kind: 'chat', conversationId: dm.id, messageId: msg.id } })).status === 404);

await call('PATCH', `/tasks/projects/${web.id}`, { user: fujita, body: { methodology: 'scrum' } });
console.log(failures ? `\n${failures} failed` : '\nall issue checks passed');
process.exit(failures ? 1 : 0);
