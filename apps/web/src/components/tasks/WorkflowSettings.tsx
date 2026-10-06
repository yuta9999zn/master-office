'use client';

import { WORKFLOWS, type TaskStatus, type WorkflowId } from '@workos/shared';
import { ArrowDown, ArrowRight, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { cn } from '../ui/primitives';

const CATS: { id: TaskStatus['category']; label: string }[] = [
  { id: 'todo', label: 'To do' },
  { id: 'doing', label: 'In progress' },
  { id: 'done', label: 'Done' },
];
const field = 'h-8 rounded-md border border-line-strong bg-surface px-2 text-[12.5px] outline-none focus:border-brand-500';

/** Status chips of a workflow, in order, with arrows where it only moves forward. */
export function WorkflowStrip({ statuses }: { statuses: TaskStatus[] }) {
  return (
    <span className="flex flex-wrap items-center gap-1">
      {statuses.map((s, i) => (
        <span key={s.id} className="flex items-center gap-1">
          {i > 0 && <ArrowRight size={10} className="text-subtle" />}
          <span className="rounded px-1.5 py-px text-[11px] font-medium" style={{ background: `${s.color}1f`, color: s.color }}>
            {s.name}
          </span>
        </span>
      ))}
    </span>
  );
}

/**
 * Choosing a professional workflow (§76) — or editing the statuses: name, color, kind, and which statuses each one
 * may move to (empty = anywhere). `strict` enforces those transitions on the board and in the issue panel.
 */
export function WorkflowSettings({
  workflow,
  setWorkflow,
  statuses,
  setStatuses,
  strict,
  setStrict,
}: {
  workflow: WorkflowId;
  setWorkflow: (w: WorkflowId) => void;
  statuses: TaskStatus[];
  setStatuses: (s: TaskStatus[]) => void;
  strict: boolean;
  setStrict: (v: boolean) => void;
}) {
  const edit = (i: number, p: Partial<TaskStatus>) => {
    setStatuses(statuses.map((s, j) => (i === j ? { ...s, ...p } : s)));
    setWorkflow('custom');
  };
  const move = (i: number, by: number) => {
    const n = [...statuses];
    const [x] = n.splice(i, 1);
    n.splice(i + by, 0, x);
    setStatuses(n);
    setWorkflow('custom');
  };
  return (
    <div className="space-y-4 text-[13px]" data-testid="workflow-settings">
      <div className="grid gap-2">
        {WORKFLOWS.map((w) => (
          <button
            key={w.id}
            role="radio"
            aria-checked={workflow === w.id}
            onClick={() => {
              setWorkflow(w.id);
              setStatuses(w.statuses);
              setStrict(['software', 'bug', 'waterfall'].includes(w.id));
            }}
            className={cn('rounded-lg p-2.5 text-left ring-1', workflow === w.id ? 'bg-selected ring-brand-300' : 'ring-line hover:bg-hover')}
            data-testid={`workflow-${w.id}`}
          >
            <span className="block font-semibold text-ink">{w.name}</span>
            <span className="mb-1.5 block text-[12px] text-muted">{w.note}</span>
            <WorkflowStrip statuses={w.statuses} />
          </button>
        ))}
        {workflow === 'custom' && <p className="rounded-lg bg-amber-50 px-3 py-2 text-[12px] text-amber-800 ring-1 ring-amber-200">Custom workflow (edited below).</p>}
      </div>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={strict} onChange={(e) => setStrict(e.target.checked)} className="accent-brand-600" data-testid="strict-workflow" />
        <span>
          <b>Strict transitions</b> — issues only move along the arrows below (e.g. In Testing → Fixing → Retest)
        </span>
      </label>
      <div>
        <p className="mb-1.5 font-medium text-ink-2">Statuses and transitions</p>
        <ul className="space-y-2">
          {statuses.map((s, i) => (
            <li key={s.id} className="rounded-lg p-2 ring-1 ring-line" data-testid="status-row" data-id={s.id}>
              <div className="flex items-center gap-1.5">
                <input type="color" value={s.color} onChange={(e) => edit(i, { color: e.target.value })} className="size-7 shrink-0 cursor-pointer rounded border-0 bg-transparent p-0" aria-label={`Color of ${s.name}`} />
                <input value={s.name} onChange={(e) => edit(i, { name: e.target.value })} className={cn(field, 'min-w-0 flex-1')} aria-label="Status name" />
                <select value={s.category} onChange={(e) => edit(i, { category: e.target.value as TaskStatus['category'] })} className={field} aria-label="Kind">
                  {CATS.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
                <button onClick={() => move(i, -1)} disabled={i === 0} className="rounded p-1 text-muted hover:bg-hover disabled:opacity-30" aria-label="Move up">
                  <ArrowUp size={14} />
                </button>
                <button onClick={() => move(i, 1)} disabled={i === statuses.length - 1} className="rounded p-1 text-muted hover:bg-hover disabled:opacity-30" aria-label="Move down">
                  <ArrowDown size={14} />
                </button>
                <button
                  onClick={() => {
                    setStatuses(statuses.filter((x) => x.id !== s.id).map((x) => ({ ...x, next: x.next?.filter((n) => n !== s.id) })));
                    setWorkflow('custom');
                  }}
                  disabled={statuses.length < 2}
                  className="rounded p-1 text-muted hover:bg-hover disabled:opacity-30"
                  aria-label={`Remove ${s.name}`}
                >
                  <Trash2 size={14} />
                </button>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-1 pl-8">
                <span className="text-[11.5px] text-muted">Moves to:</span>
                {statuses
                  .filter((x) => x.id !== s.id)
                  .map((x) => {
                    const on = !!s.next?.includes(x.id);
                    return (
                      <button
                        key={x.id}
                        onClick={() => edit(i, { next: on ? s.next!.filter((n) => n !== x.id) : [...(s.next ?? []), x.id] })}
                        className={cn('rounded-full px-2 py-px text-[11px] ring-1', on ? 'bg-brand-50 font-medium text-brand-700 ring-brand-200' : 'text-muted ring-line hover:bg-hover')}
                        aria-pressed={on}
                      >
                        {x.name}
                      </button>
                    );
                  })}
                {!s.next?.length && <span className="text-[11px] italic text-subtle">anywhere</span>}
              </div>
            </li>
          ))}
        </ul>
        <button
          onClick={() => {
            const id = `s${Date.now().toString(36)}`;
            setStatuses([...statuses.slice(0, -1), { id, name: 'New status', color: '#64748b', category: 'doing' }, ...statuses.slice(-1)]);
            setWorkflow('custom');
          }}
          className="mt-2 flex items-center gap-1 rounded-md px-2 py-1 text-[12.5px] font-medium text-brand-700 hover:bg-brand-50"
        >
          <Plus size={13} /> Add status
        </button>
      </div>
    </div>
  );
}
