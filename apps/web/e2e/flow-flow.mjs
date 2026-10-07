// Flow designer end-to-end (§77, batch 1): create from a template, drop shapes, connect, edit text and labels,
// style, move, delete / undo, pages, workflow info, live collaboration, prototype walk-through, present, export.
// node e2e/flow-flow.mjs   (needs the web app + API + seed)
import { chromium } from 'playwright';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = process.env.WEB_URL ?? 'http://localhost:3000';
const browser = await chromium.launch();
const errors = [];
let fails = 0;

async function session(email) {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 940 }, acceptDownloads: true });
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
    await page.screenshot({ path: join(tmpdir(), `mo-flow-fail-${name.replace(/\W+/g, '_')}.png`), timeout: 10000 }).catch(() => undefined);
  }
};

const claudia = await session('claudia@kaori.jp');
const node = (p, text) => p.locator(`[data-testid="flow-node"][data-text="${text}"]`);
const nodes = (p) => p.getByTestId('flow-node');
const edges = (p) => p.getByTestId('flow-edge');
let flowUrl = '';

await step('a new flow from the blank template opens in the designer', claudia, async () => {
  await claudia.goto(`${BASE}/flow`);
  await claudia.locator('[data-testid="flow-template"][data-template="blank"]').click({ timeout: 90000 });
  await claudia.waitForURL(/\/flow\/[0-9a-f-]{36}/);
  flowUrl = claudia.url();
  await node(claudia, 'First step').waitFor({ timeout: 90000 });
  if ((await nodes(claudia).count()) !== 3 || (await edges(claudia).count()) !== 2) throw new Error('blank flow');
});

await step('dragging a shape from the library onto the canvas', claudia, async () => {
  const canvas = claudia.getByTestId('flow-canvas');
  const box = await canvas.boundingBox();
  await claudia.locator('[data-testid="shape-tile"][data-shape="decision"]').dragTo(canvas, { targetPosition: { x: box.width / 2 + 260, y: box.height / 2 } });
  await node(claudia, 'Decision?').waitFor();
});

await step('connecting two shapes from a port', claudia, async () => {
  await node(claudia, 'First step').hover();
  const port = claudia.locator(`[data-testid="port"][data-side="right"]`).first();
  const target = await node(claudia, 'Decision?').boundingBox();
  const p = await port.boundingBox();
  await claudia.mouse.move(p.x + p.width / 2, p.y + p.height / 2);
  await claudia.mouse.down();
  await claudia.mouse.move(target.x + target.width / 2 - 20, target.y + target.height / 2, { steps: 8 });
  await claudia.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 4 });
  await claudia.mouse.up();
  await claudia.waitForFunction(() => document.querySelectorAll('[data-testid="flow-edge"]').length === 3);
});

await step('double-click edits the text of a shape', claudia, async () => {
  await node(claudia, 'Decision?').dblclick();
  await claudia.getByTestId('node-text-editor').fill('Approved?');
  await claudia.keyboard.press('Enter');
  await node(claudia, 'Approved?').waitFor();
});

await step('labelling a connector', claudia, async () => {
  const hits = claudia.getByTestId('edge-hit');
  await hits.nth(0).dblclick({ force: true });
  await claudia.getByTestId('edge-label-editor').fill('Ready');
  await claudia.keyboard.press('Enter');
  await claudia.getByTestId('edge-label').getByText('Ready').waitFor();
});

await step('styling from the inspector: palette and bold text', claudia, async () => {
  await node(claudia, 'Approved?').click();
  await claudia.getByLabel('Green colours').click();
  await claudia.waitForFunction(() => document.querySelector('[data-testid="flow-node"][data-text="Approved?"] path')?.getAttribute('fill') === '#ecfdf3');
  await claudia.getByTestId('inspector-text').click();
  await claudia.getByLabel('Bold').click();
  await claudia.getByTestId('inspector-style').click();
});

await step('moving a shape by dragging it', claudia, async () => {
  const before = await node(claudia, 'Approved?').getAttribute('transform');
  const b = await node(claudia, 'Approved?').boundingBox();
  await claudia.mouse.move(b.x + b.width / 2, b.y + 10);
  await claudia.mouse.down();
  await claudia.mouse.move(b.x + b.width / 2 + 60, b.y + 70, { steps: 6 });
  await claudia.mouse.up();
  await claudia.waitForFunction((t) => document.querySelector('[data-testid="flow-node"][data-text="Approved?"]')?.getAttribute('transform') !== t, before);
});

