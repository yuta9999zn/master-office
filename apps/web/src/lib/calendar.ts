'use client';

import type { CalendarEventView, CalendarInfo, EventInput, EventResponse, RealtimeEvent, UserSummary } from '@workos/shared';
import { keepPreviousData, type QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from './api';

export const useCalendars = () => useQuery({ queryKey: ['calendar', 'calendars'], queryFn: () => api<CalendarInfo[]>('/calendar/calendars'), staleTime: 60_000 });
export const useCalendarPeople = () => useQuery({ queryKey: ['calendar', 'people'], queryFn: () => api<UserSummary[]>('/calendar/people'), staleTime: 300_000 });
export const useEvents = (from: Date, to: Date, people: string[] = [], enabled = true) =>
  useQuery({
    queryKey: ['calendar', 'events', from.toISOString(), to.toISOString(), people.join(',')],
    queryFn: () => api<CalendarEventView[]>(`/calendar/events?from=${from.toISOString()}&to=${to.toISOString()}${people.length ? `&people=${people.join(',')}` : ''}`),
    placeholderData: keepPreviousData,
    enabled,
  });
export const useEvent = (id?: string | null) => useQuery({ queryKey: ['calendar', 'event', id], queryFn: () => api<CalendarEventView>(`/calendar/events/${id}`), enabled: !!id, retry: false });

export function applyCalendarEvent(qc: QueryClient, e: RealtimeEvent) {
  if (e.type === 'calendar.changed') void qc.invalidateQueries({ queryKey: ['calendar'] });
}

const onError = (e: Error) => toast.error(e.message);

export function useCalendarActions() {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ['calendar'] });
  return {
    create: useMutation({ mutationFn: (input: EventInput) => api<CalendarEventView>('/calendar/events', { method: 'POST', json: input }), onSuccess: refresh, onError }),
    update: useMutation({ mutationFn: ({ id, ...input }: Partial<EventInput> & { id: string }) => api<CalendarEventView>(`/calendar/events/${id}`, { method: 'PATCH', json: input }), onSuccess: refresh, onError }),
    remove: useMutation({
      mutationFn: ({ id, occurrence }: { id: string; occurrence?: string }) => api(`/calendar/events/${id}${occurrence ? `?occurrence=${encodeURIComponent(occurrence)}` : ''}`, { method: 'DELETE' }),
      onSuccess: refresh,
      onError,
    }),
    respond: useMutation({ mutationFn: ({ id, response }: { id: string; response: Exclude<EventResponse, 'pending'> }) => api<CalendarEventView>(`/calendar/events/${id}/respond`, { method: 'POST', json: { response } }), onSuccess: refresh, onError }),
    enableSpace: useMutation({ mutationFn: (spaceId: string) => api<{ id: string }>(`/calendar/spaces/${spaceId}/calendar`, { method: 'POST', json: {} }), onSuccess: refresh, onError }),
  };
}

// ── Dates (in the viewer's own time zone) ───────────────────────────────────

export const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
export const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes());
export const startOfWeek = (d: Date) => addDays(startOfDay(d), -d.getDay());
export const startOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);
export const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
export const localTz = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
export const hm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
export function gmtLabel(tz = localTz()) {
  const off = -new Date().getTimezoneOffset();
  void tz;
  return `GMT${off >= 0 ? '+' : '-'}${Math.floor(Math.abs(off) / 60)}${Math.abs(off) % 60 ? `:${String(Math.abs(off) % 60).padStart(2, '0')}` : ''}`;
}
