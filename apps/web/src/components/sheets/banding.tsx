'use client';

import { useSyncExternalStore } from 'react';
import { Check, Trash2 } from 'lucide-react';
import * as Y from 'yjs';
import type { UniverAPI } from './binding';
import { dataRange } from './data-tools';
import { Button, cn } from '../ui/primitives';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;
type IRange = { startRow: number; endRow: number; startColumn: number; endColumn: number };

// Format → Alternating colors (Google Sheets). docs/ARCHITECTURE.md §47.
// A banding is a set of conditional-format rules on the range — header row, two alternating bands, footer row —
// so it syncs, follows row inserts and exports to Excel like any conditional format. The `bandings` map only
// remembers which rules belong together and the chosen colours; the range itself is read back from the rules.

export interface BandColors {
  header: string;
  band1: string;
  band2: string;
  footer: string;
}
export interface Banding {
  id: string;
  sheetId: string;
  header: boolean;
  footer: boolean;
  colors: BandColors;
  /** Conditional-format rule ids by part. */
  cf: Partial<Record<keyof BandColors, string>>;
}

export const BAND_PRESETS: BandColors[] = [
  { header: '#BDBDBD', band1: '#FFFFFF', band2: '#F3F3F3', footer: '#DEDEDE' },
  { header: '#5B95F9', band1: '#FFFFFF', band2: '#E8F0FE', footer: '#ACC9FE' },
  { header: '#63D297', band1: '#FFFFFF', band2: '#E7F9EF', footer: '#AFE9CA' },
  { header: '#F7CB4D', band1: '#FFFFFF', band2: '#FEF8E3', footer: '#FCE8B2' },
  { header: '#F46524', band1: '#FFFFFF', band2: '#FFE6DD', footer: '#FFCCBB' },
  { header: '#46BDC6', band1: '#FFFFFF', band2: '#E4F7FB', footer: '#ADE2E7' },
  { header: '#7E57C2', band1: '#FFFFFF', band2: '#F1ECF8', footer: '#D1C4E9' },
  { header: '#E06666', band1: '#FFFFFF', band2: '#FCE8E6', footer: '#F4C7C3' },
];

const MAP = 'bandings';
export const bandingsOf = (doc: Y.Doc) => doc.getMap<Banding>(MAP);

const colName = (i: number) => {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};
export const a1 = (r: IRange) => `${colName(r.startColumn)}${r.startRow + 1}:${colName(r.endColumn)}${r.endRow + 1}`;

const sheetById = (api: UniverAPI, unitId: string, sheetId: string) => (api.getWorkbook(unitId) as Any)?.getSheetBySheetId(sheetId);

/** The banding's current range: the union of its rules' ranges (they move with inserted / deleted rows). */
export function bandingRange(api: UniverAPI, unitId: string, b: Banding): IRange | null {
  const ws = sheetById(api, unitId, b.sheetId);
  if (!ws) return null;
  const ids = new Set(Object.values(b.cf));
  const ranges = (ws.getConditionalFormattingRules() as Any[]).filter((r) => ids.has(r.cfId)).flatMap((r) => r.ranges as IRange[]);
  if (!ranges.length) return null;
  return {
    startRow: Math.min(...ranges.map((r) => r.startRow)),
    endRow: Math.max(...ranges.map((r) => r.endRow)),
    startColumn: Math.min(...ranges.map((r) => r.startColumn)),
    endColumn: Math.max(...ranges.map((r) => r.endColumn)),
  };
}

/** The banding that covers a cell, if any. */
export function bandingAt(api: UniverAPI, doc: Y.Doc, unitId: string, sheetId: string, row: number, col: number): Banding | null {
  for (const b of bandingsOf(doc).values()) {
    if (b.sheetId !== sheetId) continue;
    const r = bandingRange(api, unitId, b);
    if (r && row >= r.startRow && row <= r.endRow && col >= r.startColumn && col <= r.endColumn) return b;
  }
  return null;
}

