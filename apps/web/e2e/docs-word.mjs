// Phase 2.1 (Word parity) end-to-end: find & replace, superscript, TOC, suggesting mode with a second reviewer,
// page setup + print layout, print preview.   node e2e/docs-word.mjs  (needs pnpm dev + seeded data)
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
    await page.screenshot({ path: join(tmpdir(), `mo-word-fail-${name.replace(/\W+/g, '_')}.png`) });
  }
};

const claudia = await session('claudia@hanami.example');
// A fresh document in the Marketing space so Mika (editor there) can review it.
const spaces = await (await claudia.request.get(`${BASE}/api/spaces`)).json();
const marketing = spaces.find((s) => s.name === 'Marketing');
const doc = await (await claudia.request.post(`${BASE}/api/resources`, { data: { name: 'E2E Word features', type: 'document', spaceId: marketing.id } })).json();
const url = `${BASE}/docs/${doc.id}`;
const ed = (p) => p.getByTestId('doc-editor');
const menu = async (p, top, item) => {
  await p.getByRole('button', { name: top, exact: true }).click();
  await p.getByRole('menuitem', { name: item }).click();
};

await claudia.goto(url);
await ed(claudia).waitFor();

await step('type structured content with Markdown shortcuts', claudia, async () => {
  await ed(claudia).click();
  await claudia.keyboard.type('# Overview\nRevenue grew strongly this quarter.\n## Details\nEinstein: E=mc');
  await ed(claudia).locator('h1', { hasText: 'Overview' }).waitFor();
  await ed(claudia).locator('h2', { hasText: 'Details' }).waitFor();
});

await step('superscript via Ctrl+.', claudia, async () => {
  await claudia.keyboard.press('Control+.');
  await claudia.keyboard.type('2');
  await claudia.keyboard.press('Control+.');
  await ed(claudia).locator('sup', { hasText: '2' }).waitFor();
});

await step('find (Ctrl+F) counts matches', claudia, async () => {
  await claudia.keyboard.press('Control+f');
  await claudia.getByLabel('Find', { exact: true }).fill('quarter');
  await claudia.getByTestId('find-count').getByText('1/1').waitFor();
});

await step('find & replace all (Ctrl+H)', claudia, async () => {
  await ed(claudia).click();
  await claudia.keyboard.press('Control+h');
  await claudia.getByLabel('Find', { exact: true }).fill('strongly');
  await claudia.getByLabel('Replace with').fill('sharply');
  await claudia.getByRole('button', { name: 'Replace all' }).click();
  await ed(claudia).getByText('Revenue grew sharply this quarter.').waitFor();
  await claudia.getByRole('button', { name: 'Close find' }).click();
});

await step('insert table of contents from Insert menu', claudia, async () => {
  await ed(claudia).locator('h1', { hasText: 'Overview' }).click();
  await claudia.keyboard.press('Home');
  await menu(claudia, 'Insert', 'Table of contents');
  const toc = ed(claudia).getByTestId('toc');
  await toc.getByRole('button', { name: 'Overview' }).waitFor();
  await toc.getByRole('button', { name: 'Details' }).waitFor();
});

const mika = await session('mika@hanami.example');
await mika.goto(url);
await ed(mika).waitFor();

await step('suggesting mode: typed text becomes a suggestion for everyone', claudia, async () => {
  await claudia.getByTestId('mode-switch').click();
  await claudia.getByRole('menuitem', { name: /Suggesting/ }).click();
  await ed(claudia).getByText('Revenue grew sharply this quarter.').click();
  await claudia.keyboard.press('End');
  await claudia.keyboard.type(' Margins improved too.');
  await ed(claudia).locator('.mo-ins', { hasText: 'Margins improved too.' }).waitFor();
  await ed(mika).locator('.mo-ins', { hasText: 'Margins improved too.' }).waitFor({ timeout: 10000 });
});

await step('suggesting mode: deleting a word strikes it through instead', claudia, async () => {
  // Select exactly the word "sharply" (a double-click on the paragraph would land on another word).
  await ed(claudia).evaluate((root) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const i = n.textContent.indexOf('sharply');
      if (i >= 0) {
        const range = document.createRange();
        range.setStart(n, i);
        range.setEnd(n, i + 'sharply'.length);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        return;
      }
    }
  });
  await claudia.waitForTimeout(150);
  await claudia.keyboard.press('Backspace');
  await ed(claudia).locator('.mo-del', { hasText: 'sharply' }).waitFor();
  await ed(mika).locator('.mo-del', { hasText: 'sharply' }).waitFor({ timeout: 10000 });
});

await step('reviewer accepts the insertion and rejects the deletion', mika, async () => {
  await mika.getByRole('button', { name: 'Suggestions' }).first().click();
  const panel = mika.getByTestId('suggestions');
  await panel.getByText('Margins improved too.').waitFor();
  const insCard = panel.locator('div.rounded-xl', { hasText: 'Margins improved too.' });
  await insCard.getByRole('button', { name: 'Accept suggestion' }).click();
  const delCard = panel.locator('div.rounded-xl', { hasText: 'sharply' });
  await delCard.getByRole('button', { name: 'Reject suggestion' }).click();
  await ed(claudia).locator('.mo-ins, .mo-del').first().waitFor({ state: 'detached', timeout: 10000 });
  await ed(claudia).getByText('Revenue grew sharply this quarter. Margins improved too.').waitFor();
});

await step('page setup: landscape with page-number footer, shown in print layout', claudia, async () => {
  await claudia.getByTestId('mode-switch').click();
  await claudia.getByRole('menuitem', { name: /Editing/ }).click();
  await menu(claudia, 'File', 'Page setup');
  await claudia.getByRole('button', { name: 'landscape' }).click();
  await claudia.getByLabel('Footer text').fill('Page {page} of {pages}');
  await claudia.getByRole('button', { name: 'Apply' }).click();
  await menu(claudia, 'View', 'Print layout');
  const pageBox = await claudia.getByTestId('doc-page').boundingBox();
  if (!pageBox || pageBox.width < 1050) throw new Error(`page width ${pageBox?.width}`);
  await claudia.getByTestId('doc-page').getByText('Page # of #').waitFor();
  // The setting is shared: Mika's document has it too.
  await mika.getByRole('button', { name: 'View', exact: true }).click();
  await mika.getByRole('menuitem', { name: 'Print layout' }).click();
  await mika.getByTestId('doc-page').getByText('Page # of #').waitFor({ timeout: 10000 });
});

await step('print preview renders the real PDF', claudia, async () => {
  await menu(claudia, 'File', 'Print preview');
  const frame = claudia.getByTestId('print-preview');
  await frame.waitFor();
  const src = await frame.getAttribute('src');
  const res = await claudia.request.get(`${BASE}${src}`);
  if (res.status() !== 200 || !(res.headers()['content-type'] ?? '').includes('pdf')) throw new Error(`${res.status()} ${res.headers()['content-type']}`);
  await claudia.keyboard.press('Escape');
});

await claudia.request.post(`${BASE}/api/resources/${doc.id}/trash`);
await claudia.request.delete(`${BASE}/api/resources/${doc.id}`);
console.log(errors.length ? 'browser errors:\n' + [...new Set(errors)].join('\n') : 'no browser errors');
console.log(fails ? `${fails} failed` : 'all passed');
await browser.close();
process.exit(fails ? 1 : 0);
