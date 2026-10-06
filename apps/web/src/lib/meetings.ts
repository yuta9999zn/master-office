'use client';

import type { MeetingDetail, MeetingSummary, RealtimeEvent, UserSummary } from '@workos/shared';
import { type QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { create } from 'zustand';
import { api } from './api';

export const meetingPath = (code: string) => `/meetings?room=${code}`;

export const useMeetings = () => useQuery({ queryKey: ['meetings', 'list'], queryFn: () => api<MeetingSummary[]>('/meetings'), staleTime: 15_000 });
export const useMeeting = (code?: string | null) =>
  useQuery({ queryKey: ['meetings', 'one', code], queryFn: () => api<MeetingDetail>(`/meetings/${code}`), enabled: !!code, retry: false, staleTime: 5_000 });

export function applyMeetingsEvent(qc: QueryClient, e: RealtimeEvent) {
  if (e.type === 'meeting.changed') {
    void qc.invalidateQueries({ queryKey: ['meetings', 'one', e.code] });
    void qc.invalidateQueries({ queryKey: ['meetings', 'list'] });
  }
  if (e.type === 'meeting.ring') useRinging.setState((s) => ({ calls: [...s.calls.filter((c) => c.meetingId !== e.meetingId), { meetingId: e.meetingId, code: e.code, title: e.title, from: e.from, at: Date.now() }] }));
  if (e.type === 'meeting.ring.stop') useRinging.setState((s) => ({ calls: s.calls.filter((c) => c.meetingId !== e.meetingId) }));
}

/** Incoming calls being rung on this device. */
export interface IncomingCall {
  meetingId: string;
  code: string;
  title: string;
  from: UserSummary;
  at: number;
}
export const useRinging = create<{ calls: IncomingCall[] }>(() => ({ calls: [] }));

/** Starts a meeting (optionally for a conversation — a call) and opens its room. */
export function useStartMeeting() {
  const qc = useQueryClient();
  const router = useRouter();
  return useMutation({
    mutationFn: (input: { title?: string; conversationId?: string; access?: 'open' | 'trusted' }) => api<MeetingDetail>('/meetings', { method: 'POST', json: input }),
    onSuccess: (m) => {
      qc.setQueryData(['meetings', 'one', m.code], m);
      void qc.invalidateQueries({ queryKey: ['meetings', 'list'] });
      router.push(meetingPath(m.code));
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

/** "Video call" with one person: their direct message's call. */
export function useCallPerson() {
  const start = useStartMeeting();
  return useMutation({
    mutationFn: async (userId: string) => {
      const { id } = await api<{ id: string }>('/chat/conversations', { method: 'POST', json: { kind: 'dm', userId } });
      return start.mutateAsync({ conversationId: id });
    },
  });
}

export const formatDuration = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h} h ${m} min` : m ? `${m} min` : `${s} s`;
};
