'use client';

import type { Contact, UpdateProfileInput, UserProfile } from '@workos/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { toast } from 'sonner';
import { api } from './api';

export const useContacts = (q: string) =>
  useQuery({ queryKey: ['contacts', 'list', q], queryFn: () => api<Contact[]>(`/contacts${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ''}`), placeholderData: keepPreviousData, staleTime: 30_000 });

/** Everyone the viewer may see, by id — with their teams and positions (§79), for chat name tags. */
export function usePeople() {
  const { data } = useContacts('');
  return useMemo(() => new Map((data ?? []).map((c) => [c.id, c])), [data]);
}

export const useProfile = (id?: string | null) =>
  useQuery({ queryKey: ['contacts', 'profile', id], queryFn: () => api<UserProfile>(`/contacts/${id}`), enabled: !!id, retry: false });

export function useUpdateProfile(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateProfileInput) => api<UserProfile>(`/contacts/${id}`, { method: 'PATCH', json: input }),
    onSuccess: (p) => {
      qc.setQueryData(['contacts', 'profile', id], p);
      toast.success('Profile updated');
      // Names, titles and departments show up everywhere (chat, Drive, mentions).
      return Promise.all([qc.invalidateQueries({ queryKey: ['contacts'] }), qc.invalidateQueries({ queryKey: ['users'] }), qc.invalidateQueries({ queryKey: ['me'] })]);
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
