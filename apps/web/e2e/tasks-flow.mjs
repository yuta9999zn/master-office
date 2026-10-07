// Tasks end-to-end (§72): project board, creating a task, dragging it to another column (and a live update for
// someone else), the drawer (subtasks, comments, activity), read-only viewers, list status change, Gantt with
// phases, due-date calendar, dashboard hover, search, My tasks, new project.
// node e2e/tasks-flow.mjs   (needs the web app + API + seed; runs after test:tasks in `pnpm test`)
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
    await page.screenshot({ path: join(tmpdir(), `mo-tasks-fail-${name.replace(/\W+/g, '_')}.png`) });
  }
};
const card = (page, title) => page.locator(`[data-testid="task-card"][data-title="${title}"]`);
const column = (page, status) => page.locator(`[data-testid="board-column"][data-status="${status}"]`);
const claudia = await session('claudia@kaori.jp');
const hana = await session('hana@kaori.jp');
const projects = await (await claudia.context().request.get(`${BASE}/api/tasks/projects`)).json();
const web = projects.find((p) => p.key === 'WEB');
const sys = projects.find((p) => p.key === 'B625');
const title = `Plan launch webinar ${Date.now() % 10000}`;

await step('the project picker opens a project board with its columns and cards', claudia, async () => {
  await claudia.goto(`${BASE}/tasks`);
  await claudia.getByTestId('project-picker').waitFor({ timeout: 60000 });
  await claudia.getByTestId('project-picker').click();
  await claudia.getByRole('menuitem', { name: /Website Revamp/ }).click();
  await claudia.waitForURL(/project=/);
  await card(claudia, 'Implement booking system').waitFor();
  if ((await claudia.getByTestId('board-column').count()) !== web.statuses.length) throw new Error('columns');
  await card(claudia, 'Implement booking system').getByText('3/5').waitFor();
});

await hana.goto(`${BASE}/tasks?project=${web.id}&view=board`);
await step('people who only view the space get a read-only board', hana, async () => {
  await card(hana, 'Implement booking system').waitFor({ timeout: 60000 });
  if (await hana.getByTestId('create-task').count()) throw new Error('create button shown');
  if ((await card(hana, 'Implement booking system').getAttribute('draggable')) !== 'false') throw new Error('draggable');
});

await step('creating a task opens it beside the board, first column', claudia, async () => {
  await claudia.getByTestId('create-task').click();
  const dialog = claudia.getByRole('dialog');
  await dialog.getByLabel('Task title').fill(title);
  await dialog.getByLabel('Priority').selectOption('high');
  await dialog.getByLabel('Due date').fill('2026-10-22');
  await dialog.getByTestId('task-save').click();
  await claudia.getByTestId('task-drawer').waitFor();
  if ((await claudia.getByTestId('task-drawer').getByLabel('Task title').inputValue()) !== title) throw new Error('drawer title');
  await column(claudia, web.statuses[0].id).locator(`[data-title="${title}"]`).waitFor();
});

await step('dragging the card to In Progress moves it, for others too', claudia, async () => {
  await card(hana, title).waitFor({ timeout: 10000 });
  await card(claudia, title).dragTo(column(claudia, 'doing').locator('[data-testid="task-card"]').first(), { targetPosition: { x: 40, y: 6 } });
  await column(claudia, 'doing').locator(`[data-title="${title}"]`).waitFor();
  await column(hana, 'doing').locator(`[data-title="${title}"]`).waitFor({ timeout: 10000 });
  const first = await column(claudia, 'doing').getByTestId('task-card').first().getAttribute('data-title');
  if (first !== title) throw new Error('dropped above the first card, got ' + first);
  await claudia.reload();
  await column(claudia, 'doing').getByTestId('task-card').first().and(card(claudia, title)).waitFor({ timeout: 30000 });
});

await step('the drawer: subtasks, a comment and the activity trail', claudia, async () => {
  const drawer = claudia.getByTestId('task-drawer');
  await drawer.waitFor();
  await drawer.getByLabel('Add subtask').fill('Book the speaker');
  await drawer.getByLabel('Add subtask').press('Enter');
  await drawer.getByTestId('subtasks').getByText('Book the speaker').waitFor();
  await drawer.getByLabel('Book the speaker').click();
  await drawer.getByLabel('Book the speaker').and(drawer.locator(':checked')).waitFor();
  await card(claudia, title).getByText('1/1').waitFor();
  await drawer.getByLabel('Assignee').selectOption({ label: 'Mika Tanaka' });
  await drawer.getByLabel('Comment').fill('Slides by Friday please.');
  await drawer.getByTestId('task-comment').click();
  await drawer.getByTestId('task-activity').getByText('Slides by Friday please.').waitFor();
  await drawer.getByTestId('task-activity').getByText(/changed status to In Progress/).waitFor();
  await claudia.getByRole('button', { name: 'Close', exact: true }).click();
  await claudia.waitForURL((u) => !u.searchParams.get('task'));
});