await step('delete, then undo', claudia, async () => {
  await node(claudia, 'Approved?').click();
  await claudia.keyboard.press('Delete');
  await node(claudia, 'Approved?').waitFor({ state: 'detached' });
  if ((await edges(claudia).count()) !== 2) throw new Error('its connector should go too');
  await claudia.keyboard.press('Control+z');
  await node(claudia, 'Approved?').waitFor();
});

await step('workflow info: status, trigger, tags', claudia, async () => {
  await claudia.getByTestId('flow-canvas').click({ position: { x: 30, y: 300 } });
  const info = claudia.getByTestId('workflow-info');
  await info.getByLabel('Status').selectOption('review');
  await info.getByLabel('Trigger').selectOption('Base record created');
  await info.getByLabel('Add tag').fill('Onboarding');
  await info.getByLabel('Add tag').press('Enter');
  await info.getByTestId('flow-tag').getByText('Onboarding').waitFor();
});

await step('another editor sees the changes and the pointer live', claudia, async () => {
  const id = flowUrl.split('/').pop();
  const users = await (await claudia.context().request.get(`${BASE}/api/users`)).json();
  await claudia.context().request.post(`${BASE}/api/resources/${id}/members`, { data: { userId: users.find((u) => u.email === 'mika@kaori.jp').id, role: 'editor' } });
  const mika = await session('mika@kaori.jp');
  await mika.goto(flowUrl);
  await node(mika, 'Approved?').waitFor({ timeout: 90000 });
  await mika.getByTestId('workflow-info').getByLabel('Status').waitFor();
  if ((await mika.getByTestId('workflow-info').getByLabel('Status').inputValue()) !== 'review') throw new Error('status not synced');
  await node(claudia, 'First step').dblclick();
  await claudia.getByTestId('node-text-editor').fill('Collect documents');
  await claudia.keyboard.press('Enter');
  await node(mika, 'Collect documents').waitFor({ timeout: 15000 });
  const cb = await mika.getByTestId('flow-canvas').boundingBox();
  await mika.mouse.move(cb.x + 80, cb.y + cb.height - 120);
  await mika.mouse.move(cb.x + 100, cb.y + cb.height - 100, { steps: 5 });
  await claudia.getByTestId('peer-cursor').first().waitFor({ timeout: 15000 });
  await mika.context().close();
});

await step('pages: add one and switch back', claudia, async () => {
  await claudia.getByTestId('add-page').click();
  await claudia.getByTestId('page-picker').getByText('Page 2').waitFor();
  if (await nodes(claudia).count()) throw new Error('page 2 should be empty');
  await claudia.getByTestId('page-picker').click();
  await claudia.getByRole('menuitem', { name: /Page 1/ }).click();
  await node(claudia, 'Collect documents').waitFor();
});

await step('prototype: walk from Start to End', claudia, async () => {
  await claudia.getByTestId('flow-tab-prototype').click();
  await claudia.getByTestId('prototype-step').getByText('Start').waitFor();
  for (let i = 0; i < 5 && !(await claudia.getByTestId('prototype-end').count()); i++) await claudia.getByTestId('prototype-next').first().click();
  await claudia.getByTestId('prototype-end').waitFor();
  await claudia.getByTestId('flow-tab-design').click();
});

await step('present and export', claudia, async () => {
  await claudia.getByTestId('flow-present').click();
  await claudia.getByTestId('flow-presenting').waitFor();
  await claudia.keyboard.press('Escape');
  await claudia.getByTestId('flow-presenting').waitFor({ state: 'detached' });
  await claudia.getByTestId('flow-export').click();
  const [svg] = await Promise.all([claudia.waitForEvent('download'), claudia.getByRole('menuitem', { name: /SVG image/ }).click()]);
  if (!svg.suggestedFilename().endsWith('.svg')) throw new Error(svg.suggestedFilename());
  await claudia.getByTestId('flow-export').click();
  const [png] = await Promise.all([claudia.waitForEvent('download'), claudia.getByRole('menuitem', { name: /PNG image/ }).click()]);
  if (!png.suggestedFilename().endsWith('.png')) throw new Error(png.suggestedFilename());
});

await browser.close();
if (errors.length) {
  console.log('page errors:\n' + errors.join('\n'));
  fails++;
}
console.log(fails ? `\n${fails} step(s) failed` : '\nall flow e2e steps passed');
process.exit(fails ? 1 : 0);
