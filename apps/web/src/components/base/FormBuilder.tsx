'use client';

import { COMPUTED_TYPES, type BaseTable, type FormConfig, type ViewConfig } from '@workos/base-model';
import { ArrowDown, ArrowUp, Copy, ExternalLink, Plus, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button, cn, Menu, MenuContent, MenuItem, MenuTrigger } from '../ui/primitives';
import { FieldIcon } from './field-meta';

/** Form view builder (§75): questions are fields of the table; answers become records. */
export function FormBuilder({ table, viewId, config, setConfig, editable }: { table: BaseTable; viewId: string; config: ViewConfig; setConfig: (c: Partial<ViewConfig>) => void; editable: boolean }) {
  const server: FormConfig = config.form ?? { title: table.name, description: '', fields: [], required: [], open: false, submitText: 'Submit', thanks: '' };
  // Clicks show at once; the saved view replaces the local copy when it changes.
  const [form, setForm] = useState(server);
  const stamp = JSON.stringify(server);
  useEffect(() => setForm(JSON.parse(stamp) as FormConfig), [stamp]);
  const set = (patch: Partial<FormConfig>) => {
    const next = { ...form, ...patch };
    setForm(next);
    setConfig({ form: next });
  };
  const [title, setTitle] = useState(form.title);
  const [description, setDescription] = useState(form.description);
  const [thanks, setThanks] = useState(form.thanks);
  const [submitText, setSubmitText] = useState(form.submitText);
  useEffect(() => (setTitle(form.title), setDescription(form.description), setThanks(form.thanks), setSubmitText(form.submitText)), [viewId]); // eslint-disable-line react-hooks/exhaustive-deps
  const asked = form.fields.map((id) => table.fields.find((f) => f.id === id)).filter((f): f is NonNullable<typeof f> => !!f);
  const left = table.fields.filter((f) => !form.fields.includes(f.id) && !COMPUTED_TYPES.includes(f.type));
  const link = typeof window === 'undefined' ? `/bf/${viewId}` : `${window.location.origin}/bf/${viewId}`;
  const move = (i: number, d: number) => {
    const next = [...form.fields];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    set({ fields: next });
  };
  return (
    <div className="flex min-h-0 flex-1 overflow-hidden bg-[#eef2ff]" data-testid="form-builder">
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto max-w-2xl space-y-3">
          <div className="rounded-2xl border-t-8 border-brand-600 bg-surface p-5 shadow-sm ring-1 ring-line">
            <input disabled={!editable} value={title} onChange={(e) => setTitle(e.target.value)} onBlur={() => title !== form.title && set({ title })} className="w-full bg-transparent text-[22px] font-semibold text-ink outline-none" aria-label="Form title" />
            <textarea disabled={!editable} value={description} onChange={(e) => setDescription(e.target.value)} onBlur={() => description !== form.description && set({ description })} rows={2} placeholder="Description" className="mt-1 w-full resize-none bg-transparent text-[14px] text-ink-2 outline-none" aria-label="Form description" />
          </div>
          {asked.map((f, i) => (
            <div key={f.id} className="group rounded-2xl bg-surface p-4 shadow-sm ring-1 ring-line" data-testid="form-builder-question" data-field={f.name}>
              <div className="flex items-center gap-2">
                <FieldIcon type={f.type} />
                <span className="flex-1 text-[14.5px] font-medium text-ink">
                  {f.name}
                  {form.required.includes(f.id) && <span className="ml-1 text-red-600">*</span>}
                </span>
                {editable && (
                  <>
                    <label className="flex items-center gap-1.5 text-[12.5px] text-muted">
                      <input type="checkbox" checked={form.required.includes(f.id)} onChange={(e) => set({ required: e.target.checked ? [...form.required, f.id] : form.required.filter((x) => x !== f.id) })} className="accent-brand-600" aria-label={`${f.name} required`} />
                      Required
                    </label>
                    <button disabled={i === 0} onClick={() => move(i, -1)} className="rounded p-1 text-muted hover:bg-hover disabled:opacity-30" aria-label={`Move ${f.name} up`}>
                      <ArrowUp size={14} />
                    </button>
                    <button disabled={i === asked.length - 1} onClick={() => move(i, 1)} className="rounded p-1 text-muted hover:bg-hover disabled:opacity-30" aria-label={`Move ${f.name} down`}>
                      <ArrowDown size={14} />
                    </button>
                    <button onClick={() => set({ fields: form.fields.filter((x) => x !== f.id), required: form.required.filter((x) => x !== f.id) })} className="rounded p-1 text-muted hover:bg-hover" aria-label={`Remove ${f.name}`}>
                      <X size={14} />
                    </button>
                  </>
                )}
              </div>
              {f.description && <p className="mt-1 text-[12.5px] text-muted">{f.description}</p>}
              <div className="mt-2 h-9 rounded-lg border border-dashed border-line-strong bg-canvas" />
            </div>
          ))}
          {editable && left.length > 0 && (
            <Menu>
              <MenuTrigger asChild>
                <button className="flex w-full items-center justify-center gap-1.5 rounded-2xl border-2 border-dashed border-line-strong py-3 text-[13px] text-ink-2 hover:bg-surface" data-testid="form-add-question">
                  <Plus size={15} /> Add a question
                </button>
              </MenuTrigger>
              <MenuContent>
                {left.map((f) => (
                  <MenuItem key={f.id} icon={<FieldIcon type={f.type} />} onSelect={() => set({ fields: [...form.fields, f.id] })}>
                    {f.name}
                  </MenuItem>
                ))}
              </MenuContent>
            </Menu>
          )}
          <div>
            <span className="inline-block rounded-lg bg-brand-600 px-4 py-2 text-[14px] text-white">{form.submitText || 'Submit'}</span>
          </div>
        </div>
      </div>
      <aside className="w-80 shrink-0 space-y-4 overflow-y-auto border-l border-line bg-surface p-4 text-[13px]" data-testid="form-settings">
        <div>
          <p className="mb-1 font-medium text-ink">Share</p>
          <label className={cn('flex items-start gap-2', !editable && 'opacity-60')}>
            <input type="checkbox" disabled={!editable} checked={form.open} onChange={(e) => set({ open: e.target.checked })} className="mt-0.5 accent-brand-600" data-testid="form-open" />
            <span>Anyone in the workspace can answer (they do not need access to the base)</span>
          </label>
          <div className="mt-2 flex gap-1.5">
            <input readOnly value={link} className="h-8 min-w-0 flex-1 rounded-md border border-line-strong bg-canvas px-2 text-[12px]" aria-label="Form link" />
            <Button size="sm" icon={<Copy size={13} />} onClick={() => void navigator.clipboard?.writeText(link).then(() => toast.success('Link copied'))}>
              Copy
            </Button>
          </div>
          <a href={`/bf/${viewId}`} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-brand-700 hover:underline" data-testid="form-open-link">
            <ExternalLink size={13} /> Open the form
          </a>
        </div>
        <label className="block">
          <span className="mb-1 block font-medium text-ink">Submit button</span>
          <input disabled={!editable} value={submitText} onChange={(e) => setSubmitText(e.target.value)} onBlur={() => submitText !== form.submitText && set({ submitText })} className="h-8 w-full rounded-md border border-line-strong px-2" aria-label="Submit button text" />
        </label>
        <label className="block">
          <span className="mb-1 block font-medium text-ink">After submitting</span>
          <textarea disabled={!editable} value={thanks} onChange={(e) => setThanks(e.target.value)} onBlur={() => thanks !== form.thanks && set({ thanks })} rows={3} className="w-full rounded-md border border-line-strong p-2" aria-label="Thank-you message" />
        </label>
        <p className="text-[12px] text-muted">Each answer becomes a record of {table.name}. Computed fields are filled in automatically.</p>
      </aside>
    </div>
  );
}
