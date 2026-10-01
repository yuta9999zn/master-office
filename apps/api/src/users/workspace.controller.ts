import { Controller, Get, Query } from '@nestjs/common';
import { can, type ActivityEvent } from '@workos/shared';
import { and, count, desc, eq, inArray, sql } from 'drizzle-orm';
import { type Actor, CurrentUser } from '../common/current-user';
import { loadUsers } from '../common/users';
import type { Db } from '../db/client';
import { InjectDb } from '../db/db.module';
import { auditEvents, resources, workspaceMembers } from '../db/schema';
import { PermissionsService } from '../permissions/permissions.service';

/** Workspace-wide feeds for the Home dashboard. */
@Controller()
export class WorkspaceController {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly perms: PermissionsService,
  ) {}

  /** Activity the actor is allowed to see (resource events filtered by effective role, space events by space role). */
  @Get('activity')
  async activity(@CurrentUser() a: Actor, @Query('limit') limitParam?: string): Promise<ActivityEvent[]> {
    const limit = Math.min(Math.max(Number(limitParam) || 20, 1), 100);
    const rows = await this.db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.workspaceId, a.workspaceId),
          sql`(${auditEvents.resourceId} IS NULL OR EXISTS (SELECT 1 FROM resources r WHERE r.id = ${auditEvents.resourceId} AND r.trashed_at IS NULL))`,
        ),
      )
      .orderBy(desc(auditEvents.createdAt))
      .limit(limit * 4);
    const resIds = [...new Set(rows.map((r) => r.resourceId).filter((x): x is string => !!x))];
    const res = resIds.length ? await this.db.select().from(resources).where(inArray(resources.id, resIds)) : [];
    const [roles, sRoles] = await Promise.all([this.perms.rolesFor(a, res), this.perms.spaceRoles(a)]);
    const visible = rows
      .filter((r) => (r.resourceId ? can(roles.get(r.resourceId), 'viewer') : r.spaceId ? can(sRoles.get(r.spaceId), 'viewer') : false))
      .slice(0, limit);
    const people = await loadUsers(this.db, visible.map((r) => r.actorId));
    const byId = new Map(res.map((r) => [r.id, r]));
    return visible.map((r) => {
      const target = r.resourceId ? byId.get(r.resourceId) : undefined;
      return {
        id: String(r.id),
        actor: r.actorId ? people.get(r.actorId) ?? null : null,
        action: r.action,
        resourceId: r.resourceId,
        data: { ...r.data, ...(target ? { name: target.name, type: target.type } : {}) },
        createdAt: r.createdAt,
      };
    });
  }

  @Get('stats')
  async stats(@CurrentUser() a: Actor) {
    const week = sql`now() - interval '7 days'`;
    const twoWeeks = sql`now() - interval '14 days'`;
    const [[members], [thisWeek], [lastWeek], [storage], spaces] = await Promise.all([
      this.db.select({ n: count() }).from(workspaceMembers).where(eq(workspaceMembers.workspaceId, a.workspaceId)),
      this.db
        .select({ n: count() })
        .from(resources)
        .where(and(eq(resources.workspaceId, a.workspaceId), sql`${resources.type} <> 'folder'`, sql`${resources.createdAt} >= ${week}`)),
      this.db
        .select({ n: count() })
        .from(resources)
        .where(
          and(
            eq(resources.workspaceId, a.workspaceId),
            sql`${resources.type} <> 'folder'`,
            sql`${resources.createdAt} >= ${twoWeeks} AND ${resources.createdAt} < ${week}`,
          ),
        ),
      this.db
        .select({ bytes: sql<string>`coalesce(sum(${resources.sizeBytes}), 0)` })
        .from(resources)
        .where(and(eq(resources.workspaceId, a.workspaceId), sql`${resources.trashedAt} IS NULL`)),
      this.perms.spaceRoles(a),
    ]);
    return {
      members: members.n,
      spaces: [...spaces.values()].filter((r) => can(r, 'viewer')).length,
      filesCreated7d: thisWeek.n,
      filesCreatedPrev7d: lastWeek.n,
      storageBytes: Number(storage.bytes),
    };
  }
}
