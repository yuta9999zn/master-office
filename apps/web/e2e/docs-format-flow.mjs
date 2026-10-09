// Docs 2.3 end-to-end: Heading 5–6, small caps, indentation options, line numbers (editor, DOCX, PDF / HTML),
// placeholder and calendar event chips, citations (APA / MLA, bibliography), section breaks with their own orientation, drawings.
// node e2e/docs-format-flow.mjs   (needs pnpm dev + API)
import { chromium } from 'playwright';
import JSZip from 'jszip';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = process.env.WEB_URL ?? 'http://localhost:3000';
const browser = await chromium.launch();
const errors = [];
let fails = 0;

const ctx = await browser.newContext({ viewport: { width: 1500, height: 940 } });
const users = await (await ctx.request.get(`${BASE}/api/users`)).json();
await ctx.addCookies([{ name: 'mo_uid', value: users.find((u) => u.email === 'claudia@hanami.example').id, url: BASE }]);
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(e.message));
const step = async (name, fn) => {
  try {
    await fn();
    console.log('✓', name);
  } catch (e) {
    fails++;
    console.log('✗', name, '—', e.message.split('\n')[0]);
    await page.screenshot({ path: join(tmpdir(), `mo-docs-format-fail-${name.replace(/\W+/g, '_')}.png`) });
  }
};
const until = (fn, arg, timeout = 15000) => page.waitForFunction(fn, arg, { timeout, polling: 200 });
const editor = page.getByTestId('doc-editor');
const menu = async (top, item) => {
  await page.getByRole('button', { name: top, exact: true }).click();
  await page.getByRole('menuitem', { name: item }).click();
};

const doc = await (await page.request.post(`${BASE}/api/resources`, { data: { type: 'document', name: 'Format test' } })).json();

await step('Heading 5 and small caps', async () => {
  await page.goto(`${BASE}/docs/${doc.id}`);
  await editor.waitFor({ timeout: 60000 });
  await editor.click();
  await page.keyboard.type('Minor heading');
  await page.getByRole('button', { name: 'Text style' }).click();
  await page.getByRole('menuitem', { name: 'Heading 5' }).click();
  await editor.locator('h5', { hasText: 'Minor heading' }).waitFor();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Quarterly Review');
  await page.keyboard.press('Shift+Home');
  await menu('Format', 'Small caps');
  await editor.locator('span[data-small-caps]', { hasText: 'Quarterly Review' }).waitFor();
});

await step('Indentation options: first line and hanging', async () => {
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Indented paragraph that is long enough to wrap onto several lines in the page, so that the first line indent and the line numbers have something to show. '.repeat(3));
  await menu('Format', 'Indentation options…');
  const dlg = page.getByTestId('indent-dialog');
  await dlg.getByLabel('Special indent').selectOption('first');
  await dlg.getByLabel('By').fill('1.5');
  await page.getByTestId('indent-apply').click();
  await until(() => [...document.querySelectorAll('[data-testid="doc-editor"] p')].some((p) => p.style.textIndent === '42.5pt'));
  await menu('Format', 'Indentation options…');
  await dlg.getByLabel('Special indent').selectOption('hanging');
  await page.getByTestId('indent-apply').click();
  await until(() => [...document.querySelectorAll('[data-testid="doc-editor"] p')].some((p) => p.style.textIndent === '-42.5pt' && p.style.marginLeft === '42.5pt'));
});

await step('Tools → Line numbers numbers every visual line', async () => {
  await menu('Tools', 'Line numbers');
  const gutter = page.getByTestId('line-numbers');
  await gutter.waitFor({ state: 'attached' });
  // Heading + small caps line + a paragraph wrapped over several lines.
  await until(() => document.querySelectorAll('[data-testid="line-numbers"] > div').length >= 6, null, 10000);
  const n = await gutter.locator('> div').count();
  const last = await gutter.locator('> div').last().innerText();
  if (String(n) !== last.trim()) throw new Error(`numbering ${n} vs ${last}`);
  // The numbers sit in the left margin, beside the text.
  const box = await gutter.locator('> div').first().boundingBox();
  const text = await editor.boundingBox();
  if (!box || box.x >= text.x) throw new Error('numbers are not in the margin');
});

await step('DOCX keeps headings 5, small caps, indents and line numbering; PDF / HTML number lines too', async () => {
  await page.waitForTimeout(2500); // debounced store
  const res = await page.request.get(`${BASE}/api/resources/${doc.id}/export?format=docx`);
  if (!res.ok()) throw new Error(`docx ${res.status()}`);
  const xml = await (await JSZip.loadAsync(await res.body())).file('word/document.xml').async('string');
  for (const want of ['w:pStyle w:val="Heading5"', '<w:smallCaps', 'w:hanging="850"', '<w:lnNumType']) if (!xml.includes(want)) throw new Error(`docx missing ${want}`);
  const html = await (await page.request.get(`${BASE}/api/resources/${doc.id}/export?format=html`)).text();
  if (!html.includes('lineBoxes') || !html.includes('font-variant:small-caps')) throw new Error('html export');
  const pdf = await page.request.get(`${BASE}/api/resources/${doc.id}/export?format=pdf`);
  if (!pdf.ok() || (await pdf.body()).length < 1000) throw new Error(`pdf ${pdf.status()}`);
});

