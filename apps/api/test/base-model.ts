// Unit checks of @workos/base-model (§75): formulas, cell coercion / text, view filtering / sorting / grouping, CSV.
//   cd apps/api && npx tsx test/base-model.ts
import {
  applyView,
  cellText,
  cellValue,
  coerceValue,
  defaultsForView,
  emptyViewConfig,
  formulaProblem,
  guessFieldType,
  parseCsv,
  summarize,
  toCsv,
  visibleFields,
  type BaseField,
  type BaseRecord,
  type CellContext,
} from '../../../packages/base-model/src';

let failures = 0;
const check = (name: string, cond: boolean, extra?: unknown) => {
  console.log(`${cond ? '✓' : '✗'} ${name}${cond ? '' : ' ' + JSON.stringify(extra ?? '')}`);
  if (!cond) failures++;
};
const f = (id: string, name: string, type: BaseField['type'], options: BaseField['options'] = {}, position = 0): BaseField => ({ id, tableId: 't', name, type, options, description: null, position });
const fields = [
  f('name', 'Name', 'text'),
  f('price', 'Price', 'currency', { currency: 'JPY' }, 1),
  f('qty', 'Qty', 'number', {}, 2),
  f('total', 'Total', 'formula', { expression: '{Price} * {Qty}' }, 3),
  f('status', 'Status', 'singleSelect', { choices: [{ id: 'a', name: 'New', color: '#fff' }, { id: 'b', name: 'Won', color: '#fff' }, { id: 'c', name: 'Lost', color: '#fff' }] }, 4),
  f('tags', 'Tags', 'multiSelect', { choices: [{ id: 'x', name: 'VIP', color: '#fff' }, { id: 'y', name: 'Repeat', color: '#fff' }] }, 5),
  f('due', 'Due', 'date', {}, 6),
  f('owner', 'Owner', 'person', {}, 7),
  f('done', 'Done', 'checkbox', {}, 8),
  f('label', 'Label', 'formula', { expression: 'IF({Status} = "Won", UPPER({Name}) & " ✓", "")' }, 9),
  f('days', 'Days left', 'formula', { expression: "DATETIME_DIFF({Due}, TODAY(), 'days')" }, 10),
  f('no', 'No', 'autoNumber', {}, 11),
];
const ctx: CellContext = { fields, people: new Map([['u1', { name: 'Hana Sato', email: 'hana@kaori.jp' }], ['u2', { name: 'Ken Ito' }]]), now: new Date('2026-10-07T03:00:00Z'), timeZone: 'Asia/Tokyo' };
let n = 0;
const rec = (values: Record<string, unknown>): BaseRecord => ({ id: `r${++n}`, tableId: 't', values, position: `a${n}`, autoNumber: n, createdBy: 'u1', createdAt: '2026-10-01T00:00:00Z', updatedBy: null, updatedAt: '2026-10-01T00:00:00Z', commentCount: 0 });
const rows = [
  rec({ name: 'Acme', price: 1200, qty: 3, status: 'b', tags: ['x'], due: '2026-10-10', owner: ['u1'], done: true }),
  rec({ name: 'Blue Co', price: 500, qty: 10, status: 'a', tags: ['x', 'y'], due: '2026-10-05', owner: ['u2'] }),
  rec({ name: 'Cobalt', price: 800, status: 'c', due: '2026-11-01' }),
  rec({ name: 'Delta', price: 2000, qty: 1 }),
];
const by = (id: string) => fields.find((x) => x.id === id)!;

