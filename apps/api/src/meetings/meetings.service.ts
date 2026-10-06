import { randomBytes } from 'node:crypto';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import {
  can,
  MEETING_CODE,
  MEETING_MAX_PEERS,
  MEETING_REACTIONS,
  meetingCode,
  type MeetingDetail,
  type MeetingEvent,
  type MeetingJoinResult,
  type MeetingMessage,
  type MeetingPeer,
  type MeetingRecordingInfo,
  type MeetingRole,
  type MeetingSummary,
  type UserSummary,
} from '@workos/shared';
import { and, desc, eq, inArray, isNull, like, or, sql } from 'drizzle-orm';
import { ChatService } from '../chat/chat.service';
import type { Actor } from '../common/current-user';
import { loadUsers } from '../common/users';
import { config } from '../config';
import type { Db } from '../db/client';
import { InjectDb } from '../db/db.module';
import { aclEntries, calendarEvents, calendars, eventAttendees, meetingMessages, meetingParticipants, meetingRecordings, meetings, resources } from '../db/schema';
import { NotificationsService, resourcePath } from '../notifications/notifications.service';
import { PermissionsService } from '../permissions/permissions.service';
import type { ClientMessage } from '../realtime/realtime.service';
import { RealtimeService } from '../realtime/realtime.service';
import { ResourcesService } from '../resources/resources.service';

type MeetingRow = typeof meetings.$inferSelect;
interface LivePeer extends MeetingPeer {
  userId: string;
  lastSeen: number;
}
interface Room {
  peers: Map<string, LivePeer>;
  /** userId → waiting since */
  lobby: Map<string, { user: UserSummary; at: number }>;
  recording: MeetingRecordingInfo | null;
}
interface Ring {
  from: Actor;
  users: Set<string>;
  at: number;
}

const PEER_ID = /^[A-Za-z0-9_-]{8,64}$/;
/** A tab that stopped sending "alive" for this long has gone (closed laptop, crashed tab). */
const STALE_MS = 35_000;
const LOBBY_MS = 10 * 60_000;
const RING_MS = 45_000;

/**
 * Video meetings (docs/ARCHITECTURE.md §73). Browsers connect to each other directly (WebRTC mesh, at most
 * MEETING_MAX_PEERS); the API only relays signalling over the realtime socket and decides who may enter:
 * the host and co-hosts, everyone in the workspace for an "open" room, otherwise the people the room was made for
 * (members of its conversation, guests of its calendar event, people already let in) — the rest ask to join and
 * wait in the lobby. Who is in a room right now is kept in memory (single API process, like the realtime socket).
 */
@Injectable()
export class MeetingsService implements OnModuleInit, OnModuleDestroy {
  private readonly rooms = new Map<string, Room>();
  private readonly rings = new Map<string, Ring>();
  private sweeper?: NodeJS.Timeout;

  constructor(
    @InjectDb() private readonly db: Db,
    private readonly chat: ChatService,
    private readonly realtime: RealtimeService,
    private readonly notifications: NotificationsService,
    private readonly perms: PermissionsService,
    private readonly resources: ResourcesService,
  ) {}

  onModuleInit() {
    this.realtime.onClientMessage((actor, msg) => this.onSocket(actor, msg));
    this.sweeper = setInterval(() => void this.sweep().catch(() => undefined), 10_000);
  }

  onModuleDestroy() {
    clearInterval(this.sweeper);
  }

  // ── Live rooms ────────────────────────────────────────────────────────────

  private room(id: string) {
    let r = this.rooms.get(id);
    if (!r) this.rooms.set(id, (r = { peers: new Map(), lobby: new Map(), recording: null }));
    return r;
  }

  private dto(p: LivePeer): MeetingPeer {
    return { peerId: p.peerId, user: p.user, role: p.role, mic: p.mic, cam: p.cam, screen: p.screen, hand: p.hand, joinedAt: p.joinedAt };
  }

  private roomUsers(room: Room) {
    return [...room.peers.values()].map((p) => p.userId);
  }

  private publishRoom(room: Room, event: MeetingEvent, extra: string[] = []) {
    this.realtime.publish([...this.roomUsers(room), ...extra], event);
  }

