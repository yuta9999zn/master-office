'use client';

import { SHEETS_MAP, ySheet } from '@workos/sheet-model';
import { Search, X } from 'lucide-react';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import * as Y from 'yjs';
import type { UniverAPI } from './binding';
import { dataRange } from './data-tools';
import { Button, cn } from '../ui/primitives';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

// Data → Filter views (Google Sheets). docs/ARCHITECTURE.md §51.
// A filter view is a saved, named filter that each person turns on for themselves: the rows it hides disappear
// only on that person's screen (ROW_FILTERED display interceptor), never for collaborators, never in the data.
// The definitions are shared (map `filterViews`) and stored by row / column ids so they follow inserts.

export interface FilterView {
  id: string;
  sheetId: string;
  name: string;
  r0: string; // header row id
  r1: string;
  c0: string;
  c1: string;
  /** Hidden values per column id (display text; '' = blanks). */
  hidden: Record<string, string[]>;
}

const MAP = 'filterViews';
export const filterViewsOf = (doc: Y.Doc) => doc.getMap<FilterView>(MAP);

function layout(doc: Y.Doc, sheetId: string) {
  const m = doc.getMap(SHEETS_MAP).get(sheetId) as Y.Map<unknown> | undefined;
  if (!m) return null;
  const ys = ySheet(m);
  return { rows: ys.rows.toArray(), cols: ys.cols.toArray() };
}

/** Current indices of a view (null when its edge rows / columns were deleted). */
export function viewRange(doc: Y.Doc, v: FilterView) {
  const l = layout(doc, v.sheetId);
  if (!l) return null;
  const r0 = l.rows.indexOf(v.r0);
  const r1 = l.rows.indexOf(v.r1);
  const c0 = l.cols.indexOf(v.c0);
  const c1 = l.cols.indexOf(v.c1);
  if (r0 < 0 || r1 < 0 || c0 < 0 || c1 < 0) return null;
  return { r0, r1, c0, c1, cols: l.cols };
}

const colName = (i: number) => {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};
export const viewA1 = (r: { r0: number; r1: number; c0: number; c1: number }) => `${colName(r.c0)}${r.r0 + 1}:${colName(r.c1)}${r.r1 + 1}`;

export function createFilterView(api: UniverAPI, doc: Y.Doc, unitId: string): FilterView | string {
  const d = dataRange(api, unitId);
  if (!d) return 'Select the data first';
  if (d.r.endRow <= d.r.startRow) return 'A filter view needs a header row and at least one row of data';
  const sheetId = d.ws.getSheetId();
  const l = layout(doc, sheetId);
  if (!l) return 'No sheet';
  const n = [...filterViewsOf(doc).values()].filter((v) => v.sheetId === sheetId).length + 1;
  const v: FilterView = { id: crypto.randomUUID(), sheetId, name: `Filter ${n}`, r0: l.rows[d.r.startRow], r1: l.rows[d.r.endRow], c0: l.cols[d.r.startColumn], c1: l.cols[d.r.endColumn], hidden: {} };
  filterViewsOf(doc).set(v.id, v);
  return v;
}

const text = (v: unknown) => (v === null || v === undefined ? '' : typeof v === 'boolean' ? (v ? 'TRUE' : 'FALSE') : String(v));

/** Rows (0-based) the view hides, header excluded. */
export function hiddenRows(api: UniverAPI, doc: Y.Doc, unitId: string, v: FilterView): Set<number> {
  const out = new Set<number>();
  const rg = viewRange(doc, v);
  const ws = (api.getWorkbook(unitId) as Any)?.getSheetBySheetId(v.sheetId)?.getSheet();
  if (!rg || !ws) return out;
  const rules = Object.entries(v.hidden)
    .filter(([, vals]) => vals.length)
    .map(([colId, vals]) => ({ c: rg.cols.indexOf(colId), vals: new Set(vals) }))
    .filter((x) => x.c >= rg.c0 && x.c <= rg.c1);
  if (!rules.length) return out;
  for (let r = rg.r0 + 1; r <= rg.r1; r++) if (rules.some(({ c, vals }) => vals.has(text(ws.getCellRaw(r, c)?.v)))) out.add(r);
  return out;
}

