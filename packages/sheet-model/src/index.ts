// Spreadsheet model shared by the browser (Univer binding) and the server (XLSX/CSV import-export, seeding).
// docs/ARCHITECTURE.md §7.2 — cells are keyed by *stable* row/column ids so concurrent row/column inserts
// never shift someone else's edit onto the wrong cell.
//
// Yjs layout (all top-level containers are created by the server when the spreadsheet is created or imported;
// clients never lazily create them, so two clients can never race to replace a container):
//   Y.Map 'wb'        name, sheetOrder (string[])
//   Y.Map 'sheets'    sheetId → Y.Map {
//                        meta:  { name, tabColor?, hidden?, freeze?, gridlines?, defaultColWidth?, defaultRowHeight? }
//                        rows:  Y.Array<rowId>            (length = row count)
//                        cols:  Y.Array<colId>            (length = column count)
//                        cells: Y.Map<"rowId:colId", Cell>
//                        rowMeta: Y.Map<rowId, { h?, hd? }>
//                        colMeta: Y.Map<colId, { w?, hd? }>
//                        merges: Y.Map<mergeId, { r0, r1, c0, c1 }>   (row/col ids)
//                        values: Y.Map<"rowId:colId", { v, t }>      computed formula results, written back by clients
//                      }
// Formula results live apart from the cells so writing a result can never overwrite a formula someone
// changed concurrently (e.g. a reference shifted by a row insert). Workbooks created before `values`
// existed keep their results in `cells` (clients then fall back to writing there).
//   Y.Map 'resources' plugin name → JSON string (filters, conditional formats, data validation, hyperlinks)
//   Y.Map 'styles'    styleId → CellStyle — the shared style table (§83). A cell's `s` is the id of its style; a
//                     real workbook has ~500k styled cells but a few hundred distinct styles, so storing the style
//                     once instead of ~200 bytes per cell cuts the state by two thirds. Ids are content hashes,
//                     so two clients interning the same style write the same entry and never conflict. Workbooks
//                     from before the table still hold style objects in cells; every reader accepts both.
import * as Y from 'yjs';

export const WB_MAP = 'wb';
export const SHEETS_MAP = 'sheets';
export const RESOURCES_MAP = 'resources';
export const STYLES_MAP = 'styles';

/** Univer-compatible style object (IStyleData subset). */
export interface CellStyle {
  ff?: string; // font family
  fs?: number; // font size (pt)
  bl?: 0 | 1; // bold
  it?: 0 | 1; // italic
  ul?: { s: 0 | 1 }; // underline
  st?: { s: 0 | 1 }; // strikethrough
  cl?: { rgb: string }; // text colour
  bg?: { rgb: string }; // fill
  ht?: 0 | 1 | 2 | 3; // horizontal: 1 left, 2 center, 3 right
  vt?: 0 | 1 | 2 | 3; // vertical: 1 top, 2 middle, 3 bottom
  tb?: 1 | 2 | 3; // wrap strategy: 3 = wrap
  bd?: Partial<Record<'t' | 'b' | 'l' | 'r', { s: number; cl: { rgb: string } } | null>>;
  n?: { pattern: string } | null; // number format
  [k: string]: unknown;
}

/** Univer-compatible cell (ICellData subset). v is the value or the last computed formula result. */
export interface Cell {
  v?: string | number | boolean | null;
  t?: 1 | 2 | 3 | 4 | null; // 1 string, 2 number, 3 boolean, 4 forced text
  f?: string | null; // formula including the leading "="
  s?: CellStyle | null;
  [k: string]: unknown;
}
/** A cell as it sits in Yjs: the style is the id of an entry of the style table (or, in old workbooks, the object). */
export type StoredCell = Omit<Cell, 's'> & { s?: CellStyle | string | null };

// ── Shared style table ───────────────────────────────────────────────────────

