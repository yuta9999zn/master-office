'use client';

import { useQuery } from '@tanstack/react-query';
import type { ResourceDetail } from '@workos/shared';
import { useState } from 'react';
import { api } from '@/lib/api';
import { useResourceMembers } from '@/lib/queries';
import { cn, Dialog } from '../ui/primitives';

interface Dashboard {
  viewers: { userId: string; name: string; color: string; lastAt: string; views: number }[];
  trend: { day: string; viewers: number; comments: number }[];
  sharing: { action: string; data: Record<string, unknown>; at: string; actor: string | null }[];
}

const when = (iso: string) => {
  const d = new Date(iso);
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (days < 1) return `Today, ${d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
  if (days < 2) return 'Yesterday';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
};
const shortDay = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

/**
 * One-series trend (daily counts, 30 days): thin bars with rounded tops on a recessive baseline, the peak value on the
 * axis, a tooltip on hover (the hit target is the whole day column). A single series needs no legend.
 */
function TrendBars({ data, label, testId }: { data: { day: string; value: number }[]; label: string; testId: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 560;
  const H = 150;
  const pad = { l: 28, r: 8, t: 10, b: 22 };
  const max = Math.max(1, ...data.map((d) => d.value));
  const step = (W - pad.l - pad.r) / Math.max(1, data.length);
  const bw = Math.max(2, step - 4);
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - v / max);
  const total = data.reduce((s, d) => s + d.value, 0);
  return (
    <figure className="relative" data-testid={testId}>
      <figcaption className="mb-1 flex items-baseline justify-between text-[13px]">
        <span className="font-medium text-ink">{label}</span>
        <span className="text-muted">{total} in the last 30 days</span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`${label}, last 30 days`} onMouseLeave={() => setHover(null)}>
        <line x1={pad.l} x2={W - pad.r} y1={H - pad.b} y2={H - pad.b} stroke="#cbd5e1" strokeWidth={1} />
        <line x1={pad.l} x2={W - pad.r} y1={pad.t} y2={pad.t} stroke="#eef2f7" strokeWidth={1} />
        <text x={pad.l - 6} y={pad.t + 4} textAnchor="end" fontSize={10} fill="#64748b">
          {max}
        </text>
        <text x={pad.l - 6} y={H - pad.b + 3} textAnchor="end" fontSize={10} fill="#64748b">
          0
        </text>
        {data.map((d, i) => {
          const x = pad.l + i * step + (step - bw) / 2;
          const top = y(d.value);
          const h = H - pad.b - top;
          return (
            <g key={d.day} onMouseEnter={() => setHover(i)}>
              <rect x={pad.l + i * step} y={pad.t} width={step} height={H - pad.t - pad.b} fill="transparent" />
              {d.value > 0 && <path d={`M${x} ${H - pad.b} V${top + Math.min(4, h)} Q${x} ${top} ${x + Math.min(4, bw / 2)} ${top} H${x + bw - Math.min(4, bw / 2)} Q${x + bw} ${top} ${x + bw} ${top + Math.min(4, h)} V${H - pad.b} Z`} fill={hover === i ? '#1d4ed8' : '#3b82f6'} />}
            </g>
          );
        })}
        <text x={pad.l} y={H - 6} fontSize={10} fill="#64748b">
          {data[0] ? shortDay(data[0].day) : ''}
        </text>
        <text x={W - pad.r} y={H - 6} textAnchor="end" fontSize={10} fill="#64748b">
          Today
        </text>
      </svg>
      {hover !== null && data[hover] && (
        <div
          className="pointer-events-none absolute top-6 whitespace-nowrap rounded-md border border-line bg-surface px-2 py-1 text-[12px] shadow-md"
          style={(pad.l + hover * step) / W < 0.5 ? { left: `${((pad.l + (hover + 1) * step) / W) * 100}%` } : { right: `${100 - ((pad.l + hover * step) / W) * 100}%` }}
        >
          <div className="text-muted">{shortDay(data[hover].day)}</div>
          <div className="font-semibold text-ink">
            {data[hover].value} {label.toLowerCase()}
          </div>
        </div>
      )}
    </figure>
  );
}

const ACTIONS: Record<string, (d: Record<string, unknown>) => string> = {
  'resource.created': () => 'created the file',
  'acl.changed': (d) => (d.role ? `shared it with ${d.userName ?? 'someone'} (${d.role})` : `removed ${d.userName ?? 'someone'}`),
  'resource.published': () => 'published it to the web',
  'resource.unpublished': () => 'stopped publishing it',
  'resource.moved': () => 'moved it',
};

type Tab = 'Viewers' | 'Viewer trend' | 'Comment trend' | 'Sharing history';

/** Tools → Activity dashboard (Google Docs): who viewed it and when, trends, sharing history. Editors only. */
export function ActivityDashboard({ r, open, onClose }: { r: ResourceDetail; open: boolean; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('Viewers');
  const { data, isLoading, error } = useQuery({ queryKey: ['activity-dashboard', r.id], queryFn: () => api<Dashboard>(`/resources/${r.id}/activity-dashboard`), enabled: open });
  const { data: members } = useResourceMembers(open ? r.id : null);
  const seen = new Set(data?.viewers.map((v) => v.userId) ?? []);
  const notViewed = (members ?? []).filter((m) => !seen.has(m.principal.id));
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()} title="Activity dashboard" width={680}>
      <div className="flex gap-4" data-testid="activity-dashboard">
        <nav className="w-36 shrink-0 space-y-0.5">
          {(['Viewers', 'Viewer trend', 'Comment trend', 'Sharing history'] as Tab[]).map((t) => (
            <button key={t} onClick={() => setTab(t)} className={cn('block w-full rounded-lg px-2.5 py-1.5 text-left text-[13px]', tab === t ? 'bg-brand-50 font-medium text-brand-700' : 'text-ink-2 hover:bg-hover')}>
              {t}
            </button>
          ))}
        </nav>
        <div className="min-h-[260px] min-w-0 flex-1">
          {isLoading ? (
            <p className="text-[13px] text-muted">Loading…</p>
          ) : error ? (
            <p className="text-[13px] text-red-600">{(error as Error).message}</p>
          ) : !data ? null : tab === 'Viewers' ? (
            <div className="space-y-3 text-[13px]">
              <table className="w-full" data-testid="viewers">
                <thead>
                  <tr className="text-left text-[12px] text-muted">
                    <th className="pb-1 font-medium">Name</th>
                    <th className="pb-1 font-medium">Last viewed</th>
                    <th className="pb-1 text-right font-medium">Views</th>
                  </tr>
                </thead>
                <tbody>
                  {data.viewers.map((v) => (
                    <tr key={v.userId} className="border-t border-line">
                      <td className="py-1.5">
                        <span className="mr-2 inline-flex size-6 items-center justify-center rounded-full text-[10px] font-semibold text-white" style={{ background: v.color }}>
                          {v.name
                            .split(' ')
                            .map((x) => x[0])
                            .join('')
                            .slice(0, 2)}
                        </span>
                        {v.name}
                      </td>
                      <td className="py-1.5 text-ink-2">{when(v.lastAt)}</td>
                      <td className="py-1.5 text-right tabular-nums text-ink-2">{v.views}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {notViewed.length > 0 && (
                <div>
                  <div className="mb-1 text-[12px] font-medium text-muted">Has access, not viewed yet</div>
                  <div className="flex flex-wrap gap-1.5" data-testid="not-viewed">
                    {notViewed.map((m) => (
                      <span key={m.principal.id} className="rounded-full bg-hover px-2 py-0.5 text-[12px] text-ink-2">
                        {m.principal.name}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : tab === 'Viewer trend' ? (
            <TrendBars data={data.trend.map((d) => ({ day: d.day, value: d.viewers }))} label="Unique viewers" testId="viewer-trend" />
          ) : tab === 'Comment trend' ? (
            <TrendBars data={data.trend.map((d) => ({ day: d.day, value: d.comments }))} label="Comments" testId="comment-trend" />
          ) : (
            <ul className="space-y-2 text-[13px]" data-testid="sharing-history">
              {data.sharing.map((e, i) => (
                <li key={i} className="flex gap-2">
                  <span className="w-28 shrink-0 text-muted">{when(e.at)}</span>
                  <span className="text-ink-2">
                    <b className="font-medium text-ink">{e.actor ?? 'Someone'}</b> {(ACTIONS[e.action] ?? (() => e.action))(e.data ?? {})}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Dialog>
  );
}
