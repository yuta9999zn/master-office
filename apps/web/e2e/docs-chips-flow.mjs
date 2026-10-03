// Docs 2.2 end-to-end: smart chips (@date, dropdown, place), building blocks, bookmarks + internal links,
// with two editors, and their DOCX / HTML export.
// node e2e/docs-chips-flow.mjs   (needs pnpm dev + API + seeded data)
import JSZip from 'jszip';
import { chromium } from 'playwright';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = process.env.WEB_URL ?? 'http://localhost:3000';
const browser = await chromium.launch();
const errors = [];
let fails = 0;

async function session(email) {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 940 } });
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
    await page.screenshot({ path: join(tmpdir(), `mo-docs22-fail-${name.replace(/\W+/g, '_')}.png`) });
  }
};

const until = async (page, fn, arg, timeout = 15000) => page.waitForFunction(fn, arg, { timeout, polling: 200 });
const claudia = await session('claudia@kaori.jp');
const mika = await session('mika@kaori.jp');
const users = await (await claudia.request.get(`${BASE}/api/users`)).json();
const doc = await (await claudia.request.post(`${BASE}/api/resources`, { data: { name: `Chips ${Date.now()}`, type: 'document' } })).json();
await claudia.request.post(`${BASE}/api/resources/${doc.id}/members`, { data: { userId: users.find((u) => u.email === 'mika@kaori.jp').id, role: 'editor' } });
const editorOf = (p) => p.getByTestId('doc-editor');
for (const p of [claudia, mika]) {
  await p.goto(`${BASE}/docs/${doc.id}`);
  await editorOf(p).waitFor({ timeout: 60000 });
}
const today = new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short', day: 'numeric' }).format(new Date());

await step('@today inserts a date chip; the other editor sees it', claudia, async () => {
  await editorOf(claudia).click();
  await claudia.keyboard.type('Due ');
  await claudia.keyboard.type('@tod');
  await claudia.getByTestId('chip-today').waitFor();
  await claudia.keyboard.press('Enter');
  await editorOf(mika).getByTestId('date-chip').getByText(today).waitFor({ timeout: 10000 });
});

await step('/dropdown chip: picking a value syncs', claudia, async () => {
  await claudia.keyboard.press('Enter');
  await claudia.keyboard.type('Status ');
  await claudia.keyboard.type('/dropdown');
  await claudia.keyboard.press('Enter');
  await editorOf(claudia).getByTestId('dropdown-chip').click();
  await claudia.getByRole('menuitem', { name: 'In progress' }).click();
  await editorOf(mika).getByTestId('dropdown-chip').getByText('In progress').waitFor({ timeout: 10000 });
});

await step('@place chip: renamed place opens in Maps', claudia, async () => {
  await editorOf(claudia).locator('p').last().click();
  await claudia.keyboard.press('End');
  await claudia.keyboard.press('Enter');
  await claudia.keyboard.type('Meet at ');
  await claudia.keyboard.type('@pla');
  await claudia.getByTestId('chip-place').waitFor();
  await claudia.keyboard.press('Enter');
  await editorOf(claudia).getByTestId('place-chip').click();
  await claudia.getByLabel('Place', { exact: true }).fill('Shibuya Station');
  await claudia.getByLabel('Place', { exact: true }).press('Enter');
  const link = claudia.getByRole('link', { name: 'Open in Maps' });
  if (!(await link.getAttribute('href')).includes('Shibuya%20Station')) throw new Error('maps link');
  await claudia.keyboard.press('Escape');
  await editorOf(mika).getByTestId('place-chip').getByText('Shibuya Station').waitFor({ timeout: 10000 });
});

await step('building block: meeting notes', claudia, async () => {
  await editorOf(claudia).locator('p').last().click();
  await claudia.keyboard.press('End');
  await claudia.keyboard.press('Enter');
  await claudia.keyboard.type('/meeting');
  await claudia.keyboard.press('Enter');
  await editorOf(mika).getByText('Action items').waitFor({ timeout: 10000 });
  if ((await editorOf(mika).getByTestId('date-chip').count()) < 2) throw new Error('meeting notes date chip missing');
});

