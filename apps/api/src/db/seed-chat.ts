import { eq } from 'drizzle-orm';
import type { Db } from './client';
import * as s from './schema';

type User = typeof s.users.$inferSelect;
type Msg = {
  who: string;
  body: string;
  /** Minutes before now. */
  ago: number;
  system?: boolean;
  reactions?: [string, string[]][];
  replies?: { who: string; body: string; ago: number }[];
  /** Names of seeded files attached to the message. */
  files?: string[];
};

/**
 * Chat demo data mirroring the "Chat tổng quan" reference (over view 2.png): channels for spaces and projects,
 * a design group and a few direct messages. Claudia (the default dev user) has unread messages in two of them.
 */
export async function seedChat(db: Db, workspaceId: string, u: Record<string, User>, spaceId: (name: string) => string, fileId: (name: string) => Promise<string>) {
  const now = Date.now();
  let position = 0;
  const categories = new Map<string, string>();
  const categoryId = async (space: string, name: string) => {
    const key = space + '/' + name;
    if (!categories.has(key)) {
      const [row] = await db.insert(s.channelCategories).values({ spaceId: spaceId(space), name, position: categories.size }).returning();
      categories.set(key, row.id);
    }
    return categories.get(key)!;
  };
  const at = (ago: number) => new Date(now - ago * 60_000).toISOString();
  // "@hana" in seed text → the stored mention token.
  const fmt = (body: string) => body.replace(/@([a-z]+)\b/g, (m, k: string) => (u[k] ? `<@${u[k].id}>` : m));
  const mentionsOf = (body: string) => [...body.matchAll(/@([a-z]+)\b/g)].map((m) => u[m[1]]?.id).filter((x): x is string => !!x);

  async function conv(
    opts: { kind: 'dm' | 'group' | 'channel'; name?: string; description?: string; visibility?: 'public' | 'private'; space?: string; color?: string; owner: string; category?: string; announcements?: boolean },
    members: string[],
    msgs: Msg[],
    unread: Record<string, number> = {},
  ) {
    const ids = [...new Set([opts.owner, ...members])];
    const dmKey = opts.kind === 'dm' ? `${workspaceId}:${ids.map((k) => u[k].id).sort().join(':')}` : null;
    const [c] = await db
      .insert(s.conversations)
      .values({
        workspaceId,
        kind: opts.kind,
        name: opts.name ?? null,
        description: opts.description ?? null,
        visibility: opts.visibility ?? 'private',
        spaceId: opts.space ? spaceId(opts.space) : null,
        color: opts.color ?? null,
        categoryId: opts.category ? await categoryId(opts.space!, opts.category) : null,
        position: position++,
        postPolicy: opts.announcements ? 'admins' : 'all',
        dmKey,
        createdBy: u[opts.owner].id,
        createdAt: at(Math.max(...msgs.map((m) => m.ago)) + 5),
      })
      .returning();
    let seq = 0;
    const topSeqs: number[] = [];
    for (const m of msgs.sort((a, b) => b.ago - a.ago)) {
      const [row] = await db
        .insert(s.messages)
        .values({
          conversationId: c.id,
          seq: ++seq,
          senderId: u[m.who].id,
          kind: m.system ? 'system' : 'text',
          body: m.system ? m.body : fmt(m.body),
          mentions: m.system ? [] : mentionsOf(m.body),
          createdAt: at(m.ago),
          replyCount: m.replies?.length ?? 0,
          lastReplyAt: m.replies?.length ? at(Math.min(...m.replies.map((r) => r.ago))) : null,
        })
        .returning();
      if (!m.system) topSeqs.push(row.seq);
      for (const [position, name] of (m.files ?? []).entries()) await db.insert(s.messageRefs).values({ messageId: row.id, resourceId: await fileId(name), position });
      for (const [emoji, who] of m.reactions ?? []) await db.insert(s.messageReactions).values(who.map((k) => ({ messageId: row.id, userId: u[k].id, emoji })));
      for (const r of m.replies ?? [])
        await db.insert(s.messages).values({ conversationId: c.id, seq: ++seq, senderId: u[r.who].id, body: fmt(r.body), mentions: mentionsOf(r.body), threadRootId: row.id, createdAt: at(r.ago) });
    }
    const last = msgs.reduce((a, b) => (a.ago < b.ago ? a : b));
    await db.update(s.conversations).set({ lastSeq: seq, lastMessageAt: at(last.ago) }).where(eq(s.conversations.id, c.id));
    await db.insert(s.conversationMembers).values(
      ids.map((k) => {
        // Everyone has read everything except the `unread` newest top-level messages.
        const n = unread[k] ?? 0;
        const readTo = n ? topSeqs[topSeqs.length - n - 1] ?? 0 : seq;
        return { conversationId: c.id, userId: u[k].id, role: k === opts.owner ? ('owner' as const) : ('member' as const), lastReadSeq: readTo, joinedAt: at(Math.max(...msgs.map((m) => m.ago)) + 5) };
      }),
    );
    // Discord-style: a public channel holds everyone in its space (§68).
    if (opts.kind === 'channel' && opts.visibility === 'public') {
      const inSpace = await db.select({ id: s.spaceMembers.userId }).from(s.spaceMembers).where(eq(s.spaceMembers.spaceId, spaceId(opts.space!)));
      await db
        .insert(s.conversationMembers)
        .values(inSpace.map((m) => ({ conversationId: c.id, userId: m.id, lastReadSeq: seq })))
        .onConflictDoNothing();
    }
    return c;
  }

  const everyone = Object.keys(u);
  const day = 24 * 60;

  await conv(
    { kind: 'channel', name: 'General', description: 'Company-wide chat for everyone at HANAMI', visibility: 'public', color: '#f97316', owner: 'claudia', space: 'Sakura Beauty', category: 'Text channels' },
    everyone,
    [
      { who: 'claudia', body: 'created the channel General', ago: 20 * day, system: true },
      { who: 'claudia', body: 'Welcome to Master Office Chat, everyone! 👋', ago: 20 * day - 5, reactions: [['👋', ['hana', 'mika', 'yuki', 'sora']], ['🎉', ['minh', 'ken']]] },
      { who: 'ken', body: 'Welcome to the team, @huong! 🎉', ago: 2 * day + 60, reactions: [['🎉', ['claudia', 'huong', 'rina']]] },
    ],
  );
  await conv(
    { kind: 'channel', name: 'Announcements', description: 'Official news from the leadership team', visibility: 'public', color: '#2563eb', owner: 'claudia', space: 'Sakura Beauty', category: 'Information', announcements: true },
    everyone,
    [
      { who: 'claudia', body: 'created the channel Announcements', ago: 20 * day, system: true },
      { who: 'claudia', body: '**Q4 Company All-hands** this Friday at 10:00 (GMT+9). Agenda and dial-in are in the calendar invite.', ago: 3 * day, reactions: [['👍', ['hana', 'mika', 'fujita', 'yuki', 'sora', 'rina']]] },
      { who: 'claudia', body: 'Thông báo: lịch nghỉ lễ cuối năm đã được cập nhật trong Wiki HR.', ago: 15 * day },
    ],
  );
  await conv(
    { kind: 'channel', name: 'Marketing Team', description: 'Campaigns, SNS and brand assets', visibility: 'public', space: 'Marketing', color: '#2563eb', owner: 'hana', category: 'Text channels' },
    ['claudia', 'mika', 'minh', 'yuki', 'sora'],
    [
      { who: 'hana', body: 'created the channel Marketing Team', ago: 9 * day, system: true },
      {
        who: 'hana',
        files: ['Campaign Proposal'],
        body: 'Đây là concept mới cho chiến dịch tháng 10. Mọi người xem và góp ý nhé!',
        ago: 6 * 60,
        reactions: [['👍', ['mika', 'minh', 'yuki', 'sora', 'claudia']], ['❤️', ['minh', 'mika']]],
        replies: [
          { who: 'minh', body: 'Mình thích bảng màu thứ hai, nhìn rất tươi.', ago: 5 * 60 },
          { who: 'yuki', body: 'Branch 575 có thể chạy thử tuần đầu tiên.', ago: 4 * 60 + 30 },
        ],
      },
      { who: 'mika', body: 'Tôi đã tạo task cho phần này @yuki @sora — hạn chót Sep 28.', ago: 3 * 60 },
      { who: 'hana', body: 'Campaign assets are ready! 🚀', ago: 50 },
      { who: 'mika', body: 'Cập nhật kế hoạch tuần: chụp ảnh sản phẩm dời sang thứ Năm.', ago: 25 },
    ],
    { claudia: 2 },
  );
  await conv(
    { kind: 'channel', name: 'Mirai Systems - Project', description: 'Booking system and website with Mirai Systems', visibility: 'private', space: 'Mirai Systems', color: '#7c3aed', owner: 'fujita' },
    ['claudia', 'minh', 'mika'],
    [
      { who: 'fujita', body: 'created the channel Mirai Systems - Project', ago: 12 * day, system: true },
      { who: 'fujita', body: 'おはようございます。\n来週のミーティングについて、下記の時間で調整可能でしょうか？', ago: 70, files: ['Project Plan Sep.pptx'] },
      { who: 'claudia', body: 'はい、大丈夫です。\nこちらでカレンダーを作成します。', ago: 64, reactions: [['🙏', ['fujita']]] },
      { who: 'mika', body: 'Tôi sẽ chuẩn bị thêm báo cáo và gửi trước nhé.', ago: 60, files: ['Sales Report - September 2026'] },
      { who: 'fujita', body: 'ありがとうございます！資料は金曜日までにお願いします。', ago: 41 },
      { who: 'minh', body: 'The new booking screens are in the design file — @claudia can you take a look?', ago: 40 },
      { who: 'fujita', body: 'ありがとうございます！', ago: 39 },
    ],
    { claudia: 3 },
  );
  await conv({ kind: 'dm', owner: 'hana' }, ['claudia'], [
    { who: 'claudia', body: 'Hana, bạn gửi giúp mình file brand guideline mới nhất nhé?', ago: 2 * 60 + 10 },
    { who: 'hana', body: 'File đã gửi nhé', ago: 100 },
  ]);
  await conv({ kind: 'group', owner: 'claudia' }, ['yuki', 'minh', 'hana'], [
    { who: 'claudia', body: 'Design review for the autumn visuals — what time works?', ago: 4 * 60 },
    { who: 'yuki', body: 'Hẹn 15:00 nhé', ago: 3 * 60 + 30, reactions: [['👍', ['claudia', 'minh']]] },
  ]).then((c) => db.update(s.conversations).set({ name: 'Design Review' }).where(eq(s.conversations.id, c.id)));
  await conv(
    { kind: 'channel', name: 'Operations', description: 'Store operations, SOPs and checklists', visibility: 'public', space: 'Operations', color: '#f59e0b', owner: 'mika' },
    ['claudia', 'yuki', 'sora', 'ken'],
    [
      { who: 'mika', body: 'created the channel Operations', ago: 10 * day, system: true },
      { who: 'ken', body: 'Inventory check moved to Monday this week.', ago: day + 300 },
      { who: 'sora', body: 'Đã xử lý xong', ago: day + 120 },
    ],
  );
  await conv(
    { kind: 'channel', name: 'Branch 625', description: 'Station branch team', visibility: 'private', space: 'Branch 625', color: '#ef4444', owner: 'sora' },
    ['claudia', 'mika', 'rina'],
    [
      { who: 'sora', body: 'New staff schedule is posted.', ago: day + 200 },
      { who: 'rina', body: 'Thanks!', ago: day + 90 },
    ],
  );
  await conv({ kind: 'dm', owner: 'mika' }, ['claudia'], [{ who: 'mika', body: 'Hình ảnh thiết kế mới đã lên Drive, chị xem giúp em nhé.', ago: 16 * day }]);
  await conv({ kind: 'dm', owner: 'fujita' }, ['claudia'], [{ who: 'fujita', body: '来週もよろしくお願いします。', ago: 2 * day }]);
}
