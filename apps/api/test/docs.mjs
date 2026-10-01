// Phase 2 integration test: realtime collaboration, permissions, persistence, comments, versions, export/import.
// Requires the API (with collab on :4001) running and seeded data.   node apps/api/test/docs.mjs
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
const uid = (key) => users.find((u) => u.email === `${key}@kaori.jp`).id;
const [claudia, mika, sora, hana] = ['claudia', 'mika', 'sora', 'hana'].map(uid);
const docId = (await call('GET', '/search?q=' + encodeURIComponent('Branch Operation Plan - October'))).data.find((h) => h.kind === 'resource').id;

function connect(user) {
  return new Promise(async (resolve, reject) => {
    const { data: t, status } = await call('GET', `/resources/${docId}/collab-token`, { user });
    if (status !== 200) return reject(new Error('token ' + status));
    const doc = new Y.Doc();
    const provider = new HocuspocusProvider({ url: t.url, name: t.document, token: t.token, document: doc, onSynced: () => resolve({ doc, provider, role: t.role }) });
    setTimeout(() => reject(new Error('sync timeout')), 10000);
  });
}
const text = (doc) => doc.getXmlFragment('default').toString();
const appendParagraph = (doc, s) => {
  const p = new Y.XmlElement('paragraph');
  p.insert(0, [new Y.XmlText(s)]);
  doc.getXmlFragment('default').push([p]);
};

// ── Realtime & permissions ──────────────────────────────────────────────────
const a = await connect(claudia);
check('editor gets token and syncs seeded content', text(a.doc).includes('Key Goals') && a.role === 'owner');
const b = await connect(mika);
check('second editor syncs', text(b.doc).includes('Key Goals'));

const marker = `Realtime edit ${Date.now()}`;
appendParagraph(a.doc, marker);
await sleep(800);
check('edit propagates to other client', text(b.doc).includes(marker));

const viewer = await connect(sora);
check('viewer connects', viewer.role === 'viewer' && text(viewer.doc).includes(marker));
const forbidden = `viewer edit ${Date.now()}`;
appendParagraph(viewer.doc, forbidden);
await sleep(800);
check('read-only connection cannot change the shared doc', !text(a.doc).includes(forbidden));

const privateDoc = (await call('GET', '/search?q=' + encodeURIComponent('HR Manual'))).data.find((h) => h.kind === 'resource').id;
check('no token for a doc in a private space', (await call('GET', `/resources/${privateDoc}/collab-token`, { user: hana })).status === 404);

// ── Persistence (debounced store) ───────────────────────────────────────────
await sleep(3000);
const txt = await (await call('GET', `/resources/${docId}/export?format=txt`, { raw: true })).text();
check('export reflects realtime edit', txt.includes(marker));
check('search finds document content', (await call('GET', '/search?q=' + encodeURIComponent(marker))).data.some((h) => h.id === docId));
const act = (await call('GET', `/resources/${docId}/activity`)).data;
check('edit recorded in activity', act.some((e) => e.action === 'resource.content_changed'));
for (const c of [a, b, viewer]) c.provider.destroy();

// ── Comments ────────────────────────────────────────────────────────────────
const c1 = await call('POST', `/resources/${docId}/comments`, { user: sora, body: { body: '@Mika Please confirm this target.', quote: '2,000,000', anchor: { from: { x: 1 }, to: { x: 2 } } } });
check('viewer cannot comment', c1.status === 403);
const c2 = await call('POST', `/resources/${docId}/comments`, { user: mika, body: { body: 'Is 2,000,000 realistic?', quote: '2,000,000', anchor: { from: { a: 1 }, to: { a: 2 } } } });
check('editor comments', c2.status === 201);
await call('POST', `/resources/${docId}/comments`, { user: claudia, body: { body: 'Yes, with the campaign.', threadId: c2.data.id } });
let threads = (await call('GET', `/resources/${docId}/comments`, { user: sora })).data;
const th = threads.find((t) => t.id === c2.data.id);
check('viewer reads threads with replies', th?.replies.length === 1 && th.quote === '2,000,000');
check('only author edits', (await call('PATCH', `/comments/${c2.data.id}`, { user: claudia, body: { body: 'hijack' } })).status === 403);
await call('PATCH', `/comments/${c2.data.id}`, { user: claudia, body: { resolved: true } });
threads = (await call('GET', `/resources/${docId}/comments`)).data;
check('resolve thread', !!threads.find((t) => t.id === c2.data.id)?.resolvedAt);
await call('DELETE', `/comments/${c2.data.id}`, { user: mika });

