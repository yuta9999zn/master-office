import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  can,
  type CalendarEventView,
  type CalendarInfo,
  type EventInput,
  type EventResponse,
  type Recurrence,
  type Role,
  type UserSummary,
  zonedParts,
  zonedToUtc,
} from '@workos/shared';
import { and, eq, inArray, lt, or, sql } from 'drizzle-orm';
import type { Actor } from '../common/current-user';
import { loadUsers } from '../common/users';
import { config } from '../config';
import type { Db, Tx } from '../db/client';
import { InjectDb } from '../db/db.module';
import { calendarEvents, calendars, eventAttendees, resources, spaces, users, workspaceMembers } from '../db/schema';
import { MailboxService } from '../mail/mailbox.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PermissionsService } from '../permissions/permissions.service';
import { RealtimeService } from '../realtime/realtime.service';

type Cal = typeof calendars.$inferSelect;
type Ev = typeof calendarEvents.$inferSelect;
type Att = typeof eventAttendees.$inferSelect;

const EMAIL = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;
const DAY = 86_400_000;
const PALETTE = ['#2563eb', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#0ea5e9', '#14b8a6'];

/**
 * Occurrence starts of a series between `from` and `to`, stepping in the event's own time zone (so 09:00 stays
 * 09:00 across daylight-saving changes). Capped at 1000 steps.
 */
export function occurrences(start: Date, tz: string, rec: Recurrence, from: Date, to: Date, exdates: string[] = []): Date[] {
  const p = zonedParts(start, tz);
  const out: Date[] = [];
  const until = rec.until ? new Date(rec.until) : null;
  const interval = Math.max(1, rec.interval || 1);
  const skip = new Set(exdates);
  let made = 0;
  const push = (d: Date) => {
    made++;
    if (d >= to || (until && d > until)) return false;
    if (rec.count && made > rec.count) return false;
    if (!skip.has(d.toISOString())) out.push(d);
    return true;
  };
  // Without a count, jump close to the range instead of walking from the first occurrence (old daily series).
  const span = rec.freq === 'daily' ? DAY * interval : rec.freq === 'weekly' ? 7 * DAY * interval : rec.freq === 'monthly' ? 28 * DAY * interval : 365 * DAY * interval;
  const k0 = rec.count ? 0 : Math.max(0, Math.floor((from.getTime() - start.getTime()) / span) - 2);
  for (let k = k0; k < k0 + 1000; k++) {
    if (rec.freq === 'weekly') {
      const days = rec.byDay?.length ? [...rec.byDay].sort() : [p.weekday];
      // The week of the first occurrence, then every `interval` weeks.
      const weekStart = new Date(Date.UTC(p.y, p.m - 1, p.d - p.weekday + k * 7 * interval));
      let stop = false;
      for (const wd of days) {
        const day = new Date(weekStart.getTime() + wd * DAY);
        const at = zonedToUtc(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), p.h, p.mi, tz);
        if (at < start) continue;
        if (!push(at)) {
          stop = true;
          break;
        }
      }
      if (stop) break;
      continue;
    }
    let y = p.y;
    let m = p.m;
    let d = p.d;
    if (rec.freq === 'daily') {
      const day = new Date(Date.UTC(p.y, p.m - 1, p.d + k * interval));
      y = day.getUTCFullYear();
      m = day.getUTCMonth() + 1;
      d = day.getUTCDate();
    } else if (rec.freq === 'monthly') {
      const mm = p.m - 1 + k * interval;
      y = p.y + Math.floor(mm / 12);
      m = (mm % 12) + 1;
      // The 31st only happens in months that have one.
      if (new Date(Date.UTC(y, m, 0)).getUTCDate() < d) continue;
    } else {
      y = p.y + k * interval;
      if (m === 2 && d === 29 && new Date(Date.UTC(y, 2, 0)).getUTCDate() < 29) continue;
    }
    if (!push(zonedToUtc(y, m, d, p.h, p.mi, tz))) break;
  }
  return out;
}

const icsText = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const icsTime = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const icsDate = (d: Date, tz: string) => {
  const p = zonedParts(d, tz);
  return `${p.y}${String(p.m).padStart(2, '0')}${String(p.d).padStart(2, '0')}`;
};

