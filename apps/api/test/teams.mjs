// Teams & departments (§79, batch B): kinds and the tree (no cycles), leads manage members and positions, one person
// in many teams with many positions, organisation admins see every team, guests don't see public teams or everyone's
// card, phone / location privacy (self, admins, leads of their teams, or "everyone").
//   node apps/api/test/teams.mjs   (dev mode API + fresh seed)
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
const uid = (key) => users.find((u) => u.email === `${key}@hanami.example`).id;
const [claudia, hana, mika, ken, yuki, sora, fujita, minh, rina] = ['claudia', 'hana', 'mika', 'ken', 'yuki', 'sora', 'fujita', 'minh', 'rina'].map(uid);
const spaces = (await call('GET', '/spaces', { user: claudia })).data;
const byName = (n) => spaces.find((s) => s.name === n);
const n = Date.now() % 100000;

// ── Kinds, tree ─────────────────────────────────────────────────────────────
check('spaces have a kind', byName('Marketing').kind === 'department' && byName('Mirai Systems').kind === 'project' && byName('Branch 575').kind === 'team' && byName('Sakura Beauty').kind === 'general');
const sales = (await call('POST', '/spaces', { user: claudia, body: { name: `Sales ${n}`, kind: 'department', visibility: 'public' } })).data;
const north = (await call('POST', '/spaces', { user: claudia, body: { name: `Sales North ${n}`, kind: 'team', parentId: sales.id } })).data;
check('a department with a team under it', sales.kind === 'department' && north.parentId === sales.id && north.kind === 'team');
check('a team cannot go under its own sub-team', (await call('PATCH', `/spaces/${sales.id}`, { user: claudia, body: { parentId: north.id } })).status === 400);
const moved = (await call('PATCH', `/spaces/${north.id}`, { user: claudia, body: { name: `North ${n}`, kind: 'project', parentId: byName('Sakura Beauty').id } })).data;
check('renaming, changing the kind, moving', moved.name === `North ${n}` && moved.kind === 'project' && moved.parentId === byName('Sakura Beauty').id, moved);
await call('PATCH', `/spaces/${north.id}`, { user: claudia, body: { parentId: sales.id, kind: 'team' } });
check('members can’t edit a team they don’t lead', (await call('PATCH', `/spaces/${byName('Marketing').id}`, { user: ken, body: { name: 'Nope' } })).status === 403);

// ── Leads, positions ────────────────────────────────────────────────────────
check('a lead (space owner) adds a member with a position', (await call('POST', `/spaces/${sales.id}/members`, { user: claudia, body: { userId: hana, role: 'admin', title: 'Head of Sales' } })).status === 204);
check('… the new lead adds people', (await call('POST', `/spaces/${sales.id}/members`, { user: hana, body: { userId: ken, role: 'editor', title: 'Sales rep' } })).status === 204);
const members = (await call('GET', `/spaces/${sales.id}/members`, { user: hana })).data;
check('members carry their position', members.find((m) => m.user.id === hana)?.title === 'Head of Sales' && members.find((m) => m.user.id === ken)?.title === 'Sales rep', members);
check('changing only the role keeps the position', (await call('POST', `/spaces/${sales.id}/members`, { user: hana, body: { userId: ken, role: 'viewer' } })).status === 204 && (await call('GET', `/spaces/${sales.id}/members`, { user: hana })).data.find((m) => m.user.id === ken)?.title === 'Sales rep');
check('the owner’s own position can be set', (await call('POST', `/spaces/${sales.id}/members`, { user: claudia, body: { userId: claudia, role: 'owner', title: 'Sponsor' } })).status === 204);
check('… but nobody becomes owner this way', (await call('POST', `/spaces/${sales.id}/members`, { user: claudia, body: { userId: ken, role: 'owner' } })).status === 400);
check('members can’t add people', (await call('POST', `/spaces/${sales.id}/members`, { user: ken, body: { userId: yuki, role: 'editor' } })).status === 403);
check('only people of the organisation', (await call('POST', `/spaces/${sales.id}/members`, { user: claudia, body: { userId: '00000000-0000-4000-8000-000000000000', role: 'editor' } })).status === 400);

