// Board statuses end-to-end (§76): statuses are the project's own — add one from the board, rename, recolour,
// move it, delete it (its issues move to a status of the same kind), and open the full workflow editor.
// node e2e/status-edit-flow.mjs   (needs the web app + API + seed)
import { chromium } from 'playwright';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = process.env.WEB_URL ?? 'http://localhost:3000';
const browser = await chromium.launch();
const errors = [];
let fails = 0;
const ctx = await browser.newContext({ viewport: { width: 1700, height: 940 } });
const users = await (await ctx.request.get(`${BASE}/api/users`)).json();
await ctx.addCookies([{ name: 'mo_uid', value: users.find((u) => u.email === 'fujita@hanami.example').id, url: BASE }]);
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(e.message));
let answer = '';
page.on('dialog', (d) => void (d.type() === 'prompt' ? d.accept(answer) : d.accept()));
const step = async (name, fn) => {
  try {
    await fn();
    console.log('✓', name);
  } catch (e) {
    fails++;
    console.log('✗', name, '—', e.message.split('\n')[0]);
    await page.screenshot({ path: join(tmpdir(), `mo-status-fail-${name.replace(/\W+/g, '_')}.png`) }).catch(() => undefined);
  }
};
const req = ctx.request;
const spaces = await (await req.get(`${BASE}/api/spaces`)).json();
const key = `SE${Date.now() % 100000}`;
const proj = await (await req.post(`${BASE}/api/tasks/projects`, { data: { spaceId: spaces.find((x) => x.name === 'Mirai Systems').id, name: `Statuses ${key}`, key, methodology: 'kanban', workflow: 'basic' } })).json();
const t = await (await req.post(`${BASE}/api/tasks`, { data: { projectId: proj.id, title: 'Check the signage' } })).json();
const col = (name) => page.locator('[data-testid="board-column"]').filter({ has: page.getByText(name, { exact: true }) });
const statuses = async () => (await (await req.get(`${BASE}/api/tasks/projects`)).json()).find((p) => p.id === proj.id).statuses;

await step('adding a status from the board', async () => {
  await page.goto(`${BASE}/tasks?project=${proj.id}&view=board`);
  await page.getByTestId('add-status').waitFor({ timeout: 90000 });
  const before = await page.getByTestId('board-column').count();
  await page.getByLabel('New status').fill('Waiting for vendor');
  await page.getByLabel('New status').press('Enter');
  await col('Waiting for vendor').waitFor();
  if ((await page.getByTestId('board-column').count()) !== before + 1) throw new Error('column count');
  const list = await statuses();
  const i = list.findIndex((s) => s.name === 'Waiting for vendor');
  if (list[i + 1]?.category !== 'done') throw new Error('should sit before the done statuses');
});

await step('renaming and moving it', async () => {
  answer = 'Waiting for supplier';
  await col('Waiting for vendor').getByTestId('column-menu').click();
  await page.getByRole('menuitem', { name: 'Rename' }).click();
  await col('Waiting for supplier').waitFor();
  await col('Waiting for supplier').getByTestId('column-menu').click();
  await page.getByRole('menuitem', { name: 'Move left' }).click();
  await page.waitForTimeout(600);
  const list = await statuses();
  const i = list.findIndex((s) => s.name === 'Waiting for supplier');
  if (list[i + 2]?.category !== 'done') throw new Error(JSON.stringify(list.map((s) => s.name)));
});

await step('deleting a status moves its issues', async () => {
  const list = await statuses();
  const id = list.find((s) => s.name === 'Waiting for supplier').id;
  await req.patch(`${BASE}/api/tasks/${t.id}`, { data: { status: id } });
  await page.reload();
  await col('Waiting for supplier').locator('[data-testid="task-card"][data-title="Check the signage"]').waitFor({ timeout: 60000 });
  await col('Waiting for supplier').getByTestId('column-menu').click();
  await page.getByTestId('delete-status').click();
  await col('Waiting for supplier').waitFor({ state: 'detached' });
  await page.locator('[data-testid="task-card"][data-title="Check the signage"]').waitFor();
  const after = await (await req.get(`${BASE}/api/tasks/${t.id}`)).json();
  if (after.status === id) throw new Error('issue still in the deleted status');
});

await step('the column menu opens the workflow editor', async () => {
  await page.getByTestId('board-column').first().getByTestId('column-menu').click();
  await page.getByRole('menuitem', { name: /Edit workflow/ }).click();
  await page.getByTestId('workflow-settings').waitFor();
  await page.getByTestId('workflow-settings').getByText('Add status').waitFor();
});

await browser.close();
if (errors.length) {
  console.log('page errors:\n' + errors.join('\n'));
  fails++;
}
console.log(fails ? `\n${fails} step(s) failed` : '\nall status e2e steps passed');
process.exit(fails ? 1 : 0);
