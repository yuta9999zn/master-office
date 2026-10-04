'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

// View → Show formulas (Ctrl+`), like Google Sheets: every formula cell displays its formula instead of the
// result. A per-person view setting — nothing is written to the workbook. docs/ARCHITECTURE.md §49.
// Implemented as a CELL_CONTENT interceptor (display only, effect = Value): the stored cell, editing, export
// and other people's views are untouched.

const KEY = 'mo:sheets-show-formulas';
const EFFECT_VALUE = 2; // InterceptorEffectEnum.Value

export function showFormulasPref(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

/** Installs the interceptor once per grid; returns a switch and a disposer. */
export function installShowFormulas(injector: Any, sheets: Any, api: Any, unitId: string) {
  let on = false;
  const interceptor = injector.get(sheets.SheetInterceptorService);
  const formulaOf = (pos: Any): string | null => {
    const raw = pos?.rawData;
    if (raw?.f) return raw.f;
    // Shared formulas (filled down) keep only an id in the cell: ask the range.
    if (raw?.si) return api.getWorkbook(unitId)?.getSheetBySheetId(pos.subUnitId)?.getRange(pos.row, pos.col)?.getFormula?.() || null;
    return null;
  };
  const disposable = interceptor.intercept(sheets.INTERCEPTOR_POINT.CELL_CONTENT, {
    effect: EFFECT_VALUE,
    priority: 1000,
    handler: (cell: Any, pos: Any, next: (c: Any) => Any) => {
      if (!on) return next(cell);
      const f = formulaOf(pos);
      // A text value shows as typed: no number format, left aligned.
      return f ? next({ ...cell, v: f, t: 1, s: cell?.s, ...(cell?.p ? { p: undefined } : {}) }) : next(cell);
    },
  });
  return {
    /** `repaint: false` while the grid is still being built (there is no canvas to refresh yet). */
    set(next: boolean, repaint = true) {
      on = next;
      try {
        localStorage.setItem(KEY, next ? '1' : '0');
      } catch {
        /* private mode */
      }
      if (!repaint) return;
      try {
        (api.getWorkbook(unitId) as Any)?.getActiveSheet()?.refreshCanvas?.();
      } catch (e) {
        console.warn('[sheets] show formulas: repaint', e);
      }
    },
    get: () => on,
    dispose: () => disposable.dispose(),
  };
}
