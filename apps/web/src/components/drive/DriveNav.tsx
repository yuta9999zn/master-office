'use client';

import type { Space } from '@workos/shared';
import { ChevronDown, ChevronRight, Clock, HardDrive, House, Plus, Star, Trash2, Users } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { formatBytes } from '@/lib/format';
import { useSpaces, useStats } from '@/lib/queries';
import { SpaceBadge } from '../shell/Sidebar';
import { CreateSpaceDialog } from '../spaces/CreateSpaceDialog';
import { StorageMeter } from './StorageMeter';
import { cn } from '../ui/primitives';

const LINKS: { href: string; label: string; icon: ReactNode }[] = [
  { href: '/drive', label: 'Home', icon: <House size={17} /> },
  { href: '/drive/my', label: 'My files', icon: <HardDrive size={17} /> },
  { href: '/drive/shared', label: 'Shared with me', icon: <Users size={17} /> },
  { href: '/drive/recent', label: 'Recent', icon: <Clock size={17} /> },
  { href: '/drive/starred', label: 'Starred', icon: <Star size={17} /> },
  { href: '/drive/trash', label: 'Trash', icon: <Trash2 size={17} /> },
];

function SpaceNode({ space, all, depth, activeId }: { space: Space; all: Space[]; depth: number; activeId?: string }) {
  const children = all.filter((s) => s.parentId === space.id);
  const [open, setOpen] = useState(depth === 0);
  const active = activeId === space.id;
  return (
    <div>
      <div
        className={cn('group flex h-8 items-center gap-1.5 rounded-lg pr-2 text-[13px]', active ? 'bg-selected font-semibold text-brand-600' : 'text-ink-2 hover:bg-hover')}
        style={{ paddingLeft: 4 + depth * 14 }}
      >
        <button onClick={() => setOpen(!open)} className={cn('flex size-5 items-center justify-center rounded text-subtle hover:text-ink', !children.length && 'invisible')} aria-label="Toggle">
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
        <Link href={`/drive/space/${space.id}`} className="flex min-w-0 flex-1 items-center gap-2">
          <SpaceBadge space={space} size={18} />
          <span className="truncate">{space.name}</span>
        </Link>
      </div>
      {open && children.map((c) => <SpaceNode key={c.id} space={c} all={all} depth={depth + 1} activeId={activeId} />)}
    </div>
  );
}

export function DriveNav({ activeSpaceId }: { activeSpaceId?: string }) {
  const pathname = usePathname();
  const { data: spaces } = useSpaces();
  const { data: stats } = useStats();
  const [creating, setCreating] = useState(false);
  const roots = spaces?.filter((s) => !s.parentId || !spaces.some((p) => p.id === s.parentId)) ?? [];

  return (
    <nav className="flex w-[232px] shrink-0 flex-col border-r border-line bg-surface">
      <div className="flex items-center gap-2.5 px-4 pb-2 pt-4">
        <span className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-sky-400 to-sky-600 text-white">
          <HardDrive size={18} />
        </span>
        <div>
          <div className="text-[14px] font-semibold text-ink">Drive</div>
          <div className="text-[12px] text-muted">{stats ? `${formatBytes(stats.storageBytes)} used` : ' '}</div>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-3 pb-3">
        <div className="space-y-0.5 pt-2">
          {LINKS.map((l) => {
            const active = pathname === l.href;
            return (
              <Link
                key={l.href}
                href={l.href}
                className={cn('flex h-9 items-center gap-3 rounded-lg px-2.5 text-[13px]', active ? 'bg-selected font-semibold text-brand-600' : 'text-ink-2 hover:bg-hover')}
              >
                <span className={active ? 'text-brand-600' : 'text-muted'}>{l.icon}</span>
                {l.label}
              </Link>
            );
          })}
        </div>
        <div className="mb-1 mt-5 px-2.5 text-[12px] font-medium text-subtle">Spaces</div>
        <div className="space-y-0.5">
          {roots.map((s) => (
            <SpaceNode key={s.id} space={s} all={spaces ?? []} depth={0} activeId={activeSpaceId} />
          ))}
          <button onClick={() => setCreating(true)} className="flex h-8 w-full items-center gap-2 rounded-lg px-2.5 text-[13px] text-muted hover:bg-hover hover:text-ink">
            <Plus size={16} /> New space
          </button>
        </div>
      </div>
      <StorageMeter spaceId={activeSpaceId} spaceName={spaces?.find((s) => s.id === activeSpaceId)?.name} />
      <CreateSpaceDialog open={creating} onOpenChange={setCreating} />
    </nav>
  );
}
