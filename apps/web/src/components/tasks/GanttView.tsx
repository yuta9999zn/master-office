'use client';

import { ISSUE_RANK, type TaskStatus, type TaskView } from '@workos/shared';
import { CheckSquare, ChevronDown, ChevronRight } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { shortDate, useProjectLinks, useTaskActions } from '@/lib/tasks';
import { cn, EmptyState } from '../ui/primitives';
import { IssueIcon } from './issue-bits';

const DAY = 86_400_000;
// Rows, bars and arrows share pixel geometry (the app's rem is not 16px).
const ROW = 34;
const dayOf = (s: string) => new Date(`${s}T00:00:00`).getTime();
const iso = (ms: number) => {
  const d = new Date(ms + DAY / 2);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
// Finish-to-start arrows: recessive ink when the plan holds, red when the dependent starts before its predecessor ends.
const LINK = { ok: '#94a3b8', late: '#dc2626' };

type Drag = { id: string; mode: 'move' | 'end'; x0: number; dx: number };

/** The plan (§76): phase › epic › work item › subtask on a timeline, finish-to-start dependencies, drag to reschedule. */
export function GanttView({ tasks, statuses, open, projectId }: { tasks: TaskView[]; statuses: TaskStatus[]; open: (id: string) => void; projectId: string }) {
  const dated = tasks.filter((t) => t.startDate || t.dueDate);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const scroller = useRef<HTMLDivElement>(null);
  const { data: links } = useProjectLinks(projectId);
  const { update } = useTaskActions();
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  dragRef.current = drag;
  // A drag that moved does not also open the issue.
  const dragged = useRef(false);
  const px = 26;
  const LEFT = 440;
  const starts = dated.map((t) => dayOf(t.startDate ?? t.dueDate!));
  const ends = dated.map((t) => dayOf(t.dueDate ?? t.startDate!));
  const from = Math.min(...starts, Date.now()) - 3 * DAY;
  const to = Math.max(...ends, Date.now()) + 7 * DAY;
  const days = Math.round((to - from) / DAY);
  const todayX = ((new Date(new Date().toDateString()).getTime() - from) / DAY) * px;
  // Open on today rather than on the first phase.
  useEffect(() => {
    if (scroller.current) scroller.current.scrollLeft = Math.max(0, todayX - 7 * px);
  }, [dated.length > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  // Where a bar is, with the drag in progress applied (whole days).
  const spanOf = (t: TaskView, g: Drag | null = drag) => {
    let s = dayOf(t.startDate ?? t.dueDate!);
    let e = dayOf(t.dueDate ?? t.startDate!);
    const d = g?.id === t.id ? Math.round(g.dx / px) * DAY : 0;
    if (d && g!.mode === 'move') (s += d), (e += d);
    if (d && g!.mode === 'end') e = Math.max(s, e + d);
    return { s, e };
  };

  useEffect(() => {
    if (!drag) return;
    const move = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      if (Math.abs(e.clientX - d.x0) > 3) dragged.current = true;
      setDrag({ ...d, dx: e.clientX - d.x0 });
    };
    const up = () => {
      const d = dragRef.current;
      setDrag(null);
      const t = d && tasks.find((x) => x.id === d.id);
      const shift = d ? Math.round(d.dx / px) : 0;
      if (!d || !t || !shift) return;
      const { s, e } = spanOf(t, d);
      if (d.mode === 'end') update.mutate({ id: t.id, dueDate: iso(e) });
      else update.mutate({ id: t.id, ...(t.startDate ? { startDate: iso(s) } : {}), ...(t.dueDate ? { dueDate: iso(e) } : {}) });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [drag?.id, drag?.mode]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!dated.length) return <EmptyState icon={<CheckSquare size={32} />} title="Add start and due dates to see the plan" />;
  // Any depth: phase › epic › work item › subtask; an item whose parent has no dates starts a branch.
  const ids = new Set(dated.map((t) => t.id));
  const byStart = (a: TaskView, b: TaskView) => (a.startDate ?? a.dueDate!).localeCompare(b.startDate ?? b.dueDate!);
  const rows: { t: TaskView; depth: number }[] = [];
  const walk = (t: TaskView, depth: number) => {
    rows.push({ t, depth });
    if (!collapsed.has(t.id)) for (const c of dated.filter((x) => x.parentId === t.id).sort(byStart)) walk(c, depth + 1);
  };
  for (const r of dated.filter((t) => !t.parentId || !ids.has(t.parentId)).sort(byStart)) walk(r, 0);
  // A phase is as far along as its steps on average (the board counts finished subtasks instead).
  const progressOf = (t: TaskView) => {
    const kids = tasks.filter((x) => x.parentId === t.id);
    return kids.length ? Math.round(kids.reduce((n, k) => n + k.progress, 0) / kids.length) : t.progress;
  };
  const colorOf = (t: TaskView) => statuses.find((s) => s.id === t.status)?.color ?? '#2563eb';
  const months: { label: string; x: number }[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(from + i * DAY);
    if (d.getDate() === 1 || i === 0) months.push({ label: new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric' }).format(d), x: i * px });
  }
  // Bar geometry per visible row, shared by the bars and the dependency arrows.
  const geo = new Map(
    rows.map(({ t }, i) => {
      const { s, e } = spanOf(t);
      const left = ((s - from) / DAY) * px + 2;
      const milestone = t.type === 'milestone';
      const width = milestone ? 14 : Math.max(px * 0.6, ((e + DAY - s) / DAY) * px - 4);
      return [t.id, { i, s, e, left: milestone ? ((e - from) / DAY) * px + px / 2 - 7 : left, width, y: i * ROW + (ROW - 1) / 2 }] as const;
    }),
  );
  const arrows = (links ?? [])
    .map((l) => ({ l, a: geo.get(l.fromId), b: geo.get(l.toId) }))
    .filter((x): x is { l: (typeof x)['l']; a: NonNullable<(typeof x)['a']>; b: NonNullable<(typeof x)['b']> } => !!x.a && !!x.b)
    .map(({ l, a, b }) => {
      // A milestone may fall on its predecessor's last day; anything else starts the day after.
      const late = b.s < a.e + (tasks.find((x) => x.id === l.toId)?.type === 'milestone' ? 0 : DAY);
      const x1 = a.left + a.width;
      const x2 = b.left;
      const d =
        x2 >= x1 + 14
          ? `M${x1},${a.y} H${x1 + 7} V${b.y} H${x2 - 1}`
          : `M${x1},${a.y} h7 V${a.y + (b.y > a.y ? ROW / 2 : -ROW / 2)} H${x2 - 9} V${b.y} H${x2 - 1}`;
      return { id: l.id, d, late };
    });
  const conflicts = arrows.filter((x) => x.late).length;
  const cols = 'grid-cols-[1fr_64px_64px_56px]';
  const startDrag = (t: TaskView, mode: Drag['mode']) => (e: React.PointerEvent) => {
    if (!t.canEdit || e.button !== 0) return;
    e.stopPropagation();
    dragged.current = false;
    setDrag({ id: t.id, mode, x0: e.clientX, dx: 0 });
  };
  const click = (id: string) => () => {
    if (dragged.current) dragged.current = false;
    else open(id);
  };
  return (
    <div ref={scroller} className={cn('h-full overflow-auto bg-surface', drag && 'select-none')} data-testid="gantt">
      <div className="relative" style={{ width: LEFT + days * px }}>
        <div className="sticky top-0 z-20 flex h-12 border-b border-line bg-surface">
          <div className={cn('sticky left-0 z-30 grid shrink-0 items-end border-r border-line bg-surface px-3 pb-1.5 text-[11.5px] font-medium text-muted', cols)} style={{ width: LEFT }}>
            <span>
              Task
              {conflicts > 0 && (
                <span className="ml-2 font-normal text-red-600" data-testid="gantt-conflicts">
                  · {conflicts} dependency conflict{conflicts === 1 ? '' : 's'}
                </span>
              )}
            </span>
            <span>Start</span>
            <span>Due</span>
            <span className="text-right">Progress</span>
          </div>
          <div className="relative" style={{ width: days * px }}>
            {months.map((m) => (
              <span key={m.x} className="absolute top-1 whitespace-nowrap text-[11.5px] font-medium text-ink-2" style={{ left: m.x + 4 }}>
                {m.label}
              </span>
            ))}
            {Array.from({ length: days }, (_, i) => {
              const d = new Date(from + i * DAY);
              return (
                <span key={i} className={cn('absolute bottom-1 w-[26px] text-center text-[10px]', d.getDay() === 0 || d.getDay() === 6 ? 'text-subtle' : 'text-muted')} style={{ left: i * px }}>
                  {d.getDate()}
                </span>
              );
            })}
          </div>
        </div>
        <div className="relative">
          <div className="pointer-events-none absolute inset-y-0" style={{ left: LEFT, width: days * px }}>
            {Array.from({ length: days }, (_, i) => {
              const d = new Date(from + i * DAY);
              return d.getDay() === 0 || d.getDay() === 6 ? <span key={i} className="absolute inset-y-0 bg-canvas" style={{ left: i * px, width: px }} /> : null;
            })}
            <span className="absolute inset-y-0 z-[5] w-0.5 bg-red-500" style={{ left: todayX }} data-testid="gantt-today">
              <span className="absolute left-1 top-0 rounded bg-red-500 px-1 text-[10px] text-white">Today</span>
            </span>
          </div>
          <svg className="pointer-events-none absolute top-0 z-[4]" style={{ left: LEFT }} width={days * px} height={rows.length * ROW} aria-hidden="true">
            <defs>
              {(['ok', 'late'] as const).map((k) => (
                <marker key={k} id={`gantt-arrow-${k}`} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
                  <path d="M0,0 L8,4 L0,8 Z" fill={LINK[k]} />
                </marker>
              ))}
            </defs>
            {arrows.map((a) => (
              <path key={a.id} d={a.d} fill="none" stroke={a.late ? LINK.late : LINK.ok} strokeWidth={a.late ? 2 : 1.5} markerEnd={`url(#gantt-arrow-${a.late ? 'late' : 'ok'})`} data-testid="gantt-link" data-late={a.late ? '1' : '0'} />
            ))}
          </svg>
          {rows.map(({ t, depth }) => {
            const kids = dated.some((x) => x.parentId === t.id);
            const progress = progressOf(t);
            const g = geo.get(t.id)!;
            const c = t.type === 'phase' ? '#4f46e5' : t.type === 'epic' ? '#7c3aed' : colorOf(t);
            const container = ISSUE_RANK[t.type] < 2;
            const moving = drag?.id === t.id;
            return (
              <div key={t.id} className="flex hover:bg-hover/40" style={{ height: ROW }} data-testid="gantt-row" data-title={t.title} data-type={t.type}>
                <div className={cn('sticky left-0 z-10 grid shrink-0 items-center border-b border-r border-b-line/60 border-r-line bg-surface px-3 text-[12.5px]', cols)} style={{ width: LEFT }}>
                  <span className="flex min-w-0 items-center gap-1" style={{ paddingLeft: depth * 16 }}>
                    {kids ? (
                      <button
                        onClick={() =>
                          setCollapsed((v) => {
                            const n = new Set(v);
                            if (!n.delete(t.id)) n.add(t.id);
                            return n;
                          })
                        }
                        aria-label={collapsed.has(t.id) ? `Expand ${t.title}` : `Collapse ${t.title}`}
                        className="text-muted"
                      >
                        {collapsed.has(t.id) ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                      </button>
                    ) : (
                      <span className="w-[13px]" />
                    )}
                    <IssueIcon type={t.type} size={14} />
                    <button onClick={() => open(t.id)} className={cn('truncate text-left hover:underline', depth === 0 || container ? 'font-semibold text-ink' : 'text-ink-2')}>
                      {t.title}
                    </button>
                    {t.gate && t.gate.status !== 'none' && (
                      <span className={cn('shrink-0 rounded px-1 text-[10px] font-medium', t.gate.status === 'approved' ? 'bg-emerald-50 text-emerald-700' : t.gate.status === 'rejected' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700')} data-testid="gantt-gate">
                        gate {t.gate.status}
                      </span>
                    )}
                  </span>
                  <span className={cn('text-muted', moving && 'font-medium text-brand-700')} data-testid="gantt-start">
                    {t.startDate ? shortDate(iso(g.s)) : '—'}
                  </span>
                  <span className={cn('text-muted', moving && 'font-medium text-brand-700')} data-testid="gantt-due">
                    {t.dueDate ? shortDate(iso(g.e)) : '—'}
                  </span>
                  <span className="text-right tabular-nums text-ink-2" data-testid="gantt-progress">
                    {t.type === 'milestone' ? (t.completedAt ? '✓' : '—') : `${progress}%`}
                  </span>
                </div>
                <div className="relative border-b border-line/60" style={{ width: days * px }}>
                  {t.type === 'milestone' ? (
                    <button
                      onPointerDown={startDrag(t, 'move')}
                      onClick={click(t.id)}
                      className={cn('absolute z-[6] rotate-45 rounded-[2px]', t.canEdit && 'cursor-grab', moving && 'cursor-grabbing ring-2 ring-brand-300')}
                      style={{ left: g.left, top: (ROW - 1 - 14) / 2, width: 14, height: 14, background: t.completedAt ? '#10b981' : '#d97706' }}
                      title={`${t.title} (milestone)`}
                      data-testid="gantt-milestone"
                    />
                  ) : (
                    <button
                      onPointerDown={startDrag(t, 'move')}
                      onClick={click(t.id)}
                      className={cn('group absolute z-[6] overflow-hidden rounded-[4px] text-left', t.canEdit && 'cursor-grab', moving && 'cursor-grabbing ring-2 ring-brand-300')}
                      style={{ left: g.left, width: g.width, top: (ROW - 1 - (container ? 20 : 16)) / 2, height: container ? 20 : 16, background: `${c}33`, borderLeft: `3px solid ${c}` }}
                      title={`${t.title}: ${progress}%${t.canEdit ? ' — drag to move, drag the right edge to change the due date' : ''}`}
                      data-testid="gantt-bar"
                      data-title={t.title}
                    >
                      <span className="block h-full" style={{ width: `${progress}%`, background: c, opacity: 0.85 }} />
                      {t.canEdit && t.dueDate && (
                        <span onPointerDown={startDrag(t, 'end')} className="absolute inset-y-0 right-0 w-2 cursor-ew-resize group-hover:bg-black/15" data-testid="gantt-resize" aria-label={`Change the due date of ${t.title}`} />
                      )}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
