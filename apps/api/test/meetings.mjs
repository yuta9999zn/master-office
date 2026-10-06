// Meetings integration test (§73): rooms and who may enter (open / trusted, conversation members, calendar guests,
// lobby with admit / deny), WebRTC signalling relayed over the realtime socket, mic / camera state, reactions,
// in-call chat, host controls (mute, co-host, remove, end), room size, recording to Drive, notes, calls from a
// conversation (ring, missed call).   node apps/api/test/meetings.mjs
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
const [claudia, hana, mika, ken, sora, rina] = ['claudia', 'hana', 'mika', 'ken', 'sora', 'rina'].map(uid);
const inbox = async (user) => (await call('GET', '/notifications?unread=1', { user })).data;

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
    send: (msg) => ws.send(JSON.stringify(msg)),
    wait: async (pred, ms = 3000) => {
      const end = Date.now() + ms;
      while (Date.now() < end) {
        const hit = events.find(pred);
        if (hit) return hit;
        await sleep(40);
      }
      return null;
    },
  };
}
const peer = (p) => `${p}-${Math.random().toString(36).slice(2, 10)}`;

// ── An instant meeting ──────────────────────────────────────────────────────
const made = await call('POST', '/meetings', { user: claudia, body: {} });
const m = made.data;
const code = m?.code;
check('starting an instant meeting', made.status === 201 && /^[a-z]{3}-[a-z]{4}-[a-z]{3}$/.test(code) && m.access === 'open' && m.me.role === 'host' && m.me.manage && m.title === "Claudia Chen's meeting", m);
const asKen = (await call('GET', `/meetings/${code}`, { user: ken })).data;
check('anyone in the workspace joins an open room directly', asKen.me.entry === 'join' && asKen.me.role === 'guest' && !asKen.me.manage && !asKen.live, asKen.me);
check('unknown or malformed codes are not found', (await call('GET', '/meetings/zzz-zzzz-zzz', { user: ken })).status === 404 && (await call('GET', '/meetings/nope', { user: ken })).status === 404);

const sC = await socket(claudia);
const sK = await socket(ken);
const sH = await socket(hana);
const sR = await socket(rina);
const c1 = peer('c1');
const k1 = peer('k1');
const jc = await call('POST', `/meetings/${code}/join`, { user: claudia, body: { peerId: c1, mic: true, cam: true } });
check('the host joins an empty room', jc.status === 200 && jc.data.state === 'joined' && jc.data.peers.length === 0 && Array.isArray(jc.data.iceServers), jc.data);
const jk = await call('POST', `/meetings/${code}/join`, { user: ken, body: { peerId: k1, mic: true, cam: false } });
check('the next person gets the people already there', jk.data.state === 'joined' && jk.data.peers.length === 1 && jk.data.peers[0].peerId === c1 && jk.data.peers[0].user.id === claudia, jk.data);
check('… and the room hears about them', !!(await sC.wait((e) => e.type === 'meeting.peer.joined' && e.peer.peerId === k1 && e.peer.cam === false)));
const live = (await call('GET', `/meetings/${code}`, { user: hana })).data;
check('the room is live with who is in it', live.live && live.inRoom.length === 2 && live.peers.length === 2 && !!live.startedAt && !live.endedAt, live);
check('keep-alive knows the browsers in the room', (await call('POST', `/meetings/${code}/alive`, { user: ken, body: { peerId: k1 } })).data.ok === true && (await call('POST', `/meetings/${code}/alive`, { user: hana, body: { peerId: k1 } })).data.ok === false);
check('a short-lived peer id is refused', (await call('POST', `/meetings/${code}/join`, { user: ken, body: { peerId: 'x', mic: true, cam: true } })).status === 400);

