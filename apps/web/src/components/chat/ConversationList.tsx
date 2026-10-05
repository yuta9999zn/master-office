'use client';

import { can, type ConversationSummary, type Space, type UserSummary } from '@workos/shared';
import { Bell, BellOff, Check, ChevronDown, Ellipsis, FolderPlus, Hash, Lock, Megaphone, MessageCircle, MessageSquarePlus, Pin, PinOff, Plus, Search, Settings, LogOut, Users } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { lastMessageText, useCategories, useChatActions, useConversations } from '@/lib/chat';
import { formatShort } from '@/lib/format';
import { useMe, useSpaces, useUsers } from '@/lib/queries';
import { useTypingStore } from '@/lib/realtime';
import { Avatar, cn, EmptyState, Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, Skeleton, Tip } from '../ui/primitives';
import { ConversationAvatar } from './bits';

export type NewKind = 'dm' | 'channel' | 'category';
/** 'home' = direct and group messages; otherwise a space id (a Discord "server"). */
export type Place = 'home' | string;

const unreadOf = (list: ConversationSummary[]) => list.filter((c) => !c.muted).reduce((n, c) => n + c.unread, 0);
const mentionsOf = (list: ConversationSummary[]) => list.filter((c) => !c.muted).reduce((n, c) => n + c.mentions, 0);

/** The spaces you can chat in: the ones with channels you see, and the ones you could add channels to. */
export function useChatSpaces() {
  const { data: list } = useConversations();
  const { data: spaces } = useSpaces();
  return useMemo(() => {
    const withChannels = new Set((list ?? []).filter((c) => c.kind === 'channel').map((c) => c.spaceId));
    return (spaces ?? []).filter((s) => withChannels.has(s.id) || can(s.myRole, 'admin'));
  }, [list, spaces]);
}

/** Discord's server rail: Home (direct messages) and one tile per space, with unread dots and mention counts. */
export function SpaceRail({ place }: { place: Place }) {
  const { data: list } = useConversations();
  const spaces = useChatSpaces();
  const direct = (list ?? []).filter((c) => c.kind !== 'channel');
  return (
    <nav className="flex w-[72px] shrink-0 flex-col items-center gap-2 overflow-y-auto border-r border-line bg-canvas py-3" aria-label="Spaces" data-testid="space-rail">
      <RailItem href="/chat" active={place === 'home'} label="Direct messages" unread={unreadOf(direct)} mentions={unreadOf(direct)} testId="rail-home">
        <span className="flex size-11 items-center justify-center rounded-2xl bg-brand-600 text-white">
          <MessageCircle size={22} />
        </span>
      </RailItem>
      <span className="h-px w-8 bg-line-strong" />
      {spaces.map((s) => {
        const mine = (list ?? []).filter((c) => c.spaceId === s.id);
        return (
          <RailItem key={s.id} href={`/chat?space=${s.id}`} active={place === s.id} label={s.name} unread={unreadOf(mine)} mentions={mentionsOf(mine)} testId="rail-space" name={s.name}>
            <span className="flex size-11 items-center justify-center rounded-2xl text-[17px] font-bold text-white" style={{ background: `linear-gradient(145deg, ${s.color ?? '#2563eb'}bb, ${s.color ?? '#2563eb'})` }}>
              {s.name.trim()[0]?.toUpperCase()}
            </span>
          </RailItem>
        );
      })}
    </nav>
  );
}

function RailItem({ href, active, label, unread, mentions, children, testId, name }: { href: string; active: boolean; label: string; unread: number; mentions: number; children: React.ReactNode; testId: string; name?: string }) {
  return (
    <Tip label={label} side="right">
      <Link href={href} className="group relative flex w-full justify-center" aria-label={label} aria-current={active ? 'page' : undefined} data-testid={testId} data-name={name}>
        <span className={cn('absolute left-0 top-1/2 w-1 -translate-y-1/2 rounded-r-full bg-ink transition-all', active ? 'h-9' : unread ? 'h-2' : 'h-0 group-hover:h-4')} />
        <span className={cn('transition-transform', active ? '' : 'opacity-90 group-hover:-translate-y-px group-hover:opacity-100')}>{children}</span>
        {mentions > 0 && (
          <span className="absolute bottom-0 right-2.5 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full border-2 border-canvas bg-red-500 px-1 text-[10px] font-bold text-white" data-testid="rail-badge">
            {mentions > 99 ? '99+' : mentions}
          </span>
        )}
      </Link>
    </Tip>
  );
}

