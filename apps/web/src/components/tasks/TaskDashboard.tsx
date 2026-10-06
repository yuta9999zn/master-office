'use client';

import type { ProjectStats } from '@workos/shared';
import { useState } from 'react';
import { useProjectStats } from '@/lib/tasks';
import { Avatar, EmptyState, Skeleton } from '../ui/primitives';

// Validated with the dataviz skill's palette validator (light surface): slot 1 blue, slot 2 orange.
const SERIES = { created: '#2a78d6', completed: '#eb6834' };
const INK = { primary: '#0f172a', secondary: '#475569', muted: '#94a3b8', grid: '#e6eaf0' };

/** Project analytics (over view.png, panel 3): headline numbers, created vs completed, status mix, people. */
export function TaskDashboard({ projectId }: { projectId: string }) {
  const { data, isLoading } = useProjectStats(projectId);
  const [table, setTable] = useState(false);
  if (isLoading || !data) return <Skeleton className="m-6 h-96" />;
  if (!data.total) return <EmptyState title="No tasks yet">Numbers appear once the project has tasks.</EmptyState>;
  return (
    <div className="h-full overflow-y-auto p-6" data-testid="task-dashboard">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Tile label="Completion rate" value={`${data.completionRate}%`} note={`${data.done} of ${data.total} done`} />
        <Tile label="On-time delivery" value={`${data.onTimeRate}%`} note="done by the due date" />
        <Tile label="Average cycle time" value={data.avgCycleDays === null ? '—' : `${data.avgCycleDays} days`} note="created → done" />
        <Tile label="Total tasks" value={String(data.total)} note="top-level" />
        <Tile label="Overdue" value={String(data.overdue)} note="open past the due date" warn={data.overdue > 0} />
      </div>
      <div className="mt-5 grid gap-5 lg:grid-cols-[2fr_1fr]">
        <section className="card p-4">
          <div className="flex items-center justify-between">
            <h3 className="text-[14px] font-semibold text-ink">Created and completed · last 30 days</h3>
            <button onClick={() => setTable(!table)} className="text-[12px] text-brand-600 hover:underline">
              {table ? 'Show chart' : 'Show table'}
            </button>
          </div>
          {table ? <TrendTable data={data} /> : <TrendChart data={data} />}
        </section>
        <section className="card p-4">
          <h3 className="text-[14px] font-semibold text-ink">Tasks by status</h3>
          <StatusBars data={data} />
        </section>
      </div>
      <section className="card mt-5 p-4">
        <h3 className="text-[14px] font-semibold text-ink">Team performance</h3>
        <ul className="mt-3 space-y-3" data-testid="team-performance">
          {data.people.map((p) => {
            const pct = p.assigned ? Math.round((p.done / p.assigned) * 100) : 0;
            return (
              <li key={p.user.id} className="flex items-center gap-3">
                <Avatar user={p.user} size={28} />
                <span className="w-36 truncate text-[13px] text-ink">{p.user.name}</span>
                <span className="relative h-2 flex-1 rounded-full" style={{ background: '#dbe7fe' }} title={`${p.done} of ${p.assigned} done`}>
                  <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${pct}%`, background: SERIES.created }} />
                </span>
                <span className="w-12 text-right text-[13px] font-medium tabular-nums text-ink">{pct}%</span>
                <span className="w-36 whitespace-nowrap text-right text-[12px] tabular-nums text-muted">
                  {p.done}/{p.assigned} · {p.done ? Math.round((p.onTime / p.done) * 100) : 100}% on time
                </span>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}

function Tile({ label, value, note, warn }: { label: string; value: string; note: string; warn?: boolean }) {
  return (
    <div className="card p-4" data-testid="stat-tile" data-label={label}>
      <div className="text-[12px] text-muted">{label}</div>
      <div className="mt-1 text-[26px] font-semibold tabular-nums" style={{ color: INK.primary }}>
        {value}
      </div>
      <div className="text-[11.5px]" style={{ color: warn ? '#b91c1c' : INK.muted }}>
        {warn ? '⚠ ' : ''}
        {note}
      </div>
    </div>
  );
}

/** Two series on one axis, 2px lines, crosshair + tooltip on hover, legend and end labels. */
function TrendChart({ data }: { data: ProjectStats }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 640;
  const H = 220;
  const pad = { l: 32, r: 84, t: 12, b: 26 };
  const max = Math.max(1, ...data.trend.flatMap((d) => [d.created, d.completed]));
  const x = (i: number) => pad.l + (i / (data.trend.length - 1)) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - v / max) * (H - pad.t - pad.b);
  const path = (k: 'created' | 'completed') => data.trend.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(d[k]).toFixed(1)}`).join('');
  const ticks = [0, Math.ceil(max / 2), max];
  const last = data.trend.length - 1;
  const fmt = (s: string) => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(`${s}T00:00:00`));
  return (
    <div className="relative mt-2">
      <div className="mb-1 flex gap-4 text-[12px]" style={{ color: INK.secondary }}>
        {(['created', 'completed'] as const).map((k) => (
          <span key={k} className="flex items-center gap-1.5">
            <span className="h-0.5 w-4 rounded" style={{ background: SERIES[k] }} />
            {k === 'created' ? 'Created' : 'Completed'}
          </span>
        ))}
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="img"
        aria-label="Tasks created and completed per day over the last 30 days"
        onMouseMove={(e) => {
          const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const px = ((e.clientX - r.left) / r.width) * W;
          const i = Math.round(((px - pad.l) / (W - pad.l - pad.r)) * last);
          setHover(i >= 0 && i <= last ? i : null);
        }}
        onMouseLeave={() => setHover(null)}
        data-testid="trend-chart"
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke={INK.grid} />
            <text x={pad.l - 6} y={y(t) + 4} textAnchor="end" fontSize="10" fill={INK.muted}>
              {t}
            </text>
          </g>
        ))}
        {[0, 10, 20, last].map((i) => (
          <text key={i} x={x(i)} y={H - 6} textAnchor="middle" fontSize="10" fill={INK.muted}>
            {fmt(data.trend[i].day)}
          </text>
        ))}
        {(['created', 'completed'] as const).map((k) => (
          <g key={k}>
            <path d={path(k)} fill="none" stroke={SERIES[k]} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
            <text x={x(last) + 8} y={y(data.trend[last][k]) + 4} fontSize="11" fill={INK.secondary}>
              {k === 'created' ? 'Created' : 'Completed'} {data.trend[last][k]}
            </text>
          </g>
        ))}
        {hover !== null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={H - pad.b} stroke={INK.muted} strokeDasharray="3 3" />
            {(['created', 'completed'] as const).map((k) => (
              <circle key={k} cx={x(hover)} cy={y(data.trend[hover][k])} r="4.5" fill={SERIES[k]} stroke="#fff" strokeWidth="2" />
            ))}
          </g>
        )}
      </svg>
      {hover !== null && (
        <div className="pointer-events-none absolute top-6 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[12px] shadow-md" style={{ left: `${(x(hover) / W) * 100}%`, transform: hover > last / 2 ? 'translateX(-110%)' : 'translateX(10%)' }} data-testid="trend-tooltip">
          <div className="font-medium" style={{ color: INK.primary }}>
            {fmt(data.trend[hover].day)}
          </div>
          <div style={{ color: INK.secondary }}>Created {data.trend[hover].created}</div>
          <div style={{ color: INK.secondary }}>Completed {data.trend[hover].completed}</div>
        </div>
      )}
    </div>
  );
}

