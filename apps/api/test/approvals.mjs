// Approvals integration test (§74): templates and who manages them, the route (manager chain, conditions, picked
// approvers, and / or sign-off, the submitter's own step), approve / reject / transfer / withdraw / remind / comment,
// who can see a request when, attachments shared step by step, CC, bells, boxes, and leave → Out of office.
// node apps/api/test/approvals.mjs   (fresh seed)
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
const [claudia, hana, mika, yuki, sora, rina, ken, huong] = ['claudia', 'hana', 'mika', 'yuki', 'sora', 'rina', 'ken', 'huong'].map(uid);
const inbox = async (user) => (await call('GET', '/notifications?unread=1', { user })).data;
const box = async (user, b, extra = '') => (await call('GET', `/approvals/requests?box=${b}${extra}`, { user })).data;
const ymd = (d) => new Date(Date.now() + d * 86400_000).toISOString().slice(0, 10);

// ── Templates ───────────────────────────────────────────────────────────────
const tpls = (await call('GET', '/approvals/templates', { user: yuki })).data;
const T = Object.fromEntries(tpls.map((t) => [t.name, t]));
check('everyone sees the templates they can submit', tpls.length >= 5 && !!T['Leave request'] && !!T['Expense reimbursement'] && tpls.every((t) => !t.canManage), tpls.map((t) => t.name));
const asRina = (await call('GET', '/approvals/templates', { user: rina })).data;
check('a template admin manages their template only', asRina.find((t) => t.name === 'Leave request').canManage && !asRina.find((t) => t.name === 'Expense reimbursement').canManage);
check('workspace owners manage them all', (await call('GET', '/approvals/templates', { user: claudia })).data.every((t) => t.canManage));
const leave = T['Leave request'];
const expense = T['Expense reimbursement'];
const purchase = T['Purchase request'];
const trip = T['Business trip'];
const general = T['General request'];

// ── Seeded requests and who sees them ───────────────────────────────────────
const seeded = (await box(mika, 'pending')).find((r) => r.serial === 'AP-00001');
check('the manager has the seeded leave waiting', !!seeded && seeded.mine && seeded.template.name === 'Leave request' && seeded.summary[0].value === 'Annual leave', seeded);
check('people later in the line cannot act before their turn', (await call('POST', `/approvals/requests/${seeded.id}/approve`, { user: rina, body: {} })).status === 403);
check('template admins (HR for leave) can follow every request of it', (await call('GET', `/approvals/requests/${seeded.id}`, { user: rina })).status === 200);
check('… nor can people outside it', (await call('GET', `/approvals/requests/${seeded.id}`, { user: ken })).status === 404);
check('the submitter and the workspace owner can', (await call('GET', `/approvals/requests/${seeded.id}`, { user: yuki })).status === 200 && (await call('GET', `/approvals/requests/${seeded.id}`, { user: claudia })).status === 200);
check('counts of what waits for me', (await call('GET', '/approvals/counts', { user: mika })).data.pending >= 2);

// ── The route ───────────────────────────────────────────────────────────────
const p2 = (await call('POST', `/approvals/templates/${leave.id}/preview`, { user: yuki, body: { values: { dates: { start: ymd(10), end: ymd(11) } } } })).data;
check('a short leave goes to the manager only', p2.route[0].userIds[0] === mika && p2.route[1].skipped === 'Condition not met' && p2.people.some((p) => p.id === mika), p2.route);
const p5 = (await call('POST', `/approvals/templates/${leave.id}/preview`, { user: yuki, body: { values: { dates: { start: ymd(10), end: ymd(14) } } } })).data;
check('more than 3 days adds HR', p5.route[1].userIds[0] === rina && !p5.route[1].skipped);
const pickPreview = (await call('POST', `/approvals/templates/${general.id}/preview`, { user: ken, body: { values: {} } })).data;
check('"submitter picks" steps ask for people', pickPreview.route[0].needsPick === true);

// ── Submitting ──────────────────────────────────────────────────────────────
check('required answers', (await call('POST', '/approvals/requests', { user: yuki, body: { templateId: leave.id, values: { dates: { start: ymd(3), end: ymd(4) } } } })).status === 400);
check('options must be from the list', (await call('POST', '/approvals/requests', { user: yuki, body: { templateId: leave.id, values: { type: 'Holiday', dates: { start: ymd(3), end: ymd(4) } } } })).status === 400);
check('a range cannot end before it starts', (await call('POST', '/approvals/requests', { user: yuki, body: { templateId: leave.id, values: { type: 'Sick leave', dates: { start: ymd(4), end: ymd(3) } } } })).status === 400);
const someoneElses = (await call('GET', '/resources?limit=50', { user: claudia })).data.find?.((r) => r.ownerId !== yuki && r.type !== 'folder');
if (someoneElses)
  check('only your own uploads can be attached', (await call('POST', '/approvals/requests', { user: yuki, body: { templateId: leave.id, values: { type: 'Sick leave', dates: { start: ymd(3), end: ymd(4) }, files: [someoneElses.id] } } })).status === 400);

