import { Injectable } from '@nestjs/common';
import type { AppNotification, NotificationKind, ResourceType } from '@workos/shared';
import { and, desc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import type { Actor } from '../common/current-user';
import { loadUsers } from '../common/users';
import type { Db, Tx } from '../db/client';
import { InjectDb } from '../db/db.module';
import { notifications } from '../db/schema';
import { RealtimeService } from '../realtime/realtime.service';

type Row = typeof notifications.$inferSelect;

/** In-app path of a resource — the server's copy of the web app's hrefFor (docs/ARCHITECTURE.md §3.1). */
export function resourcePath(r: { id: string; type: ResourceType; metadata?: Record<string, unknown> | null }) {
  if (r.metadata?.app === 'flow') return '/flow';
  const route: Partial<Record<ResourceType, string>> = {
    folder: 'drive/folder',
    document: 'docs',
    spreadsheet: 'sheets',
    presentation: 'slides',
    wiki: 'wiki',
    note: 'notes',
    form: 'forms',
    base: 'base',
  };
  return `/${route[r.type] ?? 'preview'}/${r.id}`;
}

export interface NotifyInput {
  kind: NotificationKind;
  title: string;
  body?: string | null;
  url: string;
  resourceId?: string | null;
  conversationId?: string | null;
  messageId?: string | null;
}

/**
 * The notification inbox behind the bell (§66). Written after the change it reports (never inside a failing
 * transaction), pushed to the person's open tabs over the realtime socket.
 */
@Injectable()
export class NotificationsService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly realtime: RealtimeService,
  ) {}

  /** Notifies people (never the actor themself). */
  async notify(actor: Actor, userIds: Iterable<string>, input: NotifyInput, tx: Tx = this.db) {
    const to = [...new Set(userIds)].filter((u) => u !== actor.id);
    if (!to.length) return;
    const rows = await tx
      .insert(notifications)
      .values(
        to.map((userId) => ({
          userId,
          kind: input.kind,
          actorId: actor.id,
          title: input.title.slice(0, 300),
          body: input.body ? input.body.slice(0, 500) : null,
          url: input.url,
          resourceId: input.resourceId ?? null,
          conversationId: input.conversationId ?? null,
          messageId: input.messageId ?? null,
        })),
      )
      .returning();
    const people = await loadUsers(tx, [actor.id]);
    for (const r of rows) this.realtime.publish([r.userId], { type: 'notification', notification: this.dto(r, people) });
  }

  private dto(r: Row, people: Map<string, import('@workos/shared').UserSummary>): AppNotification {
    return {
      id: r.id,
      kind: r.kind as NotificationKind,
      actor: r.actorId ? people.get(r.actorId) ?? null : null,
      title: r.title,
      body: r.body,
      url: r.url,
      resourceId: r.resourceId,
      conversationId: r.conversationId,
      readAt: r.readAt,
      createdAt: r.createdAt,
    };
  }

  async list(actor: Actor, opts: { unread?: boolean; limit?: number }) {
    const rows = await this.db
      .select()
      .from(notifications)
      .where(and(eq(notifications.userId, actor.id), opts.unread ? isNull(notifications.readAt) : undefined))
      .orderBy(desc(notifications.createdAt))
      .limit(Math.min(opts.limit ?? 50, 200));
    const people = await loadUsers(this.db, rows.map((r) => r.actorId));
    return rows.map((r) => this.dto(r, people));
  }

  async unreadCount(actor: Actor) {
    const [{ n }] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(notifications)
      .where(and(eq(notifications.userId, actor.id), isNull(notifications.readAt)));
    return { unread: n };
  }

  async markRead(actor: Actor, ids: string[] | 'all') {
    const where = and(eq(notifications.userId, actor.id), isNull(notifications.readAt), ids === 'all' ? undefined : inArray(notifications.id, ids.length ? ids : ['00000000-0000-0000-0000-000000000000']));
    const rows = await this.db.update(notifications).set({ readAt: sql`now()` }).where(where).returning({ id: notifications.id });
    // Other tabs of the same person clear their badge too.
    this.realtime.publish([actor.id], { type: 'notification.read', ids: ids === 'all' ? 'all' : rows.map((r) => r.id) });
    return { read: rows.length };
  }

  /** Reading messages in chat (scrolling past them, opening their thread) reads their bell entries. */
  async readMessages(actor: Actor, messageIds: SQL) {
    const rows = await this.db
      .update(notifications)
      .set({ readAt: sql`now()` })
      .where(and(eq(notifications.userId, actor.id), isNull(notifications.readAt), sql`${notifications.messageId} IN (${messageIds})`))
      .returning({ id: notifications.id });
    if (rows.length) this.realtime.publish([actor.id], { type: 'notification.read', ids: rows.map((r) => r.id) });
  }
}
