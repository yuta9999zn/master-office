// Cross-cutting features end-to-end: Publish to web (+ embed) for documents, spreadsheets and presentations.
// node e2e/publish-flow.mjs   (needs pnpm dev + API + seeded data)
import { chromium } from 'playwright';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = process.env.WEB_URL ?? 'http://localhost:3000';
const browser = await chromium.launch();
const errors = [];
let fails = 0;

async function session(email) {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 940 } });
  if (email) {
    const users = await (await ctx.request.get(`${BASE}/api/users`)).json();
    await ctx.addCookies([{ name: 'mo_uid', value: users.find((u) => u.email === email).id, url: BASE }]);
  }
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
    await page.screenshot({ path: join(tmpdir(), `mo-publish-fail-${name.replace(/\W+/g, '_')}.png`) });
  }
};
const claudia = await session('claudia@kaori.jp');
const find = async (q) => (await (await claudia.request.get(`${BASE}/api/search?q=${encodeURIComponent(q)}`)).json()).find((h) => h.kind === 'resource');
const menu = async (top, item) => {
  await claudia.getByRole('button', { name: top, exact: true }).click();
  await claudia.getByRole('menuitem', { name: item }).click();
};

let docLink;
await step('document: File → Publish to web gives a link and an embed code', claudia, async () => {
  const doc = await find('Branch Operation Plan - October 2026');
  await claudia.goto(`${BASE}/docs/${doc.id}`);
  await claudia.getByTestId('doc-editor').waitFor({ timeout: 60000 });
  await menu('File', 'Publish to web…');
  await claudia.getByTestId('publish').click();
  docLink = await claudia.getByLabel('Published link').inputValue();
  const embed = await claudia.getByLabel('Embed code').inputValue();
  if (!/\/pub\/[\w-]{16,}$/.test(docLink) || !embed.includes(`${docLink}?embed=1`)) throw new Error(`${docLink} / ${embed}`);
  await claudia.keyboard.press('Escape');
});

await step('the published page is public, read-only, current, and embeddable', claudia, async () => {
  // A fresh browser without any identity cookie.
  const visitor = await session(null);
  const res = await visitor.goto(docLink);
  if (res.status() !== 200) throw new Error(`status ${res.status()}`);
  await visitor.getByText('Key Goals').first().waitFor();
  await visitor.getByText('Published with Master Office').waitFor();
  if (await visitor.locator('[contenteditable="true"]').count()) throw new Error('editable content on a published page');
  // Live: an edit in the editor shows on the next load.
  const marker = `Published line ${Date.now() % 100000}`;
  await claudia.getByTestId('doc-editor').locator('p').first().click();
  await claudia.keyboard.press('End');
  await claudia.keyboard.type(` ${marker}`);
  await claudia.getByTestId('save-status').getByText('Saved to cloud').waitFor({ timeout: 15000 });
  const fresh = await visitor.request.get(`${docLink}?t=${Date.now()}`);
  if (!(await fresh.text()).includes(marker)) throw new Error('published page is not up to date');
  // Embed: no top bar, framing allowed.
  const emb = await visitor.request.get(`${docLink}?embed=1`);
  const html = await emb.text();
  if (html.includes('Published with Master Office') || !/frame-ancestors \*/.test(emb.headers()['content-security-policy'] ?? '')) throw new Error('embed view');
  await visitor.context().close();
});

await step('stop publishing: the link stops working', claudia, async () => {
  await menu('File', 'Publish to web…');
  await claudia.getByTestId('unpublish').click();
  await claudia.getByTestId('publish').waitFor();
  const res = await claudia.request.get(`${docLink}?t=${Date.now()}`);
  if (res.status() !== 404) throw new Error(`status ${res.status()}`);
  await claudia.keyboard.press('Escape');
});

await step('spreadsheet and presentation publish too', claudia, async () => {
  for (const [q, path, text] of [
    ['Sales Report - September 2026', 'sheets', 'Monthly Summary'],
    ['Q4 Marketing Strategy - October 2026', 'slides', 'Q4 Campaign'],
  ]) {
    const r = await find(q);
    const res = await (await claudia.request.post(`${BASE}/api/resources/${r.id}/publish`, { data: { on: true } })).json();
    const page = await claudia.request.get(`${BASE}/pub/${res.token}`);
    if (page.status() !== 200 || !(await page.text()).includes(text)) throw new Error(`${path} not published`);
    await claudia.request.post(`${BASE}/api/resources/${r.id}/publish`, { data: { on: false } });
  }
});

console.log(errors.length ? `browser errors:\n  ${errors.join('\n  ')}` : 'no browser errors');
if (errors.length) fails++;
console.log(fails ? `${fails} failed` : 'all passed');
await browser.close();
process.exit(fails ? 1 : 0);
