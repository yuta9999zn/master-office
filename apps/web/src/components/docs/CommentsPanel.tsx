'use client';

import type { Editor } from '@tiptap/react';
import type { CommentAnchor, CommentThread, Me } from '@workos/shared';
import { can } from '@workos/shared';
import { Check, MessageSquareText, MoreHorizontal, RotateCcw, Send, Trash2 } from 'lucide-react';
import { DropdownMenu as DM } from 'radix-ui';
import { useEffect, useRef, useState } from 'react';
import { formatShort } from '@/lib/format';
import { useCommentActions } from '@/lib/queries';
import { Avatar, Button, cn, EmptyState } from '../ui/primitives';
import { resolveAnchor } from './comment-anchors';

export interface Draft {
  anchor: CommentAnchor;
  quote: string;
}

/** Highlights @Name mentions in comment text. */
function Body({ text }: { text: string }) {
  const parts = text.split(/(@[\p{L}][\p{L}\s]*?(?=\s|$|[,.!?]))/u);
  return (
    <p className="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-ink-2">
      {parts.map((p, i) => (p.startsWith('@') ? <span key={i} className="font-medium text-brand-600">{p}</span> : p))}
    </p>
  );
}

function Composer({ placeholder, onSubmit, autoFocus, busy }: { placeholder: string; onSubmit: (text: string) => Promise<unknown>; autoFocus?: boolean; busy?: boolean }) {
  const [text, setText] = useState('');
  const submit = async () => {
    if (!text.trim()) return;
    await onSubmit(text.trim());
    setText('');
  };
  return (
    <div className="rounded-lg border border-line-strong bg-surface focus-within:border-brand-600 focus-within:ring-3 focus-within:ring-brand-100">
      <textarea
        autoFocus={autoFocus}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void submit();
        }}
        placeholder={placeholder}
        rows={2}
        className="block w-full resize-none bg-transparent px-2.5 pt-2 text-[13px] outline-none placeholder:text-subtle"
      />
      <div className="flex items-center justify-between px-2 pb-1.5">
        <span className="text-[11px] text-subtle">Ctrl+Enter to send</span>
        <button disabled={!text.trim() || busy} onClick={submit} className="rounded-md p-1 text-brand-600 hover:bg-brand-50 disabled:opacity-30" aria-label="Send">
          <Send size={15} />
        </button>
      </div>
    </div>
  );
}