// ── Many teams, many positions ──────────────────────────────────────────────
const mikaCard = (await call('GET', '/contacts', { user: claudia })).data.find((c) => c.id === mika);
const pos = Object.fromEntries(mikaCard.projects.map((p) => [p.name, p.title]));
check('one person, several teams and positions', pos.Operations === 'Head of Operations' && pos['Branch 575'] === 'Area Manager' && pos['Mirai Systems'] === 'Business Analyst', pos);
check('… teams she leads come first', mikaCard.projects[0].lead && mikaCard.projects.findIndex((p) => !p.lead) > 0, mikaCard.projects.map((p) => [p.name, p.lead]));
check('teams carry their kind', mikaCard.projects.find((p) => p.name === 'Operations').kind === 'department');

// ── Phone privacy ───────────────────────────────────────────────────────────
const card = async (viewer, who) => (await call('GET', '/contacts', { user: viewer })).data.find((c) => c.id === who);
check('people see their own phone', (await card(yuki, yuki)).phone === '+81 80-3333-0104');
check('a colleague who doesn’t lead them does not', (await card(sora, yuki)).phone === null && (await card(sora, yuki)).phoneHidden === true);
check('a lead of one of their teams does (Mika leads Operations)', (await card(mika, yuki)).phone === '+81 80-3333-0104' && (await card(mika, yuki)).location !== null);
check('organisation admins do', (await card(claudia, yuki)).phone === '+81 80-3333-0104');
check('profiles follow the same rule', (await call('GET', `/contacts/${yuki}`, { user: sora })).data.phone === null && (await call('GET', `/contacts/${yuki}`, { user: mika })).data.phone !== null);
check('only the person picks who sees it', (await call('PATCH', `/contacts/${yuki}`, { user: claudia, body: { phoneVisibility: 'everyone' } })).status === 403);
const share = await call('PATCH', `/contacts/${yuki}`, { user: yuki, body: { phoneVisibility: 'everyone' } });
check('sharing with everyone', share.data.phoneVisibility === 'everyone' && (await card(sora, yuki)).phone === '+81 80-3333-0104');
await call('PATCH', `/contacts/${yuki}`, { user: yuki, body: { phoneVisibility: 'leads' } });
check('… and back', (await card(sora, yuki)).phone === null);
check('others don’t learn the setting', (await call('GET', `/contacts/${yuki}`, { user: sora })).data.phoneVisibility === undefined);

// ── Organisation admins and guests ──────────────────────────────────────────
const hr = byName('HR');
check('members don’t see a private department', !(await call('GET', '/spaces', { user: hana })).data.some((s) => s.id === hr.id));
await call('PATCH', `/admin/members/${hana}`, { user: claudia, body: { role: 'admin' } });
check('organisation admins see and manage every team', (await call('GET', '/spaces', { user: hana })).data.find((s) => s.id === hr.id)?.myRole === 'admin');
await call('PATCH', `/admin/members/${hana}`, { user: claudia, body: { role: 'editor' } });
// A guest invited into one team (everyone seeded is in the company-wide space, so a new person is used).
const inv = (await call('POST', '/admin/invitations', { user: claudia, body: { emails: [`partner.${n}@example.com`], role: 'viewer', teams: [{ spaceId: sales.id, role: 'editor', title: 'Agency partner' }] } })).data;
const token = inv.results[0].link.split('/invite/')[1];
await call('POST', `/invitations/${token}/accept`, { body: { name: 'Pat Partner', password: 'partner password' } });
const pat = (await call('GET', '/users')).data.find((u) => u.email === `partner.${n}@example.com`).id;
const guestSpaces = (await call('GET', '/spaces', { user: pat })).data.map((s) => s.name);
check('guests only see their own teams, not public ones', guestSpaces.join() === `Sales ${n}`, guestSpaces);
const guestContacts = (await call('GET', '/contacts', { user: pat })).data.map((c) => c.name).sort();
check('… and only their team mates in Contacts', guestContacts.join() === ['Claudia Chen', 'Hana Lee', 'Ken Watanabe', 'Pat Partner'].join(), guestContacts);
check('… nor other profiles', (await call('GET', `/contacts/${fujita}`, { user: pat })).status === 404 && (await call('GET', `/contacts/${hana}`, { user: pat })).status === 200);
check('… with their position in the team', (await call('GET', '/contacts', { user: claudia })).data.find((c) => c.id === pat).projects[0]?.title === 'Agency partner');
await call('PATCH', `/admin/members/${pat}`, { user: claudia, body: { role: 'editor' } });
check('as a member they see public teams', (await call('GET', '/spaces', { user: pat })).data.some((s) => s.name === 'Marketing'));

console.log(failures ? `\n${failures} check(s) failed` : '\nall teams checks passed');
process.exit(failures ? 1 : 0);
