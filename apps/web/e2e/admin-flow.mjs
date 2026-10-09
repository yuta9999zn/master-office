// Organisation & sign-in end-to-end (§79, batch A): the owner invites someone into a team with a position, the
// invitation link creates the account and signs in, sign out / sign in with the password, a wrong password, changing
// the password, suspending (signed out at once), the system e-mail page with its app-password guide and test errors.
// node e2e/admin-flow.mjs   (needs the web app + API in dev mode + seed)
import { chromium } from 'playwright';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = process.env.WEB_URL ?? 'http://localhost:3000';
const browser = await chromium.launch();
const errors = [];
let fails = 0;

async function session(email) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, timezoneId: 'Asia/Tokyo' });
  if (email) {
    const users = await (await ctx.request.get(`${BASE}/api/users`)).json();
    await ctx.addCookies([{ name: 'mo_uid', value: users.find((u) => u.email === email).id, url: BASE }]);
  }
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${email ?? 'guest'}: ${e.message}`));
  return page;
}
const step = async (name, page, fn) => {
  try {
    await fn();
    console.log('✓', name);
  } catch (e) {
    fails++;
    console.log('✗', name, '—', process.env.FULL ? e.message.slice(0, 1500) : e.message.split('\n')[0]);
    await page.screenshot({ path: join(tmpdir(), `mo-admin-fail-${name.replace(/\W+/g, '_')}.png`), timeout: 10000 }).catch(() => undefined);
  }
};

const owner = await session('claudia@hanami.example');
const n = Date.now() % 1000000;
const email = `designer.${n}@example.com`;
let link = '';

await step('the owner opens the admin console from the top bar', owner, async () => {
  await owner.goto(`${BASE}/home`);
  await owner.getByTestId('admin-button').click({ timeout: 90000 });
  await owner.getByTestId('members-table').waitFor({ timeout: 60000 });
  await owner.locator('[data-testid="member-row"][data-email="claudia@hanami.example"]').getByText('Owner').waitFor();
});

await step('inviting someone into a team with a position (no system e-mail → the link is shown)', owner, async () => {
  await owner.getByTestId('invite-people').click();
  const dlg = owner.getByRole('dialog');
  await dlg.getByLabel('Invite e-mails').fill(email);
  await dlg.getByTestId('invite-team').selectOption({ label: 'Mirai Systems' });
  await dlg.getByLabel('Position').fill('UI designer');
  await dlg.getByLabel('Message').fill('Welcome to the team!');
  await owner.getByTestId('invite-send').click();
  link = await owner.getByTestId('invite-link').inputValue({ timeout: 30000 });
  if (!/\/invite\/[\w-]+$/.test(link)) throw new Error(link);
  await owner.getByRole('button', { name: 'Done' }).click();
  await owner.locator('[data-testid="invitation"]').filter({ hasText: email }).waitFor();
});

const guest = await session(null);
await step('the invitation link: organisation, team and position, then the account', guest, async () => {
  await guest.goto(link.replace(/^https?:\/\/[^/]+/, BASE));
  const info = guest.getByTestId('invite-info');
  await info.getByText('Mirai Systems · UI designer').waitFor({ timeout: 60000 });
  await info.getByText('Welcome to the team!').waitFor();
  await guest.getByLabel('Your name').fill('Dana Designer');
  await guest.getByLabel('New password').fill('short');
  await guest.getByLabel('Repeat password').fill('short');
  if (await guest.getByTestId('password-submit').isEnabled()) throw new Error('short password accepted');
  await guest.getByLabel('New password').fill('pixels and coffee');
  await guest.getByLabel('Repeat password').fill('pixels and coffee');
  await guest.getByTestId('password-submit').click();
  await guest.waitForURL('**/home', { timeout: 60000 });
  await guest.getByText('Dana Designer').first().waitFor({ timeout: 60000 });
});

await step('signing out and back in with the password', guest, async () => {
  await guest.getByText('Dana Designer').first().click();
  await guest.getByTestId('sign-out').click();
  await guest.waitForURL('**/login', { timeout: 30000 });
  await guest.getByLabel('E-mail').fill(email);
  await guest.getByLabel('Password').fill('wrong password');
  await guest.getByTestId('login-submit').click();
  await guest.getByTestId('auth-error').getByText('Wrong e-mail or password').waitFor();
  await guest.getByLabel('Password').fill('pixels and coffee');
  await guest.getByTestId('login-submit').click();
  await guest.waitForURL('**/home', { timeout: 60000 });
  await guest.getByText('Dana Designer').first().waitFor({ timeout: 60000 });
});

await step('changing the password', guest, async () => {
  await guest.getByText('Dana Designer').first().click();
  await guest.getByRole('menuitem', { name: 'Password & sign-in' }).click();
  await guest.getByLabel('Current password').fill('pixels and coffee');
  await guest.getByLabel('New password').fill('pixels and more coffee');
  await guest.getByLabel('Repeat password').fill('pixels and more coffee');
  await guest.getByTestId('password-save').click();
  await guest.getByText('Password saved').waitFor();
  if (await guest.getByTestId('admin-button').count()) throw new Error('a member sees the admin button');
});

await step('the new member is listed; suspending signs them out', owner, async () => {
  await owner.reload();
  const row = owner.locator(`[data-testid="member-row"][data-email="${email}"]`);
  await row.getByText('Password set').waitFor({ timeout: 60000 });
  await row.getByTestId('member-menu').click();
  await owner.getByRole('menuitem', { name: 'Suspend' }).click();
  await row.getByText('Suspended').waitFor();
  const s = await (await guest.context().request.get(`${BASE}/api/auth/session`)).json();
  if (s.signedIn) throw new Error('still signed in');
  await row.getByTestId('member-menu').click();
  await owner.getByRole('menuitem', { name: 'Reactivate' }).click();
  await row.getByText('Suspended').waitFor({ state: 'detached' });
});

await step('roles: the owner makes a member a guest', owner, async () => {
  const row = owner.locator(`[data-testid="member-row"][data-email="${email}"]`);
  await row.getByTestId('member-role').selectOption('viewer');
  await owner.waitForTimeout(500);
  await owner.reload();
  await owner.locator(`[data-testid="member-row"][data-email="${email}"]`).getByTestId('member-role').waitFor({ timeout: 60000 });
  if ((await owner.locator(`[data-testid="member-row"][data-email="${email}"]`).getByTestId('member-role').inputValue()) !== 'viewer') throw new Error('role not saved');
});

await step('system e-mail: the app-password guide per provider', owner, async () => {
  await owner.getByTestId('admin-tab-email').click();
  await owner.getByTestId('smtp-guide').getByText('2-Step Verification').waitFor();
  await owner.getByTestId('smtp-guide').getByRole('link', { name: 'App passwords' }).waitFor();
  await owner.getByTestId('smtp-outlook').click();
  await owner.getByTestId('smtp-guide').getByText('Authenticated SMTP').waitFor();
  await owner.getByTestId('smtp-custom').click();
  await owner.getByTestId('smtp-guide').getByText('app-specific password').waitFor();
});

await step('system e-mail: save, the password is hidden, a failing test shows the error, remove', owner, async () => {
  await owner.getByLabel('Sender e-mail').fill('mailer@example.com');
  await owner.getByLabel('App password').fill('secret-app-password');
  await owner.getByLabel('SMTP server').fill('127.0.0.1');
  await owner.getByLabel('Port').fill('1');
  await owner.getByTestId('smtp-save').click();
  await owner.getByTestId('smtp-state').getByText('not tested yet').waitFor({ timeout: 30000 });
  if ((await owner.getByLabel('App password').inputValue()) !== '') throw new Error('password still in the field');
  await owner.getByLabel('Test recipient').fill('claudia@hanami.example');
  await owner.getByTestId('smtp-test').click();
  await owner.getByTestId('smtp-error').getByText('could not be sent').waitFor({ timeout: 30000 });
  await owner.getByTestId('smtp-state').getByRole('button', { name: 'Remove' }).click();
  await owner.getByTestId('smtp-state').waitFor({ state: 'detached' });
});

await step('forgot password: the same answer for any address', guest, async () => {
  await guest.goto(`${BASE}/forgot`);
  await guest.getByLabel('E-mail').fill(`nobody.${n}@example.com`);
  await guest.getByTestId('forgot-submit').click();
  await guest.getByTestId('forgot-sent').waitFor({ timeout: 30000 });
});

await browser.close();
if (errors.length) console.log('page errors:', errors);
console.log(fails ? `\n${fails} step(s) failed` : '\nall admin steps passed');
process.exit(fails || errors.length ? 1 : 0);
