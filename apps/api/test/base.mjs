// Base (§75): tables, fields (types, options, conversions, formulas), views, records (coercion, links, order),
// comments, CSV in / out, attachments, forms and access by the base's role.   node apps/api/test/base.mjs
const API = process.env.API_URL ?? 'http://localhost:4000';
let failures = 0;
const check = (name, cond, extra) => {
  console.log(`${cond ? '✓' : '✗'} ${name}${cond ? '' : ' ' + JSON.stringify(extra ?? '')}`);
  if (!cond) failures++;
};
async function call(method, path, { user, body, raw } = {}) {
  const headers = {};
  if (user) headers['x-user-id'] = user;
  if (body && !raw) headers['content-type'] = 'application/json';
  const res = await fetch(API + path, { method, headers, body: raw ?? (body ? JSON.stringify(body) : undefined) });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: res.status, data, headers: res.headers };
}
const users = (await call('GET', '/users')).data;
const uid = (key) => users.find((u) => u.email === `${key}@hanami.example`).id;
const [hana, mika, ken] = ['hana', 'mika', 'ken'].map(uid);
const n = Date.now() % 100000;

// A base in My Files, shared with Mika as editor and Ken as commenter.
const base = (await call('POST', '/resources', { user: hana, body: { name: `CRM ${n}`, type: 'base' } })).data;
check('a base is a Drive resource', base.type === 'base', base);
await call('POST', `/resources/${base.id}/members`, { user: hana, body: { userId: mika, role: 'editor' } });
await call('POST', `/resources/${base.id}/members`, { user: hana, body: { userId: ken, role: 'commenter' } });

// ── Schema ──────────────────────────────────────────────────────────────────
const s0 = (await call('GET', `/base/${base.id}`, { user: hana })).data;
const t1 = s0.tables[0];
check('a new base opens with Table 1: Name, Notes, Status and a grid view', s0.tables.length === 1 && t1.name === 'Table 1' && t1.fields.map((f) => `${f.name}:${f.type}`).join() === 'Name:text,Notes:longText,Status:singleSelect' && t1.views[0].type === 'grid' && t1.primaryFieldId === t1.fields[0].id, t1);
check('opening it again does not add tables', (await call('GET', `/base/${base.id}`, { user: mika })).data.tables.length === 1);
check('the role comes with it', (await call('GET', `/base/${base.id}`, { user: ken })).data.role === 'commenter');
check('others do not see it', (await call('GET', `/base/${base.id}`, { user: uid('rina') })).status === 404);
await call('PATCH', `/base/tables/${t1.id}`, { user: hana, body: { name: 'Leads' } });
const F = {};
const add = async (body) => {
  const r = await call('POST', `/base/tables/${t1.id}/fields`, { user: hana, body });
  if (r.status === 201) F[body.name] = r.data;
  return r;
};
await add({ name: 'Company', type: 'text' });
await add({ name: 'Value', type: 'currency', options: { currency: 'JPY' } });
await add({ name: 'Seats', type: 'number' });
await add({ name: 'Close date', type: 'date' });
await add({ name: 'Owner', type: 'person' });
await add({ name: 'Hot', type: 'checkbox' });
await add({ name: 'Tags', type: 'multiSelect', options: { choices: [{ name: 'Enterprise' }, { name: 'SMB' }] } });
await add({ name: 'Score', type: 'rating', options: { max: 5 } });
await add({ name: 'Per seat', type: 'formula', options: { expression: 'ROUND({Value} / {Seats}, 0)' } });
await add({ name: 'No', type: 'autoNumber' });
check('fields of many types', Object.keys(F).length === 10, Object.keys(F));
check('field names are unique', (await add({ name: 'company', type: 'text' })).status === 400);
check('a broken formula is refused with the reason', (await add({ name: 'Bad', type: 'formula', options: { expression: '{Nope} * 2' } })).data.message === 'Formula: No field named "Nope"');
check('commenters do not change the schema', (await call('POST', `/base/tables/${t1.id}/fields`, { user: ken, body: { name: 'X' } })).status === 403);
const statusF = t1.fields[2];