/** Installs the per-person row filter on the grid (one per grid); `set` takes the rows to hide on one sheet. */
export function installRowFilter(injector: Any, sheets: Any, api: Any, unitId: string) {
  let sheetId: string | null = null;
  let rows = new Set<number>();
  const interceptor = injector.get(sheets.SheetInterceptorService);
  // Runs before the sheet filter's own interceptor (which does not hand on), then hands on itself.
  const disposable = interceptor.intercept(sheets.INTERCEPTOR_POINT.ROW_FILTERED, {
    priority: 1000,
    handler: (filtered: boolean, pos: Any, next: (v: boolean) => boolean) => (sheetId && pos.subUnitId === sheetId && rows.has(pos.row) ? true : next(filtered)),
  });
  return {
    set(nextSheet: string | null, nextRows: Set<number>) {
      sheetId = nextSheet;
      rows = nextRows;
      try {
        const wb = api.getWorkbook(unitId);
        const ws = nextSheet ? wb?.getSheetBySheetId(nextSheet) : wb?.getActiveSheet();
        ws?.refreshCanvas?.();
      } catch (e) {
        console.warn('[sheets] filter view: repaint', e);
      }
    },
    dispose: () => disposable.dispose(),
  };
}

export function useFilterViews(doc: Y.Doc | null): FilterView[] {
  return useSyncExternalStore(
    (cb) => {
      if (!doc) return () => undefined;
      const m = filterViewsOf(doc);
      m.observeDeep(cb);
      return () => m.unobserveDeep(cb);
    },
    () => (doc ? listCache(doc) : EMPTY),
    () => EMPTY,
  );
}
const EMPTY: FilterView[] = [];
const caches = new WeakMap<Y.Doc, { key: string; list: FilterView[] }>();
function listCache(doc: Y.Doc) {
  const list = [...filterViewsOf(doc).values()].sort((a, b) => a.name.localeCompare(b.name));
  const key = JSON.stringify(list);
  const prev = caches.get(doc);
  if (prev?.key === key) return prev.list;
  caches.set(doc, { key, list });
  return list;
}

/** Keeps the grid's row filter in step with the active view, the data and the definition. */
export function useApplyFilterView(api: UniverAPI | null, doc: Y.Doc | null, unitId: string, view: FilterView | null, rowFilter: { set(s: string | null, r: Set<number>): void } | null) {
  useEffect(() => {
    if (!api || !doc || !rowFilter) return;
    const apply = () => rowFilter.set(view?.sheetId ?? null, view ? hiddenRows(api, doc, unitId, view) : new Set());
    apply();
    if (!view) return;
    // Values change → the hidden set changes (typed edits by anyone).
    const sheets = doc.getMap(SHEETS_MAP);
    let t: ReturnType<typeof setTimeout> | undefined;
    const soon = () => {
      clearTimeout(t);
      t = setTimeout(apply, 150);
    };
    sheets.observeDeep(soon);
    const sub = api.addEvent(api.Event.CommandExecuted, (e: Any) => /set-range-values|clear|insert|remove|move/.test(e.id) && soon());
    return () => {
      clearTimeout(t);
      sheets.unobserveDeep(soon);
      sub.dispose();
      rowFilter.set(null, new Set());
    };
  }, [api, doc, unitId, view, rowFilter]);
}

