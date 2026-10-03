'use client';

import { computePivot, pivotsMapOf, SHEETS_MAP, ySheet, type PivotCell, type PivotInput, type SheetPivotDef } from '@workos/sheet-model';
import type * as Y from 'yjs';
import type { UniverAPI } from '../binding';
import { dataRange } from '../data-tools';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

const MUTATION = 2;
const HEADER_STYLE = { bl: 1, bg: { rgb: '#e8f0fe' } };
const TOTAL_STYLE = { bl: 1 };

export const sheetIds = (doc: Y.Doc, sheetId: string) => {
  const m = doc.getMap(SHEETS_MAP).get(sheetId) as Y.Map<unknown> | undefined;
  if (!m) return null;
  const ys = ySheet(m);
  return { rows: ys.rows.toArray(), cols: ys.cols.toArray() };
};

/** Index range of the pivot's source (null when its rows/columns were deleted). */
export function pivotSource(doc: Y.Doc, def: Pick<SheetPivotDef, 'sheetId' | 'r0' | 'r1' | 'c0' | 'c1'>) {
  const ids = sheetIds(doc, def.sheetId);
  if (!ids) return null;
  const r = [ids.rows.indexOf(def.r0), ids.rows.indexOf(def.r1)];
  const c = [ids.cols.indexOf(def.c0), ids.cols.indexOf(def.c1)];
  if (r.some((i) => i < 0) || c.some((i) => i < 0)) return null;
  return { r0: Math.min(r[0], r[1]), r1: Math.max(r[0], r[1]), c0: Math.min(c[0], c[1]), c1: Math.max(c[0], c[1]), colIds: ids.cols };
}

/** Field names (header row) and records of the source range, keyed by column id. */
export function readPivotInput(api: UniverAPI, doc: Y.Doc, unitId: string, def: SheetPivotDef): PivotInput | null {
  const src = pivotSource(doc, def);
  const ws = (api.getWorkbook(unitId) as Any)?.getSheetBySheetId(def.sheetId);
  if (!src || !ws) return null;
  const grid: unknown[][] = ws.getRange(src.r0, src.c0, src.r1 - src.r0 + 1, src.c1 - src.c0 + 1).getValues();
  const ids = src.colIds.slice(src.c0, src.c1 + 1);
  const names = new Map<string, string>();
  ids.forEach((id, i) => names.set(id, String(grid[0]?.[i] ?? '').trim() || `Column ${i + 1}`));
  const records = grid
    .slice(1)
    .filter((row) => row.some((v) => v !== null && v !== undefined && v !== ''))
    .map((row) => new Map(ids.map((id, i) => [id, row[i] as Any])));
  return { names, records };
}

/** Which pivot table (if any) the cell belongs to. */
export function pivotAt(doc: Y.Doc, sheetId: string, row: number, col: number): string | null {
  for (const [id, def] of pivotsMapOf(doc)) {
    if (def.hostSheetId !== sheetId) continue;
    const h = Math.max(1, def.out?.rows ?? 1);
    const w = Math.max(1, def.out?.cols ?? 1);
    if (row >= def.anchor.row && row < def.anchor.row + h && col >= def.anchor.col && col < def.anchor.col + w) return id;
  }
  return null;
}

const same = (a: unknown, b: unknown) => (a ?? '') === (b ?? '');

/**
 * Writes a pivot table to its host sheet when it differs from what is there. The write is a plain
 * set-range-values mutation: it syncs like any edit but stays out of the undo stack (undoing the source edit
 * recomputes the table). Returns false when the host sheet no longer exists.
 */
export function renderPivot(api: UniverAPI, doc: Y.Doc, unitId: string, id: string): boolean {
  const map = pivotsMapOf(doc);
  const def = map.get(id);
  const wb = api.getWorkbook(unitId) as Any;
  const ws = def && wb?.getSheetBySheetId(def.hostSheetId);
  if (!def || !ws) return false;
  const input = readPivotInput(api, doc, unitId, def);
  const grid: PivotCell[][] = input ? computePivot(def, input) : [['#REF! The source range was deleted']];
  const rows = grid.length;
  const cols = Math.max(0, ...grid.map((r) => r.length));
  const h = Math.max(rows, def.out?.rows ?? 0);
  const w = Math.max(cols, def.out?.cols ?? 0);
  const { row: R, col: C } = def.anchor;
  const maxR = ws.getMaxRows();
  const maxC = ws.getMaxColumns();
  if (R + rows > maxR) ws.insertRowsAfter(maxR - 1, R + rows - maxR);
  if (C + cols > maxC) ws.insertColumnsAfter(maxC - 1, C + cols - maxC);
  const current: unknown[][] = ws.getRange(R, C, h, w).getValues();
  let changed = rows !== (def.out?.rows ?? -1) || cols !== (def.out?.cols ?? -1);
  for (let r = 0; r < h && !changed; r++) for (let c = 0; c < w && !changed; c++) changed = !same(current[r]?.[c], grid[r]?.[c]);
  if (!changed) return true;
  const headerRows = def.columns.length + 1;
  const cellValue: Record<number, Record<number, Any>> = {};
  for (let r = 0; r < h; r++) {
    const line: Record<number, Any> = (cellValue[R + r] = {});
    const label = grid[r]?.slice(0, Math.max(1, def.rows.length)).find((v) => typeof v === 'string');
    const isTotal = r >= headerRows && typeof label === 'string' && / Total$|^Grand Total$/.test(label);
    for (let c = 0; c < w; c++) {
      const v = r < rows && c < cols ? grid[r][c] : null;
      line[C + c] = { v, f: null, si: null, p: null, s: r < rows && c < cols ? (r < headerRows ? HEADER_STYLE : isTotal ? TOTAL_STYLE : null) : null };
    }
  }
  api.syncExecuteCommand('sheet.mutation.set-range-values', { unitId, subUnitId: def.hostSheetId, cellValue });
  if (def.out?.rows !== rows || def.out?.cols !== cols) map.set(id, { ...def, out: { rows, cols } });
  return true;
}

