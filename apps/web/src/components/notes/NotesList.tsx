'use client';

import type { Resource } from '@workos/shared';
import { Network, NotebookPen, Plus, Search } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { formatShort } from '@/lib/format';
import { useResources } from '@/lib/queries';
import { AppIcon, Avatar, Button, EmptyState, Skeleton } from '../ui/primitives';
import { appById } from '@/lib/apps';
import { notebookOf, tagColor, useCreateNote } from './NotesNav';

/** Note cards for a notebook / tag / favourites / mind-map filter. */
export function NotesList() {
  const params = useSearchParams();
  const nb = params.get('nb');
  const tag = params.get('tag');
  const fav = params.get('fav');
  const mindmaps = params.get('view') === 'mindmaps';
  const [q, setQ] = useState('');
  const { data: all, isLoading } = useResources(fav ? { view: 'starred', type: 'note' } : { type: 'note', sort: 'updatedAt', order: 'desc' });
  const create = useCreateNote();

  const notes = (all ?? []).filter(
    (n: Resource) =>
      (!nb || notebookOf(n) === nb || notebookOf(n).startsWith(`${nb}/`)) && (!tag || n.tags.includes(tag)) && (!q || n.name.toLowerCase().includes(q.toLowerCase())),
  );
  const title = mindmaps ? 'Mind maps' : fav ? 'Favorites' : tag ? `#${tag}` : nb ? nb.split('/').join(' / ') : 'All notes';

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1180px] p-6">
        <div className="flex items-center gap-3">
          <AppIcon app={appById(mindmaps ? 'mindmap' : 'notes')!} size={36} />
          <h1 className="text-[22px] font-bold text-ink">{title}</h1>
          <div className="ml-6 flex h-9 w-72 items-center gap-2 rounded-lg border border-line bg-surface px-3">
            <Search size={15} className="text-subtle" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search notes" className="flex-1 bg-transparent text-[13px] outline-none" />
          </div>
          <Button
            variant="primary"
            className="ml-auto"
            icon={<Plus size={16} />}
            loading={create.pending}
            onClick={() => create.run(mindmaps ? 'Untitled mind map' : 'Untitled note', nb && nb !== 'Projects' ? nb : 'Inbox', mindmaps ? 'mindmap' : undefined)}
          >
            {mindmaps ? 'New mind map' : 'New note'}
          </Button>
        </div>
        <div className="mt-6 grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4">
          {isLoading
            ? Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-40 rounded-xl" />)
            : notes.map((n) => (
                <Link key={n.id} href={`/notes/${n.id}${mindmaps ? '?view=mindmap' : ''}`} className="card group flex flex-col p-4 transition hover:-translate-y-px hover:shadow-[var(--shadow-pop)]">
                  <div className="flex items-center gap-2 text-[12px] text-muted">
                    {mindmaps ? <Network size={14} className="text-violet-brand" /> : <NotebookPen size={14} className="text-indigo-500" />}
                    <span className="truncate">{notebookOf(n).split('/').join(' / ')}</span>
                  </div>
                  <div className="mt-2 line-clamp-2 text-[15px] font-semibold text-ink">{n.name}</div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {n.tags.slice(0, 4).map((t) => (
                      <span key={t} className="rounded-full px-2 py-0.5 text-[11px] font-medium" style={{ background: `${tagColor(t)}18`, color: tagColor(t) }}>
                        {t}
                      </span>
                    ))}
                  </div>
                  <div className="mt-auto flex items-center gap-2 pt-4 text-[12px] text-muted">
                    {n.owner && <Avatar user={n.owner} size={20} />}
                    <span className="truncate">{n.owner?.name.split(' ')[0]}</span>
                    <span className="ml-auto">{formatShort(n.updatedAt)}</span>
                  </div>
                </Link>
              ))}
        </div>
        {!isLoading && !notes.length && (
          <EmptyState icon={<NotebookPen size={34} />} title="No notes here yet">
            Use Quick Capture or New note to start writing.
          </EmptyState>
        )}
      </div>
    </div>
  );
}
