// Wiki (§78): Confluence-style spaces — a home page, the BA starter set filed under section pages, a page tree
// (create under, move, reorder, no cycles), status and labels, copy with subpages, delete to trash, space roles.
//   node apps/api/test/wiki.mjs
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
const [fujita, hana, rina] = ['fujita', 'hana', 'rina'].map(uid);
const spaces = (await call('GET', '/spaces', { user: fujita })).data;
const itm = spaces.find((s) => s.name === 'ITM Japan').id;
const n = Date.now() % 100000;

// ── A space ─────────────────────────────────────────────────────────────────
const made = await call('POST', '/wiki/spaces', { user: fujita, body: { name: `Loan system ${n}`, key: `LN${n}`, description: 'BA documents of the loan system', spaceId: itm, set: 'ba' } });
const sp = made.data;
check('a space with a home page', made.status === 201 && sp.key === `LN${n}` && !!sp.homePageId && sp.tree.find((x) => x.id === sp.homePageId)?.title === `Loan system ${n} home`, made.data);
const sections = sp.tree.filter((x) => !x.parentId && !x.template).map((x) => x.title);
check('the BA toolkit filed under section pages', ['Planning', 'Elicitation', 'Business', 'Requirements', 'Modelling', 'Delivery & Quality'].every((c) => sections.includes(c)), sections);
const byTpl = (id) => sp.tree.find((x) => x.template === id);
check('… with the toolkit pages (plan, interview log, FRS, data dictionary, BPMN, review log…)', ['pd-ba-plan', 'pd-interview-log', 'pd-frs', 'pd-data-dictionary', 'pd-model-bpmn', 'pd-review-log', 'pd-uc-checklist'].every((t) => byTpl(t)), sp.tree.length);
check('template pages start as drafts', byTpl('pd-frs').status === 'draft' && sp.tree.find((x) => x.id === sp.homePageId).status === '');
const frsSection = sp.tree.find((x) => x.id === byTpl('pd-frs').parentId);
check('… under their category', frsSection.title === 'Requirements');
check('the space is listed with its pages', (await call('GET', '/wiki/spaces', { user: fujita })).data.some((s) => s.id === sp.id && s.pages === sp.tree.length));
check('space viewers see it (ITM Japan is public)', (await call('GET', `/wiki/spaces/${sp.id}`, { user: hana })).status === 200);
check('… but only editors write pages', (await call('POST', `/wiki/spaces/${sp.id}/pages`, { user: hana, body: { title: 'Nope' } })).status === 403);
check('keys are unique', (await call('POST', '/wiki/spaces', { user: fujita, body: { name: 'Other', key: `LN${n}` } })).status === 400);
const items = (await call('GET', `/tasks/docs/${byTpl('pd-brainstorming').id}/items`, { user: fujita })).data;
check('pages carry their template content', items.some((i) => i.section === 'Ground rules' && i.text === 'Every idea is valued'), items);

// ── The page tree ───────────────────────────────────────────────────────────
const parent = (await call('POST', `/wiki/spaces/${sp.id}/pages`, { user: fujita, body: { title: 'Release 1' } })).data;
const child = (await call('POST', `/wiki/spaces/${sp.id}/pages`, { user: fujita, body: { title: 'Scope of release 1', parentId: parent.id } })).data;
const child2 = (await call('POST', `/wiki/spaces/${sp.id}/pages`, { user: fujita, body: { title: 'Data migration', parentId: parent.id, template: 'pd-data-dictionary' } })).data;
let tree = (await call('GET', `/wiki/spaces/${sp.id}`, { user: fujita })).data.tree;
const kids = tree.filter((x) => x.parentId === parent.id).map((x) => x.title);
check('pages under a page, in order', kids.join() === 'Scope of release 1,Data migration', kids);
tree = (await call('PATCH', `/wiki/pages/${child2.id}`, { user: fujita, body: { parentId: parent.id, beforeId: child.id } })).data.tree;
check('reordering pages', tree.filter((x) => x.parentId === parent.id).map((x) => x.title).join() === 'Data migration,Scope of release 1');
check('a page cannot go under its own subpage', (await call('PATCH', `/wiki/pages/${parent.id}`, { user: fujita, body: { parentId: child.id } })).status === 400);
tree = (await call('PATCH', `/wiki/pages/${child.id}`, { user: fujita, body: { parentId: null } })).data.tree;
check('moving a page to the top', tree.find((x) => x.id === child.id).parentId === null);
const meta = (await call('PATCH', `/wiki/pages/${child2.id}`, { user: fujita, body: { status: 'review', labels: ['Release 1', 'data', 'data'] } })).data.tree.find((x) => x.id === child2.id);
check('status and labels (normalised, no duplicates)', meta.status === 'review' && meta.labels.join() === 'release-1,data', meta);
check('unknown statuses are refused', (await call('PATCH', `/wiki/pages/${child2.id}`, { user: fujita, body: { status: 'done' } })).status === 400);

// ── Copy, delete ────────────────────────────────────────────────────────────
const copied = (await call('POST', `/wiki/pages/${parent.id}/copy`, { user: fujita, body: { withChildren: true } })).data;
const copyKids = copied.space.tree.filter((x) => x.parentId === copied.id);
check('copying a page with its subpages', copyKids.length === 1 && copyKids[0].title === 'Data migration' && copied.space.tree.find((x) => x.id === copied.id).title === 'Release 1 (Copy)', copied.space.tree.find((x) => x.id === copied.id)?.title);
const after = (await call('DELETE', `/wiki/pages/${parent.id}`, { user: fujita })).data.tree;
check('deleting a page takes its subpages to the trash', !after.some((x) => x.id === parent.id || x.id === child2.id) && after.some((x) => x.id === child.id));
check('the home page stays', (await call('DELETE', `/wiki/pages/${sp.homePageId}`, { user: fujita })).status === 400);
check('a page knows its space', (await call('GET', `/wiki/pages/${child.id}/space`, { user: hana })).data.spaceId === sp.id);

// ── Private spaces and the recent list ──────────────────────────────────────
const hr = spaces.find((s) => s.name === 'HR');
if (hr) {
  const priv = (await call('POST', '/wiki/spaces', { user: rina, body: { name: `HR handbook ${n}`, spaceId: hr.id } })).data;
  check('spaces of a private Space are hidden from outsiders', priv?.id && !(await call('GET', '/wiki/spaces', { user: hana })).data.some((s) => s.id === priv.id) && (await call('GET', `/wiki/spaces/${priv.id}`, { user: hana })).status === 404, priv);
}
const recent = (await call('GET', '/wiki/recent', { user: fujita })).data;
check('recently updated pages across spaces', recent.length > 0 && recent.some((r) => r.spaceId === sp.id));
const up = (await call('PATCH', `/wiki/spaces/${sp.id}`, { user: fujita, body: { name: `Loan platform ${n}`, homePageId: child.id } })).data;
check('space settings: name and home page', up.name === `Loan platform ${n}` && up.homePageId === child.id);

console.log(failures ? `\n${failures} check(s) failed` : '\nall wiki checks passed');
process.exit(failures ? 1 : 0);
