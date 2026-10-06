'use client';

import { between, type IssueLinkKind, type IssueType, type Methodology, type Project, type ProjectStats, type RealtimeEvent, type TaskDetail, type TaskInput, type TaskLinkView, type TaskStatus, type TaskView } from '@workos/shared';
import { type QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from './api';

export type { TaskDetail };

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
    request: useMutation({
      mutationFn: ({ projectId, ...input }: { projectId: string; title: string; description?: string | null; type?: IssueType; priority?: TaskInput['priority'] }) =>
        api<TaskView>(`/tasks/projects/${projectId}/requests`, { method: 'POST', json: input }),
      onSuccess: refresh,
      onError,
    }),
    decline: useMutation({ mutationFn: ({ id, reason }: { id: string; reason: string }) => api<TaskView>(`/tasks/${id}/decline`, { method: 'POST', json: { reason } }), onSuccess: refresh, onError }),
    breakdown: useMutation({
      mutationFn: ({ id, titles, type }: { id: string; titles: string[]; type?: IssueType }) => api<TaskView[]>(`/tasks/${id}/breakdown`, { method: 'POST', json: { titles, type } }),
      onSuccess: refresh,
      onError,
    }),
    link: useMutation({
      mutationFn: ({ id, toId, kind }: { id: string; toId: string; kind: IssueLinkKind }) => api<TaskLinkView[]>(`/tasks/${id}/links`, { method: 'POST', json: { toId, kind } }),
      onSuccess: refresh,
      onError,
    }),
    unlink: useMutation({ mutationFn: ({ id, linkId }: { id: string; linkId: string }) => api<TaskLinkView[]>(`/tasks/${id}/links/${linkId}`, { method: 'DELETE' }), onSuccess: refresh, onError }),
    watch: useMutation({ mutationFn: ({ id, on }: { id: string; on: boolean }) => api(`/tasks/${id}/watch`, { method: 'POST', json: { on } }), onSuccess: refresh, onError }),
    createProject: useMutation({
      mutationFn: (input: { spaceId: string; name: string; key?: string; color?: string; methodology?: Methodology }) => api<Project>('/tasks/projects', { method: 'POST', json: input }),
      onSuccess: refresh,
      onError,
    }),
    updateProject: useMutation({
      mutationFn: ({ id, ...input }: { id: string; name?: string; statuses?: TaskStatus[]; methodology?: Methodology; leadId?: string | null; intakeOpen?: boolean; description?: string | null }) =>
        api(`/tasks/projects/${id}`, { method: 'PATCH', json: input }),
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

export const METHODOLOGY: Record<Methodology, { label: string; note: string }> = {
  scrum: { label: 'Scrum', note: 'Sprints and a backlog; board for the current sprint' },
  kanban: { label: 'Kanban', note: 'A continuous flow board with work-in-progress limits' },
  waterfall: { label: 'Waterfall', note: 'Phases with dates and dependencies on a Gantt chart' },
  hybrid: { label: 'Hybrid', note: 'Waterfall phases on the Gantt, agile sprints inside them' },
};

export const LINK_LABEL: Record<IssueLinkKind, { out: string; in: string }> = {
  blocks: { out: 'blocks', in: 'is blocked by' },
  relates: { out: 'relates to', in: 'relates to' },
  duplicates: { out: 'duplicates', in: 'is duplicated by' },
};
