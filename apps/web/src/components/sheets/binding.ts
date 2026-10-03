// Yjs ⇄ Univer binding (docs/ARCHITECTURE.md §22).
//
// Univer is the grid, UI and formula engine; the Y.Doc (layout in packages/sheet-model) is the source of truth.
//  • Local → Yjs: every Univer mutation that is not from us is translated after it ran. Cell mutations mark
//    ranges dirty and the cells are re-read from Univer (so styles, formulas and shared formulas come out
//    fully resolved); row/column structure is replayed on the Y.Arrays of stable row/column ids.
//  • Yjs → Univer: remote transactions are replayed as Univer mutations with { fromCollab }, which keeps
//    them out of the local undo stack and out of our own listener while the formula engine still recalculates.
//  • Rare whole-workbook changes (sheets added/removed/reordered remotely, plugin resources such as filters,
//    conditional formats and validation, version restore) reload the workbook from the Y.Doc.
import {
  cellKey,
  RESOURCES_MAP,
  readWorkbook,
  SHEETS_MAP,
  splitKey,
  WB_MAP,
  ySheet,
  newId,
  type Cell,
  type ColMeta,
  type PlainSheet,
  type PlainWorkbook,
  type RowMeta,
  type SheetMeta,
} from '@workos/sheet-model';
import * as Y from 'yjs';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;
export type UniverAPI = Any;

const ORIGIN = 'univer-binding';
const MUTATION = 2; // CommandType.MUTATION
const CALC_RESULT = 'formula.mutation.set-formula-calculation-result';

interface IRange {
  startRow: number;
  endRow: number;
  startColumn: number;
  endColumn: number;
}

// ── Plain workbook ⇄ Univer snapshot ─────────────────────────────────────────

export function toUniverSheet(s: PlainSheet) {
  const cellData: Record<number, Record<number, Cell>> = {};
  for (const [r, row] of Object.entries(s.cells)) {
    for (const [c, cell] of Object.entries(row)) {
      // Formulas are recomputed by the engine on open; stale cached results are kept only as a first paint.
      (cellData[Number(r)] ??= {})[Number(c)] = { ...cell };
    }
  }
  const rowData: Record<number, Any> = {};
  for (const [r, m] of Object.entries(s.rowMeta)) rowData[Number(r)] = { ...(m.h ? { h: m.h, ia: 0 } : {}), ...(m.hd ? { hd: 1 } : {}) };
  const columnData: Record<number, Any> = {};
  for (const [c, m] of Object.entries(s.colMeta)) columnData[Number(c)] = { ...(m.w ? { w: m.w } : {}), ...(m.hd ? { hd: 1 } : {}) };
  const f = s.meta.freeze;
  return {
    id: s.id,
    name: s.meta.name,
    tabColor: s.meta.tabColor ?? '',
    hidden: s.meta.hidden ? 1 : 0,
    rowCount: s.rowCount,
    columnCount: s.colCount,
    defaultColumnWidth: s.meta.defaultColWidth ?? 88,
    defaultRowHeight: s.meta.defaultRowHeight ?? 24,
    showGridlines: s.meta.gridlines === 0 ? 0 : 1,
    freeze: f && (f.row || f.col) ? { xSplit: f.col, ySplit: f.row, startRow: f.row, startColumn: f.col } : { xSplit: 0, ySplit: 0, startRow: -1, startColumn: -1 },
    mergeData: s.merges.map((g) => ({ startRow: g.r0, endRow: g.r1, startColumn: g.c0, endColumn: g.c1 })),
    cellData,
    rowData,
    columnData,
  };
}

export function toUniverWorkbook(unitId: string, wb: PlainWorkbook) {
  const sheets: Record<string, Any> = {};
  for (const s of wb.sheets) sheets[s.id] = toUniverSheet(s);
  return {
    id: unitId,
    name: wb.name,
    appVersion: '1.0.3',
    locale: 'enUS',
    styles: {},
    sheetOrder: wb.sheets.map((s) => s.id),
    sheets,
    resources: Object.entries(wb.resources ?? {}).map(([name, data]) => ({ name, data })),
  };
}

// ── Binding ──────────────────────────────────────────────────────────────────

interface Mirror {
  rows: string[];
  cols: string[];
  rowIdx: Map<string, number>;
  colIdx: Map<string, number>;
}

interface Dirty {
  cells: Map<string, IRange[]>; // sheetId → ranges to re-read
  rowMeta: Map<string, Set<number>>;
  colMeta: Map<string, Set<number>>;
  merges: Set<string>;
  meta: Set<string>;
  order: boolean;
  resources: boolean;
}

const emptyDirty = (): Dirty => ({ cells: new Map(), rowMeta: new Map(), colMeta: new Map(), merges: new Set(), meta: new Set(), order: false, resources: false });

