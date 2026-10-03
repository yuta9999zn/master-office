// Cross-cutting features end-to-end: spelling & grammar in Docs (underlines, suggestion card, personal dictionary).
// node e2e/spelling-flow.mjs   (needs pnpm dev + API + seeded data)
import { chromium } from 'playwright';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = process.env.WEB_URL ?? 'http://localhost:3000';
const browser = await chromium.launch();
const errors = [];
let fails = 0;

const ctx = await browser.newContext({ viewport: { width: 1500, height: 940 } });
const users = await (await ctx.request.get(`${BASE}/api/users`)).json();
await ctx.addCookies([{ name: 'mo_uid', value: users.find((u) => u.email === 'claudia@kaori.jp').id, url: BASE }]);
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(e.message));

const step = async (name, fn) => {
  try {
    await fn();
    console.log('✓', name);
  } catch (e) {
    fails++;
    console.log('✗', name, '—', e.message.split('\n')[0]);
    await page.screenshot({ path: join(tmpdir(), `mo-spelling-fail-${name.replace(/\W+/g, '_')}.png`) });
  }
};
const until = (fn, arg, timeout = 15000) => page.waitForFunction(fn, arg, { timeout, polling: 200 });
const editor = page.getByTestId('doc-editor');
const card = page.getByTestId('spelling-card');
const WORD = `Kaorix${String.fromCharCode(97 + (Date.now() % 26))}${String.fromCharCode(97 + ((Date.now() / 26) % 26 | 0))}`;

const doc = await (await page.request.post(`${BASE}/api/resources`, { data: { type: 'document', name: 'Spelling test' } })).json();

await step('the dictionary knows real words and suggests fixes', async () => {
  const r = await (await page.request.post(`${BASE}/api/spelling/check`, { data: { words: ['hello', 'teh', 'recieve', 'Tokyo'] } })).json();
  if (Object.keys(r.misspelled).sort().join() !== 'recieve,teh' || r.misspelled.teh[0] !== 'the' || r.misspelled.recieve[0] !== 'receive') throw new Error(JSON.stringify(r));
});

await step('misspellings and grammar issues are underlined as you type; Vietnamese is left alone', async () => {
  await page.goto(`${BASE}/docs/${doc.id}`);
  await editor.waitFor({ timeout: 60000 });
  await editor.click();
  await page.keyboard.type('We recieve the the report. it is done.');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Báo cáo tháng mười đã xong.');
  await until(() => document.querySelectorAll('.mo-editor .mo-spell').length === 1 && document.querySelectorAll('.mo-editor .mo-grammar').length === 2);
  const spell = await editor.locator('.mo-spell').innerText();
  if (spell !== 'recieve') throw new Error(`underlined "${spell}"`);
  if ((await editor.getAttribute('spellcheck')) !== 'false') throw new Error('browser spellcheck still on');
});

await step('Ctrl+Alt+X opens the card; Accept fixes each issue in turn', async () => {
  await page.keyboard.press('Control+Alt+x');
  await card.waitFor();
  await card.getByText('1 of 3').waitFor();
  await card.getByText('Change').first().waitFor();
  if ((await card.getByTestId('spelling-suggestions').locator('button').first().innerText()) !== 'receive') throw new Error('first suggestion');
  for (let i = 0; i < 3; i++) {
    await card.getByRole('button', { name: 'Accept' }).click();
    await page.waitForTimeout(300);
  }
  await card.getByText('No spelling or grammar suggestions').waitFor({ timeout: 10000 });
  const text = await editor.locator('p').first().innerText();
  if (text !== 'We receive the report. It is done.') throw new Error(`text: ${text}`);
});

await step('clicking an underlined word opens it; Add to dictionary clears it everywhere', async () => {
  await card.getByRole('button', { name: 'Close spelling and grammar' }).click();
  await editor.locator('p').last().click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type(`Thanks from ${WORD} and ${WORD} team.`);
  await until(() => document.querySelectorAll('.mo-editor .mo-spell').length === 2);
  await editor.locator('.mo-spell').first().click();
  await card.waitFor();
  await card.getByText(WORD).first().waitFor();
  await card.getByRole('button', { name: 'Add to dictionary' }).click();
  await until(() => document.querySelectorAll('.mo-editor .mo-spell').length === 0);
  const words = await (await page.request.get(`${BASE}/api/spelling/dictionary`)).json();
  if (!words.includes(WORD)) throw new Error('not saved');
});

await step('Ignore hides a word for this session; Personal dictionary lists and removes words', async () => {
  await editor.locator('p').last().click();
  await page.keyboard.press('End');
  await page.keyboard.type(' Zorbly.');
  await until(() => document.querySelectorAll('.mo-editor .mo-spell').length === 1);
  await editor.locator('.mo-spell').click();
  await card.getByText('Zorbly').first().waitFor();
  await card.getByRole('button', { name: 'Ignore' }).click();
  await until(() => document.querySelectorAll('.mo-editor .mo-spell').length === 0);
  await card.getByRole('button', { name: 'Close spelling and grammar' }).click();
  await page.getByRole('button', { name: 'Tools', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Personal dictionary…' }).click();
  const list = page.getByTestId('dictionary-words');
  await list.getByText(WORD, { exact: true }).hover();
  await page.getByRole('button', { name: `Remove ${WORD}` }).click();
  await list.getByText(WORD, { exact: true }).waitFor({ state: 'detached' });
  await page.keyboard.press('Escape');
  // Removed from the dictionary → underlined again.
  await until(() => document.querySelectorAll('.mo-editor .mo-spell').length === 2);
});

await step('Tools → Show suggestions off removes the underlines', async () => {
  await page.getByRole('button', { name: 'Tools', exact: true }).click();
  await page.getByRole('menuitem', { name: /Show spelling and grammar suggestions/ }).click();
  await until(() => document.querySelectorAll('.mo-editor .mo-spell, .mo-editor .mo-grammar').length === 0);
  if ((await editor.getAttribute('spellcheck')) !== 'true') throw new Error('browser spellcheck not restored');
  await page.getByRole('button', { name: 'Tools', exact: true }).click();
  await page.getByRole('menuitem', { name: /Show spelling and grammar suggestions/ }).click();
});

await page.request.delete(`${BASE}/api/resources/${doc.id}`);
await page.request.delete(`${BASE}/api/spelling/dictionary`, { data: { words: [WORD] } });
console.log(errors.length ? `browser errors:\n  ${errors.join('\n  ')}` : 'no browser errors');
if (errors.length) fails++;
console.log(fails ? `${fails} failed` : 'all passed');
await browser.close();
process.exit(fails ? 1 : 0);
