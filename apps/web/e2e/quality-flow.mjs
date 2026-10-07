// Quality end-to-end (§76, batch 4a): acceptance criteria and the Definition of Done as the gate to Done, logging
// time, editing the DoD in the project settings, and the Quality panel on the dashboard.
// node e2e/quality-flow.mjs   (needs the web app + API + seed)
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
    await page.screenshot({ path: join(tmpdir(), `mo-quality-fail-${name.replace(/\W+/g, '_')}.png`), timeout: 10000 }).catch(() => undefined);
  }
};

const fujita = await session('fujita@kaori.jp');
const req = fujita.context().request;
const spaces = await (await req.get(`${BASE}/api/spaces`)).json();
const key = `QF${Date.now() % 100000}`;
const proj = await (await req.post(`${BASE}/api/tasks/projects`, { data: { spaceId: spaces.find((x) => x.name === 'ITM Japan').id, name: `Quality flow ${key}`, key, methodology: 'kanban' } })).json();
await req.patch(`${BASE}/api/tasks/projects/${proj.id}`, { data: { strictWorkflow: false, enforceDod: true } });
await req.post(`${BASE}/api/tasks`, { data: { projectId: proj.id, title: 'Reset password', type: 'story', estimateMinutes: 240 } });
await req.post(`${BASE}/api/tasks`, { data: { projectId: proj.id, title: 'Reset link expires', type: 'bug', priority: 'high' } });
const drawer = () => fujita.getByTestId('task-drawer');

await step('acceptance criteria and the DoD hold the story back from Done', fujita, async () => {
  await fujita.goto(`${BASE}/tasks?project=${proj.id}&view=board`);
  await fujita.locator('[data-testid="task-card"][data-title="Reset password"]').click({ timeout: 90000 });
  await drawer().getByLabel('Add acceptance criterion').fill('Given a reset link, when it is older than 1 hour, then it is refused');
  await drawer().getByLabel('Add acceptance criterion').press('Enter');
  await drawer().getByTestId('criterion').waitFor();
  await drawer().getByLabel('Status').selectOption('done');
  await fujita.getByText(/Not done yet: 1 acceptance criteria and 6 Definition of Done items open/).waitFor();
  // The error toast sits over the bottom of the panel until it fades.
  await fujita.getByText(/Not done yet/).waitFor({ state: 'detached', timeout: 15000 });
  await drawer().getByTestId('criterion').getByRole('checkbox').check();
  for (const box of await drawer().getByTestId('dod').getByRole('checkbox').all()) await box.check();
  await drawer().getByTestId('dod').getByText('6/6').waitFor();
  await drawer().getByLabel('Status').selectOption('done');
  await drawer().getByTestId('task-activity').getByText('changed status to Done').waitFor();
});

await step('logging time against the estimate', fujita, async () => {
  await drawer().getByLabel('Log hours').fill('1.5');
  await drawer().getByLabel('Work note').fill('Token expiry check');
  await drawer().getByTestId('log-time').click();
  await drawer().getByTestId('worklog').getByText('Token expiry check').waitFor();
  await drawer().getByTestId('time').getByText('1.5 h logged of 4 h').waitFor();
  await fujita.getByRole('button', { name: 'Close', exact: true }).click();
});

await step('editing the Definition of Done in the settings', fujita, async () => {
  await fujita.getByTestId('project-settings').click();
  await fujita.getByTestId('settings-tab-quality').click();
  await fujita.getByLabel('New DoD item').fill('Security review done');
  await fujita.getByLabel('New DoD item').press('Enter');
  await fujita.getByTestId('quality-settings').getByText('Security review done').waitFor();
  await fujita.getByTestId('settings-save').click();
  await fujita.getByRole('dialog').waitFor({ state: 'detached' });
  await fujita.locator('[data-testid="task-card"][data-title="Reset link expires"]').click();
  await drawer().getByTestId('dod').getByText('0/7').waitFor();
  await fujita.getByRole('button', { name: 'Close', exact: true }).click();
});

await step('the Quality panel on the dashboard', fujita, async () => {
  await fujita.getByRole('tab', { name: 'dashboard' }).click();
  await fujita.getByTestId('quality-panel').waitFor({ timeout: 30000 });
  if ((await fujita.getByTestId('quality-tile').count()) !== 5) throw new Error('five tiles');
  await fujita.getByTestId('quality-tile').filter({ hasText: 'Open bugs' }).getByText('1', { exact: true }).waitFor();
  // Compliance is measured against today's DoD: the item added in the settings is not ticked on the done story.
  await fujita.getByTestId('quality-tile').filter({ hasText: 'DoD compliance' }).getByText('0%', { exact: true }).waitFor();
  await fujita.getByTestId('bug-trend').locator('svg > g').last().hover();
  await fujita.getByTestId('bug-tooltip').getByText(/Opened 1/).waitFor();
});

await browser.close();
if (errors.length) {
  console.log('page errors:\n' + errors.join('\n'));
  fails++;
}
console.log(fails ? `\n${fails} step(s) failed` : '\nall quality e2e steps passed');
process.exit(fails ? 1 : 0);