const sameJSON = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Cell as stored in Yjs: only meaningful keys, style resolved to an object, empty → null. */
function normalize(raw: Any, formula: string, styles: Any): Cell | null {
  if (!raw && !formula) return null;
  const out: Cell = {};
  let v = raw?.v;
  if ((v === undefined || v === null || v === '') && raw?.p?.body?.dataStream) v = String(raw.p.body.dataStream).replace(/\r?\n$/, '').replace(/\r\n$/, '');
  if (v !== undefined && v !== null && v !== '') {
    out.v = v;
    if (raw?.t) out.t = raw.t;
  }
  if (formula) out.f = formula;
  const s = typeof raw?.s === 'string' ? styles?.get?.(raw.s) : raw?.s;
  if (s && Object.keys(s).length) out.s = JSON.parse(JSON.stringify(s));
  return Object.keys(out).length ? out : null;
}

export class SheetBinding {
  private mirrors = new Map<string, Mirror>();
  private dirty = emptyDirty();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private resultsTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingResults = new Map<string, Map<string, { v: Cell['v']; t?: Cell['t'] }>>(); // sheetId → key → result
  private applying = 0;
  private disposers: (() => void)[] = [];
  private destroyed = false;

  constructor(
    private readonly api: UniverAPI,
    private readonly doc: Y.Doc,
    readonly unitId: string,
    private readonly opts: {
      editable: boolean;
      onReload?: () => void;
      onError?: (e: unknown) => void;
      /** Univer's resource manager: lets one plugin's state be reloaded without rebuilding the workbook. */
      resources?: { getAllResourceHooks(): { pluginName: string; toJson(unitId: string): string; parseJson(s: string): unknown; onLoad(unitId: string, model: unknown): void; onUnLoad(unitId: string): void }[] };
    },
  ) {}

  // ── setup ──

  /** Builds the workbook from the Y.Doc and starts syncing both ways. */
  start() {
    this.createUnit();
    const sub = this.api.addEvent(this.api.Event.CommandExecuted, (e: Any) => this.onCommand(e));
    this.disposers.push(() => sub.dispose());
    const handler = (events: Y.YEvent<Any>[], tr: Y.Transaction) => {
      if (tr.origin === ORIGIN) return this.rebuildMirrors();
      this.onRemote(events);
    };
    const sheets = this.doc.getMap(SHEETS_MAP);
    const wb = this.doc.getMap(WB_MAP);
    const res = this.doc.getMap(RESOURCES_MAP);
    sheets.observeDeep(handler);
    wb.observeDeep(handler);
    res.observeDeep(handler);
    this.disposers.push(() => {
      sheets.unobserveDeep(handler);
      wb.unobserveDeep(handler);
      res.unobserveDeep(handler);
    });
  }

  destroy() {
    this.destroyed = true;
    if (this.flushTimer) clearTimeout(this.flushTimer);
    if (this.resultsTimer) clearTimeout(this.resultsTimer);
    this.disposers.forEach((d) => d());
  }

  private workbook() {
    return this.api.getWorkbook(this.unitId);
  }

  private createUnit(activeSheetId?: string) {
    const plain = readWorkbook(this.doc);
    this.rebuildMirrors();
    this.applying++;
    try {
      const fwb = this.api.createWorkbook(toUniverWorkbook(this.unitId, plain));
      if (activeSheetId && plain.sheets.some((s) => s.id === activeSheetId)) fwb.setActiveSheet?.(fwb.getSheetBySheetId(activeSheetId));
      if (!this.opts.editable) fwb.setEditable?.(false);
    } finally {
      this.applying--;
    }
  }

  /** Recreates the Univer unit from the Y.Doc (remote sheet structure changes, resources, restore). */
  reload() {
    const active = this.workbook()?.getActiveSheet?.()?.getSheetId?.();
    this.applying++;
    try {
      this.api.disposeUnit(this.unitId);
    } finally {
      this.applying--;
    }
    this.createUnit(active);
    this.opts.onReload?.();
  }

  private rebuildMirrors() {
    const sheets = this.doc.getMap(SHEETS_MAP);
    this.mirrors.clear();
    sheets.forEach((m, id) => {
      const ys = ySheet(m as Y.Map<unknown>);
      const rows = ys.rows.toArray();
      const cols = ys.cols.toArray();
      this.mirrors.set(id, { rows, cols, rowIdx: new Map(rows.map((r, i) => [r, i])), colIdx: new Map(cols.map((c, i) => [c, i])) });
    });
  }

  private ysheet(sheetId: string) {
    const m = this.doc.getMap(SHEETS_MAP).get(sheetId) as Y.Map<unknown> | undefined;
    return m ? ySheet(m) : null;
  }

  // ── Univer → Yjs ──

  private onCommand(e: Any) {
    if (this.destroyed || this.applying) return;
    const p = e.params ?? {};
    if (e.id === CALC_RESULT) return this.onResults(p);
    if (e.type !== MUTATION || e.options?.fromCollab || e.options?.onlyLocal) return; // onlyLocal: Univer-internal bookkeeping
    if (p.unitId && p.unitId !== this.unitId) return;
    if (!this.opts.editable) return;
    try {
      this.translate(e.id, p);
    } catch (err) {
      this.opts.onError?.(err);
    }
  }

