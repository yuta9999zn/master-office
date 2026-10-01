import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { docExtensions, pageSetupOf, SETTINGS_MAP, toHTMLDocument, toPlainText, type JSONContent, type PageSetup } from '@workos/doc-model';
import type { ResourceType } from '@workos/shared';
import { generateJSON } from '@tiptap/html/server';
import { and, eq, inArray, sql } from 'drizzle-orm';
import mammoth from 'mammoth';
import type { Actor } from '../common/current-user';
import type { Db } from '../db/client';
import { InjectDb } from '../db/db.module';
import { blobs, resourceAssets, resourceLinks, resources, users } from '../db/schema';
import { EventsService } from '../events/events.service';
import { PermissionsService } from '../permissions/permissions.service';
import { StorageService } from '../storage/storage.service';
import { config } from '../config';
import { signCollabToken } from '../collab/collab-token';
import { CollabService } from '../collab/collab.service';
import * as Y from 'yjs';
import { DocStore, jsonToYdoc, stateToJSON, ydocToJSON } from './doc-store';
import { imageInfo, toDocx, type DocxImage } from './docx-export';
import { PdfRenderer } from './pdf-renderer';
import { cellValue } from '@workos/sheet-model';
import { SheetsService, type SheetExportFormat } from '../sheets/sheets.service';
import { deckImages, SlidesService, type SlideExportFormat } from '../slides/slides.service';
import type { ImageLoader } from '../slides/pptx-export';

export const COLLAB_TYPES: ResourceType[] = ['document', 'wiki', 'note', 'spreadsheet', 'presentation'];
export type ExportFormat = 'docx' | 'pdf' | 'html' | 'txt' | 'xlsx' | 'csv' | 'pptx' | 'png';
const SHEET_FORMATS: ExportFormat[] = ['xlsx', 'csv', 'pdf', 'html'];
const SLIDE_FORMATS: ExportFormat[] = ['pptx', 'pdf', 'png', 'html'];
const TEXT_FORMATS: ExportFormat[] = ['docx', 'pdf', 'html', 'txt'];

const EXPORT_MIME: Record<'docx' | 'pdf' | 'html' | 'txt', string> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pdf: 'application/pdf',
  html: 'text/html; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
};

const ASSET_SRC = /^\/api\/resources\/([0-9a-f-]{36})\/assets\/([0-9a-f-]{36})$/;

function collectImages(doc: JSONContent, out = new Set<string>()): Set<string> {
  if (doc.type === 'image' && typeof doc.attrs?.src === 'string') out.add(doc.attrs.src);
  doc.content?.forEach((c) => collectImages(c, out));
  return out;
}

/** Strips a trailing Office extension so "Plan.docx" exports as "Plan.docx", not "Plan.docx.docx". */
export const baseName = (name: string) => name.replace(/\.(docx?|odt|rtf|html?|txt|pdf)$/i, '');

@Injectable()
export class DocsService {
  private readonly log = new Logger('Docs');

  constructor(
    @InjectDb() private readonly db: Db,
    private readonly perms: PermissionsService,
    private readonly storage: StorageService,
    private readonly store: DocStore,
    private readonly collab: CollabService,
    private readonly pdf: PdfRenderer,
    private readonly events: EventsService,
    private readonly sheets: SheetsService,
    private readonly slides: SlidesService,
  ) {}

  private async requireDoc(actor: Actor, id: string, role: Parameters<PermissionsService['require']>[2]) {
    const r = await this.perms.require(actor, id, role);
    if (!COLLAB_TYPES.includes(r.row.type)) throw new BadRequestException(`${r.row.type} is not a collaborative document`);
    return r;
  }

  // ── Realtime ───────────────────────────────────────────────────────────────

