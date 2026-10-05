'use client';

import type { ConversationSummary, UserSummary } from '@workos/shared';
import { BellOff, Check, Ellipsis, Hash, LogOut, MessageSquarePlus, Pin, PinOff, Plus, Search, Bell, Users, Compass } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { lastMessageText, useChatActions, useConversations } from '@/lib/chat';
import { formatShort } from '@/lib/format';
import { useMe, useUsers } from '@/lib/queries';
import { useTypingStore } from '@/lib/realtime';
import { Avatar, cn, EmptyState, Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, Skeleton } from '../ui/primitives';
import { ConversationAvatar } from './bits';

type Tab = 'all' | 'unread' | 'mentions' | 'favorites';
export type NewKind = 'dm' | 'channel' | 'browse';

export function ConversationList({ activeId, onNew }: { activeId?: string; onNew: (k: NewKind) => void }) {
  const { data: list, isLoading } = useConversations();
  const { data: users } = useUsers();
  const { data: me } = useMe();
  const [tab, setTab] = useState<Tab>('all');
  const [q, setQ] = useState('');
  const router = useRouter();
  const { create } = useChatActions();
  const people = useMemo(() => new Map((users ?? []).map((u) => [u.id, u])), [users]);

  const needle = q.trim().toLowerCase();
  const shown = (list ?? []).filter((c) => {
    if (needle && !c.title.toLowerCase().includes(needle)) return false;
    if (tab === 'unread') return c.unread > 0;
    if (tab === 'mentions') return c.mentions > 0;
    if (tab === 'favorites') return c.pinned;
    return true;
  });
  const pinned = tab === 'all' && !needle ? shown.filter((c) => c.pinned) : [];
  const rest = tab === 'all' && !needle ? shown.filter((c) => !c.pinned) : shown;
  // While searching, people without a DM yet can be messaged directly.
  const dmPeers = new Set((list ?? []).filter((c) => c.kind === 'dm').map((c) => c.peer?.id));
  const newPeople = needle ? (users ?? []).filter((u) => u.id !== me?.user.id && !dmPeers.has(u.id) && u.name.toLowerCase().includes(needle)).slice(0, 5) : [];

  const startDm = async (u: UserSummary) => {
    const r = await create.mutateAsync({ kind: 'dm', userId: u.id });
    setQ('');
    router.push(`/chat/${r.id}`);
  };

  return (
    <section className="flex w-[340px] shrink-0 flex-col border-r border-line bg-surface" data-testid="conversation-list">
      <div className="flex items-center gap-2 px-4 pb-2 pt-4">
        <label className="flex h-9 flex-1 items-center gap-2 rounded-lg bg-canvas px-3 text-[13px] ring-1 ring-line focus-within:ring-brand-500">
          <Search size={15} className="text-subtle" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search chats, people…" className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-subtle" aria-label="Search chats" />
        </label>
        <Menu>
          <MenuTrigger asChild>
            <button className="inline-flex size-9 items-center justify-center rounded-lg text-ink-2 ring-1 ring-line hover:bg-hover" aria-label="New chat" data-testid="new-chat">
              <Plus size={18} />
            </button>
          </MenuTrigger>
          <MenuContent align="end">
            <MenuItem icon={<MessageSquarePlus />} onSelect={() => onNew('dm')}>
              New message or group
            </MenuItem>
            <MenuItem icon={<Hash />} onSelect={() => onNew('channel')}>
              Create a channel
            </MenuItem>
            <MenuItem icon={<Compass />} onSelect={() => onNew('browse')}>
              Browse channels
            </MenuItem>
          </MenuContent>
        </Menu>
      </div>
      <div className="flex gap-1 border-b border-line px-3" role="tablist">
        {(['all', 'unread', 'mentions', 'favorites'] as const).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={cn('-mb-px border-b-2 px-2.5 py-2 text-[13px] capitalize', tab === t ? 'border-brand-600 font-semibold text-brand-600' : 'border-transparent text-muted hover:text-ink')}
          >
            {t}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {isLoading ? (
          Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="flex items-center gap-3 px-2 py-2.5">
              <Skeleton className="size-10 rounded-full" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3.5 w-1/2" />
                <Skeleton className="h-3 w-3/4" />
              </div>
            </div>
          ))
        ) : (
          <>
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
            {!shown.length && !newPeople.length && (
              <EmptyState icon={<Users size={28} />} title={needle ? 'No matches' : tab === 'all' ? 'No conversations yet' : `Nothing in ${tab}`}>
                {tab === 'all' && !needle ? 'Start a chat with a colleague or join a channel.' : null}
              </EmptyState>
            )}
          </>
        )}
      </div>
    </section>
  );
}

const Heading = ({ children }: { children: string }) => <div className="px-2 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide text-subtle first:pt-1">{children}</div>;

function Row({ c, active, people, me }: { c: ConversationSummary; active: boolean; people: Map<string, UserSummary>; me?: string }) {
  const { prefs, read, removeMember } = useChatActions();
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
      <Link
        href={`/chat/${c.id}`}
        className={cn('flex items-center gap-3 rounded-lg px-2 py-2.5 pr-3', active ? 'bg-selected' : 'hover:bg-hover')}
        aria-current={active ? 'page' : undefined}
      >
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
              <span
                className={cn('inline-flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full px-1.5 text-[11px] font-semibold text-white', c.muted ? 'bg-slate-300' : c.mentions ? 'bg-red-500' : 'bg-red-500')}
                data-testid="unread-badge"
              >
                {c.mentions && !c.muted ? `@${c.unread > 99 ? '99+' : c.unread}` : c.unread > 99 ? '99+' : c.unread}
              </span>
            )}
          </span>
        </span>
      </Link>
      <Menu>
        <MenuTrigger asChild>
          <button className="absolute right-2 top-2 hidden size-6 items-center justify-center rounded-md bg-surface text-muted shadow-sm ring-1 ring-line hover:text-ink group-hover:flex data-[state=open]:flex" aria-label={`Options for ${c.title}`}>
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
          {c.kind !== 'dm' && me && (
            <>
              <MenuSeparator />
              <MenuItem icon={<LogOut />} danger onSelect={() => removeMember.mutate({ id: c.id, userId: me })}>
                Leave
              </MenuItem>
            </>
          )}
        </MenuContent>
      </Menu>
    </div>
  );
}
