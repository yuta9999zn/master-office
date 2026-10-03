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

await step('video (YouTube link) and audio (uploaded file): still frame in the editor, players in the slide show', claudia, async () => {
  await claudia.getByRole('button', { name: 'Insert', exact: true }).click();
  await claudia.getByRole('menuitem', { name: 'Video…' }).click();
  await claudia.getByLabel('YouTube link').fill('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  await claudia.getByTestId('insert-video-link').click();
  await until(mika, () => window.__moDeck.snapshot.slides[0].elements.some((e) => e.type === 'video'));
  await until(mika, () => !!document.querySelector('[data-testid="slide-canvas"] [data-el] div[style*="i.ytimg.com/vi/dQw4w9WgXcQ"]'));
  // Double-click plays it in place in the editor.
  const vid = await claudia.evaluate(() => window.__moDeck.snapshot.slides[0].elements.find((e) => e.type === 'video').id);
  await hitOf(claudia, vid).dblclick();
  await claudia.locator('[data-testid="media-player"] iframe[src*="dQw4w9WgXcQ"]').waitFor({ state: 'attached' });
  // The double-click must not leave the browser's selection highlight over the player.
  if ((await claudia.evaluate(() => getSelection().type)) === 'Range') throw new Error('the player is covered by a text selection');
  await claudia.getByLabel('Stop playing').click();
  await claudia.getByTestId('media-player').waitFor({ state: 'detached' });
  await claudia.getByTestId('slides-panel').getByRole('button', { name: 'Format', exact: true }).click();
  await claudia.getByLabel('Play automatically when presenting').check();
  await until(mika, () => window.__moDeck.snapshot.slides[0].elements.find((e) => e.type === 'video')?.media?.autoplay === true);
  // A tiny WAV file (0.1 s of silence).
  const n = 800;
  const wav = Buffer.alloc(44 + n);
  wav.write('RIFF', 0);
  wav.writeUInt32LE(36 + n, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24);
  wav.writeUInt32LE(8000, 28);
  wav.writeUInt16LE(1, 32);
  wav.writeUInt16LE(8, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(n, 40);
  wav.fill(128, 44);
  await claudia.getByTestId('audio-input').setInputFiles({ name: 'Chime.wav', mimeType: 'audio/wav', buffer: wav });
  await until(mika, () => window.__moDeck.snapshot.slides[0].elements.some((e) => e.type === 'audio' && e.src.includes('/assets/')));
  // Uploaded media is served in byte ranges (seeking).
  const src = await claudia.evaluate(() => window.__moDeck.snapshot.slides[0].elements.find((e) => e.type === 'audio').src);
  const part = await claudia.request.get(`${BASE}${src}`, { headers: { Range: 'bytes=0-9' } });
  if (part.status() !== 206 || (await part.body()).length !== 10) throw new Error(`range request → ${part.status()}`);
  await claudia.keyboard.press('Escape');
  await claudia.keyboard.press('F5');
  await claudia.getByTestId('presenter').waitFor();
  // The slide's earlier animations: click through them, then the players are there.
  await claudia.keyboard.press('ArrowRight');
  const iframe = claudia.locator('[data-testid="presenter"] iframe[data-mo-media]');
  await iframe.waitFor({ state: 'attached' });
  const url = await iframe.getAttribute('src');
  if (!/youtube-nocookie\.com\/embed\/dQw4w9WgXcQ\?.*autoplay=1/.test(url)) throw new Error(url);
  await claudia.locator('[data-testid="presenter"] audio[data-mo-media]').waitFor({ state: 'attached' });
  await claudia.keyboard.press('Escape');
});

await step('connectors: ends snap to shapes, follow them when moved, detach when dragged away', claudia, async () => {
  // A fresh blank slide with two boxes.
  const sid = await claudia.evaluate(() => window.__moDeck.addSlide('blank', 1));
  await claudia.locator('[data-testid="slide-thumb"]').nth(1).click();
  const [left, right] = await claudia.evaluate((s) => window.__moDeck.addElements(s, [
    { id: 'l', type: 'shape', geom: 'rect', x: 150, y: 200, w: 200, h: 120, z: 0, style: { fill: '#BFDBFE' } },
    { id: 'r', type: 'shape', geom: 'rect', x: 800, y: 400, w: 200, h: 120, z: 0, style: { fill: '#FBCFE8' } },
  ]), sid);
  await claudia.getByRole('button', { name: 'Insert', exact: true }).click();
  await claudia.getByRole('menuitem', { name: 'Elbow connector' }).click();
  const conn = await claudia.evaluate((s) => window.__moDeck.snapshot.slides.find((x) => x.id === s).elements.find((e) => e.conn)?.id, sid);
  // Slide → screen coordinates.
  const toScreen = async (x, y) => {
    const r = await claudia.getByTestId('slide-canvas').boundingBox();
    const k = r.width / 1280;
    return { x: r.x + x * k, y: r.y + y * k };
  };
  const dragTo = async (handle, x, y) => {
    const h = await claudia.locator('[data-testid="selection-box"], svg').locator('..').locator(`div[style*="cursor: crosshair"]`).nth(handle === 'start' ? 0 : 1).boundingBox();
    await claudia.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
    await claudia.mouse.down();
    const t = await toScreen(x, y);
    await claudia.mouse.move(t.x + 6, t.y + 4, { steps: 8 });
    await claudia.getByTestId('conn-site').first().waitFor();
    await claudia.mouse.move(t.x + 3, t.y + 2, { steps: 2 });
    await claudia.mouse.up();
  };
  await dragTo('start', 350, 260); // east side of the left box
  await dragTo('end', 800, 460); // west side of the right box
  await until(mika, ([s, c, l, r]) => {
    const e = window.__moDeck.snapshot.slides.find((x) => x.id === s)?.elements.find((x) => x.id === c);
    return e?.conn?.kind === 'elbow' && e.conn.from?.id === l && e.conn.from.site === 'e' && e.conn.to?.id === r && e.conn.to.site === 'w';
  }, [sid, conn, left, right]);
  // Mika moves the right box: Claudia's connector follows (its end is the box's west side).
  await mika.evaluate(([s, r]) => window.__moDeck.updateElements(s, [{ id: r, patch: { x: 900, y: 550 } }]), [sid, right]);
  await until(claudia, (c) => {
    const el = document.querySelector(`[data-testid="slide-canvas"] [data-el="${c}"]`);
    return el && Math.abs(parseFloat(el.style.left) - 350) < 1 && Math.abs(parseFloat(el.style.width) - 550) < 1 && Math.abs(parseFloat(el.style.height) - 350) < 1;
  }, conn);
  // Dragging the connector itself lets go of the shapes.
  const box = await claudia.locator(`[data-hit="${conn}"]`).boundingBox();
  await claudia.mouse.move(box.x + box.width / 2, box.y + 4);
  await claudia.mouse.down();
  await claudia.mouse.move(box.x + box.width / 2 + 60, box.y + 60, { steps: 6 });
  await claudia.mouse.up();
  await until(mika, ([s, c]) => {
    const e = window.__moDeck.snapshot.slides.find((x) => x.id === s)?.elements.find((x) => x.id === c);
    return e && !e.conn?.from && !e.conn?.to && e.conn?.kind === 'elbow';
  }, [sid, conn]);
});

console.log(errors.length ? `browser errors:\n  ${errors.join('\n  ')}` : 'no browser errors');
if (errors.length) fails++;
console.log(fails ? `${fails} failed` : 'all passed');
await browser.close();
process.exit(fails ? 1 : 0);
