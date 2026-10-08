import { cellValue, newId, usedRange, type Cell, type CellStyle, type PlainSheet, type PlainWorkbook } from '@workos/sheet-model';
import { applyImages, drawingResource, imagesIn, imagesOf, type ImportedImage } from './xlsx-images';
import { applyResources, readResources } from './xlsx-resources';
import ExcelJS from 'exceljs';

export { drawingResource, type ImportedImage };
/** Bytes of a picture a workbook references (its own assets or data: URLs). */
export type ImageLoader = (src: string) => Promise<{ mime: string; data: Buffer } | null>;

/** XLSX ⇄ internal workbook (docs/ARCHITECTURE.md §8). Univer style codes are used on the internal side. */

// Univer BorderStyleTypes
const BORDER_IN: Record<string, number> = {
  thin: 1,
  hair: 2,
  dotted: 3,
  dashed: 4,
  dashDot: 5,
  dashDotDot: 6,
  double: 7,
  medium: 8,
  mediumDashed: 9,
  mediumDashDot: 10,
  mediumDashDotDot: 11,
  slantDashDot: 12,
  thick: 13,
};
const BORDER_OUT = Object.fromEntries(Object.entries(BORDER_IN).map(([k, v]) => [v, k])) as Record<number, ExcelJS.BorderStyle>;

