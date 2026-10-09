import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { can, type Contact, type SpaceKind, type UpdateProfileInput, type UserProfile } from '@workos/shared';
import { and, asc, desc, eq, inArray, isNull, ne } from 'drizzle-orm';
import type { Actor } from '../common/current-user';
import { userColumns } from '../common/users';
import type { Db } from '../db/client';
import { InjectDb } from '../db/db.module';
import { resources, spaceMembers, spaces, users, workspaceMembers, resourceColumns } from '../db/schema';
import { PermissionsService } from '../permissions/permissions.service';
import { ResourcesService } from '../resources/resources.service';
import { visibleActivity } from './activity';

const contactColumns = {
  ...userColumns,
  phone: users.phone,
  location: users.location,
  status: users.status,
  skills: users.skills,
  managerId: users.managerId,
  phoneVisibility: users.phoneVisibility,
  joinedAt: workspaceMembers.joinedAt,
  wsRole: workspaceMembers.role,
};

/** What the viewer may see of others (§79). */
interface Viewer {
  id: string;
  admin: boolean;
  guest: boolean;
  /** People in the teams the viewer leads (owner / admin of the space): their leads see phone and location. */
  led: Set<string>;
  /** Guests only see the people of their own teams. */
  mates: Set<string>;
}

/**
 * Contacts and profiles (docs/ARCHITECTURE.md §67, §79). Members see everyone's card, guests only their team mates;
 * phone and location show to the person, admins, leads of their teams, or everyone if the person chooses so. What a
 * profile shows about work (teams, files, activity) is filtered by the viewer's own access.
 */
