// Phase 3 end-to-end: Sheets editor (Univer + Yjs) with two people, export round-trip and Excel formula parity.
// node e2e/sheets-flow.mjs   (needs pnpm dev + API + seeded data)
import { chromium } from 'playwright';
import ExcelJS from 'exceljs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FORMULA_CASES, PARITY_DATA } from './formula-cases.mjs';

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
  page.on('console', (m) => m.type() === 'error' && /binding|setState|Cannot update a component/.test(m.text()) && errors.push(`${email}: ${m.text().slice(0, 200)}`));
  return page;
}
const step = async (name, page, fn) => {
  try {
    await fn();
    console.log('✓', name);
  } catch (e) {
    fails++;
    console.log('✗', name, '—', e.message.split('\n')[0]);
    await page.screenshot({ path: join(tmpdir(), `mo-sheets-fail-${name.replace(/\W+/g, '_')}.png`) });
  }
};
const until = async (page, fn, arg, timeout = 15000) => page.waitForFunction(fn, arg, { timeout, polling: 200 });
const ready = (page, id) => until(page, (unit) => !!window.__moSheet?.api.getWorkbook(unit), id, 60000);
/** Value of a cell through the Univer facade (what the user sees after the formula engine ran). */
const value = (page, sheet, a1) =>
  page.evaluate(([s, a]) => {
    return window.__moSheet.value(s, a);
  }, [sheet, a1]);

const claudia = await session('claudia@kaori.jp');
const mika = await session('mika@kaori.jp');
const find = async (page, q) => (await (await page.request.get(`${BASE}/api/search?q=${encodeURIComponent(q)}`)).json()).find((h) => h.kind === 'resource');
const sales = await find(claudia, 'Sales Report - September 2026');

await step('open the seeded workbook: tabs, formatted cells and computed formulas', claudia, async () => {
  await claudia.goto(`${BASE}/sheets/${sales.id}`);
  await ready(claudia, sales.id);
  for (const tab of ['Sales Data', 'Monthly Summary', 'By Branch', 'Staff Performance']) await claudia.getByText(tab, { exact: true }).first().waitFor();
  await until(claudia, () => window.__moSheet.value('Monthly Summary', 'B8') === 132000);
  const avg = await value(claudia, 'Monthly Summary', 'B10');
  if (Math.round(avg) !== 9222) throw new Error(`AVERAGEIF gave ${avg}`);
  if ((await value(claudia, 'Monthly Summary', 'B16')) !== 'Behind by 68,000') throw new Error('TEXT()/IF chain');
  if ((await value(claudia, 'By Service', 'B9')) !== 'Wax (VIO)') throw new Error('INDEX/MATCH top service: ' + (await value(claudia, 'By Service', 'B9')));
});

await step('a second editor sees typed edits and recalculated formulas live', mika, async () => {
  await mika.goto(`${BASE}/sheets/${sales.id}`);
  await ready(mika, sales.id);
  // Claudia types into a cell with the keyboard (real editor path).
  await claudia.evaluate(() => window.__moSheet.api.getActiveWorkbook().getSheetByName('Sales Data').getRange('F2').activate());
  await claudia.keyboard.type('20000');
  await claudia.keyboard.press('Enter');
  await until(mika, () => window.__moSheet.value('Sales Data', 'F2') === 20000);
  // Dependent formulas recompute on Mika's side from the synced input.
  await until(mika, () => window.__moSheet.value('Monthly Summary', 'B8') === 140000);
});

await step('formulas typed by one editor are shared as formulas', mika, async () => {
  await mika.evaluate(() => window.__moSheet.api.getActiveWorkbook().getSheetByName('Sales Data').getRange('J2').activate());
  await mika.keyboard.type('=SUM(F2:F21)*2');
  await mika.keyboard.press('Enter');
  await until(claudia, () => window.__moSheet.api.getActiveWorkbook().getSheetByName('Sales Data').getRange('J2').getFormula() === '=SUM(F2:F21)*2');
  await until(claudia, () => window.__moSheet.value('Sales Data', 'J2') === 408000);
});

