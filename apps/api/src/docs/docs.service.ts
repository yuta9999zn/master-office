import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { changeCount, chartsOf, compareDocuments, docExtensions, pageSetupOf, SETTINGS_MAP, toHTMLDocument, toPlainText, type ChartPainter, type JSONContent, type PageSetup } from '@workos/doc-model';
import { chartSvg, DEFAULT_THEME, SLIDE_CSS, type ChartSpec } from '@workos/slide-model';

/** Document charts use the slide chart painter with the default theme. */
const paintChart: ChartPainter = (spec, w, h) => chartSvg(spec as ChartSpec, w, h, DEFAULT_THEME);
import type { ResourceType } from '@workos/shared';
import { generateJSON } from '@tiptap/html/server';
import { and, eq, inArray, sql } from 'drizzle-orm';
import mammoth from 'mammoth';
import { randomBytes } from 'node:crypto';
import type { Actor } from '../common/current-user';
import type { Db } from '../db/client';
import { InjectDb } from '../db/db.module';
import { auditEvents, blobs, comments, resourceAssets, resourceLinks, resources, resourceViews, users } from '../db/schema';
import { EventsService } from '../events/events.service';
import { PermissionsService } from '../permissions/permissions.service';
import { StorageService } from '../storage/storage.service';
import { config } from '../config';
import { signCollabToken } from '../collab/collab-token';
import { CollabService } from '../collab/collab.service';
import * as Y from 'yjs';
import { copyDocument, DocStore, documentJSON, stateToJSON } from './doc-store';
import { imageInfo, toDocx, type DocxImage } from './docx-export';
import { PdfRenderer } from './pdf-renderer';
import { cellValue } from '@workos/sheet-model';
import { SheetsService, type SheetExportFormat } from '../sheets/sheets.service';
import { deckImages, SlidesService, type SlideExportFormat } from '../slides/slides.service';
import type { ImageLoader } from '../slides/pptx-export';
import { FORM_MAP, ITEMS_MAP, ORDER_ARRAY as FORM_ORDER, readForm as readFormFromDoc, writeForm, type PlainForm } from '@workos/form-model';

export const COLLAB_TYPES: ResourceType[] = ['document', 'wiki', 'note', 'spreadsheet', 'presentation', 'form'];
export type ExportFormat = 'docx' | 'pdf' | 'html' | 'txt' | 'xlsx' | 'csv' | 'pptx' | 'png';
/** Published pages: a thin top bar, and slides scaled to the window (presentations). */
const PUBLISH_CSS = `.mo-pub-bar{position:sticky;top:0;z-index:10;font:13px/1.4 Inter,Arial,sans-serif;color:#475569;background:#f8fafc;border-bottom:1px solid #e2e8f0;padding:8px 16px}@media screen{main{max-width:860px;margin:0 auto;padding:24px 16px 48px}}`;
const PUBLISH_SLIDES_CSS = `@media screen{html,body{background:#0f172a}.page{margin:16px auto;box-shadow:0 8px 24px rgba(0,0,0,.35);transform-origin:top left}.mo-pub-bar{background:#1e293b;color:#cbd5e1;border-color:#334155}}`;
const PUBLISH_SLIDES_JS = `(function(){function fit(){var p=document.querySelectorAll('.page');p.forEach(function(e){var w=e.offsetWidth||1;var k=Math.min(1,(window.innerWidth-32)/w);e.style.zoom=k;});}window.addEventListener('resize',fit);fit();})();`;

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

