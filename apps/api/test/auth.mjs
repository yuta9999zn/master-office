// Organisation & sign-in (§79, batch A): setup only once, invitations (link, accept, teams), password sign-in and
// sessions, suspend / reactivate, roles (only the owner names admins), password reset links, system e-mail settings
// (password never returned), admin-only routes.
//   node apps/api/test/auth.mjs   (dev mode API + seed)
const API = process.env.API_URL ?? 'http://localhost:4000';
let failures = 0;
const check = (name, cond, extra) => {
  console.log(`${cond ? '✓' : '✗'} ${name}${cond ? '' : ' ' + JSON.stringify(extra ?? '')}`);
  if (!cond) failures++;
};
async function call(method, path, { user, body, cookie } = {}) {
  const headers = {};
  if (user) headers['x-user-id'] = user;
  if (cookie) headers.cookie = cookie;
  if (body) headers['content-type'] = 'application/json';
  const res = await fetch(API + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  const session = res.headers.getSetCookie().find((c) => c.startsWith('mo_session='));
  return { status: res.status, data: text ? JSON.parse(text) : null, cookie: session?.split(';')[0] ?? null, setCookie: session ?? null };
}
const users = (await call('GET', '/users')).data;
const uid = (key) => users.find((u) => u.email === `${key}@hanami.example`).id;
const [claudia, fujita, hana] = ['claudia', 'fujita', 'hana'].map(uid);
const spaces = (await call('GET', '/spaces', { user: claudia })).data;
const itm = spaces.find((s) => s.name === 'Mirai Systems');
const n = Date.now() % 1000000;
const email = `new.hire.${n}@example.com`;

// ── Setup ───────────────────────────────────────────────────────────────────
const st = (await call('GET', '/auth/session')).data;
check('the session endpoint: set up, dev mode, not signed in', st.needsSetup === false && st.dev === true && st.signedIn === false, st);
check('setup runs only once', (await call('POST', '/setup', { body: { orgName: 'Evil', name: 'X', email: 'x@example.com', password: 'longenough1' } })).status === 403);

// ── Admin-only ──────────────────────────────────────────────────────────────
check('members can’t open the admin console', (await call('GET', '/admin/members', { user: hana })).status === 403 && (await call('GET', '/admin/settings/smtp', { user: hana })).status === 403);
const members = (await call('GET', '/admin/members', { user: claudia })).data;
check('the owner sees every member with role and status', members.length === users.length && members[0].role === 'owner' && members.every((m) => m.status === 'active'), members.length);
check('… and their own role', (await call('GET', '/admin/me', { user: claudia })).data.role === 'owner' && (await call('GET', '/admin/me', { user: hana })).data.role === 'editor');

// ── Invitations ─────────────────────────────────────────────────────────────
check('members can’t invite', (await call('POST', '/admin/invitations', { user: hana, body: { emails: [email] } })).status === 403);
const inv = await call('POST', '/admin/invitations', { user: claudia, body: { emails: [email, `${users[1].email}`], role: 'editor', teams: [{ spaceId: itm.id, role: 'editor', title: 'Junior developer' }], message: 'Welcome!' } });
const sent = inv.data.results.find((r) => r.email === email);
check('inviting: a link for a new address (no system e-mail → shown to the admin)', inv.status === 201 && sent.status === 'sent' && /\/invite\/[\w-]{20,}$/.test(sent.link ?? ''), inv.data);
check('… members already in are skipped', inv.data.results.find((r) => r.email === users[1].email)?.status === 'member');
check('the pending list', (await call('GET', '/admin/invitations', { user: claudia })).data.some((i) => i.email === email && !i.expired));
const token = sent.link.split('/invite/')[1];
const info = await call('GET', `/invitations/${token}`);
check('the invitation page: organisation, who invited, teams and position', info.data.email === email && info.data.workspace === 'HANAMI' && info.data.teams[0]?.name === 'Mirai Systems' && info.data.teams[0]?.title === 'Junior developer', info.data);
check('a bad link', (await call('GET', '/invitations/nope-nope-nope')).status === 404);
check('passwords need 10 characters', (await call('POST', `/invitations/${token}/accept`, { body: { name: 'New Hire', password: 'short' } })).status === 400);
const acc = await call('POST', `/invitations/${token}/accept`, { body: { name: 'New Hire', password: 'correct horse battery' } });
check('accepting signs in with a session cookie (httpOnly)', acc.status === 200 && !!acc.cookie && /HttpOnly/i.test(acc.setCookie) && /SameSite=Lax/i.test(acc.setCookie), acc);
const me = (await call('GET', '/me', { cookie: acc.cookie })).data;
check('… as the new person', me.user.email === email && me.user.name === 'New Hire', me.user);
const newId = me.user.id;
check('… in the teams of the invitation', (await call('GET', `/spaces/${itm.id}/members`, { user: claudia })).data.some((m) => m.user.id === newId && m.role === 'editor'));
check('a link works once', (await call('GET', `/invitations/${token}`)).status === 404);

// ── Sign-in ─────────────────────────────────────────────────────────────────
check('wrong password', (await call('POST', '/auth/login', { body: { email, password: 'wrong password!' } })).status === 401);
check('unknown address, same answer', (await call('POST', '/auth/login', { body: { email: `nobody${n}@example.com`, password: 'whatever123' } })).status === 401);
const login = await call('POST', '/auth/login', { body: { email: email.toUpperCase(), password: 'correct horse battery' } });
check('signing in (e-mail is case-insensitive)', login.status === 200 && !!login.cookie);
check('the session says signed in', (await call('GET', '/auth/session', { cookie: login.cookie })).data.signedIn === true);
check('changing the password needs the current one', (await call('POST', '/auth/password', { cookie: login.cookie, body: { current: 'nope nope nope', password: 'another long one' } })).status === 400);
check('… then works and signs out other browsers', (await call('POST', '/auth/password', { cookie: login.cookie, body: { current: 'correct horse battery', password: 'another long one' } })).status === 200 && (await call('GET', '/auth/session', { cookie: acc.cookie })).data.signedIn === false && (await call('GET', '/auth/session', { cookie: login.cookie })).data.signedIn === true);
const out = await call('POST', '/auth/logout', { cookie: login.cookie });
check('signing out ends the session', out.status === 200 && (await call('GET', '/auth/session', { cookie: login.cookie })).data.signedIn === false);

// ── Roles, suspend ──────────────────────────────────────────────────────────
const again = (await call('POST', '/auth/login', { body: { email, password: 'another long one' } })).cookie;
check('admins can’t change themselves', (await call('PATCH', `/admin/members/${claudia}`, { user: claudia, body: { status: 'suspended' } })).status === 400);
const sus = await call('PATCH', `/admin/members/${newId}`, { user: claudia, body: { status: 'suspended' } });
check('suspending a member', sus.status === 200 && sus.data.status === 'suspended');
check('… ends their sessions and blocks sign-in', (await call('GET', '/auth/session', { cookie: again })).data.signedIn === false && (await call('POST', '/auth/login', { body: { email, password: 'another long one' } })).status === 403);
check('… and reactivating lets them back', (await call('PATCH', `/admin/members/${newId}`, { user: claudia, body: { status: 'active' } })).data.status === 'active' && (await call('POST', '/auth/login', { body: { email, password: 'another long one' } })).status === 200);
check('the owner names an admin', (await call('PATCH', `/admin/members/${fujita}`, { user: claudia, body: { role: 'admin' } })).data.role === 'admin');
check('… an admin can’t name another admin', (await call('PATCH', `/admin/members/${newId}`, { user: fujita, body: { role: 'admin' } })).status === 403);
check('… but can make a member a guest', (await call('PATCH', `/admin/members/${newId}`, { user: fujita, body: { role: 'viewer' } })).data.role === 'viewer');
check('… or invite', (await call('POST', '/admin/invitations', { user: fujita, body: { emails: [`second.${n}@example.com`] } })).status === 201);
check('the owner can’t be changed', (await call('PATCH', `/admin/members/${claudia}`, { user: fujita, body: { role: 'editor' } })).status === 400);
await call('PATCH', `/admin/members/${fujita}`, { user: claudia, body: { role: 'editor' } });
await call('PATCH', `/admin/members/${newId}`, { user: claudia, body: { role: 'editor' } });

// ── Password links ──────────────────────────────────────────────────────────
check('forgot password answers the same for unknown addresses', (await call('POST', '/auth/forgot', { body: { email: `ghost${n}@example.com` } })).status === 200);
check('admins send a password link', (await call('POST', `/admin/members/${newId}/password-link`, { user: claudia })).status === 200);
check('a bad reset link', (await call('GET', '/auth/reset/not-a-token')).status === 400);

// ── System e-mail ───────────────────────────────────────────────────────────
check('a password is required', (await call('PUT', '/admin/settings/smtp', { user: claudia, body: { provider: 'gmail', user: 'office.test@gmail.com' } })).status === 400);
const saved = await call('PUT', '/admin/settings/smtp', { user: claudia, body: { provider: 'gmail', user: 'office.test@gmail.com', password: 'abcd efgh ijkl mnop', fromName: 'HANAMI Office' } });
check('saving Gmail: preset host / port, the password is never returned', saved.status === 200 && saved.data.smtp.host === 'smtp.gmail.com' && saved.data.smtp.port === 465 && saved.data.smtp.hasPassword && !JSON.stringify(saved.data).includes('abcd'), saved.data);
const custom = await call('PUT', '/admin/settings/smtp', { user: claudia, body: { provider: 'custom', user: 'mailer', host: '127.0.0.1', port: 1, secure: false } });
check('switching to custom SMTP keeps the stored password', custom.data.smtp.host === '127.0.0.1' && custom.data.smtp.hasPassword, custom.data);
const test = await call('POST', '/admin/settings/smtp/test', { user: claudia, body: { to: 'claudia@hanami.example' } });
check('a failing test reports the server error', test.status === 400 && /could not be sent/.test(test.data.message), test.data);
check('removing the system e-mail', (await call('DELETE', '/admin/settings/smtp', { user: claudia })).status === 204 && (await call('GET', '/admin/settings/smtp', { user: claudia })).data.smtp === null);
check('the system address for links', (await call('PATCH', '/admin/settings/general', { user: claudia, body: { appUrl: 'ftp://bad' } })).status === 400 && (await call('PATCH', '/admin/settings/general', { user: claudia, body: { appUrl: 'http://localhost:3010/' } })).data.appUrl === 'http://localhost:3010');

console.log(failures ? `\n${failures} check(s) failed` : '\nall auth checks passed');
process.exit(failures ? 1 : 0);
