import { BadRequestException, ForbiddenException, Injectable, NotFoundException, type OnModuleInit } from '@nestjs/common';
import type { ChannelListing, ChatMessage, ConversationDetail, ConversationKind, ConversationMember, ConversationRole, ConversationSummary, UserSummary } from '@workos/shared';
import { and, asc, desc, eq, ilike, inArray, isNull, lt, sql } from 'drizzle-orm';
import type { Actor } from '../common/current-user';
import { loadUsers } from '../common/users';
import type { Db, Tx } from '../db/client';
import { InjectDb } from '../db/db.module';
import { conversationMembers, conversations, messageReactions, messages, users, workspaceMembers } from '../db/schema';
import { EventsService } from '../events/events.service';
import { PermissionsService } from '../permissions/permissions.service';
import { RealtimeService } from '../realtime/realtime.service';

type Conv = typeof conversations.$inferSelect;
type MsgRow = typeof messages.$inferSelect;
type MemberRow = typeof conversationMembers.$inferSelect;

const MENTION = /<@([0-9a-f-]{36})>/gi;
const CHANNEL_COLORS = ['#2563eb', '#8b5cf6', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#14b8a6'];

export interface CreateConversationInput {
  kind: ConversationKind;
  userId?: string;
  name?: string | null;
  description?: string | null;
  visibility?: 'public' | 'private';
  memberIds?: string[];
  spaceId?: string | null;
}

/**
 * Chat (docs/ARCHITECTURE.md §64): direct messages, groups and channels. Messages carry a per-conversation `seq`
 * so unread counts and read receipts are one integer per member. Every change is pushed to the members' sockets.
 */
@Injectable()
export class ChatService implements OnModuleInit {
  /** "is a member" answers for typing signals, which arrive several times a second. */
  private readonly typingCache = new Map<string, { ok: boolean; at: number }>();

  constructor(
    @InjectDb() private readonly db: Db,
    private readonly realtime: RealtimeService,
    private readonly events: EventsService,
    private readonly perms: PermissionsService,
  ) {}

  onModuleInit() {
    this.realtime.onClientMessage(async (actor, msg) => {
      if (msg.type !== 'typing' || typeof msg.conversationId !== 'string' || !/^[0-9a-f-]{36}$/i.test(msg.conversationId)) return;
      const key = `${actor.id}:${msg.conversationId}`;
      let hit = this.typingCache.get(key);
      if (!hit || Date.now() - hit.at > 60_000) {
        const [m] = await this.db
          .select({ u: conversationMembers.userId })
          .from(conversationMembers)
          .where(and(eq(conversationMembers.conversationId, msg.conversationId), eq(conversationMembers.userId, actor.id)));
        hit = { ok: !!m, at: Date.now() };
        this.typingCache.set(key, hit);
      }
      if (!hit.ok) return;
      const threadRootId = typeof msg.threadRootId === 'string' ? msg.threadRootId : null;
      this.realtime.publish(await this.memberIds(msg.conversationId), { type: 'chat.typing', conversationId: msg.conversationId, user: { id: actor.id, name: actor.name }, threadRootId }, actor.id);
    });
  }

  // ── Access ────────────────────────────────────────────────────────────────

  private async memberIds(conversationId: string, tx: Tx = this.db) {
    const rows = await tx.select({ id: conversationMembers.userId }).from(conversationMembers).where(eq(conversationMembers.conversationId, conversationId));
    return rows.map((r) => r.id);
  }

  /** Loads a conversation the actor may read: a member, or anyone in the workspace for a public channel (preview). */
  private async access(actor: Actor, id: string, tx: Tx = this.db): Promise<{ conv: Conv; member: MemberRow | null }> {
    const [conv] = await tx.select().from(conversations).where(eq(conversations.id, id));
    if (!conv || conv.workspaceId !== actor.workspaceId) throw new NotFoundException('Conversation not found');
    const [member] = await tx
      .select()
      .from(conversationMembers)
      .where(and(eq(conversationMembers.conversationId, id), eq(conversationMembers.userId, actor.id)));
    if (!member && !(conv.kind === 'channel' && conv.visibility === 'public')) throw new NotFoundException('Conversation not found');
    return { conv, member: member ?? null };
  }

  private async requireMember(actor: Actor, id: string, tx: Tx = this.db) {
    const a = await this.access(actor, id, tx);
    if (!a.member) throw new ForbiddenException('Join the channel to take part');
    return a as { conv: Conv; member: MemberRow };
  }

  private async workspaceUsers(actor: Actor, ids: string[], tx: Tx = this.db) {
    const uniq = [...new Set(ids)];
    if (!uniq.length) return [];
    const rows = await tx
      .select({ id: workspaceMembers.userId })
      .from(workspaceMembers)
      .where(and(eq(workspaceMembers.workspaceId, actor.workspaceId), inArray(workspaceMembers.userId, uniq)));
    if (rows.length !== uniq.length) throw new BadRequestException('Some people are not in this workspace');
    return uniq;
  }

  // ── Conversations ─────────────────────────────────────────────────────────

  async list(actor: Actor): Promise<ConversationSummary[]> {
    const rows = await this.summaries(actor);
    return rows.sort((a, b) => (b.lastMessageAt ?? '').localeCompare(a.lastMessageAt ?? ''));
  }

  private async summaries(actor: Actor, only?: string): Promise<ConversationSummary[]> {
    const res = await this.db.execute<{
      id: string;
      kind: ConversationKind;
      name: string | null;
      description: string | null;
      visibility: 'public' | 'private';
      color: string | null;
      space_id: string | null;
      last_seq: string;
      last_message_at: Date | null;
      role: ConversationRole;
      last_read_seq: string;
      pinned: boolean;
      muted: boolean;
      unread: string;
      mentions: string;
      lm_body: string | null;
      lm_kind: 'text' | 'system' | null;
      lm_sender: string | null;
      lm_at: Date | null;
      lm_deleted: Date | null;
    }>(sql`
      SELECT c.id, c.kind, c.name, c.description, c.visibility, c.color, c.space_id, c.last_seq, c.last_message_at,
             m.role, m.last_read_seq, m.pinned, m.muted,
             (SELECT count(*) FROM messages x WHERE x.conversation_id = c.id AND x.seq > m.last_read_seq AND x.thread_root_id IS NULL
                AND x.deleted_at IS NULL AND x.kind = 'text' AND x.sender_id IS DISTINCT FROM ${actor.id}) AS unread,
             (SELECT count(*) FROM messages x WHERE x.conversation_id = c.id AND x.seq > m.last_read_seq AND x.thread_root_id IS NULL
                AND x.deleted_at IS NULL AND ${actor.id}::uuid = ANY(x.mentions)) AS mentions,
             lm.body AS lm_body, lm.kind AS lm_kind, lm.sender_id AS lm_sender, lm.created_at AS lm_at, lm.deleted_at AS lm_deleted
      FROM conversation_members m
      JOIN conversations c ON c.id = m.conversation_id
      LEFT JOIN LATERAL (
        SELECT x.body, x.kind, x.sender_id, x.created_at, x.deleted_at FROM messages x
        WHERE x.conversation_id = c.id AND x.thread_root_id IS NULL ORDER BY x.seq DESC LIMIT 1
      ) lm ON true
      WHERE m.user_id = ${actor.id} ${only ? sql`AND c.id = ${only}` : sql``}`);
    const rows = res.rows;
    if (!rows.length) return [];
    const members = await this.db
      .select({ conversationId: conversationMembers.conversationId, userId: conversationMembers.userId })
      .from(conversationMembers)
      .where(inArray(conversationMembers.conversationId, rows.map((r) => r.id)))
      .orderBy(asc(conversationMembers.joinedAt));
    const byConv = new Map<string, string[]>();
    for (const m of members) byConv.set(m.conversationId, [...(byConv.get(m.conversationId) ?? []), m.userId]);
    const people = await loadUsers(this.db, [...members.map((m) => m.userId), ...rows.map((r) => r.lm_sender)]);
    const iso = (d: Date | string | null) => (d ? new Date(d).toISOString() : null);

    return rows.map((r) => {
      const ids = byConv.get(r.id) ?? [];
      const others = ids.filter((x) => x !== actor.id);
      const peer = r.kind === 'dm' ? people.get(others[0] ?? actor.id) ?? null : null;
      const faces = others.slice(0, 3).map((x) => people.get(x)!).filter(Boolean);
      const sender = r.lm_sender ? people.get(r.lm_sender) ?? null : null;
      return {
        id: r.id,
        kind: r.kind,
        title: this.title(r.kind, r.name, peer, faces, actor),
        description: r.description,
        visibility: r.visibility,
        color: r.color,
        spaceId: r.space_id,
        peer,
        faces,
        memberCount: ids.length,
        lastMessage: r.lm_kind
          ? {
              body: r.lm_deleted ? 'This message was deleted' : r.lm_body ?? '',
              sender: sender?.name ?? null,
              senderId: r.lm_sender,
              kind: r.lm_kind,
              createdAt: iso(r.lm_at)!,
            }
          : null,
        lastMessageAt: iso(r.last_message_at),
        lastSeq: Number(r.last_seq),
        lastReadSeq: Number(r.last_read_seq),
        unread: Number(r.unread),
        mentions: Number(r.mentions),
        pinned: r.pinned,
        muted: r.muted,
        role: r.role,
      };
    });
  }

  private title(kind: ConversationKind, name: string | null, peer: UserSummary | null, faces: UserSummary[], actor: Actor) {
    if (kind === 'dm') return peer ? (peer.id === actor.id ? `${peer.name} (you)` : peer.name) : 'Direct message';
    if (name) return name;
    return faces.length ? faces.map((f) => f.name.split(' ')[0]).join(', ') : 'Group';
  }

  async get(actor: Actor, id: string): Promise<ConversationDetail> {
    const { conv, member } = await this.access(actor, id);
    const rows = await this.db.select().from(conversationMembers).where(eq(conversationMembers.conversationId, id)).orderBy(asc(conversationMembers.joinedAt));
    const people = await loadUsers(this.db, [...rows.map((r) => r.userId), conv.createdBy]);
    const members: ConversationMember[] = rows
      .filter((r) => people.has(r.userId))
      .map((r) => ({ ...people.get(r.userId)!, role: r.role, lastReadSeq: r.lastReadSeq, joinedAt: r.joinedAt }));
    let summary: ConversationSummary;
    if (member) [summary] = await this.summaries(actor, id);
    else {
      // Previewing a public channel without being in it.
      const faces = members.slice(0, 3);
      summary = {
        id,
        kind: conv.kind,
        title: conv.name ?? 'Channel',
        description: conv.description,
        visibility: conv.visibility,
        color: conv.color,
        spaceId: conv.spaceId,
        peer: null,
        faces,
        memberCount: members.length,
        lastMessage: null,
        lastMessageAt: conv.lastMessageAt,
        lastSeq: conv.lastSeq,
        lastReadSeq: conv.lastSeq,
        unread: 0,
        mentions: 0,
        pinned: false,
        muted: false,
        role: 'member',
      };
    }
    return { ...summary, members, createdAt: conv.createdAt, createdBy: conv.createdBy ? people.get(conv.createdBy) ?? null : null, joined: !!member };
  }

  async create(actor: Actor, input: CreateConversationInput): Promise<{ id: string; created: boolean }> {
    if (input.kind === 'dm') {
      if (!input.userId) throw new BadRequestException('userId is required');
      await this.workspaceUsers(actor, [input.userId]);
      const pair = [...new Set([actor.id, input.userId])].sort();
      const dmKey = `${actor.workspaceId}:${pair.join(':')}`;
      const [existing] = await this.db.select({ id: conversations.id }).from(conversations).where(eq(conversations.dmKey, dmKey));
      if (existing) return { id: existing.id, created: false };
      const id = await this.db.transaction(async (tx) => {
        const [c] = await tx.insert(conversations).values({ workspaceId: actor.workspaceId, kind: 'dm', dmKey, createdBy: actor.id }).onConflictDoNothing().returning();
        if (!c) return (await tx.select({ id: conversations.id }).from(conversations).where(eq(conversations.dmKey, dmKey)))[0].id;
        await tx.insert(conversationMembers).values(pair.map((userId) => ({ conversationId: c.id, userId, role: 'member' as const })));
        return c.id;
      });
      return { id, created: true };
    }

    const others = await this.workspaceUsers(actor, (input.memberIds ?? []).filter((x) => x !== actor.id));
    if (input.kind === 'group' && !others.length) throw new BadRequestException('Add at least one person');
    if (input.kind === 'channel' && !input.name?.trim()) throw new BadRequestException('A channel needs a name');
    if (input.spaceId) await this.perms.requireSpace(actor, input.spaceId, 'viewer');
    const id = await this.db.transaction(async (tx) => {
      const [c] = await tx
        .insert(conversations)
        .values({
          workspaceId: actor.workspaceId,
          kind: input.kind,
          name: input.name?.trim() || null,
          description: input.description?.trim() || null,
          visibility: input.kind === 'channel' ? input.visibility ?? 'public' : 'private',
          spaceId: input.spaceId ?? null,
          color: input.kind === 'channel' ? CHANNEL_COLORS[Math.floor(Math.random() * CHANNEL_COLORS.length)] : null,
          createdBy: actor.id,
        })
        .returning();
      await tx.insert(conversationMembers).values([
        { conversationId: c.id, userId: actor.id, role: 'owner' as const },
        ...others.map((userId) => ({ conversationId: c.id, userId, role: 'member' as const })),
      ]);
      await this.system(tx, c.id, actor, input.kind === 'channel' ? `created the channel ${c.name}` : 'created the group');
      await this.events.emit(tx, actor, 'chat.conversation_created', { spaceId: input.spaceId ?? null }, { conversationId: c.id, kind: input.kind, name: c.name });
      return c.id;
    });
    this.realtime.publish([actor.id, ...others], { type: 'chat.conversation', conversationId: id });
    return { id, created: true };
  }

  async update(actor: Actor, id: string, input: { name?: string | null; description?: string | null; visibility?: 'public' | 'private' }) {
    const { conv, member } = await this.requireMember(actor, id);
    if (conv.kind === 'dm') throw new BadRequestException('Direct messages have no settings');
    if (conv.kind === 'channel' && member.role === 'member') throw new ForbiddenException('Only channel admins can change its settings');
    if (conv.kind === 'channel' && input.name !== undefined && !input.name?.trim()) throw new BadRequestException('A channel needs a name');
    await this.db.transaction(async (tx) => {
      const set: Partial<Conv> = {};
      if (input.name !== undefined) set.name = input.name?.trim() || null;
      if (input.description !== undefined) set.description = input.description?.trim() || null;
      if (input.visibility !== undefined && conv.kind === 'channel') set.visibility = input.visibility;
      if (!Object.keys(set).length) return;
      await tx.update(conversations).set(set).where(eq(conversations.id, id));
      if (set.name !== undefined && set.name !== conv.name) await this.system(tx, id, actor, set.name ? `renamed the conversation to ${set.name}` : 'removed the conversation name');
      if (set.visibility && set.visibility !== conv.visibility) await this.system(tx, id, actor, `made the channel ${set.visibility}`);
    });
    this.realtime.publish(await this.memberIds(id), { type: 'chat.conversation', conversationId: id });
  }

  async addMembers(actor: Actor, id: string, userIds: string[]) {
    const { conv } = await this.requireMember(actor, id);
    if (conv.kind === 'dm') throw new BadRequestException('Start a group to add more people to a direct message');
    const current = new Set(await this.memberIds(id));
    const add = (await this.workspaceUsers(actor, userIds)).filter((u) => !current.has(u));
    if (!add.length) return { added: 0 };
    const people = await loadUsers(this.db, add);
    await this.db.transaction(async (tx) => {
      // New members start "caught up": history is visible, but not counted as unread.
      await tx.insert(conversationMembers).values(add.map((userId) => ({ conversationId: id, userId, lastReadSeq: conv.lastSeq })));
      await this.system(tx, id, actor, `added ${add.map((u) => people.get(u)!.name).join(', ')}`);
    });
    this.realtime.publish([...current, ...add], { type: 'chat.conversation', conversationId: id });
    return { added: add.length };
  }

  async removeMember(actor: Actor, id: string, userId: string) {
    const { conv, member } = await this.requireMember(actor, id);
    if (conv.kind === 'dm') throw new BadRequestException('You cannot leave a direct message');
    const self = userId === actor.id;
    if (!self && member.role === 'member') throw new ForbiddenException('Only admins can remove people');
    const before = await this.memberIds(id);
    if (!before.includes(userId)) throw new NotFoundException('Not a member');
    const people = await loadUsers(this.db, [userId]);
    await this.db.transaction(async (tx) => {
      const [gone] = await tx
        .delete(conversationMembers)
        .where(and(eq(conversationMembers.conversationId, id), eq(conversationMembers.userId, userId)))
        .returning();
      // The last owner leaving hands the conversation to the longest-standing member.
      if (gone?.role === 'owner') {
        const [owner] = await tx.select().from(conversationMembers).where(and(eq(conversationMembers.conversationId, id), eq(conversationMembers.role, 'owner')));
        if (!owner) {
          const [next] = await tx.select().from(conversationMembers).where(eq(conversationMembers.conversationId, id)).orderBy(asc(conversationMembers.joinedAt)).limit(1);
          if (next) await tx.update(conversationMembers).set({ role: 'owner' }).where(and(eq(conversationMembers.conversationId, id), eq(conversationMembers.userId, next.userId)));
        }
      }
      await this.system(tx, id, actor, self ? 'left' : `removed ${people.get(userId)?.name ?? 'someone'}`);
    });
    this.realtime.publish(before, { type: 'chat.conversation', conversationId: id });
    this.realtime.publish([userId], { type: 'chat.conversation', conversationId: id, removed: true });
  }

  async setRole(actor: Actor, id: string, userId: string, role: 'admin' | 'member') {
    const { conv, member } = await this.requireMember(actor, id);
    if (conv.kind !== 'channel') throw new BadRequestException('Only channels have admins');
    if (member.role === 'member') throw new ForbiddenException('Only admins can change roles');
    const [target] = await this.db.select().from(conversationMembers).where(and(eq(conversationMembers.conversationId, id), eq(conversationMembers.userId, userId)));
    if (!target) throw new NotFoundException('Not a member');
    if (target.role === 'owner') throw new BadRequestException('The owner keeps full control');
    await this.db.update(conversationMembers).set({ role }).where(and(eq(conversationMembers.conversationId, id), eq(conversationMembers.userId, userId)));
    this.realtime.publish(await this.memberIds(id), { type: 'chat.conversation', conversationId: id });
  }

  async join(actor: Actor, id: string) {
    const { conv, member } = await this.access(actor, id);
    if (member) return;
    await this.db.transaction(async (tx) => {
      await tx.insert(conversationMembers).values({ conversationId: id, userId: actor.id, lastReadSeq: conv.lastSeq }).onConflictDoNothing();
      await this.system(tx, id, actor, 'joined');
    });
    this.realtime.publish(await this.memberIds(id), { type: 'chat.conversation', conversationId: id });
  }

  async setPrefs(actor: Actor, id: string, input: { pinned?: boolean; muted?: boolean }) {
    await this.requireMember(actor, id);
    if (input.pinned === undefined && input.muted === undefined) return;
    await this.db
      .update(conversationMembers)
      .set({ ...(input.pinned !== undefined ? { pinned: input.pinned } : {}), ...(input.muted !== undefined ? { muted: input.muted } : {}) })
      .where(and(eq(conversationMembers.conversationId, id), eq(conversationMembers.userId, actor.id)));
    this.realtime.publish([actor.id], { type: 'chat.conversation', conversationId: id });
  }

  async browse(actor: Actor, q?: string): Promise<ChannelListing[]> {
    const rows = await this.db
      .select({
        id: conversations.id,
        name: conversations.name,
        description: conversations.description,
        color: conversations.color,
        memberCount: sql<number>`(SELECT count(*)::int FROM conversation_members m WHERE m.conversation_id = ${conversations.id})`,
        joined: sql<boolean>`EXISTS (SELECT 1 FROM conversation_members m WHERE m.conversation_id = ${conversations.id} AND m.user_id = ${actor.id})`,
      })
      .from(conversations)
      .where(
        and(
          eq(conversations.workspaceId, actor.workspaceId),
          eq(conversations.kind, 'channel'),
          eq(conversations.visibility, 'public'),
          q?.trim() ? ilike(conversations.name, `%${q.trim().replace(/[%_\\]/g, '\\$&')}%`) : undefined,
        ),
      )
      .orderBy(asc(conversations.name))
      .limit(100);
    return rows.map((r) => ({ id: r.id, title: r.name ?? 'Channel', description: r.description, color: r.color, memberCount: r.memberCount, joined: r.joined }));
  }

  // ── Messages ──────────────────────────────────────────────────────────────

  /** Top-level messages, newest page first (`before` = a seq for older pages); returned oldest → newest. */
  async history(actor: Actor, id: string, before?: number, limit = 50): Promise<{ messages: ChatMessage[]; hasMore: boolean }> {
    await this.access(actor, id);
    const rows = await this.db
      .select()
      .from(messages)
      .where(and(eq(messages.conversationId, id), isNull(messages.threadRootId), before ? lt(messages.seq, before) : undefined))
      .orderBy(desc(messages.seq))
      .limit(limit + 1);
    const hasMore = rows.length > limit;
    return { messages: await this.serialize(actor, rows.slice(0, limit).reverse()), hasMore };
  }

  async thread(actor: Actor, messageId: string): Promise<{ root: ChatMessage; replies: ChatMessage[] }> {
    const root = await this.message(messageId);
    if (root.threadRootId) throw new BadRequestException('Not a thread');
    await this.access(actor, root.conversationId);
    const replies = await this.db.select().from(messages).where(eq(messages.threadRootId, messageId)).orderBy(asc(messages.seq));
    const [r, ...rest] = await this.serialize(actor, [root, ...replies]);
    return { root: r, replies: rest };
  }

  async search(actor: Actor, id: string, q: string): Promise<ChatMessage[]> {
    await this.access(actor, id);
    if (!q.trim()) return [];
    const rows = await this.db
      .select()
      .from(messages)
      .where(and(eq(messages.conversationId, id), isNull(messages.deletedAt), eq(messages.kind, 'text'), ilike(messages.body, `%${q.trim().replace(/[%_\\]/g, '\\$&')}%`)))
      .orderBy(desc(messages.seq))
      .limit(50);
    return this.serialize(actor, rows);
  }

  private async message(id: string) {
    const [row] = await this.db.select().from(messages).where(eq(messages.id, id));
    if (!row) throw new NotFoundException('Message not found');
    return row;
  }

  private async mentionsIn(actor: Actor, body: string, tx: Tx) {
    const ids = [...new Set([...body.matchAll(MENTION)].map((m) => m[1].toLowerCase()))];
    if (!ids.length) return [];
    const rows = await tx
      .select({ id: workspaceMembers.userId })
      .from(workspaceMembers)
      .where(and(eq(workspaceMembers.workspaceId, actor.workspaceId), inArray(workspaceMembers.userId, ids)));
    return rows.map((r) => r.id);
  }

  /** Appends a message: takes the next seq under the conversation's row lock. */
  private async insert(tx: Tx, conversationId: string, values: Omit<typeof messages.$inferInsert, 'conversationId' | 'seq'>) {
    const top = !values.threadRootId;
    const [c] = await tx
      .update(conversations)
      .set({ lastSeq: sql`${conversations.lastSeq} + 1`, ...(top ? { lastMessageAt: sql`now()` } : {}) })
      .where(eq(conversations.id, conversationId))
      .returning({ seq: conversations.lastSeq });
    const [row] = await tx.insert(messages).values({ ...values, conversationId, seq: c.seq }).returning();
    return row;
  }

  private async system(tx: Tx, conversationId: string, actor: Actor, text: string) {
    const row = await this.insert(tx, conversationId, { senderId: actor.id, kind: 'system', body: text });
    // Published after commit by the caller's own "conversation changed" event; clients refetch the history.
    return row;
  }

  async send(actor: Actor, id: string, input: { body: string; threadRootId?: string | null }): Promise<ChatMessage> {
    const body = input.body.trim();
    if (!body) throw new BadRequestException('Message is empty');
    const { row, root } = await this.db.transaction(async (tx) => {
      const { conv } = await this.requireMember(actor, id, tx);
      let root: MsgRow | null = null;
      if (input.threadRootId) {
        [root] = await tx.select().from(messages).where(and(eq(messages.id, input.threadRootId), eq(messages.conversationId, conv.id)));
        if (!root || root.threadRootId || root.kind !== 'text') throw new NotFoundException('Thread not found');
      }
      const mentions = await this.mentionsIn(actor, body, tx);
      const row = await this.insert(tx, id, { senderId: actor.id, kind: 'text', body, mentions, threadRootId: root?.id ?? null });
      if (root) {
        [root] = await tx
          .update(messages)
          .set({ replyCount: sql`${messages.replyCount} + 1`, lastReplyAt: sql`now()` })
          .where(eq(messages.id, root.id))
          .returning();
      } else {
        // Your own message marks the conversation read up to it.
        await tx
          .update(conversationMembers)
          .set({ lastReadSeq: row.seq })
          .where(and(eq(conversationMembers.conversationId, id), eq(conversationMembers.userId, actor.id)));
      }
      return { row, root };
    });
    const members = await this.memberIds(id);
    const [msg, rootMsg] = await this.serialize(actor, root ? [row, root] : [row]);
    this.realtime.publish(members, { type: 'chat.message', conversationId: id, message: msg });
    if (rootMsg) this.realtime.publish(members, { type: 'chat.message.updated', conversationId: id, message: rootMsg });
    else this.realtime.publish([actor.id], { type: 'chat.read', conversationId: id, userId: actor.id, seq: row.seq });
    return msg;
  }

  async edit(actor: Actor, messageId: string, body: string) {
    const row = await this.message(messageId);
    await this.requireMember(actor, row.conversationId);
    if (row.senderId !== actor.id || row.kind !== 'text') throw new ForbiddenException('Only the sender can edit a message');
    if (row.deletedAt) throw new BadRequestException('The message was deleted');
    const text = body.trim();
    if (!text) throw new BadRequestException('Message is empty');
    const mentions = await this.mentionsIn(actor, text, this.db);
    const [next] = await this.db.update(messages).set({ body: text, mentions, editedAt: sql`now()` }).where(eq(messages.id, messageId)).returning();
    return this.publishUpdate(actor, next);
  }

  async remove(actor: Actor, messageId: string) {
    const row = await this.message(messageId);
    const { member } = await this.requireMember(actor, row.conversationId);
    if (row.kind !== 'text') throw new BadRequestException('System messages cannot be deleted');
    if (row.senderId !== actor.id && member.role === 'member') throw new ForbiddenException('Only the sender or an admin can delete a message');
    if (row.deletedAt) return;
    const [next] = await this.db.update(messages).set({ body: '', mentions: [], deletedAt: sql`now()` }).where(eq(messages.id, messageId)).returning();
    await this.db.delete(messageReactions).where(eq(messageReactions.messageId, messageId));
    await this.publishUpdate(actor, next);
  }

  async react(actor: Actor, messageId: string, emoji: string) {
    const row = await this.message(messageId);
    await this.requireMember(actor, row.conversationId);
    if (row.deletedAt || row.kind !== 'text') throw new BadRequestException('Cannot react to this message');
    const key = and(eq(messageReactions.messageId, messageId), eq(messageReactions.userId, actor.id), eq(messageReactions.emoji, emoji));
    const gone = await this.db.delete(messageReactions).where(key).returning();
    if (!gone.length) {
      const [{ n }] = await this.db.select({ n: sql<number>`count(DISTINCT ${messageReactions.emoji})::int` }).from(messageReactions).where(eq(messageReactions.messageId, messageId));
      if (n >= 20) throw new BadRequestException('Too many different reactions');
      await this.db.insert(messageReactions).values({ messageId, userId: actor.id, emoji }).onConflictDoNothing();
    }
    return this.publishUpdate(actor, row);
  }

  private async publishUpdate(actor: Actor, row: MsgRow) {
    const [msg] = await this.serialize(actor, [row]);
    this.realtime.publish(await this.memberIds(row.conversationId), { type: 'chat.message.updated', conversationId: row.conversationId, message: msg });
    return msg;
  }

  async read(actor: Actor, id: string, seq: number) {
    const { conv, member } = await this.requireMember(actor, id);
    const next = Math.min(Math.max(seq, 0), conv.lastSeq);
    if (next <= member.lastReadSeq) return { lastReadSeq: member.lastReadSeq };
    await this.db
      .update(conversationMembers)
      .set({ lastReadSeq: next })
      .where(and(eq(conversationMembers.conversationId, id), eq(conversationMembers.userId, actor.id)));
    this.realtime.publish(await this.memberIds(id), { type: 'chat.read', conversationId: id, userId: actor.id, seq: next });
    return { lastReadSeq: next };
  }

  /**
   * Reactions are per-viewer (`mine`), so every message is serialized for the caller. Realtime pushes reuse the
   * sender's view — clients recompute `mine` from the user lists they get (see web lib/chat.ts).
   */
  private async serialize(actor: Actor, rows: MsgRow[]): Promise<ChatMessage[]> {
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const [reactions, repliers] = await Promise.all([
      this.db
        .select({ messageId: messageReactions.messageId, emoji: messageReactions.emoji, userId: messageReactions.userId, name: users.name })
        .from(messageReactions)
        .innerJoin(users, eq(users.id, messageReactions.userId))
        .where(inArray(messageReactions.messageId, ids))
        .orderBy(asc(messageReactions.createdAt)),
      rows.some((r) => r.replyCount > 0)
        ? this.db
            .selectDistinctOn([messages.threadRootId, messages.senderId], { root: messages.threadRootId, senderId: messages.senderId })
            .from(messages)
            .where(inArray(messages.threadRootId, rows.filter((r) => r.replyCount > 0).map((r) => r.id)))
        : Promise.resolve([] as { root: string | null; senderId: string | null }[]),
    ]);
    const people = await loadUsers(this.db, [...rows.map((r) => r.senderId), ...repliers.map((r) => r.senderId)]);
    return rows.map((r) => {
      const mine = reactions.filter((x) => x.messageId === r.id);
      const grouped = new Map<string, { emoji: string; ids: string[]; names: string[] }>();
      for (const x of mine) {
        const g = grouped.get(x.emoji) ?? { emoji: x.emoji, ids: [], names: [] };
        g.ids.push(x.userId);
        g.names.push(x.name);
        grouped.set(x.emoji, g);
      }
      return {
        id: r.id,
        conversationId: r.conversationId,
        seq: r.seq,
        kind: r.kind,
        sender: r.senderId ? people.get(r.senderId) ?? null : null,
        body: r.deletedAt ? '' : r.body,
        mentions: r.mentions,
        threadRootId: r.threadRootId,
        replyCount: r.replyCount,
        lastReplyAt: r.lastReplyAt,
        repliers: repliers
          .filter((x) => x.root === r.id && x.senderId)
          .slice(0, 3)
          .map((x) => people.get(x.senderId!)!)
          .filter(Boolean),
        reactions: [...grouped.values()].map((g) => ({ emoji: g.emoji, count: g.ids.length, users: g.names.slice(0, 10), mine: g.ids.includes(actor.id), userIds: g.ids })),
        createdAt: r.createdAt,
        editedAt: r.editedAt,
        deletedAt: r.deletedAt,
      };
    });
  }
}
