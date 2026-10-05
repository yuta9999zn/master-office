'use client';

import type { ChannelListing, ChatAttachment, ChatFile, ChatMessage, ConversationDetail, ConversationSummary, RealtimeEvent, Resource, UserSummary } from '@workos/shared';
import { type InfiniteData, type QueryClient, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, ApiError, uploadFile } from './api';

type Page = { messages: ChatMessage[]; hasMore: boolean };
type Pages = InfiniteData<Page, number | undefined>;
type Thread = { root: ChatMessage; replies: ChatMessage[] };

export const chatKeys = {
  list: ['chat', 'conversations'] as const,
  one: (id: string) => ['chat', 'conversation', id] as const,
  messages: (id: string) => ['chat', 'messages', id] as const,
  thread: (mid: string) => ['chat', 'thread', mid] as const,
  channels: (q: string) => ['chat', 'channels', q] as const,
  files: (id: string) => ['chat', 'files', id] as const,
  pins: (id: string) => ['chat', 'pins', id] as const,
};

// ── Queries ──────────────────────────────────────────────────────────────────

export const useConversations = () => useQuery({ queryKey: chatKeys.list, queryFn: () => api<ConversationSummary[]>('/chat/conversations'), staleTime: 30_000 });
export const useConversation = (id?: string | null) =>
  useQuery({ queryKey: chatKeys.one(id ?? ''), queryFn: () => api<ConversationDetail>(`/chat/conversations/${id}`), enabled: !!id, retry: false });
export const useChannels = (q: string, enabled = true) =>
  useQuery({ queryKey: chatKeys.channels(q), queryFn: () => api<ChannelListing[]>(`/chat/channels?q=${encodeURIComponent(q)}`), enabled });

export const useMessages = (id: string) =>
  useInfiniteQuery({
    queryKey: chatKeys.messages(id),
    queryFn: ({ pageParam }) => api<Page>(`/chat/conversations/${id}/messages${pageParam ? `?before=${pageParam}` : ''}`),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (last) => (last.hasMore && last.messages.length ? last.messages[0].seq : undefined),
    staleTime: Infinity,
  });

export const useThread = (mid?: string | null) =>
  useQuery({ queryKey: chatKeys.thread(mid ?? ''), queryFn: () => api<Thread>(`/chat/messages/${mid}/thread`), enabled: !!mid, staleTime: Infinity });

export const useChatSearch = (id: string, q: string) =>
  useQuery({ queryKey: ['chat', 'search', id, q], queryFn: () => api<ChatMessage[]>(`/chat/conversations/${id}/search?q=${encodeURIComponent(q)}`), enabled: q.trim().length > 1 });

export const useChatFiles = (id: string, enabled = true) => useQuery({ queryKey: chatKeys.files(id), queryFn: () => api<ChatFile[]>(`/chat/conversations/${id}/files`), enabled });
export const useChatPins = (id: string, enabled = true) => useQuery({ queryKey: chatKeys.pins(id), queryFn: () => api<ChatMessage[]>(`/chat/conversations/${id}/pins`), enabled });

/** Unread across conversations that are not muted (sidebar badge). */
export function useUnreadTotal() {
  const { data } = useConversations();
  return (data ?? []).filter((c) => !c.muted).reduce((n, c) => n + c.unread, 0);
}

// ── Cache maintenance ────────────────────────────────────────────────────────

/** Reactions arrive with the sender's view; `mine` is recomputed for this viewer. */
export const forViewer = (m: ChatMessage, me: string): ChatMessage => ({ ...m, reactions: m.reactions.map((r) => ({ ...r, mine: r.userIds.includes(me) })) });

function upsertInPages(data: Pages | undefined, msg: ChatMessage, append: boolean): Pages | undefined {
  if (!data) return data;
  let found = false;
  const pages = data.pages.map((p) => ({
    ...p,
    messages: p.messages.map((m) => {
      if (m.id !== msg.id) return m;
      found = true;
      return msg;
    }),
  }));
  if (!found && append && pages.length) {
    const newest = pages[0];
    // Drop the optimistic copy of this message (same body, from the same sender, still pending).
    const msgs = newest.messages.filter((m) => !(m.id.startsWith('tmp-') && m.sender?.id === msg.sender?.id && m.body === msg.body));
    pages[0] = { ...newest, messages: [...msgs, msg].sort((a, b) => a.seq - b.seq) };
  }
  return { ...data, pages };
}

