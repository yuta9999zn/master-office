'use client';

import type { ResourceType } from '@workos/shared';
import { Command } from 'cmdk';
import { FileText, FolderPlus, Play, Search, Table2 } from 'lucide-react';
import { Dialog as D } from 'radix-ui';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { APPS } from '@/lib/apps';
import { useResourceActions, useResources, useSearch } from '@/lib/queries';
import { hrefFor, typeLabel } from '@/lib/resources';
import { useUi } from '@/lib/store';
import { SpaceBadge } from './Sidebar';
import { AppIcon, Avatar, FileIcon } from '../ui/primitives';

function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function Item({ onSelect, icon, children, hint, value }: { onSelect: () => void; icon: ReactNode; children: ReactNode; hint?: ReactNode; value: string }) {
  return (
    <Command.Item
      value={value}
      onSelect={onSelect}
      className="flex h-10 cursor-default items-center gap-3 rounded-lg px-3 text-[13px] text-ink-2 data-[selected=true]:bg-selected data-[selected=true]:text-ink"
    >
      <span className="flex w-5 justify-center">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {hint && <span className="shrink-0 text-[12px] text-subtle">{hint}</span>}
    </Command.Item>
  );
}

const heading = '[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:text-subtle';

/** Global search + command palette (Ctrl/⌘ K). Search results are permission-filtered by the API. */
export function CommandPalette() {
  const open = useUi((s) => s.paletteOpen);
  const setOpen = useUi((s) => s.setPaletteOpen);
  const router = useRouter();
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 150);
  const { data: hits, isFetching } = useSearch(dq);
  const { data: recent } = useResources(open ? { view: 'recent' } : null);
  const { create } = useResourceActions();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // The document editor uses Ctrl+K for links and marks the event handled.
      if (e.defaultPrevented) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(!useUi.getState().paletteOpen);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setOpen]);

  const go = (href: string) => {
    setOpen(false);
    setQ('');
    router.push(href);
  };
  const createAndOpen = async (type: ResourceType, name: string) => {
    const r = await create.mutateAsync({ type, name });
    go(hrefFor(r));
  };

  const files = hits?.filter((h) => h.kind === 'resource') ?? [];
  const spaces = hits?.filter((h) => h.kind === 'space') ?? [];
  const people = hits?.filter((h) => h.kind === 'person') ?? [];
  const searching = q.trim().length > 0;

  return (
    <D.Root open={open} onOpenChange={setOpen}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-40 bg-ink/25" />
        <D.Content className="fixed left-1/2 top-[12vh] z-50 w-[calc(100vw-32px)] max-w-[640px] -translate-x-1/2 overflow-hidden rounded-2xl border border-line bg-surface shadow-[var(--shadow-pop)] outline-none animate-pop">
          <D.Title className="sr-only">Search</D.Title>
          <D.Description className="sr-only">Search files, spaces and people, or run a command</D.Description>
          <Command shouldFilter={!searching} loop>
            <div className="flex items-center gap-3 border-b border-line px-4">
              <Search size={18} className="text-subtle" />
              <Command.Input
                value={q}
                onValueChange={setQ}
                placeholder="Search files, spaces, people — or type a command"
                className="h-13 flex-1 bg-transparent text-[14px] outline-none placeholder:text-subtle"
              />
              {isFetching && searching && <span className="text-[12px] text-subtle">Searching…</span>}
            </div>
            <Command.List className={`max-h-[420px] overflow-auto p-2 ${heading}`}>
              <Command.Empty className="py-10 text-center text-[13px] text-muted">{isFetching ? 'Searching…' : 'No results'}</Command.Empty>

              {searching ? (
                <>
                  {!!files.length && (
                    <Command.Group heading="Files">
                      {files.map((h) => (
                        <Item
                          key={h.id}
                          value={h.id}
                          icon={<FileIcon r={{ type: h.type!, mimeType: null, metadata: {} }} size={18} />}
                          hint={h.subtitle}
                          onSelect={() => go(hrefFor({ id: h.id, type: h.type!, metadata: {} }))}
                        >
                          {h.title}
                        </Item>
                      ))}
                    </Command.Group>
                  )}
                  {!!spaces.length && (
                    <Command.Group heading="Spaces">
                      {spaces.map((h) => (
                        <Item key={h.id} value={h.id} icon={<SpaceBadge space={{ name: h.title, color: null }} size={18} />} hint={h.subtitle} onSelect={() => go(`/spaces/${h.id}`)}>
                          {h.title}
                        </Item>
                      ))}
                    </Command.Group>
                  )}
                  {!!people.length && (
                    <Command.Group heading="People">
                      {people.map((h) => (
                        <Item key={h.id} value={h.id} icon={<Avatar user={{ name: h.title, avatarColor: '#64748b' }} size={20} />} hint={h.subtitle} onSelect={() => go('/contacts')}>
                          {h.title}
                        </Item>
                      ))}
                    </Command.Group>
                  )}
                </>
              ) : (
                <>
                  {!!recent?.length && (
                    <Command.Group heading="Recent">
                      {recent.slice(0, 5).map((r) => (
                        <Item key={r.id} value={`recent ${r.name}`} icon={<FileIcon r={r} size={18} />} hint={typeLabel(r)} onSelect={() => go(hrefFor(r))}>
                          {r.name}
                        </Item>
                      ))}
                    </Command.Group>
                  )}
                  <Command.Group heading="Create">
                    <Item value="new document" icon={<FileText size={16} className="text-brand-600" />} onSelect={() => createAndOpen('document', 'Untitled document')}>
                      New document
                    </Item>
                    <Item value="new spreadsheet" icon={<Table2 size={16} className="text-emerald-600" />} onSelect={() => createAndOpen('spreadsheet', 'Untitled spreadsheet')}>
                      New spreadsheet
                    </Item>
                    <Item value="new presentation" icon={<Play size={16} className="text-orange-500" />} onSelect={() => createAndOpen('presentation', 'Untitled presentation')}>
                      New presentation
                    </Item>
                    <Item value="new folder drive" icon={<FolderPlus size={16} className="text-amber-500" />} onSelect={() => go('/drive/my')}>
                      New folder in My Files
                    </Item>
                  </Command.Group>
                  <Command.Group heading="Go to">
                    {APPS.map((a) => (
                      <Item key={a.id} value={`go ${a.label}`} icon={<AppIcon app={a} size={18} />} hint={a.tagline} onSelect={() => go(a.href)}>
                        {a.label}
                      </Item>
                    ))}
                  </Command.Group>
                </>
              )}
            </Command.List>
          </Command>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
