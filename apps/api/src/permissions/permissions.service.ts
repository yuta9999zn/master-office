import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { can, maxRole, type Role } from '@workos/shared';
import { and, eq, inArray, or } from 'drizzle-orm';
import type { Actor } from '../common/current-user';
import { runAll, type Db, type Tx } from '../db/client';
import { InjectDb } from '../db/db.module';
import { aclEntries, resources, spaceMembers, spaces, workspaceMembers } from '../db/schema';

type ResourceRow = typeof resources.$inferSelect;
type Pick_ = Pick<ResourceRow, 'id' | 'ownerId' | 'spaceId' | 'path' | 'generalAccess' | 'generalRole'>;

/**
 * Effective role resolution — docs/ARCHITECTURE.md §6.3:
 *   max(owner, ACL on self or any ancestor, space role, general access on self or any ancestor)
 * Public spaces grant `viewer` to every workspace member; workspace owners are admins of every space.
 */
@Injectable()
export class PermissionsService {
  constructor(@InjectDb() private readonly db: Db) {}

  async spaceRoles(actor: Actor, tx: Tx = this.db): Promise<Map<string, Role | null>> {
    const [all, mine, [wsm]] = await runAll(tx !== this.db, [
      () => tx.select({ id: spaces.id, visibility: spaces.visibility }).from(spaces).where(eq(spaces.workspaceId, actor.workspaceId)),
      () => tx.select({ spaceId: spaceMembers.spaceId, role: spaceMembers.role }).from(spaceMembers).where(eq(spaceMembers.userId, actor.id)),
      () =>
        tx
        .select({ role: workspaceMembers.role })
        .from(workspaceMembers)
        .where(and(eq(workspaceMembers.userId, actor.id), eq(workspaceMembers.workspaceId, actor.workspaceId))),
    ] as const);
    const member = new Map(mine.map((m) => [m.spaceId, m.role]));
    const wsOwner = wsm?.role === 'owner';
    return new Map(
      all.map((s) => [
        s.id,
        maxRole(member.get(s.id), s.visibility === 'public' ? 'viewer' : null, wsOwner ? 'admin' : null),
      ]),
    );
  }

  async rolesFor(actor: Actor, items: Pick_[], tx: Tx = this.db): Promise<Map<string, Role | null>> {
    const out = new Map<string, Role | null>();
    if (!items.length) return out;
    const ids = new Set<string>();
    for (const r of items) {
      ids.add(r.id);
      r.path.forEach((p) => ids.add(p));
    }
    const idList = [...ids];
    const [acl, ancestors, sRoles] = await runAll(tx !== this.db, [
      () =>
        tx
        .select({ resourceId: aclEntries.resourceId, role: aclEntries.role })
        .from(aclEntries)
        .where(
          and(
            inArray(aclEntries.resourceId, idList),
            or(
              and(eq(aclEntries.principalType, 'user'), eq(aclEntries.principalId, actor.id)),
              and(eq(aclEntries.principalType, 'workspace'), eq(aclEntries.principalId, actor.workspaceId)),
            ),
          ),
        ),
      () =>
        tx
        .select({ id: resources.id, generalAccess: resources.generalAccess, generalRole: resources.generalRole })
        .from(resources)
        .where(inArray(resources.id, idList)),
      () => this.spaceRoles(actor, tx),
    ] as const);
    const aclBy = new Map<string, Role>();
    for (const a of acl) aclBy.set(a.resourceId, maxRole(aclBy.get(a.resourceId), a.role)!);
    const generalBy = new Map(
      ancestors.map((a) => [a.id, a.generalAccess !== 'restricted' ? a.generalRole ?? 'viewer' : null] as const),
    );

    for (const r of items) {
      let role: Role | null = r.ownerId === actor.id ? 'owner' : null;
      for (const id of [r.id, ...r.path]) role = maxRole(role, aclBy.get(id), generalBy.get(id));
      if (r.spaceId) role = maxRole(role, sRoles.get(r.spaceId));
      out.set(r.id, role);
    }
    return out;
  }

  async roleFor(actor: Actor, r: Pick_, tx: Tx = this.db) {
    return (await this.rolesFor(actor, [r], tx)).get(r.id) ?? null;
  }

  /** Loads a resource and asserts the actor holds at least `needed`. 404 when not even viewable. */
  async require(actor: Actor, id: string, needed: Role, tx: Tx = this.db): Promise<{ row: ResourceRow; role: Role }> {
    const [row] = await tx.select().from(resources).where(eq(resources.id, id)).limit(1);
    if (!row || row.workspaceId !== actor.workspaceId) throw new NotFoundException('Resource not found');
    const role = await this.roleFor(actor, row, tx);
    if (!can(role, 'viewer')) throw new NotFoundException('Resource not found');
    if (!can(role, needed)) throw new ForbiddenException(`Requires ${needed} access`);
    return { row, role: role! };
  }

  async requireSpace(actor: Actor, spaceId: string, needed: Role, tx: Tx = this.db): Promise<Role> {
    const role = (await this.spaceRoles(actor, tx)).get(spaceId);
    if (role === undefined || !can(role, 'viewer')) throw new NotFoundException('Space not found');
    if (!can(role, needed)) throw new ForbiddenException(`Requires ${needed} access to space`);
    return role!;
  }
}