function TrendTable({ data }: { data: ProjectStats }) {
  return (
    <div className="mt-2 max-h-[220px] overflow-y-auto">
      <table className="w-full text-[12.5px]">
        <thead className="text-left text-muted">
          <tr>
            <th className="py-1 font-medium">Day</th>
            <th className="py-1 text-right font-medium">Created</th>
            <th className="py-1 text-right font-medium">Completed</th>
          </tr>
        </thead>
        <tbody>
          {data.trend.map((d) => (
            <tr key={d.day} className="border-t border-line">
              <td className="py-1">{d.day}</td>
              <td className="py-1 text-right tabular-nums">{d.created}</td>
              <td className="py-1 text-right tabular-nums">{d.completed}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** One series (count by status): one hue, value labels, the status name on each bar. */
function StatusBars({ data }: { data: ProjectStats }) {
  const max = Math.max(1, ...data.byStatus.map((s) => s.count));
  return (
    <ul className="mt-3 space-y-2.5" data-testid="status-bars">
      {data.byStatus.map((s) => (
        <li key={s.status} title={`${s.name}: ${s.count} (${data.total ? Math.round((s.count / data.total) * 100) : 0}%)`}>
          <div className="flex justify-between text-[12.5px]">
            <span style={{ color: INK.secondary }}>{s.name}</span>
            <span className="tabular-nums" style={{ color: INK.primary }}>
              {s.count} <span style={{ color: INK.muted }}>· {data.total ? Math.round((s.count / data.total) * 100) : 0}%</span>
            </span>
          </div>
          <span className="mt-1 block h-2.5 rounded-r" style={{ width: `${Math.max(2, (s.count / max) * 100)}%`, background: SERIES.created, borderRadius: '0 4px 4px 0' }} />
        </li>
      ))}
    </ul>
  );
}
