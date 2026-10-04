// Phase 3.3 end-to-end: Sheets formatting & view tools — alternating colors, show formulas, groups, filter views.
// node e2e/sheets-format-flow.mjs   (needs pnpm dev + API + seeded data)
import { chromium } from 'playwright';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = process.env.WEB_URL ?? 'http://localhost:3000';
const browser = await chromium.launch();
const errors = [];
let fails = 0;

async function session(email) {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 940 } });
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
    console.log('✗', name, '—', e.message.split('\n')[0]);
    await page.screenshot({ path: join(tmpdir(), `mo-format-fail-${name.replace(/\W+/g, '_')}.png`) });
  }
};
const until = async (page, fn, arg, timeout = 15000) => page.waitForFunction(fn, arg, { timeout, polling: 200 });
const ready = (page, id) => until(page, (u) => !!window.__moSheet?.api.getWorkbook(u), id, 120000);
/** Background colours of the conditional-format rules on the active sheet, with their A1 ranges. */
const rules = (page) =>
  page.evaluate(() => {
    const ws = window.__moSheet.api.getActiveWorkbook().getActiveSheet();
    const col = (i) => String.fromCharCode(65 + i);
    const hex = (c) => (c ?? '').replace(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/, (_, r, g, b) => '#' + [r, g, b].map((n) => Number(n).toString(16).padStart(2, '0')).join('').toUpperCase());
    return ws
      .getConditionalFormattingRules()
      .map((r) => `${r.ranges.map((g) => `${col(g.startColumn)}${g.startRow + 1}:${col(g.endColumn)}${g.endRow + 1}`).join(',')}=${hex(r.rule.style?.bg?.rgb)}`)
      .sort();
  });
const menu = async (page, top, item) => {
  await page.getByRole('button', { name: top, exact: true }).click();
  await page.getByRole('menuitem', { name: item }).click();
};

const claudia = await session('claudia@kaori.jp');
const users = await (await claudia.request.get(`${BASE}/api/users`)).json();
const book = await (await claudia.request.post(`${BASE}/api/resources`, { data: { name: `Format test ${Date.now()}`, type: 'spreadsheet' } })).json();
await claudia.request.post(`${BASE}/api/resources/${book.id}/members`, { data: { userId: users.find((u) => u.email === 'mika@kaori.jp').id, role: 'editor' } });

await step('Format → Alternating colors bands the data region with a header', claudia, async () => {
  await claudia.goto(`${BASE}/sheets/${book.id}`);
  await ready(claudia, book.id);
  await claudia.evaluate(() => {
    const ws = window.__moSheet.api.getActiveWorkbook().getActiveSheet();
    ws.getRange('A1:C6').setValues([['Name', 'Branch', 'Sales'], ['Aya', '575', 120], ['Ken', '625', 90], ['Mika', 'S2', 140], ['Sora', '575', 75], ['Rina', '625', 110]]);
    ws.getRange('B3').activate();
  });
  await menu(claudia, 'Format', 'Alternating colors');
  await claudia.getByTestId('banding-panel').waitFor();
  const range = await claudia.getByTestId('banding-range').innerText();
  if (range !== 'A1:C6') throw new Error(`range ${range}`);
  const got = (await rules(claudia)).join(' ');
  for (const want of ['A1:C1=#5B95F9', 'A2:C6=#FFFFFF', 'A2:C6=#E8F0FE']) if (!got.includes(want)) throw new Error(`missing ${want} in ${got}`);
});

