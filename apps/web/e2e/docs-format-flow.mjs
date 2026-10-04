// Docs 2.3 end-to-end: Heading 5–6, small caps, indentation options, line numbers (editor, DOCX, PDF / HTML).
// node e2e/docs-format-flow.mjs   (needs pnpm dev + API)
import { chromium } from 'playwright';
import JSZip from 'jszip';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = process.env.WEB_URL ?? 'http://localhost:3000';
const browser = await chromium.launch();
const errors = [];
let fails = 0;

const ctx = await browser.newContext({ viewport: { width: 1500, height: 940 } });
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
    await page.screenshot({ path: join(tmpdir(), `mo-docs-format-fail-${name.replace(/\W+/g, '_')}.png`) });
  }
};
const until = (fn, arg, timeout = 15000) => page.waitForFunction(fn, arg, { timeout, polling: 200 });
const editor = page.getByTestId('doc-editor');
const menu = async (top, item) => {
  await page.getByRole('button', { name: top, exact: true }).click();
  await page.getByRole('menuitem', { name: item }).click();
};

const doc = await (await page.request.post(`${BASE}/api/resources`, { data: { type: 'document', name: 'Format test' } })).json();

await step('Heading 5 and small caps', async () => {
  await page.goto(`${BASE}/docs/${doc.id}`);
  await editor.waitFor({ timeout: 60000 });
  await editor.click();
  await page.keyboard.type('Minor heading');
  await page.getByRole('button', { name: 'Text style' }).click();
  await page.getByRole('menuitem', { name: 'Heading 5' }).click();
  await editor.locator('h5', { hasText: 'Minor heading' }).waitFor();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Quarterly Review');
  await page.keyboard.press('Shift+Home');
  await menu('Format', 'Small caps');
  await editor.locator('span[data-small-caps]', { hasText: 'Quarterly Review' }).waitFor();
});

await step('Indentation options: first line and hanging', async () => {
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Indented paragraph that is long enough to wrap onto several lines in the page, so that the first line indent and the line numbers have something to show. '.repeat(3));
  await menu('Format', 'Indentation options…');
  const dlg = page.getByTestId('indent-dialog');
  await dlg.getByLabel('Special indent').selectOption('first');
  await dlg.getByLabel('By').fill('1.5');
  await page.getByTestId('indent-apply').click();
  await until(() => [...document.querySelectorAll('[data-testid="doc-editor"] p')].some((p) => p.style.textIndent === '42.5pt'));
  await menu('Format', 'Indentation options…');
  await dlg.getByLabel('Special indent').selectOption('hanging');
  await page.getByTestId('indent-apply').click();
  await until(() => [...document.querySelectorAll('[data-testid="doc-editor"] p')].some((p) => p.style.textIndent === '-42.5pt' && p.style.marginLeft === '42.5pt'));
});

await step('Tools → Line numbers numbers every visual line', async () => {
  await menu('Tools', 'Line numbers');
  const gutter = page.getByTestId('line-numbers');
  await gutter.waitFor({ state: 'attached' });
  // Heading + small caps line + a paragraph wrapped over several lines.
  await until(() => document.querySelectorAll('[data-testid="line-numbers"] > div').length >= 6, null, 10000);
  const n = await gutter.locator('> div').count();
  const last = await gutter.locator('> div').last().innerText();
  if (String(n) !== last.trim()) throw new Error(`numbering ${n} vs ${last}`);
  // The numbers sit in the left margin, beside the text.
  const box = await gutter.locator('> div').first().boundingBox();
  const text = await editor.boundingBox();
  if (!box || box.x >= text.x) throw new Error('numbers are not in the margin');
});

await step('DOCX keeps headings 5, small caps, indents and line numbering; PDF / HTML number lines too', async () => {
  await page.waitForTimeout(2500); // debounced store
  const res = await page.request.get(`${BASE}/api/resources/${doc.id}/export?format=docx`);
  if (!res.ok()) throw new Error(`docx ${res.status()}`);
  const xml = await (await JSZip.loadAsync(await res.body())).file('word/document.xml').async('string');
  for (const want of ['w:pStyle w:val="Heading5"', '<w:smallCaps', 'w:hanging="850"', '<w:lnNumType']) if (!xml.includes(want)) throw new Error(`docx missing ${want}`);
  const html = await (await page.request.get(`${BASE}/api/resources/${doc.id}/export?format=html`)).text();
  if (!html.includes('lineBoxes') || !html.includes('font-variant:small-caps')) throw new Error('html export');
  const pdf = await page.request.get(`${BASE}/api/resources/${doc.id}/export?format=pdf`);
  if (!pdf.ok() || (await pdf.body()).length < 1000) throw new Error(`pdf ${pdf.status()}`);
});

await page.request.delete(`${BASE}/api/resources/${doc.id}`);
await browser.close();
console.log(errors.length ? `browser errors:\n  ${errors.join('\n  ')}` : 'no browser errors');
if (errors.length) fails++;
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