  /** Signals from the browsers in a room: keep-alive, WebRTC offers / answers / candidates, mic & camera state, reactions. */
  private onSocket(actor: Actor, msg: ClientMessage) {
    if (typeof msg.type !== 'string' || !msg.type.startsWith('meeting.') || typeof msg.meetingId !== 'string') return;
    const meetingId = msg.meetingId;
    const room = this.rooms.get(meetingId);
    const from = typeof msg.peerId === 'string' ? room?.peers.get(msg.peerId) : undefined;
    if (!room || !from || from.userId !== actor.id) return;
    from.lastSeen = Date.now();
    if (msg.type === 'meeting.signal') {
      const to = typeof msg.to === 'string' ? room.peers.get(msg.to) : undefined;
      if (to && to !== from) this.realtime.publish([to.userId], { type: 'meeting.signal', meetingId, from: from.peerId, to: to.peerId, data: msg.data });
    } else if (msg.type === 'meeting.state') {
      if (typeof msg.mic === 'boolean') from.mic = msg.mic;
      if (typeof msg.cam === 'boolean') from.cam = msg.cam;
      if (typeof msg.hand === 'boolean') from.hand = msg.hand;
      if ('screen' in msg) from.screen = typeof msg.screen === 'string' && msg.screen.length <= 100 ? msg.screen : null;
      this.publishRoom(room, { type: 'meeting.peer.updated', meetingId, peer: this.dto(from) });
    } else if (msg.type === 'meeting.reaction') {
      if ((MEETING_REACTIONS as readonly unknown[]).includes(msg.emoji)) this.publishRoom(room, { type: 'meeting.reaction', meetingId, peerId: from.peerId, emoji: msg.emoji as string });
    }
  }

  private async sweep() {
    const now = Date.now();
    for (const [id, room] of this.rooms) {
      for (const p of [...room.peers.values()]) if (now - p.lastSeen > STALE_MS) await this.dropPeer(id, room, p);
      let lobbyChanged = false;
      for (const [u, w] of room.lobby)
        if (now - w.at > LOBBY_MS) {
          room.lobby.delete(u);
          lobbyChanged = true;
        }
      if (lobbyChanged) this.publishLobby(id, room);
      if (!room.peers.size && !room.lobby.size) this.rooms.delete(id);
    }
    for (const [id, ring] of this.rings) if (now - ring.at > RING_MS && !this.rooms.get(id)?.peers.size) await this.endRing(id);
  }

  private async dropPeer(meetingId: string, room: Room, peer: LivePeer) {
    if (!room.peers.delete(peer.peerId)) return;
    const seconds = Math.max(0, Math.round((Date.now() - Date.parse(peer.joinedAt)) / 1000));
    await this.db
      .update(meetingParticipants)
      .set({ lastLeftAt: new Date().toISOString(), seconds: sql`${meetingParticipants.seconds} + ${seconds}` })
      .where(and(eq(meetingParticipants.meetingId, meetingId), eq(meetingParticipants.userId, peer.userId)));
    this.publishRoom(room, { type: 'meeting.peer.left', meetingId, peerId: peer.peerId }, [peer.userId]);
    if (room.recording && room.recording.by.id === peer.userId && ![...room.peers.values()].some((p) => p.userId === peer.userId)) {
      room.recording = null;
      this.publishRoom(room, { type: 'meeting.recording', meetingId, recording: null });
    }
    if (!room.peers.size) await this.finish(meetingId, room);
    else {
      this.publishLobby(meetingId, room);
      await this.changed(meetingId);
    }
  }

  /** The last person left (or the host ended the meeting for everyone). */
  private async finish(meetingId: string, room: Room) {
    this.rooms.delete(meetingId);
    if (room.lobby.size) this.realtime.publish(room.lobby.keys(), { type: 'meeting.ended', meetingId });
    await this.db.update(meetings).set({ endedAt: new Date().toISOString() }).where(eq(meetings.id, meetingId));
    await this.endRing(meetingId);
    await this.changed(meetingId);
  }

  /** Stops ringing; people who were called and never came get a "missed call" in the bell. */
  private async endRing(meetingId: string) {
    const ring = this.rings.get(meetingId);
    if (!ring) return;
    this.rings.delete(meetingId);
    this.realtime.publish(ring.users, { type: 'meeting.ring.stop', meetingId });
    const came = await this.db.select({ id: meetingParticipants.userId }).from(meetingParticipants).where(eq(meetingParticipants.meetingId, meetingId));
    const missed = [...ring.users].filter((u) => !came.some((c) => c.id === u));
    const [m] = await this.db.select().from(meetings).where(eq(meetings.id, meetingId));
    if (missed.length && m)
      await this.notifications
        .notify(ring.from, missed, { kind: 'meeting.call', title: `Missed video call from ${ring.from.name}`, body: m.title, url: m.conversationId ? `/chat/${m.conversationId}` : `/meetings?room=${m.code}`, conversationId: m.conversationId })
        .catch(() => undefined);
  }