  private markCells(sheetId: string, range: IRange) {
    const list = this.dirty.cells.get(sheetId) ?? [];
    list.push(range);
    this.dirty.cells.set(sheetId, list);
  }
  private markRows(sheetId: string, rows: Iterable<number>) {
    const set = this.dirty.rowMeta.get(sheetId) ?? new Set<number>();
    for (const r of rows) set.add(r);
    this.dirty.rowMeta.set(sheetId, set);
  }
  private markCols(sheetId: string, cols: Iterable<number>) {
    const set = this.dirty.colMeta.get(sheetId) ?? new Set<number>();
    for (const c of cols) set.add(c);
    this.dirty.colMeta.set(sheetId, set);
  }
  private scheduleFlush() {
    if (!this.flushTimer) this.flushTimer = setTimeout(() => this.flush(), 0);
  }

  private uSheet(sheetId: string) {
    return this.workbook()?.getSheetBySheetId(sheetId);
  }

  private matrixRanges(sheetId: string, matrix: Any) {
    for (const [r, row] of Object.entries(matrix ?? {})) {
      const cols = Object.keys(row as object).map(Number);
      if (!cols.length) continue;
      this.markCells(sheetId, { startRow: Number(r), endRow: Number(r), startColumn: Math.min(...cols), endColumn: Math.max(...cols) });
    }
  }

  private indexRange = (from: number, to: number) => Array.from({ length: Math.max(0, to - from + 1) }, (_, i) => from + i);

  /** Structural changes are applied to Yjs immediately (indices refer to the state right after this mutation). */
  private translate(id: string, p: Any) {
    const sid: string = p.subUnitId;
    const ys = sid ? this.ysheet(sid) : null;
    const rangesOf = (): IRange[] => (p.ranges ?? (p.range ? [p.range] : [])) as IRange[];
    switch (id) {
      case 'sheet.mutation.set-range-values':
        this.matrixRanges(sid, p.cellValue);
        break;
      case 'sheet.mutation.set.numfmt':
        for (const v of Object.values(p.values ?? {}) as Any[]) for (const r of v.ranges ?? []) this.markCells(sid, r);
        break;
      case 'sheet.mutation.remove.numfmt':
      case 'sheet.mutation.reorder-range':
        for (const r of rangesOf()) this.markCells(sid, r);
        break;
      case 'sheet.mutation.move-range':
        this.matrixRanges(p.from?.subUnitId ?? sid, p.from?.value);
        this.matrixRanges(p.to?.subUnitId ?? sid, p.to?.value);
        break;
      case 'sheet.mutation.insert-range':
      case 'sheet.mutation.delete-range': {
        // Shifting cells: everything right of / below the range moves.
        const ws = this.uSheet(sid)?.getSheet();
        const r = p.range as IRange;
        if (p.shiftDimension === 0) this.markCells(sid, { startRow: r.startRow, endRow: ws?.getRowCount() - 1, startColumn: r.startColumn, endColumn: r.endColumn });
        else this.markCells(sid, { startRow: r.startRow, endRow: r.endRow, startColumn: r.startColumn, endColumn: ws?.getColumnCount() - 1 });
        break;
      }
      case 'sheet.mutation.insert-row':
      case 'sheet.mutation.insert-col': {
        if (!ys) break;
        const row = id === 'sheet.mutation.insert-row';
        const r = p.range as IRange;
        const start = row ? r.startRow : r.startColumn;
        const n = (row ? r.endRow : r.endColumn) - start + 1;
        this.doc.transact(() => (row ? ys.rows : ys.cols).insert(start, Array.from({ length: n }, newId)), ORIGIN);
        if (row) {
          this.markRows(sid, this.indexRange(r.startRow, r.endRow));
          this.markCells(sid, { startRow: r.startRow, endRow: r.endRow, startColumn: 0, endColumn: ys.cols.length - 1 });
        } else {
          this.markCols(sid, this.indexRange(r.startColumn, r.endColumn));
          this.markCells(sid, { startRow: 0, endRow: ys.rows.length - 1, startColumn: r.startColumn, endColumn: r.endColumn });
        }
        break;
      }
      case 'sheet.mutation.remove-rows':
      case 'sheet.mutation.remove-col': {
        if (!ys) break;
        const row = id === 'sheet.mutation.remove-rows';
        const r = p.range as IRange;
        const start = row ? r.startRow : r.startColumn;
        const n = (row ? r.endRow : r.endColumn) - start + 1;
        const arr = row ? ys.rows : ys.cols;
        const gone = new Set(arr.slice(start, start + n));
        this.doc.transact(() => {
          arr.delete(start, n);
          // Drop the cells and metadata of removed rows/columns so they don't linger as orphans.
          for (const key of [...ys.cells.keys()]) {
            const [ri, ci] = splitKey(key);
            if (gone.has(row ? ri : ci)) ys.cells.delete(key);
          }
          const meta = row ? ys.rowMeta : ys.colMeta;
          for (const idd of gone) meta.delete(idd);
        }, ORIGIN);
        this.dirty.merges.add(sid);
        break;
      }
      case 'sheet.mutation.move-rows':
      case 'sheet.mutation.move-columns': {
        if (!ys) break;
        const row = id === 'sheet.mutation.move-rows';
        const s = p.sourceRange as IRange;
        const t = p.targetRange as IRange;
        const from = row ? s.startRow : s.startColumn;
        const n = (row ? s.endRow : s.endColumn) - from + 1;
        const to = row ? t.startRow : t.startColumn;
        const arr = row ? ys.rows : ys.cols;
        const ids = arr.slice(from, from + n);
        const at = to > from ? to - n : to;
        this.doc.transact(() => {
          arr.delete(from, n);
          arr.insert(at, ids);
        }, ORIGIN);
        this.dirty.merges.add(sid);
        break;
      }
      case 'sheet.mutation.set-worksheet-row-height':
      case 'sheet.mutation.set-worksheet-row-is-auto-height':
      case 'sheet.mutation.set-row-hidden':
      case 'sheet.mutation.set-row-visible':
        for (const r of rangesOf()) this.markRows(sid, this.indexRange(r.startRow, r.endRow));
        break;
      case 'sheet.mutation.set-worksheet-row-auto-height':
        this.markRows(sid, ((p.rowsAutoHeightInfo ?? []) as Any[]).map((x) => x.row));
        break;
      case 'sheet.mutation.set-row-data':
        this.markRows(sid, Object.keys(p.rowData ?? {}).map(Number));
        break;
      case 'sheet.mutation.set-worksheet-col-width':
      case 'sheet.mutation.set-col-hidden':
      case 'sheet.mutation.set-col-visible':
        for (const r of rangesOf()) this.markCols(sid, this.indexRange(r.startColumn, r.endColumn));
        break;
      case 'sheet.mutation.set-col-data':
        this.markCols(sid, Object.keys(p.columnData ?? {}).map(Number));
        break;
      case 'sheet.mutation.add-worksheet-merge':
      case 'sheet.mutation.remove-worksheet-merge':
        this.dirty.merges.add(sid);
        break;
      case 'sheet.mutation.set-worksheet-name':
      case 'sheet.mutation.set-tab-color':
      case 'sheet.mutation.set-worksheet-hidden':
      case 'sheet.mutation.toggle-gridlines':
      case 'sheet.mutation.set-frozen':
        this.dirty.meta.add(sid);
        break;
      case 'sheet.mutation.set-worksheet-row-count':
      case 'sheet.mutation.set-worksheet-column-count':
        this.dirty.meta.add(sid); // lengths are reconciled in flush
        break;
      case 'sheet.mutation.insert-sheet':
        this.insertSheet(p.sheet);
        break;
      case 'sheet.mutation.remove-sheet':
        this.doc.transact(() => {
          this.doc.getMap(SHEETS_MAP).delete(sid);
          this.writeOrder();
        }, ORIGIN);
        break;
      case 'sheet.mutation.set-worksheet-order':
        this.dirty.order = true;
        break;
      default:
        // Plugin state (filters, conditional formats, data validation, hyperlinks, protection, notes, comments,
        // drawings, tables) is synced as resources.
        if (/filter|conditional|data-validation|hyper-link|protection|range-theme|note|comment|drawing|table/i.test(id)) this.dirty.resources = true;
        else return;
    }
    this.scheduleFlush();
  }

