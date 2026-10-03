'use client';

import type { UniverAPI } from './binding';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;
type Cell = { v?: unknown; f?: string | null; si?: string | null; p?: unknown; s?: unknown } | null | undefined;
type IRange = { startRow: number; endRow: number; startColumn: number; endColumn: number };

/** Data tools of the Data menu (remove duplicates, trim whitespace, split text, column stats) and checkboxes. */

const EMPTY = { v: null, f: null, si: null, p: null } as const;

function activeRange(api: UniverAPI, unitId: string): { ws: Any; range: Any; r: IRange } | null {
  const ws = (api.getWorkbook(unitId) as Any)?.getActiveSheet();
  const range = ws?.getSelection?.()?.getActiveRange?.();
  if (!ws || !range) return null;
  return { ws, range, r: range.getRange() };
}

/** The selection, or the used data region when a single cell is selected. */
export function dataRange(api: UniverAPI, unitId: string) {
  const a = activeRange(api, unitId);
  if (!a) return null;
  if (a.r.endRow > a.r.startRow || a.r.endColumn > a.r.startColumn) return a;
  const lastRow = Math.max(0, a.ws.getLastRow?.() ?? 0);
  const lastCol = Math.max(0, a.ws.getLastColumn?.() ?? 0);
  const range = a.ws.getRange(0, 0, lastRow + 1, lastCol + 1);
  return { ws: a.ws, range, r: range.getRange() as IRange };
}

const keyOf = (row: unknown[]) => JSON.stringify(row.map((v) => (typeof v === 'string' ? v.trim().toLowerCase() : v ?? '')));

/**
 * Removes duplicate rows inside the selection (compared on the given columns, case-insensitive, ignoring surrounding
 * spaces). Unique rows move up, the freed rows at the bottom are cleared — like Google Sheets. One undo step.
 */
export function removeDuplicates(api: UniverAPI, unitId: string, opts: { headerRow?: boolean; columns?: number[] } = {}): { removed: number; left: number } | null {
  const a = dataRange(api, unitId);
  if (!a) return null;
  const values: unknown[][] = a.range.getValues();
  const cells: Cell[][] = a.range.getCellDataGrid();
  const start = opts.headerRow ? 1 : 0;
  const width = values[0]?.length ?? 0;
  const cols = opts.columns?.length ? opts.columns : [...Array(width).keys()];
  const seen = new Set<string>();
  const kept: Cell[][] = cells.slice(0, start);
  for (let i = start; i < values.length; i++) {
    const row = values[i];
    if (row.every((v) => v === null || v === undefined || v === '')) continue;
    const k = keyOf(cols.map((c) => row[c]));
    if (seen.has(k)) continue;
    seen.add(k);
    kept.push(cells[i]);
  }
  const blanks = values.slice(start).filter((row) => row.every((v) => v === null || v === undefined || v === '')).length;
  const removed = values.length - kept.length - blanks;
  if (removed > 0) {
    const out = values.map((_, i) => (i < kept.length ? kept[i].map((c) => ({ ...EMPTY, ...(c ?? {}) })) : Array.from({ length: width }, () => ({ ...EMPTY }))));
    a.range.setValues(out);
  }
  return { removed, left: kept.length - start };
}

/** Trims leading/trailing spaces and collapses repeated spaces in text cells (formulas are left alone). */
export function trimWhitespace(api: UniverAPI, unitId: string): number {
  const a = dataRange(api, unitId);
  if (!a) return 0;
  const cells: Cell[][] = a.range.getCellDataGrid();
  let changed = 0;
  const out = cells.map((row) =>
    row.map((c) => {
      if (!c || c.f || c.si || typeof c.v !== 'string') return c ?? { ...EMPTY };
      const v = c.v.replace(/[ \t ]+/g, ' ').replace(/ *\n */g, '\n').trim();
      if (v === c.v) return c;
      changed++;
      return { ...c, v };
    }),
  );
  if (changed) a.range.setValues(out);
  return changed;
}

export type SplitSeparator = 'auto' | ',' | ';' | '.' | ' ' | string;

const asValue = (s: string): string | number => {
  const t = s.trim();
  return t !== '' && /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : t;
};