/** Side panel of the active filter view: name, range, filter by values per column. */
export function FilterViewPanel({ api, doc, unitId, view, editable, onClose }: { api: UniverAPI; doc: Y.Doc; unitId: string; view: FilterView; editable: boolean; onClose: () => void }) {
  const rg = viewRange(doc, view);
  const ws = (api.getWorkbook(unitId) as Any)?.getSheetBySheetId(view.sheetId)?.getSheet();
  const [col, setCol] = useState<number | null>(rg?.c0 ?? null);
  const [q, setQ] = useState('');
  const save = (patch: Partial<FilterView>) => filterViewsOf(doc).set(view.id, { ...view, ...patch });
  const values = useMemo(() => {
    if (!rg || !ws || col === null) return [] as { v: string; n: number }[];
    const counts = new Map<string, number>();
    for (let r = rg.r0 + 1; r <= rg.r1; r++) {
      const t = text(ws.getCellRaw(r, col)?.v);
      counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    return [...counts.entries()].map(([v, n]) => ({ v, n })).sort((a, b) => a.v.localeCompare(b.v, undefined, { numeric: true }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rg?.r0, rg?.r1, col, ws, view]);
  if (!rg || !ws) return <p className="p-4 text-[13px] text-muted">The range of this filter view was deleted.</p>;
  const colId = col !== null ? rg.cols[col] : null;
  const hidden = new Set(colId ? view.hidden[colId] ?? [] : []);
  const setHidden = (next: Set<string>) => colId && save({ hidden: { ...view.hidden, [colId]: [...next] } });
  const shown = values.filter((x) => (x.v || '(Blanks)').toLowerCase().includes(q.toLowerCase()));
  const headers = Array.from({ length: rg.c1 - rg.c0 + 1 }, (_, i) => ({ c: rg.c0 + i, label: text(ws.getCellRaw(rg.r0, rg.c0 + i)?.v) || colName(rg.c0 + i) }));
  return (
    <div className="flex h-full flex-col text-[13px]" data-testid="filter-view-panel">
      <div className="space-y-2 border-b border-line p-3">
        <label className="block">
          <span className="text-[12px] text-muted">Name</span>
          <input className="input mt-0.5 h-8 w-full" value={view.name} disabled={!editable} onChange={(e) => save({ name: e.target.value })} aria-label="Filter view name" />
        </label>
        <div className="text-[12px] text-muted">
          Range <span className="font-mono text-ink">{viewA1(rg)}</span>
        </div>
        <label className="block">
          <span className="text-[12px] text-muted">Column</span>
          <select className="input mt-0.5 h-8 w-full" value={col ?? ''} onChange={(e) => (setCol(Number(e.target.value)), setQ(''))} aria-label="Filter column">
            {headers.map((h) => (
              <option key={h.c} value={h.c}>
                {h.label}
                {(view.hidden[rg.cols[h.c]]?.length ?? 0) > 0 ? ' (filtered)' : ''}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="flex items-center gap-2 px-3 pt-2">
        <button className="text-[12px] font-medium text-brand-600 hover:underline disabled:opacity-40" disabled={!editable} onClick={() => setHidden(new Set())}>
          Select all
        </button>
        <button className="text-[12px] font-medium text-brand-600 hover:underline disabled:opacity-40" disabled={!editable} onClick={() => setHidden(new Set(values.map((x) => x.v)))}>
          Clear
        </button>
        <span className="ml-auto text-[12px] text-muted">{values.length - hidden.size} shown</span>
      </div>
      <div className="mx-3 mt-2 flex h-8 items-center gap-1.5 rounded-lg border border-line px-2">
        <Search size={13} className="text-subtle" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search values" className="flex-1 bg-transparent text-[12.5px] outline-none" aria-label="Search values" />
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto px-2 py-2" data-testid="filter-values">
        {shown.map((x) => (
          <li key={x.v}>
            <label className={cn('flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 hover:bg-hover', !editable && 'cursor-default')}>
              <input
                type="checkbox"
                checked={!hidden.has(x.v)}
                disabled={!editable}
                onChange={(e) => {
                  const next = new Set(hidden);
                  if (e.target.checked) next.delete(x.v);
                  else next.add(x.v);
                  setHidden(next);
                }}
                aria-label={x.v || '(Blanks)'}
              />
              <span className="min-w-0 flex-1 truncate">{x.v || <i className="text-muted">(Blanks)</i>}</span>
              <span className="text-[11px] text-muted">{x.n}</span>
            </label>
          </li>
        ))}
      </ul>
      <div className="flex gap-2 border-t border-line p-3">
        <Button size="sm" variant="ghost" disabled={!editable} onClick={() => (filterViewsOf(doc).delete(view.id), onClose())} data-testid="filter-view-delete">
          Delete view
        </Button>
        <Button size="sm" variant="primary" className="ml-auto" onClick={onClose}>
          Close view
        </Button>
      </div>
    </div>
  );
}

/** The dark bar Google shows above the grid while a filter view is on. */
export function FilterViewBar({ doc, view, onClose }: { doc: Y.Doc; view: FilterView; onClose: () => void }) {
  const rg = viewRange(doc, view);
  return (
    <div className="flex h-8 shrink-0 items-center gap-3 bg-slate-700 px-3 text-[12.5px] text-white" data-testid="filter-view-bar">
      <span className="text-slate-300">Filter view</span>
      <b className="font-medium">{view.name}</b>
      {rg && <span className="font-mono text-slate-300">{viewA1(rg)}</span>}
      <span className="text-slate-400">· only you see this filtering</span>
      <button onClick={onClose} className="ml-auto rounded p-1 hover:bg-slate-600" aria-label="Close filter view">
        <X size={14} />
      </button>
    </div>
  );
}
