'use client';

import { chartsMapOf, type SheetChartDef } from '@workos/sheet-model';
import { ChartArea, ChartBar, ChartColumn, ChartLine, ChartPie, CircleDot, Trash2 } from 'lucide-react';
import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import type * as Y from 'yjs';
import { Button, cn } from '../../ui/primitives';
import type { UniverAPI } from '../binding';
import { deleteChart, rangeFromA1 } from './chart-actions';
import { chartRangeA1 } from './SheetChart';

const KINDS: { kind: SheetChartDef['kind']; label: string; icon: ReactNode }[] = [
  { kind: 'column', label: 'Column', icon: <ChartColumn size={16} /> },
  { kind: 'bar', label: 'Bar', icon: <ChartBar size={16} /> },
  { kind: 'line', label: 'Line', icon: <ChartLine size={16} /> },
  { kind: 'area', label: 'Area', icon: <ChartArea size={16} /> },
  { kind: 'pie', label: 'Pie', icon: <ChartPie size={16} /> },
  { kind: 'doughnut', label: 'Doughnut', icon: <CircleDot size={16} /> },
];

function useChart(doc: Y.Doc, id: string) {
  return useSyncExternalStore(
    (cb) => {
      const m = chartsMapOf(doc);
      m.observe(cb);
      return () => m.unobserve(cb);
    },
    () => chartsMapOf(doc).get(id),
    () => undefined,
  );
}

/** Chart editor (side panel): type, data range, labels, legend, orientation. */
export function ChartEditor({ doc, api, unitId, chartId, editable, onClose }: { doc: Y.Doc; api: UniverAPI; unitId: string; chartId: string; editable: boolean; onClose: () => void }) {
  const def = useChart(doc, chartId);
  const [range, setRange] = useState('');
  const [rangeError, setRangeError] = useState<string | null>(null);
  useEffect(() => {
    if (def) setRange(chartRangeA1(doc, api, unitId, def));
  }, [def?.r0, def?.r1, def?.c0, def?.c1, def?.sheetId]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!def) return <p className="p-4 text-[13px] text-muted">This chart was deleted.</p>;
  const set = (patch: Partial<SheetChartDef>) => chartsMapOf(doc).set(chartId, { ...def, ...patch });
  const toggle = (k: 'legend' | 'labels' | 'headerRow' | 'headerCol' | 'byRow', label: string, fallback: boolean) => (
    <label className="flex cursor-pointer items-center gap-2 text-[13px] text-ink-2">
      <input type="checkbox" checked={def[k] ?? fallback} onChange={(e) => set({ [k]: e.target.checked })} className="size-4 accent-brand-600" />
      {label}
    </label>
  );
  return (
    <fieldset disabled={!editable} className="space-y-4 p-4" data-testid="chart-editor">
      <div>
        <div className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-subtle">Chart type</div>
        <div className="grid grid-cols-3 gap-1.5">
          {KINDS.map((k) => (
            <button key={k.kind} onClick={() => set({ kind: k.kind })} className={cn('flex h-9 items-center justify-center gap-1.5 rounded-lg border text-[12px]', def.kind === k.kind ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-line text-ink-2 hover:bg-hover')} aria-label={k.label}>
              {k.icon}
              {k.label}
            </button>
          ))}
        </div>
      </div>
      <label className="block text-[13px] text-ink-2">
        Data range
        <input
          value={range}
          onChange={(e) => setRange(e.target.value)}
          onBlur={() => {
            const r = rangeFromA1(api, doc, unitId, range, def.sheetId);
            if (!r) return setRangeError('Use a range like Sheet1!A1:D10');
            setRangeError(null);
            set(r);
          }}
          className="input mt-1 h-9 font-mono text-[13px]"
          aria-label="Data range"
          data-testid="chart-range"
        />
        {rangeError && <span className="mt-1 block text-[12px] text-red-600">{rangeError}</span>}
      </label>
      <label className="block text-[13px] text-ink-2">
        Title
        <input value={def.title ?? ''} onChange={(e) => set({ title: e.target.value || undefined })} className="input mt-1 h-9 text-[13px]" aria-label="Chart title" placeholder="Chart title" />
      </label>
      <div className="space-y-2">
        {toggle('headerRow', 'Use row 1 as headers', true)}
        {toggle('headerCol', 'Use column A as labels', true)}
        {toggle('byRow', 'Switch rows / columns', false)}
        {toggle('legend', 'Legend', true)}
        {toggle('labels', 'Data labels', false)}
      </div>
      <Button
        size="sm"
        variant="ghost"
        icon={<Trash2 size={14} />}
        className="text-red-600"
        onClick={() => {
          deleteChart(api, doc, unitId, chartId);
          onClose();
        }}
      >
        Delete chart
      </Button>
    </fieldset>
  );
}
