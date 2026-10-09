// Phase 2b API test: notes metadata, links/backlinks (permission-filtered), mind map alongside the body.
//   node apps/api/test/notes.mjs
import { HocuspocusProvider } from '@hocuspocus/provider';
import * as Y from 'yjs';

const API = process.env.API_URL ?? 'http://localhost:4000';
let failures = 0;
const check = (name, cond, extra) => {
  console.log(`${cond ? '✓' : '✗'} ${name}${cond ? '' : ' ' + JSON.stringify(extra ?? '').slice(0, 300)}`);
  if (!cond) failures++;
};
const call = async (method, path, { user, body } = {}) => {
  const headers = {};
  if (user) headers['x-user-id'] = user;
  if (body) headers['content-type'] = 'application/json';
  const res = await fetch(API + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  return { status: res.status, data: text ? (text.startsWith('{') || text.startsWith('[') ? JSON.parse(text) : text) : null };
};
const users = (await call('GET', '/users')).data;
const uid = (k) => users.find((u) => u.email === `${k}@hanami.example`).id;
const hana = uid('hana');
const find = async (q) => (await call('GET', `/search?q=${encodeURIComponent(q)}`)).data.find((h) => h.kind === 'resource');

// A private note (Claudia's My Files) that links to a shared document.
const note = (await call('POST', '/resources', { body: { name: 'API note test', type: 'note' } })).data;
check('create note resource', note.type === 'note' && !!note.id);
const patched = await call('PATCH', `/resources/${note.id}`, { body: { notebook: 'Projects/API', properties: [{ key: 'Quarter', value: 'Q4' }] } });
check('notebook + properties stored in metadata', patched.data.metadata?.notebook === 'Projects/API' && patched.data.metadata?.properties?.[0]?.value === 'Q4', patched.data.metadata);
check('properties are validated', (await call('PATCH', `/resources/${note.id}`, { body: { properties: [{ key: '', value: 'x' }] } })).status === 400);

const target = await find('Marketing Plan - Q4 2026');
const t = (await call('GET', `/resources/${note.id}/collab-token`)).data;
const doc = new Y.Doc();
const provider = await new Promise((resolve, reject) => {
  const p = new HocuspocusProvider({ url: t.url, name: t.document, token: t.token, document: doc, onSynced: () => resolve(p) });
  setTimeout(() => reject(new Error('sync timeout')), 10000);
});
doc.transact(() => {
  const p = new Y.XmlElement('paragraph');
  const link = new Y.XmlElement('resourceLink');
  link.setAttribute('id', target.id);
  link.setAttribute('name', target.title);
  link.setAttribute('type', 'document');
  p.insert(0, [new Y.XmlText('See '), link]);
  doc.getXmlFragment('default').push([p]);
  doc.getMap('mindmap').set('root', { id: 'root', parentId: null, kind: 'root', text: 'API note test', order: 0 });
});
await new Promise((r) => setTimeout(r, 3000));

const links = (await call('GET', `/resources/${note.id}/links`)).data;
check('outgoing link recorded from the saved note', links.linked.some((x) => x.id === target.id));
const back = (await call('GET', `/resources/${target.id}/links`)).data;
check('target lists the note as a backlink (for the owner)', back.backlinks.some((x) => x.id === note.id));
const backForHana = (await call('GET', `/resources/${target.id}/links`, { user: hana })).data;
check('backlinks hide notes the viewer cannot open', !backForHana.backlinks.some((x) => x.id === note.id));
const txt = (await call('GET', `/resources/${note.id}/export?format=txt`)).data;
check('export includes the page link text', typeof txt === 'string' && txt.includes(target.title));
check('notes are found by content search', (await call('GET', `/search?q=${encodeURIComponent('See Marketing Plan')}`)).data.some((h) => h.id === note.id));

// Removing the link removes the backlink.
doc.transact(() => {
  const f = doc.getXmlFragment('default');
  f.delete(0, f.length);
});
await new Promise((r) => setTimeout(r, 3000));
check('backlink disappears when the link is removed', !(await call('GET', `/resources/${target.id}/links`)).data.backlinks.some((x) => x.id === note.id));
check('mind map lives next to the body (not lost by body edits)', doc.getMap('mindmap').get('root')?.text === 'API note test');

provider.destroy();
await call('POST', `/resources/${note.id}/trash`);
await call('DELETE', `/resources/${note.id}`);
console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