function upsertInThread(data: Thread | undefined, msg: ChatMessage): Thread | undefined {
  if (!data) return data;
  if (data.root.id === msg.id) return { ...data, root: msg };
  if (msg.threadRootId !== data.root.id) return data;
  const replies = data.replies.filter((m) => !(m.id.startsWith('tmp-') && m.sender?.id === msg.sender?.id && m.body === msg.body));
  return replies.some((m) => m.id === msg.id) ? { ...data, replies: replies.map((m) => (m.id === msg.id ? msg : m)) } : { ...data, replies: [...replies, msg] };
}

export function applyChatEvent(qc: QueryClient, e: RealtimeEvent, me: string) {
  switch (e.type) {
    case 'chat.message': {
      const msg = forViewer(e.message, me);
      if (msg.threadRootId) qc.setQueryData<Thread>(chatKeys.thread(msg.threadRootId), (d) => upsertInThread(d, msg));
      else {
        qc.setQueryData<Pages>(chatKeys.messages(e.conversationId), (d) => upsertInPages(d, msg, true));
        refetchIfInFlight(qc, chatKeys.messages(e.conversationId));
      }
      if (!msg.threadRootId) void qc.invalidateQueries({ queryKey: chatKeys.list });
      if (msg.attachments.length) void qc.invalidateQueries({ queryKey: chatKeys.files(e.conversationId) });
      break;
    }
    case 'chat.message.updated': {
      const msg = forViewer(e.message, me);
      qc.setQueryData<Pages>(chatKeys.messages(e.conversationId), (d) => upsertInPages(d, msg, false));
      qc.setQueryData<Thread>(chatKeys.thread(msg.threadRootId ?? msg.id), (d) => upsertInThread(d, msg));
      void qc.invalidateQueries({ queryKey: chatKeys.pins(e.conversationId) });
      if (msg.deletedAt) void qc.invalidateQueries({ queryKey: chatKeys.files(e.conversationId) });
      break;
    }
    case 'chat.read': {
      qc.setQueryData<ConversationDetail>(chatKeys.one(e.conversationId), (d) =>
        d ? { ...d, members: d.members.map((m) => (m.id === e.userId ? { ...m, lastReadSeq: Math.max(m.lastReadSeq, e.seq) } : m)) } : d,
      );
      if (e.userId === me) markReadLocally(qc, e.conversationId, e.seq);
      break;
    }
    case 'chat.conversation': {
      void qc.invalidateQueries({ queryKey: chatKeys.list });
      void qc.invalidateQueries({ queryKey: chatKeys.one(e.conversationId) });
      // System messages (joined, renamed…) were written with the change.
      void qc.invalidateQueries({ queryKey: chatKeys.messages(e.conversationId) });
      void qc.invalidateQueries({ queryKey: ['chat', 'channels'] });
      break;
    }
  }
}

/**
 * A page load that started before this message existed would land afterwards and drop it (first open of a new
 * DM): when the history is still loading — or not loaded at all — fetch it again instead of patching.
 */
function refetchIfInFlight(qc: QueryClient, key: readonly unknown[]) {
  const state = qc.getQueryState(key);
  if (state && (state.fetchStatus === 'fetching' || !state.data)) void qc.invalidateQueries({ queryKey: key, exact: true });
}

function markReadLocally(qc: QueryClient, id: string, seq: number) {
  qc.setQueryData<ConversationSummary[]>(chatKeys.list, (list) =>
    list?.map((c) => (c.id === id && seq >= c.lastReadSeq ? { ...c, lastReadSeq: seq, unread: seq >= c.lastSeq ? 0 : c.unread, mentions: seq >= c.lastSeq ? 0 : c.mentions } : c)),
  );
}

// ── Mutations ────────────────────────────────────────────────────────────────

const onError = (e: Error) => toast.error(e.message);