await step('row insert on one side keeps the other editor’s cells aligned', claudia, async () => {
  await claudia.evaluate(() => window.__moSheet.api.getActiveWorkbook().getSheetByName('Sales Data').insertRowsBefore(1, 1));
  await until(mika, () => window.__moSheet.value('Sales Data', 'D3') === 'A. Tanaka');
  // References shift like Excel: the SUM now covers F3:F22.
  await until(mika, () => window.__moSheet.api.getActiveWorkbook().getSheetByName('Sales Data').getRange('J3').getFormula() === '=SUM(F3:F22)*2');
  await claudia.evaluate(() => window.__moSheet.api.getActiveWorkbook().getSheetByName('Sales Data').deleteRows(1, 1));
  await until(mika, () => window.__moSheet.value('Sales Data', 'D2') === 'A. Tanaka');
});

await step('formatting, merges, column widths and new sheets sync', claudia, async () => {
  await claudia.evaluate(() => {
    const ws = window.__moSheet.api.getActiveWorkbook().getSheetByName('Sales Data');
    ws.getRange('H2').setFontWeight('bold').setBackground('#fde68a');
    ws.getRange('K5:L5').merge();
    ws.setColumnWidth(10, 180);
    window.__moSheet.api.getActiveWorkbook().insertSheet('Q4 Plan');
  });
  await until(mika, () => {
    const wb = window.__moSheet.api.getActiveWorkbook();
    const ws = wb.getSheetByName('Sales Data');
    return ws.getRange('H2').getCellStyleData()?.bl === 1 && ws.getRange('K5:L5').isMerged() && ws.getColumnWidth(10) === 180 && !!wb.getSheetByName('Q4 Plan');
  });
});

await step('filters and conditional formatting reach the other editor', claudia, async () => {
  await claudia.evaluate(() => {
    const ws = window.__moSheet.api.getActiveWorkbook().getSheetByName('Sales Data');
    ws.getRange('A1:H21').createFilter();
    const rule = ws.newConditionalFormattingRule().whenNumberGreaterThan(12000).setBackground('#FECACA').setRanges([ws.getRange('F2:F21').getRange()]).build();
    ws.addConditionalFormattingRule(rule);
  });
  await until(mika, () => {
    const ws = window.__moSheet.api.getActiveWorkbook()?.getSheetByName('Sales Data');
    return !!ws?.getFilter() && ws.getConditionalFormattingRules().length === 1;
  });
  // Mika can keep editing after the workbook reloaded with the new rules.
  await mika.evaluate(() => window.__moSheet.api.getActiveWorkbook().getSheetByName('Sales Data').getRange('I2').setValue('after reload'));
  await until(claudia, () => window.__moSheet.value('Sales Data', 'I2') === 'after reload');
});

await step('xlsx export carries the live edits and formulas', claudia, async () => {
  await claudia.waitForTimeout(3000); // debounced store
  const res = await claudia.request.get(`${BASE}/api/resources/${sales.id}/export?format=csv`);
  const text = await res.text();
  if (!text.includes('20000')) throw new Error('csv lacks the edit');
  const x = await claudia.request.get(`${BASE}/api/resources/${sales.id}/export?format=xlsx`);
  if (x.status() !== 200 || (await x.body()).length < 5000) throw new Error('xlsx export');
});