// ── Records ─────────────────────────────────────────────────────────────────
const created = await call('POST', `/base/tables/${t1.id}/records`, {
  user: mika,
  body: {
    records: [
      { values: { [t1.fields[0].id]: 'Acme renewal', [F.Company.id]: 'Acme', [F.Value.id]: '¥1,200,000', [F.Seats.id]: '40', [F['Close date'].id]: '2026/11/30', [F.Owner.id]: 'hana@hanami.example', [F.Hot.id]: 'yes', [F.Tags.id]: 'Enterprise, Strategic', [statusF.id]: 'in progress', [F.Score.id]: 9 } },
      { values: { Name: 'Blue Co pilot', Company: 'Blue Co', Value: 300000, Seats: 10, Status: 'Todo' } },
      { values: { Name: 'Cobalt', Value: 50000 } },
    ],
  },
});
const [r1, r2, r3] = created.data;
check('creating records (by field id or name)', created.status === 201 && created.data.length === 3, created.data);
check('values are coerced: money, numbers, dates, people, checkbox', r1.values[F.Value.id] === 1200000 && r1.values[F.Seats.id] === 40 && r1.values[F['Close date'].id] === '2026-11-30' && r1.values[F.Owner.id][0] === hana && r1.values[F.Hot.id] === true, r1.values);
check('select names become choices (new ones are added)', r1.values[statusF.id] === statusF.options.choices[1].id && r1.values[F.Tags.id].length === 2, r1.values);
const s1 = (await call('GET', `/base/${base.id}`, { user: hana })).data;
check('… "Strategic" joined the Tags options', s1.tables[0].fields.find((f) => f.id === F.Tags.id).options.choices.map((c) => c.name).join() === 'Enterprise,SMB,Strategic');
check('ratings stop at their max', r1.values[F.Score.id] === 5);
check('auto numbers count up', [r1, r2, r3].map((r) => r.autoNumber).join() === '1,2,3');
check('computed fields cannot be written', (await call('POST', `/base/tables/${t1.id}/records`, { user: mika, body: { records: [{ values: { [F['Per seat'].id]: 1 } }] } })).status === 400);
check('commenters do not edit records', (await call('PATCH', '/base/records', { user: ken, body: { records: [{ id: r1.id, values: { Name: 'x' } }] } })).status === 403);
const up = await call('PATCH', '/base/records', { user: mika, body: { records: [{ id: r2.id, values: { Seats: '12', Hot: true } }, { id: r3.id, values: { Company: 'Cobalt KK', Value: null } }] } });
check('updating several records (paste)', up.status === 200 && up.data[0].values[F.Seats.id] === 12 && up.data[1].values[F.Company.id] === 'Cobalt KK' && !(F.Value.id in up.data[1].values), up.data);
const mid = (await call('POST', `/base/tables/${t1.id}/records`, { user: mika, body: { records: [{ values: { Name: 'Inserted' }, afterId: r1.id }] } })).data[0];
let list = (await call('GET', `/base/tables/${t1.id}/records`, { user: ken })).data;
check('inserting after a record keeps the order', list.map((r) => r.values[t1.fields[0].id]).join() === 'Acme renewal,Inserted,Blue Co pilot,Cobalt', list.map((r) => r.values[t1.fields[0].id]));
await call('POST', `/base/records/${r3.id}/move`, { user: mika, body: { afterId: null, beforeId: r1.id } });
list = (await call('GET', `/base/tables/${t1.id}/records`, { user: ken })).data;
check('moving a record to the top', list[0].id === r3.id);

