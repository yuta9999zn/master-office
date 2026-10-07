import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PROJECT_DOC_SETS, projectDocTemplate } from '@workos/doc-model';
import { can, WORK_TYPES, type DocItem, type IssueType, type ProjectDocs, type TaskView, type TraceRow } from '@workos/shared';
import type { JSONContent } from '@tiptap/core';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Actor } from '../common/current-user';
import { loadUsers } from '../common/users';
import type { Db } from '../db/client';
import { InjectDb } from '../db/db.module';
import { DocsService } from '../docs/docs.service';
import { projects, resources, taskDocs, tasks } from '../db/schema';
import { PermissionsService } from '../permissions/permissions.service';
import { ResourcesService } from '../resources/resources.service';
import { WikiService } from '../wiki/wiki.service';
import { TasksService } from './tasks.service';

type Proj = typeof projects.$inferSelect;
type DocSet = keyof typeof PROJECT_DOC_SETS;

/**
 * A project's documentation space (docs/ARCHITECTURE.md §76, batch 3) — Confluence-style: a folder in the project's
 * Space with sections (Business, Requirements, Design, Delivery & Quality, Agile, AI-DLC) and pages made from the
 * business-analysis / AI-DLC templates. Pages are ordinary documents (Docs editor, comments, versions; Space roles).
 * Issues trace to pages; bullets of a page can become issues already linked to it.
 */