// ── Signalling over the realtime socket ─────────────────────────────────────
sK.send({ type: 'meeting.signal', meetingId: m.id, peerId: k1, to: c1, data: { description: { type: 'offer', sdp: 'v=0' } } });
const sig = await sC.wait((e) => e.type === 'meeting.signal');
check('WebRTC offers are relayed to the one peer they are for', sig?.from === k1 && sig.to === c1 && sig.data.description.type === 'offer', sig);
sH.send({ type: 'meeting.signal', meetingId: m.id, peerId: k1, to: c1, data: { forged: true } });
await sleep(400);
check('nobody can speak for someone else\'s peer', !sC.events.some((e) => e.type === 'meeting.signal' && e.data.forged));
sK.send({ type: 'meeting.state', meetingId: m.id, peerId: k1, mic: false, hand: true });
const upd = await sC.wait((e) => e.type === 'meeting.peer.updated' && e.peer.peerId === k1);
check('mute and raised hand reach the room', upd?.peer.mic === false && upd.peer.hand === true, upd);
sK.send({ type: 'meeting.reaction', meetingId: m.id, peerId: k1, emoji: '🎉' });
sK.send({ type: 'meeting.reaction', meetingId: m.id, peerId: k1, emoji: '<script>' });
await sleep(400);
const reactions = sC.events.filter((e) => e.type === 'meeting.reaction');
check('reactions from the fixed set only', reactions.length === 1 && reactions[0].emoji === '🎉', reactions);

// ── In-call chat ────────────────────────────────────────────────────────────
check('only people in the room chat', (await call('POST', `/meetings/${code}/messages`, { user: hana, body: { body: 'hi' } })).status === 403);
const said = await call('POST', `/meetings/${code}/messages`, { user: ken, body: { body: 'Can everyone hear me?' } });
check('sending a chat message', said.status === 201 && said.data.user.id === ken);
check('… which the room receives', !!(await sC.wait((e) => e.type === 'meeting.message' && e.message.body === 'Can everyone hear me?')));
check('reading the chat', (await call('GET', `/meetings/${code}/messages`, { user: claudia })).data.at(-1)?.body === 'Can everyone hear me?');

// ── Trusted rooms and the lobby ─────────────────────────────────────────────
check('guests cannot change settings', (await call('PATCH', `/meetings/${code}`, { user: ken, body: { access: 'trusted' } })).status === 403);
check('the host makes the room trusted', (await call('PATCH', `/meetings/${code}`, { user: claudia, body: { access: 'trusted', title: 'Launch sync' } })).status === 204);
check('people who were in keep joining directly', (await call('GET', `/meetings/${code}`, { user: ken })).data.me.entry === 'join');
check('others must ask', (await call('GET', `/meetings/${code}`, { user: hana })).data.me.entry === 'knock');
const knock = await call('POST', `/meetings/${code}/join`, { user: hana, body: { peerId: peer('h1'), mic: true, cam: true } });
check('asking to join puts you in the lobby', knock.data.state === 'waiting', knock.data);
check('the host sees who is waiting', !!(await sC.wait((e) => e.type === 'meeting.lobby' && e.lobby.some((u) => u.id === hana))) && (await call('GET', `/meetings/${code}`, { user: claudia })).data.lobby[0]?.id === hana);
check('guests are not asked while the host is there', (await call('GET', `/meetings/${code}`, { user: ken })).data.lobby.length === 0);
check('… and cannot let people in', (await call('POST', `/meetings/${code}/admit`, { user: ken, body: { userId: hana, allow: true } })).status === 403);
check('the host lets them in', (await call('POST', `/meetings/${code}/admit`, { user: claudia, body: { userId: hana, allow: true } })).status === 204);
check('… they are told', !!(await sH.wait((e) => e.type === 'meeting.admitted' && e.meetingId === m.id)));
const h1 = peer('h1');
const jh = await call('POST', `/meetings/${code}/join`, { user: hana, body: { peerId: h1, mic: true, cam: true } });
check('… and join', jh.data.state === 'joined' && jh.data.peers.length === 2, jh.data);
await call('POST', `/meetings/${code}/join`, { user: rina, body: { peerId: peer('r1'), mic: true, cam: true } });
check('turning someone away', (await call('POST', `/meetings/${code}/admit`, { user: claudia, body: { userId: rina, allow: false } })).status === 204 && !!(await sR.wait((e) => e.type === 'meeting.denied')));
check('… they still have to ask next time', (await call('POST', `/meetings/${code}/join`, { user: rina, body: { peerId: peer('r1'), mic: true, cam: true } })).data.state === 'waiting');
check('giving up waiting leaves the lobby', (await call('POST', `/meetings/${code}/leave`, { user: rina, body: {} })).status === 204 && (await call('GET', `/meetings/${code}`, { user: claudia })).data.lobby.length === 0);

