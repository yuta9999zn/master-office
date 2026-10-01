'use client';

import type { Resource } from '@workos/shared';
import { BookOpen, ChevronDown, ChevronRight, FolderKanban, Inbox, NotebookPen, Plus, Star, Tag, Users, Zap } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMemo, useState, type ReactNode } from 'react';
import { api } from '@/lib/api';
import { useResourceActions, useResources } from '@/lib/queries';
import { AppIcon, Button, cn } from '../ui/primitives';
import { appById } from '@/lib/apps';

export const FIXED_NOTEBOOKS = ['Inbox', 'Meeting Notes', 'Projects', 'Knowledge Base'] as const;
const TAG_COLORS = ['#8b5cf6', '#2563eb', '#ec4899', '#10b981', '#f59e0b', '#0ea5e9', '#ef4444'];
export const tagColor = (t: string) => TAG_COLORS[[...t].reduce((a, c) => a + c.charCodeAt(0), 0) % TAG_COLORS.length];

export const notebookOf = (r: Pick<Resource, 'metadata'>) => (typeof r.metadata?.notebook === 'string' && r.metadata.notebook ? r.metadata.notebook : 'Inbox');

/** Creates a note (optionally in a notebook) and opens it. */
export function useCreateNote() {
  const router = useRouter();
  const { create } = useResourceActions();
  return {
    pending: create.isPending,
    async run(name: string, notebook = 'Inbox', view?: string) {
      const r = await create.mutateAsync({ type: 'note', name });
      await api(`/resources/${r.id}`, { method: 'PATCH', json: { notebook } });
      router.push(`/notes/${r.id}${view ? `?view=${view}` : ''}`);
      return r;
    },
  };
}

