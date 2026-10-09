// Project documentation space end-to-end (§76, batch 3): setting it up from the recommended starter set, a page
// from the template gallery, stories made from the lines of a page (linked back to it), linking a page from an
// issue, the traceability matrix, and opening a page in the Docs editor.
// node e2e/project-docs-flow.mjs   (needs the web app + API + seed)
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
    await page.screenshot({ path: join(tmpdir(), `mo-pdocs-fail-${name.replace(/\W+/g, '_')}.png`), timeout: 10000 }).catch(() => undefined);
  }
};

const fujita = await session('fujita@hanami.example');
const req = fujita.context().request;
const spaces = await (await req.get(`${BASE}/api/spaces`)).json();
const key = `PD${Date.now() % 100000}`;
const proj = await (await req.post(`${BASE}/api/tasks/projects`, { data: { spaceId: spaces.find((x) => x.name === 'Mirai Systems').id, name: `Loyalty app ${key}`, key, methodology: 'scrum' } })).json();
const page = (code) => fujita.locator('[data-testid="docs-page"]').filter({ hasText: `${key} · ${code} —` });

await step('setting up the documentation space from the recommended set', fujita, async () => {
  await fujita.goto(`${BASE}/tasks?project=${proj.id}&view=docs`);
  await fujita.getByTestId('docset-scrum').getByText('Recommended').waitFor({ timeout: 90000 });
  await fujita.getByTestId('docset-waterfall').getByText('BRD · Business Requirements Document').waitFor();
  await fujita.getByTestId('setup-docs').click();
  await fujita.locator('[data-testid="docs-page"][data-name="Requirements"]').waitFor({ timeout: 60000 });
  await page('PRD').waitFor();
  await page('DoD').waitFor();
});

await step('a page from the template gallery goes into its section', fujita, async () => {
  await fujita.getByTestId('new-page').click();
  await fujita.getByLabel('Search templates').fill('use case');
  await fujita.locator('[data-testid="doc-template"][data-id="pd-use-case"]').click();
  await fujita.getByTestId('docs-page-detail').getByText(`${key} · UC — Use Case Specification`).waitFor({ timeout: 30000 });
});

await step('stories made from the lines of a page stay linked to it', fujita, async () => {
  await page('US').click();
  await fujita.getByTestId('issues-from-page').click();
  const dlg = fujita.getByRole('dialog');
  await dlg.getByLabel('All of Stories').check({ timeout: 30000 });
  await dlg.getByTestId('confirm-issues').click();
  await fujita.getByText(/3 stories created and linked/).waitFor();
  await fujita.getByTestId('page-issues').getByText('As a customer, I want to … so that …').waitFor();
});

await step('linking a page from an issue', fujita, async () => {
  await fujita.getByTestId('page-issues').getByText('As a customer, I want to … so that …').click();
  const drawer = fujita.getByTestId('task-drawer');
  await drawer.getByTestId('task-doc').filter({ hasText: `${key} · US —` }).waitFor();
  await drawer.getByTestId('link-doc').click();
  await fujita.getByLabel('Search pages').fill('PRD');
  await fujita.locator('[data-testid="doc-candidate"]').first().click();
  await drawer.getByTestId('task-doc').filter({ hasText: `${key} · PRD —` }).waitFor();
  await fujita.getByRole('button', { name: 'Close', exact: true }).click();
});

await step('the traceability matrix: pages, issues and coverage', fujita, async () => {
  await fujita.getByTestId('traceability').click();
  const m = fujita.getByTestId('trace-matrix');
  await m.locator('[data-testid="trace-row"]').filter({ hasText: `${key} · US —` }).getByText('0/3').waitFor();
  await m.locator('[data-testid="trace-row"]').filter({ hasText: `${key} · PRD —` }).getByText('0/1').waitFor();
  await m.locator('[data-testid="trace-row"]').filter({ hasText: `${key} · DoD —` }).getByText('Not covered').waitFor();
});

await step('a page opens in the Docs editor with its template', fujita, async () => {
  await page('PRD').click();
  await fujita.getByTestId('open-page').click();
  await fujita.waitForURL(/\/docs\//, { timeout: 30000 });
  await fujita.getByText('Feature list and priority').first().waitFor({ timeout: 60000 });
});

await browser.close();
if (errors.length) {
  console.log('page errors:\n' + errors.join('\n'));
  fails++;
}
console.log(fails ? `\n${fails} step(s) failed` : '\nall project docs e2e steps passed');
process.exit(fails ? 1 : 0);
