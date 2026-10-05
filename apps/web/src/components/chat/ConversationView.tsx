'use client';

import type { ChatMessage, ConversationDetail, UserSummary } from '@workos/shared';
import { ArrowDown, Bell, BellOff, Info, Loader2, LogOut, Pin, PinOff, Search } from 'lucide-react';
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useChatActions, useConversation, useConversations, useMessages, useSendMessage } from '@/lib/chat';
import { useMe, useUsers } from '@/lib/queries';
import { sendRealtime, useIsOnline, useTyping } from '@/lib/realtime';
import { AvatarStack, Button, cn, EmptyState, IconButton, Skeleton } from '../ui/primitives';
import { ChannelGlyph, ConversationAvatar } from './bits';
import { Composer } from './Composer';
import { DetailsPanel, SearchPanel } from './DetailsPanel';
import { MessageItem, SystemLine } from './MessageItem';
import { ThreadPanel } from './ThreadPanel';

type Panel = { kind: 'thread'; id: string } | { kind: 'details' } | { kind: 'search' } | null;

const dayFmt = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
function dayLabel(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const diff = Math.round((new Date(today.toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 86_400_000);
  return diff === 0 ? 'Today' : diff === 1 ? 'Yesterday' : dayFmt.format(d);
}

export function TypingLine({ names }: { names: string[] }) {
  return (
    <div className="h-5 px-6 text-[12px] italic text-muted" data-testid="typing">
      {!!names.length && `${names.map((n) => n.split(' ')[0]).join(', ')} ${names.length > 1 ? 'are' : 'is'} typing…`}
    </div>
  );
}

export function ConversationView({ id }: { id: string }) {
  const { data: conv, error } = useConversation(id);
  const [panel, setPanel] = useState<Panel>(null);
  useEffect(() => {
    setPanel(null);
  }, [id]);

  if (error) return <EmptyState title="Can’t open this conversation">{(error as Error).message}</EmptyState>;
  if (!conv)
    return (
      <div className="flex-1 space-y-4 p-6">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-16 w-2/3" />
        <Skeleton className="ml-auto h-12 w-1/2" />
      </div>
    );
  return (
    <div className="flex min-w-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col bg-surface">
        <Header conv={conv} panel={panel} setPanel={setPanel} />
        <Timeline key={conv.id} conv={conv} onOpenThread={(m) => setPanel({ kind: 'thread', id: m.id })} highlight={null} />
      </div>
      {panel?.kind === 'thread' && <ThreadPanel conv={conv} rootId={panel.id} onClose={() => setPanel(null)} />}
      {panel?.kind === 'details' && <DetailsPanel conv={conv} onClose={() => setPanel(null)} />}
      {panel?.kind === 'search' && <SearchPanel conv={conv} onClose={() => setPanel(null)} onOpenThread={(mid) => setPanel({ kind: 'thread', id: mid })} />}
    </div>
  );
}

function Header({ conv, panel, setPanel }: { conv: ConversationDetail; panel: Panel; setPanel: (p: Panel) => void }) {
  const { prefs, removeMember } = useChatActions();
  const { data: me } = useMe();
  const online = useIsOnline(conv.peer?.id);
  const others = conv.members.filter((m) => m.id !== me?.user.id);
  const subtitle =
    conv.kind === 'dm'
      ? [online ? 'Active now' : 'Away', conv.peer?.title, conv.peer?.department].filter(Boolean).join(' · ')
      : [`${conv.memberCount} member${conv.memberCount === 1 ? '' : 's'}`, conv.kind === 'channel' ? (conv.visibility === 'private' ? 'Private' : 'Public') : 'Group', conv.description].filter(Boolean).join(' · ');
  const toggle = (p: NonNullable<Panel>['kind']) => setPanel(panel?.kind === p ? null : (p === 'details' ? { kind: 'details' } : { kind: 'search' }));

  return (
    <header className="flex h-[68px] shrink-0 items-center gap-3 border-b border-line px-5">
      <ConversationAvatar c={conv} size={40} />
      <div className="min-w-0 flex-1">
        <h1 className="flex items-center gap-1.5 truncate text-[16px] font-semibold text-ink" data-testid="conversation-title">
          {conv.kind === 'channel' && <ChannelGlyph visibility={conv.visibility} size={15} />}
          {conv.title}
        </h1>
        <p className="truncate text-[12.5px] text-muted" data-testid="conversation-subtitle">
          {subtitle}
        </p>
      </div>
      {conv.kind !== 'dm' && (
        <button onClick={() => toggle('details')} className="rounded-lg p-1 hover:bg-hover" aria-label="Members">
          <AvatarStack users={others.length ? others : conv.members} max={4} size={28} total={others.length || conv.members.length} />
        </button>
      )}
      <IconButton label="Search in conversation" active={panel?.kind === 'search'} onClick={() => toggle('search')}>
        <Search size={18} />
      </IconButton>
      {conv.joined && (
        <>
          <IconButton label={conv.pinned ? 'Unpin' : 'Pin to top'} onClick={() => prefs.mutate({ id: conv.id, pinned: !conv.pinned })}>
            {conv.pinned ? <PinOff size={18} /> : <Pin size={18} />}
          </IconButton>
          <IconButton label={conv.muted ? 'Unmute' : 'Mute notifications'} onClick={() => prefs.mutate({ id: conv.id, muted: !conv.muted })}>
            {conv.muted ? <BellOff size={18} /> : <Bell size={18} />}
          </IconButton>
        </>
      )}
      <IconButton label="Details" active={panel?.kind === 'details'} onClick={() => toggle('details')}>
        <Info size={18} />
      </IconButton>
      {conv.joined && conv.kind !== 'dm' && me && (
        <IconButton label="Leave" onClick={() => removeMember.mutate({ id: conv.id, userId: me.user.id })}>
          <LogOut size={18} />
        </IconButton>
      )}
    </header>
  );
}

/** Messages, newest at the bottom; older pages load when scrolled to the top. */
function Timeline({ conv, onOpenThread, highlight }: { conv: ConversationDetail; onOpenThread: (m: ChatMessage) => void; highlight: string | null }) {
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } = useMessages(conv.id);
  const { data: me } = useMe();
  const { data: users } = useUsers();
  const { data: list } = useConversations();
  const { read, join } = useChatActions();
  const send = useSendMessage(conv.id, me?.user);
  const people = useMemo(() => new Map((users ?? []).map((u) => [u.id, u])), [users]);
  const meId = me?.user.id;
  const candidates = useMemo(() => {
    const ids = new Set(conv.members.map((m) => m.id));
    return [...conv.members.filter((m) => m.id !== meId), ...(users ?? []).filter((u) => !ids.has(u.id))];
  }, [conv.members, users, meId]);
  const typing = useTyping(conv.id, null);
  const [editing, setEditing] = useState<string | null>(null);

  const messages = useMemo(() => (data ? [...data.pages].reverse().flatMap((p) => p.messages) : []), [data]);
  const scroller = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const [showJump, setShowJump] = useState(false);
  // Where "New" goes: the read marker when the conversation was opened.
  const summary = list?.find((c) => c.id === conv.id);
  const firstUnread = useRef<number | null>(null);
  if (firstUnread.current === null && summary) firstUnread.current = summary.lastReadSeq;

  const lastTop = messages.filter((m) => !m.id.startsWith('tmp-')).at(-1);
  const markRead = useCallback(() => {
    if (!conv.joined || !lastTop || document.visibilityState !== 'visible' || !atBottom.current) return;
    const current = list?.find((c) => c.id === conv.id)?.lastReadSeq ?? 0;
    if (lastTop.seq > current) read.mutate({ id: conv.id, seq: lastTop.seq });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conv.id, conv.joined, lastTop?.seq, list]);
  useEffect(() => {
    markRead();
    const onVis = () => markRead();
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('focus', onVis);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('focus', onVis);
    };
  }, [markRead]);

  // Keep the view pinned to the bottom when new messages arrive (unless reading older ones).
  const prevCount = useRef(0);
  const prevHeight = useRef(0);
  const prevFirst = useRef<string | undefined>(undefined);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const first = messages[0]?.id;
    if (prevCount.current === 0 && messages.length) {
      const divider = el.querySelector('[data-testid="new-divider"]');
      if (divider) divider.scrollIntoView({ block: 'center' });
      else el.scrollTop = el.scrollHeight;
    } else if (first !== prevFirst.current && prevFirst.current) {
      // Older page prepended: keep what was on screen in place.
      el.scrollTop += el.scrollHeight - prevHeight.current;
    } else if (messages.length > prevCount.current) {
      const last = messages.at(-1);
      if (atBottom.current || last?.sender?.id === meId) el.scrollTop = el.scrollHeight;
      else setShowJump(true);
    }
    prevCount.current = messages.length;
    prevHeight.current = el.scrollHeight;
    prevFirst.current = first;
  }, [messages, meId]);

  const onScroll = () => {
    const el = scroller.current!;
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    if (atBottom.current) {
      setShowJump(false);
      markRead();
    }
    if (el.scrollTop < 120 && hasNextPage && !isFetchingNextPage) void fetchNextPage();
  };

  // Read receipts: each other member's avatar sits under the last message they have read.
  const readersAt = useMemo(() => {
    const out = new Map<string, UserSummary[]>();
    if (conv.kind === 'dm') return out;
    const seqs = messages.filter((m) => m.kind === 'text' && !m.id.startsWith('tmp-')).map((m) => m.seq);
    for (const mem of conv.members) {
      if (mem.id === meId) continue;
      const at = seqs.filter((s) => s <= mem.lastReadSeq).at(-1);
      if (at === undefined || at < (seqs.at(-6) ?? 0)) continue; // only near the end of the conversation
      const key = String(at);
      out.set(key, [...(out.get(key) ?? []), mem]);
    }
    return out;
  }, [messages, conv.members, conv.kind, meId]);
  const myLast = [...messages].reverse().find((m) => m.sender?.id === meId && m.kind === 'text');
  const peer = conv.kind === 'dm' ? conv.members.find((m) => m.id !== meId) : null;

  const onTyping = () => sendRealtime({ type: 'typing', conversationId: conv.id });
  const editLast = () => {
    const mine = [...messages].reverse().find((m) => m.sender?.id === meId && m.kind === 'text' && !m.deletedAt && !m.id.startsWith('tmp-'));
    if (mine) setEditing(mine.id);
  };
  const canModerate = conv.kind !== 'dm' && conv.role !== 'member';

  return (
    <>
      <div ref={scroller} onScroll={onScroll} className="relative min-h-0 flex-1 overflow-y-auto pb-2" data-testid="timeline">
        {isFetchingNextPage && (
          <div className="flex justify-center py-2 text-muted">
            <Loader2 size={16} className="animate-spin" />
          </div>
        )}
        {!hasNextPage && !isLoading && <Intro conv={conv} />}
        {isLoading && (
          <div className="space-y-4 p-6">
            <Skeleton className="h-14 w-1/2" />
            <Skeleton className="ml-auto h-10 w-1/3" />
          </div>
        )}
        {messages.map((m, i) => {
          const prev = messages[i - 1];
          const newDay = !prev || new Date(prev.createdAt).toDateString() !== new Date(m.createdAt).toDateString();
          const grouped = !newDay && !!prev && prev.kind === 'text' && m.kind === 'text' && prev.sender?.id === m.sender?.id && new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() < 5 * 60_000 && !prev.replyCount;
          const isNew = firstUnread.current !== null && m.seq > firstUnread.current && (!prev || prev.seq <= firstUnread.current) && m.sender?.id !== meId && m.kind === 'text' && !m.id.startsWith('tmp-');
          return (
            <Fragment key={m.id}>
              {newDay && (
                <div className="sticky top-0 z-[5] flex justify-center py-2">
                  <span className="rounded-full border border-line bg-surface px-3 py-0.5 text-[11.5px] font-medium text-muted shadow-sm">{dayLabel(m.createdAt)}</span>
                </div>
              )}
              {isNew && (
                <div className="flex items-center gap-2 px-5 py-1" data-testid="new-divider">
                  <span className="h-px flex-1 bg-red-300" />
                  <span className="text-[11px] font-semibold uppercase text-red-500">New</span>
                </div>
              )}
              {m.kind === 'system' ? (
                <SystemLine m={m} me={meId} />
              ) : (
                <MessageItem
                  m={m}
                  me={meId}
                  people={people}
                  candidates={candidates}
                  grouped={grouped && !isNew}
                  canModerate={canModerate}
                  editing={editing === m.id}
                  setEditing={(v) => setEditing(v ? m.id : null)}
                  onOpenThread={onOpenThread}
                  readers={readersAt.get(String(m.seq))}
                  receipt={peer && myLast?.id === m.id && !m.id.startsWith('tmp-') ? (peer.lastReadSeq >= m.seq ? 'Seen' : 'Sent') : m.id.startsWith('tmp-') ? 'Sending…' : undefined}
                  highlight={highlight === m.id}
                />
              )}
            </Fragment>
          );
        })}
      </div>
      {showJump && (
        <div className="relative">
          <button
            onClick={() => {
              scroller.current!.scrollTop = scroller.current!.scrollHeight;
              setShowJump(false);
            }}
            className="absolute -top-12 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-brand-600 px-3 py-1.5 text-[12px] font-medium text-white shadow-lg"
          >
            <ArrowDown size={14} /> New messages
          </button>
        </div>
      )}
      <TypingLine names={typing} />
      <div className="px-5 pb-4">
        {conv.joined ? (
          <Composer
            key={conv.id}
            placeholder={`Message ${conv.kind === 'dm' ? conv.title : conv.kind === 'channel' ? `#${conv.title}` : conv.title}`}
            people={people}
            candidates={candidates}
            onTyping={onTyping}
            onEditLast={editLast}
            autoFocus
            onSubmit={(body) => {
              atBottom.current = true;
              return send.mutateAsync({ body }).catch(() => undefined);
            }}
          />
        ) : (
          <div className="flex items-center justify-between gap-3 rounded-xl border border-line bg-canvas px-4 py-3" data-testid="join-banner">
            <span className="text-[13px] text-ink-2">
              You are viewing <span className="font-semibold">#{conv.title}</span>. Join to send messages.
            </span>
            <Button variant="primary" onClick={() => join.mutate(conv.id)} loading={join.isPending}>
              Join channel
            </Button>
          </div>
        )}
      </div>
    </>
  );
}

function Intro({ conv }: { conv: ConversationDetail }) {
  return (
    <div className="px-6 pb-2 pt-8">
      <ConversationAvatar c={conv} size={56} />
      <h2 className="mt-3 text-[18px] font-semibold text-ink">{conv.kind === 'channel' ? `Welcome to #${conv.title}` : conv.title}</h2>
      <p className={cn('mt-1 max-w-xl text-[13px] text-muted')}>
        {conv.kind === 'dm'
          ? conv.peer?.id === conv.createdBy?.id && conv.memberCount === 1
            ? 'Jot down notes, links and drafts — only you can see this conversation.'
            : `This is the beginning of your conversation with ${conv.title}.`
          : conv.description ?? `This is the beginning of ${conv.kind === 'group' ? 'the group' : 'the channel'}.`}
      </p>
    </div>
  );
}