await step('footer and another style rewrite the rules, and the other editor sees them', claudia, async () => {
  await claudia.getByRole('checkbox', { name: 'Footer' }).check();
  await claudia.getByRole('button', { name: 'Style 3' }).click();
  await until(claudia, () => window.__moSheet.api.getActiveWorkbook().getActiveSheet().getConditionalFormattingRules().length === 4);
  const got = (await rules(claudia)).join(' ');
  for (const want of ['A1:C1=#63D297', 'A6:C6=#AFE9CA', 'A2:C5=#E7F9EF']) if (!got.includes(want)) throw new Error(`missing ${want} in ${got}`);
  const mika = await session('mika@kaori.jp');
  await mika.goto(`${BASE}/sheets/${book.id}`);
  await ready(mika, book.id);
  await until(mika, () => window.__moSheet.api.getActiveWorkbook().getActiveSheet().getConditionalFormattingRules().length === 4, null, 30000);
  // Mika opens the same banding from a cell inside it.
  await mika.evaluate(() => window.__moSheet.api.getActiveWorkbook().getActiveSheet().getRange('C4').activate());
  await menu(mika, 'Format', 'Alternating colors');
  await mika.getByTestId('banding-range').getByText('A1:C6').waitFor();
  if ((await mika.evaluate(() => window.__moSheet.api.getActiveWorkbook().getActiveSheet().getConditionalFormattingRules().length)) !== 4) throw new Error('opened a second banding');
  await mika.context().close();
});

await step('inserted rows extend the bands', claudia, async () => {
  await claudia.evaluate(() => window.__moSheet.api.getActiveWorkbook().getActiveSheet().insertRowsBefore(3, 2));
  await claudia.getByTestId('banding-range').getByText('A1:C8').waitFor();
});

await step('Remove alternating colors deletes its rules only', claudia, async () => {
  // An unrelated rule must survive.
  await claudia.evaluate(() => {
    const ws = window.__moSheet.api.getActiveWorkbook().getActiveSheet();
    ws.addConditionalFormattingRule(ws.newConditionalFormattingRule().whenNumberGreaterThan(100).setFontColor('#B91C1C').setRanges([ws.getRange('C2:C8').getRange()]).build());
  });
  await claudia.getByTestId('banding-remove').click();
  await until(claudia, () => window.__moSheet.api.getActiveWorkbook().getActiveSheet().getConditionalFormattingRules().length === 1);
});

/** What the grid shows in a cell (display interceptors applied) vs. what is stored. */
const shown = (page, a1) =>
  page.evaluate((a) => {
    const ws = window.__moSheet.api.getActiveWorkbook().getActiveSheet();
    const r = ws.getRange(a);
    return ws.getSheet().getCell(r.getRow(), r.getColumn())?.v ?? null;
  }, a1);

await step('View → Show formulas shows formulas for this person only; values stay stored', claudia, async () => {
  await claudia.evaluate(() => {
    const ws = window.__moSheet.api.getActiveWorkbook().getActiveSheet();
    ws.getRange('F1:F2').setValues([[2], [3]]);
    ws.getRange('F3').setFormula('=SUM(F1:F2)');
  });
  await until(claudia, () => window.__moSheet.value(window.__moSheet.api.getActiveWorkbook().getActiveSheet().getSheetName(), 'F3') === 5);
  await menu(claudia, 'View', 'Show formulas');
  await until(claudia, () => {
    const ws = window.__moSheet.api.getActiveWorkbook().getActiveSheet();
    return ws.getSheet().getCell(2, 5)?.v === '=SUM(F1:F2)';
  });
  if ((await shown(claudia, 'F1')) !== 2) throw new Error('plain values changed');
  const mika = await session('mika@kaori.jp');
  await mika.goto(`${BASE}/sheets/${book.id}`);
  await ready(mika, book.id);
  await until(mika, () => window.__moSheet.api.getActiveWorkbook().getActiveSheet().getSheet().getCell(2, 5)?.v === 5, null, 30000);
  await mika.context().close();
});

await step('the setting survives a reload, and Ctrl+` turns it off', claudia, async () => {
  await claudia.reload();
  await ready(claudia, book.id);
  await until(claudia, () => window.__moSheet.api.getActiveWorkbook().getActiveSheet().getSheet().getCell(2, 5)?.v === '=SUM(F1:F2)', null, 30000);
  await claudia.keyboard.press('Control+Backquote');
  await until(claudia, () => window.__moSheet.api.getActiveWorkbook().getActiveSheet().getSheet().getCell(2, 5)?.v === 5);
});

