// Phase 3 integration test: spreadsheets on the collaborative store, XLSX/CSV/PDF round-trips, versions, copy.
// Requires the API (with collab on :4001) running and seeded data.   node apps/api/test/sheets.mjs
import { HocuspocusProvider } from '@hocuspocus/provider';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
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
const [claudia, mika, sora] = ['claudia', 'mika', 'sora'].map(uid);
const find = async (q) => (await call('GET', '/search?q=' + encodeURIComponent(q), { user: claudia })).data.find((h) => h.kind === 'resource');
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
/** Minimal reader for the Yjs layout of packages/sheet-model. */
const sheetsOf = (doc) => {
  const order = doc.getMap('wb').get('sheetOrder') ?? [];
  return order.map((id) => {
    const m = doc.getMap('sheets').get(id);
    return { id, name: m.get('meta').name, m };
  });
};
const cellAt = (sheet, r, c) => {
  const rows = sheet.m.get('rows');
  const cols = sheet.m.get('cols');
  return sheet.m.get('cells').get(`${rows.get(r)}:${cols.get(c)}`);
};
const setCell = (sheet, r, c, cell) => sheet.m.get('cells').set(`${sheet.m.get('rows').get(r)}:${sheet.m.get('cols').get(c)}`, cell);
const loadXlsx = async (res) => {
  const buf = await res.arrayBuffer();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  wb.rawWorkbookXml = await (await JSZip.loadAsync(buf)).file('xl/workbook.xml').async('string');
  return wb;
};

// ── Seeded workbook over collab ──────────────────────────────────────────────
const a = await connect(salesId, claudia);
const aSheets = sheetsOf(a.doc);
check('seeded workbook syncs with its six tabs', aSheets.map((s) => s.name).join('|') === 'Sales Data|Monthly Summary|By Branch|By Service|Staff Performance|Charts', aSheets.map((s) => s.name));
check('seeded cells and formulas are present', cellAt(aSheets[0], 1, 3)?.v === 'A. Tanaka' && String(cellAt(aSheets[1], 3, 1)?.f).startsWith('=COUNTA('));
check('frozen header row is stored', aSheets[0].m.get('meta').freeze?.row === 1);

const b = await connect(salesId, mika);
setCell(sheetsOf(a.doc)[0], 30, 0, { v: 'realtime', t: 1 });
await sleep(800);
check('cell edit propagates to another editor', cellAt(sheetsOf(b.doc)[0], 30, 0)?.v === 'realtime');

// Concurrent row insert + edit: stable row ids keep each edit on its own row.
const bs = sheetsOf(b.doc)[0];
const newRow = 'row-' + Date.now();
a.doc.transact(() => sheetsOf(a.doc)[0].m.get('rows').insert(2, [newRow]));
setCell(bs, 5, 2, { v: 'edited by mika', t: 1 }); // row index 5 in mika's (stale) view = 'H. Yamada' row
await sleep(900);
const after = sheetsOf(a.doc)[0];
check('concurrent insert does not shift a remote edit', cellAt(after, 6, 2)?.v === 'edited by mika' && cellAt(after, 6, 3)?.v === 'K. Ito', [cellAt(after, 6, 2), cellAt(after, 6, 3)]);
a.doc.transact(() => sheetsOf(a.doc)[0].m.get('rows').delete(2, 1));

const viewer = await connect(salesId, sora).catch((e) => ({ error: e.message }));
if (viewer.doc) {
  setCell(sheetsOf(viewer.doc)[0], 31, 0, { v: 'viewer edit', t: 1 });
  await sleep(800);
  check('viewer edits are not accepted', cellAt(sheetsOf(a.doc)[0], 31, 0)?.v !== 'viewer edit');
  viewer.provider.destroy();
} else check('viewer can open read-only', false, viewer);

await sleep(2500); // let the debounced store flush

// ── Export ──────────────────────────────────────────────────────────────────
const xres = await call('GET', `/resources/${salesId}/export?format=xlsx`, { user: claudia, raw: true });
check('xlsx export responds', xres.status === 200 && xres.headers.get('content-type').includes('spreadsheetml'), xres.status);
const xwb = await loadXlsx(xres);
check('xlsx keeps every sheet', xwb.worksheets.map((w) => w.name).join('|').startsWith('Sales Data|Monthly Summary|By Branch'));
const summary = xwb.getWorksheet('Monthly Summary');
check('xlsx keeps formulas', summary.getCell('B8').formula?.startsWith("SUMIF('Sales Data'!$G$2:$G$21"), summary.getCell('B8').formula);
check('xlsx asks Excel to recalculate on open', /fullCalcOnLoad="1"/.test(xwb.rawWorkbookXml));
check('xlsx keeps merges and frozen panes', summary.getCell('B1').isMerged && xwb.getWorksheet('Sales Data').views[0]?.state === 'frozen');
const data = xwb.getWorksheet('Sales Data');
check('xlsx keeps number formats, fonts and widths', data.getCell('F2').numFmt === '#,##0' && data.getCell('A1').font?.bold && data.getColumn(8).width > 25, [data.getCell('F2').numFmt, data.getColumn(8).width]);
check('xlsx dates are serials with a date format', data.getCell('A2').numFmt === 'yyyy/mm/dd');
check('xlsx carries realtime edits', data.getCell('A31').value === 'realtime');

