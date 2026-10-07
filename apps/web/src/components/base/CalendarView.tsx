'use client';

import { cellValue, choiceOf, defaultsForView, recordTitle, type BaseRecord, type BaseTable, type CellContext, type ViewConfig } from '@workos/base-model';
import type { UserSummary } from '@workos/shared';
import { CalendarDays, ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { useState } from 'react';
import { useBaseActions } from '@/lib/base';
import { cn, EmptyState } from '../ui/primitives';

const pad = (n: number) => String(n).padStart(2, '0');
const key = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
/** The local day a stored date / date-time falls on. */
const dayOf = (v: string) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? v : key(new Date(v)));

/** Calendar (§75): records on the day of a date field; drag to another day, + to add one on a day. */
export function CalendarView({
  baseId,
  table,
  config,
  setConfig,
  records,
  ctx,
  editable,
  onOpen,
  me,
}: {
  baseId: string;
  table: BaseTable;
  config: ViewConfig;
  setConfig: (c: Partial<ViewConfig>) => void;
  records: BaseRecord[];
  ctx: CellContext & { users: UserSummary[] };
  editable: boolean;
  onOpen: (id: string) => void;
  me?: string;
}) {
  const a = useBaseActions(baseId);
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [drag, setDrag] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const field = table.fields.find((f) => f.id === config.dateField && ['date', 'createdTime', 'modifiedTime'].includes(f.type));
  const dates = table.fields.filter((f) => ['date', 'createdTime', 'modifiedTime'].includes(f.type));
  if (!field)
    return (
      <div className="flex-1 p-8">
        <EmptyState icon={<CalendarDays size={30} />} title="Choose the date field to show">
          {dates.length ? (
            <select onChange={(e) => e.target.value && setConfig({ dateField: e.target.value })} defaultValue="" className="mt-2 h-9 rounded-lg border border-line-strong px-2 text-[13px]" aria-label="Date field">
              <option value="">Date field…</option>
              {dates.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          ) : (
            'Add a date field to see records on a calendar.'
          )}
        </EmptyState>
      </div>
    );
  const movable = editable && field.type === 'date';
  const primary = table.fields.find((f) => f.id === table.primaryFieldId);
  // A single select colours the chips (the first one in the table).
  const tint = table.fields.find((f) => f.type === 'singleSelect');
  const byDay = new Map<string, BaseRecord[]>();
  for (const r of records) {
    const v = cellValue(field, r, ctx);
    if (typeof v !== 'string' || !v) continue;
    const d = dayOf(v);
    byDay.set(d, [...(byDay.get(d) ?? []), r]);
  }
  const first = new Date(month.getFullYear(), month.getMonth(), 1 - month.getDay());
  const days = Array.from({ length: 42 }, (_, i) => new Date(first.getFullYear(), first.getMonth(), first.getDate() + i));
  const today = key(new Date());
  const noDate = records.length - [...byDay.values()].reduce((n, l) => n + l.length, 0);
  const moveTo = (id: string, day: string) => {
    const r = records.find((x) => x.id === id);
    if (!r) return;
    const cur = r.values[field.id] as string | undefined;
    let next: string = day;
    if (field.options.includeTime && cur && !/^\d{4}-\d{2}-\d{2}$/.test(cur)) {
      // Same time of day, new day.
      const t = new Date(cur);
      const [y, m, d] = day.split('-').map(Number);
      next = new Date(y, m - 1, d, t.getHours(), t.getMinutes()).toISOString();
    }
    a.updateRecords.mutate({ tableId: table.id, records: [{ id, values: { [field.id]: next } }], ctx });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col p-4" data-testid="base-calendar">
      <div className="mb-2 flex items-center gap-2">
        <button onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} className="rounded p-1 hover:bg-hover" aria-label="Previous month">
          <ChevronLeft size={16} />
        </button>
        <span className="text-[15px] font-semibold text-ink" data-testid="calendar-month">
          {new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(month)}
        </span>
        <button onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} className="rounded p-1 hover:bg-hover" aria-label="Next month">
          <ChevronRight size={16} />
        </button>
        <button onClick={() => setMonth(new Date(new Date().getFullYear(), new Date().getMonth(), 1))} className="rounded-md px-2 py-1 text-[12.5px] ring-1 ring-line hover:bg-hover">
          Today
        </button>
        <span className="ml-auto text-[12px] text-muted">
          by {field.name}
          {noDate > 0 && ` · ${noDate} without a date`}
        </span>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-7 grid-rows-[auto_repeat(6,1fr)] overflow-hidden rounded-xl border border-line bg-surface">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
          <div key={d} className="border-b border-line px-2 py-1 text-[11.5px] font-medium text-muted">
            {d}
          </div>
        ))}
        {days.map((d) => {
          const k = key(d);
          const list = byDay.get(k) ?? [];
          const inMonth = d.getMonth() === month.getMonth();
          return (
            <div
              key={k}
              className={cn('group relative min-h-0 overflow-hidden border-b border-r border-line p-1', !inMonth && 'bg-canvas', over === k && 'bg-brand-50')}
              onDragOver={(e) => movable && drag && (e.preventDefault(), setOver(k))}
              onDragLeave={() => over === k && setOver(null)}
              onDrop={(e) => {
                e.preventDefault();
                if (drag) moveTo(drag, k);
                setDrag(null);
                setOver(null);
              }}
              data-testid="calendar-day"
              data-day={k}
            >
              <div className="flex items-center">
                <span className={cn('grid size-6 place-items-center rounded-full text-[12px]', k === today ? 'bg-brand-600 font-semibold text-white' : inMonth ? 'text-ink-2' : 'text-subtle')}>{d.getDate()}</span>
                {editable && field.type === 'date' && (
                  <button
                    onClick={() => a.createRecords.mutate({ tableId: table.id, records: [{ values: { ...defaultsForView(table, { config }, me), [field.id]: k } }] }, { onSuccess: (rs) => onOpen(rs[0].id) })}
                    className="ml-auto rounded p-0.5 text-muted opacity-0 hover:bg-hover group-hover:opacity-100"
                    aria-label={`Add a record on ${k}`}
                  >
                    <Plus size={13} />
                  </button>
                )}
              </div>
              <div className="mt-0.5 space-y-0.5">
                {list.slice(0, 4).map((r) => {
                  const c = tint ? choiceOf(tint, r.values[tint.id] as string) : undefined;
                  return (
                    <button
                      key={r.id}
                      draggable={movable}
                      onDragStart={(e) => (setDrag(r.id), e.dataTransfer.setData('text/plain', r.id))}
                      onDragEnd={() => (setDrag(null), setOver(null))}
                      onClick={() => onOpen(r.id)}
                      className={cn('block w-full truncate rounded px-1.5 py-0.5 text-left text-[12px] text-ink hover:brightness-95', drag === r.id && 'opacity-40')}
                      style={{ background: c?.color ?? '#dbeafe' }}
                      data-testid="calendar-chip"
                      data-title={recordTitle(primary, r, ctx)}
                    >
                      {recordTitle(primary, r, ctx) || 'Untitled'}
                    </button>
                  );
                })}
                {list.length > 4 && <span className="px-1 text-[11px] text-muted">+{list.length - 4} more</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
