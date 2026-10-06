'use client';

import type { MailAddr, Mailbox, MailFolder, MailThreadSummary, MailThreadView, RealtimeEvent, Resource, SendMailInput } from '@workos/shared';
import { type QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, uploadFile } from './api';

export const mailKeys = {
  boxes: ['mail', 'boxes'] as const,
  threads: (box: string, folder: MailFolder, q: string) => ['mail', 'threads', box, folder, q] as const,
  thread: (id: string) => ['mail', 'thread', id] as const,
};

export const useMailboxes = () => useQuery({ queryKey: mailKeys.boxes, queryFn: () => api<Mailbox[]>('/mail/mailboxes'), staleTime: 30_000 });
export const useMailThreads = (box: string | undefined, folder: MailFolder, q: string) =>
  useQuery({
    queryKey: mailKeys.threads(box ?? '', folder, q),
    queryFn: () => api<MailThreadSummary[]>(`/mail/mailboxes/${box}/threads?folder=${folder}${q.trim() ? `&q=${encodeURIComponent(q.trim())}` : ''}`),
    enabled: !!box,
    placeholderData: (prev) => prev,
  });
export const useMailThread = (id?: string | null) => useQuery({ queryKey: mailKeys.thread(id ?? ''), queryFn: () => api<MailThreadView>(`/mail/threads/${id}`), enabled: !!id, retry: false });
export const useMailAddresses = (q: string) =>
  useQuery({ queryKey: ['mail', 'addresses', q], queryFn: () => api<(MailAddr & { kind: 'person' | 'space' | 'external' })[]>(`/mail/addresses?q=${encodeURIComponent(q)}`), enabled: q.trim().length > 0, staleTime: 30_000 });

/** Unread conversations in your own inbox (sidebar badge). */
export function useMailUnread() {
  const { data } = useMailboxes();
  return data?.find((b) => b.kind === 'user')?.unread ?? 0;
}

export function applyMailEvent(qc: QueryClient, e: RealtimeEvent) {
  if (e.type === 'mail.changed' || e.type === 'mail.received') {
    void qc.invalidateQueries({ queryKey: mailKeys.boxes });
    void qc.invalidateQueries({ queryKey: ['mail', 'threads', e.mailboxId] });
    void qc.invalidateQueries({ queryKey: ['mail', 'thread'] });
  }
}

const onError = (e: Error) => toast.error(e.message);

export function useMailActions() {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ['mail'] });
  return {
    send: useMutation({ mutationFn: (input: SendMailInput) => api<{ id: string; threadId: string; external: number }>('/mail/send', { method: 'POST', json: input }), onSuccess: refresh, onError }),
    saveDraft: useMutation({
      mutationFn: (input: Partial<SendMailInput> & { mailboxId: string; draftId?: string | null }) => api<{ id: string; threadId: string }>('/mail/drafts', { method: 'POST', json: input }),
      onSuccess: () => qc.invalidateQueries({ queryKey: mailKeys.boxes }),
    }),
    deleteDraft: useMutation({ mutationFn: (id: string) => api(`/mail/drafts/${id}`, { method: 'DELETE' }), onSuccess: refresh, onError }),
    update: useMutation({
      mutationFn: ({ id, ...input }: { id: string; read?: boolean; starred?: boolean; folder?: 'inbox' | 'archive' | 'trash'; assigneeId?: string | null }) => api(`/mail/threads/${id}`, { method: 'PATCH', json: input }),
      onSuccess: refresh,
      onError,
    }),
    remove: useMutation({ mutationFn: (id: string) => api(`/mail/threads/${id}`, { method: 'DELETE' }), onSuccess: refresh, onError }),
    saveToDrive: useMutation({
      mutationFn: (id: string) => api<Resource>(`/mail/attachments/${id}/save`, { method: 'POST', json: {} }),
      onSuccess: (r) => toast.success(`Saved “${r.name}” to My Files`),
      onError,
    }),
    enableSpace: useMutation({
      mutationFn: ({ spaceId, localPart, name }: { spaceId: string; localPart: string; name?: string }) => api<{ id: string; address: string }>(`/mail/spaces/${spaceId}/mailbox`, { method: 'POST', json: { localPart, name } }),
      onSuccess: (r) => (toast.success(`${r.address} is ready`), refresh()),
      onError,
    }),
  };
}

export async function uploadMailAttachment(file: File) {
  const fd = new FormData();
  fd.append('file', file);
  return uploadFile<{ id: string; name: string; mimeType: string | null; sizeBytes: number }>('/mail/attachments', fd);
}

export const addrLabel = (a: MailAddr) => a.name || a.address;
export const addrFull = (a: MailAddr) => (a.name ? `${a.name} <${a.address}>` : a.address);