  private insertSheet(data: Any) {
    const id: string = data.id;
    const rows = Array.from({ length: data.rowCount ?? 1000 }, newId);
    const cols = Array.from({ length: data.columnCount ?? 26 }, newId);
    this.doc.transact(() => {
      const m = new Y.Map<unknown>();
      const ra = new Y.Array<string>();
      ra.push(rows);
      const ca = new Y.Array<string>();
      ca.push(cols);
      m.set('meta', { name: data.name ?? 'Sheet' } satisfies SheetMeta);
      m.set('rows', ra);
      m.set('cols', ca);
      m.set('cells', new Y.Map());
      m.set('rowMeta', new Y.Map());
      m.set('colMeta', new Y.Map());
      m.set('merges', new Y.Map());
      this.doc.getMap(SHEETS_MAP).set(id, m);
      this.writeOrder();
    }, ORIGIN);
    this.rebuildMirrors();
    // Copied sheets arrive with content: read everything back once the unit has it.
    this.markCells(id, { startRow: 0, endRow: rows.length - 1, startColumn: 0, endColumn: cols.length - 1 });
    this.markRows(id, Object.keys(data.rowData ?? {}).map(Number));
    this.markCols(id, Object.keys(data.columnData ?? {}).map(Number));
    this.dirty.merges.add(id);
    this.dirty.meta.add(id);
  }

  private writeOrder() {
    const order: string[] = this.workbook()?.getSheets().map((s: Any) => s.getSheetId()) ?? [];
    const wb = this.doc.getMap(WB_MAP);
    const present = order.filter((id) => this.doc.getMap(SHEETS_MAP).has(id));
    if (!sameJSON(wb.get('sheetOrder'), present)) wb.set('sheetOrder', present);
  }

