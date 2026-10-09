// Phase 2b end-to-end: Notes & Mind Map with two people.   node e2e/notes-flow.mjs  (needs pnpm dev + seeded data)
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
  page.on('console', (m) => m.type() === 'error' && /setState|Cannot update a component/.test(m.text()) && errors.push(`${email}: ${m.text().slice(0, 160)}`));
  return page;
}
const step = async (name, page, fn) => {
  try {
    await fn();
    console.log('✓', name);
  } catch (e) {
    fails++;
    console.log('✗', name, '—', e.message.split('\n')[0]);
    await page.screenshot({ path: join(tmpdir(), `mo-notes-fail-${name.replace(/\W+/g, '_')}.png`) });
  }
};

const claudia = await session('claudia@hanami.example');
const ed = (p) => p.getByTestId('note-editor');
let noteUrl = '';
let noteId = '';

await claudia.goto(`${BASE}/notes`);
await step('notes home lists notebooks, tags and the seeded notes', claudia, async () => {
  await claudia.getByRole('link', { name: /Q4 Strategy Notes/ }).first().waitFor();
  await claudia.getByRole('link', { name: /Meeting Notes/ }).first().waitFor();
  await claudia.getByRole('link', { name: /^Strategy/ }).first().waitFor();
});

await step('Quick Capture creates a note in Inbox and opens it', claudia, async () => {
  await claudia.getByRole('button', { name: 'Quick Capture' }).click();
  await claudia.waitForURL(/\/notes\/[0-9a-f-]{36}/);
  noteUrl = claudia.url().split('?')[0];
  noteId = noteUrl.split('/').pop();
  await claudia.getByTestId('note-title').getByText(/Quick note/).waitFor();
  // Share it with the Sakura Beauty space so Mika (editor there) can collaborate.
  const spaces = await (await claudia.request.get(`${BASE}/api/spaces`)).json();
  await claudia.request.patch(`${BASE}/api/resources/${noteId}`, { data: { spaceId: spaces.find((s) => s.name === 'Sakura Beauty').id, parentId: null } });
});

await step('write with Markdown and the / menu (to-do list)', claudia, async () => {
  await ed(claudia).click();
  await claudia.keyboard.type('# Plan\nBudget review for Q4\n/todo');
  await claudia.getByRole('option', { name: /To-do list/ }).waitFor();
  await claudia.keyboard.press('Enter');
  await claudia.keyboard.type('Call supplier');
  await ed(claudia).locator('li[data-type="taskItem"]', { hasText: 'Call supplier' }).waitFor();
});

await step('assign the task and set a due date', claudia, async () => {
  const task = ed(claudia).locator('li[data-type="taskItem"]', { hasText: 'Call supplier' });
  await task.hover();
  await task.getByRole('button', { name: 'Assign' }).click();
  await claudia.getByRole('menuitem', { name: 'Mika Tanaka' }).click();
  await task.getByTestId('task-assignee').getByText('@Mika').waitFor();
  await task.hover();
  await task.getByRole('button', { name: 'Set due date' }).click();
  await claudia.getByLabel('Due date', { exact: true }).fill('2026-10-20');
  await claudia.keyboard.press('Escape');
  await task.getByTestId('task-due').getByText('Oct 20').waitFor();
});

await step('[[ links a page; Linked pages and the target’s backlinks update', claudia, async () => {
  await ed(claudia).locator('p', { hasText: 'Budget review for Q4' }).click();
  await claudia.keyboard.press('End');
  await claudia.keyboard.type(' see [[Marketing Plan');
  await claudia.getByRole('option', { name: /Marketing Plan - Q4 2026/ }).click();
  await ed(claudia).getByTestId('page-link').getByText('Marketing Plan - Q4 2026').waitFor();
  await claudia.getByTestId('linked-pages').getByText('Marketing Plan - Q4 2026').waitFor({ timeout: 20000 });
  const hits = await (await claudia.request.get(`${BASE}/api/search?q=${encodeURIComponent('Marketing Plan - Q4 2026')}`)).json();
  const links = await (await claudia.request.get(`${BASE}/api/resources/${hits.find((h) => h.kind === 'resource').id}/links`)).json();
  if (!links.backlinks.some((b) => b.id === noteId)) throw new Error('backlink missing');
});