  async collabToken(actor: Actor, id: string) {
    const { role, row } = await this.requireDoc(actor, id, 'viewer');
    if (row.type === 'presentation' && !row.blobId && !(await this.store.load(id))) await this.slides.init(id, row.name);
    const [u] = await this.db.select({ color: users.avatarColor }).from(users).where(eq(users.id, actor.id));
    return {
      token: signCollabToken({ uid: actor.id, name: actor.name, color: u?.color ?? '#2563eb', rid: id, ws: actor.workspaceId, role }),
      url: process.env.COLLAB_PUBLIC_URL ?? `ws://localhost:${config.collab.port}`,
      role,
      document: `res:${id}`,
    };
  }

  async content(id: string): Promise<JSONContent> {
    return (await this.document(id)).json;
  }

  /** Body + document settings (page setup, header/footer) from the live or stored Yjs state. */
  async document(id: string): Promise<{ json: JSONContent; pageSetup: PageSetup }> {
    const state = await this.collab.currentState(id);
    if (!state) return { json: { type: 'doc', content: [] }, pageSetup: pageSetupOf(null) };
    const doc = new Y.Doc();
    Y.applyUpdate(doc, state);
    return { json: ydocToJSON(doc), pageSetup: pageSetupOf(doc.getMap(SETTINGS_MAP).toJSON()) };
  }

  /** Formatted-free values of A1:D5 in a spreadsheet the viewer can read. */
  async sheetRange(actor: Actor, id: string, range: string, sheetName?: string) {
    const { row } = await this.perms.require(actor, id, 'viewer');
    if (row.type !== 'spreadsheet') throw new BadRequestException('Not a spreadsheet');
    const wb = await this.sheets.workbook(id, row.name);
    const sheet = sheetName ? wb.sheets.find((s) => s.meta.name.toLowerCase() === sheetName.toLowerCase()) : wb.sheets.find((s) => !s.meta.hidden) ?? wb.sheets[0];
    if (!sheet) throw new NotFoundException(`Sheet "${sheetName}" not found`);
    const ref = (a1: string) => {
      const m = /^\$?([A-Za-z]+)\$?(\d+)$/.exec(a1)!;
      const c = m[1].toUpperCase().split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
      return { r: Number(m[2]) - 1, c };
    };
    const [a, b = a] = range.split(':');
    const p = ref(a);
    const q = ref(b);
    const r0 = Math.min(p.r, q.r);
    const r1 = Math.min(Math.max(p.r, q.r), r0 + 199);
    const c0 = Math.min(p.c, q.c);
    const c1 = Math.min(Math.max(p.c, q.c), c0 + 49);
    const values: (string | number | boolean | null)[][] = [];
    for (let r = r0; r <= r1; r++) {
      const line: (string | number | boolean | null)[] = [];
      for (let c = c0; c <= c1; c++) line.push(cellValue(sheet.cells[r]?.[c]));
      values.push(line);
    }
    return { name: row.name, sheet: sheet.meta.name, values };
  }

  // ── Assets (images inside documents) ──────────────────────────────────────

  async saveAsset(actor: Actor, id: string, buf: Buffer, mime: string) {
    if (!mime.startsWith('image/')) throw new BadRequestException('Only images can be embedded');
    await this.requireDoc(actor, id, 'editor');
    return this.storeAsset(id, buf, mime, actor.id);
  }

  private async storeAsset(resourceId: string, buf: Buffer, mime: string, userId: string) {
    const sha = StorageService.sha256(buf);
    const key = await this.storage.putBlob(buf, sha, mime);
    const [blob] = await this.db
      .insert(blobs)
      .values({ sha256: sha, sizeBytes: buf.length, mimeType: mime, storageKey: key })
      .onConflictDoUpdate({ target: blobs.sha256, set: { sha256: sha } })
      .returning();
    await this.db.insert(resourceAssets).values({ resourceId, blobId: blob.id, createdBy: userId }).onConflictDoNothing();
    return { url: `/api/resources/${resourceId}/assets/${blob.id}`, blobId: blob.id };
  }

