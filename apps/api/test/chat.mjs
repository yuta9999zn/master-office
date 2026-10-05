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
const [claudia, hana, mika, sora, ken, rina, yuki] = ['claudia', 'hana', 'mika', 'sora', 'ken', 'rina', 'yuki'].map(uid);
const resByName = async (name, user = claudia) => (await call('GET', '/search?q=' + encodeURIComponent(name), { user })).data.find((h) => h.kind === 'resource' && h.title === name);
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
const itmMsg = await call('POST', `/chat/conversations/${itm.id}/messages`, { user: claudia, body: { body: 'Private note for the project' } });
await sleep(300);
check('people outside a private channel get nothing', !sk.events.some((e) => e.type === 'chat.message' && e.message.id === itmMsg.data.id));
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
check('DMs and groups are outside spaces', (await list(ken)).find((c) => c.id === d1.data.id).spaceId === null);

const g = await call('POST', '/chat/conversations', { user: ken, body: { kind: 'group', memberIds: [sora, mika] } });
const gs = (await list(ken)).find((c) => c.id === g.data.id);
check('a group without a name is titled with its members', g.status === 201 && gs.kind === 'group' && gs.title.split(', ').sort().join() === 'Mika,Sora' && gs.memberCount === 3, gs);
check('a group needs other people', (await call('POST', '/chat/conversations', { user: ken, body: { kind: 'group', memberIds: [ken] } })).status === 400);
const ten = users.filter((u) => u.id !== ken).map((u) => u.id); // 9 others + Ken = 10
const big = await call('POST', '/chat/conversations', { user: ken, body: { kind: 'group', memberIds: ten } });
check('a group holds up to 10 people (the limit; bigger teams use a channel)', big.status === 201 && (await list(ken)).find((c) => c.id === big.data.id).memberCount === 10);
const conv1 = await sk.wait((e) => e.type === 'chat.conversation' && e.conversationId === g.data.id);
check('members are told about a new conversation', !!conv1);

// ── Channels live in spaces (the Discord model, §68) ────────────────────────
const spaces = (await call('GET', '/spaces', { user: claudia })).data;
const ops = spaces.find((s) => s.name === 'Operations'); // owner Mika; Yuki, Sora, Ken editors; Claudia admin
const hr = spaces.find((s) => s.name === 'HR'); // private: Rina owner, Claudia admin
const mkt = spaces.find((s) => s.name === 'Marketing'); // Yuki and Sora are commenters
check('a channel needs a space', (await call('POST', '/chat/conversations', { user: mika, body: { kind: 'channel', name: 'Nowhere' } })).status === 400);
check('only space admins create channels', (await call('POST', '/chat/conversations', { user: ken, body: { kind: 'channel', name: 'Mine', spaceId: ops.id } })).status === 403);
const cat = await call('POST', `/chat/spaces/${ops.id}/categories`, { user: mika, body: { name: 'Projects' } });
check('space admins add categories', cat.status === 201 && cat.data.name === 'Projects');
check('members cannot add categories', (await call('POST', `/chat/spaces/${ops.id}/categories`, { user: ken, body: { name: 'X' } })).status === 403);
const ch = await call('POST', '/chat/conversations', { user: mika, body: { kind: 'channel', name: 'Autumn launch', description: 'Launch coordination', visibility: 'public', spaceId: ops.id, categoryId: cat.data.id } });
check('creating a channel in a space and category', ch.status === 201);
const inKen = (await list(ken)).find((c) => c.id === ch.data.id);
check('a public channel includes everyone in the space — no joining', inKen?.spaceId === ops.id && inKen.categoryId === cat.data.id && inKen.memberCount >= 5 && inKen.unread === 0, inKen);
check('editors may post and attach, not manage', inKen.perms.post && inKen.perms.attach && inKen.perms.react && !inKen.perms.manage && !inKen.perms.moderate, inKen.perms);
check('the space owner manages it', (await list(mika)).find((c) => c.id === ch.data.id).perms.manage);
const cats = (await call('GET', `/chat/spaces/${ops.id}/categories`, { user: ken })).data;
check('categories are listed for the space', cats.some((c) => c.id === cat.data.id));
const asHana = (await list(hana)).find((c) => c.id === ch.data.id);
check('people who only view the space read its public channels but cannot write', !!asHana && !asHana.perms.post && !asHana.perms.react, asHana?.perms);
check('… posting is refused', (await call('POST', `/chat/conversations/${ch.data.id}/messages`, { user: hana, body: { body: 'hi' } })).status === 403);
check('a space nobody let you see is invisible', !(await list(ken)).some((c) => c.spaceId === hr.id));
check('you cannot leave a public channel (mute it instead)', (await call('DELETE', `/chat/conversations/${ch.data.id}/members/${ken}`, { user: ken })).status === 400);
check('nor add people to it', (await call('POST', `/chat/conversations/${ch.data.id}/members`, { user: mika, body: { userIds: [rina] } })).status === 400);

