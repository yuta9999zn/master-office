import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { DEFAULT_PAGE_SETUP } from '@workos/doc-model';
import {
  cellKey,
  cellValue,
  colName,
  newId,
  RESOURCES_MAP,
  SHEETS_MAP,
  WB_MAP,
  ySheet,
  type Cell,
  emptySheet,
  formatValue,
  readWorkbook,
  usedRange,
  writeWorkbook,
  type CellStyle,
  type PlainSheet,
  type PlainWorkbook,
  toStoredCell,
  yStyles,
} from '@workos/sheet-model';
import * as Y from 'yjs';
import type { Actor } from '../common/current-user';
import { CollabService } from '../collab/collab.service';
import { DocStore } from '../docs/doc-store';
import { PdfRenderer } from '../docs/pdf-renderer';
import { csvToSheet, sheetToCsv } from './csv';
import { exportXlsx, importXlsx, type ImageLoader, type XlsxReport } from './xlsx';
import { drawingResource } from './xlsx-images';
import { importToState, type WorkerImage, type WorkerResult } from './xlsx-worker';
import { fork } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ModuleRef } from '@nestjs/core';
import { DocsService } from '../docs/docs.service';
import JSZip from 'jszip';
import { readVbaProject, type VbaModule } from './vba';

export type SheetExportFormat = 'xlsx' | 'csv' | 'pdf' | 'html';

export const SHEET_EXPORT_MIME: Record<SheetExportFormat, string> = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv; charset=utf-8',
  pdf: 'application/pdf',
  html: 'text/html; charset=utf-8',
};

export const sheetBaseName = (name: string) => name.replace(/\.(xlsx|xlsm|xls|csv|ods)$/i, '');

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const BORDER_CSS: Record<number, string> = { 1: '1px solid', 2: '1px dotted', 3: '1px dotted', 4: '1px dashed', 7: '3px double', 8: '2px solid', 9: '2px dashed', 13: '3px solid' };

function styleCss(s: CellStyle | null | undefined, v: unknown): string {
  const css: string[] = [];
  if (s?.ff) css.push(`font-family:${JSON.stringify(s.ff)}`);
  if (s?.fs) css.push(`font-size:${s.fs}pt`);
  if (s?.bl) css.push('font-weight:700');
  if (s?.it) css.push('font-style:italic');
  const deco = [s?.ul?.s ? 'underline' : '', s?.st?.s ? 'line-through' : ''].filter(Boolean).join(' ');
  if (deco) css.push(`text-decoration:${deco}`);
  if (s?.cl?.rgb) css.push(`color:${s.cl.rgb}`);
  if (s?.bg?.rgb) css.push(`background:${s.bg.rgb}`);
  // Excel default alignment: numbers right, booleans centre, text left.
  const ht = s?.ht || (typeof v === 'number' ? 3 : typeof v === 'boolean' ? 2 : 1);
  css.push(`text-align:${['left', 'left', 'center', 'right'][ht]}`);
  if (s?.vt) css.push(`vertical-align:${['bottom', 'top', 'middle', 'bottom'][s.vt]}`);
  if (s?.tb === 3) css.push('white-space:pre-wrap');
  for (const [k, side] of [['t', 'top'], ['b', 'bottom'], ['l', 'left'], ['r', 'right']] as const) {
    const b = s?.bd?.[k];
    if (b) css.push(`border-${side}:${BORDER_CSS[b.s] ?? '1px solid'} ${b.cl?.rgb ?? '#000'}`);
  }
  return css.join(';');
}

