import Link from 'next/link';
import { AppIcon } from '@/components/ui/primitives';
import { APPS } from '@/lib/apps';

export default function AllApps() {
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl p-8">
        <h1 className="text-[22px] font-bold text-ink">All apps</h1>
        <p className="mt-1 text-[13px] text-muted">Every app shares one workspace, one permission model and one file system.</p>
        <div className="mt-6 grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-4">
          {APPS.map((a) => (
            <Link key={a.id} href={a.href} className="card flex flex-col items-center gap-3 px-3 py-6 text-center transition hover:-translate-y-px hover:shadow-[var(--shadow-pop)]">
              <AppIcon app={a} size={52} />
              <div>
                <div className="text-[14px] font-semibold text-ink">{a.label}</div>
                <div className="mt-0.5 text-[12px] text-muted">{a.tagline}</div>
              </div>
              {a.phase > 1 && <span className="rounded-full bg-canvas px-2 py-0.5 text-[11px] font-medium text-muted">Phase {a.phase}</span>}
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
