'use client';

import { PIVOT_AGGS, pivotFieldValues, pivotsMapOf, type PivotAgg, type SheetChartDef, type SheetPivotDef } from '@workos/sheet-model';
import { ArrowDownAZ, ArrowUpZA, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import type * as Y from 'yjs';
import { Button } from '../../ui/primitives';
import type { UniverAPI } from '../binding';
import { rangeFromA1 } from '../charts/chart-actions';
import { chartRangeA1 } from '../charts/SheetChart';
import { deletePivot, readPivotInput } from './pivot-engine';

function usePivot(doc: Y.Doc, id: string) {
  return useSyncExternalStore(
    (cb) => {
      const m = pivotsMapOf(doc);
      m.observe(cb);
      return () => m.unobserve(cb);
    },
    () => pivotsMapOf(doc).get(id),
    () => undefined,
  );
}

/** Re-reads the source when cells change (field names, filter values). */
function useDataTick(api: UniverAPI) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    const sub = api.addEvent(api.Event.CommandExecuted, (e: { id: string }) => {
      if (!/set-range-values|insert-|remove-|move-/.test(e.id)) return;
      clearTimeout(t);
      t = setTimeout(() => setTick((n) => n + 1), 300);
    });
    return () => (clearTimeout(t), sub.dispose());
  }, [api]);
  return tick;
}

