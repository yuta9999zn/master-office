import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  can,
  type MailAddr,
  type Mailbox,
  type MailboxPerms,
  type MailFolder,
  type MailMessageView,
  type MailThreadSummary,
  type MailThreadView,
  type Role,
  type SendMailInput,
} from '@workos/shared';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { Actor } from '../common/current-user';
import { loadUsers } from '../common/users';
import { config } from '../config';
import type { Db, Tx } from '../db/client';
import { InjectDb } from '../db/db.module';
import { blobs, mailAttachments, mailboxes, mailItems, mailMessages, mailThreads, resources, spaceMembers, spaces, users, workspaces } from '../db/schema';
import { resourcePath } from '../notifications/notifications.service';
import { PermissionsService } from '../permissions/permissions.service';
import { RealtimeService } from '../realtime/realtime.service';
import { StorageService } from '../storage/storage.service';
import { QuotaService } from '../storage/quota.service';
import { flowHooks } from '../flow/flow-hooks';
import { MailService } from './mail.service';

type Box = typeof mailboxes.$inferSelect;
type Msg = typeof mailMessages.$inferSelect;

const EMAIL = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const norm = (a: string) => a.trim().toLowerCase();
/** "Re: Re: Fwd: Plan" → "plan", for threading mail that lost its headers. */
const baseSubject = (s: string) => s.replace(/^\s*((re|fwd?|aw|tr)\s*:\s*)+/i, '').trim().toLowerCase();

