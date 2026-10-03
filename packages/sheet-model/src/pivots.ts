// Pivot tables (docs/ARCHITECTURE.md §27). The definition lives in the workbook's top-level `pivots` map; the
// table itself is written as ordinary cell values on the host sheet, so formulas, charts and exports can use it.
// Fields are column ids of the source range: inserting columns elsewhere never changes what a field means.
import type * as Y from 'yjs';

export const PIVOTS_MAP = 'pivots';

export type PivotAgg = 'SUM' | 'COUNT' | 'COUNTA' | 'COUNTUNIQUE' | 'AVERAGE' | 'MIN' | 'MAX' | 'MEDIAN';
export const PIVOT_AGGS: PivotAgg[] = ['SUM', 'COUNTA', 'COUNT', 'COUNTUNIQUE', 'AVERAGE', 'MIN', 'MAX', 'MEDIAN'];

export interface PivotGroup {
  field: string; // column id in the source
  order?: 'asc' | 'desc';
}
export interface PivotValue {
  field: string;
  agg: PivotAgg;
}
export interface PivotFilter {
  field: string;
  hidden: string[]; // values left out (as displayed text)
}

export interface SheetPivotDef {
  id: string;
  sheetId: string; // source sheet
  r0: string; // source range, row / column ids (first row = field names)
  r1: string;
  c0: string;
  c1: string;
  hostSheetId: string; // where the table is written
  anchor: { row: number; col: number }; // top-left cell of the table on the host sheet
  rows: PivotGroup[];
  columns: PivotGroup[];
  values: PivotValue[];
  filters: PivotFilter[];
  totals?: boolean; // grand totals + subtotals (default on)
  out?: { rows: number; cols: number }; // size last written, so a smaller table clears the rest
}

type Value = string | number | boolean | null | undefined;
export type PivotCell = string | number | null;

const isEmpty = (v: Value) => v === null || v === undefined || v === '';
const text = (v: Value) => (isEmpty(v) ? '(blank)' : String(v));
const num = (v: Value): number | null => (typeof v === 'number' ? v : typeof v === 'boolean' ? null : !isEmpty(v) && Number.isFinite(Number(v)) ? Number(v) : null);

