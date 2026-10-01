'use client';

import { HocuspocusProvider } from '@hocuspocus/provider';
import type { CollabTokenResponse, Role } from '@workos/shared';
import { useEffect, useRef, useState } from 'react';
import { IndexeddbPersistence } from 'y-indexeddb';
import * as Y from 'yjs';
import { api } from '@/lib/api';

export type SaveStatus = 'connecting' | 'saving' | 'saved' | 'offline';

export interface Presence {
  clientId: number;
  name: string;
  color: string;
  userId: string;
}

export interface CollabSession {
  doc: Y.Doc;
  provider: HocuspocusProvider;
  role: Role;
}

/**
 * One realtime session per open document (docs/ARCHITECTURE.md §9):
 * Yjs doc + Hocuspocus WebSocket + IndexedDB cache for offline recovery.
 */
export function useCollab(resourceId: string, me: { id: string; name: string; color: string } | undefined) {
  const [session, setSession] = useState<CollabSession | null>(null);
  const [status, setStatus] = useState<SaveStatus>('connecting');
  const [synced, setSynced] = useState(false);
  const [peers, setPeers] = useState<Presence[]>([]);
  const [error, setError] = useState<string | null>(null);
  const statelessHandlers = useRef(new Set<(payload: Record<string, unknown>) => void>());

  useEffect(() => {
    if (!me) return;
    let disposed = false;
    const doc = new Y.Doc();
    const cache = new IndexeddbPersistence(`mo-${resourceId}`, doc);
    let provider: HocuspocusProvider | null = null;

    (async () => {
      let first: CollabTokenResponse;
      try {
        first = await api<CollabTokenResponse>(`/resources/${resourceId}/collab-token`);
      } catch (e) {
        setError((e as Error).message);
        return;
      }
      if (disposed) return;
      provider = new HocuspocusProvider({
        url: first.url,
        name: first.document,
        document: doc,
        // Re-issued on every (re)connect: tokens are short-lived and carry the current role.
        token: async () => (await api<CollabTokenResponse>(`/resources/${resourceId}/collab-token`)).token,
        onSynced: () => {
          setSynced(true);
          setStatus('saved');
        },
        onStatus: ({ status: s }) => setStatus(s === 'connected' ? (provider?.hasUnsyncedChanges ? 'saving' : 'saved') : s === 'disconnected' ? 'offline' : 'connecting'),
        onUnsyncedChanges: ({ number }) => setStatus(number > 0 ? 'saving' : 'saved'),
        onAuthenticationFailed: ({ reason }) => setError(`Access denied: ${reason}`),
        onStateless: ({ payload }) => {
          try {
            const data = JSON.parse(payload);
            statelessHandlers.current.forEach((h) => h(data));
          } catch {
            /* ignore foreign payloads */
          }
        },
        onAwarenessChange: ({ states }) => {
          const seen = new Map<string, Presence>();
          for (const s of states as unknown as { clientId: number; user?: { name: string; color: string; id: string } }[]) {
            if (s.user && s.clientId !== doc.clientID) seen.set(s.user.id, { clientId: s.clientId, name: s.user.name, color: s.user.color, userId: s.user.id });
          }
          setPeers([...seen.values()]);
        },
      });
      provider.setAwarenessField('user', { id: me.id, name: me.name, color: me.color });
      setSession({ doc, provider, role: first.role });
    })();

    return () => {
      disposed = true;
      provider?.destroy();
      void cache.destroy();
      doc.destroy();
      setSession(null);
      setSynced(false);
      setStatus('connecting');
    };
  }, [resourceId, me?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const onStateless = (h: (payload: Record<string, unknown>) => void) => {
    statelessHandlers.current.add(h);
    return () => statelessHandlers.current.delete(h);
  };
  const broadcast = (payload: Record<string, unknown>) => session?.provider.sendStateless(JSON.stringify(payload));

  return { session, status, synced, peers, error, onStateless, broadcast };
}