  /** Who can admit people from the lobby: hosts and co-hosts in the room — or, when none is there, anyone in it. */
  private admitters(room: Room) {
    const managers = [...room.peers.values()].filter((p) => p.role !== 'guest');
    return (managers.length ? managers : [...room.peers.values()]).map((p) => p.userId);
  }

  private publishLobby(meetingId: string, room: Room) {
    const lobby = [...room.lobby.values()].map((w) => w.user);
    this.realtime.publish(this.admitters(room), { type: 'meeting.lobby', meetingId, lobby });
  }

  /** Lists and chat cards refetch. */
  private async changed(meetingId: string) {
    const [m] = await this.db.select().from(meetings).where(eq(meetings.id, meetingId));
    if (!m) return;
    const to = new Set<string>([...this.roomUsers(this.rooms.get(m.id) ?? this.emptyRoom), ...(m.hostId ? [m.hostId] : [])]);
    if (m.conversationId) {
      const host = m.hostId ?? m.createdBy;
      const conv = host ? await this.chat.peek({ id: host, name: '', workspaceId: m.workspaceId }, m.conversationId) : null;
      for (const u of conv?.memberIds ?? []) to.add(u);
    }
    this.realtime.publish(to, { type: 'meeting.changed', meetingId: m.id, code: m.code });
  }
  private readonly emptyRoom: Room = { peers: new Map(), lobby: new Map(), recording: null };

  // ── Access ────────────────────────────────────────────────────────────────

  /** A room by its code. A Kaori Meet link from a calendar event gets its room the first time someone opens it. */
  private async load(actor: Actor, code: string): Promise<MeetingRow> {
    if (!MEETING_CODE.test(code)) throw new NotFoundException('Meeting not found');
    const [m] = await this.db.select().from(meetings).where(eq(meetings.code, code));
    const row = m ?? (await this.fromEvent(actor, code));
    if (!row || row.workspaceId !== actor.workspaceId) throw new NotFoundException('Meeting not found');
    return row;
  }

  private async fromEvent(actor: Actor, code: string) {
    const [hit] = await this.db
      .select({ ev: calendarEvents, workspaceId: calendars.workspaceId })
      .from(calendarEvents)
      .innerJoin(calendars, eq(calendars.id, calendarEvents.calendarId))
      .where(and(eq(calendarEvents.meetingProvider, 'kaori'), like(calendarEvents.meetingUrl, `%room=${code}`)))
      .limit(1);
    if (!hit || hit.workspaceId !== actor.workspaceId) return null;
    await this.db
      .insert(meetings)
      .values({
        workspaceId: hit.workspaceId,
        code,
        title: hit.ev.visibility === 'private' ? 'Private meeting' : hit.ev.title,
        hostId: hit.ev.organizerId,
        eventId: hit.ev.id,
        access: 'trusted',
        createdBy: hit.ev.organizerId,
      })
      .onConflictDoNothing();
    return (await this.db.select().from(meetings).where(eq(meetings.code, code)))[0] ?? null;
  }

  private async standing(actor: Actor, m: MeetingRow): Promise<{ role: MeetingRole; entry: 'join' | 'knock'; manage: boolean }> {
    const [p] = await this.db
      .select()
      .from(meetingParticipants)
      .where(and(eq(meetingParticipants.meetingId, m.id), eq(meetingParticipants.userId, actor.id)));
    const role: MeetingRole = m.hostId === actor.id ? 'host' : p?.role === 'cohost' ? 'cohost' : 'guest';
    if (role !== 'guest') return { role, entry: 'join', manage: true };
    const knock = { role, entry: 'knock' as const, manage: false };
    const join = { role, entry: 'join' as const, manage: false };
    if (p?.status === 'removed') return knock;
    if (m.access === 'open' || p || m.createdBy === actor.id) return join;
    if (m.conversationId && (await this.chat.peek(actor, m.conversationId))) return join;
    if (m.eventId) {
      const [guest] = await this.db
        .select({ id: eventAttendees.id })
        .from(eventAttendees)
        .where(and(eq(eventAttendees.eventId, m.eventId), eq(eventAttendees.userId, actor.id)));
      if (guest) return join;
    }
    return knock;
  }