await step('notes and comments sync without rebuilding the other editor’s grid', mika, async () => {
  await mika.evaluate(() => {
    window.__reloads = 0;
    const orig = window.__moSheet.binding.reload.bind(window.__moSheet.binding);
    window.__moSheet.binding.reload = () => (window.__reloads++, orig());
  });
  await claudia.evaluate(async () => {
    const api = window.__moSheet.api;
    const ws = api.getActiveWorkbook().getSheetByName('Sales Data');
    ws.getRange('H3').createOrUpdateNote({ note: 'Call back on Monday', width: 200, height: 80 });
    const ok = await ws.getRange('G4').addCommentAsync(api.newTheadComment().setContent(api.newRichText().insertText('Why canceled?')));
    if (!ok) throw new Error('comment refused');
  });
  await until(mika, () => {
    const ws = window.__moSheet.api.getActiveWorkbook().getSheetByName('Sales Data');
    return ws.getRange('H3').getNote()?.note === 'Call back on Monday' && ws.getRange('G4').getComments().length === 1;
  });
  if ((await mika.evaluate(() => window.__reloads)) !== 0) throw new Error('the grid was rebuilt');
});

await step('charts: insert from a selection, edit, follow the data, sync and delete', claudia, async () => {
  await claudia.evaluate(() => {
    const ws = window.__moSheet.api.getActiveWorkbook().getSheetByName('Sales Data');
    ws.activate();
    ws.getRange('A1:B6').activate();
  });
  await claudia.getByRole('button', { name: 'Insert', exact: true }).click();
  await claudia.getByRole('menuitem', { name: 'Chart' }).click();
  await claudia.getByTestId('chart-editor').waitFor();
  await claudia.locator('[data-testid="sheet-chart"] svg').first().waitFor();
  await mika.locator('[data-testid="sheet-chart"] svg').first().waitFor({ timeout: 15000 });
  await claudia.getByTestId('chart-editor').getByRole('button', { name: 'Line' }).click();
  await until(mika, () => [...window.__moSheet.binding.doc.getMap('charts').values()].some((c) => c.kind === 'line'));
  await claudia.getByRole('button', { name: 'Delete chart' }).click();
  await until(mika, () => document.querySelectorAll('[data-testid="sheet-chart"]').length === 0);
});

await step('viewers get a read-only grid', claudia, async () => {
  const sora = await session('sora@kaori.jp');
  await sora.goto(`${BASE}/sheets/${sales.id}`);
  await ready(sora, sales.id);
  await sora.getByText('View only').waitFor();
  await sora.close();
});

await step('data tools: trim, remove duplicates, split text, column stats, checkboxes', claudia, async () => {
  const wbk = await (await claudia.request.post(`${BASE}/api/resources`, { data: { name: 'Data tools ' + Date.now(), type: 'spreadsheet' } })).json();
  await claudia.goto(`${BASE}/sheets/${wbk.id}`);
  await ready(claudia, wbk.id);
  const sheet = (js) => claudia.evaluate((code) => new Function('ws', code)(window.__moSheet.api.getActiveWorkbook().getActiveSheet()), js);
  const menu = async (top, item) => {
    await claudia.getByRole('button', { name: top, exact: true }).click();
    await claudia.getByRole('menuitem', { name: item, exact: true }).click();
  };
  await sheet(`ws.getRange('A1:C6').setValues([['Name','City','Amount'],['  Ann   Lee ','Tokyo',10],['Bob','Osaka',20],['ann lee','tokyo',10],['Bob','Osaka',20],['Cy','Kyoto',5]]);
    ws.getRange('D2').setFormula('=C2*2'); ws.getRange('A1').activate();`);
  await menu('Data', 'Trim whitespace');
  if ((await sheet(`return ws.getRange('A2').getValue()`)) !== 'Ann Lee') throw new Error('trim');
  await sheet(`ws.getRange('A1:C6').activate()`);
  await menu('Data', 'Remove duplicates');
  await claudia.getByTestId('remove-duplicates-confirm').click();
  const rows = await sheet(`return ws.getRange('A1:A6').getValues().map((r) => r[0])`);
  if (JSON.stringify(rows) !== JSON.stringify(['Name', 'Ann Lee', 'Bob', 'Cy', null, null])) throw new Error('dedupe ' + JSON.stringify(rows));
  if ((await sheet(`return ws.getRange('D2').getFormula()`)) !== '=C2*2') throw new Error('formula lost');
  await sheet(`ws.getRange('F1:F3').setValues([['a,b,3'],['c,d'],['x']]); ws.getRange('F1:F3').activate();`);
  await menu('Data', 'Detect automatically');
  if (JSON.stringify(await sheet(`return ws.getRange('F1:H1').getValues()[0]`)) !== '["a","b",3]') throw new Error('split');
  await sheet(`ws.getRange('C2').activate()`);
  await menu('Data', 'Column stats');
  await claudia.getByTestId('column-stats').getByText('35', { exact: true }).waitFor();
  await sheet(`ws.getRange('J1:J3').activate()`);
  await menu('Insert', 'Checkbox');
  if ((await sheet(`return ws.getRange('J2').getDataValidation()?.getCriteriaType()`)) !== 'checkbox') throw new Error('checkbox');
});

