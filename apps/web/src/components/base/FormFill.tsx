'use client';

import type { Attachment, BaseField } from '@workos/base-model';
import type { UserSummary } from '@workos/shared';
import { CheckCircle2, FileText, Loader2, Star, Upload, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { api, uploadFile } from '@/lib/api';
import { useUsers } from '@/lib/queries';
import { Button, cn, EmptyState, Skeleton } from '../ui/primitives';
import { useQuery } from '@tanstack/react-query';

export interface BaseFormInfo {
  viewId: string;
  baseId: string;
  baseName: string;
  tableName: string;
  title: string;
  description: string;
  fields: BaseField[];
  required: string[];
  open: boolean;
  submitText: string;
  thanks: string;
  linkOptions: Record<string, { id: string; title: string }[]>;
}

const input = 'h-10 w-full rounded-lg border border-line-strong bg-surface px-3 text-[14px] text-ink outline-none focus:border-brand-500';

/** One question of a base form, as an input for its field type. */
export function FormQuestion({
  field,
  value,
  onChange,
  users,
  links,
  upload,
}: {
  field: BaseField;
  value: unknown;
  onChange: (v: unknown) => void;
  users: UserSummary[];
  links?: { id: string; title: string }[];
  upload?: (f: File) => Promise<Attachment>;
}) {
  const list = (Array.isArray(value) ? value : []) as string[];
  const toggle = (id: string) => onChange(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  switch (field.type) {
    case 'longText':
      return <textarea value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} rows={4} className={cn(input, 'h-auto py-2')} aria-label={field.name} />;
    case 'number':
    case 'currency':
    case 'percent':
      return <input type="number" step="any" value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} className={input} aria-label={field.name} />;
    case 'date':
      return <input type={field.options.includeTime ? 'datetime-local' : 'date'} value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} className={cn(input, 'w-auto')} aria-label={field.name} />;
    case 'checkbox':
      return (
        <label className="flex items-center gap-2 text-[14px]">
          <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} className="size-4 accent-brand-600" aria-label={field.name} /> Yes
        </label>
      );
    case 'rating':
      return (
        <span className="flex gap-1">
          {Array.from({ length: field.options.max ?? 5 }, (_, i) => (
            <button key={i} type="button" onClick={() => onChange(Number(value) === i + 1 ? null : i + 1)} aria-label={`${i + 1} stars`}>
              <Star size={22} className={i < (Number(value) || 0) ? 'fill-amber-400 text-amber-400' : 'text-line-strong'} />
            </button>
          ))}
        </span>
      );
    case 'singleSelect':
      return (
        <div className="space-y-1.5" role="radiogroup" aria-label={field.name}>
          {(field.options.choices ?? []).map((c) => (
            <label key={c.id} className="flex items-center gap-2 text-[14px]">
              <input type="radio" name={field.id} checked={value === c.id} onChange={() => onChange(c.id)} className="accent-brand-600" /> {c.name}
            </label>
          ))}
        </div>
      );
    case 'multiSelect':
      return (
        <div className="space-y-1.5" aria-label={field.name}>
          {(field.options.choices ?? []).map((c) => (
            <label key={c.id} className="flex items-center gap-2 text-[14px]">
              <input type="checkbox" checked={list.includes(c.id)} onChange={() => toggle(c.id)} className="accent-brand-600" /> {c.name}
            </label>
          ))}
        </div>
      );
    case 'person':
      return (
        <select
          multiple={!!field.options.multiple}
          value={field.options.multiple ? list : (list[0] ?? '')}
          onChange={(e) => onChange(field.options.multiple ? [...e.target.selectedOptions].map((o) => o.value) : e.target.value ? [e.target.value] : null)}
          className={cn(input, field.options.multiple && 'h-28 py-1')}
          aria-label={field.name}
        >
          {!field.options.multiple && <option value="">Choose…</option>}
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
      );
    case 'link':
      return (
        <div className="max-h-48 space-y-1.5 overflow-y-auto rounded-lg p-2 ring-1 ring-line" aria-label={field.name}>
          {(links ?? []).map((r) => (
            <label key={r.id} className="flex items-center gap-2 text-[14px]">
              <input type="checkbox" checked={list.includes(r.id)} onChange={() => toggle(r.id)} className="accent-brand-600" /> {r.title}
            </label>
          ))}
          {!links?.length && <p className="text-[13px] text-subtle">Nothing to choose yet</p>}
        </div>
      );
    case 'attachment': {
      const files = (Array.isArray(value) ? value : []) as Attachment[];
      return (
        <div className="space-y-1.5">
          {files.map((a) => (
            <div key={a.id} className="flex items-center gap-2 rounded-md bg-hover px-2 py-1 text-[13px]">
              <FileText size={14} /> <span className="min-w-0 flex-1 truncate">{a.name}</span>
              <button type="button" onClick={() => onChange(files.filter((x) => x.id !== a.id))} aria-label={`Remove ${a.name}`}>
                <X size={13} />
              </button>
            </div>
          ))}
          <button type="button" disabled={!upload || busy} onClick={() => file.current?.click()} className="flex items-center gap-2 rounded-lg border border-dashed border-line-strong px-3 py-2 text-[13px] text-ink-2 hover:bg-hover">
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />} Add a file
          </button>
          <input
            ref={file}
            type="file"
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f || !upload) return;
              setBusy(true);
              try {
                onChange([...files, await upload(f)]);
              } catch (err) {
                toast.error((err as Error).message);
              } finally {
                setBusy(false);
                e.target.value = '';
              }
            }}
            aria-label={`Upload to ${field.name}`}
          />
        </div>
      );
    }
    default:
      return <input type={field.type === 'email' ? 'email' : field.type === 'url' ? 'url' : field.type === 'phone' ? 'tel' : 'text'} value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} className={input} aria-label={field.name} />;
  }
}