  private async requireManager(actor: Actor, m: MeetingRow) {
    const st = await this.standing(actor, m);
    if (!st.manage) throw new ForbiddenException('Only the host and co-hosts can do this');
    return st;
  }

  private myPeer(actor: Actor, room: Room | undefined, peerId?: string) {
    return [...(room?.peers.values() ?? [])].find((p) => p.userId === actor.id && (!peerId || p.peerId === peerId));
  }

  // ── Reading ───────────────────────────────────────────────────────────────

  private async summaries(actor: Actor, rows: MeetingRow[]): Promise<MeetingSummary[]> {
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const parts = await this.db.select().from(meetingParticipants).where(inArray(meetingParticipants.meetingId, ids));
    const recs = await this.db
      .select({ meetingId: meetingRecordings.meetingId, durationMs: meetingRecordings.durationMs, res: resources })
      .from(meetingRecordings)
      .innerJoin(resources, eq(resources.id, meetingRecordings.resourceId))
      .where(and(inArray(meetingRecordings.meetingId, ids), isNull(resources.trashedAt)))
      .orderBy(meetingRecordings.createdAt);
    const roles = await this.perms.rolesFor(actor, recs.map((r) => r.res));
    const live = rows.flatMap((r) => [...(this.rooms.get(r.id)?.peers.values() ?? [])].map((p) => p.userId));
    const people = await loadUsers(this.db, [...rows.map((r) => r.hostId), ...parts.map((p) => p.userId), ...live]);
    return rows.map((m) => {
      const inRoom = [...new Set([...(this.rooms.get(m.id)?.peers.values() ?? [])].map((p) => p.userId))].map((u) => people.get(u)!).filter(Boolean);
      return {
        id: m.id,
        code: m.code,
        title: m.title,
        host: m.hostId ? people.get(m.hostId) ?? null : null,
        conversationId: m.conversationId,
        eventId: m.eventId,
        access: m.access,
        live: inRoom.length > 0,
        startedAt: m.startedAt,
        endedAt: m.endedAt,
        createdAt: m.createdAt,
        inRoom,
        participants: parts
          .filter((p) => p.meetingId === m.id && p.firstJoinedAt)
          .map((p) => people.get(p.userId)!)
          .filter(Boolean),
        recordings: recs.filter((r) => r.meetingId === m.id && can(roles.get(r.res.id), 'viewer')).map((r) => ({ id: r.res.id, name: r.res.name, durationMs: r.durationMs })),
        notesId: m.notesId,
      };
    });
  }

  /** Meetings I hosted, created or took part in, newest first. */
  async list(actor: Actor): Promise<MeetingSummary[]> {
    const mine = this.db.select({ id: meetingParticipants.meetingId }).from(meetingParticipants).where(eq(meetingParticipants.userId, actor.id));
    const rows = await this.db
      .select()
      .from(meetings)
      .where(and(eq(meetings.workspaceId, actor.workspaceId), or(eq(meetings.hostId, actor.id), eq(meetings.createdBy, actor.id), inArray(meetings.id, mine))))
      .orderBy(desc(sql`coalesce(${meetings.startedAt}, ${meetings.createdAt})`))
      .limit(50);
    return this.summaries(actor, rows);
  }

  async get(actor: Actor, code: string): Promise<MeetingDetail> {
    const m = await this.load(actor, code);
    return this.detail(actor, m);
  }

  private async detail(actor: Actor, m: MeetingRow): Promise<MeetingDetail> {
    const me = await this.standing(actor, m);
    const [summary] = await this.summaries(actor, [m]);
    const room = this.rooms.get(m.id);
    const mayAdmit = !!room && this.admitters(room).includes(actor.id);
    let event: MeetingDetail['event'] = null;
    if (m.eventId) {
      const [ev] = await this.db.select().from(calendarEvents).where(eq(calendarEvents.id, m.eventId));
      if (ev) event = { id: ev.id, title: me.entry === 'join' ? ev.title : m.title, startAt: ev.startAt, endAt: ev.endAt };
    }
    const conv = m.conversationId ? await this.chat.peek(actor, m.conversationId) : null;
    return {
      ...summary,
      me,
      peers: [...(room?.peers.values() ?? [])].map((p) => this.dto(p)),
      lobby: mayAdmit ? [...room!.lobby.values()].map((w) => w.user) : [],
      recording: room?.recording ?? null,
      event,
      conversationTitle: conv?.title ?? null,
    };
  }