// ── Host controls ───────────────────────────────────────────────────────────
check('the host asks someone to mute', (await call('POST', `/meetings/${code}/mute`, { user: claudia, body: { peerId: h1 } })).status === 204 && !!(await sH.wait((e) => e.type === 'meeting.mute' && e.peerId === h1)));
check('guests cannot mute others', (await call('POST', `/meetings/${code}/mute`, { user: ken, body: { peerId: c1 } })).status === 403);
check('only the host makes co-hosts', (await call('POST', `/meetings/${code}/cohost`, { user: ken, body: { userId: ken, on: true } })).status === 403);
await call('POST', `/meetings/${code}/cohost`, { user: claudia, body: { userId: ken, on: true } });
check('a co-host manages the meeting', (await call('GET', `/meetings/${code}`, { user: ken })).data.me.manage && !!(await sH.wait((e) => e.type === 'meeting.peer.updated' && e.peer.peerId === k1 && e.peer.role === 'cohost')));
check('the host cannot be removed', (await call('POST', `/meetings/${code}/remove`, { user: ken, body: { userId: claudia } })).status === 400);
check('removing someone', (await call('POST', `/meetings/${code}/remove`, { user: ken, body: { userId: hana } })).status === 204 && !!(await sH.wait((e) => e.type === 'meeting.removed')) && !!(await sC.wait((e) => e.type === 'meeting.peer.left' && e.peerId === h1)));
check('… who must ask to come back', (await call('POST', `/meetings/${code}/join`, { user: hana, body: { peerId: peer('h2'), mic: true, cam: true } })).data.state === 'waiting');
await call('POST', `/meetings/${code}/leave`, { user: hana, body: {} });

// ── Room size ───────────────────────────────────────────────────────────────
const extra = [];
for (let i = 0; i < 6; i++) {
  const p = peer(`cx${i}`);
  extra.push(p);
  await call('POST', `/meetings/${code}/join`, { user: claudia, body: { peerId: p, mic: false, cam: false } });
}
check('a room holds 8 browsers', (await call('POST', `/meetings/${code}/join`, { user: claudia, body: { peerId: peer('cx9'), mic: false, cam: false } })).status === 409);
for (const p of extra) await call('POST', `/meetings/${code}/leave`, { user: claudia, body: { peerId: p } });
check('… leaving frees the seats', (await call('GET', `/meetings/${code}`, { user: claudia })).data.peers.length === 2);

