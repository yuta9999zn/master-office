'use client';

import { useSyncExternalStore } from 'react';
import type * as Y from 'yjs';
import type { UniverAPI } from '../binding';
import { applyingMacro, runMacro } from './run';
import type { MacroEvent, MacroResult } from './runtime';
import type { MacroDef } from './store';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

// Simple triggers (Apps Script): a macro that defines onOpen(e), onEdit(e) or onSelectionChange(e) runs it
// automatically — in the browser of the person who opened / edited, as that person. docs/ARCHITECTURE.md §46.

export const TRIGGERS = ['onOpen', 'onEdit', 'onSelectionChange'] as const;
export type TriggerName = (typeof TRIGGERS)[number];
export const TRIGGER_LABEL: Record<TriggerName, string> = { onOpen: 'On open', onEdit: 'On edit', onSelectionChange: 'On selection change' };

export interface TriggerDef {
  key: string; // `${macroId}:${trigger}`
  macro: MacroDef;
  trigger: TriggerName;
}

/** Triggers declared in the macros' code (a top-level `function onEdit(e)` etc.). */
export function findTriggers(macros: MacroDef[]): TriggerDef[] {
  const out: TriggerDef[] = [];
  for (const m of macros)
    for (const t of TRIGGERS) if (new RegExp(`(^|\\n)\\s*(async\\s+)?function\\s+${t}\\s*\\(`).test(m.code)) out.push({ key: `${m.id}:${t}`, macro: m, trigger: t });
  return out;
}

// Turned-off triggers live in the workbook (map `macroSettings`), so turning one off applies to everyone.
const SETTINGS = 'macroSettings';
const disabledOf = (doc: Y.Doc) => (doc.getMap<string[]>(SETTINGS).get('disabledTriggers') ?? []) as string[];
export function setTriggerEnabled(doc: Y.Doc, key: string, on: boolean) {
  const cur = new Set(disabledOf(doc));
  if (on) cur.delete(key);
  else cur.add(key);
  doc.getMap<string[]>(SETTINGS).set('disabledTriggers', [...cur]);
}
const EMPTY: string[] = [];
const cache = new WeakMap<Y.Doc, { key: string; list: string[] }>();
export function useDisabledTriggers(doc: Y.Doc | null): string[] {
  return useSyncExternalStore(
    (cb) => {
      if (!doc) return () => undefined;
      const m = doc.getMap(SETTINGS);
      m.observe(cb);
      return () => m.unobserve(cb);
    },
    () => {
      if (!doc) return EMPTY;
      const list = disabledOf(doc);
      const key = list.join('|');
      const prev = cache.get(doc);
      if (prev && prev.key === key) return prev.list;
      cache.set(doc, { key, list });
      return list;
    },
    () => EMPTY,
  );
}

export interface Execution {
  id: string;
  at: string;
  macro: string;
  fn: string;
  trigger: TriggerName | 'manual';
  result: MacroResult;
}

type IRange = { startRow: number; endRow: number; startColumn: number; endColumn: number };
const plain = (v: unknown) => (v === undefined || v === null || v === '' ? null : typeof v === 'object' ? null : (v as string | number | boolean));

/**
 * Watches the grid for the current person's own edits and selection changes and runs the matching triggers,
 * one at a time (events that arrive meanwhile wait in a short queue). Edits that come from collaborators or from
 * a macro never fire triggers, so a trigger that writes to the sheet cannot loop.
 */