  private flush() {
    this.flushTimer = null;
    if (this.destroyed) return;
    const d = this.dirty;
    this.dirty = emptyDirty();
    const fwb = this.workbook();
    if (!fwb) return;
    const styles = fwb.getWorkbook?.().getStyles?.();
    try {
      this.doc.transact(() => {
        // Row/column counts first so ids exist for every index we write.
        for (const sid of d.meta) this.reconcileLengths(sid);
        for (const [sid, ranges] of d.cells) this.writeCells(sid, ranges, styles);
        for (const [sid, rows] of d.rowMeta) this.writeRowMeta(sid, rows);
        for (const [sid, cols] of d.colMeta) this.writeColMeta(sid, cols);
        for (const sid of d.merges) this.writeMerges(sid);
        for (const sid of d.meta) this.writeMeta(sid);
        if (d.order) this.writeOrder();
        if (d.resources) this.writeResources();
      }, ORIGIN);
    } catch (err) {
      this.opts.onError?.(err);
    }
  }

  private reconcileLengths(sid: string) {
    const ys = this.ysheet(sid);
    const ws = this.uSheet(sid)?.getSheet();
    if (!ys || !ws) return;
    const fix = (arr: Y.Array<string>, want: number) => {
      if (arr.length < want) arr.push(Array.from({ length: want - arr.length }, newId));
      else if (arr.length > want) arr.delete(want, arr.length - want);
    };
    fix(ys.rows, ws.getRowCount());
    fix(ys.cols, ws.getColumnCount());
  }

  private writeCells(sid: string, ranges: IRange[], styles: Any) {
    const ys = this.ysheet(sid);
    const fws = this.uSheet(sid);
    if (!ys || !fws) return;
    const ws = fws.getSheet();
    const rows = ys.rows.toArray();
    const cols = ys.cols.toArray();
    const done = new Set<string>();
    for (const r0 of ranges) {
      const rs = Math.max(0, r0.startRow);
      const re = Math.min(rows.length - 1, r0.endRow);
      const cs = Math.max(0, r0.startColumn);
      const ce = Math.min(cols.length - 1, r0.endColumn);
      if (re < rs || ce < cs) continue;
      const formulas: string[][] = fws.getRange(rs, cs, re - rs + 1, ce - cs + 1).getFormulas();
      for (let r = rs; r <= re; r++) {
        for (let c = cs; c <= ce; c++) {
          const key = cellKey(rows[r], cols[c]);
          if (done.has(key)) continue;
          done.add(key);
          const next = normalize(ws.getCellRaw(r, c), formulas[r - rs]?.[c - cs] ?? '', styles);
          const prev = ys.cells.get(key);
          if (!next) {
            if (prev) ys.cells.delete(key);
          } else if (!sameJSON(prev, next)) ys.cells.set(key, next);
        }
      }
    }
  }

  private writeRowMeta(sid: string, rowsIdx: Set<number>) {
    const ys = this.ysheet(sid);
    const ws = this.uSheet(sid)?.getSheet();
    if (!ys || !ws) return;
    const rows = ys.rows.toArray();
    const def = ws.getConfig().defaultRowHeight;
    for (const r of rowsIdx) {
      if (r >= rows.length) continue;
      const raw = ws.getRowManager().getRow(r) ?? {};
      const meta: RowMeta = {};
      // Only explicit (non-auto) heights are stored; auto heights are recomputed by each client.
      if (raw.h && raw.h !== def && raw.ia === 0) meta.h = raw.h;
      if (raw.hd) meta.hd = 1;
      const prev = ys.rowMeta.get(rows[r]);
      if (!Object.keys(meta).length) prev && ys.rowMeta.delete(rows[r]);
      else if (!sameJSON(prev, meta)) ys.rowMeta.set(rows[r], meta);
    }
  }

  private writeColMeta(sid: string, colsIdx: Set<number>) {
    const ys = this.ysheet(sid);
    const ws = this.uSheet(sid)?.getSheet();
    if (!ys || !ws) return;
    const cols = ys.cols.toArray();
    const def = ws.getConfig().defaultColumnWidth;
    for (const c of colsIdx) {
      if (c >= cols.length) continue;
      const raw = ws.getColumnManager().getColumn(c) ?? {};
      const meta: ColMeta = {};
      if (raw.w && raw.w !== def) meta.w = raw.w;
      if (raw.hd) meta.hd = 1;
      const prev = ys.colMeta.get(cols[c]);
      if (!Object.keys(meta).length) prev && ys.colMeta.delete(cols[c]);
      else if (!sameJSON(prev, meta)) ys.colMeta.set(cols[c], meta);
    }
  }

  private writeMerges(sid: string) {
    const ys = this.ysheet(sid);
    const ws = this.uSheet(sid)?.getSheet();
    if (!ys || !ws) return;
    const rows = ys.rows.toArray();
    const cols = ys.cols.toArray();
    const want = new Map<string, { r0: string; r1: string; c0: string; c1: string }>();
    for (const m of ws.getMergeData() as IRange[]) {
      const g = { r0: rows[m.startRow], r1: rows[m.endRow], c0: cols[m.startColumn], c1: cols[m.endColumn] };
      if (g.r0 && g.r1 && g.c0 && g.c1) want.set(`${g.r0}|${g.r1}|${g.c0}|${g.c1}`, g);
    }
    ys.merges.forEach((g, id) => {
      const k = `${g.r0}|${g.r1}|${g.c0}|${g.c1}`;
      if (want.has(k)) want.delete(k);
      else ys.merges.delete(id);
    });
    for (const g of want.values()) ys.merges.set(newId(), g);
  }

