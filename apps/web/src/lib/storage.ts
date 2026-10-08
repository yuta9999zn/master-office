'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from './api';

// Storage quotas (§79 batch C): the meter in Drive and Admin → Storage.

export interface StorageStatus {
  kind: 'user' | 'space';
  id: string;
  used: number;
  /** null = unlimited */
  limit: number | null;
  percent: number | null;
  warning: boolean;
  full: boolean;
  org: { used: number; limit: number | null; full: boolean };
}

export interface StorageReport {
  settings: { orgBytes: number | null; userDefaultBytes: number | null; spaceDefaultBytes: number | null };
  org: { used: number; limit: number | null; percent: number | null; allocated: number; unlimitedParties: number; warning: boolean };
  users: { user: { id: string; name: string; email: string; avatarColor: string }; role: string; status: string; used: number; files: number; limit: number | null; override: boolean; percent: number | null }[];
  spaces: { space: { id: string; name: string; kind: string; color: string | null; icon: string | null; parentId: string | null }; used: number; files: number; limit: number | null; override: boolean; percent: number | null }[];
  largest: { id: string; name: string; type: string; sizeBytes: number; owner: { id: string; name: string; avatarColor: string } | null; space: { id: string; name: string } | null; trashed: boolean; updatedAt: string }[];
}

export const useMyStorage = () => useQuery({ queryKey: ['storage', 'me'], queryFn: () => api<StorageStatus>('/storage/me'), staleTime: 30_000 });
export const useSpaceStorage = (id?: string) => useQuery({ queryKey: ['storage', 'space', id], queryFn: () => api<StorageStatus>(`/storage/space/${id}`), enabled: !!id, staleTime: 30_000 });
export const useStorageReport = () => useQuery({ queryKey: ['admin', 'storage'], queryFn: () => api<StorageReport>('/admin/storage') });

const onError = (e: Error) => toast.error(e.message);

export function useStorageActions() {
  const qc = useQueryClient();
  const done = (r: StorageReport) => {
    qc.setQueryData(['admin', 'storage'], r);
    qc.invalidateQueries({ queryKey: ['storage'] });
    qc.invalidateQueries({ queryKey: ['stats'] });
  };
  return {
    setDefaults: useMutation({
      mutationFn: (b: Partial<StorageReport['settings']>) => api<StorageReport>('/admin/storage', { method: 'PATCH', json: b }),
      onSuccess: done,
      onError,
    }),
    /** bytes: a number, null (unlimited) or undefined (back to the default). */
    setLimit: useMutation({
      mutationFn: ({ kind, id, bytes }: { kind: 'users' | 'spaces'; id: string; bytes: number | null | undefined }) =>
        bytes === undefined ? api<StorageReport>(`/admin/storage/${kind}/${id}`, { method: 'DELETE' }) : api<StorageReport>(`/admin/storage/${kind}/${id}`, { method: 'PUT', json: { bytes } }),
      onSuccess: done,
      onError,
    }),
  };
}

export const GB = 1024 ** 3;
export const MB = 1024 ** 2;

/** "1.2 GB of 10 GB" / "1.2 GB · unlimited" */
export function describeUsage(used: number, limit: number | null, fmt: (n: number) => string) {
  return limit === null ? `${used ? fmt(used) : '0 B'} used` : `${used ? fmt(used) : '0 B'} of ${fmt(limit)}`;
}

/** Colour of a meter: brand, amber from 80 %, red when full. */
export function meterTone(s: { percent: number | null; full?: boolean; warning?: boolean }) {
  if (s.full || (s.percent ?? 0) >= 100) return 'bg-red-500';
  if (s.warning || (s.percent ?? 0) >= 80) return 'bg-amber-500';
  return 'bg-brand-500';
}
