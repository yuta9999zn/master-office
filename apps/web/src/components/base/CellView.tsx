'use client';

import { cellText, choiceOf, FormulaError, type Attachment, type BaseField, type CellContext } from '@workos/base-model';
import { Check, FileText, Star } from 'lucide-react';
import { attachmentUrl } from '@/lib/base';
import { Avatar, cn } from '../ui/primitives';
import { isNumeric } from './field-meta';

export function ChoicePill({ name, color }: { name: string; color?: string }) {
  return (
    <span className="inline-block max-w-full truncate rounded-full px-2 py-px text-[12px] leading-[18px] text-ink" style={{ background: color ?? '#e2e8f0' }}>
      {name}
    </span>
  );
}

/** A cell's value drawn for its type (grid, cards, drawer). */
export function CellView({ field, value, ctx, baseId, wrap, onToggle, onRate }: { field: BaseField; value: unknown; ctx: CellContext & { users?: { id: string; name: string; avatarColor: string }[] }; baseId: string; wrap?: boolean; onToggle?: () => void; onRate?: (n: number) => void }) {
  if (value instanceof FormulaError)
    return (
      <span className="text-[12px] font-medium text-red-600" title={value.message}>
        #ERROR!
      </span>
    );
  const empty = value === null || value === undefined || value === '' || (Array.isArray(value) && !value.length);
  switch (field.type) {
    case 'checkbox':
      return (
        <button
          type="button"
          disabled={!onToggle}
          onClick={(e) => (e.stopPropagation(), onToggle?.())}
          className={cn('grid size-[18px] place-items-center rounded border', value ? 'border-brand-600 bg-brand-600 text-white' : 'border-line-strong bg-surface', onToggle && 'hover:border-brand-500')}
          aria-label={value ? 'Checked' : 'Not checked'}
          aria-pressed={!!value}
          data-testid="cell-checkbox"
        >
          {!!value && <Check size={13} strokeWidth={3} />}
        </button>
      );
    case 'rating': {
      const n = Number(value) || 0;
      return (
        <span className="flex items-center gap-0.5">
          {Array.from({ length: field.options.max ?? 5 }, (_, i) => (
            <button key={i} type="button" disabled={!onRate} onClick={(e) => (e.stopPropagation(), onRate?.(i + 1 === n ? 0 : i + 1))} aria-label={`${i + 1} stars`} className={cn(!onRate && 'cursor-default')}>
              <Star size={14} className={i < n ? 'fill-amber-400 text-amber-400' : 'text-line-strong'} />
            </button>
          ))}
        </span>
      );
    }
  }
  if (empty) return null;
  switch (field.type) {
    case 'singleSelect': {
      const c = choiceOf(field, value as string);
      return c ? <ChoicePill name={c.name} color={c.color} /> : null;
    }
    case 'multiSelect':
      return (
        <span className={cn('flex gap-1', wrap ? 'flex-wrap' : 'overflow-hidden')}>
          {(value as string[]).map((id) => {
            const c = choiceOf(field, id);
            return c ? <ChoicePill key={id} name={c.name} color={c.color} /> : null;
          })}
        </span>
      );
    case 'person':
    case 'createdBy':
      return (
        <span className={cn('flex gap-1.5', wrap ? 'flex-wrap' : 'overflow-hidden')}>
          {(Array.isArray(value) ? (value as string[]) : [value as string]).map((id) => {
            const u = ctx.users?.find((x) => x.id === id);
            return (
              <span key={id} className="flex shrink-0 items-center gap-1 rounded-full bg-hover py-px pl-px pr-2 text-[12px]">
                {u && <Avatar user={u} size={18} />}
                {u?.name ?? ctx.people.get(id)?.name ?? 'Unknown'}
              </span>
            );
          })}
        </span>
      );
    case 'link':
      return (
        <span className={cn('flex gap-1', wrap ? 'flex-wrap' : 'overflow-hidden')}>
          {(value as string[]).map((id) => (
            <span key={id} className="shrink-0 rounded bg-brand-50 px-1.5 py-px text-[12px] text-brand-700 ring-1 ring-brand-100">
              {ctx.linkTitle?.(field.options.tableId ?? '', id) ?? '…'}
            </span>
          ))}
        </span>
      );
    case 'attachment':
      return (
        <span className={cn('flex gap-1', wrap ? 'flex-wrap' : 'overflow-hidden')}>
          {(value as Attachment[]).map((a) =>
            a.mime.startsWith('image/') ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={a.id} src={attachmentUrl(baseId, a)} alt={a.name} title={a.name} className={cn('shrink-0 rounded object-cover ring-1 ring-line', wrap ? 'size-16' : 'size-6')} />
            ) : (
              <span key={a.id} className="flex shrink-0 items-center gap-1 rounded bg-hover px-1.5 text-[12px]" title={a.name}>
                <FileText size={12} /> <span className="max-w-[120px] truncate">{a.name}</span>
              </span>
            ),
          )}
        </span>
      );
    case 'url':
      return (
        <a href={String(value)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="truncate text-brand-700 underline-offset-2 hover:underline">
          {String(value).replace(/^https?:\/\//, '')}
        </a>
      );
    case 'email':
      return (
        <a href={`mailto:${String(value)}`} onClick={(e) => e.stopPropagation()} className="truncate text-brand-700 hover:underline">
          {String(value)}
        </a>
      );
    case 'longText':
      return <span className={cn(wrap ? 'whitespace-pre-wrap' : 'truncate')}>{String(value)}</span>;
    default: {
      const text = cellText(field, value, ctx);
      return <span className={cn('truncate', isNumeric(field.type) && 'tabular-nums', field.type === 'formula' && typeof value === 'number' && 'tabular-nums')}>{text}</span>;
    }
  }
}
