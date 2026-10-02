'use client';

import type { Answer, FileAnswer, FormItem } from '@workos/form-model';
import { Heart, Loader2, Paperclip, Star, ThumbsUp, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { cn } from '../ui/primitives';

type Other = { other: string };
const isOther = (x: unknown): x is Other => !!x && typeof x === 'object' && 'other' in (x as object);

/** Deterministic shuffle per respondent session (stable while answering). */
function shuffled<T>(arr: T[], seed: string): T[] {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) | 0;
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    h = (h * 1103515245 + 12345) | 0;
    const j = Math.abs(h) % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * The respondent control of one question (also used as a disabled preview in the builder).
 * `onUpload` stores a file and returns its metadata (respondent page only).
 */
export function AnswerInput({
  item,
  value,
  onChange,
  color,
  disabled,
  seed = '',
  onUpload,
}: {
  item: FormItem;
  value: Answer | undefined;
  onChange: (v: Answer) => void;
  color: string;
  disabled?: boolean;
  seed?: string;
  onUpload?: (f: File) => Promise<FileAnswer>;
}) {
  const options = useMemo(() => (item.shuffle && item.options ? shuffled(item.options, seed + item.id) : item.options ?? []), [item.options, item.shuffle, seed, item.id]);
  const accent = { accentColor: color } as const;
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const line = 'w-full border-0 border-b border-slate-300 bg-transparent px-0 py-1.5 text-[14px] outline-none focus:border-b-2 disabled:bg-transparent';

  switch (item.type) {
    case 'short':
      return <input disabled={disabled} value={typeof value === 'string' ? value : ''} onChange={(e) => onChange(e.target.value)} placeholder="Your answer" className={cn(line, 'max-w-md')} style={{ borderColor: undefined }} aria-label={item.title} />;
    case 'paragraph':
      return <textarea disabled={disabled} value={typeof value === 'string' ? value : ''} onChange={(e) => onChange(e.target.value)} placeholder="Your answer" rows={3} className={cn(line, 'resize-y')} aria-label={item.title} />;
    case 'choice': {
      const other = isOther(value) ? value.other : null;
      return (
        <div className="space-y-2.5" role="radiogroup" aria-label={item.title}>
          {options.map((o) => (
            <label key={o.id} className="flex cursor-pointer items-center gap-3 text-[14px]">
              <input type="radio" disabled={disabled} checked={value === o.label} onChange={() => onChange(o.label)} className="size-[18px]" style={accent} name={item.id} />
              {o.label}
            </label>
          ))}
          {item.other && (
            <label className="flex cursor-pointer items-center gap-3 text-[14px]">
              <input type="radio" disabled={disabled} checked={other !== null} onChange={() => onChange({ other: other ?? '' })} className="size-[18px]" style={accent} name={item.id} />
              Other:
              <input disabled={disabled} value={other ?? ''} onFocus={() => other === null && onChange({ other: '' })} onChange={(e) => onChange({ other: e.target.value })} className={cn(line, 'max-w-xs')} aria-label="Other" />
            </label>
          )}
          {value !== undefined && value !== null && value !== '' && !disabled && !item.required && (
            <button type="button" onClick={() => onChange(null)} className="text-[12px] text-slate-500 hover:underline">
              Clear selection
            </button>
          )}
        </div>
      );
    }
    case 'checkbox': {
      const list = (Array.isArray(value) ? value : []) as (string | Other)[];
      const other = list.find(isOther);
      const toggle = (label: string) => onChange(list.includes(label) ? list.filter((x) => x !== label) : [...list, label]);
      return (
        <div className="space-y-2.5" aria-label={item.title}>
          {options.map((o) => (
            <label key={o.id} className="flex cursor-pointer items-center gap-3 text-[14px]">
              <input type="checkbox" disabled={disabled} checked={list.includes(o.label)} onChange={() => toggle(o.label)} className="size-[18px] rounded" style={accent} />
              {o.label}
            </label>
          ))}
          {item.other && (
            <label className="flex cursor-pointer items-center gap-3 text-[14px]">
              <input type="checkbox" disabled={disabled} checked={!!other} onChange={() => onChange(other ? list.filter((x) => !isOther(x)) : [...list, { other: '' }])} className="size-[18px] rounded" style={accent} />
              Other:
              <input
                disabled={disabled}
                value={other?.other ?? ''}
                onChange={(e) => onChange([...list.filter((x) => !isOther(x)), { other: e.target.value }])}
                className={cn(line, 'max-w-xs')}
                aria-label="Other"
              />
            </label>
          )}
        </div>
      );
    }
    case 'dropdown':
      return (
        <select disabled={disabled} value={typeof value === 'string' ? value : ''} onChange={(e) => onChange(e.target.value || null)} className="h-10 min-w-56 rounded-md border border-slate-300 bg-white px-2 text-[14px]" aria-label={item.title}>
          <option value="">Choose</option>
          {options.map((o) => (
            <option key={o.id} value={o.label}>
              {o.label}
            </option>
          ))}
        </select>
      );
    case 'scale': {
      const s = item.scale ?? { min: 1, max: 5 };
      const nums = Array.from({ length: s.max - s.min + 1 }, (_, i) => s.min + i);
      return (
        <div className="flex items-end gap-3 overflow-x-auto pb-1" role="radiogroup" aria-label={item.title}>
          {s.minLabel && <span className="pb-1 text-[13px] text-slate-600">{s.minLabel}</span>}
          {nums.map((n) => (
            <label key={n} className="flex cursor-pointer flex-col items-center gap-1.5 text-[13px]">
              {n}
              <input type="radio" disabled={disabled} checked={value === n} onChange={() => onChange(n)} className="size-[18px]" style={accent} name={item.id} />
            </label>
          ))}
          {s.maxLabel && <span className="pb-1 text-[13px] text-slate-600">{s.maxLabel}</span>}
        </div>
      );
    }
    case 'rating': {
      const r = item.rating ?? { max: 5, icon: 'star' };
      const Icon = r.icon === 'heart' ? Heart : r.icon === 'thumb' ? ThumbsUp : Star;
      const v = typeof value === 'number' ? value : 0;
      return (
        <div className="flex gap-1.5" role="radiogroup" aria-label={item.title}>
          {Array.from({ length: r.max }, (_, i) => i + 1).map((n) => (
            <button key={n} type="button" disabled={disabled} onClick={() => onChange(v === n && !item.required ? null : n)} aria-label={`${n} of ${r.max}`} aria-pressed={v >= n} className="rounded p-0.5">
              <Icon size={30} strokeWidth={1.5} style={{ color: v >= n ? color : '#cbd5e1', fill: v >= n ? color : 'transparent' }} />
            </button>
          ))}
        </div>
      );
    }
    case 'choiceGrid':
    case 'checkboxGrid': {
      const g = item.grid ?? { rows: [], cols: [] };
      const ans = (value && typeof value === 'object' && !Array.isArray(value) && !isOther(value) ? value : {}) as Record<string, string | string[]>;
      const multi = item.type === 'checkboxGrid';
      const set = (row: string, col: string) => {
        if (multi) {
          const cur = (ans[row] as string[] | undefined) ?? [];
          onChange({ ...ans, [row]: cur.includes(col) ? cur.filter((c) => c !== col) : [...cur, col] });
        } else onChange({ ...ans, [row]: col });
      };
      return (
        <div className="overflow-x-auto">
          <table className="text-[13px]">
            <thead>
              <tr>
                <th />
                {g.cols.map((c) => (
                  <th key={c} className="px-3 pb-2 text-center font-normal text-slate-600">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {g.rows.map((row, i) => (
                <tr key={row} className={i % 2 ? '' : 'bg-slate-50'}>
                  <td className="py-2.5 pl-2 pr-4">{row}</td>
                  {g.cols.map((c) => {
                    const on = multi ? ((ans[row] as string[] | undefined) ?? []).includes(c) : ans[row] === c;
                    return (
                      <td key={c} className="text-center">
                        <input type={multi ? 'checkbox' : 'radio'} disabled={disabled} checked={on} onChange={() => set(row, c)} className="size-[18px]" style={accent} name={`${item.id}-${row}`} aria-label={`${row} ${c}`} />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }
    case 'date':
      return <input type={item.date?.includeTime ? 'datetime-local' : 'date'} disabled={disabled} value={typeof value === 'string' ? value : ''} onChange={(e) => onChange(e.target.value || null)} className={cn(line, 'max-w-56')} aria-label={item.title} />;
    case 'time':
      return <input type="time" disabled={disabled} value={typeof value === 'string' ? value : ''} onChange={(e) => onChange(e.target.value || null)} className={cn(line, 'max-w-40')} aria-label={item.title} />;
    case 'file': {
      const files = (Array.isArray(value) ? value : []) as FileAnswer[];
      const max = item.file?.maxFiles ?? 1;
      return (
        <div className="space-y-2">
          {files.map((f) => (
            <div key={f.blobId} className="flex max-w-md items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-[13px]">
              <Paperclip size={14} className="text-slate-500" />
              <span className="min-w-0 flex-1 truncate">{f.name}</span>
              <span className="text-slate-500">{Math.max(1, Math.round(f.size / 1024))} KB</span>
              {!disabled && (
                <button type="button" onClick={() => onChange(files.filter((x) => x.blobId !== f.blobId))} aria-label={`Remove ${f.name}`}>
                  <X size={14} />
                </button>
              )}
            </div>
          ))}
          {files.length < max && (
            <label className={cn('inline-flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-[13px] font-medium', disabled && 'pointer-events-none opacity-60')} style={{ borderColor: color, color }}>
              {uploading ? <Loader2 size={14} className="animate-spin" /> : <Paperclip size={14} />}
              Add file
              <input
                type="file"
                hidden
                disabled={disabled || !onUpload}
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  if (!f || !onUpload) return;
                  if (f.size > (item.file?.maxSizeMb ?? 10) * 1024 * 1024) return setUploadError(`The file is larger than ${item.file?.maxSizeMb ?? 10} MB`);
                  setUploading(true);
                  setUploadError(null);
                  try {
                    onChange([...files, await onUpload(f)]);
                  } catch (err) {
                    setUploadError((err as Error).message);
                  } finally {
                    setUploading(false);
                  }
                }}
              />
            </label>
          )}
          <div className="text-[12px] text-slate-500">
            Up to {max} file{max > 1 ? 's' : ''}, {item.file?.maxSizeMb ?? 10} MB each.
          </div>
          {uploadError && <div className="text-[12px] text-red-600">{uploadError}</div>}
        </div>
      );
    }
    default:
      return null;
  }
}

/** YouTube / Vimeo URL → embeddable URL (null for anything else). */
export function embedUrl(url: string): string | null {
  const yt = /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([\w-]{11})/.exec(url);
  if (yt) return `https://www.youtube-nocookie.com/embed/${yt[1]}`;
  const vm = /vimeo\.com\/(\d+)/.exec(url);
  if (vm) return `https://player.vimeo.com/video/${vm[1]}`;
  return null;
}
