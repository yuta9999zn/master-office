// Phase 5 integration test: chat — conversations (DM, group, channel), messages, threads, reactions, mentions,
// unread counts and read receipts, membership and permissions, realtime socket.   node apps/api/test/chat.mjs
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

const users = (await call('GET', '/users')).data;
const uid = (key) => users.find((u) => u.email === `${key}@kaori.jp`).id;
const [claudia, hana, mika, sora, ken, rina] = ['claudia', 'hana', 'mika', 'sora', 'ken', 'rina'].map(uid);
const list = async (user) => (await call('GET', '/chat/conversations', { user })).data;

/** Opens the realtime socket for a user and collects its events. */
async function socket(user) {
  const { data } = await call('GET', '/realtime/token', { user });
  const ws = new WebSocket(`${API.replace(/^http/, 'ws')}/realtime?token=${data.token}`);
  const events = [];
  ws.on('message', (m) => events.push(JSON.parse(String(m))));
  await new Promise((res, rej) => (ws.once('open', res), ws.once('error', rej)));
  return {
    ws,
    events,
    wait: async (pred, ms = 4000) => {
      const end = Date.now() + ms;
      while (Date.now() < end) {
        const hit = events.find(pred);
        if (hit) return hit;
        await sleep(50);
      }
      return null;
    },
  };
}

// ── Seeded conversations ────────────────────────────────────────────────────
const mine = await list(claudia);
const marketing = mine.find((c) => c.title === 'Marketing Team');
const itm = mine.find((c) => c.title === 'ITM Japan - Project');
check('the seeded conversations are listed newest first', mine.length >= 8 && mine.every((c, i) => i === 0 || (mine[i - 1].lastMessageAt ?? '') >= (c.lastMessageAt ?? '')), mine.map((c) => c.title));
check('unread counts come from the read marker', marketing?.unread === 2 && itm?.unread === 3, { marketing: marketing?.unread, itm: itm?.unread });
check('a mention of the viewer is counted', itm?.mentions === 1, itm);
const dm = mine.find((c) => c.kind === 'dm' && c.peer?.email === 'hana@kaori.jp');
check('a direct message is titled with the other person', dm?.title === 'Hana Lee' && dm.lastMessage?.body === 'File đã gửi nhé', dm);
const group = mine.find((c) => c.title === 'Design Review');
check('a group shows its members as faces', group?.kind === 'group' && group.faces.length === 3 && group.memberCount === 4, group);
check('private channels are hidden from non-members', !(await list(ken)).some((c) => c.id === itm.id) && (await call('GET', `/chat/conversations/${itm.id}`, { user: ken })).status === 404);

const hist = (await call('GET', `/chat/conversations/${marketing.id}/messages`, { user: claudia })).data;
const concept = hist.messages.find((m) => m.body.startsWith('Đây là concept'));
check('history is oldest → newest with system messages', hist.messages[0].kind === 'system' && hist.messages.at(-1).seq > hist.messages[0].seq, hist.messages.map((m) => m.seq));
check('reactions are grouped with "mine" for the viewer', concept.reactions.find((r) => r.emoji === '👍')?.count === 5 && concept.reactions.find((r) => r.emoji === '👍').mine === true && concept.reactions.find((r) => r.emoji === '❤️').mine === false, concept.reactions);
check('thread roots carry the reply count and repliers', concept.replyCount === 2 && concept.repliers.length === 2, concept);
const tasked = hist.messages.find((m) => m.body.includes('task'));
check('mentions are stored as tokens with the ids', tasked.mentions.includes(uid('yuki')) && tasked.body.includes(`<@${uid('yuki')}>`), tasked);
const thread = (await call('GET', `/chat/messages/${concept.id}/thread`, { user: claudia })).data;
check('a thread returns its root and replies', thread.root.id === concept.id && thread.replies.length === 2 && thread.replies[0].threadRootId === concept.id, thread);