  private writeMeta(sid: string) {
    const ys = this.ysheet(sid);
    const ws = this.uSheet(sid)?.getSheet();
    if (!ys || !ws) return;
    const cfg = ws.getConfig();
    const prev = ys.meta();
    const freeze = cfg.freeze && (cfg.freeze.xSplit || cfg.freeze.ySplit) ? { row: cfg.freeze.ySplit, col: cfg.freeze.xSplit } : null;
    const next: SheetMeta = {
      ...prev,
      name: cfg.name,
      tabColor: cfg.tabColor || null,
      hidden: cfg.hidden ? 1 : 0,
      freeze,
      gridlines: cfg.showGridlines === 0 ? 0 : 1,
    };
    if (!sameJSON(prev, next)) ys.map.set('meta', next);
  }

  private writeResources() {
    const snap = this.workbook()?.save?.();
    const res = this.doc.getMap<string>(RESOURCES_MAP);
    for (const r of (snap?.resources ?? []) as { name: string; data: string }[]) {
      if (res.get(r.name) !== r.data) res.set(r.name, r.data);
    }
  }

  // Formula results are written back (debounced) so exports, search and previews see current values.
  private onResults(p: Any) {
    if (!this.opts.editable) return;
    const unit = p.unitData?.[this.unitId];
    if (!unit) return;
    for (const [sid, matrix] of Object.entries(unit as Record<string, Any>)) {
      const m = this.mirrors.get(sid);
      if (!m) continue;
      const pending = this.pendingResults.get(sid) ?? new Map();
      for (const [r, row] of Object.entries(matrix ?? {})) {
        for (const [c, cell] of Object.entries(row as Record<string, Any>)) {
          const rid = m.rows[Number(r)];
          const cid = m.cols[Number(c)];
          if (rid && cid) pending.set(cellKey(rid, cid), { v: cell?.v ?? null, t: cell?.t });
        }
      }
      this.pendingResults.set(sid, pending);
    }
    if (this.resultsTimer) clearTimeout(this.resultsTimer);
    this.resultsTimer = setTimeout(() => this.writeResults(), 400);
  }

  private writeResults() {
    this.resultsTimer = null;
    const all = this.pendingResults;
    this.pendingResults = new Map();
    this.doc.transact(() => {
      for (const [sid, cells] of all) {
        const ys = this.ysheet(sid);
        if (!ys) continue;
        for (const [key, { v, t }] of cells) {
          const cur = ys.cells.get(key);
          if (ys.values) {
            // Only the result is written: a concurrent formula change (reference shift, retyping) is never undone.
            if (!cur?.f) continue;
            const prev = ys.values.get(key);
            if (v === null || v === undefined) prev && ys.values.delete(key);
            else if (prev?.v !== v || (t !== undefined && prev?.t !== t)) ys.values.set(key, { v, t: t ?? (typeof v === 'number' ? 2 : typeof v === 'boolean' ? 3 : 1) });
            continue;
          }
          if (!cur?.f || (cur.v === v && (t === undefined || cur.t === t))) continue;
          const next: Cell = { ...cur };
          if (v === null || v === undefined) {
            delete next.v;
            delete next.t;
          } else {
            next.v = v;
            next.t = t ?? (typeof v === 'number' ? 2 : typeof v === 'boolean' ? 3 : 1);
          }
          ys.cells.set(key, next);
        }
      }
    }, ORIGIN);
  }

  // ── Yjs → Univer ──

  private exec(id: string, params: Any) {
    // fromCollab (not onlyLocal): the formula engine must still track dependencies and recalculate,
    // while Univer skips reference rewriting and our own listener ignores the replay.
    this.api.syncExecuteCommand(id, { unitId: this.unitId, ...params }, { fromCollab: true });
  }

  /**
   * Reloads only the plugins whose state changed remotely (comments, notes, filters…), so people typing in the
   * grid are not interrupted by a workbook rebuild. Returns false when that is not possible.
   */
  private reloadResources(names: string[]): boolean {
    const hooks = this.opts.resources?.getAllResourceHooks();
    if (!hooks || !this.workbook()) return false;
    const res = this.doc.getMap<string>(RESOURCES_MAP);
    this.applying++;
    try {
      // Only plugins whose state really differs from what Univer holds (the first save writes them all).
      const changed = names.filter((name) => {
        const hook = hooks.find((h) => h.pluginName === name);
        return !hook || (res.get(name) ?? '') !== (hook.toJson(this.unitId) ?? '');
      });
      // Permission points are rebuilt with the workbook: unloading them alone breaks Univer's permission service.
      // Drawings (images, charts) are only rendered when the workbook loads: reloading the model alone draws nothing.
      if (changed.some((n) => /PROTECTION|DRAWING/.test(n) || !hooks.some((h) => h.pluginName === n))) return false;
      for (const name of changed) {
        const hook = hooks.find((h) => h.pluginName === name)!;
        hook.onUnLoad(this.unitId);
        const data = res.get(name);
        if (data) hook.onLoad(this.unitId, hook.parseJson(data));
      }
      return true;
    } catch (err) {
      this.opts.onError?.(err);
      return false;
    } finally {
      this.applying--;
    }
  }