await step('link to a heading: bookmark added there, link points at it', claudia, async () => {
  await editorOf(claudia).locator('li, p').last().click();
  await claudia.keyboard.press('End');
  await claudia.keyboard.press('Enter');
  await claudia.keyboard.press('Enter');
  await claudia.keyboard.type('## Budget');
  await claudia.keyboard.press('Enter');
  await claudia.keyboard.type('See ');
  await claudia.keyboard.press('Control+k');
  await claudia.getByTestId('link-targets').getByRole('button', { name: /Budget/ }).click();
  // The link lands where the cursor was ("See Budget"), the heading itself stays "Budget".
  const href = await editorOf(mika).locator('p', { hasText: 'See' }).locator('a[href^="#bm-"]', { hasText: 'Budget' }).getAttribute('href', { timeout: 10000 });
  const headingText = (await editorOf(mika).locator('h2', { hasText: 'Budget' }).innerText()).replace('▾', '').trim(); // ▾ = fold toggle
  if (headingText !== 'Budget') throw new Error(`heading text changed: ${JSON.stringify(headingText)}`);
  await editorOf(mika).locator('h2', { hasText: 'Budget' }).getByTestId('bookmark').waitFor();
  if (!/^#bm-\w+$/.test(href)) throw new Error(href);
});

await step('footnotes: Ctrl+Alt+F jumps to the note; numbers follow document order', claudia, async () => {
  await editorOf(claudia).locator('p', { hasText: 'Due' }).click({ position: { x: 3, y: 8 } }); // clear of the date chip
  await claudia.keyboard.press('End');
  await claudia.keyboard.press('Control+Alt+f');
  await claudia.keyboard.type('Second note'); // typing goes to the footnote, not the text
  // A footnote earlier in the text (start of the document) becomes number 1.
  await editorOf(claudia).locator('p', { hasText: 'Due' }).click({ position: { x: 3, y: 8 } }); // clear of the date chip
  await claudia.keyboard.press('Control+Home');
  await claudia.keyboard.press('Control+Alt+f');
  await claudia.keyboard.type('First note');
  try {
    await until(mika, () => JSON.stringify([...document.querySelectorAll('[data-testid="footnote-text"]')].map((t) => t.value)) === '["First note","Second note"]');
  } catch (e) {
    for (const [n, pg] of [['claudia', claudia], ['mika', mika]]) console.log('DBG', n, JSON.stringify(await pg.evaluate(() => ({ notes: [...document.querySelectorAll('[data-testid="footnote-text"]')].map((t) => t.value), body: document.querySelector('[data-testid="doc-editor"]')?.innerText.slice(0, 60) }))));
    throw e;
  }
  const body = await editorOf(mika).locator('p', { hasText: 'Due' }).innerText();
  if (/note|Sec|Fir/.test(body)) throw new Error(`note text landed in the body: ${body}`);
  // The references are numbered 1, 2 in the text (CSS counter): check what is painted.
  const first = await editorOf(mika).getByTestId('footnote-ref').first().boundingBox();
  const second = await editorOf(mika).getByTestId('footnote-ref').nth(1).boundingBox();
  if (!first || !second || first.width < 3 || second.width < 3) throw new Error('footnote numbers are not shown');
});

await step('equation: typed as LaTeX, typeset for both editors', claudia, async () => {
  await editorOf(claudia).locator('p', { hasText: 'Meet at' }).click();
  await claudia.keyboard.press('End');
  await claudia.keyboard.type(' /equation');
  await claudia.keyboard.press('Enter');
  await claudia.getByLabel('Equation (LaTeX)').fill('E = mc^{2}');
  await claudia.getByTestId('equation-done').click();
  await editorOf(mika).getByTestId('equation').locator('.katex').waitFor({ timeout: 10000 });
});

await step('DOCX and HTML export carry chips, the bookmark and the internal link', claudia, async () => {
  await claudia.getByTestId('save-status').getByText('Saved to cloud').waitFor({ timeout: 15000 });
  const docx = await claudia.request.get(`${BASE}/api/resources/${doc.id}/export?format=docx`);
  const xml = await (await JSZip.loadAsync(await docx.body())).file('word/document.xml').async('string');
  for (const s of [today, 'In progress', 'Shibuya Station']) if (!xml.includes(s)) throw new Error(`docx misses ${s}`);
  if (!/<w:bookmarkStart[^>]*w:name="bm-\w+"/.test(xml) || !/<w:hyperlink[^>]*w:anchor="bm-\w+"/.test(xml)) throw new Error('docx bookmark / internal link');
  const html = await (await claudia.request.get(`${BASE}/api/resources/${doc.id}/export?format=html`)).text();
  if (!/id="bm-\w+"/.test(html) || !/href="#bm-\w+"/.test(html) || !html.includes('Shibuya Station')) throw new Error('html export');
  if (!html.includes('<section class="footnotes">') || !html.includes('First note') || !html.includes('<math')) throw new Error('html footnotes / equation');
  const zip = await JSZip.loadAsync(await (await claudia.request.get(`${BASE}/api/resources/${doc.id}/export?format=docx`)).body());
  const notesXml = await zip.file('word/footnotes.xml')?.async('string');
  if (!notesXml?.includes('First note') || !notesXml.includes('Second note')) throw new Error('docx footnotes');
});

console.log(errors.length ? `browser errors:\n  ${errors.join('\n  ')}` : 'no browser errors');
if (errors.length) fails++;
console.log(fails ? `${fails} failed` : 'all passed');
await browser.close();
process.exit(fails ? 1 : 0);
