'use client';

import type { JSONContent } from '@workos/doc-model';
import type {
  AclEntry,
  CommentAnchor,
  CommentThread,
  ImportReport,
  ResourceLinks,
  ActivityEvent,
  CreateResourceInput,
  ListResourcesQuery,
  Me,
  Resource,
  ResourceDetail,
  ResourceVersion,
  Role,
  SearchHit,
  Space,
  SpaceMember,
  UpdateResourceInput,
  UserSummary,
  WorkspaceStats,
  SpaceKind,
} from '@workos/shared';
import { useEffect, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, uploadFile } from './api';

const qs = (o: object) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};

// ── Queries ──────────────────────────────────────────────────────────────────

export const useMe = () => useQuery({ queryKey: ['me'], queryFn: () => api<Me>('/me'), staleTime: 60_000 });
export const useUsers = () => useQuery({ queryKey: ['users'], queryFn: () => api<UserSummary[]>('/users'), staleTime: 60_000 });
export const useStats = () => useQuery({ queryKey: ['stats'], queryFn: () => api<WorkspaceStats>('/stats') });
export const useActivity = (limit = 20) => useQuery({ queryKey: ['activity', limit], queryFn: () => api<ActivityEvent[]>(`/activity?limit=${limit}`) });

export const useSpaces = () => useQuery({ queryKey: ['spaces'], queryFn: () => api<Space[]>('/spaces'), staleTime: 30_000 });
export const useSpace = (id?: string) => useQuery({ queryKey: ['spaces', id], queryFn: () => api<Space>(`/spaces/${id}`), enabled: !!id });
export const useSpaceMembers = (id?: string) =>
  useQuery({ queryKey: ['spaces', id, 'members'], queryFn: () => api<SpaceMember[]>(`/spaces/${id}/members`), enabled: !!id });
export const useSpaceActivity = (id?: string) =>
  useQuery({ queryKey: ['spaces', id, 'activity'], queryFn: () => api<ActivityEvent[]>(`/spaces/${id}/activity`), enabled: !!id });

export const useResources = (q: ListResourcesQuery | null) =>
  useQuery({
    queryKey: ['resources', 'list', q],
    queryFn: () => api<Resource[]>(`/resources${qs(q!)}`),
    enabled: !!q,
    placeholderData: keepPreviousData,
  });
export const useResource = (id?: string | null) =>
  useQuery({ queryKey: ['resources', 'one', id], queryFn: () => api<ResourceDetail>(`/resources/${id}`), enabled: !!id, retry: false });
export const useResourceMembers = (id?: string | null) =>
  useQuery({ queryKey: ['resources', 'members', id], queryFn: () => api<AclEntry[]>(`/resources/${id}/members`), enabled: !!id });
export const useResourceActivity = (id?: string | null) =>
  useQuery({ queryKey: ['resources', 'activity', id], queryFn: () => api<ActivityEvent[]>(`/resources/${id}/activity`), enabled: !!id });
export const useResourceVersions = (id?: string | null) =>
  useQuery({ queryKey: ['resources', 'versions', id], queryFn: () => api<ResourceVersion[]>(`/resources/${id}/versions`), enabled: !!id });

/** The value a short moment after the person stopped typing (search boxes: one request per pause, not per keystroke). */
export function useDebounced<T>(value: T, ms = 200): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export const useSearch = (raw: string) => {
  const q = useDebounced(raw.trim(), 200);
  return useQuery({
    queryKey: ['search', q],
    queryFn: () => api<SearchHit[]>(`/search${qs({ q })}`),
    enabled: q.length > 0,
    placeholderData: keepPreviousData,
  });
};

// ── Mutations ────────────────────────────────────────────────────────────────

function useInvalidate() {
  const qc = useQueryClient();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ['resources'] }),
      qc.invalidateQueries({ queryKey: ['activity'] }),
      qc.invalidateQueries({ queryKey: ['stats'] }),
      qc.invalidateQueries({ queryKey: ['search'] }),
      qc.invalidateQueries({ queryKey: ['spaces'] }),
    ]);
}

const onError = (e: Error) => toast.error(e.message);

/** Every Drive action in one place so all apps (Drive, Spaces, editors, Home) behave identically. */
export function useResourceActions() {
  const invalidate = useInvalidate();
  const m = <A,>(fn: (a: A) => Promise<unknown>, success?: string | ((a: A) => string)) =>
    useMutation({
      mutationFn: fn,
      onSuccess: (_d, a) => {
        if (success) toast.success(typeof success === 'function' ? success(a) : success);
        return invalidate();
      },
      onError,
    });

  return {
    create: useMutation({ mutationFn: (input: CreateResourceInput) => api<Resource>('/resources', { method: 'POST', json: input }), onSuccess: invalidate, onError }),
    update: useMutation({
      mutationFn: ({ id, ...input }: UpdateResourceInput & { id: string }) => api<Resource>(`/resources/${id}`, { method: 'PATCH', json: input }),
      onSuccess: invalidate,
      onError,
    }),
    copy: m(({ id, ...target }: { id: string; parentId?: string | null; spaceId?: string | null }) => api<Resource>(`/resources/${id}/copy`, { method: 'POST', json: target }), 'Copy created'),
    trash: m((ids: string[]) => Promise.all(ids.map((id) => api(`/resources/${id}/trash`, { method: 'POST' }))), (ids) => `${ids.length > 1 ? `${ids.length} items` : 'Item'} moved to trash`),
    restore: m((ids: string[]) => Promise.all(ids.map((id) => api(`/resources/${id}/restore`, { method: 'POST' }))), 'Restored'),
    destroy: m((ids: string[]) => Promise.all(ids.map((id) => api(`/resources/${id}`, { method: 'DELETE' }))), 'Deleted permanently'),
    star: m(({ id, on }: { id: string; on: boolean }) => api(`/resources/${id}/star`, { method: on ? 'PUT' : 'DELETE' }), ({ on }) => (on ? 'Added to Starred' : 'Removed from Starred')),
    share: m(({ id, userId, role }: { id: string; userId: string; role: Role | null }) => api(`/resources/${id}/members`, { method: 'POST', json: { userId, role } })),
    upload: useMutation({
      mutationFn: async ({ files, parentId, spaceId }: { files: File[]; parentId?: string | null; spaceId?: string | null }) => {
        const out: Resource[] = [];
        for (const file of files) {
          const fd = new FormData();
          fd.append('file', file);
          if (parentId) fd.append('parentId', parentId);
          else if (spaceId) fd.append('spaceId', spaceId);
          out.push(await uploadFile<Resource>('/resources/upload', fd));
        }
        return out;
      },
      onSuccess: (r) => {
        toast.success(`Uploaded ${r.length} file${r.length > 1 ? 's' : ''}`);
        return invalidate();
      },
      onError,
    }),
    recordAccess: useMutation({ mutationFn: (id: string) => api(`/resources/${id}/access`, { method: 'POST' }) }),
  };
}