export function useChatActions() {
  const qc = useQueryClient();
  const refreshList = () => qc.invalidateQueries({ queryKey: chatKeys.list });
  return {
    create: useMutation({
      mutationFn: (input: { kind: 'dm'; userId: string } | { kind: 'group'; name?: string | null; memberIds: string[] } | { kind: 'channel'; name: string; description?: string | null; visibility: 'public' | 'private'; memberIds: string[]; spaceId?: string | null }) =>
        api<{ id: string; created: boolean }>('/chat/conversations', { method: 'POST', json: input }),
      onSuccess: refreshList,
      onError,
    }),
    update: useMutation({
      mutationFn: ({ id, ...input }: { id: string; name?: string | null; description?: string | null; visibility?: 'public' | 'private' }) => api(`/chat/conversations/${id}`, { method: 'PATCH', json: input }),
      onError,
    }),
    addMembers: useMutation({ mutationFn: ({ id, userIds }: { id: string; userIds: string[] }) => api<{ added: number }>(`/chat/conversations/${id}/members`, { method: 'POST', json: { userIds } }), onError }),
    removeMember: useMutation({ mutationFn: ({ id, userId }: { id: string; userId: string }) => api(`/chat/conversations/${id}/members/${userId}`, { method: 'DELETE' }), onSuccess: refreshList, onError }),
    setRole: useMutation({ mutationFn: ({ id, userId, role }: { id: string; userId: string; role: 'admin' | 'member' }) => api(`/chat/conversations/${id}/members/${userId}/role`, { method: 'PUT', json: { role } }), onError }),
    join: useMutation({ mutationFn: (id: string) => api(`/chat/conversations/${id}/join`, { method: 'POST' }), onSuccess: refreshList, onError }),
    prefs: useMutation({
      mutationFn: ({ id, ...input }: { id: string; pinned?: boolean; muted?: boolean }) => api(`/chat/conversations/${id}/prefs`, { method: 'PUT', json: input }),
      onMutate: ({ id, ...input }) => qc.setQueryData<ConversationSummary[]>(chatKeys.list, (l) => l?.map((c) => (c.id === id ? { ...c, ...input } : c))),
      onSettled: refreshList,
      onError,
    }),
    read: useMutation({
      mutationFn: ({ id, seq }: { id: string; seq: number }) => api<{ lastReadSeq: number }>(`/chat/conversations/${id}/read`, { method: 'POST', json: { seq } }),
      onMutate: ({ id, seq }) => markReadLocally(qc, id, seq),
    }),
    edit: useMutation({ mutationFn: ({ id, body }: { id: string; body: string }) => api<ChatMessage>(`/chat/messages/${id}`, { method: 'PATCH', json: { body } }), onError }),
    remove: useMutation({ mutationFn: (id: string) => api(`/chat/messages/${id}`, { method: 'DELETE' }), onError }),
    pin: useMutation({ mutationFn: ({ id, pinned }: { id: string; pinned: boolean }) => api<ChatMessage>(`/chat/messages/${id}/pin`, { method: 'PUT', json: { pinned } }), onError }),
    react: useMutation({ mutationFn: ({ id, emoji }: { id: string; emoji: string }) => api<ChatMessage>(`/chat/messages/${id}/reactions`, { method: 'POST', json: { emoji } }), onError }),
  };
}

export type SendInput = { body: string; threadRootId?: string | null; resourceIds?: string[]; grant?: 'viewer' | 'commenter' | 'editor' | 'none'; preview?: ChatAttachment[] };

/** Uploads files from the computer into the sender's "Chat files" folder; returns the new resources. */
export async function uploadForChat(files: File[]) {
  const { id: parentId } = await api<{ id: string }>('/chat/upload-folder', { method: 'POST' });
  const out: Resource[] = [];
  for (const file of files) {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('parentId', parentId);
    out.push(await uploadFile<Resource>('/resources/upload', fd));
  }
  return out;
}

export const attachmentOf = (r: Pick<Resource, 'id' | 'name' | 'type' | 'mimeType' | 'sizeBytes' | 'metadata'>): ChatAttachment => ({
  id: r.id,
  accessible: true,
  source: 'attachment',
  name: r.name,
  type: r.type,
  mimeType: r.mimeType ?? null,
  sizeBytes: r.sizeBytes ?? null,
  metadata: (r.metadata as Record<string, unknown>) ?? null,
  owner: null,
  updatedAt: null,
  trashed: false,
});

/** 409 from sending: who cannot open which file (the caller asks the sender what to do). */
export const accessProblem = (e: unknown) => (e instanceof ApiError && e.status === 409 && (e.body as { code?: string })?.code === 'needs_access' ? (e.body as import('@workos/shared').ChatAccessProblem) : null);

/**
 * Sends with an optimistic copy (id "tmp-…") that the pushed or returned message replaces.
 */
