'use client';

import type { QualityStats } from '@workos/shared';
import { Ban, Bug, Clock3, RotateCcw, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { useQuality } from '@/lib/tasks';
import { Skeleton } from '../ui/primitives';

// Same validated pair as the other Tasks charts (dataviz validator, light surface): slot 1 blue, slot 2 orange.
const SERIES = { opened: '#2a78d6', closed: '#eb6834' };
const INK = { primary: '#0f172a', secondary: '#475569', muted: '#94a3b8', grid: '#e6eaf0' };
const hours = (m: number) => `${Math.round((m / 60) * 10) / 10} h`;

/** Quality of the process (§76): defects, rework, flow, Definition of Done compliance, time. */
export function QualityPanel({ projectId }: { projectId: string }) {
  const { data } = useQuality(projectId);
  if (!data) return <Skeleton className="mt-5 h-60" />;
  const tiles: { label: string; value: string; note: string; icon: React.ReactNode; warn?: boolean }[] = [
    { label: 'Open bugs', value: String(data.bugs.open), note: `${data.bugs.critical} high / urgent · ${data.bugs.closed} closed`, icon: <Bug size={15} />, warn: data.bugs.critical > 0 },
    { label: 'Reopen rate', value: `${data.reopenRate}%`, note: `${data.reopened} reopened · ${data.qaRejections} sent back from QA`, icon: <RotateCcw size={15} />, warn: data.reopenRate > 15 },
    { label: 'Lead / cycle time', value: data.leadDays === null ? '—' : `${data.leadDays} d`, note: data.cycleDays === null ? 'no finished work yet' : `cycle ${data.cycleDays} d (in progress → done)`, icon: <Clock3 size={15} /> },
    { label: 'DoD compliance', value: data.dodCompliance === null ? '—' : `${data.dodCompliance}%`, note: data.criteriaCoverage === null ? '' : `${data.criteriaCoverage}% of work items have acceptance criteria`, icon: <ShieldCheck size={15} />, warn: data.dodCompliance !== null && data.dodCompliance < 80 },
    { label: 'Blocked / overdue', value: `${data.blocked} / ${data.overdue}`, note: `${hours(data.time.spentMinutes)} logged of ${hours(data.time.estimateMinutes)} estimated`, icon: <Ban size={15} />, warn: data.blocked > 0 },
  ];
  return (
    <section className="card mt-5 p-4" data-testid="quality-panel">
      <h3 className="text-[14px] font-semibold text-ink">Quality</h3>
      <div className="mt-3 grid grid-cols-5 gap-3">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-lg bg-canvas px-3 py-2.5 ring-1 ring-line" data-testid="quality-tile">
            <p className="flex items-center gap-1.5 text-[11.5px] text-muted">
              {t.icon} {t.label}
            </p>
            <p className={t.warn ? 'text-[20px] font-semibold text-red-600' : 'text-[20px] font-semibold text-ink'}>{t.value}</p>
            <p className="text-[11.5px] text-muted">{t.note}</p>
          </div>
        ))}
      </div>
      <BugTrend data={data} />
    </section>
  );
}

function BugTrend({ data }: { data: QualityStats }) {
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const rows = data.bugTrend;
  const W = 640;
  const H = 170;
  const pad = { l: 30, r: 10, t: 10, b: 24 };
  const max = Math.max(1, ...rows.flatMap((r) => [r.opened, r.closed]));
  const band = (W - pad.l - pad.r) / rows.length;
  const bar = Math.min(18, (band - 14) / 2);
  const y = (v: number) => pad.t + (1 - v / max) * (H - pad.t - pad.b);
  const base = H - pad.b;
  const fmt = (s: string) => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(`${s}T00:00:00`));
  const col = (x0: number, v: number, color: string) => {
    const top = y(v);
    const h = base - top;
    if (h <= 0) return null;
    const rr = Math.min(4, h);
    return <path d={`M${x0},${base} V${top + rr} Q${x0},${top} ${x0 + rr},${top} H${x0 + bar - rr} Q${x0 + bar},${top} ${x0 + bar},${top + rr} V${base} Z`} fill={color} />;
  };
  return (
    <div className="mt-4 max-w-[760px]" data-testid="bug-trend">
      <div className="mb-1 flex items-center gap-4 text-[12px]" style={{ color: INK.secondary }}>
        <span className="font-medium" style={{ color: INK.primary }}>Bugs per week</span>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm" style={{ background: SERIES.opened }} /> Opened
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm" style={{ background: SERIES.closed }} /> Closed
        </span>
        <button onClick={() => setTable(!table)} className="ml-auto text-brand-700 hover:underline">
          {table ? 'Show chart' : 'Show table'}
        </button>
      </div>
      {table ? (
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="text-left text-muted">
              <th className="py-1 font-medium">Week of</th>
              <th className="py-1 font-medium">Opened</th>
              <th className="py-1 font-medium">Closed</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.week} className="border-t border-line">
                <td className="py-1">{fmt(r.week)}</td>
                <td className="py-1 tabular-nums">{r.opened}</td>
                <td className="py-1 tabular-nums">{r.closed}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="relative">
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Bugs opened and closed per week, last 8 weeks" onMouseLeave={() => setHover(null)}>
            {[0, Math.round(max / 2), max].map((t) => (
              <g key={t}>
                <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke={INK.grid} />
                <text x={pad.l - 6} y={y(t) + 4} textAnchor="end" fontSize="10" fill={INK.muted}>
                  {t}
                </text>
              </g>
            ))}
            {rows.map((r, i) => {
              const cx = pad.l + band * i + band / 2;
              return (
                <g key={r.week} onMouseEnter={() => setHover(i)}>
                  <rect x={pad.l + band * i} y={pad.t} width={band} height={base - pad.t} fill="transparent" />
                  {col(cx - bar - 1, r.opened, SERIES.opened)}
                  {col(cx + 1, r.closed, SERIES.closed)}
                  <text x={cx} y={H - 8} textAnchor="middle" fontSize="10" fill={INK.muted}>
                    {fmt(r.week)}
                  </text>
                </g>
              );
            })}
          </svg>
          {hover !== null && (
            <div className="pointer-events-none absolute top-1 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[12px] shadow-md" style={{ left: `${((pad.l + band * hover + band / 2) / W) * 100}%`, transform: hover > rows.length / 2 ? 'translateX(-105%)' : 'translateX(5%)' }} data-testid="bug-tooltip">
              <div className="font-medium" style={{ color: INK.primary }}>
                Week of {fmt(rows[hover].week)}
              </div>
              <div style={{ color: INK.secondary }}>Opened {rows[hover].opened}</div>
              <div style={{ color: INK.secondary }}>Closed {rows[hover].closed}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
