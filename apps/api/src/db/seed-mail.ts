import { eq, sql } from 'drizzle-orm';
import { StorageService } from '../storage/storage.service';
import type { Db } from './client';
import * as s from './schema';

type User = typeof s.users.$inferSelect;
type Box = typeof s.mailboxes.$inferSelect;
const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/**
 * Mail demo data (§69): a mailbox per person on kaori.jp, a few internal conversations (with a reply and an
 * attachment), mail from an outside partner, a message sent outside, and the shared marketing@kaori.jp mailbox.
 */
export async function seedMail(db: Db, storage: StorageService, workspaceId: string, u: Record<string, User>, spaceId: (name: string) => string) {
  await db.update(s.workspaces).set({ mailDomain: 'kaori.jp' }).where(eq(s.workspaces.id, workspaceId));
  const box: Record<string, Box> = {};
  for (const [key, user] of Object.entries(u)) {
    const [row] = await db.insert(s.mailboxes).values({ workspaceId, kind: 'user', userId: user.id, address: user.email.toLowerCase(), name: user.name }).returning();
    box[key] = row;
  }
  const [marketing] = await db
    .insert(s.mailboxes)
    .values({ workspaceId, kind: 'space', spaceId: spaceId('Marketing'), address: 'marketing@kaori.jp', name: 'Marketing', signature: 'Natural Beauty Marketing Team' })
    .returning();
  box.marketing = marketing;

  const now = Date.now();
  const at = (minutesAgo: number) => new Date(now - minutesAgo * 60_000).toISOString();
  const threads = new Map<string, string>(); // `${box}:${root message}` → thread
  const blob = async (name: string, content: string, mime: string) => {
    const buf = Buffer.from(content);
    const sha = StorageService.sha256(buf);
    const key = await storage.putBlob(buf, sha, mime);
    const [b] = await db.insert(s.blobs).values({ sha256: sha, sizeBytes: buf.length, mimeType: mime, storageKey: key }).onConflictDoUpdate({ target: s.blobs.sha256, set: { sha256: sha } }).returning();
    return { blobId: b.id, name, mimeType: mime, sizeBytes: buf.length };
  };

  /** One message: stored once, filed in the sender's Sent (if ours) and in each of our recipients' inboxes. */
  async function mail(o: {
    from: string; // a mailbox key, or an outside "Name <address>"
    to: string[];
    cc?: string[];
    subject: string;
    text: string;
    ago: number;
    root?: string; // key of the conversation, for replies
    read?: string[]; // mailbox keys that have read it
    files?: { name: string; content: string; mime: string }[];
  }) {
    const parse = (x: string) => {
      if (box[x]) return { address: box[x].address, name: box[x].name, key: x };
      const m = /^(.*)<(.+)>$/.exec(x);
      return { address: (m ? m[2] : x).trim().toLowerCase(), name: m ? m[1].trim() : null, key: null as string | null };
    };
    const from = parse(o.from);
    const to = o.to.map(parse);
    const cc = (o.cc ?? []).map(parse);
    const external = !from.key;
    const id = crypto.randomUUID();
    const rootKey = o.root ?? id;
    const [msg] = await db
      .insert(s.mailMessages)
      .values({
        workspaceId,
        messageId: `${id}@${external ? from.address.split('@')[1] : 'kaori.jp'}`,
        fromAddress: from.address,
        fromName: from.name,
        to: to.map(({ address, name }) => ({ address, name })),
        cc: cc.map(({ address, name }) => ({ address, name })),
        subject: o.subject,
        text: o.text,
        html: external ? `<div style="font-family:Arial,sans-serif"><p>${esc(o.text).replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br>')}</p></div>` : null,
        authorId: from.key && box[from.key].userId ? box[from.key].userId : null,
        external,
        sentAt: at(o.ago),
        updatedAt: at(o.ago),
      })
      .returning();
    for (const f of o.files ?? []) await db.insert(s.mailAttachments).values({ workspaceId, messageId: msg.id, ...(await blob(f.name, f.content, f.mime)) });
    const file = async (key: string, direction: 'in' | 'out') => {
      const tk = `${key}:${rootKey}`;
      let threadId = threads.get(tk);
      if (!threadId) {
        const [t] = await db.insert(s.mailThreads).values({ mailboxId: box[key].id, subject: o.subject.replace(/^re:\s*/i, ''), lastAt: at(o.ago) }).returning();
        threadId = t.id;
        threads.set(tk, threadId);
      } else await db.update(s.mailThreads).set({ lastAt: at(o.ago) }).where(eq(s.mailThreads.id, threadId));
      const read = direction === 'out' || (o.read ?? []).includes(key);
      await db.insert(s.mailItems).values({ mailboxId: box[key].id, threadId, messageId: msg.id, direction, folder: direction === 'out' ? 'sent' : 'inbox', readAt: read ? at(o.ago - 1) : null }).onConflictDoNothing();
    };
    if (from.key) await file(from.key, 'out');
    for (const r of [...to, ...cc]) if (r.key) await file(r.key, 'in');
    return rootKey;
  }

  const day = 24 * 60;
  const meeting = await mail({
    from: 'fujita',
    to: ['claudia'],
    cc: ['minh'],
    subject: 'Booking system — meeting next week',
    text: 'Hi Claudia,\n\nCould we meet on Tuesday at 10:30 (JST) to review the booking screens? I attached the agenda.\n\nBest regards,\nFujita',
    ago: 2 * day,
    read: ['claudia', 'minh'],
    files: [{ name: 'agenda.txt', content: '1. Booking flow\n2. Payment\n3. Timeline', mime: 'text/plain' }],
  });
  await mail({ from: 'claudia', to: ['fujita'], cc: ['minh'], subject: 'Re: Booking system — meeting next week', text: 'Tuesday 10:30 works for me. I will send the invite.\n\nClaudia', ago: 2 * day - 90, root: meeting, read: ['fujita', 'minh'] });
  await mail({ from: 'fujita', to: ['claudia'], cc: ['minh'], subject: 'Re: Booking system — meeting next week', text: 'Thank you! See you on Tuesday.', ago: 2 * day - 120, root: meeting, read: ['minh'] });

  await mail({
    from: 'hana',
    to: ['claudia'],
    cc: ['mika'],
    subject: 'Q4 campaign assets ready for review',
    text: 'Hi Claudia,\n\nThe Q4 campaign assets are ready. Could you review the key visuals by Friday?\n\nThanks,\nHana',
    ago: 180,
    read: ['mika'],
  });
  await mail({ from: 'rina', to: ['claudia', 'hana', 'mika', 'yuki', 'sora', 'ken', 'fujita', 'huong', 'minh'], subject: 'Year-end holiday schedule', text: 'Dear all,\n\nThe office will be closed from Dec 29 to Jan 3. Please plan your leave accordingly.\n\nRina (HR)', ago: 3 * day, read: ['claudia', 'hana', 'mika'] });
  await mail({ from: 'ITM Japan Legal <legal@itmjapan.com>', to: ['claudia'], subject: 'Contract renewal 2027', text: 'Dear Ms. Chen,\n\nPlease find the renewal terms for 2027 below. We would appreciate your confirmation by October 20.\n\nKind regards,\nITM Japan Legal', ago: 300 });
  await mail({ from: 'claudia', to: ['Supplier Sales <sales@beauty-supplier.example>'], subject: 'Q4 price list request', text: 'Hello,\n\nCould you send us the Q4 price list and delivery windows?\n\nBest regards,\nClaudia Chen\nNatural Beauty', ago: day + 200 });

  // The shared Marketing mailbox: outside mail anyone in the Marketing space can read; editors answer it.
  const collab = await mail({ from: 'Aiko Mori <aiko@studio-mori.example>', to: ['marketing'], subject: 'Collaboration proposal for the spring campaign', text: 'Hello Natural Beauty team,\n\nWe are a design studio in Osaka and would love to collaborate on your spring campaign. Could we schedule a call?\n\nAiko Mori\nStudio Mori', ago: 240 });
  void collab;
  await mail({ from: 'Press Desk <press@beauty-weekly.example>', to: ['marketing'], subject: 'Interview request — Beauty Weekly', text: 'Hi,\n\nBeauty Weekly would like to interview your marketing lead about the new product line.\n\nBest,\nPress Desk', ago: 2 * day, read: ['marketing'] });
  await db.execute(sql`SELECT 1`);
}
