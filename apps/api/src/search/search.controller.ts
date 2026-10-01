import { Controller, Get, Query } from '@nestjs/common';
import { can, type SearchHit } from '@workos/shared';
import { and, eq, ilike, or, sql } from 'drizzle-orm';
import { type Actor, CurrentUser } from '../common/current-user';
import type { Db } from '../db/client';
import { InjectDb } from '../db/db.module';
import { resources, spaces, users, workspaceMembers } from '../db/schema';
import { PermissionsService } from '../permissions/permissions.service';

/**
 * Phase 1 search: Postgres ILIKE with a permission post-filter.
 * Phase 6 swaps the body for OpenSearch (ACL principals in the index) — same response contract.
 */
@Controller('search')
export class SearchController {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly perms: PermissionsService,
  ) {}

  @Get()
  async search(@CurrentUser() a: Actor, @Query('q') q = ''): Promise<SearchHit[]> {
    const term = q.trim();
    if (!term) return [];
    const like = `%${term.replace(/[%_\\]/g, (c) => '\\' + c)}%`;
    const [res, people, sp, sRoles] = await Promise.all([
      this.db
        .select()
        .from(resources)
        .where(
          and(
            eq(resources.workspaceId, a.workspaceId),
            sql`${resources.trashedAt} IS NULL AND NOT EXISTS (SELECT 1 FROM resources a WHERE a.id = ANY(${resources.path}) AND a.trashed_at IS NOT NULL)`,
            or(ilike(resources.name, like), ilike(resources.description, like), ilike(resources.contentText, like), sql`${term} = ANY(${resources.tags})`),
          ),
        )
        .limit(60),
      this.db
        .select({ id: users.id, name: users.name, title: users.title, email: users.email })
        .from(users)
        .innerJoin(workspaceMembers, eq(workspaceMembers.userId, users.id))
        .where(and(eq(workspaceMembers.workspaceId, a.workspaceId), or(ilike(users.name, like), ilike(users.email, like))))
        .limit(8),
      this.db
        .select()
        .from(spaces)
        .where(and(eq(spaces.workspaceId, a.workspaceId), ilike(spaces.name, like)))
        .limit(8),
      this.perms.spaceRoles(a),
    ]);
    const roles = await this.perms.rolesFor(a, res);
    return [
      ...res
        .filter((r) => can(roles.get(r.id), 'viewer'))
        .slice(0, 20)
        .map((r) => ({ kind: 'resource' as const, id: r.id, title: r.name, type: r.type, subtitle: r.description ?? undefined })),
      ...sp
        .filter((s) => can(sRoles.get(s.id), 'viewer'))
        .map((s) => ({ kind: 'space' as const, id: s.id, title: s.name, subtitle: s.description ?? undefined })),
      ...people.map((p) => ({ kind: 'person' as const, id: p.id, title: p.name, subtitle: p.title ?? p.email })),
    ];
  }
}
