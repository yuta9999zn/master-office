// Phase 8 integration test: forms — definition over collab, responses (validation, branching, quiz, limits,
// editing, uploads), linked spreadsheet, CSV, permissions, copy, search.   node apps/api/test/forms.mjs
import { HocuspocusProvider } from '@hocuspocus/provider';
import * as Y from 'yjs';

const API = process.env.API_URL ?? 'http://localhost:4000';
let failures = 0;
const check = (name, cond, extra) => {
  console.log(`${cond ? '✓' : '✗'} ${name}${cond ? '' : ' ' + JSON.stringify(extra ?? '')}`);
  if (!cond) failures++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(method, path, { user, body, raw, form } = {}) {
  const headers = {};
  if (user) headers['x-user-id'] = user;
  if (body) headers['content-type'] = 'application/json';
  const res = await fetch(API + path, { method, headers, body: form ?? (body ? JSON.stringify(body) : undefined) });
  if (raw) return res;
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null };
}

const users = (await call('GET', '/users')).data;
const uid = (key) => users.find((u) => u.email === `${key}@hanami.example`).id;
const [claudia, mika, sora, ken] = ['claudia', 'mika', 'sora', 'ken'].map(uid);
const find = async (q, user = claudia) => (await call('GET', '/search?q=' + encodeURIComponent(q), { user })).data.find((h) => h.kind === 'resource');

function connect(id, user) {
  return new Promise(async (resolve, reject) => {
    const { data: t, status } = await call('GET', `/resources/${id}/collab-token`, { user });
    if (status !== 200) return reject(new Error('token ' + status));
    const doc = new Y.Doc();
    const provider = new HocuspocusProvider({ url: t.url, name: t.document, token: t.token, document: doc, onSynced: () => resolve({ doc, provider }) });
    setTimeout(() => reject(new Error('sync timeout')), 10000);
  });
}
const itemsOf = (doc) => {
  const seen = new Set();
  return doc
    .getArray('itemOrder')
    .toArray()
    .filter((id) => doc.getMap('items').has(id) && !seen.has(id) && seen.add(id))
    .map((id) => ({ id, ...doc.getMap('items').get(id).toJSON() }));
};
const settingsOf = (doc) => doc.getMap('form').get('settings');
const setSettings = (doc, patch) => doc.getMap('form').set('settings', { ...settingsOf(doc), ...patch });

// ── Seeded survey ───────────────────────────────────────────────────────────
const survey = await find('Customer Satisfaction Survey');
check('survey is searchable by its title', !!survey);
const a = await connect(survey.id, mika);
const items = itemsOf(a.doc);
const byTitle = (t) => items.find((i) => i.title.startsWith(t));
const [visit, services, rating, recommend, grid, back, what, phone] = ['Which branch', 'Which services', 'How would you rate', 'How likely', 'Rate each part', 'Would you come back', 'What should we improve', 'Phone number'].map(byTitle);
check('seeded form syncs with sections and branching', items.length === 9 && items.some((i) => i.type === 'section') && back.branching === true, items.map((i) => i.type));
check('questions are searchable', (await find('recommend us to a friend'))?.id === survey.id);

const pub = await call('GET', `/forms/${survey.id}/public`, { user: ken });
check('public view returns the form for respondents', pub.status === 200 && pub.data.form.items.length === 9 && pub.data.closed === null);

const base = { [visit.id]: 'Branch 625', [services.id]: ['Facial'], [rating.id]: 4, [recommend.id]: 8 };
let r = await call('POST', `/forms/${survey.id}/responses`, { user: ken, body: { answers: { ...base } } });
check('missing required answer is rejected with per-question errors', r.status === 400 && r.data.errors?.[back.id] === 'This is a required question', r.data);

r = await call('POST', `/forms/${survey.id}/responses`, { user: ken, body: { answers: { ...base, [back.id]: 'Yes', [what.id]: 'skipped page', [grid.id]: { Booking: 'Good' } } } });
check('branching "Yes → submit" accepts the response', r.status === 201 && typeof r.data.id === 'string', r.data);
const list1 = (await call('GET', `/forms/${survey.id}/responses`, { user: mika })).data;
const mine = list1.find((x) => x.id === r.data.id);
check('answers on pages that were skipped are not stored', mine && mine.answers[what.id] === undefined && mine.answers[grid.id]?.Booking === 'Good', mine?.answers);

