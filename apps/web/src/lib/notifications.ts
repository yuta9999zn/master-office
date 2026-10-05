'use client';

import type { AppNotification, RealtimeEvent } from '@workos/shared';
import { type QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';

export const notificationKeys = {
  list: ['notifications', 'list'] as const,
  count: ['notifications', 'count'] as const,
};

export const useNotifications = (enabled = true) =>
  useQuery({ queryKey: notificationKeys.list, queryFn: () => api<AppNotification[]>('/notifications?limit=60'), enabled, staleTime: 30_000 });
export const useUnreadNotifications = () =>
  useQuery({ queryKey: notificationKeys.count, queryFn: () => api<{ unread: number }>('/notifications/unread-count'), select: (d) => d.unread, staleTime: 30_000 });

export function useNotificationActions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[] | 'all') => api<{ read: number }>('/notifications/read', { method: 'POST', json: { ids } }),
    onMutate: (ids) => markRead(qc, ids),
  });
}

function markRead(qc: QueryClient, ids: string[] | 'all') {
  const now = new Date().toISOString();
  let cleared = 0;
  qc.setQueryData<AppNotification[]>(notificationKeys.list, (l) =>
    l?.map((n) => {
      if (n.readAt || (ids !== 'all' && !ids.includes(n.id))) return n;
      cleared++;
      return { ...n, readAt: now };
    }),
  );
  qc.setQueryData<{ unread: number }>(notificationKeys.count, (c) => (c ? { unread: ids === 'all' ? 0 : Math.max(0, c.unread - (cleared || ids.length)) } : c));
  if (!qc.getQueryData(notificationKeys.list)) void qc.invalidateQueries({ queryKey: notificationKeys.count });
}

/** Keeps the bell in step with the socket (called by RealtimeBridge). */
export function applyNotificationEvent(qc: QueryClient, e: RealtimeEvent) {
  if (e.type === 'notification') {
    qc.setQueryData<AppNotification[]>(notificationKeys.list, (l) => (l && !l.some((n) => n.id === e.notification.id) ? [e.notification, ...l] : l));
    qc.setQueryData<{ unread: number }>(notificationKeys.count, (c) => (c ? { unread: c.unread + 1 } : c));
  } else if (e.type === 'notification.read') {
    // Read in another tab (or by reading the conversation): refetch the exact count.
    qc.setQueryData<AppNotification[]>(notificationKeys.list, (l) => l?.map((n) => (!n.readAt && (e.ids === 'all' || e.ids.includes(n.id)) ? { ...n, readAt: new Date().toISOString() } : n)));
    void qc.invalidateQueries({ queryKey: notificationKeys.count });
  }
}
