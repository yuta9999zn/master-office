// Board scope end-to-end (§76): pick the sprint shown on the board, filter by epic, swimlanes by epic / assignee /
// sprint, and dragging a card into another lane moves it to that epic.
// node e2e/board-lanes-flow.mjs   (needs the web app + API + seed)
import { chromium } from 'playwright';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = process.env.WEB_URL ?? 'http://localhost:3000';
const browser = await chromium.launch();
const errors = [];
let fails = 0;
const ctx = await browser.newContext({ viewport: { width: 1500, height: 940 }, timezoneId: 'Asia/Tokyo' });
const users = await (await ctx.request.get(`${BASE}/api/users`)).json();
await ctx.addCookies([{ name: 'mo_uid', value: users.find((u) => u.email === 'fujita@hanami.example').id, url: BASE }]);
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(e.message));
const step = async (name, fn) => {
  try {
    await fn();
    console.log('✓', name);
  } catch (e) {
    fails++;
    console.log('✗', name, '—', e.message.split('\n')[0]);
    await page.screenshot({ path: join(tmpdir(), `mo-lanes-fail-${name.replace(/\W+/g, '_')}.png`) }).catch(() => undefined);
  }
};

const req = ctx.request;
const spaces = await (await req.get(`${BASE}/api/spaces`)).json();
const key = `BL${Date.now() % 100000}`;
const proj = await (await req.post(`${BASE}/api/tasks/projects`, { data: { spaceId: spaces.find((x) => x.name === 'Mirai Systems').id, name: `Lanes ${key}`, key, methodology: 'scrum' } })).json();
await req.patch(`${BASE}/api/tasks/projects/${proj.id}`, { data: { strictWorkflow: false } });
const mk = async (data) => (await req.post(`${BASE}/api/tasks`, { data: { projectId: proj.id, ...data } })).json();
const checkout = await mk({ title: 'Checkout', type: 'epic' });
const search = await mk({ title: 'Search', type: 'epic' });
const sprint = await (await req.post(`${BASE}/api/tasks/projects/${proj.id}/sprints`, { data: {} })).json();
const pay = await mk({ title: 'Pay by card', type: 'story', parentId: checkout.id, sprintId: sprint.id, assigneeId: users.find((u) => u.email === 'mika@hanami.example').id });
await mk({ title: 'Coupon codes', type: 'story', parentId: checkout.id, sprintId: sprint.id });
await mk({ title: 'Search by brand', type: 'story', parentId: search.id });
await mk({ title: 'Fix footer', type: 'bug' });
await req.post(`${BASE}/api/tasks/sprints/${sprint.id}/start`, { data: {} });
const cards = () => page.getByTestId('task-card');

await step('the board shows the active sprint; the sprint picker widens it', async () => {
  await page.goto(`${BASE}/tasks?project=${proj.id}&view=board`);
  await page.getByTestId('board-controls').waitFor({ timeout: 90000 });
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="task-card"]').length === 2);
  await page.getByLabel('Board sprint').selectOption('backlog');
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="task-card"]').length === 2);
  await page.locator('[data-testid="task-card"][data-title="Fix footer"]').waitFor();
  await page.getByLabel('Board sprint').selectOption('all');
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="task-card"]').length === 4);
});

await step('filtering by epic', async () => {
  await page.getByLabel('Board epic').selectOption({ label: 'Checkout' });
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="task-card"]').length === 2);
  await page.getByLabel('Board epic').selectOption('none');
  await page.locator('[data-testid="task-card"][data-title="Fix footer"]').waitFor();
  if ((await cards().count()) !== 1) throw new Error('none');
  await page.getByLabel('Board epic').selectOption('');
});

await step('swimlanes by epic; dragging into another lane moves the story to that epic', async () => {
  await page.getByLabel('Swimlanes').selectOption('epic');
  await page.locator('[data-testid="swimlane"][data-label="Checkout"]').locator('[data-testid="task-card"]').nth(1).waitFor();
  if ((await page.getByTestId('swimlane').count()) !== 3) throw new Error('lanes');
  await page
    .locator('[data-testid="task-card"][data-title="Pay by card"]')
    .dragTo(page.locator('[data-testid="swimlane"][data-label="Search"] [data-testid="board-cell"]').first());
  await page.locator('[data-testid="swimlane"][data-label="Search"]').locator('[data-testid="task-card"][data-title="Pay by card"]').waitFor();
  await page.waitForTimeout(600);
  const t = await (await req.get(`${BASE}/api/tasks/${pay.id}`)).json();
  if (t.parentId !== search.id) throw new Error(`parent ${t.parentId}`);
});

await step('swimlanes by assignee and by sprint', async () => {
  await page.getByLabel('Swimlanes').selectOption('assignee');
  await page.locator('[data-testid="swimlane"][data-label="Mika Tanaka"], [data-testid="swimlane"][data-lane^="assignee:"]').first().waitFor();
  await page.locator('[data-testid="swimlane"][data-label="Unassigned"]').waitFor();
  await page.getByLabel('Swimlanes').selectOption('sprint');
  await page.locator(`[data-testid="swimlane"][data-lane="sprint:${sprint.id}"]`).getByTestId('task-card').nth(1).waitFor();
  await page.locator('[data-testid="swimlane"][data-label="Backlog"]').getByTestId('task-card').nth(1).waitFor();
});

await browser.close();
if (errors.length) {
  console.log('page errors:\n' + errors.join('\n'));
  fails++;
}
console.log(fails ? `\n${fails} step(s) failed` : '\nall board lanes e2e steps passed');
process.exit(fails ? 1 : 0);