  private onRemote(events: Y.YEvent<Any>[]) {
    if (this.destroyed) return;
    const sheetsMap = this.doc.getMap(SHEETS_MAP);
    const wbMap = this.doc.getMap(WB_MAP);
    const resMap = this.doc.getMap(RESOURCES_MAP);
    const resEvent = events.find((e) => e.target === resMap) as Y.YMapEvent<unknown> | undefined;
    if (resEvent && this.reloadResources([...resEvent.keysChanged])) {
      events = events.filter((e) => e !== resEvent);
      if (!events.length) return;
    }
    const needsReload = events.some(
      (e) =>
        e.target === sheetsMap ||
        e.target === resMap ||
        (e.target === wbMap && (e as Y.YMapEvent<unknown>).keysChanged.has('sheetOrder') && !this.orderMatches()),
    );
    if (needsReload || !this.workbook()) {
      this.reload();
      return;
    }
    this.applying++;
    try {
      // 1) rows/columns structure (delta positions are sequential against the evolving state)
      for (const e of events) {
        const sid = this.sheetIdOf(e.target);
        if (!sid || !(e.target instanceof Y.Array)) continue;
        const ys = this.ysheet(sid)!;
        const isRow = e.target === ys.rows;
        let idx = 0;
        for (const op of e.changes.delta) {
          if (op.retain) idx += op.retain;
          else if (op.insert) {
            const n = (op.insert as string[]).length;
            const range = isRow ? { startRow: idx, endRow: idx + n - 1, startColumn: 0, endColumn: ys.cols.length - 1, rangeType: 1 } : { startRow: 0, endRow: ys.rows.length - 1, startColumn: idx, endColumn: idx + n - 1, rangeType: 2 };
            this.exec(isRow ? 'sheet.mutation.insert-row' : 'sheet.mutation.insert-col', { subUnitId: sid, range });
            idx += n;
          } else if (op.delete) {
            const n = op.delete;
            const range = isRow ? { startRow: idx, endRow: idx + n - 1, startColumn: 0, endColumn: ys.cols.length - 1, rangeType: 1 } : { startRow: 0, endRow: ys.rows.length - 1, startColumn: idx, endColumn: idx + n - 1, rangeType: 2 };
            this.exec(isRow ? 'sheet.mutation.remove-rows' : 'sheet.mutation.remove-col', { subUnitId: sid, range });
          }
        }
      }
      this.rebuildMirrors();
      // 2) cells, row/column metadata, merges, sheet meta
      const cellWrites = new Map<string, Record<number, Record<number, Any>>>();
      const styles = this.workbook()?.getWorkbook?.().getStyles?.();
      for (const e of events) {
        const sid = this.sheetIdOf(e.target);
        if (!sid) continue;
        const ys = this.ysheet(sid)!;
        const m = this.mirrors.get(sid)!;
        const keys = (e as Y.YMapEvent<unknown>).keysChanged;
        if (e.target === ys.cells) {
          const fws = this.uSheet(sid);
          const matrix = cellWrites.get(sid) ?? {};
          for (const key of keys) {
            const [rid, cid] = splitKey(key);
            const r = m.rowIdx.get(rid);
            const c = m.colIdx.get(cid);
            if (r === undefined || c === undefined) continue;
            const cell = ys.cells.get(key);
            const old = (e as Y.YMapEvent<Cell>).changes.keys.get(key)?.oldValue as Cell | undefined;
            // A change that keeps the formula and style (a result written back by another client) never
            // replaces what this client has: the local engine computes the value, and a formula shifted here
            // in the meantime must survive.
            if (cell?.f && old?.f === cell.f && sameJSON(old?.s ?? null, cell.s ?? null)) continue;
            if (cell?.f && fws) {
              // A result-only update of a formula this client already has: the local engine computes it.
              const raw = fws.getSheet().getCellRaw(r, c);
              const localStyle = typeof raw?.s === 'string' ? styles?.get?.(raw.s) : raw?.s;
              if (fws.getRange(r, c).getFormula() === cell.f && sameJSON(localStyle && Object.keys(localStyle).length ? localStyle : null, cell.s ?? null)) continue;
            }
            (matrix[r] ??= {})[c] = cell ? { v: cell.v ?? null, t: cell.v === undefined ? undefined : cell.t, f: cell.f ?? null, si: null, s: cell.s ?? null, p: null } : null;
          }
          cellWrites.set(sid, matrix);
        } else if (e.target === ys.rowMeta) {
          const rowData: Record<number, Any> = {};
          for (const key of keys) {
            const r = m.rowIdx.get(key);
            if (r === undefined) continue;
            const meta = ys.rowMeta.get(key);
            rowData[r] = { h: meta?.h, ia: meta?.h ? 0 : undefined, hd: meta?.hd ? 1 : 0 };
          }
          if (Object.keys(rowData).length) this.exec('sheet.mutation.set-row-data', { subUnitId: sid, rowData });
        } else if (e.target === ys.colMeta) {
          const columnData: Record<number, Any> = {};
          const def = this.uSheet(sid)?.getSheet().getConfig().defaultColumnWidth ?? 88;
          for (const key of keys) {
            const c = m.colIdx.get(key);
            if (c === undefined) continue;
            const meta = ys.colMeta.get(key);
            columnData[c] = { w: meta?.w ?? def, hd: meta?.hd ? 1 : 0 };
          }
          if (Object.keys(columnData).length) this.exec('sheet.mutation.set-col-data', { subUnitId: sid, columnData });
        } else if (e.target === ys.merges) {
          this.applyMerges(sid);
        } else if (e.target === ys.map && keys.has('meta')) {
          this.applyMeta(sid);
        }
      }
      for (const [sid, cellValue] of cellWrites) {
        if (Object.keys(cellValue).length) this.exec('sheet.mutation.set-range-values', { subUnitId: sid, cellValue, isOverrideStyle: true });
      }
      if (events.some((e) => e.target === wbMap)) {
        const name = wbMap.get('name') as string | undefined;
        if (name && this.workbook()?.getName?.() !== name) this.workbook()?.getWorkbook?.().setName?.(name);
      }
    } catch (err) {
      this.opts.onError?.(err);
      // Something we could not replay precisely: fall back to a full reload from the Y.Doc.
      this.applying--;
      this.reload();
      return;
    }
    this.applying--;
  }

