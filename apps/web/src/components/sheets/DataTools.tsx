'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button, Dialog } from '../ui/primitives';
import type { UniverAPI } from './binding';
import { columnStats, removeDuplicates, splitTextToColumns, type ColumnStats } from './data-tools';

const fmt = (n: number | null) => (n === null ? '—' : Number.isInteger(n) ? n.toLocaleString() : n.toLocaleString(undefined, { maximumFractionDigits: 4 }));

/** Column stats (side panel): follows the active cell and edits. */
export function ColumnStatsPanel({ api, unitId }: { api: UniverAPI; unitId: string }) {
  const [stats, setStats] = useState<ColumnStats | null>(() => columnStats(api, unitId));
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    const sub = api.addEvent(api.Event.CommandExecuted, () => {
      clearTimeout(t);
      t = setTimeout(() => setStats(columnStats(api, unitId)), 250);
    });
    return () => (clearTimeout(t), sub.dispose());
  }, [api, unitId]);
  if (!stats) return <p className="p-4 text-[13px] text-muted">Select a cell in a column.</p>;
  const row = (label: string, value: string) => (
    <div className="flex justify-between py-1 text-[13px]">
      <span className="text-muted">{label}</span>
      <span className="font-medium tabular-nums text-ink">{value}</span>
    </div>
  );
  const max = Math.max(1, ...stats.top.map((t) => t.count));
  return (
    <div className="space-y-4 overflow-y-auto p-4" data-testid="column-stats">
      <div className="text-[14px] font-semibold text-ink" data-testid="column-stats-label">
        Column {stats.label}
      </div>
      <div className="divide-y divide-line">
        {row('Rows', fmt(stats.rows))}
        {row('Empty', fmt(stats.empty))}
        {row('Unique values', fmt(stats.unique))}
        {row('Numbers', fmt(stats.numbers))}
        {stats.numbers > 0 && (
          <>
            {row('Sum', fmt(stats.sum))}
            {row('Average', fmt(stats.average))}
            {row('Median', fmt(stats.median))}
            {row('Min', fmt(stats.min))}
            {row('Max', fmt(stats.max))}
          </>
        )}
      </div>
      {stats.top.length > 0 && (
        <div>
          <div className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-subtle">Frequency</div>
          <div className="space-y-1.5">
            {stats.top.map((t) => (
              <div key={t.value} className="text-[12px]">
                <div className="flex justify-between gap-2">
                  <span className="truncate text-ink-2">{t.value}</span>
                  <span className="tabular-nums text-muted">{t.count}</span>
                </div>
                <div className="mt-0.5 h-1.5 rounded bg-hover">
                  <div className="h-1.5 rounded bg-brand-500" style={{ width: `${(t.count / max) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** "Remove duplicates" dialog: header row + which columns to compare. */
export function RemoveDuplicatesDialog({ api, unitId, open, onOpenChange }: { api: UniverAPI; unitId: string; open: boolean; onOpenChange: (v: boolean) => void }) {
  const [headerRow, setHeaderRow] = useState(true);
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Remove duplicates"
      description="Rows with the same values in the selection (or the whole data, when one cell is selected) are removed."
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            data-testid="remove-duplicates-confirm"
            onClick={() => {
              const res = removeDuplicates(api, unitId, { headerRow });
              onOpenChange(false);
              if (res) toast.success(`${res.removed} duplicate row${res.removed === 1 ? '' : 's'} removed, ${res.left} unique row${res.left === 1 ? '' : 's'} remain`);
            }}
          >
            Remove duplicates
          </Button>
        </>
      }
    >
      <label className="flex cursor-pointer items-center gap-2 text-[13px] text-ink-2">
        <input type="checkbox" checked={headerRow} onChange={(e) => setHeaderRow(e.target.checked)} className="size-4 accent-brand-600" />
        Data has header row
      </label>
    </Dialog>
  );
}

export function runSplit(api: UniverAPI, unitId: string, sep: string) {
  const res = splitTextToColumns(api, unitId, sep);
  if (!res) return void toast.error('Nothing to split: select a column of text');
  const name = { ',': 'comma', ';': 'semicolon', '.': 'period', ' ': 'space', '\t': 'tab', '|': 'pipe' }[res.separator] ?? `"${res.separator}"`;
  toast.success(`Split into ${res.columns} columns by ${name}`);
}