// ── Realtime: messages, read receipts, typing ───────────────────────────────
const sc = await socket(claudia);
const sh = await socket(hana);
const sk = await socket(ken);
check('the socket reports who is online', !!(await sc.wait((e) => e.type === 'presence' && e.online.includes(hana) && e.online.includes(claudia))));
const bad = new WebSocket(`${API.replace(/^http/, 'ws')}/realtime?token=forged.token`);
check('a forged socket token is refused', await new Promise((r) => (bad.once('error', () => r(true)), bad.once('open', () => r(false)))));

const sent = await call('POST', `/chat/conversations/${marketing.id}/messages`, { user: hana, body: { body: `Hi <@${claudia}>, the **final** files are in Drive` } });
check('sending returns the message with the next seq', sent.status === 201 && sent.data.seq === marketing.lastSeq + 1 && sent.data.mentions.includes(claudia), sent.data);
const pushed = await sc.wait((e) => e.type === 'chat.message' && e.message.id === sent.data.id);
check('members get the message over the socket', !!pushed && pushed.conversationId === marketing.id);
await sleep(200);
check('non-members get nothing', !sk.events.some((e) => e.type === 'chat.message' && e.conversationId === marketing.id));
let m2 = (await list(claudia)).find((c) => c.id === marketing.id);
check('the new message is unread for others, with the mention counted', m2.unread === 3 && m2.mentions === 1 && m2.lastMessage.sender === 'Hana Lee', m2);
check('the sender has read their own message', (await list(hana)).find((c) => c.id === marketing.id).unread === 0);

const read = await call('POST', `/chat/conversations/${marketing.id}/read`, { user: claudia, body: { seq: sent.data.seq } });
check('marking read clears the unread count', read.status === 201 && (await list(claudia)).find((c) => c.id === marketing.id).unread === 0, read.data);
check('a read receipt goes to the other members', !!(await sh.wait((e) => e.type === 'chat.read' && e.userId === claudia && e.seq === sent.data.seq)));
check('read markers never move backwards', (await call('POST', `/chat/conversations/${marketing.id}/read`, { user: claudia, body: { seq: 1 } })).data.lastReadSeq === sent.data.seq);
check('read markers stop at the last message', (await call('POST', `/chat/conversations/${marketing.id}/read`, { user: claudia, body: { seq: 999999 } })).data.lastReadSeq === sent.data.seq);

sc.ws.send(JSON.stringify({ type: 'typing', conversationId: marketing.id }));
check('typing is relayed to the other members', !!(await sh.wait((e) => e.type === 'chat.typing' && e.user.id === claudia && e.conversationId === marketing.id)));
sk.ws.send(JSON.stringify({ type: 'typing', conversationId: itm.id }));
await sleep(300);
check('typing from a non-member is dropped', !sc.events.some((e) => e.type === 'chat.typing' && e.user.id === ken));

// ── Threads, edits, reactions, delete ───────────────────────────────────────
const reply = await call('POST', `/chat/conversations/${marketing.id}/messages`, { user: claudia, body: { body: 'Looks great!', threadRootId: concept.id } });
check('replying in a thread', reply.status === 201 && reply.data.threadRootId === concept.id);
const rootPush = await sh.wait((e) => e.type === 'chat.message.updated' && e.message.id === concept.id && e.message.replyCount === 3);
check('the root is pushed with the new reply count', !!rootPush);
check('thread replies do not add to the channel unread count', (await list(hana)).find((c) => c.id === marketing.id).unread === 0);
check('nested threads are refused', (await call('POST', `/chat/conversations/${marketing.id}/messages`, { user: claudia, body: { body: 'x', threadRootId: reply.data.id } })).status === 404);

const edited = await call('PATCH', `/chat/messages/${sent.data.id}`, { user: hana, body: { body: 'Hi all, the final files are in Drive' } });
check('the sender edits a message (mentions recomputed)', edited.status === 200 && edited.data.editedAt && edited.data.mentions.length === 0, edited.data);
check('others cannot edit it', (await call('PATCH', `/chat/messages/${sent.data.id}`, { user: claudia, body: { body: 'hacked' } })).status === 403);

