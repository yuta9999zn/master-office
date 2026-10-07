// Project documentation spaces (§76, batch 3): setting up a Confluence-style space from a starter set (agile,
// waterfall, AI-DLC), pages from the BA / AI-DLC templates in their section folders, permissions from the Space,
// requirements traceability (issue ↔ page), and making issues from the lines of a page.
// node apps/api/test/project-docs.mjs
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
const [fujita, mika, hana, ken] = ['fujita', 'mika', 'hana', 'ken'].map(uid);
const spaces = (await call('GET', '/spaces', { user: fujita })).data;
const itm = spaces.find((s) => s.name === 'ITM Japan').id;
const n = Date.now() % 100000;

// ── Setting up ──────────────────────────────────────────────────────────────
const wf = (await call('POST', '/tasks/projects', { user: fujita, body: { spaceId: itm, name: `Core banking ${n}`, key: `CB${n}`, methodology: 'waterfall' } })).data;
check('a project starts without a documentation space', (await call('GET', `/tasks/projects/${wf.id}/docs`, { user: fujita })).data.folderId === null);
check('viewers cannot set it up', (await call('POST', `/tasks/projects/${wf.id}/docs/setup`, { user: hana, body: {} })).status === 403);
const set = await call('POST', `/tasks/projects/${wf.id}/docs/setup`, { user: fujita, body: {} });
const names = set.data?.nodes?.map((x) => x.name) ?? [];
// Sections are top-level pages without a template (§78 wiki space).
const sectionIds = new Set(set.data?.nodes?.filter((x) => !x.parentId && !x.name.includes(' · ') && !x.name.endsWith(' home')).map((x) => x.id) ?? []);
const folders = set.data?.nodes?.filter((x) => sectionIds.has(x.id)).map((x) => x.name) ?? [];
check('waterfall projects get the waterfall set: business case, BRD, FRD, SRS, RTM, test plan…', set.status === 201 && ['BC', 'CBA', 'BRD', 'FRD', 'SRS', 'RTM', 'TP', 'TC', 'CR', 'RAID'].every((c) => names.some((x) => x.startsWith(`CB${n} · ${c} — `))), names);
check('… filed under section pages of the project wiki space', !!set.data.spaceId && ['Business', 'Requirements', 'Design', 'Delivery & Quality'].every((f) => folders.includes(f)) && set.data.nodes.filter((x) => x.name.includes(' · ')).every((x) => sectionIds.has(x.parentId)), folders);
const again = await call('POST', `/tasks/projects/${wf.id}/docs/setup`, { user: fujita, body: {} });
check('setting up again adds nothing twice', again.data.nodes.length === set.data.nodes.length);
const brd = set.data.nodes.find((x) => x.name.includes('· BRD —'));
const brdRes = (await call('GET', `/resources/${brd.id}`, { user: fujita })).data;
check('pages are wiki pages in the project Space', brdRes.type === 'wiki' && brdRes.spaceId === itm);
check('space viewers read the docs space', (await call('GET', `/tasks/projects/${wf.id}/docs`, { user: hana })).data.nodes.length === set.data.nodes.length);
const items = (await call('GET', `/tasks/docs/${brd.id}/items`, { user: fujita })).data;
check('the template content is in the page (BRD sections and their lines)', items.some((i) => i.section === '4. Scope' && i.text === 'In scope') && items.some((i) => i.section === '9. Non-functional needs' && i.text === 'Security'), items.slice(0, 8));

