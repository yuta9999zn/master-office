// Base views end-to-end (§75, batch 3): kanban (drag between columns, add in a column), calendar (records on
// days, drag to another day), gallery (cover pictures) and forms (builder, open to the workspace, answering).
// node e2e/base-views-flow.mjs   (needs the web app + API + seed)
import { chromium } from 'playwright';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = process.env.WEB_URL ?? 'http://localhost:3000';
const browser = await chromium.launch();
const errors = [];
let fails = 0;

async function session(email) {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 900 }, timezoneId: 'Asia/Tokyo' });
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
    await page.screenshot({ path: join(tmpdir(), `mo-base-views-fail-${name.replace(/\W+/g, '_')}.png`), timeout: 10000 }).catch(() => undefined);
  }
};
const pad = (n) => String(n).padStart(2, '0');
const now = new Date(Date.now() + 9 * 3600_000);
const day = (d) => `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(d)}`;

const hana = await session('hana@kaori.jp');
const req = hana.context().request;
const n = Date.now() % 100000;
const base = await (await req.post(`${BASE}/api/resources`, { data: { name: `Content ${n}`, type: 'base' } })).json();
const t = (await (await req.get(`${BASE}/api/base/${base.id}`)).json()).tables[0];
const due = await (await req.post(`${BASE}/api/base/tables/${t.id}/fields`, { data: { name: 'Due', type: 'date' } })).json();
const pic = await (await req.post(`${BASE}/api/base/tables/${t.id}/fields`, { data: { name: 'Picture', type: 'attachment' } })).json();
await req.post(`${BASE}/api/base/tables/${t.id}/records`, {
  data: { records: [{ values: { Name: 'Spring post', Status: 'Todo', Due: day(10) } }, { values: { Name: 'Summer reel', Status: 'In progress', Due: day(12) } }, { values: { Name: 'Autumn banner', Status: 'Todo', Due: day(12) } }] },
});
const recs = async () => (await req.get(`${BASE}/api/base/tables/${t.id}/records`)).json();
const statusId = t.fields.find((f) => f.name === 'Status');
const choice = (name) => statusId.options.choices.find((c) => c.name === name).id;
const addView = async (label) => {
  await hana.getByTestId('add-view').click();
  await hana.getByRole('menuitem', { name: label }).click();
  await hana.getByTestId('base-view').filter({ hasText: label }).waitFor();
};

await step('kanban: a column per status', hana, async () => {
  await hana.goto(`${BASE}/base/${base.id}`);
  await hana.getByTestId('grid-row').first().waitFor({ timeout: 120000 });
  await addView('Kanban');
  await hana.locator('[data-testid="kanban-column"][data-column="Todo"]').getByTestId('record-card').nth(1).waitFor();
  if ((await hana.locator('[data-testid="kanban-column"][data-column="In progress"]').getByTestId('record-card').count()) !== 1) throw new Error('in progress');
});

await step('kanban: dragging a card to another column changes its status', hana, async () => {
  await hana.locator('[data-testid="record-card"][data-title="Spring post"]').dragTo(hana.locator('[data-testid="kanban-column"][data-column="Done"]'));
  await hana.locator('[data-testid="kanban-column"][data-column="Done"]').locator('[data-testid="record-card"][data-title="Spring post"]').waitFor();
  await hana.waitForTimeout(600);
  const r = (await recs()).find((x) => x.values[t.fields[0].id] === 'Spring post');
  if (r.values[statusId.id] !== choice('Done')) throw new Error('not saved');
});

await step('kanban: a new card in a column opens with that status', hana, async () => {
  await hana.locator('[data-testid="kanban-column"][data-column="In progress"]').getByTestId('kanban-add').click();
  const d = hana.getByTestId('record-drawer');
  await d.locator('[data-testid="record-field"][data-field="Status"]').getByText('In progress').waitFor();
  await d.getByRole('button', { name: 'Close' }).click();
  await hana.waitForFunction(() => document.querySelectorAll('[data-column="In progress"] [data-testid="record-card"]').length === 2);
});

