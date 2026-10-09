// Mail from outside (§70): the SMTP listener and the raw-MIME webhook — delivery to personal and shared mailboxes,
// HTML without scripts, attachments, threading with our replies, unknown addresses refused, secret checked,
// duplicates ignored.   node apps/api/test/mail-inbound.mjs   (API with MAIL_INBOUND_PORT, default 2525)
import { createTransport } from 'nodemailer';

const API = process.env.API_URL ?? 'http://localhost:4000';
const PORT = Number(process.env.MAIL_INBOUND_PORT ?? 2525);
const SECRET = process.env.MAIL_INBOUND_SECRET ?? 'dev-inbound-secret-change-me';
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
const uid = (key) => users.find((u) => u.email === `${key}@hanami.example`).id;
const [claudia, hana] = [uid('claudia'), uid('hana')];
const boxes = async (user) => (await call('GET', '/mail/mailboxes', { user })).data;
const threads = async (user, box, folder = 'inbox') => (await call('GET', `/mail/mailboxes/${box}/threads?folder=${folder}`, { user })).data;
const smtp = createTransport({ host: '127.0.0.1', port: PORT, secure: false, ignoreTLS: true, tls: { rejectUnauthorized: false } });
const stamp = Date.now();

const cBox = (await boxes(claudia)).find((b) => b.kind === 'user');
const subject = `Partnership idea ${stamp}`;
const info = await smtp.sendMail({
  from: '"Ken Partner" <ken@partner.example>',
  to: 'claudia@hanami.example',
  subject,
  text: 'Hello Claudia, here is our proposal.',
  html: '<p>Hello <b>Claudia</b>, here is our proposal.</p><script>alert(1)</script><img src="x" onerror="alert(2)">',
  attachments: [{ filename: 'proposal.txt', content: 'Proposal v1' }],
});
check('the SMTP listener accepts mail for our addresses', info.accepted?.includes('claudia@hanami.example'), info);
await sleep(500);
const t = (await threads(claudia, cBox.id)).find((x) => x.subject === subject);
check('it lands in the inbox, unread, with the file', t?.unread === true && t.hasAttachments, t);
const v = (await call('GET', `/mail/threads/${t.id}`, { user: claudia })).data.messages[0];
check('marked as outside mail, sender kept', v.external && v.from.address === 'ken@partner.example' && v.from.name === 'Ken Partner', v.from);
check('HTML is kept without scripts or event handlers', v.html.includes('<b>Claudia</b>') && !/script|onerror/i.test(v.html), v.html);
const dl = await fetch(`${API}/mail/attachments/${v.attachments[0].id}`, { headers: { 'x-user-id': claudia } });
check('the attachment downloads', v.attachments[0].name === 'proposal.txt' && (await dl.text()) === 'Proposal v1');

// Our reply goes out; their answer comes back into the same conversation.
const r = await call('POST', '/mail/send', { user: claudia, body: { mailboxId: cBox.id, to: [v.from], subject: '', text: 'Thanks Ken, let us talk on Monday.', replyTo: v.id } });
const ours = (await call('GET', `/mail/threads/${r.data.threadId}`, { user: claudia })).data.messages.at(-1);
await smtp.sendMail({ from: 'ken@partner.example', to: 'claudia@hanami.example', subject: `Re: ${subject}`, text: 'Monday is perfect.', inReplyTo: `<${ours.messageId}>`, references: [`<${v.messageId}>`, `<${ours.messageId}>`] });
await sleep(500);
const again = (await call('GET', `/mail/threads/${t.id}`, { user: claudia })).data;
check('their answer joins the conversation (threaded by headers)', r.data.external === 1 && again.messages.length === 3 && again.messages[2].text.includes('Monday is perfect'), again.messages.map((m) => m.text));

let refused = null;
try {
  await smtp.sendMail({ from: 'x@spam.example', to: 'nobody@hanami.example', subject: 'hi', text: 'hi' });
} catch (e) {
  refused = e;
}
check('addresses without a mailbox are refused (550)', refused?.responseCode === 550, refused?.message);

await smtp.sendMail({ from: 'Aiko <aiko@studio-mori.example>', to: 'marketing@hanami.example', cc: 'claudia@hanami.example', subject: `Shared ${stamp}`, text: 'For the team' });
await sleep(500);
const mkt = (await boxes(hana)).find((b) => b.address === 'marketing@hanami.example');
check('mail to a shared mailbox reaches the space', (await threads(hana, mkt.id)).some((x) => x.subject === `Shared ${stamp}`));
check('… and the copy to a person reaches them too', (await threads(claudia, cBox.id)).some((x) => x.subject === `Shared ${stamp}`));

// The webhook for mail providers.
const mime = [
  'From: Press <press@news.example>',
  'To: claudia@hanami.example',
  `Subject: Webhook ${stamp}`,
  `Message-ID: <hook-${stamp}@news.example>`,
  'Content-Type: text/plain; charset=utf-8',
  '',
  'Sent through the webhook.',
].join('\r\n');
const hook = (secret) => fetch(`${API}/mail/inbound`, { method: 'POST', headers: { 'content-type': 'message/rfc822', 'x-inbound-secret': secret }, body: mime });
const bad = await hook('wrong');
check('the webhook refuses a wrong secret', bad.status === 404);
const ok = await hook(SECRET);
check('the webhook files raw MIME', ok.status === 202 && (await ok.json()).delivered === 1);
const dup = await hook(SECRET);
check('the same message twice is filed once', (await dup.json()).delivered === 0 && (await threads(claudia, cBox.id)).filter((x) => x.subject === `Webhook ${stamp}`).length === 1);

smtp.close();
console.log(failures ? `\n${failures} check(s) failed` : '\nall inbound mail checks passed');
process.exit(failures ? 1 : 0);