@Injectable()
export class ContactsService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly perms: PermissionsService,
    private readonly resources: ResourcesService,
  ) {}

  private async viewer(actor: Actor): Promise<Viewer> {
    const [[me], mine] = await Promise.all([
      this.db.select({ role: workspaceMembers.role }).from(workspaceMembers).where(and(eq(workspaceMembers.workspaceId, actor.workspaceId), eq(workspaceMembers.userId, actor.id))),
      this.db.select({ spaceId: spaceMembers.spaceId, role: spaceMembers.role }).from(spaceMembers).where(eq(spaceMembers.userId, actor.id)),
    ]);
    const ids = mine.map((m) => m.spaceId);
    const people = ids.length ? await this.db.select({ spaceId: spaceMembers.spaceId, userId: spaceMembers.userId }).from(spaceMembers).where(inArray(spaceMembers.spaceId, ids)) : [];
    const leads = new Set(mine.filter((m) => m.role === 'owner' || m.role === 'admin').map((m) => m.spaceId));
    return {
      id: actor.id,
      admin: me?.role === 'owner' || me?.role === 'admin',
      guest: me?.role === 'viewer',
      led: new Set(people.filter((p) => leads.has(p.spaceId)).map((p) => p.userId)),
      mates: new Set([actor.id, ...people.map((p) => p.userId)]),
    };
  }

  private async rows(actor: Actor, ids?: string[]) {
    return this.db
      .select(contactColumns)
      .from(users)
      .innerJoin(workspaceMembers, eq(workspaceMembers.userId, users.id))
      .where(and(eq(workspaceMembers.workspaceId, actor.workspaceId), ids ? inArray(users.id, ids.length ? ids : ['00000000-0000-0000-0000-000000000000']) : undefined))
      .orderBy(asc(users.name));
  }

  /** Spaces each person belongs to with their position there, limited to the spaces the viewer can see; leads first. */
  private async projects(actor: Actor, userIds: string[]) {
    const out = new Map<string, Contact['projects']>();
    if (!userIds.length) return out;
    const [rows, visible] = await Promise.all([
      this.db
        .select({ userId: spaceMembers.userId, id: spaces.id, name: spaces.name, color: spaces.color, kind: spaces.kind, title: spaceMembers.title, role: spaceMembers.role })
        .from(spaceMembers)
        .innerJoin(spaces, eq(spaces.id, spaceMembers.spaceId))
        .where(and(inArray(spaceMembers.userId, userIds), eq(spaces.workspaceId, actor.workspaceId)))
        .orderBy(asc(spaces.name)),
      this.perms.spaceRoles(actor),
    ]);
    for (const r of rows)
      if (can(visible.get(r.id), 'viewer'))
        out.set(r.userId, [...(out.get(r.userId) ?? []), { id: r.id, name: r.name, color: r.color, kind: r.kind as SpaceKind, title: r.title, lead: r.role === 'owner' || r.role === 'admin' }]);
    for (const list of out.values()) list.sort((a, b) => Number(b.lead) - Number(a.lead) || a.name.localeCompare(b.name));
    return out;
  }

  private card(r: Awaited<ReturnType<ContactsService['rows']>>[number], projects: Map<string, Contact['projects']>, v: Viewer): Contact {
    const { wsRole: _role, phoneVisibility, ...rest } = r;
    const shown = r.id === v.id || v.admin || v.led.has(r.id) || phoneVisibility === 'everyone';
    return { ...rest, ...(shown ? {} : { phone: null, location: null, phoneHidden: !!(r.phone || r.location) }), projects: projects.get(r.id) ?? [] };
  }

  async list(actor: Actor, q?: string): Promise<Contact[]> {
    const v = await this.viewer(actor);
    const rows = (await this.rows(actor)).filter((r) => !v.guest || v.mates.has(r.id));
    const projects = await this.projects(actor, rows.map((r) => r.id));
    const cards = rows.map((r) => this.card(r, projects, v));
    const needle = q?.trim().toLowerCase();
    if (!needle) return cards;
    // Name, e-mail, title, department, location, skills and projects are all searchable.
    return cards.filter((c) =>
      [c.name, c.email, c.title, c.department, c.location, ...c.skills, ...c.projects.map((p) => p.name)].some((v) => v?.toLowerCase().includes(needle)),
    );
  }

  async profile(actor: Actor, id: string): Promise<UserProfile> {
    const v = await this.viewer(actor);
    const [row] = await this.rows(actor, [id]);
    if (!row || (v.guest && !v.mates.has(id))) throw new NotFoundException('Person not found');
    const everyone = (await this.rows(actor)).filter((r) => !v.guest || v.mates.has(r.id));
    const byId = new Map(everyone.map((r) => [r.id, r]));
    const summary = (x: (typeof everyone)[number]) => ({ id: x.id, name: x.name, email: x.email, avatarColor: x.avatarColor, title: x.title, department: x.department });
    const chain: UserProfile['chain'] = [];
    for (let m = row.managerId ? byId.get(row.managerId) : undefined, guard = 0; m && guard < 20; m = m.managerId ? byId.get(m.managerId) : undefined, guard++) chain.push(summary(m));
    const reports = everyone.filter((r) => r.managerId === id).map(summary);

    const owned = await this.db
      .select(resourceColumns)
      .from(resources)
      .where(and(eq(resources.workspaceId, actor.workspaceId), eq(resources.ownerId, id), isNull(resources.trashedAt), ne(resources.type, 'folder')))
      .orderBy(desc(resources.updatedAt))
      .limit(60);
    const [projects, files, activity] = await Promise.all([
      this.projects(actor, [id]),
      this.resources.toDtos(actor, owned),
      visibleActivity(this.db, this.perms, actor, { limit: 15, by: id }),
    ]);
    const owner = v.admin;
    return {
      ...this.card(row, projects, v),
      ...(id === actor.id ? { phoneVisibility: row.phoneVisibility as 'leads' | 'everyone' } : {}),
      manager: chain[0] ?? null,
      chain: chain.slice(1),
      reports,
      files: files.slice(0, 12),
      activity,
      isMe: id === actor.id,
      canEdit: id === actor.id || owner,
      canEditOrg: owner,
    };
  }

  async update(actor: Actor, id: string, input: UpdateProfileInput) {
    const [target] = await this.rows(actor, [id]);
    if (!target) throw new NotFoundException('Person not found');
    const owner = (await this.viewer(actor)).admin;
    if (id !== actor.id && !owner) throw new ForbiddenException('You can only edit your own profile');
    if (input.phoneVisibility !== undefined && id !== actor.id) throw new ForbiddenException('Only the person chooses who sees their phone');
    const orgFields = input.title !== undefined || input.department !== undefined || input.managerId !== undefined;
    // People keep their own contact details; title, department and reporting line belong to the organisation.
    if (orgFields && !owner) throw new ForbiddenException('Only administrators change titles, departments and managers');
    if (input.managerId) {
      if (input.managerId === id) throw new BadRequestException('Someone cannot be their own manager');
      const all = await this.rows(actor);
      const byId = new Map(all.map((r) => [r.id, r]));
      if (!byId.has(input.managerId)) throw new BadRequestException('The manager is not in this workspace');
      for (let m = byId.get(input.managerId), guard = 0; m && guard < 50; m = m.managerId ? byId.get(m.managerId) : undefined, guard++)
        if (m.id === id) throw new BadRequestException('That would make a reporting loop');
    }
    const clean = (v: string | null | undefined) => (v === undefined ? undefined : v?.trim() || null);
    const set = {
      phone: clean(input.phone),
      location: clean(input.location),
      status: clean(input.status),
      title: clean(input.title),
      department: clean(input.department),
      managerId: input.managerId,
      phoneVisibility: input.phoneVisibility,
      skills: input.skills ? [...new Set(input.skills.map((x) => x.trim()).filter(Boolean))].slice(0, 20) : undefined,
    };
    const defined = Object.fromEntries(Object.entries(set).filter(([, v]) => v !== undefined));
    if (Object.keys(defined).length) await this.db.update(users).set(defined).where(eq(users.id, id));
    return this.profile(actor, id);
  }
}