/** Plain text → the HTML part sent to other mail systems (paragraphs, line breaks, links). */
export function textToHtml(text: string) {
  const linked = esc(text).replace(/https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"]/g, (u) => `<a href="${u}">${u}</a>`);
  return `<div style="font-family:Inter,Segoe UI,Arial,sans-serif;font-size:14px;line-height:1.5;color:#0f172a">${linked.replace(/\n/g, '<br>')}</div>`;
}

export interface DraftInput {
  mailboxId: string;
  draftId?: string | null;
  to?: MailAddr[];
  cc?: MailAddr[];
  bcc?: MailAddr[];
  subject?: string;
  text?: string;
  replyTo?: string | null;
  attachmentIds?: string[];
}

/**
 * The Mail module (docs/ARCHITECTURE.md §69). A message is stored once; each mailbox that holds it has an item
 * (folder, read, starred) inside its own thread. Mail between addresses of the system is delivered directly;
 * other addresses go out over SMTP (MailService). Personal mailboxes belong to their person; space mailboxes
 * follow the space role (viewer reads, editor writes, admin manages).
 */
@Injectable()
export class MailboxService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly perms: PermissionsService,
    private readonly realtime: RealtimeService,
    private readonly storage: StorageService,
    private readonly mail: MailService,
    private readonly quota: QuotaService,
  ) {}

  // ── Mailboxes & access ────────────────────────────────────────────────────

  async domain(workspaceId: string, tx: Tx = this.db) {
    const [w] = await tx.select({ slug: workspaces.slug, mailDomain: workspaces.mailDomain }).from(workspaces).where(eq(workspaces.id, workspaceId));
    return w?.mailDomain ?? `${w?.slug ?? 'workspace'}.local`;
  }

  /** Everyone has a mailbox: created on first use with their address on the workspace domain. */
  async ensurePersonal(actor: Actor, tx: Tx = this.db): Promise<Box> {
    const [found] = await tx.select().from(mailboxes).where(eq(mailboxes.userId, actor.id));
    if (found) return found;
    const [u] = await tx.select({ email: users.email, name: users.name }).from(users).where(eq(users.id, actor.id));
    const domain = await this.domain(actor.workspaceId, tx);
    const address = u.email.toLowerCase().endsWith(`@${domain}`) ? u.email.toLowerCase() : `${u.email.split('@')[0].toLowerCase()}@${domain}`;
    const [row] = await tx.insert(mailboxes).values({ workspaceId: actor.workspaceId, kind: 'user', userId: actor.id, address, name: u.name }).onConflictDoNothing().returning();
    return row ?? (await tx.select().from(mailboxes).where(eq(mailboxes.userId, actor.id)))[0];
  }

  private permsFor(box: Box, actor: Actor, spaceRole: Role | null | undefined): MailboxPerms {
    if (box.kind === 'user') {
      const mine = box.userId === actor.id;
      return { read: mine, write: mine, manage: mine };
    }
    return { read: can(spaceRole, 'viewer'), write: can(spaceRole, 'editor'), manage: can(spaceRole, 'admin') };
  }

  async access(actor: Actor, mailboxId: string, need: keyof MailboxPerms = 'read', tx: Tx = this.db) {
    const [box] = await tx.select().from(mailboxes).where(eq(mailboxes.id, mailboxId));
    if (!box || box.workspaceId !== actor.workspaceId) throw new NotFoundException('Mailbox not found');
    const role = box.spaceId ? (await this.perms.spaceRoles(actor, tx)).get(box.spaceId) : null;
    const perms = this.permsFor(box, actor, role);
    if (!perms.read) throw new NotFoundException('Mailbox not found');
    if (!perms[need]) throw new ForbiddenException(need === 'write' ? 'Your role in the space lets you read this mailbox, not send from it' : 'Only space admins manage this mailbox');
    return { box, perms };
  }

  /** People whose screens show a mailbox (for realtime). */
  private async audience(box: Box) {
    if (box.kind === 'user') return box.userId ? [box.userId] : [];
    const rows = await this.db.select({ id: spaceMembers.userId }).from(spaceMembers).where(eq(spaceMembers.spaceId, box.spaceId!));
    return rows.map((r) => r.id);
  }

  private async touched(boxIds: string[], received: { box: Box; threadId: string; subject: string; from: string }[] = []) {
    const boxes = boxIds.length ? await this.db.select().from(mailboxes).where(inArray(mailboxes.id, [...new Set(boxIds)])) : [];
    for (const b of boxes) this.realtime.publish(await this.audience(b), { type: 'mail.changed', mailboxId: b.id });
    for (const r of received) this.realtime.publish(await this.audience(r.box), { type: 'mail.received', mailboxId: r.box.id, threadId: r.threadId, subject: r.subject, from: r.from });
  }

  async list(actor: Actor): Promise<Mailbox[]> {
    const mine = await this.ensurePersonal(actor);
    const roles = await this.perms.spaceRoles(actor);
    const visible = [...roles].filter(([, r]) => can(r, 'viewer')).map(([id]) => id);
    const shared = visible.length ? await this.db.select().from(mailboxes).where(and(eq(mailboxes.kind, 'space'), inArray(mailboxes.spaceId, visible))) : [];
    const boxes = [mine, ...shared.sort((a, b) => a.name.localeCompare(b.name))];
    const counts = await this.db.execute<{ mailbox_id: string; unread: string; drafts: string }>(sql`
      SELECT i.mailbox_id,
             count(DISTINCT i.thread_id) FILTER (WHERE i.folder = 'inbox' AND i.read_at IS NULL AND i.direction = 'in') AS unread,
             count(*) FILTER (WHERE i.folder = 'drafts') AS drafts
      FROM mail_items i WHERE i.mailbox_id IN (${sql.join(boxes.map((b) => sql`${b.id}`), sql`, `)}) GROUP BY i.mailbox_id`);
    const by = new Map(counts.rows.map((c) => [c.mailbox_id, c]));
    return boxes.map((b) => ({
      id: b.id,
      kind: b.kind,
      address: b.address,
      name: b.name,
      spaceId: b.spaceId,
      signature: b.signature,
      perms: this.permsFor(b, actor, b.spaceId ? roles.get(b.spaceId) : null),
      unread: Number(by.get(b.id)?.unread ?? 0),
      drafts: Number(by.get(b.id)?.drafts ?? 0),
    }));
  }

  async updateMailbox(actor: Actor, id: string, input: { name?: string; signature?: string | null }) {
    await this.access(actor, id, 'manage');
    const set: Partial<Box> = {};
    if (input.name !== undefined) set.name = input.name.trim() || 'Mailbox';
    if (input.signature !== undefined) set.signature = input.signature?.trim() || null;
    if (Object.keys(set).length) await this.db.update(mailboxes).set(set).where(eq(mailboxes.id, id));
    await this.touched([id]);
  }

  /** A shared mailbox for a space, e.g. marketing@hanami.example (space admins). */
  async enableSpaceMailbox(actor: Actor, spaceId: string, input: { localPart: string; name?: string }) {
    const role = await this.perms.requireSpace(actor, spaceId, 'viewer');
    if (!can(role, 'admin')) throw new ForbiddenException('Only space admins set up a space mailbox');
    const local = input.localPart.trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9._-]{0,40}$/.test(local)) throw new BadRequestException('Use letters, digits, dots, dashes or underscores');
    const address = `${local}@${await this.domain(actor.workspaceId)}`;
    const [taken] = await this.db.select({ id: mailboxes.id }).from(mailboxes).where(eq(mailboxes.address, address));
    if (taken) throw new BadRequestException(`${address} is already taken`);
    const [existing] = await this.db.select().from(mailboxes).where(eq(mailboxes.spaceId, spaceId));
    if (existing) throw new BadRequestException(`This space already has ${existing.address}`);
    const [sp] = await this.db.select({ name: spaces.name }).from(spaces).where(eq(spaces.id, spaceId));
    const [row] = await this.db.insert(mailboxes).values({ workspaceId: actor.workspaceId, kind: 'space', spaceId, address, name: input.name?.trim() || sp.name }).returning();
    await this.touched([row.id]);
    return { id: row.id, address };
  }

  // ── Threads ───────────────────────────────────────────────────────────────

  async threads(actor: Actor, mailboxId: string, opts: { folder: MailFolder; q?: string; before?: string; limit?: number }): Promise<MailThreadSummary[]> {
    await this.access(actor, mailboxId);
    const f = opts.folder;
    const inFolder =
      f === 'starred'
        ? sql`i.starred AND i.folder <> 'trash'`
        : f === 'all'
          ? sql`i.folder NOT IN ('trash', 'drafts')`
          : sql`i.folder = ${f}`;
    const q = opts.q?.trim() ? `%${opts.q.trim().replace(/[%_\\]/g, '\\$&')}%` : null;
    return this.threadSummaries(mailboxId, { inFolder, folder: f, q, before: opts.before, limit: Math.min(opts.limit ?? 50, 200) });
  }

  private async threadSummaries(mailboxId: string, o: { inFolder: ReturnType<typeof sql>; folder: MailFolder; q: string | null; before?: string; limit: number; only?: string }) {
    const res = await this.db.execute<{
      id: string;
      subject: string;
      last_at: Date;
      assignee_id: string | null;
      count: string;
      unread: boolean;
      starred: boolean;
      has_draft: boolean;
      has_files: boolean;
      folders: string[];
      participants: string[] | null;
      snippet: string | null;
    }>(sql`
      SELECT t.id, t.subject, t.last_at, t.assignee_id,
             count(i.id) FILTER (WHERE i.folder <> 'trash' OR ${o.folder} = 'trash') AS count,
             coalesce(bool_or(i.direction = 'in' AND i.read_at IS NULL AND i.folder <> 'trash'), false) AS unread,
             coalesce(bool_or(i.starred), false) AS starred,
             coalesce(bool_or(i.folder = 'drafts'), false) AS has_draft,
             coalesce(bool_or(EXISTS (SELECT 1 FROM mail_attachments a WHERE a.message_id = i.message_id)), false) AS has_files,
             array_agg(DISTINCT i.folder) AS folders,
             array_agg(coalesce(m.from_name, m.from_address) ORDER BY coalesce(m.sent_at, m.updated_at)) FILTER (WHERE m.status = 'sent') AS participants,
             (array_agg(left(m.text, 160) ORDER BY coalesce(m.sent_at, m.updated_at) DESC))[1] AS snippet
      FROM mail_threads t
      JOIN mail_items i ON i.thread_id = t.id
      JOIN mail_messages m ON m.id = i.message_id
      WHERE t.mailbox_id = ${mailboxId}
        ${o.only ? sql`AND t.id = ${o.only}` : sql`AND EXISTS (SELECT 1 FROM mail_items i WHERE i.thread_id = t.id AND (${o.inFolder}))`}
        ${o.before ? sql`AND t.last_at < ${o.before}` : sql``}
        ${
          o.q
            ? sql`AND EXISTS (SELECT 1 FROM mail_items qi JOIN mail_messages qm ON qm.id = qi.message_id WHERE qi.thread_id = t.id
                AND (qm.subject ILIKE ${o.q} OR qm.text ILIKE ${o.q} OR qm.from_address ILIKE ${o.q} OR coalesce(qm.from_name, '') ILIKE ${o.q} OR qm.to::text ILIKE ${o.q}))`
            : sql``
        }
      GROUP BY t.id
      ORDER BY t.last_at DESC
      LIMIT ${o.limit}`);
    const people = await loadUsers(this.db, res.rows.map((r) => r.assignee_id));
    return res.rows.map((r) => ({
      id: r.id,
      mailboxId,
      subject: r.subject || '(no subject)',
      participants: [...new Set(r.participants ?? [])],
      snippet: (r.snippet ?? '').replace(/\s+/g, ' ').trim(),
      lastAt: new Date(r.last_at).toISOString(),
      count: Number(r.count),
      unread: r.unread,
      starred: r.starred,
      hasAttachments: r.has_files,
      hasDraft: r.has_draft,
      folders: r.folders,
      assignee: r.assignee_id ? people.get(r.assignee_id) ?? null : null,
    }));
  }

  async thread(actor: Actor, threadId: string): Promise<MailThreadView> {
    const [t] = await this.db.select().from(mailThreads).where(eq(mailThreads.id, threadId));
    if (!t) throw new NotFoundException('Conversation not found');
    await this.access(actor, t.mailboxId);
    const box = (await this.list(actor)).find((b) => b.id === t.mailboxId)!;
    const [summary] = await this.threadSummaries(t.mailboxId, { inFolder: sql`true`, folder: 'all', q: null, limit: 1, only: threadId });
    const items = await this.db
      .select({ item: mailItems, msg: mailMessages })
      .from(mailItems)
      .innerJoin(mailMessages, eq(mailMessages.id, mailItems.messageId))
      .where(eq(mailItems.threadId, threadId))
      .orderBy(asc(sql`coalesce(${mailMessages.sentAt}, ${mailMessages.updatedAt})`));
    const atts = items.length ? await this.db.select().from(mailAttachments).where(inArray(mailAttachments.messageId, items.map((x) => x.msg.id))) : [];
    const authors = await loadUsers(this.db, items.map((x) => x.msg.authorId));
    // A message sent to yourself sits twice (out + in): show it once.
    const seen = new Set<string>();
    const messages: MailMessageView[] = [];
    for (const { item, msg } of items) {
      if (seen.has(msg.id)) continue;
      seen.add(msg.id);
      const out = items.some((x) => x.msg.id === msg.id && x.item.direction === 'out');
      messages.push(this.view(msg, item, out, authors, atts));
    }
    return { ...(summary ?? { id: t.id, mailboxId: t.mailboxId, subject: t.subject, participants: [], snippet: '', lastAt: t.lastAt, count: 0, unread: false, starred: false, hasAttachments: false, hasDraft: false, folders: [], assignee: null }), messages, mailbox: box };
  }

  private view(msg: Msg, item: typeof mailItems.$inferSelect, out: boolean, authors: Map<string, import('@workos/shared').UserSummary>, atts: (typeof mailAttachments.$inferSelect)[]): MailMessageView {
    return {
      id: msg.id,
      status: msg.status,
      direction: out ? 'out' : 'in',
      from: { address: msg.fromAddress, name: msg.fromName },
      to: msg.to,
      cc: msg.cc,
      bcc: out ? msg.bcc : [],
      subject: msg.subject,
      text: msg.text,
      html: msg.external ? msg.html : null,
      sentAt: msg.sentAt,
      read: out || !!item.readAt,
      starred: item.starred,
      external: msg.external,
      author: msg.authorId ? authors.get(msg.authorId) ?? null : null,
      attachments: atts.filter((a) => a.messageId === msg.id).map((a) => ({ id: a.id, name: a.name, mimeType: a.mimeType, sizeBytes: a.sizeBytes })),
      messageId: msg.messageId,
    };
  }

  /** Read / unread, star, move (inbox, archive, trash) — on every message of the thread in this mailbox. */
  async updateThread(actor: Actor, threadId: string, input: { read?: boolean; starred?: boolean; folder?: 'inbox' | 'archive' | 'trash'; assigneeId?: string | null }) {
    const [t] = await this.db.select().from(mailThreads).where(eq(mailThreads.id, threadId));
    if (!t) throw new NotFoundException('Conversation not found');
    const { box } = await this.access(actor, t.mailboxId, 'write');
    await this.db.transaction(async (tx) => {
      if (input.read !== undefined)
        await tx
          .update(mailItems)
          .set({ readAt: input.read ? sql`now()` : null })
          .where(and(eq(mailItems.threadId, threadId), eq(mailItems.direction, 'in')));
      if (input.starred !== undefined) await tx.update(mailItems).set({ starred: input.starred }).where(eq(mailItems.threadId, threadId));
      if (input.folder === 'trash') await tx.update(mailItems).set({ folder: 'trash' }).where(eq(mailItems.threadId, threadId));
      else if (input.folder === 'archive') await tx.update(mailItems).set({ folder: 'archive' }).where(and(eq(mailItems.threadId, threadId), eq(mailItems.direction, 'in'), sql`${mailItems.folder} IN ('inbox', 'trash')`));
      else if (input.folder === 'inbox') {
        // Back from archive or trash: received mail to the inbox, sent mail to Sent, drafts to Drafts.
        await tx.update(mailItems).set({ folder: 'inbox' }).where(and(eq(mailItems.threadId, threadId), eq(mailItems.direction, 'in')));
        await tx.execute(sql`UPDATE mail_items i SET folder = CASE WHEN m.status = 'draft' THEN 'drafts' ELSE 'sent' END
          FROM mail_messages m WHERE m.id = i.message_id AND i.thread_id = ${threadId} AND i.direction = 'out'`);
      }
      if (input.assigneeId !== undefined) {
        if (box.kind !== 'space') throw new BadRequestException('Only shared mailboxes assign conversations');
        if (input.assigneeId) {
          const role = (await this.perms.spaceRoles({ id: input.assigneeId, name: '', workspaceId: actor.workspaceId }, tx)).get(box.spaceId!);
          if (!can(role, 'editor')) throw new BadRequestException('Assign it to someone who can reply from this mailbox');
        }
        await tx.update(mailThreads).set({ assigneeId: input.assigneeId }).where(eq(mailThreads.id, threadId));
      }
    });
    await this.touched([t.mailboxId]);
  }

  /** Deletes a conversation that is in the trash, for good (in this mailbox only). */
  async deleteThread(actor: Actor, threadId: string) {
    const [t] = await this.db.select().from(mailThreads).where(eq(mailThreads.id, threadId));
    if (!t) throw new NotFoundException('Conversation not found');
    await this.access(actor, t.mailboxId, 'write');
    const items = await this.db.select().from(mailItems).where(eq(mailItems.threadId, threadId));
    if (items.some((i) => i.folder !== 'trash')) throw new BadRequestException('Move it to the trash first');
    await this.db.transaction(async (tx) => {
      await tx.delete(mailThreads).where(eq(mailThreads.id, threadId));
      // Messages nobody holds any more go too (with their attachments).
      const ids = [...new Set(items.map((i) => i.messageId))];
      if (ids.length) await tx.execute(sql`DELETE FROM mail_messages m WHERE m.id IN (${sql.join(ids.map((x) => sql`${x}`), sql`, `)}) AND NOT EXISTS (SELECT 1 FROM mail_items i WHERE i.message_id = m.id)`);
    });
    await this.touched([t.mailboxId]);
  }

  // ── Writing & sending ─────────────────────────────────────────────────────

  private cleanAddrs(list: MailAddr[] | undefined) {
    const out: MailAddr[] = [];
    for (const a of list ?? []) {
      const address = norm(a.address);
      if (!EMAIL.test(address)) throw new BadRequestException(`"${a.address}" is not an e-mail address`);
      if (!out.some((x) => x.address === address)) out.push({ address, name: a.name?.trim() || null });
    }
    return out;
  }

  /** The thread a message belongs to in a mailbox: by its references, else a new one. */
  private async threadFor(tx: Tx, boxId: string, refs: string[], subject: string, at: string) {
    if (refs.length) {
      const [hit] = await tx.execute<{ thread_id: string }>(sql`
        SELECT i.thread_id FROM mail_items i JOIN mail_messages m ON m.id = i.message_id
        WHERE i.mailbox_id = ${boxId} AND m.message_id IN (${sql.join(refs.map((r) => sql`${r}`), sql`, `)}) LIMIT 1`).then((r) => r.rows);
      if (hit) {
        await tx.update(mailThreads).set({ lastAt: at }).where(eq(mailThreads.id, hit.thread_id));
        return hit.thread_id;
      }
    }
    const [t] = await tx.insert(mailThreads).values({ mailboxId: boxId, subject, lastAt: at }).returning();
    return t.id;
  }

  /** Attachments for a message: uploads by the writer, and Drive files (copied; native documents become links). */
  private async collectAttachments(actor: Actor, tx: Tx, attachmentIds: string[], resourceIds: string[]) {
    const uploads = attachmentIds.length
      ? await tx.select().from(mailAttachments).where(and(inArray(mailAttachments.id, attachmentIds), eq(mailAttachments.workspaceId, actor.workspaceId)))
      : [];
    for (const a of uploads) if (a.uploadedBy !== actor.id) throw new NotFoundException('Attachment not found');
    if (uploads.length !== new Set(attachmentIds).size) throw new NotFoundException('Attachment not found');
    const links: string[] = [];
    const copies: { blobId: string; name: string; mimeType: string | null; sizeBytes: number }[] = [];
    if (resourceIds.length) {
      const rows = await tx.select().from(resources).where(and(inArray(resources.id, resourceIds), eq(resources.workspaceId, actor.workspaceId)));
      const roles = await this.perms.rolesFor(actor, rows, tx);
      for (const id of new Set(resourceIds)) {
        const r = rows.find((x) => x.id === id);
        if (!r || r.trashedAt || !can(roles.get(id), 'viewer')) throw new NotFoundException('File not found');
        // An e-mail carries copies; documents edited in Master Office travel as links (opened with the reader's own access).
        if (r.blobId && !(r.metadata as Record<string, unknown>)?.originalBlob) copies.push({ blobId: r.blobId, name: r.name, mimeType: r.mimeType, sizeBytes: r.sizeBytes });
        else links.push(`${r.name}: ${config.webOrigin}${resourcePath(r)}`);
      }
    }
    return { uploads, copies, links };
  }

  async saveDraft(actor: Actor, input: DraftInput): Promise<{ id: string; threadId: string }> {
    const { box } = await this.access(actor, input.mailboxId, 'write');
    const to = this.cleanAddrs(input.to);
    const cc = this.cleanAddrs(input.cc);
    const bcc = this.cleanAddrs(input.bcc);
    const res = await this.db.transaction(async (tx) => {
      const parent = input.replyTo ? await this.parentIn(tx, box.id, input.replyTo) : null;
      const values = {
        to,
        cc,
        bcc,
        subject: input.subject ?? '',
        text: input.text ?? '',
        inReplyTo: parent?.messageId ?? null,
        references: parent ? [...parent.references, parent.messageId] : [],
        updatedAt: new Date().toISOString(),
      };
      if (input.draftId) {
        const draft = await this.ownDraft(tx, box.id, input.draftId);
        await tx.update(mailMessages).set(values).where(eq(mailMessages.id, draft.id));
        if (input.attachmentIds) await this.attach(tx, actor, draft.id, input.attachmentIds);
        const [item] = await tx.select().from(mailItems).where(and(eq(mailItems.messageId, draft.id), eq(mailItems.mailboxId, box.id)));
        return { id: draft.id, threadId: item.threadId };
      }
      const domain = await this.domain(actor.workspaceId, tx);
      const [msg] = await tx
        .insert(mailMessages)
        .values({ ...values, workspaceId: actor.workspaceId, status: 'draft', messageId: `${crypto.randomUUID()}@${domain}`, fromAddress: box.address, fromName: box.kind === 'user' ? box.name : `${box.name}`, authorId: actor.id })
        .returning();
      const threadId = await this.threadFor(tx, box.id, msg.references, msg.subject, msg.updatedAt);
      await tx.insert(mailItems).values({ mailboxId: box.id, threadId, messageId: msg.id, direction: 'out', folder: 'drafts', readAt: msg.updatedAt });
      if (input.attachmentIds?.length) await this.attach(tx, actor, msg.id, input.attachmentIds);
      return { id: msg.id, threadId };
    });
    await this.touched([box.id]);
    return res;
  }

  private async attach(tx: Tx, actor: Actor, messageId: string, attachmentIds: string[]) {
    if (!attachmentIds.length) return;
    await tx
      .update(mailAttachments)
      .set({ messageId })
      .where(and(inArray(mailAttachments.id, attachmentIds), eq(mailAttachments.uploadedBy, actor.id), sql`(${mailAttachments.messageId} IS NULL OR ${mailAttachments.messageId} = ${messageId})`));
  }

  private async ownDraft(tx: Tx, boxId: string, draftId: string) {
    const [row] = await tx
      .select({ msg: mailMessages })
      .from(mailItems)
      .innerJoin(mailMessages, eq(mailMessages.id, mailItems.messageId))
      .where(and(eq(mailItems.mailboxId, boxId), eq(mailItems.messageId, draftId), eq(mailMessages.status, 'draft')));
    if (!row) throw new NotFoundException('Draft not found');
    return row.msg;
  }

  private async parentIn(tx: Tx, boxId: string, messageId: string) {
    const [row] = await tx
      .select({ msg: mailMessages })
      .from(mailItems)
      .innerJoin(mailMessages, eq(mailMessages.id, mailItems.messageId))
      .where(and(eq(mailItems.mailboxId, boxId), eq(mailItems.messageId, messageId)));
    if (!row) throw new NotFoundException('The message you reply to is not in this mailbox');
    return row.msg;
  }

  async deleteDraft(actor: Actor, draftId: string) {
    const [item] = await this.db.select().from(mailItems).where(and(eq(mailItems.messageId, draftId), eq(mailItems.direction, 'out')));
    if (!item) throw new NotFoundException('Draft not found');
    const { box } = await this.access(actor, item.mailboxId, 'write');
    await this.db.transaction(async (tx) => {
      await this.ownDraft(tx, box.id, draftId);
      await tx.delete(mailMessages).where(eq(mailMessages.id, draftId));
      await tx.execute(sql`DELETE FROM mail_threads t WHERE t.id = ${item.threadId} AND NOT EXISTS (SELECT 1 FROM mail_items i WHERE i.thread_id = t.id)`);
    });
    await this.touched([box.id]);
  }

  async send(actor: Actor, input: SendMailInput): Promise<{ id: string; threadId: string; external: number }> {
    const { box } = await this.access(actor, input.mailboxId, 'write');
    const to = this.cleanAddrs(input.to);
    const cc = this.cleanAddrs(input.cc);
    const bcc = this.cleanAddrs(input.bcc);
    if (!to.length && !cc.length && !bcc.length) throw new BadRequestException('Add at least one recipient');
    const domain = await this.domain(actor.workspaceId);
    const now = new Date().toISOString();

    const out = await this.db.transaction(async (tx) => {
      const parent = input.replyTo ? await this.parentIn(tx, box.id, input.replyTo) : null;
      const { uploads, copies, links } = await this.collectAttachments(actor, tx, input.attachmentIds ?? [], input.resourceIds ?? []);
      const text = links.length ? `${input.text.trimEnd()}\n\n${links.map((l) => `📎 ${l}`).join('\n')}` : input.text;
      const values = {
        status: 'sent' as const,
        to,
        cc,
        bcc,
        subject: input.subject.trim() || (parent ? `Re: ${parent.subject.replace(/^re:\s*/i, '')}` : ''),
        text,
        html: textToHtml(text),
        inReplyTo: parent?.messageId ?? null,
        references: parent ? [...parent.references, parent.messageId].slice(-20) : [],
        fromAddress: box.address,
        fromName: box.name,
        authorId: actor.id,
        sentAt: now,
        updatedAt: now,
      };
      let msg: Msg;
      if (input.draftId) {
        const draft = await this.ownDraft(tx, box.id, input.draftId);
        [msg] = await tx.update(mailMessages).set(values).where(eq(mailMessages.id, draft.id)).returning();
        await tx.update(mailItems).set({ folder: 'sent' }).where(and(eq(mailItems.messageId, msg.id), eq(mailItems.mailboxId, box.id)));
        const [item] = await tx.select().from(mailItems).where(and(eq(mailItems.messageId, msg.id), eq(mailItems.mailboxId, box.id)));
        await tx.update(mailThreads).set({ lastAt: now }).where(eq(mailThreads.id, item.threadId));
      } else {
        [msg] = await tx.insert(mailMessages).values({ ...values, workspaceId: actor.workspaceId, messageId: `${crypto.randomUUID()}@${domain}` }).returning();
        const threadId = await this.threadFor(tx, box.id, msg.references, msg.subject, now);
        await tx.insert(mailItems).values({ mailboxId: box.id, threadId, messageId: msg.id, direction: 'out', folder: 'sent', readAt: now });
      }
      await this.attach(tx, actor, msg.id, uploads.map((u) => u.id));
      if (copies.length) await tx.insert(mailAttachments).values(copies.map((c) => ({ ...c, workspaceId: actor.workspaceId, messageId: msg.id, uploadedBy: actor.id })));
      const [senderItem] = await tx.select().from(mailItems).where(and(eq(mailItems.messageId, msg.id), eq(mailItems.mailboxId, box.id)));

      // Delivery: addresses of the system get the message in their inbox right away; the rest go out over SMTP.
      const all = [...to, ...cc, ...bcc];
      const local = all.length ? await tx.select().from(mailboxes).where(inArray(mailboxes.address, all.map((a) => a.address))) : [];
      const received: { box: Box; threadId: string; subject: string; from: string }[] = [];
      for (const dest of local) {
        const threadId = dest.id === box.id ? senderItem.threadId : await this.threadFor(tx, dest.id, msg.references, msg.subject, now);
        await tx.insert(mailItems).values({ mailboxId: dest.id, threadId, messageId: msg.id, direction: 'in', folder: 'inbox' }).onConflictDoNothing();
        received.push({ box: dest, threadId, subject: msg.subject, from: box.name });
      }
      const external = all.filter((a) => !local.some((l) => l.address === a.address));
      return { msg, threadId: senderItem.threadId, received, external, local };
    });

    if (out.external.length) {
      const atts = await this.db.select().from(mailAttachments).where(eq(mailAttachments.messageId, out.msg.id));
      const files = await Promise.all(
        atts.map(async (a) => {
          const [b] = await this.db.select().from(blobs).where(eq(blobs.id, a.blobId));
          return { filename: a.name, content: await this.storage.getBuffer(b.storageKey), contentType: a.mimeType ?? undefined };
        }),
      );
      const fmt = (l: MailAddr[]) => l.map((a) => (a.name ? `"${a.name.replace(/"/g, '')}" <${a.address}>` : a.address)).join(', ');
      await this.mail.send({
        kind: 'mail.message',
        from: `"${box.name.replace(/"/g, '')}" <${box.address}>`,
        to: fmt(to) || fmt(cc),
        cc: to.length ? fmt(cc) || undefined : undefined,
        bcc: fmt(bcc.filter((b) => out.external.some((e) => e.address === b.address))) || undefined,
        subject: out.msg.subject,
        text: out.msg.text,
        html: out.msg.html ?? undefined,
        messageId: out.msg.messageId,
        inReplyTo: out.msg.inReplyTo ?? undefined,
        references: out.msg.references,
        attachments: files,
        envelopeTo: out.external.map((e) => e.address),
      });
    }
    await this.touched([box.id, ...out.local.map((l) => l.id)], out.received.filter((r) => r.box.id !== box.id));
    return { id: out.msg.id, threadId: out.threadId, external: out.external.length };
  }

  // ── Attachments ───────────────────────────────────────────────────────────

  async upload(actor: Actor, file: { originalname: string; buffer: Buffer; mimetype: string; size: number }) {
    if (file.size > config.maxUploadBytes) throw new BadRequestException('File too large');
    // Attachments people send are charged to them (§79 C).
    await this.quota.assertRoom(actor.workspaceId, { spaceId: null, ownerId: actor.id }, file.size);
    const name = Buffer.from(file.originalname, 'latin1').toString('utf8');
    const sha = StorageService.sha256(file.buffer);
    const key = await this.storage.putBlob(file.buffer, sha, file.mimetype);
    const [blob] = await this.db
      .insert(blobs)
      .values({ sha256: sha, sizeBytes: file.size, mimeType: file.mimetype, storageKey: key })
      .onConflictDoUpdate({ target: blobs.sha256, set: { sha256: sha } })
      .returning();
    const [row] = await this.db.insert(mailAttachments).values({ workspaceId: actor.workspaceId, blobId: blob.id, name, mimeType: file.mimetype, sizeBytes: file.size, uploadedBy: actor.id }).returning();
    return { id: row.id, name, mimeType: row.mimeType, sizeBytes: row.sizeBytes };
  }

  /** An attachment is readable by whoever can read a mailbox holding its message (or its uploader, before sending). */
  async attachment(actor: Actor, id: string) {
    const [a] = await this.db.select().from(mailAttachments).where(eq(mailAttachments.id, id));
    if (!a || a.workspaceId !== actor.workspaceId) throw new NotFoundException('Attachment not found');
    let ok = !a.messageId && a.uploadedBy === actor.id;
    if (!ok && a.messageId) {
      const holders = await this.db.select({ mailboxId: mailItems.mailboxId }).from(mailItems).where(eq(mailItems.messageId, a.messageId));
      for (const h of holders) if (await this.access(actor, h.mailboxId).then(() => true, () => false)) ok = true;
    }
    if (!ok) throw new NotFoundException('Attachment not found');
    const [b] = await this.db.select().from(blobs).where(eq(blobs.id, a.blobId));
    return { att: a, blob: b };
  }

  async download(actor: Actor, id: string) {
    const { att, blob } = await this.attachment(actor, id);
    return { name: att.name, mimeType: att.mimeType ?? 'application/octet-stream', size: att.sizeBytes, etag: blob.sha256, open: () => this.storage.getStream(blob.storageKey) };
  }

  async buffer(actor: Actor, id: string) {
    const { att, blob } = await this.attachment(actor, id);
    return { att, buffer: await this.storage.getBuffer(blob.storageKey) };
  }

  // ── Address book ──────────────────────────────────────────────────────────

  /** People and shared mailboxes of the workspace, and outside addresses you have written with. */
  async addresses(actor: Actor, q: string) {
    const needle = `%${q.trim().replace(/[%_\\]/g, '\\$&')}%`;
    const mine = await this.ensurePersonal(actor);
    const boxes = await this.db
      .select({ address: mailboxes.address, name: mailboxes.name, kind: mailboxes.kind })
      .from(mailboxes)
      .where(and(eq(mailboxes.workspaceId, actor.workspaceId), sql`(${mailboxes.address} ILIKE ${needle} OR ${mailboxes.name} ILIKE ${needle})`))
      .limit(10);
    const people = await this.db
      .select({ address: users.email, name: users.name })
      .from(users)
      .where(sql`(${users.email} ILIKE ${needle} OR ${users.name} ILIKE ${needle}) AND EXISTS (SELECT 1 FROM workspace_members w WHERE w.user_id = ${users.id} AND w.workspace_id = ${actor.workspaceId})`)
      .limit(10);
    const recent = await this.db.execute<{ address: string; name: string | null }>(sql`
      SELECT DISTINCT ON (lower(a->>'address')) lower(a->>'address') AS address, a->>'name' AS name
      FROM mail_items i JOIN mail_messages m ON m.id = i.message_id, jsonb_array_elements(m.to || m.cc) a
      WHERE i.mailbox_id = ${mine.id} AND (a->>'address' ILIKE ${needle} OR coalesce(a->>'name', '') ILIKE ${needle}) LIMIT 10`);
    const out = new Map<string, MailAddr & { kind: 'person' | 'space' | 'external' }>();
    for (const p of people) out.set(p.address.toLowerCase(), { address: p.address.toLowerCase(), name: p.name, kind: 'person' });
    for (const b of boxes) if (!out.has(b.address)) out.set(b.address, { address: b.address, name: b.name, kind: b.kind === 'space' ? 'space' : 'person' });
    for (const r of recent.rows) if (!out.has(r.address)) out.set(r.address, { address: r.address, name: r.name, kind: 'external' });
    return [...out.values()].slice(0, 12);
  }
  // ── Mail from outside (§70) ───────────────────────────────────────────────

  /** Files a message that came from outside in the mailboxes it is addressed to (by address). */
  async receiveExternal(m: {
    messageId: string;
    inReplyTo: string | null;
    references: string[];
    from: MailAddr;
    to: MailAddr[];
    cc: MailAddr[];
    subject: string;
    text: string;
    html: string | null;
    sentAt: string;
    attachments: { name: string; mimeType: string; content: Buffer }[];
    targets: string[];
  }) {
    const boxes = m.targets.length ? await this.db.select().from(mailboxes).where(inArray(mailboxes.address, [...new Set(m.targets)])) : [];
    if (!boxes.length) return 0;
    const refs = [...new Set([m.inReplyTo, ...m.references].filter((x): x is string => !!x))];
    const received: { box: Box; threadId: string; subject: string; from: string }[] = [];
    await this.db.transaction(async (tx) => {
      let [msg] = await tx.select().from(mailMessages).where(eq(mailMessages.messageId, m.messageId));
      if (!msg) {
        [msg] = await tx
          .insert(mailMessages)
          .values({
            workspaceId: boxes[0].workspaceId,
            messageId: m.messageId,
            inReplyTo: m.inReplyTo,
            references: m.references.slice(-20),
            fromAddress: m.from.address,
            fromName: m.from.name,
            to: m.to,
            cc: m.cc,
            subject: m.subject,
            text: m.text,
            html: m.html,
            external: true,
            sentAt: m.sentAt,
            updatedAt: m.sentAt,
          })
          .returning();
        for (const a of m.attachments) {
          const sha = StorageService.sha256(a.content);
          const key = await this.storage.putBlob(a.content, sha, a.mimeType);
          const [b] = await tx
            .insert(blobs)
            .values({ sha256: sha, sizeBytes: a.content.length, mimeType: a.mimeType, storageKey: key })
            .onConflictDoUpdate({ target: blobs.sha256, set: { sha256: sha } })
            .returning();
          await tx.insert(mailAttachments).values({ workspaceId: msg.workspaceId, messageId: msg.id, blobId: b.id, name: a.name, mimeType: a.mimeType, sizeBytes: a.content.length });
        }
      }
      for (const box of boxes) {
        const [has] = await tx.select({ id: mailItems.id }).from(mailItems).where(and(eq(mailItems.mailboxId, box.id), eq(mailItems.messageId, msg.id), eq(mailItems.direction, 'in')));
        if (has) continue;
        const threadId = await this.threadFor(tx, box.id, refs, m.subject.replace(/^\s*((re|fwd?)\s*:\s*)+/i, '') || m.subject, m.sentAt);
        await tx.insert(mailItems).values({ mailboxId: box.id, threadId, messageId: msg.id, direction: 'in', folder: 'inbox' });
        received.push({ box, threadId, subject: m.subject, from: m.from.name ?? m.from.address });
      }
    });
    await this.touched(boxes.map((b) => b.id), received);
    for (const r of received)
      flowHooks.fire('mail.received', r.box.workspaceId, { mailboxId: r.box.id, address: r.box.address, from: m.from.address, fromName: m.from.name ?? null, subject: m.subject, text: m.text.slice(0, 5000), messageId: m.messageId, threadId: r.threadId, attachments: m.attachments.map((a) => a.name) });
    return received.length;
  }
}