function readFormState(state: Uint8Array): PlainForm {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, state);
  return readFormFromDoc(doc);
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
    // Opening the editor counts as a view (Activity dashboard). Never blocks opening.
    await this.recordView(actor, id).catch((e) => this.log.warn(`view not recorded: ${(e as Error).message}`));
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
    return { json: documentJSON(doc), pageSetup: pageSetupOf(doc.getMap(SETTINGS_MAP).toJSON()) };
  }

  /** Formatted-free values of A1:D5 in a spreadsheet the viewer can read. */
  /** Macros of a spreadsheet, for Extensions → Macros → Import (docs/ARCHITECTURE.md §46). Viewers may import from it. */
  async macros(actor: Actor, id: string) {
    const { row } = await this.perms.require(actor, id, 'viewer');
    if (row.type !== 'spreadsheet') throw new BadRequestException('Not a spreadsheet');
    const state = await this.collab.currentState(id);
    if (!state) return [];
    const doc = new Y.Doc();
    Y.applyUpdate(doc, state);
    return [...doc.getMap<{ name: string; fn: string; code: string }>('macros').values()]
      .map((m) => ({ name: m.name, fn: m.fn, code: m.code }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

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
    // Pictures everywhere; video and audio for presentations (Insert → Video / Audio).
    const media = /^(video|audio)\//.test(mime);
    if (!mime.startsWith('image/') && !media) throw new BadRequestException('Only pictures, video and audio can be embedded');
    if (!media && buf.length > 20 * 1024 * 1024) throw new BadRequestException('Pictures can be up to 20 MB');
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

  async asset(actor: Actor, id: string, blobId: string, range?: { start: number; end?: number }) {
    await this.perms.require(actor, id, 'viewer');
    const [row] = await this.db
      .select({ key: blobs.storageKey, mime: blobs.mimeType, size: blobs.sizeBytes })
      .from(resourceAssets)
      .innerJoin(blobs, eq(blobs.id, resourceAssets.blobId))
      .where(and(eq(resourceAssets.resourceId, id), eq(resourceAssets.blobId, blobId)));
    if (!row) throw new NotFoundException('Image not found');
    const size = Number(row.size);
    if (range && range.start < size) {
      const end = Math.min(size - 1, range.end ?? size - 1);
      return { stream: await this.storage.getStream(row.key, { start: range.start, end }), mime: row.mime ?? 'application/octet-stream', size, range: { start: range.start, end } };
    }
    return { stream: await this.storage.getStream(row.key), mime: row.mime ?? 'application/octet-stream', size, range: null };
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
  private async loadImages(id: string, doc: JSONContent, extra: (string | null | undefined)[] = []) {
    const wanted = [...collectImages(doc), ...extra.filter((x): x is string => !!x)]
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

  async export(actor: Actor, id: string, format: ExportFormat, sheetId?: string, slide?: number, opts: { quiet?: boolean } = {}) {
    const { row } = await this.requireDoc(actor, id, 'viewer');
    if (row.type === 'form') throw new BadRequestException('Forms have no file format — download the responses as CSV (Responses tab) or link them to a spreadsheet');
    if (row.type === 'presentation') {
      if (!SLIDE_FORMATS.includes(format)) throw new BadRequestException(`Presentations export as ${SLIDE_FORMATS.join(', ')}`);
      const f = await this.slides.export(id, row.name, format as SlideExportFormat, this.imageLoader(id), { author: actor.name, slide });
      if (!opts.quiet) await this.events.emit(this.db, actor, 'resource.exported', { resourceId: id, spaceId: row.spaceId }, { name: row.name, format });
      return f;
    }
    if (row.type === 'spreadsheet') {
      if (!SHEET_FORMATS.includes(format)) throw new BadRequestException(`Spreadsheets export as ${SHEET_FORMATS.join(', ')}`);
      const f = await this.sheets.export(id, row.name, format as SheetExportFormat, { author: actor.name, sheetId });
      if (!opts.quiet) await this.events.emit(this.db, actor, 'resource.exported', { resourceId: id, spaceId: row.spaceId }, { name: row.name, format });
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
      // Word needs pictures: each chart is drawn in the headless browser and captured as PNG.
      const charts = chartsOf(doc);
      if (charts.length) {
        const w = Math.max(...charts.map((c) => c.width));
        const h = Math.max(...charts.map((c) => c.height));
        const pages = charts.map((c) => `<div class="page" style="width:${c.width}px;height:${c.height}px;background:#fff">${paintChart(c.spec, c.width, c.height)}</div>`).join('');
        const pngs = await this.pdf.screenshots(`<!doctype html><html><head><meta charset="utf-8"><style>${SLIDE_CSS} body{margin:0}</style></head><body>${pages}</body></html>`, { w, h });
        pngs.forEach((png, i) => {
          const info = imageInfo(png);
          if (info) images.set(`chart:${i + 1}`, { ...info, width: charts[i].width, height: charts[i].height, data: png });
        });
      }
      body = await toDocx(title, doc, images, { author: actor.name, pageSetup });
    } else {
      const images = await this.loadImages(id, doc, [pageSetup.watermark?.image]);
      const html = toHTMLDocument(title, doc, {
        pageSetup,
        renderChart: paintChart,
        resolveImage: (src) => {
          const img = images.get(src);
          return img ? `data:${img.mime};base64,${img.buf.toString('base64')}` : src;
        },
      });
      body = format === 'pdf' ? await this.pdf.render(html, { pageSetup, title }) : Buffer.from(html, 'utf8');
    }
    if (!opts.quiet) await this.events.emit(this.db, actor, 'resource.exported', { resourceId: id, spaceId: row.spaceId }, { name: row.name, format });
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
    if (src?.type === 'form') {
      // Rebuilt from the plain form: its own Yjs history, no linked response sheet (responses are not copied).
      const form = readFormState(state);
      const doc = new Y.Doc();
      writeForm(doc, { ...form, settings: { ...form.settings, sheetId: null } });
      await this.store.save(toId, Y.encodeStateAsUpdate(doc), doc, null);
      return;
    }
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
      // Macros travel with the copy (they live in the doc's top-level `macros` map).
      const src = new Y.Doc();
      Y.applyUpdate(src, state);
      const macros = src.getMap('macros').toJSON();
      if (Object.keys(macros).length) doc.transact(() => Object.entries(macros).forEach(([k, v]) => doc.getMap('macros').set(k, v)));
      await this.store.save(toId, Object.keys(macros).length ? Y.encodeStateAsUpdate(doc) : fresh, doc, null);
      return;
    }
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
    // Every tab and the settings (page setup, watermark, tabs) are copied; images point at the copy's assets.
    const source = new Y.Doc();
    Y.applyUpdate(source, state);
    const doc = copyDocument(source, rewrite);
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

  /**
   * Tools → Compare documents: a new document holding `otherId` written as suggestions against `id` (created by the
   * caller-supplied `create`, so the resource lands next to the base document with the usual permissions).
   */
  async compare(actor: Actor, id: string, otherId: string, create: (name: string, parentId: string | null, spaceId: string | null) => Promise<{ id: string }>) {
    const { row } = await this.requireDoc(actor, id, 'viewer');
    const { row: other } = await this.requireDoc(actor, otherId, 'viewer');
    if (!['document', 'wiki'].includes(row.type) || !['document', 'wiki'].includes(other.type)) throw new BadRequestException('Only documents can be compared');
    const json = compareDocuments((await this.document(id)).json, (await this.document(otherId)).json, { authorId: actor.id, authorName: baseName(other.name) });
    const created = await create(`Comparison of ${baseName(row.name)} and ${baseName(other.name)}`, row.parentId ?? null, row.spaceId ?? null);
    await this.collab.replaceContent(created.id, json, { id: actor.id, name: actor.name });
    return { ...created, changes: changeCount(json) };
  }

  // ── Publish to web (docs/ARCHITECTURE.md §42) ───────────────────────────────

  /** Publishes (or stops publishing) a document, spreadsheet or presentation; the link stays the same when republished. */
  async publish(actor: Actor, id: string, on: boolean) {
    const { row } = await this.requireDoc(actor, id, 'editor');
    if (!['document', 'wiki', 'spreadsheet', 'presentation'].includes(row.type)) throw new BadRequestException('Only documents, spreadsheets and presentations can be published');
    const meta = { ...((row.metadata as Record<string, unknown>) ?? {}) };
    const current = meta.publish as { token: string } | undefined;
    if (on) meta.publish = { token: current?.token ?? randomBytes(16).toString('base64url'), at: new Date().toISOString(), by: actor.id };
    else delete meta.publish;
    await this.db.update(resources).set({ metadata: meta }).where(eq(resources.id, id));
    await this.events.emit(this.db, actor, on ? 'resource.published' : 'resource.unpublished', { resourceId: id, spaceId: row.spaceId }, { name: row.name });
    return { published: on, token: on ? (meta.publish as { token: string }).token : null };
  }

  /** The published page: the current content as HTML, rendered on each request (always up to date). */
  async published(token: string, embed: boolean): Promise<{ title: string; html: string }> {
    if (!/^[\w-]{16,64}$/.test(token)) throw new NotFoundException('Not published');
    const [row] = await this.db
      .select({ id: resources.id, name: resources.name, type: resources.type, ownerId: resources.ownerId, workspaceId: resources.workspaceId, ownerName: users.name })
      .from(resources)
      .innerJoin(users, eq(users.id, resources.ownerId))
      .where(and(sql`${resources.metadata}->'publish'->>'token' = ${token}`, sql`${resources.trashedAt} is null`));
    if (!row) throw new NotFoundException('This page is not published (any more)');
    // Rendered as the owner (the link is the permission), without logging an export each time it is opened.
    const owner: Actor = { id: row.ownerId, name: row.ownerName, workspaceId: row.workspaceId };
    const f = await this.export(owner, row.id, 'html', undefined, undefined, { quiet: true });
    let html = f.body.toString('utf8');
    const title = baseName(row.name);
    const extra = `<meta name="robots" content="noindex"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${PUBLISH_CSS}${row.type === 'presentation' ? PUBLISH_SLIDES_CSS : ''}</style>`;
    html = html.replace('</head>', `${extra}</head>`);
    if (row.type === 'presentation') html = html.replace('</body>', `<script>${PUBLISH_SLIDES_JS}</script></body>`);
    if (!embed) html = html.replace(/<body([^>]*)>/, `<body$1><div class="mo-pub-bar">Published with Master Office · <b>${title.replace(/</g, '&lt;')}</b> · updated automatically</div>`);
    return { title, html };
  }

  /** A new document created from the template gallery (doc-model DOC_TEMPLATES). */
  fillTemplate(id: string, json: JSONContent, actor: Actor) {
    return this.collab.replaceContent(id, json, { id: actor.id, name: actor.name });
  }

  // ── Activity dashboard (docs/ARCHITECTURE.md §43) ───────────────────────────

  private recordView(actor: Actor, id: string) {
    return this.db
      .insert(resourceViews)
      .values({ resourceId: id, userId: actor.id, day: sql`current_date` })
      .onConflictDoUpdate({ target: [resourceViews.resourceId, resourceViews.userId, resourceViews.day], set: { count: sql`${resourceViews.count} + 1`, lastAt: sql`now()` } });
  }

  /** Tools → Activity dashboard: viewers, 30-day viewer and comment trends, sharing history. Editors only. */
  async activityDashboard(actor: Actor, id: string) {
    await this.requireDoc(actor, id, 'editor');
    const viewers = await this.db
      .select({ userId: resourceViews.userId, name: users.name, color: users.avatarColor, lastAt: sql<string>`max(${resourceViews.lastAt})`, views: sql<number>`sum(${resourceViews.count})::int` })
      .from(resourceViews)
      .innerJoin(users, eq(users.id, resourceViews.userId))
      .where(eq(resourceViews.resourceId, id))
      .groupBy(resourceViews.userId, users.name, users.avatarColor)
      .orderBy(sql`max(${resourceViews.lastAt}) desc`);
    const days = (await this.db.execute(sql`
      SELECT to_char(d::date, 'YYYY-MM-DD') AS day,
        (SELECT count(DISTINCT user_id) FROM resource_views v WHERE v.resource_id = ${id} AND v.day = d::date)::int AS viewers,
        (SELECT count(*) FROM comments c WHERE c.resource_id = ${id} AND c.created_at::date = d::date)::int AS comments
      FROM generate_series(current_date - 29, current_date, interval '1 day') AS d ORDER BY d`)) as unknown as { rows: { day: string; viewers: number; comments: number }[] };
    const sharing = await this.db
      .select({ action: auditEvents.action, data: auditEvents.data, at: auditEvents.createdAt, actor: users.name })
      .from(auditEvents)
      .leftJoin(users, eq(users.id, auditEvents.actorId))
      .where(and(eq(auditEvents.resourceId, id), inArray(auditEvents.action, ['resource.created', 'acl.changed', 'resource.published', 'resource.unpublished', 'resource.moved'])))
      .orderBy(sql`${auditEvents.createdAt} desc`)
      .limit(40);
    return { viewers, trend: days.rows ?? (days as unknown as { day: string; viewers: number; comments: number }[]), sharing };
  }

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
    if (row.type === 'form') return { form: readFormState(state) };
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
    else if (row.type === 'form') {
      const form = readFormState(state);
      await this.collab.transact(id, { id: actor.id, name: actor.name }, (doc) => {
        // Keep the current response-sheet link: restoring questions must not detach the sheet.
        const sheetId = ((doc.getMap(FORM_MAP).get('settings') as PlainForm['settings'] | undefined)?.sheetId) ?? null;
        for (const name of [FORM_MAP, ITEMS_MAP]) {
          const m = doc.getMap(name);
          for (const k of [...m.keys()]) m.delete(k);
        }
        const order = doc.getArray(FORM_ORDER);
        order.delete(0, order.length);
        writeForm(doc, { ...form, settings: { ...form.settings, sheetId } });
      });
    }
    else await this.collab.replaceDocument(id, state, { id: actor.id, name: actor.name });
    await this.events.emit(this.db, actor, 'resource.version_restored', { resourceId: id, spaceId: row.spaceId }, { name: row.name, versionId });
  }
}
