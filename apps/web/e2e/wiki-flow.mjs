// Wiki end-to-end (§78): creating a space from the business-analysis toolkit, the page tree (sections, a page from a
// template, a subpage, drag to reorder and nest), status and labels, copy and delete, space settings, and a
// /wiki/:id link opening inside its space.
// node e2e/wiki-flow.mjs   (needs the web app + API + seed)
import { chromium } from 'playwright';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = process.env.WEB_URL ?? 'http://localhost:3000';
const browser = await chromium.launch();
const errors = [];
let fails = 0;

async function session(email) {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 940 }, timezoneId: 'Asia/Tokyo' });
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
    await page.screenshot({ path: join(tmpdir(), `mo-wiki-fail-${name.replace(/\W+/g, '_')}.png`), timeout: 10000 }).catch(() => undefined);
  }
};

const p = await session('fujita@hanami.example');
const n = Date.now() % 100000;
const name = `Loan system ${n}`;
const node = (title) => p.locator(`[data-testid="wiki-node"][data-title="${title}"]`);
const tree = () => p.locator('[data-testid="wiki-node"]').evaluateAll((els) => els.map((e) => ({ t: e.dataset.title, pad: parseInt(e.style.paddingLeft) })));
const dragTo = async (from, to, where) => {
  const box = await node(to).boundingBox();
  const y = where === 'before' ? box.y + 3 : where === 'after' ? box.y + box.height - 3 : box.y + box.height / 2;
  await node(from).dragTo(node(to), { targetPosition: { x: 60, y: y - box.y } });
};

await step('creating a space from the business-analysis toolkit', p, async () => {
  await p.goto(`${BASE}/wiki`);
  await p.getByTestId('create-space').click({ timeout: 90000 });
  await p.getByLabel('Space name').fill(name);
  await p.getByLabel('Space key').fill(`LN${n}`);
  await p.getByLabel('Where').selectOption({ label: 'Members of Mirai Systems' });
  await p.getByTestId('starter-ba').click();
  await p.getByTestId('space-save').click();
  await p.getByTestId('space-name').filter({ hasText: name }).waitFor({ timeout: 60000 });
  await node('Requirements').waitFor();
  await node('Modelling').waitFor();
  await p.getByTestId('wiki-page-meta').getByText(name).waitFor();
  await p.locator('.ProseMirror').first().waitFor({ timeout: 30000 });
});

await step('section pages hold the toolkit pages', p, async () => {
  const t = await tree();
  const req = t.findIndex((x) => x.t === 'Requirements');
  const frs = t.findIndex((x) => /Functional Requirements Specification/.test(x.t));
  if (req < 0 || frs < req || t[frs].pad <= t[req].pad) throw new Error(JSON.stringify(t.slice(0, 20)));
  await p.locator('[data-testid="wiki-node"]').filter({ hasText: 'Functional Requirements Specification' }).first().click();
  await p.getByTestId('page-status').filter({ hasText: 'Draft' }).waitFor();
  await p.getByTestId('wiki-page-meta').getByText('Requirements').waitFor();
});

await step('a new page from a template, and a subpage under it', p, async () => {
  await p.getByTestId('wiki-add-page').click();
  await p.getByRole('dialog').getByTestId('blank-page').click();
  await node('Untitled page').waitFor({ timeout: 30000 });
  await node('Untitled page').hover();
  await node('Untitled page').getByTestId('node-add').click();
  await p.getByLabel('Search templates').fill('retrospective');
  await p.locator('[data-testid="doc-template"][data-id="pd-retro"]').click();
  await node('Retrospective Notes').waitFor({ timeout: 30000 });
  const t = await tree();
  const a = t.find((x) => x.t === 'Untitled page');
  const b = t.find((x) => x.t === 'Retrospective Notes');
  if (b.pad <= a.pad) throw new Error(JSON.stringify([a, b]));
  await p.getByTestId('wiki-page-meta').getByText('Untitled page').waitFor();
});

