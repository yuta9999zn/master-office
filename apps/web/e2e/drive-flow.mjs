import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Drive end-to-end flow against a running dev stack (pnpm dev) with seeded data (pnpm db:seed).
//   pnpm --filter @workos/web e2e
const BASE = process.env.WEB_URL ?? 'http://localhost:3000';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 940 } });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text()));
let fails = 0;
const step = async (name, fn) => {
  try {
    await fn();
    console.log('✓', name);
  } catch (e) {
    fails++;
    console.log('✗', name, '—', e.message.split('\n')[0]);
    await page.screenshot({ path: join(tmpdir(), `mo-fail-${name.replace(/\W+/g, '_')}.png`) });
  }
};
const row = (name) => page.locator('[role=row]', { hasText: name }).first();
const menuItem = (name) => page.getByRole('menuitem', { name, exact: false }).first();
const folder = `E2E Folder ${Date.now() % 100000}`;

const small = join(tmpdir(), 'small.txt');
const big = join(tmpdir(), 'big.bin');
writeFileSync(small, 'hello from e2e');
writeFileSync(big, Buffer.alloc(12 * 1024 * 1024, 7));

await page.goto(BASE + '/drive/my', { waitUntil: 'networkidle' });

await step('create folder via New menu', async () => {
  await page.locator('main').getByRole('button', { name: 'New', exact: true }).click();
  await menuItem('New folder').click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type(folder);
  await page.keyboard.press('Enter');
  await row(folder).waitFor({ timeout: 10000 });
});

await step('open folder by double click', async () => {
  await row(folder).dblclick();
  await page.waitForURL(/\/drive\/folder\//);
  await page.getByRole('heading', { name: folder }).waitFor();
});

await step('upload small + 12MB file (direct to API, bypassing the 10MB Next proxy)', async () => {
  await page.locator('input[type=file]').setInputFiles([small, big]);
  await row('small.txt').waitFor({ timeout: 30000 });
  await row('big.bin').waitFor({ timeout: 30000 });
  const size = await row('big.bin').textContent();
  if (!size.includes('12 MB')) throw new Error('size shown: ' + size);
});

await step('rename via context menu', async () => {
  await row('small.txt').click({ button: 'right' });
  await menuItem('Rename').click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('notes-renamed.txt');
  await page.keyboard.press('Enter');
  await row('notes-renamed.txt').waitFor();
});

await step('share with Mika from Share dialog', async () => {
  await row('notes-renamed.txt').click();
  await page.locator('main').getByRole('button', { name: 'Share', exact: true }).nth(1).click();
  await page.getByPlaceholder('Add members, groups, or email').fill('Mika');
  await page.getByRole('button', { name: /Mika Tanaka/ }).click();
  await page.getByRole('dialog').getByText('Mika Tanaka').waitFor();
  await page.getByRole('button', { name: 'Done' }).click();
});

await step('details panel shows activity for shared file', async () => {
  await page.getByRole('tab', { name: 'Activity' }).click();
  await page.getByText(/shared with Mika Tanaka/).first().waitFor();
});

await step('move file to Marketing space', async () => {
  await row('notes-renamed.txt').click({ button: 'right' });
  await menuItem('Move to').click();
  await page.getByRole('dialog').getByRole('button', { name: 'Marketing' }).click();
  await page.getByRole('button', { name: 'Move here' }).click();
  await page.getByText(/Moved “notes-renamed.txt” to Marketing/).waitFor();
  await row('notes-renamed.txt').waitFor({ state: 'detached' });
});

await step('trash folder, then delete forever from Trash', async () => {
  await page.goto(BASE + '/drive/my', { waitUntil: 'networkidle' });
  await row(folder).click({ button: 'right' });
  await menuItem('Move to trash').click();
  await row(folder).waitFor({ state: 'detached' });
  await page.goto(BASE + '/drive/trash', { waitUntil: 'networkidle' });
  await row(folder).click({ button: 'right' });
  await menuItem('Delete forever').click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete forever' }).click();
  await row(folder).waitFor({ state: 'detached' });
});

await step('clean up moved file', async () => {
  const q = await page.request.get(BASE + '/api/search?q=notes-renamed');
  const [hit] = await q.json();
  await page.request.post(`${BASE}/api/resources/${hit.id}/trash`);
  const d = await page.request.delete(`${BASE}/api/resources/${hit.id}`);
  if (d.status() !== 204) throw new Error('delete ' + d.status());
});

await step('Ctrl+K search opens the right editor', async () => {
  await page.keyboard.press('Control+K');
  await page.keyboard.type('Marketing Plan');
  await page.getByRole('option', { name: /Marketing Plan - Q4 2026/ }).waitFor();
  await page.keyboard.press('Enter');
  await page.waitForURL(/\/docs\//);
  await page.getByText('Saved to cloud').waitFor();
});

await step('switch user: Hana cannot see private HR space', async () => {
  const users = await (await page.request.get(BASE + '/api/users')).json();
  const hana = users.find((u) => u.email === 'hana@hanami.example');
  await page.context().addCookies([{ name: 'mo_uid', value: hana.id, url: BASE }]);
  await page.goto(BASE + '/spaces', { waitUntil: 'networkidle' });
  await page.getByText('Marketing', { exact: true }).first().waitFor();
  if (await page.getByText('Recruitment, onboarding and HR policies').count()) throw new Error('HR visible to Hana');
  await page.context().clearCookies();
});

console.log(errors.length ? 'browser errors:\n' + [...new Set(errors)].join('\n') : 'no browser errors');
console.log(fails ? `${fails} failed` : 'all passed');
await browser.close();
process.exit(fails ? 1 : 0);