r = await call('POST', `/forms/${survey.id}/responses`, { user: ken, body: { answers: { ...base, [back.id]: 'No' } } });
check('branching "No → Help us do better" requires that section', r.status === 400 && !!r.data.errors?.[what.id], r.data);
r = await call('POST', `/forms/${survey.id}/responses`, { user: ken, body: { answers: { ...base, [back.id]: 'No', [what.id]: 'abc', [phone.id]: 'call me' } } });
check('response validation: length and regex with custom messages', r.status === 400 && r.data.errors[what.id] === 'Please write at least a few words' && r.data.errors[phone.id] === 'Enter a phone number', r.data);
r = await call('POST', `/forms/${survey.id}/responses`, { user: ken, body: { answers: { ...base, [back.id]: 'No', [what.id]: 'More evening slots please', [phone.id]: '+81 90-1234-5678' } } });
check('a valid branched response is accepted', r.status === 201);
r = await call('POST', `/forms/${survey.id}/responses`, { user: ken, body: { answers: { ...base, [visit.id]: 'Branch 999', [back.id]: 'Yes' } } });
check('answers outside the options are rejected', r.status === 400 && !!r.data.errors[visit.id]);
r = await call('POST', `/forms/${survey.id}/responses`, { user: ken, body: { answers: { ...base, [visit.id]: { other: 'Pop-up store' }, [back.id]: 'Yes' } } });
check('"Other" answers are accepted', r.status === 201);

const sum = await call('GET', `/forms/${survey.id}/public/summary`, { user: ken });
check('public summary (when enabled) has counts only', sum.status === 200 && sum.data.total === 8 && sum.data.counts[visit.id]['Branch 625'] >= 3 && !('answers' in sum.data), sum.data);

const csv = Buffer.from(await (await call('GET', `/forms/${survey.id}/responses.csv`, { user: mika, raw: true })).arrayBuffer()).toString('utf8');
check('CSV export: BOM, header with grid rows, one line per response', csv.charCodeAt(0) === 0xfeff && csv.includes('Timestamp,Which branch did you visit?') && csv.includes('Rate each part of your visit [Booking]') && csv.trim().split('\r\n').length === 9, csv.slice(0, 200));
check('respondents who are not editors cannot read responses', (await call('GET', `/forms/${survey.id}/responses`, { user: sora })).status === 403);

// ── Linked spreadsheet ──────────────────────────────────────────────────────
const sheet = (await call('POST', `/forms/${survey.id}/sheet`, { user: mika })).data;
check('"Link to Sheets" creates the response spreadsheet', sheet?.type === 'spreadsheet' && sheet.name === 'Customer Satisfaction Survey (Responses)', sheet);
await sleep(500);
check('the form remembers the linked sheet', settingsOf(a.doc).sheetId === sheet.id);
const sh = await connect(sheet.id, mika);
const cellsOf = (doc) => {
  const sid = doc.getMap('wb').get('sheetOrder')[0];
  const m = doc.getMap('sheets').get(sid);
  const rows = m.get('rows').toArray();
  const cols = m.get('cols').toArray();
  return (r, c) => m.get('cells').get(`${rows[r]}:${cols[c]}`)?.v;
};
let cell = cellsOf(sh.doc);
check('sheet has the header and every response', cell(0, 0) === 'Timestamp' && cell(0, 1) === 'Which branch did you visit?' && cell(8, 1) && !cell(9, 1), [cell(0, 0), cell(8, 1), cell(9, 1)]);
r = await call('POST', `/forms/${survey.id}/responses`, { user: ken, body: { answers: { ...base, [visit.id]: 'Branch S2', [back.id]: 'Yes' } } });
await sleep(700);
cell = cellsOf(sh.doc);
check('a new response is appended to the linked sheet live', r.status === 201 && cell(9, 1) === 'Branch S2', cell(9, 1));
sh.provider.destroy();

// ── New form: quiz, limits, editing, uploads, closing ──────────────────────
const created = (await call('POST', '/resources', { user: claudia, body: { name: 'Product quiz', type: 'form' } })).data;
const q = await connect(created.id, claudia);
check('a new form is initialised by the server', itemsOf(q.doc).length === 1 && settingsOf(q.doc)?.accepting === true);
const add = (doc, item) =>
  doc.transact(() => {
    const m = new Y.Map();
    for (const [k, v] of Object.entries(item)) if (k !== 'id') m.set(k, v);
    doc.getMap('items').set(item.id, m);
    doc.getArray('itemOrder').push([item.id]);
  });