await step('/placeholder chip: typing the value replaces it', async () => {
  await editor.locator('p').last().click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Prepared for ');
  await page.keyboard.type('/placeholder');
  await page.keyboard.press('Enter');
  await editor.getByTestId('placeholder-chip').click();
  await page.getByLabel('Replace placeholder with').fill('Acme Corp');
  await page.getByLabel('Replace placeholder with').press('Enter');
  await editor.getByText('Prepared for Acme Corp').waitFor();
  if (await editor.getByTestId('placeholder-chip').count()) throw new Error('placeholder still there');
});

await step('/calendar event chip: details, label and an .ics file', async () => {
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Next: ');
  await page.keyboard.type('/event');
  await page.keyboard.press('Enter');
  const chip = editor.getByTestId('event-chip');
  await chip.getByText(/Meeting · .*10:00–10:30/).waitFor();
  await chip.click();
  await page.getByLabel('Event title').fill('Board review');
  await page.getByLabel('Event location').fill('Room 5');
  await page.getByLabel('Event location').press('Tab');
  await chip.getByText(/Board review · /).waitFor();
  const href = await page.getByTestId('event-ics').getAttribute('href');
  const ics = decodeURIComponent(href.replace(/^data:text\/calendar;charset=utf-8,/, ''));
  for (const want of ['BEGIN:VEVENT', 'SUMMARY:Board review', 'LOCATION:Room 5', 'T100000']) if (!ics.includes(want)) throw new Error(`ics missing ${want}`);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(2500);
  const xml = await (await JSZip.loadAsync(await (await page.request.get(`${BASE}/api/resources/${doc.id}/export?format=docx`)).body())).file('word/document.xml').async('string');
  if (!xml.includes('Board review') || !xml.includes('Acme Corp')) throw new Error('docx misses the chips');
});

await step('Tools → Citations: sources, in-text citation with a page, bibliography of cited sources', async () => {
  await menu('Tools', 'Citations');
  const panel = page.getByTestId('citations-panel');
  await panel.getByTestId('source-add').click();
  await panel.getByLabel('Author 1 first name').fill('Aya');
  await panel.getByLabel('Author 1 last name').fill('Tanaka');
  await panel.getByLabel('Title').fill('Salon Operations');
  await panel.getByLabel('Publisher').fill('Hanami Press');
  await panel.getByLabel('Year').fill('2024');
  await panel.getByTestId('source-save').click();
  await panel.getByTestId('source-add').click();
  await panel.getByLabel('Source type').selectOption('website');
  await panel.getByRole('button', { name: 'Remove author 1' }).click();
  await panel.getByLabel('Title').fill('Skin care trends 2026');
  await panel.getByLabel('Website name').fill('Beauty Weekly');
  await panel.getByLabel('Year').fill('2026');
  await panel.getByTestId('source-save').click();
  await panel.getByTestId('sources').getByText('Skin care trends 2026').first().waitFor();
  // Cite the book at the end of the last paragraph.
  await editor.locator('p').last().click();
  await page.keyboard.press('End');
  await page.keyboard.type(' as shown ');
  await panel.getByRole('button', { name: 'Cite Salon Operations' }).click();
  const cite = editor.getByTestId('citation');
  await cite.getByText('(Tanaka, 2024)').waitFor();
  await cite.getByText('(Tanaka, 2024)').click();
  await page.getByLabel('Citation page').fill('12');
  await page.getByLabel('Citation page').press('Enter');
  await cite.getByText('(Tanaka, 2024, p. 12)').waitFor();
  await panel.getByTestId('insert-bibliography').click();
  const bib = editor.getByTestId('bibliography');
  await bib.getByText('References').waitFor();
  await bib.getByText('Salon Operations').waitFor();
  if (await bib.getByText('Skin care trends').count()) throw new Error('uncited source listed');
});

await step('switching to MLA restyles citations and the list; DOCX has the formatted text', async () => {
  await page.getByTestId('citations-panel').getByLabel('Citation style').selectOption('mla');
  await editor.getByTestId('citation').getByText('(Tanaka 12)').waitFor();
  await editor.getByTestId('bibliography').getByText('Works Cited').waitFor();
  await page.waitForTimeout(2500);
  const xml = await (await JSZip.loadAsync(await (await page.request.get(`${BASE}/api/resources/${doc.id}/export?format=docx`)).body())).file('word/document.xml').async('string');
  for (const want of ['(Tanaka 12)', 'Works Cited', 'Tanaka, Aya. ', 'Salon Operations']) if (!xml.includes(want)) throw new Error(`docx missing ${want}`);
  if (!/<w:i\/>[\s\S]{0,200}Salon Operations/.test(xml)) throw new Error('book title not italic');
});

