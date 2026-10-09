// Phase 3.2 end-to-end: macros — record, save with a shortcut, replay, scripts, errors, sandbox, sharing.
// node e2e/macros-flow.mjs   (needs pnpm dev + API + seeded data)
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
    await page.screenshot({ path: join(tmpdir(), `mo-macros-fail-${name.replace(/\W+/g, '_')}.png`) });
  }
};
const until = async (page, fn, arg, timeout = 15000) => page.waitForFunction(fn, arg, { timeout, polling: 200 });
const ready = (page, id) => until(page, (u) => !!window.__moSheet?.api.getWorkbook(u), id, 120000);
const cell = (page, a1) => page.evaluate((a) => window.__moSheet.value(window.__moSheet.api.getActiveWorkbook().getActiveSheet().getSheetName(), a), a1);
const bold = (page, a1) =>
  page.evaluate((a) => {
    const ws = window.__moSheet.api.getActiveWorkbook().getActiveSheet();
    const r = ws.getRange(a);
    const raw = ws.getSheet().getCellRaw(r.getRow(), r.getColumn());
    const s = typeof raw?.s === 'string' ? window.__moSheet.api.getActiveWorkbook().getWorkbook().getStyles().get(raw.s) : raw?.s;
    return s?.bl === 1;
  }, a1);