@Injectable()
export class ProjectDocsService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly tasksSvc: TasksService,
    private readonly resources: ResourcesService,
    private readonly docs: DocsService,
    private readonly perms: PermissionsService,
    private readonly wiki: WikiService,
  ) {}

  /** The project's documentation space (a wiki space, §78). */
  async tree(actor: Actor, projectId: string): Promise<ProjectDocs> {
    await this.tasksSvc.projectAccess(actor, projectId);
    const space = await this.wiki.ofProject(projectId);
    if (!space) return { folderId: null, spaceId: null, nodes: [] };
    const d = await this.wiki.detail(actor, space.id);
    return {
      folderId: space.folderId,
      spaceId: space.id,
      nodes: d.tree.map((n) => ({ id: n.id, name: n.title, type: 'wiki', parentId: n.parentId, updatedAt: n.updatedAt, updatedBy: n.updatedBy, linked: n.linked })),
    };
  }

  /** The project's space, made on first use in the project's Space. */
  private async spaceFor(actor: Actor, p: Proj) {
    const existing = await this.wiki.ofProject(p.id);
    if (existing) return existing;
    const key = await this.wiki.freeKey(actor.workspaceId, p.key);
    const made = await this.wiki.createSpace(actor, { name: p.name, key, description: `Documentation of the ${p.name} project`, spaceId: p.spaceId, projectId: p.id, set: 'blank' });
    return (await this.wiki.ofProject(p.id)) ?? { ...made, workspaceId: actor.workspaceId };
  }

  private pageName(p: Proj, templateId: string, name?: string) {
    const tpl = projectDocTemplate(templateId)!;
    return name?.trim() || `${p.key} · ${tpl.code} — ${tpl.name.replace(/^AI-DLC · /, '')}`;
  }

  /** Sets the space up with the starter pages of a way of working. */
  async setup(actor: Actor, projectId: string, set?: DocSet): Promise<ProjectDocs> {
    const { p } = await this.tasksSvc.projectAccess(actor, projectId, 'write');
    const chosen: DocSet = set ?? (p.methodology === 'ai-dlc' ? 'ai-dlc' : p.methodology === 'waterfall' ? 'waterfall' : p.methodology === 'hybrid' ? 'hybrid' : p.methodology === 'kanban' ? 'kanban' : 'scrum');
    const space = await this.spaceFor(actor, p);
    await this.wiki.addStarter(actor, space.id, chosen, (id) => this.pageName(p, id));
    return this.tree(actor, projectId);
  }

  async createPage(actor: Actor, projectId: string, input: { template?: string | null; name?: string; folderId?: string | null }) {
    const { p } = await this.tasksSvc.projectAccess(actor, projectId, 'write');
    const tpl = input.template ? projectDocTemplate(input.template) : null;
    if (input.template && !tpl) throw new BadRequestException('Unknown template');
    const space = await this.spaceFor(actor, p);
    // folderId: the page to put it under (a section page or any page of the space).
    const parentId = input.folderId ?? (tpl ? await this.wiki.sectionFor(actor, space.id, tpl.category) : null);
    const title = tpl ? this.pageName(p, tpl.id, input.name) : input.name?.trim() || 'Untitled page';
    return this.wiki.createPage(actor, space.id, { title, template: tpl?.id ?? null, parentId });
  }

  // ── Traceability ──────────────────────────────────────────────────────────

  private async readableDoc(actor: Actor, resourceId: string) {
    const { row } = await this.perms.require(actor, resourceId, 'viewer').catch(() => {
      throw new NotFoundException('Document not found');
    });
    if (row.type !== 'document' && row.type !== 'wiki' && row.type !== 'note') throw new BadRequestException('Link a document');
    return row;
  }

  async link(actor: Actor, taskId: string, resourceId: string) {
    const [t] = await this.db.select().from(tasks).where(eq(tasks.id, taskId));
    if (!t || !t.projectId) throw new NotFoundException('Task not found');
    await this.tasksSvc.projectAccess(actor, t.projectId, 'write');
    await this.readableDoc(actor, resourceId);
    await this.db.insert(taskDocs).values({ taskId, resourceId, createdBy: actor.id }).onConflictDoNothing();
    await this.tasksSvc.notifyProject(t.projectId);
    return this.tasksSvc.docsOf(actor, taskId);
  }

  async unlink(actor: Actor, taskId: string, resourceId: string) {
    const [t] = await this.db.select().from(tasks).where(eq(tasks.id, taskId));
    if (!t || !t.projectId) throw new NotFoundException('Task not found');
    await this.tasksSvc.projectAccess(actor, t.projectId, 'write');
    await this.db.delete(taskDocs).where(and(eq(taskDocs.taskId, taskId), eq(taskDocs.resourceId, resourceId)));
    await this.tasksSvc.notifyProject(t.projectId);
    return this.tasksSvc.docsOf(actor, taskId);
  }

  /** Every page of the project docs, and any other document the project's issues trace to, with those issues. */
  async traceability(actor: Actor, projectId: string): Promise<TraceRow[]> {
    const { p } = await this.tasksSvc.projectAccess(actor, projectId);
    const tree = await this.tree(actor, projectId);
    const pages = tree.nodes.filter((n) => n.type !== 'folder');
    const links = await this.db
      .select({ taskId: taskDocs.taskId, resourceId: taskDocs.resourceId, t: tasks })
      .from(taskDocs)
      .innerJoin(tasks, eq(tasks.id, taskDocs.taskId))
      .where(eq(tasks.projectId, projectId));
    const otherIds = [...new Set(links.map((l) => l.resourceId))].filter((id) => !pages.some((x) => x.id === id));
    const others = otherIds.length ? await this.db.select().from(resources).where(and(inArray(resources.id, otherIds), isNull(resources.trashedAt))) : [];
    const roles = await this.perms.rolesFor(actor, others);
    const docs = [...pages.map((x) => ({ id: x.id, name: x.name, inProjectDocs: true })), ...others.filter((o) => can(roles.get(o.id), 'viewer')).map((o) => ({ id: o.id, name: o.name, inProjectDocs: false }))];
    return docs.map((doc) => ({
      doc,
      issues: links
        .filter((l) => l.resourceId === doc.id)
        .map(({ t }) => ({ id: t.id, ref: t.number ? `${p.key}-${t.number}` : null, title: t.title, type: t.type, status: t.status, done: !!t.completedAt })),
    }));
  }

  /** Lines of a page that could become issues: bullets, checklist items and first cells of table rows. */
  async items(actor: Actor, resourceId: string): Promise<DocItem[]> {
    await this.readableDoc(actor, resourceId);
    const json = await this.docs.content(resourceId);
    const out: DocItem[] = [];
    let section: string | null = null;
    const text = (n: JSONContent): string => (n.text ?? '') + (n.content ?? []).map(text).join('');
    const walk = (n: JSONContent, inTable = false) => {
      if (n.type === 'heading') {
        section = text(n).trim() || section;
        return;
      }
      if (n.type === 'listItem' || n.type === 'taskItem') {
        const first = n.content?.find((c) => c.type === 'paragraph');
        const line = first ? text(first).trim() : '';
        if (line && !/^[…. ]*$/.test(line) && line.length > 2) out.push({ text: line.slice(0, 300), section });
        for (const c of n.content ?? []) if (c.type !== 'paragraph') walk(c);
        return;
      }
      if (n.type === 'tableRow' && inTable) {
        const cells = n.content ?? [];
        if (cells[0]?.type === 'tableHeader') return;
        // "ID | requirement | …" tables: the requirement text with its ID.
        const first = cells[0] ? text(cells[0]).trim() : '';
        const second = cells[1] ? text(cells[1]).trim() : '';
        const line = /^[A-Z]{1,6}-\d+/.test(first) && second ? `${first} ${second}` : first;
        if (line && line.length > 2 && !(/^[A-Z]{1,6}-\d+$/.test(line))) out.push({ text: line.slice(0, 300), section });
        return;
      }
      for (const c of n.content ?? []) walk(c, inTable || n.type === 'table');
    };
    walk(json);
    return out;
  }

  /** Makes issues from lines of a page; each issue is linked to the page. */
  async issuesFromDoc(actor: Actor, projectId: string, resourceId: string, input: { items: string[]; type?: IssueType; parentId?: string | null; sprintId?: string | null }): Promise<TaskView[]> {
    await this.tasksSvc.projectAccess(actor, projectId, 'write');
    await this.readableDoc(actor, resourceId);
    const titles = input.items.map((x) => x.trim()).filter(Boolean);
    if (!titles.length) throw new BadRequestException('Pick at least one line');
    if (titles.length > 50) throw new BadRequestException('At most 50 at a time');
    const type = input.type ?? 'story';
    const out: TaskView[] = [];
    for (const title of titles) {
      const t = await this.tasksSvc.create(actor, { projectId, parentId: input.parentId ?? null, type, title: title.slice(0, 500), sprintId: WORK_TYPES.includes(type) ? input.sprintId ?? null : null });
      await this.db.insert(taskDocs).values({ taskId: t.id, resourceId, createdBy: actor.id }).onConflictDoNothing();
      out.push(t);
    }
    await this.tasksSvc.notifyProject(projectId);
    return out;
  }
}
