// Macro triggers end-to-end: onEdit / onOpen simple triggers, on/off switch, no loops, per-user execution, import.
// node e2e/macro-triggers-flow.mjs   (needs pnpm dev + API + seeded data)
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
    await page.screenshot({ path: join(tmpdir(), `mo-triggers-fail-${name.replace(/\W+/g, '_')}.png`) });
  }
};
const until = async (page, fn, arg, timeout = 15000) => page.waitForFunction(fn, arg, { timeout, polling: 200 });
const ready = (page, id) => until(page, (u) => !!window.__moSheet?.api.getWorkbook(u), id, 120000);
const cell = (page, a1) => page.evaluate((a) => window.__moSheet.value(window.__moSheet.api.getActiveWorkbook().getActiveSheet().getSheetName(), a), a1);
const cellIs = (page, a1, v, timeout) => until(page, ([a, want]) => window.__moSheet.value(window.__moSheet.api.getActiveWorkbook().getActiveSheet().getSheetName(), a) === want, [a1, v], timeout);
const select = (page, a1) => page.evaluate((a) => window.__moSheet.api.getActiveWorkbook().getActiveSheet().getRange(a).activate(), a1);
const focusGrid = async (page) => {
  // The grid is the largest canvas (the formula bar has its own).
  const boxes = await Promise.all((await page.locator('.mo-univer canvas').all()).map((c) => c.boundingBox()));
  const box = boxes.filter(Boolean).sort((a, b) => b.width * b.height - a.width * a.height)[0];
  await page.mouse.click(box.x + box.width * 0.6, box.y + box.height * 0.7);
};
/** Types into a cell the way a user does (the edit is local, so it fires onEdit). */
const typeInto = async (page, a1, text) => {
  await focusGrid(page);
  await page.waitForTimeout(300); // the click's own selection lands first
  await select(page, a1);
  await until(page, (a) => window.__moSheet.api.getActiveWorkbook().getActiveSheet().getSelection().getActiveRange().getA1Notation() === a, a1);
  await page.keyboard.type(text);
  await page.keyboard.press('Enter');
};
const setCode = async (page, code) => {
  await page.locator('[data-testid="macro-code"] .cm-content').click();
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Delete');
  await page.locator('[data-testid="macro-code"] .cm-content').evaluate((el, c) => {
    const view = el.cmView?.view ?? el.closest('.cm-editor')?.cmView?.view;
    if (view) view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: c } });
    else document.execCommand('insertText', false, c);
  }, code);
};
const openMacros = async (page) => {
  await page.getByRole('button', { name: 'Extensions' }).click();
  await page.getByRole('menuitem', { name: /Manage macros/ }).click();
  await page.getByTestId('macros-panel').waitFor();
};
const newScript = async (page, code) => {
  await page.getByRole('button', { name: 'New script' }).click();
  await page.getByTestId('macro-editor').waitFor();
  await setCode(page, code);
  await page.getByRole('button', { name: 'Back to macros' }).click();
};

const claudia = await session('claudia@hanami.example');
const users = await (await claudia.request.get(`${BASE}/api/users`)).json();
const book = await (await claudia.request.post(`${BASE}/api/resources`, { data: { name: `Trigger test ${Date.now()}`, type: 'spreadsheet' } })).json();
const other = await (await claudia.request.post(`${BASE}/api/resources`, { data: { name: `Import target ${Date.now()}`, type: 'spreadsheet' } })).json();
await claudia.request.post(`${BASE}/api/resources/${book.id}/members`, { data: { userId: users.find((u) => u.email === 'mika@hanami.example').id, role: 'editor' } });

