import { Controller, Get, Query } from '@nestjs/common';
import { can, type ActivityEvent } from '@workos/shared';
import { and, count, eq, sql } from 'drizzle-orm';
import { type Actor, CurrentUser } from '../common/current-user';
import type { Db } from '../db/client';
import { InjectDb } from '../db/db.module';
import { resources, workspaceMembers } from '../db/schema';
import { QuotaService } from '../storage/quota.service';
import { PermissionsService } from '../permissions/permissions.service';
import { visibleActivity } from './activity';

/** Workspace-wide feeds for the Home dashboard. */
@Controller()
export class WorkspaceController {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly perms: PermissionsService,
    private readonly quota: QuotaService,
  ) {}

  /** Activity the actor is allowed to see (resource events filtered by effective role, space events by space role). */
  @Get('activity')
  activity(@CurrentUser() a: Actor, @Query('limit') limitParam?: string): Promise<ActivityEvent[]> {
    return visibleActivity(this.db, this.perms, a, { limit: Math.min(Math.max(Number(limitParam) || 20, 1), 100) });
  }

  @Get('stats')
  async stats(@CurrentUser() a: Actor) {
    const week = sql`now() - interval '7 days'`;
    const twoWeeks = sql`now() - interval '14 days'`;
    const [[members], [thisWeek], [lastWeek], storage, spaces] = await Promise.all([
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
      this.quota.orgUsed(a.workspaceId),
      this.perms.spaceRoles(a),
    ]);
    return {
      members: members.n,
      spaces: [...spaces.values()].filter((r) => can(r, 'viewer')).length,
      filesCreated7d: thisWeek.n,
      filesCreatedPrev7d: lastWeek.n,
      storageBytes: storage,
    };
  }
}