await step('a section break puts the following pages in landscape (PDF, DOCX)', async () => {
  await editor.locator('p').first().click();
  await page.keyboard.press('End');
  await menu('Insert', 'Section break (next page)');
  const bar = editor.getByTestId('section-break');
  await bar.waitFor();
  if ((await bar.getAttribute('data-orientation')) !== 'landscape') throw new Error('not landscape');
  await bar.getByRole('button', { name: 'Section orientation' }).click();
  await editor.locator('[data-testid="section-break"][data-orientation="portrait"]').waitFor();
  await bar.getByRole('button', { name: 'Section orientation' }).click();
  await editor.locator('[data-testid="section-break"][data-orientation="landscape"]').waitFor();
  await page.waitForTimeout(2500);
  const xml = await (await JSZip.loadAsync(await (await page.request.get(`${BASE}/api/resources/${doc.id}/export?format=docx`)).body())).file('word/document.xml').async('string');
  if ((xml.match(/<w:sectPr/g) ?? []).length < 2 || !xml.includes('w:orient="landscape"')) throw new Error('docx sections');
  const html = await (await page.request.get(`${BASE}/api/resources/${doc.id}/export?format=html`)).text();
  if (!html.includes('page:landscape') || !html.includes('@page landscape')) throw new Error('html named pages');
  const pdf = (await (await page.request.get(`${BASE}/api/resources/${doc.id}/export?format=pdf`)).body()).toString('latin1');
  const boxes = [...pdf.matchAll(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)/g)].map((m) => Number(m[1]) > Number(m[2]));
  if (!boxes.includes(true) || !boxes.includes(false)) throw new Error(`pdf pages ${JSON.stringify(boxes)}`);
});

await step('Insert → Drawing: shapes, a scribble and text on the canvas, saved into the document', async () => {
  await page.keyboard.press('Escape');
  await editor.locator('p').first().click();
  await menu('Insert', 'Drawing…');
  const canvas = page.getByTestId('drawing-canvas');
  await canvas.getByTestId('slide-canvas').waitFor({ timeout: 30000 });
  const hits = () => canvas.locator('[data-hit]').count();
  await page.getByRole('button', { name: 'Drawing shape' }).click();
  await page.getByRole('menuitem', { name: 'Heart', exact: true }).click();
  await page.getByRole('button', { name: 'Drawing line' }).click();
  await page.getByRole('menuitem', { name: 'Scribble' }).click();
  const b = await canvas.getByTestId('slide-canvas').boundingBox();
  await page.mouse.move(b.x + b.width * 0.1, b.y + b.height * 0.8);
  await page.mouse.down();
  for (let i = 1; i <= 15; i++) await page.mouse.move(b.x + b.width * (0.1 + i * 0.015), b.y + b.height * (0.8 - Math.sin(i / 3) * 0.1), { steps: 2 });
  await page.mouse.up();
  await page.getByRole('button', { name: 'Drawing text box' }).click();
  // The text editor mounts asynchronously: type once it has the focus.
  await page.waitForFunction(() => document.activeElement?.closest('[data-testid="drawing-canvas"]') && document.activeElement.isContentEditable, null, { timeout: 10000 });
  await page.keyboard.type('Hello drawing');
  // Leave the text box by clicking an empty spot of the canvas.
  await page.mouse.click(b.x + b.width * 0.9, b.y + b.height * 0.1);
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="drawing-canvas"] [data-hit]').length === 3, null, { timeout: 10000 });
  await page.getByTestId('drawing-save').click();
  const view = editor.getByTestId('drawing');
  await view.getByText('Hello drawing').waitFor();
  if ((await view.locator('svg path').count()) < 2) throw new Error('drawing preview misses shapes');
});

await step('editing a drawing reopens its elements; exports carry it', async () => {
  const view = editor.getByTestId('drawing');
  await view.locator('div[style*="scale"]').first().dblclick({ force: true });
  const canvas = page.getByTestId('drawing-canvas');
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="drawing-canvas"] [data-hit]').length === 3, null, { timeout: 30000 });
  await canvas.locator('[data-hit]').last().click();
  await page.getByRole('button', { name: 'Delete from drawing' }).click();
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="drawing-canvas"] [data-hit]').length === 2);
  await page.getByTestId('drawing-save').click();
  // The topmost element was the text box: it is gone from the saved drawing, the shapes stay.
  await view.getByText('Hello drawing').waitFor({ state: 'detached' });
  if ((await view.locator('svg path').count()) < 2) throw new Error('shapes lost');
  await page.waitForTimeout(2500);
  const zip = await JSZip.loadAsync(await (await page.request.get(`${BASE}/api/resources/${doc.id}/export?format=docx`)).body());
  if (!Object.keys(zip.files).some((n) => /^word\/media\/.+\.png$/.test(n))) throw new Error('docx has no drawing picture');
  const html = await (await page.request.get(`${BASE}/api/resources/${doc.id}/export?format=html`)).text();
  if (!/<figure class="drawing">[\s\S]*?<svg/.test(html)) throw new Error('html drawing');
});

await page.request.delete(`${BASE}/api/resources/${doc.id}`);
await browser.close();
console.log(errors.length ? `browser errors:\n  ${errors.join('\n  ')}` : 'no browser errors');
if (errors.length) fails++;
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
