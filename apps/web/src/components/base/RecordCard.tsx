'use client';

import { cellValue, isEmptyValue, recordTitle, visibleFields, type Attachment, type BaseRecord, type BaseTable, type CellContext, type ViewConfig } from '@workos/base-model';
import type { UserSummary } from '@workos/shared';
import { MessageSquare } from 'lucide-react';
import { attachmentUrl } from '@/lib/base';
import { cn } from '../ui/primitives';
import { CellView } from './CellView';
import { FieldIcon } from './field-meta';

/** A record as a card (kanban, gallery): cover picture, title, the view's shown fields. */
export function RecordCard({
  baseId,
  table,
  config,
  record,
  ctx,
  cover,
  skip = [],
  max = 4,
  onOpen,
  draggable,
  onDragStart,
  onDragEnd,
  dimmed,
}: {
  baseId: string;
  table: BaseTable;
  config: ViewConfig;
  record: BaseRecord;
  ctx: CellContext & { users: UserSummary[] };
  cover?: string | null;
  skip?: string[];
  max?: number;
  onOpen: () => void;
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  onDragEnd?: () => void;
  dimmed?: boolean;
}) {
  const primary = table.fields.find((f) => f.id === table.primaryFieldId);
  const title = recordTitle(primary, record, ctx);
  const shown = visibleFields(table, { config })
    .filter((f) => f.id !== table.primaryFieldId && !skip.includes(f.id) && f.id !== cover)
    .map((f) => ({ f, v: cellValue(f, record, ctx) }))
    .filter(({ v }) => !isEmptyValue(v))
    .slice(0, max);
  const pic = cover ? ((record.values[cover] as Attachment[] | undefined) ?? []).find((a) => a.mime.startsWith('image/')) : undefined;
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => e.key === 'Enter' && onOpen()}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={cn('cursor-pointer overflow-hidden rounded-lg bg-surface text-left shadow-sm ring-1 ring-line transition hover:shadow-md hover:ring-line-strong', dimmed && 'opacity-40')}
      data-testid="record-card"
      data-title={title}
    >
      {cover !== undefined && (
        <div className="grid h-32 place-items-center bg-canvas">
          {pic ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={attachmentUrl(baseId, pic)} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="text-[12px] text-subtle">No picture</span>
          )}
        </div>
      )}
      <div className="space-y-1.5 p-2.5">
        <p className={cn('text-[13.5px] font-medium', title ? 'text-ink' : 'text-subtle')}>{title || 'Untitled'}</p>
        {shown.map(({ f, v }) => (
          <div key={f.id} className="flex min-w-0 items-center gap-1.5 text-[12.5px] text-ink-2" title={f.name}>
            <FieldIcon type={f.type} size={12} className="shrink-0 text-subtle" />
            <div className="min-w-0 flex-1 overflow-hidden">
              <CellView field={f} value={v} ctx={ctx} baseId={baseId} />
            </div>
          </div>
        ))}
        {record.commentCount > 0 && (
          <span className="flex items-center gap-1 text-[11px] text-muted">
            <MessageSquare size={11} /> {record.commentCount}
          </span>
        )}
      </div>
    </div>
  );
}