const q1 = itemsOf(q.doc)[0];
q.doc.transact(() => {
  const m = q.doc.getMap('items').get(q1.id);
  m.set('title', 'Which serum is fragrance-free?');
  m.set('options', [{ id: 'o1', label: 'Rose' }, { id: 'o2', label: 'Pure' }]);
  m.set('quiz', { points: 2, answers: ['Pure'], feedbackCorrect: 'Yes!' });
  m.set('required', true);
});
add(q.doc, { id: 'q2', type: 'short', title: 'Name our moisturiser', quiz: { points: 3, answers: ['Hydra Bloom', 'HydraBloom'] } });
add(q.doc, { id: 'q3', type: 'file', title: 'Upload your receipt', file: { maxFiles: 2, maxSizeMb: 1 } });
setSettings(q.doc, { quiz: true, limitOne: true, allowEdit: true });
await sleep(2600);
const pq = (await call('GET', `/forms/${created.id}/public`, { user: ken })).data;
check('answer keys are not sent to respondents', pq.form.items[0].quiz?.answers === undefined && pq.form.items[0].quiz?.points === 2, pq.form.items[0].quiz);

const fd = new FormData();
fd.append('file', new Blob([Buffer.from('receipt content')], { type: 'text/plain' }), 'receipt.txt');
const up = await call('POST', `/forms/${created.id}/uploads`, { user: ken, form: fd });
check('respondents can upload files', up.status === 201 && up.data.name === 'receipt.txt' && up.data.size === 15, up.data);
const big = new FormData();
big.append('file', new Blob([Buffer.alloc(11 * 1024 * 1024)]), 'big.bin');
check('uploads above the size limit are refused', (await call('POST', `/forms/${created.id}/uploads`, { user: ken, form: big })).status === 400);

r = await call('POST', `/forms/${created.id}/responses`, { user: ken, body: { answers: { [q1.id]: 'Pure', q2: '  hydra bloom ', q3: [up.data] } } });
check('quiz is scored on submit (case-insensitive text answers)', r.status === 201 && r.data.score?.points === 5 && r.data.score?.max === 5 && !!r.data.editToken, r.data);
const token = r.data.editToken;
check('"limit to 1 response" refuses a second submission', (await call('POST', `/forms/${created.id}/responses`, { user: ken, body: { answers: { [q1.id]: 'Rose' } } })).status === 409);
const again = (await call('GET', `/forms/${created.id}/public`, { user: ken })).data;
check('the form tells a respondent they already answered', again.alreadyResponded === true);
const edit = (await call('GET', `/forms/${created.id}/public?edit=${token}`, { user: ken })).data;
check('the edit link loads the earlier answers', edit.existing?.answers?.[q1.id] === 'Pure');
r = await call('POST', `/forms/${created.id}/responses`, { user: ken, body: { answers: { [q1.id]: 'Rose', q2: 'x' }, editToken: token } });
check('editing a response re-scores it', r.status === 201 && r.data.score?.points === 0);
const own = (await call('GET', `/forms/${created.id}/responses`, { user: claudia })).data;
check('only one response exists after editing', own.length === 1 && own[0].answers[q1.id] === 'Rose' && own[0].email === 'ken@hanami.example', own);
const fileAsset = await call('GET', `/resources/${created.id}/assets/${up.data.blobId}`, { user: claudia, raw: true });
check('form editors can download uploaded files', fileAsset.status === 200);

setSettings(q.doc, { accepting: false, closedMessage: 'Quiz closed' });
await sleep(800);
const closed = await call('POST', `/forms/${created.id}/responses`, { user: mika, body: { answers: { [q1.id]: 'Pure' } } });
check('a closed form refuses responses with its message', closed.status === 403 && closed.data.message === 'Quiz closed', closed.data);
check('the public view shows the closed message', (await call('GET', `/forms/${created.id}/public`, { user: mika })).data.closed === 'Quiz closed');

// ── Access: workspace-only forms ────────────────────────────────────────────
setSettings(q.doc, { accepting: true, access: 'org', limitOne: false });
await sleep(800);
check('org forms accept people of the workspace', (await call('POST', `/forms/${created.id}/responses`, { user: sora, body: { answers: { [q1.id]: 'Pure' } } })).status === 201);

