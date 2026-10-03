// Phase 4.1 end-to-end: group / ungroup and object animations (motion panel + slide show), two editors.
// node e2e/slides-motion-flow.mjs   (needs pnpm dev + API + seeded data)
import { chromium } from 'playwright';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = process.env.WEB_URL ?? 'http://localhost:3000';
const browser = await chromium.launch();
const errors = [];
let fails = 0;

async function session(email) {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 940 } });
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
    await page.screenshot({ path: join(tmpdir(), `mo-motion-fail-${name.replace(/\W+/g, '_')}.png`) });
  }
};
const until = async (page, fn, arg, timeout = 15000) => page.waitForFunction(fn, arg, { timeout, polling: 200 });
/** Elements of the current (first) slide from the editor's store. */
const els = (page) => page.evaluate(() => window.__moDeck.snapshot.slides[0].elements.map((e) => ({ id: e.id, type: e.type, x: e.x, y: e.y, w: e.w, h: e.h, group: e.group ?? null, anim: e.anim ?? null })));

const claudia = await session('claudia@kaori.jp');
const mika = await session('mika@kaori.jp');
const users = await (await claudia.request.get(`${BASE}/api/users`)).json();
const created = await (await claudia.request.post(`${BASE}/api/resources`, { data: { name: `Motion ${Date.now()}`, type: 'presentation' } })).json();
await claudia.request.post(`${BASE}/api/resources/${created.id}/members`, { data: { userId: users.find((u) => u.email === 'mika@kaori.jp').id, role: 'editor' } });
for (const p of [claudia, mika]) {
  await p.goto(`${BASE}/slides/${created.id}`);
  await until(p, () => document.querySelectorAll('[data-testid="slide-thumb"]').length === 1 && !!window.__moDeck, null, 60000);
}

let a;
let b;
const hitOf = (page, id) => page.locator(`[data-hit="${id}"]`);
const center = async (page, id) => {
  const box = await hitOf(page, id).boundingBox();
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};

await step('two shapes are grouped (Ctrl+Alt+G) and the other editor gets the group', claudia, async () => {
  for (let i = 0; i < 2; i++) {
    await claudia.getByRole('button', { name: 'Shape', exact: true }).click();
    await claudia.getByRole('menuitem', { name: 'Rounded rectangle' }).click();
  }
  const shapes = (await els(claudia)).filter((e) => e.type === 'shape');
  [a, b] = shapes.map((s) => s.id);
  await claudia.evaluate(([id]) => window.__moDeck.updateElements(window.__moDeck.snapshot.slides[0].id, [{ id, patch: { x: 100, y: 420 } }]), [a]);
  await claudia.evaluate(([id]) => window.__moDeck.updateElements(window.__moDeck.snapshot.slides[0].id, [{ id, patch: { x: 700, y: 420 } }]), [b]);
  const pa = await center(claudia, a);
  const pb = await center(claudia, b);
  await claudia.mouse.click(pa.x, pa.y);
  await claudia.keyboard.down('Shift');
  await claudia.mouse.click(pb.x, pb.y);
  await claudia.keyboard.up('Shift');
  await claudia.keyboard.press('Control+Alt+g');
  await claudia.getByTestId('group-box').waitFor();
  await until(mika, ([x, y]) => {
    const e = window.__moDeck.snapshot.slides[0].elements;
    const g = e.find((el) => el.id === x)?.group;
    return !!g && e.find((el) => el.id === y)?.group === g;
  }, [a, b]);
});

await step('clicking a member selects the group; its handles scale every member', claudia, async () => {
  await claudia.keyboard.press('Escape');
  const pa = await center(claudia, a);
  await claudia.mouse.click(pa.x, pa.y);
  await claudia.getByTestId('group-box').waitFor();
  const before = await els(claudia);
  const h = claudia.locator('[data-handle="g-se"]');
  const hb = await h.boundingBox();
  await claudia.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await claudia.mouse.down();
  await claudia.mouse.move(hb.x + 120, hb.y + 40, { steps: 6 });
  await claudia.mouse.up();
  const after = await els(claudia);
  for (const id of [a, b]) {
    const x0 = before.find((e) => e.id === id);
    const x1 = after.find((e) => e.id === id);
    if (!(x1.w > x0.w + 5)) throw new Error(`member ${id} was not scaled (${x0.w} → ${x1.w})`);
  }
});

await step('double-click enters the group (one member), Arrange → Ungroup splits it', claudia, async () => {
  const pb = await center(claudia, b);
  await claudia.mouse.dblclick(pb.x, pb.y);
  await until(claudia, () => !document.querySelector('[data-testid="group-box"]') && document.querySelectorAll('[data-testid="selection-box"]').length === 1);
  await claudia.getByRole('button', { name: 'Arrange', exact: true }).click();
  await claudia.getByRole('menuitem', { name: 'Ungroup' }).click();
  await until(mika, ([x, y]) => {
    const e = window.__moDeck.snapshot.slides[0].elements;
    return !e.find((el) => el.id === x)?.group && !e.find((el) => el.id === y)?.group;
  }, [a, b]);
});

