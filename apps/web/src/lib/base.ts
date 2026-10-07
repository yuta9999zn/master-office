'use client';

import { coerceValue, type Attachment, type BaseChange, type BaseField, type BaseRecord, type BaseSchema, type BaseView, type CellContext, type FieldOptions, type FieldType, type RecordComment, type ViewConfig, type ViewType } from '@workos/base-model';
import type { UserSummary } from '@workos/shared';
import { useMutation, useQueries, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import { toast } from 'sonner';
import { api, uploadFile } from './api';
import { sendRealtime, useRealtime } from './realtime';
import { useUsers } from './queries';

// Base (§75): schema, records per table, titles of linked tables, comments — and live updates while open.

export const useBaseSchema = (id: string) => useQuery({ queryKey: ['base', 'schema', id], queryFn: () => api<BaseSchema>(`/base/${id}`), retry: false });
export const useRecords = (tableId?: string | null) =>
  useQuery({ queryKey: ['base', 'records', tableId], queryFn: () => api<BaseRecord[]>(`/base/tables/${tableId}/records`), enabled: !!tableId, staleTime: 30_000 });
export const useTitles = (tableId?: string | null) =>
  useQuery({ queryKey: ['base', 'titles', tableId], queryFn: () => api<{ id: string; title: string }[]>(`/base/tables/${tableId}/titles`), enabled: !!tableId, staleTime: 30_000 });
export const useComments = (recordId?: string | null) =>
  useQuery({ queryKey: ['base', 'comments', recordId], queryFn: () => api<RecordComment[]>(`/base/records/${recordId}/comments`), enabled: !!recordId });

const onError = (e: Error) => toast.error(e.message);

/** Upserts / removes records in the cached list of a table. */
function patchRecords(qc: QueryClient, tableId: string, upserted: BaseRecord[] = [], deleted: string[] = []) {
  qc.setQueryData<BaseRecord[]>(['base', 'records', tableId], (list) => {
    if (!list) return list;
    const gone = new Set(deleted);
    const by = new Map(upserted.map((r) => [r.id, r]));
    const out = list.filter((r) => !gone.has(r.id)).map((r) => (by.has(r.id) ? { ...by.get(r.id)!, commentCount: by.get(r.id)!.commentCount || r.commentCount } : r));
    for (const r of upserted) if (!list.some((x) => x.id === r.id)) out.push(r);
    return out.sort((a, b) => (a.position < b.position ? -1 : a.position > b.position ? 1 : 0));
  });
}

/** Keeps the base live while it is open: tells the server we watch it and applies its changes. */
export function useBaseLive(baseId: string) {
  const qc = useQueryClient();
  useEffect(() => {
    const watch = () => sendRealtime({ type: 'base.watch', baseId });
    // The socket may still be connecting when the page opens.
    const early = [setTimeout(watch, 300), setTimeout(watch, 2000)];
    const beat = setInterval(watch, 25_000);
    return () => {
      early.forEach(clearTimeout);
      clearInterval(beat);
      sendRealtime({ type: 'base.unwatch', baseId });
    };
  }, [baseId]);
  useRealtime((e) => {
    if (e.type !== 'base.changed' || e.baseId !== baseId) return;
    const c = e.change as BaseChange | { kind: 'records'; tableId: string; upserted?: BaseRecord[]; deleted?: string[] };
    if (c.kind === 'schema') void qc.invalidateQueries({ queryKey: ['base', 'schema', baseId] });
    else if (c.kind === 'records') {
      if (c.upserted || c.deleted) patchRecords(qc, c.tableId, c.upserted, c.deleted);
      else void qc.invalidateQueries({ queryKey: ['base', 'records', c.tableId] });
      void qc.invalidateQueries({ queryKey: ['base', 'titles', c.tableId] });
    } else if (c.kind === 'comments') {
      void qc.invalidateQueries({ queryKey: ['base', 'comments', c.recordId] });
      if ('tableId' in c && c.tableId) void qc.invalidateQueries({ queryKey: ['base', 'records', c.tableId] });
    }
  });
}

/** Cell context for a table: people, linked titles, the browser's time zone. */
export function useCellContext(fields: BaseField[]): CellContext & { users: UserSummary[] } {
  const { data: users } = useUsers();
  const linked = [...new Set(fields.filter((f) => f.type === 'link' && f.options.tableId).map((f) => f.options.tableId!))];
  const titles = useQueries({
    queries: linked.map((id) => ({ queryKey: ['base', 'titles', id], queryFn: () => api<{ id: string; title: string }[]>(`/base/tables/${id}/titles`), staleTime: 30_000 })),
  });
  const stamp = titles.map((t) => t.dataUpdatedAt).join();
  return useMemo(() => {
    const by = new Map(linked.map((id, i) => [id, new Map((titles[i]?.data ?? []).map((x) => [x.id, x.title]))]));
    return {
      fields,
      users: users ?? [],
      people: new Map((users ?? []).map((u) => [u.id, { name: u.name, email: u.email }])),
      linkTitle: (tid, rid) => by.get(tid)?.get(rid),
      findLinked: (tid, title) => [...(by.get(tid) ?? [])].find(([, t]) => t.toLowerCase() === title.trim().toLowerCase())?.[0],
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    };
  }, [fields, users, stamp, linked.join()]); // eslint-disable-line react-hooks/exhaustive-deps
}

export function useBaseActions(baseId: string) {
  const qc = useQueryClient();
  const schema = () => qc.invalidateQueries({ queryKey: ['base', 'schema', baseId] });
  const records = (tableId: string) => qc.invalidateQueries({ queryKey: ['base', 'records', tableId] });
  return {
    createTable: useMutation({ mutationFn: (name?: string) => api<{ id: string }>(`/base/${baseId}/tables`, { method: 'POST', json: { name } }), onSuccess: schema, onError }),
    updateTable: useMutation({ mutationFn: ({ id, ...b }: { id: string; name?: string; position?: number }) => api(`/base/tables/${id}`, { method: 'PATCH', json: b }), onSuccess: schema, onError }),
    deleteTable: useMutation({ mutationFn: (id: string) => api(`/base/tables/${id}`, { method: 'DELETE' }), onSuccess: schema, onError }),
    importCsv: useMutation({ mutationFn: (b: { name?: string; csv: string }) => api<{ tableId: string; records: number }>(`/base/${baseId}/import`, { method: 'POST', json: b }), onSuccess: schema, onError }),
    appendCsv: useMutation({
      mutationFn: ({ tableId, csv }: { tableId: string; csv: string }) => api<{ added: number; skipped: string[] }>(`/base/tables/${tableId}/csv`, { method: 'POST', json: { csv } }),
      onSuccess: (_d, v) => void records(v.tableId),
      onError,
    }),
    createField: useMutation({
      mutationFn: ({ tableId, ...b }: { tableId: string; name?: string; type: FieldType; options?: FieldOptions; description?: string | null; afterFieldId?: string | null }) => api<BaseField>(`/base/tables/${tableId}/fields`, { method: 'POST', json: b }),
      onSuccess: schema,
      onError,
    }),
    updateField: useMutation({
      mutationFn: ({ id, ...b }: { id: string; name?: string; type?: FieldType; options?: FieldOptions; description?: string | null }) => api<BaseField>(`/base/fields/${id}`, { method: 'PATCH', json: b }),
      onSuccess: (f) => (void schema(), void records(f.tableId)),
      onError,
    }),
    deleteField: useMutation({ mutationFn: (id: string) => api(`/base/fields/${id}`, { method: 'DELETE' }), onSuccess: schema, onError }),
    createView: useMutation({ mutationFn: ({ tableId, ...b }: { tableId: string; type: ViewType; name?: string; config?: Partial<ViewConfig> }) => api<BaseView>(`/base/tables/${tableId}/views`, { method: 'POST', json: b }), onSuccess: schema, onError }),
    updateView: useMutation({
      mutationKey: ['base', 'view'],
      mutationFn: ({ id, ...b }: { id: string; name?: string; config?: Partial<ViewConfig>; position?: number }) => api<BaseView>(`/base/views/${id}`, { method: 'PATCH', json: b }),
      // The view changes at once (filters, widths…); the server's cleaned config replaces it.
      onMutate: ({ id, name, config }) =>
        qc.setQueryData<BaseSchema>(['base', 'schema', baseId], (s) =>
          s && { ...s, tables: s.tables.map((t) => ({ ...t, views: t.views.map((v) => (v.id === id ? { ...v, name: name ?? v.name, config: { ...v.config, ...config } } : v)) })) },
        ),
      // Quick successive changes: only the last answer is applied, so an early one cannot undo a later change.
      onSuccess: (v) => {
        if (qc.isMutating({ mutationKey: ['base', 'view'] }) > 1) return;
        qc.setQueryData<BaseSchema>(['base', 'schema', baseId], (s) => s && { ...s, tables: s.tables.map((t) => ({ ...t, views: t.views.map((x) => (x.id === v.id ? v : x)) })) });
      },
      onError: (e: Error) => (onError(e), void schema()),
    }),
    deleteView: useMutation({ mutationFn: (id: string) => api(`/base/views/${id}`, { method: 'DELETE' }), onSuccess: schema, onError }),
    createRecords: useMutation({
      mutationFn: ({ tableId, records: rs }: { tableId: string; records: { values?: Record<string, unknown>; afterId?: string | null }[] }) => api<BaseRecord[]>(`/base/tables/${tableId}/records`, { method: 'POST', json: { records: rs } }),
      onSuccess: (rs, v) => patchRecords(qc, v.tableId, rs),
      onError,
    }),
    /** Cell edits: shown at once (coerced the way the server will), then the server's records replace them. */
    updateRecords: useMutation({
      mutationKey: ['base', 'update'],
      mutationFn: ({ records: rs }: { tableId: string; records: { id: string; values: Record<string, unknown> }[]; ctx?: CellContext }) => api<BaseRecord[]>('/base/records', { method: 'PATCH', json: { records: rs } }),
      onMutate: ({ tableId, records: rs, ctx }) => {
        if (!ctx) return;
        const list = qc.getQueryData<BaseRecord[]>(['base', 'records', tableId]);
        if (!list) return;
        const next = rs.flatMap((p) => {
          const r = list.find((x) => x.id === p.id);
          if (!r) return [];
          const values = { ...r.values };
          for (const [k, raw] of Object.entries(p.values)) {
            const f = ctx.fields.find((x) => x.id === k);
            if (!f) continue;
            const v = coerceValue(f, raw, ctx);
            if (v === null || v === undefined || (Array.isArray(v) && !v.length)) {
              // An unknown option name is added by the server: keep the old value until it answers.
              if ((f.type === 'singleSelect' || f.type === 'multiSelect') && raw) continue;
              delete values[k];
            } else values[k] = v;
          }
          return [{ ...r, values }];
        });
        patchRecords(qc, tableId, next);
      },
      onSuccess: (rs, v) => patchRecords(qc, v.tableId, rs),
      onError: (e: Error, v) => (onError(e), void records(v.tableId)),
    }),
    moveRecord: useMutation({
      mutationFn: ({ id, ...b }: { tableId: string; id: string; afterId?: string | null; beforeId?: string | null }) => api<BaseRecord>(`/base/records/${id}/move`, { method: 'POST', json: { afterId: b.afterId, beforeId: b.beforeId } }),
      onSuccess: (r, v) => patchRecords(qc, v.tableId, [r]),
      onError,
    }),
    deleteRecords: useMutation({
      mutationFn: ({ ids }: { tableId: string; ids: string[] }) => api('/base/records/delete', { method: 'POST', json: { ids } }),
      onMutate: ({ tableId, ids }) => patchRecords(qc, tableId, [], ids),
      onError: (e: Error, v) => (onError(e), void records(v.tableId)),
    }),
    comment: useMutation({
      mutationFn: ({ recordId, body }: { tableId: string; recordId: string; body: string }) => api<RecordComment[]>(`/base/records/${recordId}/comments`, { method: 'POST', json: { body } }),
      onSuccess: (list, v) => (qc.setQueryData(['base', 'comments', v.recordId], list), void records(v.tableId)),
      onError,
    }),
    deleteComment: useMutation({
      mutationFn: ({ id }: { id: string; recordId: string; tableId: string }) => api(`/base/comments/${id}`, { method: 'DELETE' }),
      onSuccess: (_d, v) => (void qc.invalidateQueries({ queryKey: ['base', 'comments', v.recordId] }), void records(v.tableId)),
      onError,
    }),
  };
}

export async function uploadAttachment(baseId: string, file: File) {
  const fd = new FormData();
  fd.append('file', file);
  return uploadFile<Attachment>(`/base/${baseId}/attachments`, fd);
}
export const attachmentUrl = (baseId: string, a: Attachment) => `/api/resources/${baseId}/assets/${a.id}`;
