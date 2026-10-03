'use client';

import type { ResourceType } from '@workos/shared';
import { Plus, Search } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { SlideTemplates } from '../slides/SlideTemplates';
import { appById } from '@/lib/apps';
import { useResourceActions, useResources } from '@/lib/queries';
import { hrefFor, TYPE_META } from '@/lib/resources';
import { FileList } from '../drive/FileViews';
import { AppIcon, Button, EmptyState, Skeleton } from '../ui/primitives';

/** Landing page of Docs / Sheets / Slides / Wiki: every accessible item of one type, newest first. */
export function TypeIndex({ appId, type }: { appId: string; type: ResourceType }) {
  const app = appById(appId)!;
  const router = useRouter();
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<{ sort?: 'name' | 'updatedAt' | 'size' | 'type'; order?: 'asc' | 'desc' }>({ sort: 'updatedAt', order: 'desc' });
  const { data, isLoading } = useResources({ type, ...sort });
  const { create } = useResourceActions();
  const items = (data ?? []).filter((r) => r.name.toLowerCase().includes(q.toLowerCase()));
  const label = TYPE_META[type].label.toLowerCase();

  const createNew = async () => {
    const r = await create.mutateAsync({ type, name: `Untitled ${label}` });
    router.push(hrefFor(r));
  };
  // Presentations start from the template gallery.
  const [busy, setBusy] = useState<string | null>(null);
  const fromTemplate = async (template: string | null, name: string) => {
    setBusy(template ?? 'blank');
    try {
      const r = await create.mutateAsync({ type, name, ...(template ? { template } : {}) });
      router.push(hrefFor(r));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1280px] p-6">
        <div className="flex items-center gap-3">
          <AppIcon app={app} size={40} />
          <div>
            <h1 className="text-[22px] font-bold leading-tight text-ink">{app.label}</h1>
            <p className="text-[13px] text-muted">{app.tagline}</p>
          </div>
          <div className="ml-8 flex h-9 w-80 items-center gap-2 rounded-lg border border-line bg-surface px-3">
            <Search size={15} className="text-subtle" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${app.label.toLowerCase()}`} className="flex-1 bg-transparent text-[13px] outline-none" />
          </div>
          <Button variant="primary" className="ml-auto" icon={<Plus size={16} />} loading={create.isPending} onClick={createNew}>
            New {label}
          </Button>
        </div>

        {type === 'presentation' ? (
          <SlideTemplates onPick={(t, n) => void fromTemplate(t, n)} busy={busy} />
        ) : (
        <button onClick={createNew} className="card mt-6 flex w-56 flex-col items-center gap-3 p-6 transition hover:-translate-y-px hover:shadow-[var(--shadow-pop)]">
          <span className="flex size-14 items-center justify-center rounded-2xl border-2 border-dashed" style={{ borderColor: app.to, color: app.to }}>
            <Plus size={24} />
          </span>
          <span className="text-[13px] font-medium text-ink">Blank {label}</span>
        </button>
        )}

        <div className="card mt-6 overflow-hidden px-4">
          {isLoading ? (
            <div className="space-y-2 py-4">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-10" />)}</div>
          ) : items.length ? (
            <FileList
              items={items}
              selected={new Set()}
              onSelect={(_, r) => router.push(hrefFor(r))}
              onOpen={(r) => router.push(hrefFor(r))}
              actionsFor={() => []}
              onContextSelect={() => undefined}
              sort={sort}
              onSort={(k) => setSort({ sort: k, order: sort.sort === k && sort.order === 'asc' ? 'desc' : 'asc' })}
            />
          ) : (
            <EmptyState title={q ? 'No matches' : `No ${label}s yet`}>Create one, or upload an Office file in Drive.</EmptyState>
          )}
        </div>
      </div>
    </div>
  );
}
