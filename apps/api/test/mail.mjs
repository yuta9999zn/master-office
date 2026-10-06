// Mail module integration test (§69): mailboxes, threads by folder, internal delivery, replies, cc/bcc, outside
// addresses, attachments (uploads, Drive files, save to Drive), drafts, read/star/archive/trash/delete, shared space
// mailboxes with role permissions and assignment, search, address book, realtime.   node apps/api/test/mail.mjs
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
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: res.status, data };
}
async function socket(user) {
  const { data } = await call('GET', '/realtime/token', { user });
  const ws = new WebSocket(`${API.replace(/^http/, 'ws')}/realtime?token=${data.token}`);
  const events = [];
  ws.on('message', (m) => events.push(JSON.parse(String(m))));
  await new Promise((res, rej) => (ws.once('open', res), ws.once('error', rej)));
  return {
    ws,
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

const users = (await call('GET', '/users')).data;
const uid = (key) => users.find((u) => u.email === `${key}@kaori.jp`).id;
const [claudia, hana, mika, ken, yuki, rina] = ['claudia', 'hana', 'mika', 'ken', 'yuki', 'rina'].map(uid);
const boxes = async (user) => (await call('GET', '/mail/mailboxes', { user })).data;
const personal = async (user) => (await boxes(user)).find((b) => b.kind === 'user');
const threads = async (user, box, folder = 'inbox', q) => (await call('GET', `/mail/mailboxes/${box}/threads?folder=${folder}${q ? `&q=${encodeURIComponent(q)}` : ''}`, { user })).data;
const me = (key) => ({ address: `${key}@kaori.jp`, name: null });

// ── Mailboxes ───────────────────────────────────────────────────────────────
const cBoxes = await boxes(claudia);
const cBox = cBoxes.find((b) => b.kind === 'user');
const mkt = cBoxes.find((b) => b.address === 'marketing@kaori.jp');
check('everyone has a mailbox on the workspace domain', cBox.address === 'claudia@kaori.jp' && cBox.perms.write && cBox.unread === 3, cBox);
check('shared space mailboxes are listed for people in the space', !!mkt && mkt.kind === 'space' && mkt.perms.manage, mkt);
const inbox = await threads(claudia, cBox.id);
const meeting = inbox.find((t) => t.subject.startsWith('Booking system'));
check('the inbox lists conversations newest first', inbox.length >= 4 && inbox.every((t, i) => i === 0 || inbox[i - 1].lastAt >= t.lastAt), inbox.map((t) => t.subject));
check('a conversation groups its replies and knows about files', meeting.count === 3 && meeting.hasAttachments && meeting.unread && meeting.participants.includes('Fujita Sota'), meeting);
const view = (await call('GET', `/mail/threads/${meeting.id}`, { user: claudia })).data;
check('a conversation shows its messages in order with attachments', view.messages.length === 3 && view.messages[0].attachments[0].name === 'agenda.txt' && view.messages[1].direction === 'out', view.messages.map((m) => [m.direction, m.subject]));
check('mail from outside keeps its HTML; ours is text', (await call('GET', `/mail/threads/${inbox.find((t) => t.subject === 'Contract renewal 2027').id}`, { user: claudia })).data.messages[0].html?.includes('<p>') && view.messages[0].html === null);
check('other people cannot open your mailbox', (await call('GET', `/mail/mailboxes/${cBox.id}/threads`, { user: ken })).status === 404 && (await call('GET', `/mail/threads/${meeting.id}`, { user: ken })).status === 404);

// ── Sending inside the workspace ────────────────────────────────────────────
const hBox = await personal(hana);
const sh = await socket(hana);
const sent = await call('POST', '/mail/send', { user: claudia, body: { mailboxId: cBox.id, to: [me('hana')], subject: 'Lunch on Friday?', text: 'Shall we try the new place near the station?' } });
check('sending inside the workspace delivers directly', sent.status === 201 && sent.data.external === 0, sent.data);
const got = await sh.wait((e) => e.type === 'mail.received' && e.subject === 'Lunch on Friday?');
check('the recipient is told live', !!got && got.mailboxId === hBox.id && got.from === 'Claudia Chen', got);
const hThread = (await threads(hana, hBox.id)).find((t) => t.subject === 'Lunch on Friday?');
check('it lands unread in their inbox', hThread?.unread === true, hThread);
check('and in your Sent folder', (await threads(claudia, cBox.id, 'sent')).some((t) => t.subject === 'Lunch on Friday?'));
const hView = (await call('GET', `/mail/threads/${hThread.id}`, { user: hana })).data;
const reply = await call('POST', '/mail/send', { user: hana, body: { mailboxId: hBox.id, to: [me('claudia')], subject: '', text: 'Yes! 12:30?', replyTo: hView.messages[0].id } });
check('replying threads the answer on both sides', reply.status === 201 && (await threads(claudia, cBox.id)).find((t) => t.subject === 'Lunch on Friday?')?.count === 2, reply.data);
const rView = (await call('GET', `/mail/threads/${reply.data.threadId}`, { user: hana })).data;
check('a reply gets "Re:" and references the original', rView.messages[1].subject === 'Re: Lunch on Friday?' && rView.messages.length === 2);
check('you cannot reply to mail that is not in your mailbox', (await call('POST', '/mail/send', { user: ken, body: { mailboxId: (await personal(ken)).id, to: [me('hana')], subject: 'x', text: 'x', replyTo: hView.messages[0].id } })).status === 404);

const bccd = await call('POST', '/mail/send', { user: claudia, body: { mailboxId: cBox.id, to: [me('hana')], cc: [me('mika')], bcc: [me('ken')], subject: 'Budget memo', text: 'See the figures.' } });
const kBox = await personal(ken);
const kThread = (await threads(ken, kBox.id)).find((t) => t.subject === 'Budget memo');
check('blind copies are delivered', !!kThread);
const forHana = (await call('GET', `/mail/threads/${(await threads(hana, hBox.id)).find((t) => t.subject === 'Budget memo').id}`, { user: hana })).data.messages[0];
const forClaudia = (await call('GET', `/mail/threads/${bccd.data.threadId}`, { user: claudia })).data.messages[0];
check('… but only the sender sees the Bcc line', forHana.bcc.length === 0 && forHana.cc[0].address === 'mika@kaori.jp' && forClaudia.bcc[0].address === 'ken@kaori.jp', [forHana.bcc, forClaudia.bcc]);
check('sending to yourself files it once in Sent and once in the inbox', (await call('POST', '/mail/send', { user: ken, body: { mailboxId: kBox.id, to: [me('ken')], subject: 'Note to self', text: 'Buy milk' } })).status === 201 && (await threads(ken, kBox.id)).some((t) => t.subject === 'Note to self') && (await threads(ken, kBox.id, 'sent')).some((t) => t.subject === 'Note to self'));

// ── Outside addresses and validation ────────────────────────────────────────
const ext = await call('POST', '/mail/send', { user: claudia, body: { mailboxId: cBox.id, to: [{ address: 'Partner@Example.com', name: 'Partner' }, me('hana')], subject: 'Hello partner', text: 'Nice to meet you.' } });
check('outside addresses go out over SMTP, ours are delivered inside', ext.status === 201 && ext.data.external === 1 && (await threads(hana, hBox.id)).some((t) => t.subject === 'Hello partner'), ext.data);
check('a wrong address is refused', (await call('POST', '/mail/send', { user: claudia, body: { mailboxId: cBox.id, to: [{ address: 'not-an-address' }], subject: 'x', text: 'x' } })).status === 400);
check('a message needs a recipient', (await call('POST', '/mail/send', { user: claudia, body: { mailboxId: cBox.id, to: [], subject: 'x', text: 'x' } })).status === 400);
check('you cannot send from someone else\'s mailbox', (await call('POST', '/mail/send', { user: ken, body: { mailboxId: cBox.id, to: [me('hana')], subject: 'x', text: 'x' } })).status === 404);

// ── Attachments ─────────────────────────────────────────────────────────────
const fd = new FormData();
fd.append('file', new Blob(['Quarterly numbers'], { type: 'text/plain' }), 'numbers.txt');
const up = await fetch(API + '/mail/attachments', { method: 'POST', headers: { 'x-user-id': claudia }, body: fd }).then((r) => r.json());
check('uploading an attachment', !!up.id && up.name === 'numbers.txt', up);
check('nobody else can use your upload', (await call('POST', '/mail/send', { user: ken, body: { mailboxId: kBox.id, to: [me('hana')], subject: 'x', text: 'x', attachmentIds: [up.id] } })).status === 404);
const search = async (q) => (await call('GET', '/search?q=' + encodeURIComponent(q), { user: claudia })).data.find((h) => h.kind === 'resource' && h.title === q);
const pdf = await search('Brand Guideline.pdf');
const roadmap = await search('Product Roadmap');
const withFiles = await call('POST', '/mail/send', { user: claudia, body: { mailboxId: cBox.id, to: [me('hana')], subject: 'Files for you', text: 'Here you go.', attachmentIds: [up.id], resourceIds: [pdf.id, roadmap.id] } });
const fView = (await call('GET', `/mail/threads/${(await threads(hana, hBox.id)).find((t) => t.subject === 'Files for you').id}`, { user: hana })).data.messages[0];
check('uploads and Drive files travel as copies', fView.attachments.map((a) => a.name).sort().join() === 'Brand Guideline.pdf,numbers.txt', fView.attachments);
check('documents edited in the app travel as links', fView.text.includes('📎 Product Roadmap:') && fView.text.includes(`/docs/${roadmap.id}`), fView.text);
const dl = await fetch(`${API}/mail/attachments/${fView.attachments.find((a) => a.name === 'numbers.txt').id}`, { headers: { 'x-user-id': hana } });
check('recipients download attachments', dl.status === 200 && (await dl.text()) === 'Quarterly numbers');
check('others cannot', (await fetch(`${API}/mail/attachments/${fView.attachments[0].id}`, { headers: { 'x-user-id': ken } })).status === 404);
const saved = await call('POST', `/mail/attachments/${fView.attachments.find((a) => a.name === 'numbers.txt').id}/save`, { user: hana, body: {} });
check('"Save to Drive" makes a file in My Files', saved.status === 201 && saved.data.name === 'numbers.txt' && saved.data.owner?.id === hana, saved.data);
check('attaching a file you cannot open is refused', (await call('POST', '/mail/send', { user: ken, body: { mailboxId: kBox.id, to: [me('hana')], subject: 'x', text: 'x', resourceIds: [(await search('Budget 2027')).id] } })).status === 404);
void withFiles;

// ── Read, star, archive, trash, delete ──────────────────────────────────────
await call('PATCH', `/mail/threads/${meeting.id}`, { user: claudia, body: { read: true } });
check('marking read', !(await threads(claudia, cBox.id)).find((t) => t.id === meeting.id).unread && (await personal(claudia)).unread === cBox.unread - 1 + 1, await personal(claudia));
await call('PATCH', `/mail/threads/${meeting.id}`, { user: claudia, body: { starred: true } });
check('starred conversations have their folder', (await threads(claudia, cBox.id, 'starred')).some((t) => t.id === meeting.id));
await call('PATCH', `/mail/threads/${meeting.id}`, { user: claudia, body: { folder: 'archive' } });
check('archiving leaves the inbox', !(await threads(claudia, cBox.id)).some((t) => t.id === meeting.id) && (await threads(claudia, cBox.id, 'archive')).some((t) => t.id === meeting.id));
check('… and keeps your own replies in Sent', (await threads(claudia, cBox.id, 'sent')).some((t) => t.id === meeting.id));
check('deleting needs the trash first', (await call('DELETE', `/mail/threads/${meeting.id}`, { user: claudia })).status === 400);
await call('PATCH', `/mail/threads/${meeting.id}`, { user: claudia, body: { folder: 'trash' } });
check('trash', (await threads(claudia, cBox.id, 'trash')).some((t) => t.id === meeting.id) && !(await threads(claudia, cBox.id, 'sent')).some((t) => t.id === meeting.id));
await call('PATCH', `/mail/threads/${meeting.id}`, { user: claudia, body: { folder: 'inbox' } });
check('restoring puts mail back in Inbox and Sent', (await threads(claudia, cBox.id)).some((t) => t.id === meeting.id) && (await threads(claudia, cBox.id, 'sent')).some((t) => t.id === meeting.id));
await call('PATCH', `/mail/threads/${meeting.id}`, { user: claudia, body: { folder: 'trash' } });
check('deleting from the trash', (await call('DELETE', `/mail/threads/${meeting.id}`, { user: claudia })).status === 204 && (await call('GET', `/mail/threads/${meeting.id}`, { user: claudia })).status === 404);
check('… only in your mailbox (Fujita keeps the conversation)', (await threads(uid('fujita'), (await personal(uid('fujita'))).id, 'all')).some((t) => t.subject.startsWith('Booking system')));

// ── Drafts ──────────────────────────────────────────────────────────────────
const d = await call('POST', '/mail/drafts', { user: claudia, body: { mailboxId: cBox.id, to: [me('mika')], subject: 'Draft plan', text: 'First lines' } });
check('saving a draft', d.status === 201 && (await threads(claudia, cBox.id, 'drafts')).some((t) => t.id === d.data.threadId) && (await personal(claudia)).drafts === 1, d.data);
await call('POST', '/mail/drafts', { user: claudia, body: { mailboxId: cBox.id, draftId: d.data.id, to: [me('mika')], subject: 'Draft plan v2', text: 'More lines' } });
check('drafts are not delivered', !(await threads(mika, (await personal(mika)).id)).some((t) => t.subject.startsWith('Draft plan')));
const sd = await call('POST', '/mail/send', { user: claudia, body: { mailboxId: cBox.id, draftId: d.data.id, to: [me('mika')], subject: 'Draft plan v2', text: 'Final lines' } });
check('sending a draft delivers it and moves it to Sent', sd.status === 201 && (await threads(mika, (await personal(mika)).id)).some((t) => t.subject === 'Draft plan v2') && (await personal(claudia)).drafts === 0, sd.data);
const d2 = await call('POST', '/mail/drafts', { user: claudia, body: { mailboxId: cBox.id, subject: 'Throwaway' } });
check('discarding a draft', (await call('DELETE', `/mail/drafts/${d2.data.id}`, { user: claudia })).status === 204 && !(await threads(claudia, cBox.id, 'drafts')).length);

// ── Shared space mailboxes ──────────────────────────────────────────────────
const mThreads = await threads(hana, mkt.id);
const collab = mThreads.find((t) => t.subject.startsWith('Collaboration proposal'));
check('people in the space read the shared inbox', !!collab && collab.unread, mThreads.map((t) => t.subject));
const asYuki = (await boxes(yuki)).find((b) => b.id === mkt.id);
check('commenters read but cannot send', asYuki?.perms.read && !asYuki.perms.write && (await call('POST', '/mail/send', { user: yuki, body: { mailboxId: mkt.id, to: [me('hana')], subject: 'x', text: 'x' } })).status === 403, asYuki);
check('… nor change it', (await call('PATCH', `/mail/threads/${collab.id}`, { user: yuki, body: { read: true } })).status === 403);
const cView = (await call('GET', `/mail/threads/${collab.id}`, { user: hana })).data;
const answer = await call('POST', '/mail/send', { user: hana, body: { mailboxId: mkt.id, to: [cView.messages[0].from], subject: '', text: 'Thank you Aiko — how about Thursday?', replyTo: cView.messages[0].id } });
check('editors answer from the shared address (outside mail goes out)', answer.status === 201 && answer.data.external === 1, answer.data);
const aView = (await call('GET', `/mail/threads/${collab.id}`, { user: mika })).data;
check('the answer sits in the shared conversation, from the shared address, written by its author', aView.messages[1].from.address === 'marketing@kaori.jp' && aView.messages[1].author?.id === hana, aView.messages[1]);
check('conversations can be assigned to someone who can answer', (await call('PATCH', `/mail/threads/${collab.id}`, { user: hana, body: { assigneeId: mika } })).status === 204 && (await threads(hana, mkt.id)).find((t) => t.id === collab.id).assignee?.id === mika);
check('… not to someone who only reads', (await call('PATCH', `/mail/threads/${collab.id}`, { user: hana, body: { assigneeId: yuki } })).status === 400);
check('personal mailboxes have no assignment', (await call('PATCH', `/mail/threads/${hThread.id}`, { user: hana, body: { assigneeId: mika } })).status === 400);
await call('POST', '/mail/send', { user: ken, body: { mailboxId: kBox.id, to: [{ address: 'marketing@kaori.jp', name: 'Marketing' }], subject: 'Store poster request', text: 'Can we get A1 posters for Branch 625?' } });
check('mail to the shared address from inside lands in its inbox', (await threads(hana, mkt.id)).some((t) => t.subject === 'Store poster request'));

const spaces = (await call('GET', '/spaces', { user: claudia })).data;
const hr = spaces.find((s) => s.name === 'HR');
check('only space admins add a space mailbox', (await call('POST', `/mail/spaces/${hr.id}/mailbox`, { user: ken, body: { localPart: 'hr' } })).status === 404);
const hrBox = await call('POST', `/mail/spaces/${hr.id}/mailbox`, { user: rina, body: { localPart: 'hr', name: 'HR Team' } });
check('a space admin adds hr@kaori.jp', hrBox.status === 201 && hrBox.data.address === 'hr@kaori.jp', hrBox.data);
check('one address, one mailbox', (await call('POST', `/mail/spaces/${spaces.find((s) => s.name === 'Finance').id}/mailbox`, { user: claudia, body: { localPart: 'hr' } })).status === 400);
check('people outside a private space never see its mailbox', !(await boxes(ken)).some((b) => b.id === hrBox.data.id) && (await call('GET', `/mail/mailboxes/${hrBox.data.id}/threads`, { user: ken })).status === 404);

// ── Search, address book ────────────────────────────────────────────────────
check('search finds conversations by words, sender or subject', (await threads(claudia, cBox.id, 'all', 'station')).some((t) => t.subject === 'Lunch on Friday?') && (await threads(claudia, cBox.id, 'all', 'legal@itmjapan')).length === 1);
const book = (await call('GET', '/mail/addresses?q=mar', { user: claudia })).data;
check('the address book suggests shared mailboxes and people', book.some((a) => a.address === 'marketing@kaori.jp' && a.kind === 'space'), book);
check('… and outside people you wrote to', (await call('GET', '/mail/addresses?q=partner', { user: claudia })).data.some((a) => a.address === 'partner@example.com' && a.kind === 'external'));

sh.ws.close();
console.log(failures ? `\n${failures} check(s) failed` : '\nall mail checks passed');
process.exit(failures ? 1 : 0);
