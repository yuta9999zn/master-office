'use client';

import type { AutomationProblem, AutomationRole, PlainFlow } from '@workos/flow-model';
import type { UserSummary } from '@workos/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from './api';

// Flow automation (§77 batch 2): the Runs tab talks to /flows/:id/….

export interface FlowRunStep {
  nodeId: string;
  name: string;
  role: AutomationRole;
  type: string;
  status: 'ok' | 'error' | 'waiting' | 'passed';
  startedAt: string;
  finishedAt?: string;
  output?: unknown;
  error?: string;
  branch?: 'yes' | 'no';
}

export interface FlowRun {
  id: string;
  flowId: string;
  pageId: string;
  triggerNodeId: string;
  triggerType: string;
  trigger: Record<string, unknown>;
  status: 'running' | 'waiting' | 'succeeded' | 'failed' | 'cancelled';
  steps: FlowRunStep[];
  error: string | null;
  runBy: UserSummary | null;
  startedAt: string;
  finishedAt: string | null;
  resumeAt: string | null;
}

export interface FlowAutomation {
  enabled: boolean;
  problems: AutomationProblem[];
  triggers: { nodeId: string; type: string; config: Record<string, unknown>; enabled: boolean; nextRunAt: string | null; name: string }[];
  counts: { total: number; running: number; waiting: number; failed: number };
}

export const useFlowAutomation = (id: string) => useQuery({ queryKey: ['flow', id, 'automation'], queryFn: () => api<FlowAutomation>(`/flows/${id}/automation`) });
export const useFlowRuns = (id: string, enabled = true) => useQuery({ queryKey: ['flow', id, 'runs'], queryFn: () => api<FlowRun[]>(`/flows/${id}/runs`), enabled, refetchInterval: (q) => (q.state.data?.some((r) => r.status === 'running') ? 1500 : false) });

const onError = (e: Error) => toast.error(e.message);

export function useFlowActions(id: string) {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ['flow', id] });
  return {
    refresh,
    runNow: useMutation({ mutationFn: (b: { nodeId?: string | null; input?: Record<string, unknown> }) => api<FlowRun>(`/flows/${id}/run`, { method: 'POST', json: b }), onSuccess: refresh, onError }),
    resume: useMutation({ mutationFn: (rid: string) => api<FlowRun>(`/flows/${id}/runs/${rid}/resume`, { method: 'POST' }), onSuccess: refresh, onError }),
    cancel: useMutation({ mutationFn: (rid: string) => api<FlowRun>(`/flows/${id}/runs/${rid}/cancel`, { method: 'POST' }), onSuccess: refresh, onError }),
    setEnabled: useMutation({ mutationFn: (enabled: boolean) => api<FlowAutomation>(`/flows/${id}/automation`, { method: 'PUT', json: { enabled } }), onSuccess: refresh, onError }),
    importFlow: useMutation({ mutationFn: (f: PlainFlow) => api<{ ok: boolean; nodes: number }>(`/flows/${id}/import`, { method: 'POST', json: f }), onSuccess: refresh, onError }),
  };
}

export const TRIGGER_LABEL: Record<string, string> = {
  manual: 'Run now',
  'form.submitted': 'Form submitted',
  'base.recordCreated': 'Base record created',
  'base.recordUpdated': 'Base record updated',
  'approval.finished': 'Approval decided',
  'task.statusChanged': 'Task status changed',
  schedule: 'Schedule',
  'mail.received': 'E-mail received',
};

export const RUN_STATUS: Record<FlowRun['status'], { label: string; tone: string }> = {
  running: { label: 'Running', tone: 'bg-sky-50 text-sky-700' },
  waiting: { label: 'Waiting', tone: 'bg-amber-50 text-amber-700' },
  succeeded: { label: 'Succeeded', tone: 'bg-emerald-50 text-emerald-700' },
  failed: { label: 'Failed', tone: 'bg-red-50 text-red-700' },
  cancelled: { label: 'Cancelled', tone: 'bg-canvas text-muted' },
};
