'use client';

import { cellValue, COMPUTED_TYPES, recordTitle, type BaseField, type BaseRecord, type BaseTable, type CellContext } from '@workos/base-model';
import type { UserSummary } from '@workos/shared';
import { ChevronDown, ChevronUp, Lock, Send, Trash2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { timeAgo } from '@/lib/format';
import { useBaseActions, useComments } from '@/lib/base';
import { Avatar, Button, cn, IconButton, Skeleton } from '../ui/primitives';
import { CellEditor } from './CellEditor';
import { CellView } from './CellView';
import { FieldIcon } from './field-meta';

/** One record with every field (hidden ones too), editable in place, and its comments (§75). */
export function RecordDrawer({
  baseId,
  table,
  record,
  ctx,
  editable,
  canComment,
  me,
  onClose,
  onStep,
}: {
  baseId: string;
  table: BaseTable;
  record: BaseRecord;
  ctx: CellContext & { users: UserSummary[] };
  editable: boolean;
  canComment: boolean;
  me?: string;
  onClose: () => void;
  onStep?: (dir: -1 | 1) => void;
}) {
  const a = useBaseActions(baseId);
  const { data: comments, isLoading } = useComments(record.id);
  const [editing, setEditing] = useState<string | null>(null);
  const [body, setBody] = useState('');
  useEffect(() => setEditing(null), [record.id]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea, select, [data-testid="cell-picker"]')) return;
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowUp' && e.altKey) onStep?.(-1);
      if (e.key === 'ArrowDown' && e.altKey) onStep?.(1);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose, onStep]);
  const primary = table.fields.find((f) => f.id === table.primaryFieldId);
  const title = recordTitle(primary, record, ctx) || 'Untitled';
  const write = (f: BaseField, raw: unknown) => a.updateRecords.mutate({ tableId: table.id, records: [{ id: record.id, values: { [f.id]: raw } }], ctx });
  const created = ctx.people.get(record.createdBy ?? '')?.name;

  return (
    <aside className="flex h-full w-[460px] shrink-0 flex-col border-l border-line bg-surface shadow-[-8px_0_24px_-12px_rgba(15,23,42,0.15)]" data-testid="record-drawer">
      <header className="flex items-center gap-1 border-b border-line px-4 py-2.5">
        <h2 className="min-w-0 flex-1 truncate text-[15px] font-semibold text-ink" data-testid="record-title">
          {title}
        </h2>
        {onStep && (
          <>
            <IconButton label="Previous record (Alt+↑)" onClick={() => onStep(-1)}>
              <ChevronUp size={17} />
            </IconButton>
            <IconButton label="Next record (Alt+↓)" onClick={() => onStep(1)}>
              <ChevronDown size={17} />
            </IconButton>
          </>
        )}
        {editable && (
          <IconButton
            label="Delete record"
            onClick={() => {
              a.deleteRecords.mutate({ tableId: table.id, ids: [record.id] });
              onClose();
            }}
          >
            <Trash2 size={16} />
          </IconButton>
        )}
        <IconButton label="Close" onClick={onClose}>
          <X size={17} />
        </IconButton>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        <dl className="space-y-2.5">
          {table.fields.map((f) => {
            const v = cellValue(f, record, ctx);
            const ro = !editable || COMPUTED_TYPES.includes(f.type);
            const isEditing = editing === f.id;
            return (
              <div key={f.id} data-testid="record-field" data-field={f.name}>
                <dt className="mb-0.5 flex items-center gap-1.5 text-[12px] text-muted">
                  <FieldIcon type={f.type} size={13} /> {f.name}
                  {COMPUTED_TYPES.includes(f.type) && <Lock size={10} className="text-subtle" />}
                </dt>
                <dd className="relative">
                  {isEditing && !['checkbox', 'rating'].includes(f.type) ? (
                    <div className={cn(['singleSelect', 'multiSelect', 'person', 'link', 'attachment'].includes(f.type) ? '' : 'h-9 overflow-hidden rounded-md border border-brand-500')}>
                      <CellEditor
                        field={f}
                        value={record.values[f.id]}
                        ctx={ctx}
                        baseId={baseId}
                        onCommit={(raw, move) => {
                          write(f, raw);
                          if (move !== 'none' || !['multiSelect', 'link', 'attachment'].includes(f.type) || (f.type === 'person' && !f.options.multiple)) setEditing(null);
                        }}
                        onCancel={() => setEditing(null)}
                      />
                    </div>
                  ) : (
                    <div
                      role={ro ? undefined : 'button'}
                      tabIndex={ro ? -1 : 0}
                      onClick={() => !ro && !['checkbox', 'rating'].includes(f.type) && setEditing(f.id)}
                      onKeyDown={(e) => e.key === 'Enter' && !ro && setEditing(f.id)}
                      className={cn('flex min-h-9 items-center rounded-md px-2 py-1.5 text-[13px] text-ink', !ro && 'cursor-text ring-1 ring-line hover:ring-line-strong', ro && 'bg-canvas')}
                    >
                      <CellView
                        field={f}
                        value={v}
                        ctx={ctx}
                        baseId={baseId}
                        wrap
                        onToggle={!ro && f.type === 'checkbox' ? () => write(f, !record.values[f.id]) : undefined}
                        onRate={!ro && f.type === 'rating' ? (n) => write(f, n || null) : undefined}
                      />
                      {v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length) ? !['checkbox', 'rating'].includes(f.type) && <span className="text-subtle">{ro ? '—' : 'Empty'}</span> : null}
                    </div>
                  )}
                  {f.description && <p className="mt-0.5 text-[11.5px] text-subtle">{f.description}</p>}
                </dd>
              </div>
            );
          })}
        </dl>
        <p className="mt-4 text-[11.5px] text-subtle">
          #{record.autoNumber} · created {created ? `by ${created} ` : ''}
          {timeAgo(record.createdAt)} · last changed {timeAgo(record.updatedAt)}
        </p>

        <section className="mt-5 border-t border-line pt-3" data-testid="record-comments">
          <h3 className="text-[13px] font-semibold text-ink">Comments</h3>
          {isLoading ? (
            <Skeleton className="mt-2 h-12" />
          ) : (
            <ul className="mt-2 space-y-3">
              {(comments ?? []).map((c) => (
                <li key={c.id} className="group flex gap-2.5 text-[13px]" data-testid="record-comment">
                  {c.user ? <Avatar user={c.user} size={24} /> : <span className="size-6 rounded-full bg-hover" />}
                  <div className="min-w-0 flex-1">
                    <span className="font-medium text-ink">{c.user?.name ?? 'Someone'}</span> <span className="text-[11.5px] text-subtle">{timeAgo(c.createdAt)}</span>
                    <p className="whitespace-pre-wrap text-ink-2">{c.body}</p>
                  </div>
                  {c.user?.id === me && (
                    <button onClick={() => a.deleteComment.mutate({ id: c.id, recordId: record.id, tableId: table.id })} className="self-start rounded p-0.5 text-muted opacity-0 hover:bg-hover group-hover:opacity-100" aria-label="Delete comment">
                      <X size={13} />
                    </button>
                  )}
                </li>
              ))}
              {!comments?.length && <li className="text-[12.5px] text-subtle">No comments yet</li>}
            </ul>
          )}
        </section>
      </div>
      {canComment && (
        <form
          className="flex gap-2 border-t border-line p-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (body.trim()) a.comment.mutate({ tableId: table.id, recordId: record.id, body }, { onSuccess: () => setBody('') });
          }}
        >
          <input value={body} onChange={(e) => setBody(e.target.value)} placeholder="Add a comment…" aria-label="Comment" className="h-9 min-w-0 flex-1 rounded-lg border border-line-strong px-3 text-[13px] outline-none focus:border-brand-500" />
          <Button variant="primary" type="submit" disabled={!body.trim()} icon={<Send size={14} />} data-testid="comment-send">
            Send
          </Button>
        </form>
      )}
    </aside>
  );
}