// ── Fields change ───────────────────────────────────────────────────────────
const ren = await call('PATCH', `/base/fields/${F.Value.id}`, { user: hana, body: { name: 'Amount' } });
const s2 = (await call('GET', `/base/${base.id}`, { user: hana })).data.tables[0];
check('renaming a field rewrites formulas that use it', ren.status === 200 && s2.fields.find((f) => f.id === F['Per seat'].id).options.expression === 'ROUND({Amount} / {Seats}, 0)');
const conv = await call('PATCH', `/base/fields/${F.Company.id}`, { user: hana, body: { type: 'singleSelect' } });
list = (await call('GET', `/base/tables/${t1.id}/records`, { user: hana })).data;
const compF = (await call('GET', `/base/${base.id}`, { user: hana })).data.tables[0].fields.find((f) => f.id === F.Company.id);
check('text → single select turns values into options', conv.status === 200 && compF.options.choices.map((c) => c.name).sort().join() === 'Acme,Blue Co,Cobalt KK' && list.find((r) => r.id === r1.id).values[F.Company.id] === compF.options.choices.find((c) => c.name === 'Acme').id, compF.options);
await call('PATCH', `/base/fields/${F.Seats.id}`, { user: hana, body: { type: 'text' } });
list = (await call('GET', `/base/tables/${t1.id}/records`, { user: hana })).data;
check('number → text keeps the digits', list.find((r) => r.id === r1.id).values[F.Seats.id] === '40');
await call('PATCH', `/base/fields/${F.Seats.id}`, { user: hana, body: { type: 'number' } });
list = (await call('GET', `/base/tables/${t1.id}/records`, { user: hana })).data;
check('… and back to a number', list.find((r) => r.id === r1.id).values[F.Seats.id] === 40);
check('the primary field cannot become a checkbox', (await call('PATCH', `/base/fields/${t1.fields[0].id}`, { user: hana, body: { type: 'checkbox' } })).status === 400);
check('… nor be deleted', (await call('DELETE', `/base/fields/${t1.fields[0].id}`, { user: hana })).status === 400);

// ── Views ───────────────────────────────────────────────────────────────────
const kb = await call('POST', `/base/tables/${t1.id}/views`, { user: hana, body: { type: 'kanban' } });
check('a kanban view stacks by the first single select', kb.status === 201 && kb.data.config.stackField === statusF.id, kb.data);
const cal = (await call('POST', `/base/tables/${t1.id}/views`, { user: hana, body: { type: 'calendar' } })).data;
check('a calendar view uses the first date field', cal.config.dateField === F['Close date'].id);
const grid = s0.tables[0].views[0];
const v2 = await call('PATCH', `/base/views/${grid.id}`, { user: hana, body: { config: { filters: { conjunction: 'and', conditions: [{ fieldId: F.Hot.id, op: 'is', value: true }, { fieldId: 'not-a-field', op: 'is', value: 1 }] }, sorts: [{ fieldId: F.Value.id, dir: 'desc' }], hidden: [F.Score.id], widths: { [F.Company.id]: 5000 } } } });
check('view config is cleaned (unknown fields dropped, widths clamped)', v2.data.config.filters.conditions.length === 1 && v2.data.config.sorts[0].dir === 'desc' && v2.data.config.widths[F.Company.id] === 800 && v2.data.config.rowHeight === 'short', v2.data.config);
const csv = await call('GET', `/base/tables/${t1.id}/csv?view=${grid.id}`, { user: ken });
const lines = csv.data.replace(/^﻿/, '').trim().split(/\r\n/);
check('CSV export follows the view: filter, sort, hidden fields', csv.status === 200 && lines.length === 3 && lines[0].startsWith('Name,Notes,Status,Company,Amount,Seats') && !lines[0].includes('Score') && lines[1].startsWith('Acme renewal') && lines[1].includes('"¥1,200,000"') && lines[2].startsWith('Blue Co pilot'), lines);
check('… with a file name', /filename\*=UTF-8''CRM/.test(csv.headers.get('content-disposition') ?? ''));
const delF = await call('DELETE', `/base/fields/${F.Hot.id}`, { user: hana });
const g2 = (await call('GET', `/base/${base.id}`, { user: hana })).data.tables[0].views.find((v) => v.id === grid.id);
check('deleting a field removes its values and view settings', delF.status === 204 && g2.config.filters.conditions.length === 0 && !((await call('GET', `/base/tables/${t1.id}/records`, { user: hana })).data.find((r) => r.id === r1.id).values[F.Hot.id]));

