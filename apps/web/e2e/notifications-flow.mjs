// Phase 5 end-to-end: the notification bell — live badge and toast, opening a mention, a thread reply link,
// a shared file, mark all as read.   node e2e/notifications-flow.mjs   (needs the web app + API + fresh seed)
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
  return { page, users };
}
const step = async (name, page, fn) => {
  try {
    await fn();
    console.log('✓', name);
  } catch (e) {
    fails++;
    console.log('✗', name, '—', e.message.split('\n')[0]);
    await page.screenshot({ path: join(tmpdir(), `mo-notif-fail-${name.replace(/\W+/g, '_')}.png`) });
  }
};

const { page: claudia, users } = await session('claudia@hanami.example');
const { page: hana } = await session('hana@hanami.example');
const id = (key) => users.find((u) => u.email === `${key}@hanami.example`).id;
const asHana = (method, path, data) => hana.request.fetch(`${BASE}/api${path}`, { method, data }).then((r) => r.json());
const conversations = await asHana('GET', '/chat/conversations');
const marketing = conversations.find((c) => c.title === 'Marketing Team');

await step('a mention lights up the bell and shows a toast', claudia, async () => {
  // Start from an empty bell whatever ran before (other suites mention Claudia too).
  await claudia.request.post(`${BASE}/api/notifications/read`, { data: { ids: 'all' } });
  await claudia.goto(`${BASE}/home`);
  await claudia.getByTestId('bell').waitFor({ timeout: 60000 });
  if (await claudia.getByTestId('bell-count').count()) throw new Error('bell not empty');
  await claudia.waitForTimeout(1500); // socket connected
  await asHana('POST', `/chat/conversations/${marketing.id}/messages`, { body: `<@${id('claudia')}> the banner is ready for sign-off` });
  await claudia.getByTestId('bell-count').getByText('1').waitFor();
  await claudia.getByText('Hana Lee mentioned you in #Marketing Team').first().waitFor();
});

await step('opening the mention goes to the conversation and clears it', claudia, async () => {
  await claudia.getByTestId('bell').click();
  const item = claudia.getByTestId('notifications').locator('[data-testid="notification"][data-kind="chat.mention"]').first();
  await item.getByText('@Claudia Chen the banner is ready for sign-off').waitFor();
  if ((await item.getAttribute('data-read')) !== 'false') throw new Error('should be unread');
  await item.click();
  await claudia.getByTestId('conversation-title').getByText('Marketing Team').waitFor({ timeout: 30000 });
  await claudia.waitForFunction(() => !document.querySelector('[data-testid="bell-count"]'), null, { timeout: 15000 });
});

await step('a thread reply link opens the thread beside the conversation', claudia, async () => {
  await claudia.getByTestId('composer').fill('Who can check the print proofs?');
  await claudia.keyboard.press('Enter');
  const mine = claudia.getByTestId('timeline').getByTestId('message').filter({ hasText: 'Who can check the print proofs?' });
  await mine.waitFor();
  await claudia.waitForFunction(() => [...document.querySelectorAll('[data-testid="message"]')].some((m) => m.textContent.includes('print proofs') && !m.getAttribute('data-message-id').startsWith('tmp-')));
  const mid = await mine.getAttribute('data-message-id');
  await claudia.goto(`${BASE}/home`);
  await asHana('POST', `/chat/conversations/${marketing.id}/messages`, { body: 'I can, tomorrow morning', threadRootId: mid });
  await claudia.getByTestId('bell-count').getByText('1').waitFor();
  await claudia.getByTestId('bell').click();
  await claudia.getByTestId('notifications').locator('[data-kind="chat.reply"]').first().click();
  await claudia.waitForURL(/thread=/);
  await claudia.getByTestId('thread-panel').getByText('I can, tomorrow morning').waitFor({ timeout: 30000 });
  await claudia.waitForFunction(() => !document.querySelector('[data-testid="bell-count"]'), null, { timeout: 15000 });
});

await step('a shared file shows in the bell and opens the file', claudia, async () => {
  const hits = await asHana('GET', `/search?q=${encodeURIComponent('Marketing Plan - Q4 2026')}`);
  const plan = hits.find((h) => h.kind === 'resource' && h.title === 'Marketing Plan - Q4 2026');
  const r = await hana.request.post(`${BASE}/api/resources/${plan.id}/members`, { data: { userId: id('ken'), role: 'viewer' } });
  if (!r.ok()) throw new Error('share ' + r.status());
  // Claudia is told when Hana shares straight with her.
  await hana.request.post(`${BASE}/api/resources/${plan.id}/members`, { data: { userId: id('claudia'), role: 'editor' } });
  await claudia.getByTestId('bell-count').getByText('1').waitFor();
  await claudia.getByTestId('bell').click();
  await claudia.getByTestId('notifications').getByText('Hana Lee shared "Marketing Plan - Q4 2026" with you').click();
  await claudia.waitForURL(/\/docs\//, { timeout: 30000 });
});

await step('mark all as read empties the badge; Unread says all caught up', claudia, async () => {
  await asHana('POST', `/chat/conversations/${marketing.id}/messages`, { body: `<@${id('claudia')}> one more thing` });
  await asHana('POST', `/chat/conversations/${marketing.id}/messages`, { body: `<@${id('claudia')}> and another` });
  await claudia.getByTestId('bell-count').getByText('2').waitFor();
  await claudia.getByTestId('bell').click();
  await claudia.getByRole('button', { name: 'Mark all as read' }).click();
  await claudia.waitForFunction(() => !document.querySelector('[data-testid="bell-count"]'));
  await claudia.getByTestId('notifications').getByRole('tab', { name: 'unread' }).click();
  await claudia.getByText('You’re all caught up').waitFor();
});

await browser.close();
if (errors.length) {
  console.log('page errors:\n' + errors.join('\n'));
  fails++;
}
console.log(fails ? `\n${fails} step(s) failed` : '\nall notification e2e steps passed');
process.exit(fails ? 1 : 0);
