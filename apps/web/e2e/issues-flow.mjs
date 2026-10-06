// Issues end-to-end (§76, Jira-style tasks, batch 1): epics on cards, the intake queue (a viewer files a request, the
// lead accepts one and declines one), a new epic broken down into stories, a dependency link, the hierarchy list,
// milestones on the Gantt, project settings (methodology), watching, and a task made from a chat message.
// node e2e/issues-flow.mjs   (needs the web app + API + a fresh seed)
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
    console.log('✗', name, '—', process.env.FULL ? e.message.slice(0, 1500) : e.message.split('\n')[0]);
    await page.screenshot({ path: join(tmpdir(), `mo-issues-fail-${name.replace(/\W+/g, '_')}.png`), timeout: 10000 }).catch(() => undefined);
  }
};
const card = (page, title) => page.locator(`[data-testid="task-card"][data-title="${title}"]`);
// Issues outside the active sprint wait in the backlog (Scrum project).
const inBacklog = (page, title) => page.locator('[data-testid="backlog-section"][data-name="Backlog"]').locator(`[data-testid="backlog-row"][data-title="${title}"]`);

const fujita = await session('fujita@kaori.jp');
const hana = await session('hana@kaori.jp');
const users = await (await fujita.context().request.get(`${BASE}/api/users`)).json();
const id = (k) => users.find((u) => u.email === `${k}@kaori.jp`).id;
const projects = await (await fujita.context().request.get(`${BASE}/api/tasks/projects`)).json();
const web = projects.find((p) => p.key === 'WEB');
const sys = projects.find((p) => p.key === 'B625');
const drawer = (page) => page.getByTestId('task-drawer');

await step('the board shows work items with their epic, type and points; requests wait in Intake', fujita, async () => {
  await fujita.goto(`${BASE}/tasks?project=${web.id}&view=board`);
  await card(fujita, 'Implement booking system').getByTestId('card-epic').getByText('Online booking').waitFor({ timeout: 90000 });
  await card(fujita, 'Implement booking system').getByTestId('story-points').getByText('13').waitFor();
  if (await card(fujita, 'Online booking').count()) throw new Error('epics are not cards');
  if (await card(fujita, 'Booking page is slow on mobile').count()) throw new Error('requests are not on the board');
  await fujita.getByTestId('intake-count').getByText('2').waitFor();
  await fujita.getByTestId('methodology').getByText('Scrum').waitFor();
});

await step('a viewer files a request; the lead accepts it onto the board', hana, async () => {
  await hana.goto(`${BASE}/tasks?project=${web.id}&view=board`);
  await hana.getByTestId('file-request').click({ timeout: 90000 });
  const dlg = hana.getByRole('dialog');
  await dlg.getByRole('radio', { name: /Report a bug/ }).click();
  await dlg.getByLabel('Request title').fill('Map pin shows the wrong branch');
  await dlg.getByLabel('Request details').fill('Branch 625 pin points to 575.');
  await dlg.getByTestId('request-save').click();
  await dlg.waitFor({ state: 'detached' });
  await fujita.getByRole('tab', { name: /intake/ }).click();
  const item = fujita.locator('[data-testid="request-item"][data-title="Map pin shows the wrong branch"]');
  await item.waitFor({ timeout: 15000 });
  await item.getByText('Hana Lee').waitFor();
  await item.getByTestId('accept-request').click();
  await item.waitFor({ state: 'detached' });
  await fujita.getByRole('tab', { name: 'backlog' }).click();
  await inBacklog(fujita, 'Map pin shows the wrong branch').locator('[data-testid="issue-icon"][data-type="bug"]').waitFor();
});

await step('declining a request with a reason', fujita, async () => {
  await fujita.getByRole('tab', { name: /intake/ }).click();
  const item = fujita.locator('[data-testid="request-item"][data-title="Log in and book with LINE"]');
  await item.getByTestId('decline-request').click();
  await fujita.getByLabel('Reason').fill('Planned for next year.');
  await fujita.getByTestId('confirm-decline').click();
  await item.waitFor({ state: 'detached' });
});

await step('a new epic, broken down into stories', fujita, async () => {
  await fujita.getByRole('tab', { name: 'board', exact: true }).click();
  await fujita.getByTestId('create-task').click();
  const dlg = fujita.getByRole('dialog');
  await dlg.getByTestId('type-epic').click();
  await dlg.getByLabel('Task title').fill('Customer reviews');
  await dlg.getByTestId('task-save').click();
  await drawer(fujita).waitFor();
  await drawer(fujita).getByText('Issues in this epic').waitFor();
  await drawer(fujita).getByTestId('break-down').click();
  await fujita.getByLabel('One per line').fill('Write review form\nModerate reviews');
  await fujita.getByTestId('confirm-breakdown').click();
  await drawer(fujita).getByTestId('subtasks').getByText('Moderate reviews').waitFor();
  if ((await drawer(fujita).getByTestId('subtasks').locator('[data-testid="issue-icon"][data-type="story"]').count()) !== 2) throw new Error('two stories');
  await fujita.getByRole('button', { name: 'Close', exact: true }).click();
  await fujita.getByRole('tab', { name: 'backlog' }).click();
  await inBacklog(fujita, 'Write review form').getByText('Customer reviews').waitFor();
});