  // ── Creating & settings ───────────────────────────────────────────────────

  async create(actor: Actor, input: { title?: string | null; conversationId?: string | null; access?: 'open' | 'trusted'; ring?: boolean }): Promise<MeetingDetail> {
    let conv: Awaited<ReturnType<ChatService['peek']>> = null;
    if (input.conversationId) {
      conv = await this.chat.peek(actor, input.conversationId);
      if (!conv) throw new NotFoundException('Conversation not found');
      if (!conv.canPost) throw new ForbiddenException('You cannot start a meeting in this conversation');
      // One call per conversation: a second "call" joins the one in progress.
      const open = await this.db.select().from(meetings).where(and(eq(meetings.conversationId, input.conversationId), isNull(meetings.endedAt)));
      const live = open.find((m) => this.rooms.get(m.id)?.peers.size);
      if (live) return this.detail(actor, live);
    }
    const title = input.title?.trim() || (conv ? (conv.kind === 'dm' ? `Call with ${conv.title}` : `${conv.title} meeting`) : `${actor.name}'s meeting`);
    let m: MeetingRow | undefined;
    for (let i = 0; i < 5 && !m; i++)
      [m] = await this.db
        .insert(meetings)
        .values({
          workspaceId: actor.workspaceId,
          code: meetingCode(randomBytes(10)),
          title: title.slice(0, 200),
          hostId: actor.id,
          conversationId: input.conversationId ?? null,
          access: input.access ?? (conv ? 'trusted' : 'open'),
          createdBy: actor.id,
        })
        .onConflictDoNothing()
        .returning();
    if (!m) throw new ConflictException('Try again');
    if (conv && input.conversationId) {
      await this.chat.send(actor, input.conversationId, { body: `📹 Started a video meeting: ${config.webOrigin}/meetings?room=${m.code}` }).catch(() => undefined);
      if (input.ring !== false && conv.kind !== 'channel') {
        const users = new Set(conv.memberIds.filter((u) => u !== actor.id));
        if (users.size) {
          this.rings.set(m.id, { from: actor, users, at: Date.now() });
          const from = (await loadUsers(this.db, [actor.id])).get(actor.id)!;
          this.realtime.publish(users, { type: 'meeting.ring', meetingId: m.id, code: m.code, title: m.title, from, conversationId: m.conversationId });
        }
      }
    }
    return this.detail(actor, m);
  }

  async update(actor: Actor, code: string, input: { title?: string; access?: 'open' | 'trusted' }) {
    const m = await this.load(actor, code);
    await this.requireManager(actor, m);
    const set: Partial<MeetingRow> = {};
    if (input.title !== undefined) set.title = input.title.trim().slice(0, 200) || m.title;
    if (input.access) set.access = input.access;
    if (Object.keys(set).length) await this.db.update(meetings).set(set).where(eq(meetings.id, m.id));
    await this.changed(m.id);
  }

  // ── Joining & leaving ─────────────────────────────────────────────────────

