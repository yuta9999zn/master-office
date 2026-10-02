'use client';

import type { UniverAPI } from '../binding';
import { macroWorker, type MacroCell, type MacroOp, type MacroResult, type MacroSnapshot } from './runtime';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

export const MACRO_TIMEOUT_MS = 30_000;
const SNAPSHOT_CELL_LIMIT = 400_000;

/** The workbook as the macro sees it: values, formulas, styles of the used range of every sheet. */
export function snapshotOf(api: UniverAPI, unitId: string): MacroSnapshot {
  const wb = api.getWorkbook(unitId) as Any;
  const styles = wb.getWorkbook?.().getStyles?.();
  let budget = SNAPSHOT_CELL_LIMIT;
  const sheets = wb.getSheets().map((ws: Any) => {
    const sheet = ws.getSheet();
    const cells: Record<string, MacroCell> = {};
    const lastRow = ws.getLastRow?.() ?? -1;
    const lastCol = ws.getLastColumn?.() ?? -1;
    for (let r = 0; r <= lastRow && budget > 0; r++) {
      for (let c = 0; c <= lastCol && budget > 0; c++) {
        const raw = sheet.getCellRaw(r, c);
        if (!raw) continue;
        budget--;
        const s = typeof raw.s === 'string' ? styles?.get?.(raw.s) : raw.s;
        const v = raw.t === 3 ? raw.v === 1 || raw.v === true || raw.v === 'TRUE' : raw.v;
        const cell: MacroCell = {};
        if (v !== undefined && v !== null && v !== '') cell.v = v;
        if (raw.f) cell.f = raw.f;
        if (s && Object.keys(s).length) cell.s = s;
        if (Object.keys(cell).length) cells[`${r}:${c}`] = cell;
      }
    }
    const cfg = sheet.getConfig();
    return {
      name: ws.getSheetName(),
      maxRows: ws.getMaxRows(),
      maxCols: ws.getMaxColumns(),
      frozenRows: cfg.freeze?.ySplit ?? 0,
      frozenCols: cfg.freeze?.xSplit ?? 0,
      cells,
    };
  });
  const active = wb.getActiveSheet();
  const sel = active?.getSelection?.()?.getActiveRange?.()?.getRange?.();
  return {
    name: wb.getName?.() ?? 'Spreadsheet',
    active: active?.getSheetName() ?? sheets[0]?.name,
    selection: sel ? { sheet: active.getSheetName(), r: sel.startRow, c: sel.startColumn, nr: sel.endRow - sel.startRow + 1, nc: sel.endColumn - sel.startColumn + 1 } : null,
    sheets,
  };
}

let workerUrl: string | null = null;

/** Runs a macro in a fresh sandboxed worker; never resolves later than the timeout. */
export function runInWorker(code: string, fn: string | null, snapshot: MacroSnapshot, timeoutMs = MACRO_TIMEOUT_MS): Promise<MacroResult> {
  workerUrl ??= URL.createObjectURL(new Blob([`(${macroWorker.toString()})();`], { type: 'text/javascript' }));
  const worker = new Worker(workerUrl);
  const t0 = performance.now();
  return new Promise((resolve) => {
    const done = (r: MacroResult) => {
      clearTimeout(timer);
      worker.terminate();
      resolve(r);
    };
    const timer = setTimeout(() => done({ ok: false, ops: [], logs: [], error: `Exceeded maximum execution time (${timeoutMs / 1000} s) — the macro was stopped and nothing was changed`, ms: timeoutMs }), timeoutMs);
    worker.onmessage = (e: MessageEvent<MacroResult>) => done(e.data);
    worker.onerror = (e) => done({ ok: false, ops: [], logs: [], error: e.message || 'The macro crashed', ms: performance.now() - t0 });
    worker.postMessage({ code, fn, snapshot });
  });
}

// ── Applying the ops through Univer (synced to everyone by the Yjs binding) ──

const cellData = (c: MacroCell | null) => {
  if (!c) return { v: null, f: null, si: null };
  if (c.f) return { f: c.f, v: null, si: null };
  const out: Any = { v: c.v ?? null, f: null, si: null };
  if (typeof c.v === 'number') out.t = 2;
  else if (typeof c.v === 'boolean') {
    out.v = c.v ? 1 : 0;
    out.t = 3;
  } else if (typeof c.v === 'string') out.t = 1;
  if (c.s) out.s = c.s;
  return out;
};