// ── Versions ────────────────────────────────────────────────────────────────
const v = await call('POST', `/resources/${docId}/versions`, { body: { label: 'Before cleanup' } });
check('named version saved', v.status === 201);
const vc = await call('GET', `/resources/${docId}/versions/${v.data.id}/content`);
check('version content readable', JSON.stringify(vc.data.content).includes(marker));
const editor = await connect(claudia);
const fragment = editor.doc.getXmlFragment('default');
fragment.delete(0, fragment.length);
appendParagraph(editor.doc, 'Everything replaced');
await sleep(500);
const restore = await call('POST', `/resources/${docId}/versions/${v.data.id}/restore`);
await sleep(800);
check('restore pushes old content to live editors', restore.status === 204 && text(editor.doc).includes(marker) && !text(editor.doc).includes('Everything replaced'));
const versions = (await call('GET', `/resources/${docId}/versions`)).data;
check('restore keeps a "Before restore" version', versions.some((x) => x.label === 'Before restore'));
editor.provider.destroy();

// ── Export / import ─────────────────────────────────────────────────────────
const docx = await call('GET', `/resources/${docId}/export?format=docx`, { raw: true });
const docxBuf = Buffer.from(await docx.arrayBuffer());
check('DOCX export is a zip', docx.status === 200 && docxBuf.subarray(0, 2).toString() === 'PK', docx.status);
check('DOCX file name', /Branch%20Operation%20Plan%20-%20October%202026\.docx/.test(docx.headers.get('content-disposition')));
const html = await (await call('GET', `/resources/${docId}/export?format=html`, { raw: true })).text();
check('HTML export has table + callout', html.includes('<table>') && html.includes('class="callout"'));
const pdf = await call('GET', `/resources/${docId}/export?format=pdf`, { raw: true });
const pdfBuf = Buffer.from(await pdf.arrayBuffer());
check('PDF export', pdf.status === 200 && pdfBuf.subarray(0, 4).toString() === '%PDF', pdf.status);

const fd = new FormData();
fd.append('file', new Blob([docxBuf]), 'Round trip.docx');
const up = await call('POST', '/resources/upload', { form: fd });
check('upload .docx creates a document', up.status === 201 && up.data.type === 'document', up);
check('import report recorded', up.data.metadata?.import?.status === 'done', up.data.metadata);
const back = await (await call('GET', `/resources/${up.data.id}/export?format=txt`, { raw: true })).text();
check('round trip keeps text, list and table content', back.includes('Key Goals') && back.includes('Maintain customer return rate') && back.includes('625 (Station)'));
const dl = await call('GET', `/resources/${up.data.id}/download`, { raw: true });
check('download of imported doc returns original file', Buffer.from(await dl.arrayBuffer()).length === docxBuf.length);

// ── Copy keeps content ──────────────────────────────────────────────────────
const copy = await call('POST', `/resources/${docId}/copy`, { body: {} });
const copyTxt = await (await call('GET', `/resources/${copy.data.id}/export?format=txt`, { raw: true })).text();
check('make a copy clones document content', copyTxt.includes('Key Goals'));

for (const id of [up.data.id, copy.data.id]) {
  await call('POST', `/resources/${id}/trash`);
  await call('DELETE', `/resources/${id}`);
}

console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
