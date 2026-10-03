'use client';

import { chartDataOf, chartsMapOf, colName, SHEETS_MAP, ySheet, type SheetChartDef } from '@workos/sheet-model';
import { chartSvg, DEFAULT_THEME } from '@workos/slide-model';
import { useEffect, useRef, useState } from 'react';
import type * as Y from 'yjs';
import type { UniverAPI } from '../binding';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

export const CHART_COMPONENT = 'MoChart';

/**
 * Univer renders float DOMs in its own React root (no access to our context), so each grid registers the
 * Y.Doc and API it works with here, keyed by unit id.
 */
export const chartContexts = new Map<string, { doc: Y.Doc; api: UniverAPI }>();

const rowIds = (doc: Y.Doc, sheetId: string) => {
  const m = doc.getMap(SHEETS_MAP).get(sheetId) as Y.Map<unknown> | undefined;
  if (!m) return null;
  const ys = ySheet(m);
  return { rows: ys.rows.toArray(), cols: ys.cols.toArray() };
};

/** Index range of a chart's data (null when the rows/columns it pointed at were deleted). */
export function chartRange(doc: Y.Doc, def: SheetChartDef) {
  const ids = rowIds(doc, def.sheetId);
  if (!ids) return null;
  const r0 = ids.rows.indexOf(def.r0);
  const r1 = ids.rows.indexOf(def.r1);
  const c0 = ids.cols.indexOf(def.c0);
  const c1 = ids.cols.indexOf(def.c1);
  if (r0 < 0 || r1 < 0 || c0 < 0 || c1 < 0) return null;
  return { r0: Math.min(r0, r1), r1: Math.max(r0, r1), c0: Math.min(c0, c1), c1: Math.max(c0, c1) };
}

export function chartRangeA1(doc: Y.Doc, api: UniverAPI, unitId: string, def: SheetChartDef) {
  const r = chartRange(doc, def);
  const name = (api.getWorkbook(unitId) as Any)?.getSheetBySheetId(def.sheetId)?.getSheetName() ?? '';
  if (!r) return '';
  const quoted = /^[A-Za-z0-9_]+$/.test(name) ? name : `'${name.replace(/'/g, "''")}'`;
  return `${quoted}!${colName(r.c0)}${r.r0 + 1}:${colName(r.c1)}${r.r1 + 1}`;
}

/** The chart drawn over the grid. Re-renders when its definition, its data or its size changes. */
export function SheetChart(props: { data?: { chartId: string; unitId: string } }) {
  const chartId = props.data?.chartId;
  const unitId = props.data?.unitId;
  const host = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 400, h: 260 });
  const [tick, setTick] = useState(0);
  const ctx = unitId ? chartContexts.get(unitId) : undefined;

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: Math.max(80, e.contentRect.width), h: Math.max(60, e.contentRect.height) }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!ctx) return;
    let raf = 0;
    const bump = () => {
      if (!raf) raf = requestAnimationFrame(() => ((raf = 0), setTick((t) => t + 1)));
    };
    const sub = ctx.api.addEvent(ctx.api.Event.CommandExecuted, (e: Any) => {
      if (/set-range-values|formula-calculation-result|insert-row|remove-rows|insert-col|remove-col|move-rows|move-col/.test(e.id)) bump();
    });
    const charts = chartsMapOf(ctx.doc);
    charts.observe(bump);
    return () => {
      sub.dispose();
      charts.unobserve(bump);
      cancelAnimationFrame(raf);
    };
  }, [ctx]);

  void tick;
  const def = ctx && chartId ? chartsMapOf(ctx.doc).get(chartId) : undefined;
  let svg = '';
  let message: string | null = null;
  if (!ctx || !def) message = 'Chart not found';
  else {
    const r = chartRange(ctx.doc, def);
    const ws = (ctx.api.getWorkbook(unitId!) as Any)?.getSheetBySheetId(def.sheetId);
    if (!r || !ws) message = 'The chart’s data range was deleted';
    else {
      const sheet = ws.getSheet();
      const grid = Array.from({ length: Math.min(r.r1 - r.r0 + 1, 500) }, (_, i) =>
        Array.from({ length: Math.min(r.c1 - r.c0 + 1, 50) }, (_, j) => {
          const c = sheet.getCellRaw(r.r0 + i, r.c0 + j);
          return c?.t === 3 ? c.v === 1 || c.v === true : c?.v;
        }),
      );
      const data = chartDataOf(def, grid);
      svg = chartSvg({ kind: def.kind, title: def.title, legend: def.legend, labels: def.labels, ...data }, size.w, size.h, DEFAULT_THEME);
    }
  }
  return (
    <div
      ref={host}
      className="h-full w-full overflow-hidden rounded border border-slate-200 bg-white"
      data-testid="sheet-chart"
      data-chart={chartId}
      onDoubleClick={() => chartId && window.dispatchEvent(new CustomEvent('mo-chart-edit', { detail: { chartId, unitId } }))}
      title="Double-click to edit the chart"
    >
      {message ? <div className="flex h-full items-center justify-center p-3 text-center text-[12px] text-slate-500">{message}</div> : <div dangerouslySetInnerHTML={{ __html: svg }} />}
    </div>
  );
}