/** The column next to the rail: direct messages at Home, the space's channels by category otherwise. */
export function ChatSidebar({ place, activeId, onNew }: { place: Place; activeId?: string; onNew: (k: NewKind) => void }) {
  const { data: spaces } = useSpaces();
  const space = place === 'home' ? null : spaces?.find((s) => s.id === place) ?? null;
  return (
    <section className="flex w-[300px] shrink-0 flex-col border-r border-line bg-surface" data-testid="conversation-list">
      {place === 'home' ? <DirectMessages activeId={activeId} onNew={onNew} /> : space ? <SpaceChannels space={space} activeId={activeId} onNew={onNew} /> : <Skeleton className="m-4 h-8" />}
    </section>
  );
}

// ── Home: direct and group messages ─────────────────────────────────────────

function DirectMessages({ activeId, onNew }: { activeId?: string; onNew: (k: NewKind) => void }) {
  const { data: list, isLoading } = useConversations();
  const { data: users } = useUsers();
  const { data: me } = useMe();
  const [q, setQ] = useState('');
  const router = useRouter();
  const { create } = useChatActions();
  const people = useMemo(() => new Map((users ?? []).map((u) => [u.id, u])), [users]);
  const needle = q.trim().toLowerCase();
  const direct = (list ?? []).filter((c) => c.kind !== 'channel' && (!needle || c.title.toLowerCase().includes(needle)));
  const pinned = needle ? [] : direct.filter((c) => c.pinned);
  const rest = needle ? direct : direct.filter((c) => !c.pinned);
  const dmPeers = new Set((list ?? []).filter((c) => c.kind === 'dm').map((c) => c.peer?.id));
  const newPeople = needle ? (users ?? []).filter((u) => u.id !== me?.user.id && !dmPeers.has(u.id) && u.name.toLowerCase().includes(needle)).slice(0, 5) : [];
  const startDm = async (u: UserSummary) => {
    const r = await create.mutateAsync({ kind: 'dm', userId: u.id });
    setQ('');
    router.push(`/chat/${r.id}`);
  };

  return (
    <>
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-line px-4">
        <span className="flex-1 text-[15px] font-semibold text-ink">Direct messages</span>
        <Tip label="New message or group">
          <button onClick={() => onNew('dm')} className="inline-flex size-8 items-center justify-center rounded-lg text-ink-2 hover:bg-hover" aria-label="New chat" data-testid="new-chat">
            <MessageSquarePlus size={18} />
          </button>
        </Tip>
      </div>
      <div className="px-3 pt-3">
        <label className="flex h-9 items-center gap-2 rounded-lg bg-canvas px-3 text-[13px] ring-1 ring-line focus-within:ring-brand-500">
          <Search size={15} className="text-subtle" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find or start a conversation" className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-subtle" aria-label="Search chats" />
        </label>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {isLoading && [0, 1, 2, 3].map((i) => <Skeleton key={i} className="m-2 h-12" />)}
        {!!pinned.length && <Heading>Pinned</Heading>}
        {pinned.map((c) => (
          <Row key={c.id} c={c} active={c.id === activeId} people={people} me={me?.user.id} />
        ))}
        {!!pinned.length && !!rest.length && <Heading>All chats</Heading>}
        {rest.map((c) => (
          <Row key={c.id} c={c} active={c.id === activeId} people={people} me={me?.user.id} />
        ))}
        {!!newPeople.length && <Heading>People</Heading>}
        {newPeople.map((u) => (
          <button key={u.id} onClick={() => startDm(u)} className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-hover">
            <Avatar user={u} size={36} />
            <span className="min-w-0">
              <span className="block truncate text-[14px] font-medium text-ink">{u.name}</span>
              <span className="block truncate text-[12px] text-muted">{[u.title, u.department].filter(Boolean).join(' · ')}</span>
            </span>
          </button>
        ))}
        {!isLoading && !direct.length && !newPeople.length && (
          <EmptyState icon={<Users size={28} />} title={needle ? 'No matches' : 'No direct messages yet'}>
            {needle ? null : 'Message a colleague, or start a group of up to 10 people.'}
          </EmptyState>
        )}
      </div>
    </>
  );
}

const Heading = ({ children }: { children: string }) => <div className="px-2 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide text-subtle first:pt-1">{children}</div>;