// ── Formulas ────────────────────────────────────────────────────────────────
check('arithmetic over fields', cellValue(by('total'), rows[0], ctx) === 3600);
check('blank counts as 0', cellValue(by('total'), rows[2], ctx) === 0);
check('IF, comparison with a select name, & and UPPER', cellValue(by('label'), rows[0], ctx) === 'ACME ✓' && cellValue(by('label'), rows[1], ctx) === '');
check('date difference against today', cellValue(by('days'), rows[0], ctx) === 3 && cellValue(by('days'), rows[1], ctx) === -2);
check('formula problems are reported', formulaProblem('{Price} * ', fields) === 'The formula ends too early' && formulaProblem('{Nope} + 1', fields) === 'No field named "Nope"' && formulaProblem('{Total} + 1', fields, 'total') === 'A formula cannot use itself' && formulaProblem('SUMX(1)', fields) === 'Unknown function SUMX');
const loopA = f('la', 'A', 'formula', { expression: '{B} + 1' });
const loopB = f('lb', 'B', 'formula', { expression: '{A} + 1' });
check('formulas that refer to each other in a loop error out', cellText(loopA, cellValue(loopA, rows[0], { ...ctx, fields: [loopA, loopB] }), ctx) === '#ERROR!');
check('functions: ROUND, SUM over lists, CONCAT, DATEADD', cellValue(f('z', 'Z', 'formula', { expression: 'ROUND(10/3, 2) & "|" & SUM(1, 2, 3) & "|" & DATEADD("2026-01-31", 1, "months")' }), rows[0], ctx) === '3.33|6|2026-03-03');

// ── Cells ───────────────────────────────────────────────────────────────────
check('currency text', cellText(by('price'), 1200, ctx) === '¥1,200');
check('select / multi-select / person text', cellText(by('status'), 'b', ctx) === 'Won' && cellText(by('tags'), ['x', 'y'], ctx) === 'VIP, Repeat' && cellText(by('owner'), ['u1'], ctx) === 'Hana Sato');
check('coercing typed text: numbers, percent, checkbox, dates', coerceValue(by('qty'), '1,250', ctx) === 1250 && coerceValue(f('p', 'P', 'percent'), '15%', ctx) === 0.15 && coerceValue(by('done'), 'yes', ctx) === true && coerceValue(by('due'), '10/07/2026', ctx) === '2026-10-07');
check('coercing names to choices and people', coerceValue(by('status'), 'won', ctx) === 'b' && JSON.stringify(coerceValue(by('owner'), 'hana@kaori.jp', ctx)) === '["u1"]');
const added: string[] = [];
const v = coerceValue(by('tags'), 'VIP, Gold', ctx, { addChoice: (_fl, name) => (added.push(name), { id: 'g', name, color: '#fff' }) });
check('unknown choices can be added on import', JSON.stringify(v) === '["x","g"]' && added.join() === 'Gold', v);
check('computed fields take no input', coerceValue(by('total'), 5, ctx) === undefined);
check('a bad e-mail is refused', coerceValue(f('e', 'E', 'email'), 'nope', ctx) === null);

