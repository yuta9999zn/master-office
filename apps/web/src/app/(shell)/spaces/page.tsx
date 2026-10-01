'use client';

import { Lock, Plus, Search } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { SpaceBadge } from '@/components/shell/Sidebar';
import { CreateSpaceDialog } from '@/components/spaces/CreateSpaceDialog';
import { AppIcon, Button, Skeleton } from '@/components/ui/primitives';
import { appById } from '@/lib/apps';
import { useSpaces } from '@/lib/queries';
import { ROLE_LABEL } from '@/lib/resources';

export default function SpacesPage() {
  const { data: spaces, isLoading } = useSpaces();
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const list = (spaces ?? []).filter((s) => s.name.toLowerCase().includes(q.toLowerCase()));
  const parentName = (id: string | null) => spaces?.find((s) => s.id === id)?.name;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1440px] p-6">
        <div className="flex items-center gap-3">
          <AppIcon app={appById('spaces')!} size={36} />
          <h1 className="text-[22px] font-bold text-ink">Spaces</h1>
          <div className="ml-6 flex h-9 w-80 items-center gap-2 rounded-lg border border-line bg-surface px-3">
            <Search size={15} className="text-subtle" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search spaces" className="flex-1 bg-transparent text-[13px] outline-none" />
          </div>
          <Button variant="primary" className="ml-auto" icon={<Plus size={16} />} onClick={() => setCreating(true)}>
            Create space
          </Button>
        </div>

        <div className="mt-6 grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-4">
          {isLoading
            ? Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-44 rounded-xl" />)
            : list.map((s) => (
                <Link key={s.id} href={`/spaces/${s.id}`} className="card group overflow-hidden transition hover:-translate-y-px hover:shadow-[var(--shadow-pop)]">
                  <div className="flex h-24 items-center justify-center" style={{ background: `linear-gradient(135deg, ${s.color}22, ${s.color}0a)` }}>
                    <SpaceBadge space={s} size={52} />
                  </div>
                  <div className="p-4">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-[15px] font-semibold text-ink">{s.name}</span>
                      {s.parentId && <span className="truncate text-[12px] text-muted">· {parentName(s.parentId)}</span>}
                    </div>
                    <p className="mt-1 line-clamp-2 min-h-9 text-[12px] text-muted">{s.description}</p>
                    <div className="mt-3 flex items-center justify-between text-[12px] text-muted">
                      <span>{s.memberCount} members</span>
                      <span className="flex items-center gap-1 rounded-full bg-canvas px-2 py-0.5">
                        {s.myRole ? ROLE_LABEL[s.myRole] : <Lock size={11} />}
                      </span>
                    </div>
                  </div>
                </Link>
              ))}
        </div>
      </div>
      <CreateSpaceDialog open={creating} onOpenChange={setCreating} />
    </div>
  );
}
