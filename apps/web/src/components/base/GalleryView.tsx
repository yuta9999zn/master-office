'use client';

import { defaultsForView, type BaseRecord, type BaseTable, type CellContext, type ViewConfig } from '@workos/base-model';
import type { UserSummary } from '@workos/shared';
import { Plus } from 'lucide-react';
import { useBaseActions } from '@/lib/base';
import { RecordCard } from './RecordCard';

/** Gallery (§75): records as cards, with the first picture of an attachment field as the cover. */
export function GalleryView({
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
  const covers = table.fields.filter((f) => f.type === 'attachment');
  const cover = covers.find((f) => f.id === config.coverField)?.id ?? null;
  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-canvas p-4" data-testid="gallery">
      {covers.length > 0 && (
        <label className="mb-3 flex items-center gap-2 text-[12.5px] text-muted">
          Cover
          <select value={cover ?? ''} onChange={(e) => setConfig({ coverField: e.target.value || null })} className="h-8 rounded-md border border-line-strong bg-surface px-2 text-[12.5px]" aria-label="Cover field">
            <option value="">None</option>
            {covers.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
        {records.map((r) => (
          <RecordCard key={r.id} baseId={baseId} table={table} config={config} record={r} ctx={ctx} cover={cover ?? undefined} max={5} onOpen={() => onOpen(r.id)} />
        ))}
        {editable && (
          <button
            onClick={() => a.createRecords.mutate({ tableId: table.id, records: [{ values: defaultsForView(table, { config }, me) }] }, { onSuccess: (rs) => onOpen(rs[0].id) })}
            className="flex min-h-[120px] items-center justify-center gap-1.5 rounded-lg border-2 border-dashed border-line-strong text-[13px] text-muted hover:bg-surface hover:text-ink"
            data-testid="gallery-add"
          >
            <Plus size={15} /> New record
          </button>
        )}
      </div>
    </div>
  );
}