await step('calendar: records sit on their day and move by dragging', hana, async () => {
  await addView('Calendar');
  await hana.locator(`[data-testid="calendar-day"][data-day="${day(12)}"]`).getByTestId('calendar-chip').nth(1).waitFor();
  await hana.locator('[data-testid="calendar-chip"][data-title="Summer reel"]').dragTo(hana.locator(`[data-testid="calendar-day"][data-day="${day(15)}"]`));
  await hana.locator(`[data-testid="calendar-day"][data-day="${day(15)}"]`).getByText('Summer reel').waitFor();
  await hana.waitForTimeout(600);
  const r = (await recs()).find((x) => x.values[t.fields[0].id] === 'Summer reel');
  if (r.values[due.id] !== day(15)) throw new Error(`date ${r.values[due.id]}`);
});

await step('gallery: cards with the cover picture', hana, async () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="#f472b6"/></svg>';
  const up = await (await req.post(`${BASE}/api/base/${base.id}/attachments`, { multipart: { file: { name: 'pink.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(svg) } } })).json();
  const r = (await recs()).find((x) => x.values[t.fields[0].id] === 'Autumn banner');
  await req.patch(`${BASE}/api/base/records`, { data: { records: [{ id: r.id, values: { [pic.id]: [up] } }] } });
  await addView('Gallery');
  await hana.locator('[data-testid="record-card"][data-title="Autumn banner"] img').waitFor();
  if ((await hana.getByTestId('record-card').count()) !== 4) throw new Error('cards');
});

const formUrl = { v: '' };
await step('form: build the questions and open it to the workspace', hana, async () => {
  await addView('Form');
  const b = hana.getByTestId('form-builder');
  await b.locator('[data-testid="form-builder-question"][data-field="Name"]').waitFor();
  await b.getByLabel('Form title').fill('Content request');
  await b.getByLabel('Form description').click();
  await b.getByLabel('Name required').check();
  await b.getByLabel('Remove Notes').click();
  await b.locator('[data-testid="form-builder-question"][data-field="Notes"]').waitFor({ state: 'detached' });
  await hana.getByTestId('form-open').check();
  formUrl.v = await hana.getByLabel('Form link').inputValue();
  await hana.waitForTimeout(800);
  const s = await (await req.get(`${BASE}/api/base/${base.id}`)).json();
  const f = s.tables[0].views.find((v) => v.type === 'form').config.form;
  if (f.title !== 'Content request' || !f.open || f.fields.includes(t.fields[1].id) || f.required.length !== 1) throw new Error(JSON.stringify(f));
});

await step('form: someone without access answers it and the record appears', hana, async () => {
  const rina = await session('rina@kaori.jp');
  await rina.goto(formUrl.v.replace(/^https?:\/\/[^/]+/, BASE));
  await rina.getByTestId('base-form').getByText('Content request').waitFor({ timeout: 60000 });
  await rina.getByTestId('form-submit').click();
  await rina.getByText('Please answer: Name').waitFor();
  await rina.locator('[data-testid="form-question"][data-field="Name"]').getByRole('textbox').fill('Winter campaign');
  await rina.locator('[data-testid="form-question"][data-field="Status"]').getByLabel('In progress').check();
  await rina.locator('[data-testid="form-question"][data-field="Due"]').locator('input').fill(day(20));
  await rina.getByTestId('form-submit').click();
  await rina.getByTestId('form-thanks').waitFor();
  await rina.context().close();
  await hana.getByTestId('base-view').filter({ hasText: 'Grid view' }).click();
  await hana.locator('[data-testid="grid-cell"][data-field="Name"]').getByText('Winter campaign').waitFor({ timeout: 15000 });
});

await browser.close();
if (errors.length) {
  console.log('page errors:\n' + errors.join('\n'));
  fails++;
}
console.log(fails ? `\n${fails} step(s) failed` : '\nall base views e2e steps passed');
process.exit(fails ? 1 : 0);