function removeRules(ws: Any, b: Banding) {
  const existing = new Set((ws.getConditionalFormattingRules() as Any[]).map((r) => r.cfId));
  for (const id of Object.values(b.cf)) if (id && existing.has(id)) ws.deleteConditionalFormattingRule(id);
}

/**
 * (Re)writes the rules of a banding over `range`. Header and footer are single rows; the bands alternate from the
 * first data row, anchored with an absolute reference so inserting rows keeps the stripes regular.
 */
export function writeBanding(api: UniverAPI, doc: Y.Doc, unitId: string, b: Banding, range: IRange): Banding {
  const ws = sheetById(api, unitId, b.sheetId);
  if (!ws) return b;
  removeRules(ws, b);
  const head = b.header && range.endRow > range.startRow;
  const foot = b.footer && range.endRow - range.startRow > (head ? 1 : 0);
  const first = range.startRow + (head ? 1 : 0);
  const last = range.endRow - (foot ? 1 : 0);
  const anchor = `$${colName(range.startColumn)}$${first + 1}`;
  const rows = (r0: number, r1: number): IRange => ({ startRow: r0, endRow: r1, startColumn: range.startColumn, endColumn: range.endColumn });
  const add = (formula: string, color: string, r: IRange) => {
    const rule = ws.newConditionalFormattingRule().whenFormulaSatisfied(formula).setBackground(color).setRanges([r]).build();
    ws.addConditionalFormattingRule(rule);
    return rule.cfId as string;
  };
  const cf: Banding['cf'] = {};
  if (last >= first) {
    cf.band1 = add(`=ISEVEN(ROW()-ROW(${anchor}))`, b.colors.band1, rows(first, last));
    cf.band2 = add(`=ISODD(ROW()-ROW(${anchor}))`, b.colors.band2, rows(first, last));
  }
  if (head) cf.header = add('=TRUE', b.colors.header, rows(range.startRow, range.startRow));
  if (foot) cf.footer = add('=TRUE', b.colors.footer, rows(range.endRow, range.endRow));
  const next = { ...b, cf };
  bandingsOf(doc).set(b.id, next);
  return next;
}

export function removeBanding(api: UniverAPI, doc: Y.Doc, unitId: string, b: Banding) {
  const ws = sheetById(api, unitId, b.sheetId);
  if (ws) removeRules(ws, b);
  bandingsOf(doc).delete(b.id);
}

/**
 * Format → Alternating colors: edits the banding under the selection, or adds one over the selection (a single
 * selected cell means its data region), header on — like Google Sheets. Overlapping bandings are refused.
 */
export function openBanding(api: UniverAPI, doc: Y.Doc, unitId: string): { banding: Banding } | { error: string } {
  const ws = (api.getWorkbook(unitId) as Any)?.getActiveSheet();
  const sel = ws?.getSelection?.()?.getActiveRange?.()?.getRange?.() as IRange | undefined;
  if (!ws || !sel) return { error: 'Select a range first' };
  const sheetId = ws.getSheetId();
  const here = bandingAt(api, doc, unitId, sheetId, sel.startRow, sel.startColumn);
  if (here) return { banding: here };
  const d = dataRange(api, unitId);
  if (!d) return { error: 'Select a range first' };
  for (const b of bandingsOf(doc).values()) {
    const r = b.sheetId === sheetId ? bandingRange(api, unitId, b) : null;
    if (r && !(d.r.endRow < r.startRow || d.r.startRow > r.endRow || d.r.endColumn < r.startColumn || d.r.startColumn > r.endColumn))
      return { error: 'A range can only have one set of alternating colors' };
  }
  const b: Banding = { id: crypto.randomUUID(), sheetId, header: true, footer: false, colors: BAND_PRESETS[1], cf: {} };
  return { banding: writeBanding(api, doc, unitId, b, d.r) };
}

export function useBanding(doc: Y.Doc, id: string): Banding | null {
  return useSyncExternalStore(
    (cb) => {
      const m = bandingsOf(doc);
      m.observe(cb);
      return () => m.unobserve(cb);
    },
    () => bandingsOf(doc).get(id) ?? null,
  );
}

