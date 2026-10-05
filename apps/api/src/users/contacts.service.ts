import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { can, type Contact, type UpdateProfileInput, type UserProfile } from '@workos/shared';
import { and, asc, desc, eq, inArray, isNull, ne } from 'drizzle-orm';
import type { Actor } from '../common/current-user';
import { userColumns } from '../common/users';
import type { Db } from '../db/client';
import { InjectDb } from '../db/db.module';
import { resources, spaceMembers, spaces, users, workspaceMembers } from '../db/schema';
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
  joinedAt: workspaceMembers.joinedAt,
  wsRole: workspaceMembers.role,
};

/**
 * Contacts and profiles (docs/ARCHITECTURE.md §67). Everyone in a workspace sees everyone's card; what a profile
 * shows about work (projects, files, activity) is filtered by the viewer's own access.
 */
@Injectable()
export class ContactsService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly perms: PermissionsService,
    private readonly resources: ResourcesService,
  ) {}

  private async rows(actor: Actor, ids?: string[]) {
    return this.db
      .select(contactColumns)
      .from(users)
      .innerJoin(workspaceMembers, eq(workspaceMembers.userId, users.id))
      .where(and(eq(workspaceMembers.workspaceId, actor.workspaceId), ids ? inArray(users.id, ids.length ? ids : ['00000000-0000-0000-0000-000000000000']) : undefined))
      .orderBy(asc(users.name));
  }

  /** Spaces each person belongs to, limited to the spaces the viewer can see. */
  private async projects(actor: Actor, userIds: string[]) {
    const out = new Map<string, Contact['projects']>();
    if (!userIds.length) return out;
    const [rows, visible] = await Promise.all([
      this.db
        .select({ userId: spaceMembers.userId, id: spaces.id, name: spaces.name, color: spaces.color })
        .from(spaceMembers)
        .innerJoin(spaces, eq(spaces.id, spaceMembers.spaceId))
        .where(and(inArray(spaceMembers.userId, userIds), eq(spaces.workspaceId, actor.workspaceId)))
        .orderBy(asc(spaces.name)),
      this.perms.spaceRoles(actor),
    ]);
    for (const r of rows) if (can(visible.get(r.id), 'viewer')) out.set(r.userId, [...(out.get(r.userId) ?? []), { id: r.id, name: r.name, color: r.color }]);
    return out;
  }

  private card(r: Awaited<ReturnType<ContactsService['rows']>>[number], projects: Map<string, Contact['projects']>): Contact {
    const { wsRole: _role, ...rest } = r;
    return { ...rest, projects: projects.get(r.id) ?? [] };
  }

  async list(actor: Actor, q?: string): Promise<Contact[]> {
    const rows = await this.rows(actor);
    const projects = await this.projects(actor, rows.map((r) => r.id));
    const cards = rows.map((r) => this.card(r, projects));
    const needle = q?.trim().toLowerCase();
    if (!needle) return cards;
    // Name, e-mail, title, department, location, skills and projects are all searchable.
    return cards.filter((c) =>
      [c.name, c.email, c.title, c.department, c.location, ...c.skills, ...c.projects.map((p) => p.name)].some((v) => v?.toLowerCase().includes(needle)),
    );
  }

  async profile(actor: Actor, id: string): Promise<UserProfile> {
    const [row] = await this.rows(actor, [id]);
    if (!row) throw new NotFoundException('Person not found');
    const everyone = await this.rows(actor);
    const byId = new Map(everyone.map((r) => [r.id, r]));
    const summary = (x: (typeof everyone)[number]) => ({ id: x.id, name: x.name, email: x.email, avatarColor: x.avatarColor, title: x.title, department: x.department });
    const chain: UserProfile['chain'] = [];
    for (let m = row.managerId ? byId.get(row.managerId) : undefined, guard = 0; m && guard < 20; m = m.managerId ? byId.get(m.managerId) : undefined, guard++) chain.push(summary(m));
    const reports = everyone.filter((r) => r.managerId === id).map(summary);

    const owned = await this.db
      .select()
      .from(resources)
      .where(and(eq(resources.workspaceId, actor.workspaceId), eq(resources.ownerId, id), isNull(resources.trashedAt), ne(resources.type, 'folder')))
      .orderBy(desc(resources.updatedAt))
      .limit(60);
    const [projects, files, activity, me] = await Promise.all([
      this.projects(actor, [id]),
      this.resources.toDtos(actor, owned),
      visibleActivity(this.db, this.perms, actor, { limit: 15, by: id }),
      this.db.select({ role: workspaceMembers.role }).from(workspaceMembers).where(and(eq(workspaceMembers.workspaceId, actor.workspaceId), eq(workspaceMembers.userId, actor.id))),
    ]);
    const owner = me[0]?.role === 'owner';
    return {
      ...this.card(row, projects),
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
    const [me] = await this.db.select({ role: workspaceMembers.role }).from(workspaceMembers).where(and(eq(workspaceMembers.workspaceId, actor.workspaceId), eq(workspaceMembers.userId, actor.id)));
    const owner = me?.role === 'owner';
    if (id !== actor.id && !owner) throw new ForbiddenException('You can only edit your own profile');
    const orgFields = input.title !== undefined || input.department !== undefined || input.managerId !== undefined;
    // People keep their own contact details; title, department and reporting line belong to the organisation.
    if (orgFields && !owner) throw new ForbiddenException('Only workspace owners change titles, departments and managers');
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
      skills: input.skills ? [...new Set(input.skills.map((x) => x.trim()).filter(Boolean))].slice(0, 20) : undefined,
    };
    const defined = Object.fromEntries(Object.entries(set).filter(([, v]) => v !== undefined));
    if (Object.keys(defined).length) await this.db.update(users).set(defined).where(eq(users.id, id));
    return this.profile(actor, id);
  }
}