await step('scripts with onEdit / onOpen show up as triggers', claudia, async () => {
  await claudia.goto(`${BASE}/sheets/${book.id}`);
  await ready(claudia, book.id);
  await openMacros(claudia);
  // Writes to column B and counts calls in E1: if its own writes fired onEdit, E1 would run away.
  await newScript(
    claudia,
    `function onEdit(e) {
  var sheet = e.source.getActiveSheet();
  var n = sheet.getRange('E1');
  n.setValue(Number(n.getValue() || 0) + 1);
  if (e.range.getColumn() === 1 && e.value) {
    e.range.offset(0, 1).setValue(e.user.getEmail() + ' was ' + (e.oldValue || 'empty'));
  }
}`,
  );
  await newScript(claudia, `function onOpen(e) {\n  var c = SpreadsheetApp.getActiveSheet().getRange('D1');\n  c.setValue(Number(c.getValue() || 0) + 1);\n}`);
  const items = claudia.getByTestId('trigger-item');
  await items.filter({ hasText: 'On edit' }).waitFor();
  await items.filter({ hasText: 'On open' }).waitFor();
  // Creating an onOpen macro does not run it: it runs when the file is opened.
  await claudia.waitForTimeout(800);
  if ((await cell(claudia, 'D1')) !== null) throw new Error('onOpen ran without an open');
});

await step('onEdit runs on a typed edit with e.value, e.oldValue and e.user — and never on its own writes', claudia, async () => {
  await typeInto(claudia, 'A3', 'apple');
  await cellIs(claudia, 'B3', 'claudia@hanami.example was empty');
  await typeInto(claudia, 'A3', 'pear');
  await cellIs(claudia, 'B3', 'claudia@hanami.example was apple');
  await claudia.waitForTimeout(1200);
  if ((await cell(claudia, 'E1')) !== 2) throw new Error(`onEdit ran ${await cell(claudia, 'E1')} times for 2 edits`);
  await claudia.getByTestId('macro-executions').getByText('onEdit').first().waitFor();
});

await step("another editor's edit runs the trigger once, in their browser, as them", claudia, async () => {
  const mika = await session('mika@hanami.example');
  await mika.goto(`${BASE}/sheets/${book.id}`);
  await ready(mika, book.id);
  await typeInto(mika, 'A5', 'plum');
  await cellIs(mika, 'B5', 'mika@hanami.example was empty');
  await cellIs(claudia, 'B5', 'mika@hanami.example was empty');
  await claudia.waitForTimeout(1500);
  if ((await cell(claudia, 'E1')) !== 3) throw new Error(`E1 = ${await cell(claudia, 'E1')} (expected 3: Claudia must not also run it)`);
  await mika.context().close();
});

await step('onOpen runs when the file is opened', claudia, async () => {
  // Every editor who opens the file runs it (Mika's visit above may already have counted one).
  const before = Number((await cell(claudia, 'D1')) ?? 0);
  await claudia.reload();
  await ready(claudia, book.id);
  await cellIs(claudia, 'D1', before + 1, 20000);
  await claudia.waitForTimeout(1500);
  if ((await cell(claudia, 'D1')) !== before + 1) throw new Error('onOpen ran more than once for one opening');
});

await step('a trigger switched off does not run', claudia, async () => {
  await openMacros(claudia);
  const sw = claudia.getByRole('switch', { name: /On edit trigger/ });
  await sw.click();
  await until(claudia, () => document.querySelector('[role="switch"][aria-label^="On edit"]')?.getAttribute('aria-checked') === 'false');
  await typeInto(claudia, 'A6', 'fig');
  await claudia.waitForTimeout(2000);
  if ((await cell(claudia, 'B6')) !== null) throw new Error('disabled trigger ran');
  await sw.click();
});

await step('Import copies macros from another spreadsheet', claudia, async () => {
  await claudia.goto(`${BASE}/sheets/${other.id}`);
  await ready(claudia, other.id);
  await openMacros(claudia);
  await claudia.getByTestId('macro-import').click();
  const dlg = claudia.getByTestId('import-macros');
  await dlg.getByRole('button', { name: book.name }).click();
  await dlg.getByRole('checkbox').first().waitFor();
  for (const box of await dlg.getByRole('checkbox').all()) await box.check();
  await claudia.getByTestId('import-macros-confirm').click();
  await until(claudia, () => document.querySelectorAll('[data-testid="macro-item"]').length === 2);
  await claudia.getByTestId('trigger-item').filter({ hasText: 'On edit' }).waitFor();
});

for (const id of [book.id, other.id]) await claudia.request.delete(`${BASE}/api/resources/${id}`);
await browser.close();
console.log(errors.length ? `browser errors:\n  ${errors.join('\n  ')}` : 'no browser errors');
if (errors.length) fails++;
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