await step('dragging pages: reorder and nest', p, async () => {
  // Retrospective Notes out to the top level, before "Untitled page".
  await dragTo('Retrospective Notes', 'Untitled page', 'before');
  await p.waitForFunction(() => {
    const els = [...document.querySelectorAll('[data-testid="wiki-node"]')];
    const i = els.findIndex((e) => e.dataset.title === 'Retrospective Notes');
    return i >= 0 && els[i + 1]?.dataset.title === 'Untitled page' && els[i].style.paddingLeft === els[i + 1].style.paddingLeft;
  }, null, { timeout: 15000 });
  // … and back inside it.
  await dragTo('Retrospective Notes', 'Untitled page', 'inside');
  await p.waitForFunction(() => {
    const els = [...document.querySelectorAll('[data-testid="wiki-node"]')];
    const i = els.findIndex((e) => e.dataset.title === 'Untitled page');
    return els[i + 1]?.dataset.title === 'Retrospective Notes' && parseInt(els[i + 1].style.paddingLeft) > parseInt(els[i].style.paddingLeft);
  }, null, { timeout: 15000 });
});

await step('status and labels on a page', p, async () => {
  await node('Retrospective Notes').click();
  await p.getByTestId('page-status').click();
  await p.getByRole('menuitem', { name: 'In review' }).click();
  await p.getByTestId('page-status').filter({ hasText: 'In review' }).waitFor();
  await p.getByLabel('Add label').fill('Release 1');
  await p.getByLabel('Add label').press('Enter');
  await p.getByTestId('page-labels').getByText('release-1').waitFor({ timeout: 10000 });
  await p.reload();
  await p.getByTestId('page-status').filter({ hasText: 'In review' }).waitFor({ timeout: 60000 });
  await p.getByTestId('page-labels').getByText('release-1').waitFor();
});

await step('searching pages by title and label', p, async () => {
  await p.getByLabel('Search pages').fill('release-1');
  await p.getByTestId('wiki-match').filter({ hasText: 'Retrospective Notes' }).waitFor();
  await p.getByLabel('Clear search').click();
});

await step('copying a page with its subpages, then deleting the copy', p, async () => {
  await node('Untitled page').hover();
  await node('Untitled page').getByTestId('node-menu').click();
  await p.getByRole('menuitem', { name: 'Copy with subpages' }).click();
  await node('Untitled page (Copy)').waitFor({ timeout: 30000 });
  await node('Untitled page (Copy)').and(p.locator('[aria-current="page"]')).waitFor();
  if ((await node('Retrospective Notes').count()) !== 2) throw new Error('subpage not copied');
  await node('Untitled page (Copy)').hover();
  await node('Untitled page (Copy)').getByTestId('node-menu').click();
  await p.getByRole('menuitem', { name: 'Delete…' }).click();
  await p.getByRole('dialog').getByText('1 subpage(s)').waitFor();
  await p.getByTestId('confirm-delete-page').click();
  await node('Untitled page (Copy)').waitFor({ state: 'detached', timeout: 15000 });
  if ((await node('Retrospective Notes').count()) !== 1) throw new Error('subpage not deleted');
});

await step('space settings', p, async () => {
  await p.getByTestId('space-settings').click();
  const dlg = p.getByRole('dialog');
  await dlg.getByLabel('Space name').fill(`${name} platform`);
  await dlg.getByLabel('Space description').fill('Everything about the loan platform');
  await p.getByTestId('space-settings-save').click();
  await p.getByTestId('space-name').filter({ hasText: `${name} platform` }).waitFor();
});

await step('the wiki home lists the space and its recent pages', p, async () => {
  await p.goto(`${BASE}/wiki`);
  await p.locator(`[data-testid="wiki-space"][data-name="${name} platform"]`).getByText('Everything about the loan platform').waitFor({ timeout: 60000 });
  await p.getByTestId('wiki-recent').getByText('Retrospective Notes').first().waitFor();
});

await step('a /wiki/:id link opens inside its space', p, async () => {
  const spaces = await (await p.context().request.get(`${BASE}/api/wiki/spaces`)).json();
  const sp = await (await p.context().request.get(`${BASE}/api/wiki/spaces/${spaces.find((s) => s.name === `${name} platform`).id}`)).json();
  const pg = sp.tree.find((x) => x.title === 'Retrospective Notes');
  await p.goto(`${BASE}/wiki/${pg.id}`);
  await p.waitForURL(`**/wiki/s/${sp.id}?page=${pg.id}`, { timeout: 60000 });
  await p.getByTestId('page-status').filter({ hasText: 'In review' }).waitFor();
});

await browser.close();
if (errors.length) console.log('page errors:', errors);
console.log(fails ? `\n${fails} step(s) failed` : '\nall wiki steps passed');
process.exit(fails || errors.length ? 1 : 0);
