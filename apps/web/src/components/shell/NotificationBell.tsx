'use client';

import type { AppNotification } from '@workos/shared';
import { AtSign, Bell, CalendarDays, CheckCheck, CircleCheck, FileText, ListChecks, MessageSquareText, PhoneMissed, Share2, SquareCheckBig, Workflow } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Popover } from 'radix-ui';
import { useState } from 'react';
import { timeAgo } from '@/lib/format';
import { useNotificationActions, useNotifications, useUnreadNotifications } from '@/lib/notifications';
import { Avatar, cn, EmptyState, Skeleton, Tip } from '../ui/primitives';

const KIND_ICON: Record<string, { icon: typeof Bell; color: string }> = {
  'chat.mention': { icon: AtSign, color: '#f59e0b' },
  'chat.reply': { icon: MessageSquareText, color: '#2563eb' },
  'resource.shared': { icon: Share2, color: '#10b981' },
  'comment.created': { icon: FileText, color: '#8b5cf6' },
  'comment.reply': { icon: FileText, color: '#8b5cf6' },
  'calendar.invite': { icon: CalendarDays, color: '#ef4444' },
  'calendar.response': { icon: CalendarDays, color: '#ef4444' },
  'task.assigned': { icon: SquareCheckBig, color: '#2563eb' },
  'task.comment': { icon: SquareCheckBig, color: '#2563eb' },
  'meeting.call': { icon: PhoneMissed, color: '#ef4444' },
  'approval.pending': { icon: ListChecks, color: '#f59e0b' },
  'approval.result': { icon: CircleCheck, color: '#10b981' },
  'approval.cc': { icon: ListChecks, color: '#0ea5e9' },
  'approval.comment': { icon: MessageSquareText, color: '#f59e0b' },
  'flow.run': { icon: Workflow, color: '#8b5cf6' },
};

type Tab = 'all' | 'unread' | 'mentions';

/** The bell in the top bar (docs/ARCHITECTURE.md §66). */
export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>('all');
  const { data: unread = 0 } = useUnreadNotifications();
  const { data, isLoading } = useNotifications(open);
  const read = useNotificationActions();
  const router = useRouter();

  const shown = (data ?? []).filter((n) => (tab === 'unread' ? !n.readAt : tab === 'mentions' ? n.kind === 'chat.mention' : true));
  const go = (n: AppNotification) => {
    if (!n.readAt) read.mutate([n.id]);
    setOpen(false);
    router.push(n.url);
  };

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Tip label="Notifications">
        <Popover.Trigger asChild>
          <button className="relative inline-flex size-8 items-center justify-center rounded-lg text-muted hover:bg-hover hover:text-ink data-[state=open]:bg-selected data-[state=open]:text-brand-600" aria-label="Notifications" data-testid="bell">
            <Bell size={19} />
            {unread > 0 && (
              <span className="absolute -right-0.5 -top-0.5 inline-flex h-[17px] min-w-[17px] items-center justify-center rounded-full border-2 border-surface bg-red-500 px-1 text-[10px] font-bold text-white" data-testid="bell-count">
                {unread > 99 ? '99+' : unread}
              </span>
            )}
          </button>
        </Popover.Trigger>
      </Tip>
      <Popover.Portal>
        <Popover.Content align="end" sideOffset={8} className="pop z-50 flex max-h-[min(640px,80vh)] w-[400px] flex-col overflow-hidden animate-pop" data-testid="notifications">
          <div className="flex items-center justify-between px-4 pb-1 pt-3">
            <span className="text-[15px] font-semibold text-ink">Notifications</span>
            <button onClick={() => read.mutate('all')} disabled={!unread} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[12px] font-medium text-brand-600 hover:bg-brand-50 disabled:text-subtle disabled:hover:bg-transparent">
              <CheckCheck size={14} /> Mark all as read
            </button>
          </div>
          <div className="flex gap-1 border-b border-line px-3" role="tablist">
            {(['all', 'unread', 'mentions'] as const).map((t) => (
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
          <ul className="min-h-0 flex-1 overflow-y-auto p-1.5">
            {isLoading && [0, 1, 2, 3].map((i) => <Skeleton key={i} className="m-2 h-14" />)}
            {!isLoading && !shown.length && (
              <EmptyState icon={<Bell size={28} />} title={tab === 'unread' ? 'You’re all caught up' : 'No notifications yet'}>
                Mentions, replies to your threads, files shared with you and comments on your files show up here.
              </EmptyState>
            )}
            {shown.map((n) => {
              const k = KIND_ICON[n.kind] ?? KIND_ICON['chat.reply'];
              const Icon = k.icon;
              return (
                <li key={n.id}>
                  <button onClick={() => go(n)} className={cn('flex w-full gap-3 rounded-lg px-2.5 py-2.5 text-left hover:bg-hover', !n.readAt && 'bg-brand-50/50')} data-testid="notification" data-kind={n.kind} data-read={!!n.readAt}>
                    <span className="relative shrink-0">
                      {n.actor ? <Avatar user={n.actor} size={36} /> : <span className="block size-9 rounded-full bg-hover" />}
                      <span className="absolute -bottom-0.5 -right-0.5 flex size-[18px] items-center justify-center rounded-full border-2 border-surface text-white" style={{ background: k.color }}>
                        <Icon size={10} strokeWidth={2.6} />
                      </span>
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] leading-snug text-ink">{n.title}</span>
                      {n.body && <span className="mt-0.5 line-clamp-2 block text-[12.5px] text-muted">{n.body}</span>}
                      <span className="mt-1 block text-[11.5px] text-subtle">{timeAgo(n.createdAt)}</span>
                    </span>
                    {!n.readAt && <span className="mt-1.5 size-2 shrink-0 rounded-full bg-brand-600" aria-label="Unread" />}
                  </button>
                </li>
              );
            })}
          </ul>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