/** One sheet as an HTML table (used range only), honouring widths, heights, merges, hidden rows/columns and styles. */
export function sheetToHtml(s: PlainSheet): string {
  const { maxR, maxC } = usedRange(s);
  if (maxR < 0) return `<h2 class="sheet-name">${esc(s.meta.name)}</h2><p class="empty">(empty)</p>`;
  const covered = new Set<string>();
  const spans = new Map<string, { rs: number; cs: number }>();
  for (const g of s.merges) {
    spans.set(`${g.r0}:${g.c0}`, { rs: g.r1 - g.r0 + 1, cs: g.c1 - g.c0 + 1 });
    for (let r = g.r0; r <= g.r1; r++) for (let c = g.c0; c <= g.c1; c++) if (r !== g.r0 || c !== g.c0) covered.add(`${r}:${c}`);
  }
  const cols: number[] = [];
  for (let c = 0; c <= maxC; c++) if (!s.colMeta[c]?.hd) cols.push(c);
  const grid = s.meta.gridlines !== 0;
  let html = `<h2 class="sheet-name">${esc(s.meta.name)}</h2><table class="${grid ? 'grid' : ''}"><colgroup>`;
  for (const c of cols) html += `<col style="width:${s.colMeta[c]?.w ?? s.meta.defaultColWidth ?? 88}px">`;
  html += '</colgroup>';
  for (let r = 0; r <= maxR; r++) {
    if (s.rowMeta[r]?.hd) continue;
    html += `<tr style="height:${s.rowMeta[r]?.h ?? s.meta.defaultRowHeight ?? 24}px">`;
    for (const c of cols) {
      if (covered.has(`${r}:${c}`)) continue;
      const cell = s.cells[r]?.[c];
      const span = spans.get(`${r}:${c}`);
      const attrs = span ? `${span.rs > 1 ? ` rowspan="${span.rs}"` : ''}${span.cs > 1 ? ` colspan="${span.cs}"` : ''}` : '';
      const v = cellValue(cell);
      const text = cell ? formatValue(v, cell.s?.n?.pattern) : '';
      html += `<td${attrs} style="${styleCss(cell?.s, v)}">${esc(text)}</td>`;
    }
    html += '</tr>';
  }
  return `${html}</table>`;
}

