// AI end-to-end (§80): the AI button in the top bar (and Ctrl+J), the panel knowing the open file, a business card
// generated from the panel and opened, the prompt library (edit a built-in for the organisation, reset it, add one's
// own), the model & settings page, and Docs: the old in-app AI tab now opens the same panel.
// node e2e/ai-flow.mjs   (web + API in dev mode + seed + Ollama with a model)
import { chromium } from 'playwright';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = process.env.WEB_URL ?? 'http://localhost:3000';
const API = process.env.API_URL ?? 'http://localhost:4000';
const browser = await chromium.launch();
const errors = [];
let fails = 0;
let users = [];

async function session(email) {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 940 } });
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
    await page.screenshot({ path: join(tmpdir(), `mo-ai-fail-${name.replace(/\W+/g, '_')}.png`), timeout: 10000 }).catch(() => undefined);
  }
};
const claudia = await session('claudia@hanami.example');
const claudiaId = users.find((u) => u.email === 'claudia@hanami.example').id;
let cardUrl = '';

await step('the AI button opens the assistant beside the app, with the local model', claudia, async () => {
  await claudia.goto(`${BASE}/home`);
  await claudia.getByTestId('ai-button').click();
  await claudia.getByTestId('ai-panel').waitFor({ timeout: 60000 });
  await claudia.locator('[data-testid="ai-model"]', { hasText: 'local' }).waitFor({ timeout: 30000 });
  if (!(await claudia.getByTestId('ai-context').innerText()).includes('Not in a file')) throw new Error('context');
  await claudia.keyboard.press('Control+j');
  await claudia.getByTestId('ai-panel').waitFor({ state: 'detached' });
  await claudia.keyboard.press('Control+j');
  await claudia.getByTestId('ai-panel').waitFor();
});

await step('a business card from the panel: progress, then Open', claudia, async () => {
  await claudia.locator('[data-testid="ai-action"][data-action="card"]').click();
  await claudia.getByTestId('ai-format').waitFor();
  await claudia.getByTestId('ai-request').fill('Card visit cho Lê Thu Hà, Kế toán trưởng, Hanami Office, 0987 111 222, ha@hanami.example, hanami.example, màu xanh dương');
  await claudia.getByTestId('ai-run').click();
  await claudia.locator('[data-testid="ai-job"]').waitFor();
  await claudia.locator('[data-testid="ai-job"][data-status="done"]').waitFor({ timeout: 300000 });
  await claudia.getByTestId('ai-open').click();
  await claudia.waitForURL(/\/slides\/[0-9a-f-]{36}/, { timeout: 60000 });
  cardUrl = claudia.url();
  await claudia.locator('[data-testid="slide-thumb"]').nth(1).waitFor({ timeout: 90000 });
  if (!((await claudia.locator('[data-testid="slide-canvas"]').textContent()) ?? '').match(/HANAMI|Hanami|LTH|KO/)) throw new Error('brand side');
});

await step('inside a file the panel offers to work on it', claudia, async () => {
  if (!(await claudia.getByTestId('ai-context').innerText()).includes('Slides')) throw new Error(await claudia.getByTestId('ai-context').innerText());
  await claudia.locator('[data-testid="ai-action"][data-action="deck-slides"]').waitFor();
});

await step('the prompt library: tune a built-in prompt, then reset it', claudia, async () => {
  await claudia.goto(`${BASE}/ai?tab=prompts`);
  await claudia.getByTestId('ai-library').waitFor({ timeout: 60000 });
  await claudia.locator('[data-testid="prompt-row"][data-key="general.ask"]').click();
  await claudia.waitForFunction(() => document.querySelector('[aria-label="Prompt name"]')?.value === 'Ask anything', null, { timeout: 15000 });
  const sys = claudia.getByTestId('prompt-system');
  await sys.fill(`${await sys.inputValue()}\nAlways answer in under 50 words.`);
  await claudia.getByTestId('prompt-save').click();
  await claudia.locator('[data-testid="prompt-row"][data-key="general.ask"]', { hasText: 'edited' }).waitFor({ timeout: 15000 });
  await claudia.getByTestId('prompt-reset').click();
  await claudia.locator('[data-testid="prompt-row"][data-key="general.ask"]', { hasText: 'edited' }).waitFor({ state: 'detached', timeout: 15000 });
});

await step('… and add a prompt of one’s own', claudia, async () => {
  await claudia.getByTestId('prompt-new').click();
  await claudia.getByLabel('Prompt name').fill('Slogans e2e');
  await claudia.getByTestId('prompt-save').click();
  await claudia.locator('[data-testid="prompt-row"]', { hasText: 'Slogans e2e' }).waitFor({ timeout: 15000 });
  await claudia.getByTestId('prompt-delete').click();
  await claudia.locator('[data-testid="prompt-row"]', { hasText: 'Slogans e2e' }).waitFor({ state: 'detached', timeout: 15000 });
});

await step('model & settings: the models of the server', claudia, async () => {
  await claudia.getByTestId('ai-tab-settings').click();
  await claudia.locator('[data-testid="ai-model-row"]').first().waitFor({ timeout: 60000 });
  await claudia.getByTestId('ai-settings-save').waitFor();
});

await step('Docs: the AI Assistant menu opens the same panel, which can write into the document', claudia, async () => {
  const doc = await (await fetch(`${API}/resources`, { method: 'POST', headers: { 'x-user-id': claudiaId, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'AI e2e doc', type: 'document' }) })).json();
  await claudia.goto(`${BASE}/docs/${doc.id}`);
  await claudia.locator('.mo-editor').first().waitFor({ timeout: 90000 });
  await claudia.getByTestId('ai-button').click();
  await claudia.getByTestId('ai-panel').waitFor();
  if (!(await claudia.getByTestId('ai-context').innerText()).includes('Docs')) throw new Error('doc context');
  await claudia.locator('[data-testid="ai-action"][data-action="draft"]').waitFor();
  await claudia.locator('[data-testid="ai-action"][data-action="summary"]').waitFor();
  await fetch(`${API}/resources/${doc.id}/trash`, { method: 'POST', headers: { 'x-user-id': claudiaId } });
});

if (cardUrl) {
  const id = cardUrl.split('/').pop();
  await fetch(`${API}/resources/${id}/trash`, { method: 'POST', headers: { 'x-user-id': claudiaId } });
}
await browser.close();
if (errors.length) console.log('page errors:', errors);
console.log(fails ? `\n${fails} failed` : '\nall AI e2e steps passed');
process.exit(fails || errors.length ? 1 : 0);
