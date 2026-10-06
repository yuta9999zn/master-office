'use client';

import type { ApprovalBox, ApprovalCounts, ApprovalRequestDetail, ApprovalRequestSummary, ApprovalRouteStep, ApprovalTemplate, RealtimeEvent, Resource, UserSummary } from '@workos/shared';
import { type QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, uploadFile } from './api';

export const useApprovalTemplates = () => useQuery({ queryKey: ['approvals', 'templates'], queryFn: () => api<ApprovalTemplate[]>('/approvals/templates'), staleTime: 30_000 });
export const useApprovalCounts = () => useQuery({ queryKey: ['approvals', 'counts'], queryFn: () => api<ApprovalCounts>('/approvals/counts'), staleTime: 15_000 });
export const useApprovalList = (box: ApprovalBox, f: { template?: string | null; status?: string | null; q?: string }) => {
  const qs = new URLSearchParams({ box });
  if (f.template) qs.set('template', f.template);
  if (f.status) qs.set('status', f.status);
  if (f.q?.trim()) qs.set('q', f.q.trim());
  return useQuery({ queryKey: ['approvals', 'list', qs.toString()], queryFn: () => api<ApprovalRequestSummary[]>(`/approvals/requests?${qs}`) });
};
export const useApprovalRequest = (id?: string | null) =>
  useQuery({ queryKey: ['approvals', 'one', id], queryFn: () => api<ApprovalRequestDetail>(`/approvals/requests/${id}`), enabled: !!id, retry: false });

export function applyApprovalsEvent(qc: QueryClient, e: RealtimeEvent) {
  if (e.type === 'approvals.changed') void qc.invalidateQueries({ queryKey: ['approvals'] });
}

export const previewRoute = (templateId: string, values: Record<string, unknown>, picks: Record<string, string[]>) =>
  api<{ route: ApprovalRouteStep[]; people: UserSummary[] }>(`/approvals/templates/${templateId}/preview`, { method: 'POST', json: { values, picks } });

export const uploadApprovalFile = (file: File) => {
  const fd = new FormData();
  fd.append('file', file);
  return uploadFile<Resource>('/approvals/files', fd);
};

const onError = (e: Error) => toast.error(e.message);

export function useApprovalActions() {
  const qc = useQueryClient();
  const done = (r?: ApprovalRequestDetail) => {
    if (r) qc.setQueryData(['approvals', 'one', r.id], r);
    void qc.invalidateQueries({ queryKey: ['approvals'] });
  };
  const act = (path: string) =>
    useMutation({
      mutationFn: ({ id, ...body }: { id: string; comment?: string | null; userId?: string }) => api<ApprovalRequestDetail>(`/approvals/requests/${id}/${path}`, { method: 'POST', json: body }),
      onSuccess: done,
      onError,
    });
  return {
    submit: useMutation({
      mutationFn: (input: { templateId: string; values: Record<string, unknown>; picks: Record<string, string[]> }) => api<ApprovalRequestDetail>('/approvals/requests', { method: 'POST', json: input }),
      onSuccess: done,
      onError,
    }),
    approve: act('approve'),
    reject: act('reject'),
    transfer: act('transfer'),
    withdraw: act('withdraw'),
    remind: useMutation({
      mutationFn: (id: string) => api<{ reminded: number }>(`/approvals/requests/${id}/remind`, { method: 'POST' }),
      onSuccess: (r) => toast.success(`Reminder sent to ${r.reminded} ${r.reminded === 1 ? 'person' : 'people'}`),
      onError,
    }),
    comment: useMutation({
      mutationFn: ({ id, body }: { id: string; body: string }) => api<ApprovalRequestDetail>(`/approvals/requests/${id}/comments`, { method: 'POST', json: { body } }),
      onSuccess: done,
      onError,
    }),
    saveTemplate: useMutation({
      mutationFn: ({ id, ...t }: Partial<Omit<ApprovalTemplate, 'admins'>> & { id?: string; admins?: string[] }) =>
        id ? api<ApprovalTemplate>(`/approvals/templates/${id}`, { method: 'PATCH', json: t }) : api<ApprovalTemplate>('/approvals/templates', { method: 'POST', json: t }),
      onSuccess: () => qc.invalidateQueries({ queryKey: ['approvals'] }),
      onError,
    }),
    deleteTemplate: useMutation({
      mutationFn: (id: string) => api(`/approvals/templates/${id}`, { method: 'DELETE' }),
      onSuccess: () => qc.invalidateQueries({ queryKey: ['approvals'] }),
      onError,
    }),
  };
}
