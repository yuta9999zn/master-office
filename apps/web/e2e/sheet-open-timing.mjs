// Opens a spreadsheet headless and reports how long each phase took (sync, engine, workbook build, first calculation)
// and the heap — the numbers of docs/ARCHITECTURE.md §83.   node e2e/sheet-open-timing.mjs <resourceId>   (WEB_URL=…)
import { chromium } from 'playwright';
const BASE = process.env.WEB_URL ?? 'http://localhost:3010';
const [id] = process.argv.slice(2);
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1500, height: 900 } });
const users = await (await ctx.request.get(`${BASE}/api/users`)).json();
await ctx.addCookies([{ name: 'mo_uid', value: users.find((u) => u.email === 'claudia@kaori.jp').id, url: BASE }]);
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text().slice(0, 160)));
page.on('pageerror', (e) => errors.push(e.message.slice(0, 160)));
const t0 = Date.now();
await page.goto(`${BASE}/sheets/${id}`);
await page.locator('.mo-univer canvas').first().waitFor({ timeout: 600000 });
const tCanvas = Date.now() - t0;
// wait until the open timing has its calcMs (first calculation done) or 4 minutes
await page.waitForFunction(() => window.__moSheetOpen && window.__moSheetOpen.calcMs !== undefined, null, { timeout: 240000 }).catch(() => undefined);
const timing = await page.evaluate(() => window.__moSheetOpen);
const mem = await page.evaluate(() => (performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null));
console.log(JSON.stringify({ msToCanvas: tCanvas, msTotal: Date.now() - t0, heapMB: mem, ...timing, errors }));
await browser.close();