/** An iCalendar invitation (METHOD:REQUEST) or cancellation, as Google Calendar and Outlook read it. */
export function toIcs(e: Ev, organizer: { name: string; email: string }, guests: Att[], method: 'REQUEST' | 'CANCEL', domain: string) {
  const rrule = e.recurrence
    ? `RRULE:FREQ=${e.recurrence.freq.toUpperCase()};INTERVAL=${e.recurrence.interval || 1}${e.recurrence.count ? `;COUNT=${e.recurrence.count}` : ''}${e.recurrence.until ? `;UNTIL=${icsTime(new Date(e.recurrence.until))}` : ''}${
        e.recurrence.byDay?.length ? `;BYDAY=${e.recurrence.byDay.map((d) => ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'][d]).join(',')}` : ''
      }`
    : null;
  const lines = [
    'BEGIN:VCALENDAR',
    'PRODID:-//Master Office//Calendar//EN',
    'VERSION:2.0',
    `METHOD:${method}`,
    'BEGIN:VEVENT',
    `UID:${e.id}@${domain}`,
    `DTSTAMP:${icsTime(new Date())}`,
    e.allDay ? `DTSTART;VALUE=DATE:${icsDate(new Date(e.startAt), e.timezone)}` : `DTSTART:${icsTime(new Date(e.startAt))}`,
    e.allDay ? `DTEND;VALUE=DATE:${icsDate(new Date(e.endAt), e.timezone)}` : `DTEND:${icsTime(new Date(e.endAt))}`,
    ...(rrule ? [rrule] : []),
    `SEQUENCE:${e.sequence}`,
    `SUMMARY:${icsText(e.title)}`,
    ...(e.description ? [`DESCRIPTION:${icsText(e.description + (e.meetingUrl ? `\n\nJoin: ${e.meetingUrl}` : ''))}`] : e.meetingUrl ? [`DESCRIPTION:${icsText(`Join: ${e.meetingUrl}`)}`] : []),
    ...(e.location ? [`LOCATION:${icsText(e.location)}`] : []),
    ...(e.meetingUrl ? [`URL:${e.meetingUrl}`] : []),
    `ORGANIZER;CN=${icsText(organizer.name)}:mailto:${organizer.email}`,
    ...guests.map((g) => `ATTENDEE;CN=${icsText(g.name ?? g.email)};ROLE=${g.optional ? 'OPT-PARTICIPANT' : 'REQ-PARTICIPANT'};PARTSTAT=${({ pending: 'NEEDS-ACTION', accepted: 'ACCEPTED', tentative: 'TENTATIVE', declined: 'DECLINED' } as const)[g.response]};RSVP=TRUE:mailto:${g.email}`),
    `STATUS:${method === 'CANCEL' ? 'CANCELLED' : 'CONFIRMED'}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.join('\r\n') + '\r\n';
}

/**
 * Calendar (docs/ARCHITECTURE.md §71). Personal calendars belong to their person; team calendars follow the space
 * role (viewer sees, editor adds events, admin manages), like Mail. Invited people see the events they are on;
 * other people's time shows as busy only. Invitations go through the bell and the Mail module (with an .ics).
 */
@Injectable()
export class CalendarService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly perms: PermissionsService,
    private readonly notifications: NotificationsService,
    private readonly mail: MailboxService,
    private readonly realtime: RealtimeService,
  ) {}

  // ── Calendars ─────────────────────────────────────────────────────────────

  async ensurePersonal(actor: Actor, tx: Tx = this.db): Promise<Cal> {
    const [found] = await tx.select().from(calendars).where(eq(calendars.userId, actor.id));
    if (found) return found;
    const [row] = await tx.insert(calendars).values({ workspaceId: actor.workspaceId, kind: 'user', userId: actor.id, name: 'My Calendar', color: '#2563eb' }).onConflictDoNothing().returning();
    return row ?? (await tx.select().from(calendars).where(eq(calendars.userId, actor.id)))[0];
  }

  private permsOf(cal: Cal, actor: Actor, role: Role | null | undefined) {
    if (cal.kind === 'user') {
      const mine = cal.userId === actor.id;
      return { read: mine, write: mine, manage: mine };
    }
    return { read: can(role, 'viewer'), write: can(role, 'editor'), manage: can(role, 'admin') };
  }

  async list(actor: Actor): Promise<CalendarInfo[]> {
    const mine = await this.ensurePersonal(actor);
    const roles = await this.perms.spaceRoles(actor);
    const visible = [...roles].filter(([, r]) => can(r, 'viewer')).map(([id]) => id);
    const team = visible.length ? await this.db.select().from(calendars).where(and(eq(calendars.kind, 'space'), inArray(calendars.spaceId, visible))) : [];
    const owners = await loadUsers(this.db, [mine.userId]);
    return [mine, ...team.sort((a, b) => a.name.localeCompare(b.name))].map((c) => ({
      id: c.id,
      kind: c.kind,
      name: c.name,
      color: c.color,
      timezone: c.timezone,
      spaceId: c.spaceId,
      owner: c.userId ? owners.get(c.userId) ?? null : null,
      perms: this.permsOf(c, actor, c.spaceId ? roles.get(c.spaceId) : null),
    }));
  }

  private async calendar(actor: Actor, id: string, need: 'read' | 'write' | 'manage', tx: Tx = this.db) {
    const [cal] = await tx.select().from(calendars).where(eq(calendars.id, id));
    if (!cal || cal.workspaceId !== actor.workspaceId) throw new NotFoundException('Calendar not found');
    const role = cal.spaceId ? (await this.perms.spaceRoles(actor, tx)).get(cal.spaceId) : null;
    const p = this.permsOf(cal, actor, role);
    if (!p.read) throw new NotFoundException('Calendar not found');
    if (!p[need]) throw new ForbiddenException(need === 'write' ? 'Your role in the space lets you see this calendar, not add to it' : 'Only space admins manage this calendar');
    return cal;
  }

  /** A team calendar for a space (space admins). */
  async enableSpaceCalendar(actor: Actor, spaceId: string, input: { name?: string; color?: string }) {
    const role = await this.perms.requireSpace(actor, spaceId, 'viewer');
    if (!can(role, 'admin')) throw new ForbiddenException('Only space admins add a team calendar');
    const [has] = await this.db.select({ id: calendars.id }).from(calendars).where(eq(calendars.spaceId, spaceId));
    if (has) throw new BadRequestException('This space already has a calendar');
    const [sp] = await this.db.select({ name: spaces.name, color: spaces.color }).from(spaces).where(eq(spaces.id, spaceId));
    const [row] = await this.db
      .insert(calendars)
      .values({ workspaceId: actor.workspaceId, kind: 'space', spaceId, name: input.name?.trim() || sp.name, color: input.color ?? sp.color ?? PALETTE[0] })
      .returning();
    return { id: row.id };
  }

  async updateCalendar(actor: Actor, id: string, input: { name?: string; color?: string; timezone?: string }) {
    await this.calendar(actor, id, 'manage');
    if (input.timezone) this.checkTz(input.timezone);
    const set = Object.fromEntries(Object.entries({ name: input.name?.trim(), color: input.color, timezone: input.timezone }).filter(([, v]) => v));
    if (Object.keys(set).length) await this.db.update(calendars).set(set).where(eq(calendars.id, id));
  }

  private checkTz(tz: string) {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: tz });
    } catch {
      throw new BadRequestException(`Unknown time zone ${tz}`);
    }
  }

  // ── Reading events ────────────────────────────────────────────────────────

  /**
   * Occurrences between `from` and `to`: from the calendars you can read, the events you are invited to, and —
   * for `people` — the time of other people (busy only unless you could see the event anyway).
   */
  async range(actor: Actor, q: { from: string; to: string; calendarIds?: string[]; people?: string[] }): Promise<CalendarEventView[]> {
    const from = new Date(q.from);
    const to = new Date(q.to);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from) throw new BadRequestException('Give a valid from / to');
    if (to.getTime() - from.getTime() > 120 * DAY) throw new BadRequestException('Ask for at most 120 days at a time');
    const cals = await this.list(actor);
    const readable = cals.filter((c) => c.perms.read && (!q.calendarIds || q.calendarIds.includes(c.id))).map((c) => c.id);
    const people = (q.people ?? []).filter((p) => p !== actor.id);
    const theirCals = people.length ? await this.db.select({ id: calendars.id, userId: calendars.userId }).from(calendars).where(inArray(calendars.userId, people)) : [];
    const invited = await this.db.select({ eventId: eventAttendees.eventId, userId: eventAttendees.userId }).from(eventAttendees).where(inArray(eventAttendees.userId, [actor.id, ...people]));
    const mineInvites = new Set(invited.filter((i) => i.userId === actor.id).map((i) => i.eventId));
    const ids = [...new Set(invited.map((i) => i.eventId))];
    const calIds = [...new Set([...readable, ...theirCals.map((c) => c.id)])];
    const inRange = or(sql`${calendarEvents.recurrence} IS NOT NULL`, sql`${calendarEvents.endAt} > ${from.toISOString()}`);
    const rows = await this.db
      .select()
      .from(calendarEvents)
      .where(
        and(
          lt(calendarEvents.startAt, to.toISOString()),
          inRange,
          or(calIds.length ? inArray(calendarEvents.calendarId, calIds) : sql`false`, ids.length ? inArray(calendarEvents.id, ids) : sql`false`),
        ),
      );
    // Invites seen through someone else's calendar must still belong to this workspace.
    const allCals = rows.length ? await this.db.select().from(calendars).where(inArray(calendars.id, [...new Set(rows.map((r) => r.calendarId))])) : [];
    const calById = new Map(allCals.map((c) => [c.id, c]));
    const ok = rows.filter((r) => calById.get(r.calendarId)?.workspaceId === actor.workspaceId);
    const views = await this.views(actor, ok, calById, (e) => readable.includes(e.calendarId) || mineInvites.has(e.id));
    const out: CalendarEventView[] = [];
    for (const v of views) {
      const base = ok.find((r) => r.id === v.id)!;
      const len = new Date(base.endAt).getTime() - new Date(base.startAt).getTime();
      const starts = base.recurrence ? occurrences(new Date(base.startAt), base.timezone, base.recurrence, from, to, base.exdates) : [new Date(base.startAt)];
      for (const s of starts) {
        const e = new Date(s.getTime() + len);
        if (e <= from || s >= to) continue;
        out.push({ ...v, occurrence: s.toISOString(), start: s.toISOString(), end: e.toISOString() });
      }
    }
    return out.sort((a, b) => a.start.localeCompare(b.start));
  }

  async get(actor: Actor, id: string): Promise<CalendarEventView> {
    const { ev, visible } = await this.readable(actor, id);
    const [cal] = await this.db.select().from(calendars).where(eq(calendars.id, ev.calendarId));
    const [v] = await this.views(actor, [ev], new Map([[cal.id, cal]]), () => visible);
    return v;
  }

  private async readable(actor: Actor, id: string) {
    const [ev] = await this.db.select().from(calendarEvents).where(eq(calendarEvents.id, id));
    if (!ev) throw new NotFoundException('Event not found');
    const [cal] = await this.db.select().from(calendars).where(eq(calendars.id, ev.calendarId));
    if (!cal || cal.workspaceId !== actor.workspaceId) throw new NotFoundException('Event not found');
    const role = cal.spaceId ? (await this.perms.spaceRoles(actor)).get(cal.spaceId) : null;
    const p = this.permsOf(cal, actor, role);
    const [inv] = await this.db.select().from(eventAttendees).where(and(eq(eventAttendees.eventId, id), eq(eventAttendees.userId, actor.id)));
    if (!p.read && !inv) throw new NotFoundException('Event not found');
    return { ev, cal, perms: p, invite: inv ?? null, visible: true };
  }

  private async views(actor: Actor, rows: Ev[], cals: Map<string, Cal>, visible: (e: Ev) => boolean): Promise<CalendarEventView[]> {
    if (!rows.length) return [];
    const atts = await this.db.select().from(eventAttendees).where(inArray(eventAttendees.eventId, rows.map((r) => r.id)));
    const people = await loadUsers(this.db, [...rows.map((r) => r.organizerId), ...atts.map((a) => a.userId)]);
    const roles = await this.perms.spaceRoles(actor);
    const files = [...new Set(rows.flatMap((r) => r.attachments))];
    const res = files.length ? await this.db.select().from(resources).where(inArray(resources.id, files)) : [];
    const resRoles = await this.perms.rolesFor(actor, res);
    return rows.map((r) => {
      const cal = cals.get(r.calendarId)!;
      const see = visible(r) && (r.visibility !== 'private' || cal.userId === actor.id || atts.some((a) => a.eventId === r.id && a.userId === actor.id));
      const mine = atts.find((a) => a.eventId === r.id && a.userId === actor.id);
      const canEdit = this.permsOf(cal, actor, cal.spaceId ? roles.get(cal.spaceId) : null).write;
      const base = {
        id: r.id,
        occurrence: r.startAt,
        calendarId: r.calendarId,
        kind: r.kind,
        start: r.startAt,
        end: r.endAt,
        allDay: r.allDay,
        timezone: r.timezone,
        recurrence: r.recurrence,
        color: r.color,
      };
      if (!see)
        return {
          ...base,
          title: r.kind === 'ooo' ? 'Out of office' : 'Busy',
          description: null,
          location: null,
          meetingUrl: null,
          meetingProvider: null,
          organizer: null,
          attendees: [],
          myResponse: null,
          attachments: [],
          canEdit: false,
          busyOnly: true,
        };
      return {
        ...base,
        title: r.title,
        description: r.description,
        location: r.location,
        meetingUrl: r.meetingUrl,
        meetingProvider: r.meetingProvider,
        organizer: r.organizerId ? people.get(r.organizerId) ?? null : null,
        attendees: atts
          .filter((a) => a.eventId === r.id)
          .map((a) => ({ id: a.id, email: a.email, name: a.name, user: a.userId ? people.get(a.userId) ?? null : null, response: a.response, optional: a.optional })),
        myResponse: mine?.response ?? null,
        attachments: r.attachments.map((id) => {
          const f = res.find((x) => x.id === id);
          const okRole = !!f && can(resRoles.get(id), 'viewer');
          return { id, name: okRole ? f.name : null, type: okRole ? f.type : null, accessible: okRole };
        }),
        canEdit,
        busyOnly: false,
      };
    });
  }

  // ── Writing ───────────────────────────────────────────────────────────────

  private async guestsOf(actor: Actor, list: EventInput['guests'], tx: Tx) {
    const clean = new Map<string, { email: string; name: string | null; optional: boolean; userId: string | null }>();
    const wsUsers = await tx
      .select({ id: users.id, email: users.email, name: users.name })
      .from(users)
      .innerJoin(workspaceMembers, eq(workspaceMembers.userId, users.id))
      .where(eq(workspaceMembers.workspaceId, actor.workspaceId));
    for (const g of list ?? []) {
      const email = g.email.trim().toLowerCase();
      if (!EMAIL.test(email)) throw new BadRequestException(`"${g.email}" is not an e-mail address`);
      const u = wsUsers.find((x) => x.email.toLowerCase() === email);
      clean.set(email, { email, name: g.name?.trim() || u?.name || null, optional: !!g.optional, userId: u?.id ?? null });
    }
    return [...clean.values()];
  }

  private times(input: Pick<EventInput, 'start' | 'end' | 'allDay' | 'timezone'>) {
    const tz = input.timezone ?? 'Asia/Tokyo';
    this.checkTz(tz);
    let start = new Date(input.start);
    let end = new Date(input.end);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) throw new BadRequestException('Invalid start or end');
    if (input.allDay) {
      // Whole days in the event's zone: midnight to midnight (end exclusive, at least one day).
      const s = zonedParts(start, tz);
      const e = zonedParts(end, tz);
      start = zonedToUtc(s.y, s.m, s.d, 0, 0, tz);
      end = zonedToUtc(e.y, e.m, e.d, 0, 0, tz);
      if (end <= start) end = zonedToUtc(s.y, s.m, s.d + 1, 0, 0, tz);
    }
    if (end <= start) throw new BadRequestException('The end must be after the start');
    if (end.getTime() - start.getTime() > 366 * DAY) throw new BadRequestException('An event lasts at most a year');
    return { startAt: start.toISOString(), endAt: end.toISOString(), timezone: tz };
  }

  private meeting(m: EventInput['meeting']) {
    if (!m) return { meetingUrl: null, meetingProvider: null };
    if (m.provider === 'kaori') {
      // Video rooms open with the Meetings module; the link is stable from now on.
      const code = `${Math.random().toString(36).slice(2, 5)}-${Math.random().toString(36).slice(2, 6)}-${Math.random().toString(36).slice(2, 5)}`;
      return { meetingUrl: `${config.webOrigin}/meetings?room=${code}`, meetingProvider: 'kaori' as const };
    }
    if (!m.url || !/^https?:\/\/\S+$/.test(m.url)) throw new BadRequestException('Give the meeting link');
    return { meetingUrl: m.url, meetingProvider: m.provider };
  }

  private async checkFiles(actor: Actor, ids: string[] | undefined, tx: Tx) {
    if (!ids?.length) return [];
    const rows = await tx.select().from(resources).where(and(inArray(resources.id, ids), eq(resources.workspaceId, actor.workspaceId)));
    const roles = await this.perms.rolesFor(actor, rows, tx);
    for (const id of ids) if (!can(roles.get(id), 'viewer')) throw new NotFoundException('File not found');
    return [...new Set(ids)];
  }

  async create(actor: Actor, input: EventInput): Promise<CalendarEventView> {
    const cal = await this.calendar(actor, input.calendarId, 'write');
    const t = this.times(input);
    const ev = await this.db.transaction(async (tx) => {
      const guests = await this.guestsOf(actor, input.guests, tx);
      const [row] = await tx
        .insert(calendarEvents)
        .values({
          calendarId: cal.id,
          kind: input.kind ?? 'event',
          title: input.title.trim() || (input.kind === 'focus' ? 'Focus time' : input.kind === 'ooo' ? 'Out of office' : '(no title)'),
          description: input.description?.trim() || null,
          location: input.location?.trim() || null,
          ...t,
          allDay: !!input.allDay,
          recurrence: this.cleanRec(input.recurrence),
          ...this.meeting(input.meeting),
          color: input.color ?? null,
          organizerId: actor.id,
          attachments: await this.checkFiles(actor, input.attachments, tx),
        })
        .returning();
      // The organizer is a guest who has said yes.
      const [me] = await tx.select({ email: users.email, name: users.name }).from(users).where(eq(users.id, actor.id));
      const all = [{ email: me.email.toLowerCase(), name: me.name, optional: false, userId: actor.id }, ...guests.filter((g) => g.email !== me.email.toLowerCase())];
      await tx.insert(eventAttendees).values(all.map((g) => ({ eventId: row.id, ...g, response: g.userId === actor.id ? ('accepted' as const) : ('pending' as const), respondedAt: g.userId === actor.id ? row.createdAt : null })));
      return row;
    });
    await this.announce(actor, ev, input.notify !== false, input.message ?? null, 'invite');
    return this.get(actor, ev.id);
  }

  private cleanRec(r: Recurrence | null | undefined): Recurrence | null {
    if (!r) return null;
    return { freq: r.freq, interval: Math.min(Math.max(1, Math.floor(r.interval || 1)), 99), until: r.until ?? null, count: r.count ? Math.min(r.count, 1000) : null, ...(r.freq === 'weekly' && r.byDay?.length ? { byDay: [...new Set(r.byDay)].filter((d) => d >= 0 && d <= 6) } : {}) };
  }

  /** Changes the whole event (every occurrence of a series). Guests hear about it when `notify`. */
  async update(actor: Actor, id: string, input: Partial<EventInput>) {
    const { ev, cal } = await this.readable(actor, id);
    await this.calendar(actor, cal.id, 'write');
    if (input.calendarId && input.calendarId !== cal.id) await this.calendar(actor, input.calendarId, 'write');
    const set: Partial<Ev> = { updatedAt: new Date().toISOString(), sequence: ev.sequence + 1 };
    if (input.title !== undefined) set.title = input.title.trim() || '(no title)';
    if (input.description !== undefined) set.description = input.description?.trim() || null;
    if (input.location !== undefined) set.location = input.location?.trim() || null;
    if (input.kind) set.kind = input.kind;
    if (input.color !== undefined) set.color = input.color;
    if (input.calendarId) set.calendarId = input.calendarId;
    if (input.recurrence !== undefined) set.recurrence = this.cleanRec(input.recurrence);
    if (input.start || input.end || input.allDay !== undefined || input.timezone) {
      Object.assign(set, this.times({ start: input.start ?? ev.startAt, end: input.end ?? ev.endAt, allDay: input.allDay ?? ev.allDay, timezone: input.timezone ?? ev.timezone }));
      if (input.allDay !== undefined) set.allDay = input.allDay;
    }
    if (input.meeting !== undefined) Object.assign(set, input.meeting && ev.meetingProvider === input.meeting.provider && input.meeting.provider === 'kaori' ? {} : this.meeting(input.meeting));
    const added: string[] = [];
    await this.db.transaction(async (tx) => {
      if (input.attachments) set.attachments = await this.checkFiles(actor, input.attachments, tx);
      await tx.update(calendarEvents).set(set).where(eq(calendarEvents.id, id));
      if (input.guests) {
        const guests = await this.guestsOf(actor, input.guests, tx);
        const current = await tx.select().from(eventAttendees).where(eq(eventAttendees.eventId, id));
        const organizer = current.find((a) => a.userId === ev.organizerId);
        const keep = new Set([...guests.map((g) => g.email), ...(organizer ? [organizer.email] : [])]);
        const gone = current.filter((a) => !keep.has(a.email));
        if (gone.length) await tx.delete(eventAttendees).where(inArray(eventAttendees.id, gone.map((g) => g.id)));
        for (const g of guests) {
          const had = current.find((a) => a.email === g.email);
          if (had) await tx.update(eventAttendees).set({ optional: g.optional }).where(eq(eventAttendees.id, had.id));
          else {
            await tx.insert(eventAttendees).values({ eventId: id, ...g });
            added.push(g.email);
          }
        }
      }
    });
    const [fresh] = await this.db.select().from(calendarEvents).where(eq(calendarEvents.id, id));
    await this.announce(actor, fresh, input.notify !== false, input.message ?? null, 'update');
    return this.get(actor, id);
  }

  /** Removes one occurrence of a series (`occurrence`) or the whole event; guests are told it is cancelled. */
  async remove(actor: Actor, id: string, occurrence?: string, notify = true) {
    const { ev, cal } = await this.readable(actor, id);
    await this.calendar(actor, cal.id, 'write');
    if (occurrence && ev.recurrence) {
      const at = new Date(occurrence).toISOString();
      await this.db.update(calendarEvents).set({ exdates: [...new Set([...ev.exdates, at])], sequence: ev.sequence + 1, updatedAt: new Date().toISOString() }).where(eq(calendarEvents.id, id));
    } else {
      if (notify) await this.announce(actor, ev, true, null, 'cancel');
      await this.db.delete(calendarEvents).where(eq(calendarEvents.id, id));
    }
    await this.changed(actor, ev);
  }

  /** Accept / maybe / decline. The organizer hears about it. */
  async respond(actor: Actor, id: string, response: Exclude<EventResponse, 'pending'>) {
    const { ev, invite } = await this.readable(actor, id);
    if (!invite) throw new BadRequestException('You are not invited to this event');
    await this.db.update(eventAttendees).set({ response, respondedAt: new Date().toISOString() }).where(eq(eventAttendees.id, invite.id));
    if (ev.organizerId && ev.organizerId !== actor.id) {
      const verb = { accepted: 'accepted', tentative: 'might attend', declined: 'declined' }[response];
      await this.notifications
        .notify(actor, [ev.organizerId], { kind: 'calendar.response', title: `${actor.name} ${verb} "${ev.title}"`, body: null, url: `/calendar?event=${ev.id}` })
        .catch(() => undefined);
    }
    await this.changed(actor, ev);
    return this.get(actor, id);
  }

  private async changed(actor: Actor, ev: Ev) {
    const atts = await this.db.select({ userId: eventAttendees.userId }).from(eventAttendees).where(eq(eventAttendees.eventId, ev.id));
    const [cal] = await this.db.select().from(calendars).where(eq(calendars.id, ev.calendarId));
    const ids = new Set<string>([actor.id, ...atts.map((a) => a.userId).filter((x): x is string => !!x)]);
    if (cal?.userId) ids.add(cal.userId);
    if (cal?.spaceId) for (const u of await this.perms.spaceReaders(cal.spaceId)) ids.add(u);
    this.realtime.publish(ids, { type: 'calendar.changed' });
  }

  /**
   * Tells the guests: a bell entry for people of the workspace and a mail with the .ics for everyone (inside
   * through the Mail module, outside over SMTP), sent from the organizer's mailbox.
   */
  private async announce(actor: Actor, ev: Ev, notify: boolean, message: string | null, what: 'invite' | 'update' | 'cancel') {
    await this.changed(actor, ev);
    if (!notify) return;
    const guests = (await this.db.select().from(eventAttendees).where(eq(eventAttendees.eventId, ev.id))).filter((g) => g.userId !== actor.id);
    if (!guests.length) return;
    const when = this.when(ev);
    const title = { invite: `${actor.name} invited you to "${ev.title}"`, update: `${actor.name} changed "${ev.title}"`, cancel: `${actor.name} cancelled "${ev.title}"` }[what];
    await this.notifications
      .notify(actor, guests.map((g) => g.userId).filter((x): x is string => !!x), { kind: 'calendar.invite', title, body: when, url: what === 'cancel' ? '/calendar' : `/calendar?event=${ev.id}` })
      .catch(() => undefined);
    try {
      const box = await this.mail.ensurePersonal(actor);
      const [me] = await this.db.select({ email: users.email, name: users.name }).from(users).where(eq(users.id, actor.id));
      const all = await this.db.select().from(eventAttendees).where(eq(eventAttendees.eventId, ev.id));
      const ics = toIcs(ev, { name: me.name, email: box.address }, all, what === 'cancel' ? 'CANCEL' : 'REQUEST', box.address.split('@')[1]);
      const file = await this.mail.upload(actor, { originalname: what === 'cancel' ? 'cancel.ics' : 'invite.ics', buffer: Buffer.from(ics), mimetype: 'text/calendar', size: Buffer.byteLength(ics) });
      const lines = [
        ...(message?.trim() ? [message.trim(), ''] : []),
        `${ev.title}`,
        when,
        ...(ev.location ? [`Where: ${ev.location}`] : []),
        ...(ev.meetingUrl ? [`Join: ${ev.meetingUrl}`] : []),
        ...(ev.description ? ['', ev.description] : []),
        '',
        what === 'cancel' ? 'This event has been cancelled.' : `Reply in Master Office: ${config.webOrigin}/calendar?event=${ev.id}`,
      ];
      await this.mail.send(actor, {
        mailboxId: box.id,
        to: guests.map((g) => ({ address: g.email, name: g.name })),
        subject: { invite: `Invitation: ${ev.title}`, update: `Updated invitation: ${ev.title}`, cancel: `Cancelled: ${ev.title}` }[what] + ` — ${when}`,
        text: lines.join('\n'),
        attachmentIds: [file.id],
      });
    } catch {
      /* the event stands even if the mail could not go out */
    }
  }

  private when(ev: Ev) {
    const opts: Intl.DateTimeFormatOptions = { timeZone: ev.timezone, weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' };
    const day = new Intl.DateTimeFormat('en-US', opts).format(new Date(ev.startAt));
    if (ev.allDay) return `${day} (all day)`;
    const t = (d: string) => new Intl.DateTimeFormat('en-US', { timeZone: ev.timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(d));
    return `${day}, ${t(ev.startAt)} – ${t(ev.endAt)} (${ev.timezone})${ev.recurrence ? `, repeats ${ev.recurrence.freq}` : ''}`;
  }

  /** People to overlay ("People" panel): everyone in the workspace. */
  async people(actor: Actor): Promise<UserSummary[]> {
    const rows = await this.db
      .select({ id: users.id, name: users.name, email: users.email, avatarColor: users.avatarColor, title: users.title, department: users.department })
      .from(users)
      .innerJoin(workspaceMembers, eq(workspaceMembers.userId, users.id))
      .where(eq(workspaceMembers.workspaceId, actor.workspaceId));
    return rows.filter((r) => r.id !== actor.id).sort((a, b) => a.name.localeCompare(b.name));
  }
}