check('members cannot change channel settings', (await call('PATCH', `/chat/conversations/${ch.data.id}`, { user: ken, body: { name: 'Mine' } })).status === 403);
check('the space owner renames the channel', (await call('PATCH', `/chat/conversations/${ch.data.id}`, { user: mika, body: { name: 'Autumn launch 2026' } })).status === 204);
check('an emptied name is refused for channels', (await call('PATCH', `/chat/conversations/${ch.data.id}`, { user: mika, body: { name: '  ' } })).status === 400);
await call('PATCH', `/chat/conversations/${ch.data.id}`, { user: mika, body: { postPolicy: 'admins' } });
check('announcement channels: members cannot post', (await call('POST', `/chat/conversations/${ch.data.id}/messages`, { user: ken, body: { body: 'hi' } })).status === 403);
const annc = await call('POST', `/chat/conversations/${ch.data.id}/messages`, { user: mika, body: { body: 'Launch is on the 20th' } });
check('… admins can', annc.status === 201);
check('… members still react', (await call('POST', `/chat/messages/${annc.data.id}/reactions`, { user: ken, body: { emoji: '🎉' } })).status === 201);
await call('PATCH', `/chat/conversations/${ch.data.id}`, { user: mika, body: { postPolicy: 'all' } });

// Roles: commenters write but do not attach; only moderators delete others' messages or pin.
const yukiMsg = await call('POST', `/chat/conversations/${marketing.id}/messages`, { user: yuki, body: { body: 'Commenters can write' } });
check('commenters post', yukiMsg.status === 201);
const proposal = await resByName('Campaign Proposal');
check('commenters cannot attach files', (await call('POST', `/chat/conversations/${marketing.id}/messages`, { user: yuki, body: { body: 'x', resourceIds: [proposal.id] } })).status === 403);
check('… nor get an upload folder', (await call('POST', `/chat/conversations/${marketing.id}/upload-folder`, { user: yuki })).status === 403);
const kenMsg = await call('POST', `/chat/conversations/${ch.data.id}/messages`, { user: ken, body: { body: 'Ken was here' } });
check('members cannot delete others\' messages', (await call('DELETE', `/chat/messages/${kenMsg.data.id}`, { user: sora })).status === 403);
check('members cannot pin in a channel', (await call('PUT', `/chat/messages/${kenMsg.data.id}/pin`, { user: sora, body: { pinned: true } })).status === 403);
check('the space owner moderates', (await call('PUT', `/chat/messages/${kenMsg.data.id}/pin`, { user: mika, body: { pinned: true } })).status === 200 && (await call('DELETE', `/chat/messages/${kenMsg.data.id}`, { user: mika })).status === 204);

