import { templateDocument } from '@workos/doc-model';
import { templateWorkbook } from '@workos/sheet-model';
import { templateDeck } from '@workos/slide-model';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, NotImplementedException } from '@nestjs/common';
import {
  can,
  NATIVE_TYPES,
  resourceTypeFromFile,
  type AclEntry,
  type ActivityEvent,
  type Breadcrumb,
  type CreateResourceInput,
  type ListResourcesQuery,
  type Resource,
  type ResourceDetail,
  type Role,
  type UpdateResourceInput,
} from '@workos/shared';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Actor } from '../common/current-user';
import { loadUsers } from '../common/users';
import { runAll, type Db, type Tx } from '../db/client';
import { InjectDb } from '../db/db.module';
import { aclEntries, auditEvents, blobs, resourceAccess, resources, resourceVersions, spaceMembers, spaces, stars } from '../db/schema';
import { EventsService } from '../events/events.service';
import { PermissionsService } from '../permissions/permissions.service';
import { NotificationsService, resourcePath } from '../notifications/notifications.service';
import { StorageService } from '../storage/storage.service';
import { COLLAB_TYPES, DocsService } from '../docs/docs.service';
import { SheetsService } from '../sheets/sheets.service';
import { SlidesService } from '../slides/slides.service';
import { FormsService } from '../forms/forms.service';

type Row = typeof resources.$inferSelect;

const alive = sql`${resources.trashedAt} IS NULL AND NOT EXISTS (
  SELECT 1 FROM resources a WHERE a.id = ANY(${resources.path}) AND a.trashed_at IS NOT NULL)`;

function copyName(name: string) {
  const dot = name.lastIndexOf('.');
  return dot > 0 && name.length - dot <= 6 ? `${name.slice(0, dot)} (Copy)${name.slice(dot)}` : `${name} (Copy)`;
}