function Row({ c, active, people, me }: { c: ConversationSummary; active: boolean; people: Map<string, UserSummary>; me?: string }) {
  const typingMap = useTypingStore((s) => s.typing[c.id]);
  const typing = Object.values(typingMap ?? {}).filter((t) => t.until > Date.now() && !t.threadRootId);
  const lm = c.lastMessage;
  const who = lm?.kind === 'text' ? (lm.senderId === me ? 'You' : c.kind === 'dm' ? null : lm.sender?.split(' ')[0]) : lm?.sender?.split(' ')[0];
  const preview = typing.length
    ? `${typing.map((t) => t.name.split(' ')[0]).join(', ')} ${typing.length > 1 ? 'are' : 'is'} typing…`
    : lm
      ? `${who ? `${who}${lm.kind === 'text' ? ': ' : ' '}` : ''}${lastMessageText(lm, people)}`
      : c.description ?? 'No messages yet';
  const bold = c.unread > 0 && !c.muted;
  return (
    <div className="group relative" data-testid="conversation-row" data-title={c.title}>
      <Link href={`/chat/${c.id}`} className={cn('flex items-center gap-3 rounded-lg px-2 py-2.5 pr-3', active ? 'bg-selected' : 'hover:bg-hover')} aria-current={active ? 'page' : undefined}>
        <ConversationAvatar c={c} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className={cn('min-w-0 flex-1 truncate text-[14px]', bold ? 'font-semibold text-ink' : 'font-medium text-ink-2')}>{c.title}</span>
            {c.pinned && <Pin size={12} className="shrink-0 rotate-45 text-subtle" />}
            {c.muted && <BellOff size={12} className="shrink-0 text-subtle" />}
            <span className="shrink-0 text-[11.5px] text-subtle group-hover:invisible">{c.lastMessageAt ? formatShort(c.lastMessageAt) : ''}</span>
          </span>
          <span className="mt-0.5 flex items-center gap-2">
            <span className={cn('min-w-0 flex-1 truncate text-[12.5px]', typing.length ? 'italic text-brand-600' : bold ? 'text-ink-2' : 'text-muted')}>{preview}</span>
            {c.unread > 0 && (
              <span className={cn('inline-flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full px-1.5 text-[11px] font-semibold text-white', c.muted ? 'bg-slate-300' : 'bg-red-500')} data-testid="unread-badge">
                {c.mentions && !c.muted ? `@${c.unread > 99 ? '99+' : c.unread}` : c.unread > 99 ? '99+' : c.unread}
              </span>
            )}
          </span>
        </span>
      </Link>
      <RowMenu c={c} me={me} className="absolute right-2 top-2" />
    </div>
  );
}

function RowMenu({ c, me, className }: { c: ConversationSummary; me?: string; className?: string }) {
  const { prefs, read, removeMember } = useChatActions();
  const canLeave = c.kind === 'group' || (c.kind === 'channel' && c.visibility === 'private');
  return (
    <Menu>
      <MenuTrigger asChild>
        <button className={cn('hidden size-6 items-center justify-center rounded-md bg-surface text-muted shadow-sm ring-1 ring-line hover:text-ink group-hover:flex data-[state=open]:flex', className)} aria-label={`Options for ${c.title}`}>
          <Ellipsis size={14} />
        </button>
      </MenuTrigger>
      <MenuContent align="end">
        <MenuItem icon={c.pinned ? <PinOff /> : <Pin />} onSelect={() => prefs.mutate({ id: c.id, pinned: !c.pinned })}>
          {c.pinned ? 'Unpin' : 'Pin to top'}
        </MenuItem>
        <MenuItem icon={c.muted ? <Bell /> : <BellOff />} onSelect={() => prefs.mutate({ id: c.id, muted: !c.muted })}>
          {c.muted ? 'Unmute' : 'Mute'}
        </MenuItem>
        {c.unread > 0 && (
          <MenuItem icon={<Check />} onSelect={() => read.mutate({ id: c.id, seq: c.lastSeq })}>
            Mark as read
          </MenuItem>
        )}
        {canLeave && me && (
          <>
            <MenuSeparator />
            <MenuItem icon={<LogOut />} danger onSelect={() => removeMember.mutate({ id: c.id, userId: me })}>
              Leave
            </MenuItem>
          </>
        )}
      </MenuContent>
    </Menu>
  );
}

// ── A space: channels by category ───────────────────────────────────────────

