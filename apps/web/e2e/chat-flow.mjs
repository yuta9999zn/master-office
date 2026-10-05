// Phase 5 end-to-end: Chat — list and unread badges, live messages between two people, typing, mentions,
// reactions, threads, edit/delete, read receipts, new DM / channel, browse & join, pin.
// node e2e/chat-flow.mjs   (needs the web app + API + freshly seeded data)
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
    await page.screenshot({ path: join(tmpdir(), `mo-chat-fail-${name.replace(/\W+/g, '_')}.png`) });
  }
};
const until = async (page, fn, arg, timeout = 15000) => page.waitForFunction(fn, arg, { timeout, polling: 200 });
const row = (page, title) => page.locator(`[data-testid="conversation-row"][data-title="${title}"]`);
const lastMessage = (page) => page.getByTestId('timeline').getByTestId('message').last();

const claudia = await session('claudia@kaori.jp');
const hana = await session('hana@kaori.jp');

await step('the list shows conversations with unread badges and the sidebar total', claudia, async () => {
  await claudia.goto(`${BASE}/chat`);
  await row(claudia, 'Marketing Team').waitFor({ timeout: 60000 });
  const badge = await row(claudia, 'Marketing Team').getByTestId('unread-badge').innerText();
  if (badge !== '2') throw new Error('marketing badge ' + badge);
  if ((await row(claudia, 'ITM Japan - Project').getByTestId('unread-badge').innerText()) !== '@3') throw new Error('mention badge');
  if ((await claudia.getByTestId('chat-unread').innerText()) !== '5') throw new Error('sidebar total');
  await claudia.getByText('Select a conversation').waitFor();
});

await step('opening a conversation shows the "New" divider and clears its unread count', claudia, async () => {
  await row(claudia, 'Marketing Team').click();
  await claudia.getByTestId('conversation-title').getByText('Marketing Team').waitFor();
  await claudia.getByTestId('new-divider').waitFor();
  await until(claudia, () => !document.querySelector('[data-title="Marketing Team"] [data-testid="unread-badge"]'));
  await until(claudia, () => document.querySelector('[data-testid="chat-unread"]')?.textContent === '3');
});

await step('a message appears live for the other person, with typing first', hana, async () => {
  await hana.goto(`${BASE}/chat`);
  await row(hana, 'Marketing Team').click();
  await hana.getByTestId('composer').waitFor();
  await claudia.getByTestId('composer').click();
  await claudia.keyboard.type('Thanks Hana, ', { delay: 20 });
  await hana.getByTestId('typing').getByText('Claudia is typing…').waitFor();
  await claudia.keyboard.type('the concept looks great!');
  await claudia.keyboard.press('Enter');
  await lastMessage(hana).getByText('Thanks Hana, the concept looks great!').waitFor();
  if (await claudia.getByTestId('composer').inputValue()) throw new Error('composer not cleared');
  await until(hana, () => !document.querySelector('[data-testid="typing"]')?.textContent);
});

await step('@mentions are suggested, sent as a mention and highlighted for the person', claudia, async () => {
  await claudia.getByTestId('composer').fill('');
  await claudia.getByTestId('composer').pressSequentially('Can you check this @han');
  await claudia.getByTestId('mention-list').getByText('Hana Lee').waitFor();
  await claudia.keyboard.press('Enter');
  await claudia.keyboard.type('please?');
  if ((await claudia.getByTestId('composer').inputValue()) !== 'Can you check this @Hana Lee please?') throw new Error(await claudia.getByTestId('composer').inputValue());
  await claudia.keyboard.press('Enter');
  const mention = lastMessage(hana).locator('[data-mention]');
  await mention.getByText('@Hana Lee').waitFor();
  if (!(await mention.getAttribute('class')).includes('amber')) throw new Error('mention of me not highlighted');
});

await step('Markdown renders bold, code and links', claudia, async () => {
  await claudia.getByTestId('composer').fill('**Launch** is `v2` — see https://example.com/plan');
  await claudia.keyboard.press('Enter');
  const m = lastMessage(hana);
  await m.locator('strong', { hasText: 'Launch' }).waitFor();
  await m.locator('code', { hasText: 'v2' }).waitFor();
  await m.locator('a[href="https://example.com/plan"]').waitFor();
});

await step('reactions from the hover bar show for both people', hana, async () => {
  const m = lastMessage(hana);
  await m.hover();
  await m.getByRole('button', { name: 'React 🎉' }).click();
  const chip = m.getByTestId('reaction');
  await chip.getByText('1').waitFor();
  if ((await chip.getAttribute('aria-pressed')) !== 'true') throw new Error('not marked as mine');
  const theirs = lastMessage(claudia).getByTestId('reaction');
  await theirs.getByText('1').waitFor();
  if ((await theirs.getAttribute('aria-pressed')) !== 'false') throw new Error('marked as mine for the other person');
});

await step('replying in a thread updates the reply count live', hana, async () => {
  const m = lastMessage(hana);
  await m.hover();
  await m.getByRole('button', { name: 'Reply in thread' }).click();
  await hana.getByTestId('thread-panel').waitFor();
  await hana.getByTestId('thread-composer').fill('Plan looks good to me');
  await hana.keyboard.press('Enter');
  await hana.getByTestId('thread-panel').getByText('Plan looks good to me').waitFor();
  await lastMessage(claudia).getByTestId('thread-summary').getByText('1 reply').waitFor();
  await lastMessage(claudia).getByTestId('thread-summary').click();
  await claudia.getByTestId('thread-panel').getByText('Plan looks good to me').waitFor();
  await claudia.getByRole('button', { name: 'Close thread' }).click();
});