const hiddenRows = (page) => page.evaluate(() => { const ws = window.__moSheet.api.getActiveWorkbook().getActiveSheet().getSheet(); const out = []; for (let r = 0; r < 14; r++) if (!ws.getRowVisible(r)) out.push(r + 1); return out.join(','); });
const hiddenCols = (page) => page.evaluate(() => { const ws = window.__moSheet.api.getActiveWorkbook().getActiveSheet().getSheet(); const out = []; for (let c = 0; c < 8; c++) if (!ws.getColVisible(c)) out.push(c + 1); return out.join(','); });
const selectA1 = (page, a1) => page.evaluate((a) => window.__moSheet.api.getActiveWorkbook().getActiveSheet().getRange(a).activate(), a1);

await step('View → Group rows draws a toggle; collapsing hides the rows for everyone', claudia, async () => {
  await claudia.evaluate(() => window.__moSheet.api.getActiveWorkbook().insertSheet('Outline'));
  await claudia.evaluate(() => window.__moSheet.api.getActiveWorkbook().getActiveSheet().getRange('A1:A10').setValues([[1], [2], [3], [4], [5], [6], [7], [8], [9], [10]]));
  await selectA1(claudia, 'A3:A5');
  await menu(claudia, 'View', /^Group rows/);
  await claudia.getByRole('button', { name: 'Collapse rows 3–5' }).click();
  await until(claudia, () => !window.__moSheet.api.getActiveWorkbook().getActiveSheet().getSheet().getRowVisible(2));
  if ((await hiddenRows(claudia)) !== '3,4,5') throw new Error(`hidden ${await hiddenRows(claudia)}`);
  const mika = await session('mika@kaori.jp');
  await mika.goto(`${BASE}/sheets/${book.id}`);
  await ready(mika, book.id);
  await mika.evaluate(() => { const wb = window.__moSheet.api.getActiveWorkbook(); wb.setActiveSheet(wb.getSheetByName('Outline')); });
  await mika.getByRole('button', { name: 'Expand rows 3–5' }).waitFor({ timeout: 20000 });
  if ((await hiddenRows(mika)) !== '3,4,5') throw new Error(`mika sees ${await hiddenRows(mika)}`);
  await mika.context().close();
});

await step('groups follow inserted rows, nest, and expand / collapse all', claudia, async () => {
  await claudia.getByRole('button', { name: 'Expand rows 3–5' }).click();
  await until(claudia, () => window.__moSheet.api.getActiveWorkbook().getActiveSheet().getSheet().getRowVisible(2));
  await claudia.evaluate(() => window.__moSheet.api.getActiveWorkbook().getActiveSheet().insertRowsBefore(0, 1));
  await claudia.getByRole('button', { name: 'Collapse rows 4–6' }).waitFor();
  await selectA1(claudia, 'A5:A5');
  await claudia.keyboard.press('Alt+Shift+ArrowRight');
  await claudia.getByRole('button', { name: 'Collapse rows 5–5' }).waitFor();
  await menu(claudia, 'View', 'Collapse all row groups');
  await until(claudia, () => !window.__moSheet.api.getActiveWorkbook().getActiveSheet().getSheet().getRowVisible(3));
  if ((await hiddenRows(claudia)) !== '4,5,6') throw new Error(`hidden ${await hiddenRows(claudia)}`);
  await menu(claudia, 'View', 'Expand all row groups');
  await until(claudia, () => window.__moSheet.api.getActiveWorkbook().getActiveSheet().getSheet().getRowVisible(4));
});