await step('headings fold and unfold their section', claudia, async () => {
  const h1 = ed(claudia).locator('h1', { hasText: 'Plan' });
  await h1.hover();
  await h1.getByRole('button', { name: 'Collapse section' }).click();
  await ed(claudia).locator('p.mo-folded', { hasText: 'Budget review' }).waitFor({ state: 'attached' });
  await h1.getByRole('button', { name: 'Expand section' }).click();
  await ed(claudia).locator('p', { hasText: 'Budget review' }).waitFor({ state: 'visible' });
});

await step('convert notes to mind map', claudia, async () => {
  await claudia.getByRole('button', { name: 'Mind Map', exact: true }).click();
  await claudia.getByRole('button', { name: 'Convert notes to mind map' }).first().click();
  await claudia.getByTestId('mindmap').locator('[data-testid="mind-node-topic"]').filter({ hasText: /^Plan$/ }).waitFor();
});

const mika = await session('mika@hanami.example');
await step('second person sees the map and new branches live', claudia, async () => {
  await mika.goto(`${noteUrl}?view=mindmap`);
  await mika.getByTestId('mindmap').locator('[data-testid="mind-node-topic"]').filter({ hasText: /^Plan$/ }).waitFor({ timeout: 15000 });
  await claudia.getByTestId('mindmap').locator('[data-testid="mind-node-topic"]').filter({ hasText: /^Plan$/ }).click();
  await claudia.keyboard.press('Tab');
  await claudia.getByLabel('Topic text').fill('Next step');
  await claudia.keyboard.press('Enter');
  await mika.getByTestId('mindmap').locator('[data-testid="mind-node-topic"]').filter({ hasText: /^Next step$/ }).waitFor({ timeout: 10000 });
});

await step('sticky note added by the other person appears', mika, async () => {
  await mika.getByRole('button', { name: /Sticky note/ }).click();
  const box = await mika.getByTestId('mindmap').boundingBox();
  await mika.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.75);
  await mika.getByLabel('Sticky note text').fill('Check budget with finance');
  await mika.getByTestId('mindmap').click({ position: { x: 20, y: box.height - 20 } });
  await claudia.getByTestId('mindmap').getByText('Check budget with finance').waitFor({ timeout: 10000 });
});

await step('delete a topic and undo it (Ctrl+Z)', claudia, async () => {
  const node = claudia.getByTestId('mindmap').locator('[data-testid="mind-node-topic"]').filter({ hasText: /^Next step$/ });
  await node.click();
  await claudia.keyboard.press('Delete');
  await node.waitFor({ state: 'detached' });
  await claudia.keyboard.press('Control+z');
  await node.waitFor();
});

await step('Both view shows note and map side by side', claudia, async () => {
  await claudia.getByRole('button', { name: 'Both', exact: true }).click();
  await ed(claudia).waitFor();
  await claudia.getByTestId('mindmap').waitFor();
});

await step('tags from Properties appear in the notebook navigation', claudia, async () => {
  await claudia.getByTestId('note-properties').getByRole('button', { name: 'Add tag' }).click();
  await claudia.keyboard.type('E2Etag');
  await claudia.keyboard.press('Enter');
  await claudia.getByRole('link', { name: /E2Etag/ }).waitFor({ timeout: 10000 });
});

await claudia.request.post(`${BASE}/api/resources/${noteId}/trash`);
await claudia.request.delete(`${BASE}/api/resources/${noteId}`);
console.log(errors.length ? 'browser errors:\n' + [...new Set(errors)].join('\n') : 'no browser errors');
console.log(fails ? `${fails} failed` : 'all passed');
await browser.close();
process.exit(fails || errors.length ? 1 : 0);
