'use client';

import { choiceOf, defaultsForView, type BaseRecord, type BaseTable, type CellContext, type ViewConfig } from '@workos/base-model';
import type { UserSummary } from '@workos/shared';
import { Columns3, Plus } from 'lucide-react';
import { useState } from 'react';
import { useBaseActions } from '@/lib/base';
import { cn, EmptyState } from '../ui/primitives';
import { ChoicePill } from './CellView';
import { RecordCard } from './RecordCard';

/** Kanban (§75): a column per option of a single-select field; drag cards between columns or within one. */
export function KanbanView({
  baseId,
  table,
  config,
  setConfig,
  records,
  ctx,
  editable,
  manualOrder,
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
  manualOrder: boolean;
  onOpen: (id: string) => void;
  me?: string;
}) {
  const a = useBaseActions(baseId);
  const [drag, setDrag] = useState<string | null>(null);
  const [over, setOver] = useState<{ col: string; before: string | null } | null>(null);
  const stack = table.fields.find((f) => f.id === config.stackField && f.type === 'singleSelect');
  const selects = table.fields.filter((f) => f.type === 'singleSelect');
  if (!stack)
    return (
      <div className="flex-1 p-8">
        <EmptyState icon={<Columns3 size={30} />} title="Choose the field that makes the columns">
          {selects.length ? (
            <select onChange={(e) => e.target.value && setConfig({ stackField: e.target.value })} defaultValue="" className="mt-2 h-9 rounded-lg border border-line-strong px-2 text-[13px]" aria-label="Stack by">
              <option value="">Single select field…</option>
              {selects.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          ) : (
            'Add a single select field (for example Status) to stack records by it.'
          )}
        </EmptyState>
      </div>
    );

  const cols = [{ id: '', name: `No ${stack.name}`, color: undefined as string | undefined }, ...(stack.options.choices ?? [])];
  const byCol = new Map(cols.map((c) => [c.id, [] as BaseRecord[]]));
  for (const r of records) {
    const v = (r.values[stack.id] as string | undefined) ?? '';
    (byCol.get(choiceOf(stack, v) ? v : '') ?? byCol.get('')!).push(r);
  }
  const drop = (col: string, before: string | null) => {
    if (!drag) return;
    const r = records.find((x) => x.id === drag);
    setDrag(null);
    setOver(null);
    if (!r) return;
    const cur = (r.values[stack.id] as string | undefined) ?? '';
    if (cur !== col) a.updateRecords.mutate({ tableId: table.id, records: [{ id: r.id, values: { [stack.id]: col || null } }], ctx });
    if (manualOrder) {
      const list = (byCol.get(col) ?? []).filter((x) => x.id !== r.id);
      const i = before ? list.findIndex((x) => x.id === before) : list.length;
      a.moveRecord.mutate({ tableId: table.id, id: r.id, afterId: list[i - 1]?.id ?? null, beforeId: list[i]?.id ?? null });
    }
  };

  return (
    <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto bg-canvas p-4" data-testid="kanban">
      {cols
        .filter((c) => c.id || byCol.get('')!.length)
        .map((c) => {
          const list = byCol.get(c.id)!;
          return (
            <section
              key={c.id || 'none'}
              className={cn('flex w-72 shrink-0 flex-col rounded-xl bg-hover/60', over?.col === c.id && 'ring-2 ring-brand-300')}
              onDragOver={(e) => {
                if (!drag) return;
                e.preventDefault();
                if (over?.col !== c.id || over.before !== null) setOver({ col: c.id, before: (e.target as HTMLElement).closest<HTMLElement>('[data-card]')?.dataset.card ?? null });
              }}
              onDrop={(e) => {
                e.preventDefault();
                drop(c.id, (e.target as HTMLElement).closest<HTMLElement>('[data-card]')?.dataset.card ?? null);
              }}
              data-testid="kanban-column"
              data-column={c.name}
            >
              <header className="flex items-center gap-2 px-3 pb-1 pt-2.5">
                {c.id ? <ChoicePill name={c.name} color={c.color} /> : <span className="text-[13px] font-medium text-muted">{c.name}</span>}
                <span className="text-[12px] text-muted">{list.length}</span>
              </header>
              <div className="min-h-[60px] flex-1 space-y-2 overflow-y-auto p-2">
                {list.map((r) => (
                  <div key={r.id} data-card={r.id}>
                    <RecordCard
                      baseId={baseId}
                      table={table}
                      config={config}
                      record={r}
                      ctx={ctx}
                      skip={[stack.id]}
                      onOpen={() => onOpen(r.id)}
                      draggable={editable}
                      onDragStart={(e) => (setDrag(r.id), e.dataTransfer.setData('text/plain', r.id))}
                      onDragEnd={() => (setDrag(null), setOver(null))}
                      dimmed={drag === r.id}
                    />
                  </div>
                ))}
              </div>
              {editable && (
                <button
                  onClick={() => a.createRecords.mutate({ tableId: table.id, records: [{ values: { ...defaultsForView(table, { config }, me), [stack.id]: c.id || null } }] }, { onSuccess: (rs) => onOpen(rs[0].id) })}
                  className="m-2 mt-0 flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[12.5px] text-muted hover:bg-surface hover:text-ink"
                  data-testid="kanban-add"
                >
                  <Plus size={14} /> New record
                </button>
              )}
            </section>
          );
        })}
    </div>
  );
}