function Row({ href, icon, label, count, active, depth = 0, trailing }: { href: string; icon: ReactNode; label: string; count?: number; active: boolean; depth?: number; trailing?: ReactNode }) {
  return (
    <Link
      href={href}
      className={cn('flex h-9 items-center gap-2.5 rounded-lg pr-2.5 text-[13px]', active ? 'bg-selected font-semibold text-brand-600' : 'text-ink-2 hover:bg-hover')}
      style={{ paddingLeft: 10 + depth * 16 }}
    >
      <span className={cn('flex w-4 justify-center', active ? 'text-brand-600' : 'text-muted')}>{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {trailing}
      {count !== undefined && <span className="text-[12px] text-subtle">{count}</span>}
    </Link>
  );
}

export function NotesNav({ currentNote }: { currentNote?: Resource | null }) {
  const params = useSearchParams();
  const { data: notes = [] } = useResources({ type: 'note' });
  const { data: starred = [] } = useResources({ view: 'starred', type: 'note' });
  const [projectsOpen, setProjectsOpen] = useState(true);
  const [tagsOpen, setTagsOpen] = useState(true);
  const create = useCreateNote();

  const nb = params.get('nb') ?? (currentNote ? notebookOf(currentNote) : null);
  const tag = params.get('tag');
  const fav = params.get('fav');

  const { counts, projects, others, tags } = useMemo(() => {
    const counts = new Map<string, number>();
    const projects = new Map<string, number>();
    const tags = new Map<string, number>();
    for (const n of notes) {
      const path = notebookOf(n);
      const [top, sub] = path.split('/');
      counts.set(top, (counts.get(top) ?? 0) + 1);
      if (top === 'Projects' && sub) projects.set(sub, (projects.get(sub) ?? 0) + 1);
      n.tags.forEach((t) => tags.set(t, (tags.get(t) ?? 0) + 1));
    }
    const others = [...counts.keys()].filter((k) => !(FIXED_NOTEBOOKS as readonly string[]).includes(k));
    return { counts, projects: [...projects].sort(), others, tags: [...tags].sort((a, b) => b[1] - a[1]) };
  }, [notes]);

  const icons: Record<string, ReactNode> = {
    Inbox: <Inbox size={16} />,
    'Meeting Notes': <Users size={16} />,
    'Knowledge Base': <BookOpen size={16} />,
  };

  return (
    <nav className="flex w-[248px] shrink-0 flex-col border-r border-line bg-surface">
      <div className="flex items-center gap-2.5 px-4 pb-3 pt-4">
        <AppIcon app={appById('notes')!} size={28} />
        <span className="flex-1 text-[14px] font-semibold text-ink">Notes &amp; Mind Map</span>
        <button aria-label="New note" onClick={() => create.run('Untitled note', nb && nb !== 'Projects' ? nb : 'Inbox')} className="rounded-md p-1 text-muted hover:bg-hover hover:text-ink">
          <Plus size={17} />
        </button>
      </div>
      <div className="px-3">
        <Button
          variant="soft"
          className="h-10 w-full justify-start gap-2.5 px-3 text-[14px]"
          loading={create.pending}
          icon={<Zap size={16} />}
          onClick={() => create.run(`Quick note — ${new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date())}`, 'Inbox')}
        >
          Quick Capture
        </Button>
      </div>
      <div className="flex-1 space-y-0.5 overflow-y-auto px-3 py-3">
        <Row href="/notes" icon={<NotebookPen size={16} />} label="All notes" count={notes.length} active={!nb && !tag && !fav && !currentNote && params.get('view') !== 'mindmaps'} />
        {(['Inbox', 'Meeting Notes'] as const).map((k) => (
          <Row key={k} href={`/notes?nb=${encodeURIComponent(k)}`} icon={icons[k]} label={k} count={counts.get(k) ?? 0} active={nb === k} />
        ))}
        <div>
          <div className={cn('flex h-9 items-center rounded-lg pr-2.5 text-[13px]', nb === 'Projects' ? 'bg-selected font-semibold text-brand-600' : 'text-ink-2 hover:bg-hover')}>
            <button onClick={() => setProjectsOpen(!projectsOpen)} className="flex h-full w-7 items-center justify-center text-subtle" aria-label="Toggle projects">
              {projectsOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button>
            <Link href="/notes?nb=Projects" className="flex flex-1 items-center gap-2.5">
              <FolderKanban size={16} className="text-muted" />
              <span className="flex-1">Projects</span>
              <span className="text-[12px] text-subtle">{counts.get('Projects') ?? 0}</span>
            </Link>
          </div>
          {projectsOpen &&
            projects.map(([p, c]) => (
              <Row key={p} href={`/notes?nb=${encodeURIComponent(`Projects/${p}`)}`} icon={<span className={cn('size-2.5 rounded-[3px] border', nb === `Projects/${p}` ? 'border-brand-600 bg-brand-600' : 'border-line-strong')} />} label={p} count={c} active={nb === `Projects/${p}`} depth={1} />
            ))}
        </div>
        <Row href={`/notes?nb=${encodeURIComponent('Knowledge Base')}`} icon={icons['Knowledge Base']} label="Knowledge Base" count={counts.get('Knowledge Base') ?? 0} active={nb === 'Knowledge Base'} />
        {others.map((k) => (
          <Row key={k} href={`/notes?nb=${encodeURIComponent(k)}`} icon={<NotebookPen size={16} />} label={k} count={counts.get(k)} active={nb === k} />
        ))}
        <Row href="/notes?fav=1" icon={<Star size={16} />} label="Favorites" count={starred.length} active={!!fav} />

        <div className="pt-3">
          <button onClick={() => setTagsOpen(!tagsOpen)} className="flex h-8 w-full items-center gap-2 rounded-lg px-2.5 text-[13px] text-ink-2 hover:bg-hover">
            {tagsOpen ? <ChevronDown size={14} className="text-subtle" /> : <ChevronRight size={14} className="text-subtle" />}
            <Tag size={15} className="text-muted" /> Tags
          </button>
          {tagsOpen &&
            tags.map(([t, c]) => (
              <Row key={t} href={`/notes?tag=${encodeURIComponent(t)}`} icon={<span className="size-2.5 rounded-[3px]" style={{ background: tagColor(t) }} />} label={t} count={c} active={tag === t} depth={1} />
            ))}
        </div>
      </div>
    </nav>
  );
}