const fd = new FormData();
fd.append('file', new Blob(['Doctor note'], { type: 'text/plain' }), 'doctor-note.txt');
const upRes = await fetch(`${API}/approvals/files`, { method: 'POST', headers: { 'x-user-id': yuki }, body: fd });
const note = await upRes.json();
check('attachments upload to the submitter\'s "Approval attachments" folder', upRes.status === 201 && (await call('GET', `/resources/${note.parentId}`, { user: yuki })).data?.name === 'Approval attachments', note);

const sub = await call('POST', '/approvals/requests', {
  user: yuki,
  body: { templateId: leave.id, values: { type: 'Sick leave', dates: { start: ymd(20), end: ymd(24) }, reason: 'Surgery and recovery.', cover: sora, files: [note.id] } },
});
const L = sub.data;
check('submitting a leave request', sub.status === 201 && L.status === 'pending' && /^AP-\d{5}$/.test(L.serial) && L.title === 'Leave request — Yuki Sato', L);
check('… the manager step is open, HR and the CC wait', L.steps[0].state === 'active' && L.steps[0].people[0].user.id === mika && L.steps[1].state === 'upcoming' && L.steps[2].state === 'upcoming', L.steps);
check('… the summary reads as text', L.summary.some((s) => s.label === 'Dates' && s.value.endsWith('(5 days)')), L.summary);
await sleep(300);
check('the manager is asked in the bell', (await inbox(mika)).some((n) => n.kind === 'approval.pending' && n.title === 'Yuki Sato asks for your approval: Leave request' && n.url === `/approvals?r=${L.id}`));
check('the manager can open the attachment', (await call('GET', `/resources/${note.id}`, { user: mika })).status === 200);
check('HR cannot open the attachment before their turn', (await call('GET', `/resources/${note.id}`, { user: rina })).status !== 200);
check('people outside cannot act', (await call('POST', `/approvals/requests/${L.id}/approve`, { user: ken, body: {} })).status === 404);
check('the submitter cannot approve for the manager', (await call('POST', `/approvals/requests/${L.id}/approve`, { user: yuki, body: {} })).status === 403);

const a1 = await call('POST', `/approvals/requests/${L.id}/approve`, { user: mika, body: { comment: 'Get well soon.' } });
check('the manager approves; HR is next', a1.status === 200 && a1.data.steps[0].state === 'done' && a1.data.steps[0].people[0].comment === 'Get well soon.' && a1.data.steps[1].state === 'active', a1.data.steps);
check('approving twice is refused', (await call('POST', `/approvals/requests/${L.id}/approve`, { user: mika, body: {} })).status === 403);
await sleep(300);
check('HR is asked and can now open it and the attachment', (await inbox(rina)).some((n) => n.kind === 'approval.pending') && (await call('GET', `/resources/${note.id}`, { user: rina })).status === 200);
check('rejecting needs a reason', (await call('POST', `/approvals/requests/${L.id}/reject`, { user: rina, body: {} })).status === 400);
const a2 = (await call('POST', `/approvals/requests/${L.id}/approve`, { user: rina, body: {} })).data;
check('HR approves: CC delivered, request approved', a2.status === 'approved' && a2.steps[2].state === 'done' && a2.steps[2].people[0].status === 'cc' && !!a2.finishedAt, a2.steps);
await sleep(500);
check('the submitter hears the result', (await inbox(yuki)).some((n) => n.kind === 'approval.result' && n.title === 'Your leave request was approved'));
check('HR has it in CC', (await box(rina, 'cc')).some((r) => r.id === L.id));
const evs = (await call('GET', `/calendar/events?from=${ymd(19)}T00:00:00Z&to=${ymd(26)}T00:00:00Z`, { user: yuki })).data;
const ooo = evs.find((e) => e.title === 'Out of office · Leave request');
check('approved leave is Out of office in the calendar', !!ooo && ooo.kind === 'ooo' && ooo.allDay, evs.map((e) => e.title));
check('the timeline tells the story', a2.events.map((e) => e.kind).join() === 'submitted,approved,approved,cc,finished', a2.events.map((e) => e.kind));