// ── Forms 8.1: import questions, e-mail notifications & copies, manual grading, release (§61–§63) ──────────
const def = await call('GET', `/forms/${created.id}/definition`, { user: claudia });
check('the definition (for importing) includes answer keys for people who can open the form', def.status === 200 && def.data.items.length === 3 && def.data.items[0].quiz?.answers?.[0] === 'Pure', def.data);
check('people who cannot open the form cannot read its definition', (await call('GET', `/forms/${created.id}/definition`, { user: ken })).status === 404);

const sub = await call('PUT', `/forms/${created.id}/notifications`, { user: claudia, body: { on: true } });
check('editors can turn on e-mail notifications for new responses', sub.status === 200 && sub.data.on === true && (await call('GET', `/forms/${created.id}/notifications`, { user: claudia })).data.on === true, sub.data);
check('non-editors cannot subscribe', (await call('PUT', `/forms/${created.id}/notifications`, { user: sora, body: { on: true } })).status >= 403);

add(q.doc, { id: 'q4', type: 'paragraph', title: 'Why is sunscreen important?', quiz: { points: 5 } });
setSettings(q.doc, { releaseScore: 'later', collectEmail: 'input', sendCopy: 'requested' });
await sleep(1500);
r = await call('POST', `/forms/${created.id}/responses`, { user: mika, body: { answers: { [q1.id]: 'Pure', q2: 'Hydra Bloom', q4: 'It prevents UV damage.' }, email: 'student@example.com', sendCopy: true } });
check('with "release later" the receipt has no score but a "view score" token', r.status === 201 && r.data.score === null && typeof r.data.resultToken === 'string', r.data);
const resultToken = r.data.resultToken;
const editTok = r.data.editToken;
const pending = (await call('GET', `/forms/${created.id}/public/result?token=${resultToken}`)).data;
check('"view score" before release says it is not released (no answers leak)', pending.released === false && pending.questions.length === 0 && pending.score === null, pending);
check('an unknown result token is refused', (await call('GET', `/forms/${created.id}/public/result?token=nope`)).status === 404);
await sleep(800);
let box = (await call('GET', `/forms/${created.id}/outbox`, { user: claudia })).data;
check('a new response e-mails the subscribed editor', box.some((m) => m.kind === 'form.response' && m.to === 'claudia@hanami.example' && m.subject.includes('Product quiz')), box);
check('the respondent who asked for it gets a copy of their answers', box.some((m) => m.kind === 'form.copy' && m.to === 'student@example.com'), box);
check('the outbox is only for editors', (await call('GET', `/forms/${created.id}/outbox`, { user: sora })).status >= 403);

let resp = (await call('GET', `/forms/${created.id}/responses`, { user: claudia })).data.find((x) => x.email === 'student@example.com');
check('an essay without an answer key scores 0 until graded', resp.score?.points === 5 && resp.score?.max === 10 && resp.releasedAt === null, resp);
let g = await call('PATCH', `/forms/${created.id}/responses/${resp.id}/grades`, { user: claudia, body: { grades: { q4: { points: 4, feedback: 'Good point about UV.' } } } });
check('manual grading sets points and feedback and re-scores', g.status === 200 && g.data.score.points === 9 && g.data.grades.q4.feedback === 'Good point about UV.', g.data);
g = await call('PATCH', `/forms/${created.id}/responses/${resp.id}/grades`, { user: claudia, body: { grades: { q2: { points: 1 } } } });
check('graders can override an automatically marked answer', g.status === 200 && g.data.score.points === 7, g.data);
g = await call('PATCH', `/forms/${created.id}/responses/${resp.id}/grades`, { user: claudia, body: { grades: { q2: { points: null } } } });
check('clearing the points goes back to the answer key', g.status === 200 && g.data.score.points === 9 && !('q2' in g.data.grades), g.data);
check('points above the maximum are refused', (await call('PATCH', `/forms/${created.id}/responses/${resp.id}/grades`, { user: claudia, body: { grades: { q4: { points: 6 } } } })).status === 400);
check('questions without points cannot be graded', (await call('PATCH', `/forms/${created.id}/responses/${resp.id}/grades`, { user: claudia, body: { grades: { q3: { points: 1 } } } })).status === 400);
check('respondents cannot grade', (await call('PATCH', `/forms/${created.id}/responses/${resp.id}/grades`, { user: sora, body: { grades: { q4: { points: 5 } } } })).status >= 403);

