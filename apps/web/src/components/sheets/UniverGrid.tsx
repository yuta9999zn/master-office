'use client';

import '@univerjs/preset-sheets-core/lib/index.css';
import '@univerjs/preset-sheets-filter/lib/index.css';
import '@univerjs/preset-sheets-sort/lib/index.css';
import '@univerjs/preset-sheets-conditional-formatting/lib/index.css';
import '@univerjs/preset-sheets-data-validation/lib/index.css';
import '@univerjs/preset-sheets-find-replace/lib/index.css';
import '@univerjs/preset-sheets-hyper-link/lib/index.css';

import { hasWorkbook } from '@workos/sheet-model';
import { useEffect, useRef, useState } from 'react';
import type * as Y from 'yjs';
import { SheetBinding, type UniverAPI } from './binding';

export interface GridHandle {
  api: UniverAPI;
  binding: SheetBinding;
  /** Stored value of a cell (not the number-formatted display), booleans as booleans — used by tests. */
  value: (sheet: string, a1: string) => unknown;
}

const rawValue = (api: UniverAPI, unitId: string) => (sheet: string, a1: string) => {
  const ws = api.getWorkbook(unitId)?.getSheetByName(sheet);
  const range = ws?.getRange(a1);
  // getCellRaw skips the display interceptors (number formats), unlike FRange.getValue().
  const cell = range && ws.getSheet().getCellRaw(range.getRow(), range.getColumn());
  if (!cell || cell.v === undefined || cell.v === null) return null;
  return cell.t === 3 ? cell.v === true || cell.v === 1 || cell.v === 'TRUE' : cell.v;
};

/**
 * Univer workbook bound to the collaborative Y.Doc. Loaded on the client only (Univer needs the DOM),
 * and only after the first sync so the workbook the server created is there.
 */
export function UniverGrid({
  unitId,
  doc,
  synced,
  editable,
  onReady,
}: {
  unitId: string;
  doc: Y.Doc;
  synced: boolean;
  editable: boolean;
  onReady?: (h: GridHandle | null) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'empty' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!synced || !host.current) return;
    if (!hasWorkbook(doc)) {
      setState('empty');
      return;
    }
    let disposed = false;
    let cleanup: (() => void) | null = null;
    (async () => {
      try {
        const [presets, core, filter, sort, cf, dv, fr, link, enCore, enFilter, enSort, enCf, enDv, enFr, enLink] = await Promise.all([
          import('@univerjs/presets'),
          import('@univerjs/preset-sheets-core'),
          import('@univerjs/preset-sheets-filter'),
          import('@univerjs/preset-sheets-sort'),
          import('@univerjs/preset-sheets-conditional-formatting'),
          import('@univerjs/preset-sheets-data-validation'),
          import('@univerjs/preset-sheets-find-replace'),
          import('@univerjs/preset-sheets-hyper-link'),
          import('@univerjs/preset-sheets-core/locales/en-US'),
          import('@univerjs/preset-sheets-filter/locales/en-US'),
          import('@univerjs/preset-sheets-sort/locales/en-US'),
          import('@univerjs/preset-sheets-conditional-formatting/locales/en-US'),
          import('@univerjs/preset-sheets-data-validation/locales/en-US'),
          import('@univerjs/preset-sheets-find-replace/locales/en-US'),
          import('@univerjs/preset-sheets-hyper-link/locales/en-US'),
        ]);
        if (disposed || !host.current) return;
        const { createUniver, LocaleType, mergeLocales } = presets;
        const { univer, univerAPI } = createUniver({
          locale: LocaleType.EN_US,
          locales: {
            [LocaleType.EN_US]: mergeLocales(enCore.default, enFilter.default, enSort.default, enCf.default, enDv.default, enFr.default, enLink.default),
          },
          presets: [
            core.UniverSheetsCorePreset({
              container: host.current,
              ribbonType: 'classic',
              sheets: { disableForceStringMark: true },
              // Formulas are always recalculated on open, like Excel with "fullCalcOnLoad".
              formula: { initialFormulaComputing: 0 as never },
              // Sheet tabs live above the grid (SheetTabs, Lark style), not in Univer's bottom bar.
              footer: { sheetBar: false, statisticBar: true, menus: true, zoomSlider: true } as never,
            }),
            filter.UniverSheetsFilterPreset(),
            sort.UniverSheetsSortPreset(),
            cf.UniverSheetsConditionalFormattingPreset(),
            dv.UniverSheetsDataValidationPreset(),
            fr.UniverSheetsFindReplacePreset(),
            link.UniverSheetsHyperLinkPreset(),
          ],
        });
        const binding = new SheetBinding(univerAPI, doc, unitId, {
          editable,
          onError: (e) => console.error('[sheets] binding', e),
        });
        binding.start();
        const handle = { api: univerAPI, binding, value: rawValue(univerAPI, unitId) };
        (window as unknown as { __moSheet?: GridHandle }).__moSheet = handle; // e2e hooks (formula parity tests)
        onReady?.(handle);
        setState('ready');
        cleanup = () => {
          onReady?.(null);
          binding.destroy();
          univer.dispose();
          delete (window as unknown as { __moSheet?: GridHandle }).__moSheet;
        };
      } catch (e) {
        console.error(e);
        setError((e as Error).message);
        setState('error');
      }
    })();
    return () => {
      disposed = true;
      cleanup?.();
    };
  }, [synced, doc, unitId, editable]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="relative h-full w-full">
      <div ref={host} className="mo-univer absolute inset-0" />
      {state === 'loading' && <div className="absolute inset-0 flex items-center justify-center bg-surface text-[13px] text-muted">Loading spreadsheet…</div>}
      {state === 'empty' && (
        <div className="absolute inset-0 flex items-center justify-center bg-surface text-[13px] text-muted">This spreadsheet has no content yet — it may still be importing.</div>
      )}
      {state === 'error' && <div className="absolute inset-0 flex items-center justify-center bg-surface text-[13px] text-red-600">Could not start the spreadsheet engine: {error}</div>}
    </div>
  );
}