/** Deterministic JSON: keys sorted at every level, empty / null members dropped — the identity of a style. */
export function canonicalStyle(style: CellStyle | null | undefined): CellStyle | null {
  const clean = (v: unknown): unknown => {
    if (v === null || v === undefined) return undefined;
    if (Array.isArray(v)) return v.map(clean);
    if (typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(v as object).sort()) {
        const c = clean((v as Record<string, unknown>)[k]);
        if (c !== undefined && !(typeof c === 'object' && !Array.isArray(c) && !Object.keys(c as object).length)) out[k] = c;
      }
      return out;
    }
    return v;
  };
  const out = clean(style) as CellStyle | undefined;
  return out && Object.keys(out).length ? out : null;
}

/** The id of a style: a 64-bit FNV-1a hash of its canonical JSON, base-36 — the same on the server and in the browser. */
export function styleId(style: CellStyle): string {
  const text = JSON.stringify(canonicalStyle(style) ?? {});
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x811c9dc5) >>> 0;
  }
  return `s${h1.toString(36)}${h2.toString(36)}`;
}

/** Puts a style in the table (if new) and returns its id; null for no style. Call inside a transaction when writing. */
export function internStyle(styles: Y.Map<CellStyle>, style: CellStyle | string | null | undefined): string | null {
  if (!style) return null;
  if (typeof style === 'string') return style;
  const canon = canonicalStyle(style);
  if (!canon) return null;
  const id = styleId(canon);
  if (!styles.has(id)) styles.set(id, canon);
  return id;
}

/** The style object behind a cell's `s` (an id of the table, or the object itself in old workbooks). */
export function resolveStyle(styles: Y.Map<CellStyle> | Record<string, CellStyle> | null | undefined, s: CellStyle | string | null | undefined): CellStyle | null {
  if (!s) return null;
  if (typeof s !== 'string') return s;
  const v = styles instanceof Y.Map ? styles.get(s) : styles?.[s];
  return v ?? null;
}

/** A stored cell with its style resolved to the object (shared by reference: resolving 500k cells allocates nothing). */
export function resolveCell(styles: Y.Map<CellStyle> | Record<string, CellStyle> | null | undefined, cell: StoredCell | null | undefined): Cell | null {
  if (!cell) return null;
  if (typeof cell.s !== 'string') return cell as Cell;
  const s = resolveStyle(styles, cell.s);
  return s ? { ...cell, s } : { ...cell, s: undefined };
}

/** "Same style?" for a stored and a plain cell, by id — never by the 200-byte object. */
export const styleKeyOf = (s: CellStyle | string | null | undefined): string => (!s ? '' : typeof s === 'string' ? s : styleId(s));

/** A plain cell made ready for Yjs: its style interned, the cell holding the id (call inside a transaction). */
export function toStoredCell(styles: Y.Map<CellStyle>, cell: Cell): StoredCell {
  if (!cell.s) {
    if (cell.s === null || cell.s === undefined) {
      const { s: _s, ...rest } = cell;
      return rest;
    }
    return cell as StoredCell;
  }
  const id = internStyle(styles, cell.s);
  const { s: _s, ...rest } = cell;
  return id ? { ...rest, s: id } : rest;
}

export interface RowMeta {
  h?: number;
  hd?: 0 | 1;
}
export interface ColMeta {
  w?: number;
  hd?: 0 | 1;
}

export interface SheetMeta {
  name: string;
  tabColor?: string | null;
  hidden?: 0 | 1;
  freeze?: { row: number; col: number } | null;
  gridlines?: 0 | 1;
  defaultColWidth?: number;
  defaultRowHeight?: number;
}

/** Plain, index-based workbook — what importers produce and exporters consume. */
export interface PlainSheet {
  id: string;
  meta: SheetMeta;
  rowCount: number;
  colCount: number;
  cells: Record<number, Record<number, Cell>>;
  rowMeta: Record<number, RowMeta>;
  colMeta: Record<number, ColMeta>;
  merges: { r0: number; c0: number; r1: number; c1: number }[];
}
export interface PlainWorkbook {
  name: string;
  sheets: PlainSheet[];
  resources?: Record<string, string>;
  /** Present only when read with `styles: 'table'`: the cells' `s` are then ids into this table (the Univer snapshot shape). */
  styles?: Record<string, CellStyle>;
}

