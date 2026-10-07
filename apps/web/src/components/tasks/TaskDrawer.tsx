'use client';

import { canTransition, childTypeOf, ISSUE_RANK, WORK_TYPES, type IssueLinkKind, type IssueType, type TaskEventView, type UserSummary } from '@workos/shared';
import { ArrowRight, Ban, BookOpen, Bug, CalendarDays, Lock, ChevronRight, Clock, Eye, EyeOff, Flag, Gauge, Inbox, Link2, MessageSquare, MessagesSquare, Split, Tag, Trash2, UserRound, X } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { timeAgo } from '@/lib/format';
import { useUsers } from '@/lib/queries';
import { LINK_LABEL, PRIORITY, shortDate, useProjectDocActions, useProjectDocs, useProjects, useTask, useTaskActions, useTasks } from '@/lib/tasks';
import { Avatar, AvatarStack, Button, cn, Dialog, EmptyState, FileIcon, IconButton, Skeleton } from '../ui/primitives';
import { IssueIcon, ISSUE_META, Points } from './issue-bits';

const FIELD: Record<string, string> = {
  title: 'title',
  description: 'description',
  status: 'status',
  priority: 'priority',
  assigneeId: 'assignee',
  reporterId: 'reporter',
  tags: 'tags',
  startDate: 'start date',
  dueDate: 'due date',
  progress: 'progress',
  storyPoints: 'story points',
  estimateMinutes: 'estimate',
  parentId: 'parent',
  type: 'type',
};

