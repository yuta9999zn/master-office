'use client';

import type { CommentThread, Me } from '@workos/shared';
import { can } from '@workos/shared';
import { Check, MessageSquareText, RotateCcw, Send, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { timeAgo } from '@/lib/format';
import { useCommentActions } from '@/lib/queries';
import { Avatar, Button, cn, EmptyState } from '../ui/primitives';

/** Where a slide comment points: a slide, optionally one object on it. */
export interface SlideAnchor {
  slide: string;
  el?: string | null;
}
export const anchorOf = (t: CommentThread): SlideAnchor | null => {
  const a = t.anchor?.from as SlideAnchor | undefined;
  return a && typeof a.slide === 'string' ? a : null;
};

export function SlideComments({
  resourceId,
  threads,
  me,
  role,
  target,
  targetLabel,
  active,
  setActive,
  slideNumber,
  onGo,
  onChanged,
}: {
  resourceId: string;
  threads: CommentThread[];
  me: Me['user'] | undefined;
  role: string | null | undefined;
  target: SlideAnchor | null;
  targetLabel: string;
  active: string | null;
  setActive: (id: string | null) => void;
  slideNumber: (slideId: string) => number;
  onGo: (a: SlideAnchor) => void;
  onChanged: () => void;
}) {
  const [filter, setFilter] = useState<'open' | 'resolved' | 'all'>('open');
  const [draft, setDraft] = useState('');
  const acts = useCommentActions(resourceId, onChanged);
  const canComment = can(role as never, 'commenter');
  const refs = useRef(new Map<string, HTMLDivElement>());
  const shown = threads.filter((t) => (filter === 'all' ? true : filter === 'open' ? !t.resolvedAt : !!t.resolvedAt));

  useEffect(() => {
    if (active) refs.current.get(active)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [active]);

  return (
    <div className="flex h-full flex-col">
      {canComment && target && (
        <div className="border-b border-line p-3">
          <div className="mb-1.5 truncate text-[12px] text-muted">
            Comment on <b className="text-ink-2">{targetLabel}</b>
          </div>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && draft.trim()) {
                e.preventDefault();
                (e.currentTarget.nextElementSibling?.querySelector('button') as HTMLButtonElement | null)?.click();
              }
            }}
            placeholder="Add a comment… (Ctrl+Enter to post)"
            className="input min-h-16 resize-none py-2 text-[13px]"
            aria-label="New comment"
          />
          <div className="mt-2 flex justify-end">
            <Button
              size="sm"
              variant="primary"
              icon={<Send size={13} />}
              disabled={!draft.trim()}
              loading={acts.create.isPending}
              onClick={async () => {
                const { id } = await acts.create.mutateAsync({ body: draft.trim(), anchor: { from: target, to: null }, quote: targetLabel.slice(0, 200) });
                setDraft('');
                setActive(id);
              }}
            >
              Comment
            </Button>
          </div>
        </div>
      )}
      <div className="flex items-center gap-1 border-b border-line px-3 py-2">
        {(['open', 'resolved', 'all'] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)} className={cn('rounded-md px-2 py-1 text-[12px] capitalize', filter === f ? 'bg-brand-50 font-medium text-brand-700' : 'text-muted hover:bg-hover')}>
            {f}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto p-3">
        {!shown.length && (
          <EmptyState icon={<MessageSquareText size={28} />} title={filter === 'resolved' ? 'No resolved comments' : 'No comments yet'}>
            Select a slide or an object on it and leave a comment.
          </EmptyState>
        )}
        {shown.map((t) => {
          const a = anchorOf(t);
          const n = a ? slideNumber(a.slide) : 0;
          return (
            <Thread
              key={t.id}
              t={t}
              me={me}
              role={role}
              active={active === t.id}
              where={a ? (n > 0 ? `Slide ${n}${a.el ? ' · object' : ''}` : 'Deleted slide') : 'Presentation'}
              refCb={(el) => (el ? refs.current.set(t.id, el) : refs.current.delete(t.id))}
              onClick={() => {
                setActive(t.id);
                if (a && n > 0) onGo(a);
              }}
              acts={acts}
            />
          );
        })}
      </div>
    </div>
  );
}

function Thread({
  t,
  me,
  role,
  active,
  where,
  refCb,
  onClick,
  acts,
}: {
  t: CommentThread;
  me: Me['user'] | undefined;
  role: string | null | undefined;
  active: boolean;
  where: string;
  refCb: (el: HTMLDivElement | null) => void;
  onClick: () => void;
  acts: ReturnType<typeof useCommentActions>;
}) {
  const [reply, setReply] = useState('');
  const canComment = can(role as never, 'commenter');
  const canDelete = (authorId: string) => authorId === me?.id || can(role as never, 'admin');
  return (
    <div ref={refCb} onClick={onClick} className={cn('cursor-pointer rounded-xl border bg-surface p-3 transition', active ? 'border-brand-600 shadow-sm' : 'border-line hover:border-line-strong', t.resolvedAt && 'opacity-70')} data-testid="slide-comment">
      <div className="mb-1 flex items-center gap-1.5 text-[11px] text-muted">
        <span className="rounded bg-amber-50 px-1.5 py-0.5 font-medium text-amber-700">{where}</span>
        {t.quote && <span className="truncate">“{t.quote}”</span>}
      </div>
      {[t, ...t.replies].map((c, i) => (
        <div key={c.id} className={cn('flex gap-2', i && 'mt-2.5 border-t border-line pt-2.5')}>
          <Avatar user={c.author} size={24} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 text-[12px]">
              <b className="text-ink">{c.author.name}</b>
              <span className="text-subtle">{timeAgo(c.createdAt)}</span>
              {canDelete(c.author.id) && (
                <button onClick={(e) => (e.stopPropagation(), acts.remove.mutate(c.id))} className="ml-auto text-subtle hover:text-red-600" aria-label="Delete comment">
                  <Trash2 size={12} />
                </button>
              )}
            </div>
            <p className="whitespace-pre-wrap text-[13px] text-ink-2">{c.body}</p>
          </div>
        </div>
      ))}
      {canComment && (
        <div className="mt-2.5 flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
          {active && !t.resolvedAt && (
            <input
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              onKeyDown={async (e) => {
                if (e.key === 'Enter' && reply.trim()) {
                  await acts.create.mutateAsync({ body: reply.trim(), threadId: t.id });
                  setReply('');
                }
              }}
              placeholder="Reply…"
              className="input h-7 flex-1 text-[12px]"
              aria-label="Reply"
            />
          )}
          <button onClick={() => acts.update.mutate({ id: t.id, resolved: !t.resolvedAt })} className="ml-auto flex items-center gap-1 rounded-md px-1.5 py-1 text-[12px] text-muted hover:bg-hover hover:text-ink">
            {t.resolvedAt ? <RotateCcw size={12} /> : <Check size={12} />}
            {t.resolvedAt ? 'Reopen' : 'Resolve'}
          </button>
        </div>
      )}
    </div>
  );
}
