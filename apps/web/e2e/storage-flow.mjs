// Storage quotas end-to-end (§79, batch C): Admin → Storage (summary, people and teams with their meters, a custom
// limit for one person, default limits), the meter in Drive turning red when full, an upload refused with
// "Storage full", the team meter while browsing a space, and the limit back to default.
// node e2e/storage-flow.mjs   (needs the web app + API in dev mode + seed)
import { chromium } from 'playwright';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = process.env.WEB_URL ?? 'http://localhost:3000';
const API = process.env.API_URL ?? 'http://localhost:4000';
const browser = await chromium.launch();
const errors = [];
let fails = 0;
let users = [];

async function session(email) {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 940 }, timezoneId: 'Asia/Tokyo' });
  users = await (await ctx.request.get(`${BASE}/api/users`)).json();
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
    console.log('✗', name, '—', process.env.FULL ? e.message.slice(0, 1500) : e.message.split('\n')[0]);
    await page.screenshot({ path: join(tmpdir(), `mo-storage-fail-${name.replace(/\W+/g, '_')}.png`), timeout: 10000 }).catch(() => undefined);
  }
};
async function api(method, path, user, body) {
  const res = await fetch(API + path, { method, headers: { 'x-user-id': user, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null };
}

const claudia = await session('claudia@kaori.jp');
const kenId = users.find((u) => u.email === 'ken@kaori.jp').id;
const kenName = users.find((u) => u.email === 'ken@kaori.jp').name;
const claudiaId = users.find((u) => u.email === 'claudia@kaori.jp').id;
const marketing = (await api('GET', '/spaces', claudiaId)).data.find((s) => s.name === 'Marketing');

// Ken holds 1.5 MB so that a 1 MB limit is already exceeded. A clean slate first.
await api('DELETE', `/admin/storage/users/${kenId}`, claudiaId);
await api('PATCH', '/admin/storage', claudiaId, { userDefaultBytes: 10 * 1024 ** 3, orgBytes: null });
const fd = new FormData();
fd.append('file', new Blob([randomBytes(1.5 * 1024 * 1024)], { type: 'application/octet-stream' }), `big-${Date.now()}.bin`);
const big = await (await fetch(`${API}/resources/upload`, { method: 'POST', headers: { 'x-user-id': kenId }, body: fd })).json();

await step('Admin → Storage: summary, people and teams with their meters', claudia, async () => {
  await claudia.goto(`${BASE}/admin?tab=storage`);
  await claudia.getByTestId('storage-admin').waitFor({ timeout: 90000 });
  await claudia.getByTestId('storage-org-used').waitFor();
  const ken = claudia.locator('[data-testid="storage-person"][data-email="ken@kaori.jp"]');
  await ken.waitFor();
  if (!/MB|GB/.test(await ken.innerText())) throw new Error('Ken’s usage is not shown');
  await claudia.locator('[data-testid="storage-team"][data-name="Marketing"]').waitFor();
  await claudia.getByTestId('storage-largest').waitFor();
});

await step('a custom 1 MB limit for one person', claudia, async () => {
  const ken = claudia.locator('[data-testid="storage-person"][data-email="ken@kaori.jp"]');
  await ken.getByLabel(`Limit for ${kenName}`, { exact: true }).selectOption('custom');
  await ken.getByLabel(`Custom limit for ${kenName}`, { exact: true }).fill('1');
  await ken.getByLabel(`Custom limit unit for ${kenName}`, { exact: true }).selectOption('MB');
  await ken.getByLabel(`Apply limit for ${kenName}`).click();
  await claudia.locator('[data-testid="storage-person"][data-email="ken@kaori.jp"][data-percent="100"]').waitFor({ timeout: 30000 });
  const chosen = await ken.getByLabel(`Limit for ${kenName}`, { exact: true }).inputValue();
  if (chosen !== 'custom') throw new Error(`select shows ${chosen}`);
});

const ken = await session('ken@kaori.jp');
await step('the Drive meter is red and says storage is full', ken, async () => {
  await ken.goto(`${BASE}/drive/my`);
  await ken.locator('[data-testid="storage-mine"][data-full="1"]').waitFor({ timeout: 90000 });
  await ken.getByTestId('storage-full-note').waitFor();
  if (!/1(\.0)? MB/.test(await ken.getByTestId('storage-mine').innerText())) throw new Error('limit not shown');
});

await step('an upload is refused with "Storage full"', ken, async () => {
  await ken.locator('input[type=file]').setInputFiles([{ name: 'note.txt', mimeType: 'text/plain', buffer: Buffer.from('hello storage') }]);
  await ken.getByText(/Storage full/).first().waitFor({ timeout: 30000 });
});

await step('browsing a team shows the team’s meter too', ken, async () => {
  await ken.goto(`${BASE}/drive/space/${marketing.id}`);
  await ken.getByTestId('storage-team').waitFor({ timeout: 60000 });
  if (!/50 GB/.test(await ken.getByTestId('storage-team').innerText())) throw new Error('team limit not shown');
});

await step('back to the default limit', claudia, async () => {
  const row = claudia.locator('[data-testid="storage-person"][data-email="ken@kaori.jp"]');
  await row.getByLabel(`Limit for ${kenName}`, { exact: true }).selectOption('default');
  await claudia.locator('[data-testid="storage-person"][data-email="ken@kaori.jp"]:not([data-percent="100"])').waitFor({ timeout: 30000 });
  await ken.goto(`${BASE}/drive/my`);
  await ken.locator('[data-testid="storage-mine"][data-full="0"]').waitFor({ timeout: 60000 });
});

await step('default limits: 20 GB per person, then 10 GB again', claudia, async () => {
  await claudia.getByLabel('Default limit per person', { exact: true }).fill('20');
  await claudia.getByTestId('storage-defaults-save').click();
  await claudia.getByText('Storage limits saved').waitFor({ timeout: 30000 });
  await claudia.getByText(/Defaults 20 GB/).waitFor();
  await claudia.getByLabel('Default limit per person', { exact: true }).fill('10');
  await claudia.getByTestId('storage-defaults-save').click();
  await claudia.getByText(/Defaults 10 GB/).waitFor({ timeout: 30000 });
});

if (big?.id) {
  await api('POST', `/resources/${big.id}/trash`, kenId);
  await api('DELETE', `/resources/${big.id}`, kenId);
}
await browser.close();
if (errors.length) console.log('page errors:', errors);
console.log(fails ? `\n${fails} failed` : '\nall storage e2e steps passed');
process.exit(fails || errors.length ? 1 : 0);
