// Planning end-to-end (§76): Not Started beside the epics and their sprints; dragging a task into an epic's sprint
// makes it Created there; a new epic and a sprint of it with its own start and end dates.
// node e2e/planning-flow.mjs   (needs the web app + API + fresh seed)
import { chromium } from 'playwright';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = process.env.WEB_URL ?? 'http://localhost:3000';
const browser = await chromium.launch();
const errors = [];
let fails = 0;
const ctx = await browser.newContext({ viewport: { width: 1600, height: 960 }, timezoneId: 'Asia/Tokyo' });
const users = await (await ctx.request.get(`${BASE}/api/users`)).json();
await ctx.addCookies([{ name: 'mo_uid', value: users.find((u) => u.email === 'sora@kaori.jp').id, url: BASE }]);
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(e.message));
const step = async (name, fn) => {
  try {
    await fn();
    console.log('✓', name);
  } catch (e) {
    fails++;
    console.log('✗', name, '—', e.message.split('\n')[0]);
    await page.screenshot({ path: join(tmpdir(), `mo-planning-fail-${name.replace(/\W+/g, '_')}.png`) }).catch(() => undefined);
  }
};
const req = ctx.request;
const sys = (await (await req.get(`${BASE}/api/tasks/projects`)).json()).find((p) => p.key === 'B625');
const section = (name) => page.locator(`[data-testid="backlog-section"][data-name="${name}"]`);
const row = (name, title) => section(name).locator(`[data-testid="backlog-row"][data-title="${title}"]`);
const epic = (title) => page.locator(`[data-testid="epic-block"][data-epic="${title}"]`);

await step('Not Started beside the epics and their sprints', async () => {
  await page.goto(`${BASE}/tasks?project=${sys.id}&view=backlog`);
  await row('Not Started', 'Customer reminders by LINE').waitFor({ timeout: 90000 });
  await epic('Online booking').getByTestId('backlog-section').nth(1).waitFor();
  if ((await epic('Online booking').getByTestId('backlog-section').count()) !== 2) throw new Error('booking sprints');
  await epic('Staff app').locator('[data-testid="backlog-section"][data-name="Staff app · Sprint 1"]').waitFor();
  await row('Online booking · Sprint 1', 'Cancel and reschedule flow').getByText('Recheck').waitFor();
});

await step('dragging a Not Started task into an epic’s sprint makes it Created', async () => {
  await row('Not Started', 'Customer reminders by LINE').dragTo(section('Staff app · Sprint 1'));
  await row('Staff app · Sprint 1', 'Customer reminders by LINE').getByText('Created').waitFor();
  const t = (await (await req.get(`${BASE}/api/tasks?project=${sys.id}`)).json()).find((x) => x.title === 'Customer reminders by LINE');
  const staff = (await (await req.get(`${BASE}/api/tasks?project=${sys.id}`)).json()).find((x) => x.title === 'Staff app');
  if (t.status !== 'created' || t.parentId !== staff.id) throw new Error(JSON.stringify({ status: t.status, parent: t.parentId }));
});

await step('a new epic, and a sprint of it with its own dates', async () => {
  await page.getByLabel('New epic').fill('Loyalty points');
  await page.getByTestId('add-epic').click();
  await epic('Loyalty points').waitFor();
  await epic('Loyalty points').getByTestId('epic-add-sprint').click();
  const dlg = page.getByRole('dialog');
  if ((await dlg.getByLabel('Sprint epic').locator('option:checked').textContent()) !== 'Loyalty points') throw new Error('epic not preset');
  await dlg.getByLabel('Start date').fill('2026-11-09');
  await dlg.getByLabel('End date').fill('2026-11-20');
  await dlg.getByTestId('save-sprint').click();
  await dlg.waitFor({ state: 'detached' });
  await epic('Loyalty points').locator('[data-testid="backlog-section"][data-name="Loyalty points · Sprint 1"]').getByText('Nov 9 – Nov 20').waitFor();
});

await step('the board shows the running sprints with the new statuses', async () => {
  await page.getByRole('tab', { name: 'board', exact: true }).click();
  for (const st of ['Not Started', 'Created', 'In Progress', 'In Review', 'Approved', 'On Hold', 'Recheck', 'Completed', 'Cancelled']) await page.getByTestId('board-column').filter({ hasText: st }).first().waitFor();
  await page.locator('[data-testid="task-card"][data-title="Booking calendar screen"]').waitFor();
  if (await page.locator('[data-testid="task-card"][data-title="Staff check-in with QR code"]').count()) throw new Error('Not Started tasks are not on the sprint board');
});

await browser.close();
if (errors.length) {
  console.log('page errors:\n' + errors.join('\n'));
  fails++;
}
console.log(fails ? `\n${fails} step(s) failed` : '\nall planning e2e steps passed');
process.exit(fails ? 1 : 0);