export class TriggerRunner {
  private subs: { dispose(): void }[] = [];
  private queue: { t: TriggerDef; event: MacroEvent }[] = [];
  private busy = false;
  private before = new Map<string, unknown>();
  private selTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly api: UniverAPI,
    private readonly unitId: string,
    private readonly opts: {
      triggers: () => TriggerDef[];
      user: { email: string; name: string };
      toast: (text: string) => void;
      onExecution: (e: Execution) => void;
    },
  ) {}

  start() {
    const ev = this.api.Event as Any;
    this.subs.push(this.api.addEvent(ev.BeforeCommandExecute, (e: Any) => this.remember(e)));
    this.subs.push(this.api.addEvent(ev.CommandExecuted, (e: Any) => this.on(e)));
  }

  destroy() {
    this.subs.forEach((s) => s.dispose());
    this.subs = [];
    this.queue = [];
    clearTimeout(this.selTimer);
  }

  /** onOpen: once, when the grid is ready. */
  open() {
    this.fire('onOpen', null);
  }

  private wb() {
    return this.api.getWorkbook(this.unitId) as Any;
  }

  private sheetName(subUnitId?: string) {
    const wb = this.wb();
    return (subUnitId ? wb?.getSheetBySheetId(subUnitId) : wb?.getActiveSheet())?.getSheetName() ?? null;
  }

  private local(e: Any) {
    return !(e.options?.fromCollab || (e.params?.unitId && e.params.unitId !== this.unitId) || applyingMacro());
  }

  /** The value of a single edited cell before the edit (e.oldValue). */
  private remember(e: Any) {
    if (e.id !== 'sheet.command.set-range-values' || !this.local(e)) return;
    const rg = this.rangeOf(e.params);
    if (!rg || rg.startRow !== rg.endRow || rg.startColumn !== rg.endColumn) return;
    const ws = e.params?.subUnitId ? this.wb()?.getSheetBySheetId(e.params.subUnitId) : this.wb()?.getActiveSheet();
    const raw = ws?.getSheet?.().getCellRaw(rg.startRow, rg.startColumn);
    this.before.set(`${e.params?.subUnitId}:${rg.startRow}:${rg.startColumn}`, raw?.v);
  }

  private rangeOf(p: Any): IRange | null {
    if (p?.range) return p.range;
    if (p?.ranges?.[0]) return p.ranges[0];
    // Typing into one cell: `value` is a { row: { col: cell } } matrix.
    const rows = p?.value && typeof p.value === 'object' && !('v' in p.value) && !('f' in p.value) ? Object.keys(p.value).map(Number) : [];
    if (!rows.length || rows.some(Number.isNaN)) return null;
    const cols = rows.flatMap((r) => Object.keys(p.value[r]).map(Number));
    return { startRow: Math.min(...rows), endRow: Math.max(...rows), startColumn: Math.min(...cols), endColumn: Math.max(...cols) };
  }

  private on(e: Any) {
    if (!this.local(e) || e.type === 2 /* mutation */) return;
    if (e.id === 'sheet.operation.set-selections') {
      clearTimeout(this.selTimer);
      const s = e.params?.selections?.find((x: Any) => x.primary) ?? e.params?.selections?.[0];
      const sheet = this.sheetName(e.params?.subUnitId);
      if (!s?.range || !sheet) return;
      const range = { sheet, r: s.range.startRow, c: s.range.startColumn, nr: s.range.endRow - s.range.startRow + 1, nc: s.range.endColumn - s.range.startColumn + 1 };
      this.selTimer = setTimeout(() => this.fire('onSelectionChange', range), 250);
      return;
    }
    if (!/^sheet\.command\.(set-range-values|clear-selection-content|clear-selection-all|delete-range-move-(left|up))$/.test(e.id)) return;
    const sheet = this.sheetName(e.params?.subUnitId);
    const wb = this.wb();
    const sel = wb?.getActiveSheet()?.getSelection?.()?.getActiveRange?.()?.getRange?.();
    const rg = this.rangeOf(e.params) ?? sel;
    if (!rg || !sheet) return;
    const range = { sheet, r: rg.startRow, c: rg.startColumn, nr: rg.endRow - rg.startRow + 1, nc: rg.endColumn - rg.startColumn + 1 };
    let value: MacroEvent['value'] = null;
    let oldValue: MacroEvent['oldValue'] = null;
    if (range.nr === 1 && range.nc === 1) {
      const ws = e.params?.subUnitId ? wb?.getSheetBySheetId(e.params.subUnitId) : wb?.getActiveSheet();
      value = plain(ws?.getSheet?.().getCellRaw(range.r, range.c)?.v);
      const k = `${e.params?.subUnitId}:${range.r}:${range.c}`;
      oldValue = plain(this.before.get(k));
      this.before.delete(k);
    }
    this.fire('onEdit', range, value, oldValue);
  }

  private fire(trigger: TriggerName, range: MacroEvent['range'], value: MacroEvent['value'] = null, oldValue: MacroEvent['oldValue'] = null) {
    const list = this.opts.triggers().filter((t) => t.trigger === trigger);
    if (!list.length) return;
    // Selection changes replace any waiting selection change; the queue stays short.
    if (trigger === 'onSelectionChange') this.queue = this.queue.filter((q) => q.t.trigger !== 'onSelectionChange');
    for (const t of list) if (this.queue.length < 20) this.queue.push({ t, event: { trigger, range, value, oldValue, user: this.opts.user } });
    void this.drain();
  }

  private async drain() {
    if (this.busy) return;
    this.busy = true;
    try {
      for (let next = this.queue.shift(); next; next = this.queue.shift()) {
        const { t, event } = next;
        const result = await runMacro(this.api, this.unitId, t.macro.code, t.trigger, this.opts.toast, event);
        this.opts.onExecution({ id: crypto.randomUUID(), at: new Date().toISOString(), macro: t.macro.name, fn: t.trigger, trigger: t.trigger, result });
      }
    } finally {
      this.busy = false;
    }
  }
}
