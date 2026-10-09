// Calendar end-to-end (§71): week view and event details, create from the grid with a guest and an invitation,
// answering from the bell link with a live update for the organizer, month / agenda, hiding a calendar, other
// people's busy time, editing, removing one occurrence, Home "Upcoming".
// node e2e/calendar-flow.mjs   (needs the web app + API + fresh seed)
import { chromium } from 'playwright';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = process.env.WEB_URL ?? 'http://localhost:3000';
const browser = await chromium.launch();
const errors = [];
let fails = 0;

async function session(email) {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 940 }, timezoneId: 'Asia/Tokyo' });
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
    await page.screenshot({ path: join(tmpdir(), `mo-cal-fail-${name.replace(/\W+/g, '_')}.png`) });
  }
};
const ev = (page, title) => page.locator(`[data-testid="event"][data-title="${title}"]`);
const claudia = await session('claudia@hanami.example');
const hana = await session('hana@hanami.example');

await step('the week shows events; opening one shows guests, answers and the meeting link', claudia, async () => {
  await claudia.goto(`${BASE}/calendar`);
  await ev(claudia, 'Mirai Systems Meeting').waitFor({ timeout: 60000 });
  await ev(claudia, 'Mirai Systems Meeting').click();
  const panel = claudia.getByTestId('event-panel');
  await panel.getByTestId('event-title').getByText('Mirai Systems Meeting').waitFor();
  await panel.locator('[data-testid="guest"][data-email="mika@hanami.example"]').getByText('Tentative').waitFor();
  // test:calendar (which runs first in `pnpm test`) has Yuki answer "maybe".
  await panel.locator('[data-testid="guest"][data-email="yuki@hanami.example"]').getByText(/^(Pending|Tentative)$/).waitFor();
  if (!(await panel.getByTestId('join-meeting').getAttribute('href')).includes('/meetings?room=')) throw new Error('meeting link');
  await panel.getByText('Project Plan Sep.pptx').waitFor();
  await panel.getByRole('button', { name: 'Close' }).click();
});

let createdTitle = `Launch rehearsal ${Date.now() % 10000}`;
await step('clicking the grid opens a new event at that time; a guest and an invitation', claudia, async () => {
  // Saturday 10:00 of this week.
  const col = claudia.getByTestId('day-column').last();
  const box = await col.boundingBox();
  await claudia.getByTestId('time-grid').locator('.overflow-y-auto').evaluate((el) => (el.scrollTop = 56 * 7.5));
  const top = (await col.boundingBox()).y;
  await claudia.mouse.click(box.x + box.width / 2, top + 56 * 10 + 10);
  const dialog = claudia.getByTestId('event-dialog');
  await dialog.waitFor();
  if ((await dialog.getByLabel('Start time').inputValue()) !== '10:00') throw new Error('start ' + (await dialog.getByLabel('Start time').inputValue()));
  await dialog.getByLabel('Title').fill(createdTitle);
  await dialog.getByLabel('Add guests').fill('han');
  await claudia.getByTestId('guest-suggestions').getByText('Hana Lee').click();
  await dialog.getByTestId('guest-chip').getByText('Hana Lee').waitFor();
  await dialog.getByLabel('Message to guests').fill('Please bring the launch deck.');
  await claudia.getByTestId('event-save').click();
  await dialog.waitFor({ state: 'detached' });
  await ev(claudia, createdTitle).waitFor();
});

await step('the guest answers from the bell link; the organizer sees it live', hana, async () => {
  await hana.goto(`${BASE}/home`);
  await hana.getByTestId('bell').click();
  await hana.getByTestId('notifications').getByText(`Claudia Chen invited you to "${createdTitle}"`).click();
  const panel = hana.getByTestId('event-panel');
  await panel.getByTestId('event-title').getByText(createdTitle).waitFor({ timeout: 30000 });
  await panel.getByTestId('rsvp').getByRole('button', { name: 'Yes' }).click();
  await ev(claudia, createdTitle).click();
  await claudia.getByTestId('event-panel').locator('[data-testid="guest"][data-email="hana@hanami.example"]').getByText('Accepted').waitFor({ timeout: 15000 });
});

