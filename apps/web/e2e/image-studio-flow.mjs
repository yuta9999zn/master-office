// AI Image Studio end-to-end (§81), no model needed: in the AI workspace a picture made in ChatGPT is brought in (a
// new design in its own shape), then in Slides: AI → "Put new information into this design" with exact facts, File →
// Download as picture (PNG print 300 dpi, sizes listed), File → Resize to another format (keep whole → a square).
// node e2e/image-studio-flow.mjs   (needs the web app + API in dev mode + seed)
import { chromium } from 'playwright';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';

const BASE = process.env.WEB_URL ?? 'http://localhost:3000';
const API = process.env.API_URL ?? 'http://localhost:4000';
const browser = await chromium.launch();
const errors = [];
let fails = 0;
const ctx = await browser.newContext({ viewport: { width: 1500, height: 900 }, acceptDownloads: true });
const users = await (await ctx.request.get(`${BASE}/api/users`)).json();
const ken = users.find((u) => u.email === 'ken@kaori.jp').id;
await ctx.addCookies([{ name: 'mo_uid', value: ken, url: BASE }]);
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(e.message));
const step = async (name, fn) => {
  try {
    await fn();
    console.log('✓', name);
  } catch (e) {
    fails++;
    console.log('✗', name, '—', process.env.FULL ? e.message.slice(0, 1500) : e.message.split('\n')[0]);
    await page.screenshot({ path: join(tmpdir(), `mo-studio-fail-${name.replace(/\W+/g, '_')}.png`), timeout: 10000 }).catch(() => undefined);
  }
};
const created = [];

// A "ChatGPT" banner: 1512 × 793 with text on it.
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1512" height="793"><rect width="100%" height="100%" fill="#f6d5dc"/><circle cx="1200" cy="380" r="260" fill="#e8a0b0"/><text x="90" y="300" font-size="90" font-family="Arial" font-weight="bold" fill="#5a2d1a">KHUYẾN MÃI</text><text x="90" y="420" font-size="80" font-family="Arial" fill="#c0506a">GIẢM 30% ĐẾN 31/10</text></svg>`;
const picture = join(tmpdir(), `mo-chatgpt-banner-${Date.now()}.png`);
await sharp(Buffer.from(svg)).png().toFile(picture);
let deckId = '';

await step('AI workspace: bring in a picture from ChatGPT → a new design in its own shape', async () => {
  await page.goto(`${BASE}/ai`);
  await page.getByTestId('ai-workspace').waitFor({ timeout: 90000 });
  await page.locator('[data-testid="ai-task"][data-key="image.editable"]').click();
  // Making the text editable needs a vision model; the import itself does not — catch the new design from the upload.
  const [res] = await Promise.all([page.waitForResponse((r) => r.url().endsWith('/ai/pictures/import') && r.request().method() === 'POST'), page.locator('input[type=file]').setInputFiles(picture)]);
  const body = await res.json();
  if (res.status() !== 201 || body.size?.w !== 1200 || body.size?.h !== 628) throw new Error(`import ${res.status()} ${JSON.stringify(body).slice(0, 200)}`);
  deckId = body.resourceId;
  created.push(deckId);
  // Stop the "make editable" run (it would wait for the vision model) and give the slide a text layer to change.
  const jobs = await (await fetch(`${API}/ai/jobs`, { headers: { 'x-user-id': ken } })).json();
  const run = jobs.find((j) => j.promptKey === 'image.editable' && ['queued', 'running'].includes(j.status));
  if (run) await fetch(`${API}/ai/jobs/${run.id}/cancel`, { method: 'POST', headers: { 'x-user-id': ken } });
});

await step('Slides: the picture is the background; a text layer is added over it', async () => {
  await page.goto(`${BASE}/slides/${deckId}`);
  await page.locator('[data-testid="slide-thumb"]').first().waitFor({ timeout: 90000 });
  await page.getByRole('button', { name: 'Text box', exact: true }).click();
  await page.keyboard.type('Giảm 30% đến 31/10 — gọi 0901 234 567');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1500);
});

await step('AI → Put new information into this design: facts swapped exactly', async () => {
  await page.getByTestId('ai-button').click();
  await page.locator('[data-testid="ai-action"][data-action="slide-retext"]').click();
  await page.getByTestId('ai-request').fill('Giảm 40% đến 30/11, hotline 0909 888 999');
  await page.getByTestId('ai-run').click();
  await page.locator('[data-testid="ai-job"][data-status="done"]').waitFor({ timeout: 60000 });
  const changes = await page.getByTestId('ai-changes').innerText();
  if (!changes.includes('Giảm 40% đến 30/11 — gọi 0909 888 999')) throw new Error(changes);
  await page.keyboard.press('Escape');
  await page.locator('[data-testid="slide-canvas"]').getByText('Giảm 40% đến 30/11').waitFor({ timeout: 15000 });
});

await step('File → Download as picture: sizes listed, PNG at print 300 dpi', async () => {
  await page.getByRole('button', { name: 'File', exact: true }).click();
  await page.getByRole('menuitem', { name: /Download as picture/ }).click();
  const dialog = page.getByTestId('picture-download-dialog');
  await dialog.waitFor();
  for (const t of ['1200 × 628 px', '2400 × 1256 px', '3750 × 1963 px · 318 × 166 mm']) await dialog.getByText(t).waitFor();
  await dialog.locator('label', { hasText: 'Print · 300 dpi' }).click();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('picture-download').click()]);
  const file = join(tmpdir(), dl.suggestedFilename());
  await dl.saveAs(file);
  const m = await sharp(file).metadata();
  if (m.width !== 3750 || m.height !== 1963 || m.density !== 300 || !file.endsWith('@300dpi.png')) throw new Error(`${file} ${m.width}×${m.height} @${m.density}`);
});

await step('File → Resize to another format: kept whole as a square post', async () => {
  await page.getByRole('button', { name: 'File', exact: true }).click();
  await page.getByRole('menuitem', { name: /Resize to another format/ }).click();
  await page.getByTestId('resize-dialog').waitFor();
  if ((await page.locator('[data-testid="resize-mode"][data-mode="fit"]').getAttribute('aria-checked')) !== 'true') throw new Error('a picture design should default to “keep whole”');
  await page.locator('[data-testid="resize-format"][data-format="banner-square"]').click();
  await page.waitForURL((u) => !u.pathname.endsWith(deckId), { timeout: 60000 });
  created.push(page.url().split('/').pop());
  await page.getByText(/Square post 1080 × 1080/).first().waitFor({ timeout: 60000 });
  await page.locator('[data-testid="slide-canvas"]').getByText('Giảm 40% đến 30/11').waitFor({ timeout: 30000 });
});

for (const id of created.filter(Boolean)) {
  await fetch(`${API}/resources/${id}/trash`, { method: 'POST', headers: { 'x-user-id': ken } });
  await fetch(`${API}/resources/${id}`, { method: 'DELETE', headers: { 'x-user-id': ken } });
}
await browser.close();
if (errors.length) console.log('page errors:', errors);
console.log(fails ? `\n${fails} failed` : '\nall image studio e2e steps passed');
process.exit(fails || errors.length ? 1 : 0);
