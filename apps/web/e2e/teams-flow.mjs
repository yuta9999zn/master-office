// Teams & departments end-to-end (§79, batch B): the organisation chart in Admin → Teams (a department with a lead
// and positions, members, a sub-team), team + position tags in Contacts, phone privacy (hidden from colleagues,
// shared with everyone by choice), and in Chat: the sender's position next to their name, the person card on hover,
// team tags in the member list and on the DM card.
// node e2e/teams-flow.mjs   (needs the web app + API in dev mode + seed)
import { chromium } from 'playwright';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = process.env.WEB_URL ?? 'http://localhost:3000';
const browser = await chromium.launch();
const errors = [];
let fails = 0;
let users = [];

async function session(email) {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 940 }, timezoneId: 'Asia/Tokyo' });
  users = await (await ctx.request.get(`${BASE}/api/users`)).json();
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
    await page.screenshot({ path: join(tmpdir(), `mo-teams-fail-${name.replace(/\W+/g, '_')}.png`), timeout: 10000 }).catch(() => undefined);
  }
};
const n = Date.now() % 100000;
const dept = `Sales ${n}`;
const claudia = await session('claudia@hanami.example');

await step('the organisation chart: departments with their teams', claudia, async () => {
  await claudia.goto(`${BASE}/admin?tab=teams`);
  await claudia.getByTestId('team-tree').waitFor({ timeout: 90000 });
  await claudia.locator('[data-testid="team-node"][data-name="Marketing"]').waitFor();
  const pad = await claudia.locator('[data-testid="team-node"][data-name="Marketing"]').evaluate((e) => parseInt(e.style.paddingLeft));
  if (pad <= 8) throw new Error('Marketing is not nested under Sakura Beauty');
});

await step('a new department with a lead and their position', claudia, async () => {
  await claudia.getByTestId('new-team').click();
  const dlg = claudia.getByRole('dialog');
  await dlg.getByLabel('Team name').fill(dept);
  await dlg.getByRole('radio', { name: /Department/ }).click();
  await dlg.getByLabel('Lead', { exact: true }).selectOption({ label: 'Hana Lee' });
  await dlg.getByLabel('Lead position').fill('Head of Sales');
  await claudia.getByTestId('team-save').click();
  const hana = claudia.locator('[data-testid="team-member"][data-name="Hana Lee"]');
  await hana.waitFor({ timeout: 30000 });
  await hana.getByLabel('Lead').waitFor();
  if ((await hana.getByLabel('Position of Hana Lee').inputValue()) !== 'Head of Sales') throw new Error('position');
});

await step('adding members with positions, editing a position', claudia, async () => {
  await claudia.getByLabel('Add a person').selectOption({ label: 'Ken Watanabe' });
  await claudia.getByLabel('New member position').fill('Sales rep');
  await claudia.getByTestId('team-add-member').click();
  const ken = claudia.locator('[data-testid="team-member"][data-name="Ken Watanabe"]');
  await ken.waitFor({ timeout: 30000 });
  await ken.getByLabel('Position of Ken Watanabe').fill('Senior sales rep');
  await ken.getByLabel('Position of Ken Watanabe').press('Enter');
  await claudia.waitForTimeout(800);
  await claudia.reload();
  await claudia.locator(`[data-testid="team-node"][data-name="${dept}"]`).click({ timeout: 60000 });
  const v = await claudia.locator('[data-testid="team-member"][data-name="Ken Watanabe"]').getByLabel('Position of Ken Watanabe').inputValue({ timeout: 30000 });
  if (v !== 'Senior sales rep') throw new Error(v);
});

await step('a sub-team under the department', claudia, async () => {
  await claudia.getByRole('button', { name: 'Sub-team' }).click();
  const dlg = claudia.getByRole('dialog');
  await dlg.getByLabel('Team name').fill(`North ${n}`);
  await claudia.getByTestId('team-save').click();
  const node = claudia.locator(`[data-testid="team-node"][data-name="North ${n}"]`);
  await node.waitFor({ timeout: 30000 });
  const pad = await node.evaluate((e) => parseInt(e.style.paddingLeft));
  const parentPad = await claudia.locator(`[data-testid="team-node"][data-name="${dept}"]`).evaluate((e) => parseInt(e.style.paddingLeft));
  if (pad <= parentPad) throw new Error('not nested');
});