  async asset(actor: Actor, id: string, blobId: string) {
    await this.perms.require(actor, id, 'viewer');
    const [row] = await this.db
      .select({ key: blobs.storageKey, mime: blobs.mimeType, size: blobs.sizeBytes })
      .from(resourceAssets)
      .innerJoin(blobs, eq(blobs.id, resourceAssets.blobId))
      .where(and(eq(resourceAssets.resourceId, id), eq(resourceAssets.blobId, blobId)));
    if (!row) throw new NotFoundException('Image not found');
    return { stream: await this.storage.getStream(row.key), mime: row.mime ?? 'application/octet-stream', size: row.size };
  }

  /** Bytes of an image a presentation references: its own assets or data: URLs (never arbitrary URLs). */
  imageLoader(resourceId: string): ImageLoader {
    return async (src) => {
      const data = /^data:([\w/+.-]+);base64,(.*)$/s.exec(src);
      if (data) return { mime: data[1], data: Buffer.from(data[2], 'base64') };
      const m = src.match(ASSET_SRC);
      if (!m || m[1] !== resourceId) return null;
      const [row] = await this.db
        .select({ key: blobs.storageKey, mime: blobs.mimeType })
        .from(resourceAssets)
        .innerJoin(blobs, eq(blobs.id, resourceAssets.blobId))
        .where(and(eq(resourceAssets.resourceId, resourceId), eq(resourceAssets.blobId, m[2])));
      return row ? { data: await this.storage.getBuffer(row.key), mime: row.mime ?? 'image/png' } : null;
    };
  }

  /** Loads the images a document embeds — only assets registered to that document. */
  private async loadImages(id: string, doc: JSONContent) {
    const wanted = [...collectImages(doc)]
      .map((src) => ({ src, m: src.match(ASSET_SRC) }))
      .filter((x): x is { src: string; m: RegExpMatchArray } => !!x.m && x.m[1] === id);
    const out = new Map<string, { buf: Buffer; mime: string }>();
    if (!wanted.length) return out;
    const rows = await this.db
      .select({ id: blobs.id, key: blobs.storageKey, mime: blobs.mimeType })
      .from(resourceAssets)
      .innerJoin(blobs, eq(blobs.id, resourceAssets.blobId))
      .where(and(eq(resourceAssets.resourceId, id), inArray(resourceAssets.blobId, wanted.map((w) => w.m[2]))));
    for (const w of wanted) {
      const row = rows.find((r) => r.id === w.m[2]);
      if (row) out.set(w.src, { buf: await this.storage.getBuffer(row.key), mime: row.mime ?? 'image/png' });
    }
    return out;
  }

  // ── Export ────────────────────────────────────────────────────────────────