let r = await call('POST', `/chat/messages/${sent.data.id}/reactions`, { user: claudia, body: { emoji: '🎉' } });
check('reacting adds the emoji', r.status === 201 && r.data.reactions.find((x) => x.emoji === '🎉')?.count === 1 && r.data.reactions[0].userIds.includes(claudia), r.data);
const reactPush = await sh.wait((e) => e.type === 'chat.message.updated' && e.message.id === sent.data.id && e.message.reactions.length === 1);
check('reactions are pushed with user ids so each viewer can tell its own', !!reactPush && reactPush.message.reactions[0].userIds.includes(claudia));
r = await call('POST', `/chat/messages/${sent.data.id}/reactions`, { user: claudia, body: { emoji: '🎉' } });
check('reacting again removes it', r.data.reactions.length === 0, r.data);
check('non-members cannot react', (await call('POST', `/chat/messages/${sent.data.id}/reactions`, { user: rina, body: { emoji: '👍' } })).status === 403);

check('members cannot delete other people\'s messages', (await call('DELETE', `/chat/messages/${sent.data.id}`, { user: mika })).status === 403);
check('the channel owner can delete any message', (await call('DELETE', `/chat/messages/${concept.id}`, { user: hana })).status === 204);
const after = (await call('GET', `/chat/conversations/${marketing.id}/messages`, { user: claudia })).data.messages.find((m) => m.id === concept.id);
check('a deleted message keeps its place but loses its text and reactions', after.deletedAt && after.body === '' && after.reactions.length === 0 && after.replyCount === 3, after);
check('deleted messages cannot be edited', (await call('PATCH', `/chat/messages/${concept.id}`, { user: hana, body: { body: 'again' } })).status === 400);

const found = (await call('GET', `/chat/conversations/${marketing.id}/search?q=${encodeURIComponent('final files')}`, { user: claudia })).data;
check('search finds messages in the conversation', found.length === 1 && found[0].id === sent.data.id, found);

// ── Creating conversations ──────────────────────────────────────────────────
const d1 = await call('POST', '/chat/conversations', { user: ken, body: { kind: 'dm', userId: sora } });
const d2 = await call('POST', '/chat/conversations', { user: sora, body: { kind: 'dm', userId: ken } });
check('one DM per pair, whoever starts it', d1.status === 201 && d1.data.created && d2.data.id === d1.data.id && !d2.data.created, [d1.data, d2.data]);
const self = await call('POST', '/chat/conversations', { user: ken, body: { kind: 'dm', userId: ken } });
check('a DM with yourself works as notes-to-self', self.status === 201 && (await list(ken)).find((c) => c.id === self.data.id)?.title === 'Ken Watanabe (you)');
check('DMs have no member list to edit', (await call('POST', `/chat/conversations/${d1.data.id}/members`, { user: ken, body: { userIds: [mika] } })).status === 400);

const g = await call('POST', '/chat/conversations', { user: ken, body: { kind: 'group', memberIds: [sora, mika] } });
const gs = (await list(ken)).find((c) => c.id === g.data.id);
check('a group without a name is titled with its members', g.status === 201 && gs.kind === 'group' && gs.title === 'Sora, Mika' && gs.memberCount === 3, gs);
check('a group needs other people', (await call('POST', '/chat/conversations', { user: ken, body: { kind: 'group', memberIds: [ken] } })).status === 400);
const conv1 = await sk.wait((e) => e.type === 'chat.conversation' && e.conversationId === g.data.id);
check('members are told about a new conversation', !!conv1);

