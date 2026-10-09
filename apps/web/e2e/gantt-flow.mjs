// Gantt and phase gates end-to-end (§76, batch 4b): finish-to-start arrows (red when the plan breaks them), dragging a
// bar to reschedule, dragging its right edge to change the due date, and a phase gate requested and approved.
// node e2e/gantt-flow.mjs   (needs the web app + API + seed)
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
    await page.screenshot({ path: join(tmpdir(), `mo-gantt-fail-${name.replace(/\W+/g, '_')}.png`), timeout: 10000 }).catch(() => undefined);
  }
};
const day = (n) => {
  const d = new Date(Date.now() + 9 * 3600_000 + n * 86_400_000);
  return d.toISOString().slice(0, 10);
};

const fujita = await session('fujita@hanami.example');
const req = fujita.context().request;
const spaces = await (await req.get(`${BASE}/api/spaces`)).json();
const key = `GF${Date.now() % 100000}`;
const proj = await (await req.post(`${BASE}/api/tasks/projects`, { data: { spaceId: spaces.find((x) => x.name === 'Mirai Systems').id, name: `Gantt flow ${key}`, key, methodology: 'waterfall' } })).json();
await req.patch(`${BASE}/api/tasks/projects/${proj.id}`, { data: { strictWorkflow: false } });
const phase = await (await req.post(`${BASE}/api/tasks`, { data: { projectId: proj.id, title: 'Build', type: 'phase', startDate: day(1), dueDate: day(12), criteria: [{ text: 'Code complete', done: true }] } })).json();
const a = await (await req.post(`${BASE}/api/tasks`, { data: { projectId: proj.id, parentId: phase.id, title: 'Database schema', startDate: day(2), dueDate: day(6) } })).json();
const b = await (await req.post(`${BASE}/api/tasks`, { data: { projectId: proj.id, parentId: phase.id, title: 'Booking API', startDate: day(4), dueDate: day(8) } })).json();
await req.post(`${BASE}/api/tasks/${a.id}/links`, { data: { toId: b.id, kind: 'blocks' } });
const bar = (title) => fujita.locator(`[data-testid="gantt-bar"][data-title="${title}"]`);
const read = async (id) => (await req.get(`${BASE}/api/tasks/${id}`)).json();

await step('a broken finish-to-start dependency shows in red', fujita, async () => {
  await fujita.goto(`${BASE}/tasks?project=${proj.id}&view=gantt`);
  await fujita.getByTestId('gantt-link').waitFor({ timeout: 90000 });
  if ((await fujita.getByTestId('gantt-link').getAttribute('data-late')) !== '1') throw new Error('not red');
  await fujita.getByTestId('gantt-conflicts').getByText('1 dependency conflict').waitFor();
});

await step('dragging a bar reschedules it and clears the conflict', fujita, async () => {
  const box = await bar('Booking API').boundingBox();
  await fujita.mouse.move(box.x + 12, box.y + box.height / 2);
  await fujita.mouse.down();
  for (let i = 1; i <= 6; i++) await fujita.mouse.move(box.x + 12 + i * 13, box.y + box.height / 2);
  await fujita.mouse.up();
  await fujita.waitForFunction(() => document.querySelector('[data-testid="gantt-link"]')?.getAttribute('data-late') === '0');
  if (await fujita.getByTestId('gantt-conflicts').count()) throw new Error('conflict still shown');
  if (await fujita.getByTestId('task-drawer').count()) throw new Error('a drag should not open the issue');
  await fujita.waitForTimeout(800);
  const t = await read(b.id);
  if (t.startDate !== day(7) || t.dueDate !== day(11)) throw new Error(`dates ${t.startDate} – ${t.dueDate}`);
});

await step('dragging the right edge changes the due date only', fujita, async () => {
  await bar('Booking API').hover();
  const box = await bar('Booking API').getByTestId('gantt-resize').boundingBox();
  await fujita.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await fujita.mouse.down();
  for (let i = 1; i <= 4; i++) await fujita.mouse.move(box.x + box.width / 2 + i * 13, box.y + box.height / 2);
  await fujita.mouse.up();
  await fujita.waitForTimeout(800);
  const t = await read(b.id);
  if (t.startDate !== day(7) || t.dueDate !== day(13)) throw new Error(`dates ${t.startDate} – ${t.dueDate}`);
});

await step('a click still opens the issue', fujita, async () => {
  await bar('Database schema').click();
  await fujita.getByTestId('task-drawer').getByText('Database schema').first().waitFor();
  await fujita.getByRole('button', { name: 'Close', exact: true }).click();
});

await step('the phase gate: request, approve, then close the phase', fujita, async () => {
  await bar('Build').click();
  const drawer = fujita.getByTestId('task-drawer');
  await drawer.getByTestId('gate-status').getByText('Not requested').waitFor();
  await drawer.getByLabel('Status').selectOption('done');
  await fujita.getByText('Get the phase gate approved before closing the phase').waitFor();
  await drawer.getByLabel('Gate note').fill('Build is complete');
  await drawer.getByTestId('gate-request').click();
  await drawer.getByTestId('gate-status').getByText('Waiting for approval').waitFor();
  await drawer.getByTestId('gate-approver').getByText('pending').waitFor();
  await drawer.getByTestId('gate-approve').click();
  await drawer.getByTestId('gate-status').getByText('Approved').waitFor();
  await drawer.getByTestId('task-activity').getByText(/approved the phase gate — the gate is approved/).waitFor();
  await fujita.getByText('Get the phase gate approved').waitFor({ state: 'detached', timeout: 15000 });
  await drawer.getByLabel('Status').selectOption('done');
  await drawer.getByTestId('task-activity').getByText('changed status to Completed').waitFor();
  await fujita.getByRole('button', { name: 'Close', exact: true }).click();
  await fujita.getByTestId('gantt-gate').getByText('gate approved').waitFor();
});

await browser.close();
if (errors.length) {
  console.log('page errors:\n' + errors.join('\n'));
  fails++;
}
console.log(fails ? `\n${fails} step(s) failed` : '\nall gantt e2e steps passed');
process.exit(fails ? 1 : 0);
