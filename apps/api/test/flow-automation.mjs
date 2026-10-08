// Flow automation (§77, batch 2): the diagram runs — a manual trigger with input, a condition picking the Yes / No
// connector, actions (notification, task, e-mail, Base record), {{templates}}, a Wait that parks the run and is
// continued or cancelled, triggers from other modules (Base record created, task status changed) that start only
// enabled flows that match, a schedule trigger's next run, validation problems, the loop guard, permissions, import.
//   node apps/api/test/flow-automation.mjs   (dev mode API + seed)
const API = process.env.API_URL ?? 'http://localhost:4000';
let failures = 0;
const check = (name, cond, extra) => {
  console.log(`${cond ? '✓' : '✗'} ${name}${cond ? '' : ' ' + JSON.stringify(extra ?? '').slice(0, 600)}`);
  if (!cond) failures++;
};
async function call(method, path, { user, body } = {}) {
  const headers = {};
  if (user) headers['x-user-id'] = user;
  if (body) headers['content-type'] = 'application/json';
  const res = await fetch(API + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 8000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) return null;
    await sleep(250);
  }
}
const users = (await call('GET', '/users')).data;
const uid = (key) => users.find((u) => u.email === `${key}@kaori.jp`).id;
const [claudia, ken, hana] = ['claudia', 'ken', 'hana'].map(uid);
const n = Date.now() % 100000;

// A diagram builder: nodes with automation roles, edges with labels.
const P = 'p1';
let seq = 0;
const node = (id, text, automation = null, shape = 'process') => ({ id, page: P, shape, x: 100, y: 100 + 80 * seq++, w: 180, h: 56, text, icon: null, style: {}, z: 0, data: {}, automation });
const edge = (from, to, label = '') => ({ id: `${from}-${to}`, page: P, from, to, fromSide: null, toSide: null, label, style: {} });
const diagram = (nodes, edges, info = {}) => ({ info: { version: '1.0.0', status: 'published', trigger: 'Manual', tags: [], description: '', automation: true, ...info }, pages: [{ id: P, name: 'Page 1' }], nodes, edges });
const trigger = (type, config = {}) => ({ role: 'trigger', type, config });
const action = (type, config) => ({ role: 'action', type, config });
const condition = (left, op, right) => ({ role: 'condition', type: '', config: { left, op, right } });

const projects = (await call('GET', '/tasks/projects', { user: claudia })).data;
const project = projects.find((p) => p.name === 'Website Redesign') ?? projects[0];

// ── A new flow knows its trigger ────────────────────────────────────────────
const flow = (await call('POST', '/resources', { user: claudia, body: { name: `Automation ${n}`, type: 'flow' } })).data;
let auto = (await call('GET', `/flows/${flow.id}/automation`, { user: claudia })).data;
check('a blank flow starts with a manual trigger on Start, automation off', auto.enabled === false && auto.triggers.some((t) => t.type === 'manual' && t.nodeId === 'n1') && auto.problems.length === 0, auto);
check('outsiders see nothing', (await call('GET', `/flows/${flow.id}/automation`, { user: ken })).status === 404 && (await call('GET', `/flows/${flow.id}/runs`, { user: ken })).status === 404);