/** Detects the most frequent separator among comma, semicolon, tab, pipe, period and space. */
export function detectSeparator(texts: string[]): string {
  let best = ',';
  let bestCount = 0;
  for (const sep of [',', ';', '\t', '|', '.', ' ']) {
    const count = texts.filter((t) => t.includes(sep)).length;
    if (count > bestCount) [best, bestCount] = [sep, count];
  }
  return best;
}

/**
 * Splits the text of the selected column into the columns to its right (overwriting them, like Google Sheets).
 * Returns the separator used and how many columns were written, or null when nothing could be split.
 */
export function splitTextToColumns(api: UniverAPI, unitId: string, separator: SplitSeparator = 'auto'): { separator: string; columns: number } | null {
  const a = activeRange(api, unitId);
  if (!a) return null;
  const { r, ws } = a;
  const col = ws.getRange(r.startRow, r.startColumn, r.endRow - r.startRow + 1, 1);
  const cells: Cell[][] = col.getCellDataGrid();
  const texts = cells.map((row) => (row[0] && !row[0].f && typeof row[0].v === 'string' ? (row[0].v as string) : null));
  const sep = separator === 'auto' ? detectSeparator(texts.filter((t): t is string => !!t)) : separator;
  if (!sep) return null;
  const parts = texts.map((t) => (t === null ? null : t.split(sep).map((s) => s.trim()).filter((p) => !(sep === ' ' && p === ''))));
  const width = Math.max(1, ...parts.map((p) => p?.length ?? 1));
  if (width < 2) return null;
  const out = parts.map((p, i) => Array.from({ length: width }, (_, j) => (p ? (j < p.length ? { ...EMPTY, v: asValue(p[j]) } : { ...EMPTY }) : j === 0 ? (cells[i][0] ?? { ...EMPTY }) : { ...EMPTY })));
  ws.getRange(r.startRow, r.startColumn, out.length, width).setValues(out);
  return { separator: sep, columns: width };
}

/** Turns the selection into checkboxes (data validation, unchecked = empty / FALSE). */
export function insertCheckboxes(api: UniverAPI, unitId: string): boolean {
  const a = activeRange(api, unitId);
  if (!a) return false;
  a.range.setDataValidation(api.newDataValidation().requireCheckbox().build());
  return true;
}

export interface ColumnStats {
  label: string;
  rows: number;
  empty: number;
  unique: number;
  numbers: number;
  sum: number;
  average: number | null;
  median: number | null;
  min: number | null;
  max: number | null;
  top: { value: string; count: number }[];
}

const colLetter = (i: number) => {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};

/** Statistics of the column of the active cell, over the used rows (row 1 counted as header when it is text). */
export function columnStats(api: UniverAPI, unitId: string): ColumnStats | null {
  const a = activeRange(api, unitId);
  if (!a) return null;
  const c = a.r.startColumn;
  const lastRow = Math.max(0, a.ws.getLastRow?.() ?? 0);
  const values: unknown[] = a.ws.getRange(0, c, lastRow + 1, 1).getValues().map((row: unknown[]) => row[0]);
  const header = typeof values[0] === 'string' && values.slice(1).some((v) => typeof v === 'number') ? String(values[0]) : null;
  const body = header === null ? values : values.slice(1);
  const filled = body.filter((v) => v !== null && v !== undefined && v !== '');
  const nums = filled.filter((v): v is number => typeof v === 'number').sort((x, y) => x - y);
  const freq = new Map<string, number>();
  for (const v of filled) freq.set(String(v), (freq.get(String(v)) ?? 0) + 1);
  const sum = nums.reduce((s, n) => s + n, 0);
  const mid = nums.length >> 1;
  return {
    label: header ? `${colLetter(c)} · ${header}` : colLetter(c),
    rows: body.length,
    empty: body.length - filled.length,
    unique: freq.size,
    numbers: nums.length,
    sum,
    average: nums.length ? sum / nums.length : null,
    median: nums.length ? (nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2) : null,
    min: nums.length ? nums[0] : null,
    max: nums.length ? nums[nums.length - 1] : null,
    top: [...freq].sort((x, y) => y[1] - x[1]).slice(0, 8).map(([value, count]) => ({ value, count })),
  };
}
