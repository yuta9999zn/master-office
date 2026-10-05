'use client';

import type { ChatAccessProblem, ChatAttachment, Resource, UserSummary } from '@workos/shared';
import { Check, Lock, Search, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { accessProblem, attachmentOf, type SendInput, useSendMessage } from '@/lib/chat';
import { formatBytes } from '@/lib/format';
import { useResources, useSearch } from '@/lib/queries';
import { hrefFor, typeLabel } from '@/lib/resources';
import { Button, cn, Dialog, FileIcon, Skeleton } from '../ui/primitives';

/** A file a message points at. Opens the right editor; locked for people who cannot open it. */
export function FileCard({ a, compact }: { a: ChatAttachment; compact?: boolean }) {
  const router = useRouter();
  if (!a.accessible || !a.name || !a.type)
    return (
      <div className="flex w-[300px] max-w-full items-center gap-3 rounded-xl border border-dashed border-line-strong bg-canvas px-3 py-2.5 text-[12.5px] text-muted" data-testid="file-card" data-locked="true">
        <span className="flex size-9 items-center justify-center rounded-lg bg-hover">
          <Lock size={16} />
        </span>
        <span>
          <span className="block font-medium text-ink-2">Restricted file</span>
          You don’t have access — ask the sender to share it.
        </span>
      </div>
    );
  const r = { id: a.id, name: a.name, type: a.type, mimeType: a.mimeType, metadata: a.metadata ?? {} } as Pick<Resource, 'id' | 'name' | 'type' | 'mimeType' | 'metadata'>;
  return (
    <button
      onClick={() => router.push(hrefFor(r))}
      className={cn('flex w-[300px] max-w-full items-center gap-3 rounded-xl border border-line bg-surface px-3 text-left shadow-[var(--shadow-card)] hover:border-brand-200 hover:bg-brand-50/40', compact ? 'py-2' : 'py-2.5')}
      data-testid="file-card"
      data-name={a.name}
    >
      <FileIcon r={r} size={compact ? 26 : 32} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13.5px] font-medium text-ink">{a.name}</span>
        <span className="block truncate text-[11.5px] text-muted">
          {a.trashed ? (
            <span className="inline-flex items-center gap-1 text-red-500">
              <Trash2 size={11} /> In trash
            </span>
          ) : (
            [typeLabel(r as Resource), a.sizeBytes ? formatBytes(a.sizeBytes) : null, a.owner].filter(Boolean).join(' · ')
          )}
        </span>
      </span>
    </button>
  );
}

/** Pick files from Drive (recent files, or search) to share in a message. */
export function ResourcePickerDialog({ open, onOpenChange, onPick }: { open: boolean; onOpenChange: (v: boolean) => void; onPick: (items: ChatAttachment[]) => void }) {
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<Map<string, ChatAttachment>>(new Map());
  const { data: recent, isLoading } = useResources(open ? { view: 'recent' } : null);
  const { data: hits } = useSearch(q);
  const items: Pick<Resource, 'id' | 'name' | 'type' | 'mimeType' | 'sizeBytes' | 'metadata'>[] = q.trim()
    ? (hits ?? []).filter((h) => h.kind === 'resource' && h.type !== 'folder').map((h) => ({ id: h.id, name: h.title, type: h.type!, mimeType: null, sizeBytes: 0, metadata: {} }))
    : (recent ?? []).filter((r) => r.type !== 'folder');
  const close = () => (onOpenChange(false), setPicked(new Map()), setQ(''));
  const toggle = (r: (typeof items)[number]) =>
    setPicked((p) => {
      const next = new Map(p);
      if (!next.delete(r.id)) next.set(r.id, attachmentOf(r));
      return next;
    });
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => (v ? onOpenChange(true) : close())}
      title="Share from Drive"
      description="The file is shared as a link to the original — never a copy."
      width={520}
      footer={
        <Button variant="primary" disabled={!picked.size} onClick={() => (onPick([...picked.values()]), close())} data-testid="pick-files">
          Add {picked.size || ''}
        </Button>
      }
    >
      <label className="flex h-9 items-center gap-2 rounded-lg border border-line-strong px-3 text-[13px] focus-within:border-brand-500">
        <Search size={15} className="text-subtle" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search files" className="min-w-0 flex-1 bg-transparent outline-none" aria-label="Search files" />
      </label>
      {!q.trim() && <div className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-subtle">Recent</div>}
      <ul className="mt-1 max-h-72 overflow-y-auto" data-testid="file-picker">
        {isLoading && !q.trim() && [0, 1, 2].map((i) => <Skeleton key={i} className="my-1 h-10" />)}
        {items.slice(0, 30).map((r) => {
          const on = picked.has(r.id);
          return (
            <li key={r.id}>
              <button onClick={() => toggle(r)} className={cn('flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left hover:bg-hover', on && 'bg-selected')} aria-pressed={on} data-name={r.name}>
                <FileIcon r={r} size={24} />
                <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{r.name}</span>
                {on && <Check size={16} className="text-brand-600" />}
              </button>
            </li>
          );
        })}
        {!items.length && (q.trim() || !isLoading) && <li className="px-2 py-4 text-center text-[13px] text-muted">No files found</li>}
      </ul>
    </Dialog>
  );
}

function AccessDialog({ problem, onAnswer }: { problem: ChatAccessProblem | null; onAnswer: (send: boolean) => void }) {
  const people = (users: Pick<UserSummary, 'id' | 'name'>[]) => (users.length <= 3 ? users.map((u) => u.name).join(', ') : `${users.slice(0, 2).map((u) => u.name).join(', ')} and ${users.length - 2} others`);
  return (
    <Dialog
      open={!!problem}
      onOpenChange={(v) => !v && onAnswer(false)}
      title="Some people can’t open this"
      description="Chat never shares files: people open them with their own access. Those without it will see a locked card."
      width={480}
      footer={
        <>
          <Button variant="ghost" onClick={() => onAnswer(false)}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => onAnswer(true)} data-testid="send-anyway">
            Send anyway
          </Button>
        </>
      }
    >
      <ul className="space-y-2" data-testid="access-dialog">
        {problem?.missing.map((m) => (
          <li key={m.resourceId} className="rounded-lg border border-line px-3 py-2 text-[13px]">
            <div className="font-medium text-ink">{m.name}</div>
            <div className="text-muted">No access: {people(m.users)}</div>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[12px] text-muted">To give them access, share the file from Drive — or upload a copy here so it lives in this conversation’s folder.</p>
    </Dialog>
  );
}

/**
 * Sending with the heads-up of §68: a 409 says who will see a file locked; "Send anyway" re-sends with grant 'none'.
 * Chat itself never grants access to files.
 */
export function useSendFlow(conversationId: string, me: UserSummary | undefined) {
  const send = useSendMessage(conversationId, me);
  const [pending, setPending] = useState<{ input: SendInput; problem: ChatAccessProblem } | null>(null);
  const run = async (input: SendInput) => {
    try {
      await send.mutateAsync(input);
    } catch (e) {
      const problem = accessProblem(e);
      if (problem) setPending({ input, problem });
    }
  };
  const dialog = (
    <AccessDialog
      problem={pending?.problem ?? null}
      onAnswer={(ok) => {
        const p = pending;
        setPending(null);
        if (p && ok) void run({ ...p.input, grant: 'none' });
      }}
    />
  );
  return { send: run, dialog };
}
