// Slides audience Q&A end-to-end: start from presenter view, banner on the show, anonymous audience asks and
// votes (one vote each), present a question on the big screen, hide, stop.
// node e2e/qa-flow.mjs   (needs pnpm dev + API)
import { chromium } from 'playwright';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = process.env.WEB_URL ?? 'http://localhost:3000';
const browser = await chromium.launch();
const errors = [];
let fails = 0;

const ctx = await browser.newContext({ viewport: { width: 1500, height: 900 } });
const users = await (await ctx.request.get(`${BASE}/api/users`)).json();
await ctx.addCookies([{ name: 'mo_uid', value: users.find((u) => u.email === 'claudia@hanami.example').id, url: BASE }]);
const show = await ctx.newPage();
show.on('pageerror', (e) => errors.push(`show: ${e.message}`));
let presenter;
const step = async (name, page, fn) => {
  try {
    await fn();
    console.log('✓', name);
  } catch (e) {
    fails++;
    console.log('✗', name, '—', e.message.split('\n')[0]);
    await page.screenshot({ path: join(tmpdir(), `mo-qa-fail-${name.replace(/\W+/g, '_')}.png`) });
  }
};
// Audience members: no Master Office cookie at all.
const audience = async () => {
  const c = await browser.newContext({ viewport: { width: 420, height: 800 } });
  const p = await c.newPage();
  p.on('pageerror', (e) => errors.push(`audience: ${e.message}`));
  return p;
};

const deck = await (await show.request.post(`${BASE}/api/resources`, { data: { name: `QA deck ${Date.now()}`, type: 'presentation' } })).json();
let link;

await step('presenter view starts a Q&A session; the show displays the link', show, async () => {
  await show.goto(`${BASE}/slides/${deck.id}`);
  await show.getByTestId('slide-canvas').waitFor({ timeout: 60000 });
  await show.keyboard.press('F5');
  await show.getByTestId('presenter').waitFor();
  presenter = await ctx.newPage();
  presenter.on('pageerror', (e) => errors.push(`presenter: ${e.message}`));
  await presenter.goto(`${BASE}/present/${deck.id}`);
  await presenter.getByRole('button', { name: 'Audience Q&A' }).click({ timeout: 60000 });
  await presenter.getByTestId('qa-start').click();
  link = (await presenter.getByTestId('qa-link').innerText()).trim();
  if (!/\/qa\/[\w-]{6,}$/.test(link)) throw new Error(`link ${link}`);
  await show.getByTestId('qa-banner').getByText(link.replace(/^https?:\/\//, '')).waitFor({ timeout: 10000 });
});

let a1;
await step('the audience asks anonymously and votes once each', show, async () => {
  a1 = await audience();
  await a1.goto(link);
  await a1.getByLabel('Your question').fill('When is the launch?');
  await a1.getByTestId('qa-submit').click();
  const q = a1.getByTestId('qa-list').getByText('When is the launch?');
  await q.waitFor();
  await a1.getByTestId('qa-list').getByText('Anonymous').waitFor();
  const up = a1.getByRole('button', { name: /Upvote: When is the launch\?/ });
  await up.click();
  await a1.getByRole('button', { name: /Remove vote: When is the launch\?/ }).waitFor();
  // Voting again takes the vote back; once more puts it back.
  await a1.getByRole('button', { name: /Remove vote/ }).click();
  await a1.getByRole('button', { name: /Upvote/ }).waitFor();
  await a1.getByRole('button', { name: /Upvote/ }).click();
  const a2 = await audience();
  await a2.goto(link);
  await a2.getByRole('button', { name: /Upvote: When is the launch\?/ }).click();
  await a2.getByRole('button', { name: /Remove vote: When is the launch\?/ }).filter({ hasText: '2' }).waitFor();
  await a2.context().close();
});

await step('presenting a question puts it on the big screen; hiding removes it for the audience', show, async () => {
  const item = presenter.getByTestId('qa-question').filter({ hasText: 'When is the launch?' });
  await item.getByText('2', { exact: false }).first().waitFor({ timeout: 10000 });
  await item.getByRole('button', { name: 'Present this question' }).click();
  await show.getByTestId('qa-presented').getByText('When is the launch?').waitFor({ timeout: 10000 });
  await item.getByRole('button', { name: 'Hide question' }).click();
  await show.getByTestId('qa-presented').waitFor({ state: 'detached', timeout: 10000 });
  await a1.getByTestId('qa-list').getByText('When is the launch?').waitFor({ state: 'detached', timeout: 10000 });
});

await step('stopping ends the session for everyone', show, async () => {
  await presenter.getByTestId('qa-stop').click();
  await show.getByTestId('qa-banner').waitFor({ state: 'detached', timeout: 10000 });
  await a1.getByTestId('qa-closed').waitFor({ timeout: 10000 });
  const res = await a1.request.post(`${link.replace(/^https?:\/\/[^/]+/, BASE).replace('/qa/', '/api/qa/')}/questions`, { data: { text: 'late', voter: crypto.randomUUID() } });
  if (res.status() !== 403) throw new Error(`asking after the end: ${res.status()}`);
});

await show.request.delete(`${BASE}/api/resources/${deck.id}`);
await browser.close();
console.log(errors.length ? `browser errors:\n  ${errors.join('\n  ')}` : 'no browser errors');
if (errors.length) fails++;
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