const argbToHex = (c?: Partial<ExcelJS.Color>) => (c?.argb && /^[0-9a-f]{8}$/i.test(c.argb) ? `#${c.argb.slice(2)}` : undefined);
const hexToArgb = (h?: string) => (h && /^#?[0-9a-f]{6}$/i.test(h) ? `FF${h.replace('#', '').toUpperCase()}` : undefined);

const COL_PX = (chars: number) => Math.round(chars * 7 + 5);
const PX_COL = (px: number) => Math.max(1, Math.round(((px - 5) / 7) * 100) / 100);
const ROW_PX = (pt: number) => Math.round((pt * 4) / 3);
const PX_ROW = (px: number) => Math.round(px * 0.75 * 100) / 100;

const EXCEL_EPOCH = Date.UTC(1899, 11, 30);
export const dateToSerial = (d: Date) => (d.getTime() - EXCEL_EPOCH) / 86_400_000;
export const serialToDate = (n: number) => new Date(EXCEL_EPOCH + n * 86_400_000);

function styleIn(cell: ExcelJS.Cell): CellStyle | null {
  const s: CellStyle = {};
  const f = cell.font;
  if (f) {
    if (f.name) s.ff = f.name;
    if (f.size) s.fs = f.size;
    if (f.bold) s.bl = 1;
    if (f.italic) s.it = 1;
    if (f.underline) s.ul = { s: 1 };
    if (f.strike) s.st = { s: 1 };
    const cl = argbToHex(f.color);
    if (cl && cl !== '#000000') s.cl = { rgb: cl };
  }
  const fill = cell.fill as ExcelJS.FillPattern | undefined;
  if (fill?.type === 'pattern' && fill.pattern === 'solid') {
    const bg = argbToHex(fill.fgColor);
    if (bg) s.bg = { rgb: bg };
  }
  const a = cell.alignment;
  if (a) {
    if (a.horizontal === 'left') s.ht = 1;
    else if (a.horizontal === 'center' || a.horizontal === 'centerContinuous') s.ht = 2;
    else if (a.horizontal === 'right') s.ht = 3;
    if (a.vertical === 'top') s.vt = 1;
    else if (a.vertical === 'middle') s.vt = 2;
    else if (a.vertical === 'bottom') s.vt = 3;
    if (a.wrapText) s.tb = 3;
  }
  const b = cell.border;
  if (b) {
    const side = (x?: Partial<ExcelJS.Border>) => (x?.style ? { s: BORDER_IN[x.style] ?? 1, cl: { rgb: argbToHex(x.color) ?? '#000000' } } : undefined);
    const bd: CellStyle['bd'] = {};
    const t = side(b.top);
    const bo = side(b.bottom);
    const l = side(b.left);
    const r = side(b.right);
    if (t) bd.t = t;
    if (bo) bd.b = bo;
    if (l) bd.l = l;
    if (r) bd.r = r;
    if (Object.keys(bd).length) s.bd = bd;
  }
  if (cell.numFmt && cell.numFmt !== 'General') s.n = { pattern: cell.numFmt };
  return Object.keys(s).length ? s : null;
}

function valueIn(cell: ExcelJS.Cell): Cell | null {
  const out: Cell = {};
  const v = cell.value;
  const put = (x: unknown) => {
    if (x === null || x === undefined) return;
    if (typeof x === 'number') (out.v = x), (out.t = 2);
    else if (typeof x === 'boolean') (out.v = x), (out.t = 3);
    else if (x instanceof Date) (out.v = dateToSerial(x)), (out.t = 2);
    else if (typeof x === 'object' && 'error' in (x as object)) (out.v = String((x as { error: string }).error)), (out.t = 1);
    else (out.v = String(x)), (out.t = 1);
  };
  if (cell.type === ExcelJS.ValueType.Formula) {
    const formula = cell.formula;
    if (formula) out.f = `=${formula}`;
    put(cell.result);
  } else if (cell.type === ExcelJS.ValueType.RichText) {
    put((v as ExcelJS.CellRichTextValue).richText.map((r) => r.text).join(''));
  } else if (cell.type === ExcelJS.ValueType.Hyperlink) {
    put((v as ExcelJS.CellHyperlinkValue).text);
  } else if (cell.type !== ExcelJS.ValueType.Merge && cell.type !== ExcelJS.ValueType.Null) {
    put(v);
  }
  const s = styleIn(cell);
  if (s) out.s = s;
  // Dates without an explicit format still read as dates.
  if (v instanceof Date && !out.s?.n) out.s = { ...(out.s ?? {}), n: { pattern: 'yyyy-mm-dd' } };
  return out.v !== undefined || out.f || out.s ? out : null;
}

export interface XlsxReport {
  preserved: string[];
  degraded: string[];
  dropped: string[];
  warnings: string[];
}

export async function importXlsx(buf: Buffer, name: string): Promise<{ wb: PlainWorkbook; report: XlsxReport; images: ImportedImage[] }> {
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(buf as unknown as ArrayBuffer);
  const counts = { sheets: 0, cells: 0, formulas: 0, styled: 0, merges: 0, images: 0 };
  const sheets: PlainSheet[] = [];
  const pairs: { id: string; ws: ExcelJS.Worksheet }[] = [];
  const images: ImportedImage[] = [];
  book.eachSheet((ws) => {
    counts.sheets++;
    const cells: PlainSheet['cells'] = {};
    let maxR = 0;
    let maxC = 0;
    ws.eachRow({ includeEmpty: false }, (row, r) => {
      row.eachCell({ includeEmpty: false }, (cell, c) => {
        const x = valueIn(cell);
        if (!x) return;
        (cells[r - 1] ??= {})[c - 1] = x;
        counts.cells++;
        if (x.f) counts.formulas++;
        if (x.s) counts.styled++;
        maxR = Math.max(maxR, r);
        maxC = Math.max(maxC, c);
      });
    });
    const rowMeta: PlainSheet['rowMeta'] = {};
    ws.eachRow({ includeEmpty: true }, (row, r) => {
      if (row.height || row.hidden) rowMeta[r - 1] = { ...(row.height ? { h: ROW_PX(row.height) } : {}), ...(row.hidden ? { hd: 1 as const } : {}) };
    });
    const colMeta: PlainSheet['colMeta'] = {};
    (ws.columns ?? []).forEach((col, i) => {
      if (col?.width || col?.hidden) colMeta[i] = { ...(col.width ? { w: COL_PX(col.width) } : {}), ...(col.hidden ? { hd: 1 as const } : {}) };
    });
    const merges: PlainSheet['merges'] = [];
    for (const m of Object.values((ws as unknown as { _merges: Record<string, { top: number; left: number; bottom: number; right: number }> })._merges ?? {})) {
      merges.push({ r0: m.top - 1, c0: m.left - 1, r1: m.bottom - 1, c1: m.right - 1 });
    }
    counts.merges += merges.length;
    const view = ws.views?.[0] as { state?: string; xSplit?: number; ySplit?: number } | undefined;
    const id = newId();
    pairs.push({ id, ws });
    const sheet: PlainSheet = {
      id,
      meta: {
        name: ws.name,
        tabColor: argbToHex(ws.properties?.tabColor) ?? null,
        hidden: ws.state === 'hidden' || ws.state === 'veryHidden' ? 1 : 0,
        freeze: view?.state === 'frozen' && (view.xSplit || view.ySplit) ? { row: view.ySplit ?? 0, col: view.xSplit ?? 0 } : null,
        gridlines: ws.views?.[0]?.showGridLines === false ? 0 : 1,
      },
      rowCount: Math.max(maxR + 100, 1000),
      colCount: Math.max(maxC + 5, 26),
      cells,
      rowMeta,
      colMeta,
      merges,
    };
    sheets.push(sheet);
    const found = imagesIn(book, ws, sheet);
    counts.images += ws.getImages?.().length ?? 0;
    images.push(...found);
  });
  if (!sheets.length) throw new Error('The workbook has no worksheets');
  // Conditional formats, data validation, notes and named ranges become Univer plugin state.
  const extra = readResources(book, pairs);
  const degraded: string[] = [];
  if (extra.counts.conditionalSkipped) degraded.push(`conditional formats without an equivalent: ${extra.counts.conditionalSkipped} (icon sets, dates…)`);
  if (extra.counts.validationsSkipped) degraded.push(`data validation rules without an equivalent: ${extra.counts.validationsSkipped}`);
  const dropped = ['charts and pivot tables', 'macros (VBA)', 'external data connections'];
  if (counts.images > images.length) dropped.unshift(`pictures in a format other than PNG / JPEG / GIF: ${counts.images - images.length}`);
  return {
    wb: { name: name.replace(/\.(xlsx|xlsm|xls|csv)$/i, ''), sheets, resources: extra.resources },
    images,
    report: {
      preserved: [`sheets: ${counts.sheets}`, `cells: ${counts.cells}`, `formulas: ${counts.formulas}`, `styled cells: ${counts.styled}`, `merged ranges: ${counts.merges}`, 'column widths, row heights, frozen panes, tab colours, number formats', `conditional formats: ${extra.counts.conditional}`, `data validation rules: ${extra.counts.validations}`, `notes: ${extra.counts.notes}`, `named ranges: ${extra.counts.names}`, ...(images.length ? [`pictures: ${images.length}`] : [])],
      degraded,
      dropped,
      warnings: [],
    },
  };
}

function styleOut(cell: ExcelJS.Cell, s: CellStyle) {
  const font: Partial<ExcelJS.Font> = {};
  if (s.ff) font.name = s.ff;
  if (s.fs) font.size = s.fs;
  if (s.bl) font.bold = true;
  if (s.it) font.italic = true;
  if (s.ul?.s) font.underline = true;
  if (s.st?.s) font.strike = true;
  if (s.cl?.rgb) font.color = { argb: hexToArgb(s.cl.rgb) };
  if (Object.keys(font).length) cell.font = font;
  if (s.bg?.rgb && hexToArgb(s.bg.rgb)) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: hexToArgb(s.bg.rgb) } };
  const al: Partial<ExcelJS.Alignment> = {};
  if (s.ht) al.horizontal = ({ 1: 'left', 2: 'center', 3: 'right' } as const)[s.ht as 1 | 2 | 3];
  if (s.vt) al.vertical = ({ 1: 'top', 2: 'middle', 3: 'bottom' } as const)[s.vt as 1 | 2 | 3];
  if (s.tb === 3) al.wrapText = true;
  if (Object.keys(al).length) cell.alignment = al;
  if (s.bd) {
    const side = (x?: { s: number; cl: { rgb: string } } | null) => (x ? { style: BORDER_OUT[x.s] ?? 'thin', color: { argb: hexToArgb(x.cl?.rgb) ?? 'FF000000' } } : undefined);
    cell.border = { top: side(s.bd.t), bottom: side(s.bd.b), left: side(s.bd.l), right: side(s.bd.r) };
  }
  if (s.n?.pattern) cell.numFmt = s.n.pattern;
}

