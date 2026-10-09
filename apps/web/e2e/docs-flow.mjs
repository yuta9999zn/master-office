// Docs editor end-to-end: two people editing the same document live, comments, formatting, versions, export, read-only viewer.
//   pnpm --filter @workos/web e2e:docs   (needs pnpm dev + seeded data)
import { chromium } from 'playwright';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = process.env.WEB_URL ?? 'http://localhost:3000';
const browser = await chromium.launch();
const errors = [];
let fails = 0;

async function session(email) {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 940 }, acceptDownloads: true });
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
    await page.screenshot({ path: join(tmpdir(), `mo-docs-fail-${name.replace(/\W+/g, '_')}.png`) });
  }
};

const claudia = await session('claudia@hanami.example');
const hits = await (await claudia.request.get(`${BASE}/api/search?q=${encodeURIComponent('Branch Operation Plan - October')}`)).json();
const docUrl = `${BASE}/docs/${hits.find((h) => h.kind === 'resource').id}`;
const editorOf = (p) => p.getByTestId('doc-editor');
const marker = `Live line ${Date.now() % 100000}`;

await claudia.goto(docUrl);
await editorOf(claudia).waitFor();
const mika = await session('mika@hanami.example');
await mika.goto(docUrl);
await editorOf(mika).waitFor();

await step('both editors load seeded content', claudia, async () => {
  await claudia.getByText('Key Goals').first().waitFor();
  await mika.getByText('Key Goals').first().waitFor();
});

await step('presence: each sees the other online', claudia, async () => {
  await claudia.getByTestId('online-users').getByText('MT').waitFor({ timeout: 10000 });
  await mika.getByTestId('online-users').getByText('CC').waitFor({ timeout: 10000 });
});

await step('typing appears live for the other editor', claudia, async () => {
  await editorOf(claudia).locator('p').first().click();
  await claudia.keyboard.press('End');
  await claudia.keyboard.press('Enter');
  await claudia.keyboard.type(marker);
  await editorOf(mika).getByText(marker).waitFor({ timeout: 10000 });
});

await step('save status returns to "Saved to cloud"', claudia, async () => {
  await claudia.getByTestId('save-status').getByText('Saved to cloud').waitFor({ timeout: 15000 });
});

await step('bold via toolbar syncs as formatting', claudia, async () => {
  await editorOf(claudia).getByText(marker).click({ clickCount: 3 });
  await claudia.getByRole('button', { name: 'Bold' }).click();
  await mika.locator('strong', { hasText: marker }).waitFor({ timeout: 10000 });
});

await step('comment on selection shows in the other user’s panel', claudia, async () => {
  await editorOf(claudia).getByText(marker).click({ clickCount: 3 });
  await claudia.getByRole('button', { name: 'Add comment' }).click();
  await claudia.getByPlaceholder('Add a comment… use @ to mention').fill('@Mika can you check this line?');
  await claudia.keyboard.press('Control+Enter');
  await claudia.locator('.mo-comment').first().waitFor({ timeout: 10000 });
  await mika.getByText('can you check this line?').waitFor({ timeout: 10000 });
  await mika.locator('.mo-comment').first().waitFor({ timeout: 10000 });
});

await step('reply and resolve', mika, async () => {
  await mika.getByText('can you check this line?').click();
  await mika.getByPlaceholder('Reply…').fill('Looks good.');
  await mika.keyboard.press('Control+Enter');
  await claudia.getByText('Looks good.').waitFor({ timeout: 10000 });
  await mika.getByRole('button', { name: 'Resolve', exact: true }).click();
  await claudia.getByText('No comments yet').waitFor({ timeout: 10000 });
});

await step('@mention suggestion inserts a mention', claudia, async () => {
  await editorOf(claudia).getByText(marker).click();
  await claudia.keyboard.press('End');
  await claudia.keyboard.type(' @Hana');
  await claudia.getByRole('button', { name: /Hana Lee/ }).waitFor();
  await claudia.keyboard.press('Enter');
  await editorOf(mika).locator('p', { hasText: marker }).locator('.mo-mention', { hasText: 'Hana Lee' }).waitFor({ timeout: 10000 });
});

await step('save a named version and preview it', claudia, async () => {
  await claudia.getByRole('button', { name: 'Version history' }).click();
  await claudia.getByPlaceholder('Name this version (optional)').fill(`E2E checkpoint ${marker}`);
  await claudia.getByRole('button', { name: 'Save', exact: true }).click();
  await claudia.getByText(`E2E checkpoint ${marker}`).click();
  await claudia.getByTestId('version-preview').getByText(marker).waitFor();
  await claudia.getByRole('button', { name: 'Back to current' }).click();
});

await step('download as Word (.docx)', claudia, async () => {
  await claudia.getByRole('button', { name: 'File', exact: true }).click();
  const [dl] = await Promise.all([claudia.waitForEvent('download'), claudia.getByRole('menuitem', { name: 'Word (.docx)' }).click()]);
  if (!dl.suggestedFilename().endsWith('.docx')) throw new Error(dl.suggestedFilename());
});

await step('viewer opens read-only and cannot type', claudia, async () => {
  const sora = await session('sora@hanami.example');
  await sora.goto(docUrl);
  await editorOf(sora).waitFor();
  await sora.getByText('View only').waitFor();
  if ((await editorOf(sora).getAttribute('contenteditable')) !== 'false') throw new Error('editor is editable for viewer');
});

await step('clean up: remove the test line', claudia, async () => {
  await editorOf(claudia).getByText(marker).click({ clickCount: 3 });
  await claudia.keyboard.press('Backspace');
  await claudia.keyboard.press('Backspace');
  await editorOf(mika).getByText(marker).waitFor({ state: 'detached', timeout: 10000 });
});

console.log(errors.length ? 'browser errors:\n' + [...new Set(errors)].join('\n') : 'no browser errors');
console.log(fails ? `${fails} failed` : 'all passed');
await browser.close();
process.exit(fails ? 1 : 0);