  async join(actor: Actor, code: string, input: { peerId: string; mic: boolean; cam: boolean }): Promise<MeetingJoinResult> {
    if (!PEER_ID.test(input.peerId)) throw new BadRequestException('Bad peer id');
    const m = await this.load(actor, code);
    const st = await this.standing(actor, m);
    const room = this.room(m.id);
    const ready = (): MeetingJoinResult => ({
      state: 'joined',
      peers: [...room.peers.values()].filter((p) => p.peerId !== input.peerId).map((p) => this.dto(p)),
      iceServers: config.meetings.iceServers,
      recording: room.recording,
    });
    const existing = room.peers.get(input.peerId);
    if (existing) {
      if (existing.userId !== actor.id) throw new ConflictException('Bad peer id');
      existing.lastSeen = Date.now();
      return ready();
    }
    if (st.entry === 'knock') {
      if (!room.lobby.has(actor.id)) room.lobby.set(actor.id, { user: (await loadUsers(this.db, [actor.id])).get(actor.id)!, at: Date.now() });
      this.publishLobby(m.id, room);
      return { state: 'waiting' };
    }
    if (room.peers.size >= MEETING_MAX_PEERS) throw new ConflictException(`This meeting is full (${MEETING_MAX_PEERS} people)`);
    const now = new Date().toISOString();
    const user = (await loadUsers(this.db, [actor.id])).get(actor.id)!;
    const peer: LivePeer = { peerId: input.peerId, user, role: st.role, mic: input.mic, cam: input.cam, screen: null, hand: false, joinedAt: now, userId: actor.id, lastSeen: Date.now() };
    const first = room.peers.size === 0;
    const others = ready();
    room.peers.set(peer.peerId, peer);
    if (room.lobby.delete(actor.id)) this.publishLobby(m.id, room);
    if (first) await this.db.update(meetings).set({ startedAt: now, endedAt: null }).where(eq(meetings.id, m.id));
    await this.db
      .insert(meetingParticipants)
      .values({ meetingId: m.id, userId: actor.id, role: st.role, status: 'joined', firstJoinedAt: now, lastJoinedAt: now })
      .onConflictDoUpdate({
        target: [meetingParticipants.meetingId, meetingParticipants.userId],
        set: { status: 'joined', lastJoinedAt: now, firstJoinedAt: sql`coalesce(${meetingParticipants.firstJoinedAt}, ${now})` },
      });
    this.publishRoom(room, { type: 'meeting.peer.joined', meetingId: m.id, peer: this.dto(peer) });
    // Picked up on one device: the others stop ringing.
    if (this.rings.get(m.id)?.users.has(actor.id)) this.realtime.publish([actor.id], { type: 'meeting.ring.stop', meetingId: m.id });
    if (room.lobby.size) this.publishLobby(m.id, room);
    await this.changed(m.id);
    return others;
  }

  /** Leaves the room (peerId) or stops waiting in the lobby (no peerId). Also sent by the page as it closes. */
  async leave(actor: Actor, code: string, peerId?: string) {
    const m = await this.load(actor, code);
    const room = this.rooms.get(m.id);
    if (!room) return;
    if (peerId) {
      const p = room.peers.get(peerId);
      if (p && p.userId === actor.id) await this.dropPeer(m.id, room, p);
    } else if (room.lobby.delete(actor.id)) this.publishLobby(m.id, room);
  }

  /** Keep-alive from a browser in the room; false when the room no longer knows it (it then joins again). */
  async alive(actor: Actor, code: string, peerId: string) {
    const m = await this.load(actor, code);
    const p = this.rooms.get(m.id)?.peers.get(peerId);
    if (!p || p.userId !== actor.id) return { ok: false };
    p.lastSeen = Date.now();
    return { ok: true };
  }

  /** Declines an incoming call on every device. */
  async decline(actor: Actor, code: string) {
    const m = await this.load(actor, code);
    this.realtime.publish([actor.id], { type: 'meeting.ring.stop', meetingId: m.id });
  }

  async admit(actor: Actor, code: string, userId: string, allow: boolean) {
    const m = await this.load(actor, code);
    const room = this.rooms.get(m.id);
    if (!room || !this.admitters(room).includes(actor.id)) throw new ForbiddenException('Only the host can let people in');
    if (!room.lobby.delete(userId)) throw new NotFoundException('That person is not waiting');
    if (allow)
      await this.db
        .insert(meetingParticipants)
        .values({ meetingId: m.id, userId, role: 'guest', status: 'admitted' })
        .onConflictDoUpdate({ target: [meetingParticipants.meetingId, meetingParticipants.userId], set: { status: 'admitted' } });
    this.realtime.publish([userId], allow ? { type: 'meeting.admitted', meetingId: m.id } : { type: 'meeting.denied', meetingId: m.id });
    this.publishLobby(m.id, room);
  }

  /** Asks someone's browser to turn their microphone off (they can turn it back on). */
  async mute(actor: Actor, code: string, peerId: string) {
    const m = await this.load(actor, code);
    await this.requireManager(actor, m);
    const p = this.rooms.get(m.id)?.peers.get(peerId);
    if (!p) throw new NotFoundException('Not in the meeting');
    this.realtime.publish([p.userId], { type: 'meeting.mute', meetingId: m.id, peerId, by: actor.name });
  }

  async remove(actor: Actor, code: string, userId: string) {
    const m = await this.load(actor, code);
    await this.requireManager(actor, m);
    if (userId === m.hostId || userId === actor.id) throw new BadRequestException('The host cannot be removed');
    await this.db
      .insert(meetingParticipants)
      .values({ meetingId: m.id, userId, role: 'guest', status: 'removed' })
      .onConflictDoUpdate({ target: [meetingParticipants.meetingId, meetingParticipants.userId], set: { status: 'removed', role: 'guest' } });
    this.realtime.publish([userId], { type: 'meeting.removed', meetingId: m.id });
    const room = this.rooms.get(m.id);
    for (const p of [...(room?.peers.values() ?? [])]) if (p.userId === userId) await this.dropPeer(m.id, room!, p);
  }

