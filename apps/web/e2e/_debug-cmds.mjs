// Diagnosis: which Univer commands (and params) do user actions produce? (input for the macro recorder)
import { chromium } from 'playwright';
const BASE = process.env.WEB_URL ?? 'http://localhost:3010';
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
const users = await (await ctx.request.get(`${BASE}/api/users`)).json();
await ctx.addCookies([{ name: 'mo_uid', value: users.find((u) => u.email === 'claudia@hanami.example').id, url: BASE }]);
const p = await ctx.newPage();
const id = (await (await ctx.request.get(`${BASE}/api/search?q=${encodeURIComponent('Budget 2027')}`)).json()).find((h) => h.kind === 'resource').id;
await p.goto(`${BASE}/sheets/${id}`);
await p.waitForFunction((u) => !!window.__moSheet?.api.getWorkbook(u), id, { timeout: 120000 });
await p.waitForTimeout(1500);
await p.evaluate(() => {
  window.__log = [];
  window.__moSheet.api.addEvent(window.__moSheet.api.Event.CommandExecuted, (e) => {
    if (e.type === 2 /* mutation */ || /formula|scroll|selection|notification|set-activate-cell-edit|rich-text|replace-snapshot|doc\./.test(e.id)) return;
    window.__log.push(`${e.type}:${e.id} ${JSON.stringify(e.params ?? {}).slice(0, 260)}`);
  });
});
const sel = (a1) => p.evaluate((a) => window.__moSheet.api.getActiveWorkbook().getActiveSheet().getRange(a).activate(), a1);
const step = async (label, fn) => {
  await p.evaluate((l) => window.__log.push(`--- ${l}`), label);
  await fn();
  await p.waitForTimeout(400);
};
await step('type text', async () => (await sel('B2'), await p.keyboard.type('hello'), await p.keyboard.press('Enter')));
await step('type number', async () => (await sel('B3'), await p.keyboard.type('42'), await p.keyboard.press('Enter')));
await step('type formula', async () => (await sel('B4'), await p.keyboard.type('=B3*2'), await p.keyboard.press('Enter')));
await step('bold', async () => (await sel('B2'), await p.keyboard.press('Control+b')));
await step('italic', async () => (await sel('B2:C3'), await p.keyboard.press('Control+i')));
await step('underline', async () => p.keyboard.press('Control+u'));
await step('delete', async () => (await sel('C3'), await p.keyboard.press('Delete')));
await step('undo', async () => p.keyboard.press('Control+z'));
await step('switch sheet (facade)', async () => p.evaluate(() => { const wb = window.__moSheet.api.getActiveWorkbook(); const s = wb.getSheets()[1] ?? wb.getSheets()[0]; wb.setActiveSheet(s); wb.setActiveSheet(wb.getSheets()[0]); }));
console.log((await p.evaluate(() => window.__log)).join('\n'));
await browser.close();