await step('↑ edits your last message; others see "(edited)"', claudia, async () => {
  await claudia.getByTestId('composer').click();
  await claudia.keyboard.press('ArrowUp');
  const ed = claudia.getByTestId('edit-composer');
  await ed.waitFor();
  await ed.fill('**Launch** is `v2.1` — see https://example.com/plan');
  await claudia.keyboard.press('Enter');
  await lastMessage(hana).locator('code', { hasText: 'v2.1' }).waitFor();
  await lastMessage(hana).getByText('(edited)').waitFor();
});

await step('deleting a message leaves a placeholder for everyone', claudia, async () => {
  await claudia.getByTestId('composer').fill('oops, wrong chat');
  await claudia.keyboard.press('Enter');
  await lastMessage(hana).getByText('oops, wrong chat').waitFor();
  const m = lastMessage(claudia);
  await m.getByText('oops, wrong chat').waitFor();
  await m.hover();
  await m.getByRole('button', { name: 'More actions' }).click();
  await claudia.getByRole('menuitem', { name: 'Delete' }).click();
  await lastMessage(hana).getByText('This message was deleted').waitFor();
});

await step('a direct message from the New menu, with "Seen" once read', claudia, async () => {
  await claudia.getByTestId('new-chat').click();
  await claudia.getByRole('menuitem', { name: 'New message or group' }).click();
  await claudia.getByLabel('Search people').fill('Ken');
  await claudia.getByTestId('people-picker').getByRole('button', { name: /Ken Watanabe/ }).click();
  await claudia.getByTestId('start-chat').click();
  await claudia.getByTestId('conversation-title').getByText('Ken Watanabe').waitFor();
  await claudia.getByTestId('composer').fill('Hi Ken, quick question about inventory');
  await claudia.keyboard.press('Enter');
  await lastMessage(claudia).getByTestId('receipt').getByText('Sent').waitFor();
  const ken = await session('ken@kaori.jp');
  await ken.goto(`${BASE}/chat`);
  await row(ken, 'Claudia Chen').getByTestId('unread-badge').waitFor({ timeout: 60000 });
  await row(ken, 'Claudia Chen').click();
  await lastMessage(ken).getByText('Hi Ken, quick question about inventory').waitFor();
  await lastMessage(claudia).getByTestId('receipt').getByText('Seen').waitFor();
  await ken.context().close();
});

await step('creating a channel and finding it in Browse channels', claudia, async () => {
  await claudia.getByTestId('new-chat').click();
  await claudia.getByRole('menuitem', { name: 'Create a channel' }).click();
  await claudia.getByLabel('Channel name').fill('Holiday party');
  await claudia.getByLabel('Channel description').fill('Planning the year-end party');
  await claudia.getByTestId('create-channel').click();
  await claudia.getByTestId('conversation-title').getByText('Holiday party').waitFor();
  await claudia.getByTestId('system-message').getByText('created the channel Holiday party').waitFor();

  await hana.getByTestId('new-chat').click();
  await hana.getByRole('menuitem', { name: 'Browse channels' }).click();
  await hana.getByLabel('Search channels').fill('holiday');
  const entry = hana.getByTestId('channel-directory').locator('[data-name="Holiday party"]');
  await entry.waitFor();
  await entry.getByRole('button', { name: 'Open' }).or(entry.getByRole('button', { name: 'Join' })).first().waitFor();
  await entry.getByRole('button', { name: 'Holiday party' }).click();
  await hana.getByTestId('join-banner').waitFor();
  await hana.getByTestId('join-banner').getByRole('button', { name: 'Join channel' }).click();
  await hana.getByTestId('composer').waitFor();
  await claudia.getByTestId('system-message').getByText('joined').waitFor();
});

await step('pinning moves a conversation into Pinned', claudia, async () => {
  const r = row(claudia, 'Branch 625');
  await r.hover();
  await r.getByRole('button', { name: 'Options for Branch 625' }).click();
  await claudia.getByRole('menuitem', { name: 'Pin to top' }).click();
  await until(claudia, () => {
    const list = document.querySelector('[data-testid="conversation-list"]');
    const rows = [...list.querySelectorAll('[data-testid="conversation-row"]')];
    return list.textContent.includes('Pinned') && rows[0]?.getAttribute('data-title') === 'Branch 625';
  });
  await claudia.getByRole('tab', { name: 'favorites' }).click();
  await until(claudia, () => [...document.querySelectorAll('[data-testid="conversation-row"]')].map((r) => r.getAttribute('data-title')).join() === 'Branch 625');
  await claudia.getByRole('tab', { name: 'all' }).click();
});

await step('Home shows recent chats', claudia, async () => {
  await claudia.goto(`${BASE}/home`);
  await claudia.getByTestId('recent-chats').getByText('Holiday party').waitFor({ timeout: 60000 });
});

await browser.close();
if (errors.length) {
  console.log('page errors:\n' + errors.join('\n'));
  fails++;
}
console.log(fails ? `\n${fails} step(s) failed` : '\nall chat e2e steps passed');
process.exit(fails ? 1 : 0);
