'use client';

import { between, type Project, type ProjectStats, type RealtimeEvent, type TaskEventView, type TaskInput, type TaskStatus, type TaskView } from '@workos/shared';
import { type QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from './api';

export type TaskDetail = TaskView & { events: TaskEventView[]; children: TaskView[]; statuses: TaskStatus[] };

export const useProjects = () => useQuery({ queryKey: ['tasks', 'projects'], queryFn: () => api<Project[]>('/tasks/projects'), staleTime: 30_000 });
export const useTasks = (projectId: string | null) =>
  useQuery({ queryKey: ['tasks', 'list', projectId ?? 'mine'], queryFn: () => api<TaskView[]>(projectId ? `/tasks?project=${projectId}` : '/tasks?mine=1') });
export const useTask = (id?: string | null) => useQuery({ queryKey: ['tasks', 'one', id], queryFn: () => api<TaskDetail>(`/tasks/${id}`), enabled: !!id, retry: false });
export const useProjectStats = (id?: string | null) => useQuery({ queryKey: ['tasks', 'stats', id], queryFn: () => api<ProjectStats>(`/tasks/projects/${id}/stats`), enabled: !!id });

export function applyTasksEvent(qc: QueryClient, e: RealtimeEvent) {
  if (e.type === 'tasks.changed') void qc.invalidateQueries({ queryKey: ['tasks'] });
}

const onError = (e: Error) => toast.error(e.message);

export function useTaskActions() {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ['tasks'] });
  return {
    create: useMutation({ mutationFn: (input: TaskInput) => api<TaskView>('/tasks', { method: 'POST', json: input }), onSuccess: refresh, onError }),
    update: useMutation({
      mutationFn: ({ id, ...input }: Partial<TaskInput> & { id: string }) => api<TaskView>(`/tasks/${id}`, { method: 'PATCH', json: input }),
      // Board moves feel instant: patch the cached list, then let the server's answer win.
      // A drop between two cards gets the key the server will give it (same between()), so it lands there at once.
      onMutate: ({ id, status, after, before }) => {
        if (!status) return;
        for (const [key, list] of qc.getQueriesData<TaskView[]>({ queryKey: ['tasks', 'list'] })) {
          if (!list) continue;
          const pos = (x?: string | null) => (x ? (list.find((t) => t.id === x)?.position ?? null) : null);
          const position = after !== undefined || before !== undefined ? between(pos(after), pos(before)) : undefined;
          qc.setQueryData(key, list.map((t) => (t.id === id ? { ...t, status, ...(position ? { position } : {}) } : t)));
        }
        // …and so do subtask checkboxes in an open drawer.
        for (const [key, d] of qc.getQueriesData<TaskDetail>({ queryKey: ['tasks', 'one'] })) {
          if (!d?.children?.some((c) => c.id === id)) continue;
          const done = d.statuses.find((s) => s.id === status)?.category === 'done';
          qc.setQueryData(key, { ...d, children: d.children.map((c) => (c.id === id ? { ...c, status, completedAt: done ? (c.completedAt ?? new Date().toISOString()) : null } : c)) });
        }
      },
      onSettled: refresh,
      onError,
    }),
    remove: useMutation({ mutationFn: (id: string) => api(`/tasks/${id}`, { method: 'DELETE' }), onSuccess: refresh, onError }),
    comment: useMutation({ mutationFn: ({ id, body }: { id: string; body: string }) => api(`/tasks/${id}/comments`, { method: 'POST', json: { body } }), onSuccess: refresh, onError }),
    createProject: useMutation({
      mutationFn: (input: { spaceId: string; name: string; key?: string; color?: string }) => api<Project>('/tasks/projects', { method: 'POST', json: input }),
      onSuccess: refresh,
      onError,
    }),
    updateProject: useMutation({
      mutationFn: ({ id, ...input }: { id: string; name?: string; statuses?: TaskStatus[] }) => api(`/tasks/projects/${id}`, { method: 'PATCH', json: input }),
      onSuccess: refresh,
      onError,
    }),
  };
}

export const PRIORITY: Record<string, { label: string; color: string }> = {
  urgent: { label: 'Urgent', color: '#dc2626' },
  high: { label: 'High', color: '#ef4444' },
  medium: { label: 'Medium', color: '#f59e0b' },
  low: { label: 'Low', color: '#10b981' },
  none: { label: 'No priority', color: '#94a3b8' },
};
export const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
export const shortDate = (s: string) => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(`${s}T00:00:00`));
