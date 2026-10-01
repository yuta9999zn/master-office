'use client';

import type { ListResourcesQuery, Resource } from '@workos/shared';
import { ArrowDown, ArrowUp, Check, MoreHorizontal, Star, Users } from 'lucide-react';
import { ContextMenu as CM, DropdownMenu as DM } from 'radix-ui';
import type { MouseEvent, ReactElement } from 'react';
import { downloadUrl } from '@/lib/api';
import { formatBytes, formatDate } from '@/lib/format';
import { typeLabel, typeMeta } from '@/lib/resources';
import type { ViewMode } from '@/lib/store';
import { cn, FileIcon } from '../ui/primitives';
import { type Action, ContextActions, DropdownActions } from './actions';

export interface ViewProps {
  items: Resource[];
  selected: Set<string>;
  onSelect: (e: MouseEvent, r: Resource, index: number) => void;
  onOpen: (r: Resource) => void;
  actionsFor: (r: Resource) => Action[];
  onContextSelect: (r: Resource) => void;
  sort: Pick<ListResourcesQuery, 'sort' | 'order'>;
  onSort: (key: NonNullable<ListResourcesQuery['sort']>) => void;
  showLocation?: boolean;
}

function RowMenu({ actions }: { actions: Action[] }) {
  if (!actions.length) return <span />;
  return (
    <DM.Root>
      <DM.Trigger asChild>
        <button
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          className="flex size-7 items-center justify-center rounded-md text-muted opacity-0 hover:bg-line group-hover:opacity-100 data-[state=open]:bg-line data-[state=open]:opacity-100"
          aria-label="More actions"
        >
          <MoreHorizontal size={16} />
        </button>
      </DM.Trigger>
      <DM.Portal>
        <DM.Content align="end" sideOffset={4} className="pop z-50 min-w-[210px] animate-pop" onCloseAutoFocus={(e) => e.preventDefault()}>
          <DropdownActions actions={actions} />
        </DM.Content>
      </DM.Portal>
    </DM.Root>
  );
}

function Wrap({ r, props, children }: { r: Resource; props: ViewProps; children: ReactElement }) {
  const actions = props.actionsFor(r);
  if (!actions.length) return children;
  return (
    <CM.Root>
      <CM.Trigger asChild onContextMenu={() => props.onContextSelect(r)}>
        {children}
      </CM.Trigger>
      <ContextActions actions={actions} />
    </CM.Root>
  );
}

function Checkbox({ on }: { on: boolean }) {
  return (
    <span className={cn('flex size-4 items-center justify-center rounded border transition', on ? 'border-brand-600 bg-brand-600 text-white' : 'border-line-strong bg-surface opacity-0 group-hover:opacity-100')}>
      {on && <Check size={11} strokeWidth={3} />}
    </span>
  );
}

// ── List / Compact ───────────────────────────────────────────────────────────

export function FileList(props: ViewProps & { compact?: boolean }) {
  const { items, selected, onSelect, onOpen, sort, onSort, compact } = props;
  const cols = compact ? 'grid-cols-[28px_minmax(0,1fr)_140px_90px_40px]' : 'grid-cols-[28px_minmax(0,1fr)_150px_150px_90px_80px_40px]';
  const H = ({ k, label, className }: { k?: NonNullable<ListResourcesQuery['sort']>; label: string; className?: string }) => (
    <button disabled={!k} onClick={() => k && onSort(k)} className={cn('flex items-center gap-1 text-left hover:text-ink disabled:hover:text-muted', className)}>
      {label}
      {k && sort.sort === k && (sort.order === 'desc' ? <ArrowDown size={12} /> : <ArrowUp size={12} />)}
    </button>
  );
  return (
    <div className="min-w-[640px]" role="grid">
      <div className={cn('sticky top-0 z-[1] grid h-9 items-center border-b border-line bg-surface px-2 text-[12px] font-medium text-muted', cols)}>
        <span />
        <H k="name" label="Name" />
        {!compact && <H label="Owner" />}
        <H k="updatedAt" label="Last modified" />
        <H k="size" label="Size" />
        {!compact && <H k="type" label="Type" />}
        <span />
      </div>
      {items.map((r, i) => {
        const on = selected.has(r.id);
        return (
          <Wrap key={r.id} r={r} props={props}>
            <div
              role="row"
              aria-selected={on}
              onClick={(e) => onSelect(e, r, i)}
              onDoubleClick={() => onOpen(r)}
              className={cn(
                'group grid cursor-default items-center border-b border-line/70 px-2 text-[13px] transition-colors',
                cols,
                compact ? 'h-9' : 'h-11',
                on ? 'bg-selected' : 'hover:bg-canvas',
              )}
            >
              <Checkbox on={on} />
              <span className="flex min-w-0 items-center gap-2.5">
                <FileIcon r={r} size={compact ? 18 : 20} />
                <span className="truncate text-ink">{r.name}</span>
                {r.starred && <Star size={13} className="shrink-0 fill-amber-400 text-amber-400" />}
                {r.generalAccess !== 'restricted' && <Users size={13} className="shrink-0 text-subtle" />}
              </span>
              {!compact && <span className="truncate text-muted">{r.owner?.name.split(' ')[0] ?? '—'}</span>}
              <span className="text-muted">{formatDate(r.updatedAt)}</span>
              <span className="text-muted">{r.type === 'folder' ? '—' : formatBytes(r.sizeBytes)}</span>
              {!compact && <span className="text-muted">{typeLabel(r)}</span>}
              <RowMenu actions={props.actionsFor(r)} />
            </div>
          </Wrap>
        );
      })}
    </div>
  );
}

