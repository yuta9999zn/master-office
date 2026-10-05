// Phase 5 end-to-end: Chat, the Discord model (§68) — space rail and channels by category, unread badges, live
// messages between two people, typing, mentions, reactions, threads, edit/delete, read receipts, DMs, channel
// creation by space admins, read-only roles, files that never grant access, pins.
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
const space = async (page, name) => {
  await page.locator(`[data-testid="rail-space"][data-name="${name}"]`).click();
  await page.getByTestId('space-title').getByText(name, { exact: true }).waitFor({ timeout: 60000 });
  // Opening a space opens its first channel (as Discord does): wait for that before touching anything.
  await page.locator('[data-testid="conversation-list"] [aria-current="page"]').waitFor({ timeout: 30000 });
  await page.getByTestId('conversation-title').waitFor();
};
const home = async (page) => {
  await page.getByTestId('rail-home').click();
  await page.getByText('Direct messages', { exact: true }).first().waitFor();
};

await step('the rail shows spaces with mention counts; channels sit in categories; the sidebar total adds up', claudia, async () => {
  await claudia.goto(`${BASE}/chat`);
  await claudia.getByTestId('space-rail').waitFor({ timeout: 60000 });
  await claudia.locator('[data-testid="rail-space"][data-name="ITM Japan"] [data-testid="rail-badge"]').getByText('1').waitFor();
  await until(claudia, () => document.querySelector('[data-testid="chat-unread"]')?.textContent === '5');
  await space(claudia, 'Natural Beauty');
  await claudia.locator('[data-testid="channel-category"][data-name="Information"] [data-title="Announcements"]').waitFor();
});

await step('opening a channel shows the "New" divider and clears its unread count', claudia, async () => {
  await space(claudia, 'Marketing');
  await row(claudia, 'Marketing Team').click();
  await claudia.getByTestId('conversation-title').getByText('Marketing Team').waitFor();
  await claudia.getByTestId('conversation-subtitle').getByText(/Marketing ·/).waitFor();
  await claudia.getByTestId('new-divider').waitFor();
  await until(claudia, () => !document.querySelector('[data-title="Marketing Team"] [data-testid="unread-badge"]'));
  await until(claudia, () => document.querySelector('[data-testid="chat-unread"]')?.textContent === '3');
});