// ── Views ───────────────────────────────────────────────────────────────────
const view = (patch: Partial<ReturnType<typeof emptyViewConfig>>) => ({ config: { ...emptyViewConfig(), ...patch } });
const names = (rs: BaseRecord[]) => rs.map((r) => r.values.name).join();
check('filter: number >', names(applyView({ fields }, rows, view({ filters: { conjunction: 'and', conditions: [{ id: '1', fieldId: 'price', op: 'gt', value: 900 }] } }), ctx).records) === 'Acme,Delta');
check('filter: select is any of, OR conjunction', names(applyView({ fields }, rows, view({ filters: { conjunction: 'or', conditions: [{ id: '1', fieldId: 'status', op: 'isAnyOf', value: ['c'] }, { id: '2', fieldId: 'done', op: 'is', value: true }] } }), ctx).records) === 'Acme,Cobalt');
check('filter: is empty, has all of, is me', names(applyView({ fields }, rows, view({ filters: { conjunction: 'and', conditions: [{ id: '1', fieldId: 'status', op: 'isEmpty' }] } }), ctx).records) === 'Delta' && names(applyView({ fields }, rows, view({ filters: { conjunction: 'and', conditions: [{ id: '1', fieldId: 'tags', op: 'hasAllOf', value: ['x', 'y'] }] } }), ctx).records) === 'Blue Co' && names(applyView({ fields }, rows, view({ filters: { conjunction: 'and', conditions: [{ id: '1', fieldId: 'owner', op: 'isMe' }] } }), ctx, { me: 'u2' }).records) === 'Blue Co');
check('filter on a formula (text contains)', names(applyView({ fields }, rows, view({ filters: { conjunction: 'and', conditions: [{ id: '1', fieldId: 'label', op: 'contains', value: 'acme' }] } }), ctx).records) === 'Acme');
check('a condition without a value hides nothing', applyView({ fields }, rows, view({ filters: { conjunction: 'and', conditions: [{ id: '1', fieldId: 'name', op: 'contains', value: '' }] } }), ctx).records.length === 4);
check('sort by formula desc, empty last', names(applyView({ fields }, rows, view({ sorts: [{ fieldId: 'total', dir: 'desc' }] }), ctx).records) === 'Blue Co,Acme,Delta,Cobalt');
check('sort by date asc puts empty last', names(applyView({ fields }, rows, view({ sorts: [{ fieldId: 'due', dir: 'asc' }] }), ctx).records) === 'Blue Co,Acme,Cobalt,Delta');
const g = applyView({ fields }, rows, view({ groupBy: { fieldId: 'status', dir: 'asc' } }), ctx).groups!;
check('group by select in choice order, empty group last', g.map((x) => `${x.label}:${x.records.length}`).join() === 'New:1,Won:1,Lost:1,No Status:1', g.map((x) => x.label));
check('search over shown fields', names(applyView({ fields }, rows, null, ctx, { search: 'repeat' }).records) === 'Blue Co');
check('hidden fields and order (primary first)', visibleFields({ fields, primaryFieldId: 'name' }, view({ hidden: ['qty', 'name'], order: ['status', 'price'] })).slice(0, 3).map((x) => x.id).join() === 'name,status,price');
check('a new record fits the filtered view it came from', JSON.stringify(defaultsForView({ fields }, view({ filters: { conjunction: 'and', conditions: [{ id: '1', fieldId: 'status', op: 'is', value: 'b' }, { id: '2', fieldId: 'owner', op: 'isMe' }] } }), 'u1')) === '{"status":"b","owner":["u1"]}');
check('summaries: sum, avg, filled, checked', summarize(by('price'), rows, ctx, 'sum') === '¥4,500' && summarize(by('qty'), rows, ctx, 'avg') === '4.67' && summarize(by('status'), rows, ctx, 'filled') === '3' && summarize(by('done'), rows, ctx, 'checked') === '1 / 4', [summarize(by('qty'), rows, ctx, 'avg')]);

// ── CSV ─────────────────────────────────────────────────────────────────────
const parsed = parseCsv('﻿Name,Note,Amount\r\n"Acme, Inc.","said ""hi""\nthen left",1200\nBlue,,5\n');
check('CSV: quotes, embedded commas / quotes / newlines, BOM', parsed.length === 3 && parsed[1][0] === 'Acme, Inc.' && parsed[1][1] === 'said "hi"\nthen left' && parsed[2][1] === '', parsed);
check('CSV: semicolons and tabs are detected', parseCsv('a;b\n1;2')[1][1] === '2' && parseCsv('a\tb\n1\t2')[1][1] === '2');
check('CSV out round-trips', JSON.stringify(parseCsv(toCsv(parsed))) === JSON.stringify(parsed));
check('type guesses', guessFieldType(['1', '2.5', '1,000']).type === 'number' && guessFieldType(['2026-10-01', '2026/10/02']).type === 'date' && guessFieldType(['yes', 'no', 'yes']).type === 'checkbox' && guessFieldType(['a@b.co']).type === 'email' && guessFieldType(['New', 'Won', 'New', 'Lost', 'Won', 'New']).type === 'singleSelect' && guessFieldType(['15%', '20%']).type === 'percent' && guessFieldType(['007', '008']).type === 'text');

console.log(failures ? `\n${failures} check(s) failed` : '\nall base model checks passed');
process.exit(failures ? 1 : 0);
