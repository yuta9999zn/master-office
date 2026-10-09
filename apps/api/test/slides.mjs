// Phase 4 integration test: presentations on the collaborative store, PPTX/PDF/PNG/HTML export, PPTX import,
// versions, copy, search, linked chart data. Requires the API (collab on :4001) running and seeded data.
//   node apps/api/test/slides.mjs
import { HocuspocusProvider } from '@hocuspocus/provider';
import JSZip from 'jszip';
import PptxGenJS from 'pptxgenjs';
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
const [claudia, mika, sora] = ['claudia', 'mika', 'sora'].map(uid);
const find = async (q) => (await call('GET', '/search?q=' + encodeURIComponent(q), { user: claudia })).data.find((h) => h.kind === 'resource');
const deckId = (await find('Q4 Marketing Strategy - October 2026')).id;
const salesId = (await find('Sales Report - September 2026')).id;

function connect(id, user) {
  return new Promise(async (resolve, reject) => {
    const { data: t, status } = await call('GET', `/resources/${id}/collab-token`, { user });
    if (status !== 200) return reject(new Error('token ' + status));
    const doc = new Y.Doc();
    const provider = new HocuspocusProvider({ url: t.url, name: t.document, token: t.token, document: doc, onSynced: () => resolve({ doc, provider, role: t.role }) });
    setTimeout(() => reject(new Error('sync timeout')), 10000);
  });
}

/** Minimal reader for the Yjs layout of packages/slide-model. */
const order = (doc) => {
  const seen = new Set();
  return doc
    .getArray('slideOrder')
    .toArray()
    .filter((id) => doc.getMap('slides').has(id) && !seen.has(id) && seen.add(id));
};
const slideAt = (doc, i) => doc.getMap('slides').get(order(doc)[i]);
const fragText = (frag) => {
  const walk = (n) => (n instanceof Y.XmlText ? n.toDelta().map((d) => d.insert).join('') : n.toArray().map(walk).join(n.nodeName === 'paragraph' ? '' : '\n'));
  return frag.toArray().map(walk).join('\n');
};
const elementsOf = (slide) =>
  [...slide.get('elements').entries()].map(([id, m]) => ({ id, m, type: m.get('type'), text: m.get('text') instanceof Y.XmlFragment ? fragText(m.get('text')) : '' }));
const zipOf = async (res) => JSZip.loadAsync(Buffer.from(await res.arrayBuffer()));

// ── Seeded deck over collab ──────────────────────────────────────────────────
const a = await connect(deckId, claudia);
check('seeded deck syncs with six slides', order(a.doc).length === 6, order(a.doc).length);
check('deck keeps size and theme', a.doc.getMap('deck').get('size')?.w === 1280 && a.doc.getMap('deck').get('theme')?.id === 'sakura-beauty');
const s1 = elementsOf(slideAt(a.doc, 0));
check('title slide has its title, chart and shapes', s1.some((e) => e.text.includes('Q4 Campaign')) && s1.some((e) => e.type === 'chart') && s1.filter((e) => e.type === 'shape').length > 10);
check('speaker notes are stored per slide', slideAt(a.doc, 0).get('notes').toString().includes('biggest quarter'));

const b = await connect(deckId, mika);
check('second editor connects with edit rights', b.role === 'editor' || b.role === 'admin' || b.role === 'owner', b.role);
const newId = 'el-' + Date.now();
a.doc.transact(() => {
  const m = new Y.Map();
  m.set('type', 'shape');
  m.set('geom', 'star5');
  for (const [k, v] of Object.entries({ x: 100, y: 100, w: 80, h: 80, z: 999 })) m.set(k, v);
  m.set('style', { fill: '#FF0000' });
  m.set('text', new Y.XmlFragment());
  slideAt(a.doc, 1).get('elements').set(newId, m);
});
await sleep(800);
const bEl = slideAt(b.doc, 1).get('elements').get(newId);
check('new object propagates to another editor', bEl?.get('geom') === 'star5');

// Concurrent edits of different properties of the same object both survive.
slideAt(a.doc, 1).get('elements').get(newId).set('x', 400);
bEl.set('style', { fill: '#00AA00' });
await sleep(900);
const merged = slideAt(a.doc, 1).get('elements').get(newId);
check('concurrent move + recolour of one object both apply', merged.get('x') === 400 && merged.get('style').fill === '#00AA00', [merged.get('x'), merged.get('style')]);

