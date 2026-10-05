// Phase 5 integration test: notifications (the bell) — chat mentions and thread replies, sharing, comments,
// read state (explicit, and by reading the conversation / opening the thread), realtime push.
//   node apps/api/test/notifications.mjs
import WebSocket from 'ws';

const API = process.env.API_URL ?? 'http://localhost:4000';
let failures = 0;
const check = (name, cond, extra) => {
  console.log(`${cond ? '✓' : '✗'} ${name}${cond ? '' : ' ' + JSON.stringify(extra ?? '')}`);
  if (!cond) failures++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(method, path, { user, body } = {}) {
  const headers = {};
  if (user) headers['x-user-id'] = user;
  if (body) headers['content-type'] = 'application/json';
  const res = await fetch(API + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null };
}
async function socket(user) {
  const { data } = await call('GET', '/realtime/token', { user });
  const ws = new WebSocket(`${API.replace(/^http/, 'ws')}/realtime?token=${data.token}`);
  const events = [];
  ws.on('message', (m) => events.push(JSON.parse(String(m))));
  await new Promise((res, rej) => (ws.once('open', res), ws.once('error', rej)));
  const wait = async (pred, ms = 4000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const hit = events.find(pred);
      if (hit) return hit;
      await sleep(50);
    }
    return null;
  };
  return { ws, events, wait };
}

const users = (await call('GET', '/users')).data;
const uid = (key) => users.find((u) => u.email === `${key}@kaori.jp`).id;
const [claudia, hana, mika, ken, minh, fujita] = ['claudia', 'hana', 'mika', 'ken', 'minh', 'fujita'].map(uid);
const inbox = async (user, unread) => (await call('GET', `/notifications${unread ? '?unread=1' : ''}`, { user })).data;
const count = async (user) => (await call('GET', '/notifications/unread-count', { user })).data.unread;
const list = async (user) => (await call('GET', '/chat/conversations', { user })).data;

const marketing = (await list(claudia)).find((c) => c.title === 'Marketing Team');
const sh = await socket(hana);
const before = await count(hana);

// ── Chat mentions ────────────────────────────────────────────────────────────
const m1 = (await call('POST', `/chat/conversations/${marketing.id}/messages`, { user: claudia, body: { body: `<@${hana}> can you review the banner? <@${claudia}> <@${ken}>` } })).data;
const pushed = await sh.wait((e) => e.type === 'notification' && e.notification.kind === 'chat.mention');
check('a mention reaches the person live', pushed?.notification.title === 'Claudia Chen mentioned you in #Marketing Team' && pushed.notification.url === `/chat/${marketing.id}` && pushed.notification.actor?.id === claudia, pushed);
check('the mention text uses names, not tokens', pushed?.notification.body === '@Hana Lee can you review the banner? @Claudia Chen @Ken Watanabe', pushed?.notification.body);
check('the unread count goes up', (await count(hana)) === before + 1);
check('mentioning yourself does not notify you', !(await inbox(claudia)).some((n) => n.kind === 'chat.mention' && n.title.includes('Claudia Chen mentioned')));
check('people who can read the channel are notified, opened or not', (await inbox(ken)).some((n) => n.kind === 'chat.mention' && n.conversationId === marketing.id));
const itm = (await list(claudia)).find((c) => c.title === 'ITM Japan - Project');
await call('POST', `/chat/conversations/${itm.id}/messages`, { user: claudia, body: { body: `<@${ken}> private?` } });
await sleep(300);
check('people outside a private channel are not notified', !(await inbox(ken)).some((n) => n.conversationId === itm.id));

// ── Thread replies ──────────────────────────────────────────────────────────
const inThread = (n) => n.kind === 'chat.reply' && n.url.endsWith(`thread=${m1.id}`);
await call('POST', `/chat/conversations/${marketing.id}/messages`, { user: hana, body: { body: 'On it!', threadRootId: m1.id } });
await sleep(300);
const r1 = (await inbox(claudia, true)).find(inThread);
check('a reply notifies the person who started the thread', r1?.title === 'Hana Lee replied to a thread in #Marketing Team' && r1.url === `/chat/${marketing.id}?thread=${m1.id}` && r1.body === 'On it!', r1);
await call('POST', `/chat/conversations/${marketing.id}/messages`, { user: minh, body: { body: 'Banner v2 is in Drive' } });
await call('POST', `/chat/conversations/${marketing.id}/messages`, { user: minh, body: { body: 'Updated colours', threadRootId: m1.id } });
await sleep(300);
check('later replies notify everyone in the thread', (await inbox(claudia, true)).filter(inThread).length === 2 && (await inbox(hana, true)).some((n) => inThread(n) && n.title.startsWith('Nguyễn Minh')));
check('top-level messages without mentions notify nobody', !(await inbox(hana)).some((n) => n.body === 'Banner v2 is in Drive'));