const ch = await call('POST', '/chat/conversations', { user: mika, body: { kind: 'channel', name: 'Autumn launch', description: 'Launch coordination', visibility: 'public', memberIds: [hana] } });
check('creating a channel', ch.status === 201);
const browse = (await call('GET', '/chat/channels?q=autumn', { user: ken })).data;
check('public channels can be browsed and searched', browse.length === 1 && browse[0].title === 'Autumn launch' && browse[0].joined === false && browse[0].memberCount === 2, browse);
const preview = await call('GET', `/chat/conversations/${ch.data.id}`, { user: ken });
check('anyone in the workspace can preview a public channel', preview.status === 200 && preview.data.joined === false && preview.data.members.length === 2, preview.data);
check('previewers can read but not post', (await call('GET', `/chat/conversations/${ch.data.id}/messages`, { user: ken })).status === 200 && (await call('POST', `/chat/conversations/${ch.data.id}/messages`, { user: ken, body: { body: 'hi' } })).status === 403);
check('joining a public channel', (await call('POST', `/chat/conversations/${ch.data.id}/join`, { user: ken })).status === 204 && (await list(ken)).some((c) => c.id === ch.data.id));
const joinedHist = (await call('GET', `/chat/conversations/${ch.data.id}/messages`, { user: ken })).data.messages;
check('joins are recorded as system messages', joinedHist.some((m) => m.kind === 'system' && m.body === 'joined' && m.sender.id === ken), joinedHist);
check('joiners start with nothing unread', (await list(ken)).find((c) => c.id === ch.data.id).unread === 0);

check('members cannot change channel settings', (await call('PATCH', `/chat/conversations/${ch.data.id}`, { user: ken, body: { name: 'Mine' } })).status === 403);
check('the owner renames the channel', (await call('PATCH', `/chat/conversations/${ch.data.id}`, { user: mika, body: { name: 'Autumn launch 2026', visibility: 'private' } })).status === 204);
const renamed = await call('GET', `/chat/conversations/${ch.data.id}`, { user: mika });
check('rename and visibility change are applied and announced', renamed.data.title === 'Autumn launch 2026' && renamed.data.visibility === 'private', renamed.data);
check('an emptied name is refused for channels', (await call('PATCH', `/chat/conversations/${ch.data.id}`, { user: mika, body: { name: '  ' } })).status === 400);
check('private channels are no longer browsable', !(await call('GET', '/chat/channels?q=autumn', { user: rina })).data.length);

check('members add people', (await call('POST', `/chat/conversations/${ch.data.id}/members`, { user: ken, body: { userIds: [rina, rina] } })).data.added === 1);
check('people outside the workspace cannot be added', (await call('POST', `/chat/conversations/${ch.data.id}/members`, { user: ken, body: { userIds: ['00000000-0000-4000-8000-000000000000'] } })).status === 400);
check('members cannot remove others', (await call('DELETE', `/chat/conversations/${ch.data.id}/members/${rina}`, { user: ken })).status === 403);
check('admins can promote members', (await call('PUT', `/chat/conversations/${ch.data.id}/members/${ken}/role`, { user: mika, body: { role: 'admin' } })).status === 204);
check('a promoted admin removes people', (await call('DELETE', `/chat/conversations/${ch.data.id}/members/${rina}`, { user: ken })).status === 204);
check('removed people lose access', (await call('GET', `/chat/conversations/${ch.data.id}/messages`, { user: rina })).status === 404);
check('the owner leaving hands over ownership', (await call('DELETE', `/chat/conversations/${ch.data.id}/members/${mika}`, { user: mika })).status === 204 && (await call('GET', `/chat/conversations/${ch.data.id}`, { user: hana })).data.members.find((m) => m.id === hana)?.role === 'owner');

// ── Preferences ─────────────────────────────────────────────────────────────
await call('PUT', `/chat/conversations/${itm.id}/prefs`, { user: claudia, body: { pinned: true, muted: true } });
const pinned = (await list(claudia)).find((c) => c.id === itm.id);
check('pin and mute are per person', pinned.pinned && pinned.muted && !(await list(mika)).find((c) => c.id === itm.id).pinned, pinned);
await call('PUT', `/chat/conversations/${itm.id}/prefs`, { user: claudia, body: { pinned: false, muted: false } });
check('empty messages are refused', (await call('POST', `/chat/conversations/${itm.id}/messages`, { user: claudia, body: { body: '   ' } })).status === 400);

for (const s of [sc, sh, sk]) s.ws.close();
bad.terminate();
console.log(failures ? `\n${failures} check(s) failed` : '\nall chat checks passed');
process.exit(failures ? 1 : 0);
