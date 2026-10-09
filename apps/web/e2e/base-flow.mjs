// Base grid end-to-end (§75, batch 2): typing into cells, pickers, checkbox, new records, fields (formula),
// filter / sort / group / hide, summaries, record drawer + comments, copy / paste, delete, CSV import, live updates.
// node e2e/base-flow.mjs   (needs the web app + API + seed)
import { chromium } from 'playwright';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = process.env.WEB_URL ?? 'http://localhost:3000';
const browser = await chromium.launch();
const errors = [];
let fails = 0;

async function session(email) {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 900 }, timezoneId: 'Asia/Tokyo', permissions: ['clipboard-read', 'clipboard-write'] });
  const users = await (await ctx.request.get(`${BASE}/api/users`)).json();
  await ctx.addCookies([{ name: 'mo_uid', value: users.find((u) => u.email === email).id, url: BASE }]);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${email}: ${e.message}`));
  return page;
}
const step = async (name, page, fn) => {
  try {
    await fn();
    console.log('✓', name);
  } catch (e) {
    fails++;
    console.log('✗', name, '—', process.env.FULL ? e.message.slice(0, 1500) : e.message.split('\n')[0]);
    await page.screenshot({ path: join(tmpdir(), `mo-base-fail-${name.replace(/\W+/g, '_')}.png`), timeout: 10000 }).catch(() => undefined);
  }
};

const hana = await session('hana@hanami.example');
const req = hana.context().request;
// A fresh base for the run, shared with Mika (editor) to watch live updates.
const n = Date.now() % 100000;
const base = await (await req.post(`${BASE}/api/resources`, { data: { name: `Pipeline ${n}`, type: 'base' } })).json();
const users = await (await req.get(`${BASE}/api/users`)).json();
await req.post(`${BASE}/api/resources/${base.id}/members`, { data: { userId: users.find((u) => u.email === 'mika@hanami.example').id, role: 'editor' } });
const schema = await (await req.get(`${BASE}/api/base/${base.id}`)).json();
const t = schema.tables[0];
const fid = (name) => t.fields.find((f) => f.name === name).id;
await req.post(`${BASE}/api/base/tables/${t.id}/fields`, { data: { name: 'Amount', type: 'currency', options: { currency: 'JPY' } } });
await req.post(`${BASE}/api/base/tables/${t.id}/fields`, { data: { name: 'Qty', type: 'number' } });
await req.post(`${BASE}/api/base/tables/${t.id}/fields`, { data: { name: 'Done', type: 'checkbox' } });
await req.post(`${BASE}/api/base/tables/${t.id}/records`, {
  data: { records: [{ values: { Name: 'Acme', Amount: 1200, Qty: 3, Status: 'Todo' } }, { values: { Name: 'Blue Co', Amount: 500, Qty: 10, Status: 'Done' } }, { values: { Name: 'Cobalt', Amount: 800, Qty: 1, Status: 'In progress' } }] },
});
const grid = () => hana.getByTestId('grid');
const cell = (row, field) => hana.locator(`[data-testid="grid-row"]`).nth(row).locator(`[data-testid="grid-cell"][data-field="${field}"]`);
const rows = () => hana.getByTestId('grid-row');
const names = async () => (await hana.locator('[data-testid="grid-cell"][data-field="Name"]').allInnerTexts()).map((x) => x.trim());

await step('the base opens on its first table and grid view', hana, async () => {
  await hana.goto(`${BASE}/base/${base.id}`);
  await rows().first().waitFor({ timeout: 120000 });
  if ((await rows().count()) !== 3) throw new Error(`rows ${await rows().count()}`);
  await hana.getByTestId('base-table').filter({ hasText: 'Table 1' }).waitFor();
  await hana.getByTestId('record-count').getByText('3 records').waitFor();
});

await step('typing over a cell edits it; Enter moves down', hana, async () => {
  await cell(0, 'Name').click();
  await hana.keyboard.type('Acme Corp');
  await hana.keyboard.press('Enter');
  await cell(0, 'Name').getByText('Acme Corp').waitFor();
  await cell(1, 'Name').click();
  await hana.keyboard.press('Enter');
  await hana.getByTestId('cell-input').fill('Blue Company');
  await hana.keyboard.press('Tab');
  await cell(1, 'Name').getByText('Blue Company').waitFor();
  const r = await (await req.get(`${BASE}/api/base/tables/${t.id}/records`)).json();
  if (!r.some((x) => x.values[fid('Name')] === 'Acme Corp')) throw new Error('not saved');
});

await step('number and money cells parse what is typed', hana, async () => {
  await cell(2, 'Amount').click();
  await hana.keyboard.type('¥2,500');
  await hana.keyboard.press('Enter');
  await cell(2, 'Amount').getByText('¥2,500').waitFor();
});

await step('a select cell picks or adds an option', hana, async () => {
  await cell(0, 'Status').dblclick();
  await hana.getByTestId('cell-picker').getByText('Done', { exact: true }).click();
  await cell(0, 'Status').getByText('Done').waitFor();
  await cell(2, 'Status').dblclick();
  await hana.getByLabel('Find an option').fill('Blocked');
  await hana.getByTestId('picker-create').click();
  await cell(2, 'Status').getByText('Blocked').waitFor({ timeout: 15000 });
});

await step('a checkbox toggles with one click', hana, async () => {
  await cell(1, 'Done').getByTestId('cell-checkbox').click();
  await cell(1, 'Done').getByRole('button', { name: 'Checked' }).waitFor();
});

await step('adding a formula field computes it for every record', hana, async () => {
  await hana.getByTestId('add-field').click();
  const dlg = hana.getByTestId('field-dialog');
  await dlg.getByLabel('Field name').fill('Total');
  await dlg.getByRole('radio', { name: 'Formula' }).click();
  await dlg.getByLabel('Formula').fill('{Amount} * {Qty');
  await dlg.getByTestId('formula-status').getByText(/Unclosed/).waitFor();
  await dlg.getByLabel('Formula').fill('{Amount} * {Qty}');
  await dlg.getByTestId('formula-status').getByText(/First record: 3600/).waitFor();
  await hana.getByTestId('field-save').click();
  await cell(0, 'Total').getByText('3600').waitFor();
  await cell(1, 'Total').getByText('5000').waitFor();
});

await step('a new record from the Add record row', hana, async () => {
  await hana.getByTestId('add-record').click();
  await hana.getByTestId('cell-input').waitFor();
  await hana.keyboard.type('Delta');
  await hana.keyboard.press('Enter');
  await hana.getByTestId('record-count').getByText('4 records').waitFor();
  await cell(3, 'Name').getByText('Delta').waitFor();
});

await step('pasting a block of cells (and new rows)', hana, async () => {
  await cell(3, 'Qty').click();
  await hana.evaluate(() => {
    const dt = new DataTransfer();
    dt.setData('text/plain', '4\tyes\n7\tno\n');
    document.querySelector('[data-testid="grid"]').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  await hana.getByTestId('record-count').getByText('5 records').waitFor();
  await cell(3, 'Qty').getByText('4').waitFor();
  await cell(3, 'Done').getByRole('button', { name: 'Checked' }).waitFor();
  await cell(4, 'Qty').getByText('7').waitFor();
});

await step('summaries in the footer', hana, async () => {
  await hana.locator('[data-testid="summary"][data-field="Qty"]').click();
  await hana.getByRole('menuitem', { name: 'Sum' }).click();
  await hana.locator('[data-testid="summary"][data-field="Qty"]').getByText('25').waitFor();
});

await step('sort, filter, group and hide from the toolbar', hana, async () => {
  await hana.getByTestId('tb-sort').click();
  await hana.getByTestId('sort-add').click();
  await hana.getByLabel('Sort field').selectOption({ label: 'Amount' });
  await hana.getByLabel('Sort direction').selectOption('desc');
  await hana.keyboard.press('Escape');
  await hana.waitForFunction(() => document.querySelector('[data-testid="grid-row"] [data-field="Name"]')?.textContent?.includes('Cobalt'));
  await hana.getByTestId('tb-filter').click();
  await hana.getByTestId('filter-add').click();
  await hana.getByLabel('Filter field').selectOption({ label: 'Done' });
  await hana.keyboard.press('Escape');
  await hana.getByTestId('record-count').getByText('2 records').waitFor();
  await hana.getByTestId('tb-filter').click();
  await hana.getByLabel('Remove condition').click();
  await hana.keyboard.press('Escape');
  await hana.getByTestId('record-count').getByText('5 records').waitFor();
  await hana.getByTestId('tb-group').click();
  await hana.getByLabel('Group by').selectOption({ label: 'Status' });
  await hana.keyboard.press('Escape');
  await hana.getByTestId('group-row').first().waitFor();
  if ((await hana.getByTestId('group-row').count()) < 3) throw new Error('groups');
  await hana.getByTestId('tb-group').click();
  await hana.getByLabel('Group by').selectOption('');
  await hana.keyboard.press('Escape');
  await hana.getByTestId('tb-fields').click();
  await hana.locator('[data-testid="tb-field-toggle"][data-field="Notes"]').click();
  await hana.keyboard.press('Escape');
  await hana.locator('[data-testid="grid-header"][data-field="Notes"]').waitFor({ state: 'detached' });
  // The view keeps it for everyone.
  const s = await (await req.get(`${BASE}/api/base/${base.id}`)).json();
  const v = s.tables[0].views[0].config;
  if (!v.hidden.includes(fid('Notes')) || v.sorts[0]?.dir !== 'desc') throw new Error(JSON.stringify(v));
});

await step('the record drawer edits fields and takes comments', hana, async () => {
  await rows().first().hover();
  await rows().first().getByTestId('expand-record').click();
  const d = hana.getByTestId('record-drawer');
  await d.getByTestId('record-title').waitFor();
  await d.locator('[data-testid="record-field"][data-field="Notes"]').getByRole('button').click();
  await d.getByTestId('cell-textarea').fill('Call back on Friday');
  await d.getByLabel('Comment').click();
  await d.locator('[data-testid="record-field"][data-field="Notes"]').getByText('Call back on Friday').waitFor();
  await d.getByLabel('Comment').fill('Sent the quote');
  await d.getByTestId('comment-send').click();
  await d.getByTestId('record-comment').getByText('Sent the quote').waitFor();
  await d.getByRole('button', { name: 'Close' }).click();
  await d.waitFor({ state: 'detached' });
});

await step('another editor sees changes live', hana, async () => {
  const mika = await session('mika@hanami.example');
  await mika.goto(`${BASE}/base/${base.id}`);
  await mika.getByTestId('grid-row').first().waitFor({ timeout: 120000 });
  await mika.waitForTimeout(2500);
  await cell(0, 'Name').click();
  await hana.keyboard.type('Live edit');
  await hana.keyboard.press('Enter');
  await mika.locator('[data-testid="grid-cell"][data-field="Name"]').getByText('Live edit').waitFor({ timeout: 15000 });
  await mika.context().close();
});

await step('selecting records and deleting them', hana, async () => {
  const before = await rows().count();
  await rows().nth(0).hover();
  await rows().nth(0).getByLabel('Select record').check();
  await rows().nth(1).hover();
  await rows().nth(1).getByLabel('Select record').check();
  await hana.getByTestId('selection-bar').getByText('2 selected').waitFor();
  await hana.getByTestId('delete-selected').click();
  await hana.waitForFunction((b) => document.querySelectorAll('[data-testid="grid-row"]').length === b - 2, before);
});

await step('importing a CSV makes a new table', hana, async () => {
  await hana.getByTestId('import-input').setInputFiles({ name: 'suppliers.csv', mimeType: 'text/csv', buffer: Buffer.from('Supplier,Spend,Since\nHanami Print,1200,2024-04-01\nNishi Foods,800,2025-01-15\n') });
  await hana.getByTestId('base-table').filter({ hasText: 'suppliers' }).waitFor();
  await hana.locator('[data-testid="grid-header"][data-field="Spend"]').waitFor();
  await hana.getByTestId('record-count').getByText('2 records').waitFor();
});

await browser.close();
if (errors.length) {
  console.log('page errors:\n' + errors.join('\n'));
  fails++;
}
console.log(fails ? `\n${fails} step(s) failed` : '\nall base e2e steps passed');
process.exit(fails ? 1 : 0);
