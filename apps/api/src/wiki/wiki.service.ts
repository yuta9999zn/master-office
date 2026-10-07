import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { BA_SET, PROJECT_DOC_SETS, projectDocTemplate } from '@workos/doc-model';
import { between, can, WIKI_STATUS, type Role, type WikiPageNode, type WikiPageStatus, type WikiSpaceDetail, type WikiSpaceSummary } from '@workos/shared';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Actor } from '../common/current-user';
import { loadUsers } from '../common/users';
import type { Db, Tx } from '../db/client';
import { InjectDb } from '../db/db.module';
import { resources, wikiPages, wikiSpaces } from '../db/schema';
import { PermissionsService } from '../permissions/permissions.service';
import { ResourcesService } from '../resources/resources.service';

type SpaceRow = typeof wikiSpaces.$inferSelect;
type PageRow = typeof wikiPages.$inferSelect;
export type StarterSet = keyof typeof PROJECT_DOC_SETS | 'blank' | 'ba';

const STATUSES = ['', ...Object.keys(WIKI_STATUS)] as WikiPageStatus[];

/**
 * Wiki (docs/ARCHITECTURE.md §78): Confluence-style spaces. A space is a Drive folder (its roles are the space's
 * permissions — viewer reads, editor writes pages, admin manages the space); a page is a `wiki` resource in that
 * folder (Docs editor, comments, versions, exports) with its place in the page tree, status and labels here.
 */