await step('a message appears live for the other person, with typing first', hana, async () => {
  await hana.goto(`${BASE}/chat`);
  await space(hana, 'Marketing');
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


await step('a direct message from Home, with "Seen" once read', claudia, async () => {
  await home(claudia);
  await claudia.getByTestId('new-chat').click();
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

await step('space admins create a channel in a category; everyone in the space has it at once', claudia, async () => {
  await space(claudia, 'Natural Beauty');
  await claudia.getByTestId('space-menu').click();
  await claudia.getByRole('menuitem', { name: 'Create channel' }).click();
  await claudia.getByLabel('Channel name').fill('Holiday party');
  await claudia.getByLabel('Channel description').fill('Planning the year-end party');
  await claudia.getByLabel('Category').selectOption({ label: 'Text channels' });
  await claudia.getByTestId('create-channel').click();
  await claudia.getByTestId('conversation-title').getByText('Holiday party').waitFor();
  await claudia.getByTestId('system-message').getByText('created the channel Holiday party').waitFor();
  await claudia.locator('[data-testid="channel-category"][data-name="Text channels"] [data-title="Holiday party"]').waitFor();
  await space(hana, 'Natural Beauty');
  await row(hana, 'Holiday party').click();
  await hana.getByTestId('conversation-title').getByText('Holiday party').waitFor();
  await hana.getByTestId('composer').fill('Count me in!');
  await hana.keyboard.press('Enter');
  await lastMessage(claudia).getByText('Count me in!').waitFor();
});

await step('members cannot create channels; read-only roles get no composer', hana, async () => {
  await space(hana, 'Natural Beauty');
  await hana.getByTestId('space-menu').click();
  if (await hana.getByRole('menuitem', { name: 'Create channel' }).count()) throw new Error('a member can create channels');
  await hana.keyboard.press('Escape');
  // Hana only views the Operations space (public, she is not a member): she reads, cannot write.
  await space(hana, 'Operations');
  await hana.getByTestId('space-role').getByText('read only').waitFor();
  await row(hana, 'Operations').click();
  await hana.getByTestId('conversation-title').getByText('Operations').waitFor();
  await hana.getByTestId('read-only-banner').waitFor();
  if (await hana.getByTestId('composer').count()) throw new Error('composer shown to a viewer');
});

await step('announcement channels: only admins post', hana, async () => {
  await space(hana, 'Natural Beauty');
  await row(hana, 'Announcements').click();
  await hana.getByTestId('conversation-title').getByText('Announcements').waitFor();
  await hana.getByTestId('read-only-banner').getByText(/announcement channel/).waitFor();
});

await step('pinning moves a direct message into Pinned', claudia, async () => {
  await home(claudia);
  const r = row(claudia, 'Hana Lee');
  await r.hover();
  await r.getByRole('button', { name: 'Options for Hana Lee' }).click();
  await claudia.getByRole('menuitem', { name: 'Pin to top' }).click();
  await until(claudia, () => {
    const list = document.querySelector('[data-testid="conversation-list"]');
    const rows = [...list.querySelectorAll('[data-testid="conversation-row"]')];
    return list.textContent.includes('Pinned') && rows[0]?.getAttribute('data-title') === 'Hana Lee';
  });
});

await step('file cards show live metadata and open the right editor', claudia, async () => {
  await space(claudia, 'ITM Japan');
  await row(claudia, 'ITM Japan - Project').click();
  const card = claudia.getByTestId('timeline').locator('[data-testid="file-card"][data-name="Project Plan Sep.pptx"]');
  await card.waitFor();
  if (!(await card.innerText()).includes('PPTX')) throw new Error(await card.innerText());
  await card.click();
  await claudia.waitForURL(/\/slides\//, { timeout: 30000 });
  await claudia.goBack();
  await claudia.getByTestId('conversation-title').getByText('ITM Japan - Project').waitFor({ timeout: 30000 });
});

const shareFromDrive = async (page, name) => {
  await page.getByRole('button', { name: 'Attach' }).click();
  await page.getByRole('menuitem', { name: 'Share from Drive' }).click();
  await page.getByLabel('Search files').fill(name);
  await page.getByTestId('file-picker').locator(`[data-name="${name}"]`).click();
  await page.getByTestId('pick-files').click();
  await page.getByTestId('composer-file').filter({ hasText: name }).waitFor();
};

await step('chat never grants file access: people without it see a locked card', claudia, async () => {
  await home(claudia);
  await row(claudia, 'Hana Lee').click();
  await claudia.getByTestId('conversation-title').getByText('Hana Lee').waitFor();
  await shareFromDrive(claudia, 'HR Manual');
  await claudia.getByTestId('composer').click();
  await claudia.keyboard.press('Enter');
  const dialog = claudia.getByTestId('access-dialog');
  await dialog.getByText('No access: Hana Lee').waitFor();
  if (await claudia.getByTestId('share-and-send').count()) throw new Error('chat offers to share');
  await claudia.getByTestId('send-anyway').click();
  await lastMessage(claudia).locator('[data-testid="file-card"][data-name="HR Manual"]').waitFor();
  await home(hana);
  await row(hana, 'Claudia Chen').click();
  await hana.getByTestId('conversation-title').getByText('Claudia Chen').waitFor();
  await lastMessage(hana).locator('[data-testid="file-card"][data-locked="true"]').getByText('Restricted file').waitFor();
});

await step('a file uploaded into the conversation opens for its members', claudia, async () => {
  await claudia.getByTestId('composer').fill('Here is the agenda');
  await claudia.getByTestId('composer-upload').setInputFiles({ name: 'agenda.txt', mimeType: 'text/plain', buffer: Buffer.from('Agenda: launch review') });
  await claudia.locator('[data-testid="composer-file"][data-status="ready"]').filter({ hasText: 'agenda.txt' }).waitFor();
  await claudia.getByTestId('composer').click();
  await claudia.keyboard.press('Enter');
  const card = lastMessage(hana).locator('[data-testid="file-card"][data-name="agenda.txt"]');
  await card.waitFor();
  await claudia.getByRole('tab', { name: 'files' }).click();
  await claudia.getByTestId('files-view').locator('[data-testid="file-card"][data-name="agenda.txt"]').waitFor();
  await claudia.getByRole('tab', { name: 'chat' }).click();
});

await step('pinning a message shows it in the Pinned tab for everyone', claudia, async () => {
  const m = claudia.getByTestId('timeline').getByTestId('message').filter({ hasText: 'Here is the agenda' });
  await m.hover();
  await m.getByRole('button', { name: 'More actions' }).click();
  await claudia.getByRole('menuitem', { name: 'Pin to conversation' }).click();
  await m.getByTestId('pinned-label').getByText('Pinned by you').waitFor();
  await hana.getByTestId('system-message').getByText('pinned a message').waitFor();
  await hana.getByRole('tab', { name: 'pinned' }).click();
  await hana.getByTestId('pinned-message').getByText('Here is the agenda').waitFor();
  await hana.getByTestId('pinned-message').getByRole('button', { name: 'Unpin' }).click();
  await hana.getByText('No pinned messages').waitFor();
});

await step('Home shows recent chats', claudia, async () => {
  await claudia.goto(`${BASE}/home`);
  await claudia.getByTestId('recent-chats').getByText('Holiday party').first().waitFor({ timeout: 60000 });
});

await browser.close();
if (errors.length) {
  console.log('page errors:\n' + errors.join('\n'));
  fails++;
}
console.log(fails ? `\n${fails} step(s) failed` : '\nall chat e2e steps passed');
process.exit(fails ? 1 : 0);
