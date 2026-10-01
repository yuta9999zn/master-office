import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { can, type CommentAnchor, type CommentThread } from '@workos/shared';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { Actor } from '../common/current-user';
import { loadUsers } from '../common/users';
import type { Db } from '../db/client';
import { InjectDb } from '../db/db.module';
import { comments } from '../db/schema';
import { CollabService } from '../collab/collab.service';
import { EventsService } from '../events/events.service';
import { PermissionsService } from '../permissions/permissions.service';

type Row = typeof comments.$inferSelect;

/** Document comments (docs/ARCHITECTURE.md §7.1). Kept outside the Yjs doc so commenters never need write access. */
@Injectable()
export class CommentsService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly perms: PermissionsService,
    private readonly events: EventsService,
    private readonly collab: CollabService,
  ) {}

  async list(actor: Actor, resourceId: string): Promise<CommentThread[]> {
    await this.perms.require(actor, resourceId, 'viewer');
    const rows = await this.db.select().from(comments).where(eq(comments.resourceId, resourceId)).orderBy(asc(comments.createdAt));
    const people = await loadUsers(this.db, rows.flatMap((r) => [r.authorId, r.resolvedBy]));
    const reply = (r: Row) => ({ id: r.id, author: people.get(r.authorId)!, body: r.body, createdAt: r.createdAt, editedAt: r.editedAt });
    return rows
      .filter((r) => !r.threadId)
      .map((r) => ({
        ...reply(r),
        anchor: (r.anchor as CommentAnchor | null) ?? null,
        quote: r.quote,
        resolvedAt: r.resolvedAt,
        resolvedBy: r.resolvedBy ? people.get(r.resolvedBy) ?? null : null,
        replies: rows.filter((c) => c.threadId === r.id).map(reply),
      }));
  }

  async create(actor: Actor, resourceId: string, input: { body: string; threadId?: string | null; anchor?: CommentAnchor | null; quote?: string | null }) {
    const { row: res } = await this.perms.require(actor, resourceId, 'commenter');
    if (input.threadId) {
      const [root] = await this.db.select().from(comments).where(and(eq(comments.id, input.threadId), eq(comments.resourceId, resourceId)));
      if (!root || root.threadId) throw new NotFoundException('Thread not found');
    }
    const [row] = await this.db
      .insert(comments)
      .values({
        resourceId,
        threadId: input.threadId ?? null,
        authorId: actor.id,
        body: input.body,
        anchor: input.threadId ? null : input.anchor ?? null,
        quote: input.threadId ? null : input.quote ?? null,
      })
      .returning();
    await this.events.emit(this.db, actor, 'comment.created', { resourceId, spaceId: res.spaceId }, { name: res.name, type: res.type, snippet: input.body.slice(0, 140), reply: !!input.threadId });
    this.collab.notify(resourceId, { type: 'comments' });
    return { id: row.id };
  }

  private async load(actor: Actor, id: string) {
    const [row] = await this.db.select().from(comments).where(eq(comments.id, id));
    if (!row) throw new NotFoundException('Comment not found');
    const { role } = await this.perms.require(actor, row.resourceId, 'viewer');
    return { row, role };
  }

  async update(actor: Actor, id: string, input: { body?: string; resolved?: boolean }) {
    const { row, role } = await this.load(actor, id);
    if (input.body !== undefined) {
      if (row.authorId !== actor.id) throw new ForbiddenException('Only the author can edit a comment');
      await this.db.update(comments).set({ body: input.body, editedAt: sql`now()` }).where(eq(comments.id, id));
    }
    if (input.resolved !== undefined) {
      if (!can(role, 'commenter')) throw new ForbiddenException('Requires comment access');
      await this.db
        .update(comments)
        .set(input.resolved ? { resolvedAt: sql`now()`, resolvedBy: actor.id } : { resolvedAt: null, resolvedBy: null })
        .where(eq(comments.id, row.threadId ?? id));
    }
    this.collab.notify(row.resourceId, { type: 'comments' });
  }

  async remove(actor: Actor, id: string) {
    const { row, role } = await this.load(actor, id);
    if (row.authorId !== actor.id && !can(role, 'admin')) throw new ForbiddenException('Only the author or an admin can delete a comment');
    await this.db.delete(comments).where(eq(comments.id, id));
    this.collab.notify(row.resourceId, { type: 'comments' });
  }
}