// ── Import a runnable diagram: manual → condition → notify + task | e-mail ──
const d1 = diagram(
  [
    node('start', 'Start', trigger('manual'), 'terminal'),
    node('check', 'Seats left?', condition('{{trigger.input.seats}}', 'gt', '0'), 'decision'),
    node('notify', 'Tell the requester', action('notify', { title: 'Booking for {{trigger.input.name}}: {{trigger.input.seats}} seats', body: 'Confirmed by {{flow.name}}' })),
    node('task', 'Create task', action('task.create', { projectId: project.id, title: 'Booking: {{trigger.input.name}} ({{trigger.input.seats}} seats)', description: 'Run {{trigger.by.name}}' })),
    node('mail', 'Suggest another time', action('mail.send', { to: '{{trigger.input.email}}', subject: 'No seats left, {{trigger.input.name}}', body: 'Sorry {{trigger.input.name}}.' })),
    node('end', 'End', null, 'terminal'),
  ],
  [edge('start', 'check'), edge('check', 'notify', 'Yes'), edge('notify', 'task'), edge('task', 'end'), edge('check', 'mail', 'No'), edge('mail', 'end')],
);
const imp = await call('POST', `/flows/${flow.id}/import`, { user: claudia, body: d1 });
check('a diagram is imported (the .json export) and re-indexed', imp.status === 200 && imp.data.nodes === 6, imp);
auto = (await call('GET', `/flows/${flow.id}/automation`, { user: claudia })).data;
check('… automation on, one manual trigger, no problems', auto.enabled === true && auto.triggers.length === 1 && auto.problems.length === 0, auto);
check('viewers can’t run it', (await call('POST', `/flows/${flow.id}/run`, { user: ken, body: {} })).status === 404);

const unread0 = (await call('GET', '/notifications/unread-count', { user: claudia })).data?.count ?? null;
let run = (await call('POST', `/flows/${flow.id}/run`, { user: claudia, body: { input: { seats: 3, name: 'Aiko', email: 'aiko@example.com' } } })).data;
check('Run now walks the Yes branch: trigger → condition → notify → task → end', run.status === 'succeeded' && run.steps.map((s) => s.nodeId).join('>') === 'start>check>notify>task>end', run.steps?.map((s) => `${s.nodeId}:${s.status}`));
check('… the condition recorded its branch and values', run.steps[1].branch === 'yes' && run.steps[1].output.left === 3, run.steps[1]);
check('… the notification went to the person who ran it, with templates filled', run.steps[2].output.userIds.includes(claudia) && run.steps[2].output.title === 'Booking for Aiko: 3 seats', run.steps[2]);
const taskId = run.steps[3].output.taskId;
const task = (await call('GET', `/tasks/${taskId}`, { user: claudia })).data;
check('… a real task exists with the rendered title', task?.title === 'Booking: Aiko (3 seats)' && task.projectId === project.id && /Claudia/.test(task.description ?? ''), task);
const unread1 = (await call('GET', '/notifications/unread-count', { user: claudia })).data?.count ?? null;
check('… and a bell notification arrived', unread0 === null || unread1 > unread0, { unread0, unread1 });
check('the run says who started it', run.runBy?.id === claudia && run.triggerType === 'manual' && run.trigger.input.seats === 3);

run = (await call('POST', `/flows/${flow.id}/run`, { user: claudia, body: { input: { seats: 0, name: 'Bao', email: 'bao@example.com' } } })).data;
check('seats = 0 takes the No branch and sends the e-mail', run.status === 'succeeded' && run.steps.map((s) => s.nodeId).join('>') === 'start>check>mail>end' && run.steps[2].output.to[0] === 'bao@example.com' && run.steps[2].output.subject === 'No seats left, Bao', run.steps?.map((s) => s.nodeId));
const runs = (await call('GET', `/flows/${flow.id}/runs`, { user: claudia })).data;
check('runs are listed, newest first', runs.length === 2 && runs[0].id === run.id && runs.every((r) => r.status === 'succeeded'));
check('a single run can be fetched', (await call('GET', `/flows/${flow.id}/runs/${run.id}`, { user: claudia })).data.id === run.id);

// ── Problems, missing config, failures ──────────────────────────────────────
const bad = diagram([node('s', 'Start', trigger('form.submitted', {}), 'terminal'), node('a', 'Mail', action('mail.send', { subject: 'x' })), node('c', 'Ok?', condition('', 'eq', ''), 'decision'), node('lonely', 'Never', action('notify', { title: 'x' }))], [edge('s', 'a'), edge('a', 'c')]);
await call('POST', `/flows/${flow.id}/import`, { user: claudia, body: bad });
auto = (await call('GET', `/flows/${flow.id}/automation`, { user: claudia })).data;
check('validation lists what is missing: the form, the recipient, the condition value, the Yes / No connectors, an unconnected action', auto.problems.length >= 5 && auto.problems.some((p) => /form/.test(p.text)) && auto.problems.some((p) => /“Mail”.*to/.test(p.text)) && auto.problems.some((p) => /“Never”/.test(p.text)), auto.problems);
run = (await call('POST', `/flows/${flow.id}/run`, { user: claudia, body: {} })).data;
check('a run with a half-configured action fails at that step with the reason', run.status === 'failed' && run.steps.find((s) => s.nodeId === 'a')?.status === 'error' && /"to" is not set/.test(run.error), run);

