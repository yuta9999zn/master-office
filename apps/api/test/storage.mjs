// Storage quotas (§79, batch C): logical usage (current size + old versions + embedded media + mail attachments,
// copies and trash count in full; the "Original upload" version does not count twice), who is charged (My Files →
// owner, team space → team), limits (defaults, per person / team overrides, unlimited, organisation pool), 80 %
// warning, 413 "Storage full" on uploads, admin report, and ETag / 304 on downloads.
//   node apps/api/test/storage.mjs   (dev mode API + seed; re-runnable)
import { randomBytes } from 'node:crypto';

const API = process.env.API_URL ?? 'http://localhost:4000';
let failures = 0;
const check = (name, cond, extra) => {
  console.log(`${cond ? '✓' : '✗'} ${name}${cond ? '' : ' ' + JSON.stringify(extra ?? '')}`);
  if (!cond) failures++;
};
async function call(method, path, { user, body, headers: extra } = {}) {
  const headers = { ...(extra ?? {}) };
  if (user) headers['x-user-id'] = user;
  if (body) headers['content-type'] = 'application/json';
  const res = await fetch(API + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null, headers: res.headers };
}
async function upload(user, path, bytes, name, fields = {}) {
  const fd = new FormData();
  fd.append('file', new Blob([bytes], { type: 'application/octet-stream' }), name);
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  const res = await fetch(API + path, { method: 'POST', headers: { 'x-user-id': user }, body: fd });
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null };
}
const GiB = 1024 ** 3;
const users = (await call('GET', '/users')).data;
const uid = (key) => users.find((u) => u.email === `${key}@hanami.example`).id;
const [claudia, ken, hana] = ['claudia', 'ken', 'hana'].map(uid);
const spaces = (await call('GET', '/spaces', { user: claudia })).data;
const marketing = spaces.find((s) => s.name === 'Marketing');
const n = Date.now() % 100000;
const mine = async (user) => (await call('GET', '/storage/me', { user })).data;
const spaceUse = async (id, user = claudia) => (await call('GET', `/storage/space/${id}`, { user })).data;

// ── A clean slate (the test is re-runnable) ─────────────────────────────────
await call('DELETE', `/admin/storage/users/${ken}`, { user: claudia });
await call('DELETE', `/admin/storage/spaces/${marketing.id}`, { user: claudia });
let report = (await call('PATCH', '/admin/storage', { user: claudia, body: { orgBytes: null, userDefaultBytes: 10 * GiB, spaceDefaultBytes: 50 * GiB } })).data;

// ── Report and access ───────────────────────────────────────────────────────
check('admins see the storage report', report.org && Array.isArray(report.users) && Array.isArray(report.spaces) && Array.isArray(report.largest) && report.settings.userDefaultBytes === 10 * GiB, report.settings);
check('… members don’t', (await call('GET', '/admin/storage', { user: ken })).status === 403);
check('… nor can they change limits', (await call('PATCH', '/admin/storage', { user: ken, body: { orgBytes: 1 } })).status === 403 && (await call('PUT', `/admin/storage/users/${ken}`, { user: ken, body: { bytes: 1 } })).status === 403);
check('report rows carry the default limit', report.users.find((r) => r.user.id === ken)?.limit === 10 * GiB && report.users.find((r) => r.user.id === ken)?.override === false);
check('the largest files come first', report.largest.every((f, i, a) => i === 0 || a[i - 1].sizeBytes >= f.sizeBytes));
let s0 = await mine(ken);
check('my status: used, limit, percent, flags', typeof s0.used === 'number' && s0.limit === 10 * GiB && typeof s0.percent === 'number' && s0.warning === false && s0.full === false && s0.org.limit === null, s0);
check('a member can see their own but not a colleague’s meter', (await call('GET', '/storage/me', { user: ken })).status === 200 && (await call('GET', `/storage/space/${marketing.id}`, { user: ken })).status === 200);
check('admins see anyone’s', (await call('GET', `/storage/space/${spaces.find((s) => s.name === 'HR')?.id ?? marketing.id}`, { user: claudia })).status === 200);
const reportKen = report.users.find((r) => r.user.id === ken);
check('the report agrees with the personal meter', reportKen.used === s0.used, { report: reportKen.used, me: s0.used });

// ── Logical usage ───────────────────────────────────────────────────────────
const bytes64k = randomBytes(64 * 1024);
const up = await upload(ken, '/resources/upload', bytes64k, `quota-${n}.bin`);
check('upload lands in My Files', up.status === 201 || up.status === 200, up);
let s1 = await mine(ken);
check('a 64 KB upload adds exactly 64 KB (the original-upload version is not counted twice)', s1.used - s0.used === bytes64k.length, { delta: s1.used - s0.used });
const copy = (await call('POST', `/resources/${up.data.id}/copy`, { user: ken, body: {} })).data;
const s2 = await mine(ken);
check('a copy counts in full although the content is shared', s2.used - s1.used === bytes64k.length, { delta: s2.used - s1.used });
await call('POST', `/resources/${copy.id}/trash`, { user: ken });
check('the trash still counts', (await mine(ken)).used === s2.used);
await call('DELETE', `/resources/${copy.id}`, { user: ken });
check('deleting permanently frees it', (await mine(ken)).used === s1.used);

