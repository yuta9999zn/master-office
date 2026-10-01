import { createParamDecorator, type ExecutionContext, Injectable, type NestMiddleware, UnauthorizedException } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import type { NextFunction, Request, Response } from 'express';
import type { Db } from '../db/client';
import { InjectDb } from '../db/db.module';
import { users, workspaceMembers } from '../db/schema';

export interface Actor {
  id: string;
  name: string;
  workspaceId: string;
}

declare module 'express' {
  interface Request {
    actor?: Actor;
  }
}

/**
 * Phase 1 identity: the dev user is picked with the `x-user-id` header or `mo_uid` cookie (the web app has a user switcher).
 * Replaced by OIDC sessions in the identity module — only this middleware changes.
 */
function readCookie(header: string | undefined, name: string) {
  for (const part of header?.split(';') ?? []) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return undefined;
}

@Injectable()
export class CurrentUserMiddleware implements NestMiddleware {
  constructor(@InjectDb() private readonly db: Db) {}

  async use(req: Request, _res: Response, next: NextFunction) {
    try {
      const header = req.header('x-user-id');
      const cookie = readCookie(req.header('cookie'), 'mo_uid');
      // An explicit header must be valid; a stale browser cookie (e.g. after re-seeding) falls back to the default user.
      req.actor = header ? await this.load(header) : (cookie && (await this.find(cookie))) || (await this.defaultActor());
      next();
    } catch (e) {
      next(e);
    }
  }

  private async load(id: string): Promise<Actor> {
    const row = await this.find(id);
    if (!row) throw new UnauthorizedException('Unknown user');
    return row;
  }

  private async find(id: string): Promise<Actor | null> {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
    const [row] = await this.db
      .select({ id: users.id, name: users.name, workspaceId: workspaceMembers.workspaceId })
      .from(users)
      .innerJoin(workspaceMembers, eq(workspaceMembers.userId, users.id))
      .where(eq(users.id, id))
      .limit(1);
    return row ?? null;
  }

  private async defaultActor(): Promise<Actor> {
    const [row] = await this.db
      .select({ id: users.id, name: users.name, workspaceId: workspaceMembers.workspaceId })
      .from(users)
      .innerJoin(workspaceMembers, eq(workspaceMembers.userId, users.id))
      .orderBy(asc(users.createdAt), asc(users.email))
      .limit(1);
    if (!row) throw new UnauthorizedException('No users — run pnpm db:seed');
    return row;
  }
}

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): Actor => {
  const req = ctx.switchToHttp().getRequest<Request>();
  if (!req.actor) throw new UnauthorizedException();
  return req.actor;
});