const csv = await call('GET', `/resources/${salesId}/export?format=csv`, { user: claudia, raw: true });
const csvText = Buffer.from(await csv.arrayBuffer()).toString('utf8');
check('csv export is UTF-8 with BOM and the first sheet', csvText.charCodeAt(0) === 0xfeff && csvText.slice(1).startsWith('Date,Branch,Service,Customer,Staff,Amount (¥),Status,Notes'), csvText.slice(0, 60));
const pdf = await call('GET', `/resources/${salesId}/export?format=pdf`, { user: claudia, raw: true });
const pdfBuf = Buffer.from(await pdf.arrayBuffer());
check('pdf export renders', pdf.status === 200 && pdfBuf.subarray(0, 4).toString() === '%PDF', pdf.status);
const html = await (await call('GET', `/resources/${salesId}/export?format=html`, { user: claudia, raw: true })).text();
check('html export formats numbers and dates like Excel', html.includes('12,000') && html.includes('2026/09/01'));
check('docx is rejected for spreadsheets', (await call('GET', `/resources/${salesId}/export?format=docx`, { user: claudia })).status === 400);
const dl = await call('GET', `/resources/${salesId}/download`, { user: claudia, raw: true });
check('download of a native spreadsheet is xlsx', dl.status === 200 && (dl.headers.get('content-disposition') ?? '').includes('.xlsx'));

// ── Search ──────────────────────────────────────────────────────────────────
const hit = await find('Hashimoto');
check('cell text is searchable', hit?.id === salesId, hit);

// ── Create ──────────────────────────────────────────────────────────────────
const created = (await call('POST', '/resources', { user: claudia, body: { name: 'Test sheet ' + Date.now(), type: 'spreadsheet' } })).data;
const c = await connect(created.id, claudia);
check('new spreadsheet is initialised by the server', sheetsOf(c.doc).length === 1 && sheetsOf(c.doc)[0].m.get('rows').length === 1000);
// Formula results live in their own map: writing one never touches the formula (no lost reference shifts).
const cs = sheetsOf(c.doc)[0];
const fKey = `${cs.m.get('rows').get(0)}:${cs.m.get('cols').get(0)}`;
setCell(cs, 0, 0, { f: '=6*7' });
cs.m.get('values').set(fKey, { v: 42, t: 2 });
await sleep(2600);
check('formula results are stored apart from formulas', cellAt(cs, 0, 0)?.f === '=6*7' && cellAt(cs, 0, 0)?.v === undefined);
const rHtml = await (await call('GET', `/resources/${created.id}/export?format=html`, { user: claudia, raw: true })).text();
check('exports show results from the values map', rHtml.includes('>42<'));
c.provider.destroy();

