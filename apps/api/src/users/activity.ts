import { can, type ActivityEvent } from '@workos/shared';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Actor } from '../common/current-user';
import { loadUsers } from '../common/users';
import type { Db } from '../db/client';
import { auditEvents, resources, resourceColumns } from '../db/schema';
import type { PermissionsService } from '../permissions/permissions.service';

/**
 * Audit events the viewer may see: resource events filtered by the viewer's effective role, space events by space
 * role (Home's Recent Activity, a person's Activity tab). `by` limits it to what one person did.
 */
export async function visibleActivity(db: Db, perms: PermissionsService, viewer: Actor, opts: { limit: number; by?: string }): Promise<ActivityEvent[]> {
  const rows = await db
    .select()
    .from(auditEvents)
    .where(
      and(
        eq(auditEvents.workspaceId, viewer.workspaceId),
        opts.by ? eq(auditEvents.actorId, opts.by) : undefined,
        sql`(${auditEvents.resourceId} IS NULL OR EXISTS (SELECT 1 FROM resources r WHERE r.id = ${auditEvents.resourceId} AND r.trashed_at IS NULL))`,
      ),
    )
    .orderBy(desc(auditEvents.createdAt))
    .limit(opts.limit * 4);
  const resIds = [...new Set(rows.map((r) => r.resourceId).filter((x): x is string => !!x))];
  const res = resIds.length ? await db.select(resourceColumns).from(resources).where(inArray(resources.id, resIds)) : [];
  const [roles, sRoles] = await Promise.all([perms.rolesFor(viewer, res), perms.spaceRoles(viewer)]);
  const visible = rows
    .filter((r) => (r.resourceId ? can(roles.get(r.resourceId), 'viewer') : r.spaceId ? can(sRoles.get(r.spaceId), 'viewer') : false))
    .slice(0, opts.limit);
  const people = await loadUsers(db, visible.map((r) => r.actorId));
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
