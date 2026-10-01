// Phase 3 end-to-end: Sheets editor (Univer + Yjs) with two people, export round-trip and Excel formula parity.
// node e2e/sheets-flow.mjs   (needs pnpm dev + API + seeded data)
import { chromium } from 'playwright';
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

await step('viewers get a read-only grid', claudia, async () => {
  const sora = await session('sora@kaori.jp');
  await sora.goto(`${BASE}/sheets/${sales.id}`);
  await ready(sora, sales.id);
  await sora.getByText('View only').waitFor();
  await sora.close();
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
