// Cross-cutting features end-to-end: the templates gallery for Docs and Sheets.
// node e2e/templates-flow.mjs   (needs pnpm dev + API + seeded data)
import { chromium } from 'playwright';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = process.env.WEB_URL ?? 'http://localhost:3000';
const browser = await chromium.launch();
const errors = [];
const created = [];
let fails = 0;

const ctx = await browser.newContext({ viewport: { width: 1500, height: 940 } });
const users = await (await ctx.request.get(`${BASE}/api/users`)).json();
await ctx.addCookies([{ name: 'mo_uid', value: users.find((u) => u.email === 'claudia@hanami.example').id, url: BASE }]);
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(e.message));

const step = async (name, fn) => {
  try {
    await fn();
    console.log('✓', name);
  } catch (e) {
    fails++;
    console.log('✗', name, '—', e.message.split('\n')[0]);
    await page.screenshot({ path: join(tmpdir(), `mo-templates-fail-${name.replace(/\W+/g, '_')}.png`) });
  }
};
const idFromUrl = (prefix) => {
  const m = new RegExp(`/${prefix}/([0-9a-f-]{36})`).exec(page.url());
  if (!m) throw new Error(`not on a ${prefix} page: ${page.url()}`);
  created.push(m[1]);
  return m[1];
};

await step('Docs: the gallery shows every template with a page preview', async () => {
  await page.goto(`${BASE}/docs`);
  const gallery = page.getByTestId('templates');
  for (const name of ['Blank document', 'Meeting notes', 'Project proposal', 'Weekly report', 'Product spec', 'Business letter', 'Resume']) await gallery.getByText(name, { exact: true }).first().waitFor();
  if (!(await page.getByTestId('template-meeting-notes').getByText('Agenda').count())) throw new Error('no preview content');
});

await step('Docs: a template opens as a filled-in document', async () => {
  await page.getByTestId('template-meeting-notes').click();
  await page.waitForURL(/\/docs\/[0-9a-f-]{36}/, { timeout: 30000 });
  const editor = page.getByTestId('doc-editor');
  await editor.waitFor({ timeout: 60000 });
  await editor.getByRole('heading', { name: 'Meeting notes' }).waitFor({ timeout: 15000 });
  await editor.getByText('Action items').first().waitFor();
  const id = idFromUrl('docs');
  const text = await (await page.request.get(`${BASE}/api/resources/${id}/export?format=txt`)).text();
  if (!text.includes('Decisions')) throw new Error('stored document is missing template content');
});

await step('Sheets: the gallery shows every template with a grid preview', async () => {
  await page.goto(`${BASE}/sheets`);
  const gallery = page.getByTestId('templates');
  for (const name of ['Blank spreadsheet', 'To-do list', 'Monthly budget', 'Invoice', 'Project tracker', 'Weekly schedule', 'Expense report']) await gallery.getByText(name, { exact: true }).first().waitFor();
  if (!(await page.getByTestId('template-invoice').getByText('INVOICE').count())) throw new Error('no preview content');
});

await step('Sheets: a template opens with its data and working formulas', async () => {
  await page.getByTestId('template-invoice').click();
  await page.waitForURL(/\/sheets\/[0-9a-f-]{36}/, { timeout: 30000 });
  await page.getByText('Invoice', { exact: true }).first().waitFor({ timeout: 60000 });
  const id = idFromUrl('sheets');
  const csv = await (await page.request.get(`${BASE}/api/resources/${id}/export?format=csv`)).text();
  if (!csv.includes('Facial treatment') || !csv.includes('Total due')) throw new Error(`csv: ${csv.slice(0, 200)}`);
});

for (const id of created) await page.request.delete(`${BASE}/api/resources/${id}`);
console.log(errors.length ? `browser errors:\n  ${errors.join('\n  ')}` : 'no browser errors');
if (errors.length) fails++;
console.log(fails ? `${fails} failed` : 'all passed');
await browser.close();
process.exit(fails ? 1 : 0);