const loop = diagram([node('s', 'Start', trigger('manual'), 'terminal'), node('a', 'A'), node('b', 'B')], [edge('s', 'a'), edge('a', 'b'), edge('b', 'a')]);
await call('POST', `/flows/${flow.id}/import`, { user: claudia, body: loop });
run = (await call('POST', `/flows/${flow.id}/run`, { user: claudia, body: {} })).data;
check('a looping diagram is stopped', run.status === 'failed' && /loops/.test(run.error), run.error);

const hook = diagram([node('s', 'Start', trigger('manual'), 'terminal'), node('w', 'Webhook', action('webhook', { url: 'http://127.0.0.1:9/x' }))], [edge('s', 'w')]);
await call('POST', `/flows/${flow.id}/import`, { user: claudia, body: hook });
run = (await call('POST', `/flows/${flow.id}/run`, { user: claudia, body: {} })).data;
check('webhooks to local addresses are refused', run.status === 'failed' && /local addresses/.test(run.error), run.error);

// ── Wait: the run parks, then continues or is cancelled ─────────────────────
const wait = diagram([node('s', 'Start', trigger('manual'), 'terminal'), node('w', 'Wait', action('delay', { minutes: 30 }), 'delay'), node('nt', 'Then notify', action('notify', { title: 'After the wait: {{trigger.input.x}}' }))], [edge('s', 'w'), edge('w', 'nt')]);
await call('POST', `/flows/${flow.id}/import`, { user: claudia, body: wait });
run = (await call('POST', `/flows/${flow.id}/run`, { user: claudia, body: { input: { x: 'done' } } })).data;
check('a Wait parks the run with a resume time', run.status === 'waiting' && run.steps[1].status === 'waiting' && new Date(run.resumeAt) > new Date(Date.now() + 25 * 60_000), run);
auto = (await call('GET', `/flows/${flow.id}/automation`, { user: claudia })).data;
check('the automation status counts waiting runs', auto.counts.waiting >= 1, auto.counts);
const resumed = (await call('POST', `/flows/${flow.id}/runs/${run.id}/resume`, { user: claudia })).data;
check('Continue now finishes it: the wait step closes, the next action runs with the trigger input', resumed.status === 'succeeded' && resumed.steps[1].status === 'ok' && resumed.steps[2].output.title === 'After the wait: done', resumed.steps);
check('a finished run cannot be continued again', (await call('POST', `/flows/${flow.id}/runs/${run.id}/resume`, { user: claudia })).status === 400);
const run2 = (await call('POST', `/flows/${flow.id}/run`, { user: claudia, body: {} })).data;
const cancelled = (await call('POST', `/flows/${flow.id}/runs/${run2.id}/cancel`, { user: claudia })).data;
check('a waiting run can be cancelled', cancelled.status === 'cancelled' && cancelled.finishedAt, cancelled);

