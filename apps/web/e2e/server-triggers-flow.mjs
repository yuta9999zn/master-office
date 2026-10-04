// Server-run macro triggers end-to-end: time-driven (scheduler), run now, sandbox limits, on form submit.
// node e2e/server-triggers-flow.mjs   (needs pnpm dev + API + seeded data; takes ~2 minutes: waits for the scheduler)
import { chromium } from 'playwright';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = process.env.WEB_URL ?? 'http://localhost:3000';
const browser = await chromium.launch();
const errors = [];
let fails = 0;

const ctx = await browser.newContext({ viewport: { width: 1600, height: 940 } });
const users = await (await ctx.request.get(`${BASE}/api/users`)).json();
await ctx.addCookies([{ name: 'mo_uid', value: users.find((u) => u.email === 'claudia@kaori.jp').id, url: BASE }]);
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(e.message));
const step = async (name, fn) => {
  try {
    await fn();
    console.log('✓', name);
  } catch (e) {
    fails++;
    console.log('✗', name, '—', e.message.split('\n')[0]);
    await page.screenshot({ path: join(tmpdir(), `mo-server-triggers-fail-${name.replace(/\W+/g, '_')}.png`) });
  }
};
const until = (fn, arg, timeout = 15000) => page.waitForFunction(fn, arg, { timeout, polling: 250 });
const ready = (id) => until((u) => !!window.__moSheet?.api.getWorkbook(u), id, 120000);
const cellIs = (a1, v, timeout) => until(([a, want]) => window.__moSheet.value(window.__moSheet.api.getActiveWorkbook().getActiveSheet().getSheetName(), a) === want, [a1, v], timeout);
const openMacros = async () => {
  await page.getByRole('button', { name: 'Extensions' }).click();
  await page.getByRole('menuitem', { name: /Manage macros/ }).click();
  await page.getByTestId('macros-panel').waitFor();
};
const newScript = async (code) => {
  await page.getByRole('button', { name: 'New script' }).click();
  await page.getByTestId('macro-editor').waitFor();
  await page.locator('[data-testid="macro-code"] .cm-content').click();
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Delete');
  await page.locator('[data-testid="macro-code"] .cm-content').evaluate((el, c) => {
    const view = el.cmView?.view ?? el.closest('.cm-editor')?.cmView?.view;
    if (view) view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: c } });
    else document.execCommand('insertText', false, c);
  }, code);
  await page.getByRole('button', { name: 'Back to macros' }).click();
};
const addTrigger = async (fn, kind, every) => {
  await page.getByTestId('server-triggers').getByRole('button', { name: 'Add trigger' }).click();
  const form = page.getByTestId('trigger-form');
  await form.getByLabel('Trigger function').fill(fn);
  await form.getByLabel('Trigger event').selectOption(kind);
  if (every) {
    await form.getByLabel('Timer type').selectOption('minutes');
    await form.getByLabel('Interval').selectOption(String(every));
  }
  await page.getByTestId('trigger-save').click();
  await page.getByTestId('server-trigger').filter({ hasText: `${fn}()` }).waitFor();
};

const book = await (await page.request.post(`${BASE}/api/resources`, { data: { name: `Server triggers ${Date.now()}`, type: 'spreadsheet' } })).json();
const trigger = async (fn) => (await (await page.request.get(`${BASE}/api/resources/${book.id}/macro-triggers`)).json()).find((t) => t.fn === fn);

await step('a time-driven trigger is saved with its schedule', async () => {
  await page.goto(`${BASE}/sheets/${book.id}`);
  await ready(book.id);
  await openMacros();
  await newScript(`function stamp() {
  var c = SpreadsheetApp.getActiveSheet().getRange('A1');
  c.setValue(Number(c.getValue() || 0) + 1);
  Logger.log('stamped by ' + Session_user());
}
function Session_user() { return typeof require + '/' + typeof process + '/' + typeof fetch; }
function spin() { while (true) {} }`);
  await addTrigger('stamp', 'time', 1);
  await page.getByTestId('server-trigger').filter({ hasText: 'Every minute' }).waitFor();
});

await step('Run now executes it on the server, sandboxed, and the open grid updates live', async () => {
  await page.getByRole('button', { name: 'Run stamp now on the server' }).click();
  await cellIs('A1', 1, 20000);
  // The grid updates during the run; the status is recorded right after it.
  let t = await trigger('stamp');
  for (let i = 0; i < 20 && !t.lastStatus; i++) await page.waitForTimeout(250), (t = await trigger('stamp'));
  if (t.lastStatus !== 'ok') throw new Error(`status ${t.lastStatus}: ${t.lastError}`);
  // No Node, no network inside the isolate.
  if (!t.lastLogs.some((l) => l.includes('stamped by undefined/undefined/undefined'))) throw new Error(`logs ${JSON.stringify(t.lastLogs)}`);
});

await step('the scheduler runs it again on its own', async () => {
  await cellIs('A1', 2, 120000);
});

await step('a runaway macro is stopped after 30 s and nothing is applied', async () => {
  await addTrigger('spin', 'time', 30);
  const t0 = Date.now();
  await page.getByRole('button', { name: 'Run spin now on the server' }).click();
  await page.getByTestId('server-trigger').filter({ hasText: 'spin()' }).getByTestId('server-trigger-status').getByText(/maximum execution time/).waitFor({ timeout: 60000 });
  if (Date.now() - t0 > 50000) throw new Error('took too long to stop');
  // The scheduler still works after a killed isolate.
  const stamp = await trigger('stamp');
  await page.request.patch(`${BASE}/api/macro-triggers/${stamp.id}`, { data: { enabled: false } });
});

await step('On form submit runs with e.namedValues and e.range of the new row', async () => {
  const form = await (await page.request.post(`${BASE}/api/resources`, { data: { name: `Trigger form ${Date.now()}`, type: 'form' } })).json();
  const linked = await (await page.request.post(`${BASE}/api/forms/${form.id}/sheet`)).json();
  const sheetId = linked.id ?? linked.sheetId ?? linked.resource?.id;
  if (!sheetId) throw new Error(`link: ${JSON.stringify(linked)}`);
  await page.goto(`${BASE}/sheets/${sheetId}`);
  await ready(sheetId);
  await openMacros();
  await newScript(`function onSubmit(e) {
  SpreadsheetApp.getActiveSheet().getRange(e.range.getRow(), 8).setValue('seen ' + Object.keys(e.namedValues).length + ' fields');
}`);
  await addTrigger('onSubmit', 'formSubmit');
  const res = await page.request.post(`${BASE}/api/forms/${form.id}/responses`, { data: { answers: {} } });
  if (!res.ok()) throw new Error(`submit ${res.status()} ${await res.text()}`);
  await until(() => {
    const ws = window.__moSheet.api.getActiveWorkbook().getActiveSheet();
    for (let r = 1; r < 5; r++) if (String(window.__moSheet.value(ws.getSheetName(), `H${r + 1}`) ?? '').startsWith('seen ')) return true;
    return false;
  }, null, 30000);
  await page.request.delete(`${BASE}/api/resources/${form.id}`);
  await page.request.delete(`${BASE}/api/resources/${sheetId}`);
});

await page.request.delete(`${BASE}/api/resources/${book.id}`);
await browser.close();
console.log(errors.length ? `browser errors:\n  ${errors.join('\n  ')}` : 'no browser errors');
if (errors.length) fails++;
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