export function workbookToHtml(title: string, wb: PlainWorkbook): string {
  const body = wb.sheets
    .filter((s) => !s.meta.hidden)
    .map((s) => `<section>${sheetToHtml(s)}</section>`)
    .join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>
@page { size: A4 landscape; margin: 12mm; }
body { font-family: Arial, 'Noto Sans', sans-serif; font-size: 10pt; color: #111; margin: 0; }
section + section { break-before: page; }
.sheet-name { font-size: 11pt; margin: 0 0 6px; color: #334155; }
table { border-collapse: collapse; table-layout: fixed; }
td { padding: 1px 4px; overflow: hidden; white-space: nowrap; vertical-align: bottom; }
table.grid td { border: 1px solid #d4d4d8; }
tr { break-inside: avoid; }
.empty { color: #94a3b8; }
</style></head><body>${body}</body></html>`;
}

/** Spreadsheets on the collaborative store: create, import, export, restore (docs/ARCHITECTURE.md §22). */
@Injectable()
export class SheetsService {
  private readonly log = new Logger('Sheets');

  constructor(
    private readonly store: DocStore,
    private readonly collab: CollabService,
    private readonly pdf: PdfRenderer,
    private readonly moduleRef: ModuleRef,
  ) {}

  /** Workbook from the live or stored Yjs state (an empty sheet if the spreadsheet was never initialised). */
  async workbook(id: string, name = 'Workbook'): Promise<PlainWorkbook> {
    const state = await this.collab.currentState(id);
    if (!state?.length) return { name, sheets: [emptySheet()] };
    const doc = new Y.Doc();
    Y.applyUpdate(doc, state);
    const wb = readWorkbook(doc);
    return wb.sheets.length ? wb : { name, sheets: [emptySheet()] };
  }

  static stateOf(wb: PlainWorkbook) {
    const doc = new Y.Doc();
    writeWorkbook(doc, wb);
    return { doc, state: Y.encodeStateAsUpdate(doc) };
  }

  /**
   * The server creates every spreadsheet's containers (new, imported, seeded); clients never do,
   * so two first-openers can never race to create conflicting maps.
   */
  async init(id: string, wb: PlainWorkbook = { name: 'Workbook', sheets: [emptySheet()] }, editor: { id: string; name: string } | null = null) {
    const { doc, state } = SheetsService.stateOf(wb);
    await this.store.save(id, state, doc, editor);
  }

  /** Converts an uploaded .xlsx / .csv into the collaborative model. */
  async importFile(actor: Actor, id: string, buf: Buffer, fileName: string): Promise<XlsxReport & { status: string }> {
    const ext = fileName.split('.').pop()?.toLowerCase();
    let wb: PlainWorkbook;
    let report: XlsxReport;
    let vba: VbaModule[] = [];
    if (ext === 'xlsx' || ext === 'xlsm') {
      // Built in a child process: the API keeps answering, and the memory ExcelJS needs is given back when it exits.
      const r = await this.importIsolated(buf, fileName);
      report = r.report;
      if (ext === 'xlsm') vba = await this.vbaOf(buf, report);
      await this.collab.replaceWorkbookState(id, r.state, { id: actor.id, name: actor.name });
      await this.placePictures(actor, id, r.images, report);
      await this.collab.replaceMap(id, 'vba', Object.fromEntries(vba.map((m, i) => [String(i).padStart(3, '0'), m])), { id: actor.id, name: actor.name });
      this.log.log(`imported ${fileName}: ${r.stats.cells} cells, state ${(r.stats.stateBytes / 1048576).toFixed(1)} MB, ${r.stats.totalMs} ms${r.worker ? ' (worker)' : ''}`);
      return { status: 'done', ...report };
    } else if (ext === 'csv') {
      const sheet = csvToSheet(buf.toString('utf8'), sheetBaseName(fileName));
      wb = { name: sheetBaseName(fileName), sheets: [sheet] };
      const { maxR, maxC } = usedRange(sheet);
      report = { preserved: [`rows: ${maxR + 1}`, `columns: ${maxC + 1}`, 'numbers, booleans and formulas'], degraded: [], dropped: [], warnings: [] };
    } else {
      throw new BadRequestException(
        ext === 'xls' || ext === 'ods'
          ? `Legacy .${ext} files need the LibreOffice converter (not installed on this server). Save as .xlsx and upload again.`
          : `.${ext} import is not supported yet.`,
      );
    }
    await this.replace(id, wb, { id: actor.id, name: actor.name });
    await this.collab.replaceMap(id, 'vba', Object.fromEntries(vba.map((m, i) => [String(i).padStart(3, '0'), m])), { id: actor.id, name: actor.name });
    return { status: 'done', ...report };
  }

  /**
   * The .xlsx → Yjs state, in the import worker when the built one exists (production), inline otherwise (dev
   * under tsx, tests) — the same code either way.
   */
  private async importIsolated(buf: Buffer, fileName: string): Promise<{ state: Uint8Array; report: XlsxReport; images: (WorkerImage & { data: Buffer })[]; stats: WorkerResult['stats']; worker: boolean }> {
    const dir = mkdtempSync(join(tmpdir(), 'mo-xlsx-'));
    const file = join(dir, 'in.xlsx');
    const out = join(dir, 'state.bin');
    writeFileSync(file, buf);
    try {
      const worker = join(__dirname, 'xlsx-worker.js');
      let result: WorkerResult;
      let viaWorker = false;
      if (existsSync(worker)) {
        viaWorker = true;
        result = await new Promise<WorkerResult>((resolve, reject) => {
          const child = fork(worker, [], { execArgv: ['--max-old-space-size=4096'], stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
          const timer = setTimeout(() => (child.kill(), reject(new Error('The import took longer than 10 minutes'))), 600_000);
          child.once('message', (m: WorkerResult | { ok: false; error: string }) => {
            clearTimeout(timer);
            if (m.ok) resolve(m);
            else reject(new BadRequestException(`The workbook could not be read: ${m.error}`));
          });
          child.once('error', (e) => (clearTimeout(timer), reject(e)));
          child.once('exit', (code) => code && reject(new Error(`The import worker stopped (code ${code}) — the file may be too large for this server`)));
          child.send({ file, name: fileName, out });
        });
      } else result = await importToState({ file, name: fileName, out });
      const state = new Uint8Array(readFileSync(out));
      const images = result.images.map((img) => ({ ...img, data: readFileSync(img.path) }));
      return { state, report: result.report, images, stats: result.stats, worker: viaWorker };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  /** Pictures of an imported workbook: stored as the spreadsheet's assets, drawn by Univer's drawing plugin. */
  private async placePictures(actor: Actor, id: string, images: (WorkerImage & { data: Buffer })[], report: XlsxReport) {
    if (!images.length) return;
    const docs = this.moduleRef.get(DocsService, { strict: false });
    const placed: { sheetId: string; source: string; from: WorkerImage['from']; to: WorkerImage['to']; box: WorkerImage['box'] }[] = [];
    for (const img of images) {
      try {
        const { url } = await docs.saveAsset(actor, id, img.data, `image/${img.ext}`);
        placed.push({ sheetId: img.sheetId, source: url, from: img.from, to: img.to, box: img.box });
      } catch (e) {
        report.warnings.push(`A picture could not be stored: ${(e as Error).message}`);
      }
    }
    if (!placed.length) return;
    await this.collab.transact(id, { id: actor.id, name: actor.name }, (doc) => {
      const res = doc.getMap<string>(RESOURCES_MAP);
      res.set('SHEET_DRAWING_PLUGIN', drawingResource(id, placed, res.get('SHEET_DRAWING_PLUGIN')));
    });
  }

  /** VBA source of a macro-enabled workbook: kept read-only (Extensions → Macros), never executed. */
  private async vbaOf(buf: Buffer, report: XlsxReport): Promise<VbaModule[]> {
    try {
      const bin = await (await JSZip.loadAsync(buf)).file('xl/vbaProject.bin')?.async('uint8array');
      if (!bin) return [];
      const modules = readVbaProject(bin);
      const withCode = modules.filter((m) => m.code);
      report.dropped = report.dropped.filter((d) => !/macros/i.test(d));
      report.preserved.push(`VBA macros: ${withCode.length} module(s) kept as read-only source (Extensions → Macros)`);
      report.degraded.push('VBA does not run in Master Office — rewrite it as a JavaScript macro (Extensions → Macros)');
      return modules;
    } catch (e) {
      report.warnings.push(`VBA project could not be read: ${(e as Error).message}`);
      return [];
    }
  }

  /** Replaces the whole workbook for everyone connected (import, version restore). */
  async replace(id: string, wb: PlainWorkbook, editor: { id: string; name: string }) {
    await this.collab.replaceWorkbook(id, wb, editor);
  }

  /** Appends rows below the last used row of the first sheet (form responses → linked spreadsheet). */
  /** Appends rows below the used rows of the first sheet; returns where they went (sheet name, 0-based first row). */
  async appendRows(id: string, rows: (string | number)[][], editor: { id: string; name: string }, opts: { headerBold?: boolean } = {}) {
    let at: { sheet: string; row: number } | null = null;
    await this.collab.transact(id, editor, (doc) => {
      const order = (doc.getMap(WB_MAP).get('sheetOrder') as string[] | undefined) ?? [];
      const m = doc.getMap(SHEETS_MAP).get(order[0]) as Y.Map<unknown> | undefined;
      if (!m) return;
      const ys = ySheet(m);
      const styles = yStyles(doc);
      const rowIds = ys.rows.toArray();
      const colIds = ys.cols.toArray();
      const used = new Set<string>();
      ys.cells.forEach((_c, key) => used.add(key.slice(0, key.indexOf(':'))));
      let start = 0;
      rowIds.forEach((rid, i) => used.has(rid) && (start = i + 1));
      const needRows = start + rows.length - rowIds.length;
      if (needRows > 0) ys.rows.push(Array.from({ length: needRows }, newId));
      const width = Math.max(...rows.map((r) => r.length), 0);
      if (width > colIds.length) ys.cols.push(Array.from({ length: width - colIds.length }, newId));
      const allRows = ys.rows.toArray();
      const allCols = ys.cols.toArray();
      rows.forEach((row, i) =>
        row.forEach((v, j) => {
          if (v === '' || v === null || v === undefined) return;
          const cell: Cell = typeof v === 'number' ? { v, t: 2 } : { v: String(v), t: 1 };
          if (opts.headerBold && start === 0 && i === 0) cell.s = { bl: 1, bg: { rgb: '#E8F0FE' } };
          ys.cells.set(cellKey(allRows[start + i], allCols[j]), toStoredCell(styles, cell));
        }),
      );
      if (opts.headerBold && start === 0) ys.map.set('meta', { ...ys.meta(), freeze: { row: 1, col: 0 } });
      at = { sheet: ys.meta().name, row: start };
    });
    return at as { sheet: string; row: number } | null;
  }

  async export(id: string, name: string, format: SheetExportFormat, opts: { author?: string; sheetId?: string; loadImage?: ImageLoader } = {}) {
    const wb = await this.workbook(id, name);
    const title = sheetBaseName(name);
    let body: Buffer;
    let fileName = `${title}.${format}`;
    if (format === 'xlsx') body = await exportXlsx(wb, { author: opts.author, loadImage: opts.loadImage });
    else if (format === 'csv') {
      // CSV holds one sheet: the requested one, else the first visible one (like Excel's "active sheet").
      const sheet = wb.sheets.find((s) => s.id === opts.sheetId) ?? wb.sheets.find((s) => !s.meta.hidden) ?? wb.sheets[0];
      body = Buffer.from(sheetToCsv(sheet), 'utf8');
      if (wb.sheets.length > 1) fileName = `${title} - ${sheet.meta.name}.csv`;
    } else {
      const html = workbookToHtml(title, wb);
      body = format === 'pdf' ? await this.pdf.render(html, { title, pageSetup: { ...DEFAULT_PAGE_SETUP, orientation: 'landscape' } }) : Buffer.from(html, 'utf8');
    }
    return { name: fileName, mime: SHEET_EXPORT_MIME[format], body };
  }

  /** Version preview payload: the index-based workbook (values, formulas, styles). */
  static preview(state: Uint8Array): PlainWorkbook {
    const doc = new Y.Doc();
    Y.applyUpdate(doc, state);
    return readWorkbook(doc);
  }

  static a1(r: number, c: number) {
    return `${colName(c)}${r + 1}`;
  }
}