// Private channels: only the people on them (and space admins).
const priv = await call('POST', '/chat/conversations', { user: mika, body: { kind: 'channel', name: 'ops-leads', visibility: 'private', spaceId: ops.id, memberIds: [ken] } });
check('a private channel is visible to its members', priv.status === 201 && (await list(ken)).some((c) => c.id === priv.data.id));
check('… and hidden from the rest of the space', !(await list(yuki)).some((c) => c.id === priv.data.id) && (await call('GET', `/chat/conversations/${priv.data.id}/messages`, { user: yuki })).status === 404);
check('space admins see every channel', (await call('GET', `/chat/conversations/${priv.data.id}`, { user: claudia })).status === 200);
const hrChan = await call('POST', '/chat/conversations', { user: rina, body: { kind: 'channel', name: 'hiring', visibility: 'private', spaceId: hr.id } });
check('people outside the space cannot be added to its channels', hrChan.status === 201 && (await call('POST', `/chat/conversations/${hrChan.data.id}/members`, { user: rina, body: { userIds: [ken] } })).status === 400);
check('members of a private channel cannot add people (admins do)', (await call('POST', `/chat/conversations/${priv.data.id}/members`, { user: ken, body: { userIds: [yuki] } })).status === 403);
check('admins add people to a private channel', (await call('POST', `/chat/conversations/${priv.data.id}/members`, { user: mika, body: { userIds: [yuki] } })).data.added === 1);
check('admins can promote members', (await call('PUT', `/chat/conversations/${priv.data.id}/members/${ken}/role`, { user: mika, body: { role: 'admin' } })).status === 204);
check('a promoted admin removes people', (await call('DELETE', `/chat/conversations/${priv.data.id}/members/${yuki}`, { user: ken })).status === 204);
check('removed people lose access', (await call('GET', `/chat/conversations/${priv.data.id}/messages`, { user: yuki })).status === 404);

// Files sent in a channel live in its space; a private channel's folder is closed to the rest of the space.
const pubFolder = await call('POST', `/chat/conversations/${ch.data.id}/upload-folder`, { user: ken });
const pubFolderInfo = (await call('GET', `/resources/${pubFolder.data.id}`, { user: yuki })).data;
check('a channel\'s files go to "Chat files / #channel" in its space', pubFolder.status === 201 && pubFolderInfo.name === '#Autumn launch 2026' && pubFolderInfo.spaceId === ops.id && (await call('GET', `/resources/${pubFolderInfo.parentId}`, { user: yuki })).data.name === 'Chat files', pubFolderInfo);
check('the folder is created once', (await call('POST', `/chat/conversations/${ch.data.id}/upload-folder`, { user: mika })).data.id === pubFolder.data.id);
const privFolder = (await call('POST', `/chat/conversations/${priv.data.id}/upload-folder`, { user: ken })).data;
const kenRole = (await call('GET', `/resources/${privFolder.id}`, { user: ken })).data;
check('a private channel\'s folder is open to its members', kenRole.myRole === 'editor', kenRole);
check('… and closed to the rest of the space', (await call('GET', `/resources/${privFolder.id}`, { user: yuki })).status === 404 && (await call('GET', `/resources/${privFolder.id}`, { user: sora })).status === 404);
const spaceLink = (await call('POST', `/spaces/${ops.id}/members`, { user: mika, body: { userId: ken, role: null } }));
check('leaving the space takes you out of its private channels', spaceLink.status < 300 && (await call('GET', `/chat/conversations/${priv.data.id}/messages`, { user: ken })).status === 404, spaceLink);
check('… and out of their file folders', (await call('GET', `/resources/${privFolder.id}`, { user: ken })).status === 404);
await call('POST', `/spaces/${ops.id}/members`, { user: mika, body: { userId: ken, role: 'editor' } });
check('joining the space again brings the public channels back', (await list(ken)).find((c) => c.id === ch.data.id)?.perms.post === true);

// ── Files, links and pins (§65, §68) ────────────────────────────────────────
const itmHist = (u) => call('GET', `/chat/conversations/${itm.id}/messages`, { user: u }).then((r) => r.data.messages);
const plan = (await itmHist(claudia)).find((m) => m.attachments.length && m.sender.id === uid('fujita'));
check('seeded attachments show live file metadata to people who can open them', plan?.attachments[0].accessible === true && plan.attachments[0].name === 'Project Plan Sep.pptx' && plan.attachments[0].type === 'presentation', plan?.attachments);