function SpaceChannels({ space, activeId, onNew }: { space: Space; activeId?: string; onNew: (k: NewKind) => void }) {
  const { data: list, isLoading } = useConversations();
  const { data: categories } = useCategories(space.id);
  const { data: me } = useMe();
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const router = useRouter();
  const admin = can(space.myRole, 'admin');
  const channels = (list ?? []).filter((c) => c.kind === 'channel' && c.spaceId === space.id).sort((a, b) => a.position - b.position || a.title.localeCompare(b.title));
  const groups = [
    { id: '', name: null as string | null, items: channels.filter((c) => !c.categoryId || !categories?.some((k) => k.id === c.categoryId)) },
    ...(categories ?? []).map((k) => ({ id: k.id, name: k.name as string | null, items: channels.filter((c) => c.categoryId === k.id) })),
  ];
  const toggle = (id: string) =>
    setClosed((s) => {
      const next = new Set(s);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  return (
    <>
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-line px-4">
        <span className="min-w-0 flex-1 truncate text-[15px] font-semibold text-ink" data-testid="space-title">
          {space.name}
        </span>
        <Menu>
          <MenuTrigger asChild>
            <button className="inline-flex size-8 items-center justify-center rounded-lg text-ink-2 hover:bg-hover" aria-label="Space menu" data-testid="space-menu">
              <ChevronDown size={18} />
            </button>
          </MenuTrigger>
          <MenuContent align="end">
            {admin && (
              <>
                <MenuItem icon={<Plus />} onSelect={() => onNew('channel')}>
                  Create channel
                </MenuItem>
                <MenuItem icon={<FolderPlus />} onSelect={() => onNew('category')}>
                  Create category
                </MenuItem>
                <MenuSeparator />
              </>
            )}
            <MenuItem icon={<Settings />} onSelect={() => router.push(`/spaces/${space.id}`)}>
              Space members & roles
            </MenuItem>
          </MenuContent>
        </Menu>
      </div>
      <div className="px-4 pt-2 text-[11.5px] text-muted" data-testid="space-role">
        Your role: <span className="font-medium capitalize text-ink-2">{space.myRole ?? 'none'}</span>
        {space.myRole === 'viewer' && ' · read only'}
        {space.myRole === 'commenter' && ' · can write, no files'}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {isLoading && [0, 1, 2].map((i) => <Skeleton key={i} className="m-2 h-7" />)}
        {groups.map((g) => (
          <div key={g.id || 'none'} className="mb-1" data-testid="channel-category" data-name={g.name ?? ''}>
            {g.name && (
              <div className="group flex items-center">
                <button onClick={() => toggle(g.id)} className="flex flex-1 items-center gap-1 px-1 pb-1 pt-3 text-left text-[11px] font-semibold uppercase tracking-wide text-subtle hover:text-ink-2">
                  <ChevronDown size={12} className={cn('transition-transform', closed.has(g.id) && '-rotate-90')} />
                  {g.name}
                </button>
                {admin && (
                  <Tip label="Create channel">
                    <button onClick={() => onNew('channel')} className="mt-2 rounded p-0.5 text-subtle opacity-0 hover:text-ink group-hover:opacity-100" aria-label={`Create channel in ${g.name}`}>
                      <Plus size={14} />
                    </button>
                  </Tip>
                )}
              </div>
            )}
            {!closed.has(g.id) &&
              g.items.map((c) => <ChannelRow key={c.id} c={c} active={c.id === activeId} me={me?.user.id} />)}
          </div>
        ))}
        {!isLoading && !channels.length && (
          <EmptyState icon={<Hash size={28} />} title="No channels yet">
            {admin ? 'Create the first channel for this space.' : 'Space admins create channels here.'}
          </EmptyState>
        )}
      </div>
    </>
  );
}

function ChannelRow({ c, active, me }: { c: ConversationSummary; active: boolean; me?: string }) {
  const bold = c.unread > 0 && !c.muted;
  const Icon = c.visibility === 'private' ? Lock : c.postPolicy === 'admins' ? Megaphone : Hash;
  return (
    <div className="group relative" data-testid="conversation-row" data-title={c.title}>
      <Link
        href={`/chat/${c.id}`}
        className={cn('flex h-9 items-center gap-2 rounded-lg px-2 pr-8 text-[14px]', active ? 'bg-selected font-semibold text-ink' : bold ? 'font-semibold text-ink hover:bg-hover' : c.muted ? 'text-subtle hover:bg-hover' : 'text-ink-2 hover:bg-hover')}
        aria-current={active ? 'page' : undefined}
      >
        <Icon size={16} className={cn('shrink-0', bold || active ? 'text-ink-2' : 'text-subtle')} />
        <span className="min-w-0 flex-1 truncate">{c.title}</span>
        {c.mentions > 0 && !c.muted ? (
          <span className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-red-500 px-1.5 text-[11px] font-semibold text-white" data-testid="unread-badge">
            @{c.mentions}
          </span>
        ) : (
          bold && <span className="size-2 rounded-full bg-ink" data-testid="unread-badge" aria-label={`${c.unread} unread`} />
        )}
        {c.muted && <BellOff size={12} className="text-subtle" />}
      </Link>
      <RowMenu c={c} me={me} className="absolute right-1.5 top-1.5" />
    </div>
  );
}
