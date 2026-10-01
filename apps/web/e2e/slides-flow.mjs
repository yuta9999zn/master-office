// Phase 4 end-to-end: Slides editor with two people, formatting, notes, themes, charts, presenting, export.
// node e2e/slides-flow.mjs   (needs pnpm dev + API + seeded data)
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
  page.on('console', (m) => m.type() === 'error' && /Cannot update a component|Maximum update depth|is not a function/.test(m.text()) && errors.push(`${email}: ${m.text().slice(0, 200)}`));
  return page;
}
const step = async (name, page, fn) => {
  try {
    await fn();
    console.log('✓', name);
  } catch (e) {
    fails++;
    console.log('✗', name, '—', e.message.split('\n')[0]);
    await page.screenshot({ path: join(tmpdir(), `mo-slides-fail-${name.replace(/\W+/g, '_')}.png`) });
  }
};
const until = async (page, fn, arg, timeout = 15000) => page.waitForFunction(fn, arg, { timeout, polling: 200 });
const counter = (page) => page.getByTestId('slide-counter').innerText();
const canvasText = (page) => page.getByTestId('slide-canvas').innerText();

const claudia = await session('claudia@kaori.jp');
const mika = await session('mika@kaori.jp');
const find = async (page, q) => (await (await page.request.get(`${BASE}/api/search?q=${encodeURIComponent(q)}`)).json()).find((h) => h.kind === 'resource');
const deck = await find(claudia, 'Q4 Marketing Strategy - October 2026');

await step('open the seeded deck: thumbnails, canvas, status bar, panels', claudia, async () => {
  await claudia.goto(`${BASE}/slides/${deck.id}`);
  await until(claudia, () => document.querySelectorAll('[data-testid="slide-thumb"]').length === 6, null, 60000);
  if (!(await canvasText(claudia)).includes('Q4 Campaign')) throw new Error('title slide not rendered');
  if ((await counter(claudia)) !== 'Slide 1 of 6') throw new Error(await counter(claudia));
  for (const t of ['Design', 'Layout', 'Theme', 'Comments']) await claudia.getByTestId('slides-panel').getByRole('button', { name: t, exact: true }).waitFor();
  await claudia.getByText('Color scheme').waitFor();
  if (!(await claudia.locator('[data-testid="slide-canvas"] svg rect').count())) throw new Error('chart not drawn');
});

await step('second editor opens the same deck', mika, async () => {
  await mika.goto(`${BASE}/slides/${deck.id}`);
  await until(mika, () => document.querySelectorAll('[data-testid="slide-thumb"]').length === 6, null, 60000);
});

await step('new slide + typing into the title placeholder appears live for the other editor', claudia, async () => {
  await claudia.getByTestId('new-slide').click();
  await until(claudia, () => document.querySelector('[data-testid="slide-counter"]')?.textContent === 'Slide 2 of 7');
  await claudia.locator('[data-hit]').first().dblclick();
  const ed = claudia.getByTestId('slide-text-editor');
  await ed.waitFor();
  await claudia.keyboard.type('Hello from Claudia');
  await claudia.keyboard.press('Escape');
  await until(mika, () => document.querySelectorAll('[data-testid="slide-thumb"]').length === 7);
  await mika.locator('[data-testid="slide-thumb"]').nth(1).click();
  await until(mika, () => document.querySelector('[data-testid="slide-canvas"]')?.textContent.includes('Hello from Claudia'));
});

await step('insert a shape, drag it, and the other editor sees the move', claudia, async () => {
  await claudia.getByRole('button', { name: 'Shape', exact: true }).click();
  await claudia.getByRole('menuitem', { name: 'Rounded rectangle' }).click();
  await claudia.getByTestId('selection-box').waitFor();
  const hit = claudia.locator('[data-hit]').last();
  const box = await hit.boundingBox();
  await claudia.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await claudia.mouse.down();
  await claudia.mouse.move(box.x + box.width / 2 - 150, box.y + box.height / 2 + 60, { steps: 8 });
  await claudia.mouse.up();
  const after = await hit.boundingBox();
  if (Math.abs(after.x - (box.x - 150)) > 8) throw new Error(`moved to ${after.x}, expected ~${box.x - 150}`);
  await until(mika, () => document.querySelectorAll('[data-testid="slide-canvas"] path').length >= 1);
  const mikaLeft = await mika.evaluate(() => [...document.querySelectorAll('[data-hit]')].pop()?.style.left);
  const claudiaLeft = await claudia.evaluate(() => [...document.querySelectorAll('[data-hit]')].pop()?.style.left);
  if (mikaLeft !== claudiaLeft) throw new Error(`mika ${mikaLeft} vs claudia ${claudiaLeft}`);
});

