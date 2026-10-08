'use client';

import { TRIGGER_TYPES, type PlainFlow } from '@workos/flow-model';
import type { ResourceDetail } from '@workos/shared';
import { AlertTriangle, CheckCircle2, ChevronRight, Circle, Clock, GitFork, Play, RotateCw, XCircle, Zap } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { formatDateTime, timeAgo } from '@/lib/format';
import { RUN_STATUS, TRIGGER_LABEL, useFlowActions, useFlowAutomation, useFlowRuns, type FlowRun, type FlowRunStep } from '@/lib/flow';
import { Button, cn, EmptyState, Skeleton } from '../ui/primitives';
import type { FlowStore } from './flow-store';

const field = 'w-full rounded-md border border-line-strong bg-surface px-2 py-1.5 font-mono text-[11.5px] text-ink outline-none focus:border-brand-500';

/** The Runs tab (§77 batch 2): the automation switch, problems, triggers, Run now, and every run with its steps. */
export function RunsPanel({ r, flow, store, editable, onStateless, onSelectNode }: { r: ResourceDetail; flow: PlainFlow; store: FlowStore; editable: boolean; onStateless: (h: (p: Record<string, unknown>) => void) => () => void; onSelectNode: (id: string) => void }) {
  const { data: auto, isLoading } = useFlowAutomation(r.id);
  const { data: runs } = useFlowRuns(r.id);
  const a = useFlowActions(r.id);
  const [selected, setSelected] = useState<string | null>(null);
  const [input, setInput] = useState('{}');
  const [inputOpen, setInputOpen] = useState(false);
  const qc = useQueryClient();
  const refresh = useCallback(() => qc.invalidateQueries({ queryKey: ['flow', r.id] }), [qc, r.id]);
  useEffect(() => onStateless((p) => p.type === 'runs' && refresh()), [onStateless, refresh]);
  // Edits on the canvas (a new trigger, a changed config) reach the server a moment later: re-read the status then.
  useEffect(() => {
    const t = setTimeout(() => qc.invalidateQueries({ queryKey: ['flow', r.id, 'automation'] }), 500);
    return () => clearTimeout(t);
  }, [flow, qc, r.id]);
  useEffect(() => {
    if (!selected && runs?.length) setSelected(runs[0].id);
  }, [runs, selected]);
  const run = runs?.find((x) => x.id === selected) ?? null;
  const triggers = useMemo(() => flow.nodes.filter((n) => n.automation?.role === 'trigger'), [flow.nodes]);
  const manual = triggers.find((n) => n.automation?.type === 'manual') ?? triggers[0];
  const enabled = flow.info.automation;

  const runNow = () => {
    let parsed: Record<string, unknown> = {};
    try {
      parsed = input.trim() ? (JSON.parse(input) as Record<string, unknown>) : {};
    } catch {
      toast.error('The input must be a JSON object, e.g. {"name": "Aiko"}');
      return;
    }
    a.runNow.mutate({ nodeId: manual?.id ?? null, input: parsed }, { onSuccess: (res) => (setSelected(res.id), toast.success(res.status === 'succeeded' ? 'The flow ran' : res.status === 'waiting' ? 'The flow is waiting' : `The flow failed: ${res.error ?? ''}`)) });
  };

  if (isLoading || !auto) return <div className="flex-1 p-4"><Skeleton className="h-64" /></div>;
  return (
    <div className="flex min-h-0 flex-1" data-testid="runs-panel">
      <aside className="flex w-[340px] shrink-0 flex-col border-r border-line bg-surface">
        <div className="space-y-3 border-b border-line p-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-[14px] font-semibold text-ink">Automation</div>
              <div className="text-[12px] text-muted">{enabled ? 'On — trigger shapes start runs.' : 'Off — nothing starts by itself.'}</div>
            </div>
            <button
              role="switch"
              aria-checked={enabled}
              aria-label="Automation on"
              disabled={!editable}
              onClick={() => a.setEnabled.mutate(!enabled)}
              className={cn('relative h-6 w-11 rounded-full transition-colors disabled:opacity-60', enabled ? 'bg-brand-600' : 'bg-line-strong')}
              data-testid="automation-switch"
            >
              <span className={cn('absolute top-0.5 size-5 rounded-full bg-white shadow transition-all', enabled ? 'left-[22px]' : 'left-0.5')} />
            </button>
          </div>
          {auto.problems.length > 0 && (
            <ul className="space-y-1 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800" data-testid="automation-problems">
              {auto.problems.map((p, i) => (
                <li key={i} className="flex items-start gap-1.5">
                  <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                  {p.nodeId ? (
                    <button className="text-left underline-offset-2 hover:underline" onClick={() => onSelectNode(p.nodeId!)}>
                      {p.text}
                    </button>
                  ) : (
                    <span>{p.text}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
          <div>
            <div className="mb-1 text-[12px] font-medium text-ink-2">Triggers</div>
            {triggers.length === 0 && <p className="text-[12px] text-muted">None yet — select a shape and give it the Trigger role in the Automation tab.</p>}
            <ul className="space-y-1">
              {triggers.map((n) => {
                const t = auto.triggers.find((x) => x.nodeId === n.id);
                const def = TRIGGER_TYPES.find((d) => d.id === n.automation?.type);
                return (
                  <li key={n.id}>
                    <button onClick={() => onSelectNode(n.id)} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] hover:bg-hover" data-testid="trigger-row">
                      <Zap size={14} className={enabled && t ? 'text-amber-500' : 'text-muted'} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-ink">{n.text || def?.label || 'Trigger'}</span>
                        <span className="block truncate text-[11px] text-muted">
                          {def?.label ?? 'No type yet'}
                          {t?.nextRunAt ? ` · next ${formatDateTime(t.nextRunAt)}` : ''}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
          <div className="space-y-2">
            <div className="flex gap-2">
              <Button variant="primary" icon={<Play size={14} />} disabled={!editable || !manual} loading={a.runNow.isPending} onClick={runNow} data-testid="run-now">
                Run now
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setInputOpen(!inputOpen)} aria-expanded={inputOpen}>
                {inputOpen ? 'Hide input' : 'With input…'}
              </Button>
            </div>
            {inputOpen && <textarea value={input} onChange={(e) => setInput(e.target.value)} rows={3} className={field} aria-label="Run input (JSON)" placeholder='{"name": "Aiko", "seats": 3}' />}
            {!manual && triggers.length > 0 && <p className="text-[11.5px] text-muted">Run now starts a test run at “{triggers[0].text}”.</p>}
          </div>
        </div>
        <div className="flex items-center justify-between px-4 pb-1 pt-3 text-[12px] font-medium text-ink-2">
          <span>Runs</span>
          <span className="text-muted">
            {auto.counts.total} · {auto.counts.failed} failed{auto.counts.waiting ? ` · ${auto.counts.waiting} waiting` : ''}
          </span>
        </div>
        <ul className="min-h-0 flex-1 overflow-y-auto px-2 pb-2" data-testid="run-list">
          {runs?.length === 0 && <li className="px-2 py-3 text-[12.5px] text-muted">No runs yet.</li>}
          {runs?.map((x) => (
            <li key={x.id}>
              <button onClick={() => setSelected(x.id)} className={cn('flex w-full items-center gap-2 rounded-md px-2 py-2 text-left', selected === x.id ? 'bg-selected' : 'hover:bg-hover')} data-testid="run-row" data-status={x.status}>
                <StatusIcon status={x.status} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] text-ink">
                    {TRIGGER_LABEL[x.triggerType] ?? x.triggerType}
                    {x.runBy ? ` · ${x.runBy.name}` : ''}
                  </span>
                  <span className="block text-[11px] text-muted">{timeAgo(x.startedAt)} · {x.steps.length} steps</span>
                </span>
                <ChevronRight size={14} className="text-muted" />
              </button>
            </li>
          ))}
        </ul>
      </aside>
      <div className="min-w-0 flex-1 overflow-y-auto p-5">
        {!run ? (
          <EmptyState icon={<Play size={28} />} title="Nothing has run yet">
            Turn Automation on and let a trigger fire, or press Run now to try the flow with sample input.
          </EmptyState>
        ) : (
          <RunDetail run={run} editable={editable} onResume={() => a.resume.mutate(run.id)} onCancel={() => a.cancel.mutate(run.id)} onSelectNode={onSelectNode} busy={a.resume.isPending || a.cancel.isPending} />
        )}
      </div>
    </div>
  );
}

function StatusIcon({ status }: { status: FlowRun['status'] }) {
  if (status === 'succeeded') return <CheckCircle2 size={16} className="shrink-0 text-emerald-600" />;
  if (status === 'failed') return <XCircle size={16} className="shrink-0 text-red-600" />;
  if (status === 'waiting') return <Clock size={16} className="shrink-0 text-amber-600" />;
  if (status === 'cancelled') return <Circle size={16} className="shrink-0 text-muted" />;
  return <RotateCw size={16} className="shrink-0 animate-spin text-sky-600" />;
}

function RunDetail({ run, editable, onResume, onCancel, onSelectNode, busy }: { run: FlowRun; editable: boolean; onResume: () => void; onCancel: () => void; onSelectNode: (id: string) => void; busy: boolean }) {
  const [showTrigger, setShowTrigger] = useState(false);
  const st = RUN_STATUS[run.status];
  const ms = run.finishedAt ? new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime() : null;
  return (
    <div data-testid="run-detail" data-status={run.status}>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <span className={cn('rounded-md px-2 py-0.5 text-[12px] font-medium', st.tone)} data-testid="run-status">
          {st.label}
        </span>
        <span className="text-[13px] text-ink-2">
          {TRIGGER_LABEL[run.triggerType] ?? run.triggerType}
          {run.runBy ? ` by ${run.runBy.name}` : ''} · {formatDateTime(run.startedAt)}
          {ms !== null ? ` · ${ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`}` : ''}
        </span>
        {run.status === 'waiting' && editable && (
          <span className="ml-auto flex gap-2">
            <Button size="sm" variant="primary" loading={busy} onClick={onResume} data-testid="run-resume">
              Continue now
            </Button>
            <Button size="sm" variant="ghost" onClick={onCancel} data-testid="run-cancel">
              Cancel
            </Button>
          </span>
        )}
      </div>
      {run.status === 'waiting' && run.resumeAt && <p className="mb-3 text-[12.5px] text-amber-700">Waiting — continues {formatDateTime(run.resumeAt)}.</p>}
      {run.error && (
        <p className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] text-red-700" data-testid="run-error">
          {run.error}
        </p>
      )}
      <ol className="relative space-y-1 border-l border-line pl-5">
        {run.steps.map((s, i) => (
          <Step key={`${s.nodeId}-${i}`} s={s} onSelectNode={onSelectNode} />
        ))}
      </ol>
      <button onClick={() => setShowTrigger(!showTrigger)} className="mt-4 text-[12px] text-brand-600 hover:underline" aria-expanded={showTrigger}>
        {showTrigger ? 'Hide trigger data' : 'Show trigger data'}
      </button>
      {showTrigger && <pre className="mt-2 max-h-80 overflow-auto rounded-md bg-canvas p-3 text-[11.5px] text-ink-2">{JSON.stringify(run.trigger, null, 2)}</pre>}
    </div>
  );
}

function Step({ s, onSelectNode }: { s: FlowRunStep; onSelectNode: (id: string) => void }) {
  const [open, setOpen] = useState(s.status === 'error');
  const icon =
    s.status === 'error' ? <XCircle size={14} className="text-red-600" /> : s.status === 'waiting' ? <Clock size={14} className="text-amber-600" /> : s.role === 'condition' ? <GitFork size={14} className="text-violet-600" /> : s.role === 'trigger' ? <Zap size={14} className="text-amber-500" /> : s.status === 'passed' ? <Circle size={14} className="text-muted" /> : <CheckCircle2 size={14} className="text-emerald-600" />;
  const has = s.output !== undefined && s.output !== null && !(typeof s.output === 'object' && !Object.keys(s.output as object).length);
  return (
    <li className="relative" data-testid="run-step" data-node={s.nodeId} data-status={s.status}>
      <span className="absolute -left-[27px] top-1.5 grid size-4 place-items-center rounded-full bg-surface">{icon}</span>
      <div className={cn('rounded-md px-2 py-1.5', s.status === 'error' && 'bg-red-50')}>
        <div className="flex items-center gap-2 text-[13px]">
          <button onClick={() => onSelectNode(s.nodeId)} className="font-medium text-ink hover:text-brand-600">
            {s.name}
          </button>
          <span className="text-[11.5px] text-muted">
            {s.role === 'none' ? 'step' : s.role}
            {s.type ? ` · ${s.type}` : ''}
            {s.branch ? ` · ${s.branch === 'yes' ? 'Yes' : 'No'}` : ''}
          </span>
          {has && (
            <button onClick={() => setOpen(!open)} className="ml-auto text-[11.5px] text-brand-600 hover:underline">
              {open ? 'hide' : 'details'}
            </button>
          )}
        </div>
        {s.error && <p className="mt-0.5 text-[12px] text-red-700">{s.error}</p>}
        {open && has && <pre className="mt-1 max-h-60 overflow-auto rounded bg-canvas p-2 text-[11px] text-ink-2">{JSON.stringify(s.output, null, 2)}</pre>}
      </div>
    </li>
  );
}

