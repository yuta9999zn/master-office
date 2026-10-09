'use client';

import { cellText, type Attachment, type BaseField, type CellContext } from '@workos/base-model';
import type { UserSummary } from '@workos/shared';
import { Check, FileText, Loader2, Plus, Upload, X } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { toast } from 'sonner';
import { attachmentUrl, uploadAttachment, useTitles } from '@/lib/base';
import { Avatar, cn } from '../ui/primitives';
import { ChoicePill } from './CellView';

export type Move = 'down' | 'right' | 'left' | 'none';

/** Picker / input for one cell. `seed` is the key that started editing (typing over a cell). */
export function CellEditor({
  field,
  value,
  ctx,
  baseId,
  seed,
  onCommit,
  onCancel,
}: {
  field: BaseField;
  value: unknown;
  ctx: CellContext & { users: UserSummary[] };
  baseId: string;
  seed?: string;
  onCommit: (raw: unknown, move?: Move) => void;
  onCancel: () => void;
}) {
  switch (field.type) {
    case 'singleSelect':
    case 'multiSelect': {
      const multiple = field.type === 'multiSelect';
      const sel = new Set(multiple ? ((value as string[]) ?? []) : value ? [value as string] : []);
      return (
        <Picker
          seed={seed}
          multiple={multiple}
          selected={sel}
          items={(field.options.choices ?? []).map((c) => ({ id: c.id, label: c.name, render: <ChoicePill name={c.name} color={c.color} /> }))}
          onPick={(id) => (multiple ? onCommit(sel.has(id) ? [...sel].filter((x) => x !== id) : [...sel, id], 'none') : onCommit(sel.has(id) ? null : id))}
          onCreate={(name) => (multiple ? onCommit([...sel, name], 'none') : onCommit(name))}
          onClose={onCancel}
          createLabel="option"
        />
      );
    }
    case 'person': {
      const multiple = !!field.options.multiple;
      const sel = new Set((value as string[]) ?? []);
      return (
        <Picker
          seed={seed}
          multiple={multiple}
          selected={sel}
          items={ctx.users.map((u) => ({ id: u.id, label: `${u.name} ${u.email}`, render: <span className="flex items-center gap-2 text-[13px]"><Avatar user={u} size={20} /> {u.name}</span> }))}
          onPick={(id) => (multiple ? onCommit(sel.has(id) ? [...sel].filter((x) => x !== id) : [...sel, id], 'none') : onCommit(sel.has(id) ? null : [id]))}
          onClose={onCancel}
        />
      );
    }
    case 'link':
      return <LinkPicker field={field} value={(value as string[]) ?? []} seed={seed} onCommit={onCommit} onClose={onCancel} />;
    case 'attachment':
      return <AttachmentEditor baseId={baseId} value={(value as Attachment[]) ?? []} onCommit={onCommit} onClose={onCancel} />;
    case 'longText':
      return <LongText initial={seed ?? (value as string) ?? ''} onCommit={onCommit} onCancel={onCancel} />;
    case 'date':
      return <DateInput field={field} value={value as string | null} onCommit={onCommit} onCancel={onCancel} />;
    default: {
      const initial = seed ?? (value === null || value === undefined ? '' : typeof value === 'number' && field.type === 'percent' ? `${Math.round(value * 1e6) / 1e4}%` : typeof value === 'number' ? String(value) : cellText(field, value, ctx));
      return <TextInput initial={initial} numeric={['number', 'currency', 'percent'].includes(field.type)} onCommit={onCommit} onCancel={onCancel} />;
    }
  }
}

const keyMove = (e: KeyboardEvent): Move | null => (e.key === 'Enter' ? 'down' : e.key === 'Tab' ? (e.shiftKey ? 'left' : 'right') : null);

function TextInput({ initial, numeric, onCommit, onCancel }: { initial: string; numeric?: boolean; onCommit: (v: unknown, m?: Move) => void; onCancel: () => void }) {
  const [v, setV] = useState(initial);
  const done = useRef(false);
  const commit = (m?: Move) => {
    if (done.current) return;
    done.current = true;
    if (v === initial) onCancel();
    else onCommit(v, m);
  };
  return (
    <input
      autoFocus
      value={v}
      onChange={(e) => setV(e.target.value)}
      onFocus={(e) => e.currentTarget.setSelectionRange(e.currentTarget.value.length, e.currentTarget.value.length)}
      onKeyDown={(e) => {
        const m = keyMove(e);
        if (m) (e.preventDefault(), commit(m));
        else if (e.key === 'Escape') (e.preventDefault(), (done.current = true), onCancel());
      }}
      onBlur={() => commit('none')}
      className={cn('h-full w-full bg-surface px-2 text-[13px] text-ink outline-none', numeric && 'text-right tabular-nums')}
      data-testid="cell-input"
    />
  );
}

