'use client';

import type { FormSettings, PlainForm } from '@workos/form-model';
import type { ReactNode } from 'react';
import { cn } from '../ui/primitives';
import type { FormStore } from './form-store';

function Switch({ on, onChange, color, label, disabled }: { on: boolean; onChange: (v: boolean) => void; color: string; label: string; disabled?: boolean }) {
  return (
    <button role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => onChange(!on)} className={cn('relative h-5 w-9 shrink-0 rounded-full transition disabled:opacity-50', on ? '' : 'bg-slate-300')} style={on ? { background: color } : undefined}>
      <span className={cn('absolute top-0.5 size-4 rounded-full bg-white shadow transition', on ? 'left-[18px]' : 'left-0.5')} />
    </button>
  );
}

function Row({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-4 border-t border-slate-100 py-4 first:border-t-0">
      <div className="min-w-0 flex-1">
        <div className="text-[14px] text-slate-900">{title}</div>
        {hint && <div className="text-[12px] text-slate-500">{hint}</div>}
      </div>
      {children}
    </div>
  );
}

export function SettingsTab({ form, store, editable }: { form: PlainForm; store: FormStore; editable: boolean }) {
  const s = form.settings;
  const c = form.theme.color;
  const set = (patch: Partial<FormSettings>) => store.setSettings(patch);
  return (
    <fieldset disabled={!editable} className="space-y-3" data-testid="settings-tab">
      <section className="rounded-lg border border-slate-200 bg-white px-6 py-2">
        <Row title="Make this a quiz" hint="Assign point values, set answers and automatically provide feedback">
          <Switch label="Make this a quiz" on={s.quiz} onChange={(v) => set({ quiz: v })} color={c} />
        </Row>
        {s.quiz && (
          <>
            <Row title="Release score" hint="When respondents see their score">
              <select value={s.releaseScore} onChange={(e) => set({ releaseScore: e.target.value as FormSettings['releaseScore'] })} className="h-9 rounded-md border border-slate-300 px-2 text-[13px]" aria-label="Release score">
                <option value="immediately">Immediately after each submission</option>
                <option value="later">Later, after manual review</option>
              </select>
            </Row>
            <Row title="Respondents can see correct answers">
              <Switch label="Show correct answers" on={s.showCorrect} onChange={(v) => set({ showCorrect: v })} color={c} />
            </Row>
          </>
        )}
      </section>

      <section className="rounded-lg border border-slate-200 bg-white px-6 py-2">
        <div className="pt-3 text-[16px] font-medium">Responses</div>
        <Row title="Who can respond" hint={s.access === 'org' ? 'People in your workspace with the link' : 'Anyone with the link, no sign-in needed'}>
          <select value={s.access} onChange={(e) => set({ access: e.target.value as FormSettings['access'] })} className="h-9 rounded-md border border-slate-300 px-2 text-[13px]" aria-label="Who can respond" data-testid="access-select">
            <option value="org">Only people in the workspace</option>
            <option value="public">Anyone with the link</option>
          </select>
        </Row>
        <Row title="Collect email addresses">
          <select value={s.collectEmail} onChange={(e) => set({ collectEmail: e.target.value as FormSettings['collectEmail'] })} className="h-9 rounded-md border border-slate-300 px-2 text-[13px]" aria-label="Collect email addresses">
            <option value="off">Do not collect</option>
            <option value="verified" disabled={s.access === 'public'}>
              Verified (signed-in account)
            </option>
            <option value="input">Responder input</option>
          </select>
        </Row>
        <Row title="Send responders a copy of their response" hint={s.collectEmail === 'off' ? 'Collect email addresses first' : 'By e-mail, right after they submit'}>
          <select value={s.collectEmail === 'off' ? 'off' : s.sendCopy} disabled={s.collectEmail === 'off'} onChange={(e) => set({ sendCopy: e.target.value as FormSettings['sendCopy'] })} className="h-9 rounded-md border border-slate-300 px-2 text-[13px] disabled:opacity-50" aria-label="Send responders a copy" data-testid="send-copy-select">
            <option value="off">Off</option>
            <option value="requested">When requested</option>
            <option value="always">Always</option>
          </select>
        </Row>
        <Row title="Limit to 1 response" hint="Respondents must be signed in">
          <Switch label="Limit to 1 response" on={s.limitOne} onChange={(v) => set({ limitOne: v, ...(v && s.access === 'public' ? { access: 'org' } : {}) })} color={c} />
        </Row>
        <Row title="Allow response editing" hint="Respondents can change their answers after submitting">
          <Switch label="Allow response editing" on={s.allowEdit} onChange={(v) => set({ allowEdit: v })} color={c} />
        </Row>
        <Row title="Accepting responses">
          <Switch label="Accepting responses" on={s.accepting} onChange={(v) => set({ accepting: v })} color={c} />
        </Row>
        <Row title="Close automatically" hint="Stop accepting responses at a date and time">
          <input type="datetime-local" value={s.closesAt ? s.closesAt.slice(0, 16) : ''} onChange={(e) => set({ closesAt: e.target.value ? new Date(e.target.value).toISOString() : null })} className="h-9 rounded-md border border-slate-300 px-2 text-[13px]" aria-label="Closing date" />
        </Row>
        <Row title="Message when closed">
          <input value={s.closedMessage} onChange={(e) => set({ closedMessage: e.target.value })} className="h-9 w-72 rounded-md border border-slate-300 px-2 text-[13px]" aria-label="Closed message" />
        </Row>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white px-6 py-2">
        <div className="pt-3 text-[16px] font-medium">Presentation</div>
        <Row title="Show progress bar">
          <Switch label="Show progress bar" on={s.progressBar} onChange={(v) => set({ progressBar: v })} color={c} />
        </Row>
        <Row title="Shuffle question order" hint="Within each section">
          <Switch label="Shuffle question order" on={s.shuffle} onChange={(v) => set({ shuffle: v })} color={c} />
        </Row>
        <Row title="Respondents can see a summary of results">
          <Switch label="Show summary" on={s.showSummary} onChange={(v) => set({ showSummary: v })} color={c} />
        </Row>
        <Row title="Confirmation message">
          <input value={s.confirmation} onChange={(e) => set({ confirmation: e.target.value })} className="h-9 w-72 rounded-md border border-slate-300 px-2 text-[13px]" aria-label="Confirmation message" />
        </Row>
      </section>
    </fieldset>
  );
}