/** The page people answer a base form on (`/bf/:viewId`): each answer becomes a record. */
export function FormFill({ viewId }: { viewId: string }) {
  const { data: info, error, isLoading } = useQuery({ queryKey: ['base', 'form', viewId], queryFn: () => api<BaseFormInfo>(`/base/forms/${viewId}`), retry: false });
  const { data: users } = useUsers();
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [done, setDone] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  if (isLoading) return <Shell><Skeleton className="h-80" /></Shell>;
  if (error || !info)
    return (
      <Shell>
        <EmptyState title="This form is not available">{(error as Error)?.message}</EmptyState>
      </Shell>
    );
  if (done)
    return (
      <Shell>
        <div className="rounded-2xl bg-surface p-8 text-center shadow-sm ring-1 ring-line" data-testid="form-thanks">
          <CheckCircle2 size={40} className="mx-auto text-emerald-500" />
          <p className="mt-3 text-[16px] font-medium text-ink">{done}</p>
          <Button className="mt-4" onClick={() => (setDone(null), setValues({}))}>
            Submit another answer
          </Button>
        </div>
      </Shell>
    );
  const submit = async () => {
    const missing = info.required.filter((id) => {
      const v = values[id];
      return v === undefined || v === null || v === '' || v === false || (Array.isArray(v) && !v.length);
    });
    if (missing.length) return void toast.error(`Please answer: ${missing.map((id) => info.fields.find((f) => f.id === id)?.name).join(', ')}`);
    setSending(true);
    try {
      // Date-times are typed in local time.
      const out = Object.fromEntries(Object.entries(values).map(([k, v]) => [k, info.fields.find((f) => f.id === k)?.options.includeTime && typeof v === 'string' && v ? new Date(v).toISOString() : v]));
      const r = await api<{ id: string; thanks: string }>(`/base/forms/${viewId}`, { method: 'POST', json: { values: out } });
      setDone(r.thanks || 'Thanks!');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSending(false);
    }
  };
  return (
    <Shell>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        data-testid="base-form"
      >
        <div className="rounded-2xl border-t-8 border-brand-600 bg-surface p-6 shadow-sm ring-1 ring-line">
          <h1 className="text-[24px] font-semibold text-ink">{info.title}</h1>
          {info.description && <p className="mt-2 whitespace-pre-wrap text-[14px] text-ink-2">{info.description}</p>}
          <p className="mt-3 text-[12px] text-muted">
            {info.baseName} · {info.tableName}
            {info.required.length > 0 && <span className="ml-2 text-red-600">* required</span>}
          </p>
        </div>
        {info.fields.map((f) => (
          <div key={f.id} className="rounded-2xl bg-surface p-5 shadow-sm ring-1 ring-line" data-testid="form-question" data-field={f.name}>
            <p className="mb-2 text-[15px] font-medium text-ink">
              {f.name}
              {info.required.includes(f.id) && <span className="ml-1 text-red-600">*</span>}
            </p>
            {f.description && <p className="-mt-1 mb-2 text-[12.5px] text-muted">{f.description}</p>}
            <FormQuestion
              field={f}
              value={values[f.id]}
              onChange={(v) => setValues((m) => ({ ...m, [f.id]: v }))}
              users={users ?? []}
              links={info.linkOptions[f.id]}
              upload={(file) => {
                const fd = new FormData();
                fd.append('file', file);
                return uploadFile<Attachment>(`/base/forms/${viewId}/attachments`, fd);
              }}
            />
          </div>
        ))}
        <Button type="submit" variant="primary" loading={sending} data-testid="form-submit">
          {info.submitText || 'Submit'}
        </Button>
      </form>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#eef2ff] px-4 py-10">
      <div className="mx-auto max-w-2xl">{children}</div>
    </div>
  );
}