  async setCohost(actor: Actor, code: string, userId: string, on: boolean) {
    const m = await this.load(actor, code);
    if (m.hostId !== actor.id) throw new ForbiddenException('Only the host chooses co-hosts');
    if (userId === actor.id) throw new BadRequestException('You are the host');
    await this.db
      .insert(meetingParticipants)
      .values({ meetingId: m.id, userId, role: on ? 'cohost' : 'guest', status: 'admitted' })
      .onConflictDoUpdate({ target: [meetingParticipants.meetingId, meetingParticipants.userId], set: { role: on ? 'cohost' : 'guest' } });
    const room = this.rooms.get(m.id);
    for (const p of room?.peers.values() ?? [])
      if (p.userId === userId) {
        p.role = on ? 'cohost' : 'guest';
        this.publishRoom(room!, { type: 'meeting.peer.updated', meetingId: m.id, peer: this.dto(p) });
      }
    if (room) this.publishLobby(m.id, room);
  }

  /** Ends the meeting for everyone. */
  async end(actor: Actor, code: string) {
    const m = await this.load(actor, code);
    await this.requireManager(actor, m);
    const room = this.rooms.get(m.id);
    if (!room) return;
    this.publishRoom(room, { type: 'meeting.ended', meetingId: m.id });
    for (const p of [...room.peers.values()]) {
      room.peers.delete(p.peerId);
      const seconds = Math.max(0, Math.round((Date.now() - Date.parse(p.joinedAt)) / 1000));
      await this.db
        .update(meetingParticipants)
        .set({ lastLeftAt: new Date().toISOString(), seconds: sql`${meetingParticipants.seconds} + ${seconds}` })
        .where(and(eq(meetingParticipants.meetingId, m.id), eq(meetingParticipants.userId, p.userId)));
    }
    await this.finish(m.id, room);
  }

  // ── In-call chat ──────────────────────────────────────────────────────────

  private async messageDtos(rows: (typeof meetingMessages.$inferSelect)[]): Promise<MeetingMessage[]> {
    const people = await loadUsers(this.db, rows.map((r) => r.userId));
    return rows.map((r) => ({ id: r.id, user: r.userId ? people.get(r.userId) ?? null : null, body: r.body, createdAt: r.createdAt }));
  }

  async messages(actor: Actor, code: string): Promise<MeetingMessage[]> {
    const m = await this.load(actor, code);
    if ((await this.standing(actor, m)).entry !== 'join') throw new ForbiddenException('Join the meeting to read its chat');
    const rows = await this.db.select().from(meetingMessages).where(eq(meetingMessages.meetingId, m.id)).orderBy(meetingMessages.createdAt).limit(500);
    return this.messageDtos(rows);
  }

  async post(actor: Actor, code: string, body: string): Promise<MeetingMessage> {
    const m = await this.load(actor, code);
    const room = this.rooms.get(m.id);
    if (!this.myPeer(actor, room)) throw new ForbiddenException('Join the meeting to chat');
    const text = body.trim();
    if (!text) throw new BadRequestException('Message is empty');
    const [row] = await this.db.insert(meetingMessages).values({ meetingId: m.id, userId: actor.id, body: text.slice(0, 4000) }).returning();
    const [message] = await this.messageDtos([row]);
    this.publishRoom(room!, { type: 'meeting.message', meetingId: m.id, message });
    return message;
  }

  // ── Recording & notes ─────────────────────────────────────────────────────

  /** Host / co-host starts or stops recording: everyone in the room sees the red "Recording" sign. */
  async setRecording(actor: Actor, code: string, on: boolean) {
    const m = await this.load(actor, code);
    await this.requireManager(actor, m);
    const room = this.rooms.get(m.id);
    if (!this.myPeer(actor, room)) throw new ForbiddenException('Join the meeting first');
    if (on && room!.recording && room!.recording.by.id !== actor.id) throw new ConflictException(`${room!.recording.by.name} is already recording`);
    room!.recording = on ? { by: (await loadUsers(this.db, [actor.id])).get(actor.id)!, since: new Date().toISOString() } : null;
    this.publishRoom(room!, { type: 'meeting.recording', meetingId: m.id, recording: room!.recording });
    return room!.recording;
  }

