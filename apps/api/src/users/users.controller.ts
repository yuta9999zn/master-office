import { Controller, Get } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import { type Actor, CurrentUser } from '../common/current-user';
import { userColumns } from '../common/users';
import type { Db } from '../db/client';
import { InjectDb } from '../db/db.module';
import { users, workspaceMembers, workspaces } from '../db/schema';

@Controller()
export class UsersController {
  constructor(@InjectDb() private readonly db: Db) {}

  @Get('me')
  async me(@CurrentUser() a: Actor) {
    const [user] = await this.db.select(userColumns).from(users).where(eq(users.id, a.id));
    const mine = await this.db
      .select({ id: workspaces.id, name: workspaces.name, slug: workspaces.slug })
      .from(workspaceMembers)
      .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
      .where(eq(workspaceMembers.userId, a.id));
    return { user, workspace: mine.find((w) => w.id === a.workspaceId), workspaces: mine };
  }

  @Get('users')
  list(@CurrentUser() a: Actor) {
    return this.db
      .select(userColumns)
      .from(users)
      .innerJoin(workspaceMembers, eq(workspaceMembers.userId, users.id))
      .where(eq(workspaceMembers.workspaceId, a.workspaceId))
      .orderBy(asc(users.name));
  }
}
