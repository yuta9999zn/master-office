'use client';

import { SHEETS_MAP, ySheet } from '@workos/sheet-model';
import { useEffect, useState } from 'react';
import * as Y from 'yjs';
import type { UniverAPI } from './binding';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

// View → Group rows / columns (Google Sheets: Alt+Shift+→ / ←). docs/ARCHITECTURE.md §50.
// A group is stored by the ids of its first and last row (column) in the Yjs sheet layout, so it follows
// inserted and deleted rows; collapsing hides the rows through Univer, which syncs like any hide. Groups and
// their collapsed state are shared, like Google. Univer OSS has no outline gutter: GroupGutter draws the
// brackets and the +/− buttons over the row / column headers.

export type Axis = 'rows' | 'cols';
export interface Group {
  id: string;
  sheetId: string;
  axis: Axis;
  start: string; // row / column id
  end: string;
  collapsed: boolean;
}
export interface PlacedGroup extends Group {
  from: number; // 0-based index
  to: number;
  depth: number;
}

const MAP = 'groups';
export const groupsOf = (doc: Y.Doc) => doc.getMap<Group>(MAP);

function idsOf(doc: Y.Doc, sheetId: string, axis: Axis): string[] {
  const m = doc.getMap(SHEETS_MAP).get(sheetId) as Y.Map<unknown> | undefined;
  if (!m) return [];
  const ys = ySheet(m);
  return (axis === 'rows' ? ys.rows : ys.cols).toArray();
}

/** Groups of a sheet with their current indices and nesting depth (deleted ends drop the group). */
export function placedGroups(doc: Y.Doc, sheetId: string): PlacedGroup[] {
  const out: PlacedGroup[] = [];
  for (const axis of ['rows', 'cols'] as const) {
    const ids = idsOf(doc, sheetId, axis);
    const index = new Map(ids.map((id, i) => [id, i]));
    const list = [...groupsOf(doc).values()]
      .filter((g) => g.sheetId === sheetId && g.axis === axis && index.has(g.start) && index.has(g.end))
      .map((g) => ({ ...g, from: index.get(g.start)!, to: index.get(g.end)!, depth: 0 }))
      .sort((a, b) => a.from - b.from || b.to - a.to);
    // Depth = how many other groups contain this one.
    for (const g of list) g.depth = list.filter((o) => o !== g && o.from <= g.from && o.to >= g.to && (o.from !== g.from || o.to !== g.to)).length;
    out.push(...list);
  }
  return out;
}

const BASE_HEADER_W = 46;
const BASE_HEADER_H = 20;
const LANE = 16; // room for one level of brackets + buttons
const STEP = 9; // each nesting level

const activeSheet = (api: UniverAPI, unitId: string) => (api.getWorkbook(unitId) as Any)?.getActiveSheet();

/** The rows / columns the selection covers. */
export function selectionSpan(api: UniverAPI, unitId: string): { rows: [number, number]; cols: [number, number]; wholeCols: boolean } | null {
  const r = activeSheet(api, unitId)?.getSelection?.()?.getActiveRange?.()?.getRange?.();
  if (!r) return null;
  return { rows: [r.startRow, r.endRow], cols: [r.startColumn, r.endColumn], wholeCols: r.rangeType === 2 };
}

const MAX_DEPTH = 8;

export function addGroup(api: UniverAPI, doc: Y.Doc, unitId: string, axis: Axis, from: number, to: number): string | null {
  const ws = activeSheet(api, unitId);
  if (!ws) return 'No sheet';
  const sheetId = ws.getSheetId();
  const ids = idsOf(doc, sheetId, axis);
  if (to >= ids.length) return 'Out of range';
  const placed = placedGroups(doc, sheetId).filter((g) => g.axis === axis);
  if (placed.some((g) => g.from === from && g.to === to)) return 'These are already grouped';
  if (placed.some((g) => g.from <= from && g.to >= to && g.depth >= MAX_DEPTH - 1)) return `Groups can be nested ${MAX_DEPTH} deep`;
  // Overlapping without containing would make an ambiguous outline (Google merges them; we ask for a nesting).
  if (placed.some((g) => (from < g.from && to >= g.from && to < g.to) || (from > g.from && from <= g.to && to > g.to))) return 'A group must be inside or around another group';
  const id = crypto.randomUUID();
  groupsOf(doc).set(id, { id, sheetId, axis, start: ids[from], end: ids[to], collapsed: false });
  return null;
}