await step('remote selection is shown with the editor’s name', mika, async () => {
  await mika.getByText('Claudia Chen', { exact: true }).first().waitFor();
});

await step('undo removes the move, then the shape (Ctrl+Z)', claudia, async () => {
  const n = await claudia.locator('[data-hit]').count();
  await claudia.getByTestId('slide-viewport').click({ position: { x: 20, y: 20 } });
  await claudia.keyboard.press('Control+z');
  await claudia.keyboard.press('Control+z');
  await until(claudia, (k) => document.querySelectorAll('[data-hit]').length === k - 1, n);
});

await step('bold on a selected text box formats the whole box', claudia, async () => {
  await claudia.locator('[data-hit]').first().click();
  await claudia.getByRole('button', { name: 'Bold (Ctrl+B)' }).click();
  await until(claudia, () => !!document.querySelector('[data-testid="slide-canvas"] .mo-box[style*="font-weight:700"], [data-testid="slide-canvas"] .mo-box[style*="font-weight: 700"]') || !document.querySelector('[data-testid="slide-canvas"] .mo-box'));
});

await step('speaker notes sync to the other editor', claudia, async () => {
  await claudia.getByTestId('speaker-notes').fill('Talk about the launch');
  await until(mika, () => document.querySelector('[data-testid="speaker-notes"]')?.value === 'Talk about the launch');
});

await step('theme change restyles the deck for everyone', claudia, async () => {
  await claudia.getByTestId('slides-panel').getByRole('button', { name: 'Theme', exact: true }).click();
  await claudia.getByTestId('theme-midnight').click();
  await until(mika, () => document.querySelector('[data-testid="slide-canvas"] .mo-slide')?.getAttribute('style')?.includes('#0F172A'));
  await claudia.getByTestId('theme-natural-beauty').click();
});

await step('insert a chart and edit its data in the Format panel', claudia, async () => {
  await claudia.getByRole('button', { name: 'Chart', exact: true }).click();
  await claudia.getByRole('menuitem', { name: 'pie' }).click();
  await claudia.getByTestId('chart-data').waitFor();
  const cell = claudia.getByLabel('Share Social');
  await cell.fill('90');
  await cell.blur();
  await until(claudia, () => [...document.querySelectorAll('[data-testid="slide-canvas"] text')].some((t) => t.textContent === '72%'));
});

await step('present: full-screen show, keyboard navigation, end with Esc', claudia, async () => {
  await claudia.getByTestId('slides-toolbar').getByRole('button', { name: 'Present', exact: true }).click();
  await claudia.getByTestId('presenter').waitFor();
  await until(claudia, () => document.querySelector('[data-testid="presenter-counter"]')?.textContent.trim().startsWith('1 /'));
  await claudia.keyboard.press('ArrowRight');
  await until(claudia, () => document.querySelector('[data-testid="presenter-counter"]')?.textContent.trim().startsWith('2 /'));
  await claudia.keyboard.press('Escape');
  await claudia.getByTestId('slides-workspace').waitFor();
});

await step('slide sorter shows every slide', claudia, async () => {
  await claudia.getByRole('button', { name: 'Slide sorter' }).click();
  await until(claudia, () => document.querySelectorAll('[data-testid="slide-sorter"] .mo-slide').length === 7);
  await claudia.getByRole('button', { name: 'Normal view' }).click();
});

await step('download as PowerPoint from the File menu', claudia, async () => {
  await claudia.getByRole('button', { name: 'File', exact: true }).click();
  const [dl] = await Promise.all([claudia.waitForEvent('download'), claudia.getByRole('menuitem', { name: /PowerPoint/ }).click()]);
  if (!dl.suggestedFilename().endsWith('.pptx')) throw new Error(dl.suggestedFilename());
});

await step('a viewer gets a read-only deck', claudia, async () => {
  const sora = await session('sora@kaori.jp');
  await sora.goto(`${BASE}/slides/${deck.id}`);
  await until(sora, () => document.querySelectorAll('[data-testid="slide-thumb"]').length === 7, null, 60000);
  await sora.getByText('View only').waitFor();
  if (await sora.getByTestId('new-slide').isEnabled()) throw new Error('viewer can add slides');
  await sora.context().close();
});

await step('deleting the added slide syncs (cleanup)', claudia, async () => {
  await claudia.locator('[data-testid="slide-thumb"]').nth(1).click({ button: 'right' });
  await claudia.getByRole('menuitem', { name: 'Delete slide' }).click();
  await until(mika, () => document.querySelectorAll('[data-testid="slide-thumb"]').length === 6);
});

await browser.close();
if (errors.length) {
  console.log('page errors:\n' + errors.join('\n'));
  fails++;
}
console.log(fails ? `\n${fails} step(s) failed` : '\nall slides e2e steps passed');
process.exit(fails ? 1 : 0);
