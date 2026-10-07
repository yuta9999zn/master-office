// Sprints end-to-end (§76, batch 2): the backlog with drag and drop into a sprint and reordering, a new 1-week
// sprint, completing the active sprint (unfinished work carried over), starting the next with the Scrum ceremonies
// in Calendar, the board on the active sprint, the Sprints view (velocity, burndown, ceremonies with Join), the
// retrospective board (card, vote, action item → task), and a work-in-progress limit on the board.
// node e2e/sprints-flow.mjs   (needs the web app + API + a fresh seed)
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
    await page.screenshot({ path: join(tmpdir(), `mo-sprints-fail-${name.replace(/\W+/g, '_')}.png`), timeout: 10000 }).catch(() => undefined);
  }
};

const fujita = await session('fujita@kaori.jp');
// Its own Scrum project (the API tests change the seeded one): a closed sprint with a retro card, an active
// sprint, a planned one and a backlog item.
const req = fujita.context().request;
const post = async (path, data) => (await req.post(`${BASE}/api${path}`, { data })).json();
const spaces = await (await req.get(`${BASE}/api/spaces`)).json();
const key = `SD${Date.now() % 100000}`;
const web = await post('/tasks/projects', { spaceId: spaces.find((x) => x.name === 'ITM Japan').id, name: `Sprint demo ${key}`, key, methodology: 'scrum' });
const P = (k) => `${key} Sprint ${k}`;
const issue = (title, extra = {}) => post('/tasks', { projectId: web.id, title, type: 'story', storyPoints: 3, ...extra });
const today = new Date().toISOString().slice(0, 10);
const back = (n) => new Date(Date.now() - n * 86400_000).toISOString().slice(0, 10);
const sp1 = await post(`/tasks/projects/${web.id}/sprints`, { startDate: back(20), days: 14, goal: 'Foundations' });
await issue('Initial wireframe', { sprintId: sp1.id, status: 'done' });
await post(`/tasks/sprints/${sp1.id}/start`, { startDate: back(20), days: 14 });
await post(`/tasks/sprints/${sp1.id}/retro`, { kind: 'action', body: 'Freeze the sprint scope after planning' });
await post(`/tasks/sprints/${sp1.id}/complete`, {});
const sp2 = await post(`/tasks/projects/${web.id}/sprints`, { startDate: back(6), days: 14, goal: 'Customers can book a visit online' });
await issue('Implement booking system', { sprintId: sp2.id, status: 'doing', storyPoints: 13 });
await issue('Design logo variations', { sprintId: sp2.id, status: 'review' });
await post(`/tasks/sprints/${sp2.id}/start`, { startDate: back(6), days: 14 });
const sp3 = await post(`/tasks/projects/${web.id}/sprints`, { goal: 'Sign-in and payments' });
await issue('Build user authentication', { sprintId: sp3.id, storyPoints: 8 });
await issue('Prepare marketing assets');
void today;
const section = (name) => fujita.locator(`[data-testid="backlog-section"][data-name="${name}"]`);
const row = (name, title) => section(name).locator(`[data-testid="backlog-row"][data-title="${title}"]`);

await step('the backlog: active sprint, planned sprint, backlog', fujita, async () => {
  await fujita.goto(`${BASE}/tasks?project=${web.id}&view=backlog`);
  await row(P(2), 'Implement booking system').waitFor({ timeout: 90000 });
  await row(P(3), 'Build user authentication').waitFor();
  await row('Not Started', 'Prepare marketing assets').waitFor();
  await section(P(2)).getByText(/Active · \d+ days left/).waitFor();
});

await step('drag an issue from the backlog into a sprint, above another one', fujita, async () => {
  await row('Not Started', 'Prepare marketing assets').dragTo(row(P(3), 'Build user authentication'), { targetPosition: { x: 200, y: 4 } });
  await row(P(3), 'Prepare marketing assets').waitFor();
  await fujita.waitForFunction((name) => {
    const titles = [...document.querySelectorAll(`[data-testid="backlog-section"][data-name="${name}"] [data-testid="backlog-row"]`)].map((r) => r.getAttribute('data-title'));
    return titles[0] === 'Prepare marketing assets' && titles[1] === 'Build user authentication';
  }, P(3));
  await fujita.reload();
  await row(P(3), 'Prepare marketing assets').waitFor({ timeout: 60000 });
  const first = await section(P(3)).getByTestId('backlog-row').first().getAttribute('data-title');
  if (first !== 'Prepare marketing assets') throw new Error('order not kept: ' + first);
});

await step('creating a 1-week sprint', fujita, async () => {
  await fujita.getByTestId('create-sprint').click();
  const dlg = fujita.getByRole('dialog');
  await dlg.getByLabel('Sprint goal').fill('Reviews and ratings');
  await dlg.getByLabel('Duration').selectOption('7');
  await dlg.getByTestId('save-sprint').click();
  await fujita.locator('[data-testid="backlog-section"]').filter({ hasText: 'Reviews and ratings' }).waitFor();
});

await step('completing the active sprint carries unfinished work to the next one', fujita, async () => {
  await section(P(2)).getByTestId('complete-sprint').click();
  const dlg = fujita.getByRole('dialog');
  await dlg.getByText(/not finished/).waitFor();
  await dlg.getByLabel('Move unfinished to').selectOption({ label: P(3) });
  await dlg.getByTestId('confirm-complete').click();
  await section(P(2)).waitFor({ state: 'detached' });
  await row(P(3), 'Implement booking system').waitFor();
});