await step('the list view changes status in place', claudia, async () => {
  await claudia.getByRole('tab', { name: 'list' }).click();
  const row = claudia.locator(`[data-testid="task-row"][data-title="${title}"]`);
  await row.waitFor();
  await claudia.getByLabel(`Status of ${title}`).selectOption('done');
  await claudia.locator('section', { hasText: 'Done' }).locator(`[data-testid="task-row"][data-title="${title}"]`).waitFor();
});

await step('search filters the tasks', claudia, async () => {
  await claudia.getByLabel('Search tasks').fill('webinar');
  await claudia.waitForFunction(() => document.querySelectorAll('[data-testid="task-row"]').length === 1);
  await claudia.getByLabel('Search tasks').fill('');
});

await step('the Gantt shows phases with their steps, today, and folds a phase', claudia, async () => {
  await claudia.goto(`${BASE}/tasks?project=${sys.id}&view=gantt`);
  const row = (t) => claudia.locator(`[data-testid="gantt-row"][data-title="${t}"]`);
  await row('Design').waitFor({ timeout: 30000 });
  if ((await row('Design').getByTestId('gantt-progress').textContent()) !== '70%') throw new Error('phase progress');
  await claudia.getByTestId('gantt-today').waitFor();
  if (!(await claudia.getByTestId('gantt').evaluate((el) => el.scrollLeft > 0))) throw new Error('not scrolled to today');
  await claudia.getByRole('button', { name: 'Collapse Design' }).click();
  await row('UI/UX design').waitFor({ state: 'detached' });
  await claudia.getByRole('button', { name: 'Expand Design' }).click();
  await row('UI/UX design').getByRole('button', { name: 'UI/UX design', exact: true }).click();
  await claudia.getByTestId('task-drawer').waitFor();
});

await step('the calendar shows tasks on their due date', claudia, async () => {
  await claudia.goto(`${BASE}/tasks?project=${web.id}&view=calendar`);
  await claudia.locator(`[data-testid="due-task"][data-title="${title}"]`).waitFor({ timeout: 30000 });
});

await step('the dashboard: numbers, a chart with a hover readout, people', claudia, async () => {
  await claudia.getByRole('tab', { name: 'dashboard' }).click();
  await claudia.getByTestId('task-dashboard').waitFor({ timeout: 30000 });
  if ((await claudia.getByTestId('stat-tile').count()) !== 5) throw new Error('tiles');
  const box = await claudia.getByTestId('trend-chart').boundingBox();
  await claudia.mouse.move(box.x + box.width * 0.85, box.y + box.height / 2);
  await claudia.getByTestId('trend-tooltip').getByText(/Created \d+/).waitFor();
  await claudia.getByTestId('team-performance').getByText('Mika Tanaka').waitFor();
  await claudia.getByText('Show table').first().click();
  await claudia.getByRole('columnheader', { name: 'Completed' }).waitFor();
});

await step('plain /tasks opens the last project (each has its own workflow columns)', claudia, async () => {
  await claudia.goto(`${BASE}/tasks`);
  await claudia.waitForURL(/project=/);
  await claudia.getByTestId('board-column').nth(5).waitFor();
});

await step('My tasks: personal tasks, and a new one', claudia, async () => {
  await claudia.getByTestId('project-picker').click();
  await claudia.getByRole('menuitem', { name: 'My tasks' }).click();
  await claudia.waitForURL(/mine=1/);
  await claudia.getByTestId('my-tasks-note').waitFor();
  await card(claudia, 'Review Q4 budget').waitFor({ timeout: 30000 });
  if (await claudia.getByRole('tab', { name: 'gantt' }).count()) throw new Error('gantt on My tasks');
  await claudia.getByRole('button', { name: 'Add task to To Do' }).click();
  await claudia.getByRole('dialog').getByLabel('Task title').fill('Renew parking permit');
  await claudia.getByRole('dialog').getByLabel('Task title').press('Enter');
  await claudia.getByText('Personal task', { exact: true }).waitFor();
  await column(claudia, 'todo').locator('[data-title="Renew parking permit"]').waitFor();
});

await step('a new project in a space starts with an empty board', claudia, async () => {
  await claudia.getByTestId('project-picker').click();
  await claudia.getByRole('menuitem', { name: 'New project' }).click();
  const dialog = claudia.getByRole('dialog');
  await dialog.getByLabel('Project name').fill('Office move');
  await dialog.getByLabel('Project key').fill('MOVE');
  await dialog.getByTestId('project-save').click();
  await claudia.getByTestId('project-picker').getByText('Office move').waitFor();
  await claudia.waitForFunction(() => document.querySelectorAll('[data-testid="board-column"]').length === 11 /* software development workflow */ && !document.querySelector('[data-testid="task-card"]'));
});

await browser.close();
if (errors.length) {
  console.log('page errors:\n' + errors.join('\n'));
  fails++;
}
console.log(fails ? `\n${fails} step(s) failed` : '\nall tasks e2e steps passed');
process.exit(fails ? 1 : 0);
