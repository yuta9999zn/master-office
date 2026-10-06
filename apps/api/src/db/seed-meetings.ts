import { randomBytes } from 'node:crypto';
import { meetingCode } from '@workos/shared';
import type { Db } from './client';
import * as s from './schema';

type User = typeof s.users.$inferSelect;

/** Meetings demo data (§73): a few past meetings with who took part, how long, and their in-call chat. */
export async function seedMeetings(db: Db, workspaceId: string, u: Record<string, User>) {
  const day = 86400_000;
  const past = [
    { title: 'Weekly Ops Standup', host: 'mika', ago: 1, hour: 0, minutes: 32, people: ['mika', 'claudia', 'yuki', 'sora', 'ken'], chat: [['yuki', 'Inventory sheet is updated for 575.'], ['mika', 'Thanks! Sora, can you check 625 by Friday?'], ['sora', 'Will do 👍']] },
    { title: 'Marketing Sync', host: 'hana', ago: 2, hour: 1, minutes: 45, people: ['hana', 'claudia', 'mika'], chat: [['hana', 'Slides for the autumn campaign are in Drive.']] },
    { title: 'ITM Japan — Project kickoff', host: 'fujita', ago: 5, hour: 4, minutes: 58, people: ['fujita', 'claudia', 'minh', 'hana'], chat: [] },
  ];
  for (const m of past) {
    const start = new Date(Date.now() - m.ago * day);
    start.setUTCHours(m.hour, 0, 0, 0);
    const end = new Date(start.getTime() + m.minutes * 60_000);
    const [row] = await db
      .insert(s.meetings)
      .values({ workspaceId, code: meetingCode(randomBytes(10)), title: m.title, hostId: u[m.host].id, createdBy: u[m.host].id, access: 'open', startedAt: start.toISOString(), endedAt: end.toISOString(), createdAt: start.toISOString() })
      .returning();
    await db.insert(s.meetingParticipants).values(
      m.people.map((p, i) => ({
        meetingId: row.id,
        userId: u[p].id,
        role: p === m.host ? ('host' as const) : ('guest' as const),
        status: 'joined' as const,
        firstJoinedAt: new Date(start.getTime() + i * 30_000).toISOString(),
        lastJoinedAt: new Date(start.getTime() + i * 30_000).toISOString(),
        lastLeftAt: end.toISOString(),
        seconds: m.minutes * 60 - i * 30,
      })),
    );
    if (m.chat.length)
      await db.insert(s.meetingMessages).values(m.chat.map(([who, body], i) => ({ meetingId: row.id, userId: u[who].id, body, createdAt: new Date(start.getTime() + (i + 2) * 60_000).toISOString() })));
  }
}
