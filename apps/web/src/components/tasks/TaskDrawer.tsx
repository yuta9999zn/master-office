'use client';

import type { TaskEventView, UserSummary } from '@workos/shared';
import { CalendarDays, Flag, MessageSquare, Tag, Trash2, UserRound, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { timeAgo } from '@/lib/format';
import { useUsers } from '@/lib/queries';
import { PRIORITY, shortDate, useTask, useTaskActions } from '@/lib/tasks';
import { Avatar, Button, cn, EmptyState, IconButton, Skeleton } from '../ui/primitives';

const FIELD: Record<string, string> = { title: 'title', description: 'description', status: 'status', priority: 'priority', assigneeId: 'assignee', tags: 'tags', startDate: 'start date', dueDate: 'due date', progress: 'progress' };

/** The task beside the board: every field editable in place, subtasks, comments and the activity trail. */
export function TaskDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const { data: t, error } = useTask(id);
  const { data: users } = useUsers();
  const { update, create, remove, comment } = useTaskActions();
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [tag, setTag] = useState('');
  const [sub, setSub] = useState('');
  const [note, setNote] = useState('');
  useEffect(() => {
    if (t) {
      setTitle(t.title);
      setDesc(t.description ?? '');
    }
  }, [t?.id, t?.title, t?.description]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <Shell onClose={onClose}><EmptyState title="Task not found">{(error as Error).message}</EmptyState></Shell>;
  if (!t) return <Shell onClose={onClose}><Skeleton className="m-5 h-60" /></Shell>;
  const set = (patch: Parameters<typeof update.mutate>[0] extends infer P ? Omit<P, 'id'> : never) => update.mutate({ id: t.id, ...patch });
  const ro = !t.canEdit;
  const people = new Map((users ?? []).map((u) => [u.id, u]));
  const status = t.statuses.find((s) => s.id === t.status);
  const field = 'h-8 w-full min-w-0 rounded-md border border-line-strong bg-surface px-2 text-[13px] text-ink outline-none focus:border-brand-500 disabled:bg-canvas';

  return (
    <Shell onClose={onClose} onDelete={ro ? undefined : () => remove.mutate(t.id, { onSuccess: onClose })} refText={t.ref}>
      <div className="px-5 pb-6" data-testid="task-drawer">
        <textarea
          value={title}
          disabled={ro}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => title.trim() && title !== t.title && set({ title })}
          rows={1}
          aria-label="Task title"
          className="w-full resize-none bg-transparent text-[19px] font-semibold leading-snug text-ink outline-none"
        />
        <div className="mt-3 grid grid-cols-[110px_minmax(0,1fr)] items-center gap-y-2.5 text-[13px]">
          <span className="text-muted">Status</span>
          <select value={t.status} disabled={ro} onChange={(e) => set({ status: e.target.value })} className={field} aria-label="Status" style={{ color: status?.color }}>
            {t.statuses.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <span className="flex items-center gap-1.5 text-muted">
            <UserRound size={13} /> Assignee
          </span>
          <select value={t.assignee?.id ?? ''} disabled={ro} onChange={(e) => set({ assigneeId: e.target.value || null })} className={field} aria-label="Assignee">
            <option value="">Unassigned</option>
            {(users ?? []).map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
          <span className="flex items-center gap-1.5 text-muted">
            <Flag size={13} /> Priority
          </span>
          <select value={t.priority} disabled={ro} onChange={(e) => set({ priority: e.target.value as never })} className={field} aria-label="Priority">
            {Object.entries(PRIORITY).map(([k, p]) => (
              <option key={k} value={k}>
                {p.label}
              </option>
            ))}
          </select>
          <span className="flex items-center gap-1.5 text-muted">
            <CalendarDays size={13} /> Dates
          </span>
          <span className="flex min-w-0 items-center gap-1.5">
            <input type="date" value={t.startDate ?? ''} disabled={ro} onChange={(e) => set({ startDate: e.target.value || null })} className={field} aria-label="Start date" />
            <span className="text-muted">→</span>
            <input type="date" value={t.dueDate ?? ''} disabled={ro} onChange={(e) => set({ dueDate: e.target.value || null })} className={field} aria-label="Due date" />
          </span>
          <span className="flex items-center gap-1.5 text-muted">
            <Tag size={13} /> Tags
          </span>
          <span className="flex flex-wrap items-center gap-1">
            {t.tags.map((x) => (
              <span key={x} className="inline-flex h-6 items-center gap-1 rounded-full bg-brand-50 px-2 text-[12px] text-brand-700">
                {x}
                {!ro && (
                  <button onClick={() => set({ tags: t.tags.filter((y) => y !== x) })} aria-label={`Remove ${x}`}>
                    <X size={11} />
                  </button>
                )}
              </span>
            ))}
            {!ro && (
              <input
                value={tag}
                onChange={(e) => setTag(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && tag.trim()) {
                    set({ tags: [...t.tags, tag.trim()] });
                    setTag('');
                  }
                }}
                placeholder="Add tag"
                aria-label="Add tag"
                className="h-6 w-24 bg-transparent text-[12px] outline-none"
              />
            )}
          </span>
          <span className="text-muted">Progress</span>
          <span className="flex items-center gap-2">
            {t.subtasks.total || ro ? (
              <span className="h-2 flex-1 rounded-full bg-hover">
                <span className="block h-2 rounded-full bg-brand-600" style={{ width: `${t.progress}%` }} />
              </span>
            ) : (
              <input type="range" min={0} max={100} step={5} defaultValue={t.progress} onMouseUp={(e) => set({ progress: Number((e.target as HTMLInputElement).value) })} className="flex-1 accent-brand-600" aria-label="Progress" />
            )}
            <span className="w-10 text-right text-[12px] text-muted">{t.progress}%</span>
          </span>
        </div>
        <textarea value={desc} disabled={ro} onChange={(e) => setDesc(e.target.value)} onBlur={() => desc !== (t.description ?? '') && set({ description: desc })} rows={4} placeholder="Add a description" aria-label="Description" className="mt-4 w-full resize-none rounded-lg border border-line px-3 py-2 text-[13.5px] leading-relaxed outline-none focus:border-brand-500" />

        {!t.parentId && (
          <section className="mt-4">
            <div className="text-[13px] font-semibold text-ink">
              Subtasks {t.children.length ? `· ${t.children.filter((c) => c.completedAt).length}/${t.children.length}` : ''}
            </div>
            <ul className="mt-1.5 space-y-1" data-testid="subtasks">
              {t.children.map((c) => (
                <li key={c.id} className="flex items-center gap-2 rounded-md px-1 py-1 hover:bg-hover">
                  <input type="checkbox" checked={!!c.completedAt} disabled={!c.canEdit} onChange={(e) => update.mutate({ id: c.id, status: e.target.checked ? t.statuses.find((s) => s.category === 'done')!.id : t.statuses[0].id })} className="accent-brand-600" aria-label={c.title} />
                  <span className={cn('flex-1 text-[13px]', c.completedAt && 'text-muted line-through')}>{c.title}</span>
                  {c.assignee && <Avatar user={c.assignee} size={20} />}
                </li>
              ))}
            </ul>
            {!ro && (
              <input
                value={sub}
                onChange={(e) => setSub(e.target.value)}
                onKeyDown={async (e) => {
                  if (e.key === 'Enter' && sub.trim()) {
                    await create.mutateAsync({ parentId: t.id, title: sub.trim() });
                    setSub('');
                  }
                }}
                placeholder="+ Add subtask"
                aria-label="Add subtask"
                className="mt-1 h-8 w-full rounded-md px-2 text-[13px] outline-none hover:bg-hover focus:bg-hover"
              />
            )}
          </section>
        )}

        <section className="mt-5">
          <div className="flex items-center gap-1.5 text-[13px] font-semibold text-ink">
            <MessageSquare size={14} /> Activity
          </div>
          <ul className="mt-2 space-y-3" data-testid="task-activity">
            {t.events.map((e) => (
              <ActivityItem key={e.id} e={e} people={people} statuses={t.statuses} />
            ))}
          </ul>
          <div className="mt-3 flex gap-2">
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Write a comment" aria-label="Comment" className="flex-1 resize-none rounded-lg border border-line-strong px-2.5 py-1.5 text-[13px] outline-none focus:border-brand-500" />
            <Button variant="primary" size="sm" disabled={!note.trim()} onClick={async () => (await comment.mutateAsync({ id: t.id, body: note }), setNote(''))} data-testid="task-comment">
              Send
            </Button>
          </div>
        </section>
      </div>
    </Shell>
  );
}

function Shell({ onClose, onDelete, refText, children }: { onClose: () => void; onDelete?: () => void; refText?: string | null; children: React.ReactNode }) {
  return (
    <aside className="flex w-[420px] shrink-0 flex-col overflow-y-auto border-l border-line bg-surface">
      <div className="flex items-center gap-1 px-4 py-2.5">
        <span className="flex-1 font-mono text-[12px] text-muted">{refText ?? 'Personal task'}</span>
        {onDelete && (
          <IconButton label="Delete task" onClick={onDelete}>
            <Trash2 size={16} />
          </IconButton>
        )}
        <IconButton label="Close" onClick={onClose}>
          <X size={16} />
        </IconButton>
      </div>
      {children}
    </aside>
  );
}

function ActivityItem({ e, people, statuses }: { e: TaskEventView; people: Map<string, UserSummary>; statuses: { id: string; name: string }[] }) {
  const who = e.actor?.name ?? 'Someone';
  const show = (k: string, v: unknown) => {
    if (v === null || v === undefined || v === '') return 'none';
    if (k === 'status') return statuses.find((s) => s.id === v)?.name ?? String(v);
    if (k === 'assigneeId') return people.get(String(v))?.name ?? 'someone';
    if (k === 'startDate' || k === 'dueDate') return shortDate(String(v));
    if (k === 'priority') return PRIORITY[String(v)]?.label ?? String(v);
    if (k === 'progress') return `${v}%`;
    if (Array.isArray(v)) return v.join(', ') || 'none';
    return String(v).slice(0, 60);
  };
  return (
    <li className="flex gap-2.5 text-[13px]">
      {e.actor ? <Avatar user={e.actor} size={24} /> : <span className="size-6 rounded-full bg-hover" />}
      <span className="min-w-0 flex-1">
        {e.kind === 'comment' ? (
          <>
            <span className="font-medium text-ink">{who}</span> <span className="text-[11.5px] text-subtle">{timeAgo(e.createdAt)}</span>
            <span className="mt-0.5 block whitespace-pre-wrap rounded-lg bg-canvas px-2.5 py-1.5 text-ink-2">{e.body}</span>
          </>
        ) : (
          <span className="text-muted">
            <span className="font-medium text-ink-2">{who}</span>{' '}
            {e.data.created
              ? 'created the task'
              : Object.entries(e.data)
                  .map(([k, v]) => `changed ${FIELD[k] ?? k} to ${show(k, (v as unknown[])[1])}`)
                  .join(', ')}{' '}
            · {timeAgo(e.createdAt)}
          </span>
        )}
      </span>
    </li>
  );
}
