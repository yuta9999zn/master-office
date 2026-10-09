import { BadRequestException, ForbiddenException, HttpException, HttpStatus, Injectable, UnauthorizedException } from '@nestjs/common';
import { and, eq, gt, isNull, ne, sql } from 'drizzle-orm';
import type { Actor } from '../common/current-user';
import type { Db, Tx } from '../db/client';
import { InjectDb } from '../db/db.module';
import { authCredentials, authSessions, authTokens, users, workspaceMembers, workspaces } from '../db/schema';
import { MailService, mailHtml } from '../mail/mail.service';
import { SettingsService } from '../admin/settings.service';
import { hashPassword, newToken, tokenHash, verifyPassword } from './secrets';

export const SESSION_COOKIE = 'mo_session';
export const SESSION_DAYS = 30;
const DAY = 86_400_000;

export function checkPassword(p: unknown): string {
  if (typeof p !== 'string' || p.length < 10) throw new BadRequestException('The password needs at least 10 characters');
  if (p.length > 200) throw new BadRequestException('The password is too long');
  return p;
}
export const normEmail = (e: unknown) => {
  const v = typeof e === 'string' ? e.trim().toLowerCase() : '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) || v.length > 200) throw new BadRequestException('Enter a valid e-mail address');
  return v;
};

/** Sign-in with e-mail + password, sessions, password resets (docs/ARCHITECTURE.md §79). */
@Injectable()
export class AuthService {
  /** Failed sign-ins per e-mail and per IP: 8 within 15 minutes, then a pause. */
  private fails = new Map<string, { n: number; until: number }>();

  constructor(
    @InjectDb() private readonly db: Db,
    private readonly mail: MailService,
    private readonly settings: SettingsService,
  ) {}

  private throttle(keys: string[]) {
    const now = Date.now();
    for (const k of keys) {
      const f = this.fails.get(k);
      if (f && f.until > now && f.n >= 8) throw new HttpException('Too many attempts — try again in a few minutes', HttpStatus.TOO_MANY_REQUESTS);
    }
  }
  private failed(keys: string[]) {
    const now = Date.now();
    if (this.fails.size > 5000) for (const [k, f] of this.fails) if (f.until <= now) this.fails.delete(k);
    for (const k of keys) {
      const f = this.fails.get(k);
      this.fails.set(k, f && f.until > now ? { n: f.n + 1, until: f.until } : { n: 1, until: now + 15 * 60_000 });
    }
  }

  /** The workspace membership a session signs into (the first one; one organisation per install). */
  private async membership(userId: string) {
    const [m] = await this.db.select().from(workspaceMembers).where(eq(workspaceMembers.userId, userId)).limit(1);
    return m ?? null;
  }

  async createSession(tx: Tx, userId: string, workspaceId: string, meta: { ua?: string; ip?: string }) {
    const { token, hash } = newToken();
    await tx.insert(authSessions).values({ tokenHash: hash, userId, workspaceId, userAgent: meta.ua?.slice(0, 300) ?? null, ip: meta.ip ?? null, expiresAt: new Date(Date.now() + SESSION_DAYS * DAY).toISOString() });
    return token;
  }

  async login(emailIn: unknown, password: unknown, meta: { ua?: string; ip?: string }) {
    const email = normEmail(emailIn);
    const keys = [`e:${email}`, `ip:${meta.ip ?? ''}`];
    this.throttle(keys);
    const [row] = await this.db
      .select({ id: users.id, hash: authCredentials.hash })
      .from(users)
      .leftJoin(authCredentials, eq(authCredentials.userId, users.id))
      .where(eq(sql`lower(${users.email})`, email));
    const ok = !!row?.hash && typeof password === 'string' && (await verifyPassword(password, row.hash));
    if (!ok) {
      this.failed(keys);
      throw new UnauthorizedException('Wrong e-mail or password');
    }
    const m = await this.membership(row.id);
    if (!m) throw new UnauthorizedException('Wrong e-mail or password');
    if (m.status !== 'active') throw new ForbiddenException('This account is suspended — ask your administrator');
    this.fails.delete(keys[0]);
    return this.createSession(this.db, row.id, m.workspaceId, meta);
  }

  /** The signed-in person of a session cookie (slides the expiry, at most once a minute). */
  async actorFor(token: string): Promise<Actor | null> {
    if (!token || token.length > 100) return null;
    const [row] = await this.db
      .select({ id: authSessions.id, userId: users.id, name: users.name, workspaceId: authSessions.workspaceId, status: workspaceMembers.status, lastSeenAt: authSessions.lastSeenAt })
      .from(authSessions)
      .innerJoin(users, eq(users.id, authSessions.userId))
      .innerJoin(workspaceMembers, and(eq(workspaceMembers.userId, authSessions.userId), eq(workspaceMembers.workspaceId, authSessions.workspaceId)))
      .where(and(eq(authSessions.tokenHash, tokenHash(token)), gt(authSessions.expiresAt, new Date().toISOString())));
    if (!row || row.status !== 'active') return null;
    if (Date.now() - Date.parse(row.lastSeenAt) > 60_000)
      void this.db.update(authSessions).set({ lastSeenAt: new Date().toISOString(), expiresAt: new Date(Date.now() + SESSION_DAYS * DAY).toISOString() }).where(eq(authSessions.id, row.id)).catch(() => undefined);
    return { id: row.userId, name: row.name, workspaceId: row.workspaceId };
  }