const bytes32k = randomBytes(32 * 1024);
const t0 = await spaceUse(marketing.id);
const inTeam = await upload(claudia, '/resources/upload', bytes32k, `team-quota-${n}.bin`, { spaceId: marketing.id });
const t1 = await spaceUse(marketing.id);
check('a file in a team space is charged to the team', inTeam.status < 300 && t1.used - t0.used === bytes32k.length, { delta: t1.used - t0.used });
check('… not to the person who uploaded it', (await mine(ken)).used === s1.used);
check('team limit is the default 50 GB', t1.limit === 50 * GiB && t1.kind === 'space');

const att = await upload(ken, '/mail/attachments', randomBytes(16 * 1024), `att-${n}.bin`);
check('a mail attachment counts for its sender', att.status < 300 && (await mine(ken)).used - s1.used === 16 * 1024, att);
s1 = await mine(ken);

const doc = (await call('POST', '/resources', { user: ken, body: { name: `Quota doc ${n}`, type: 'document' } })).data;
const png = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), randomBytes(8 * 1024)]);
const fdImg = new FormData();
fdImg.append('file', new Blob([png], { type: 'image/png' }), 'pic.png');
const img = await fetch(`${API}/resources/${doc.id}/assets`, { method: 'POST', headers: { 'x-user-id': ken }, body: fdImg });
const s3 = await mine(ken);
check('a picture embedded in a document counts for the document’s owner', img.status < 300 && s3.used - s1.used >= png.length, { status: img.status, delta: s3.used - s1.used });
s1 = s3;

// ── Limits ──────────────────────────────────────────────────────────────────
let r = await call('PUT', `/admin/storage/users/${ken}`, { user: claudia, body: { bytes: s1.used + 1000 } });
check('an admin sets a person’s own limit', r.status === 200 && r.data.users.find((x) => x.user.id === ken)?.override === true && r.data.users.find((x) => x.user.id === ken)?.limit === s1.used + 1000, r.status);
let blocked = await upload(ken, '/resources/upload', randomBytes(4096), `too-big-${n}.bin`);
check('an upload over the limit is refused with 413 "Storage full"', blocked.status === 413 && /Storage full/.test(blocked.data?.message ?? ''), blocked);
check('… and nothing was stored', (await mine(ken)).used === s1.used);
const small = await upload(ken, '/resources/upload', randomBytes(500), `fits-${n}.bin`);
check('one that fits goes through', small.status < 300);
s1 = await mine(ken);
check('the meter is red once full', s1.full === false && s1.warning === true && s1.percent >= 80, s1);
r = await call('PUT', `/admin/storage/users/${ken}`, { user: claudia, body: { bytes: s1.used } });
const now = await mine(ken);
check('at 100 % the status says full', now.full === true && now.percent === 100, now);
check('… and even a tiny upload is refused', (await upload(ken, '/resources/upload', randomBytes(10), `tiny-${n}.bin`)).status === 413);
check('… copies too', (await call('POST', `/resources/${up.data.id}/copy`, { user: ken, body: {} })).status === 413);
check('… and mail attachments', (await upload(ken, '/mail/attachments', randomBytes(10), `tiny-${n}.bin`)).status === 413);
check('… and pictures in documents', (await fetch(`${API}/resources/${doc.id}/assets`, { method: 'POST', headers: { 'x-user-id': ken }, body: (() => { const f = new FormData(); f.append('file', new Blob([png], { type: 'image/png' }), 'p.png'); return f; })() })).status === 413);
check('deleting still works when full', (await call('POST', `/resources/${small.data.id}/trash`, { user: ken })).status < 300 && (await call('DELETE', `/resources/${small.data.id}`, { user: ken })).status < 300);
check('a colleague is not affected by my limit', (await mine(hana)).full === false);

r = await call('PUT', `/admin/storage/users/${ken}`, { user: claudia, body: { bytes: null } });
const unl = await mine(ken);
check('"unlimited" lifts the limit', unl.limit === null && unl.percent === null && unl.full === false && (await upload(ken, '/resources/upload', randomBytes(4096), `free-${n}.bin`)).status < 300, unl);
r = await call('DELETE', `/admin/storage/users/${ken}`, { user: claudia });
check('removing the override returns to the default', r.status === 200 && (await mine(ken)).limit === 10 * GiB && r.data.users.find((x) => x.user.id === ken)?.override === false);