@Injectable()
export class ResourcesService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly perms: PermissionsService,
    private readonly events: EventsService,
    private readonly storage: StorageService,
    private readonly docs: DocsService,
    private readonly sheets: SheetsService,
    private readonly slides: SlidesService,
    private readonly forms: FormsService,
    private readonly notifications: NotificationsService,
  ) {}

  // ── Serialization ──────────────────────────────────────────────────────────

  async toDtos(actor: Actor, rows: Row[], tx: Tx = this.db, minRole: Role = 'viewer'): Promise<Resource[]> {
    if (!rows.length) return [];
    const [roles, owners, starred] = await runAll(tx !== this.db, [
      () => this.perms.rolesFor(actor, rows, tx),
      () => loadUsers(tx, rows.map((r) => r.ownerId)),
      () =>
        tx
        .select({ id: stars.resourceId })
        .from(stars)
        .where(and(eq(stars.userId, actor.id), inArray(stars.resourceId, rows.map((r) => r.id)))),
    ] as const);
    const starSet = new Set(starred.map((s) => s.id));
    return rows
      .filter((r) => can(roles.get(r.id), minRole))
      .map((r) => ({
        id: r.id,
        workspaceId: r.workspaceId,
        spaceId: r.spaceId,
        parentId: r.parentId,
        name: r.name,
        type: r.type,
        ownerId: r.ownerId,
        owner: owners.get(r.ownerId),
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
        updatedBy: r.updatedBy,
        version: r.version,
        sizeBytes: r.sizeBytes,
        mimeType: r.mimeType,
        description: r.description,
        tags: r.tags,
        generalAccess: r.generalAccess,
        generalRole: r.generalRole,
        metadata: r.metadata,
        trashedAt: r.trashedAt,
        path: r.path,
        myRole: roles.get(r.id) ?? null,
        starred: starSet.has(r.id),
      }));
  }

  // ── Queries ────────────────────────────────────────────────────────────────

  async list(actor: Actor, q: ListResourcesQuery): Promise<Resource[]> {
    const ws = eq(resources.workspaceId, actor.workspaceId);
    const typeFilter = q.type ? eq(resources.type, q.type) : undefined;
    let rows: Row[];

    if (q.parentId) {
      await this.perms.require(actor, q.parentId, 'viewer');
      rows = await this.db.select().from(resources).where(and(ws, eq(resources.parentId, q.parentId), alive, typeFilter));
    } else if (q.spaceId) {
      await this.perms.requireSpace(actor, q.spaceId, 'viewer');
      rows = await this.db
        .select()
        .from(resources)
        .where(and(ws, eq(resources.spaceId, q.spaceId), q.deep ? undefined : sql`${resources.parentId} IS NULL`, alive, typeFilter));
    } else {
      switch (q.view) {
        case 'my':
          rows = await this.db
            .select()
            .from(resources)
            .where(and(ws, eq(resources.ownerId, actor.id), sql`${resources.spaceId} IS NULL AND ${resources.parentId} IS NULL`, alive, typeFilter));
          break;
        case 'shared':
          rows = await this.db
            .select()
            .from(resources)
            .where(
              and(
                ws,
                sql`${resources.ownerId} <> ${actor.id}`,
                sql`EXISTS (SELECT 1 FROM acl_entries e WHERE e.resource_id = ${resources.id}
                      AND e.principal_type = 'user' AND e.principal_id = ${actor.id})`,
                alive,
                typeFilter,
              ),
            );
          break;
        case 'home':
        case 'recent': {
          const r = await this.db
            .select({ r: resources })
            .from(resourceAccess)
            .innerJoin(resources, eq(resources.id, resourceAccess.resourceId))
            .where(and(eq(resourceAccess.userId, actor.id), ws, alive, sql`${resources.type} <> 'folder'`, typeFilter))
            .orderBy(desc(resourceAccess.accessedAt))
            .limit(50);
          return this.toDtos(actor, r.map((x) => x.r)); // keep access order
        }
        case 'starred': {
          const r = await this.db
            .select({ r: resources })
            .from(stars)
            .innerJoin(resources, eq(resources.id, stars.resourceId))
            .where(and(eq(stars.userId, actor.id), ws, alive, typeFilter));
          rows = r.map((x) => x.r);
          break;
        }
        case 'trash':
          rows = await this.db
            .select()
            .from(resources)
            .where(
              and(
                ws,
                sql`${resources.trashedAt} IS NOT NULL`,
                sql`(${resources.ownerId} = ${actor.id} OR ${resources.trashedBy} = ${actor.id})`,
                sql`NOT EXISTS (SELECT 1 FROM resources a WHERE a.id = ANY(${resources.path}) AND a.trashed_at IS NOT NULL)`,
                typeFilter,
              ),
            )
            .orderBy(desc(resources.trashedAt));
          return this.toDtos(actor, rows);
        default:
          if (!q.type) throw new BadRequestException('Specify view, parentId, spaceId or type');
          // App index pages (Docs, Sheets, Slides…): every accessible resource of one type.
          rows = await this.db.select().from(resources).where(and(ws, alive, typeFilter)).orderBy(desc(resources.updatedAt)).limit(300);
      }
    }
    return this.sort(await this.toDtos(actor, rows), q);
  }

  private sort(items: Resource[], q: ListResourcesQuery) {
    const dir = q.order === 'asc' ? 1 : q.order === 'desc' ? -1 : q.sort === 'name' || !q.sort ? 1 : -1;
    const key = q.sort ?? 'name';
    const cmp = (a: Resource, b: Resource) => {
      if (key === 'updatedAt') return a.updatedAt.localeCompare(b.updatedAt);
      if (key === 'size') return a.sizeBytes - b.sizeBytes;
      if (key === 'type') return a.type.localeCompare(b.type) || a.name.localeCompare(b.name, 'vi');
      return a.name.localeCompare(b.name, 'vi', { numeric: true });
    };
    return items.sort((a, b) => (a.type === 'folder' ? 0 : 1) - (b.type === 'folder' ? 0 : 1) || cmp(a, b) * dir);
  }

  async get(actor: Actor, id: string): Promise<ResourceDetail> {
    const { row } = await this.perms.require(actor, id, 'viewer');
    const [dto] = await this.toDtos(actor, [row]);
    const breadcrumb: Breadcrumb[] = [];
    let space: ResourceDetail['space'] = null;
    if (row.spaceId) {
      const [s] = await this.db
        .select({ id: spaces.id, name: spaces.name, color: spaces.color, icon: spaces.icon })
        .from(spaces)
        .where(eq(spaces.id, row.spaceId));
      space = s ?? null;
      if (s) breadcrumb.push({ id: s.id, name: s.name, kind: 'space' });
    } else {
      breadcrumb.push({ id: row.ownerId === actor.id ? 'my' : 'shared', name: row.ownerId === actor.id ? 'My Files' : 'Shared with me', kind: 'root' });
    }
    if (row.path.length) {
      const anc = await this.db.select().from(resources).where(inArray(resources.id, row.path));
      const visible = new Map((await this.toDtos(actor, anc)).map((a) => [a.id, a]));
      for (const pid of row.path) {
        const a = visible.get(pid);
        if (a) breadcrumb.push({ id: a.id, name: a.name, kind: 'folder' });
      }
    }
    return { ...dto, breadcrumb, space };
  }

  /** DTOs for known ids, in the given order, dropping anything the actor cannot view. */
  async byIds(actor: Actor, ids: string[]): Promise<Resource[]> {
    if (!ids.length) return [];
    const rows = await this.db.select().from(resources).where(and(inArray(resources.id, ids), eq(resources.workspaceId, actor.workspaceId)));
    const dtos = new Map((await this.toDtos(actor, rows)).map((d) => [d.id, d]));
    return ids.map((id) => dtos.get(id)).filter((d): d is Resource => !!d);
  }

  async recordAccess(actor: Actor, id: string) {
    await this.perms.require(actor, id, 'viewer');
    await this.db
      .insert(resourceAccess)
      .values({ userId: actor.id, resourceId: id })
      .onConflictDoUpdate({ target: [resourceAccess.userId, resourceAccess.resourceId], set: { accessedAt: sql`now()` } });
  }

  // ── Mutations ──────────────────────────────────────────────────────────────

  /** Resolves where a new/moved item lands and checks the actor may write there. */
  private async resolveTarget(actor: Actor, parentId: string | null | undefined, spaceId: string | null | undefined, tx: Tx) {
    if (parentId) {
      const { row: parent } = await this.perms.require(actor, parentId, 'editor', tx);
      if (parent.type !== 'folder') throw new BadRequestException('Parent must be a folder');
      if (parent.trashedAt) throw new BadRequestException('Parent is in trash');
      return { parentId: parent.id, spaceId: parent.spaceId, path: [...parent.path, parent.id] };
    }
    if (spaceId) {
      await this.perms.requireSpace(actor, spaceId, 'editor', tx);
      return { parentId: null, spaceId, path: [] as string[] };
    }
    return { parentId: null, spaceId: null, path: [] as string[] }; // My Files root
  }

  async create(actor: Actor, input: CreateResourceInput): Promise<Resource> {
    const dto = await this.db.transaction(async (tx) => {
      const t = await this.resolveTarget(actor, input.parentId, input.spaceId, tx);
      const id = crypto.randomUUID();
      const [row] = await tx
        .insert(resources)
        .values({
          id,
          workspaceId: actor.workspaceId,
          ...t,
          name: input.name.trim(),
          type: input.type,
          ownerId: actor.id,
          updatedBy: actor.id,
          contentRef: NATIVE_TYPES.includes(input.type) ? `res:${id}` : null,
        })
        .returning();
      await this.events.emit(tx, actor, 'resource.created', { resourceId: id, spaceId: t.spaceId }, { name: row.name, type: row.type });
      return (await this.toDtos(actor, [row], tx))[0];
    });
    if (dto.type === 'spreadsheet') await this.sheets.init(dto.id, templateWorkbook(input.template, dto.name) ?? undefined);
    const body = dto.type === 'document' ? templateDocument(input.template, dto.name) : null;
    if (body) await this.docs.fillTemplate(dto.id, body, actor);
    if (dto.type === 'presentation') await this.slides.init(dto.id, dto.name, templateDeck(input.template, dto.name));
    if (dto.type === 'form') await this.forms.init(dto.id, dto.name);
    return dto;
  }

  async update(actor: Actor, id: string, input: UpdateResourceInput, ifMatch?: number): Promise<Resource> {
    return this.db.transaction(async (tx) => {
      const sharing = input.generalAccess !== undefined || input.generalRole !== undefined;
      const { row } = await this.perms.require(actor, id, sharing ? 'admin' : 'editor', tx);
      if (ifMatch !== undefined && ifMatch !== row.version) throw new ConflictException('Resource was modified by someone else');

      const patch: Partial<Row> = {};
      const changes: Record<string, unknown> = {};
      if (input.name !== undefined && input.name.trim() !== row.name) {
        patch.name = input.name.trim();
        changes.rename = { from: row.name, to: patch.name };
      }
      if (input.description !== undefined) patch.description = input.description;
      if (input.tags !== undefined) patch.tags = [...new Set(input.tags.map((t) => t.trim()).filter(Boolean))];
      if (input.notebook !== undefined || input.properties !== undefined) {
        patch.metadata = {
          ...row.metadata,
          ...(input.notebook !== undefined ? { notebook: input.notebook } : {}),
          ...(input.properties !== undefined ? { properties: input.properties } : {}),
        };
      }
      if (input.generalAccess !== undefined) {
        patch.generalAccess = input.generalAccess;
        patch.generalRole = input.generalAccess === 'restricted' ? null : input.generalRole ?? row.generalRole ?? 'viewer';
        changes.generalAccess = { access: patch.generalAccess, role: patch.generalRole };
      } else if (input.generalRole !== undefined) patch.generalRole = input.generalRole;

      const moving = input.parentId !== undefined || input.spaceId !== undefined;
      if (moving) {
        const t = await this.resolveTarget(actor, input.parentId, input.parentId ? undefined : input.spaceId, tx);
        if (t.parentId === id || t.path.includes(id)) throw new BadRequestException('Cannot move a folder into itself');
        if (!t.spaceId && !t.parentId && row.ownerId !== actor.id) throw new ForbiddenException('Only the owner can move this to My Files');
        if (t.parentId !== row.parentId || t.spaceId !== row.spaceId) {
          const oldLen = row.path.length;
          Object.assign(patch, t);
          await tx.execute(sql`
            UPDATE resources
               SET path = ARRAY[${sql.join([...t.path, id].map((p) => sql`${p}::uuid`), sql`, `)}] || path[${oldLen + 2}::int:],
                   space_id = ${t.spaceId}
             WHERE ${id} = ANY(path)`);
          changes.move = { fromParent: row.parentId, fromSpace: row.spaceId, toParent: t.parentId, toSpace: t.spaceId };
        }
      }
      if (!Object.keys(patch).length) return (await this.toDtos(actor, [row], tx))[0];

      const [updated] = await tx
        .update(resources)
        .set({ ...patch, updatedAt: sql`now()`, updatedBy: actor.id, version: sql`${resources.version} + 1` })
        .where(eq(resources.id, id))
        .returning();
      const action = changes.move ? 'resource.moved' : changes.rename ? 'resource.renamed' : changes.generalAccess ? 'acl.changed' : 'resource.updated';
      await this.events.emit(tx, actor, action, { resourceId: id, spaceId: updated.spaceId }, { name: updated.name, ...changes });
      return (await this.toDtos(actor, [updated], tx))[0];
    });
  }

  async copy(actor: Actor, id: string, target: { parentId?: string | null; spaceId?: string | null }): Promise<Resource> {
    const pairs: [string, string][] = [];
    const dto = await this.db.transaction(async (tx) => {
      const { row } = await this.perms.require(actor, id, 'viewer', tx);
      const sameLocation = target.parentId === undefined && target.spaceId === undefined;
      const t = await this.resolveTarget(
        actor,
        sameLocation ? row.parentId : target.parentId,
        sameLocation ? row.spaceId : target.parentId ? undefined : target.spaceId,
        tx,
      );
      const subtree = row.type === 'folder' ? await tx.select().from(resources).where(and(sql`${id} = ANY(${resources.path})`, alive)) : [];
      const idMap = new Map<string, string>([[id, crypto.randomUUID()]]);
      subtree.forEach((r) => idMap.set(r.id, crypto.randomUUID()));

      const clone = (r: Row, parentId: string | null, path: string[], name: string) => {
        const nid = idMap.get(r.id)!;
        return {
          ...r,
          id: nid,
          parentId,
          path,
          name,
          spaceId: t.spaceId,
          ownerId: actor.id,
          updatedBy: actor.id,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          version: 1,
          generalAccess: 'restricted' as const,
          generalRole: null,
          contentRef: r.contentRef ? `res:${nid}` : null,
          metadata: { ...r.metadata, copiedFrom: r.id },
        };
      };
      const root = clone(row, t.parentId, t.path, sameLocation ? copyName(row.name) : row.name);
      const rest = subtree
        .sort((a, b) => a.path.length - b.path.length)
        .map((r) => {
          const rel = r.path.slice(r.path.indexOf(id));
          return clone(r, idMap.get(r.parentId!)!, [...t.path, ...rel.map((p) => idMap.get(p)!)], r.name);
        });
      for (const r of [row, ...subtree]) if (COLLAB_TYPES.includes(r.type)) pairs.push([r.id, idMap.get(r.id)!]);
      const [created] = await tx.insert(resources).values(root).returning();
      if (rest.length) await tx.insert(resources).values(rest);
      await this.events.emit(tx, actor, 'resource.created', { resourceId: created.id, spaceId: created.spaceId }, { name: created.name, type: created.type, copiedFrom: id });
      return (await this.toDtos(actor, [created], tx))[0];
    });
    for (const [from, to] of pairs) await this.docs.cloneContent(from, to);
    return dto;
  }

  async trash(actor: Actor, id: string) {
    await this.db.transaction(async (tx) => {
      const { row } = await this.perms.require(actor, id, 'editor', tx);
      await tx.update(resources).set({ trashedAt: sql`now()`, trashedBy: actor.id }).where(eq(resources.id, id));
      await this.events.emit(tx, actor, 'resource.trashed', { resourceId: id, spaceId: row.spaceId }, { name: row.name });
    });
  }

  async restore(actor: Actor, id: string) {
    await this.db.transaction(async (tx) => {
      const [row] = await tx.select().from(resources).where(and(eq(resources.id, id), eq(resources.workspaceId, actor.workspaceId)));
      if (!row?.trashedAt) throw new NotFoundException('Not in trash');
      if (row.ownerId !== actor.id && row.trashedBy !== actor.id) await this.perms.require(actor, id, 'editor', tx);
      await tx.update(resources).set({ trashedAt: null, trashedBy: null }).where(eq(resources.id, id));
      await this.events.emit(tx, actor, 'resource.restored', { resourceId: id, spaceId: row.spaceId }, { name: row.name });
    });
  }

  async destroy(actor: Actor, id: string) {
    await this.db.transaction(async (tx) => {
      const { row } = await this.perms.require(actor, id, 'owner', tx);
      if (!row.trashedAt) throw new BadRequestException('Move to trash first');
      await tx.execute(sql`UPDATE resources SET link_target_id = NULL WHERE link_target_id IN (SELECT id FROM resources WHERE id = ${id} OR ${id} = ANY(path))`);
      await tx.execute(sql`DELETE FROM resources WHERE id = ${id} OR ${id} = ANY(path)`);
      await this.events.emit(tx, actor, 'resource.deleted', { resourceId: id, spaceId: row.spaceId }, { name: row.name });
      // Orphaned blobs are reclaimed by a GC job (Phase 2).
    });
  }

  async setStar(actor: Actor, id: string, on: boolean) {
    await this.perms.require(actor, id, 'viewer');
    if (on) await this.db.insert(stars).values({ userId: actor.id, resourceId: id }).onConflictDoNothing();
    else await this.db.delete(stars).where(and(eq(stars.userId, actor.id), eq(stars.resourceId, id)));
  }

  // ── Binary files ───────────────────────────────────────────────────────────

  async upload(actor: Actor, file: Express.Multer.File, target: { parentId?: string; spaceId?: string }): Promise<Resource> {
    const name = Buffer.from(file.originalname, 'latin1').toString('utf8'); // multer decodes as latin1
    const sha = StorageService.sha256(file.buffer);
    const key = await this.storage.putBlob(file.buffer, sha, file.mimetype);
    const created = await this.db.transaction(async (tx) => {
      const t = await this.resolveTarget(actor, target.parentId, target.spaceId, tx);
      const [blob] = await tx
        .insert(blobs)
        .values({ sha256: sha, sizeBytes: file.size, mimeType: file.mimetype, storageKey: key })
        .onConflictDoUpdate({ target: blobs.sha256, set: { sha256: sha } })
        .returning();
      const type = resourceTypeFromFile(name, file.mimetype);
      const id = crypto.randomUUID();
      const native = NATIVE_TYPES.includes(type);
      const [row] = await tx
        .insert(resources)
        .values({
          id,
          workspaceId: actor.workspaceId,
          ...t,
          name,
          type,
          ownerId: actor.id,
          updatedBy: actor.id,
          blobId: blob.id,
          sizeBytes: file.size,
          mimeType: file.mimetype,
          contentRef: native ? `res:${id}` : null,
          // Office files keep the original as version 0; the converter imports them into the internal model (Phase 2–4).
          metadata: native ? { originalBlob: true, import: { status: 'pending', source: name } } : {},
        })
        .returning();
      await tx.insert(resourceVersions).values({ resourceId: id, version: 1, blobId: blob.id, sizeBytes: file.size, label: 'Original upload', createdBy: actor.id });
      await this.events.emit(tx, actor, 'resource.created', { resourceId: id, spaceId: t.spaceId }, { name, type, uploaded: true, size: file.size });
      return row;
    });
    if (COLLAB_TYPES.includes(created.type)) {
      // Word → internal model right away; the report (or failure) is kept in metadata.import.
      await this.docs.importOriginal(actor, created.id, file.buffer).catch(() => undefined);
      const [fresh] = await this.db.select().from(resources).where(eq(resources.id, created.id));
      return (await this.toDtos(actor, [fresh]))[0];
    }
    return (await this.toDtos(actor, [created]))[0];
  }

  async download(actor: Actor, id: string) {
    const { row } = await this.perms.require(actor, id, 'viewer');
    // Native files download as Office files; uploads keep returning their original (current content: /export).
    if (!row.blobId && COLLAB_TYPES.includes(row.type)) {
      const f = await this.docs.export(actor, id, row.type === 'spreadsheet' ? 'xlsx' : row.type === 'presentation' ? 'pptx' : 'docx');
      return { body: f.body, name: f.name, mime: f.mime, size: f.body.length };
    }
    if (!row.blobId) {
      throw new NotImplementedException(`Export of ${row.type} to Office format arrives with the ${row.type} editor (see docs/ARCHITECTURE.md §16)`);
    }
    const [blob] = await this.db.select().from(blobs).where(eq(blobs.id, row.blobId));
    if (!blob) throw new NotFoundException('Blob missing');
    return { stream: await this.storage.getStream(blob.storageKey), name: row.name, mime: blob.mimeType ?? 'application/octet-stream', size: blob.sizeBytes };
  }

  // ── Details panel ─────────────────────────────────────────────────────────

  async activity(actor: Actor, id: string): Promise<ActivityEvent[]> {
    await this.perms.require(actor, id, 'viewer');
    const rows = await this.db
      .select()
      .from(auditEvents)
      .where(sql`${auditEvents.resourceId} = ${id} OR ${auditEvents.resourceId} IN (SELECT r.id FROM resources r WHERE ${id} = ANY(r.path))`)
      .orderBy(desc(auditEvents.createdAt))
      .limit(100);
    const people = await loadUsers(this.db, rows.map((r) => r.actorId));
    return rows.map((r) => ({
      id: String(r.id),
      actor: r.actorId ? people.get(r.actorId) ?? null : null,
      action: r.action,
      resourceId: r.resourceId,
      data: r.data,
      createdAt: r.createdAt,
    }));
  }

  async members(actor: Actor, id: string): Promise<AclEntry[]> {
    const { row } = await this.perms.require(actor, id, 'viewer');
    const chain = [id, ...row.path];
    const [acl, ancestors, sMembers] = await Promise.all([
      this.db.select().from(aclEntries).where(and(inArray(aclEntries.resourceId, chain), eq(aclEntries.principalType, 'user'))),
      row.path.length ? this.db.select({ id: resources.id, name: resources.name }).from(resources).where(inArray(resources.id, row.path)) : [],
      row.spaceId
        ? this.db
            .select({ userId: spaceMembers.userId, role: spaceMembers.role, spaceName: spaces.name })
            .from(spaceMembers)
            .innerJoin(spaces, eq(spaces.id, spaceMembers.spaceId))
            .where(eq(spaceMembers.spaceId, row.spaceId))
        : [],
    ]);
    const people = await loadUsers(this.db, [row.ownerId, ...acl.map((a) => a.principalId), ...sMembers.map((m) => m.userId)]);
    const ancName = new Map(ancestors.map((a) => [a.id, a.name]));
    const rank = { owner: 0, direct: 1, inherited: 2, space: 3 } as const;

    const best = new Map<string, AclEntry>();
    const offer = (e: AclEntry) => {
      const cur = best.get(e.principal.id);
      const order = ['viewer', 'commenter', 'editor', 'admin', 'owner'];
      if (!cur || order.indexOf(e.role) > order.indexOf(cur.role) || (e.role === cur.role && rank[e.source] < rank[cur.source])) best.set(e.principal.id, e);
    };
    const owner = people.get(row.ownerId);
    if (owner) offer({ principal: owner, role: 'owner', source: 'owner' });
    for (const a of acl) {
      const p = people.get(a.principalId);
      if (p) offer({ principal: p, role: a.role, source: a.resourceId === id ? 'direct' : 'inherited', sourceName: ancName.get(a.resourceId) });
    }
    for (const m of sMembers) {
      const p = people.get(m.userId);
      if (p) offer({ principal: p, role: m.role, source: 'space', sourceName: m.spaceName });
    }
    return [...best.values()].sort((a, b) => rank[a.source] - rank[b.source] || a.principal.name.localeCompare(b.principal.name, 'vi'));
  }

  async share(actor: Actor, id: string, userId: string, role: Role | null) {
    const shared = await this.db.transaction(async (tx) => {
      const { row } = await this.perms.require(actor, id, 'admin', tx);
      if (userId === row.ownerId) throw new BadRequestException('Owner access cannot be changed here');
      if (role === 'owner') throw new BadRequestException('Use ownership transfer');
      if (role) {
        await tx
          .insert(aclEntries)
          .values({ resourceId: id, principalType: 'user', principalId: userId, role, createdBy: actor.id })
          .onConflictDoUpdate({ target: [aclEntries.resourceId, aclEntries.principalType, aclEntries.principalId], set: { role } });
      } else {
        await tx.delete(aclEntries).where(and(eq(aclEntries.resourceId, id), eq(aclEntries.principalType, 'user'), eq(aclEntries.principalId, userId)));
      }
      const who = (await loadUsers(tx, [userId])).get(userId);
      await this.events.emit(tx, actor, 'acl.changed', { resourceId: id, spaceId: row.spaceId }, { name: row.name, userId, userName: who?.name, role });
      return row;
    });
    if (role) {
      const verb = { viewer: 'view', commenter: 'comment on', editor: 'edit', admin: 'manage', owner: 'own' }[role];
      await this.notifications
        .notify(actor, [userId], { kind: 'resource.shared', title: `${actor.name} shared "${shared.name}" with you`, body: `You can ${verb} it.`, url: resourcePath(shared), resourceId: id })
        .catch(() => undefined);
    }
  }

  async versions(actor: Actor, id: string) {
    await this.perms.require(actor, id, 'viewer');
    const rows = await this.db.select().from(resourceVersions).where(eq(resourceVersions.resourceId, id)).orderBy(desc(resourceVersions.version));
    const people = await loadUsers(this.db, rows.map((r) => r.createdBy));
    return rows.map((r) => ({ id: r.id, version: r.version, label: r.label, sizeBytes: r.sizeBytes, createdAt: r.createdAt, createdBy: r.createdBy ? people.get(r.createdBy) : null }));
  }
}