// ── Linked tables ───────────────────────────────────────────────────────────
const t2id = (await call('POST', `/base/${base.id}/tables`, { user: hana, body: { name: 'Contacts' } })).data.id;
const s3 = (await call('GET', `/base/${base.id}`, { user: hana })).data;
const t2 = s3.tables.find((t) => t.id === t2id);
const people = (await call('POST', `/base/tables/${t2id}/records`, { user: mika, body: { records: [{ values: { Name: 'Aiko Tanaka' } }, { values: { Name: 'Ben Ito' } }] } })).data;
const link = (await call('POST', `/base/tables/${t1.id}/fields`, { user: hana, body: { name: 'Contacts', type: 'link', options: { tableId: t2id } } })).data;
const linked = await call('PATCH', '/base/records', { user: mika, body: { records: [{ id: r1.id, values: { [link.id]: 'Aiko Tanaka, Ben Ito, Nobody' } }] } });
check('links take record titles (unknown ones are dropped)', linked.data[0].values[link.id].length === 2, linked.data[0].values);
check('link targets must be in this base', (await call('POST', `/base/tables/${t1.id}/fields`, { user: hana, body: { name: 'Elsewhere', type: 'link', options: { tableId: '00000000-0000-4000-8000-000000000000' } } })).status === 400);
check('titles for link pickers', (await call('GET', `/base/tables/${t2id}/titles`, { user: ken })).data.map((x) => x.title).join() === 'Aiko Tanaka,Ben Ito');
await call('POST', '/base/records/delete', { user: mika, body: { ids: [people[1].id] } });
check('deleting a record drops links to it', (await call('GET', `/base/tables/${t1.id}/records`, { user: hana })).data.find((r) => r.id === r1.id).values[link.id].join() === people[0].id);
await call('DELETE', `/base/tables/${t2id}`, { user: hana });
const s4 = (await call('GET', `/base/${base.id}`, { user: hana })).data.tables[0];
const linkAfter = s4.fields.find((f) => f.id === link.id);
check('deleting a linked table turns its links into text', linkAfter.type === 'text' && (await call('GET', `/base/tables/${t1.id}/records`, { user: hana })).data.find((r) => r.id === r1.id).values[link.id] === 'Aiko Tanaka', linkAfter);
check('the last table cannot be deleted', (await call('DELETE', `/base/tables/${t1.id}`, { user: hana })).status === 400);

// ── Comments ────────────────────────────────────────────────────────────────
const c1 = await call('POST', `/base/records/${r1.id}/comments`, { user: ken, body: { body: 'Called them today' } });
check('commenters comment on records', c1.status === 201 && c1.data[0].user.id === ken && c1.data[0].body === 'Called them today');
check('… the count shows on the record', (await call('GET', `/base/tables/${t1.id}/records`, { user: hana })).data.find((r) => r.id === r1.id).commentCount === 1);
check('only the writer (or an admin) removes a comment', (await call('DELETE', `/base/comments/${c1.data[0].id}`, { user: mika })).status === 403 && (await call('DELETE', `/base/comments/${c1.data[0].id}`, { user: hana })).status === 204);

// ── CSV import ──────────────────────────────────────────────────────────────
const imp = await call('POST', `/base/${base.id}/import`, { user: mika, body: { name: 'vendors.csv', csv: 'Vendor,Contact,Spend,Since,Active,Tier\n"Hanami Print, Ltd.",hanami@print.jp,"1,200",2024-04-01,yes,Gold\nNishi Foods,info@nishi.jp,800,2025-01-15,no,Silver\nUme Tech,hello@ume.tech,450,2023-09-30,yes,Gold\nSora Cleaning,ops@sora.jp,120,2026-02-01,yes,Bronze\n' } });
const s5 = (await call('GET', `/base/${base.id}`, { user: hana })).data;
const vt = s5.tables.find((t) => t.id === imp.data.tableId);
check('importing CSV makes a table with guessed field types', imp.status === 201 && imp.data.records === 4 && vt.name === 'vendors' && vt.fields.map((f) => f.type).join() === 'text,email,number,date,checkbox,singleSelect', vt?.fields.map((f) => f.type));
const vrecs = (await call('GET', `/base/tables/${vt.id}/records`, { user: hana })).data;
check('… with the values parsed', vrecs[0].values[vt.fields[0].id] === 'Hanami Print, Ltd.' && vrecs[0].values[vt.fields[2].id] === 1200 && vrecs[1].values[vt.fields[4].id] !== true && vrecs.length === 4, vrecs[0].values);
const app = await call('POST', `/base/tables/${vt.id}/csv`, { user: mika, body: { csv: 'vendor,Spend,Unknown\nYama Supply,99,x\n' } });
check('appending CSV matches columns by name', app.data.added === 1 && app.data.skipped.join() === 'Unknown', app.data);

