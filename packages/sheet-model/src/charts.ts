// Charts in spreadsheets (docs/ARCHITECTURE.md §26). The definition lives in the workbook's top-level `charts`
// map; the position is a Univer DOM drawing (synced with the drawing plugin's state). The data range is stored
// with stable row/column ids, so inserting or deleting rows elsewhere never shifts what a chart shows.
import type * as Y from 'yjs';

export const CHARTS_MAP = 'charts';

export type SheetChartKind = 'column' | 'bar' | 'line' | 'area' | 'pie' | 'doughnut';

export interface SheetChartDef {
  id: string;
  sheetId: string; // sheet that holds the data
  hostSheetId?: string; // sheet the chart is drawn on
  r0: string; // row / column ids of the data range (inclusive)
  r1: string;
  c0: string;
  c1: string;
  kind: SheetChartKind;
  title?: string;
  legend?: boolean;
  labels?: boolean;
  headerRow?: boolean; // first row = series names (or categories when byRow)
  headerCol?: boolean; // first column = categories (or series names when byRow)
  byRow?: boolean; // series in rows instead of columns
  colors?: string[];
}

export interface ChartData {
  categories: string[];
  series: { name: string; values: number[]; color?: string }[];
}

type Value = string | number | boolean | null | undefined;

/** Turns a value grid (rows × columns, already resolved from the range) into categories + series. */
export function chartDataOf(def: Pick<SheetChartDef, 'headerRow' | 'headerCol' | 'byRow' | 'colors'>, grid: Value[][]): ChartData {
  // Work in "series are columns" orientation; transpose when series are rows.
  const g = def.byRow ? grid[0]?.map((_, c) => grid.map((row) => row[c])) ?? [] : grid;
  const headerRow = def.byRow ? def.headerCol !== false : def.headerRow !== false;
  const headerCol = def.byRow ? def.headerRow !== false : def.headerCol !== false;
  const body = headerRow ? g.slice(1) : g;
  const names = headerRow ? g[0] ?? [] : [];
  const firstSeries = headerCol ? 1 : 0;
  const width = Math.max(0, ...g.map((r) => r.length));
  const categories = body.map((r, i) => (headerCol ? String(r[0] ?? '') : String(i + 1)));
  const series = [];
  for (let c = firstSeries; c < width; c++) {
    const values = body.map((r) => {
      const v = r[c];
      return typeof v === 'number' ? v : typeof v === 'boolean' ? (v ? 1 : 0) : Number(String(v ?? '').replace(/[, ]/g, '')) || 0;
    });
    const name = headerRow ? String(names[c] ?? `Series ${c - firstSeries + 1}`) : `Series ${c - firstSeries + 1}`;
    const color = def.colors?.[c - firstSeries];
    series.push({ name, values, ...(color ? { color } : {}) });
  }
  return { categories, series };
}

export const chartsMapOf = (doc: Y.Doc) => doc.getMap<SheetChartDef>(CHARTS_MAP);
