// Approvals end-to-end (§74): the pending badge, submitting a leave with an attachment and a live process preview,
// the manager approving live, HR rejecting needs a reason then approving, Out of office in the calendar, transfer,
// reject, withdraw + submit again, designing a new template and using it, searching all requests.
// node e2e/approvals-flow.mjs   (needs the web app + API + a fresh seed)
import { chromium } from 'playwright';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';

const BASE = process.env.WEB_URL ?? 'http://localhost:3000';
const browser = await chromium.launch();
const errors = [];
let fails = 0;

async function session(email) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, timezoneId: 'Asia/Tokyo' });
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
    await page.screenshot({ path: join(tmpdir(), `mo-approvals-fail-${name.replace(/\W+/g, '_')}.png`), timeout: 10000 }).catch(() => undefined);
  }
};
const ymd = (d) => new Date(Date.now() + d * 86400_000).toISOString().slice(0, 10);
const row = (page, text) => page.getByTestId('request-row').filter({ hasText: text }).first();

const mika = await session('mika@kaori.jp');
const yuki = await session('yuki@kaori.jp');
const rina = await session('rina@kaori.jp');
const claudia = await session('claudia@kaori.jp');
const users = await (await mika.context().request.get(`${BASE}/api/users`)).json();
const id = (k) => users.find((u) => u.email === `${k}@kaori.jp`).id;
const tpls = await (await yuki.context().request.get(`${BASE}/api/approvals/templates`)).json();
const T = (name) => tpls.find((t) => t.name === name);
let leaveId = '';

await step('the manager sees what waits for them (sidebar badge, Pending box)', mika, async () => {
  await mika.goto(`${BASE}/approvals`);
  await mika.getByTestId('approvals-pending').getByText('2').waitFor({ timeout: 90000 });
  await row(mika, 'AP-00001').waitFor();
  await row(mika, 'AP-00006').waitFor();
});

await step('submitting a leave: gallery, form, live process preview, attachment', yuki, async () => {
  await yuki.goto(`${BASE}/approvals`);
  await yuki.getByTestId('new-request').click({ timeout: 90000 });
  await yuki.locator('[data-testid="gallery-template"][data-name="Leave request"]').click();
  await yuki.getByTestId('submit-form').waitFor();
  await yuki.selectOption('#f-type', 'Sick leave');
  await yuki.fill('#f-dates', ymd(40));
  await yuki.getByLabel('Dates end').fill(ymd(41));
  await yuki.getByTestId('range-days').getByText('2 days').waitFor();
  await yuki.locator('[data-testid="route-step"][data-skipped="1"]').filter({ hasText: 'HR review' }).waitFor();
  await yuki.getByLabel('Dates end').fill(ymd(44));
  await yuki.getByTestId('route-step').filter({ hasText: 'HR review' }).filter({ hasText: 'Rina Kato' }).waitFor();
  const file = join(tmpdir(), 'clinic-note.txt');
  writeFileSync(file, 'Clinic appointment note');
  await yuki.getByTestId('file-input').setInputFiles(file);
  await yuki.getByTestId('attached-file').getByText('clinic-note.txt').waitFor({ timeout: 20000 });
  await yuki.fill('#f-reason', 'Minor surgery.');
  await yuki.getByTestId('submit-request').click();
  await yuki.getByTestId('request-detail').getByTestId('request-title').getByText('Leave request — Yuki Sato').waitFor({ timeout: 20000 });
  leaveId = new URL(yuki.url()).searchParams.get('r');
  await yuki.getByTestId('request-detail').getByTestId('status-pill').getByText('In review').waitFor();
});

await step('the manager gets it live and approves with a note', mika, async () => {
  const r = mika.getByTestId('request-row').first();
  await r.filter({ hasText: 'Yuki Sato' }).filter({ hasText: 'Sick leave' }).waitFor({ timeout: 15000 });
  await r.click();
  await mika.getByTestId('request-file').getByText('clinic-note.txt').waitFor();
  await mika.getByTestId('approve').click();
  await mika.getByTestId('decision-note').fill('Take care.');
  await mika.getByTestId('confirm-decision').click();
  await mika.locator('[data-testid="step-people"][data-step="0"]').getByText('Take care.').waitFor();
  await mika.locator('[data-testid="step-people"][data-step="1"][data-state="active"]').waitFor();
});

await step('HR: rejecting needs a reason; HR approves and the leave is approved', rina, async () => {
  await rina.goto(`${BASE}/approvals?r=${leaveId}`);
  await rina.getByTestId('reject').click({ timeout: 90000 });
  if (await rina.getByTestId('confirm-decision').isEnabled()) throw new Error('reject without a reason');
  await rina.keyboard.press('Escape');
  await rina.getByTestId('approve').click();
  await rina.getByTestId('confirm-decision').click();
  await rina.getByTestId('request-detail').getByTestId('status-pill').getByText('Approved').waitFor();
  await yuki.getByTestId('request-detail').getByTestId('status-pill').getByText('Approved').waitFor({ timeout: 15000 });
  const evs = await (await yuki.context().request.get(`${BASE}/api/calendar/events?from=${ymd(39)}T00:00:00Z&to=${ymd(46)}T00:00:00Z`)).json();
  if (!evs.some((e) => e.title === 'Out of office · Leave request' && e.kind === 'ooo')) throw new Error('no Out of office event');
});

