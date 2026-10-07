import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, count, desc, eq, gt, inArray, max, sql } from 'drizzle-orm';
import type { Actor } from '../common/current-user';
import { userColumns } from '../common/users';
import type { Db } from '../db/client';
import { InjectDb } from '../db/db.module';
import { authCredentials, authSessions, invitations, spaceMembers, spaces, users, workspaceMembers, workspaces } from '../db/schema';
import { MailService, mailHtml } from '../mail/mail.service';
import { SpacesService } from '../spaces/spaces.service';
import { ChatService } from '../chat/chat.service';
import { AuthService, checkPassword, normEmail } from '../auth/auth.service';
import { newToken, tokenHash } from '../auth/secrets';
import { SettingsService } from './settings.service';

export type OrgRole = 'owner' | 'admin' | 'editor' | 'viewer';
type Meta = { ua?: string; ip?: string };
const COLORS = ['#2563eb', '#7c3aed', '#0d9488', '#db2777', '#ea580c', '#16a34a', '#0891b2', '#9333ea', '#ca8a04', '#475569'];
const colorFor = (s: string) => COLORS[[...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % COLORS.length];
const slugify = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'org';

/**
 * The organisation (§79): first-run setup, members (roles, suspend), invitations. Owners and admins of the workspace
 * manage it; the owner is the one who set the system up and alone can name other admins or hand over ownership.
 */
@Injectable()
export class OrgService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly auth: AuthService,
    private readonly settings: SettingsService,
    private readonly mail: MailService,
    private readonly spaces: SpacesService,
    private readonly chat: ChatService,
  ) {}

  async myRole(actor: Actor): Promise<OrgRole | null> {
    const [m] = await this.db.select({ role: workspaceMembers.role }).from(workspaceMembers).where(and(eq(workspaceMembers.workspaceId, actor.workspaceId), eq(workspaceMembers.userId, actor.id)));
    return (m?.role as OrgRole) ?? null;
  }

  async requireAdmin(actor: Actor) {
    const r = await this.myRole(actor);
    if (r !== 'owner' && r !== 'admin') throw new ForbiddenException('Only administrators can do this');
    return r;
  }

  // ── First run ────────────────────────────────────────────────────────────

  async needsSetup() {
    const [{ n }] = await this.db.select({ n: count() }).from(workspaces);
    return n === 0;
  }

  async setup(input: { orgName: string; mailDomain?: string | null; name: string; email: string; password: string; appUrl?: string | null }, meta: Meta) {
    const email = normEmail(input.email);
    checkPassword(input.password);
    const done = await this.db.transaction(async (tx) => {
      // One setup at a time, and only once.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(790001)`);
      const [{ n }] = await tx.select({ n: count() }).from(workspaces);
      if (n > 0) throw new ForbiddenException('This system is already set up — sign in instead');
      const domain = input.mailDomain?.trim().toLowerCase().replace(/^@/, '') || email.split('@')[1];
      const [ws] = await tx.insert(workspaces).values({ name: input.orgName.trim(), slug: slugify(input.orgName), mailDomain: domain }).returning();
      const [u] = await tx.insert(users).values({ name: input.name.trim(), email, avatarColor: colorFor(email), title: 'Administrator' }).returning();
      await tx.insert(workspaceMembers).values({ workspaceId: ws.id, userId: u.id, role: 'owner' });
      await this.auth.setPassword(tx, u.id, input.password);
      const token = await this.auth.createSession(tx, u.id, ws.id, meta);
      return { ws, u, token };
    });
    const actor: Actor = { id: done.u.id, name: done.u.name, workspaceId: done.ws.id };
    if (input.appUrl) await this.settings.setGeneral(actor, done.ws.id, { appUrl: input.appUrl }).catch(() => undefined);
    // Everyone's space: public, every member reads it.
    await this.spaces.create(actor, { name: 'General', description: 'Company-wide news, files and chat', visibility: 'public', color: '#2563eb' }).catch(() => undefined);
    return { token: done.token, workspaceId: done.ws.id };
  }

  // ── Members ──────────────────────────────────────────────────────────────

  async members(actor: Actor) {
    await this.requireAdmin(actor);
    const rows = await this.db
      .select({ user: userColumns, role: workspaceMembers.role, status: workspaceMembers.status, joinedAt: workspaceMembers.joinedAt })
      .from(workspaceMembers)
      .innerJoin(users, eq(users.id, workspaceMembers.userId))
      .where(eq(workspaceMembers.workspaceId, actor.workspaceId))
      .orderBy(asc(users.name));
    const ids = rows.map((r) => r.user.id);
    const [seen, creds, teams] = ids.length
      ? await Promise.all([
          this.db.select({ id: authSessions.userId, at: max(authSessions.lastSeenAt) }).from(authSessions).where(inArray(authSessions.userId, ids)).groupBy(authSessions.userId),
          this.db.select({ id: authCredentials.userId }).from(authCredentials).where(inArray(authCredentials.userId, ids)),
          this.db
            .select({ id: spaceMembers.userId, n: count() })
            .from(spaceMembers)
            .innerJoin(spaces, eq(spaces.id, spaceMembers.spaceId))
            .where(and(inArray(spaceMembers.userId, ids), eq(spaces.workspaceId, actor.workspaceId)))
            .groupBy(spaceMembers.userId),
        ])
      : [[], [], []];
    const lastSeen = new Map(seen.map((s) => [s.id, s.at]));
    const has = new Set(creds.map((c) => c.id));
    const nTeams = new Map(teams.map((t) => [t.id, t.n]));
    const order = ['owner', 'admin', 'editor', 'commenter', 'viewer'];
    return rows
      .map((r) => ({ ...r, lastSeenAt: lastSeen.get(r.user.id) ?? null, hasPassword: has.has(r.user.id), teams: nTeams.get(r.user.id) ?? 0 }))
      .sort((a, b) => order.indexOf(a.role) - order.indexOf(b.role) || a.user.name.localeCompare(b.user.name, 'vi'));
  }

  private async member(actor: Actor, userId: string) {
    const [m] = await this.db.select().from(workspaceMembers).where(and(eq(workspaceMembers.workspaceId, actor.workspaceId), eq(workspaceMembers.userId, userId)));
    if (!m) throw new NotFoundException('Not a member of this organisation');
    return m;
  }

  async updateMember(actor: Actor, userId: string, input: { role?: 'admin' | 'editor' | 'viewer'; status?: 'active' | 'suspended' }) {
    const mine = await this.requireAdmin(actor);
    const m = await this.member(actor, userId);
    if (m.role === 'owner') throw new BadRequestException('The owner cannot be changed — hand over ownership first');
    if (userId === actor.id) throw new BadRequestException('You cannot change your own role or suspend yourself');
    const set: Partial<typeof workspaceMembers.$inferInsert> = {};
    if (input.role && input.role !== m.role) {
      if ((input.role === 'admin' || m.role === 'admin') && mine !== 'owner') throw new ForbiddenException('Only the owner names or removes administrators');
      set.role = input.role;
    }
    if (input.status && input.status !== m.status) {
      if (m.role === 'admin' && mine !== 'owner') throw new ForbiddenException('Only the owner can suspend an administrator');
      set.status = input.status;
    }
    if (Object.keys(set).length) await this.db.update(workspaceMembers).set(set).where(and(eq(workspaceMembers.workspaceId, actor.workspaceId), eq(workspaceMembers.userId, userId)));
    if (set.status === 'suspended') await this.auth.revokeAll(userId);
    return (await this.members(actor)).find((x) => x.user.id === userId)!;
  }

  async sendPasswordLink(actor: Actor, userId: string) {
    await this.requireAdmin(actor);
    const m = await this.member(actor, userId);
    if (m.status !== 'active') throw new BadRequestException('Reactivate the account first');
    const [u] = await this.db.select({ id: users.id, name: users.name, email: users.email }).from(users).where(eq(users.id, userId));
    await this.auth.sendReset(actor.workspaceId, u, `${actor.name} sent you a link to set your password.`);
    return { delivered: this.mail.delivering };
  }

  async transferOwnership(actor: Actor, userId: string) {
    if ((await this.myRole(actor)) !== 'owner') throw new ForbiddenException('Only the owner can hand over ownership');
    const m = await this.member(actor, userId);
    if (m.status !== 'active' || userId === actor.id) throw new BadRequestException('Pick another active member');
    await this.db.transaction(async (tx) => {
      await tx.update(workspaceMembers).set({ role: 'admin' }).where(and(eq(workspaceMembers.workspaceId, actor.workspaceId), eq(workspaceMembers.userId, actor.id)));
      await tx.update(workspaceMembers).set({ role: 'owner' }).where(and(eq(workspaceMembers.workspaceId, actor.workspaceId), eq(workspaceMembers.userId, userId)));
    });
    return { ok: true };
  }

  // ── Invitations ──────────────────────────────────────────────────────────

  async invitations(actor: Actor) {
    await this.requireAdmin(actor);
    const rows = await this.db
      .select({ i: invitations, by: users.name })
      .from(invitations)
      .leftJoin(users, eq(users.id, invitations.invitedBy))
      .where(and(eq(invitations.workspaceId, actor.workspaceId), eq(invitations.status, 'pending')))
      .orderBy(desc(invitations.createdAt));
    const now = new Date().toISOString();
    return rows.map(({ i, by }) => ({ id: i.id, email: i.email, role: i.role, teams: i.teams, invitedBy: by, createdAt: i.createdAt, expiresAt: i.expiresAt, expired: i.expiresAt < now }));
  }

  private async sendInvite(actor: Actor, inv: { email: string; message?: string | null }, token: string) {
    const [ws] = await this.db.select({ name: workspaces.name }).from(workspaces).where(eq(workspaces.id, actor.workspaceId));
    const url = `${await this.settings.appUrl(actor.workspaceId)}/invite/${token}`;
    await this.mail.send({
      kind: 'org.invite',
      to: inv.email,
      subject: `${actor.name} invited you to ${ws.name} on Master Office`,
      text: `${actor.name} invited you to join ${ws.name} on Master Office.${inv.message ? `\n\n“${inv.message}”` : ''}\n\nAccept within 7 days:\n${url}`,
      html: mailHtml({ title: `Join ${ws.name}`, intro: `${actor.name} invited you to join ${ws.name} on Master Office — chat, files, documents, tasks and meetings in one place.${inv.message ? ` “${inv.message}”` : ''}`, button: { label: 'Accept invitation', url }, footer: 'The link works for 7 days.' }),
    });
    return url;
  }

  async invite(actor: Actor, input: { emails: string[]; role: 'admin' | 'editor' | 'viewer'; teams: { spaceId: string; role: 'admin' | 'editor' | 'viewer'; title?: string | null }[]; message?: string | null }) {
    const mine = await this.requireAdmin(actor);
    if (input.role === 'admin' && mine !== 'owner') throw new ForbiddenException('Only the owner invites administrators');
    const emails = [...new Set(input.emails.map(normEmail))];
    if (!emails.length) throw new BadRequestException('Enter at least one e-mail address');
    if (input.teams.length) {
      const ok = await this.db.select({ id: spaces.id }).from(spaces).where(and(eq(spaces.workspaceId, actor.workspaceId), inArray(spaces.id, input.teams.map((t) => t.spaceId))));
      if (ok.length !== new Set(input.teams.map((t) => t.spaceId)).size) throw new BadRequestException('Unknown team');
    }
    const existing = await this.db
      .select({ email: users.email })
      .from(users)
      .innerJoin(workspaceMembers, eq(workspaceMembers.userId, users.id))
      .where(and(eq(workspaceMembers.workspaceId, actor.workspaceId), inArray(sql`lower(${users.email})`, emails)));
    const members = new Set(existing.map((e) => e.email.toLowerCase()));
    const out: { email: string; status: 'sent' | 'member'; link?: string }[] = [];
    for (const email of emails) {
      if (members.has(email)) {
        out.push({ email, status: 'member' });
        continue;
      }
      const { token, hash } = newToken();
      await this.db.transaction(async (tx) => {
        await tx.update(invitations).set({ status: 'revoked' }).where(and(eq(invitations.workspaceId, actor.workspaceId), eq(invitations.email, email), eq(invitations.status, 'pending')));
        await tx.insert(invitations).values({ workspaceId: actor.workspaceId, email, role: input.role, teams: input.teams, message: input.message?.trim() || null, tokenHash: hash, invitedBy: actor.id, expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString() });
      });
      const link = await this.sendInvite(actor, { email, message: input.message }, token);
      // Without a system e-mail the admin shares the link by hand.
      out.push({ email, status: 'sent', ...(this.mail.delivering ? {} : { link }) });
    }
    return { delivered: this.mail.delivering, results: out };
  }

  async resendInvitation(actor: Actor, id: string) {
    await this.requireAdmin(actor);
    const [inv] = await this.db.select().from(invitations).where(and(eq(invitations.id, id), eq(invitations.workspaceId, actor.workspaceId), eq(invitations.status, 'pending')));
    if (!inv) throw new NotFoundException('Invitation not found');
    const { token, hash } = newToken();
    await this.db.update(invitations).set({ tokenHash: hash, expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString() }).where(eq(invitations.id, id));
    const link = await this.sendInvite(actor, inv, token);
    return { delivered: this.mail.delivering, ...(this.mail.delivering ? {} : { link }) };
  }

  async revokeInvitation(actor: Actor, id: string) {
    await this.requireAdmin(actor);
    await this.db.update(invitations).set({ status: 'revoked' }).where(and(eq(invitations.id, id), eq(invitations.workspaceId, actor.workspaceId), eq(invitations.status, 'pending')));
  }

  private async pending(token: string) {
    const [row] = await this.db
      .select({ i: invitations, ws: workspaces.name, by: users.name })
      .from(invitations)
      .innerJoin(workspaces, eq(workspaces.id, invitations.workspaceId))
      .leftJoin(users, eq(users.id, invitations.invitedBy))
      .where(and(eq(invitations.tokenHash, tokenHash(token)), eq(invitations.status, 'pending'), gt(invitations.expiresAt, new Date().toISOString())));
    if (!row) throw new NotFoundException('This invitation has expired, was cancelled or was already used — ask for a new one');
    return row;
  }

  async invitationInfo(token: string) {
    const { i, ws, by } = await this.pending(token);
    const teams = i.teams.length ? await this.db.select({ id: spaces.id, name: spaces.name }).from(spaces).where(inArray(spaces.id, i.teams.map((t) => t.spaceId))) : [];
    return { email: i.email, workspace: ws, invitedBy: by, role: i.role, teams: teams.map((t) => ({ name: t.name, title: i.teams.find((x) => x.spaceId === t.id)?.title ?? null })), message: i.message };
  }

  async accept(token: string, input: { name: string; password: string }, meta: Meta) {
    const { i } = await this.pending(token);
    checkPassword(input.password);
    const name = input.name.trim();
    if (!name) throw new BadRequestException('Enter your name');
    const done = await this.db.transaction(async (tx) => {
      const [taken] = await tx.select({ id: users.id }).from(users).where(eq(sql`lower(${users.email})`, i.email));
      if (taken) throw new BadRequestException('An account with this e-mail already exists — sign in, or ask for a password link');
      const [u] = await tx.insert(users).values({ name, email: i.email, avatarColor: colorFor(i.email) }).returning();
      await tx.insert(workspaceMembers).values({ workspaceId: i.workspaceId, userId: u.id, role: i.role });
      await this.auth.setPassword(tx, u.id, input.password);
      for (const t of i.teams) await tx.insert(spaceMembers).values({ spaceId: t.spaceId, userId: u.id, role: t.role as 'editor', title: t.title?.trim() || null }).onConflictDoNothing();
      await tx.update(invitations).set({ status: 'accepted', acceptedBy: u.id }).where(eq(invitations.id, i.id));
      return { u, token: await this.auth.createSession(tx, u.id, i.workspaceId, meta) };
    });
    // Chat follows the teams (channels, folders).
    for (const t of i.teams) await this.chat.spaceMembershipChanged(i.workspaceId, t.spaceId, done.u.id).catch(() => undefined);
    return { token: done.token };
  }
}
