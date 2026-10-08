// Flow (§77): a flow is a collaborative file — created blank or from a template, opened through a collab token,
// versioned and restorable like any native file.   node apps/api/test/flow.mjs
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
const [claudia, ken] = ['claudia', 'ken'].map(uid);

const blank = await call('POST', '/resources', { user: claudia, body: { name: 'Onboarding flow', type: 'flow' } });
check('a flow is a Drive file', blank.status === 201 && blank.data.type === 'flow', blank.data);
const tok = await call('GET', `/resources/${blank.data.id}/collab-token`, { user: claudia });
check('it opens through a collaboration token (editor)', tok.status === 200 && tok.data.role === 'owner' && tok.data.document === `res:${blank.data.id}`, tok.data);
check('others cannot open it', (await call('GET', `/resources/${blank.data.id}/collab-token`, { user: ken })).status === 404);
await call('POST', `/resources/${blank.data.id}/versions`, { user: claudia, body: { label: 'First' } });
const versions = (await call('GET', `/resources/${blank.data.id}/versions`, { user: claudia })).data;
const v = versions.find((x) => x.label === 'First');
const content = await call('GET', `/resources/${blank.data.id}/versions/${v.id}/content`, { user: claudia });
check('a blank flow: Start → First step → End on one page', content.data.flow.nodes.length === 3 && content.data.flow.edges.length === 2 && content.data.flow.pages.length === 1 && content.data.flow.info.status === 'draft', content.data);

const tpl = await call('POST', '/resources', { user: claudia, body: { name: 'Booking', type: 'flow', template: 'booking' } });
await call('POST', `/resources/${tpl.data.id}/versions`, { user: claudia, body: { label: 'Template' } });
const tv = (await call('GET', `/resources/${tpl.data.id}/versions`, { user: claudia })).data.find((x) => x.label === 'Template');
const tf = (await call('GET', `/resources/${tpl.data.id}/versions/${tv.id}/content`, { user: claudia })).data.flow;
check('the booking template: 10 steps, the Yes / No decision, trigger and tags', tf.nodes.length === 10 && tf.edges.some((e) => e.label === 'Yes') && tf.edges.some((e) => e.label === 'No') && tf.info.trigger === 'Form submission' && tf.info.tags.join() === 'Booking,Meeting,Customer', tf.info);
const erf = (await call('POST', '/resources', { user: claudia, body: { name: 'Orders ER', type: 'flow', template: 'erOrders' } })).data;
await call('POST', `/resources/${erf.id}/versions`, { user: claudia, body: { label: 'T' } });
const erv = (await call('GET', `/resources/${erf.id}/versions`, { user: claudia })).data.find((x) => x.label === 'T');
const erFlow = (await call('GET', `/resources/${erf.id}/versions/${erv.id}/content`, { user: claudia })).data.flow;
check('the ER template: tables with attributes, a weak entity, crow’s-foot 1 — n connectors', erFlow.nodes.filter((n) => n.shape === 'erEntity').length === 3 && erFlow.nodes.some((n) => n.shape === 'erWeakEntity' && /PK FK/.test(n.text)) && erFlow.edges.some((e) => e.style.startArrow === 'crowOne' && e.style.endArrow === 'crowZeroMany') && erFlow.edges.some((e) => e.style.endArrow === 'crowOneMany'), erFlow.edges.map((e) => [e.style.startArrow, e.style.endArrow]));
const umf = (await call('POST', '/resources', { user: claudia, body: { name: 'Orders UML', type: 'flow', template: 'umlOrders' } })).data;
await call('POST', `/resources/${umf.id}/versions`, { user: claudia, body: { label: 'T' } });
const umv = (await call('GET', `/resources/${umf.id}/versions`, { user: claudia })).data.find((x) => x.label === 'T');
const umFlow = (await call('GET', `/resources/${umf.id}/versions/${umv.id}/content`, { user: claudia })).data.flow;
check('the UML template: classes with -- compartments, an interface, composition / aggregation / realization heads', umFlow.nodes.filter((n) => n.shape === 'umlClass' && /\n--\n/.test(n.text)).length >= 5 && umFlow.nodes.some((n) => n.shape === 'umlInterface') && umFlow.edges.some((e) => e.style.startArrow === 'diamond') && umFlow.edges.some((e) => e.style.startArrow === 'diamondOpen') && umFlow.edges.filter((e) => e.style.endArrow === 'triangle' && e.style.dash === 'dashed').length === 2, umFlow.edges.map((e) => [e.style.startArrow, e.style.endArrow]));
const catalog = (await call('GET', '/flows/catalog', { user: claudia })).data;
check('the catalog describes every shape, trigger and action (for people and for the AI)', catalog.shapes.length > 120 && catalog.shapes.every((s) => s.description.length > 15) && catalog.shapes.some((s) => s.bpmn?.eventType === 'timer') && catalog.shapes.some((s) => s.category === 'UML') && catalog.shapes.some((s) => s.category === 'Entity Relationship') && catalog.triggers.every((t) => t.description && t.outputs) && catalog.actions.every((a) => a.description && a.required), { shapes: catalog.shapes.length });
const restore = await call('POST', `/resources/${tpl.data.id}/versions/${tv.id}/restore`, { user: claudia });
check('restoring a version works for flows', restore.status === 200 || restore.status === 201 || restore.status === 204, restore);
const copy = await call('POST', `/resources/${tpl.data.id}/copy`, { user: claudia, body: {} });
check('copying a flow copies its diagram', copy.status === 201 && copy.data.type === 'flow', copy.data);
const listed = (await call('GET', '/resources?type=flow', { user: claudia })).data;
check('flows are listed by type (seeded booking workflow included)', (listed.items ?? listed).some((x) => x.name === 'Customer Booking Approval Workflow'));

console.log(failures ? `\n${failures} check(s) failed` : '\nall flow checks passed');
process.exit(failures ? 1 : 0);
