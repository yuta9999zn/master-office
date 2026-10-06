import { zonedParts, zonedToUtc } from '@workos/shared';
import type { Db } from './client';
import * as s from './schema';

type User = typeof s.users.$inferSelect;
const TZ = 'Asia/Tokyo';

/**
 * Calendar demo data after "giao diện calender.png" (§71): personal calendars, team calendars for spaces, and the
 * week around today — Team Meeting (weekly), ITM Japan Meeting with guests in every state, reviews, trainings.
 */
export async function seedCalendar(db: Db, workspaceId: string, u: Record<string, User>, spaceId: (name: string) => string, fileId: (name: string) => Promise<string>, origin: string) {
  const cal: Record<string, string> = {};
  for (const [key, user] of Object.entries(u)) {
    const [row] = await db.insert(s.calendars).values({ workspaceId, kind: 'user', userId: user.id, name: 'My Calendar', color: '#2563eb' }).returning();
    cal[key] = row.id;
  }
  const team = async (key: string, space: string, name: string, color: string) => {
    const [row] = await db.insert(s.calendars).values({ workspaceId, kind: 'space', spaceId: spaceId(space), name, color }).returning();
    cal[key] = row.id;
  };
  await team('all', 'Natural Beauty', 'Natural Beauty - All', '#2563eb');
  await team('marketing', 'Marketing', 'Marketing', '#ec4899');
  await team('operations', 'Operations', 'Operations', '#f59e0b');
  await team('b575', 'Branch 575', 'Branch 575', '#10b981');
  await team('b625', 'Branch 625', 'Branch 625', '#ef4444');
  await team('hr', 'HR', 'HR', '#8b5cf6');

  // Sunday of this week, in Tokyo.
  const now = zonedParts(new Date(), TZ);
  const sunday = new Date(Date.UTC(now.y, now.m - 1, now.d - now.weekday));
  const at = (dayOfWeek: number, h: number, mi = 0) => {
    const d = new Date(sunday.getTime() + dayOfWeek * 86_400_000);
    return zonedToUtc(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), h, mi, TZ).toISOString();
  };

  async function event(o: {
    cal: string;
    organizer: string;
    title: string;
    day: number;
    from: [number, number];
    to: [number, number];
    guests?: [string, 'pending' | 'accepted' | 'tentative' | 'declined'][];
    location?: string;
    online?: boolean;
    description?: string;
    weekly?: boolean;
    kind?: 'event' | 'focus' | 'ooo';
    allDay?: boolean;
    files?: string[];
  }) {
    const code = Math.random().toString(36).slice(2, 12).replace(/(.{3})(.{4})(.{3})/, '$1-$2-$3');
    const [ev] = await db
      .insert(s.calendarEvents)
      .values({
        calendarId: cal[o.cal],
        kind: o.kind ?? 'event',
        title: o.title,
        description: o.description ?? null,
        location: o.online ? 'Online (Kaori Meet)' : o.location ?? null,
        startAt: o.allDay ? at(o.day, 0) : at(o.day, ...o.from),
        endAt: o.allDay ? at(o.day + 1, 0) : at(o.day, ...o.to),
        allDay: !!o.allDay,
        timezone: TZ,
        recurrence: o.weekly ? { freq: 'weekly', interval: 1, byDay: [o.day] } : null,
        meetingUrl: o.online ? `${origin}/meetings?room=${code}` : null,
        meetingProvider: o.online ? 'kaori' : null,
        organizerId: u[o.organizer].id,
        attachments: o.files ? await Promise.all(o.files.map(fileId)) : [],
      })
      .returning();
    const people = [[o.organizer, 'accepted'] as const, ...(o.guests ?? []).filter(([g]) => g !== o.organizer)];
    await db.insert(s.eventAttendees).values(people.map(([g, response]) => ({ eventId: ev.id, userId: u[g].id, email: u[g].email.toLowerCase(), name: u[g].name, response })));
  }

  await event({ cal: 'claudia', organizer: 'claudia', title: 'Team Meeting', day: 1, from: [9, 0], to: [10, 0], online: true, weekly: true, guests: [['hana', 'accepted'], ['mika', 'accepted'], ['yuki', 'accepted'], ['sora', 'tentative']] });
  await event({ cal: 'marketing', organizer: 'hana', title: 'Marketing Plan Review', day: 1, from: [11, 0], to: [12, 0], location: 'Meeting room A', guests: [['claudia', 'accepted'], ['mika', 'accepted'], ['minh', 'accepted']] });
  await event({ cal: 'b575', organizer: 'yuki', title: 'Branch 575 Operations', day: 1, from: [14, 0], to: [15, 0], location: 'Branch 575', guests: [['mika', 'accepted']] });
  await event({
    cal: 'claudia',
    organizer: 'claudia',
    title: 'ITM Japan Meeting',
    day: 2,
    from: [10, 30],
    to: [11, 30],
    online: true,
    guests: [['fujita', 'accepted'], ['huong', 'accepted'], ['mika', 'tentative'], ['yuki', 'pending']],
    description: '下記の内容について打ち合わせを行います。\n- 予約システムの進捗確認\n- 今後のスケジュール\n- 必要なサポートについて',
    files: ['Project Plan Sep.pptx'],
  });
  await event({ cal: 'claudia', organizer: 'claudia', title: 'Product Discussion', day: 2, from: [13, 0], to: [14, 0], guests: [['mika', 'accepted'], ['ken', 'pending']] });
  await event({ cal: 'all', organizer: 'rina', title: 'Staff Training', day: 2, from: [15, 30], to: [16, 30], location: 'Training room', guests: [['claudia', 'accepted'], ['ken', 'accepted'], ['sora', 'accepted']] });
  await event({ cal: 'hr', organizer: 'rina', title: 'HR Interview', day: 3, from: [9, 0], to: [10, 0], location: 'Meeting room B', guests: [['claudia', 'accepted']] });
  await event({ cal: 'claudia', organizer: 'minh', title: 'Design Review', day: 3, from: [11, 0], to: [12, 0], online: true, guests: [['claudia', 'accepted'], ['hana', 'accepted'], ['yuki', 'declined']] });
  await event({ cal: 'marketing', organizer: 'hana', title: 'Customer Feedback', day: 3, from: [14, 0], to: [15, 0], guests: [['claudia', 'tentative'], ['sora', 'accepted']] });
  await event({ cal: 'b625', organizer: 'sora', title: 'Branch 625 KPI Review', day: 4, from: [10, 0], to: [11, 0], location: 'Branch 625', guests: [['claudia', 'accepted'], ['mika', 'accepted']] });
  await event({ cal: 'claudia', organizer: 'fujita', title: 'Website Project', day: 4, from: [13, 0], to: [14, 0], online: true, guests: [['claudia', 'accepted'], ['minh', 'accepted']] });
  await event({ cal: 'claudia', organizer: 'claudia', title: '1:1 Meeting', day: 4, from: [16, 0], to: [17, 0], guests: [['hana', 'accepted']] });
  await event({ cal: 'marketing', organizer: 'hana', title: 'Marketing Sync', day: 5, from: [9, 30], to: [10, 30], online: true, guests: [['claudia', 'accepted'], ['minh', 'accepted']] });
  await event({ cal: 'fujita', organizer: 'fujita', title: 'System Planning', day: 5, from: [14, 0], to: [15, 0], online: true, guests: [['claudia', 'accepted'], ['ken', 'pending']] });
  await event({ cal: 'claudia', organizer: 'claudia', title: 'Focus time', kind: 'focus', day: 5, from: [16, 0], to: [17, 30] });
  await event({ cal: 'rina', organizer: 'rina', title: 'Out of office', kind: 'ooo', day: 5, from: [0, 0], to: [0, 0], allDay: true });
}