function LongText({ initial, onCommit, onCancel }: { initial: string; onCommit: (v: unknown, m?: Move) => void; onCancel: () => void }) {
  const [v, setV] = useState(initial);
  const done = useRef(false);
  const commit = () => {
    if (done.current) return;
    done.current = true;
    if (v === initial) onCancel();
    else onCommit(v, 'none');
  };
  return (
    <textarea
      autoFocus
      value={v}
      onChange={(e) => setV(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Escape') (e.preventDefault(), (done.current = true), onCancel());
        else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) (e.preventDefault(), commit());
      }}
      onBlur={commit}
      rows={6}
      className="w-[320px] rounded-md border border-brand-500 bg-surface p-2 text-[13px] text-ink shadow-lg outline-none"
      data-testid="cell-textarea"
    />
  );
}

function DateInput({ field, value, onCommit, onCancel }: { field: BaseField; value: string | null; onCommit: (v: unknown, m?: Move) => void; onCancel: () => void }) {
  const time = !!field.options.includeTime;
  const local = (s: string | null) => {
    if (!s) return '';
    if (!time) return s.slice(0, 10);
    const d = new Date(s);
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  };
  const [v, setV] = useState(local(value));
  const done = useRef(false);
  const commit = (m?: Move) => {
    if (done.current) return;
    done.current = true;
    if (v === local(value)) return onCancel();
    onCommit(v ? (time ? new Date(v).toISOString() : v) : null, m);
  };
  return (
    <input
      autoFocus
      type={time ? 'datetime-local' : 'date'}
      value={v}
      onChange={(e) => setV(e.target.value)}
      onKeyDown={(e) => {
        const m = keyMove(e);
        if (m) (e.preventDefault(), commit(m));
        else if (e.key === 'Escape') (e.preventDefault(), (done.current = true), onCancel());
      }}
      onBlur={() => commit('none')}
      className="h-full w-full bg-surface px-2 text-[13px] text-ink outline-none"
      aria-label={field.name}
      data-testid="cell-date"
    />
  );
}

/** A searchable list (options, people, records): click picks; multiple lists stay open. */
export function Picker({
  items,
  selected,
  multiple,
  seed,
  onPick,
  onCreate,
  onClose,
  createLabel,
  loading,
}: {
  items: { id: string; label: string; render: ReactNode }[];
  selected: Set<string>;
  multiple?: boolean;
  seed?: string;
  onPick: (id: string) => void;
  onCreate?: (name: string) => void;
  onClose: () => void;
  createLabel?: string;
  loading?: boolean;
}) {
  const [q, setQ] = useState(seed ?? '');
  const [hi, setHi] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const shown = items.filter((i) => i.label.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 200);
  const exact = items.some((i) => i.label.toLowerCase() === q.trim().toLowerCase());
  const canCreate = !!onCreate && !!q.trim() && !exact;
  useEffect(() => {
    const away = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && onClose();
    const t = setTimeout(() => document.addEventListener('mousedown', away), 0);
    return () => (clearTimeout(t), document.removeEventListener('mousedown', away));
  }, [onClose]);
  return (
    <div ref={box} className="w-[260px] rounded-lg border border-line bg-surface p-1.5 shadow-lg" data-testid="cell-picker" onMouseDown={(e) => e.stopPropagation()}>
      <input
        autoFocus
        value={q}
        onChange={(e) => (setQ(e.target.value), setHi(0))}
        onKeyDown={(e) => {
          if (e.key === 'Escape') (e.preventDefault(), onClose());
          else if (e.key === 'ArrowDown') (e.preventDefault(), setHi(Math.min(hi + 1, shown.length - 1)));
          else if (e.key === 'ArrowUp') (e.preventDefault(), setHi(Math.max(0, hi - 1)));
          else if (e.key === 'Enter') {
            e.preventDefault();
            if (shown[hi]) onPick(shown[hi].id);
            else if (canCreate) onCreate!(q.trim());
          }
        }}
        placeholder="Find…"
        aria-label="Find an option"
        className="mb-1 h-8 w-full rounded-md border border-line-strong px-2 text-[13px] outline-none focus:border-brand-500"
      />
      <ul className="max-h-60 overflow-y-auto">
        {loading && (
          <li className="flex items-center gap-2 px-2 py-1.5 text-[12.5px] text-muted">
            <Loader2 size={13} className="animate-spin" /> Loading…
          </li>
        )}
        {shown.map((i, n) => (
          <li key={i.id}>
            <button type="button" onClick={() => onPick(i.id)} onMouseEnter={() => setHi(n)} className={cn('flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left', n === hi && 'bg-hover')} data-testid="picker-item">
              <span className="min-w-0 flex-1 truncate">{i.render}</span>
              {selected.has(i.id) && <Check size={14} className="shrink-0 text-brand-600" />}
            </button>
          </li>
        ))}
        {!shown.length && !canCreate && !loading && <li className="px-2 py-1.5 text-[12.5px] text-subtle">Nothing found</li>}
        {canCreate && (
          <li>
            <button type="button" onClick={() => onCreate!(q.trim())} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-brand-700 hover:bg-hover" data-testid="picker-create">
              <Plus size={14} /> Add {createLabel ?? ''} “{q.trim()}”
            </button>
          </li>
        )}
      </ul>
      {multiple && <p className="px-2 pt-1 text-[11px] text-subtle">Click to add or remove · Esc to close</p>}
    </div>
  );
}

