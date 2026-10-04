'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Clock, FileInput, Loader2, Play, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { Button, cn } from '../../ui/primitives';
import type { MacroDef } from './store';

// Installable triggers that run on the server (time-driven, on form submit) — docs/ARCHITECTURE.md §48.

type Schedule = { every: 'minutes' | 'hours' | 'day' | 'week'; n?: number; hour?: number; weekday?: number };
interface ServerTrigger {
  id: string;
  macroId: string;
  fn: string;
  kind: 'time' | 'formSubmit';
  schedule: Schedule | null;
  enabled: boolean;
  creator: string;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastStatus: 'ok' | 'error' | null;
  lastError: string | null;
  lastLogs: string[] | null;
  lastMs: number | null;
  failures: number;
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const hourLabel = (h: number) => `${String(h).padStart(2, '0')}:00`;
export function describeSchedule(s: Schedule | null) {
  if (!s) return '';
  if (s.every === 'minutes') return s.n === 1 ? 'Every minute' : `Every ${s.n} minutes`;
  if (s.every === 'hours') return s.n === 1 ? 'Every hour' : `Every ${s.n} hours`;
  if (s.every === 'day') return `Every day at ${hourLabel(s.hour ?? 0)}`;
  return `Every ${DAYS[s.weekday ?? 1]} at ${hourLabel(s.hour ?? 0)}`;
}
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');

export function ServerTriggers({ resourceId, macros, editable }: { resourceId: string; macros: MacroDef[]; editable: boolean }) {
  const qc = useQueryClient();
  const key = ['macro-triggers', resourceId];
  const { data: list } = useQuery({ queryKey: key, queryFn: () => api<ServerTrigger[]>(`/resources/${resourceId}/macro-triggers`), refetchInterval: 20_000 });
  const refresh = () => qc.invalidateQueries({ queryKey: key });
  const [adding, setAdding] = useState(false);
  const [macroId, setMacroId] = useState('');
  const [fn, setFn] = useState('');
  const [kind, setKind] = useState<'time' | 'formSubmit'>('time');
  const [every, setEvery] = useState<Schedule['every']>('hours');
  const [n, setN] = useState(1);
  const [hour, setHour] = useState(9);
  const [weekday, setWeekday] = useState(1);
  const macro = macros.find((m) => m.id === macroId) ?? macros[0];

  const create = useMutation({
    mutationFn: () =>
      api(`/resources/${resourceId}/macro-triggers`, {
        method: 'POST',
        json: { macroId: macro!.id, fn: fn || macro!.fn, kind, schedule: kind === 'time' ? { every, ...(every === 'minutes' || every === 'hours' ? { n } : { hour, ...(every === 'week' ? { weekday } : {}) }) } : null },
      }),
    onSuccess: () => (setAdding(false), refresh(), toast.success('Trigger saved')),
    onError: (e) => toast.error((e as Error).message),
  });
  const runNow = useMutation({
    mutationFn: (id: string) => api<{ status: string; error: string | null }>(`/macro-triggers/${id}/run`, { method: 'POST' }),
    onSuccess: (r) => (refresh(), r.error ? toast.error(r.error) : toast.success('Ran on the server')),
    onError: (e) => toast.error((e as Error).message),
  });
  const setEnabled = (t: ServerTrigger, enabled: boolean) => void api(`/macro-triggers/${t.id}`, { method: 'PATCH', json: { enabled } }).then(refresh, (e: Error) => toast.error(e.message));
  const remove = (t: ServerTrigger) => void api(`/macro-triggers/${t.id}`, { method: 'DELETE' }).then(refresh, (e: Error) => toast.error(e.message));

  const nOptions = every === 'minutes' ? [1, 5, 10, 15, 30] : [1, 2, 4, 6, 8, 12];
  return (
    <div className="mt-3 border-t border-line pt-3" data-testid="server-triggers">
      <div className="flex items-center px-2 pb-1">
        <span className="flex-1 text-[11px] font-semibold uppercase tracking-wide text-subtle">Server triggers</span>
        {editable && macros.length > 0 && !adding && (
          <button onClick={() => (setAdding(true), setMacroId(macros[0].id), setFn(macros[0].fn))} className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[12px] font-medium text-brand-600 hover:bg-brand-50">
            <Plus size={12} /> Add trigger
          </button>
        )}
      </div>
      <p className="px-2 pb-2 text-[11.5px] leading-relaxed text-muted">Run on the server even when nobody has the file open — on a schedule or when a linked form gets a response — as the person who adds them.</p>
      {adding && (
        <div className="mx-2 mb-2 space-y-2 rounded-lg border border-line p-2.5 text-[12.5px]" data-testid="trigger-form">
          <label className="flex items-center gap-2">
            <span className="w-20 text-muted">Macro</span>
            <select className="input h-8 flex-1" value={macro?.id} onChange={(e) => (setMacroId(e.target.value), setFn(macros.find((m) => m.id === e.target.value)?.fn ?? ''))} aria-label="Trigger macro">
              {macros.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2">
            <span className="w-20 text-muted">Function</span>
            <input className="input h-8 flex-1 font-mono" value={fn} onChange={(e) => setFn(e.target.value)} aria-label="Trigger function" />
          </label>
          <label className="flex items-center gap-2">
            <span className="w-20 text-muted">Event</span>
            <select className="input h-8 flex-1" value={kind} onChange={(e) => setKind(e.target.value as 'time' | 'formSubmit')} aria-label="Trigger event">
              <option value="time">Time-driven</option>
              <option value="formSubmit">On form submit</option>
            </select>
          </label>
          {kind === 'time' && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="w-20 text-muted">Every</span>
              <select className="input h-8" value={every} onChange={(e) => (setEvery(e.target.value as Schedule['every']), setN(1))} aria-label="Timer type">
                <option value="minutes">Minutes timer</option>
                <option value="hours">Hour timer</option>
                <option value="day">Day timer</option>
                <option value="week">Week timer</option>
              </select>
              {(every === 'minutes' || every === 'hours') && (
                <select className="input h-8" value={n} onChange={(e) => setN(Number(e.target.value))} aria-label="Interval">
                  {nOptions.map((x) => (
                    <option key={x} value={x}>
                      {describeSchedule({ every, n: x })}
                    </option>
                  ))}
                </select>
              )}
              {every === 'week' && (
                <select className="input h-8" value={weekday} onChange={(e) => setWeekday(Number(e.target.value))} aria-label="Weekday">
                  {DAYS.map((d, i) => (
                    <option key={d} value={i}>
                      {d}
                    </option>
                  ))}
                </select>
              )}
              {(every === 'day' || every === 'week') && (
                <select className="input h-8" value={hour} onChange={(e) => setHour(Number(e.target.value))} aria-label="Hour">
                  {Array.from({ length: 24 }, (_, h) => (
                    <option key={h} value={h}>
                      {hourLabel(h)}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>
              Cancel
            </Button>
            <Button size="sm" variant="primary" loading={create.isPending} disabled={!macro || !/^[A-Za-z_$][\w$]*$/.test(fn || macro.fn)} onClick={() => create.mutate()} data-testid="trigger-save">
              Save
            </Button>
          </div>
        </div>
      )}
      {(list ?? []).map((t) => {
        const m = macros.find((x) => x.id === t.macroId);
        return (
          <div key={t.id} className="mx-1 rounded-lg px-1.5 py-1.5 hover:bg-hover" data-testid="server-trigger">
            <div className="flex items-center gap-2">
              {t.kind === 'time' ? <Clock size={14} className="shrink-0 text-sky-600" /> : <FileInput size={14} className="shrink-0 text-violet-600" />}
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] text-ink">{t.kind === 'time' ? describeSchedule(t.schedule) : 'On form submit'}</div>
                <div className="truncate text-[11px] text-muted">
                  {t.fn}() · {m?.name ?? 'deleted macro'} · by {t.creator}
                </div>
              </div>
              {editable && (
                <>
                  <button onClick={() => runNow.mutate(t.id)} disabled={runNow.isPending} className="rounded p-1 text-brand-600 hover:bg-brand-50 disabled:opacity-40" aria-label={`Run ${t.fn} now on the server`}>
                    {runNow.isPending && runNow.variables === t.id ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
                  </button>
                  <button
                    role="switch"
                    aria-checked={t.enabled}
                    aria-label={`Server trigger ${t.fn}`}
                    onClick={() => setEnabled(t, !t.enabled)}
                    className={cn('relative h-5 w-9 shrink-0 rounded-full transition', t.enabled ? 'bg-brand-600' : 'bg-slate-300')}
                  >
                    <span className={cn('absolute top-0.5 size-4 rounded-full bg-white shadow transition-all', t.enabled ? 'left-[18px]' : 'left-0.5')} />
                  </button>
                  <button onClick={() => remove(t)} className="rounded p-1 text-subtle hover:text-red-600" aria-label={`Delete trigger ${t.fn}`}>
                    <Trash2 size={13} />
                  </button>
                </>
              )}
            </div>
            <div className="mt-0.5 pl-5 text-[11px] text-muted" data-testid="server-trigger-status" title={[t.lastError, ...(t.lastLogs ?? [])].filter(Boolean).join('\n')}>
              {t.lastStatus ? (
                <span className={t.lastStatus === 'error' ? 'text-red-600' : 'text-emerald-700'}>
                  {t.lastStatus === 'error' ? `Failed ${when(t.lastRunAt)}: ${t.lastError}` : `Ran ${when(t.lastRunAt)} · ${t.lastMs} ms`}
                </span>
              ) : (
                'Not run yet'
              )}
              {t.kind === 'time' && t.enabled && ` · next ${when(t.nextRunAt)}`}
              {!t.enabled && t.failures >= 5 && ' · turned off after 5 failures'}
            </div>
          </div>
        );
      })}
      {list && !list.length && !adding && <p className="px-2 text-[12px] text-subtle">No server triggers.</p>}
    </div>
  );
}