await step('pivot tables: build, filter, follow the source, sync and delete', claudia, async () => {
  const wbk = await (await claudia.request.post(`${BASE}/api/resources`, { data: { name: 'Pivot ' + Date.now(), type: 'spreadsheet' } })).json();
  const mikaId = (await (await claudia.request.get(`${BASE}/api/users`)).json()).find((u) => u.email === 'mika@kaori.jp').id;
  await claudia.request.post(`${BASE}/api/resources/${wbk.id}/members`, { data: { userId: mikaId, role: 'editor' } });
  for (const p of [claudia, mika]) {
    await p.goto(`${BASE}/sheets/${wbk.id}`);
    await ready(p, wbk.id);
  }
  await claudia.evaluate(() => {
    const ws = window.__moSheet.api.getActiveWorkbook().getActiveSheet();
    ws.getRange('A1:C7').setValues([['Region', 'Month', 'Sales'], ['East', 'Oct', 10], ['East', 'Nov', 5], ['West', 'Oct', 3], ['West', 'Nov', 4], ['East', 'Oct', 7], ['West', 'Nov', 1]]);
    ws.getRange('A1').activate();
  });
  await claudia.getByRole('button', { name: 'Insert', exact: true }).click();
  await claudia.getByRole('menuitem', { name: 'Pivot table' }).click();
  await claudia.getByTestId('pivot-add-rows').selectOption({ label: 'Region' });
  await claudia.getByTestId('pivot-add-columns').selectOption({ label: 'Month' });
  await claudia.getByTestId('pivot-add-values').selectOption({ label: 'Sales' });
  await until(mika, (r) => window.__moSheet.api.getActiveWorkbook().getSheetByName('Pivot table 1')?.getRange(r).getValues().flat().join(',') === 'Grand Total,10,20,30', 'A5:D5');
  // Mika edits the source: her client refreshes the table, Claudia receives it.
  await mika.evaluate(() => window.__moSheet.api.getActiveWorkbook().getSheetByName('Sheet1').getRange('C2').setValue(100));
  await until(claudia, (r) => window.__moSheet.api.getActiveWorkbook().getSheetByName('Pivot table 1')?.getRange(r).getValues().flat().join(',') === 'East,5,107,112', 'A3:D3');
  await claudia.getByTestId('pivot-add-filters').selectOption({ label: 'Region' });
  await claudia.getByTestId('pivot-filters-item').getByLabel('West').uncheck();
  await until(mika, (r) => window.__moSheet.api.getActiveWorkbook().getSheetByName('Pivot table 1')?.getRange(r).getValues().flat().join(',') === 'Grand Total,5,107,112', 'A4:D4');
  await claudia.getByRole('button', { name: 'Delete pivot table' }).click();
  await until(mika, (r) => window.__moSheet.api.getActiveWorkbook().getSheetByName('Pivot table 1')?.getRange(r).getValues().flat().every((v) => v === null || v === ''), 'A1:D5');
  if (await mika.evaluate(() => window.__moSheet.binding.doc.getMap('pivots').size)) throw new Error('definition left behind');
});