  async export(actor: Actor, id: string, format: ExportFormat, sheetId?: string, slide?: number) {
    const { row } = await this.requireDoc(actor, id, 'viewer');
    if (row.type === 'presentation') {
      if (!SLIDE_FORMATS.includes(format)) throw new BadRequestException(`Presentations export as ${SLIDE_FORMATS.join(', ')}`);
      const f = await this.slides.export(id, row.name, format as SlideExportFormat, this.imageLoader(id), { author: actor.name, slide });
      await this.events.emit(this.db, actor, 'resource.exported', { resourceId: id, spaceId: row.spaceId }, { name: row.name, format });
      return f;
    }
    if (row.type === 'spreadsheet') {
      if (!SHEET_FORMATS.includes(format)) throw new BadRequestException(`Spreadsheets export as ${SHEET_FORMATS.join(', ')}`);
      const f = await this.sheets.export(id, row.name, format as SheetExportFormat, { author: actor.name, sheetId });
      await this.events.emit(this.db, actor, 'resource.exported', { resourceId: id, spaceId: row.spaceId }, { name: row.name, format });
      return f;
    }
    if (!TEXT_FORMATS.includes(format)) throw new BadRequestException(`Documents export as ${TEXT_FORMATS.join(', ')}`);
    const { json: doc, pageSetup } = await this.document(id);
    const title = baseName(row.name);
    const name = `${title}.${format}`;
    let body: Buffer;
    if (format === 'txt') {
      body = Buffer.from(`${title}\n\n${toPlainText(doc)}\n`, 'utf8');
    } else if (format === 'docx') {
      const images = new Map<string, DocxImage>();
      for (const [src, img] of await this.loadImages(id, doc)) {
        const info = imageInfo(img.buf);
        if (info) images.set(src, { ...info, data: img.buf });
      }
      body = await toDocx(title, doc, images, { author: actor.name, pageSetup });
    } else {
      const images = await this.loadImages(id, doc);
      const html = toHTMLDocument(title, doc, {
        pageSetup,
        resolveImage: (src) => {
          const img = images.get(src);
          return img ? `data:${img.mime};base64,${img.buf.toString('base64')}` : src;
        },
      });
      body = format === 'pdf' ? await this.pdf.render(html, { pageSetup, title }) : Buffer.from(html, 'utf8');
    }
    await this.events.emit(this.db, actor, 'resource.exported', { resourceId: id, spaceId: row.spaceId }, { name: row.name, format });
    return { name, mime: EXPORT_MIME[format as keyof typeof EXPORT_MIME], body };
  }

  // ── Import (.docx → internal model) ───────────────────────────────────────

  /**
   * Converts the document's original Office file into the collaborative model.
   * The original stays untouched as version 1 (docs/ARCHITECTURE.md §8).
   */
  async importOriginal(actor: Actor, id: string, buffer?: Buffer) {
    const { row } = await this.requireDoc(actor, id, 'editor');
    const ext = row.name.split('.').pop()?.toLowerCase();
    const setImport = (report: Record<string, unknown>) =>
      this.db
        .update(resources)
        .set({ metadata: sql`${resources.metadata} || ${JSON.stringify({ import: { source: row.name, at: new Date().toISOString(), ...report } })}::jsonb` })
        .where(eq(resources.id, id));

    if (row.type === 'presentation') {
      let buf = buffer;
      if (!buf) {
        if (!row.blobId) throw new BadRequestException('This presentation has no original file');
        const [b] = await this.db.select().from(blobs).where(eq(blobs.id, row.blobId));
        buf = await this.storage.getBuffer(b.storageKey);
      }
      try {
        const report = await this.slides.importFile(id, buf, row.name, async (data, mime) => (await this.storeAsset(id, data, mime, actor.id)).url, { id: actor.id, name: actor.name });
        await setImport(report as unknown as Record<string, unknown>);
        return report;
      } catch (e) {
        const message = (e as Error).message;
        this.log.error(`import ${id} failed: ${message}`);
        await setImport({ status: /not supported|LibreOffice/.test(message) ? 'unsupported' : 'failed', message });
        throw e instanceof BadRequestException ? e : new BadRequestException(`Could not read this presentation: ${message}`);
      }
    }
    if (row.type === 'spreadsheet') {
      let buf = buffer;
      if (!buf) {
        if (!row.blobId) throw new BadRequestException('This spreadsheet has no original file');
        const [b] = await this.db.select().from(blobs).where(eq(blobs.id, row.blobId));
        buf = await this.storage.getBuffer(b.storageKey);
      }
      try {
        const report = await this.sheets.importFile(actor, id, buf, row.name);
        await setImport(report as unknown as Record<string, unknown>);
        return report;
      } catch (e) {
        const message = (e as Error).message;
        this.log.error(`import ${id} failed: ${message}`);
        await setImport({ status: /not supported|LibreOffice/.test(message) ? 'unsupported' : 'failed', message });
        throw e instanceof BadRequestException ? e : new BadRequestException(`Could not read this spreadsheet: ${message}`);
      }
    }
    if (ext !== 'docx') {
      const message = ext === 'doc' ? 'Legacy .doc files need the LibreOffice converter (not installed on this server). Save as .docx and upload again.' : `.${ext} import is not supported yet.`;
      await setImport({ status: 'unsupported', message });
      return { status: 'unsupported', message };
    }
    let buf = buffer;
    if (!buf) {
      if (!row.blobId) throw new BadRequestException('This document has no original file');
      const [b] = await this.db.select().from(blobs).where(eq(blobs.id, row.blobId));
      buf = await this.storage.getBuffer(b.storageKey);
    }
    try {
      let images = 0;
      const result = await mammoth.convertToHtml(
        { buffer: buf },
        {
          convertImage: mammoth.images.imgElement(async (image) => {
            const data = Buffer.from(await image.readAsBuffer());
            const { url } = await this.storeAsset(id, data, image.contentType, actor.id);
            images++;
            return { src: url };
          }),
        },
      );
      const json = generateJSON(result.value, docExtensions()) as JSONContent;
      await this.collab.replaceContent(id, json, { id: actor.id, name: actor.name });
      const counts = { tables: 0, lists: 0, headings: 0 };
      const walk = (n: JSONContent) => {
        if (n.type === 'table') counts.tables++;
        if (n.type === 'bulletList' || n.type === 'orderedList') counts.lists++;
        if (n.type === 'heading') counts.headings++;
        n.content?.forEach(walk);
      };
      walk(json);
      const report = {
        status: 'done',
        preserved: ['text', 'bold / italic / underline / strike', 'links', `headings: ${counts.headings}`, `lists: ${counts.lists}`, `tables: ${counts.tables}`, `images: ${images}`],
        degraded: ['fonts, font sizes and colors use document defaults', 'paragraph alignment', 'table cell shading and widths'],
        dropped: ['headers / footers', 'comments and tracked changes', 'page layout (margins, columns)'],
        warnings: result.messages.map((m) => m.message).slice(0, 20),
      };
      await setImport(report);
      return report;
    } catch (e) {
      this.log.error(`import ${id} failed: ${(e as Error).message}`);
      await setImport({ status: 'failed', message: (e as Error).message });
      throw new BadRequestException(`Could not read this Word file: ${(e as Error).message}`);
    }
  }