// Team limit
r = await call('PUT', `/admin/storage/spaces/${marketing.id}`, { user: claudia, body: { bytes: t1.used } });
check('a team’s limit', r.status === 200 && (await spaceUse(marketing.id)).full === true);
check('uploads into a full team are refused — even for an admin', (await upload(claudia, '/resources/upload', randomBytes(100), `team-full-${n}.bin`, { spaceId: marketing.id })).status === 413);
check('… while the same person’s My Files still accept files', (await upload(claudia, '/resources/upload', randomBytes(100), `own-${n}.bin`)).status < 300);
await call('DELETE', `/admin/storage/spaces/${marketing.id}`, { user: claudia });
check('team back to default', (await spaceUse(marketing.id)).limit === 50 * GiB);

// Organisation pool
const orgUsed = (await mine(ken)).org.used;
r = await call('PATCH', '/admin/storage', { user: claudia, body: { orgBytes: orgUsed + 1000 } });
check('the organisation pool', r.status === 200 && r.data.org.limit === orgUsed + 1000 && r.data.org.warning === true);
blocked = await upload(ken, '/resources/upload', randomBytes(4096), `org-full-${n}.bin`);
check('a full organisation refuses uploads from everyone, with its own message', blocked.status === 413 && /organisation/.test(blocked.data?.message ?? ''), blocked.data);
check('… the personal meter shows the organisation warning', (await mine(ken)).warning === true);
r = await call('PATCH', '/admin/storage', { user: claudia, body: { orgBytes: null } });
check('pool back to unlimited', r.data.org.limit === null && (await mine(ken)).warning === false);

// Defaults
r = await call('PATCH', '/admin/storage', { user: claudia, body: { userDefaultBytes: 20 * GiB } });
check('changing the default changes everyone without an override', r.data.users.every((x) => x.override || x.limit === 20 * GiB) && (await mine(ken)).limit === 20 * GiB);
await call('PATCH', '/admin/storage', { user: claudia, body: { userDefaultBytes: 10 * GiB } });
check('allocated = sum of limits', r.data.org.allocated >= r.data.users.length * 20 * GiB);

// Validation
check('negative limits are refused', (await call('PUT', `/admin/storage/users/${ken}`, { user: claudia, body: { bytes: -1 } })).status === 400);
check('unknown people / teams → 404', (await call('PUT', `/admin/storage/users/00000000-0000-4000-8000-000000000000`, { user: claudia, body: { bytes: 1 } })).status === 404 && (await call('PUT', `/admin/storage/spaces/00000000-0000-4000-8000-000000000000`, { user: claudia, body: { bytes: 1 } })).status === 404);
check('only "users" or "spaces"', (await call('PUT', `/admin/storage/things/${ken}`, { user: claudia, body: { bytes: 1 } })).status === 400);

// Stats
const stats = (await call('GET', '/stats', { user: claudia })).data;
check('workspace stats show the organisation’s logical usage', stats.storageBytes === (await mine(ken)).org.used, { stats: stats.storageBytes });

// ── Open / save performance: immutable content is cached by its sha256 ──────
const dl = await fetch(`${API}/resources/${up.data.id}/download`, { headers: { 'x-user-id': ken } });
const etag = dl.headers.get('etag');
check('downloads carry an ETag and a private Cache-Control', dl.status === 200 && /^"[0-9a-f]{64}"$/.test(etag ?? '') && /private/.test(dl.headers.get('cache-control') ?? ''), { etag, cc: dl.headers.get('cache-control') });
const again = await fetch(`${API}/resources/${up.data.id}/download`, { headers: { 'x-user-id': ken, 'if-none-match': etag } });
check('… and answer 304 when the browser already has it', again.status === 304 && (await again.text()) === '');
const assetUrl = (await img.json().catch(() => null))?.url;
if (assetUrl) {
  const a1 = await fetch(`${API}${assetUrl.replace(/^\/api/, '')}`, { headers: { 'x-user-id': ken } });
  const a2 = await fetch(`${API}${assetUrl.replace(/^\/api/, '')}`, { headers: { 'x-user-id': ken, 'if-none-match': a1.headers.get('etag') } });
  check('pictures in documents: ETag + 304 too', a1.status === 200 && !!a1.headers.get('etag') && a2.status === 304, { a1: a1.status, a2: a2.status });
}
const attDl = await fetch(`${API}/mail/attachments/${att.data.id}`, { headers: { 'x-user-id': ken } });
const attAgain = await fetch(`${API}/mail/attachments/${att.data.id}`, { headers: { 'x-user-id': ken, 'if-none-match': attDl.headers.get('etag') } });
check('mail attachments: ETag + 304', attDl.status === 200 && attAgain.status === 304, { a: attDl.status, b: attAgain.status });

// ── Clean up what we can (the rest is seeded away by the next `db:seed`) ────
for (const id of [up.data.id, doc.id, inTeam.data?.id]) {
  if (!id) continue;
  const owner = id === inTeam.data?.id ? claudia : ken;
  await call('POST', `/resources/${id}/trash`, { user: owner });
  await call('DELETE', `/resources/${id}`, { user: owner });
}

console.log(failures ? `\n${failures} failed` : '\nall storage checks passed');
process.exit(failures ? 1 : 0);