await step('linking: one story blocks another', fujita, async () => {
  await inBacklog(fujita, 'Write review form').click();
  await drawer(fujita).getByLabel('Task title').and(fujita.locator('textarea')).waitFor();
  await drawer(fujita).getByTestId('ancestors').getByText('Customer reviews').waitFor();
  await drawer(fujita).getByTestId('add-link').click();
  await fujita.getByLabel('Link type').selectOption('blocks');
  await fujita.getByLabel('Search issues').fill('Moderate');
  await fujita.locator('[data-testid="link-candidate"][data-title="Moderate reviews"]').click();
  await drawer(fujita).locator('[data-testid="link-row"][data-kind="blocks"][data-direction="out"]').getByText('Moderate reviews').waitFor();
  await drawer(fujita).locator('[data-testid="link-row"]').getByText('Moderate reviews').click();
  await drawer(fujita).locator('[data-testid="link-row"][data-direction="in"]').getByText('is blocked by').waitFor();
});

await step('watching an issue', fujita, async () => {
  const w = fujita.getByTestId('watch');
  const before = await w.getAttribute('aria-pressed');
  await w.click();
  await fujita.waitForFunction((b) => document.querySelector('[data-testid="watch"]')?.getAttribute('aria-pressed') !== b, before);
  await fujita.getByRole('button', { name: 'Close', exact: true }).click();
});

await step('the list grouped by hierarchy: epics with their stories and subtasks', fujita, async () => {
  await fujita.getByRole('tab', { name: 'list' }).click();
  await fujita.getByTestId('group-hierarchy').click();
  const h = fujita.getByTestId('hierarchy');
  await h.locator('[data-testid="task-row"][data-type="epic"][data-title="Online booking"]').waitFor();
  await h.locator('[data-testid="task-row"][data-type="subtask"][data-title="Booking calendar"]').waitFor();
  await h.getByRole('button', { name: 'Collapse Online booking' }).click();
  await h.locator('[data-testid="task-row"][data-title="Booking calendar"]').waitFor({ state: 'detached' });
});

await step('waterfall: phases, tasks and a milestone on the Gantt', fujita, async () => {
  await fujita.goto(`${BASE}/tasks?project=${sys.id}&view=gantt`);
  await fujita.locator('[data-testid="gantt-row"][data-type="phase"][data-title="Planning"]').waitFor({ timeout: 90000 });
  await fujita.locator('[data-testid="gantt-row"][data-title="Go-live"]').getByTestId('gantt-milestone').waitFor();
  await fujita.getByTestId('methodology').getByText('Waterfall').waitFor();
});

await step('project settings: the lead switches the methodology', fujita, async () => {
  await fujita.goto(`${BASE}/tasks?project=${web.id}&view=board`);
  await fujita.getByTestId('project-settings').click({ timeout: 90000 });
  await fujita.getByTestId('methodology-hybrid').click();
  await fujita.getByTestId('settings-save').click();
  await fujita.getByTestId('methodology').getByText('Hybrid').waitFor();
  await fujita.getByTestId('project-settings').click();
  await fujita.getByTestId('methodology-scrum').click();
  await fujita.getByTestId('settings-save').click();
  await fujita.getByTestId('methodology').getByText('Scrum').waitFor();
});

await step('a task made from a chat message answers in its thread', fujita, async () => {
  const dm = await (await fujita.context().request.post(`${BASE}/api/chat/conversations`, { data: { kind: 'dm', userId: id('ken') } })).json();
  await fujita.context().request.post(`${BASE}/api/chat/conversations/${dm.id}/messages`, { headers: { 'x-user-id': id('ken') }, data: { body: 'Booking mail says 10:00 but the visit is 11:00' } });
  await fujita.goto(`${BASE}/chat/${dm.id}`);
  const msg = fujita.getByTestId('message').filter({ hasText: 'Booking mail says 10:00' }).last();
  await msg.waitFor({ timeout: 90000 });
  await msg.hover();
  await msg.getByRole('button', { name: 'More actions' }).click();
  await fujita.getByTestId('message-create-task').click();
  const dlg = fujita.getByRole('dialog');
  await dlg.getByLabel('Project').selectOption({ label: 'Website Revamp (WEB)' });
  await dlg.getByRole('radio', { name: /Bug/ }).click();
  await dlg.getByTestId('task-from-message-save').click();
  await fujita.getByText(/^Created WEB-\d+/).waitFor();
  await msg.getByTestId('thread-summary').waitFor({ timeout: 15000 });
});

await browser.close();
if (errors.length) {
  console.log('page errors:\n' + errors.join('\n'));
  fails++;
}
console.log(fails ? `\n${fails} step(s) failed` : '\nall issues e2e steps passed');
process.exit(fails ? 1 : 0);
