// Phase 5 integration test: contacts & profiles — directory and search, projects / files / activity filtered by the
// viewer's access, reporting line, editing your own profile, owner-only organisation fields.
//   node apps/api/test/contacts.mjs
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
const [claudia, hana, mika, ken, rina, fujita, yuki] = ['claudia', 'hana', 'mika', 'ken', 'rina', 'fujita', 'yuki'].map(uid);
const search = async (q, user = claudia) => (await call('GET', `/contacts?q=${encodeURIComponent(q)}`, { user })).data.map((c) => c.email.split('@')[0]).sort();
const profile = (id, user = claudia) => call('GET', `/contacts/${id}`, { user });

const all = (await call('GET', '/contacts', { user: hana })).data;
const f = all.find((c) => c.id === fujita);
check('everyone in the workspace is in the directory', all.length === 10 && all.every((c, i) => i === 0 || all[i - 1].name.localeCompare(c.name) <= 0), all.map((c) => c.name));
check('cards carry contact details and skills', f.location === 'Tokyo, Japan' && f.phone === '+81 90-1234-5678' && f.skills.includes('Japanese') && f.status === 'よろしくお願いします。' && f.joinedAt.startsWith('2024-01-15'), f);
check('search by skill', (await search('japanese')).join() === 'fujita');
const fin = await search('finance');
check('search by department (and by the Finance space its members belong to)', fin.includes('huong') && fin.includes('hana') && !fin.includes('ken'), fin);
check('search by project (space)', (await search('ITM Japan')).join() === ['claudia', 'fujita', 'minh'].join(), await search('ITM Japan'));
check('search by location', (await search('hanoi')).join() === 'huong');

const rinaForHana = all.find((c) => c.id === rina);
const rinaForClaudia = (await call('GET', '/contacts', { user: claudia })).data.find((c) => c.id === rina);
check('projects only list spaces the viewer can see', !rinaForHana.projects.some((p) => p.name === 'HR') && rinaForClaudia.projects.some((p) => p.name === 'HR'), [rinaForHana.projects, rinaForClaudia.projects]);

// ── Profiles ────────────────────────────────────────────────────────────────
const pf = (await profile(fujita, hana)).data;
check('a profile shows the manager and the reporting line', pf.manager?.id === claudia && pf.chain.length === 0 && pf.reports.length === 0, pf);
const py = (await profile(yuki)).data;
check('the chain goes up past the manager', py.manager?.id === mika && py.chain.map((c) => c.id).join() === claudia, py);
const pc = (await profile(claudia)).data;
check('direct reports', ['hana', 'mika', 'rina', 'fujita', 'huong'].every((k) => pc.reports.some((r) => r.id === uid(k))) && pc.manager === null, pc.reports.map((r) => r.name));
check('the files of a person are the ones they own', pf.files.length > 0 && pf.files.every((r) => r.owner?.id === fujita), pf.files.map((r) => r.name));
const rinaFilesHana = (await profile(rina, hana)).data.files.map((r) => r.name);
const rinaFilesClaudia = (await profile(rina, claudia)).data.files.map((r) => r.name);
check('files are filtered by what the viewer can open', rinaFilesClaudia.includes('Recruitment Plan Q4') && !rinaFilesHana.includes('Recruitment Plan Q4'), [rinaFilesHana, rinaFilesClaudia]);
check('activity is what that person did, as far as the viewer can see', pc.activity.length > 0 && pc.activity.every((e) => e.actor?.id === claudia), pc.activity.slice(0, 3));
check('unknown people are 404', (await profile('00000000-0000-4000-8000-000000000000')).status === 404);
const own = (await profile(ken, ken)).data;
check('edit flags: yourself yes, organisation fields no', own.isMe && own.canEdit && !own.canEditOrg && !(await profile(hana, ken)).data.canEdit);
check('workspace owners may edit anyone, including organisation fields', (await profile(ken, claudia)).data.canEdit && (await profile(ken, claudia)).data.canEditOrg);

// ── Editing ─────────────────────────────────────────────────────────────────
const e1 = await call('PATCH', `/contacts/${ken}`, { user: ken, body: { status: '  In the warehouse today  ', phone: '+81 70-0000-0000', skills: ['Inventory', ' Inventory', 'Forklift', ''] } });
check('people edit their own details (trimmed, skills de-duplicated)', e1.status === 200 && e1.data.status === 'In the warehouse today' && e1.data.phone === '+81 70-0000-0000' && e1.data.skills.join() === 'Inventory,Forklift', e1.data);
check('clearing a field', (await call('PATCH', `/contacts/${ken}`, { user: ken, body: { status: '' } })).data.status === null);
check('people cannot change their own title', (await call('PATCH', `/contacts/${ken}`, { user: ken, body: { title: 'CEO' } })).status === 403);
check('people cannot edit someone else', (await call('PATCH', `/contacts/${hana}`, { user: ken, body: { status: 'hi' } })).status === 403);
const moved = await call('PATCH', `/contacts/${ken}`, { user: claudia, body: { managerId: hana, department: 'Marketing', title: 'Store Support Lead' } });
check('owners change title, department and manager', moved.status === 200 && moved.data.manager.id === hana && moved.data.department === 'Marketing' && moved.data.title === 'Store Support Lead', moved.data);
check('the new manager lists the report', (await profile(hana)).data.reports.some((r) => r.id === ken));
check('a reporting loop is refused', (await call('PATCH', `/contacts/${hana}`, { user: claudia, body: { managerId: ken } })).status === 400);
check('nobody manages themselves', (await call('PATCH', `/contacts/${ken}`, { user: claudia, body: { managerId: ken } })).status === 400);
check('a manager outside the workspace is refused', (await call('PATCH', `/contacts/${ken}`, { user: claudia, body: { managerId: '00000000-0000-4000-8000-000000000000' } })).status === 400);
await call('PATCH', `/contacts/${ken}`, { user: claudia, body: { managerId: mika, department: 'Operations', title: 'Store Support' } });

console.log(failures ? `\n${failures} check(s) failed` : '\nall contacts checks passed');
process.exit(failures ? 1 : 0);