// ── Reading in chat reads the bell ──────────────────────────────────────────
const hist = (await call('GET', `/chat/conversations/${marketing.id}/messages`, { user: hana })).data.messages;
await call('POST', `/chat/conversations/${marketing.id}/read`, { user: hana, body: { seq: hist.at(-1).seq } });
check('reading past a mention marks it read', !(await inbox(hana, true)).some((n) => n.kind === 'chat.mention' && n.conversationId === marketing.id));
check('… and tells the other tabs', !!(await sh.wait((e) => e.type === 'notification.read' && Array.isArray(e.ids) && e.ids.includes(pushed.notification.id))));
check('thread replies stay unread until the thread is opened', (await inbox(hana, true)).some(inThread));
await call('GET', `/chat/messages/${m1.id}/thread`, { user: hana });
check('opening the thread reads its replies', !(await inbox(hana, true)).some(inThread));

// ── Sharing ─────────────────────────────────────────────────────────────────
const roadmap = (await call('GET', '/search?q=Product%20Roadmap', { user: claudia })).data.find((h) => h.kind === 'resource' && h.title === 'Product Roadmap');
const sk = await socket(ken);
await call('POST', `/resources/${roadmap.id}/members`, { user: claudia, body: { userId: ken, role: 'editor' } });
const shared = await sk.wait((e) => e.type === 'notification' && e.notification.kind === 'resource.shared');
check('sharing a file notifies the person with a link to it', shared?.notification.title === 'Claudia Chen shared "Product Roadmap" with you' && shared.notification.url === `/docs/${roadmap.id}` && shared.notification.body === 'You can edit it.', shared?.notification);
const n0 = (await inbox(ken)).length;
await call('POST', `/resources/${roadmap.id}/members`, { user: claudia, body: { userId: ken, role: null } });
check('removing access sends nothing', (await inbox(ken)).length === n0);
await call('POST', `/resources/${roadmap.id}/members`, { user: claudia, body: { userId: ken, role: 'commenter' } });

// ── Comments ────────────────────────────────────────────────────────────────
const c1 = await call('POST', `/resources/${roadmap.id}/comments`, { user: ken, body: { body: 'Should we move the beta to November?' } });
await sleep(300);
const onMine = (await inbox(fujita, true)).find((n) => n.kind === 'comment.created');
check('a new comment notifies the file owner', c1.status === 201 && onMine?.title === 'Ken Watanabe commented on "Product Roadmap"' && onMine.body === 'Should we move the beta to November?' && onMine.url === `/docs/${roadmap.id}`, onMine);
await call('POST', `/resources/${roadmap.id}/comments`, { user: fujita, body: { body: 'Yes, let us do that', threadId: c1.data.id } });
await sleep(300);
check('a reply notifies the people in the comment thread', (await inbox(ken, true)).some((n) => n.kind === 'comment.reply' && n.title === 'Fujita Sota replied to a comment on "Product Roadmap"'));
check('commenting on your own file does not notify you', !(await inbox(fujita)).some((n) => n.title.startsWith('Fujita Sota')));

// ── Marking read ────────────────────────────────────────────────────────────
const one = (await inbox(ken, true))[0];
check('someone else cannot mark your notifications', (await call('POST', '/notifications/read', { user: mika, body: { ids: [one.id] } })).data.read === 0);
const r = await call('POST', '/notifications/read', { user: ken, body: { ids: [one.id] } });
check('marking one read', r.status === 201 && r.data.read === 1 && (await inbox(ken)).find((n) => n.id === one.id).readAt);
await call('POST', '/notifications/read', { user: ken, body: { ids: 'all' } });
check('mark all as read', (await count(ken)) === 0 && (await inbox(ken, true)).length === 0 && (await inbox(ken)).length > 0);
check('the unread filter returns only unread entries', (await inbox(claudia, true)).every((n) => n.readAt === null));

sh.ws.close();
sk.ws.close();
console.log(failures ? `\n${failures} check(s) failed` : '\nall notification checks passed');
process.exit(failures ? 1 : 0);
