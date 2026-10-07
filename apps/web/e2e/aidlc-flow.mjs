// AI-DLC end-to-end (§76, batch 4c): creating an AI-DLC project gives the three phases on the Gantt, units of work,
// bolts of days with their rituals, and the AI-DLC documentation set.
// node e2e/aidlc-flow.mjs   (needs the web app + API + seed)
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
    await page.screenshot({ path: join(tmpdir(), `mo-aidlc-fail-${name.replace(/\W+/g, '_')}.png`), timeout: 10000 }).catch(() => undefined);
  }
};

const fujita = await session('fujita@kaori.jp');
const key = `AD${Date.now() % 100000}`;
const name = `Concierge bot ${key}`;

await step('creating an AI-DLC project lays out its three phases', fujita, async () => {
  await fujita.goto(`${BASE}/tasks`);
  await fujita.getByTestId('project-picker').click({ timeout: 90000 });
  await fujita.getByRole('menuitem', { name: 'New project' }).click();
  const dialog = fujita.getByRole('dialog');
  await dialog.getByLabel('Project name').fill(name);
  await dialog.getByLabel('Project key').fill(key);
  await dialog.getByLabel('Methodology').selectOption('ai-dlc');
  await dialog.getByTestId('project-save').click();
  await fujita.getByTestId('project-picker').getByText(name).waitFor();
  await fujita.getByTestId('methodology').getByText('AI-DLC').waitFor();
  await fujita.getByRole('tab', { name: 'gantt' }).click();
  for (const t of ['Inception', 'Construction', 'Operations']) await fujita.locator(`[data-testid="gantt-row"][data-title="${t}"]`).waitFor();
});

await step('epics are units of work here', fujita, async () => {
  await fujita.getByTestId('create-task').click();
  const dialog = fujita.getByRole('dialog');
  await dialog.getByRole('radio', { name: 'Unit of work' }).click();
  await dialog.getByLabel('Task title').fill('Room booking unit');
  await dialog.getByLabel('Task title').press('Enter');
  await dialog.waitFor({ state: 'detached' });
  await fujita.getByTestId('task-drawer').getByText('Room booking unit').first().waitFor();
  await fujita.getByTestId('task-drawer').getByLabel('Type').getByRole('option', { name: 'Unit of work', selected: true }).waitFor({ state: 'attached' });
  await fujita.getByRole('button', { name: 'Close', exact: true }).click();
  await fujita.getByTestId('task-drawer').waitFor({ state: 'detached' });
});

await step('bolts: two days by default, kickoff / review / retro and no daily', fujita, async () => {
  await fujita.getByRole('tab', { name: 'bolts' }).waitFor();
  await fujita.getByRole('tab', { name: 'backlog' }).click();
  await fujita.getByTestId('create-sprint').getByText('Create bolt').click();
  const dlg = fujita.getByRole('dialog');
  await dlg.getByText('Create bolt').first().waitFor();
  if ((await dlg.getByLabel('Duration').inputValue()) !== '2') throw new Error('bolt length');
  await dlg.getByTestId('save-sprint').click();
  await dlg.waitFor({ state: 'detached' });
  await fujita.getByText(`${key} Bolt 1`).waitFor();
  await fujita.getByLabel('Create issue in backlog').fill('Show free rooms');
  await fujita.getByLabel('Create issue in backlog').press('Enter');
  const row = fujita.locator('[data-testid="backlog-row"][data-title="Show free rooms"]');
  await row.waitFor();
  await row.dragTo(fujita.locator('[data-sprint]').first());
  await fujita.locator('[data-sprint]').first().locator('[data-testid="backlog-row"][data-title="Show free rooms"]').waitFor();
  await fujita.getByTestId('start-sprint').click();
  const start = fujita.getByRole('dialog');
  await start.getByTestId('ceremony-plan').getByText('Bolt Kickoff').waitFor();
  await start.getByTestId('ceremony-plan').getByText('Bolt Review').waitFor();
  if (await start.getByTestId('ceremony-plan').getByText('Daily Scrum').count()) throw new Error('a bolt has no daily');
});

await step('the documentation space recommends the AI-DLC set', fujita, async () => {
  await fujita.keyboard.press('Escape');
  await fujita.getByRole('tab', { name: 'docs' }).click();
  const chosen = fujita.getByTestId('docs-setup').getByRole('radio', { checked: true });
  await chosen.getByText('Recommended').waitFor({ timeout: 30000 });
  if (!(await chosen.innerText()).startsWith('AI-DLC')) throw new Error('not the AI-DLC set');
  await chosen.getByText('BOLT · Bolt Plan').waitFor();
});

await browser.close();
if (errors.length) {
  console.log('page errors:\n' + errors.join('\n'));
  fails++;
}
console.log(fails ? `\n${fails} step(s) failed` : '\nall AI-DLC e2e steps passed');
process.exit(fails ? 1 : 0);
