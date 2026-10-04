// Slides 4.2 end-to-end: shape sets, Arrange ▸ Rotate, Line ▸ Curve / Polyline / Scribble, PPTX export of both.
// node e2e/slides-draw-flow.mjs   (needs pnpm dev + API)
import { chromium } from 'playwright';
import JSZip from 'jszip';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = process.env.WEB_URL ?? 'http://localhost:3000';
const browser = await chromium.launch();
const errors = [];
let fails = 0;

const ctx = await browser.newContext({ viewport: { width: 1600, height: 940 } });
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
    await page.screenshot({ path: join(tmpdir(), `mo-slides-draw-fail-${name.replace(/\W+/g, '_')}.png`) });
  }
};
const until = (fn, arg, timeout = 15000) => page.waitForFunction(fn, arg, { timeout, polling: 200 });
const hits = () => page.locator('[data-testid="slide-canvas"] [data-hit]').count();
const canvasBox = async () => page.getByTestId('slide-canvas').boundingBox();
const menu = async (top, item) => {
  await page.getByRole('button', { name: top, exact: true }).click();
  await page.getByRole('menuitem', { name: item }).click();
};

const deck = await (await page.request.post(`${BASE}/api/resources`, { data: { name: `Draw test ${Date.now()}`, type: 'presentation' } })).json();

await step('the shape picker has arrows, callouts and equation shapes', async () => {
  await page.goto(`${BASE}/slides/${deck.id}`);
  await page.getByTestId('slide-canvas').waitFor({ timeout: 60000 });
  const before = await hits();
  await page.getByRole('button', { name: 'Shape', exact: true }).click();
  for (const label of ['Up arrow', 'Rectangular callout', 'Plus', 'Not equal', 'Heart']) await page.getByRole('menuitem', { name: label, exact: true }).waitFor();
  await page.getByRole('menuitem', { name: 'Heart', exact: true }).click();
  await until((n) => document.querySelectorAll('[data-testid="slide-canvas"] [data-hit]').length === n + 1, before);
});

await step('Arrange → Rotate turns the selection by quarter turns', async () => {
  await menu('Arrange', 'Rotate clockwise 90°');
  await until(() => [...document.querySelectorAll('[data-testid="slide-canvas"] [data-hit]')].some((h) => h.style.transform === 'rotate(90deg)'));
  await menu('Arrange', 'Rotate counter-clockwise 90°');
  await menu('Arrange', 'Rotate counter-clockwise 90°');
  await until(() => [...document.querySelectorAll('[data-testid="slide-canvas"] [data-hit]')].some((h) => h.style.transform === 'rotate(270deg)'));
});

await step('Line → Scribble draws a smooth freehand line', async () => {
  const before = await hits();
  await page.getByRole('button', { name: 'Line', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Scribble' }).click();
  await page.getByTestId('draw-layer').waitFor();
  const b = await canvasBox();
  await page.mouse.move(b.x + b.width * 0.1, b.y + b.height * 0.7);
  await page.mouse.down();
  for (let i = 1; i <= 30; i++) await page.mouse.move(b.x + b.width * (0.1 + i * 0.01), b.y + b.height * (0.7 + Math.sin(i / 4) * 0.08), { steps: 2 });
  await page.mouse.up();
  await until((n) => document.querySelectorAll('[data-testid="slide-canvas"] [data-hit]').length === n + 1, before);
  if (await page.getByTestId('draw-layer').count()) throw new Error('still drawing');
});

await step('Line → Polyline: clicking the first point closes a filled shape; Curve finishes on double-click', async () => {
  const before = await hits();
  const b = await canvasBox();
  const P = (x, y) => [b.x + b.width * x, b.y + b.height * y];
  await page.getByRole('button', { name: 'Line', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Polyline' }).click();
  for (const [x, y] of [P(0.55, 0.2), P(0.75, 0.25), P(0.7, 0.45), P(0.55, 0.2)]) await page.mouse.click(x, y);
  await until((n) => document.querySelectorAll('[data-testid="slide-canvas"] [data-hit]').length === n + 1, before);
  await page.getByRole('button', { name: 'Line', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Curve' }).click();
  for (const [x, y] of [P(0.2, 0.2), P(0.3, 0.35), P(0.4, 0.2)]) await page.mouse.click(x, y);
  await page.mouse.dblclick(...P(0.45, 0.35));
  await until((n) => document.querySelectorAll('[data-testid="slide-canvas"] [data-hit]').length === n + 2, before);
  // Esc cancels a drawing in progress.
  await page.getByRole('button', { name: 'Line', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Polyline' }).click();
  await page.mouse.click(...P(0.8, 0.8));
  await page.keyboard.press('Escape');
  await page.getByTestId('draw-layer').waitFor({ state: 'detached' });
  if ((await hits()) !== before + 2) throw new Error('Esc added an element');
});

await step('PowerPoint export keeps presets, rotation and freeforms (custom geometry)', async () => {
  await page.waitForTimeout(2500); // debounced store
  const res = await page.request.get(`${BASE}/api/resources/${deck.id}/export?format=pptx`);
  if (!res.ok()) throw new Error(`export ${res.status()}`);
  const zip = await JSZip.loadAsync(await res.body());
  const xml = await zip.file('ppt/slides/slide1.xml').async('string');
  for (const want of ['prst="heart"', 'rot="16200000"', '<a:custGeom>', '<a:cubicBezTo>']) if (!xml.includes(want)) throw new Error(`missing ${want}`);
  if (!/<a:close ?\/>/.test(xml)) throw new Error('missing a closed path');
});

await page.request.delete(`${BASE}/api/resources/${deck.id}`);
await browser.close();
console.log(errors.length ? `browser errors:\n  ${errors.join('\n  ')}` : 'no browser errors');
if (errors.length) fails++;
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
