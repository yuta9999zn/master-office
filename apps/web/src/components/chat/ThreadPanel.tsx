'use client';

import type { ConversationDetail } from '@workos/shared';
import { X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useThread } from '@/lib/chat';
import { useMe, useUsers } from '@/lib/queries';
import { sendRealtime, useTyping } from '@/lib/realtime';
import { EmptyState, Skeleton } from '../ui/primitives';
import { useSendFlow } from './attachments';
import { Composer } from './Composer';
import { TypingLine } from './ConversationView';
import { MessageItem } from './MessageItem';

/** A message and its replies, beside the conversation (Slack-style threads). */
export function ThreadPanel({ conv, rootId, onClose }: { conv: ConversationDetail; rootId: string; onClose: () => void }) {
  const { data, error } = useThread(rootId);
  const { data: me } = useMe();
  const { data: users } = useUsers();
  const { send, dialog } = useSendFlow(conv.id, me?.user);
  const people = useMemo(() => new Map((users ?? []).map((u) => [u.id, u])), [users]);
  const candidates = useMemo(() => conv.members.filter((m) => m.id !== me?.user.id), [conv.members, me?.user.id]);
  const typing = useTyping(conv.id, rootId);
  const [editing, setEditing] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const count = data?.replies.length ?? 0;
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [count]);
  const canModerate = conv.perms.moderate;

  return (
    <aside className="flex w-[400px] shrink-0 flex-col border-l border-line bg-surface" data-testid="thread-panel">
      <div className="flex h-[68px] shrink-0 items-center justify-between border-b border-line px-5">
        <div>
          <div className="text-[15px] font-semibold text-ink">Thread</div>
          <div className="text-[12px] text-muted">{conv.kind === 'channel' ? `#${conv.title}` : conv.title}</div>
        </div>
        <button onClick={onClose} className="rounded-md p-1.5 text-muted hover:bg-hover" aria-label="Close thread">
          <X size={16} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pb-3">
        {error ? (
          <EmptyState title="Thread not found">{(error as Error).message}</EmptyState>
        ) : !data ? (
          <div className="space-y-3 p-5">
            <Skeleton className="h-14 w-3/4" />
            <Skeleton className="h-10 w-1/2" />
          </div>
        ) : (
          <>
            <MessageItem m={data.root} me={me?.user.id} spaceId={conv.spaceId} people={people} candidates={candidates} grouped={false} canModerate={canModerate} canReact={conv.perms.react} canPin={conv.kind !== 'channel' || conv.perms.moderate} inThread editing={editing === data.root.id} setEditing={(v) => setEditing(v ? data.root.id : null)} />
            <div className="my-3 flex items-center gap-3 px-5 text-[12px] text-muted">
              <span>
                {count} {count === 1 ? 'reply' : 'replies'}
              </span>
              <span className="h-px flex-1 bg-line" />
            </div>
            {data.replies.map((m, i) => {
              const prev = data.replies[i - 1];
              const grouped = !!prev && prev.sender?.id === m.sender?.id && new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() < 5 * 60_000;
              return (
                <MessageItem key={m.id} m={m} me={me?.user.id} spaceId={conv.spaceId} people={people} candidates={candidates} grouped={grouped} canModerate={canModerate} canReact={conv.perms.react} canPin={conv.kind !== 'channel' || conv.perms.moderate} inThread editing={editing === m.id} setEditing={(v) => setEditing(v ? m.id : null)} />
              );
            })}
            <div ref={end} />
          </>
        )}
      </div>
      <TypingLine names={typing} />
      {conv.joined && conv.perms.post && data && !data.root.deletedAt && (
        <div className="px-4 pb-4">
          <Composer
            key={rootId}
            placeholder="Reply…"
            people={people}
            candidates={candidates}
            compact
            autoFocus
            testId="thread-composer"
            onTyping={() => sendRealtime({ type: 'typing', conversationId: conv.id, threadRootId: rootId })}
            allowFiles={conv.perms.attach}
            conversationId={conv.id}
            onSubmit={(body, files, { uploadsOnly }) => send({ body, threadRootId: rootId, resourceIds: files.map((f) => f.id), preview: files, ...(uploadsOnly ? { grant: 'none' as const } : {}) })}
          />
        </div>
      )}
      {dialog}
    </aside>
  );
}