const hrManual = await resByName('HR Manual');
const dmHana = (await call('POST', '/chat/conversations', { user: claudia, body: { kind: 'dm', userId: hana } })).data.id;
let fs1 = await call('POST', `/chat/conversations/${dmHana}/messages`, { user: claudia, body: { body: 'The new HR manual', resourceIds: [hrManual.id] } });
check('sending a file someone cannot open says who will see it locked (409)', fs1.status === 409 && fs1.data.code === 'needs_access' && fs1.data.missing[0].resourceId === hrManual.id && fs1.data.missing[0].users[0].id === hana, fs1.data);
check('nothing was sent while asking', !(await call('GET', `/chat/conversations/${dmHana}/messages`, { user: claudia })).data.messages.some((m) => m.body === 'The new HR manual'));
check('chat never hands out file access', (await call('POST', `/chat/conversations/${dmHana}/messages`, { user: claudia, body: { body: 'x', resourceIds: [hrManual.id], grant: 'viewer' } })).status === 400);
fs1 = await call('POST', `/chat/conversations/${dmHana}/messages`, { user: claudia, body: { body: '', resourceIds: [hrManual.id], grant: 'none' } });
check('"send anyway" sends — and the recipient still cannot open it', fs1.status === 201 && (await call('GET', `/resources/${hrManual.id}`, { user: hana })).status === 404, fs1.data);
check('a file-only message has an empty body and shows in the preview', (await list(hana)).find((c) => c.id === dmHana).lastMessage.files === 1);
const dmFolder = (await call('POST', `/chat/conversations/${dmHana}/upload-folder`, { user: hana })).data;
const fd = new FormData();
fd.append('file', new Blob(['agenda'], { type: 'text/plain' }), 'agenda.txt');
fd.append('parentId', dmFolder.id);
const up = await fetch(API + '/resources/upload', { method: 'POST', headers: { 'x-user-id': claudia }, body: fd }).then((r) => r.json());
check('a file one person uploads into the DM folder opens for the other (even the folder owner)', (await call('GET', `/resources/${up.id}`, { user: hana })).status === 200 && (await call('GET', `/resources/${up.id}`, { user: ken })).status === 404, up);
check('a DM\'s files folder is shared with exactly its two people', (await call('GET', `/resources/${dmFolder.id}`, { user: claudia })).status === 200 && (await call('GET', `/resources/${dmFolder.id}`, { user: ken })).status === 404);

// Budget 2027 lives in the private Finance space: Claudia (admin) and Hana (viewer) can open it, the rest cannot.
const budget = await resByName('Budget 2027');
const r409 = await call('POST', `/chat/conversations/${marketing.id}/messages`, { user: claudia, body: { body: 'For reference', resourceIds: [budget.id] } });
check('in a channel every member without access is listed', r409.status === 409 && r409.data.missing[0].users.length >= 3 && !r409.data.missing[0].users.some((u) => u.id === claudia || u.id === hana), r409.data);
const sm = await socket(mika);
const sentNone = await call('POST', `/chat/conversations/${marketing.id}/messages`, { user: claudia, body: { body: 'For reference', resourceIds: [budget.id], grant: 'none' } });
check('sent anyway, nobody gained access', sentNone.status === 201 && (await call('GET', `/resources/${budget.id}`, { user: mika })).status === 404);
const pushedLocked = await sm.wait((e) => e.type === 'chat.message' && e.message.id === sentNone.data.id);
const pushedOpen = await sh.wait((e) => e.type === 'chat.message' && e.message.id === sentNone.data.id);
check('pushed messages carry each recipient\'s own view of the file', pushedLocked?.message.attachments[0].accessible === false && pushedLocked.message.attachments[0].name === null && pushedOpen?.message.attachments[0].name === 'Budget 2027', [pushedLocked?.message.attachments, pushedOpen?.message.attachments]);
const lockedInHistory = (await call('GET', `/chat/conversations/${marketing.id}/messages`, { user: mika })).data.messages.find((m) => m.id === sentNone.data.id);
check('people without access see a locked card with no name', lockedInHistory.attachments[0].accessible === false && lockedInHistory.attachments[0].name === null && lockedInHistory.attachments[0].owner === null, lockedInHistory.attachments);
check('attaching a file you cannot open is refused', (await call('POST', `/chat/conversations/${itm.id}/messages`, { user: mika, body: { body: 'x', resourceIds: [budget.id] } })).status === 404);

