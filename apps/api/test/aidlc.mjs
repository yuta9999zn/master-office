// AI-DLC (§76, batch 4c): a project that starts with the Inception / Construction / Operations phases (exit criteria,
// stage gates), plans in bolts of days with kickoff / review / retro rituals and no daily, and recommends the
// AI-DLC documentation set.   node apps/api/test/aidlc.mjs
const API = process.env.API_URL ?? 'http://localhost:4000';
let failures = 0;
const check = (name, cond, extra) => {
  console.log(`${cond ? '✓' : '✗'} ${name}${cond ? '' : ' ' + JSON.stringify(extra ?? '')}`);
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
const users = (await call('GET', '/users')).data;
const uid = (key) => users.find((u) => u.email === `${key}@kaori.jp`).id;
const [fujita, mika] = ['fujita', 'mika'].map(uid);
const spaces = (await call('GET', '/spaces', { user: fujita })).data;
const n = Date.now() % 100000;
const created = await call('POST', '/tasks/projects', { user: fujita, body: { spaceId: spaces.find((s) => s.name === 'ITM Japan').id, name: `AI booking ${n}`, key: `AI${n}`, methodology: 'ai-dlc' } });
const proj = created.data;
check('an AI-DLC project', created.status === 201 && proj.methodology === 'ai-dlc', created.data);
check('… plans in bolts of 2 days', proj.sprintDays === 2);

// ── The three phases ────────────────────────────────────────────────────────
const all = (await call('GET', `/tasks?project=${proj.id}`, { user: fujita })).data;
const phases = all.filter((t) => t.type === 'phase').sort((a, b) => a.startDate.localeCompare(b.startDate));
check('it starts with Inception → Construction → Operations', phases.map((p) => p.title).join() === 'Inception,Construction,Operations', phases.map((p) => p.title));
check('… back to back on the plan (1, 3 and 1 weeks)', phases.every((p, i) => !i || Date.parse(p.startDate) - Date.parse(phases[i - 1].dueDate) === 86_400_000) && (Date.parse(phases[1].dueDate) - Date.parse(phases[1].startDate)) / 86_400_000 === 20, phases.map((p) => [p.startDate, p.dueDate]));
check('… each with exit criteria and a gate', phases.every((p) => p.criteria.length === 4 && p.criteria.every((c) => !c.done) && p.gate?.status === 'none'), phases.map((p) => p.criteria.length));
check('… and a description of its ritual', phases[0].description?.startsWith('Mob elaboration') && phases[1].description?.startsWith('Mob construction'), phases[0].description);
const inception = phases[0];
await call('PATCH', `/tasks/projects/${proj.id}`, { user: fujita, body: { strictWorkflow: false } });
check('an AI-DLC phase needs its gate approved to close', (await call('PATCH', `/tasks/${inception.id}`, { user: fujita, body: { status: 'done' } })).data.message === 'Get the phase gate approved before closing the phase');
await call('PATCH', `/tasks/${inception.id}`, { user: fujita, body: { criteria: inception.criteria.map((c) => ({ ...c, done: true })) } });
await call('POST', `/tasks/${inception.id}/gate/request`, { user: fujita, body: { approverIds: [mika] } });
await call('POST', `/tasks/${inception.id}/gate/decide`, { user: mika, body: { decision: 'approve' } });
check('… and closes once approved', (await call('PATCH', `/tasks/${inception.id}`, { user: fujita, body: { status: 'done' } })).data.completedAt !== null);

// ── Units of work and bolts ─────────────────────────────────────────────────
const unit = (await call('POST', '/tasks', { user: fujita, body: { projectId: proj.id, title: 'Booking unit', type: 'epic', parentId: phases[1].id } })).data;
const story = (await call('POST', '/tasks', { user: fujita, body: { projectId: proj.id, title: 'Reserve a room', type: 'story', parentId: unit.id, storyPoints: 3, assigneeId: mika } })).data;
check('units of work (epics) sit in Construction', unit.parentId === phases[1].id && story.parentId === unit.id);
const bolt = (await call('POST', `/tasks/projects/${proj.id}/sprints`, { user: fujita, body: {} })).data;
check('a bolt is named so and lasts the project length', bolt.name === `AI${n} Bolt 1` && (Date.parse(bolt.endDate) - Date.parse(bolt.startDate)) / 86_400_000 === 1, bolt);
await call('PATCH', `/tasks/${story.id}`, { user: fujita, body: { sprintId: bolt.id } });
const started = await call('POST', `/tasks/sprints/${bolt.id}/start`, { user: fujita, body: { ceremonies: { schedule: true } } });
check('starting a bolt schedules kickoff, review and retro — no daily', started.status === 200 && Object.keys(started.data.ceremonies).sort().join() === 'planning,retro,review', started.data.ceremonies);
const ev = (await call('GET', `/calendar/events/${started.data.ceremonies.planning}`, { user: fujita })).data;
check('… the kickoff is 30 minutes to approve the AI plan', ev.title === `AI${n} Bolt 1 · Bolt Kickoff` && (Date.parse(ev.end) - Date.parse(ev.start)) / 60_000 === 30 && ev.description.includes('approve the plan the AI proposes'), ev);
const retro = (await call('GET', `/calendar/events/${started.data.ceremonies.retro}`, { user: fujita })).data;
check('… the retro looks at prompts and reviews', retro.title.endsWith('Bolt Retrospective') && retro.description.includes('prompts'), retro.title);

// ── Documentation ───────────────────────────────────────────────────────────
const docs = await call('POST', `/tasks/projects/${proj.id}/docs/setup`, { user: fujita, body: {} });
const pages = (docs.data?.nodes ?? []).filter((x) => x.type === 'document').map((x) => x.name);
check('the docs space starts with the AI-DLC set', pages.length === 8 && pages.some((x) => x.includes('Intent')) && pages.some((x) => x.includes('Bolt Plan')), pages);

console.log(failures ? `\n${failures} check(s) failed` : '\nall AI-DLC checks passed');
process.exit(failures ? 1 : 0);