await step('motion panel: animate both shapes (on click, then after previous)', claudia, async () => {
  const pa = await center(claudia, a);
  await claudia.mouse.click(pa.x, pa.y);
  await claudia.getByTestId('slides-panel').getByRole('button', { name: 'Motion', exact: true }).click();
  await claudia.getByTestId('add-animation').click();
  const pb = await center(claudia, b);
  await claudia.mouse.click(pb.x, pb.y);
  await claudia.getByTestId('add-animation').click();
  await until(claudia, () => document.querySelectorAll('[data-testid="anim-item"]').length === 2);
  await claudia.getByTestId('anim-item').nth(1).getByLabel('Animation effect').selectOption('flyInLeft');
  await claudia.getByTestId('anim-item').nth(1).getByLabel('Animation start').selectOption('after');
  await until(mika, ([x, y]) => {
    const e = window.__moDeck.snapshot.slides[0].elements;
    const ea = e.find((el) => el.id === x)?.anim;
    const eb = e.find((el) => el.id === y)?.anim;
    return ea?.start === 'click' && eb?.effect === 'flyInLeft' && eb?.start === 'after' && eb.order > ea.order;
  }, [a, b]);
  await claudia.getByTestId('motion-play').click();
  await claudia.getByTestId('motion-panel').locator('.mo-slide').waitFor();
});

await step('slide show: animated shapes wait for the click, back hides them again', claudia, async () => {
  await claudia.keyboard.press('Escape');
  await claudia.keyboard.press('F5');
  await claudia.getByTestId('presenter').waitFor();
  const vis = (id) => claudia.evaluate((x) => getComputedStyle(document.querySelector(`[data-testid="presenter"] [data-el="${x}"]`)).visibility, id);
  await until(claudia, () => !!document.querySelector('[data-testid="presenter"] .mo-slide'));
  if ((await vis(a)) !== 'hidden' || (await vis(b)) !== 'hidden') throw new Error('animated shapes visible before the click');
  await claudia.keyboard.press('ArrowRight');
  await until(claudia, ([x, y]) => [x, y].every((id) => getComputedStyle(document.querySelector(`[data-testid="presenter"] [data-el="${id}"]`)).visibility === 'visible'), [a, b], 5000);
  if ((await claudia.getByTestId('presenter-counter').innerText()) !== '1 / 1') throw new Error('the click left the slide');
  await claudia.keyboard.press('ArrowLeft');
  await until(claudia, (x) => getComputedStyle(document.querySelector(`[data-testid="presenter"] [data-el="${x}"]`)).visibility === 'hidden', a);
  await claudia.keyboard.press('ArrowRight');
  await claudia.keyboard.press('ArrowRight');
  await claudia.getByTestId('presenter-end').waitFor();
  await claudia.keyboard.press('Escape');
});

await step('picture: crop from the Format panel keeps the scale; brightness and recolour apply', claudia, async () => {
  // A 40×20 picture (left half red, right half blue).
  const src = await claudia.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 40;
    c.height = 20;
    const g = c.getContext('2d');
    g.fillStyle = '#ef4444';
    g.fillRect(0, 0, 20, 20);
    g.fillStyle = '#3b82f6';
    g.fillRect(20, 0, 20, 20);
    return c.toDataURL('image/png');
  });
  const [img] = await claudia.evaluate((s) => window.__moDeck.addElements(window.__moDeck.snapshot.slides[0].id, [{ id: 'x', type: 'image', x: 200, y: 120, w: 400, h: 200, z: 0, src: s }]), src);
  const p = await center(claudia, img);
  await claudia.mouse.click(p.x, p.y);
  await claudia.getByTestId('slides-panel').getByRole('button', { name: 'Format', exact: true }).click();
  const left = claudia.getByLabel('Crop left');
  await left.fill('25');
  await left.press('Enter');
  await until(mika, (id) => {
    const e = window.__moDeck.snapshot.slides[0].elements.find((x) => x.id === id);
    return e?.crop?.l === 0.25 && Math.abs(e.w - 300) < 1 && Math.abs(e.x - 300) < 1;
  }, img);
  await claudia.getByLabel('Picture brightness').fill('40');
  await claudia.getByLabel('Recolor').selectOption('grayscale');
  await until(mika, (id) => {
    const el = document.querySelector(`[data-testid="slide-canvas"] [data-el="${id}"] img`);
    return !!el && /brightness\(1\.4\)/.test(el.style.filter) && /grayscale/.test(el.style.filter);
  }, img);
});

await step('slide numbers: shown on every slide (title slides optional), synced', claudia, async () => {
  await claudia.keyboard.press('Escape');
  await claudia.getByTestId('slides-panel').getByRole('button', { name: 'Design', exact: true }).click();
  await claudia.getByLabel('Show slide numbers').check();
  await claudia.getByLabel('Skip title slides').uncheck();
  await until(mika, () => document.querySelector('[data-testid="slide-canvas"] [data-testid="slide-number"]')?.textContent === '1');
  await claudia.getByLabel('Skip title slides').check();
  await until(mika, () => !document.querySelector('[data-testid="slide-canvas"] [data-testid="slide-number"]'));
});

console.log(errors.length ? `browser errors:\n  ${errors.join('\n  ')}` : 'no browser errors');
if (errors.length) fails++;
console.log(fails ? `${fails} failed` : 'all passed');
await browser.close();
process.exit(fails ? 1 : 0);