function LinkPicker({ field, value, seed, onCommit, onClose }: { field: BaseField; value: string[]; seed?: string; onCommit: (v: unknown, m?: Move) => void; onClose: () => void }) {
  const { data, isLoading } = useTitles(field.options.tableId);
  const sel = new Set(value);
  return (
    <Picker
      seed={seed}
      multiple
      loading={isLoading}
      selected={sel}
      items={(data ?? []).map((r) => ({ id: r.id, label: r.title, render: <span className="text-[13px]">{r.title}</span> }))}
      onPick={(id) => onCommit(sel.has(id) ? value.filter((x) => x !== id) : [...value, id], 'none')}
      onClose={onClose}
    />
  );
}

export function AttachmentEditor({ baseId, value, onCommit, onClose }: { baseId: string; value: Attachment[]; onCommit: (v: unknown, m?: Move) => void; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const away = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && onClose();
    const t = setTimeout(() => document.addEventListener('mousedown', away), 0);
    return () => (clearTimeout(t), document.removeEventListener('mousedown', away));
  }, [onClose]);
  const upload = async (files: FileList | File[]) => {
    setBusy(true);
    try {
      const added: Attachment[] = [];
      for (const f of [...files]) added.push(await uploadAttachment(baseId, f));
      onCommit([...value, ...added], 'none');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div
      ref={box}
      className="w-[300px] rounded-lg border border-line bg-surface p-2 shadow-lg"
      onMouseDown={(e) => e.stopPropagation()}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => (e.preventDefault(), void upload(e.dataTransfer.files))}
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
      data-testid="attachment-editor"
    >
      <ul className="max-h-56 space-y-1 overflow-y-auto">
        {value.map((a) => (
          <li key={a.id} className="group flex items-center gap-2 rounded-md px-1 py-1 hover:bg-hover">
            {a.mime.startsWith('image/') ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={attachmentUrl(baseId, a)} alt="" loading="lazy" className="size-8 rounded object-cover ring-1 ring-line" />
            ) : (
              <span className="grid size-8 place-items-center rounded bg-hover">
                <FileText size={15} />
              </span>
            )}
            <a href={attachmentUrl(baseId, a)} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate text-[12.5px] hover:underline">
              {a.name}
            </a>
            <button type="button" onClick={() => onCommit(value.filter((x) => x.id !== a.id), 'none')} className="rounded p-0.5 text-muted opacity-0 hover:bg-white group-hover:opacity-100" aria-label={`Remove ${a.name}`}>
              <X size={13} />
            </button>
          </li>
        ))}
      </ul>
      <button type="button" autoFocus onClick={() => input.current?.click()} disabled={busy} className="mt-1 flex w-full items-center justify-center gap-2 rounded-md border border-dashed border-line-strong py-2 text-[12.5px] text-ink-2 hover:bg-hover">
        {busy ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />} {busy ? 'Uploading…' : 'Upload or drop files'}
      </button>
      <input ref={input} type="file" multiple hidden onChange={(e) => e.target.files && void upload(e.target.files)} data-testid="attachment-input" />
    </div>
  );
}