/** The issue beside the board: every field editable in place, hierarchy, children, links, watchers, comments, activity. */
export function TaskDrawer({ id, onClose, onOpen }: { id: string; onClose: () => void; onOpen?: (id: string) => void }) {
  const { data: t, error } = useTask(id);
  const { data: users } = useUsers();
  const { data: siblings } = useTasks(t?.projectId ?? null);
  const { update, create, remove, comment, decline, breakdown, link, unlink, watch, logBug } = useTaskActions();
  const { data: projects } = useProjects();
  const { data: projectDocs } = useProjectDocs(t?.projectId ?? null);
  const docActions = useProjectDocActions();
  const [linkingDoc, setLinkingDoc] = useState(false);
  const [docQ, setDocQ] = useState('');
  const [bugging, setBugging] = useState(false);
  const [bugTitle, setBugTitle] = useState('');
  const [bugDesc, setBugDesc] = useState('');
  const [bugWho, setBugWho] = useState('');
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [tag, setTag] = useState('');
  const [sub, setSub] = useState('');
  const [note, setNote] = useState('');
  const [splitting, setSplitting] = useState(false);
  const [lines, setLines] = useState('');
  const [linking, setLinking] = useState(false);
  const [linkKind, setLinkKind] = useState<IssueLinkKind>('blocks');
  const [linkQ, setLinkQ] = useState('');
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState('');
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
  const inProject = !!t.projectId;
  // Workflow (§76): where this issue may go next; a strict workflow only offers those.
  const strict = !!projects?.find((p) => p.id === t.projectId)?.strictWorkflow;
  const nextSteps = (status?.next ?? []).map((id) => t.statuses.find((s) => s.id === id)).filter((x): x is NonNullable<typeof x> => !!x);
  const statusChoices = strict ? t.statuses.filter((s) => canTransition(t.statuses, t.status, s.id)) : t.statuses;
  const childType: IssueType = childTypeOf(t.type);
  const containers = ISSUE_RANK[t.type] < 2;
  const childLabel = t.type === 'phase' ? 'Issues in this phase' : t.type === 'epic' ? 'Issues in this epic' : 'Subtasks';
  // Types this issue may become (below its parent, above its children).
  const parentRank = t.ancestors.length ? ISSUE_RANK[t.ancestors[t.ancestors.length - 1].type] : -1;
  const childRank = Math.min(4, ...t.children.map((c) => ISSUE_RANK[c.type]));
  const typeChoices = (Object.keys(ISSUE_META) as IssueType[]).filter((x) => ISSUE_RANK[x] > parentRank && ISSUE_RANK[x] < childRank && (x !== 'subtask' || parentRank === 2) && (inProject || x === 'task' || x === 'subtask'));
  // Parents it can move under.
  const parentChoices = (siblings ?? []).filter((x) => x.id !== t.id && !x.triage && ISSUE_RANK[x.type] < ISSUE_RANK[t.type] && (t.type === 'subtask' ? ISSUE_RANK[x.type] === 2 : ISSUE_RANK[x.type] < 2));
  const linkCandidates = (siblings ?? []).filter((x) => x.id !== t.id && !x.triage && (!linkQ.trim() || x.title.toLowerCase().includes(linkQ.toLowerCase()) || x.ref?.toLowerCase().includes(linkQ.toLowerCase()))).slice(0, 8);

  return (
    <Shell onClose={onClose} onDelete={ro ? undefined : () => remove.mutate(t.id, { onSuccess: onClose })} refText={t.ref} type={t.type} watching={t.watching} watchers={t.watchers} onWatch={() => watch.mutate({ id: t.id, on: !t.watching })}>
      <div className="px-5 pb-6" data-testid="task-drawer">
        {t.ancestors.length > 0 && (
          <nav className="mb-1.5 flex flex-wrap items-center gap-1 text-[12px] text-muted" data-testid="ancestors">
            {t.ancestors.map((a) => (
              <span key={a.id} className="flex items-center gap-1">
                <button onClick={() => onOpen?.(a.id)} className="flex items-center gap-1 hover:text-ink hover:underline">
                  <IssueIcon type={a.type} size={13} /> {a.title}
                </button>
                <ChevronRight size={12} />
              </span>
            ))}
          </nav>
        )}
        {t.triage && (
          <div className="mb-3 flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900 ring-1 ring-amber-200" data-testid="triage-banner">
            <Inbox size={15} />
            <span className="flex-1">Request from {t.reporter?.name ?? 'someone'} — waiting in the intake queue.</span>
            {!ro && (
              <>
                <Button size="sm" variant="ghost" onClick={() => setDeclining(true)}>
                  Decline
                </Button>
                <Button size="sm" variant="primary" onClick={() => set({ triage: false })} data-testid="drawer-accept">
                  Accept
                </Button>
              </>
            )}
          </div>
        )}
        {t.resolution === 'declined' && <p className="mb-2 rounded-lg bg-hover px-3 py-1.5 text-[12.5px] text-muted">Declined request</p>}
        <textarea
          value={title}
          disabled={ro}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => title.trim() && title !== t.title && set({ title })}
          rows={1}
          aria-label="Task title"
          className="w-full resize-none bg-transparent text-[19px] font-semibold leading-snug text-ink outline-none"
        />
        {!ro && inProject && ISSUE_RANK[t.type] >= 2 && t.type !== 'bug' && (
          <button onClick={() => (setBugging(true), setBugTitle(''), setBugDesc(''), setBugWho(''))} className="mt-1 mr-3 inline-flex items-center gap-1 text-[12px] font-medium text-red-600 hover:underline" data-testid="log-bug">
            <Bug size={13} /> Log bug
          </button>
        )}
        {t.source && (
          <Link href={`/chat/${t.source.conversationId}?thread=${t.source.messageId}`} className="mt-1 inline-flex items-center gap-1 text-[12px] text-brand-700 hover:underline" data-testid="from-chat">
            <MessagesSquare size={13} /> From a chat message
          </Link>
        )}
        <div className="mt-3 grid grid-cols-[110px_minmax(0,1fr)] items-center gap-y-2.5 text-[13px]">
          {inProject && (
            <>
              <span className="text-muted">Type</span>
              <select value={t.type} disabled={ro || typeChoices.length < 2} onChange={(e) => set({ type: e.target.value as IssueType })} className={field} aria-label="Issue type">
                {typeChoices.map((x) => (
                  <option key={x} value={x}>
                    {ISSUE_META[x].label}
                  </option>
                ))}
              </select>
            </>
          )}
          <span className="text-muted">Status</span>
          <select value={t.status} disabled={ro} onChange={(e) => set({ status: e.target.value })} className={field} aria-label="Status" style={{ color: status?.color }}>
            {statusChoices.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          {!ro && nextSteps.length > 0 && (
            <>
              <span className="text-muted">Next step</span>
              <span className="flex flex-wrap gap-1" data-testid="transitions">
                {nextSteps.map((n) => (
                  <button key={n.id} onClick={() => set({ status: n.id })} className="flex items-center gap-1 rounded-md px-2 py-1 text-[12px] font-medium ring-1 hover:bg-hover" style={{ color: n.color, borderColor: n.color }} data-testid="transition" data-to={n.id}>
                    <ArrowRight size={12} /> {n.name}
                  </button>
                ))}
              </span>
            </>
          )}
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
          {inProject && (
            <>
              <span className="text-muted">Reporter</span>
              <select value={t.reporter?.id ?? ''} disabled={ro} onChange={(e) => set({ reporterId: e.target.value || null })} className={field} aria-label="Reporter">
                <option value="">—</option>
                {(users ?? []).map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
              {t.type !== 'phase' && (
                <>
                  <span className="text-muted">Parent</span>
                  <select value={t.parentId ?? ''} disabled={ro} onChange={(e) => set({ parentId: e.target.value || null })} className={field} aria-label="Parent">
                    <option value="">{t.type === 'subtask' ? '—' : 'None'}</option>
                    {parentChoices.map((p) => (
                      <option key={p.id} value={p.id}>
                        {ISSUE_META[p.type].label}: {p.title}
                      </option>
                    ))}
                  </select>
                </>
              )}
            </>
          )}
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
          {inProject && WORK_TYPES.includes(t.type) && (
            <>
              <span className="flex items-center gap-1.5 text-muted">
                <Gauge size={13} /> Estimate
              </span>
              <span className="flex min-w-0 items-center gap-1.5">
                <input type="number" min={0} defaultValue={t.storyPoints ?? ''} key={`sp${t.storyPoints}`} disabled={ro} onBlur={(e) => set({ storyPoints: e.target.value === '' ? null : Number(e.target.value) })} className={cn(field, 'w-20')} aria-label="Story points" />
                <span className="text-[12px] text-muted">pts</span>
                <input type="number" min={0} step={0.5} defaultValue={t.estimateMinutes ? t.estimateMinutes / 60 : ''} key={`em${t.estimateMinutes}`} disabled={ro} onBlur={(e) => set({ estimateMinutes: e.target.value === '' ? null : Math.round(Number(e.target.value) * 60) })} className={cn(field, 'w-20')} aria-label="Estimate hours" />
                <span className="flex items-center gap-1 text-[12px] text-muted">
                  <Clock size={12} /> h
                </span>
              </span>
            </>
          )}
          <span className="flex items-center gap-1.5 text-muted">
            <CalendarDays size={13} /> {t.type === 'milestone' ? 'Date' : 'Dates'}
          </span>
          {t.type === 'milestone' ? (
            <input type="date" value={t.dueDate ?? ''} disabled={ro} onChange={(e) => set({ startDate: e.target.value || null, dueDate: e.target.value || null })} className={field} aria-label="Due date" />
          ) : (
            <span className="flex min-w-0 items-center gap-1.5">
              <input type="date" value={t.startDate ?? ''} disabled={ro} onChange={(e) => set({ startDate: e.target.value || null })} className={field} aria-label="Start date" />
              <span className="text-muted">→</span>
              <input type="date" value={t.dueDate ?? ''} disabled={ro} onChange={(e) => set({ dueDate: e.target.value || null })} className={field} aria-label="Due date" />
            </span>
          )}
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

        {t.type !== 'subtask' && t.type !== 'milestone' && (
          <section className="mt-4">
            <div className="flex items-center text-[13px] font-semibold text-ink">
              <span className="flex-1">
                {childLabel} {t.children.length ? `· ${t.children.filter((c) => c.completedAt).length}/${t.children.length}` : ''}
              </span>
              {!ro && inProject && (
                <button onClick={() => (setSplitting(true), setLines(''))} className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[12px] font-medium text-brand-700 hover:bg-brand-50" data-testid="break-down">
                  <Split size={13} /> Break down
                </button>
              )}
            </div>
            <ul className="mt-1.5 space-y-1" data-testid="subtasks">
              {t.children.map((c) => (
                <li key={c.id} className="flex items-center gap-2 rounded-md px-1 py-1 hover:bg-hover">
                  <input type="checkbox" checked={!!c.completedAt} disabled={!c.canEdit} onChange={(e) => update.mutate({ id: c.id, status: e.target.checked ? t.statuses.find((s) => s.category === 'done')!.id : t.statuses[0].id })} className="accent-brand-600" aria-label={c.title} />
                  {inProject && <IssueIcon type={c.type} size={14} />}
                  <button onClick={() => onOpen?.(c.id)} className={cn('flex-1 text-left text-[13px] hover:underline', c.completedAt && 'text-muted line-through')}>
                    {c.title}
                  </button>
                  <Points n={c.storyPoints} />
                  {c.ref && <span className="font-mono text-[10.5px] text-subtle">{c.ref}</span>}
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
                    await create.mutateAsync({ parentId: t.id, title: sub.trim(), ...(inProject ? { type: childType } : {}) });
                    setSub('');
                  }
                }}
                placeholder={containers ? `+ Add ${ISSUE_META[childType].label.toLowerCase()}` : '+ Add subtask'}
                aria-label={containers ? 'Add child issue' : 'Add subtask'}
                className="mt-1 h-8 w-full rounded-md px-2 text-[13px] outline-none hover:bg-hover focus:bg-hover"
              />
            )}
          </section>
        )}

        {inProject && (
          <section className="mt-4" data-testid="links">
            <div className="flex items-center text-[13px] font-semibold text-ink">
              <span className="flex flex-1 items-center gap-1.5">
                <Link2 size={14} /> Linked issues
                {t.blockedBy > 0 && (
                  <span className="flex items-center gap-0.5 text-[12px] font-medium text-red-600">
                    <Ban size={12} /> blocked
                  </span>
                )}
              </span>
              {!ro && (
                <button onClick={() => (setLinking(true), setLinkQ(''))} className="rounded-md px-1.5 py-0.5 text-[12px] font-medium text-brand-700 hover:bg-brand-50" data-testid="add-link">
                  + Link
                </button>
              )}
            </div>
            <ul className="mt-1.5 space-y-1">
              {t.links.map((l) => (
                <li key={l.id} className="group flex items-center gap-2 rounded-md px-1 py-1 text-[13px] hover:bg-hover" data-testid="link-row" data-kind={l.kind} data-direction={l.direction}>
                  <span className="w-[92px] shrink-0 text-[12px] text-muted">{LINK_LABEL[l.kind][l.direction]}</span>
                  <IssueIcon type={l.task.type} size={14} />
                  <button onClick={() => onOpen?.(l.task.id)} className={cn('min-w-0 flex-1 truncate text-left hover:underline', l.task.done && 'text-muted line-through')}>
                    {l.task.title}
                  </button>
                  {l.task.ref && <span className="font-mono text-[10.5px] text-subtle">{l.task.ref}</span>}
                  {!ro && (
                    <button onClick={() => unlink.mutate({ id: t.id, linkId: l.id })} className="hidden rounded p-0.5 text-muted hover:bg-white group-hover:block" aria-label="Remove link">
                      <X size={12} />
                    </button>
                  )}
                </li>
              ))}
              {!t.links.length && <li className="px-1 text-[12.5px] text-subtle">No links</li>}
            </ul>
          </section>
        )}

        {inProject && (
          <section className="mt-4" data-testid="task-docs">
            <div className="flex items-center text-[13px] font-semibold text-ink">
              <span className="flex flex-1 items-center gap-1.5">
                <BookOpen size={14} /> Documents
              </span>
              {!ro && (
                <button onClick={() => (setLinkingDoc(true), setDocQ(''))} className="rounded-md px-1.5 py-0.5 text-[12px] font-medium text-brand-700 hover:bg-brand-50" data-testid="link-doc">
                  + Document
                </button>
              )}
            </div>
            <ul className="mt-1.5 space-y-1">
              {t.docs.map((d) => (
                <li key={d.id} className="group flex items-center gap-2 rounded-md px-1 py-1 text-[13px] hover:bg-hover" data-testid="task-doc">
                  {d.accessible ? <FileIcon r={{ type: d.type, metadata: {}, mimeType: null }} size={15} /> : <Lock size={14} className="text-subtle" />}
                  {d.accessible ? (
                    <a href={`/docs/${d.id}`} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate hover:underline">
                      {d.name}
                    </a>
                  ) : (
                    <span className="min-w-0 flex-1 truncate text-muted">{d.name}</span>
                  )}
                  {!ro && (
                    <button onClick={() => docActions.unlink.mutate({ taskId: t.id, resourceId: d.id })} className="hidden rounded p-0.5 text-muted hover:bg-white group-hover:block" aria-label="Unlink document">
                      <X size={12} />
                    </button>
                  )}
                </li>
              ))}
              {!t.docs.length && <li className="px-1 text-[12.5px] text-subtle">No documents — link the requirement or spec this implements</li>}
            </ul>
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

      <Dialog
        open={splitting}
        onOpenChange={setSplitting}
        title={`Break down "${t.title}"`}
        description={`One ${ISSUE_META[childType].label.toLowerCase()} per line.`}
        footer={
          <Button variant="primary" loading={breakdown.isPending} disabled={!lines.trim()} onClick={() => breakdown.mutate({ id: t.id, titles: lines.split('\n') }, { onSuccess: () => setSplitting(false) })} data-testid="confirm-breakdown">
            Create {lines.split('\n').filter((x) => x.trim()).length || ''}
          </Button>
        }
      >
        <textarea value={lines} onChange={(e) => setLines(e.target.value)} rows={6} placeholder={'Design the form\nWrite the API\nTest on mobile'} aria-label="One per line" className="w-full rounded-lg border border-line-strong px-3 py-2 text-[13.5px] outline-none focus:border-brand-500" />
      </Dialog>
      <Dialog open={linking} onOpenChange={setLinking} title="Link an issue" width={480}>
        <div className="space-y-2">
          <select value={linkKind} onChange={(e) => setLinkKind(e.target.value as IssueLinkKind)} className="h-9 w-full rounded-lg border border-line-strong bg-surface px-2 text-[13px]" aria-label="Link type">
            <option value="blocks">This issue blocks…</option>
            <option value="relates">This issue relates to…</option>
            <option value="duplicates">This issue duplicates…</option>
          </select>
          <input value={linkQ} onChange={(e) => setLinkQ(e.target.value)} placeholder="Search issues by title or key" aria-label="Search issues" className="h-9 w-full rounded-lg border border-line-strong px-3 text-[13px] outline-none focus:border-brand-500" />
          <ul className="max-h-64 overflow-auto">
            {linkCandidates.map((x) => (
              <li key={x.id}>
                <button onClick={() => link.mutate({ id: t.id, toId: x.id, kind: linkKind }, { onSuccess: () => setLinking(false) })} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] hover:bg-hover" data-testid="link-candidate" data-title={x.title}>
                  <IssueIcon type={x.type} size={14} />
                  <span className="min-w-0 flex-1 truncate">{x.title}</span>
                  <span className="font-mono text-[10.5px] text-subtle">{x.ref}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </Dialog>
      <Dialog open={linkingDoc} onOpenChange={setLinkingDoc} title="Link a document" description="Pages of the project docs (requirements, specs, use cases…)." width={480}>
        <input value={docQ} onChange={(e) => setDocQ(e.target.value)} placeholder="Search pages" aria-label="Search pages" className="mb-2 h-9 w-full rounded-lg border border-line-strong px-3 text-[13px] outline-none focus:border-brand-500" />
        <ul className="max-h-72 overflow-auto">
          {(projectDocs?.nodes ?? [])
            .filter((n) => n.type !== 'folder' && !t.docs.some((d) => d.id === n.id) && n.name.toLowerCase().includes(docQ.toLowerCase()))
            .map((n) => (
              <li key={n.id}>
                <button onClick={() => docActions.link.mutate({ taskId: t.id, resourceId: n.id }, { onSuccess: () => setLinkingDoc(false) })} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] hover:bg-hover" data-testid="doc-candidate" data-name={n.name}>
                  <FileIcon r={{ type: n.type, metadata: {}, mimeType: null }} size={15} />
                  <span className="min-w-0 flex-1 truncate">{n.name}</span>
                </button>
              </li>
            ))}
          {!projectDocs?.folderId && <li className="px-2 py-3 text-[12.5px] text-muted">This project has no documentation space yet (Docs tab).</li>}
        </ul>
      </Dialog>
      <Dialog
        open={bugging}
        onOpenChange={setBugging}
        title="Log a bug"
        description={`Found on "${t.title}" — the bug blocks it until it is fixed.`}
        footer={
          <Button variant="danger" disabled={!bugTitle.trim()} loading={logBug.isPending} onClick={() => logBug.mutate({ id: t.id, title: bugTitle, description: bugDesc || null, assigneeId: bugWho || null }, { onSuccess: () => setBugging(false) })} data-testid="confirm-bug">
            Log bug
          </Button>
        }
      >
        <div className="space-y-2">
          <input value={bugTitle} onChange={(e) => setBugTitle(e.target.value)} placeholder="What is wrong?" aria-label="Bug title" className="h-9 w-full rounded-lg border border-line-strong px-3 text-[13.5px] outline-none focus:border-brand-500" />
          <textarea value={bugDesc} onChange={(e) => setBugDesc(e.target.value)} rows={4} placeholder={'Steps to reproduce\nExpected\nActual'} aria-label="Bug details" className="w-full rounded-lg border border-line-strong px-3 py-2 text-[13.5px] outline-none focus:border-brand-500" />
          <select value={bugWho} onChange={(e) => setBugWho(e.target.value)} aria-label="Bug assignee" className="h-9 w-full rounded-lg border border-line-strong bg-surface px-2 text-[13px]">
            <option value="">Unassigned</option>
            {(users ?? []).map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </div>
      </Dialog>
      <Dialog
        open={declining}
        onOpenChange={setDeclining}
        title="Decline this request"
        footer={
          <Button variant="danger" loading={decline.isPending} onClick={() => decline.mutate({ id: t.id, reason }, { onSuccess: () => setDeclining(false) })}>
            Decline
          </Button>
        }
      >
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="Why not?" aria-label="Reason" className="w-full rounded-lg border border-line-strong px-3 py-2 text-[13.5px] outline-none focus:border-brand-500" />
      </Dialog>
    </Shell>
  );
}

function Shell({
  onClose,
  onDelete,
  refText,
  type,
  watching,
  watchers,
  onWatch,
  children,
}: {
  onClose: () => void;
  onDelete?: () => void;
  refText?: string | null;
  type?: IssueType;
  watching?: boolean;
  watchers?: UserSummary[];
  onWatch?: () => void;
  children: React.ReactNode;
}) {
  return (
    <aside className="flex w-[440px] shrink-0 flex-col overflow-y-auto border-l border-line bg-surface">
      <div className="flex items-center gap-1.5 px-4 py-2.5">
        {type && <IssueIcon type={type} size={16} />}
        <span className="flex-1 font-mono text-[12px] text-muted">{refText ?? 'Personal task'}</span>
        {onWatch && (
          <button onClick={onWatch} className={cn('flex h-8 items-center gap-1 rounded-lg px-2 text-[12px] hover:bg-hover', watching ? 'text-brand-700' : 'text-muted')} aria-label={watching ? 'Stop watching' : 'Watch'} aria-pressed={!!watching} data-testid="watch">
            {watching ? <Eye size={15} /> : <EyeOff size={15} />}
            {!!watchers?.length && <AvatarStack users={watchers} size={18} max={3} />}
          </button>
        )}
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
    if (k === 'assigneeId' || k === 'reporterId') return people.get(String(v))?.name ?? 'someone';
    if (k === 'startDate' || k === 'dueDate') return shortDate(String(v));
    if (k === 'priority') return PRIORITY[String(v)]?.label ?? String(v);
    if (k === 'progress') return `${v}%`;
    if (k === 'type') return ISSUE_META[v as IssueType]?.label ?? String(v);
    if (k === 'estimateMinutes') return `${Number(v) / 60} h`;
    if (k === 'parentId') return 'another parent';
    if (Array.isArray(v)) return v.join(', ') || 'none';
    return String(v).slice(0, 60);
  };
  const text = () => {
    if (e.data.created) return e.data.request ? 'filed the request' : e.data.fromChat ? 'created it from a chat message' : 'created the task';
    if (e.data.declined) return 'declined the request';
    if (e.data.linked) return `linked an issue (${String((e.data.linked as string[])[0])})`;
    return Object.entries(e.data)
      .map(([k, v]) => (k === 'accepted' ? 'accepted the request' : k === 'triage' ? null : `changed ${FIELD[k] ?? k} to ${show(k, (v as unknown[])[1])}`))
      .filter(Boolean)
      .join(', ');
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
            <span className="font-medium text-ink-2">{who}</span> {text()} · {timeAgo(e.createdAt)}
            {e.body && <span className="mt-0.5 block rounded-lg bg-canvas px-2.5 py-1.5 text-ink-2">{e.body}</span>}
          </span>
        )}
      </span>
    </li>
  );
}