/** Removes the innermost group covering the selection on that axis (Google: Ungroup). */
export function removeGroup(api: UniverAPI, doc: Y.Doc, unitId: string, axis: Axis, from: number, to: number): boolean {
  const ws = activeSheet(api, unitId);
  if (!ws) return false;
  const hits = placedGroups(doc, ws.getSheetId())
    .filter((g) => g.axis === axis && g.from <= to && g.to >= from)
    .sort((a, b) => b.depth - a.depth);
  const g = hits[0];
  if (!g) return false;
  if (g.collapsed) setCollapsed(api, doc, unitId, g, false);
  groupsOf(doc).delete(g.id);
  return true;
}

export function setCollapsed(api: UniverAPI, doc: Y.Doc, unitId: string, g: PlacedGroup, collapsed: boolean) {
  const ws = (api.getWorkbook(unitId) as Any)?.getSheetBySheetId(g.sheetId);
  if (!ws) return;
  const n = g.to - g.from + 1;
  if (g.axis === 'rows') (collapsed ? ws.hideRows(g.from, n) : ws.showRows(g.from, n));
  else collapsed ? ws.hideColumns(g.from, n) : ws.showColumns(g.from, n);
  groupsOf(doc).set(g.id, { id: g.id, sheetId: g.sheetId, axis: g.axis, start: g.start, end: g.end, collapsed });
  // Expanding an outer group keeps the inner collapsed groups collapsed (like Google).
  if (!collapsed)
    for (const inner of placedGroups(doc, g.sheetId))
      if (inner.id !== g.id && inner.axis === g.axis && inner.collapsed && inner.from >= g.from && inner.to <= g.to)
        g.axis === 'rows' ? ws.hideRows(inner.from, inner.to - inner.from + 1) : ws.hideColumns(inner.from, inner.to - inner.from + 1);
}

export function setAll(api: UniverAPI, doc: Y.Doc, unitId: string, axis: Axis, collapsed: boolean) {
  const ws = activeSheet(api, unitId);
  if (!ws) return;
  const list = placedGroups(doc, ws.getSheetId()).filter((g) => g.axis === axis);
  // Outer groups first when expanding, inner first when collapsing.
  list.sort((a, b) => (collapsed ? b.depth - a.depth : a.depth - b.depth));
  for (const g of list) if (g.collapsed !== collapsed) setCollapsed(api, doc, unitId, g, collapsed);
}