// ── AI-DLC set, single pages ────────────────────────────────────────────────
const ag = (await call('POST', '/tasks/projects', { user: fujita, body: { spaceId: itm, name: `Assistant ${n}`, key: `AI${n}`, methodology: 'scrum' } })).data;
const ai = await call('POST', `/tasks/projects/${ag.id}/docs/setup`, { user: fujita, body: { set: 'ai-dlc' } });
check('the AI-DLC set: intent, inception, units of work, domain, logical design, bolt plan, runbook', ['INT', 'INC', 'UOW', 'DOM', 'LD', 'BOLT', 'OPS'].every((c) => ai.data.nodes.some((x) => x.name.startsWith(`AI${n} · ${c} — `))) && ai.data.nodes.some((x) => x.name === 'AI-DLC' && !x.parentId), ai.data.nodes.map((x) => x.name));
const uc = await call('POST', `/tasks/projects/${ag.id}/docs`, { user: mika, body: { template: 'pd-use-case' } });
check('a single page from a template, into its section', uc.status === 201 && uc.data.name === `AI${n} · UC — Use Case Specification`);
const ALL = ['pd-business-case', 'pd-cba', 'pd-vision', 'pd-scope', 'pd-stakeholders', 'pd-raci', 'pd-comms', 'pd-brd', 'pd-frd', 'pd-srs', 'pd-prd', 'pd-use-case', 'pd-user-stories', 'pd-solution-design', 'pd-rmp', 'pd-rtm', 'pd-raid', 'pd-change-request', 'pd-test-plan', 'pd-test-cases', 'pd-dod', 'pd-release-notes', 'pd-sprint-planning', 'pd-sprint-review', 'pd-retro', 'pd-aidlc-intent', 'pd-aidlc-inception', 'pd-aidlc-units', 'pd-aidlc-domain', 'pd-aidlc-logical', 'pd-aidlc-bolt', 'pd-aidlc-ops'];
const all = [];
for (const id of ALL) all.push((await call('POST', `/tasks/projects/${ag.id}/docs`, { user: mika, body: { template: id, name: `T ${id}` } })).status);
check('every template makes a valid page', all.every((s) => s === 201), ALL.filter((_, i) => all[i] !== 201));
check('unknown templates are refused', (await call('POST', `/tasks/projects/${ag.id}/docs`, { user: mika, body: { template: 'nope' } })).status === 400);
const blank = await call('POST', `/tasks/projects/${ag.id}/docs`, { user: mika, body: { name: 'Glossary' } });
check('a blank page', blank.status === 201 && blank.data.name === 'Glossary');

// ── Issues from a page, traceability ────────────────────────────────────────
const stories = (await call('POST', `/tasks/projects/${ag.id}/docs`, { user: fujita, body: { template: 'pd-user-stories' } })).data;
const lines = (await call('GET', `/tasks/docs/${stories.id}/items`, { user: fujita })).data;
const storyLines = lines.filter((l) => l.section === 'Stories');
check('the lines of a page that can become issues', storyLines.length === 3 && storyLines[0].text.startsWith('As a customer'), lines);
const made = await call('POST', `/tasks/projects/${ag.id}/docs/${stories.id}/issues`, { user: fujita, body: { items: storyLines.map((l) => l.text) } });
check('creating stories from those lines', made.status === 201 && made.data.length === 3 && made.data.every((t) => t.type === 'story'));
const d0 = (await call('GET', `/tasks/${made.data[0].id}`, { user: fujita })).data;
check('… each linked to the page', d0.docs.length === 1 && d0.docs[0].id === stories.id && d0.docs[0].accessible);
const task = (await call('POST', '/tasks', { user: fujita, body: { projectId: ag.id, title: 'Draft the intent', type: 'task' } })).data;
const intent = ai.data.nodes.find((x) => x.name.includes('· INT —'));
check('linking an issue to a page', (await call('POST', `/tasks/${task.id}/docs`, { user: fujita, body: { resourceId: intent.id } })).data.some((d) => d.id === intent.id));
check('viewers cannot link', (await call('POST', `/tasks/${task.id}/docs`, { user: hana, body: { resourceId: intent.id } })).status === 403);
check('only documents are linked', (await call('POST', `/tasks/${task.id}/docs`, { user: fujita, body: { resourceId: ai.data.folderId } })).status === 400);
const tr = (await call('GET', `/tasks/projects/${ag.id}/traceability`, { user: hana })).data;
const row = tr.find((r) => r.doc.id === stories.id);
check('traceability: each page with the issues that implement it', row?.issues.length === 3 && tr.find((r) => r.doc.id === intent.id).issues[0].title === 'Draft the intent' && tr.some((r) => r.issues.length === 0), tr.map((r) => [r.doc.name, r.issues.length]));
await call('PATCH', `/tasks/${made.data[0].id}`, { user: fujita, body: { status: 'doing' } });
check('the tree counts linked issues', (await call('GET', `/tasks/projects/${ag.id}/docs`, { user: fujita })).data.nodes.find((x) => x.id === stories.id).linked === 3);
check('unlinking', (await call('DELETE', `/tasks/${task.id}/docs/${intent.id}`, { user: fujita })).data.length === 0);
void ken;

console.log(failures ? `\n${failures} failed` : '\nall project docs checks passed');
process.exit(failures ? 1 : 0);
