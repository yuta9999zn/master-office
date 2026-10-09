// List view end-to-end (§76): every workflow status as a group (like the board's columns), drag a row to another
// status, and sprints from the list — even in a waterfall project: + Sprint with its own start and end dates, drag
// issues from the backlog into it.   node e2e/list-sprint-flow.mjs   (needs the web app + API + seed)
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
    await page.screenshot({ path: join(tmpdir(), `mo-list-fail-${name.replace(/\W+/g, '_')}.png`) }).catch(() => undefined);
  }
};
const req = ctx.request;
const spaces = await (await req.get(`${BASE}/api/spaces`)).json();
const key = `LS${Date.now() % 100000}`;
const proj = await (await req.post(`${BASE}/api/tasks/projects`, { data: { spaceId: spaces.find((x) => x.name === 'Mirai Systems').id, name: `List ${key}`, key, methodology: 'waterfall' } })).json();
await req.patch(`${BASE}/api/tasks/projects/${proj.id}`, { data: { strictWorkflow: false } });
const mk = async (title) => (await req.post(`${BASE}/api/tasks`, { data: { projectId: proj.id, title, type: 'task' } })).json();
const a = await mk('Install POS terminals');
await mk('Train branch staff');
await mk('Print price labels');
const group = (k) => page.locator(`[data-testid="status-group"][data-group="${k}"], [data-testid="sprint-group"][data-group="${k}"]`);
const row = (t) => page.locator(`[data-testid="task-row"][data-title="${t}"]`);

await step('the list shows every status of the workflow, like the board', async () => {
  await page.goto(`${BASE}/tasks?project=${proj.id}&view=list`);
  await page.getByTestId('status-group').first().waitFor({ timeout: 90000 });
  const n = await page.getByTestId('status-group').count();
  if (n !== proj.statuses.length) throw new Error(`${n} groups for ${proj.statuses.length} statuses`);
  await group('doing').getByText('No issues').waitFor();
});

await step('dragging a row to another status group', async () => {
  await row('Install POS terminals').dragTo(group('doing'));
  await group('doing').locator('[data-testid="task-row"][data-title="Install POS terminals"]').waitFor();
  await page.waitForTimeout(500);
  if ((await (await req.get(`${BASE}/api/tasks/${a.id}`)).json()).status !== 'doing') throw new Error('not saved');
});

await step('+ Sprint with custom start and end dates', async () => {
  await page.getByTestId('list-new-sprint').click();
  const dlg = page.getByRole('dialog');
  await dlg.getByLabel('Start date').fill('2026-11-02');
  await dlg.getByLabel('End date').fill('2026-11-11');
  await dlg.getByText(/^10 days · ends/).waitFor();
  await dlg.getByTestId('save-sprint').click();
  await dlg.waitFor({ state: 'detached' });
  await page.getByTestId('sprint-range').getByText('Nov 2 – Nov 11').waitFor();
  const sp = (await (await req.get(`${BASE}/api/tasks/projects/${proj.id}/sprints`)).json())[0];
  if (sp.startDate !== '2026-11-02' || sp.endDate !== '2026-11-11') throw new Error(`${sp.startDate} – ${sp.endDate}`);
});

await step('dragging not-started issues from the backlog into the sprint', async () => {
  const sp = (await (await req.get(`${BASE}/api/tasks/projects/${proj.id}/sprints`)).json())[0];
  await group('backlog').locator('[data-testid="task-row"][data-title="Train branch staff"]').waitFor();
  await row('Train branch staff').dragTo(group(sp.id));
  await group(sp.id).locator('[data-testid="task-row"][data-title="Train branch staff"]').waitFor();
  await row('Print price labels').dragTo(group(sp.id));
  await group(sp.id).locator('[data-testid="task-row"][data-title="Print price labels"]').waitFor();
  await page.waitForTimeout(500);
  const t = (await (await req.get(`${BASE}/api/tasks?project=${proj.id}`)).json()).filter((x) => x.sprintId === sp.id);
  if (t.length !== 2) throw new Error(`${t.length} in the sprint`);
});

await step('the waterfall project now has backlog and sprint tabs', async () => {
  await page.getByRole('tab', { name: 'backlog' }).waitFor();
  await page.getByRole('tab', { name: 'sprints' }).waitFor();
});

await browser.close();
if (errors.length) {
  console.log('page errors:\n' + errors.join('\n'));
  fails++;
}
console.log(fails ? `\n${fails} step(s) failed` : '\nall list e2e steps passed');
process.exit(fails ? 1 : 0);