await step('the invitation also arrives by mail with a calendar file', hana, async () => {
  await hana.goto(`${BASE}/mail`);
  const t = hana.getByTestId('thread-list').locator(`[data-testid="mail-thread"][data-subject^="Invitation: ${createdTitle}"]`);
  await t.waitFor({ timeout: 30000 });
  await t.locator('button').first().click();
  await hana.getByTestId('mail-message').last().getByText('Please bring the launch deck.').waitFor();
  await hana.locator('[data-testid="mail-attachment"][data-name="invite.ics"]').waitFor();
});

await step('month and agenda views', claudia, async () => {
  await claudia.getByRole('tab', { name: 'month' }).click();
  await claudia.getByTestId('month-view').locator('[data-testid="event"][data-title="Mirai Systems Meeting"]').waitFor();
  await claudia.getByRole('tab', { name: 'agenda' }).click();
  await claudia.getByTestId('agenda-view').locator(`[data-testid="event"][data-title="${createdTitle}"]`).waitFor();
  await claudia.getByRole('tab', { name: 'week' }).click();
  await ev(claudia, 'Mirai Systems Meeting').waitFor();
});

await step('hiding a team calendar hides its events', claudia, async () => {
  await ev(claudia, 'Marketing Plan Review').waitFor();
  await claudia.getByTestId('calendar-sidebar').getByLabel('Marketing', { exact: true }).uncheck();
  await ev(claudia, 'Marketing Plan Review').waitFor({ state: 'detached' });
  await claudia.getByTestId('calendar-sidebar').getByLabel('Marketing', { exact: true }).check();
  await ev(claudia, 'Marketing Plan Review').waitFor();
});

await step('other people\'s time shows as busy', hana, async () => {
  const ken = await session('ken@hanami.example');
  await ken.goto(`${BASE}/calendar`);
  await ken.getByTestId('calendar-people').locator('[data-name="Claudia Chen"]').click({ timeout: 60000 });
  await ken.locator('[data-testid="event"][data-busy="true"]').first().waitFor();
  if (await ev(ken, 'Mirai Systems Meeting').count()) throw new Error('details leaked');
  await ev(ken, 'Product Discussion').waitFor(); // Ken is invited to this one
  await ken.context().close();
});

await step('editing an event', claudia, async () => {
  await ev(claudia, createdTitle).click();
  await claudia.getByTestId('event-panel').getByRole('button', { name: 'Edit' }).click();
  const dialog = claudia.getByTestId('event-dialog');
  createdTitle = `${createdTitle} (final)`;
  await dialog.getByLabel('Title').fill(createdTitle);
  await dialog.getByLabel('Send invitation').uncheck();
  await claudia.getByTestId('event-save').click();
  await claudia.getByTestId('event-panel').getByTestId('event-title').getByText(createdTitle).waitFor();
});

await step('removing one occurrence of a weekly event', claudia, async () => {
  // test:calendar may already have removed this week's one.
  await claudia.waitForTimeout(500);
  if (!(await ev(claudia, 'Team Meeting').count())) await claudia.getByRole('button', { name: 'Next', exact: true }).click();
  await ev(claudia, 'Team Meeting').click();
  await claudia.getByTestId('event-panel').getByRole('button', { name: 'Delete' }).click();
  await claudia.getByRole('menuitem', { name: 'This event' }).click();
  await ev(claudia, 'Team Meeting').waitFor({ state: 'detached' });
  await claudia.getByRole('button', { name: 'Next', exact: true }).click();
  await ev(claudia, 'Team Meeting').waitFor();
});

await step('Home shows what is coming up today', claudia, async () => {
  await claudia.goto(`${BASE}/home`);
  await claudia.getByTestId('upcoming').locator('li').first().waitFor({ timeout: 60000 });
});

await browser.close();
if (errors.length) {
  console.log('page errors:\n' + errors.join('\n'));
  fails++;
}
console.log(fails ? `\n${fails} step(s) failed` : '\nall calendar e2e steps passed');
process.exit(fails ? 1 : 0);