export function applyOps(api: UniverAPI, unitId: string, ops: MacroOp[], toast: (text: string) => void) {
  const wb = api.getWorkbook(unitId) as Any;
  const ws = (name?: string) => {
    const s = name ? wb.getSheetByName(name) : wb.getActiveSheet();
    if (!s) throw new Error(`Sheet "${name}" not found while applying the macro`);
    return s;
  };
  const range = (o: MacroOp) => ws(o.sheet).getRange(o.r, o.c, o.nr ?? 1, o.nc ?? 1);
  for (const o of ops) {
    switch (o.op) {
      case 'cells': {
        const rows = o.rows as (MacroCell | null)[][];
        const nc = Math.max(1, ...rows.map((r) => r.length));
        ws(o.sheet).getRange(o.r, o.c, rows.length, nc).setValues(rows.map((row) => Array.from({ length: nc }, (_, j) => cellData(row[j] ?? null))));
        break;
      }
      case 'style': {
        const rg = range(o);
        const v = o.value;
        if (o.kind === 'background') v ? rg.setBackground(v) : rg.setBackground('#ffffff');
        else if (o.kind === 'fontColor') rg.setFontColor(v ?? '#000000');
        else if (o.kind === 'fontWeight') rg.setFontWeight(v === 'bold' ? 'bold' : 'normal');
        else if (o.kind === 'fontStyle') rg.setFontStyle(v === 'italic' ? 'italic' : 'normal');
        else if (o.kind === 'fontLine') rg.setFontLine(v === 'underline' || v === 'line-through' ? v : 'none');
        else if (o.kind === 'fontSize') rg.setFontSize(Number(v));
        else if (o.kind === 'fontFamily') rg.setFontFamily(String(v));
        else if (o.kind === 'hAlign') rg.setHorizontalAlignment(v === 'center' || v === 'right' ? v : 'left');
        else if (o.kind === 'vAlign') rg.setVerticalAlignment(v === 'top' || v === 'middle' ? v : 'bottom');
        else if (o.kind === 'wrap') rg.setWrap(!!v);
        else if (o.kind === 'numberFormat') rg.setNumberFormat?.(String(v));
        break;
      }
      case 'clear':
        if (o.what === 'format') range(o).clearFormat();
        else if (o.what === 'content') range(o).clearContent();
        else range(o).clear();
        break;
      case 'border': {
        // Google signature: true = set, false = remove, null = unchanged.
        const rg = range(o);
        const style = api.Enum?.BorderStyleTypes?.THIN ?? 1;
        const set = (type: string, on: boolean | null) => on !== null && rg.setBorder(api.Enum?.BorderType?.[type] ?? type.toLowerCase(), on ? style : api.Enum?.BorderStyleTypes?.NONE ?? 0, o.color);
        set('TOP', o.top);
        set('LEFT', o.left);
        set('BOTTOM', o.bottom);
        set('RIGHT', o.right);
        set('VERTICAL', o.vertical);
        set('HORIZONTAL', o.horizontal);
        break;
      }
      case 'merge':
        range(o).merge();
        break;
      case 'unmerge':
        range(o).breakApart();
        break;
      case 'insertRows':
        ws(o.sheet).insertRowsBefore(o.at, o.n);
        break;
      case 'deleteRows':
        ws(o.sheet).deleteRows(o.at, o.n);
        break;
      case 'insertCols':
        ws(o.sheet).insertColumnsBefore(o.at, o.n);
        break;
      case 'deleteCols':
        ws(o.sheet).deleteColumns(o.at, o.n);
        break;
      case 'hideRows':
        ws(o.sheet).hideRows(o.at, o.n);
        break;
      case 'showRows':
        ws(o.sheet).showRows(o.at, o.n);
        break;
      case 'hideCols':
        ws(o.sheet).hideColumns(o.at, o.n);
        break;
      case 'showCols':
        ws(o.sheet).showColumns(o.at, o.n);
        break;
      case 'colWidth':
        ws(o.sheet).setColumnWidth(o.c, o.w);
        break;
      case 'rowHeight':
        ws(o.sheet).setRowHeight(o.r, o.h);
        break;
      case 'freeze':
        ws(o.sheet).setFrozenRows(o.rows ?? 0);
        ws(o.sheet).setFrozenColumns(o.cols ?? 0);
        break;
      case 'tabColor':
        ws(o.sheet).setTabColor(o.color);
        break;
      case 'renameSheet':
        ws(o.sheet).setName(o.name);
        break;
      case 'insertSheet': {
        const s = wb.insertSheet(o.name);
        if (o.index !== null && o.index !== undefined) wb.moveSheet(s, o.index);
        wb.setActiveSheet(s);
        break;
      }
      case 'deleteSheet':
        wb.deleteSheet(ws(o.sheet));
        break;
      case 'activate':
        wb.setActiveSheet(ws(o.sheet));
        break;
      case 'select':
        wb.setActiveSheet(ws(o.sheet));
        range(o).activate();
        break;
      case 'toast':
        toast(String(o.text));
        break;
    }
  }
}

/** Runs a macro end-to-end: snapshot → sandboxed worker → apply changes (also those made before an error). */
export async function runMacro(api: UniverAPI, unitId: string, code: string, fn: string | null, toast: (text: string) => void) {
  const result = await runInWorker(code, fn, snapshotOf(api, unitId));
  let applyError: string | null = null;
  try {
    applyOps(api, unitId, result.ops, toast);
  } catch (e) {
    applyError = (e as Error).message;
  }
  return { ...result, error: result.error ?? applyError, ok: result.ok && !applyError };
}