// Concurrent slide insertions keep both slides.
const addSlide = (doc, id, at) =>
  doc.transact(() => {
    const m = new Y.Map();
    m.set('meta', { layout: 'blank' });
    m.set('notes', new Y.Text());
    m.set('elements', new Y.Map());
    doc.getMap('slides').set(id, m);
    doc.getArray('slideOrder').insert(at, [id]);
  });
addSlide(a.doc, 'sa-' + Date.now(), 2);
addSlide(b.doc, 'sb-' + Date.now(), 2);
await sleep(900);
check('slides inserted concurrently by two people are both kept', order(a.doc).length === 8 && order(b.doc).length === 8, [order(a.doc).length, order(b.doc).length]);
a.doc.transact(() => {
  const ids = order(a.doc).slice(2, 4);
  const arr = a.doc.getArray('slideOrder');
  for (let i = arr.length - 1; i >= 0; i--) if (ids.includes(arr.get(i))) arr.delete(i, 1);
  ids.forEach((id) => a.doc.getMap('slides').delete(id));
});

const viewer = await connect(deckId, sora).catch((e) => ({ error: e.message }));
if (viewer.doc) {
  slideAt(viewer.doc, 0).get('elements').forEach((m) => m.set('x', 0));
  await sleep(800);
  check('viewer edits are not accepted', [...slideAt(a.doc, 0).get('elements').values()].some((m) => m.get('x') !== 0));
  viewer.provider.destroy();
} else check('viewer can open read-only', false, viewer);

await sleep(2600); // let the debounced store flush

// ── Export ──────────────────────────────────────────────────────────────────
const pres = await call('GET', `/resources/${deckId}/export?format=pptx`, { user: claudia, raw: true });
check('pptx export responds', pres.status === 200 && pres.headers.get('content-type').includes('presentationml'), pres.status);
const pz = await zipOf(pres);
const slideFiles = Object.keys(pz.files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f));
check('pptx has one slide part per slide', slideFiles.length === 6, slideFiles.length);
const x1 = await pz.file('ppt/slides/slide1.xml').async('string');
check('pptx slides hold real text (not pictures)', x1.includes('Q4 Campaign') && x1.includes('<a:t>'));
check('pptx keeps native charts', Object.keys(pz.files).some((f) => /^ppt\/charts\/chart\d+\.xml$/.test(f)));
check('pptx keeps the table as a table', (await pz.file('ppt/slides/slide4.xml').async('string')).includes('<a:tbl>'));
check('pptx keeps speaker notes', Object.keys(pz.files).some((f) => f.startsWith('ppt/notesSlides/')));
const theme = await pz.file('ppt/theme/theme1.xml').async('string');
check('pptx carries the deck theme colours and fonts', theme.includes('Master Office: sakura-beauty') && theme.includes('F28B9B'));
check('pptx carries realtime edits', (await pz.file('ppt/slides/slide2.xml').async('string')).includes('prst="star5"'));

