// Workflows end-to-end (§76): a project on the software development workflow with strict transitions — the board
// refuses skipping steps while dragging, the issue panel offers the next steps (code review → QA → testing →
// fixing → retest…), a bug logged on a story blocks it, and switching the project to the bug tracking workflow.
// node e2e/workflows-flow.mjs   (needs the web app + API + seed)
import { chromium } from 'playwright';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = process.env.WEB_URL ?? 'http://localhost:3000';
const browser = await chromium.launch();
const errors = [];
let fails = 0;

async function session(email) {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 940 }, timezoneId: 'Asia/Tokyo' });
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
    await page.screenshot({ path: join(tmpdir(), `mo-workflows-fail-${name.replace(/\W+/g, '_')}.png`), timeout: 10000 }).catch(() => undefined);
  }
};

const fujita = await session('fujita@hanami.example');
const req = fujita.context().request;
const post = async (path, data) => (await req.post(`${BASE}/api${path}`, { data })).json();
const spaces = await (await req.get(`${BASE}/api/spaces`)).json();
const key = `WK${Date.now() % 100000}`;
// Kanban so the board shows every issue (no sprint needed).
const proj = await post('/tasks/projects', { spaceId: spaces.find((x) => x.name === 'Mirai Systems').id, name: `Checkout ${key}`, key, methodology: 'kanban' });
const story = await post('/tasks', { projectId: proj.id, title: 'Pay with QR code', type: 'story', storyPoints: 5 });
const card = (title) => fujita.locator(`[data-testid="task-card"][data-title="${title}"]`);
const column = (status) => fujita.locator(`[data-testid="board-column"][data-status="${status}"]`);
const drawer = () => fujita.getByTestId('task-drawer');

await step('the board has the professional statuses', fujita, async () => {
  await fujita.goto(`${BASE}/tasks?project=${proj.id}&view=board`);
  await card('Pay with QR code').waitFor({ timeout: 90000 });
  for (const name of ['Code Review', 'Ready for QA', 'In Testing', 'Fixing', 'Retest', 'UAT', 'Ready for Release', 'Cancelled']) await fujita.getByTestId('board').getByText(name, { exact: true }).waitFor();
});

await step('strict workflow: dragging To Do → Done is refused, To Do → In Progress works', fujita, async () => {
  await card('Pay with QR code').dragTo(column('done'));
  await fujita.waitForTimeout(800);
  if (!(await column('todo').locator('[data-title="Pay with QR code"]').count())) throw new Error('moved to done');
  await card('Pay with QR code').dragTo(column('doing'));
  await column('doing').locator('[data-title="Pay with QR code"]').waitFor();
});

await step('the issue panel walks the workflow: code review, QA, testing, fixing, retest', fujita, async () => {
  await card('Pay with QR code').click();
  await drawer().waitFor();
  const options = await drawer().getByLabel('Status').locator('option').allTextContents();
  if (options.includes('Done')) throw new Error('strict status list offers Done: ' + options.join());
  for (const [to, name] of [['review', 'Code Review'], ['ready_qa', 'Ready for QA'], ['testing', 'In Testing'], ['fixing', 'Fixing'], ['retest', 'Retest']]) {
    await drawer().locator(`[data-testid="transition"][data-to="${to}"]`).click();
    await drawer().getByTestId('task-activity').getByText(`changed status to ${name}`).waitFor();
  }
  await column('retest').locator('[data-title="Pay with QR code"]').waitFor();
});

await step('logging a bug found in testing blocks the story', fujita, async () => {
  await drawer().getByTestId('log-bug').click();
  await fujita.getByLabel('Bug title').fill('QR code expires too early');
  await fujita.getByLabel('Bug details').fill('Steps: open checkout, wait 30 s.\nExpected: still valid.\nActual: expired.');
  await fujita.getByTestId('confirm-bug').click();
  await drawer().locator('[data-testid="link-row"][data-direction="in"][data-kind="blocks"]').getByText('QR code expires too early').waitFor();
  await card('Pay with QR code').getByTestId('card-blocked').waitFor();
  await card('QR code expires too early').locator('[data-testid="issue-icon"][data-type="bug"]').waitFor();
  await fujita.getByRole('button', { name: 'Close', exact: true }).click();
});

await step('switching the project to the bug tracking workflow', fujita, async () => {
  await fujita.getByTestId('project-settings').click();
  await fujita.getByTestId('settings-tab-workflow').click();
  await fujita.getByTestId('workflow-bug').click();
  await fujita.getByTestId('workflow-settings').locator('[data-testid="status-row"][data-id="verified"]').waitFor();
  await fujita.getByTestId('settings-save').click();
  for (const name of ['New', 'Confirmed', 'Fixed', 'Verified', 'Closed', "Won't Fix"]) await fujita.getByTestId('board').getByText(name, { exact: true }).waitFor();
  // In-progress issues stay in progress, to-do ones stay to do.
  await column('retest').locator('[data-title="Pay with QR code"]').waitFor();
  await column('todo').locator('[data-title="QR code expires too early"]').waitFor();
});

await browser.close();
if (errors.length) {
  console.log('page errors:\n' + errors.join('\n'));
  fails++;
}
console.log(fails ? `\n${fails} step(s) failed` : '\nall workflow e2e steps passed');
process.exit(fails ? 1 : 0);
