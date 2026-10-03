'use client';

import { chartsMapOf, SHEETS_MAP, ySheet, type SheetChartDef } from '@workos/sheet-model';
import type * as Y from 'yjs';
import type { UniverAPI } from '../binding';
import { CHART_COMPONENT } from './SheetChart';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

const idsOf = (doc: Y.Doc, sheetId: string) => {
  const ys = ySheet(doc.getMap(SHEETS_MAP).get(sheetId) as Y.Map<unknown>);
  return { rows: ys.rows.toArray(), cols: ys.cols.toArray() };
};

const isText = (v: unknown) => typeof v === 'string' && v.trim() !== '' && !Number.isFinite(Number(v));

/** The selection, or — for a single cell — the sheet's used data region (like Excel's "insert chart"). */
function dataRange(ws: Any) {
  const sel = ws.getSelection?.()?.getActiveRange?.()?.getRange?.();
  if (sel && (sel.endRow > sel.startRow || sel.endColumn > sel.startColumn)) return sel;
  const lastRow = Math.max(0, ws.getLastRow?.() ?? 0);
  const lastCol = Math.max(0, ws.getLastColumn?.() ?? 0);
  return { startRow: 0, startColumn: 0, endRow: lastRow, endColumn: lastCol };
}

/** Inserts a chart for the selected data next to it; returns the chart id. */
export function insertChart(api: UniverAPI, doc: Y.Doc, unitId: string, kind: SheetChartDef['kind'] = 'column'): string | null {
  const wb = api.getWorkbook(unitId) as Any;
  const ws = wb?.getActiveSheet();
  if (!ws) return null;
  const r = dataRange(ws);
  const sheetId = ws.getSheetId();
  const ids = idsOf(doc, sheetId);
  const sheet = ws.getSheet();
  const first = sheet.getCellRaw(r.startRow, r.startColumn + 1)?.v;
  const firstCol = sheet.getCellRaw(r.startRow + 1, r.startColumn)?.v;
  const id = `chart-${Math.random().toString(36).slice(2, 10)}`;
  const def: SheetChartDef = {
    id,
    sheetId,
    hostSheetId: sheetId,
    r0: ids.rows[r.startRow],
    r1: ids.rows[r.endRow],
    c0: ids.cols[r.startColumn],
    c1: ids.cols[r.endColumn],
    kind,
    headerRow: isText(first) || first === undefined,
    headerCol: isText(firstCol),
    legend: true,
  };
  if (!def.r0 || !def.c0 || !def.r1 || !def.c1) return null;
  chartsMapOf(doc).set(id, def);
  // Place it to the right of the data, at the top of the range.
  const anchor = ws.getRange(r.startRow, Math.min(r.endColumn + 2, ws.getMaxColumns() - 1)).getCellRect();
  ws.addFloatDomToPosition(
    { componentKey: CHART_COMPONENT, initPosition: { startX: anchor.left, startY: anchor.top, endX: anchor.left + 520, endY: anchor.top + 320 }, data: { chartId: id, unitId }, allowTransform: true },
    id,
  );
  return id;
}

/** Removes the chart's drawing and its definition. */
export function deleteChart(api: UniverAPI, doc: Y.Doc, unitId: string, chartId: string) {
  const def = chartsMapOf(doc).get(chartId);
  const subUnitId = def?.hostSheetId ?? def?.sheetId;
  if (subUnitId) void api.executeCommand('sheet.command.remove-sheet-image', { unitId, drawings: [{ unitId, subUnitId, drawingId: chartId, drawingType: 8 /* DRAWING_DOM */ }] });
  chartsMapOf(doc).delete(chartId);
}

/** Parses "Sheet1!A1:C5" / "A1:C5" into a chart range (ids); null when invalid. */
export function rangeFromA1(api: UniverAPI, doc: Y.Doc, unitId: string, a1: string, fallbackSheetId: string): Pick<SheetChartDef, 'sheetId' | 'r0' | 'r1' | 'c0' | 'c1'> | null {
  const m = /^\s*(?:(?:'((?:[^']|'')+)'|([^!]+))!)?\$?([A-Za-z]{1,3})\$?(\d{1,7}):\$?([A-Za-z]{1,3})\$?(\d{1,7})\s*$/.exec(a1);
  if (!m) return null;
  const name = m[1]?.replace(/''/g, "'") ?? m[2];
  const wb = api.getWorkbook(unitId) as Any;
  const ws = name ? wb?.getSheetByName(name.trim()) : wb?.getSheetBySheetId(fallbackSheetId);
  if (!ws) return null;
  const col = (s: string) => s.toUpperCase().split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
  const ids = idsOf(doc, ws.getSheetId());
  const r0 = ids.rows[Number(m[4]) - 1];
  const r1 = ids.rows[Number(m[6]) - 1];
  const c0 = ids.cols[col(m[3])];
  const c1 = ids.cols[col(m[5])];
  if (!r0 || !r1 || !c0 || !c1) return null;
  return { sheetId: ws.getSheetId(), r0, r1, c0, c1 };
}