// ── Import .xlsx ────────────────────────────────────────────────────────────
const src = new ExcelJS.Workbook();
const ws = src.addWorksheet('Data', { views: [{ state: 'frozen', ySplit: 1 }], properties: { tabColor: { argb: 'FFFF0000' } } });
ws.columns = [{ width: 20 }, { width: 12 }, { width: 12 }];
ws.addRow(['Item', 'Qty', 'Price']);
ws.addRow(['Apple', 3, 1.5]);
ws.addRow(['Pear', 4, 2.25]);
ws.getCell('D2').value = { formula: 'B2*C2', result: 4.5, shareType: 'shared', ref: 'D2:D3' };
ws.getCell('D3').value = { sharedFormula: 'D2', result: 9 };
ws.getCell('A5').value = { formula: 'SUM(D2:D3)', result: 13.5 };
ws.getCell('B6').value = new Date(Date.UTC(2026, 8, 29));
ws.getCell('A1').font = { bold: true, color: { argb: 'FF1D4ED8' } };
ws.getCell('C2').numFmt = '0.00';
ws.mergeCells('A7:C7');
ws.getCell('A7').value = 'Merged note';
src.addWorksheet('Second').getCell('A1').value = { richText: [{ text: 'Rich ' }, { text: 'text', font: { bold: true } }] };
const fd = new FormData();
const srcBuf = Buffer.from(await src.xlsx.writeBuffer());
fd.append('file', new Blob([srcBuf]), 'Imported book.xlsx');
const up = await call('POST', '/resources/upload', { user: claudia, form: fd });
const imported = up.data;
check('xlsx upload becomes a spreadsheet with an import report', up.status === 201 && imported.type === 'spreadsheet' && imported.metadata?.import?.status === 'done', up.data);
const d = await connect(imported.id, claudia);
const ds = sheetsOf(d.doc);
check('imported sheets, values and styles', ds.length === 2 && cellAt(ds[0], 1, 1)?.v === 3 && cellAt(ds[0], 0, 0)?.s?.bl === 1 && cellAt(ds[0], 1, 2)?.s?.n?.pattern === '0.00');
check('shared formulas are expanded per cell', cellAt(ds[0], 2, 3)?.f === '=B3*C3' && cellAt(ds[0], 2, 3)?.v === 9, cellAt(ds[0], 2, 3));
check('dates import as serial numbers', Math.round(cellAt(ds[0], 5, 1)?.v) === 46294, cellAt(ds[0], 5, 1));
check('merges, freeze, tab colour, widths import', ds[0].m.get('merges').size === 1 && ds[0].m.get('meta').freeze?.row === 1 && ds[0].m.get('meta').tabColor === '#FF0000' && ds[0].m.get('colMeta').size >= 3);
check('rich text imports as its text', cellAt(ds[1], 0, 0)?.v === 'Rich text');
setCell(ds[0], 9, 0, { v: 'after import', t: 1 });
await sleep(2500);
const reDl = await loadXlsx(await call('GET', `/resources/${imported.id}/export?format=xlsx`, { user: claudia, raw: true }));
check('imported file exports with later edits', reDl.getWorksheet('Data').getCell('A10').value === 'after import');
const orig = await call('GET', `/resources/${imported.id}/download`, { user: claudia, raw: true });
check('download of an imported file still returns the original upload', Buffer.from(await orig.arrayBuffer()).length === srcBuf.length);
d.provider.destroy();

// ── Import .csv ─────────────────────────────────────────────────────────────
const fc = new FormData();
fc.append('file', new Blob(['﻿Name;Score;Pass\r\n"Tanaka, A";91.5;TRUE\r\nSato;78;FALSE\r\nTotal;=SUM(B2:B3);\r\n']), 'scores.csv');
const upc = (await call('POST', '/resources/upload', { user: claudia, form: fc })).data;
const e = await connect(upc.id, claudia);
const es = sheetsOf(e.doc)[0];
check('csv import: delimiter, quotes, numbers, booleans, formulas', cellAt(es, 1, 0)?.v === 'Tanaka, A' && cellAt(es, 1, 1)?.v === 91.5 && cellAt(es, 1, 2)?.v === true && cellAt(es, 3, 1)?.f === '=SUM(B2:B3)');
e.provider.destroy();

const bad = new FormData();
bad.append('file', new Blob([Buffer.from('not a zip')]), 'broken.xlsx');
const badUp = (await call('POST', '/resources/upload', { user: claudia, form: bad })).data;
check('corrupt xlsx is kept as a file with a failed report', badUp.metadata?.import?.status === 'failed', badUp.metadata);

// ── Versions & copy ─────────────────────────────────────────────────────────
const v1 = (await call('POST', `/resources/${salesId}/versions`, { user: claudia, body: { label: 'Before cleanup' } })).data;
setCell(sheetsOf(a.doc)[0], 1, 3, { v: 'CHANGED', t: 1 });
await sleep(800);
const vc = (await call('GET', `/resources/${salesId}/versions/${v1.id}/content`, { user: claudia })).data;
check('version preview returns the workbook', vc.workbook?.sheets?.[0]?.cells?.[1]?.[3]?.v === 'A. Tanaka');
const rs = await call('POST', `/resources/${salesId}/versions/${v1.id}/restore`, { user: claudia });
await sleep(800);
check('restore replaces the workbook for connected editors', rs.status === 204 && cellAt(sheetsOf(b.doc)[0], 1, 3)?.v === 'A. Tanaka', rs.status);

const copy = (await call('POST', `/resources/${salesId}/copy`, { user: claudia, body: {} })).data;
const cp = await connect(copy.id, claudia);
check('copy has the same sheets and data', sheetsOf(cp.doc).length === 6 && cellAt(sheetsOf(cp.doc)[0], 1, 3)?.v === 'A. Tanaka');
cp.provider.destroy();

a.provider.destroy();
b.provider.destroy();
console.log(failures ? `\n${failures} check(s) failed` : '\nall sheets checks passed');
process.exit(failures ? 1 : 0);
