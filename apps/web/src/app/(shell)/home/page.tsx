'use client';

import { ArrowRight, ArrowUpRight, CalendarDays, FileText, HardDrive, Layers, Users } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import { ActivityList } from '@/components/drive/DetailsPanel';
import { AppIcon, Button, CardHeader, EmptyState, FileIcon, LogoMark, Skeleton } from '@/components/ui/primitives';
import { APPS } from '@/lib/apps';
import { firstName, formatBytes, formatShort } from '@/lib/format';
import { useActivity, useMe, useResourceActions, useResources, useStats } from '@/lib/queries';
import { hrefFor, typeLabel } from '@/lib/resources';

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

function Hero({ name }: { name?: string }) {
  const router = useRouter();
  const { create } = useResourceActions();
  return (
    <section className="relative overflow-hidden rounded-2xl border border-brand-100 bg-gradient-to-r from-[#e9f1ff] via-[#eef3ff] to-[#f3eeff] px-9 py-8">
      <div className="relative z-[1] max-w-[560px]">
        <div className="text-[12px] font-semibold uppercase tracking-[0.14em] text-brand-700/80">Welcome to Master Office</div>
        <h1 className="mt-2 text-[32px] font-bold leading-tight tracking-tight text-ink">
          {greeting()}
          {name ? `, ${firstName(name)}` : ''}. All your work, in one place.
        </h1>
        <p className="mt-2 text-[15px] leading-relaxed text-ink-2/80">Chat, collaborate, create and organize — a more connected way to get things done together.</p>
        <div className="mt-5 flex gap-2.5">
          <Button
            variant="primary"
            className="h-10 px-5 text-[14px]"
            onClick={async () => {
              const r = await create.mutateAsync({ type: 'document', name: 'Untitled document' });
              router.push(hrefFor(r));
            }}
            loading={create.isPending}
          >
            Create a document <ArrowRight size={16} />
          </Button>
          <Link href="/drive" className="inline-flex h-10 items-center rounded-lg border border-brand-200 bg-white/70 px-5 text-[14px] font-medium text-brand-700 hover:bg-white">
            Open Drive
          </Link>
        </div>
      </div>
      {/* Illustration: floating app cards around the brand mark */}
      <div aria-hidden className="pointer-events-none absolute inset-y-0 right-0 hidden w-[46%] lg:block">
        <div className="absolute right-[18%] top-1/2 size-56 -translate-y-1/2 rounded-full bg-gradient-to-br from-brand-500/25 to-violet-brand/25 blur-2xl" />
        <div className="absolute right-[24%] top-1/2 -translate-y-1/2 drop-shadow-[0_16px_24px_rgba(37,99,235,0.35)]">
          <LogoMark size={120} />
        </div>
        {[
          { id: 'docs', cls: 'right-[52%] top-[16%]', w: 150 },
          { id: 'sheets', cls: 'right-[6%] top-[12%]', w: 132 },
          { id: 'chat', cls: 'right-[48%] bottom-[12%]', w: 138 },
          { id: 'calendar', cls: 'right-[4%] bottom-[16%]', w: 128 },
        ].map(({ id, cls, w }) => {
          const app = APPS.find((a) => a.id === id)!;
          return (
            <div key={id} className={`absolute flex items-center gap-2 rounded-xl bg-white/90 p-2.5 shadow-[0_8px_24px_-10px_rgba(15,23,42,0.25)] ${cls}`} style={{ width: w }}>
              <AppIcon app={app} size={30} />
              <div className="flex-1 space-y-1.5">
                <div className="h-1.5 w-4/5 rounded-full bg-line-strong" />
                <div className="h-1.5 w-3/5 rounded-full bg-line" />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function AppGrid() {
  const apps = APPS.filter((a) => a.id !== 'home' && a.primary && a.id !== 'contacts' && a.id !== 'spaces').slice(0, 14);
  return (
    <section className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-7">
      {apps.map((a) => (
        <Link key={a.id} href={a.href} className="card group flex items-center gap-3 px-3.5 py-3 transition hover:-translate-y-px hover:shadow-[var(--shadow-pop)]">
          <AppIcon app={a} size={40} />
          <div className="min-w-0">
            <div className="text-[14px] font-semibold text-ink">{a.label}</div>
            <div className="truncate text-[12px] text-muted">{a.tagline}</div>
          </div>
        </Link>
      ))}
    </section>
  );
}

function ViewAll({ href }: { href: string }) {
  return (
    <Link href={href} className="flex items-center gap-1 text-[13px] font-medium text-brand-600 hover:underline">
      View all <ArrowRight size={14} />
    </Link>
  );
}

function RecentFiles() {
  const { data, isLoading } = useResources({ view: 'recent' });
  return (
    <section className="card flex flex-col">
      <CardHeader title="Recent Files" action={<ViewAll href="/drive/recent" />} />
      <div className="flex-1 px-2 pb-2">
        {isLoading ? (
          <div className="space-y-2 px-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-11" />)}</div>
        ) : !data?.length ? (
          <EmptyState title="No recent files">Files you open show up here.</EmptyState>
        ) : (
          data.slice(0, 7).map((r) => (
            <Link key={r.id} href={hrefFor(r)} className="flex items-center gap-3 rounded-lg px-2.5 py-2 hover:bg-canvas">
              <FileIcon r={r} size={26} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[14px] font-medium text-ink">{r.name}</div>
                <div className="truncate text-[12px] text-muted">
                  {typeLabel(r)} · Updated by {r.owner?.name.split(' ')[0]} · {formatShort(r.updatedAt)}
                </div>
              </div>
            </Link>
          ))
        )}
      </div>
    </section>
  );
}

function Activity() {
  const { data, isLoading } = useActivity(7);
  return (
    <section className="card flex flex-col">
      <CardHeader title="Recent Activity" />
      <div className="flex-1 px-4 pb-4">
        <ActivityList events={data} loading={isLoading} />
      </div>
    </section>
  );
}

function Stat({ icon, value, label, trend, tint }: { icon: ReactNode; value: ReactNode; label: string; trend?: number | null; tint: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-line px-3 py-2.5">
      <span className="flex size-9 items-center justify-center rounded-lg" style={{ background: `${tint}14`, color: tint }}>
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[18px] font-bold leading-tight text-ink">{value}</div>
        <div className="truncate text-[12px] text-muted">{label}</div>
      </div>
      {trend !== undefined && trend !== null && (
        <span className={`flex items-center text-[12px] font-semibold ${trend >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
          <ArrowUpRight size={13} className={trend < 0 ? 'rotate-90' : ''} />
          {Math.abs(trend)}%
        </span>
      )}
    </div>
  );
}

function TeamStats() {
  const { data: s } = useStats();
  const trend = s && s.filesCreatedPrev7d ? Math.round(((s.filesCreated7d - s.filesCreatedPrev7d) / s.filesCreatedPrev7d) * 100) : null;
  return (
    <section className="card">
      <CardHeader title="Team Activity" action={<span className="text-[12px] text-muted">Last 7 days</span>} />
      <div className="grid grid-cols-2 gap-2.5 px-4 pb-4">
        <Stat icon={<Users size={18} />} value={s?.members ?? '–'} label="Members" tint="#2563eb" />
        <Stat icon={<FileText size={18} />} value={s?.filesCreated7d ?? '–'} label="Files created" trend={trend} tint="#8b5cf6" />
        <Stat icon={<Layers size={18} />} value={s?.spaces ?? '–'} label="Spaces" tint="#10b981" />
        <Stat icon={<HardDrive size={18} />} value={s ? formatBytes(s.storageBytes) : '–'} label="Storage used" tint="#f59e0b" />
      </div>
    </section>
  );
}

function Upcoming() {
  return (
    <section className="card">
      <CardHeader title="Upcoming" action={<span className="text-[12px] text-muted">{new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).format(new Date())}</span>} />
      <EmptyState icon={<CalendarDays size={30} />} title="Calendar is coming in Phase 7">
        Meetings and events from Calendar will appear here.
      </EmptyState>
    </section>
  );
}

export default function HomePage() {
  const { data: me } = useMe();
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1440px] space-y-5 p-6">
        <Hero name={me?.user.name} />
        <AppGrid />
        <div className="grid gap-5 lg:grid-cols-3">
          <RecentFiles />
          <Activity />
          <div className="space-y-5">
            <Upcoming />
            <TeamStats />
          </div>
        </div>
      </div>
    </div>
  );
}