function Section({ title, add, children }: { title: string; add: ReactNode; children: ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[12px] font-semibold uppercase tracking-wide text-subtle">{title}</span>
        {add}
      </div>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

const Card = ({ name, onRemove, children, testId }: { name: string; onRemove: () => void; children?: ReactNode; testId?: string }) => (
  <div className="rounded-lg border border-line bg-canvas px-2.5 py-2" data-testid={testId}>
    <div className="flex items-center gap-2">
      <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">{name}</span>
      <button onClick={onRemove} className="rounded p-0.5 text-muted hover:bg-hover" aria-label={`Remove ${name}`}>
        <X size={13} />
      </button>
    </div>
    {children}
  </div>
);

/** Pivot table editor (side panel), like Google Sheets: rows, columns, values, filters. */
export function PivotEditor({ doc, api, unitId, pivotId, editable, onClose }: { doc: Y.Doc; api: UniverAPI; unitId: string; pivotId: string; editable: boolean; onClose: () => void }) {
  const def = usePivot(doc, pivotId);
  const tick = useDataTick(api);
  const input = useMemo(() => (def ? readPivotInput(api, doc, unitId, def) : null), [def?.sheetId, def?.r0, def?.r1, def?.c0, def?.c1, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const [range, setRange] = useState('');
  const [rangeError, setRangeError] = useState<string | null>(null);
  useEffect(() => {
    if (def) setRange(chartRangeA1(doc, api, unitId, def as unknown as SheetChartDef));
  }, [def?.r0, def?.r1, def?.c0, def?.c1, def?.sheetId]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!def) return <p className="p-4 text-[13px] text-muted">This pivot table was deleted.</p>;
  const set = (patch: Partial<SheetPivotDef>) => pivotsMapOf(doc).set(pivotId, { ...def, ...patch });
  const fields = input ? [...input.names] : [];
  const name = (f: string) => input?.names.get(f) ?? '(deleted column)';
  const picker = (label: string, onPick: (field: string) => void, exclude: string[] = []) => (
    <select
      value=""
      onChange={(e) => e.target.value && onPick(e.target.value)}
      className="h-7 rounded-md border border-line bg-surface px-1.5 text-[12px] text-ink-2"
      aria-label={`Add ${label}`}
      data-testid={`pivot-add-${label.toLowerCase()}`}
    >
      <option value="">Add</option>
      {fields
        .filter(([id]) => !exclude.includes(id))
        .map(([id, n]) => (
          <option key={id} value={id}>
            {n}
          </option>
        ))}
    </select>
  );
  const groupCards = (key: 'rows' | 'columns') =>
    def[key].map((g, i) => (
      <Card key={g.field} name={name(g.field)} onRemove={() => set({ [key]: def[key].filter((_, j) => j !== i) })} testId={`pivot-${key}-item`}>
        <button
          onClick={() => set({ [key]: def[key].map((x, j) => (j === i ? { ...x, order: x.order === 'desc' ? 'asc' : 'desc' } : x)) })}
          className="mt-1 flex items-center gap-1 text-[12px] text-muted hover:text-ink"
        >
          {g.order === 'desc' ? <ArrowUpZA size={13} /> : <ArrowDownAZ size={13} />}
          {g.order === 'desc' ? 'Descending' : 'Ascending'}
        </button>
      </Card>
    ));
  const used = [...def.rows, ...def.columns].map((g) => g.field);
  return (
    <fieldset disabled={!editable} className="h-full space-y-4 overflow-y-auto p-4" data-testid="pivot-editor">
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
          aria-label="Pivot data range"
        />
        {rangeError && <span className="mt-1 block text-[12px] text-red-600">{rangeError}</span>}
      </label>
      <Section title="Rows" add={picker('Rows', (f) => set({ rows: [...def.rows, { field: f }] }), used)}>
        {groupCards('rows')}
      </Section>
      <Section title="Columns" add={picker('Columns', (f) => set({ columns: [...def.columns, { field: f }] }), used)}>
        {groupCards('columns')}
      </Section>
      <Section title="Values" add={picker('Values', (f) => set({ values: [...def.values, { field: f, agg: input?.records.some((r) => typeof r.get(f) === 'number') ? 'SUM' : 'COUNTA' }] }))}>
        {def.values.map((v, i) => (
          <Card key={`${v.field}-${i}`} name={name(v.field)} onRemove={() => set({ values: def.values.filter((_, j) => j !== i) })} testId="pivot-values-item">
            <label className="mt-1 flex items-center gap-2 text-[12px] text-muted">
              Summarize by
              <select
                value={v.agg}
                onChange={(e) => set({ values: def.values.map((x, j) => (j === i ? { ...x, agg: e.target.value as PivotAgg } : x)) })}
                className="h-7 rounded-md border border-line bg-surface px-1.5 text-[12px] text-ink-2"
                aria-label="Summarize by"
              >
                {PIVOT_AGGS.map((a) => (
                  <option key={a}>{a}</option>
                ))}
              </select>
            </label>
          </Card>
        ))}
      </Section>
      <Section title="Filters" add={picker('Filters', (f) => set({ filters: [...def.filters, { field: f, hidden: [] }] }), def.filters.map((f) => f.field))}>
        {def.filters.map((f, i) => {
          const values = input ? pivotFieldValues(input, f.field) : [];
          return (
            <Card key={f.field} name={name(f.field)} onRemove={() => set({ filters: def.filters.filter((_, j) => j !== i) })} testId="pivot-filters-item">
              <div className="mt-1 max-h-40 space-y-0.5 overflow-y-auto">
                {values.slice(0, 200).map((val) => (
                  <label key={val} className="flex cursor-pointer items-center gap-2 text-[12px] text-ink-2">
                    <input
                      type="checkbox"
                      checked={!f.hidden.includes(val)}
                      onChange={(e) => set({ filters: def.filters.map((x, j) => (j === i ? { ...x, hidden: e.target.checked ? x.hidden.filter((h) => h !== val) : [...x.hidden, val] } : x)) })}
                      className="size-3.5 accent-brand-600"
                    />
                    <span className="truncate">{val}</span>
                  </label>
                ))}
              </div>
            </Card>
          );
        })}
      </Section>
      <label className="flex cursor-pointer items-center gap-2 text-[13px] text-ink-2">
        <input type="checkbox" checked={def.totals !== false} onChange={(e) => set({ totals: e.target.checked })} className="size-4 accent-brand-600" />
        Show totals
      </label>
      <Button
        size="sm"
        variant="ghost"
        icon={<Trash2 size={14} />}
        className="text-red-600"
        onClick={() => {
          deletePivot(api, doc, unitId, pivotId);
          onClose();
        }}
      >
        Delete pivot table
      </Button>
    </fieldset>
  );
}