// ── Recording and notes ─────────────────────────────────────────────────────
const rec = await call('POST', `/meetings/${code}/recording`, { user: ken, body: { on: true } });
check('a co-host starts recording; everyone sees it', rec.status === 200 && rec.data.by.id === ken && !!(await sC.wait((e) => e.type === 'meeting.recording' && e.recording?.by.id === ken)));
check('one recording at a time', (await call('POST', `/meetings/${code}/recording`, { user: claudia, body: { on: true } })).status === 409);
await call('POST', `/meetings/${code}/recording`, { user: ken, body: { on: false } });
check('… stopping clears the sign', !!(await sC.wait((e) => e.type === 'meeting.recording' && e.recording === null)));
const fd = new FormData();
fd.append('file', new Blob([new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3, 4])], { type: 'video/webm' }), 'Launch sync — recording.webm');
fd.append('durationMs', '65000');
const up = await fetch(`${API}/meetings/${code}/recordings`, { method: 'POST', headers: { 'x-user-id': ken }, body: fd });
const video = await up.json();
check('the recording is saved to the recorder\'s Drive as a video', up.status === 201 && video.type === 'video' && video.name === 'Launch sync — recording.webm', video);
check('… in their "Meeting recordings" folder', (await call('GET', `/resources/${video.parentId}`, { user: ken })).data?.name === 'Meeting recordings');
check('people who were in the meeting can watch it', (await call('GET', `/resources/${video.id}`, { user: hana })).status === 200 && (await call('GET', `/resources/${video.id}`, { user: claudia })).status === 200);
check('… others cannot', (await call('GET', `/resources/${video.id}`, { user: mika })).status !== 200);
await sleep(300);
check('participants are told it is ready', (await inbox(hana)).some((n) => n.title === 'Recording of "Launch sync" is ready'));
const withRec = (await call('GET', `/meetings/${code}`, { user: claudia })).data;
check('the meeting lists its recording', withRec.recordings[0]?.id === video.id && withRec.recordings[0].durationMs === 65000, withRec.recordings);
const badRec = new FormData();
badRec.append('file', new Blob(['hello'], { type: 'text/plain' }), 'x.txt');
check('only videos are recordings', (await fetch(`${API}/meetings/${code}/recordings`, { method: 'POST', headers: { 'x-user-id': claudia }, body: badRec })).status === 400);

const notes = await call('POST', `/meetings/${code}/notes`, { user: ken });
check('taking notes makes a document', notes.status === 200 && !!notes.data.id);
const doc = (await call('GET', `/resources/${notes.data.id}`, { user: claudia })).data;
check('… everyone in the meeting edits it', doc?.type === 'document' && doc.name.startsWith('Notes — Launch sync') && doc.myRole === 'editor', doc);
check('… and it is the same document next time', (await call('POST', `/meetings/${code}/notes`, { user: claudia })).data.id === notes.data.id);
check('people outside cannot open the notes', (await call('POST', `/meetings/${code}/notes`, { user: rina })).status === 403);

// ── Leaving and history ─────────────────────────────────────────────────────
await call('POST', `/meetings/${code}/leave`, { user: ken, body: { peerId: k1 } });
check('leaving tells the room', !!(await sC.wait((e) => e.type === 'meeting.peer.left' && e.peerId === k1)));
await call('POST', `/meetings/${code}/leave`, { user: claudia, body: { peerId: c1 } });
const over = (await call('GET', `/meetings/${code}`, { user: claudia })).data;
check('the meeting ends when the last person leaves', !over.live && !!over.endedAt && over.peers.length === 0, over);
const hist = (await call('GET', '/meetings', { user: hana })).data.find((x) => x.code === code);
check('it is in the history of everyone who took part', !!hist && hist.participants.map((u) => u.id).sort().join() === [claudia, ken, hana].sort().join() && hist.notesId === notes.data.id, hist);
check('… not of people who were turned away', !(await call('GET', '/meetings', { user: rina })).data.some((x) => x.code === code));
const again = await call('POST', `/meetings/${code}/join`, { user: claudia, body: { peerId: peer('c9'), mic: true, cam: true } });
check('the room can be used again later', again.data.state === 'joined' && !(await call('GET', `/meetings/${code}`, { user: claudia })).data.endedAt);
check('ending for everyone', (await call('POST', `/meetings/${code}/end`, { user: claudia })).status === 204 && !!(await sC.wait((e) => e.type === 'meeting.ended' && e.meetingId === m.id)));