@Injectable()
export class WikiService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly perms: PermissionsService,
    private readonly resources: ResourcesService,
  ) {}

  // ── Access ────────────────────────────────────────────────────────────────

  async space(actor: Actor, id: string, need: Role = 'viewer', tx: Tx = this.db) {
    const [s] = await tx.select().from(wikiSpaces).where(eq(wikiSpaces.id, id));
    if (!s || s.workspaceId !== actor.workspaceId) throw new NotFoundException('Space not found');
    const { role } = await this.perms.require(actor, s.folderId, 'viewer', tx).catch(() => {
      throw new NotFoundException('Space not found');
    });
    if (!can(role, need)) throw new ForbiddenException(need === 'admin' ? 'Space admins change the space' : 'Editors of the space change its pages');
    return { s, role };
  }

  private async page(actor: Actor, id: string, need: Role = 'viewer') {
    const [p] = await this.db.select().from(wikiPages).where(eq(wikiPages.resourceId, id));
    if (!p) throw new NotFoundException('Page not found');
    const { s, role } = await this.space(actor, p.spaceId, need);
    return { p, s, role };
  }

  // ── Spaces ────────────────────────────────────────────────────────────────

  async spaces(actor: Actor): Promise<WikiSpaceSummary[]> {
    const rows = await this.db.select().from(wikiSpaces).where(eq(wikiSpaces.workspaceId, actor.workspaceId)).orderBy(asc(wikiSpaces.name));
    if (!rows.length) return [];
    const folders = await this.db.select().from(resources).where(inArray(resources.id, rows.map((r) => r.folderId)));
    const roles = await this.perms.rolesFor(actor, folders);
    const stats = await this.db.execute<{ space_id: string; n: string; updated: string | null }>(sql`
      SELECT p.space_id, count(*) AS n, max(r.updated_at) AS updated FROM wiki_pages p JOIN resources r ON r.id = p.resource_id
      WHERE r.trashed_at IS NULL GROUP BY p.space_id`);
    return rows
      .filter((r) => can(roles.get(r.folderId), 'viewer') && !folders.find((f) => f.id === r.folderId)?.trashedAt)
      .map((r) => {
        const st = stats.rows.find((x) => x.space_id === r.id);
        return this.summary(r, roles.get(r.folderId)!, Number(st?.n ?? 0), st?.updated ? new Date(st.updated).toISOString() : null);
      });
  }

  private summary(s: SpaceRow, role: Role, pages: number, updatedAt: string | null): WikiSpaceSummary {
    return { id: s.id, key: s.key, name: s.name, description: s.description, color: s.color, folderId: s.folderId, homePageId: s.homePageId, projectId: s.projectId, role, pages, updatedAt };
  }

  /** A new space: a folder (in a workspace Space, or My Files), a home page, and the starter pages of a set. */
  async createSpace(actor: Actor, input: { name: string; key?: string; description?: string | null; color?: string; spaceId?: string | null; set?: StarterSet; projectId?: string | null }) {
    const name = input.name.trim().slice(0, 120);
    if (!name) throw new BadRequestException('A space needs a name');
    const key = (input.key?.trim() || name.replace(/[^A-Za-z0-9 ]/g, '').split(/\s+/).map((w) => w[0]).join('').slice(0, 6) || 'WIKI').toUpperCase();
    if (!/^[A-Z][A-Z0-9]{1,9}$/.test(key)) throw new BadRequestException('The key is 2–10 letters or digits, starting with a letter');
    const [taken] = await this.db.select({ id: wikiSpaces.id }).from(wikiSpaces).where(and(eq(wikiSpaces.workspaceId, actor.workspaceId), eq(wikiSpaces.key, key)));
    if (taken) throw new BadRequestException(`The key ${key} is already used`);
    const folder = await this.resources.create(actor, { name: `${name} (Wiki)`, type: 'folder', spaceId: input.spaceId ?? null });
    const [s] = await this.db
      .insert(wikiSpaces)
      .values({ workspaceId: actor.workspaceId, key, name, description: input.description?.trim() || null, color: input.color ?? '#2563eb', folderId: folder.id, projectId: input.projectId ?? null, createdBy: actor.id })
      .returning();
    const home = await this.createPage(actor, s.id, { title: `${name} home`, template: 'pd-space-home' });
    await this.db.update(wikiSpaces).set({ homePageId: home.id }).where(eq(wikiSpaces.id, s.id));
    if (input.set && input.set !== 'blank') await this.addStarter(actor, s.id, input.set);
    return this.detail(actor, s.id);
  }

  async updateSpace(actor: Actor, id: string, input: { name?: string; description?: string | null; color?: string; homePageId?: string | null }) {
    await this.space(actor, id, 'admin');
    const set: Partial<SpaceRow> = {};
    if (input.name?.trim()) set.name = input.name.trim().slice(0, 120);
    if (input.description !== undefined) set.description = input.description?.trim() || null;
    if (input.color && /^#[0-9a-f]{6}$/i.test(input.color)) set.color = input.color;
    if (input.homePageId !== undefined) {
      if (input.homePageId) {
        const [p] = await this.db.select().from(wikiPages).where(eq(wikiPages.resourceId, input.homePageId));
        if (!p || p.spaceId !== id) throw new BadRequestException('The home page is a page of this space');
      }
      set.homePageId = input.homePageId;
    }
    if (Object.keys(set).length) await this.db.update(wikiSpaces).set(set).where(eq(wikiSpaces.id, id));
    return this.detail(actor, id);
  }

  /** The space with its whole page tree (pages the actor can see). */
  async detail(actor: Actor, id: string): Promise<WikiSpaceDetail> {
    const { s, role } = await this.space(actor, id);
    const rows = await this.db
      .select({ p: wikiPages, r: resources })
      .from(wikiPages)
      .innerJoin(resources, eq(resources.id, wikiPages.resourceId))
      .where(and(eq(wikiPages.spaceId, id), isNull(resources.trashedAt)))
      .orderBy(asc(wikiPages.position));
    const roles = await this.perms.rolesFor(actor, rows.map((x) => x.r));
    const visible = rows.filter((x) => can(roles.get(x.r.id), 'viewer'));
    const linked = visible.length
      ? await this.db.execute<{ resource_id: string; n: string }>(sql`SELECT resource_id, count(*) AS n FROM task_docs WHERE resource_id IN (${sql.join(visible.map((x) => sql`${x.r.id}`), sql`, `)}) GROUP BY resource_id`)
      : { rows: [] };
    const people = await loadUsers(this.db, visible.flatMap((x) => [x.r.updatedBy, x.p.ownerId]));
    const ids = new Set(visible.map((x) => x.r.id));
    const tree: WikiPageNode[] = visible.map(({ p, r }) => ({
      id: r.id,
      title: r.name,
      // A page whose parent was removed (or is hidden) shows at the top.
      parentId: p.parentId && ids.has(p.parentId) ? p.parentId : null,
      position: p.position,
      status: (p.status as WikiPageStatus) ?? '',
      labels: p.labels,
      template: p.template,
      owner: p.ownerId ? (people.get(p.ownerId) ?? null) : null,
      updatedAt: r.updatedAt,
      updatedBy: r.updatedBy ? (people.get(r.updatedBy) ?? null) : null,
      linked: Number(linked.rows.find((x) => x.resource_id === r.id)?.n ?? 0),
    }));
    const updated = tree.reduce<string | null>((m, x) => (!m || x.updatedAt > m ? x.updatedAt : m), null);
    return { ...this.summary(s, role, tree.length, updated), tree };
  }

  /** The space of a page (opening /wiki/:pageId lands in its space). */
  async pageSpace(actor: Actor, pageId: string) {
    const { s } = await this.page(actor, pageId);
    return { spaceId: s.id };
  }

  // ── Pages ─────────────────────────────────────────────────────────────────

  private async lastPosition(tx: Tx, spaceId: string, parentId: string | null) {
    const [last] = await tx
      .select({ p: wikiPages.position })
      .from(wikiPages)
      .where(and(eq(wikiPages.spaceId, spaceId), parentId ? eq(wikiPages.parentId, parentId) : isNull(wikiPages.parentId)))
      .orderBy(desc(wikiPages.position))
      .limit(1);
    return last?.p ?? null;
  }

  async createPage(actor: Actor, spaceId: string, input: { title?: string; parentId?: string | null; template?: string | null }) {
    const { s } = await this.space(actor, spaceId, 'editor');
    const tpl = input.template ? projectDocTemplate(input.template) : null;
    if (input.template && !tpl) throw new BadRequestException('Unknown template');
    if (input.parentId) {
      const [parent] = await this.db.select().from(wikiPages).where(eq(wikiPages.resourceId, input.parentId));
      if (!parent || parent.spaceId !== spaceId) throw new BadRequestException('The parent page is in another space');
    }
    const title = (input.title?.trim() || (tpl ? tpl.name.replace(/^AI-DLC · /, '') : 'Untitled page')).slice(0, 200);
    const r = await this.resources.create(actor, { name: title, type: 'wiki', parentId: s.folderId, ...(tpl ? { template: tpl.id } : {}) });
    const position = between(await this.lastPosition(this.db, spaceId, input.parentId ?? null), null);
    await this.db.insert(wikiPages).values({ resourceId: r.id, spaceId, parentId: input.parentId ?? null, position, template: tpl?.id ?? null, ownerId: actor.id, status: tpl && !tpl.hidden ? 'draft' : '' });
    return r;
  }

  /** Moves a page (under another, or to the top), and / or sets its status, labels or owner. */
  async updatePage(actor: Actor, id: string, input: { parentId?: string | null; afterId?: string | null; beforeId?: string | null; status?: WikiPageStatus; labels?: string[]; ownerId?: string | null }) {
    const { p } = await this.page(actor, id, 'editor');
    const set: Partial<PageRow> = {};
    if (input.status !== undefined) {
      if (!STATUSES.includes(input.status)) throw new BadRequestException('Unknown status');
      set.status = input.status;
    }
    if (input.labels) set.labels = [...new Set(input.labels.map((l) => l.trim().toLowerCase().replace(/\s+/g, '-')).filter(Boolean))].slice(0, 20);
    if (input.ownerId !== undefined) set.ownerId = input.ownerId;
    if (input.parentId !== undefined || input.afterId !== undefined || input.beforeId !== undefined) {
      const parentId = input.parentId !== undefined ? input.parentId : p.parentId;
      if (parentId) {
        if (parentId === id) throw new BadRequestException('A page cannot be its own parent');
        const [parent] = await this.db.select().from(wikiPages).where(eq(wikiPages.resourceId, parentId));
        if (!parent || parent.spaceId !== p.spaceId) throw new BadRequestException('Move pages within their space');
        // Not under its own subpage.
        for (let up: string | null = parent.parentId, i = 0; up && i < 50; i++) {
          if (up === id) throw new BadRequestException('A page cannot go under its own subpage');
          up = (await this.db.select({ parentId: wikiPages.parentId }).from(wikiPages).where(eq(wikiPages.resourceId, up)))[0]?.parentId ?? null;
        }
      }
      const pos = async (x?: string | null) => (x ? ((await this.db.select({ p: wikiPages.position }).from(wikiPages).where(eq(wikiPages.resourceId, x)))[0]?.p ?? null) : null);
      const after = await pos(input.afterId);
      const before = await pos(input.beforeId);
      set.parentId = parentId;
      set.position = after || before ? between(after, before) : between(await this.lastPosition(this.db, p.spaceId, parentId), null);
    }
    if (Object.keys(set).length) await this.db.update(wikiPages).set(set).where(eq(wikiPages.resourceId, id));
    return this.detail(actor, p.spaceId);
  }

  private async descendants(spaceId: string, id: string) {
    const all = await this.db.select({ id: wikiPages.resourceId, parentId: wikiPages.parentId }).from(wikiPages).where(eq(wikiPages.spaceId, spaceId));
    const out: string[] = [];
    const walk = (pid: string) => {
      for (const c of all.filter((x) => x.parentId === pid)) {
        out.push(c.id);
        walk(c.id);
      }
    };
    walk(id);
    return out;
  }

  /** Moves a page and its subpages to the trash (restorable from Drive's trash). */
  async deletePage(actor: Actor, id: string) {
    const { p, s } = await this.page(actor, id, 'editor');
    if (s.homePageId === id) throw new BadRequestException('The home page of a space stays');
    for (const pid of [id, ...(await this.descendants(p.spaceId, id))]) await this.resources.trash(actor, pid).catch(() => undefined);
    return this.detail(actor, p.spaceId);
  }

  /** Copies a page (and, if asked, its subpages) next to it. */
  async copyPage(actor: Actor, id: string, input: { withChildren?: boolean }) {
    const { p, s } = await this.page(actor, id, 'editor');
    const copyOne = async (srcId: string, parentId: string | null, rename: boolean): Promise<string> => {
      const [src] = await this.db.select().from(wikiPages).where(eq(wikiPages.resourceId, srcId));
      const r = await this.resources.copy(actor, srcId, { parentId: s.folderId });
      // The copied page is marked as a copy; its subpages keep their titles.
      const [orig] = await this.db.select({ name: resources.name }).from(resources).where(eq(resources.id, srcId));
      await this.db.update(resources).set({ name: rename ? `${orig.name} (Copy)` : orig.name }).where(eq(resources.id, r.id));
      await this.db.insert(wikiPages).values({ resourceId: r.id, spaceId: s.id, parentId, position: between(await this.lastPosition(this.db, s.id, parentId), null), status: src.status, labels: src.labels, template: src.template, ownerId: actor.id });
      if (input.withChildren) {
        const kids = await this.db.select().from(wikiPages).where(eq(wikiPages.parentId, srcId)).orderBy(asc(wikiPages.position));
        for (const k of kids) await copyOne(k.resourceId, r.id, false);
      }
      return r.id;
    };
    const newId = await copyOne(id, p.parentId, true);
    return { id: newId, space: await this.detail(actor, s.id) };
  }

  /** Recently changed pages of the spaces the actor can see. */
  async recent(actor: Actor, limit = 20) {
    const spaces = await this.spaces(actor);
    if (!spaces.length) return [];
    const rows = await this.db
      .select({ p: wikiPages, r: resources })
      .from(wikiPages)
      .innerJoin(resources, eq(resources.id, wikiPages.resourceId))
      .where(and(inArray(wikiPages.spaceId, spaces.map((s) => s.id)), isNull(resources.trashedAt)))
      .orderBy(desc(resources.updatedAt))
      .limit(limit * 2);
    const roles = await this.perms.rolesFor(actor, rows.map((x) => x.r));
    const people = await loadUsers(this.db, rows.map((x) => x.r.updatedBy));
    return rows
      .filter((x) => can(roles.get(x.r.id), 'viewer'))
      .slice(0, limit)
      .map(({ p, r }) => ({ id: r.id, title: r.name, spaceId: p.spaceId, spaceName: spaces.find((s) => s.id === p.spaceId)!.name, status: p.status, updatedAt: r.updatedAt, updatedBy: r.updatedBy ? (people.get(r.updatedBy) ?? null) : null }));
  }

  // ── Starter sets ──────────────────────────────────────────────────────────

  /** The top-level section page of a category (made on first use). */
  async sectionFor(actor: Actor, spaceId: string, category: string) {
    const rows = await this.db
      .select({ id: wikiPages.resourceId })
      .from(wikiPages)
      .innerJoin(resources, eq(resources.id, wikiPages.resourceId))
      .where(and(eq(wikiPages.spaceId, spaceId), isNull(wikiPages.parentId), isNull(wikiPages.template), eq(resources.name, category), isNull(resources.trashedAt)));
    return rows[0]?.id ?? (await this.createPage(actor, spaceId, { title: category })).id;
  }

  /** Adds the pages of a starter set: a section page per category with its template pages under it. */
  async addStarter(actor: Actor, spaceId: string, set: Exclude<StarterSet, 'blank'>, titleFor?: (templateId: string) => string) {
    const ids = set === 'ba' ? BA_SET : PROJECT_DOC_SETS[set].templates;
    const existing = (await this.detail(actor, spaceId)).tree;
    for (const id of ids) {
      const tpl = projectDocTemplate(id);
      if (!tpl || existing.some((x) => x.template === id)) continue;
      const section = await this.sectionFor(actor, spaceId, tpl.category);
      await this.createPage(actor, spaceId, { template: id, parentId: section, title: titleFor?.(id) });
    }
    return this.detail(actor, spaceId);
  }

  /** The space that documents a Tasks project, if it has one. */
  async ofProject(projectId: string) {
    const [s] = await this.db.select().from(wikiSpaces).where(eq(wikiSpaces.projectId, projectId));
    return s ?? null;
  }

  /** A key no other space of the workspace uses, starting from a wish. */
  async freeKey(workspaceId: string, wish: string) {
    const base = wish.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) || 'WIKI';
    const taken = new Set((await this.db.select({ key: wikiSpaces.key }).from(wikiSpaces).where(eq(wikiSpaces.workspaceId, workspaceId))).map((r) => r.key));
    if (!taken.has(base)) return base;
    for (let i = 2; ; i++) if (!taken.has(`${base}${i}`)) return `${base}${i}`;
  }
}