// ── Grid ─────────────────────────────────────────────────────────────────────

export function FileGrid(props: ViewProps) {
  const { items, selected, onSelect, onOpen } = props;
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3 p-4">
      {items.map((r, i) => (
        <Wrap key={r.id} r={r} props={props}>
          <div
            onClick={(e) => onSelect(e, r, i)}
            onDoubleClick={() => onOpen(r)}
            className={cn(
              'group flex h-12 cursor-default items-center gap-2.5 rounded-xl border px-3 transition-colors',
              selected.has(r.id) ? 'border-brand-200 bg-selected' : 'border-line bg-surface hover:bg-canvas',
            )}
          >
            <FileIcon r={r} size={22} />
            <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{r.name}</span>
            <RowMenu actions={props.actionsFor(r)} />
          </div>
        </Wrap>
      ))}
    </div>
  );
}

// ── Gallery ──────────────────────────────────────────────────────────────────

function Thumb({ r }: { r: Resource }) {
  const m = typeMeta(r);
  if (r.type === 'image') {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={downloadUrl(r.id, true)} alt="" loading="lazy" className="size-full object-cover" />;
  }
  const Icon = m.icon;
  return (
    <div className="relative flex size-full items-center justify-center overflow-hidden" style={{ background: m.tint }}>
      {r.type === 'folder' ? (
        <FileIcon r={r} size={64} />
      ) : (
        <div className="flex h-[78%] w-[62%] flex-col gap-1.5 rounded-t-lg bg-white p-3 pt-4 shadow-sm translate-y-[14%]">
          <div className="mb-1 flex items-center gap-1.5">
            <span className="flex size-5 items-center justify-center rounded" style={{ background: m.color }}>
              <Icon size={12} color="#fff" strokeWidth={2.5} />
            </span>
            <span className="h-1.5 w-12 rounded-full bg-line-strong" />
          </div>
          {[92, 80, 86, 64, 74].map((w, i) => (
            <span key={i} className="h-1.5 rounded-full bg-line" style={{ width: `${w}%` }} />
          ))}
        </div>
      )}
    </div>
  );
}

export function FileGallery(props: ViewProps) {
  const { items, selected, onSelect, onOpen } = props;
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-4 p-4">
      {items.map((r, i) => (
        <Wrap key={r.id} r={r} props={props}>
          <div
            onClick={(e) => onSelect(e, r, i)}
            onDoubleClick={() => onOpen(r)}
            className={cn(
              'group cursor-default overflow-hidden rounded-xl border bg-surface transition-shadow hover:shadow-[var(--shadow-pop)]',
              selected.has(r.id) ? 'border-brand-600 ring-2 ring-brand-100' : 'border-line',
            )}
          >
            <div className="aspect-[4/3] border-b border-line">
              <Thumb r={r} />
            </div>
            <div className="flex items-center gap-2 px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium text-ink">{r.name}</div>
                <div className="text-[12px] text-muted">
                  {typeLabel(r)}
                  {r.type !== 'folder' && r.sizeBytes ? ` · ${formatBytes(r.sizeBytes)}` : ''}
                </div>
              </div>
              <RowMenu actions={props.actionsFor(r)} />
            </div>
          </div>
        </Wrap>
      ))}
    </div>
  );
}

export function FileView({ mode, ...props }: ViewProps & { mode: ViewMode }) {
  if (mode === 'grid') return <FileGrid {...props} />;
  if (mode === 'gallery') return <FileGallery {...props} />;
  return <FileList {...props} compact={mode === 'compact'} />;
}