// ── Calling from a conversation ─────────────────────────────────────────────
const sS = await socket(sora);
const dm = (await call('POST', '/chat/conversations', { user: ken, body: { kind: 'dm', userId: sora } })).data;
const callK = await call('POST', '/meetings', { user: ken, body: { conversationId: dm.id } });
check('a call from a direct message', callK.status === 201 && callK.data.access === 'trusted' && callK.data.title === 'Call with Sora Ito' && callK.data.conversationId === dm.id, callK.data);
const ring = await sS.wait((e) => e.type === 'meeting.ring' && e.meetingId === callK.data.id);
check('… rings the other person', ring?.from.id === ken && ring.code === callK.data.code, ring);
const hist2 = (await call('GET', `/chat/conversations/${dm.id}/messages`, { user: sora })).data.messages;
check('… and leaves a link in the conversation', hist2.some((x) => x.body.includes(`/meetings?room=${callK.data.code}`)), hist2.at(-1));
check('members of the conversation join directly', (await call('GET', `/meetings/${callK.data.code}`, { user: sora })).data.me.entry === 'join');
check('… others ask', (await call('GET', `/meetings/${callK.data.code}`, { user: mika })).data.me.entry === 'knock');
await call('POST', `/meetings/${callK.data.code}/join`, { user: ken, body: { peerId: peer('k2'), mic: true, cam: true } });
const callS = await call('POST', '/meetings', { user: sora, body: { conversationId: dm.id } });
check('calling back while a call is on joins that call', callS.data.code === callK.data.code);
check('declining stops the ringing', (await call('POST', `/meetings/${callK.data.code}/decline`, { user: sora })).status === 204 && !!(await sS.wait((e) => e.type === 'meeting.ring.stop')));
check('nobody calls into a conversation they cannot read', (await call('POST', '/meetings', { user: mika, body: { conversationId: dm.id } })).status === 404);
await call('POST', `/meetings/${callK.data.code}/end`, { user: ken });
await sleep(400);
check('an unanswered call is a missed call in the bell', (await inbox(sora)).some((n) => n.kind === 'meeting.call' && n.title === 'Missed video call from Ken Watanabe'));

// ── Kaori Meet links from the calendar ──────────────────────────────────────
const myCal = (await call('GET', '/calendar/calendars', { user: claudia })).data.find((c) => c.kind === 'user');
const t0 = new Date(Date.now() + 2 * 86400_000);
const start = new Date(Date.UTC(t0.getUTCFullYear(), t0.getUTCMonth(), t0.getUTCDate(), 3, 0)).toISOString();
const end = new Date(Date.UTC(t0.getUTCFullYear(), t0.getUTCMonth(), t0.getUTCDate(), 4, 0)).toISOString();
const ev = (await call('POST', '/calendar/events', { user: claudia, body: { calendarId: myCal.id, title: 'Vendor review', start, end, timezone: 'Asia/Tokyo', meeting: { provider: 'kaori' }, guests: [{ email: 'hana@kaori.jp' }], notify: false } })).data;
const evCode = ev.meetingUrl.split('room=')[1];
check('calendar links use the meeting code format', /^[a-z]{3}-[a-z]{4}-[a-z]{3}$/.test(evCode), ev.meetingUrl);
const fromEv = (await call('GET', `/meetings/${evCode}`, { user: hana })).data;
check('opening the link makes the room, hosted by the organizer', fromEv?.title === 'Vendor review' && fromEv.host?.id === claudia && fromEv.eventId === ev.id && fromEv.event?.startAt === start, fromEv);
check('guests of the event join directly', fromEv.me.entry === 'join' && fromEv.access === 'trusted');
check('people who were not invited ask to join', (await call('GET', `/meetings/${evCode}`, { user: ken })).data.me.entry === 'knock');

for (const s of [sC, sK, sH, sR, sS]) s.ws.close();
console.log(failures ? `\n${failures} failed` : '\nall meetings checks passed');
process.exit(failures ? 1 : 0);