const select = (page, a1) => page.evaluate((a) => window.__moSheet.api.getActiveWorkbook().getActiveSheet().getRange(a).activate(), a1);
/** Gives the grid keyboard focus the way a user does: clicking into it. */
const focusGrid = async (page) => {
  const box = await page.locator('.mo-univer canvas').first().boundingBox();
  await page.mouse.click(box.x + box.width * 0.6, box.y + box.height * 0.7);
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

const claudia = await session('claudia@hanami.example');
const mika = await session('mika@hanami.example');
const created = await (await claudia.request.post(`${BASE}/api/resources`, { data: { name: `Macro test ${Date.now()}`, type: 'spreadsheet', spaceId: null } })).json();
// Share with Mika (editor) and Sora (viewer).
const users = await (await claudia.request.get(`${BASE}/api/users`)).json();
const uid = (e) => users.find((u) => u.email === e).id;
for (const [email, role] of [['mika@hanami.example', 'editor'], ['sora@hanami.example', 'viewer']]) {
  await claudia.request.post(`${BASE}/api/resources/${created.id}/members`, { data: { userId: uid(email), role } });
}

await step('open a new spreadsheet; Extensions menu offers macros', claudia, async () => {
  await claudia.goto(`${BASE}/sheets/${created.id}`);
  await ready(claudia, created.id);
  await claudia.getByRole('button', { name: 'Extensions' }).click();
  await claudia.getByRole('menuitem', { name: 'Record macro' }).waitFor();
  await claudia.keyboard.press('Escape');
});

await step('record typing + bold, save with Ctrl+Alt+Shift+1', claudia, async () => {
  await claudia.getByRole('button', { name: 'Extensions' }).click();
  await claudia.getByRole('menuitem', { name: 'Record macro' }).click();
  await claudia.getByTestId('macro-recording').waitFor();
  await focusGrid(claudia);
  await select(claudia, 'A1');
  await claudia.keyboard.type('Header');
  await claudia.keyboard.press('Enter');
  await select(claudia, 'A1');
  await claudia.keyboard.press('Control+b');
  await until(claudia, () => document.querySelector('[data-testid="macro-recording"] b')?.textContent === '2');
  await claudia.getByTestId('macro-stop').click();
  await claudia.getByTestId('macro-name').fill('Format header');
  await claudia.getByTestId('macro-save').click();
  await until(claudia, () => !document.querySelector('[data-testid="macro-recording"]'));
});

await step('the recorded script reads like Apps Script', claudia, async () => {
  await claudia.getByRole('button', { name: 'Extensions' }).click();
  await claudia.getByRole('menuitem', { name: /Manage macros/ }).click();
  await claudia.getByTestId('macro-item').filter({ hasText: 'Format header' }).getByText('Format header', { exact: true }).click();
  const code = await claudia.locator('[data-testid="macro-code"] .cm-content').innerText();
  for (const want of ["function formatHeader()", "getRange(\"A1\").setValue(\"Header\")", "getRange(\"A1\").setFontWeight(\"bold\")"]) if (!code.includes(want)) throw new Error(`missing ${want} in:\n${code}`);
  await claudia.getByRole('button', { name: 'Back to macros' }).click();
});

await step('the shortcut replays the macro (value + bold)', claudia, async () => {
  await claudia.evaluate(() => window.__moSheet.api.getActiveWorkbook().getActiveSheet().getRange('A1').clear());
  await until(claudia, () => window.__moSheet.value(window.__moSheet.api.getActiveWorkbook().getActiveSheet().getSheetName(), 'A1') === null);
  await focusGrid(claudia);
  await claudia.keyboard.press('Control+Alt+Shift+Digit1');
  await until(claudia, () => window.__moSheet.value(window.__moSheet.api.getActiveWorkbook().getActiveSheet().getSheetName(), 'A1') === 'Header');
  if (!(await bold(claudia, 'A1'))) throw new Error('A1 not bold after replay');
});

await step('another editor sees the macro and its result', mika, async () => {
  await mika.goto(`${BASE}/sheets/${created.id}`);
  await ready(mika, created.id);
  await until(mika, () => window.__moSheet.value(window.__moSheet.api.getActiveWorkbook().getActiveSheet().getSheetName(), 'A1') === 'Header');
  await mika.getByRole('button', { name: 'Extensions' }).click();
  await mika.getByRole('menuitem', { name: 'Format header' }).waitFor();
  await mika.keyboard.press('Escape');
});

await step('a written script runs: loops, appendRow, formulas, logs', claudia, async () => {
  await claudia.getByRole('button', { name: 'New script' }).click();
  await claudia.getByTestId('macro-editor').waitFor();
  await setCode(
    claudia,
    `function myFunction() {
  var sheet = SpreadsheetApp.getActiveSheet();
  for (var i = 1; i <= 5; i++) sheet.getRange(i + 1, 2).setValue(i * 10);
  sheet.getRange('B7').setFormula('=SUM(B2:B6)');
  sheet.appendRow(['total', 'done']);
  sheet.getRange('B2:B6').setBackground('#FDE68A');
  Logger.log('rows: ' + sheet.getLastRow(), typeof fetch);
}`,
  );
  await claudia.getByTestId('macro-run').click();
  await until(claudia, () => document.querySelector('[data-testid="macro-output"]')?.textContent.includes('rows: 8'));
  const out = await claudia.getByTestId('macro-output').innerText();
  if (!out.includes('undefined')) throw new Error('sandbox: fetch is reachable — ' + out);
  await until(claudia, () => window.__moSheet.value(window.__moSheet.api.getActiveWorkbook().getActiveSheet().getSheetName(), 'B7') === 150);
  if ((await cell(claudia, 'A8')) !== 'total') throw new Error('appendRow');
});

await step('errors are reported with the changes made before them kept', claudia, async () => {
  await setCode(claudia, `function myFunction() {\n  SpreadsheetApp.getActiveSheet().getRange('D1').setValue('before');\n  SpreadsheetApp.getActive().getSheetByName('Nope').getRange('A1');\n}`);
  await claudia.getByTestId('macro-run').click();
  // getSheetByName returns null for a missing sheet (as in Apps Script), so the error is the null access.
  await until(claudia, () => /✗ TypeError/.test(document.querySelector('[data-testid="macro-output"]')?.textContent ?? ''));
  await until(claudia, () => window.__moSheet.value(window.__moSheet.api.getActiveWorkbook().getActiveSheet().getSheetName(), 'D1') === 'before');
});

await step('a viewer cannot record or run macros', claudia, async () => {
  const sora = await session('sora@hanami.example');
  await sora.goto(`${BASE}/sheets/${created.id}`);
  await ready(sora, created.id);
  await sora.getByRole('button', { name: 'Extensions' }).click();
  if (await sora.getByRole('menuitem', { name: 'Record macro' }).isEnabled()) throw new Error('viewer can record');
  if (await sora.getByRole('menuitem', { name: 'Format header' }).isEnabled()) throw new Error('viewer can run');
  await sora.context().close();
});

await browser.close();
if (errors.length) {
  console.log('page errors:\n' + errors.join('\n'));
  fails++;
}
console.log(fails ? `\n${fails} step(s) failed` : '\nall macros e2e steps passed');
process.exit(fails ? 1 : 0);