await step('transferring to someone else', mika, async () => {
  const ken = await (await mika.context().request.post(`${BASE}/api/approvals/requests`, { headers: { 'x-user-id': id('ken') }, data: { templateId: T('Expense reimbursement').id, values: { type: 'Travel', amount: 12000, date: ymd(-1), description: 'Taxi to the warehouse' } } })).json();
  await mika.goto(`${BASE}/approvals?r=${ken.id}`);
  await mika.getByTestId('transfer').click({ timeout: 90000 });
  await mika.getByTestId('people-picker').locator('[data-name="Claudia Chen"]').click();
  await mika.getByTestId('confirm-transfer').click();
  await mika.locator('[data-testid="person-status"][data-status="transferred"]').getByText('Transferred to Claudia Chen').waitFor();
  await claudia.goto(`${BASE}/approvals`);
  await row(claudia, 'Taxi').or(row(claudia, ken.serial)).waitFor({ timeout: 90000 });
});

await step('rejecting with a reason', claudia, async () => {
  await row(claudia, 'AP-00004').click();
  await claudia.getByTestId('reject').click();
  await claudia.getByTestId('decision-note').fill('Please combine it with the November trip.');
  await claudia.getByTestId('confirm-decision').click();
  await claudia.getByTestId('request-detail').getByTestId('status-pill').getByText('Rejected').waitFor();
});

await step('withdraw, then submit again with the answers filled in', yuki, async () => {
  const trip = await (await yuki.context().request.post(`${BASE}/api/approvals/requests`, { data: { templateId: T('Business trip').id, values: { destination: 'Sapporo', dates: { start: ymd(50), end: ymd(51) }, purpose: 'Store opening', budget: 60000 } } })).json();
  await yuki.goto(`${BASE}/approvals?box=submitted&r=${trip.id}`);
  await yuki.getByTestId('withdraw').click({ timeout: 90000 });
  await yuki.getByTestId('request-detail').getByTestId('status-pill').getByText('Withdrawn').waitFor();
  await yuki.getByTestId('submit-again').click();
  await yuki.getByTestId('submit-form').waitFor();
  await yuki.waitForFunction(() => document.querySelector('#f-destination')?.value === 'Sapporo');
  await yuki.getByTestId('submit-request').click();
  await yuki.getByTestId('request-detail').getByTestId('status-pill').getByText('In review').waitFor({ timeout: 20000 });
  if (new URL(yuki.url()).searchParams.get('r') === trip.id) throw new Error('same request');
});

await step('designing a template and submitting it', claudia, async () => {
  await claudia.goto(`${BASE}/approvals?view=templates`);
  await claudia.getByTestId('new-template').click({ timeout: 90000 });
  await claudia.getByTestId('template-name').fill('Equipment loan');
  await claudia.getByRole('tab', { name: 'form' }).click();
  await claudia.getByLabel('Field label').first().fill('What do you borrow?');
  await claudia.getByRole('tab', { name: 'process' }).click();
  await claudia.getByTestId('step-card').waitFor();
  await claudia.getByTestId('save-template').click();
  await claudia.locator('[data-testid="template-card"][data-name="Equipment loan"]').waitFor({ timeout: 20000 });
  await yuki.goto(`${BASE}/approvals`);
  await yuki.getByTestId('new-request').click({ timeout: 90000 });
  await yuki.locator('[data-testid="gallery-template"][data-name="Equipment loan"]').click();
  await yuki.getByLabel('What do you borrow?').fill('Projector');
  await yuki.getByTestId('route-step').filter({ hasText: 'Mika Tanaka' }).waitFor();
  await yuki.getByTestId('submit-request').click();
  await yuki.getByTestId('request-detail').getByText('Equipment loan — Yuki Sato').waitFor({ timeout: 20000 });
});

await step('all requests: search across everything you manage', claudia, async () => {
  await claudia.goto(`${BASE}/approvals?box=all`);
  await claudia.getByTestId('request-search').fill('barcode', { timeout: 90000 });
  await row(claudia, 'AP-00003').waitFor();
  if ((await claudia.getByTestId('request-row').count()) !== 1) throw new Error('search should leave one row');
});

await browser.close();
if (errors.length) {
  console.log('page errors:\n' + errors.join('\n'));
  fails++;
}
console.log(fails ? `\n${fails} step(s) failed` : '\nall approvals e2e steps passed');
process.exit(fails ? 1 : 0);
