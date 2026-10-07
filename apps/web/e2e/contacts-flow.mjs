// Phase 5 end-to-end: Contacts & profiles — directory search and grouping, profile tabs, chat from a profile,
// editing your own profile from the user menu, profile link from a DM.
// node e2e/contacts-flow.mjs   (needs the web app + API + fresh seed)
import { chromium } from 'playwright';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = process.env.WEB_URL ?? 'http://localhost:3000';
const browser = await chromium.launch();
const errors = [];
let fails = 0;

async function session(email) {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 940 } });
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
    await page.screenshot({ path: join(tmpdir(), `mo-contacts-fail-${name.replace(/\W+/g, '_')}.png`) });
  }
};
const until = async (page, fn, arg, timeout = 15000) => page.waitForFunction(fn, arg, { timeout, polling: 200 });
const names = (page) => page.getByTestId('directory').getByTestId('contact').evaluateAll((els) => els.map((e) => e.getAttribute('data-name')));

const claudia = await session('claudia@kaori.jp');

await step('the directory lists everyone and searches skills', claudia, async () => {
  await claudia.goto(`${BASE}/contacts`);
  await claudia.getByTestId('contact').first().waitFor({ timeout: 60000 });
  // The ten seeded people (other suites, e.g. auth.mjs, may have invited more).
  if ((await names(claudia)).length < 10) throw new Error('count ' + (await names(claudia)).length);
  await claudia.getByLabel('Search contacts').fill('japanese');
  await until(claudia, () => document.querySelectorAll('[data-testid="directory"] [data-testid="contact"]').length === 1);
  if ((await names(claudia))[0] !== 'Fujita Sota') throw new Error((await names(claudia)).join());
  await claudia.getByLabel('Search contacts').fill('');
});

await step('grouping by department and by project', claudia, async () => {
  await claudia.getByRole('tab', { name: 'department' }).click();
  await claudia.locator('[data-testid="contact-group"][data-title="ITM Japan"] [data-name="Fujita Sota"]').waitFor();
  await claudia.getByRole('tab', { name: 'project' }).click();
  const itm = claudia.locator('[data-testid="contact-group"][data-title="ITM Japan"]');
  await itm.locator('[data-name="Nguyễn Minh"]').waitFor();
  await claudia.getByRole('tab', { name: 'All' }).click();
});

await step('a profile shows contact details, skills, projects and manager', claudia, async () => {
  await claudia.getByTestId('directory').locator('[data-name="Fujita Sota"]').getByRole('link').click();
  await claudia.getByTestId('profile-name').getByText('Fujita Sota').waitFor();
  await claudia.getByTestId('profile-status').getByText('よろしくお願いします。').waitFor();
  const field = (label) => claudia.locator(`[data-testid="profile-field"][data-label="${label}"]`);
  await field('Phone').getByText('+81 90-1234-5678').waitFor();
  await field('Skills').getByText('Japanese').waitFor();
  await field('Projects').getByText('ITM Japan').waitFor();
  await field('Manager').getByText('Claudia Chen').waitFor();
  await field('Joined').getByText('Jan 15, 2024').waitFor();
});

await step('Organization shows the reporting line; Files lists their files', claudia, async () => {
  await claudia.getByRole('tab', { name: 'organization' }).click();
  await claudia.getByTestId('org-chart').getByText('Claudia Chen').click();
  await claudia.getByTestId('profile-name').getByText('Claudia Chen').waitFor();
  await claudia.getByRole('tab', { name: 'organization' }).click();
  await claudia.getByTestId('org-chart').getByText('Direct reports · 5').waitFor();
  await claudia.getByTestId('org-chart').getByText('Fujita Sota').click();
  await claudia.getByTestId('profile-name').getByText('Fujita Sota').waitFor();
  await claudia.getByRole('tab', { name: 'files' }).click();
  // Their latest files (API suites add wiki pages as Fujita, so no particular file is checked).
  await claudia.getByTestId('profile-files').locator('a, button, li').first().waitFor();
});

await step('Chat from a profile opens the direct message', claudia, async () => {
  await claudia.getByTestId('profile-chat').click();
  await claudia.getByTestId('conversation-title').getByText('Fujita Sota').waitFor({ timeout: 30000 });
});

await step('a DM links to the profile', claudia, async () => {
  await claudia.getByRole('button', { name: 'Details' }).click();
  await claudia.getByTestId('view-profile').click();
  await claudia.getByTestId('profile-name').getByText('Fujita Sota').waitFor({ timeout: 30000 });
});

await step('people edit their own profile from the user menu', claudia, async () => {
  const ken = await session('ken@kaori.jp');
  await ken.goto(`${BASE}/home`);
  await ken.getByText('Ken Watanabe').first().click();
  await ken.getByRole('menuitem', { name: 'Profile' }).click();
  await ken.getByTestId('profile-name').getByText('Ken Watanabe').waitFor({ timeout: 60000 });
  await ken.getByTestId('edit-profile').click();
  if (await ken.getByText('Organization (administrators)').count()) throw new Error('org fields shown to a member');
  await ken.getByLabel('Status').fill('Inventory count all day');
  await ken.getByLabel('Skills').fill('Engineering, System, Inventory, Forklift');
  await ken.getByTestId('save-profile').click();
  await ken.getByTestId('profile-status').getByText('Inventory count all day').waitFor();
  await ken.locator('[data-testid="profile-field"][data-label="Skills"]').getByText('Forklift').waitFor();
  await ken.context().close();
});

await browser.close();
if (errors.length) {
  console.log('page errors:\n' + errors.join('\n'));
  fails++;
}
console.log(fails ? `\n${fails} step(s) failed` : '\nall contacts e2e steps passed');
process.exit(fails ? 1 : 0);
