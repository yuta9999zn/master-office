// Phase 3.3 end-to-end: Sheets formatting & view tools — alternating colors.
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

await claudia.request.delete(`${BASE}/api/resources/${book.id}`);
await browser.close();
console.log(errors.length ? `browser errors:\n  ${errors.join('\n  ')}` : 'no browser errors');
if (errors.length) fails++;
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
