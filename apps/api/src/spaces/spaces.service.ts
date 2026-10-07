import { BadRequestException, Injectable } from '@nestjs/common';
import { can, type ActivityEvent, type Role, type Space, type SpaceKind, type SpaceMember } from '@workos/shared';
import { and, asc, count, desc, eq } from 'drizzle-orm';
import type { Actor } from '../common/current-user';
import { loadUsers, userColumns } from '../common/users';
import type { Db } from '../db/client';
import { InjectDb } from '../db/db.module';
import { auditEvents, spaceMembers, spaces, users, workspaceMembers } from '../db/schema';
import { EventsService } from '../events/events.service';
import { PermissionsService } from '../permissions/permissions.service';
import { ChatService } from '../chat/chat.service';

type SpaceRow = typeof spaces.$inferSelect;

@Injectable()
export class SpacesService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly perms: PermissionsService,
    private readonly events: EventsService,
    private readonly chat: ChatService,
  ) {}

  private dto(s: SpaceRow, myRole: Role | null, memberCount?: number): Space {
    return {
      id: s.id,
      workspaceId: s.workspaceId,
      parentId: s.parentId,
      name: s.name,
      description: s.description,
      icon: s.icon,
      color: s.color,
      visibility: s.visibility,
      kind: s.kind as SpaceKind,
      createdAt: s.createdAt,
      myRole,
      memberCount,
    };
  }

  async list(actor: Actor): Promise<Space[]> {
    const [rows, roles, counts] = await Promise.all([
      this.db.select().from(spaces).where(eq(spaces.workspaceId, actor.workspaceId)).orderBy(asc(spaces.createdAt)),
      this.perms.spaceRoles(actor),
      this.db.select({ spaceId: spaceMembers.spaceId, n: count() }).from(spaceMembers).groupBy(spaceMembers.spaceId),
    ]);
    const n = new Map(counts.map((c) => [c.spaceId, c.n]));
    return rows.filter((s) => can(roles.get(s.id), 'viewer')).map((s) => this.dto(s, roles.get(s.id) ?? null, n.get(s.id) ?? 0));
  }

  async get(actor: Actor, id: string): Promise<Space> {
    const role = await this.perms.requireSpace(actor, id, 'viewer');
    const [row] = await this.db.select().from(spaces).where(eq(spaces.id, id));
    const [{ n }] = await this.db.select({ n: count() }).from(spaceMembers).where(eq(spaceMembers.spaceId, id));
    return this.dto(row, role, n);
  }

  async create(
    actor: Actor,
    input: { name: string; description?: string | null; parentId?: string | null; color?: string | null; visibility: 'public' | 'private'; kind?: SpaceKind },
  ) {
    if (input.parentId) await this.perms.requireSpace(actor, input.parentId, 'admin');
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(spaces)
        .values({
          workspaceId: actor.workspaceId,
          name: input.name,
          description: input.description,
          parentId: input.parentId,
          color: input.color ?? '#3370ff',
          icon: 'folder',
          visibility: input.visibility,
          kind: input.kind ?? 'team',
          createdBy: actor.id,
        })
        .returning();
      await tx.insert(spaceMembers).values({ spaceId: row.id, userId: actor.id, role: 'owner' });
      await this.events.emit(tx, actor, 'space.created', { spaceId: row.id }, { name: row.name });
      return this.dto(row, 'owner', 1);
    });
  }

  /** Name, description, kind, colour, visibility and place in the tree (§79). Moving under another space needs admin there too. */
  async update(actor: Actor, id: string, input: { name?: string; description?: string | null; kind?: SpaceKind; color?: string | null; visibility?: 'public' | 'private'; parentId?: string | null }) {
    await this.perms.requireSpace(actor, id, 'admin');
    if (input.parentId !== undefined && input.parentId !== null) {
      await this.perms.requireSpace(actor, input.parentId, 'admin');
      const all = await this.db.select({ id: spaces.id, parentId: spaces.parentId }).from(spaces).where(eq(spaces.workspaceId, actor.workspaceId));
      const parentOf = new Map(all.map((x) => [x.id, x.parentId]));
      for (let p: string | null | undefined = input.parentId, guard = 0; p && guard < 100; p = parentOf.get(p), guard++)
        if (p === id) throw new BadRequestException('A team cannot go under itself or one of its sub-teams');
    }
    const set = Object.fromEntries(Object.entries({ name: input.name?.trim(), description: input.description, kind: input.kind, color: input.color, visibility: input.visibility, parentId: input.parentId }).filter(([, v]) => v !== undefined));
    if (set.name === '') throw new BadRequestException('Enter a name');
    if (Object.keys(set).length) await this.db.update(spaces).set(set).where(eq(spaces.id, id));
    return this.get(actor, id);
  }

  async members(actor: Actor, id: string): Promise<SpaceMember[]> {
    await this.perms.requireSpace(actor, id, 'viewer');
    const rows = await this.db
      .select({ user: userColumns, role: spaceMembers.role, title: spaceMembers.title })
      .from(spaceMembers)
      .innerJoin(users, eq(users.id, spaceMembers.userId))
      .where(eq(spaceMembers.spaceId, id));
    const order = ['owner', 'admin', 'editor', 'commenter', 'viewer'];
    return rows.sort((a, b) => order.indexOf(a.role) - order.indexOf(b.role) || a.user.name.localeCompare(b.user.name, 'vi'));
  }

  /** Adds, changes or (role null) removes a member. Leads (space admins) do it; `title` is the position in this team. */
  async setMember(actor: Actor, id: string, userId: string, role: Role | null, title?: string | null) {
    await this.perms.requireSpace(actor, id, 'admin');
    const [inWs] = await this.db.select({ id: workspaceMembers.userId }).from(workspaceMembers).where(and(eq(workspaceMembers.workspaceId, actor.workspaceId), eq(workspaceMembers.userId, userId)));
    if (!inWs) throw new BadRequestException('Not a member of this organisation — invite them first');
    const pos = title === undefined ? undefined : title?.trim().slice(0, 80) || null;
    await this.db.transaction(async (tx) => {
      const [cur] = await tx.select().from(spaceMembers).where(and(eq(spaceMembers.spaceId, id), eq(spaceMembers.userId, userId)));
      if (role === 'owner' && cur?.role !== 'owner') throw new BadRequestException('Use ownership transfer');
      if (cur?.role === 'owner' && role !== cur.role) throw new BadRequestException('Cannot change the space owner');
      if (role) {
        await tx
          .insert(spaceMembers)
          .values({ spaceId: id, userId, role, title: pos ?? null })
          .onConflictDoUpdate({ target: [spaceMembers.spaceId, spaceMembers.userId], set: { role, ...(pos !== undefined ? { title: pos } : {}) } });
      } else {
        await tx.delete(spaceMembers).where(and(eq(spaceMembers.spaceId, id), eq(spaceMembers.userId, userId)));
      }
      const who = (await loadUsers(tx, [userId])).get(userId);
      await this.events.emit(tx, actor, 'space.member_changed', { spaceId: id }, { userId, userName: who?.name, role });
    });
    // Chat follows the space: its public channels, private channel access and file folders (§68).
    await this.chat.spaceMembershipChanged(actor.workspaceId, id, userId).catch(() => undefined);
  }

  async activity(actor: Actor, id: string): Promise<ActivityEvent[]> {
    await this.perms.requireSpace(actor, id, 'viewer');
    const rows = await this.db.select().from(auditEvents).where(eq(auditEvents.spaceId, id)).orderBy(desc(auditEvents.createdAt)).limit(100);
    const people = await loadUsers(this.db, rows.map((r) => r.actorId));
    return rows.map((r) => ({
      id: String(r.id),
      actor: r.actorId ? people.get(r.actorId) ?? null : null,
      action: r.action,
      resourceId: r.resourceId,
      data: r.data,
      createdAt: r.createdAt,
    }));
  }
}