let colorTimer: ReturnType<typeof setTimeout> | undefined;

/** Side panel: range, header / footer, preset styles, custom colours, remove. */
export function BandingPanel({ api, doc, unitId, id, editable, onClose }: { api: UniverAPI; doc: Y.Doc; unitId: string; id: string; editable: boolean; onClose: () => void }) {
  const b = useBanding(doc, id);
  if (!b) return <p className="p-4 text-[13px] text-muted">These alternating colors were removed.</p>;
  const range = bandingRange(api, unitId, b);
  const update = (patch: Partial<Banding>) => range && writeBanding(api, doc, unitId, { ...b, ...patch }, range);
  // The colour picker fires while dragging: rewrite the rules once it settles.
  const updateSoon = (patch: Partial<Banding>) => {
    clearTimeout(colorTimer);
    colorTimer = setTimeout(() => update(patch), 250);
  };
  const same = (p: BandColors) => (Object.keys(p) as (keyof BandColors)[]).every((k) => p[k].toLowerCase() === b.colors[k].toLowerCase());
  return (
    <div className="space-y-4 p-4 text-[13px]" data-testid="banding-panel">
      <div>
        <div className="mb-1 text-[12px] font-medium text-muted">Apply to range</div>
        <div className="rounded-lg border border-line px-2.5 py-1.5 font-mono text-[12.5px] text-ink" data-testid="banding-range">
          {range ? a1(range) : '—'}
        </div>
      </div>
      <div className="flex gap-4">
        {(['header', 'footer'] as const).map((k) => (
          <label key={k} className="flex items-center gap-2">
            <input type="checkbox" checked={b[k]} disabled={!editable} onChange={(e) => update({ [k]: e.target.checked })} aria-label={k === 'header' ? 'Header' : 'Footer'} />
            {k === 'header' ? 'Header' : 'Footer'}
          </label>
        ))}
      </div>
      <div>
        <div className="mb-1.5 text-[12px] font-medium text-muted">Default styles</div>
        <div className="grid grid-cols-4 gap-2" data-testid="banding-presets">
          {BAND_PRESETS.map((p, i) => (
            <button key={i} disabled={!editable} onClick={() => update({ colors: p })} className={cn('relative overflow-hidden rounded-md border-2 transition', same(p) ? 'border-brand-500' : 'border-line hover:border-slate-300')} aria-label={`Style ${i + 1}`}>
              {[p.header, p.band1, p.band2, p.band1, p.footer].map((c, j) => (
                <div key={j} className="h-2" style={{ background: c }} />
              ))}
              {same(p) && <Check size={12} className="absolute right-0.5 top-0.5 rounded-full bg-white text-brand-600" />}
            </button>
          ))}
        </div>
      </div>
      <div>
        <div className="mb-1.5 text-[12px] font-medium text-muted">Custom style</div>
        <div className="space-y-1.5">
          {(['header', 'band1', 'band2', 'footer'] as const).map((k) => (
            <label key={k} className={cn('flex items-center justify-between', ((k === 'header' && !b.header) || (k === 'footer' && !b.footer)) && 'opacity-40')}>
              <span>{k === 'header' ? 'Header' : k === 'band1' ? 'Color 1' : k === 'band2' ? 'Color 2' : 'Footer'}</span>
              <input type="color" value={b.colors[k]} disabled={!editable} onChange={(e) => updateSoon({ colors: { ...b.colors, [k]: e.target.value.toUpperCase() } })} className="h-7 w-12 cursor-pointer rounded border border-line" aria-label={`${k} color`} />
            </label>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-2 border-t border-line pt-3">
        <Button size="sm" variant="ghost" icon={<Trash2 size={13} />} disabled={!editable} onClick={() => (removeBanding(api, doc, unitId, b), onClose())} data-testid="banding-remove">
          Remove alternating colors
        </Button>
        <Button size="sm" variant="primary" className="ml-auto" onClick={onClose}>
          Done
        </Button>
      </div>
    </div>
  );
}