await step('Contacts: teams and positions, leads marked', claudia, async () => {
  await claudia.goto(`${BASE}/contacts`);
  const mika = claudia.locator('[data-testid="contact"][data-name="Mika Tanaka"]');
  await mika.getByText('Operations · Head of Operations').waitFor({ timeout: 60000 });
  await mika.getByTestId('team-tag').first().getByLabel('Lead').waitFor();
  const ken = claudia.locator('[data-testid="contact"][data-name="Ken Watanabe"]');
  await ken.click();
  await claudia.getByText(`${dept} · Senior sales rep`).first().waitFor();
});

const sora = await session('sora@hanami.example');
const yukiId = users.find((u) => u.email === 'yuki@hanami.example').id;
await step('a colleague who doesn’t lead them can’t see the phone', sora, async () => {
  await sora.goto(`${BASE}/contacts/${yukiId}`);
  await sora.getByTestId('phone-hidden').waitFor({ timeout: 60000 });
});

const yuki = await session('yuki@hanami.example');
await step('people choose to share their phone with everyone', yuki, async () => {
  await yuki.goto(`${BASE}/contacts/${yukiId}`);
  await yuki.getByRole('button', { name: 'Edit profile' }).click({ timeout: 60000 });
  await yuki.getByLabel('Phone visibility').selectOption('everyone');
  await yuki.getByTestId('save-profile').click();
  await yuki.getByText('everyone sees it').waitFor();
  await sora.reload();
  await sora.getByText('+81 80-3333-0104').waitFor({ timeout: 60000 });
  await yuki.getByRole('button', { name: 'Edit profile' }).click();
  await yuki.getByLabel('Phone visibility').selectOption('leads');
  await yuki.getByTestId('save-profile').click();
  await yuki.getByText('your team leads and admins see it').waitFor();
});

// Chat: Fujita writes in the Mirai Systems project channel.
const fujitaId = users.find((u) => u.email === 'fujita@hanami.example').id;
const convs = await (await claudia.context().request.get(`${BASE}/api/chat/conversations`, { headers: { 'x-user-id': fujitaId } })).json();
const itm = convs.find((c) => c.spaceId && c.title.startsWith('Mirai Systems'));
await claudia.context().request.post(`${BASE}/api/chat/conversations/${itm.id}/messages`, { headers: { 'x-user-id': fujitaId }, data: { body: `Status update ${n}` } });

await step('Chat: the sender’s position in this team, next to the name', claudia, async () => {
  await claudia.goto(`${BASE}/chat/${itm.id}`);
  const msg = claudia.locator('[data-testid="message"]').filter({ hasText: `Status update ${n}` }).last();
  await msg.waitFor({ timeout: 60000 });
  await msg.getByTestId('author-team').getByText('Mirai Systems · Project Manager').waitFor();
});

await step('… and every team on hover', claudia, async () => {
  const msg = claudia.locator('[data-testid="message"]').filter({ hasText: `Status update ${n}` }).last();
  await msg.getByTestId('message-author').hover();
  await claudia.getByTestId('person-summary').getByText('Mirai Systems · Project Manager').waitFor();
});

await step('… and in the member list', claudia, async () => {
  await claudia.getByRole('button', { name: 'Members' }).click();
  const row = claudia.locator('[data-testid="member"][data-name="Mika Tanaka"]');
  await row.getByText('Mirai Systems · Business Analyst').waitFor({ timeout: 30000 });
});

await browser.close();
if (errors.length) console.log('page errors:', errors);
console.log(fails ? `\n${fails} step(s) failed` : '\nall teams steps passed');
process.exit(fails || errors.length ? 1 : 0);
