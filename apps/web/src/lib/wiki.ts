'use client';

import type { Resource, WikiPageStatus, WikiSpaceDetail, WikiSpaceSummary } from '@workos/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from './api';

// Wiki (§78): Confluence-style spaces and their page trees.

export type StarterSet = 'blank' | 'ba' | 'scrum' | 'kanban' | 'waterfall' | 'hybrid' | 'ai-dlc';
export const STARTER_SETS: { id: StarterSet; name: string; note: string }[] = [
  { id: 'blank', name: 'Blank', note: 'Just the home page' },
  { id: 'ba', name: 'Business analysis toolkit', note: 'Plan, elicitation, BRD / FRS, data dictionary, models, RTM, reviews, risks, tests' },
  { id: 'waterfall', name: 'Waterfall project', note: 'Business case, CBA, scope, BRD, FRD, SRS, design, RTM, tests, change requests' },
  { id: 'scrum', name: 'Agile (Scrum)', note: 'Vision, PRD, user stories, design, DoD, RAID, test plan, release notes' },
  { id: 'kanban', name: 'Agile (Kanban)', note: 'Vision, PRD, user stories, DoD, RAID' },
  { id: 'hybrid', name: 'Hybrid', note: 'Business case and BRD with user stories and DoD' },
  { id: 'ai-dlc', name: 'AI-DLC', note: 'Intent, inception, units of work, domain and logical design, bolts, runbook' },
];

export interface WikiRecent {
  id: string;
  title: string;
  spaceId: string;
  spaceName: string;
  status: WikiPageStatus;
  updatedAt: string;
  updatedBy: { id: string; name: string; avatarColor: string } | null;
}

export const useWikiSpaces = () => useQuery({ queryKey: ['wiki', 'spaces'], queryFn: () => api<WikiSpaceSummary[]>('/wiki/spaces') });
export const useWikiSpace = (id?: string | null) => useQuery({ queryKey: ['wiki', 'space', id], queryFn: () => api<WikiSpaceDetail>(`/wiki/spaces/${id}`), enabled: !!id, retry: false });
export const useWikiRecent = () => useQuery({ queryKey: ['wiki', 'recent'], queryFn: () => api<WikiRecent[]>('/wiki/recent?limit=12') });

const onError = (e: Error) => toast.error(e.message);

export function useWikiActions() {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ['wiki'] });
  const setSpace = (s: WikiSpaceDetail) => (qc.setQueryData(['wiki', 'space', s.id], s), void qc.invalidateQueries({ queryKey: ['wiki', 'spaces'] }));
  return {
    createSpace: useMutation({
      mutationFn: (b: { name: string; key?: string; description?: string | null; spaceId?: string | null; set?: StarterSet }) => api<WikiSpaceDetail>('/wiki/spaces', { method: 'POST', json: b }),
      onSuccess: refresh,
      onError,
    }),
    updateSpace: useMutation({
      mutationFn: ({ id, ...b }: { id: string; name?: string; description?: string | null; color?: string; homePageId?: string | null }) => api<WikiSpaceDetail>(`/wiki/spaces/${id}`, { method: 'PATCH', json: b }),
      onSuccess: setSpace,
      onError,
    }),
    createPage: useMutation({
      mutationFn: ({ spaceId, ...b }: { spaceId: string; title?: string; parentId?: string | null; template?: string | null }) => api<Resource>(`/wiki/spaces/${spaceId}/pages`, { method: 'POST', json: b }),
      onSuccess: refresh,
      onError,
    }),
    starter: useMutation({ mutationFn: ({ spaceId, set }: { spaceId: string; set: Exclude<StarterSet, 'blank'> }) => api<WikiSpaceDetail>(`/wiki/spaces/${spaceId}/starter`, { method: 'POST', json: { set } }), onSuccess: setSpace, onError }),
    /** Moves and page status / labels: the tree updates at once. */
    updatePage: useMutation({
      mutationKey: ['wiki', 'page'],
      mutationFn: ({ id, ...b }: { spaceId: string; id: string; parentId?: string | null; afterId?: string | null; beforeId?: string | null; status?: WikiPageStatus; labels?: string[] }) =>
        api<WikiSpaceDetail>(`/wiki/pages/${id}`, { method: 'PATCH', json: { parentId: b.parentId, afterId: b.afterId, beforeId: b.beforeId, status: b.status, labels: b.labels } }),
      onMutate: ({ spaceId, id, status, labels, parentId }) =>
        qc.setQueryData<WikiSpaceDetail>(['wiki', 'space', spaceId], (s) =>
          s && { ...s, tree: s.tree.map((n) => (n.id === id ? { ...n, ...(status !== undefined ? { status } : {}), ...(labels ? { labels } : {}), ...(parentId !== undefined ? { parentId } : {}) } : n)) },
        ),
      onSuccess: (s) => (qc.isMutating({ mutationKey: ['wiki', 'page'] }) > 1 ? undefined : setSpace(s)),
      onError: (e: Error) => (onError(e), void refresh()),
    }),
    copyPage: useMutation({ mutationFn: ({ id, withChildren }: { id: string; withChildren?: boolean }) => api<{ id: string; space: WikiSpaceDetail }>(`/wiki/pages/${id}/copy`, { method: 'POST', json: { withChildren } }), onSuccess: (r) => setSpace(r.space), onError }),
    deletePage: useMutation({ mutationFn: (id: string) => api<WikiSpaceDetail>(`/wiki/pages/${id}`, { method: 'DELETE' }), onSuccess: setSpace, onError }),
  };
}
