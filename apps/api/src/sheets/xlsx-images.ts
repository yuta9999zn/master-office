// Floating pictures of a workbook (docs/ARCHITECTURE.md §83): read from the .xlsx with their anchors, placed on the
// sheet in pixels the way Univer draws them, stored as the spreadsheet's assets and written as the drawing plugin's
// state (SHEET_DRAWING_PLUGIN) — and back into the .xlsx on export.
import type ExcelJS from 'exceljs';
import type { PlainSheet } from '@workos/sheet-model';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

/** Univer draws columns 88 px and rows 24 px wide / high unless the sheet says otherwise (see toUniverSheet). */
const DEFAULT_COL_PX = 88;
const DEFAULT_ROW_PX = 24;

export interface CellAnchor {
  column: number;
  columnOffset: number;
  row: number;
  rowOffset: number;
}
export interface ImportedImage {
  sheetId: string;
  ext: 'png' | 'jpeg' | 'gif';
  data: Buffer;
  from: CellAnchor;
  to: CellAnchor;
  /** Pixel box on the sheet (left / top from the first cell, width / height of the picture). */
  box: { left: number; top: number; width: number; height: number };
}
/** A picture of the drawing plugin's state, as the exporter reads it. */
export interface StoredImage {
  sheetId: string;
  source: string;
  from: CellAnchor;
  to: CellAnchor;
  box: { left: number; top: number; width: number; height: number };
}

const colPx = (s: PlainSheet, c: number) => s.colMeta[c]?.w ?? DEFAULT_COL_PX;
const rowPx = (s: PlainSheet, r: number) => s.rowMeta[r]?.h ?? DEFAULT_ROW_PX;
const sumCols = (s: PlainSheet, upTo: number) => {
  let x = 0;
  for (let c = 0; c < upTo; c++) x += colPx(s, c);
  return x;
};
const sumRows = (s: PlainSheet, upTo: number) => {
  let y = 0;
  for (let r = 0; r < upTo; r++) y += rowPx(s, r);
  return y;
};

/** The cell (and offset into it) at a pixel position. */
function cellAt(s: PlainSheet, x: number, y: number): CellAnchor {
  let column = 0;
  let left = 0;
  while (left + colPx(s, column) <= x && column < s.colCount - 1) left += colPx(s, column++);
  let row = 0;
  let top = 0;
  while (top + rowPx(s, row) <= y && row < s.rowCount - 1) top += rowPx(s, row++);
  return { column, columnOffset: Math.round(x - left), row, rowOffset: Math.round(y - top) };
}

/**
 * The pictures of a worksheet. ExcelJS gives fractional anchors (column 3.4 = 40 % into column D); the pixel box
 * follows from the sheet's column widths and row heights.
 */
export function imagesIn(book: ExcelJS.Workbook, ws: ExcelJS.Worksheet, sheet: PlainSheet): ImportedImage[] {
  const out: ImportedImage[] = [];
  for (const img of ws.getImages?.() ?? []) {
    const media = book.getImage(Number(img.imageId)) as { extension?: string; buffer?: Buffer } | undefined;
    if (!media?.buffer || !/^(png|jpe?g|gif)$/i.test(media.extension ?? '')) continue;
    const range = img.range as Any;
    const tl = range?.tl;
    if (!tl) continue;
    const col0 = Math.max(0, Number(tl.nativeCol ?? Math.floor(tl.col ?? 0)));
    const row0 = Math.max(0, Number(tl.nativeRow ?? Math.floor(tl.row ?? 0)));
    const fracC = Math.min(1, Math.max(0, (tl.col ?? col0) - col0));
    const fracR = Math.min(1, Math.max(0, (tl.row ?? row0) - row0));
    const left = sumCols(sheet, col0) + fracC * colPx(sheet, col0);
    const top = sumRows(sheet, row0) + fracR * rowPx(sheet, row0);
    let width: number;
    let height: number;
    if (range.br) {
      const bc = Math.max(0, Number(range.br.nativeCol ?? Math.floor(range.br.col ?? 0)));
      const br = Math.max(0, Number(range.br.nativeRow ?? Math.floor(range.br.row ?? 0)));
      const right = sumCols(sheet, bc) + Math.min(1, Math.max(0, (range.br.col ?? bc) - bc)) * colPx(sheet, bc);
      const bottom = sumRows(sheet, br) + Math.min(1, Math.max(0, (range.br.row ?? br) - br)) * rowPx(sheet, br);
      width = right - left;
      height = bottom - top;
    } else {
      width = Number(range.ext?.width ?? 200);
      height = Number(range.ext?.height ?? 150);
    }
    if (!(width > 2) || !(height > 2)) continue;
    const ext = /jpe?g/i.test(media.extension!) ? 'jpeg' : (media.extension!.toLowerCase() as 'png' | 'gif');
    const box = { left: Math.round(left), top: Math.round(top), width: Math.round(width), height: Math.round(height) };
    out.push({ sheetId: sheet.id, ext, data: media.buffer, from: cellAt(sheet, box.left, box.top), to: cellAt(sheet, box.left + box.width, box.top + box.height), box });
  }
  return out;
}

