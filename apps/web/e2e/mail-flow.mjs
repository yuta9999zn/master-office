// Mail module end-to-end (§69): inbox, reading, compose with address suggestions and an attachment, live delivery,
// reply, archive / trash / delete, drafts, shared space mailbox (assign, answer, read-only roles), search.
// node e2e/mail-flow.mjs   (needs the web app + API + fresh seed)
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
    await page.screenshot({ path: join(tmpdir(), `mo-mail-fail-${name.replace(/\W+/g, '_')}.png`) });
  }
};
const thread = (page, subject) => page.getByTestId('thread-list').locator(`[data-testid="mail-thread"][data-subject="${subject}"]`);
const folderLoc = (page, address, f) => page.locator(`[data-testid="mailbox"][data-address="${address}"] [data-testid="folder"][data-folder="${f}"]`);
// Clicking a folder, then waiting until it is the open one (so the list below is that folder's).
const folder = (page, address, f) => ({
  click: async () => {
    await folderLoc(page, address, f).click();
    await folderLoc(page, address, f).and(page.locator('[aria-current="page"]')).waitFor();
    await page.waitForFunction((x) => new URLSearchParams(location.search).get('folder') === x, f);
  },
});

const claudia = await session('claudia@hanami.example');
const hana = await session('hana@hanami.example');

await step('the inbox lists conversations; opening one marks it read', claudia, async () => {
  await claudia.goto(`${BASE}/mail`);
  await thread(claudia, 'Q4 campaign assets ready for review').waitFor({ timeout: 60000 });
  await claudia.getByTestId('mail-unread').getByText('3').waitFor();
  if ((await thread(claudia, 'Q4 campaign assets ready for review').getAttribute('data-unread')) !== 'true') throw new Error('not unread');
  await thread(claudia, 'Q4 campaign assets ready for review').locator('button').first().click();
  await claudia.getByTestId('mail-subject').getByText('Q4 campaign assets ready for review').waitFor();
  await claudia.waitForFunction(() => document.querySelector('[data-subject="Q4 campaign assets ready for review"]')?.getAttribute('data-unread') === 'false');
  await claudia.getByTestId('mail-unread').getByText('2').waitFor();
});

await step('compose with address suggestions and an attachment; the draft saves itself; send', claudia, async () => {
  await hana.goto(`${BASE}/mail`);
  await hana.getByTestId('thread-list').waitFor({ timeout: 60000 });
  await claudia.getByTestId('compose').click();
  const box = claudia.getByTestId('mail-compose');
  await box.getByLabel('To').fill('han');
  await claudia.getByTestId('address-suggestions').getByText('hana@hanami.example').waitFor();
  await box.getByLabel('To').press('Enter');
  await box.getByTestId('address-chip').getByText('Hana Lee').waitFor();
  await box.getByLabel('Subject').fill('Launch checklist');
  await box.getByTestId('compose-body').fill('Hi Hana,\n\nThe checklist is attached. See https://example.com/launch for the timeline.');
  await box.getByTestId('compose-upload').setInputFiles({ name: 'checklist.txt', mimeType: 'text/plain', buffer: Buffer.from('1. Posters\n2. SNS\n3. Store displays') });
  await box.locator('[data-testid="compose-attachments"] [data-status="ready"]').waitFor();
  await box.getByTestId('draft-saved').waitFor({ timeout: 15000 });
  await box.getByTestId('compose-send').click();
  await box.waitFor({ state: 'detached' });
  await folder(claudia, 'claudia@hanami.example', 'sent').click();
  await thread(claudia, 'Launch checklist').waitFor();
});

await step('the recipient gets it live, opens it, downloads and saves the attachment', hana, async () => {
  await thread(hana, 'Launch checklist').waitFor({ timeout: 15000 });
  await thread(hana, 'Launch checklist').locator('button').first().click();
  const msg = hana.getByTestId('mail-message').last();
  await msg.getByTestId('mail-body').getByText('The checklist is attached.').waitFor();
  await msg.locator('a[href="https://example.com/launch"]').waitFor();
  const att = msg.locator('[data-testid="mail-attachment"][data-name="checklist.txt"]');
  await att.waitFor();
  const [dl] = await Promise.all([hana.waitForEvent('download'), att.getByRole('link', { name: 'Download checklist.txt' }).click()]);
  if (dl.suggestedFilename() !== 'checklist.txt') throw new Error(dl.suggestedFilename());
  await att.getByRole('button', { name: 'Save checklist.txt to Drive' }).click();
  await hana.getByText('Saved “checklist.txt” to My Files').waitFor();
});

