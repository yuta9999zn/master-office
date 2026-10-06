'use client';

import type { SprintReport, VelocityRow } from '@workos/shared';
import { useState } from 'react';

// Same validated pair as the Tasks dashboard (dataviz validator, light surface): slot 1 blue, slot 2 orange.
// The ideal line is a reference, not a series: muted ink, dashed.
const SERIES = { first: '#2a78d6', second: '#eb6834' };
const INK = { primary: '#0f172a', secondary: '#475569', muted: '#94a3b8', grid: '#e6eaf0' };
const fmt = (s: string) => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(`${s}T00:00:00`));

/** Remaining work per day of the sprint against the ideal straight line. */
export function Burndown({ report }: { report: SprintReport }) {
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const d = report.burndown;
  const W = 640;
  const H = 220;
  const pad = { l: 34, r: 70, t: 12, b: 26 };
  const max = Math.max(1, ...d.map((x) => Math.max(x.ideal, x.remaining ?? 0)));
  const last = d.length - 1;
  const x = (i: number) => pad.l + (last ? i / last : 0) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - v / max) * (H - pad.t - pad.b);
  const actual = d.map((p, i) => ({ ...p, i })).filter((p) => p.remaining !== null);
  const unit = report.unit === 'points' ? 'pts' : 'issues';
  const ticks = [0, Math.round(max / 2), max];
  return (
    <div className="max-w-[760px]" data-testid="burndown">
      <div className="mb-1 flex items-center gap-4 text-[12px]" style={{ color: INK.secondary }}>
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-4 rounded" style={{ background: SERIES.first }} /> Remaining ({unit})
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-4 border-t-2 border-dashed" style={{ borderColor: INK.muted }} /> Ideal
        </span>
        <button onClick={() => setTable(!table)} className="ml-auto text-[12px] text-brand-700 hover:underline">
          {table ? 'Show chart' : 'Show table'}
        </button>
      </div>
      {table ? (
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="text-left text-muted">
              <th className="py-1 font-medium">Day</th>
              <th className="py-1 font-medium">Remaining</th>
              <th className="py-1 font-medium">Ideal</th>
            </tr>
          </thead>
          <tbody>
            {d.map((p) => (
              <tr key={p.day} className="border-t border-line">
                <td className="py-1">{fmt(p.day)}</td>
                <td className="py-1 tabular-nums">{p.remaining ?? '—'}</td>
                <td className="py-1 tabular-nums">{p.ideal}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="relative">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="w-full"
            role="img"
            aria-label={`Sprint burndown: remaining ${unit} per day against the ideal line`}
            onMouseMove={(e) => {
              const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
              const px = ((e.clientX - r.left) / r.width) * W;
              const i = Math.round(((px - pad.l) / (W - pad.l - pad.r)) * last);
              setHover(i >= 0 && i <= last ? i : null);
            }}
            onMouseLeave={() => setHover(null)}
            data-testid="burndown-chart"
          >
            {ticks.map((t) => (
              <g key={t}>
                <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke={INK.grid} />
                <text x={pad.l - 6} y={y(t) + 4} textAnchor="end" fontSize="10" fill={INK.muted}>
                  {t}
                </text>
              </g>
            ))}
            {[0, Math.floor(last / 2), last].map((i) => (
              <text key={i} x={x(i)} y={H - 6} textAnchor="middle" fontSize="10" fill={INK.muted}>
                {fmt(d[i].day)}
              </text>
            ))}
            <path d={d.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.ideal).toFixed(1)}`).join('')} fill="none" stroke={INK.muted} strokeWidth="1.5" strokeDasharray="4 4" />
            {actual.length > 0 && (
              <>
                <path d={actual.map((p, k) => `${k ? 'L' : 'M'}${x(p.i).toFixed(1)},${y(p.remaining!).toFixed(1)}`).join('')} fill="none" stroke={SERIES.first} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
                <text x={x(actual.at(-1)!.i) + 8} y={y(actual.at(-1)!.remaining!) + 4} fontSize="11" fill={INK.secondary}>
                  {actual.at(-1)!.remaining} left
                </text>
              </>
            )}
            {hover !== null && (
              <g>
                <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={H - pad.b} stroke={INK.muted} strokeDasharray="3 3" />
                {d[hover].remaining !== null && <circle cx={x(hover)} cy={y(d[hover].remaining!)} r="4.5" fill={SERIES.first} stroke="#fff" strokeWidth="2" />}
              </g>
            )}
          </svg>
          {hover !== null && (
            <div className="pointer-events-none absolute top-4 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[12px] shadow-md" style={{ left: `${(x(hover) / W) * 100}%`, transform: hover > last / 2 ? 'translateX(-110%)' : 'translateX(10%)' }} data-testid="burndown-tooltip">
              <div className="font-medium" style={{ color: INK.primary }}>
                {fmt(d[hover].day)}
              </div>
              <div style={{ color: INK.secondary }}>Remaining {d[hover].remaining ?? '—'}</div>
              <div style={{ color: INK.secondary }}>Ideal {d[hover].ideal}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Committed vs completed story points per closed sprint. */
export function Velocity({ rows }: { rows: VelocityRow[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  if (!rows.length) return <p className="py-6 text-center text-[13px] text-muted">Velocity shows once a sprint is completed.</p>;
  const W = 640;
  const H = 200;
  const pad = { l: 34, r: 12, t: 12, b: 28 };
  const max = Math.max(1, ...rows.flatMap((r) => [r.committed, r.completed]));
  const band = (W - pad.l - pad.r) / rows.length;
  const bar = Math.min(26, (band - 18) / 2);
  const y = (v: number) => pad.t + (1 - v / max) * (H - pad.t - pad.b);
  const base = H - pad.b;
  const avg = Math.round(rows.reduce((n, r) => n + r.completed, 0) / rows.length);
  // A bar with a 4px rounded top anchored to the baseline.
  const col = (x0: number, v: number, color: string) => {
    const top = y(v);
    const h = base - top;
    if (h <= 0) return null;
    const rr = Math.min(4, h);
    return <path d={`M${x0},${base} V${top + rr} Q${x0},${top} ${x0 + rr},${top} H${x0 + bar - rr} Q${x0 + bar},${top} ${x0 + bar},${top + rr} V${base} Z`} fill={color} />;
  };
  return (
    <div className="max-w-[760px]" data-testid="velocity">
      <div className="mb-1 flex items-center gap-4 text-[12px]" style={{ color: INK.secondary }}>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm" style={{ background: SERIES.first }} /> Committed
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm" style={{ background: SERIES.second }} /> Completed
        </span>
        <span>Average completed: {avg} pts</span>
        <button onClick={() => setTable(!table)} className="ml-auto text-[12px] text-brand-700 hover:underline">
          {table ? 'Show chart' : 'Show table'}
        </button>
      </div>
      {table ? (
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="text-left text-muted">
              <th className="py-1 font-medium">Sprint</th>
              <th className="py-1 font-medium">Committed</th>
              <th className="py-1 font-medium">Completed</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.sprintId} className="border-t border-line">
                <td className="py-1">{r.name}</td>
                <td className="py-1 tabular-nums">{r.committed}</td>
                <td className="py-1 tabular-nums">{r.completed}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="relative">
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Velocity: committed and completed story points per sprint" onMouseLeave={() => setHover(null)}>
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
                <g key={r.sprintId} onMouseEnter={() => setHover(i)}>
                  <rect x={pad.l + band * i} y={pad.t} width={band} height={base - pad.t} fill="transparent" />
                  {col(cx - bar - 1, r.committed, SERIES.first)}
                  {col(cx + 1, r.completed, SERIES.second)}
                  <text x={cx} y={H - 9} textAnchor="middle" fontSize="10" fill={INK.muted}>
                    {r.name.replace(/^.*Sprint /, 'Sprint ')}
                  </text>
                </g>
              );
            })}
          </svg>
          {hover !== null && (
            <div className="pointer-events-none absolute top-2 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[12px] shadow-md" style={{ left: `${((pad.l + band * hover + band / 2) / W) * 100}%`, transform: 'translateX(-50%)' }} data-testid="velocity-tooltip">
              <div className="font-medium" style={{ color: INK.primary }}>
                {rows[hover].name}
              </div>
              <div style={{ color: INK.secondary }}>Committed {rows[hover].committed}</div>
              <div style={{ color: INK.secondary }}>Completed {rows[hover].completed}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