export function aggregate(agg: PivotAgg, vals: Value[]): PivotCell {
  const filled = vals.filter((v) => !isEmpty(v));
  if (agg === 'COUNTA') return filled.length;
  if (agg === 'COUNTUNIQUE') return new Set(filled.map((v) => String(v))).size;
  const nums = filled.map(num).filter((n): n is number => n !== null);
  if (agg === 'COUNT') return nums.length;
  if (agg === 'SUM') return nums.reduce((s, n) => s + n, 0);
  if (!nums.length) return null;
  if (agg === 'AVERAGE') return nums.reduce((s, n) => s + n, 0) / nums.length;
  if (agg === 'MIN') return Math.min(...nums);
  if (agg === 'MAX') return Math.max(...nums);
  const s = [...nums].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Numbers sort numerically, text alphabetically (numbers first), "(blank)" last — like Google Sheets. */
function compareKeys(a: Value, b: Value, order: 'asc' | 'desc' = 'asc') {
  const ea = isEmpty(a);
  const eb = isEmpty(b);
  if (ea || eb) return ea === eb ? 0 : ea ? 1 : -1;
  const na = typeof a === 'number';
  const nb = typeof b === 'number';
  const c = na && nb ? (a as number) - (b as number) : na ? -1 : nb ? 1 : String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
  return order === 'desc' ? -c : c;
}

export interface PivotInput {
  /** Field names by column id. */
  names: Map<string, string>;
  /** Data rows (without the header row), as column id → value. */
  records: Map<string, Value>[];
}

/** Distinct values of a field (for the filter picker), sorted. */
export function pivotFieldValues(input: PivotInput, field: string): string[] {
  const vals = [...new Map(input.records.map((r) => [text(r.get(field)), r.get(field)])).entries()];
  return vals.sort((a, b) => compareKeys(a[1], b[1])).map(([t]) => t);
}

const SEP = '\u001f';

/**
 * Lays the pivot table out as a grid (like Google Sheets): header rows (one per column field, then the row field
 * names and value labels), one row per row-key combination with subtotals for outer row fields, and grand totals.
 */
export function computePivot(def: Pick<SheetPivotDef, 'rows' | 'columns' | 'values' | 'filters' | 'totals'>, input: PivotInput): PivotCell[][] {
  const totals = def.totals !== false;
  const rows = def.rows.filter((g) => input.names.has(g.field));
  const cols = def.columns.filter((g) => input.names.has(g.field));
  const vals = def.values.filter((v) => input.names.has(v.field));
  const name = (f: string) => input.names.get(f) ?? '';
  const records = input.records.filter((r) => def.filters.every((f) => !f.hidden.includes(text(r.get(f.field)))));

  // Distinct key tuples, sorted level by level.
  const tuples = (groups: PivotGroup[]) => {
    const seen = new Map<string, Value[]>();
    for (const r of records) {
      const t = groups.map((g) => r.get(g.field));
      seen.set(t.map(text).join(SEP), t);
    }
    return [...seen.values()].sort((a, b) => {
      for (let i = 0; i < groups.length; i++) {
        const c = compareKeys(a[i], b[i], groups[i].order);
        if (c) return c;
      }
      return 0;
    });
  };
  const rowKeys = rows.length ? tuples(rows) : [[]];
  const colKeys = cols.length ? tuples(cols) : [[]];

  // Buckets: row prefix (any length) × column key (or '*' = all columns).
  const buckets = new Map<string, Map<string, Value>[]>();
  const add = (k: string, r: Map<string, Value>) => {
    const b = buckets.get(k);
    if (b) b.push(r);
    else buckets.set(k, [r]);
  };
  for (const r of records) {
    const rk = rows.map((g) => text(r.get(g.field)));
    const ck = cols.map((g) => text(r.get(g.field))).join(SEP);
    for (let p = 0; p <= rk.length; p++) {
      const prefix = rk.slice(0, p).join(SEP);
      add(`${p}${SEP}${prefix}|${ck}`, r);
      add(`${p}${SEP}${prefix}|*`, r);
    }
  }
  const cellsFor = (prefix: Value[], ck: string): PivotCell[] => {
    const recs = buckets.get(`${prefix.length}${SEP}${prefix.map(text).join(SEP)}|${ck}`) ?? [];
    return vals.map((v) => (recs.length ? aggregate(v.agg, recs.map((r) => r.get(v.field))) : null));
  };
  const colKeyStrs = colKeys.map((k) => k.map(text).join(SEP));
  const showColTotals = totals && cols.length > 0;
  const labelCols = Math.max(1, rows.length);
  const vCount = Math.max(1, vals.length);

  const out: PivotCell[][] = [];
  // Header rows for column fields.
  cols.forEach((g, level) => {
    const line: PivotCell[] = Array(labelCols).fill(null);
    line[labelCols - 1] = name(g.field);
    colKeys.forEach((k, i) => {
      const prev = colKeys[i - 1];
      const same = prev && k.slice(0, level + 1).every((v, j) => text(v) === text(prev[j]));
      for (let v = 0; v < vCount; v++) line.push(v === 0 && !same ? (isEmpty(k[level]) ? '(blank)' : (k[level] as PivotCell)) : null);
    });
    if (showColTotals) for (let v = 0; v < vCount; v++) line.push(level === 0 && v === 0 ? 'Grand Total' : null);
    out.push(line);
  });
  // Row field names + value labels.
  const head: PivotCell[] = rows.length ? rows.map((g) => name(g.field)) : [null];
  const labels = vals.map((v) => `${v.agg} of ${name(v.field)}`);
  for (let i = 0; i < colKeys.length; i++) for (let v = 0; v < vCount; v++) head.push(labels[v] ?? null);
  if (showColTotals) for (let v = 0; v < vCount; v++) head.push(labels[v] ?? null);
  out.push(head);
  if (!vals.length && !rows.length) return out;

  const lineFor = (labelsLine: PivotCell[], prefix: Value[]) => {
    const line = [...labelsLine];
    for (const ck of colKeyStrs) line.push(...(vals.length ? cellsFor(prefix, ck) : [null]));
    if (showColTotals) line.push(...(vals.length ? cellsFor(prefix, '*') : [null]));
    return line;
  };
  // Body with subtotals for outer row fields.
  rowKeys.forEach((key, i) => {
    const prev = rowKeys[i - 1];
    const labelsLine: PivotCell[] = Array(labelCols).fill(null);
    let changedFrom = prev ? key.findIndex((v, j) => text(v) !== text(prev[j])) : 0;
    if (changedFrom < 0) changedFrom = key.length;
    key.forEach((v, j) => {
      if (j >= changedFrom) labelsLine[j] = isEmpty(v) ? '(blank)' : (v as PivotCell);
    });
    if (rows.length) out.push(lineFor(labelsLine, key));
    // Close the groups that end after this row (innermost first).
    const next = rowKeys[i + 1];
    if (totals && rows.length > 1) {
      for (let level = rows.length - 2; level >= 0; level--) {
        const ends = !next || key.slice(0, level + 1).some((v, j) => text(v) !== text(next[j]));
        if (!ends) continue;
        const sub: PivotCell[] = Array(labelCols).fill(null);
        sub[level] = `${text(key[level])} Total`;
        out.push(lineFor(sub, key.slice(0, level + 1)));
      }
    }
  });
  if (totals || !rows.length) {
    const g: PivotCell[] = Array(labelCols).fill(null);
    g[0] = 'Grand Total';
    out.push(lineFor(g, []));
  }
  // Square the grid.
  const width = Math.max(...out.map((r) => r.length));
  return out.map((r) => (r.length < width ? [...r, ...Array(width - r.length).fill(null)] : r));
}

export const pivotsMapOf = (doc: Y.Doc) => doc.getMap<SheetPivotDef>(PIVOTS_MAP);