const general = mine.find((c) => c.title === 'General');
const roadmap = await resByName('Product Roadmap');
const linked = await call('POST', `/chat/conversations/${general.id}/messages`, { user: claudia, body: { body: `Roadmap is here: http://localhost:3000/docs/${roadmap.id} and a private one http://localhost:3000/docs/${hrManual.id}`, grant: 'none' } });
check('links to files become cards (unfurl)', linked.status === 201 && linked.data.attachments.some((a) => a.id === roadmap.id && a.source === 'link'), linked.data);
const branch625 = mine.find((c) => c.title === 'Branch 625');
const hidden = await call('POST', `/chat/conversations/${branch625.id}/messages`, { user: mika, body: { body: `see http://localhost:3000/sheets/${budget.id}` } });
check('links to files the sender cannot open stay plain text', hidden.status === 201 && hidden.data.attachments.length === 0, hidden.data);

const files = (await call('GET', `/chat/conversations/${marketing.id}/files`, { user: claudia })).data;
check('the Files tab lists shared files once, newest first', files[0].file.id === budget.id && new Set(files.map((f) => f.file.id)).size === files.length, files.map((f) => f.file.name));
await call('DELETE', `/chat/messages/${sentNone.data.id}`, { user: claudia });
check('deleting a message drops its files from the Files tab (the file stays in Drive)', !(await call('GET', `/chat/conversations/${marketing.id}/files`, { user: claudia })).data.some((f) => f.file.id === budget.id) && (await call('GET', `/resources/${budget.id}`, { user: claudia })).status === 200);

const target = (await call('GET', `/chat/conversations/${itm.id}/messages`, { user: claudia })).data.messages.find((m) => m.kind === 'text' && m.sender.id === uid('minh'));
const pinned1 = await call('PUT', `/chat/messages/${target.id}/pin`, { user: claudia, body: { pinned: true } });
check('pinning a message', pinned1.status === 200 && pinned1.data.pinnedAt && pinned1.data.pinnedBy.id === claudia, pinned1.data);
check('pins are announced and listed', (await call('GET', `/chat/conversations/${itm.id}/messages`, { user: mika })).data.messages.some((m) => m.kind === 'system' && m.body === 'pinned a message') && (await call('GET', `/chat/conversations/${itm.id}/pins`, { user: mika })).data[0]?.id === target.id);
check('non-members cannot pin', (await call('PUT', `/chat/messages/${target.id}/pin`, { user: ken, body: { pinned: false } })).status === 404);
await call('PUT', `/chat/messages/${target.id}/pin`, { user: claudia, body: { pinned: false } });
check('unpinning', (await call('GET', `/chat/conversations/${itm.id}/pins`, { user: claudia })).data.length === 0);
const dmPin = await call('PUT', `/chat/messages/${fs1.data.id}/pin`, { user: hana, body: { pinned: true } });
check('anyone in a DM may pin', dmPin.status === 200);

// ── Preferences ─────────────────────────────────────────────────────────────
await call('PUT', `/chat/conversations/${itm.id}/prefs`, { user: claudia, body: { pinned: true, muted: true } });
const pinned = (await list(claudia)).find((c) => c.id === itm.id);
check('pin and mute are per person', pinned.pinned && pinned.muted && !(await list(mika)).find((c) => c.id === itm.id).pinned, pinned);
await call('PUT', `/chat/conversations/${itm.id}/prefs`, { user: claudia, body: { pinned: false, muted: false } });
check('empty messages are refused', (await call('POST', `/chat/conversations/${itm.id}/messages`, { user: claudia, body: { body: '   ' } })).status === 400);

for (const s of [sc, sh, sk, sm]) s.ws.close();
bad.terminate();
console.log(failures ? `\n${failures} check(s) failed` : '\nall chat checks passed');
process.exit(failures ? 1 : 0);
