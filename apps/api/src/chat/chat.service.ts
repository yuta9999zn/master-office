import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, type OnModuleInit } from '@nestjs/common';
import { swallow } from '../common/errors';
import { can, type ChannelCategory, type ChatAccessProblem, type ChatPerms, type ChatAttachment, type ChatFile, type ChatMessage, type ConversationDetail, type ConversationKind, type ConversationMember, type ConversationRole, type ConversationSummary, type Role, type UserSummary } from '@workos/shared';
import { and, asc, desc, eq, ilike, inArray, isNotNull, isNull, lt, sql } from 'drizzle-orm';
import type { Actor } from '../common/current-user';
import { loadUsers } from '../common/users';
import type { Db, Tx } from '../db/client';
import { InjectDb } from '../db/db.module';
import { aclEntries, channelCategories, conversationMembers, conversations, spaceMembers, spaces, messageReactions, messageRefs, messages, resources, users, workspaceMembers, resourceColumns } from '../db/schema';
import { EventsService } from '../events/events.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PermissionsService } from '../permissions/permissions.service';
import { RealtimeService } from '../realtime/realtime.service';

type Conv = typeof conversations.$inferSelect;
type MsgRow = typeof messages.$inferSelect;
type MemberRow = typeof conversationMembers.$inferSelect;
type ResourceRow = Omit<typeof resources.$inferSelect, 'contentText'>;