await step('cursors, named ranges, text rotation and protected ranges between editors', claudia, async () => {
  const wbk = await (await claudia.request.post(`${BASE}/api/resources`, { data: { name: 'Collab ' + Date.now(), type: 'spreadsheet' } })).json();
  const people = await (await claudia.request.get(`${BASE}/api/users`)).json();
  const idOf = (email) => people.find((u) => u.email === email).id;
  for (const email of ['mika@kaori.jp', 'sora@kaori.jp']) await claudia.request.post(`${BASE}/api/resources/${wbk.id}/members`, { data: { userId: idOf(email), role: 'editor' } });
  const sora = await session('sora@kaori.jp');
  for (const p of [claudia, mika, sora]) {
    await p.goto(`${BASE}/sheets/${wbk.id}`);
    await ready(p, wbk.id);
  }
  // Edits go through Univer's commands, which check the range permissions like typing does.
  const setAt = (p, a1, v) => p.evaluate(([a, x]) => window.__moSheet.api.getActiveWorkbook().getActiveSheet().getRange(a).setValue(x), [a1, v]);
  await claudia.evaluate(async (mikaId) => {
    const wb = window.__moSheet.api.getActiveWorkbook();
    const ws = wb.getActiveSheet();
    ws.getRange('A1:A3').setValues([[1], [2], [3]]);
    ws.getRange('B1').setValue('Rotated').setTextRotation(45);
    wb.insertDefinedName('Nums', 'Sheet1!$A$1:$A$3');
    await ws.getRange('A1:A3').getRangePermission().protect({ name: 'Locked numbers', allowedUsers: [mikaId] });
    ws.getRange('C3:D5').activate();
  }, idOf('mika@kaori.jp'));
  await mika.getByTestId('sheet-cursor').filter({ hasText: 'Claudia' }).waitFor();
  await until(mika, () => window.__moSheet.api.getActiveWorkbook().getActiveSheet().getRange('B1').getCellStyleData()?.tr?.a === 45);
  await mika.evaluate(() => window.__moSheet.api.getActiveWorkbook().getActiveSheet().getRange('E1').setFormula('=SUM(Nums)'));
  await until(claudia, () => window.__moSheet.value('Sheet1', 'E1') === 6);
  // Mika is on the rule's list, Sora is not — also after reopening.
  await until(sora, () => window.__moSheet.api.getActiveWorkbook().getActiveSheet().getRange('A2').getRangePermission().isProtected());
  await sora.reload();
  await ready(sora, wbk.id);
  await sora.waitForTimeout(1000);
  await setAt(sora, 'A2', 99);
  await setAt(mika, 'A3', 30);
  await until(claudia, () => window.__moSheet.value('Sheet1', 'A3') === 30);
  await claudia.waitForTimeout(800);
  if ((await value(claudia, 'Sheet1', 'A2')) !== 2) throw new Error('Sora edited a protected range');
  await sora.close();
});