  /** The recorder's "Meeting recordings" folder in My Files. */
  private async recordingsFolder(actor: Actor) {
    const [f] = await this.db
      .select({ id: resources.id })
      .from(resources)
      .where(
        and(
          eq(resources.ownerId, actor.id),
          eq(resources.type, 'folder'),
          isNull(resources.parentId),
          isNull(resources.spaceId),
          isNull(resources.trashedAt),
          sql`${resources.metadata}->>'meetingRecordings' = 'true'`,
        ),
      );
    if (f) return f.id;
    const folder = await this.resources.create(actor, { name: 'Meeting recordings', type: 'folder' });
    await this.db.update(resources).set({ metadata: { meetingRecordings: true } }).where(eq(resources.id, folder.id));
    return folder.id;
  }

  /** Gives people a role on a file unless they already have one (never lowers a role). */
  private async grant(actor: Actor, resourceId: string, userIds: string[], role: 'viewer' | 'editor') {
    const to = [...new Set(userIds)].filter((u) => u !== actor.id);
    if (to.length) await this.db.insert(aclEntries).values(to.map((u) => ({ resourceId, principalType: 'user' as const, principalId: u, role, createdBy: actor.id }))).onConflictDoNothing();
  }

  private async participantIds(meetingId: string) {
    const rows = await this.db
      .select({ id: meetingParticipants.userId })
      .from(meetingParticipants)
      .where(and(eq(meetingParticipants.meetingId, meetingId), sql`${meetingParticipants.firstJoinedAt} IS NOT NULL`));
    return rows.map((r) => r.id);
  }

  /**
   * A finished recording (WebM made in the recorder's browser) becomes a video in their Drive, viewable by everyone
   * who was in the meeting, and is announced in the meeting's conversation.
   */
  async saveRecording(actor: Actor, code: string, file: Express.Multer.File | undefined, durationMs: number) {
    if (!file) throw new BadRequestException('No recording');
    if (!/^video\/webm|^video\/mp4/.test(file.mimetype)) throw new BadRequestException('Recordings are WebM or MP4 videos');
    const m = await this.load(actor, code);
    await this.requireManager(actor, m);
    const folder = await this.recordingsFolder(actor);
    const res = await this.resources.upload(actor, file, { parentId: folder });
    await this.db.insert(meetingRecordings).values({ meetingId: m.id, resourceId: res.id, durationMs: Math.max(0, Math.round(durationMs) || 0), createdBy: actor.id });
    const people = await this.participantIds(m.id);
    await this.grant(actor, res.id, people, 'viewer');
    await this.notifications
      .notify(actor, people, { kind: 'resource.shared', title: `Recording of "${m.title}" is ready`, body: res.name, url: resourcePath(res), resourceId: res.id })
      .catch(() => undefined);
    if (m.conversationId)
      await this.chat.send(actor, m.conversationId, { body: `🎬 Recording of "${m.title}": ${config.webOrigin}${resourcePath(res)}`, grant: 'none' }).catch(() => undefined);
    await this.changed(m.id);
    return res;
  }

  /** The meeting's notes document (made on first use from the Meeting notes template), editable by everyone in it. */
  async notes(actor: Actor, code: string): Promise<{ id: string }> {
    const m = await this.load(actor, code);
    const st = await this.standing(actor, m);
    if (st.entry !== 'join') throw new ForbiddenException('Join the meeting to take notes');
    const inRoom = this.roomUsers(this.rooms.get(m.id) ?? this.emptyRoom);
    if (m.notesId) {
      const [doc] = await this.db.select({ id: resources.id, trashedAt: resources.trashedAt }).from(resources).where(eq(resources.id, m.notesId));
      if (doc && !doc.trashedAt) {
        const owner = { id: m.hostId ?? actor.id, name: '', workspaceId: m.workspaceId };
        await this.grant(owner, doc.id, [actor.id], 'editor');
        return { id: doc.id };
      }
    }
    const day = new Date().toISOString().slice(0, 10);
    const doc = await this.resources.create(actor, { name: `Notes — ${m.title} — ${day}`, type: 'document', template: 'meeting-notes' });
    await this.db.update(meetings).set({ notesId: doc.id }).where(eq(meetings.id, m.id));
    await this.grant(actor, doc.id, [...inRoom, ...(await this.participantIds(m.id))], 'editor');
    await this.changed(m.id);
    return { id: doc.id };
  }
}