// ── Transfer, reject ────────────────────────────────────────────────────────
const E = (await call('POST', '/approvals/requests', { user: ken, body: { templateId: expense.id, values: { type: 'Software', amount: 60000, date: ymd(-1), description: 'Inventory app licence' } } })).data;
check('a large expense goes to the manager, then finance', E.steps[0].people[0].user.id === mika && E.steps[1].people[0].user.id === huong && E.steps[1].state === 'upcoming');
check('transferring to yourself is refused', (await call('POST', `/approvals/requests/${E.id}/transfer`, { user: mika, body: { userId: mika } })).status === 400);
const tr = (await call('POST', `/approvals/requests/${E.id}/transfer`, { user: mika, body: { userId: claudia, comment: 'Claudia owns this budget.' } })).data;
check('the manager hands it to someone else', tr.steps[0].people.find((p) => p.user.id === mika).status === 'transferred' && tr.steps[0].people.find((p) => p.user.id === claudia).status === 'pending' && tr.waitingOn[0].id === claudia, tr.steps[0]);
check('… which counts as processed for them', (await box(mika, 'processed')).some((r) => r.id === E.id));
await call('POST', `/approvals/requests/${E.id}/approve`, { user: claudia, body: {} });
const rj = (await call('POST', `/approvals/requests/${E.id}/reject`, { user: huong, body: { comment: 'Use the company licence.' } })).data;
check('finance rejects with a reason', rj.status === 'rejected' && rj.steps[1].state === 'rejected' && rj.steps[1].people[0].comment === 'Use the company licence.');
await sleep(300);
check('… and the submitter hears it', (await inbox(ken)).some((n) => n.kind === 'approval.result' && n.title === 'Your expense reimbursement was rejected'));
check('nothing more to do on a finished request', (await call('POST', `/approvals/requests/${E.id}/approve`, { user: huong, body: {} })).status === 409);

// ── "and" steps, "or" steps, picked approvers, the submitter's own step ─────
const P = (await call('POST', '/approvals/requests', { user: ken, body: { templateId: purchase.id, values: { item: 'Label printer', qty: 2, cost: 300000, reason: 'Two branches need one.' } } })).data;
await call('POST', `/approvals/requests/${P.id}/approve`, { user: mika, body: {} });
const pAnd = (await call('POST', `/approvals/requests/${P.id}/approve`, { user: claudia, body: {} })).data;
check('"and": one of two approvals is not enough', pAnd.status === 'pending' && pAnd.waitingOn.map((u) => u.id).join() === huong, pAnd.waitingOn);
check('"and": the second completes it', (await call('POST', `/approvals/requests/${P.id}/approve`, { user: huong, body: {} })).data.status === 'approved');
check('picked approvers are required', (await call('POST', '/approvals/requests', { user: ken, body: { templateId: general.id, values: { subject: 'Desk move', details: 'To the window side.' } } })).status === 400);
const G = (await call('POST', '/approvals/requests', { user: ken, body: { templateId: general.id, values: { subject: 'Desk move', details: 'To the window side.' }, picks: { s1: [hana, mika] } } })).data;
check('picked approvers are asked together', G.steps[0].people.length === 2 && G.steps[0].people.every((p) => p.status === 'pending'));
const gDone = (await call('POST', `/approvals/requests/${G.id}/approve`, { user: hana, body: {} })).data;
check('"or": the first approval decides; the others are skipped', gDone.status === 'approved' && gDone.steps[0].people.find((p) => p.user.id === mika).status === 'skipped');
const own = (await call('POST', '/approvals/requests', { user: claudia, body: { templateId: purchase.id, values: { item: 'Projector', qty: 1, cost: 220000, reason: 'Meeting room B.' } } })).data;
check('no manager on file: that step is skipped', own.steps[0].state === 'skipped' && own.steps[0].note === 'No manager on file', own.steps[0]);
check('the submitter\'s own part is approved automatically', own.steps[1].people.find((p) => p.user.id === claudia).auto === true && own.waitingOn.map((u) => u.id).join() === huong, own.steps[1]);