export async function exportXlsx(wb: PlainWorkbook, meta: { author?: string; loadImage?: ImageLoader } = {}): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  book.creator = meta.author ?? 'Master Office';
  book.created = new Date();
  // Excel recalculates every formula on open, so cached results can never be stale.
  book.calcProperties.fullCalcOnLoad = true;
  const byId = new Map<string, ExcelJS.Worksheet>();
  for (const s of wb.sheets) {
    const ws = book.addWorksheet(s.meta.name.slice(0, 31) || 'Sheet', {
      properties: s.meta.tabColor ? { tabColor: { argb: hexToArgb(s.meta.tabColor) } } : {},
      views: [
        {
          ...(s.meta.freeze && (s.meta.freeze.row || s.meta.freeze.col) ? { state: 'frozen' as const, xSplit: s.meta.freeze.col, ySplit: s.meta.freeze.row } : {}),
          showGridLines: s.meta.gridlines !== 0,
        },
      ],
      state: s.meta.hidden ? 'hidden' : 'visible',
    });
    byId.set(s.id, ws);
    const { maxR, maxC } = usedRange(s);
    for (const [c, m] of Object.entries(s.colMeta)) {
      if (Number(c) > Math.max(maxC, 50)) continue;
      const col = ws.getColumn(Number(c) + 1);
      if (m.w) col.width = PX_COL(m.w);
      if (m.hd) col.hidden = true;
    }
    for (const [r, m] of Object.entries(s.rowMeta)) {
      if (Number(r) > Math.max(maxR, 200)) continue;
      const row = ws.getRow(Number(r) + 1);
      if (m.h) row.height = PX_ROW(m.h);
      if (m.hd) row.hidden = true;
    }
    for (const [r, row] of Object.entries(s.cells)) {
      for (const [c, x] of Object.entries(row)) {
        const cell = ws.getCell(Number(r) + 1, Number(c) + 1);
        if (x.f) {
          const result = cellValue(x) ?? undefined;
          cell.value = { formula: x.f.replace(/^=/, ''), result: result as ExcelJS.CellFormulaValue['result'] };
        } else if (x.t === 3) {
          cell.value = cellValue(x);
        } else if (x.v !== null && x.v !== undefined) {
          cell.value = x.t === 2 && typeof x.v === 'string' && x.v.trim() !== '' && !Number.isNaN(Number(x.v)) ? Number(x.v) : x.v;
        }
        if (x.s) styleOut(cell, x.s);
      }
    }
    for (const g of s.merges) {
      try {
        ws.mergeCells(g.r0 + 1, g.c0 + 1, g.r1 + 1, g.c1 + 1);
      } catch {
        /* overlapping merge from concurrent edits — skip */
      }
    }
  }
  // Conditional formats, data validation, notes, hyperlinks and named ranges (Univer plugin state).
  applyResources(book, byId, wb.resources);
  // Floating pictures (the drawing plugin's state) — only the workbook's own assets are fetched.
  if (meta.loadImage) {
    const loaded: Parameters<typeof applyImages>[3] = [];
    for (const img of imagesOf(wb.resources?.SHEET_DRAWING_PLUGIN)) {
      const data = await meta.loadImage(img.source).catch(() => null);
      if (data && /^image\/(png|jpe?g|gif)$/i.test(data.mime)) loaded.push({ img, data: data.data, mime: data.mime });
    }
    applyImages(book, byId, new Map(wb.sheets.map((s) => [s.id, s])), loaded);
  }
  return Buffer.from(await book.xlsx.writeBuffer());
}