const rel = await call('POST', `/forms/${created.id}/release`, { user: claudia, body: { ids: 'all' } });
// Every response so far has an address (ken and sora signed in, the student typed one), so each gets an e-mail.
check('releasing scores marks responses released and e-mails respondents with an address', rel.status === 201 && rel.data.released === 3 && rel.data.mailed === 3, rel.data);
check('releasing again does nothing', (await call('POST', `/forms/${created.id}/release`, { user: claudia, body: { ids: 'all' } })).data.released === 0);
await sleep(500);
box = (await call('GET', `/forms/${created.id}/outbox`, { user: claudia })).data;
check('the score e-mail is recorded', box.some((m) => m.kind === 'form.score' && m.to === 'student@example.com' && m.subject.startsWith('Your score')), box);
const res = (await call('GET', `/forms/${created.id}/public/result?token=${resultToken}`)).data;
const rq4 = res.questions?.find((x) => x.id === 'q4');
const rq1 = res.questions?.find((x) => x.id === q1.id);
check('after release "view score" shows points, feedback and correct answers', res.released === true && res.score.points === 9 && rq4?.points === 4 && rq4.feedback === 'Good point about UV.' && rq1?.correct === true && rq1.correctAnswers?.[0] === 'Pure', res);
check('the released result never includes answer keys in the form', res.form.items.every((i) => !i.quiz?.answers), res.form.items.map((i) => i.quiz));

r = await call('POST', `/forms/${created.id}/responses`, { user: mika, body: { answers: { [q1.id]: 'Rose', q2: 'Hydra Bloom', q4: 'It prevents UV damage.' }, email: 'student@example.com', editToken: editTok } });
check('editing a graded response keeps grades of unchanged answers', r.status === 201 && r.data.score?.points === 7, r.data);

await call('PUT', `/forms/${created.id}/notifications`, { user: claudia, body: { on: false } });
const before = (await call('GET', `/forms/${created.id}/outbox`, { user: claudia })).data.filter((m) => m.kind === 'form.response').length;
await call('POST', `/forms/${created.id}/responses`, { user: sora, body: { answers: { [q1.id]: 'Pure' }, email: 'sora@hanami.example' } });
await sleep(800);
const after = (await call('GET', `/forms/${created.id}/outbox`, { user: claudia })).data;
check('after turning notifications off no more response e-mails are sent', after.filter((m) => m.kind === 'form.response').length === before && !after.some((m) => m.kind === 'form.copy' && m.to === 'sora@hanami.example'), after);

// ── Delete, copy, versions ──────────────────────────────────────────────────
const del = await call('POST', `/forms/${created.id}/responses/delete`, { user: claudia, body: { ids: 'all' } });
check('editors can delete responses', del.status === 204 && (await call('GET', `/forms/${created.id}/responses`, { user: claudia })).data.length === 0);
const copy = (await call('POST', `/resources/${survey.id}/copy`, { user: mika, body: {} })).data;
const c = await connect(copy.id, mika);
check('a copy has the questions but no responses and no linked sheet', itemsOf(c.doc).length === 9 && settingsOf(c.doc).sheetId === null && (await call('GET', `/forms/${copy.id}/responses`, { user: mika })).data.length === 0);
c.provider.destroy();
check('forms have no file export (clear message)', (await call('GET', `/resources/${survey.id}/export?format=pdf`, { user: mika })).status === 400);

const v1 = (await call('POST', `/resources/${created.id}/versions`, { user: claudia, body: { label: 'Before edit' } })).data;
q.doc.getMap('form').set('title', 'Renamed quiz');
await sleep(800);
const vc = (await call('GET', `/resources/${created.id}/versions/${v1.id}/content`, { user: claudia })).data;
check('version preview returns the form', vc.form?.items?.length === 4);
await call('POST', `/resources/${created.id}/versions/${v1.id}/restore`, { user: claudia });
await sleep(800);
check('restore brings back the earlier form for connected editors', q.doc.getMap('form').get('title') !== 'Renamed quiz' && itemsOf(q.doc).length === 4);

q.provider.destroy();
a.provider.destroy();
console.log(failures ? `\n${failures} check(s) failed` : '\nall forms checks passed');
process.exit(failures ? 1 : 0);