  /**
   * "Make a copy": the new document gets the current content and its own copies of the embedded images,
   * so the copy never depends on access to the original.
   */
  async cloneContent(fromId: string, toId: string) {
    const state = await this.collab.currentState(fromId);
    if (!state?.length) return;
    const [src] = await this.db.select({ type: resources.type }).from(resources).where(eq(resources.id, fromId));
    if (src?.type === 'presentation') {
      // Fresh element ids; pictures are re-registered to the copy so it never depends on the original.
      const deck = SlidesService.preview(state);
      const prefix = `/api/resources/${fromId}/assets/`;
      const move = (s: string) => (s.startsWith(prefix) ? `/api/resources/${toId}/assets/${s.slice(prefix.length)}` : s);
      for (const s of deck.slides) {
        if (s.meta.background?.type === 'image') s.meta.background = { ...s.meta.background, src: move(s.meta.background.src) };
        for (const e of s.elements) if (e.src) e.src = move(e.src);
      }
      if (deckImages(deck).length) {
        await this.db.execute(sql`INSERT INTO resource_assets (resource_id, blob_id, created_by)
          SELECT ${toId}, blob_id, created_by FROM resource_assets WHERE resource_id = ${fromId} ON CONFLICT DO NOTHING`);
      }
      const { doc, state: fresh } = SlidesService.stateOf(deck);
      await this.store.save(toId, fresh, doc, null);
      return;
    }
    if (src?.type === 'spreadsheet') {
      // Rebuilt (not byte-copied) so the copy gets fresh row/column ids and its own Yjs history.
      const { doc, state: fresh } = SheetsService.stateOf(SheetsService.preview(state));
      await this.store.save(toId, fresh, doc, null);
      return;
    }
    const json = stateToJSON(state);
    const prefix = `/api/resources/${fromId}/assets/`;
    const rewrite = (n: JSONContent): JSONContent => ({
      ...n,
      ...(n.type === 'image' && typeof n.attrs?.src === 'string' && n.attrs.src.startsWith(prefix)
        ? { attrs: { ...n.attrs, src: `/api/resources/${toId}/assets/${n.attrs.src.slice(prefix.length)}` } }
        : {}),
      ...(n.content ? { content: n.content.map(rewrite) } : {}),
    });
    await this.db.execute(sql`INSERT INTO resource_assets (resource_id, blob_id, created_by)
      SELECT ${toId}, blob_id, created_by FROM resource_assets WHERE resource_id = ${fromId} ON CONFLICT DO NOTHING`);
    const doc = jsonToYdoc(rewrite(json));
    await this.store.save(toId, Y.encodeStateAsUpdate(doc), doc, null);
  }