// ── Attachments ─────────────────────────────────────────────────────────────
const fd = new FormData();
fd.append('file', new Blob(['%PDF-1.4 quote'], { type: 'application/pdf' }), 'quote.pdf');
const att = await call('POST', `/base/${base.id}/attachments`, { user: mika, raw: fd });
check('uploading an attachment', att.status === 201 && att.data.name === 'quote.pdf' && att.data.mime === 'application/pdf', att.data);
const attF = (await call('POST', `/base/tables/${t1.id}/fields`, { user: hana, body: { name: 'Files', type: 'attachment' } })).data;
const withFile = (await call('PATCH', '/base/records', { user: mika, body: { records: [{ id: r1.id, values: { [attF.id]: [att.data, { id: 'nope' }] } }] } })).data[0];
check('… stored on the record', withFile.values[attF.id].length === 1 && withFile.values[attF.id][0].name === 'quote.pdf');
check('… and readable by viewers of the base', (await call('GET', `/resources/${base.id}/assets/${att.data.id}`, { user: ken })).status === 200);

// ── Forms ───────────────────────────────────────────────────────────────────
const form = (await call('POST', `/base/tables/${t1.id}/views`, { user: hana, body: { type: 'form', config: { form: { title: 'New lead', required: [t1.fields[0].id], fields: [t1.fields[0].id, F.Value.id, statusF.id, F['Per seat'].id] } } } })).data;
check('a form view asks the fields chosen (never computed ones)', form.config.form.fields.length === 3 && form.config.form.required.join() === t1.fields[0].id, form.config.form);
check('a closed form is for editors only', (await call('GET', `/base/forms/${form.id}`, { user: uid('rina') })).status === 404 && (await call('GET', `/base/forms/${form.id}`, { user: ken })).status === 403);
await call('PATCH', `/base/views/${form.id}`, { user: hana, body: { config: { form: { open: true } } } });
const fv = await call('GET', `/base/forms/${form.id}`, { user: uid('rina') });
check('an open form takes answers from anyone in the workspace', fv.status === 200 && fv.data.title === 'New lead' && fv.data.fields.length === 3 && fv.data.fields[2].options.choices.length === 3, fv.data);
check('required questions', (await call('POST', `/base/forms/${form.id}`, { user: uid('rina'), body: { values: { [F.Value.id]: 5 } } })).data.message === 'Please answer: Name');
const sub = await call('POST', `/base/forms/${form.id}`, { user: uid('rina'), body: { values: { [t1.fields[0].id]: 'From the form', [F.Value.id]: '7000', [F.Seats.id]: 3 } } });
list = (await call('GET', `/base/tables/${t1.id}/records`, { user: hana })).data;
const fromForm = list.find((r) => r.id === sub.data.id);
check('a submission becomes a record (only asked fields kept)', sub.status === 200 && fromForm.values[F.Value.id] === 7000 && !(F.Seats.id in fromForm.values) && fromForm.createdBy === uid('rina'), fromForm);

const fd2 = new FormData();
fd2.append('file', new Blob(['hello'], { type: 'text/plain' }), 'note.txt');
check('a form without file questions takes no files', (await call('POST', `/base/forms/${form.id}/attachments`, { user: uid('rina'), raw: fd2 })).status === 400);
await call('PATCH', `/base/views/${form.id}`, { user: hana, body: { config: { form: { fields: [t1.fields[0].id, attF.id] } } } });
const fd3 = new FormData();
fd3.append('file', new Blob(['hello'], { type: 'text/plain' }), 'note.txt');
const fa = await call('POST', `/base/forms/${form.id}/attachments`, { user: uid('rina'), raw: fd3 });
check('people answering an open form attach files (without access to the base)', fa.status === 201 && fa.data.name === 'note.txt', fa.data);

// ── Deleting ────────────────────────────────────────────────────────────────
check('deleting records', (await call('POST', '/base/records/delete', { user: mika, body: { ids: [mid.id, sub.data.id] } })).status === 204 && (await call('GET', `/base/tables/${t1.id}/records`, { user: hana })).data.length === 3);
check('the last view of a table stays', (await call('DELETE', `/base/views/${vt.views[0].id}`, { user: hana })).status === 400);

console.log(failures ? `\n${failures} check(s) failed` : '\nall base checks passed');
process.exit(failures ? 1 : 0);