await step('Excel conditional formats, validation, notes and named ranges survive import and export', claudia, async () => {
  const src = new ExcelJS.Workbook();
  const ws = src.addWorksheet('Data');
  [5, 15, 25].forEach((v, i) => (ws.getCell(i + 1, 1).value = v));
  ws.addConditionalFormatting({ ref: 'A1:A3', rules: [{ type: 'cellIs', operator: 'greaterThan', formulae: ['10'], style: { font: { bold: true } }, priority: 1 }] });
  ws.addConditionalFormatting({ ref: 'B1:B3', rules: [{ type: 'colorScale', cfvo: [{ type: 'min' }, { type: 'max' }], color: [{ argb: 'FFF8696B' }, { argb: 'FF63BE7B' }], priority: 2 }] });
  ws.dataValidations.add('C1:C3', { type: 'list', allowBlank: true, formulae: ['"Low,High"'] });
  ws.getCell('D1').value = 'see note';
  ws.getCell('D1').note = 'Imported note';
  src.definedNames.add('Data!$A$1:$A$3', 'Amounts');
  const res = await claudia.request.post(`${BASE}/api/resources/upload`, {
    multipart: { file: { name: 'Rules.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from(await src.xlsx.writeBuffer()) } },
  });
  const up = await res.json();
  await claudia.goto(`${BASE}/sheets/${up.id}`);
  await ready(claudia, up.id);
  await until(claudia, () => {
    const wb = window.__moSheet.api.getActiveWorkbook();
    const s = wb.getSheetByName('Data');
    return s.getConditionalFormattingRules().length === 2 && s.getRange('C1').getDataValidation()?.getCriteriaType() === 'list' && s.getRange('D1').getNote()?.note === 'Imported note' && !!wb.getDefinedName('Amounts');
  });
  await claudia.evaluate(() => window.__moSheet.api.getActiveWorkbook().getActiveSheet().getRange('E1').setFormula('=SUM(Amounts)'));
  await until(claudia, () => window.__moSheet.value('Data', 'E1') === 45);
  // And back out to Excel.
  const x = await claudia.request.get(`${BASE}/api/resources/${up.id}/export?format=xlsx`);
  const back = new ExcelJS.Workbook();
  await back.xlsx.load(await x.body());
  const bws = back.getWorksheet('Data');
  if (bws.conditionalFormattings.length !== 2) throw new Error('conditional formats not exported');
  if (!Object.values(bws.dataValidations.model).some((v) => v.type === 'list')) throw new Error('validation not exported');
  if (!back.definedNames.model.some((n) => n.name === 'Amounts')) throw new Error('named range not exported');
});

// ── Excel formula parity ─────────────────────────────────────────────────────
const created = await (await claudia.request.post(`${BASE}/api/resources`, { data: { name: 'Formula parity ' + Date.now(), type: 'spreadsheet' } })).json();
const mismatches = [];
await step(`Excel formula parity (${FORMULA_CASES.length} formulas)`, claudia, async () => {
  await claudia.goto(`${BASE}/sheets/${created.id}`);
  await ready(claudia, created.id);
  const got = await claudia.evaluate(
    async ([data, cases]) => {
      const wb = window.__moSheet.api.getActiveWorkbook();
      const ws = wb.getActiveSheet();
      ws.getRange(0, 0, data.length, data[0].length).setValues(data);
      ws.getRange(0, 7, cases.length, 1).setValues(cases.map((c) => [c.f]));
      // Wait for the engine to settle (values stop changing).
      let last = '';
      for (let i = 0; i < 60; i++) {
        await new Promise((r) => setTimeout(r, 250));
        const now = JSON.stringify(ws.getRange(0, 7, cases.length, 1).getRawValues());
        if (now === last && !now.includes('null')) break;
        last = now;
      }
      const name = ws.getSheetName();
      return cases.map((_, i) => window.__moSheet.value(name, 'H' + (i + 1)));
    },
    [PARITY_DATA, FORMULA_CASES],
  );
  FORMULA_CASES.forEach((c, i) => {
    const g = got[i];
    const ok = typeof c.v === 'number' ? typeof g === 'number' && Math.abs(g - c.v) <= 1e-6 * Math.max(1, Math.abs(c.v)) : g === c.v;
    if (!ok) mismatches.push(`${c.f}  →  got ${JSON.stringify(g)}, Excel ${JSON.stringify(c.v)}`);
  });
  if (mismatches.length) throw new Error(`${mismatches.length} differ from Excel`);
});
if (mismatches.length) console.log('  ' + mismatches.join('\n  '));

await claudia.request.post(`${BASE}/api/resources/${created.id}/trash`);
await claudia.request.delete(`${BASE}/api/resources/${created.id}`);
console.log(errors.length ? 'browser errors:\n' + [...new Set(errors)].join('\n') : 'no browser errors');
console.log(fails ? `${fails} failed` : 'all passed');
await browser.close();
process.exit(fails || errors.length ? 1 : 0);