const MENTION = /<@([0-9a-f-]{36})>/gi;
/** Discord caps group DMs at 10 people; bigger conversations belong in a space's channel. */
const GROUP_LIMIT = 10;
const CHANNEL_COLORS = ['#2563eb', '#8b5cf6', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#14b8a6'];

export interface CreateConversationInput {
  kind: ConversationKind;
  userId?: string;
  name?: string | null;
  description?: string | null;
  visibility?: 'public' | 'private';
  memberIds?: string[];
  spaceId?: string | null;
  categoryId?: string | null;
  postPolicy?: 'all' | 'admins';
}

/**
 * Chat (docs/ARCHITECTURE.md §64, §68 — the Discord model). Spaces are the servers: every channel belongs to one,
 * grouped in categories; public channels are open to everyone who can see the space, private ones only to the
 * people added. What you may do follows your role in the space (viewer reads, commenter writes, editor attaches,
 * admin / owner manage). Direct and group messages (≤ 10 people) live at workspace level, outside any space.
 * Messages carry a per-conversation `seq`, so unread counts and read receipts are one integer per member.
 */
@Injectable()
export class ChatService implements OnModuleInit {
  private readonly log = new Logger('Chat');
  /** "may read" answers for typing signals, which arrive several times a second. */
  private readonly typingCache = new Map<string, { ok: boolean; at: number }>();

  constructor(
    @InjectDb() private readonly db: Db,
    private readonly realtime: RealtimeService,
    private readonly events: EventsService,
    private readonly perms: PermissionsService,
    private readonly notifications: NotificationsService,
  ) {}

  onModuleInit() {
    this.realtime.onClientMessage(async (actor, msg) => {
      if (msg.type !== 'typing' || typeof msg.conversationId !== 'string' || !/^[0-9a-f-]{36}$/i.test(msg.conversationId)) return;
      const key = `${actor.id}:${msg.conversationId}`;
      let hit = this.typingCache.get(key);
      if (!hit || Date.now() - hit.at > 60_000) {
        const ok = await this.access(actor, msg.conversationId).then((a) => a.perms.post, () => false);
        hit = { ok, at: Date.now() };
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

  /** The permission table of §68, for one person in one conversation. */
  private permsFor(conv: Conv, member: MemberRow | null, spaceRole: Role | null | undefined): ChatPerms {
    if (conv.kind !== 'channel') {
      const ok = !!member;
      return { post: ok, attach: ok, react: ok, moderate: false, manage: ok && (conv.kind === 'group' || false) };
    }
    const admin = can(spaceRole, 'admin') || member?.role === 'owner' || member?.role === 'admin';
    const write = can(spaceRole, 'commenter') && (conv.postPolicy === 'all' || admin);
    return { post: write, attach: write && can(spaceRole, 'editor'), react: can(spaceRole, 'commenter'), moderate: admin, manage: admin };
  }

  /**
   * Loads a conversation the actor may read. Channels: needs at least viewer on the space, and for a private channel
   * to be on it (space admins see every channel, as Discord administrators do). DMs and groups: members only.
   */
  private async access(actor: Actor, id: string, tx: Tx = this.db): Promise<{ conv: Conv; member: MemberRow | null; perms: ChatPerms; spaceRole: Role | null }> {
    const [conv] = await tx.select().from(conversations).where(eq(conversations.id, id));
    if (!conv || conv.workspaceId !== actor.workspaceId) throw new NotFoundException('Conversation not found');
    const [member] = await tx
      .select()
      .from(conversationMembers)
      .where(and(eq(conversationMembers.conversationId, id), eq(conversationMembers.userId, actor.id)));
    let spaceRole: Role | null = null;
    if (conv.kind === 'channel') {
      spaceRole = conv.spaceId ? (await this.perms.spaceRoles(actor, tx)).get(conv.spaceId) ?? null : null;
      const visible = can(spaceRole, 'viewer') && (conv.visibility === 'public' || !!member || can(spaceRole, 'admin'));
      if (!visible) throw new NotFoundException('Conversation not found');
    } else if (!member) throw new NotFoundException('Conversation not found');
    return { conv, member: member ?? null, perms: this.permsFor(conv, member ?? null, spaceRole), spaceRole };
  }

  /** Readable, and with a member row (public channels get one on first use — everyone in the space is "in" them). */
  private async requireMember(actor: Actor, id: string, tx: Tx = this.db) {
    const a = await this.access(actor, id, tx);
    if (a.member) return a as typeof a & { member: MemberRow };
    if (a.conv.kind === 'channel' && a.conv.visibility === 'public') {
      const [member] = await tx.insert(conversationMembers).values({ conversationId: id, userId: actor.id, lastReadSeq: a.conv.lastSeq }).onConflictDoNothing().returning();
      const row = member ?? (await tx.select().from(conversationMembers).where(and(eq(conversationMembers.conversationId, id), eq(conversationMembers.userId, actor.id))))[0];
      return { ...a, member: row, perms: this.permsFor(a.conv, row, a.spaceRole) };
    }
    throw new ForbiddenException('You are not in this channel');
  }

  private async need(actor: Actor, id: string, what: keyof ChatPerms, message: string, tx: Tx = this.db) {
    const a = await this.requireMember(actor, id, tx);
    if (!a.perms[what]) throw new ForbiddenException(message);
    return a;
  }

  /** For Meetings (§73): what a conversation is to this person, or null when they cannot read it. */
  async peek(actor: Actor, id: string): Promise<{ kind: ConversationKind; title: string; canPost: boolean; memberIds: string[] } | null> {
    const a = await this.access(actor, id).catch(() => null);
    if (!a) return null;
    const title = a.conv.kind === 'channel' ? `#${a.conv.name}` : (await this.summaries(actor, id))[0]?.title ?? 'Conversation';
    return { kind: a.conv.kind, title, canPost: a.perms.post, memberIds: await this.memberIds(id) };
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

  /** People who can see a space (for adding them to its private channels). */
  private async spaceViewers(actor: Actor, spaceId: string, ids: string[], tx: Tx = this.db) {
    const out: string[] = [];
    for (const id of ids) {
      const role = (await this.perms.spaceRoles({ id, name: '', workspaceId: actor.workspaceId }, tx)).get(spaceId);
      if (!can(role, 'viewer')) throw new BadRequestException('Only people in this space can join its channels');
      out.push(id);
    }
    return out;
  }

  // ── Conversations ─────────────────────────────────────────────────────────

  /**
   * Your conversations: DMs and groups you are in, plus every channel you can see — public channels of your spaces
   * get a member row on the way (caught up, nothing unread), the way a Discord server shows all its channels.
   */
  async list(actor: Actor): Promise<ConversationSummary[]> {
    const roles = await this.perms.spaceRoles(actor);
    const visibleSpaces = [...roles].filter(([, r]) => can(r, 'viewer')).map(([id]) => id);
    if (visibleSpaces.length) {
      const open = await this.db
        .select({ id: conversations.id, lastSeq: conversations.lastSeq })
        .from(conversations)
        .where(
          and(
            eq(conversations.kind, 'channel'),
            eq(conversations.visibility, 'public'),
            inArray(conversations.spaceId, visibleSpaces),
            sql`NOT EXISTS (SELECT 1 FROM conversation_members m WHERE m.conversation_id = ${conversations.id} AND m.user_id = ${actor.id})`,
          ),
        );
      if (open.length) await this.db.insert(conversationMembers).values(open.map((c) => ({ conversationId: c.id, userId: actor.id, lastReadSeq: c.lastSeq }))).onConflictDoNothing();
    }
    const rows = (await this.summaries(actor)).filter((c) => c.kind !== 'channel' || (c.spaceId && can(roles.get(c.spaceId), 'viewer')));
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
      category_id: string | null;
      position: number;
      post_policy: 'all' | 'admins';
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
      lm_files: string | null;
    }>(sql`
      SELECT c.id, c.kind, c.name, c.description, c.visibility, c.color, c.space_id, c.category_id, c.position, c.post_policy, c.last_seq, c.last_message_at,
             m.role, m.last_read_seq, m.pinned, m.muted,
             (SELECT count(*) FROM messages x WHERE x.conversation_id = c.id AND x.seq > m.last_read_seq AND x.thread_root_id IS NULL
                AND x.deleted_at IS NULL AND x.kind = 'text' AND x.sender_id IS DISTINCT FROM ${actor.id}) AS unread,
             (SELECT count(*) FROM messages x WHERE x.conversation_id = c.id AND x.seq > m.last_read_seq AND x.thread_root_id IS NULL
                AND x.deleted_at IS NULL AND ${actor.id}::uuid = ANY(x.mentions)) AS mentions,
             lm.body AS lm_body, lm.kind AS lm_kind, lm.sender_id AS lm_sender, lm.created_at AS lm_at, lm.deleted_at AS lm_deleted,
             (SELECT count(*) FROM message_refs r WHERE r.message_id = lm.id) AS lm_files
      FROM conversation_members m
      JOIN conversations c ON c.id = m.conversation_id
      LEFT JOIN LATERAL (
        SELECT x.id, x.body, x.kind, x.sender_id, x.created_at, x.deleted_at FROM messages x
        WHERE x.conversation_id = c.id AND x.thread_root_id IS NULL ORDER BY x.seq DESC LIMIT 1
      ) lm ON true
      WHERE m.user_id = ${actor.id} ${only ? sql`AND c.id = ${only}` : sql``}`);
    const rows = res.rows;
    if (!rows.length) return [];
    const [members, roles] = await Promise.all([
      this.db
        .select({ conversationId: conversationMembers.conversationId, userId: conversationMembers.userId })
        .from(conversationMembers)
        .where(inArray(conversationMembers.conversationId, rows.map((r) => r.id)))
        .orderBy(asc(conversationMembers.joinedAt), asc(conversationMembers.userId)),
      this.perms.spaceRoles(actor),
    ]);
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
      const conv = { kind: r.kind, postPolicy: r.post_policy } as Conv;
      return {
        id: r.id,
        kind: r.kind,
        title: this.title(r.kind, r.name, peer, faces, actor),
        description: r.description,
        visibility: r.visibility,
        color: r.color,
        spaceId: r.space_id,
        categoryId: r.category_id,
        position: r.position,
        postPolicy: r.post_policy,
        perms: this.permsFor(conv, { role: r.role } as MemberRow, r.space_id ? roles.get(r.space_id) : null),
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
              files: r.lm_deleted ? 0 : Number(r.lm_files ?? 0),
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
    const a = await this.access(actor, id);
    if (!a.member && a.conv.visibility === 'public') await this.requireMember(actor, id);
    const { conv } = a;
    const rows = await this.db.select().from(conversationMembers).where(eq(conversationMembers.conversationId, id)).orderBy(asc(conversationMembers.joinedAt));
    const people = await loadUsers(this.db, [...rows.map((r) => r.userId), conv.createdBy]);
    const members: ConversationMember[] = rows
      .filter((r) => people.has(r.userId))
      .map((r) => ({ ...people.get(r.userId)!, role: r.role, lastReadSeq: r.lastReadSeq, joinedAt: r.joinedAt }));
    const [summary] = await this.summaries(actor, id);
    if (summary) return { ...summary, members, createdAt: conv.createdAt, createdBy: conv.createdBy ? people.get(conv.createdBy) ?? null : null, joined: true };
    // A space admin looking into a private channel they are not on.
    return {
      id,
      kind: conv.kind,
      title: conv.name ?? 'Channel',
      description: conv.description,
      visibility: conv.visibility,
      color: conv.color,
      spaceId: conv.spaceId,
      categoryId: conv.categoryId,
      position: conv.position,
      postPolicy: conv.postPolicy,
      perms: { ...a.perms, post: false, attach: false, react: false },
      peer: null,
      faces: members.slice(0, 3),
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
      members,
      createdAt: conv.createdAt,
      createdBy: conv.createdBy ? people.get(conv.createdBy) ?? null : null,
      joined: false,
    };
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

    if (input.kind === 'group') {
      const others = await this.workspaceUsers(actor, (input.memberIds ?? []).filter((x) => x !== actor.id));
      if (!others.length) throw new BadRequestException('Add at least one person');
      if (others.length + 1 > GROUP_LIMIT) throw new BadRequestException(`A group message has at most ${GROUP_LIMIT} people — make a channel in a space for more`);
      const id = await this.db.transaction(async (tx) => {
        const [c] = await tx.insert(conversations).values({ workspaceId: actor.workspaceId, kind: 'group', name: input.name?.trim() || null, createdBy: actor.id }).returning();
        await tx.insert(conversationMembers).values([
          { conversationId: c.id, userId: actor.id, role: 'owner' as const },
          ...others.map((userId) => ({ conversationId: c.id, userId, role: 'member' as const })),
        ]);
        await this.system(tx, c.id, actor, 'created the group');
        return c.id;
      });
      this.realtime.publish([actor.id, ...others], { type: 'chat.conversation', conversationId: id });
      return { id, created: true };
    }

    // Channels: in a space, created by its admins (Discord "Manage Channels").
    if (!input.spaceId) throw new BadRequestException('A channel belongs to a space');
    if (!input.name?.trim()) throw new BadRequestException('A channel needs a name');
    const spaceRole = await this.perms.requireSpace(actor, input.spaceId, 'viewer');
    if (!can(spaceRole, 'admin')) throw new ForbiddenException('Only space admins create channels');
    if (input.categoryId) await this.category(input.spaceId, input.categoryId);
    const visibility = input.visibility ?? 'public';
    const privateMembers = visibility === 'private' ? await this.spaceViewers(actor, input.spaceId, (input.memberIds ?? []).filter((x) => x !== actor.id)) : [];
    const everyone = visibility === 'public' ? await this.spaceMemberIds(input.spaceId) : [];
    const id = await this.db.transaction(async (tx) => {
      const [{ max }] = await tx.select({ max: sql<number>`coalesce(max(${conversations.position}), -1)::int` }).from(conversations).where(eq(conversations.spaceId, input.spaceId!));
      const [c] = await tx
        .insert(conversations)
        .values({
          workspaceId: actor.workspaceId,
          kind: 'channel',
          name: input.name!.trim(),
          description: input.description?.trim() || null,
          visibility,
          spaceId: input.spaceId,
          categoryId: input.categoryId ?? null,
          position: max + 1,
          postPolicy: input.postPolicy ?? 'all',
          color: CHANNEL_COLORS[Math.floor(Math.random() * CHANNEL_COLORS.length)],
          createdBy: actor.id,
        })
        .returning();
      const ids = [...new Set([actor.id, ...privateMembers, ...everyone])];
      await tx.insert(conversationMembers).values(ids.map((userId) => ({ conversationId: c.id, userId, role: userId === actor.id ? ('owner' as const) : ('member' as const) })));
      await this.system(tx, c.id, actor, `created the channel ${c.name}`);
      await this.events.emit(tx, actor, 'chat.conversation_created', { spaceId: input.spaceId }, { conversationId: c.id, kind: 'channel', name: c.name });
      return { id: c.id, ids };
    });
    this.realtime.publish(id.ids, { type: 'chat.conversation', conversationId: id.id });
    return { id: id.id, created: true };
  }

  /** People explicitly in a space (its "server members"). */
  private async spaceMemberIds(spaceId: string, tx: Tx = this.db) {
    const rows = await tx.select({ id: spaceMembers.userId }).from(spaceMembers).where(eq(spaceMembers.spaceId, spaceId));
    return rows.map((r) => r.id);
  }

  async update(
    actor: Actor,
    id: string,
    input: { name?: string | null; description?: string | null; visibility?: 'public' | 'private'; postPolicy?: 'all' | 'admins'; categoryId?: string | null; position?: number },
  ) {
    const { conv, perms } = await this.requireMember(actor, id);
    if (conv.kind === 'dm') throw new BadRequestException('Direct messages have no settings');
    if (!perms.manage) throw new ForbiddenException('Only channel or space admins can change its settings');
    if (conv.kind === 'channel' && input.name !== undefined && !input.name?.trim()) throw new BadRequestException('A channel needs a name');
    if (conv.kind === 'channel' && input.categoryId) await this.category(conv.spaceId!, input.categoryId);
    await this.db.transaction(async (tx) => {
      const set: Partial<Conv> = {};
      if (input.name !== undefined) set.name = input.name?.trim() || null;
      if (input.description !== undefined) set.description = input.description?.trim() || null;
      if (conv.kind === 'channel') {
        if (input.visibility !== undefined) set.visibility = input.visibility;
        if (input.postPolicy !== undefined) set.postPolicy = input.postPolicy;
        if (input.categoryId !== undefined) set.categoryId = input.categoryId;
        if (input.position !== undefined) set.position = input.position;
      }
      if (!Object.keys(set).length) return;
      await tx.update(conversations).set(set).where(eq(conversations.id, id));
      if (set.name !== undefined && set.name !== conv.name) await this.system(tx, id, actor, set.name ? `renamed the conversation to ${set.name}` : 'removed the conversation name');
      if (set.visibility && set.visibility !== conv.visibility) {
        await this.system(tx, id, actor, `made the channel ${set.visibility}`);
        // Public again: everyone in the space is in it.
        if (set.visibility === 'public') {
          const everyone = await this.spaceMemberIds(conv.spaceId!, tx);
          if (everyone.length) await tx.insert(conversationMembers).values(everyone.map((userId) => ({ conversationId: id, userId, lastReadSeq: conv.lastSeq }))).onConflictDoNothing();
        }
      }
      if (set.postPolicy && set.postPolicy !== conv.postPolicy) await this.system(tx, id, actor, set.postPolicy === 'admins' ? 'made this an announcement channel' : 'let everyone post again');
    });
    await this.syncFolderAccess(id).catch(() => undefined);
    this.realtime.publish(await this.memberIds(id), { type: 'chat.conversation', conversationId: id });
  }

  async addMembers(actor: Actor, id: string, userIds: string[]) {
    const { conv, perms } = await this.requireMember(actor, id);
    if (conv.kind === 'dm') throw new BadRequestException('Start a group to add more people to a direct message');
    if (conv.kind === 'channel' && conv.visibility === 'public') throw new BadRequestException('Everyone in the space is already in a public channel');
    if (conv.kind === 'channel' && !perms.manage) throw new ForbiddenException('Only channel or space admins add people to a private channel');
    const current = new Set(await this.memberIds(id));
    const candidates = (await this.workspaceUsers(actor, userIds)).filter((u) => !current.has(u));
    const add = conv.kind === 'channel' ? await this.spaceViewers(actor, conv.spaceId!, candidates) : candidates;
    if (!add.length) return { added: 0 };
    if (conv.kind === 'group' && current.size + add.length > GROUP_LIMIT) throw new BadRequestException(`A group message has at most ${GROUP_LIMIT} people`);
    const people = await loadUsers(this.db, add);
    await this.db.transaction(async (tx) => {
      // New members start "caught up": history is visible, but not counted as unread.
      await tx.insert(conversationMembers).values(add.map((userId) => ({ conversationId: id, userId, lastReadSeq: conv.lastSeq })));
      await this.system(tx, id, actor, `added ${add.map((u) => people.get(u)!.name).join(', ')}`);
    });
    await this.syncFolderAccess(id).catch(() => undefined);
    this.realtime.publish([...current, ...add], { type: 'chat.conversation', conversationId: id });
    return { added: add.length };
  }

  async removeMember(actor: Actor, id: string, userId: string) {
    const { conv, member, perms } = await this.requireMember(actor, id);
    if (conv.kind === 'dm') throw new BadRequestException('You cannot leave a direct message');
    // Like a Discord server: you are in its public channels while you are in the space — mute one instead.
    if (conv.kind === 'channel' && conv.visibility === 'public') throw new BadRequestException('Public channels include everyone in the space — mute it instead');
    const self = userId === actor.id;
    if (!self && !(perms.manage && (conv.kind === 'channel' || member.role !== 'member'))) throw new ForbiddenException('Only admins can remove people');
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
    await this.syncFolderAccess(id).catch(() => undefined);
    this.realtime.publish(before, { type: 'chat.conversation', conversationId: id });
    this.realtime.publish([userId], { type: 'chat.conversation', conversationId: id, removed: true });
  }

  async setRole(actor: Actor, id: string, userId: string, role: 'admin' | 'member') {
    const { conv, perms } = await this.requireMember(actor, id);
    if (conv.kind !== 'channel') throw new BadRequestException('Only channels have admins');
    if (!perms.manage) throw new ForbiddenException('Only admins can change roles');
    const [target] = await this.db.select().from(conversationMembers).where(and(eq(conversationMembers.conversationId, id), eq(conversationMembers.userId, userId)));
    if (!target) throw new NotFoundException('Not a member');
    if (target.role === 'owner') throw new BadRequestException('The owner keeps full control');
    await this.db.update(conversationMembers).set({ role }).where(and(eq(conversationMembers.conversationId, id), eq(conversationMembers.userId, userId)));
    this.realtime.publish(await this.memberIds(id), { type: 'chat.conversation', conversationId: id });
  }

  /** Opening a public channel you can see (the member row is what holds your read marker). */
  async join(actor: Actor, id: string) {
    await this.requireMember(actor, id);
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

  /**
   * Keeps chat in step with space membership (called by SpacesService): joining a space puts you in its public
   * channels; leaving it takes you out of every channel you can no longer see, and out of their file folders.
   */
  async spaceMembershipChanged(workspaceId: string, spaceId: string, userId: string) {
    const who = { id: userId, name: '', workspaceId };
    const role = (await this.perms.spaceRoles(who)).get(spaceId);
    const channels = await this.db.select().from(conversations).where(and(eq(conversations.spaceId, spaceId), eq(conversations.kind, 'channel')));
    if (!channels.length) return;
    const explicit = (await this.spaceMemberIds(spaceId)).includes(userId);
    const touched: string[] = [];
    for (const c of channels) {
      const stay = can(role, 'viewer') && (c.visibility === 'public' ? true : explicit || can(role, 'admin'));
      if (!stay) {
        const gone = await this.db.delete(conversationMembers).where(and(eq(conversationMembers.conversationId, c.id), eq(conversationMembers.userId, userId))).returning();
        if (gone.length) touched.push(c.id);
      } else if (c.visibility === 'public' && explicit) {
        const added = await this.db.insert(conversationMembers).values({ conversationId: c.id, userId, lastReadSeq: c.lastSeq }).onConflictDoNothing().returning();
        if (added.length) touched.push(c.id);
      }
    }
    // A role change alone can turn upload rights on or off in private channel folders.
    for (const c of channels) if (!touched.includes(c.id)) await this.syncFolderAccess(c.id).catch(() => undefined);
    for (const id of touched) {
      await this.syncFolderAccess(id).catch(() => undefined);
      this.realtime.publish([userId, ...(await this.memberIds(id))], { type: 'chat.conversation', conversationId: id });
    }
  }

  // ── Categories ────────────────────────────────────────────────────────────

  private async category(spaceId: string, id: string) {
    const [c] = await this.db.select().from(channelCategories).where(and(eq(channelCategories.id, id), eq(channelCategories.spaceId, spaceId)));
    if (!c) throw new BadRequestException('Category not found in this space');
    return c;
  }

  async categories(actor: Actor, spaceId: string): Promise<ChannelCategory[]> {
    await this.perms.requireSpace(actor, spaceId, 'viewer');
    return this.db
      .select({ id: channelCategories.id, spaceId: channelCategories.spaceId, name: channelCategories.name, position: channelCategories.position })
      .from(channelCategories)
      .where(eq(channelCategories.spaceId, spaceId))
      .orderBy(asc(channelCategories.position), asc(channelCategories.createdAt));
  }

  private async requireSpaceAdmin(actor: Actor, spaceId: string) {
    const role = await this.perms.requireSpace(actor, spaceId, 'viewer');
    if (!can(role, 'admin')) throw new ForbiddenException('Only space admins manage channels and categories');
  }

  async createCategory(actor: Actor, spaceId: string, name: string) {
    await this.requireSpaceAdmin(actor, spaceId);
    const [{ max }] = await this.db.select({ max: sql<number>`coalesce(max(${channelCategories.position}), -1)::int` }).from(channelCategories).where(eq(channelCategories.spaceId, spaceId));
    const [c] = await this.db.insert(channelCategories).values({ spaceId, name: name.trim(), position: max + 1 }).returning();
    await this.notifySpace(spaceId);
    return { id: c.id, spaceId, name: c.name, position: c.position };
  }

  async updateCategory(actor: Actor, id: string, input: { name?: string; position?: number }) {
    const [c] = await this.db.select().from(channelCategories).where(eq(channelCategories.id, id));
    if (!c) throw new NotFoundException('Category not found');
    await this.requireSpaceAdmin(actor, c.spaceId);
    await this.db
      .update(channelCategories)
      .set({ ...(input.name !== undefined ? { name: input.name.trim() } : {}), ...(input.position !== undefined ? { position: input.position } : {}) })
      .where(eq(channelCategories.id, id));
    await this.notifySpace(c.spaceId);
  }

  /** Deleting a category keeps its channels (they move to the top, uncategorised). */
  async deleteCategory(actor: Actor, id: string) {
    const [c] = await this.db.select().from(channelCategories).where(eq(channelCategories.id, id));
    if (!c) throw new NotFoundException('Category not found');
    await this.requireSpaceAdmin(actor, c.spaceId);
    await this.db.delete(channelCategories).where(eq(channelCategories.id, id));
    await this.notifySpace(c.spaceId);
  }

  private async notifySpace(spaceId: string) {
    const ids = await this.db
      .selectDistinct({ id: conversationMembers.userId })
      .from(conversationMembers)
      .innerJoin(conversations, eq(conversations.id, conversationMembers.conversationId))
      .where(eq(conversations.spaceId, spaceId));
    this.realtime.publish(ids.map((r) => r.id), { type: 'chat.categories', spaceId });
  }

  // ── File folders ──────────────────────────────────────────────────────────

  /**
   * Where files sent in a conversation live (§68): a channel's folder "Chat files / #channel" inside its space
   * (a private channel's folder is restricted to the channel's members); a DM's or group's folder under the
   * creator's "Chat files", shared with the people in it. Created on the first upload.
   */
  async uploadFolder(actor: Actor, id: string): Promise<{ id: string }> {
    const { conv } = await this.need(actor, id, 'attach', 'You cannot send files here');
    const [found] = await this.db
      .select({ id: resources.id })
      .from(resources)
      .where(and(eq(resources.workspaceId, actor.workspaceId), isNull(resources.trashedAt), sql`${resources.metadata}->>'chatConversation' = ${id}`))
      .limit(1);
    if (found) {
      await this.syncFolderAccess(id);
      return found;
    }
    const root = await this.chatRoot(actor, conv.spaceId);
    // Channel folders belong to the space's owner, not to whoever uploaded first — leaving the channel must take
    // the files away too. DM and group folders belong to the person who started the conversation.
    const owner = conv.spaceId ? await this.spaceOwner(conv.spaceId, actor.id) : conv.createdBy ?? actor.id;
    const [row] = await this.db
      .insert(resources)
      .values({
        workspaceId: actor.workspaceId,
        spaceId: conv.spaceId,
        parentId: root.id,
        path: [...root.path, root.id],
        name: conv.kind === 'channel' ? `#${conv.name}` : (await this.summaries(actor, id))[0]?.title ?? 'Conversation',
        type: 'folder',
        ownerId: owner,
        updatedBy: actor.id,
        metadata: { chatConversation: id, ...(conv.kind !== 'channel' || conv.visibility === 'private' ? { restricted: true } : {}) },
        description: 'Files sent in this conversation',
      })
      .returning({ id: resources.id });
    await this.syncFolderAccess(id);
    return row;
  }

  private async spaceOwner(spaceId: string, fallback: string) {
    const [sp] = await this.db.select({ createdBy: spaces.createdBy }).from(spaces).where(eq(spaces.id, spaceId));
    return sp?.createdBy ?? fallback;
  }

  /** "Chat files" at the root of the space (or of the sender's My Files for DMs and groups). */
  private async chatRoot(actor: Actor, spaceId: string | null) {
    const where = and(
      eq(resources.workspaceId, actor.workspaceId),
      isNull(resources.parentId),
      spaceId ? eq(resources.spaceId, spaceId) : and(isNull(resources.spaceId), eq(resources.ownerId, actor.id)),
      eq(resources.type, 'folder'),
      isNull(resources.trashedAt),
      sql`${resources.metadata}->>'chatFiles' = 'true'`,
    );
    const [found] = await this.db.select({ id: resources.id, path: resources.path }).from(resources).where(where).limit(1);
    if (found) return found;
    const [row] = await this.db
      .insert(resources)
      .values({ workspaceId: actor.workspaceId, spaceId, name: 'Chat files', type: 'folder', ownerId: spaceId ? await this.spaceOwner(spaceId, actor.id) : actor.id, updatedBy: actor.id, metadata: { chatFiles: true }, description: 'Files sent in Chat' })
      .returning({ id: resources.id, path: resources.path });
    return row;
  }

  /**
   * Access to a restricted conversation folder is exactly its members: editors (may upload) are the people who
   * can attach files, everyone else views. Public channel folders need nothing — the space's roles apply.
   */
  private async syncFolderAccess(conversationId: string) {
    const [folder] = await this.db.select(resourceColumns).from(resources).where(sql`${resources.metadata}->>'chatConversation' = ${conversationId}`).limit(1);
    if (!folder || (folder.metadata as Record<string, unknown>).restricted !== true) return;
    const [conv] = await this.db.select().from(conversations).where(eq(conversations.id, conversationId));
    const members = await this.db.select().from(conversationMembers).where(eq(conversationMembers.conversationId, conversationId));
    // A DM / group folder whose owner left the conversation passes to someone still in it.
    if (!conv.spaceId && members.length && !members.some((m) => m.userId === folder.ownerId)) {
      const next = members.find((m) => m.role === 'owner') ?? members[0];
      await this.db.update(resources).set({ ownerId: next.userId }).where(eq(resources.id, folder.id));
      folder.ownerId = next.userId;
    }
    const want = new Map<string, Role>();
    // Every member gets an entry, the folder owner too: owning a folder does not open the files others put in it.
    for (const m of members) {
      const spaceRole = conv.spaceId ? (await this.perms.spaceRoles({ id: m.userId, name: '', workspaceId: conv.workspaceId })).get(conv.spaceId) : null;
      want.set(m.userId, this.permsFor(conv, m, spaceRole).attach ? 'editor' : 'viewer');
    }
    const current = await this.db
      .select()
      .from(aclEntries)
      .where(and(eq(aclEntries.resourceId, folder.id), eq(aclEntries.principalType, 'user')));
    for (const a of current) if (!want.has(a.principalId)) await this.db.delete(aclEntries).where(and(eq(aclEntries.resourceId, folder.id), eq(aclEntries.principalType, 'user'), eq(aclEntries.principalId, a.principalId)));
    for (const [userId, role] of want)
      await this.db
        .insert(aclEntries)
        .values({ resourceId: folder.id, principalType: 'user', principalId: userId, role, createdBy: folder.ownerId })
        .onConflictDoUpdate({ target: [aclEntries.resourceId, aclEntries.principalType, aclEntries.principalId], set: { role } });
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
    await this.notifications.readMessages(actor, sql`SELECT id FROM messages WHERE id = ${messageId} OR thread_root_id = ${messageId}`);
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

  /** Links in the text that point at files of this workspace (any URL containing a resource id). */
  private linkedIds(body: string) {
    const ids = new Set<string>();
    for (const url of body.match(/https?:\/\/[^\s<>]+/gi) ?? []) for (const m of url.matchAll(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi)) ids.add(m[0].toLowerCase());
    return [...ids];
  }

  /**
   * The files a message will point at: picked attachments (must be viewable by the sender) and links to files the
   * sender can open (others are ignored — a link to something you cannot see is just text).
   */
  private async refsFor(actor: Actor, attachmentIds: string[], body: string, tx: Tx) {
    const attach = [...new Set(attachmentIds.map((x) => x.toLowerCase()))];
    const links = this.linkedIds(body).filter((x) => !attach.includes(x));
    const all = [...attach, ...links];
    if (!all.length) return [];
    if (all.length > 10) throw new BadRequestException('A message can carry at most 10 files');
    const rows = await tx.select(resourceColumns).from(resources).where(and(inArray(resources.id, all), eq(resources.workspaceId, actor.workspaceId)));
    const roles = await this.perms.rolesFor(actor, rows, tx);
    const byId = new Map(rows.map((r) => [r.id, r]));
    const out: { row: ResourceRow; source: 'attachment' | 'link' }[] = [];
    for (const id of attach) {
      const row = byId.get(id);
      if (!row || row.trashedAt || !can(roles.get(id), 'viewer')) throw new NotFoundException('File not found');
      out.push({ row, source: 'attachment' });
    }
    for (const id of links) {
      const row = byId.get(id);
      if (row && !row.trashedAt && can(roles.get(id), 'viewer')) out.push({ row, source: 'link' });
    }
    return out;
  }

  /** Members (other than the sender) who cannot open each file. */
  private async missingAccess(actor: Actor, memberIds: string[], refs: { row: ResourceRow }[], tx: Tx) {
    const others = memberIds.filter((m) => m !== actor.id);
    const missing = new Map<string, string[]>();
    for (const userId of others) {
      const roles = await this.perms.rolesFor({ id: userId, name: '', workspaceId: actor.workspaceId }, refs.map((r) => r.row), tx);
      for (const r of refs) if (!can(roles.get(r.row.id), 'viewer')) missing.set(r.row.id, [...(missing.get(r.row.id) ?? []), userId]);
    }
    return missing;
  }

  async send(actor: Actor, id: string, input: { body: string; threadRootId?: string | null; resourceIds?: string[]; grant?: 'viewer' | 'commenter' | 'editor' | 'none' }): Promise<ChatMessage> {
    const body = input.body.trim();
    if (!body && !input.resourceIds?.length) throw new BadRequestException('Message is empty');
    // Files open with each person's own access (read → view, edit → edit); chat never hands out access (§68).
    if (input.grant && input.grant !== 'none') throw new BadRequestException('Chat does not share files — people open them with their own access');
    const { row, root } = await this.db.transaction(async (tx) => {
      const { conv, perms } = await this.need(actor, id, 'post', 'You cannot post in this channel', tx);
      if (input.resourceIds?.length && !perms.attach) throw new ForbiddenException('You cannot send files here');
      let root: MsgRow | null = null;
      if (input.threadRootId) {
        [root] = await tx.select().from(messages).where(and(eq(messages.id, input.threadRootId), eq(messages.conversationId, conv.id)));
        if (!root || root.threadRootId || root.kind !== 'text') throw new NotFoundException('Thread not found');
      }
      const refs = await this.refsFor(actor, input.resourceIds ?? [], body, tx);
      if (refs.length) {
        // Sharing in chat never copies a file: people who cannot open it get access, or the sender sends anyway (§6.4).
        const missing = await this.missingAccess(actor, await this.memberIds(id, tx), refs, tx);
        if (missing.size && input.grant !== 'none') {
          const people = await loadUsers(tx, [...missing.values()].flat());
          const problem: ChatAccessProblem = {
            code: 'needs_access',
            message: 'Some people in this conversation cannot open a file — they will see it locked',
            missing: refs
              .filter((r) => missing.has(r.row.id))
              .map((r) => ({ resourceId: r.row.id, name: r.row.name, users: missing.get(r.row.id)!.map((u) => ({ id: u, name: people.get(u)?.name ?? 'Someone' })) })),
          };
          throw new ConflictException(problem);
        }
      }
      const mentions = await this.mentionsIn(actor, body, tx);
      const row = await this.insert(tx, id, { senderId: actor.id, kind: 'text', body, mentions, threadRootId: root?.id ?? null });
      if (refs.length) await tx.insert(messageRefs).values(refs.map((r, position) => ({ messageId: row.id, resourceId: r.row.id, position, source: r.source })));
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
    await this.publishRows(actor, members, 'chat.message', [row]);
    await this.notifyMessage(actor, id, row, root, members).catch(swallow(this.log, `notify for message ${row.id}`));
    if (root) await this.publishRows(actor, members, 'chat.message.updated', [root]);
    else this.realtime.publish([actor.id], { type: 'chat.read', conversationId: id, userId: actor.id, seq: row.seq });
    return (await this.serialize(actor, [row]))[0];
  }

  /** Bell entries for a new message: people mentioned, and people taking part in the thread it replies to. */
  private async notifyMessage(actor: Actor, conversationId: string, row: MsgRow, root: MsgRow | null, members: string[]) {
    const [conv] = await this.db.select().from(conversations).where(eq(conversations.id, conversationId));
    const where = conv.kind === 'channel' ? `#${conv.name}` : conv.kind === 'group' ? conv.name ?? 'a group' : 'a direct message';
    const people = await loadUsers(this.db, row.mentions);
    const text = row.body.replace(MENTION, (_m, uid: string) => `@${people.get(uid.toLowerCase())?.name ?? 'someone'}`).replace(/\s+/g, ' ').trim();
    const url = `/chat/${conversationId}${root ? `?thread=${root.id}` : ''}`;
    const inConv = new Set(members);
    // Mentions reach whoever can read the conversation — in a public channel that is the whole space, opened yet or not.
    const mentioned: string[] = [];
    for (const u of row.mentions) {
      if (inConv.has(u)) mentioned.push(u);
      else if (conv.kind === 'channel' && (await this.access({ id: u, name: '', workspaceId: actor.workspaceId }, conversationId).then(() => true, () => false))) mentioned.push(u);
    }
    await this.notifications.notify(actor, mentioned, { kind: 'chat.mention', title: `${actor.name} mentioned you in ${where}`, body: text || null, url, conversationId, messageId: row.id });
    if (root) {
      const repliers = await this.db.selectDistinct({ id: messages.senderId }).from(messages).where(eq(messages.threadRootId, root.id));
      const followers = [root.senderId, ...repliers.map((r) => r.id)].filter((u): u is string => !!u && inConv.has(u) && !mentioned.includes(u));
      await this.notifications.notify(actor, followers, { kind: 'chat.reply', title: `${actor.name} replied to a thread in ${where}`, body: text || (row.mentions.length ? null : '📎 File'), url, conversationId, messageId: row.id });
    }
  }

  async edit(actor: Actor, messageId: string, body: string) {
    const row = await this.message(messageId);
    await this.requireMember(actor, row.conversationId);
    if (row.senderId !== actor.id || row.kind !== 'text') throw new ForbiddenException('Only the sender can edit a message');
    if (row.deletedAt) throw new BadRequestException('The message was deleted');
    const text = body.trim();
    const attached = await this.db.select({ id: messageRefs.resourceId }).from(messageRefs).where(and(eq(messageRefs.messageId, messageId), eq(messageRefs.source, 'attachment')));
    if (!text && !attached.length) throw new BadRequestException('Message is empty');
    const next = await this.db.transaction(async (tx) => {
      const mentions = await this.mentionsIn(actor, text, tx);
      // Links are re-read from the new text; attachments stay.
      await tx.delete(messageRefs).where(and(eq(messageRefs.messageId, messageId), eq(messageRefs.source, 'link')));
      const links = (await this.refsFor(actor, [], text, tx)).filter((r) => !attached.some((a) => a.id === r.row.id));
      if (links.length) await tx.insert(messageRefs).values(links.map((r, i) => ({ messageId, resourceId: r.row.id, position: attached.length + i, source: 'link' as const })));
      const [n] = await tx.update(messages).set({ body: text, mentions, editedAt: sql`now()` }).where(eq(messages.id, messageId)).returning();
      return n;
    });
    return this.publishUpdate(actor, next);
  }

  async remove(actor: Actor, messageId: string) {
    const row = await this.message(messageId);
    const { perms } = await this.requireMember(actor, row.conversationId);
    if (row.kind !== 'text') throw new BadRequestException('System messages cannot be deleted');
    if (row.senderId !== actor.id && !perms.moderate) throw new ForbiddenException('Only the sender or an admin can delete a message');
    if (row.deletedAt) return;
    const [next] = await this.db.update(messages).set({ body: '', mentions: [], deletedAt: sql`now()`, pinnedAt: null, pinnedBy: null }).where(eq(messages.id, messageId)).returning();
    await this.db.delete(messageReactions).where(eq(messageReactions.messageId, messageId));
    // The files themselves stay in Drive; the message just stops pointing at them.
    await this.db.delete(messageRefs).where(eq(messageRefs.messageId, messageId));
    await this.publishUpdate(actor, next);
  }

  async react(actor: Actor, messageId: string, emoji: string) {
    const row = await this.message(messageId);
    await this.need(actor, row.conversationId, 'react', 'You cannot react in this channel');
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

  /** Pins or unpins a message for everyone in the conversation (Pinned tab). */
  async pin(actor: Actor, messageId: string, pinned: boolean) {
    const row = await this.message(messageId);
    const { conv, perms } = await this.requireMember(actor, row.conversationId);
    // Discord: pinning in a server channel is "Manage Messages"; anyone in a DM or group may pin.
    if (conv.kind === 'channel' && !perms.moderate) throw new ForbiddenException('Only channel or space admins pin messages');
    if (row.deletedAt || row.kind !== 'text') throw new BadRequestException('Cannot pin this message');
    if (!!row.pinnedAt === pinned) return this.publishUpdate(actor, row);
    if (pinned) {
      const [{ n }] = await this.db.select({ n: sql<number>`count(*)::int` }).from(messages).where(and(eq(messages.conversationId, row.conversationId), isNotNull(messages.pinnedAt)));
      if (n >= 50) throw new BadRequestException('A conversation can have at most 50 pinned messages');
    }
    const next = await this.db.transaction(async (tx) => {
      const [n] = await tx.update(messages).set(pinned ? { pinnedAt: sql`now()`, pinnedBy: actor.id } : { pinnedAt: null, pinnedBy: null }).where(eq(messages.id, messageId)).returning();
      if (pinned) await this.system(tx, row.conversationId, actor, 'pinned a message');
      return n;
    });
    const msg = await this.publishUpdate(actor, next);
    if (pinned) this.realtime.publish(await this.memberIds(row.conversationId), { type: 'chat.conversation', conversationId: row.conversationId });
    return msg;
  }

  async pins(actor: Actor, id: string): Promise<ChatMessage[]> {
    await this.access(actor, id);
    const rows = await this.db.select().from(messages).where(and(eq(messages.conversationId, id), isNotNull(messages.pinnedAt))).orderBy(desc(messages.pinnedAt));
    return this.serialize(actor, rows);
  }

  /** Files shared in the conversation, newest first, once per file (Files tab). */
  async files(actor: Actor, id: string): Promise<ChatFile[]> {
    await this.access(actor, id);
    const rows = await this.db
      .select({ messageId: messageRefs.messageId, resourceId: messageRefs.resourceId, source: messageRefs.source, senderId: messages.senderId, sentAt: messages.createdAt })
      .from(messageRefs)
      .innerJoin(messages, eq(messages.id, messageRefs.messageId))
      .where(and(eq(messages.conversationId, id), isNull(messages.deletedAt)))
      .orderBy(desc(messages.seq))
      .limit(500);
    const seen = new Set<string>();
    const latest = rows.filter((r) => !seen.has(r.resourceId) && seen.add(r.resourceId));
    const cards = await this.cards(actor, latest);
    const people = await loadUsers(this.db, latest.map((r) => r.senderId));
    return latest.map((r) => ({ messageId: r.messageId, sender: r.senderId ? people.get(r.senderId) ?? null : null, sentAt: r.sentAt, file: cards.get(`${r.messageId}:${r.resourceId}`)! }));
  }

  /** Live file cards for the viewer; files the viewer cannot open are locked (no name). */
  private async cards(viewer: Actor, refs: { messageId: string; resourceId: string; source: 'attachment' | 'link' }[]) {
    const out = new Map<string, ChatAttachment>();
    if (!refs.length) return out;
    const rows = await this.db.select(resourceColumns).from(resources).where(inArray(resources.id, [...new Set(refs.map((r) => r.resourceId))]));
    const roles = await this.perms.rolesFor(viewer, rows);
    const owners = await loadUsers(this.db, rows.map((r) => r.ownerId));
    const byId = new Map(rows.map((r) => [r.id, r]));
    for (const ref of refs) {
      const r = byId.get(ref.resourceId);
      const ok = !!r && can(roles.get(r.id), 'viewer');
      out.set(`${ref.messageId}:${ref.resourceId}`, {
        id: ref.resourceId,
        accessible: ok,
        source: ref.source,
        name: ok ? r.name : null,
        type: ok ? r.type : null,
        mimeType: ok ? r.mimeType : null,
        sizeBytes: ok ? r.sizeBytes : null,
        metadata: ok ? r.metadata : null,
        owner: ok ? owners.get(r.ownerId)?.name ?? null : null,
        updatedAt: ok ? r.updatedAt : null,
        trashed: ok && !!r.trashedAt,
      });
    }
    return out;
  }

  private async publishUpdate(actor: Actor, row: MsgRow) {
    await this.publishRows(actor, await this.memberIds(row.conversationId), 'chat.message.updated', [row]);
    return (await this.serialize(actor, [row]))[0];
  }

  /**
   * Pushes messages to members. Messages with files are serialized per recipient, because a file card shows its
   * name only to people who can open it; everything else is one payload for all.
   */
  private async publishRows(actor: Actor, members: string[], type: 'chat.message' | 'chat.message.updated', rows: MsgRow[]) {
    const withFiles = rows.length ? await this.db.select({ id: messageRefs.messageId }).from(messageRefs).where(inArray(messageRefs.messageId, rows.map((r) => r.id))).limit(1) : [];
    if (!withFiles.length) {
      for (const msg of await this.serialize(actor, rows)) this.realtime.publish(members, { type, conversationId: msg.conversationId, message: msg });
      return;
    }
    for (const userId of members) {
      const viewer = { id: userId, name: '', workspaceId: actor.workspaceId };
      for (const msg of await this.serialize(viewer, rows)) this.realtime.publish([userId], { type, conversationId: msg.conversationId, message: msg });
    }
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
    // Mentions you have now scrolled past are read in the bell too.
    await this.notifications.readMessages(actor, sql`SELECT id FROM messages WHERE conversation_id = ${id} AND thread_root_id IS NULL AND seq <= ${next}`);
    return { lastReadSeq: next };
  }

  /**
   * Serialized for one viewer: `mine` on reactions and which file cards are open to them. Clients recompute `mine`
   * from `userIds` for pushed messages (see web lib/chat.ts).
   */
  private async serialize(actor: Actor, rows: MsgRow[]): Promise<ChatMessage[]> {
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const [reactions, repliers, refs] = await Promise.all([
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
      this.db.select().from(messageRefs).where(inArray(messageRefs.messageId, ids)).orderBy(asc(messageRefs.position)),
    ]);
    const [people, cards] = await Promise.all([loadUsers(this.db, [...rows.map((r) => r.senderId), ...rows.map((r) => r.pinnedBy), ...repliers.map((r) => r.senderId)]), this.cards(actor, refs)]);
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
        attachments: r.deletedAt ? [] : refs.filter((x) => x.messageId === r.id).map((x) => cards.get(`${x.messageId}:${x.resourceId}`)!),
        pinnedAt: r.pinnedAt,
        pinnedBy: r.pinnedBy ? people.get(r.pinnedBy) ?? null : null,
        createdAt: r.createdAt,
        editedAt: r.editedAt,
        deletedAt: r.deletedAt,
      };
    });
  }
}