  /** Linked pages (outgoing) and backlinks (incoming), each filtered to what the viewer may open. */
  async links(actor: Actor, id: string) {
    await this.perms.require(actor, id, 'viewer');
    const [outRows, inRows] = await Promise.all([
      this.db.select({ r: resources }).from(resourceLinks).innerJoin(resources, eq(resources.id, resourceLinks.targetId)).where(eq(resourceLinks.sourceId, id)),
      this.db.select({ r: resources }).from(resourceLinks).innerJoin(resources, eq(resources.id, resourceLinks.sourceId)).where(eq(resourceLinks.targetId, id)),
    ]);
    const visible = async (rows: { r: typeof resources.$inferSelect }[]) => {
      const alive = rows.map((x) => x.r).filter((r) => !r.trashedAt);
      const roles = await this.perms.rolesFor(actor, alive);
      return alive.filter((r) => roles.get(r.id)).map((r) => r.id);
    };
    return { linked: await visible(outRows), backlinks: await visible(inRows) };
  }

  // ── Versions ──────────────────────────────────────────────────────────────

  async createVersion(actor: Actor, id: string, label: string | null) {
    const { row } = await this.requireDoc(actor, id, 'editor');
    const state = (await this.collab.currentState(id)) ?? new Uint8Array();
    const vid = await this.store.snapshot(id, state, label, actor.id);
    await this.events.emit(this.db, actor, 'resource.version_saved', { resourceId: id, spaceId: row.spaceId }, { name: row.name, label });
    return { id: vid };
  }

  async versionContent(actor: Actor, id: string, versionId: string) {
    const { row } = await this.requireDoc(actor, id, 'viewer');
    const state = await this.store.loadSnapshot(id, versionId);
    if (!state) throw new NotFoundException('Version not found');
    if (row.type === 'spreadsheet') return { workbook: SheetsService.preview(state) };
    if (row.type === 'presentation') return { deck: SlidesService.preview(state) };
    return { content: stateToJSON(state) };
  }

  async restoreVersion(actor: Actor, id: string, versionId: string) {
    const { row } = await this.requireDoc(actor, id, 'editor');
    const state = await this.store.loadSnapshot(id, versionId);
    if (!state) throw new NotFoundException('Version not found');
    // Keep the current content as a version so a restore can always be undone.
    await this.store.snapshot(id, (await this.collab.currentState(id)) ?? new Uint8Array(), 'Before restore', actor.id);
    if (row.type === 'spreadsheet') await this.sheets.replace(id, SheetsService.preview(state), { id: actor.id, name: actor.name });
    else if (row.type === 'presentation') await this.slides.replace(id, SlidesService.preview(state), { id: actor.id, name: actor.name });
    else await this.collab.replaceContent(id, stateToJSON(state), { id: actor.id, name: actor.name });
    await this.events.emit(this.db, actor, 'resource.version_restored', { resourceId: id, spaceId: row.spaceId }, { name: row.name, versionId });
  }
}
