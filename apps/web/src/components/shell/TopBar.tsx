'use client';

import { useQueryClient } from '@tanstack/react-query';
import { Check, ChevronDown, CircleHelp, LogOut, Plus, Search, Settings, UserRound } from 'lucide-react';
import Link from 'next/link';
import { setDevUser } from '@/lib/api';
import { useMe, useUsers } from '@/lib/queries';
import { useUi } from '@/lib/store';
import { Avatar, Button, IconButton, Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger, Wordmark } from '../ui/primitives';
import { NewMenu } from './NewMenu';
import { NotificationBell } from './NotificationBell';

export function TopBar() {
  const collapsed = useUi((s) => s.sidebarCollapsed);
  const openPalette = useUi((s) => s.setPaletteOpen);
  const { data: me } = useMe();

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line bg-surface pr-4">
      <Link href="/home" className="flex h-full shrink-0 items-center pl-5 transition-[width]" style={{ width: collapsed ? 72 : 232 }}>
        {collapsed ? <Wordmark className="[&>span:last-child]:hidden" /> : <Wordmark />}
      </Link>

      <div className="flex flex-1 justify-center">
        <button
          onClick={() => openPalette(true)}
          className="flex h-9 w-full max-w-[520px] items-center gap-2.5 rounded-lg bg-canvas px-3 text-[13px] text-subtle ring-1 ring-line transition hover:ring-line-strong"
        >
          <Search size={16} />
          <span className="flex-1 text-left">Search across Master Office</span>
          <kbd className="rounded border border-line bg-surface px-1.5 font-sans text-[11px] text-muted">Ctrl K</kbd>
        </button>
      </div>

      <div className="flex items-center gap-1">
        <NewMenu
          trigger={
            <Button variant="primary" icon={<Plus size={16} />} className="mr-2">
              New
            </Button>
          }
        />
        <IconButton label="Help">
          <CircleHelp size={19} />
        </IconButton>
        <IconButton label="Settings">
          <Settings size={19} />
        </IconButton>
        <NotificationBell />
        <UserMenu name={me?.user.name} org={me?.workspace?.name} user={me?.user} />
      </div>
    </header>
  );
}

function UserMenu({ name, org, user }: { name?: string; org?: string; user?: Parameters<typeof Avatar>[0]['user'] & { id: string } }) {
  const { data: users } = useUsers();
  const qc = useQueryClient();
  return (
    <Menu>
      <MenuTrigger asChild>
        <button className="ml-2 flex items-center gap-2.5 rounded-lg py-1 pl-1 pr-2 hover:bg-hover">
          {user ? <Avatar user={user} size={32} /> : <span className="size-8 rounded-full bg-hover" />}
          <span className="hidden text-left leading-tight lg:block">
            <span className="block text-[13px] font-semibold text-ink">{name ?? '…'}</span>
            <span className="block text-[12px] text-muted">{org}</span>
          </span>
          <ChevronDown size={15} className="text-muted" />
        </button>
      </MenuTrigger>
      <MenuContent align="end" className="w-64">
        <MenuItem icon={<UserRound />} disabled>
          Profile
        </MenuItem>
        <MenuItem icon={<Settings />} disabled>
          Preferences
        </MenuItem>
        <MenuSeparator />
        <MenuLabel>Switch user (dev)</MenuLabel>
        <div className="max-h-72 overflow-auto">
          {users?.map((u) => (
            <MenuItem
              key={u.id}
              icon={<Avatar user={u} size={18} />}
              onSelect={() => {
                setDevUser(u.id);
                qc.clear();
                window.location.href = '/home';
              }}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="truncate">{u.name}</span>
                {u.id === user?.id && <Check size={14} className="text-brand-600" />}
              </span>
            </MenuItem>
          ))}
        </div>
        <MenuSeparator />
        <MenuItem icon={<LogOut />} disabled>
          Sign out
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}