export function CommentsPanel({
  resourceId,
  threads,
  me,
  role,
  editor,
  draft,
  onDraftDone,
  active,
  setActive,
  onChanged,
}: {
  resourceId: string;
  threads: CommentThread[];
  me: Me['user'];
  role: string | null | undefined;
  editor: Editor | null;
  draft: Draft | null;
  onDraftDone: () => void;
  active: string | null;
  setActive: (id: string | null) => void;
  onChanged: () => void;
}) {
  const [filter, setFilter] = useState<'open' | 'resolved' | 'all'>('open');
  const acts = useCommentActions(resourceId, onChanged);
  const canComment = can(role as never, 'commenter');
  const refs = useRef(new Map<string, HTMLDivElement>());
  const shown = threads.filter((t) => (filter === 'all' ? true : filter === 'open' ? !t.resolvedAt : !!t.resolvedAt));

  useEffect(() => {
    if (active) refs.current.get(active)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [active]);

  const focusThread = (t: CommentThread) => {
    setActive(t.id);
    if (!editor) return;
    const range = resolveAnchor(editor.state, t.anchor);
    if (range) {
      editor.chain().setTextSelection(range).scrollIntoView().run();
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1 px-4 py-2.5">
        {(['open', 'resolved', 'all'] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)} className={cn('rounded-full px-2.5 py-1 text-[12px] font-medium capitalize', filter === f ? 'bg-brand-50 text-brand-600' : 'text-muted hover:bg-hover')}>
            {f} {f === 'open' ? `(${threads.filter((t) => !t.resolvedAt).length})` : ''}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 pb-4">
        {draft && (
          <div className="rounded-xl border border-brand-200 bg-brand-50/50 p-3">
            <div className="mb-2 line-clamp-2 border-l-2 border-amber-400 pl-2 text-[12px] text-muted">“{draft.quote}”</div>
            <Composer
              autoFocus
              busy={acts.create.isPending}
              placeholder="Add a comment… use @ to mention"
              onSubmit={async (body) => {
                const { id } = await acts.create.mutateAsync({ body, anchor: draft.anchor, quote: draft.quote });
                onDraftDone();
                setFilter('open');
                setActive(id);
              }}
            />
            <button onClick={onDraftDone} className="mt-1.5 text-[12px] text-muted hover:text-ink">
              Cancel
            </button>
          </div>
        )}

        {!shown.length && !draft && (
          <EmptyState icon={<MessageSquareText size={28} />} title={filter === 'resolved' ? 'No resolved comments' : 'No comments yet'}>
            {canComment ? 'Select text in the document and click the comment button.' : 'Comments from collaborators will appear here.'}
          </EmptyState>
        )}

        {shown.map((t) => (
          <div
            key={t.id}
            ref={(el) => {
              if (el) refs.current.set(t.id, el);
            }}
            onClick={() => focusThread(t)}
            className={cn('cursor-pointer rounded-xl border p-3 transition', active === t.id ? 'border-brand-600 bg-surface shadow-[var(--shadow-pop)]' : 'border-line bg-surface hover:border-line-strong', t.resolvedAt && 'opacity-70')}
          >
            {t.quote && <div className="mb-2 line-clamp-2 border-l-2 border-amber-400 pl-2 text-[12px] text-muted">“{t.quote}”</div>}
            {[t, ...t.replies].map((c, i) => (
              <div key={c.id} className={cn('flex gap-2.5', i > 0 && 'mt-3')}>
                <Avatar user={c.author} size={28} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-semibold text-ink">{c.author.name.split(' ')[0]}</span>
                    <span className="text-[11px] text-subtle">{formatShort(c.createdAt)}</span>
                    {(c.author.id === me.id || can(role as never, 'admin')) && (
                      <DM.Root>
                        <DM.Trigger asChild>
                          <button onClick={(e) => e.stopPropagation()} className="ml-auto rounded p-0.5 text-subtle hover:bg-hover" aria-label="Comment actions">
                            <MoreHorizontal size={14} />
                          </button>
                        </DM.Trigger>
                        <DM.Portal>
                          <DM.Content align="end" className="pop z-50 animate-pop">
                            <DM.Item className="menu-item text-red-600" onSelect={() => acts.remove.mutate(c.id)}>
                              <Trash2 size={14} /> Delete
                            </DM.Item>
                          </DM.Content>
                        </DM.Portal>
                      </DM.Root>
                    )}
                  </div>
                  <Body text={c.body} />
                </div>
              </div>
            ))}
            {t.resolvedAt && <div className="mt-2 text-[11px] text-muted">Resolved by {t.resolvedBy?.name.split(' ')[0]} · {formatShort(t.resolvedAt)}</div>}
            {canComment && active === t.id && (
              <div className="mt-3 space-y-2" onClick={(e) => e.stopPropagation()}>
                {!t.resolvedAt && <Composer placeholder="Reply…" busy={acts.create.isPending} onSubmit={(body) => acts.create.mutateAsync({ body, threadId: t.id })} />}
                <div className="flex justify-end">
                  <Button size="sm" variant="ghost" icon={t.resolvedAt ? <RotateCcw size={14} /> : <Check size={14} />} onClick={() => acts.update.mutate({ id: t.id, resolved: !t.resolvedAt })}>
                    {t.resolvedAt ? 'Reopen' : 'Resolve'}
                  </Button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