// ── Withdraw, remind, comment ───────────────────────────────────────────────
const W = (await call('POST', '/approvals/requests', { user: yuki, body: { templateId: trip.id, values: { destination: 'Hanoi', dates: { start: ymd(30), end: ymd(32) }, purpose: 'Supplier fair', budget: 150000 } } })).data;
check('a big trip budget adds the second-level manager', W.steps[0].people[0].user.id === mika && W.steps[1].state === 'upcoming' && W.steps[1].people[0].user.id === claudia, W.steps);
check('only the submitter withdraws', (await call('POST', `/approvals/requests/${W.id}/withdraw`, { user: mika })).status === 403);
check('withdrawing', (await call('POST', `/approvals/requests/${W.id}/withdraw`, { user: yuki })).data.status === 'withdrawn');
check('… it no longer waits on anyone', !(await box(mika, 'pending')).some((r) => r.id === W.id));
const R = (await call('POST', '/approvals/requests', { user: yuki, body: { templateId: expense.id, values: { type: 'Meals', amount: 4200, date: ymd(-1), description: 'Team lunch' } } })).data;
check('reminding the approvers', (await call('POST', `/approvals/requests/${R.id}/remind`, { user: yuki })).data?.reminded === 1);
await sleep(300);
check('… they get a bell', (await inbox(mika)).some((n) => n.title === 'Yuki Sato reminded you to review: Expense reimbursement'));
check('… not again right away', (await call('POST', `/approvals/requests/${R.id}/remind`, { user: yuki })).status === 429);
check('only the submitter reminds', (await call('POST', `/approvals/requests/${R.id}/remind`, { user: mika })).status === 403);
const c = (await call('POST', `/approvals/requests/${R.id}/comments`, { user: mika, body: { body: 'Which team?' } })).data;
check('commenting', c.events.at(-1).kind === 'comment' && c.events.at(-1).body === 'Which team?');
await sleep(300);
check('… the submitter is told', (await inbox(yuki)).some((n) => n.kind === 'approval.comment'));
check('people who cannot see it cannot comment', (await call('POST', `/approvals/requests/${R.id}/comments`, { user: ken, body: { body: 'x' } })).status === 404);

// ── Boxes ───────────────────────────────────────────────────────────────────
check('Submitted lists my requests', (await box(yuki, 'submitted')).every((r) => r.submitter.id === yuki) && (await box(yuki, 'submitted')).some((r) => r.id === L.id));
check('Processed lists what I decided', (await box(mika, 'processed')).some((r) => r.id === L.id));
const rinaAll = await box(rina, 'all');
check('a template admin sees all of their template\'s requests', rinaAll.length > 0 && rinaAll.every((r) => r.template.id === leave.id));
check('… people managing nothing see none', (await box(ken, 'all')).length === 0);
check('filters: template and status', (await box(claudia, 'all', `&template=${expense.id}&status=rejected`)).every((r) => r.template.id === expense.id && r.status === 'rejected'));
check('search', (await box(claudia, 'all', '&q=barcode')).some((r) => r.summary.some((s) => s.value.includes('Barcode'))));

// ── Designing templates ─────────────────────────────────────────────────────
const def = { name: 'Equipment loan', category: 'Operations', fields: [{ id: 'item', type: 'text', label: 'Item', required: true }, { id: 'until', type: 'date', label: 'Return by', required: true }], steps: [{ id: 's1', name: 'Manager', type: 'approve', approvers: { kind: 'manager', level: 1 }, mode: 'or', condition: null }] };
check('only workspace admins create templates', (await call('POST', '/approvals/templates', { user: hana, body: def })).status === 403);
check('a person step must point at a person field', (await call('POST', '/approvals/templates', { user: claudia, body: { ...def, steps: [{ id: 's1', name: 'X', type: 'approve', approvers: { kind: 'field', fieldId: 'item' }, mode: 'or', condition: null }] } })).status === 400);
check('a process needs an approval step', (await call('POST', '/approvals/templates', { user: claudia, body: { ...def, steps: [{ id: 's1', name: 'CC', type: 'cc', approvers: { kind: 'users', userIds: [rina] }, mode: 'or', condition: null }] } })).status === 400);
const made = await call('POST', '/approvals/templates', { user: claudia, body: def });
check('creating a template', made.status === 201 && made.data.enabled && made.data.fields.length === 2);
check('template admins edit theirs', (await call('PATCH', `/approvals/templates/${leave.id}`, { user: rina, body: { description: 'Leave of any kind.' } })).data?.description === 'Leave of any kind.');
check('… not others\'', (await call('PATCH', `/approvals/templates/${expense.id}`, { user: rina, body: { description: 'x' } })).status === 403);
await call('PATCH', `/approvals/templates/${made.data.id}`, { user: claudia, body: { enabled: false } });
check('turned-off templates are hidden from submitters', !(await call('GET', '/approvals/templates', { user: yuki })).data.some((t) => t.id === made.data.id));
check('… and cannot be submitted', (await call('POST', '/approvals/requests', { user: yuki, body: { templateId: made.data.id, values: { item: 'Camera', until: ymd(5) } } })).status === 400);
check('a template with requests cannot be deleted', (await call('DELETE', `/approvals/templates/${leave.id}`, { user: claudia })).status === 409);
check('an unused one can', (await call('DELETE', `/approvals/templates/${made.data.id}`, { user: claudia })).status === 204);

console.log(failures ? `\n${failures} failed` : '\nall approvals checks passed');
process.exit(failures ? 1 : 0);