// ── Triggers from other modules: Base record created ────────────────────────
const base = (await call('POST', '/resources', { user: claudia, body: { name: `Leads ${n}`, type: 'base' } })).data;
const schema = (await call('GET', `/base/${base.id}`, { user: claudia })).data;
const table = schema.tables[0];
const nameField = table.fields.find((f) => f.type === 'text') ?? table.fields[0];
const other = (await call('POST', `/base/${base.id}/tables`, { user: claudia, body: { name: 'Other' } })).data;
const onRecord = diagram(
  [node('s', 'New lead', trigger('base.recordCreated', { tableId: table.id }), 'terminal'), node('nt', 'Notify', action('notify', { title: 'New lead: {{trigger.record.' + nameField.name + '}} in {{trigger.tableName}}', userIds: [hana] }))],
  [edge('s', 'nt')],
);
await call('POST', `/flows/${flow.id}/import`, { user: claudia, body: onRecord });
auto = (await call('GET', `/flows/${flow.id}/automation`, { user: claudia })).data;
check('the Base trigger is indexed with its table', auto.triggers.length === 1 && auto.triggers[0].type === 'base.recordCreated' && auto.triggers[0].config.tableId === table.id && auto.triggers[0].enabled === true, auto.triggers);
await call('POST', `/base/tables/${other.id}/records`, { user: claudia, body: { records: [{ values: {} }] } });
await call('POST', `/base/tables/${table.id}/records`, { user: claudia, body: { records: [{ values: { [nameField.id]: 'Nguyen Van A' } }] } });
let fired = await waitFor(async () => (await call('GET', `/flows/${flow.id}/runs`, { user: claudia })).data.find((r) => r.triggerType === 'base.recordCreated' && r.status !== 'running'));
check('a record in the chosen table starts the flow (the other table does not)', fired && fired.status === 'succeeded' && (await call('GET', `/flows/${flow.id}/runs`, { user: claudia })).data.filter((r) => r.triggerType === 'base.recordCreated').length === 1, fired);
check('… the record is readable by field name in templates and the notification reached the chosen person', fired?.steps[1]?.output?.title === `New lead: Nguyen Van A in ${table.name}` && fired?.steps[1]?.output?.userIds?.includes(hana), fired?.steps);
check('… the trigger payload carries ids for later actions', fired?.trigger?.recordId && fired?.trigger?.tableId === table.id && fired?.trigger?.baseId === base.id);

// Off switch: nothing starts while automation is off.
let off = (await call('PUT', `/flows/${flow.id}/automation`, { user: claudia, body: { enabled: false } })).data;
check('Automation can be switched off', off.enabled === false && off.triggers[0].enabled === false, off);
await call('POST', `/base/tables/${table.id}/records`, { user: claudia, body: { records: [{ values: { [nameField.id]: 'Quiet' } }] } });
await sleep(1200);
check('… and then records start nothing', (await call('GET', `/flows/${flow.id}/runs`, { user: claudia })).data.filter((r) => r.triggerType === 'base.recordCreated').length === 1);
off = (await call('PUT', `/flows/${flow.id}/automation`, { user: claudia, body: { enabled: true } })).data;
check('… back on', off.enabled === true && off.triggers[0].enabled === true);

// Record update → update another record (the same one) through an action.
const onUpdate = diagram(
  [node('s', 'Changed', trigger('base.recordUpdated', { tableId: table.id }), 'terminal'), node('u', 'Stamp it', action('base.updateRecord', { tableId: table.id, recordId: '{{trigger.recordId}}', values: { [nameField.id]: '{{trigger.record.' + nameField.name + '}} ✓' } }))],
  [edge('s', 'u')],
);
await call('POST', `/flows/${flow.id}/import`, { user: claudia, body: onUpdate });
const recs = (await call('GET', `/base/tables/${table.id}/records`, { user: claudia })).data;
const rec = (recs.items ?? recs).find((r) => r.values[nameField.id] === 'Nguyen Van A');
await call('PATCH', `/base/records`, { user: claudia, body: { records: [{ id: rec.id, values: { [nameField.id]: 'Nguyen Van B' } }] } });
fired = await waitFor(async () => (await call('GET', `/flows/${flow.id}/runs`, { user: claudia })).data.find((r) => r.triggerType === 'base.recordUpdated' && r.status !== 'running'));
const after = (await call('GET', `/base/tables/${table.id}/records`, { user: claudia })).data;
check('a record update starts the flow, which stamps the record once — its own write does not re-trigger it', fired?.status === 'succeeded' && (after.items ?? after).find((r) => r.id === rec.id)?.values[nameField.id] === 'Nguyen Van B ✓', { fired: fired?.steps, after: (after.items ?? after).find((r) => r.id === rec.id)?.values });
await sleep(1500);
const updRuns = (await call('GET', `/flows/${flow.id}/runs`, { user: claudia })).data.filter((r) => r.triggerType === 'base.recordUpdated');
check('… exactly one run: a flow never restarts itself from its own actions', updRuns.length === 1 && updRuns[0].status === 'succeeded', updRuns.length);