await step('replying threads the answer for both people', hana, async () => {
  await hana.getByTestId('reply').click();
  const box = hana.getByTestId('mail-compose');
  await box.getByTestId('address-chip').getByText('Claudia Chen').waitFor();
  if ((await box.getByLabel('Subject').inputValue()) !== 'Re: Launch checklist') throw new Error(await box.getByLabel('Subject').inputValue());
  await box.getByTestId('compose-body').press('Control+Home');
  await box.getByTestId('compose-body').pressSequentially('Thanks, all clear!');
  await box.getByTestId('compose-send').click();
  await box.waitFor({ state: 'detached' });
  await hana.getByTestId('mail-message').filter({ hasText: 'Thanks, all clear!' }).waitFor();
  await folder(claudia, 'claudia@hanami.example', 'inbox').click();
  await thread(claudia, 'Launch checklist').locator('button').first().click();
  await claudia.getByTestId('mail-message').filter({ hasText: 'Thanks, all clear!' }).waitFor({ timeout: 15000 });
});

await step('archive, trash, restore and delete forever', claudia, async () => {
  const row = thread(claudia, 'Year-end holiday schedule');
  await row.hover();
  await row.getByRole('button', { name: 'Archive' }).click();
  await row.waitFor({ state: 'detached' });
  await folder(claudia, 'claudia@hanami.example', 'archive').click();
  await thread(claudia, 'Year-end holiday schedule').hover();
  await thread(claudia, 'Year-end holiday schedule').getByRole('button', { name: 'Delete' }).click();
  await folder(claudia, 'claudia@hanami.example', 'trash').click();
  await thread(claudia, 'Year-end holiday schedule').locator('button').first().click();
  await claudia.getByRole('button', { name: 'Restore' }).click();
  await folder(claudia, 'claudia@hanami.example', 'inbox').click();
  await thread(claudia, 'Year-end holiday schedule').hover();
  await thread(claudia, 'Year-end holiday schedule').getByRole('button', { name: 'Delete' }).click();
  await folder(claudia, 'claudia@hanami.example', 'trash').click();
  await thread(claudia, 'Year-end holiday schedule').locator('button').first().click();
  await claudia.getByRole('button', { name: 'Delete forever' }).click();
  await thread(claudia, 'Year-end holiday schedule').waitFor({ state: 'detached' });
});

await step('closing the compose window keeps a draft that opens again; discard removes it', claudia, async () => {
  await claudia.getByTestId('compose').click();
  const box = claudia.getByTestId('mail-compose');
  await box.getByLabel('Subject').fill('Ideas for spring');
  await box.getByTestId('compose-body').fill('Some first thoughts');
  await box.getByTestId('draft-saved').waitFor({ timeout: 15000 });
  await box.getByRole('button', { name: 'Close (keeps the draft)' }).click();
  await folder(claudia, 'claudia@hanami.example', 'drafts').click();
  await thread(claudia, 'Ideas for spring').locator('button').first().click();
  await box.waitFor();
  if ((await box.getByTestId('compose-body').inputValue()) !== 'Some first thoughts') throw new Error('draft text');
  await box.getByRole('button', { name: 'Discard draft' }).click();
  await thread(claudia, 'Ideas for spring').waitFor({ state: 'detached' });
});

await step('a shared space mailbox: assign a conversation and answer from the shared address', hana, async () => {
  await hana.locator('[data-testid="mailbox"][data-address="marketing@hanami.example"] > button').click();
  await thread(hana, 'Collaboration proposal for the spring campaign').locator('button').first().click();
  await hana.getByTestId('assign').click();
  await hana.getByRole('menuitem', { name: 'Mika Tanaka' }).click();
  await hana.getByTestId('assign').getByText('Mika').waitFor();
  await hana.getByTestId('reply').click();
  const box = hana.getByTestId('mail-compose');
  if (!(await box.getByLabel('From').locator('option:checked').innerText()).includes('marketing@hanami.example')) throw new Error('from');
  await box.getByTestId('compose-body').press('Control+Home');
  await box.getByTestId('compose-body').pressSequentially('Thank you Aiko, Thursday works.');
  await box.getByTestId('compose-send').click();
  await hana.getByText(/outside address/).waitFor();
  const answer = hana.getByTestId('mail-message').filter({ hasText: 'Thank you Aiko, Thursday works.' });
  await answer.getByText('<marketing@hanami.example>').waitFor();
});

await step('people who only read the space see the shared mailbox read-only', hana, async () => {
  const yuki = await session('yuki@hanami.example');
  await yuki.goto(`${BASE}/mail`);
  await yuki.locator('[data-testid="mailbox"][data-address="marketing@hanami.example"] > button').click({ timeout: 60000 });
  await yuki.getByText('Read only — your role in the space').waitFor();
  await thread(yuki, 'Collaboration proposal for the spring campaign').locator('button').first().click();
  await yuki.getByText('You can read this shared mailbox').waitFor();
  if (await yuki.getByTestId('reply').count()) throw new Error('reply offered to a commenter');
  await yuki.context().close();
});

await step('search finds mail by its words', claudia, async () => {
  await claudia.getByLabel('Search mail').fill('renewal');
  await thread(claudia, 'Contract renewal 2027').waitFor();
  await claudia.getByLabel('Search mail').fill('');
});

await browser.close();
if (errors.length) {
  console.log('page errors:\n' + errors.join('\n'));
  fails++;
}
console.log(fails ? `\n${fails} step(s) failed` : '\nall mail e2e steps passed');
process.exit(fails ? 1 : 0);
