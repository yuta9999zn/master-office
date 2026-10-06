'use client';

import { rangeDays, type ApprovalField, type ApprovalRouteStep, type ApprovalTemplate, type UserSummary } from '@workos/shared';
import { ArrowLeft, Loader2, Paperclip, Send, UserPlus, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { previewRoute, uploadApprovalFile, useApprovalActions, useApprovalRequest } from '@/lib/approvals';
import { useMe, useUsers } from '@/lib/queries';
import { PeoplePicker } from '../chat/NewChatDialogs';
import { Avatar, Button, cn, Dialog, FileIcon } from '../ui/primitives';
import { TemplateIcon } from './bits';

type Files = Record<string, { id: string; name: string; type: string }[]>;

/** Filling in a request: the template's form on the left, who it will go to on the right (live). */
export function SubmitForm({ template, from, onBack, onDone }: { template: ApprovalTemplate; from?: string | null; onBack: () => void; onDone: (id: string) => void }) {
  const { submit } = useApprovalActions();
  const { data: previous } = useApprovalRequest(from);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [files, setFiles] = useState<Files>({});
  const [picks, setPicks] = useState<Record<string, string[]>>({});
  const [route, setRoute] = useState<{ route: ApprovalRouteStep[]; people: UserSummary[] } | null>(null);
  const [picking, setPicking] = useState<ApprovalRouteStep | null>(null);
  const seeded = useRef(false);

  // "Submit again": the answers of an earlier request (not its files).
  useEffect(() => {
    if (!previous || seeded.current) return;
    seeded.current = true;
    const v: Record<string, unknown> = {};
    for (const f of template.fields) if (f.type !== 'files' && previous.values[f.id] !== undefined) v[f.id] = previous.values[f.id];
    setValues(v);
  }, [previous, template.fields]);

  const all = useMemo(() => ({ ...values, ...Object.fromEntries(Object.entries(files).map(([k, list]) => [k, list.map((f) => f.id)])) }), [values, files]);
  useEffect(() => {
    const t = setTimeout(() => {
      previewRoute(template.id, values, picks).then(setRoute, () => undefined);
    }, 250);
    return () => clearTimeout(t);
  }, [template.id, values, picks]);

  const set = (id: string, v: unknown) => setValues((s) => ({ ...s, [id]: v }));
  const people = new Map((route?.people ?? []).map((p) => [p.id, p]));
  const missingPick = route?.route.find((r) => r.needsPick);

  const send = async () => {
    for (const f of template.fields) {
      const v = all[f.id];
      if (f.required && (v === undefined || v === '' || v === null || (Array.isArray(v) && !v.length))) return toast.error(`"${f.label}" is required`);
    }
    if (missingPick) return toast.error(`Choose who approves "${missingPick.name}"`);
    const r = await submit.mutateAsync({ templateId: template.id, values: all, picks }).catch(() => null);
    if (r) {
      toast.success(`Submitted ${r.serial}`);
      onDone(r.id);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="submit-form">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line px-5">
        <button onClick={onBack} className="rounded-md p-1 text-muted hover:bg-hover" aria-label="Back">
          <ArrowLeft size={18} />
        </button>
        <TemplateIcon icon={template.icon} color={template.color} size={30} />
        <h2 className="text-[16px] font-semibold text-ink">{template.name}</h2>
      </header>
      <div className="min-h-0 flex-1 overflow-auto bg-canvas">
        <div className="mx-auto grid max-w-[1080px] gap-6 p-6 lg:grid-cols-[1fr_360px]">
          <section className="rounded-xl bg-surface p-6 ring-1 ring-line">
            {template.description && <p className="mb-5 rounded-lg bg-brand-50/60 px-3 py-2 text-[13px] text-ink-2">{template.description}</p>}
            <div className="space-y-5">
              {template.fields.map((f) => (
                <div key={f.id}>
                  <label className="mb-1.5 block text-[13px] font-medium text-ink-2" htmlFor={`f-${f.id}`}>
                    {f.label}
                    {f.required && <span className="ml-0.5 text-red-500">*</span>}
                  </label>
                  <FieldInput f={f} value={values[f.id]} onChange={(v) => set(f.id, v)} files={files[f.id] ?? []} setFiles={(list) => setFiles((s) => ({ ...s, [f.id]: list }))} />
                </div>
              ))}
            </div>
            <div className="mt-8 flex justify-end gap-2 border-t border-line pt-4">
              <Button variant="ghost" onClick={onBack}>
                Cancel
              </Button>
              <Button variant="primary" icon={<Send size={15} />} loading={submit.isPending} onClick={() => void send()} data-testid="submit-request">
                Submit
              </Button>
            </div>
          </section>
          <aside className="h-fit rounded-xl bg-surface p-5 ring-1 ring-line" data-testid="route-preview">
            <h3 className="mb-4 text-[14px] font-semibold text-ink">Approval process</h3>
            {!route ? (
              <Loader2 className="animate-spin text-subtle" size={18} />
            ) : (
              <ol className="relative space-y-4 border-l-2 border-line pl-5">
                <Dot />
                <li className="text-[13px] text-muted">You submit</li>
                {route.route.map((r) => (
                  <li key={r.stepId} className={cn('relative', r.skipped && 'opacity-50')} data-testid="route-step" data-skipped={r.skipped ? '1' : undefined}>
                    <Dot tone={r.type === 'cc' ? 'cc' : 'approve'} />
                    <p className="flex items-center gap-2 text-[13px] font-medium text-ink">
                      {r.name}
                      <span className="rounded bg-hover px-1.5 py-px text-[11px] font-normal text-muted">{r.type === 'cc' ? 'CC' : r.userIds.length > 1 ? (r.mode === 'and' ? 'Everyone approves' : 'Any one approves') : 'Approve'}</span>
                    </p>
                    {r.skipped ? (
                      <p className="mt-1 text-[12px] text-muted">Skipped — {r.skipped.toLowerCase()}</p>
                    ) : (
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        {r.userIds.map((id) => {
                          const u = people.get(id);
                          return u ? (
                            <span key={id} className="inline-flex items-center gap-1.5 rounded-full bg-hover py-0.5 pl-0.5 pr-2.5 text-[12px] text-ink-2">
                              <Avatar user={u} size={20} /> {u.name}
                            </span>
                          ) : null;
                        })}
                        {(r.needsPick || picks[r.stepId]?.length) && (
                          <button onClick={() => setPicking(r)} className={cn('inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[12px] font-medium', r.needsPick ? 'bg-brand-600 text-white' : 'text-brand-700 hover:bg-brand-50')} data-testid="pick-approvers">
                            <UserPlus size={13} /> {r.needsPick ? 'Choose approvers' : 'Change'}
                          </button>
                        )}
                      </div>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </aside>
        </div>
      </div>
      <PickDialog step={picking} selected={picking ? picks[picking.stepId] ?? [] : []} onClose={() => setPicking(null)} onSave={(ids) => picking && setPicks((p) => ({ ...p, [picking.stepId]: ids }))} />
    </div>
  );
}

function Dot({ tone = 'start' }: { tone?: 'start' | 'approve' | 'cc' }) {
  return <span className={cn('absolute -left-[27px] mt-1 size-3 rounded-full ring-4 ring-white', tone === 'start' ? 'bg-slate-300' : tone === 'cc' ? 'bg-sky-400' : 'bg-brand-600')} />;
}

function PickDialog({ step, selected, onClose, onSave }: { step: ApprovalRouteStep | null; selected: string[]; onClose: () => void; onSave: (ids: string[]) => void }) {
  const [ids, setIds] = useState<string[]>(selected);
  useEffect(() => setIds(selected), [step, selected]);
  return (
    <Dialog
      open={!!step}
      onOpenChange={(o) => !o && onClose()}
      title={`Who approves "${step?.name ?? ''}"?`}
      width={460}
      footer={
        <Button
          variant="primary"
          disabled={!ids.length}
          onClick={() => {
            onSave(ids);
            onClose();
          }}
          data-testid="save-picks"
        >
          Done
        </Button>
      }
    >
      <PeoplePicker selected={ids} onChange={setIds} max={10} />
    </Dialog>
  );
}

const input = 'h-9 w-full rounded-lg border border-line-strong bg-surface px-3 text-[13.5px] outline-none focus:border-brand-600 focus:ring-3 focus:ring-brand-100';

function FieldInput({ f, value, onChange, files, setFiles }: { f: ApprovalField; value: unknown; onChange: (v: unknown) => void; files: { id: string; name: string; type: string }[]; setFiles: (l: { id: string; name: string; type: string }[]) => void }) {
  const { data: users } = useUsers();
  const { data: me } = useMe();
  const [uploading, setUploading] = useState(false);
  const id = `f-${f.id}`;
  switch (f.type) {
    case 'textarea':
      return <textarea id={id} value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} rows={4} placeholder={f.placeholder ?? ''} className={cn(input, 'h-auto py-2')} />;
    case 'number':
    case 'money':
      return (
        <div className="flex items-center gap-2">
          {f.type === 'money' && <span className="text-[13px] text-muted">{f.currency === 'USD' ? '$' : f.currency === 'VND' ? '₫' : '¥'}</span>}
          <input id={id} type="number" min={f.type === 'money' ? 0 : undefined} value={(value as number | string) ?? ''} onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))} className={cn(input, 'max-w-[240px]')} />
          {f.unit && <span className="text-[13px] text-muted">{f.unit}</span>}
        </div>
      );
    case 'date':
      return <input id={id} type="date" value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value || undefined)} className={cn(input, 'max-w-[220px]')} />;
    case 'daterange': {
      const r = (value as { start?: string; end?: string }) ?? {};
      const n = rangeDays(r);
      return (
        <div className="flex flex-wrap items-center gap-2">
          <input id={id} type="date" aria-label={`${f.label} start`} value={r.start ?? ''} onChange={(e) => onChange({ ...r, start: e.target.value, end: r.end && r.end >= e.target.value ? r.end : e.target.value })} className={cn(input, 'max-w-[200px]')} />
          <span className="text-muted">→</span>
          <input type="date" aria-label={`${f.label} end`} value={r.end ?? ''} min={r.start} onChange={(e) => onChange({ ...r, end: e.target.value })} className={cn(input, 'max-w-[200px]')} />
          {n !== null && n > 0 && <span className="text-[13px] text-muted" data-testid="range-days">{n} day{n === 1 ? '' : 's'}</span>}
        </div>
      );
    }
    case 'select':
      return (
        <select id={id} value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value || undefined)} className={cn(input, 'max-w-[320px]')}>
          <option value="">Choose…</option>
          {f.options?.map((o) => (
            <option key={o}>{o}</option>
          ))}
        </select>
      );
    case 'multiselect': {
      const cur = (value as string[]) ?? [];
      return (
        <div className="flex flex-wrap gap-2" id={id}>
          {f.options?.map((o) => {
            const on = cur.includes(o);
            return (
              <button key={o} type="button" onClick={() => onChange(on ? cur.filter((x) => x !== o) : [...cur, o])} className={cn('rounded-full px-3 py-1 text-[13px] ring-1', on ? 'bg-brand-50 text-brand-700 ring-brand-200' : 'text-ink-2 ring-line-strong hover:bg-hover')} aria-pressed={on}>
                {o}
              </button>
            );
          })}
        </div>
      );
    }
    case 'person':
      return (
        <select id={id} value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value || undefined)} className={cn(input, 'max-w-[320px]')}>
          <option value="">Choose a person…</option>
          {(users ?? [])
            .filter((u) => u.id !== me?.user.id)
            .map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
        </select>
      );
    case 'files':
      return (
        <div>
          {files.length > 0 && (
            <ul className="mb-2 space-y-1.5">
              {files.map((x) => (
                <li key={x.id} className="flex items-center gap-2 rounded-lg bg-canvas px-2.5 py-1.5 text-[13px] ring-1 ring-line" data-testid="attached-file">
                  <FileIcon r={{ type: x.type as never, metadata: {}, mimeType: null }} size={18} />
                  <span className="min-w-0 flex-1 truncate">{x.name}</span>
                  <button onClick={() => setFiles(files.filter((y) => y.id !== x.id))} className="rounded p-0.5 text-muted hover:bg-hover" aria-label={`Remove ${x.name}`}>
                    <X size={14} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-dashed border-line-strong px-3 py-2 text-[13px] text-ink-2 hover:bg-hover">
            {uploading ? <Loader2 size={15} className="animate-spin" /> : <Paperclip size={15} />} Attach files
            <input
              id={id}
              type="file"
              multiple
              className="hidden"
              data-testid="file-input"
              onChange={async (e) => {
                const picked = [...(e.target.files ?? [])];
                e.target.value = '';
                setUploading(true);
                const added: typeof files = [];
                for (const file of picked)
                  try {
                    const r = await uploadApprovalFile(file);
                    added.push({ id: r.id, name: r.name, type: r.type });
                  } catch (err) {
                    toast.error((err as Error).message);
                  }
                setUploading(false);
                setFiles([...files, ...added]);
              }}
            />
          </label>
        </div>
      );
    default:
      return <input id={id} value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} placeholder={f.placeholder ?? ''} className={input} />;
  }
}