/** Clears the table's cells (when the pivot is deleted). */
export function clearPivot(api: UniverAPI, unitId: string, def: SheetPivotDef) {
  const h = def.out?.rows ?? 0;
  const w = def.out?.cols ?? 0;
  if (!h || !w || !(api.getWorkbook(unitId) as Any)?.getSheetBySheetId(def.hostSheetId)) return;
  const cellValue: Record<number, Record<number, Any>> = {};
  for (let r = 0; r < h; r++) {
    cellValue[def.anchor.row + r] = {};
    for (let c = 0; c < w; c++) cellValue[def.anchor.row + r][def.anchor.col + c] = { v: null, f: null, si: null, p: null, s: null };
  }
  api.syncExecuteCommand('sheet.mutation.set-range-values', { unitId, subUnitId: def.hostSheetId, cellValue });
}

/**
 * Keeps pivot tables up to date. Only the editor who causes a change recomputes (their local edits, their formula
 * results right after, their definition changes): other people receive the written cells, so nobody gets
 * someone else's refresh. On open, tables that are out of date (e.g. rows appended by a form) are refreshed.
 */
export class PivotEngine {
  private sub: { dispose(): void } | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private lastLocalEdit = 0;
  private readonly onDefs = (e: Y.YMapEvent<SheetPivotDef>) => {
    if (e.transaction.local) this.schedule([...e.keysChanged]);
  };
  private pending = new Set<string>();

  constructor(
    private readonly api: UniverAPI,
    private readonly doc: Y.Doc,
    private readonly unitId: string,
  ) {}

  start() {
    this.sub = this.api.addEvent(this.api.Event.CommandExecuted, (e: Any) => {
      if (e.options?.fromCollab || (e.params?.unitId && e.params.unitId !== this.unitId)) return;
      if (e.type === MUTATION && /formula-calculation-result/.test(e.id)) {
        if (Date.now() - this.lastLocalEdit < 3000) this.schedule();
        return;
      }
      if (e.type !== MUTATION || e.options?.onlyLocal) return;
      if (!/set-range-values|insert-row|remove-row|insert-col|remove-col|move-rows|move-col|remove-sheet/.test(e.id)) return;
      this.lastLocalEdit = Date.now();
      if (/remove-sheet/.test(e.id)) {
        // The person who deletes a sheet also deletes the pivot tables written on it.
        const map = pivotsMapOf(this.doc);
        for (const [id, def] of map) if (def.hostSheetId === e.params?.subUnitId) map.delete(id);
      }
      this.schedule();
    });
    pivotsMapOf(this.doc).observe(this.onDefs);
    // Formulas are recalculated on open: give them a moment before checking the tables.
    this.timer = setTimeout(() => this.refresh(), 1500);
  }

  private schedule(ids?: string[]) {
    if (!pivotsMapOf(this.doc).size) return;
    for (const id of ids ?? pivotsMapOf(this.doc).keys()) this.pending.add(id);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.refresh([...this.pending]), 200);
  }

  refresh(ids: string[] = [...pivotsMapOf(this.doc).keys()]) {
    this.pending.clear();
    for (const id of ids) {
      try {
        if (pivotsMapOf(this.doc).has(id)) renderPivot(this.api, this.doc, this.unitId, id);
      } catch (err) {
        console.error('[sheets] pivot', id, err);
      }
    }
  }

  destroy() {
    clearTimeout(this.timer);
    this.sub?.dispose();
    pivotsMapOf(this.doc).unobserve(this.onDefs);
  }
}

/** Inserts a pivot table for the selected data (or the sheet's data region) on a new sheet; returns its id. */
export function insertPivot(api: UniverAPI, doc: Y.Doc, unitId: string): string | null {
  const a = dataRange(api, unitId);
  if (!a || a.r.endRow <= a.r.startRow) return null; // a header row and at least one row of data
  const sheetId = a.ws.getSheetId();
  const ids = sheetIds(doc, sheetId);
  if (!ids) return null;
  const wb = api.getWorkbook(unitId) as Any;
  const names = new Set<string>(wb.getSheets().map((s: Any) => s.getSheetName()));
  let n = 1;
  while (names.has(`Pivot table ${n}`)) n++;
  const host = wb.insertSheet(`Pivot table ${n}`);
  const id = `pivot-${Math.random().toString(36).slice(2, 10)}`;
  const def: SheetPivotDef = {
    id,
    sheetId,
    r0: ids.rows[a.r.startRow],
    r1: ids.rows[a.r.endRow],
    c0: ids.cols[a.r.startColumn],
    c1: ids.cols[a.r.endColumn],
    hostSheetId: host.getSheetId(),
    anchor: { row: 0, col: 0 },
    rows: [],
    columns: [],
    values: [],
    filters: [],
    totals: true,
  };
  pivotsMapOf(doc).set(id, def);
  host.activate?.();
  return id;
}

export function deletePivot(api: UniverAPI, doc: Y.Doc, unitId: string, id: string) {
  const def = pivotsMapOf(doc).get(id);
  if (!def) return;
  clearPivot(api, unitId, def);
  pivotsMapOf(doc).delete(id);
}