await step('starting a sprint puts Planning, Daily, Review and Retro in Calendar', fujita, async () => {
  await section(P(3)).getByTestId('start-sprint').click();
  const dlg = fujita.getByRole('dialog');
  await dlg.getByTestId('ceremony-plan').getByText('Daily Scrum').waitFor();
  await dlg.getByLabel('Daily time').fill('09:15');
  await dlg.getByTestId('confirm-start').click();
  await fujita.getByText(/ceremonies are in Calendar/).waitFor({ timeout: 30000 });
  await section(P(3)).getByText(/Active/).waitFor();
  const sprints = await (await fujita.context().request.get(`${BASE}/api/tasks/projects/${web.id}/sprints`)).json();
  const s3 = sprints.find((x) => x.name === P(3));
  if (!['planning', 'daily', 'review', 'retro'].every((k) => s3.ceremonies[k])) throw new Error(JSON.stringify(s3.ceremonies));
  const daily = await (await fujita.context().request.get(`${BASE}/api/calendar/events/${s3.ceremonies.daily}`)).json();
  if (daily.recurrence?.byDay?.join() !== '1,2,3,4,5') throw new Error('daily recurrence');
});

await step('the board shows the active sprint', fujita, async () => {
  await fujita.getByRole('tab', { name: 'board', exact: true }).click();
  await fujita.getByTestId('sprint-bar').getByText(P(3)).waitFor();
  await fujita.locator('[data-testid="task-card"][data-title="Prepare marketing assets"]').waitFor();
  await fujita.locator('[data-testid="task-card"][data-title="Design logo variations"]').waitFor(); // carried over
  if (await fujita.locator('[data-testid="task-card"][data-title="Initial wireframe"]').count()) throw new Error('issue of a closed sprint on the board');
});

await step('Sprints: velocity, burndown and the ceremonies with Join', fujita, async () => {
  await fujita.getByRole('tab', { name: 'sprints' }).click();
  await fujita.getByTestId('sprint-title').getByText(P(3)).waitFor({ timeout: 30000 });
  await fujita.getByTestId('burndown-chart').waitFor();
  await fujita.getByTestId('velocity').getByText(/Average completed/).waitFor();
  await fujita.waitForFunction(() => document.querySelectorAll('[data-testid="ceremony"]').length === 4);
  await fujita.getByTestId('ceremony').filter({ hasText: 'Daily Scrum' }).getByText(/every weekday/).waitFor();
  await fujita.getByTestId('ceremony').filter({ hasText: 'Sprint Planning' }).getByRole('link', { name: 'Join' }).waitFor();
  const box = await fujita.getByTestId('burndown-chart').boundingBox();
  await fujita.mouse.move(box.x + box.width * 0.1, box.y + box.height / 2);
  await fujita.getByTestId('burndown-tooltip').getByText(/Ideal/).waitFor();
});

await step('the retrospective: past cards, a new action item turned into a task', fujita, async () => {
  await fujita.locator(`[data-testid="sprint-item"][data-name="${P(1)}"]`).click();
  await fujita.getByTestId('sprint-title').getByText(P(1)).waitFor();
  await fujita.getByRole('tab', { name: 'Retrospective' }).click();
  await fujita.getByTestId('retro-board').getByText('Freeze the sprint scope after planning').waitFor();
  await fujita.locator(`[data-testid="sprint-item"][data-name="${P(3)}"]`).click();
  await fujita.getByTestId('sprint-title').getByText(P(3)).waitFor();
  const actions = fujita.locator('[data-testid="retro-column"][data-kind="action"]');
  await actions.getByLabel('Add to Action items').fill('Pair on the payment webhooks');
  await actions.getByLabel('Add to Action items').press('Enter');
  const c = actions.getByTestId('retro-card').filter({ hasText: 'Pair on the payment webhooks' });
  await c.waitFor();
  await c.getByTestId('retro-vote').click();
  await c.getByTestId('retro-vote').getByText('1').waitFor();
  await c.getByTestId('retro-make-task').click();
  await c.getByTestId('retro-task').getByText(new RegExp(`${key}-\\d+`)).waitFor();
});

await step('a work-in-progress limit marks an overfull column', fujita, async () => {
  await fujita.getByTestId('project-settings').click();
  await fujita.getByTestId('settings-tab-board').click();
  await fujita.getByLabel('WIP limit To Do').fill('1');
  await fujita.getByTestId('settings-save').click();
  await fujita.getByRole('dialog').waitFor({ state: 'detached' });
  await fujita.getByRole('tab', { name: 'board', exact: true }).click();
  await fujita.locator('[data-testid="board-column"][data-status="todo"] [data-testid="wip"][data-over="1"]').waitFor();
  await fujita.getByTestId('project-settings').click();
  await fujita.getByTestId('settings-tab-board').click();
  await fujita.getByLabel('WIP limit To Do').fill('');
  await fujita.getByTestId('settings-save').click();
});

await browser.close();
if (errors.length) {
  console.log('page errors:\n' + errors.join('\n'));
  fails++;
}
console.log(fails ? `\n${fails} step(s) failed` : '\nall sprint e2e steps passed');
process.exit(fails ? 1 : 0);
