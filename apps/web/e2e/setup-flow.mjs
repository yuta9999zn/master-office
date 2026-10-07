// First-run setup end-to-end (§79): a fresh install sends everyone to /setup; organisation → owner account →
// system e-mail (skipped) → first team + invitations (links shown without e-mail) → home; afterwards /setup is
// closed, signed-out people go to /login (production sign-in, AUTH_DEV=0) and the owner signs in.
// Needs a second API on an EMPTY database, e.g.
//   DATABASE_URL=…/workos_setup API_PORT=4100 COLLAB_PORT=4101 MAIL_INBOUND_PORT=0 AUTH_DEV=0 node dist/apps/api/src/main.js
// then: SETUP_API=http://localhost:4100 node e2e/setup-flow.mjs   (the browser's /api calls are routed to it)
import { chromium } from 'playwright';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = process.env.WEB_URL ?? 'http://localhost:3000';
const API = process.env.SETUP_API ?? 'http://localhost:4100';
const browser = await chromium.launch();
const errors = [];
let fails = 0;

async function fresh() {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.route('**/api/**', async (route) => {
    const u = new URL(route.request().url());
    if (!u.pathname.startsWith('/api/')) return route.continue();
    const response = await route.fetch({ url: API + u.pathname.slice(4) + u.search });
    await route.fulfill({ response });
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  return page;
}
const step = async (name, page, fn) => {
  try {
    await fn();
    console.log('✓', name);
  } catch (e) {
    fails++;
    console.log('✗', name, '—', process.env.FULL ? e.message.slice(0, 1500) : e.message.split('\n')[0]);
    await page.screenshot({ path: join(tmpdir(), `mo-setup-fail-${name.replace(/\W+/g, '_')}.png`), timeout: 10000 }).catch(() => undefined);
  }
};

const p = await fresh();
await step('a fresh install opens the setup', p, async () => {
  await p.goto(`${BASE}/home`);
  await p.waitForURL('**/setup', { timeout: 90000 });
  await p.getByTestId('setup-steps').waitFor();
});

await step('1 · the organisation', p, async () => {
  await p.getByLabel('Organisation name').fill('ABC Company');
  await p.getByLabel('E-mail domain').fill('abc.vn');
  await p.getByTestId('setup-next').click();
});

await step('2 · the owner account', p, async () => {
  await p.getByLabel('Your name').fill('An Nguyen');
  await p.getByLabel('E-mail').fill('an@abc.vn');
  await p.getByLabel('New password').fill('first owner pass');
  await p.getByLabel('Repeat password').fill('first owner pass');
  await p.getByTestId('setup-create').click();
  await p.getByTestId('smtp-form').waitFor({ timeout: 60000 });
});

await step('3 · system e-mail: the guide is there, skipped for now', p, async () => {
  await p.getByTestId('smtp-guide').getByText('16-character password').waitFor();
  await p.getByTestId('setup-skip-mail').click();
});

await step('4 · first team and invitations — links to share by hand', p, async () => {
  await p.getByLabel('First team').fill('Sales');
  await p.getByLabel('Invite e-mails').fill('binh@abc.vn, chi@abc.vn');
  await p.getByTestId('setup-invite').click();
  await p.getByTestId('setup-links').getByLabel('Invitation link for binh@abc.vn').waitFor({ timeout: 30000 });
  await p.getByTestId('setup-finish').click();
  await p.waitForURL('**/home', { timeout: 60000 });
  await p.getByText('An Nguyen').first().waitFor({ timeout: 60000 });
});

await step('the owner is an admin with the people invited', p, async () => {
  await p.goto(`${BASE}/admin`);
  await p.locator('[data-testid="invitation"][data-email="chi@abc.vn"]').waitFor({ timeout: 60000 });
  await p.locator('[data-testid="member-row"][data-email="an@abc.vn"]').getByText('Owner').waitFor();
});

const q = await fresh();
await step('setup is closed once done; signed-out people go to sign in', q, async () => {
  await q.goto(`${BASE}/setup`);
  await q.waitForURL('**/login**', { timeout: 60000 });
  await q.goto(`${BASE}/drive`);
  await q.waitForURL('**/login?next=%2Fdrive', { timeout: 60000 });
});

await step('the owner signs in and lands where they were going', q, async () => {
  await q.getByLabel('E-mail').fill('an@abc.vn');
  await q.getByLabel('Password').fill('first owner pass');
  await q.getByTestId('login-submit').click();
  await q.waitForURL('**/drive**', { timeout: 60000 });
  if (await q.getByText('Dev mode').count()) throw new Error('dev mode shown');
});

await browser.close();
if (errors.length) console.log('page errors:', errors);
console.log(fails ? `\n${fails} step(s) failed` : '\nall setup steps passed');
process.exit(fails || errors.length ? 1 : 0);