export function useSpaceActions() {
  const qc = useQueryClient();
  return {
    create: useMutation({
      mutationFn: (input: { name: string; description?: string; parentId?: string | null; color?: string; visibility: 'public' | 'private'; kind?: SpaceKind }) =>
        api<Space>('/spaces', { method: 'POST', json: input }),
      onSuccess: () => qc.invalidateQueries({ queryKey: ['spaces'] }),
      onError,
    }),
    /** Name, kind, colour, visibility, place in the tree (§79). */
    update: useMutation({
      mutationFn: ({ id, ...b }: { id: string; name?: string; description?: string | null; kind?: SpaceKind; color?: string | null; visibility?: 'public' | 'private'; parentId?: string | null }) =>
        api<Space>(`/spaces/${id}`, { method: 'PATCH', json: b }),
      onSuccess: () => qc.invalidateQueries({ queryKey: ['spaces'] }),
      onError,
    }),
    setMember: useMutation({
      mutationFn: ({ spaceId, userId, role, title }: { spaceId: string; userId: string; role: Role | null; title?: string | null }) =>
        api(`/spaces/${spaceId}/members`, { method: 'POST', json: { userId, role, ...(title !== undefined ? { title } : {}) } }),
      onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: ['spaces'] }), qc.invalidateQueries({ queryKey: ['resources'] }), qc.invalidateQueries({ queryKey: ['contacts'] })]),
      onError,
    }),
  };
}

// ── Docs (Phase 2) ───────────────────────────────────────────────────────────

export const useComments = (resourceId?: string | null) =>
  useQuery({ queryKey: ['comments', resourceId], queryFn: () => api<CommentThread[]>(`/resources/${resourceId}/comments`), enabled: !!resourceId });

export function useCommentActions(resourceId: string, onChange?: () => void) {
  const qc = useQueryClient();
  const done = () => {
    onChange?.();
    return Promise.all([qc.invalidateQueries({ queryKey: ['comments', resourceId] }), qc.invalidateQueries({ queryKey: ['resources', 'activity', resourceId] })]);
  };
  return {
    create: useMutation({
      mutationFn: (input: { body: string; threadId?: string; anchor?: CommentAnchor | null; quote?: string | null }) =>
        api<{ id: string }>(`/resources/${resourceId}/comments`, { method: 'POST', json: input }),
      onSuccess: done,
      onError,
    }),
    update: useMutation({
      mutationFn: ({ id, ...input }: { id: string; body?: string; resolved?: boolean }) => api(`/comments/${id}`, { method: 'PATCH', json: input }),
      onSuccess: done,
      onError,
    }),
    remove: useMutation({ mutationFn: (id: string) => api(`/comments/${id}`, { method: 'DELETE' }), onSuccess: done, onError }),
  };
}

export function useVersionActions(resourceId: string) {
  const qc = useQueryClient();
  const done = () => qc.invalidateQueries({ queryKey: ['resources'] });
  return {
    save: useMutation({
      mutationFn: (label: string | null) => api<{ id: string }>(`/resources/${resourceId}/versions`, { method: 'POST', json: { label } }),
      onSuccess: () => {
        toast.success('Version saved');
        return done();
      },
      onError,
    }),
    restore: useMutation({
      mutationFn: (versionId: string) => api(`/resources/${resourceId}/versions/${versionId}/restore`, { method: 'POST' }),
      onSuccess: () => {
        toast.success('Version restored — the previous content was kept as a version');
        return done();
      },
      onError,
    }),
    reimport: useMutation({
      mutationFn: () => api<ImportReport>(`/resources/${resourceId}/import`, { method: 'POST' }),
      onSuccess: done,
      onError,
    }),
  };
}

export const useVersionContent = (resourceId: string, versionId: string | null) =>
  useQuery({
    queryKey: ['resources', 'version-content', resourceId, versionId],
    queryFn: () => api<{ content: JSONContent }>(`/resources/${resourceId}/versions/${versionId}/content`),
    enabled: !!versionId,
  });

// ── Notes (Phase 2b) ─────────────────────────────────────────────────────────

/** Linked pages / backlinks. Links are recomputed server-side when the note is saved, so poll gently while open. */
export const useResourceLinks = (id?: string | null) =>
  useQuery({ queryKey: ['resources', 'links', id], queryFn: () => api<ResourceLinks>(`/resources/${id}/links`), enabled: !!id, refetchInterval: 8000 });