export const DEFAULT_ROWS = 1000;
export const DEFAULT_COLS = 26;

let counter = 0;
/** Short, collision-resistant ids (random prefix per process + counter). */
const prefix = Math.random().toString(36).slice(2, 7);
export const newId = () => `${prefix}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;
export const cellKey = (rowId: string, colId: string) => `${rowId}:${colId}`;
export const splitKey = (k: string) => {
  const i = k.indexOf(':');
  return [k.slice(0, i), k.slice(i + 1)] as const;
};

export function emptySheet(name = 'Sheet1', rows = DEFAULT_ROWS, cols = DEFAULT_COLS): PlainSheet {
  return { id: newId(), meta: { name }, rowCount: rows, colCount: cols, cells: {}, rowMeta: {}, colMeta: {}, merges: [] };
}

export const isEmptyCell = (c: Cell | null | undefined) => !c || ((c.v === undefined || c.v === null || c.v === '') && !c.f && !c.s);

export type FormulaResult = { v: string | number | boolean | null; t?: Cell['t'] };

export interface YSheet {
  map: Y.Map<unknown>;
  values: Y.Map<FormulaResult> | null;
  meta: () => SheetMeta;
  rows: Y.Array<string>;
  cols: Y.Array<string>;
  cells: Y.Map<StoredCell>;
  rowMeta: Y.Map<RowMeta>;
  colMeta: Y.Map<ColMeta>;
  merges: Y.Map<{ r0: string; r1: string; c0: string; c1: string }>;
}

export function ySheet(map: Y.Map<unknown>): YSheet {
  return {
    map,
    values: (map.get('values') as Y.Map<FormulaResult> | undefined) ?? null,
    meta: () => (map.get('meta') as SheetMeta) ?? { name: 'Sheet' },
    rows: map.get('rows') as Y.Array<string>,
    cols: map.get('cols') as Y.Array<string>,
    cells: map.get('cells') as Y.Map<StoredCell>,
    rowMeta: map.get('rowMeta') as Y.Map<RowMeta>,
    colMeta: map.get('colMeta') as Y.Map<ColMeta>,
    merges: map.get('merges') as Y.Map<{ r0: string; r1: string; c0: string; c1: string }>,
  };
}

/** The workbook's style table (created on first use: workbooks from before §83 have none). */
export function yStyles(doc: Y.Doc): Y.Map<CellStyle> {
  return doc.getMap<CellStyle>(STYLES_MAP);
}

/**
 * Builds the Yjs containers for one sheet (call inside a transaction). With a style table, cell styles are
 * interned into it and the cells hold ids; without one (tests, old callers) the objects are stored as they are.
 */
export function createYSheet(s: PlainSheet, styles?: Y.Map<CellStyle>): Y.Map<unknown> {
  const m = new Y.Map<unknown>();
  const rowIds = Array.from({ length: s.rowCount }, newId);
  const colIds = Array.from({ length: s.colCount }, newId);
  const rows = new Y.Array<string>();
  rows.push(rowIds);
  const cols = new Y.Array<string>();
  cols.push(colIds);
  const cells = new Y.Map<StoredCell>();
  // Importers build a fresh style object per cell, most of them equal: the id is looked up by the raw JSON (one
  // stringify) and only a new JSON is canonicalised and hashed — a 480k-cell workbook has a few hundred of them.
  const seen = new Map<string, string | null>();
  for (const [r, row] of Object.entries(s.cells)) {
    for (const [c, cell] of Object.entries(row)) {
      const ri = Number(r);
      const ci = Number(c);
      if (ri >= s.rowCount || ci >= s.colCount || isEmptyCell(cell)) continue;
      if (styles && cell.s && typeof cell.s === 'object') {
        const raw = JSON.stringify(cell.s);
        let id = seen.get(raw);
        if (id === undefined) (id = internStyle(styles, cell.s)), seen.set(raw, id);
        const { s: _s, ...rest } = cell;
        cells.set(cellKey(rowIds[ri], colIds[ci]), id ? { ...rest, s: id } : rest);
      } else cells.set(cellKey(rowIds[ri], colIds[ci]), cell);
    }
  }
  const rowMeta = new Y.Map<RowMeta>();
  for (const [r, v] of Object.entries(s.rowMeta)) if (Number(r) < s.rowCount) rowMeta.set(rowIds[Number(r)], v);
  const colMeta = new Y.Map<ColMeta>();
  for (const [c, v] of Object.entries(s.colMeta)) if (Number(c) < s.colCount) colMeta.set(colIds[Number(c)], v);
  const merges = new Y.Map<{ r0: string; r1: string; c0: string; c1: string }>();
  for (const g of s.merges) {
    if (g.r1 < s.rowCount && g.c1 < s.colCount) merges.set(newId(), { r0: rowIds[g.r0], r1: rowIds[g.r1], c0: colIds[g.c0], c1: colIds[g.c1] });
  }
  m.set('meta', s.meta);
  m.set('rows', rows);
  m.set('cols', cols);
  m.set('cells', cells);
  m.set('rowMeta', rowMeta);
  m.set('colMeta', colMeta);
  m.set('merges', merges);
  m.set('values', new Y.Map<FormulaResult>());
  return m;
}

/** Writes a whole workbook into an empty Y.Doc (server: create / import / seed). */
export function writeWorkbook(doc: Y.Doc, wb: PlainWorkbook) {
  doc.transact(() => {
    const meta = doc.getMap(WB_MAP);
    const sheets = doc.getMap(SHEETS_MAP);
    const styles = yStyles(doc);
    // A workbook read with its table: the ids are kept and the table copied as it is.
    for (const [id, st] of Object.entries(wb.styles ?? {})) if (!styles.has(id)) styles.set(id, st);
    for (const s of wb.sheets) sheets.set(s.id, createYSheet(s, styles));
    meta.set('name', wb.name);
    meta.set('sheetOrder', wb.sheets.map((s) => s.id));
    const res = doc.getMap<string>(RESOURCES_MAP);
    for (const [k, v] of Object.entries(wb.resources ?? {})) res.set(k, v);
  });
}

export function hasWorkbook(doc: Y.Doc) {
  return ((doc.getMap(WB_MAP).get('sheetOrder') as string[] | undefined)?.length ?? 0) > 0;
}

/**
 * Reads the Yjs state back into index-based form (server export, client initial load). Styles come back as
 * objects (one shared object per distinct style — resolving costs nothing); with `styles: 'table'` the cells keep
 * their ids and the table is returned beside them, which is the shape Univer loads directly.
 */
export function readWorkbook(doc: Y.Doc, opts: { styles?: 'resolve' | 'table' } = {}): PlainWorkbook {
  const meta = doc.getMap(WB_MAP);
  const sheets = doc.getMap(SHEETS_MAP);
  const styles = yStyles(doc);
  const table = opts.styles === 'table';
  const order = ((meta.get('sheetOrder') as string[]) ?? []).filter((id) => sheets.has(id));
  const out: PlainWorkbook = { name: (meta.get('name') as string) ?? 'Workbook', sheets: [], resources: doc.getMap<string>(RESOURCES_MAP).toJSON() as Record<string, string> };
  if (table) out.styles = styles.toJSON() as Record<string, CellStyle>;
  for (const id of order) {
    const ys = ySheet(sheets.get(id) as Y.Map<unknown>);
    const rowIds = ys.rows.toArray();
    const colIds = ys.cols.toArray();
    const ri = new Map(rowIds.map((r, i) => [r, i]));
    const ci = new Map(colIds.map((c, i) => [c, i]));
    const cells: PlainSheet['cells'] = {};
    ys.cells.forEach((stored, key) => {
      const [r, c] = splitKey(key);
      const rIdx = ri.get(r);
      const cIdx = ci.get(c);
      if (rIdx === undefined || cIdx === undefined) return; // orphan of a deleted row/col
      const cell = (table ? stored : resolveCell(styles, stored)) as Cell;
      const result = cell.f ? ys.values?.get(key) : undefined;
      (cells[rIdx] ??= {})[cIdx] = result ? { ...cell, v: result.v, ...(result.t ? { t: result.t } : {}) } : cell;
    });
    const rowMeta: PlainSheet['rowMeta'] = {};
    ys.rowMeta.forEach((v, r) => ri.has(r) && (rowMeta[ri.get(r)!] = v));
    const colMeta: PlainSheet['colMeta'] = {};
    ys.colMeta.forEach((v, c) => ci.has(c) && (colMeta[ci.get(c)!] = v));
    const merges: PlainSheet['merges'] = [];
    ys.merges.forEach((g) => {
      const r0 = ri.get(g.r0);
      const r1 = ri.get(g.r1);
      const c0 = ci.get(g.c0);
      const c1 = ci.get(g.c1);
      if (r0 !== undefined && r1 !== undefined && c0 !== undefined && c1 !== undefined) merges.push({ r0, r1, c0, c1 });
    });
    out.sheets.push({ id, meta: ys.meta(), rowCount: rowIds.length, colCount: colIds.length, cells, rowMeta, colMeta, merges });
  }
  return out;
}

// ── Helpers shared by importers/exporters ────────────────────────────────────

export function colName(i: number): string {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

/** Used range: last row/col that holds data (0-based, -1 when empty). */
export function usedRange(s: PlainSheet) {
  let maxR = -1;
  let maxC = -1;
  for (const [r, row] of Object.entries(s.cells)) {
    for (const [c, cell] of Object.entries(row)) {
      if (isEmptyCell(cell) && !cell.s) continue;
      maxR = Math.max(maxR, Number(r));
      maxC = Math.max(maxC, Number(c));
    }
  }
  return { maxR, maxC };
}

/** The cell value with its type applied (Univer stores booleans as 1/0 with t = 3). */
export function cellValue(c: Cell | undefined): string | number | boolean | null {
  if (!c || c.v === null || c.v === undefined) return null;
  if (c.t === 3) return c.v === true || c.v === 1 || c.v === 'TRUE' || c.v === '1';
  return c.v;
}

/** Display text of a cell value (no number formatting). */
export function cellText(c: Cell | undefined): string {
  const v = cellValue(c);
  if (v === null) return '';
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  return String(v);
}

/**
 * What a save needs to know about a workbook — its sheet count and the text for search — read straight from the
 * Y.Doc, stopping at the text limit. Saves run every few seconds while people type; materialising a 500k-cell
 * workbook for each would block the server.
 */
export function workbookSummary(doc: Y.Doc, limit = 200_000): { sheetCount: number; text: string } {
  const sheets = doc.getMap(SHEETS_MAP);
  const order = ((doc.getMap(WB_MAP).get('sheetOrder') as string[]) ?? []).filter((id) => sheets.has(id));
  const parts: string[] = [];
  let size = 0;
  outer: for (const id of order) {
    const ys = ySheet(sheets.get(id) as Y.Map<unknown>);
    parts.push(ys.meta().name);
    for (const [key, cell] of ys.cells.entries()) {
      const result = cell.f ? ys.values?.get(key) : undefined;
      const t = cellText(result ? { v: result.v, t: result.t ?? (cell.t as Cell['t']) } : (cell as Cell));
      if (!t) continue;
      parts.push(t);
      size += t.length;
      if (size > limit) break outer;
    }
  }
  return { sheetCount: order.length, text: parts.join(' ') };
}

/** Plain text of the whole workbook — used for search indexing. */
export function workbookText(wb: PlainWorkbook, limit = 200_000): string {
  const parts: string[] = [];
  let size = 0;
  for (const s of wb.sheets) {
    parts.push(s.meta.name);
    for (const row of Object.values(s.cells)) {
      for (const cell of Object.values(row)) {
        const t = cellText(cell);
        if (!t) continue;
        parts.push(t);
        size += t.length;
        if (size > limit) return parts.join(' ');
      }
    }
  }
  return parts.join(' ');
}
export * from './format';
export * from './charts';
export * from './pivots';
export * from './templates';
export * from './macro-runtime';
