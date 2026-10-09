// End-to-end smoke test for the Phase 1 API. Requires a running API + seeded DB.
//   node apps/api/test/smoke.mjs
const API = process.env.API_URL ?? 'http://localhost:4000';
let failures = 0;

async function call(method, path, { user, body, form, raw } = {}) {
  const headers = {};
  if (user) headers['x-user-id'] = user;
  if (body) headers['content-type'] = 'application/json';
  const res = await fetch(API + path, { method, headers, body: form ?? (body ? JSON.stringify(body) : undefined) });
  if (raw) return res;
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null };
}
function check(name, cond, extra) {
  console.log(`${cond ? '✓' : '✗'} ${name}${cond ? '' : ' ' + JSON.stringify(extra ?? '')}`);
  if (!cond) failures++;
}

const me = (await call('GET', '/me')).data.user;
const users = (await call('GET', '/users')).data;
const byEmail = (e) => users.find((u) => u.email === e).id;
const mai = byEmail('mika@hanami.example');
const bao = byEmail('hana@hanami.example');

// Create & rename with optimistic concurrency
const folder = (await call('POST', '/resources', { body: { name: 'Smoke Folder', type: 'folder' } })).data;
check('create folder in My Files', folder.type === 'folder' && folder.myRole === 'owner');
const doc = (await call('POST', '/resources', { body: { name: 'Smoke Doc', type: 'document', parentId: folder.id } })).data;
check('create document in folder', doc.parentId === folder.id && doc.path[0] === folder.id);
const stale = await call('PATCH', `/resources/${doc.id}`, { body: { name: 'x' } });
check('rename', stale.status === 200 && stale.data.name === 'x');
const conflict = await fetch(`${API}/resources/${doc.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json', 'if-match': '1' }, body: JSON.stringify({ name: 'y' }) });
check('stale If-Match → 409', conflict.status === 409);

// Upload / download round trip (Vietnamese filename)
const fd = new FormData();
fd.append('file', new Blob(['xin chào, Master Office'], { type: 'text/plain' }), 'Ghi chú.txt');
fd.append('parentId', folder.id);
const up = await call('POST', '/resources/upload', { form: fd });
check('upload', up.status === 201 && up.data.name === 'Ghi chú.txt', up);
check('search finds upload', (await call('GET', '/search?q=' + encodeURIComponent('Ghi chú'))).data.some((h) => h.id === up.data.id));
const dl = await call('GET', `/resources/${up.data.id}/download`, { raw: true });
check('download content', (await dl.text()) === 'xin chào, Master Office');
check('download filename*', /filename\*=UTF-8''Ghi%20ch%C3%BA\.txt/.test(dl.headers.get('content-disposition')));

// Permissions: Mai cannot see Anh's private folder until shared
check('other user cannot see', (await call('GET', `/resources/${doc.id}`, { user: mai })).status === 404);
await call('POST', `/resources/${folder.id}/members`, { body: { userId: mai, role: 'viewer' } });
const inherited = await call('GET', `/resources/${doc.id}`, { user: mai });
check('ACL inherits to children', inherited.status === 200 && inherited.data.myRole === 'viewer');
check('viewer cannot rename', (await call('PATCH', `/resources/${doc.id}`, { user: mai, body: { name: 'hack' } })).status === 403);
const sharedList = (await call('GET', '/resources?view=shared', { user: mai })).data;
check('appears in Shared with me', sharedList.some((r) => r.id === folder.id));
const members = (await call('GET', `/resources/${doc.id}/members`)).data;
check('members shows inherited', members.some((m) => m.principal.id === mai && m.source === 'inherited'));

// Space permissions: private HR space invisible to Bao
const spaces = (await call('GET', '/spaces', { user: bao })).data;
check('private space hidden', !spaces.some((s) => s.name === 'HR'));
check('public space visible as viewer', spaces.find((s) => s.name === 'Branch 575')?.myRole === 'viewer');

// Move into a space, copy, trash, restore, destroy
const mk = (await call('GET', '/spaces')).data.find((s) => s.name === 'Marketing');
const moved = await call('PATCH', `/resources/${folder.id}`, { body: { spaceId: mk.id, parentId: null } });
check('move folder to space', moved.status === 200 && moved.data.spaceId === mk.id, moved);
const child = (await call('GET', `/resources/${doc.id}`)).data;
check('descendants follow move', child.spaceId === mk.id && child.breadcrumb[0].name === 'Marketing');
const copy = await call('POST', `/resources/${folder.id}/copy`, { body: {} });
check('deep copy', copy.status === 201 && copy.data.name === 'Smoke Folder (Copy)');
const copyKids = (await call('GET', `/resources?parentId=${copy.data.id}`)).data;
check('copy has children', copyKids.length === 2, copyKids.length);

await call('POST', `/resources/${folder.id}/trash`);
check('child of trashed folder hidden from search', !(await call('GET', '/search?q=' + encodeURIComponent('Ghi chú'))).data.some((h) => h.id === up.data.id));
check('in trash', (await call('GET', '/resources?view=trash')).data.some((r) => r.id === folder.id));
check('child of trashed not listed at top', !(await call('GET', '/resources?view=trash')).data.some((r) => r.id === doc.id));
await call('POST', `/resources/${folder.id}/restore`);
check('restored', (await call('GET', `/resources?spaceId=${mk.id}`)).data.some((r) => r.id === folder.id));

for (const id of [folder.id, copy.data.id]) {
  await call('POST', `/resources/${id}/trash`);
  const del = await call('DELETE', `/resources/${id}`);
  check('permanent delete', del.status === 204, del);
}
check('descendants deleted', (await call('GET', `/resources/${doc.id}`)).status === 404);

const act = (await call('GET', `/spaces/${mk.id}/activity`)).data;
check('space activity recorded', act.some((e) => e.action === 'resource.moved'));

console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