/** Brackets and +/− buttons over the row and column headers of the active sheet. */
export function GroupGutter({ api, doc, unitId, editable }: { api: UniverAPI; doc: Y.Doc; unitId: string; editable: boolean }) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const bump = () => setTick((t) => t + 1);
    const m = groupsOf(doc);
    const sheets = doc.getMap(SHEETS_MAP);
    m.observe(bump);
    sheets.observeDeep(bump);
    const subs = [api.addEvent((api.Event as Any).Scroll, bump), api.addEvent(api.Event.CommandExecuted, (e: Any) => /set-worksheet-activ|row|col|zoom|hide|show|insert|remove|move/.test(e.id) && bump())];
    window.addEventListener('resize', bump);
    return () => {
      m.unobserve(bump);
      sheets.unobserveDeep(bump);
      subs.forEach((s) => s.dispose());
      window.removeEventListener('resize', bump);
    };
  }, [api, doc]);

  // A lane for the outline: wider row header / taller column header while the sheet has groups (each person
  // computes the same from the shared groups, so nothing about it needs syncing).
  useEffect(() => {
    try {
      const ws = activeSheet(api, unitId);
      if (!ws) return;
      const list = placedGroups(doc, ws.getSheetId());
      const depth = (axis: Axis) => Math.max(-1, ...list.filter((g) => g.axis === axis).map((g) => g.depth));
      const wantW = BASE_HEADER_W + (depth('rows') >= 0 ? LANE + depth('rows') * STEP : 0);
      const wantH = BASE_HEADER_H + (depth('cols') >= 0 ? LANE + depth('cols') * STEP : 0);
      const sk = ws.getSkeleton?.();
      if (sk && sk.rowHeaderWidth !== wantW) ws.setRowHeaderWidth(wantW);
      if (sk && sk.columnHeaderHeight !== wantH) ws.setColumnHeaderHeight(wantH);
    } catch {
      /* render services not ready yet: the next tick retries */
    }
  });
  // Univer's render services appear a little after the workbook: until then there is no geometry to read.
  useEffect(() => {
    if (!retry) return;
    const t = setTimeout(() => setTick((n) => n + 1), 300);
    return () => clearTimeout(t);
  });
  let retry = false;
  try {
    return draw();
  } catch {
    retry = true;
    return null;
  }

  function draw() {
  const ws = activeSheet(api, unitId);
  const host = typeof document !== 'undefined' ? (document.querySelector('.mo-univer') as HTMLElement | null) : null;
  if (!ws || !host) return null;
  const groups = placedGroups(doc, ws.getSheetId());
  if (!groups.length) return null;
  // Geometry: getCellRect is in sheet space relative to the grid canvas; subtract the scroll, apply the zoom.
  const canvas = [...host.querySelectorAll('canvas')].map((c) => c.getBoundingClientRect()).sort((a, b) => b.width * b.height - a.width * a.height)[0];
  const hostRect = host.getBoundingClientRect();
  if (!canvas) return null;
  const sk = ws.getSkeleton?.();
  const headW: number = sk?.rowHeaderWidth ?? 46;
  const headH: number = sk?.columnHeaderHeight ?? 20;
  const zoom: number = ws.getZoom?.() ?? 1;
  const scroll = ws.getScrollState?.() ?? { sheetViewStartRow: 0, sheetViewStartColumn: 0, offsetX: 0, offsetY: 0 };
  const rect = (r: number, c: number) => ws.getRange(r, c).getCellRect() as DOMRect;
  const scrollY = rect(scroll.sheetViewStartRow, 0).top - headH + scroll.offsetY;
  const scrollX = rect(0, scroll.sheetViewStartColumn).left - headW + scroll.offsetX;
  const ox = canvas.left - hostRect.left;
  const oy = canvas.top - hostRect.top;
  const y = (top: number) => oy + (top - scrollY) * zoom;
  const x = (left: number) => ox + (left - scrollX) * zoom;
  const maxRow = ws.getMaxRows() - 1;
  const maxCol = ws.getMaxColumns() - 1;
  void tick;

  const button = (g: PlacedGroup, left: number, top: number) => (
    <button
      key={`b-${g.id}`}
      disabled={!editable}
      onClick={() => setCollapsed(api, doc, unitId, g, !g.collapsed)}
      className="pointer-events-auto absolute flex size-[13px] items-center justify-center rounded-[3px] border border-slate-400 bg-white text-[11px] leading-none text-slate-600 hover:border-brand-500 hover:text-brand-600 disabled:cursor-default"
      style={{ left, top }}
      aria-label={`${g.collapsed ? 'Expand' : 'Collapse'} ${g.axis === 'rows' ? `rows ${g.from + 1}–${g.to + 1}` : `columns ${g.from + 1}–${g.to + 1}`}`}
      data-testid="group-toggle"
    >
      {g.collapsed ? '+' : '−'}
    </button>
  );

  return (
    <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden" style={{ clipPath: `inset(${oy}px 0 0 ${ox}px)` }} data-testid="group-gutter">
      {groups.map((g) => {
        if (g.axis === 'rows') {
          const gx = ox + 2 + g.depth * STEP;
          const top = y(rect(g.from, 0).top);
          const after = Math.min(g.to + 1, maxRow);
          const at = rect(after, 0);
          const bottom = y(rect(g.to, 0).top + rect(g.to, 0).height);
          const by = (g.to + 1 <= maxRow ? y(at.top) + (at.height * zoom) / 2 : bottom) - 6.5;
          return (
            <div key={g.id}>
              {!g.collapsed && <div className="absolute border-l-2 border-t-2 border-slate-400" style={{ left: gx + 5, top: top + 2, width: 5, height: Math.max(0, by - top - 2) }} />}
              {button(g, gx, by)}
            </div>
          );
        }
        const gy = oy + 2 + g.depth * STEP;
        const left = x(rect(0, g.from).left);
        const after = Math.min(g.to + 1, maxCol);
        const at = rect(0, after);
        const right = x(rect(0, g.to).left + rect(0, g.to).width);
        const bx = (g.to + 1 <= maxCol ? x(at.left) + (at.width * zoom) / 2 : right) - 6.5;
        return (
          <div key={g.id}>
            {!g.collapsed && <div className="absolute border-l-2 border-t-2 border-slate-400" style={{ left: left + 2, top: gy + 5, width: Math.max(0, bx - left - 2), height: 4 }} />}
            {button(g, bx, gy)}
          </div>
        );
      })}
    </div>
  );
  }
}
