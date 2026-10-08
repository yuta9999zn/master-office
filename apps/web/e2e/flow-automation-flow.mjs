// Flow automation end-to-end (§77, batch 2): a shape gets the Action role with an explained type, the badge appears,
// the Runs tab shows the switch, triggers and problems, Run now walks the diagram and lists the steps, a waiting run
// is continued, the shape library explains its shapes.
// node e2e/flow-automation-flow.mjs   (needs the web app + API + seed)
import { chromium } from 'playwright';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = process.env.WEB_URL ?? 'http://localhost:3000';
const API = process.env.API_URL ?? 'http://localhost:4000';
const browser = await chromium.launch();
const errors = [];
let fails = 0;
let users = [];

async function session(email) {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 940 } });
  users = await (await ctx.request.get(`${BASE}/api/users`)).json();
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
    await page.screenshot({ path: join(tmpdir(), `mo-flowauto-fail-${name.replace(/\W+/g, '_')}.png`), timeout: 10000 }).catch(() => undefined);
  }
};
async function api(method, path, user, body) {
  const res = await fetch(API + path, { method, headers: { 'x-user-id': user, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null };
}

const claudia = await session('claudia@kaori.jp');
const claudiaId = users.find((u) => u.email === 'claudia@kaori.jp').id;
const n = Date.now() % 100000;

// A flow with a manual trigger → Wait → a step to configure.
const P = 'p1';
const node = (id, text, y, automation = null, shape = 'process') => ({ id, page: P, shape, x: 300, y, w: 180, h: 56, text, icon: null, style: {}, z: 0, data: {}, automation });
const edge = (from, to, label = '') => ({ id: `${from}-${to}`, page: P, from, to, fromSide: null, toSide: null, label, style: {} });
const flow = (await api('POST', '/resources', claudiaId, { name: `Auto e2e ${n}`, type: 'flow' })).data;
await api('POST', `/flows/${flow.id}/import`, claudiaId, {
  info: { version: '1.0.0', status: 'draft', trigger: 'Manual', tags: [], description: '', automation: false },
  pages: [{ id: P, name: 'Page 1' }],
  nodes: [node('s', 'Start', 60, { role: 'trigger', type: 'manual', config: {} }, 'terminal'), node('w', 'Wait a bit', 160, { role: 'action', type: 'delay', config: { minutes: 30 } }, 'delay'), node('t', 'Tell the team', 260), node('e', 'End', 360, null, 'terminal')],
  edges: [edge('s', 'w'), edge('w', 't'), edge('t', 'e')],
});

await step('shapes with a role carry a badge; the Automation tab explains the chosen type', claudia, async () => {
  await claudia.goto(`${BASE}/flow/${flow.id}`);
  await claudia.locator('[data-testid="flow-node"][data-text="Tell the team"]').waitFor({ timeout: 90000 });
  if ((await claudia.locator('[data-testid="automation-badge"][data-role="trigger"]').count()) !== 1) throw new Error('trigger badge');
  if ((await claudia.locator('[data-testid="automation-badge"][data-role="action"]').count()) !== 1) throw new Error('action badge');
  await claudia.locator('[data-testid="flow-node"][data-text="Tell the team"]').click();
  await claudia.getByTestId('inspector-automation').click();
  await claudia.getByTestId('automation-role').selectOption('action');
  await claudia.getByTestId('automation-type').selectOption('notify');
  const explain = await claudia.getByTestId('automation-explain').innerText();
  if (!/bell/i.test(explain)) throw new Error(`explanation: ${explain}`);
  await claudia.getByTestId('action-title').fill('Hello from {{flow.name}} — {{trigger.input.who}}');
  await claudia.locator('[data-testid="flow-node"][data-text="Tell the team"][data-automation="action"]').waitFor({ timeout: 15000 });
});

await step('the Runs tab: switch, triggers, Run now with input → steps and status', claudia, async () => {
  await claudia.getByTestId('flow-tab-runs').click();
  await claudia.getByTestId('runs-panel').waitFor();
  if ((await claudia.getByTestId('trigger-row').count()) !== 1) throw new Error('trigger row');
  await claudia.getByRole('button', { name: 'With input…' }).click();
  await claudia.getByLabel('Run input (JSON)').fill('{"who": "Aiko"}');
  await claudia.getByTestId('run-now').click();
  await claudia.locator('[data-testid="run-detail"][data-status="waiting"]').waitFor({ timeout: 30000 });
  if ((await claudia.locator('[data-testid="run-step"][data-node="w"][data-status="waiting"]').count()) !== 1) throw new Error('wait step');
});

await step('Continue now finishes the run; the notification step shows the filled template', claudia, async () => {
  await claudia.getByTestId('run-resume').click();
  await claudia.locator('[data-testid="run-detail"][data-status="succeeded"]').waitFor({ timeout: 30000 });
  await claudia.locator('[data-testid="run-step"][data-node="t"][data-status="ok"]').waitFor();
  await claudia.locator('[data-testid="run-step"][data-node="t"]').getByText('details').click();
  const detail = await claudia.locator('[data-testid="run-step"][data-node="t"] pre').innerText();
  if (!detail.includes(`Hello from Auto e2e ${n} — Aiko`)) throw new Error(detail);
  if ((await claudia.locator('[data-testid="run-row"][data-status="succeeded"]').count()) !== 1) throw new Error('run list');
});

await step('the automation switch turns the flow on and is reflected in Workflow Info', claudia, async () => {
  await claudia.getByTestId('automation-switch').click();
  await claudia.locator('[data-testid="automation-switch"][aria-checked="true"]').waitFor({ timeout: 15000 });
  const auto = await (async () => {
    for (let i = 0; i < 20; i++) {
      const a = (await api('GET', `/flows/${flow.id}/automation`, claudiaId)).data;
      if (a.enabled) return a;
      await new Promise((r) => setTimeout(r, 500));
    }
    return null;
  })();
  if (!auto?.enabled || !auto.triggers.every((t) => t.enabled)) throw new Error('not enabled on the server');
  await claudia.getByTestId('flow-tab-design').click();
  await claudia.locator('[data-testid="flow-node"][data-text="Start"]').click();
  await claudia.getByTestId('inspector-style').click();
  if (!(await claudia.getByTestId('info-automation').isChecked())) throw new Error('info checkbox');
});

await step('a step turned into a Trigger shows what it needs in the Runs tab', claudia, async () => {
  await claudia.locator('[data-testid="flow-node"][data-text="Tell the team"]').click();
  await claudia.getByTestId('inspector-automation').click();
  await claudia.getByTestId('automation-role').selectOption('trigger');
  await claudia.getByTestId('automation-type').selectOption('form.submitted');
  await claudia.getByTestId('flow-tab-runs').click();
  await claudia.getByTestId('automation-problems').waitFor({ timeout: 15000 });
  if (!/form/.test(await claudia.getByTestId('automation-problems').innerText())) throw new Error('problem text');
  if ((await claudia.getByTestId('trigger-row').count()) !== 2) throw new Error('trigger rows');
});

await step('the shape library explains each shape and has the BPMN sets', claudia, async () => {
  await claudia.getByTestId('flow-tab-design').click();
  await claudia.getByLabel('Search shapes').fill('timer');
  const tile = claudia.locator('[data-testid="shape-tile"][data-shape="bpmnStartTimer"]');
  await tile.waitFor({ timeout: 15000 });
  if (!/timer/i.test((await tile.getAttribute('title')) ?? '')) throw new Error('no description');
  await claudia.getByLabel('Search shapes').fill('');
  for (const c of ['BPMN Events', 'BPMN Activities', 'BPMN Gateways', 'Entity Relationship', 'UML']) await claudia.getByRole('button', { name: new RegExp(c) }).waitFor();
});

await step('ER tables with attribute rows and a 1 — n connector preset', claudia, async () => {
  await claudia.getByLabel('Search shapes').fill('table');
  await claudia.locator('[data-testid="shape-tile"][data-shape="erEntity"]').click();
  await claudia.locator('[data-testid="flow-node"][data-shape="erEntity"]').waitFor({ timeout: 15000 });
  if (!((await claudia.locator('[data-testid="flow-node"][data-shape="erEntity"]').textContent()) ?? '').includes('PK id')) throw new Error('attribute rows');
  await claudia.locator('[data-testid="edge-hit"]').first().click({ force: true });
  await claudia.getByTestId('edge-preset').selectOption('er1n');
  await claudia.locator('[data-testid="edge-preset"]').waitFor();
  if ((await claudia.getByLabel('End arrow').inputValue()) !== 'crowMany' || (await claudia.getByLabel('Start arrow').inputValue()) !== 'crowOne') throw new Error('preset not applied');
  await claudia.getByLabel('Search shapes').fill('');
});

await api('POST', `/resources/${flow.id}/trash`, claudiaId);
await api('DELETE', `/resources/${flow.id}`, claudiaId);
await browser.close();
if (errors.length) console.log('page errors:', errors);
console.log(fails ? `\n${fails} failed` : '\nall flow automation e2e steps passed');
process.exit(fails || errors.length ? 1 : 0);