// ── Task status changed, filtered by project and status ─────────────────────
const statuses = project.statuses ?? (await call('GET', `/tasks/projects`, { user: claudia })).data.find((p) => p.id === project.id)?.statuses ?? [];
const done = statuses.find((s) => s.category === 'done') ?? statuses[statuses.length - 1];
const onDone = diagram(
  [node('s', 'Task done', trigger('task.statusChanged', { projectId: project.id, toStatus: done?.id ?? '' }), 'terminal'), node('nt', 'Tell', action('notify', { title: '{{trigger.title}} moved {{trigger.from}} → {{trigger.to}}', userIds: [claudia] }))],
  [edge('s', 'nt')],
);
await call('POST', `/flows/${flow.id}/import`, { user: claudia, body: onDone });
const t2 = (await call('POST', '/tasks', { user: claudia, body: { projectId: project.id, title: `Flow task ${n}` } })).data;
const otherStatus = statuses.find((s) => s.id !== t2.status && s.id !== done?.id);
if (otherStatus) await call('PATCH', `/tasks/${t2.id}`, { user: claudia, body: { status: otherStatus.id } });
await sleep(800);
const before = (await call('GET', `/flows/${flow.id}/runs`, { user: claudia })).data.filter((r) => r.triggerType === 'task.statusChanged').length;
check('a move to another status is ignored when the trigger waits for Done', before === 0, before);
const moved = await call('PATCH', `/tasks/${t2.id}`, { user: claudia, body: { status: done?.id } });
fired = moved.status < 300 ? await waitFor(async () => (await call('GET', `/flows/${flow.id}/runs`, { user: claudia })).data.find((r) => r.triggerType === 'task.statusChanged' && r.status !== 'running')) : null;
check('moving the task to Done starts the flow with from / to in the payload', fired?.status === 'succeeded' && fired.steps[1].output.title.includes(`Flow task ${n} moved`) && fired.steps[1].output.title.endsWith(`→ ${done.id}`), { moved: moved.status, fired: fired?.steps });

// ── Schedule: the next run is planned when automation is on ─────────────────
const sched = diagram([node('s', 'Every 5 min', trigger('schedule', { schedule: { every: 'minutes', n: 5 } }), 'terminal'), node('nt', 'Ping', action('notify', { title: 'tick', userIds: [claudia] }))], [edge('s', 'nt')]);
await call('POST', `/flows/${flow.id}/import`, { user: claudia, body: sched });
auto = (await call('GET', `/flows/${flow.id}/automation`, { user: claudia })).data;
const next = new Date(auto.triggers[0]?.nextRunAt ?? 0).getTime() - Date.now();
check('a schedule trigger has its next run within 5 minutes', auto.triggers[0]?.type === 'schedule' && next > 0 && next <= 5 * 60_000 + 2000, auto.triggers);
check('Run now also works for a schedule trigger (as a test run)', (await call('POST', `/flows/${flow.id}/run`, { user: claudia, body: {} })).data.status === 'succeeded');

// ── Clean up ───────────────────────────────────────────────────────────────
for (const id of [flow.id, base.id]) {
  await call('POST', `/resources/${id}/trash`, { user: claudia });
  await call('DELETE', `/resources/${id}`, { user: claudia });
}
await call('POST', `/tasks/${taskId}/trash`, { user: claudia }).catch(() => undefined);

console.log(failures ? `\n${failures} check(s) failed` : '\nall flow automation checks passed');
process.exit(failures ? 1 : 0);