/**
 * The drawing plugin's state for these pictures: one image drawing per picture, anchored to its cells so it
 * follows row and column changes, with the pixel transform Univer renders from. Univer stores the state of one
 * workbook keyed by sheet id: { [sheetId]: { data: { [drawingId]: drawing }, order: [drawingId] } }.
 */
export function drawingResource(unitId: string, images: { sheetId: string; source: string; from: CellAnchor; to: CellAnchor; box: ImportedImage['box'] }[], existing?: string): string {
  const map: Record<string, { data: Record<string, Any>; order: string[] }> = (() => {
    try {
      return existing ? JSON.parse(existing) : {};
    } catch {
      return {};
    }
  })();
  images.forEach((img, i) => {
    const sub = (map[img.sheetId] ??= { data: {}, order: [] });
    if (!Array.isArray(sub.order)) sub.order = Object.keys(sub.data ?? {});
    sub.data ??= {};
    const drawingId = `img${Date.now().toString(36)}${i.toString(36)}`;
    sub.data[drawingId] = {
      unitId,
      subUnitId: img.sheetId,
      drawingId,
      drawingType: 0, // DrawingTypeEnum.DRAWING_IMAGE
      imageSourceType: 'URL',
      source: img.source,
      transform: { left: img.box.left, top: img.box.top, width: img.box.width, height: img.box.height, angle: 0 },
      sheetTransform: { from: img.from, to: img.to },
      anchorType: '1', // SheetDrawingAnchorType.Both: position and size follow the cells
    };
    sub.order.push(drawingId);
  });
  return JSON.stringify(map);
}

/** The pictures held in the drawing plugin's state ({ [sheetId]: { data, order } }). */
export function imagesOf(resource: string | undefined): StoredImage[] {
  if (!resource) return [];
  let map: Record<string, { data?: Record<string, Any> }>;
  try {
    map = JSON.parse(resource);
  } catch {
    return [];
  }
  const out: StoredImage[] = [];
  for (const [sheetId, item] of Object.entries(map ?? {}))
    for (const d of Object.values(item?.data ?? {})) {
        if (d?.drawingType !== 0 || typeof d.source !== 'string') continue;
        const t = d.transform ?? {};
        const st = d.sheetTransform ?? {};
      out.push({ sheetId, source: d.source, from: st.from ?? { column: 0, columnOffset: 0, row: 0, rowOffset: 0 }, to: st.to ?? { column: 1, columnOffset: 0, row: 1, rowOffset: 0 }, box: { left: t.left ?? 0, top: t.top ?? 0, width: t.width ?? 200, height: t.height ?? 150 } });
    }
  return out;
}

/** Pictures back into the .xlsx: anchored to their cells, the way Excel stores them. */
export function applyImages(book: ExcelJS.Workbook, sheets: Map<string, ExcelJS.Worksheet>, plain: Map<string, PlainSheet>, images: { img: StoredImage; data: Buffer; mime: string }[]) {
  for (const { img, data, mime } of images) {
    const ws = sheets.get(img.sheetId);
    const s = plain.get(img.sheetId);
    if (!ws || !s) continue;
    const extension = /jpe?g/.test(mime) ? 'jpeg' : /gif/.test(mime) ? 'gif' : 'png';
    const id = book.addImage({ buffer: data as unknown as ExcelJS.Buffer, extension });
    const frac = (a: CellAnchor, size: (i: number) => number) => ({ col: a.column + Math.min(0.999, a.columnOffset / Math.max(1, size(a.column))), row: a.row + Math.min(0.999, a.rowOffset / Math.max(1, rowPx(s, a.row))) });
    const tl = frac(img.from, (c) => colPx(s, c));
    const br = frac(img.to, (c) => colPx(s, c));
    ws.addImage(id, { tl: tl as Any, br: br as Any, editAs: 'oneCell' } as Any);
  }
}
