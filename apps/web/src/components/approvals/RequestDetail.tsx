'use client';

import { approvalValueText, type ApprovalEventView, type ApprovalRequestDetail, type ApprovalStepView } from '@workos/shared';
import { BellRing, Check, CornerUpRight, Lock, MessageSquare, RotateCcw, Undo2, X } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { useApprovalActions, useApprovalRequest } from '@/lib/approvals';
import { formatShort } from '@/lib/format';
import { useMe } from '@/lib/queries';
import { hrefFor } from '@/lib/resources';
import { PeoplePicker } from '../chat/NewChatDialogs';
import { Avatar, Button, cn, Dialog, EmptyState, FileIcon, Skeleton } from '../ui/primitives';
import { StatusPill, TemplateIcon } from './bits';

const full = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });

/** One request: answers, files, the process step by step, the conversation, and what you can do now. */
export function RequestDetail({ id, onSubmitAgain }: { id: string; onSubmitAgain: (r: ApprovalRequestDetail) => void }) {
  const { data: r, error } = useApprovalRequest(id);
  const { data: me } = useMe();
  const a = useApprovalActions();
  const [dialog, setDialog] = useState<'approve' | 'reject' | 'transfer' | null>(null);
  const [note, setNote] = useState('');
  const [to, setTo] = useState<string[]>([]);
  const [comment, setComment] = useState('');

  if (error) return <EmptyState title="Can’t open this request">{(error as Error).message}</EmptyState>;
  if (!r)
    return (
      <div className="space-y-3 p-6">
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  const people = new Map(r.people.map((p) => [p.id, p]));
  const mineSubmitted = r.submitter.id === me?.user.id;
  const close = () => {
    setDialog(null);
    setNote('');
    setTo([]);
  };
  const files = new Map(r.files.map((f) => [f.id, f]));

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="request-detail">
      <div className="min-h-0 flex-1 overflow-auto">
        <div className="border-b border-line px-6 py-5">
          <div className="flex items-start gap-3">
            <TemplateIcon icon={r.template.icon} color={r.template.color} size={40} />
            <div className="min-w-0 flex-1">
              <h2 className="text-[18px] font-semibold text-ink" data-testid="request-title">
                {r.title}
              </h2>
              <p className="mt-0.5 text-[12.5px] text-muted">
                {r.serial} · Submitted {full.format(new Date(r.submittedAt))}
              </p>
            </div>
            <StatusPill status={r.status} />
          </div>
          <div className="mt-4 flex items-center gap-2.5 text-[13px]">
            <Avatar user={r.submitter} size={30} />
            <div>
              <p className="font-medium text-ink">{r.submitter.name}</p>
              <p className="text-[12px] text-muted">{[r.submitter.title, r.submitter.department].filter(Boolean).join(' · ')}</p>
            </div>
          </div>
        </div>

        <section className="border-b border-line px-6 py-5">
          <dl className="grid grid-cols-[160px_1fr] gap-x-4 gap-y-3 text-[13.5px]" data-testid="request-fields">
            {r.fields.map((f) => (
              <div key={f.id} className="contents">
                <dt className="text-muted">{f.label}</dt>
                <dd className="min-w-0 whitespace-pre-wrap text-ink [overflow-wrap:anywhere]">
                  {f.type === 'files' ? (
                    ((r.values[f.id] as string[]) ?? []).length ? (
                      <ul className="space-y-1.5">
                        {((r.values[f.id] as string[]) ?? []).map((fid) => {
                          const file = files.get(fid);
                          if (!file) return null;
                          return (
                            <li key={fid}>
                              {file.accessible ? (
                                <Link href={hrefFor({ id: file.id, type: file.type, metadata: {} })} target="_blank" className="inline-flex items-center gap-2 rounded-lg px-2 py-1 ring-1 ring-line hover:bg-hover" data-testid="request-file">
                                  <FileIcon r={{ type: file.type, metadata: {}, mimeType: null }} size={18} /> {file.name}
                                </Link>
                              ) : (
                                <span className="inline-flex items-center gap-2 rounded-lg px-2 py-1 text-muted ring-1 ring-line">
                                  <Lock size={14} /> {file.name}
                                </span>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    ) : (
                      '—'
                    )
                  ) : (
                    approvalValueText(f, r.values[f.id], people)
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="border-b border-line px-6 py-5">
          <h3 className="mb-4 text-[14px] font-semibold text-ink">Approval process</h3>
          <ol className="relative space-y-5 border-l-2 border-line pl-6" data-testid="process">
            <TimelineItem tone="done" title="Submitted" sub={`${r.submitter.name} · ${formatShort(r.submittedAt)}`} />
            {r.steps.map((s) => (
              <StepItem key={s.index} s={s} />
            ))}
            {r.status !== 'pending' && <TimelineItem tone={r.status === 'approved' ? 'done' : r.status === 'rejected' ? 'rejected' : 'skipped'} title={r.status === 'approved' ? 'Approved' : r.status === 'rejected' ? 'Rejected' : 'Withdrawn'} sub={r.finishedAt ? formatShort(r.finishedAt) : ''} />}
          </ol>
        </section>

        <section className="px-6 py-5">
          <h3 className="mb-3 text-[14px] font-semibold text-ink">Activity</h3>
          <ul className="space-y-3" data-testid="activity">
            {r.events.map((e) => (
              <EventItem key={e.id} e={e} people={people} />
            ))}
          </ul>
          <form
            className="mt-4 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!comment.trim()) return;
              a.comment.mutate({ id: r.id, body: comment }, { onSuccess: () => setComment('') });
            }}
          >
            <input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Add a comment" className="h-9 min-w-0 flex-1 rounded-lg border border-line-strong px-3 text-[13.5px] outline-none focus:border-brand-600" aria-label="Comment" data-testid="comment-input" />
            <Button type="submit" disabled={!comment.trim()} icon={<MessageSquare size={15} />}>
              Comment
            </Button>
          </form>
        </section>
      </div>

      {(r.perms.approve || r.perms.withdraw || (mineSubmitted && r.status !== 'pending')) && (
        <footer className="flex shrink-0 items-center gap-2 border-t border-line bg-surface px-6 py-3" data-testid="request-actions">
          {r.perms.approve && (
            <>
              <Button variant="primary" icon={<Check size={15} />} onClick={() => setDialog('approve')} data-testid="approve">
                Approve
              </Button>
              <Button variant="danger" icon={<X size={15} />} onClick={() => setDialog('reject')} data-testid="reject">
                Reject
              </Button>
              <Button icon={<CornerUpRight size={15} />} onClick={() => setDialog('transfer')} data-testid="transfer">
                Transfer
              </Button>
            </>
          )}
          {r.perms.remind && (
            <Button icon={<BellRing size={15} />} loading={a.remind.isPending} onClick={() => a.remind.mutate(r.id)} data-testid="remind">
              Remind
            </Button>
          )}
          {r.perms.withdraw && (
            <Button variant="ghost" icon={<Undo2 size={15} />} loading={a.withdraw.isPending} onClick={() => a.withdraw.mutate({ id: r.id })} data-testid="withdraw">
              Withdraw
            </Button>
          )}
          {mineSubmitted && r.status !== 'pending' && (
            <Button icon={<RotateCcw size={15} />} onClick={() => onSubmitAgain(r)} data-testid="submit-again">
              Submit again
            </Button>
          )}
        </footer>
      )}

      <Dialog
        open={dialog === 'approve' || dialog === 'reject'}
        onOpenChange={(o) => !o && close()}
        title={dialog === 'reject' ? 'Reject this request' : 'Approve this request'}
        description={dialog === 'reject' ? `${r.submitter.name} will see your reason.` : 'Add a note if you like.'}
        footer={
          <Button
            variant={dialog === 'reject' ? 'danger' : 'primary'}
            disabled={dialog === 'reject' && !note.trim()}
            loading={a.approve.isPending || a.reject.isPending}
            onClick={() => (dialog === 'reject' ? a.reject : a.approve).mutate({ id: r.id, comment: note }, { onSuccess: close })}
            data-testid="confirm-decision"
          >
            {dialog === 'reject' ? 'Reject' : 'Approve'}
          </Button>
        }
      >
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder={dialog === 'reject' ? 'Why? (required)' : 'Note (optional)'} className="w-full rounded-lg border border-line-strong px-3 py-2 text-[13.5px] outline-none focus:border-brand-600" aria-label="Note" data-testid="decision-note" />
      </Dialog>
      <Dialog
        open={dialog === 'transfer'}
        onOpenChange={(o) => !o && close()}
        title="Transfer to someone else"
        description="They decide in your place; you will see the outcome."
        width={460}
        footer={
          <Button variant="primary" disabled={!to.length} loading={a.transfer.isPending} onClick={() => a.transfer.mutate({ id: r.id, userId: to[0], comment: note }, { onSuccess: close })} data-testid="confirm-transfer">
            Transfer
          </Button>
        }
      >
        <PeoplePicker selected={to} onChange={setTo} single />
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" className="mt-3 h-9 w-full rounded-lg border border-line-strong px-3 text-[13.5px] outline-none focus:border-brand-600" aria-label="Transfer note" />
      </Dialog>
    </div>
  );
}

function TimelineItem({ tone, title, sub, children }: { tone: 'done' | 'active' | 'upcoming' | 'skipped' | 'rejected'; title: string; sub?: string; children?: React.ReactNode }) {
  return (
    <li className="relative">
      <span
        className={cn(
          'absolute -left-[33px] top-0.5 grid size-4 place-items-center rounded-full ring-4 ring-white',
          tone === 'done' ? 'bg-emerald-500' : tone === 'active' ? 'bg-amber-400' : tone === 'rejected' ? 'bg-red-500' : 'bg-slate-300',
        )}
      >
        {tone === 'done' && <Check size={10} className="text-white" strokeWidth={3} />}
        {tone === 'rejected' && <X size={10} className="text-white" strokeWidth={3} />}
      </span>
      <p className={cn('text-[13.5px] font-medium', tone === 'skipped' || tone === 'upcoming' ? 'text-muted' : 'text-ink')}>{title}</p>
      {sub && <p className="text-[12px] text-muted">{sub}</p>}
      {children}
    </li>
  );
}

const PERSON_STATUS: Record<string, { label: string; cls: string }> = {
  waiting: { label: 'Not yet', cls: 'text-subtle' },
  pending: { label: 'Reviewing', cls: 'text-amber-700' },
  approved: { label: 'Approved', cls: 'text-emerald-700' },
  rejected: { label: 'Rejected', cls: 'text-red-700' },
  transferred: { label: 'Transferred', cls: 'text-muted' },
  skipped: { label: '—', cls: 'text-subtle' },
  cc: { label: 'Copied', cls: 'text-sky-700' },
};

function StepItem({ s }: { s: ApprovalStepView }) {
  const kind = s.type === 'cc' ? 'CC' : s.people.length > 1 ? (s.mode === 'and' ? 'Everyone approves' : 'Any one approves') : 'Approval';
  return (
    <TimelineItem tone={s.state} title={s.name} sub={s.state === 'skipped' ? `Skipped${s.note ? ` — ${s.note.toLowerCase()}` : ''}` : kind}>
      {s.people.length > 0 && (
        <ul className="mt-2 space-y-2" data-testid="step-people" data-step={s.index} data-state={s.state}>
          {s.people.map((p, i) => (
            <li key={`${p.user.id}-${i}`} className="flex items-start gap-2 text-[13px]">
              <Avatar user={p.user} size={24} />
              <div className="min-w-0 flex-1">
                <p>
                  <span className="font-medium text-ink">{p.user.name}</span>{' '}
                  <span className={cn('text-[12px]', PERSON_STATUS[p.status].cls)} data-testid="person-status" data-status={p.status}>
                    {p.auto ? 'Approved automatically' : PERSON_STATUS[p.status].label}
                    {p.transferredTo ? ` to ${p.transferredTo.name}` : ''}
                  </span>
                  {p.actedAt && <span className="ml-1.5 text-[11.5px] text-subtle">{formatShort(p.actedAt)}</span>}
                </p>
                {p.comment && <p className="mt-0.5 rounded-lg bg-hover px-2.5 py-1.5 text-[12.5px] text-ink-2">{p.comment}</p>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </TimelineItem>
  );
}

function EventItem({ e, people }: { e: ApprovalEventView; people: Map<string, { name: string }> }) {
  const who = e.actor?.name ?? 'System';
  const text: Record<ApprovalEventView['kind'], string> = {
    submitted: 'submitted the request',
    approved: e.data.auto ? 'approved automatically (own step)' : 'approved',
    rejected: 'rejected',
    transferred: `transferred to ${people.get(String(e.data.to))?.name ?? 'someone'}`,
    comment: 'commented',
    withdrawn: 'withdrew the request',
    cc: 'sent a copy',
    reminded: 'sent a reminder',
    finished: `The request was ${String(e.data.status ?? 'closed')}`,
  };
  return (
    <li className="flex gap-2.5 text-[13px]" data-testid="event" data-kind={e.kind}>
      {e.actor ? <Avatar user={e.actor} size={24} /> : <span className="size-6 shrink-0 rounded-full bg-hover" />}
      <div className="min-w-0 flex-1">
        <p className="text-ink-2">
          {e.kind !== 'finished' && <span className="font-medium text-ink">{who} </span>}
          {text[e.kind]} <span className="text-[11.5px] text-subtle">{formatShort(e.createdAt)}</span>
        </p>
        {e.body && <p className="mt-0.5 whitespace-pre-wrap rounded-lg bg-hover px-2.5 py-1.5 text-[12.5px] text-ink-2">{e.body}</p>}
      </div>
    </li>
  );
}
