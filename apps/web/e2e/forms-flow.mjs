// Phase 8 end-to-end: Forms — building together, responding (validation, sections, branching), live responses.
// node e2e/forms-flow.mjs   (needs pnpm dev + API + seeded data)
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
    await page.screenshot({ path: join(tmpdir(), `mo-forms-fail-${name.replace(/\W+/g, '_')}.png`) });
  }
};
const until = async (page, fn, arg, timeout = 15000) => page.waitForFunction(fn, arg, { timeout, polling: 200 });

const mika = await session('mika@kaori.jp');
const claudia = await session('claudia@kaori.jp');
// Exact title: other suites may have made copies ("… (Copy)").
const find = async (page, q) => (await (await page.request.get(`${BASE}/api/search?q=${encodeURIComponent(q)}`)).json()).find((h) => h.kind === 'resource' && h.title === q);
const survey = await find(mika, 'Customer Satisfaction Survey');

await step('open the seeded survey: header, questions, tabs, toolbar', mika, async () => {
  await mika.goto(`${BASE}/forms/${survey.id}`);
  await mika.getByTestId('form-title').waitFor({ timeout: 60000 });
  await until(mika, () => document.querySelectorAll('[data-testid="form-item"]').length === 8);
  for (const t of ['questions', 'responses', 'settings']) await mika.getByTestId(`tab-${t}`).waitFor();
  await mika.getByTestId('form-toolbar').waitFor();
});

await step('a second editor sees edits live (title + new question)', claudia, async () => {
  await claudia.goto(`${BASE}/forms/${survey.id}`);
  await claudia.getByTestId('form-title').waitFor({ timeout: 60000 });
  await mika.getByTestId('form-title').fill('Customer Satisfaction Survey 2026');
  await until(claudia, () => document.querySelector('[data-testid="form-title"]')?.value === 'Customer Satisfaction Survey 2026');
  await mika.locator('[data-testid="form-item"]').first().click();
  await mika.getByRole('button', { name: 'Add question' }).click();
  await until(claudia, () => document.querySelectorAll('[data-testid="form-item"]').length === 9);
});

await step('edit the new question: title, type, options, required', mika, async () => {
  await mika.getByLabel('Question', { exact: true }).fill('Favourite product line');
  await mika.getByTestId('question-type').click();
  await mika.getByRole('menuitem', { name: 'Dropdown' }).click();
  await mika.getByTestId('add-option').click();
  await mika.getByLabel('Option 2', { exact: true }).fill('Hydra');
  await mika.getByLabel('Option 1', { exact: true }).fill('Pure');
  await mika.getByTestId('required-toggle').click();
  await until(claudia, () => document.body.innerText.includes('Favourite product line'));
});

let respondent;
let before = 0;
await step('respond: required errors are shown, then the form submits', mika, async () => {
  before = (await (await mika.request.get(`${BASE}/api/forms/${survey.id}/responses`)).json()).length;
  respondent = await session('ken@kaori.jp');
  await respondent.goto(`${BASE}/f/${survey.id}`);
  await respondent.getByTestId('respond-title').waitFor({ timeout: 60000 });
  // The first page leads to a section, so the button is Next (as in Google Forms).
  await respondent.getByTestId('form-next').click();
  await until(respondent, () => document.body.innerText.includes('This is a required question'));
  await respondent.getByLabel('Branch 625').check();
  await respondent.getByLabel('Facial').check();
  await respondent.getByRole('button', { name: '4 of 5' }).click();
  await respondent.getByRole('radiogroup', { name: 'How likely are you to recommend us to a friend?' }).getByRole('radio').nth(9).check();
  await respondent.getByLabel('Favourite product line').selectOption('Hydra');
  await respondent.getByRole('radiogroup', { name: 'Would you come back?' }).getByLabel('No').check();
  // "No" branches to the "Help us do better" section: Next instead of Submit.
  await respondent.getByTestId('form-next').click();
  await respondent.getByText('Help us do better').waitFor();
  await respondent.getByLabel('What should we improve?').fill('More parking please');
  await respondent.getByTestId('form-submit').click();
  await respondent.getByTestId('form-confirmation').waitFor();
});

await step('the response appears live in the Responses tab with the summary', mika, async () => {
  await mika.getByTestId('tab-responses').click();
  // Other suites may have answered this form too: expect exactly one more than before.
  await until(mika, (n) => new RegExp(`^${n} responses?$`).test(document.querySelector('[data-testid="response-count"]')?.textContent ?? ''), before + 1);
  await mika.getByText('More parking please').waitFor();
});

await step('quiz mode from Settings, then the question gets points', mika, async () => {
  await mika.getByTestId('tab-settings').click();
  await mika.getByRole('switch', { name: 'Make this a quiz' }).click();
  await mika.getByTestId('tab-questions').click();
  // The new question is still selected, so its quiz controls are already showing.
  await mika.getByLabel('Points').fill('2');
  await until(claudia, () => document.body.innerText.includes('(2 pt)'));
});

await step('closing the form shows the closed message to respondents', mika, async () => {
  await mika.getByTestId('tab-responses').click();
  await mika.getByTestId('accepting-toggle').click();
  await respondent.goto(`${BASE}/f/${survey.id}`);
  await respondent.getByTestId('form-closed').waitFor();
  await mika.getByTestId('accepting-toggle').click();
});

await step('the Send dialog gives the responder link', mika, async () => {
  await mika.getByTestId('form-send').click();
  const link = await mika.getByTestId('respond-link').inputValue();
  if (!link.endsWith(`/f/${survey.id}`)) throw new Error(link);
  await mika.keyboard.press('Escape');
});

await step('a viewer cannot edit the form', claudia, async () => {
  const sora = await session('sora@kaori.jp');
  await sora.goto(`${BASE}/forms/${survey.id}`);
  await sora.getByTestId('form-title').waitFor({ timeout: 60000 });
  if (await sora.getByTestId('form-title').isEnabled()) throw new Error('viewer can edit the title');
  if (await sora.getByTestId('form-toolbar').count()) throw new Error('viewer sees the add toolbar');
  await sora.context().close();
});

await browser.close();
if (errors.length) {
  console.log('page errors:\n' + errors.join('\n'));
  fails++;
}
console.log(fails ? `\n${fails} step(s) failed` : '\nall forms e2e steps passed');
process.exit(fails ? 1 : 0);
