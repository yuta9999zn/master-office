'use client';

import type { RealtimeEvent } from '@workos/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { useEffect, useRef } from 'react';
import { create } from 'zustand';
import { api, API_ORIGIN } from './api';
import { applyChatEvent } from './chat';
import { applyNotificationEvent } from './notifications';
import { useMe } from './queries';

type Listener = (e: RealtimeEvent) => void;
const listeners = new Set<Listener>();
let socket: WebSocket | null = null;

/** Sends a client signal (typing) when the socket is open; silently dropped otherwise. */
export function sendRealtime(msg: Record<string, unknown>) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg));
}

export function useRealtime(handler: Listener) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const l: Listener = (e) => ref.current(e);
    listeners.add(l);
    return () => void listeners.delete(l);
  }, []);
}

interface PresenceState {
  online: Set<string>;
  connected: boolean;
}
export const usePresence = create<PresenceState>(() => ({ online: new Set(), connected: false }));
export const useIsOnline = (userId?: string | null) => usePresence((s) => !!userId && s.online.has(userId));

/** conversationId → userId → who is typing (and where: the channel or a thread) until when. */
interface TypingState {
  typing: Record<string, Record<string, { name: string; threadRootId: string | null; until: number }>>;
}
export const useTypingStore = create<TypingState>(() => ({ typing: {} }));

export function useTyping(conversationId: string, threadRootId: string | null) {
  const map = useTypingStore((s) => s.typing[conversationId]);
  const now = Date.now();
  return Object.values(map ?? {})
    .filter((t) => t.until > now && t.threadRootId === threadRootId)
    .map((t) => t.name);
}

/**
 * The per-user socket of docs/ARCHITECTURE.md §64, opened once by the shell. Reconnects with backoff; after a
 * reconnect every chat query is refetched, so nothing pushed while offline is missed.
 */
export function RealtimeBridge() {
  const qc = useQueryClient();
  const router = useRouter();
  const { data: me } = useMe();
  const meId = me?.user.id;
  const routerRef = useRef(router);
  routerRef.current = router;

  useEffect(() => {
    if (!meId) return;
    let stopped = false;
    let retry = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let wasConnected = false;

    const connect = async () => {
      if (stopped) return;
      try {
        const { token } = await api<{ token: string }>('/realtime/token');
        if (stopped) return;
        const ws = new WebSocket(`${API_ORIGIN.replace(/^http/, 'ws')}/realtime?token=${encodeURIComponent(token)}`);
        socket = ws;
        ws.onopen = () => {
          retry = 0;
          usePresence.setState({ connected: true });
          if (wasConnected) void qc.invalidateQueries({ queryKey: ['chat'] });
          wasConnected = true;
        };
        ws.onmessage = (m) => {
          let e: RealtimeEvent;
          try {
            e = JSON.parse(String(m.data));
          } catch {
            return;
          }
          if (e.type === 'presence') usePresence.setState({ online: new Set(e.online) });
          else if (e.type === 'chat.typing')
            useTypingStore.setState((s) => ({
              typing: { ...s.typing, [e.conversationId]: { ...s.typing[e.conversationId], [e.user.id]: { name: e.user.name, threadRootId: e.threadRootId, until: Date.now() + 4500 } } },
            }));
          else if (e.type === 'chat.message' && e.message.sender)
            // A message ends that person's typing indicator.
            useTypingStore.setState((s) => {
              const conv = { ...s.typing[e.conversationId] };
              delete conv[e.message.sender!.id];
              return { typing: { ...s.typing, [e.conversationId]: conv } };
            });
          applyChatEvent(qc, e, meId);
          applyNotificationEvent(qc, e);
          if (e.type === 'notification') {
            const n = e.notification;
            // A small heads-up, unless you are already looking at the place it points to.
            if (!window.location.pathname.startsWith(n.url.split('?')[0]))
              toast(n.title, { description: n.body ?? undefined, action: { label: 'Open', onClick: () => routerRef.current.push(n.url) } });
          }
          for (const l of listeners) l(e);
        };
        ws.onclose = () => {
          if (socket === ws) socket = null;
          usePresence.setState({ connected: false });
          if (!stopped) timer = setTimeout(connect, Math.min(1000 * 2 ** retry++, 15_000));
        };
      } catch {
        timer = setTimeout(connect, Math.min(1000 * 2 ** retry++, 15_000));
      }
    };
    void connect();
    // Typing indicators expire on their own; re-render listeners every second while any is shown.
    const sweep = setInterval(() => {
      const now = Date.now();
      const { typing } = useTypingStore.getState();
      if (Object.values(typing).some((c) => Object.values(c).some((t) => t.until < now)))
        useTypingStore.setState({
          typing: Object.fromEntries(Object.entries(typing).map(([k, c]) => [k, Object.fromEntries(Object.entries(c).filter(([, t]) => t.until >= now))])),
        });
    }, 1000);
    return () => {
      stopped = true;
      clearTimeout(timer);
      clearInterval(sweep);
      socket?.close();
      socket = null;
    };
  }, [meId, qc]);

  return null;
}