await step('Alt+Shift+← ungroups the innermost group; column groups hide columns', claudia, async () => {
  await selectA1(claudia, 'A5:A5');
  await claudia.keyboard.press('Alt+Shift+ArrowLeft');
  await claudia.getByRole('button', { name: 'Collapse rows 5–5' }).waitFor({ state: 'detached' });
  await claudia.getByRole('button', { name: 'Collapse rows 4–6' }).waitFor();
  await selectA1(claudia, 'C1:D1');
  await menu(claudia, 'View', /^Group columns/);
  await claudia.getByRole('button', { name: 'Collapse columns 3–4' }).click();
  await until(claudia, () => !window.__moSheet.api.getActiveWorkbook().getActiveSheet().getSheet().getColVisible(2));
  if ((await hiddenCols(claudia)) !== '3,4') throw new Error(`hidden cols ${await hiddenCols(claudia)}`);
});

const filtered = (page) => page.evaluate(() => { const ws = window.__moSheet.api.getActiveWorkbook().getActiveSheet().getSheet(); const out = []; for (let r = 0; r < 10; r++) if (ws.getRowFiltered(r)) out.push(r + 1); return out.join(','); });

await step('Data → Create filter view filters by values on this screen only', claudia, async () => {
  await claudia.evaluate(() => {
    const wb = window.__moSheet.api.getActiveWorkbook();
    wb.insertSheet('Views');
    const ws = wb.getActiveSheet();
    ws.getRange('A1:C7').setValues([['Name', 'Branch', 'Sales'], ['Aya', '575', 120], ['Ken', '625', 90], ['Mika', 'S2', 140], ['Sora', '625', 75], ['Rina', '575', 110], ['Hana', 'S2', 95]]);
    ws.getRange('B2').activate();
  });
  await menu(claudia, 'Data', 'Create filter view');
  await claudia.getByTestId('filter-view-bar').getByText('A1:C7').waitFor();
  const panel = claudia.getByTestId('filter-view-panel');
  await panel.getByLabel('Filter column').selectOption({ label: 'Branch' });
  await panel.getByTestId('filter-values').getByRole('checkbox', { name: '625' }).uncheck();
  await until(claudia, () => window.__moSheet.api.getActiveWorkbook().getActiveSheet().getSheet().getRowFiltered(2));
  if ((await filtered(claudia)) !== '3,5') throw new Error(`filtered ${await filtered(claudia)}`);
  const mika = await session('mika@kaori.jp');
  await mika.goto(`${BASE}/sheets/${book.id}`);
  await ready(mika, book.id);
  await mika.evaluate(() => { const wb = window.__moSheet.api.getActiveWorkbook(); wb.setActiveSheet(wb.getSheetByName('Views')); });
  await mika.waitForTimeout(1500);
  if ((await filtered(mika)) !== '') throw new Error(`Mika's rows are filtered: ${await filtered(mika)}`);
  await mika.getByRole('button', { name: 'Data', exact: true }).click();
  await mika.getByRole('menuitem', { name: 'Filter 1' }).waitFor();
  await mika.context().close();
});

await step('the view follows edits, closes, and reopens from the Data menu', claudia, async () => {
  await claudia.evaluate(() => window.__moSheet.api.getActiveWorkbook().getActiveSheet().getRange('B7').setValue('625'));
  await until(claudia, () => window.__moSheet.api.getActiveWorkbook().getActiveSheet().getSheet().getRowFiltered(6));
  await claudia.getByRole('button', { name: 'Close filter view' }).click();
  await until(claudia, () => !window.__moSheet.api.getActiveWorkbook().getActiveSheet().getSheet().getRowFiltered(2));
  await menu(claudia, 'Data', 'Filter 1');
  await until(claudia, () => window.__moSheet.api.getActiveWorkbook().getActiveSheet().getSheet().getRowFiltered(2));
  if ((await filtered(claudia)) !== '3,5,7') throw new Error(`filtered ${await filtered(claudia)}`);
  await claudia.getByTestId('filter-view-delete').click();
  await until(claudia, () => !window.__moSheet.api.getActiveWorkbook().getActiveSheet().getSheet().getRowFiltered(2));
});

await claudia.request.delete(`${BASE}/api/resources/${book.id}`);
await browser.close();
console.log(errors.length ? `browser errors:\n  ${errors.join('\n  ')}` : 'no browser errors');
if (errors.length) fails++;
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
