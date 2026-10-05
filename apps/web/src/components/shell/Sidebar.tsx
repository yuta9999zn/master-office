'use client';

import type { Space } from '@workos/shared';
import { ChevronDown, ChevronsLeft, ChevronsRight, LayoutGrid, Plus } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { APPS, MORE_APP } from '@/lib/apps';
import { useUnreadTotal } from '@/lib/chat';
import { useResources, useSpaces } from '@/lib/queries';
import { hrefFor } from '@/lib/resources';
import { useUi } from '@/lib/store';
import { CreateSpaceDialog } from '../spaces/CreateSpaceDialog';
import { AppIcon, cn, FileIcon, Tip } from '../ui/primitives';

export function SpaceBadge({ space, size = 20 }: { space: Pick<Space, 'name' | 'color'>; size?: number }) {
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-[6px] font-bold text-white"
      style={{ width: size, height: size, fontSize: size * 0.5, background: space.color ?? '#2563eb' }}
    >
      {space.name[0]}
    </span>
  );
}

function NavLink({ href, icon, label, active, collapsed, trailing }: { href: string; icon: ReactNode; label: string; active: boolean; collapsed: boolean; trailing?: ReactNode }) {
  const link = (
    <Link
      href={href}
      className={cn(
        'group flex h-9 items-center gap-3 rounded-lg px-2.5 text-[14px] transition-colors',
        active ? 'bg-selected font-semibold text-brand-600' : 'text-ink-2 hover:bg-hover',
        collapsed && 'justify-center px-0',
      )}
    >
      {icon}
      {!collapsed && <span className="min-w-0 flex-1 truncate">{label}</span>}
      {!collapsed && trailing}
    </Link>
  );
  return collapsed ? (
    <Tip label={label} side="right">
      {link}
    </Tip>
  ) : (
    link
  );
}

function Section({ title, children, collapsed }: { title: string; children: ReactNode; collapsed: boolean }) {
  const [open, setOpen] = useState(true);
  if (collapsed) return <div className="mt-3 border-t border-line pt-3">{children}</div>;
  return (
    <div className="mt-4">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center justify-between px-2.5 pb-1 text-[12px] font-medium text-subtle hover:text-muted">
        {title}
        <ChevronDown size={14} className={cn('transition-transform', !open && '-rotate-90')} />
      </button>
      {open && <div className="space-y-0.5">{children}</div>}
    </div>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const collapsed = useUi((s) => s.sidebarCollapsed);
  const toggle = useUi((s) => s.toggleSidebar);
  const { data: spaces } = useSpaces();
  const { data: starred } = useResources({ view: 'starred' });
  const [creating, setCreating] = useState(false);
  const unread = useUnreadTotal();

  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  const topSpaces = spaces?.filter((s) => !s.parentId) ?? [];

  return (
    <aside className={cn('flex shrink-0 flex-col border-r border-line bg-surface transition-[width]', collapsed ? 'w-[72px]' : 'w-[232px]')}>
      <nav className="flex-1 overflow-y-auto px-3 py-3">
        <div className="space-y-0.5">
          {APPS.filter((a) => a.primary).map((app) => (
            <NavLink
              key={app.id}
              href={app.href}
              label={app.label}
              active={isActive(app.href)}
              collapsed={collapsed}
              icon={<AppIcon app={app} size={22} />}
              trailing={app.id === 'chat' && unread > 0 ? <span className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-red-500 px-1.5 text-[11px] font-semibold text-white" data-testid="chat-unread">{unread > 99 ? '99+' : unread}</span> : undefined}
            />
          ))}
          <NavLink href={MORE_APP.href} label="More" active={isActive(MORE_APP.href)} collapsed={collapsed} icon={<AppIcon app={MORE_APP} size={22} />} />
        </div>

        {!!starred?.length && (
          <Section title="Favorites" collapsed={collapsed}>
            {starred.slice(0, 8).map((r) => (
              <NavLink key={r.id} href={hrefFor(r)} label={r.name} active={pathname === hrefFor(r)} collapsed={collapsed} icon={<FileIcon r={r} size={18} />} />
            ))}
          </Section>
        )}

        <Section title="Spaces" collapsed={collapsed}>
          <NavLink href="/spaces" label="All spaces" active={pathname === '/spaces'} collapsed={collapsed} icon={<LayoutGrid size={18} className="mx-px text-muted" />} />
          {topSpaces.map((s) => (
            <NavLink key={s.id} href={`/spaces/${s.id}`} label={s.name} active={isActive(`/spaces/${s.id}`)} collapsed={collapsed} icon={<SpaceBadge space={s} />} />
          ))}
          <button
            onClick={() => setCreating(true)}
            className={cn('flex h-9 w-full items-center gap-3 rounded-lg px-2.5 text-[14px] text-muted hover:bg-hover hover:text-ink', collapsed && 'justify-center px-0')}
          >
            <Plus size={18} className="mx-px" />
            {!collapsed && 'Create space'}
          </button>
        </Section>
      </nav>
      <button onClick={toggle} className="flex h-11 items-center gap-2 border-t border-line px-5 text-[13px] text-muted hover:text-ink">
        {collapsed ? <ChevronsRight size={16} /> : <ChevronsLeft size={16} />}
        {!collapsed && 'Collapse'}
      </button>
      <CreateSpaceDialog open={creating} onOpenChange={setCreating} />
    </aside>
  );
}