  async logout(token: string | undefined) {
    if (token) await this.db.delete(authSessions).where(eq(authSessions.tokenHash, tokenHash(token)));
  }

  async revokeAll(userId: string, keepToken?: string) {
    await this.db.delete(authSessions).where(and(eq(authSessions.userId, userId), keepToken ? ne(authSessions.tokenHash, tokenHash(keepToken)) : undefined));
  }

  async setPassword(tx: Tx, userId: string, password: string) {
    const hash = await hashPassword(checkPassword(password));
    await tx.insert(authCredentials).values({ userId, hash }).onConflictDoUpdate({ target: authCredentials.userId, set: { hash, changedAt: new Date().toISOString() } });
  }

  async changePassword(actor: Actor, current: unknown, next: unknown, keepToken?: string) {
    const [c] = await this.db.select().from(authCredentials).where(eq(authCredentials.userId, actor.id));
    if (c && !(typeof current === 'string' && (await verifyPassword(current, c.hash)))) throw new BadRequestException('The current password is wrong');
    await this.setPassword(this.db, actor.id, checkPassword(next));
    // Other browsers are signed out.
    await this.revokeAll(actor.id, keepToken);
  }

  async hasPassword(userId: string) {
    return !!(await this.db.select({ id: authCredentials.userId }).from(authCredentials).where(eq(authCredentials.userId, userId)))[0];
  }

  /** Mails a one-hour reset link. Says nothing about whether the address exists. */
  async forgot(emailIn: unknown, ip?: string) {
    const email = normEmail(emailIn);
    this.throttle([`r:${email}`, `rip:${ip ?? ''}`]);
    this.failed([`r:${email}`, `rip:${ip ?? ''}`]);
    const [u] = await this.db.select({ id: users.id, name: users.name, email: users.email }).from(users).where(eq(sql`lower(${users.email})`, email));
    const m = u && (await this.membership(u.id));
    if (!u || !m || m.status !== 'active') return;
    await this.sendReset(m.workspaceId, u, 'You asked to reset your password.');
  }

  /** Admin → Members → Send password link. */
  async sendReset(workspaceId: string, u: { id: string; name: string; email: string }, why: string) {
    const { token, hash } = newToken();
    await this.db.insert(authTokens).values({ tokenHash: hash, kind: 'reset', userId: u.id, expiresAt: new Date(Date.now() + 3_600_000).toISOString() });
    const [ws] = await this.db.select({ name: workspaces.name }).from(workspaces).where(eq(workspaces.id, workspaceId));
    const url = `${await this.settings.appUrl(workspaceId)}/reset/${token}`;
    await this.mail.send({
      kind: 'auth.reset',
      to: u.email,
      subject: `Set your Master Office password — ${ws?.name ?? ''}`,
      text: `Hello ${u.name},\n\n${why} Open this link within one hour to choose a new password:\n${url}\n\nIf you did not ask for this, ignore this e-mail.`,
      html: mailHtml({ title: 'Choose a new password', intro: `Hello ${u.name}, ${why} The link works for one hour. If you did not ask for this, ignore this e-mail.`, button: { label: 'Set password', url } }),
    });
  }

  private async resetRow(token: string) {
    const [t] = await this.db
      .select({ id: authTokens.id, userId: authTokens.userId, email: users.email, name: users.name })
      .from(authTokens)
      .innerJoin(users, eq(users.id, authTokens.userId))
      .where(and(eq(authTokens.tokenHash, tokenHash(token)), eq(authTokens.kind, 'reset'), isNull(authTokens.usedAt), gt(authTokens.expiresAt, new Date().toISOString())));
    if (!t) throw new BadRequestException('This link has expired or was already used — ask for a new one');
    return t;
  }

  async resetInfo(token: string) {
    const t = await this.resetRow(token);
    return { email: t.email, name: t.name };
  }

  async reset(token: string, password: unknown, meta: { ua?: string; ip?: string }) {
    const t = await this.resetRow(token);
    const m = await this.membership(t.userId);
    if (!m || m.status !== 'active') throw new ForbiddenException('This account is suspended — ask your administrator');
    return this.db.transaction(async (tx) => {
      await this.setPassword(tx, t.userId, checkPassword(password));
      await tx.update(authTokens).set({ usedAt: new Date().toISOString() }).where(eq(authTokens.id, t.id));
      await tx.delete(authSessions).where(eq(authSessions.userId, t.userId));
      return this.createSession(tx, t.userId, m.workspaceId, meta);
    });
  }
}