export function useSendMessage(conversationId: string, me: UserSummary | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ preview: _p, ...input }: SendInput) => api<ChatMessage>(`/chat/conversations/${conversationId}/messages`, { method: 'POST', json: input }),
    onMutate: (input) => {
      if (!me) return;
      const tmp: ChatMessage = {
        id: `tmp-${Math.random().toString(36).slice(2)}`,
        conversationId,
        seq: Number.MAX_SAFE_INTEGER,
        kind: 'text',
        sender: me,
        body: input.body,
        mentions: [],
        threadRootId: input.threadRootId ?? null,
        replyCount: 0,
        lastReplyAt: null,
        repliers: [],
        reactions: [],
        attachments: input.preview ?? [],
        pinnedAt: null,
        pinnedBy: null,
        createdAt: new Date().toISOString(),
        editedAt: null,
        deletedAt: null,
      };
      if (tmp.threadRootId) qc.setQueryData<Thread>(chatKeys.thread(tmp.threadRootId), (d) => (d ? { ...d, replies: [...d.replies, tmp] } : d));
      else qc.setQueryData<Pages>(chatKeys.messages(conversationId), (d) => (d && d.pages.length ? { ...d, pages: [{ ...d.pages[0], messages: [...d.pages[0].messages, tmp] }, ...d.pages.slice(1)] } : d));
      return { tmp: tmp.id };
    },
    onSuccess: (msg, _input, ctx) => {
      const real = forViewer(msg, me?.id ?? '');
      const swap = (list: ChatMessage[]) => (list.some((m) => m.id === real.id) ? list.filter((m) => m.id !== ctx?.tmp) : list.map((m) => (m.id === ctx?.tmp ? real : m)).sort((a, b) => a.seq - b.seq));
      if (real.threadRootId) qc.setQueryData<Thread>(chatKeys.thread(real.threadRootId), (d) => (d ? { ...d, replies: swap(d.replies) } : d));
      else {
        qc.setQueryData<Pages>(chatKeys.messages(conversationId), (d) => (d && d.pages.length ? { ...d, pages: [{ ...d.pages[0], messages: swap(d.pages[0].messages) }, ...d.pages.slice(1)] } : d));
        refetchIfInFlight(qc, chatKeys.messages(conversationId));
      }
      void qc.invalidateQueries({ queryKey: chatKeys.list });
    },
    onError: (e: Error, input, ctx) => {
      // A missing-access question is answered by the caller, not shown as an error.
      if (!accessProblem(e)) toast.error(e.message);
      const drop = (list: ChatMessage[]) => list.filter((m) => m.id !== ctx?.tmp);
      if (input.threadRootId) qc.setQueryData<Thread>(chatKeys.thread(input.threadRootId), (d) => (d ? { ...d, replies: drop(d.replies) } : d));
      else qc.setQueryData<Pages>(chatKeys.messages(conversationId), (d) => (d && d.pages.length ? { ...d, pages: [{ ...d.pages[0], messages: drop(d.pages[0].messages) }, ...d.pages.slice(1)] } : d));
    },
  });
}

// ── Text helpers ─────────────────────────────────────────────────────────────

const TOKEN = /<@([0-9a-f-]{36})>/gi;

/** Stored text → what the composer shows ("@Hana Lee"), plus the names it must turn back into tokens. */
export function tokensToText(body: string, people: Map<string, UserSummary>) {
  const names = new Map<string, string>();
  const text = body.replace(TOKEN, (m, id: string) => {
    const u = people.get(id);
    if (!u) return m;
    names.set(u.name, u.id);
    return `@${u.name}`;
  });
  return { text, names };
}

/** Composer text → stored text: "@Hana Lee" (picked from the list) becomes <@id>. Longest names first. */
export function textToTokens(text: string, names: Map<string, string>) {
  let out = text;
  for (const [name, id] of [...names].sort((a, b) => b[0].length - a[0].length)) out = out.split(`@${name}`).join(`<@${id}>`);
  return out;
}

/** Preview of a conversation's last message: its text, or the files it carries. */
export function lastMessageText(lm: { body: string; files?: number }, people: Map<string, UserSummary>) {
  const text = previewText(lm.body, people);
  if (text || !lm.files) return text;
  return lm.files === 1 ? '📎 File' : `📎 ${lm.files} files`;
}

/** One-line preview for lists ("Hana: File đã gửi nhé"), with mentions as names and Markdown marks removed. */
export function previewText(body: string, people: Map<string, UserSummary>) {
  return body
    .replace(TOKEN, (_m, id: string) => `@${people.get(id)?.name ?? 'someone'}`)
    .replace(/```[\s\S]*?```/g, '[code]')
    .replace(/(\*\*|__|~~|`)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