const pdf = await call('GET', `/resources/${deckId}/export?format=pdf`, { user: claudia, raw: true });
const pdfBuf = Buffer.from(await pdf.arrayBuffer());
check('pdf export renders one page per slide', pdf.status === 200 && pdfBuf.subarray(0, 4).toString() === '%PDF' && (pdfBuf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length === 6, pdf.status);
const png = await call('GET', `/resources/${deckId}/export?format=png&slide=1`, { user: claudia, raw: true });
const pngBuf = Buffer.from(await png.arrayBuffer());
check('png export of one slide (2× resolution)', png.status === 200 && pngBuf.readUInt32BE(16) === 2560 && pngBuf.readUInt32BE(20) === 1440, [png.status, pngBuf.length > 24 && pngBuf.readUInt32BE(16)]);
const pngs = await zipOf(await call('GET', `/resources/${deckId}/export?format=png`, { user: claudia, raw: true }));
check('png export of all slides is a zip of images', Object.keys(pngs.files).filter((f) => f.endsWith('.png')).length === 6);
check('png export rejects a missing slide', (await call('GET', `/resources/${deckId}/export?format=png&slide=99`, { user: claudia })).status === 400);
const html = await (await call('GET', `/resources/${deckId}/export?format=html`, { user: claudia, raw: true })).text();
check('html export is the rendered deck', html.includes('Q4 Campaign') && html.includes('class="mo-slide"') && html.includes('<svg'));
check('xlsx is rejected for presentations', (await call('GET', `/resources/${deckId}/export?format=xlsx`, { user: claudia })).status === 400);
const dl = await call('GET', `/resources/${deckId}/download`, { user: claudia, raw: true });
check('download of a native presentation is pptx', dl.status === 200 && (dl.headers.get('content-disposition') ?? '').includes('.pptx'));

// ── Search ──────────────────────────────────────────────────────────────────
check('slide text is searchable', (await find('Channel Strategy'))?.id === deckId);
check('speaker notes are searchable', (await find('biggest quarter'))?.id === deckId);

// ── Linked chart data from Sheets ───────────────────────────────────────────
const range = await call('GET', `/resources/${salesId}/sheet-range?range=A1:C3`, { user: claudia });
check('sheet-range returns values of a spreadsheet range', range.status === 200 && range.data.values.length === 3 && range.data.values[0][1] === 'Branch', range.data);
check('sheet-range refuses non-spreadsheets', (await call('GET', `/resources/${deckId}/sheet-range?range=A1:B2`, { user: claudia })).status === 400);

// ── Create ──────────────────────────────────────────────────────────────────
const created = (await call('POST', '/resources', { user: claudia, body: { name: 'Test deck ' + Date.now(), type: 'presentation' } })).data;
const c = await connect(created.id, claudia);
check('new presentation is initialised by the server with a title slide', order(c.doc).length === 1 && elementsOf(slideAt(c.doc, 0)).some((e) => e.text.startsWith('Test deck')));
c.provider.destroy();

// ── Import .pptx ────────────────────────────────────────────────────────────
const PNG_1x1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const src = new PptxGenJS();
src.layout = 'LAYOUT_WIDE';
const p1 = src.addSlide();
p1.background = { color: 'FFF5F7' };
p1.addText('Imported title', { x: 0.5, y: 0.4, w: 9, h: 1, fontSize: 40, bold: true, color: '1D4ED8' });
p1.addText(
  [
    { text: 'First point', options: { bullet: true, breakLine: true } },
    { text: 'Second point', options: { bullet: true, italic: true } },
  ],
  { x: 0.5, y: 1.6, w: 6, h: 2, fontSize: 20 },
);
p1.addShape('ellipse', { x: 8, y: 2, w: 2, h: 2, fill: { color: 'F59E0B' }, line: { color: '111111', width: 2 }, rotate: 30 });
p1.addImage({ data: `image/png;base64,${PNG_1x1}`, x: 10.5, y: 0.5, w: 2, h: 2 });
p1.addNotes('Remember the launch date');
const p2 = src.addSlide();
p2.addTable(
  [
    [{ text: 'Channel' }, { text: 'Share' }],
    [{ text: 'TikTok' }, { text: '35%' }],
  ],
  { x: 0.5, y: 0.5, w: 6, h: 1.5 },
);
p2.addChart('bar', [{ name: 'Sales', labels: ['Q1', 'Q2', 'Q3'], values: [10, 20, 30] }], { x: 7, y: 0.5, w: 5, h: 4, barDir: 'col', showTitle: true, title: 'Quarterly' });
p2.hidden = true;
const srcBuf = await src.write({ outputType: 'nodebuffer' });
const fd = new FormData();
fd.append('file', new Blob([srcBuf]), 'Imported deck.pptx');
const up = await call('POST', '/resources/upload', { user: claudia, form: fd });
const imported = up.data;
check('pptx upload becomes a presentation with an import report', up.status === 201 && imported.type === 'presentation' && imported.metadata?.import?.status === 'done', up.data?.metadata);
const d = await connect(imported.id, claudia);
check('imported slides, size and hidden flag', order(d.doc).length === 2 && d.doc.getMap('deck').get('size').w === 1280 && slideAt(d.doc, 1).get('meta').hidden === true);
const i1 = elementsOf(slideAt(d.doc, 0));
check('imported text keeps content and bullets', i1.some((e) => e.text === 'Imported title') && i1.some((e) => e.text.includes('First point') && e.m.get('text').toArray()[0].nodeName === 'bulletList'), i1.map((e) => [e.type, e.text]));
const ell = i1.find((e) => e.m.get('geom') === 'ellipse');
check('imported shape keeps geometry, fill, border and rotation', ell && ell.m.get('style').fill === '#F59E0B' && ell.m.get('style').stroke === '#111111' && Math.round(ell.m.get('rot')) === 30, ell && [ell.m.get('style'), ell.m.get('rot')]);
const img = i1.find((e) => e.type === 'image');
check('imported picture is stored as an asset of the presentation', img && img.m.get('src').startsWith(`/api/resources/${imported.id}/assets/`), img?.m.get('src'));
const asset = await call('GET', img.m.get('src').replace('/api', ''), { user: claudia, raw: true });
check('imported picture can be downloaded', asset.status === 200 && asset.headers.get('content-type') === 'image/png');
check('imported background and notes', slideAt(d.doc, 0).get('meta').background?.color === '#FFF5F7' && slideAt(d.doc, 0).get('notes').toString() === 'Remember the launch date');
const i2 = elementsOf(slideAt(d.doc, 1));
const tbl = i2.find((e) => e.type === 'table');
check('imported table keeps its cells', tbl && tbl.m.get('table').rows.length === 2 && [...tbl.m.get('cells').values()].includes('TikTok'));
const ch = i2.find((e) => e.type === 'chart')?.m.get('chart');
check('imported chart keeps type, title, categories and values', ch?.kind === 'column' && ch.title === 'Quarterly' && ch.categories.join() === 'Q1,Q2,Q3' && ch.series[0].values.join() === '10,20,30', ch);
// Edit after import, then export: the edit and the picture both come back.
const firstText = i1.find((e) => e.text === 'Imported title');
firstText.m.get('text').toArray()[0].toArray()[0].insert(0, 'Edited ');
await sleep(2600);
const reZip = await zipOf(await call('GET', `/resources/${imported.id}/export?format=pptx`, { user: claudia, raw: true }));
check('imported deck exports with later edits and its picture', (await reZip.file('ppt/slides/slide1.xml').async('string')).includes('Edited Imported title') && Object.keys(reZip.files).some((f) => f.startsWith('ppt/media/')));
const orig = await call('GET', `/resources/${imported.id}/download`, { user: claudia, raw: true });
check('download of an imported file still returns the original upload', Buffer.from(await orig.arrayBuffer()).length === srcBuf.length);

const bad = new FormData();
bad.append('file', new Blob([Buffer.from('not a zip')]), 'broken.pptx');
const badUp = (await call('POST', '/resources/upload', { user: claudia, form: bad })).data;
check('corrupt pptx is kept with a failed report', badUp.metadata?.import?.status === 'failed', badUp.metadata);
const legacy = new FormData();
legacy.append('file', new Blob([Buffer.from('legacy')]), 'old.ppt');
const legacyUp = (await call('POST', '/resources/upload', { user: claudia, form: legacy })).data;
check('legacy .ppt is kept with an "unsupported" report', legacyUp.type === 'presentation' && legacyUp.metadata?.import?.status === 'unsupported', legacyUp.metadata);

// ── Comments on objects ─────────────────────────────────────────────────────
const elId = s1.find((e) => e.type === 'chart').id;
const cm = await call('POST', `/resources/${deckId}/comments`, { user: mika, body: { body: 'Use the final December number', anchor: { from: { slide: order(a.doc)[0], el: elId }, to: null }, quote: 'Chart' } });
const list = (await call('GET', `/resources/${deckId}/comments`, { user: claudia })).data;
check('comments anchor to a slide object', cm.status === 201 && list.some((t) => t.anchor?.from?.el === elId), cm.status);

// ── Versions & copy ─────────────────────────────────────────────────────────
const v1 = (await call('POST', `/resources/${deckId}/versions`, { user: claudia, body: { label: 'Before cleanup' } })).data;
const firstOrder = order(a.doc);
a.doc.transact(() => a.doc.getArray('slideOrder').delete(0, 1));
await sleep(800);
const vc = (await call('GET', `/resources/${deckId}/versions/${v1.id}/content`, { user: claudia })).data;
check('version preview returns the deck', vc.deck?.slides?.length === 6 && vc.deck.slides[0].id === firstOrder[0], vc.deck?.slides?.length);
const rs = await call('POST', `/resources/${deckId}/versions/${v1.id}/restore`, { user: claudia });
await sleep(900);
check('restore replaces the deck for connected editors', rs.status === 204 && order(b.doc).length === 6, [rs.status, order(b.doc).length]);

const copy = (await call('POST', `/resources/${imported.id}/copy`, { user: claudia, body: {} })).data;
const cp = await connect(copy.id, claudia);
const cimg = elementsOf(slideAt(cp.doc, 0)).find((e) => e.type === 'image');
check('copy has the same slides', order(cp.doc).length === 2);
check('copy gets its own copy of pictures', cimg?.m.get('src').startsWith(`/api/resources/${copy.id}/assets/`) && (await call('GET', cimg.m.get('src').replace('/api', ''), { user: claudia, raw: true })).status === 200, cimg?.m.get('src'));
cp.provider.destroy();
d.provider.destroy();

a.provider.destroy();
b.provider.destroy();
console.log(failures ? `\n${failures} check(s) failed` : '\nall slides checks passed');
process.exit(failures ? 1 : 0);