  private orderMatches() {
    const order = (this.doc.getMap(WB_MAP).get('sheetOrder') as string[]) ?? [];
    const cur: string[] = this.workbook()?.getSheets().map((s: Any) => s.getSheetId()) ?? [];
    return sameJSON(order, cur);
  }

  private sheetIdOf(target: Y.AbstractType<unknown>): string | null {
    let t: Y.AbstractType<unknown> | null = target;
    const sheets = this.doc.getMap(SHEETS_MAP);
    while (t && t._item) {
      const parent = t._item.parent as Y.AbstractType<unknown>;
      if (parent === sheets) return t._item.parentSub;
      t = parent;
    }
    return null;
  }

  private applyMerges(sid: string) {
    const ys = this.ysheet(sid)!;
    const m = this.mirrors.get(sid)!;
    const ws = this.uSheet(sid)?.getSheet();
    if (!ws) return;
    const current = (ws.getMergeData() as IRange[]).map((r) => ({ ...r }));
    const want: IRange[] = [];
    ys.merges.forEach((g) => {
      const r0 = m.rowIdx.get(g.r0);
      const r1 = m.rowIdx.get(g.r1);
      const c0 = m.colIdx.get(g.c0);
      const c1 = m.colIdx.get(g.c1);
      if (r0 !== undefined && r1 !== undefined && c0 !== undefined && c1 !== undefined) want.push({ startRow: r0, endRow: r1, startColumn: c0, endColumn: c1 });
    });
    const key = (r: IRange) => `${r.startRow}:${r.endRow}:${r.startColumn}:${r.endColumn}`;
    const wantKeys = new Set(want.map(key));
    const curKeys = new Set(current.map(key));
    const remove = current.filter((r) => !wantKeys.has(key(r)));
    const add = want.filter((r) => !curKeys.has(key(r)));
    if (remove.length) this.exec('sheet.mutation.remove-worksheet-merge', { subUnitId: sid, ranges: remove });
    if (add.length) this.exec('sheet.mutation.add-worksheet-merge', { subUnitId: sid, ranges: add });
  }

  private applyMeta(sid: string) {
    const ys = this.ysheet(sid)!;
    const ws = this.uSheet(sid)?.getSheet();
    if (!ws) return;
    const meta = ys.meta();
    const cfg = ws.getConfig();
    if (meta.name && meta.name !== cfg.name) this.exec('sheet.mutation.set-worksheet-name', { subUnitId: sid, name: meta.name });
    if ((meta.tabColor ?? '') !== (cfg.tabColor ?? '')) this.exec('sheet.mutation.set-tab-color', { subUnitId: sid, color: meta.tabColor ?? '' });
    if ((meta.hidden ? 1 : 0) !== (cfg.hidden ? 1 : 0)) this.exec('sheet.mutation.set-worksheet-hidden', { subUnitId: sid, hidden: meta.hidden ? 1 : 0 });
    if ((meta.gridlines === 0 ? 0 : 1) !== (cfg.showGridlines === 0 ? 0 : 1)) this.exec('sheet.mutation.toggle-gridlines', { subUnitId: sid, showGridlines: meta.gridlines === 0 ? 0 : 1 });
    const f = meta.freeze ?? { row: 0, col: 0 };
    if ((cfg.freeze?.ySplit ?? 0) !== f.row || (cfg.freeze?.xSplit ?? 0) !== f.col) {
      this.exec('sheet.mutation.set-frozen', { subUnitId: sid, startRow: f.row || -1, startColumn: f.col || -1, ySplit: f.row, xSplit: f.col });
    }
  }
}
