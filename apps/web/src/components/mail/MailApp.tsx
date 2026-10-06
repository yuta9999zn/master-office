'use client';

import { can, type MailFolder, type MailMessageView, type MailThreadSummary, type MailThreadView, type Mailbox } from '@workos/shared';
import {
  Archive,
  ArchiveRestore,
  Download,
  File as FileIcon2,
  FileText,
  Forward,
  HardDriveUpload,
  Inbox,
  Mail as MailIcon,
  MailOpen,
  Pencil,
  Plus,
  Reply,
  ReplyAll,
  Search,
  Send,
  Star,
  Trash2,
  UserRound,
  Users,
} from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { API_ORIGIN } from '@/lib/api';
import { formatBytes, formatDateTime, formatShort } from '@/lib/format';
import { addrFull, addrLabel, useMailActions, useMailboxes, useMailThread, useMailThreads } from '@/lib/mail';
import { useMe, useSpaces, useUsers } from '@/lib/queries';
import { useMounted } from '@/lib/use-mounted';
import { Avatar, Button, cn, Dialog, EmptyState, IconButton, Menu, MenuContent, MenuItem, MenuTrigger, Skeleton } from '../ui/primitives';
import { MailCompose, useCompose } from './MailCompose';

const FOLDERS: { id: MailFolder; label: string; icon: typeof Inbox }[] = [
  { id: 'inbox', label: 'Inbox', icon: Inbox },
  { id: 'starred', label: 'Starred', icon: Star },
  { id: 'sent', label: 'Sent', icon: Send },
  { id: 'drafts', label: 'Drafts', icon: FileText },
  { id: 'archive', label: 'Archive', icon: Archive },
  { id: 'trash', label: 'Trash', icon: Trash2 },
];

/** /mail?box=…&folder=…&t=… — mailboxes and folders · conversations · the open conversation (docs/ARCHITECTURE.md §69). */
export function MailApp() {
  const params = useSearchParams();
  const router = useRouter();
  const { data: boxes } = useMailboxes();
  const boxId = params.get('box') ?? boxes?.find((b) => b.kind === 'user')?.id;
  const folder = (params.get('folder') as MailFolder) ?? 'inbox';
  const threadId = params.get('t');
  const box = boxes?.find((b) => b.id === boxId);
  const go = (p: { box?: string; folder?: MailFolder; t?: string | null }) => {
    // Start from the address bar, not this render's values: two quick clicks must not undo each other.
    const cur = new URLSearchParams(window.location.search);
    const n = new URLSearchParams();
    n.set('box', p.box ?? cur.get('box') ?? boxId ?? '');
    n.set('folder', p.folder ?? (cur.get('folder') as MailFolder | null) ?? folder);
    const t = p.t === undefined ? cur.get('t') : p.t;
    if (t) n.set('t', t);
    router.push(`/mail?${n.toString()}`);
  };

  const mounted = useMounted();
  if (!mounted) return <div className="h-full bg-canvas" />;
  return (
    <div className="flex h-full">
      <MailNav boxes={boxes} boxId={boxId} folder={folder} go={go} />
      <ThreadList box={box} folder={folder} activeId={threadId} open={(t) => go({ t })} />
      <div className="min-w-0 flex-1 overflow-hidden bg-canvas">
        {threadId ? (
          <ThreadView key={threadId} id={threadId} onGone={() => go({ t: null })} />
        ) : (
          <div className="flex h-full items-center justify-center">
            <EmptyState icon={<MailIcon size={40} />} title={box ? box.address : 'Mail'}>
              Pick a conversation, or write a new message.
            </EmptyState>
          </div>
        )}
      </div>
      <MailCompose />
    </div>
  );
}

function MailNav({ boxes, boxId, folder, go }: { boxes?: Mailbox[]; boxId?: string; folder: MailFolder; go: (p: { box?: string; folder?: MailFolder; t?: string | null }) => void }) {
  const compose = useCompose((s) => s.compose);
  const [setup, setSetup] = useState(false);
  const { data: spaces } = useSpaces();
  const personal = boxes?.filter((b) => b.kind === 'user') ?? [];
  const shared = boxes?.filter((b) => b.kind === 'space') ?? [];
  const canSetup = (spaces ?? []).some((s) => can(s.myRole, 'admin') && !shared.some((b) => b.spaceId === s.id));
  return (
    <nav className="flex w-[240px] shrink-0 flex-col border-r border-line bg-surface" data-testid="mail-nav">
      <div className="p-3">
        <Button variant="primary" className="h-10 w-full" icon={<Pencil size={16} />} onClick={() => compose({ mailboxId: boxes?.find((b) => b.id === boxId && b.perms.write)?.id })} data-testid="compose">
          Compose
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {!boxes && [0, 1, 2, 3].map((i) => <Skeleton key={i} className="m-2 h-7" />)}
        {personal.map((b) => (
          <BoxFolders key={b.id} b={b} active={b.id === boxId} folder={folder} go={go} />
        ))}
        {(!!shared.length || canSetup) && (
          <div className="mt-4 flex items-center justify-between px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-subtle">
            Shared mailboxes
            {canSetup && (
              <button onClick={() => setSetup(true)} className="rounded p-0.5 hover:bg-hover hover:text-ink" aria-label="Set up a shared mailbox" data-testid="setup-shared">
                <Plus size={14} />
              </button>
            )}
          </div>
        )}
        {shared.map((b) => (
          <BoxFolders key={b.id} b={b} active={b.id === boxId} folder={folder} go={go} />
        ))}
      </div>
      <SharedMailboxDialog open={setup} onOpenChange={setSetup} existing={shared.map((b) => b.spaceId!)} />
    </nav>
  );
}

function BoxFolders({ b, active, folder, go }: { b: Mailbox; active: boolean; folder: MailFolder; go: (p: { box?: string; folder?: MailFolder; t?: string | null }) => void }) {
  const [open, setOpen] = useState(active || b.kind === 'user');
  useEffect(() => {
    if (active) setOpen(true);
  }, [active]);
  return (
    <div className="mb-1" data-testid="mailbox" data-address={b.address}>
      <button onClick={() => (setOpen(!open), go({ box: b.id, folder: 'inbox', t: null }))} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-hover">
        {b.kind === 'user' ? <UserRound size={15} className="text-muted" /> : <Users size={15} className="text-violet-600" />}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold text-ink">{b.kind === 'user' ? 'My mailbox' : b.name}</span>
          <span className="block truncate text-[11px] text-muted">{b.address}</span>
        </span>
        {!open && b.unread > 0 && <span className="text-[11px] font-semibold text-brand-600">{b.unread}</span>}
      </button>
      {open &&
        FOLDERS.map((f) => {
          const on = active && folder === f.id;
          const count = f.id === 'inbox' ? b.unread : f.id === 'drafts' ? b.drafts : 0;
          return (
            <button
              key={f.id}
              onClick={() => go({ box: b.id, folder: f.id, t: null })}
              className={cn('flex h-8 w-full items-center gap-3 rounded-lg pl-7 pr-2 text-[13px]', on ? 'bg-selected font-semibold text-brand-700' : 'text-ink-2 hover:bg-hover')}
              aria-current={on ? 'page' : undefined}
              data-testid="folder"
              data-folder={f.id}
            >
              <f.icon size={15} />
              <span className="flex-1 text-left">{f.label}</span>
              {count > 0 && <span className={cn('text-[11.5px]', f.id === 'inbox' ? 'font-semibold text-brand-600' : 'text-muted')}>{count}</span>}
            </button>
          );
        })}
      {open && !b.perms.write && <div className="pl-7 pt-1 text-[11px] text-subtle">Read only — your role in the space</div>}
    </div>
  );
}

function SharedMailboxDialog({ open, onOpenChange, existing }: { open: boolean; onOpenChange: (v: boolean) => void; existing: string[] }) {
  const { data: spaces } = useSpaces();
  const options = (spaces ?? []).filter((s) => can(s.myRole, 'admin') && !existing.includes(s.id));
  const [spaceId, setSpaceId] = useState('');
  const [local, setLocal] = useState('');
  const { enableSpace } = useMailActions();
  const { data: boxes } = useMailboxes();
  const domain = boxes?.find((b) => b.kind === 'user')?.address.split('@')[1] ?? '';
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Set up a shared mailbox"
      description="A space gets one address. People in the space read it; editors answer it; space admins manage it."
      footer={
        <Button variant="primary" disabled={!spaceId || !local.trim()} loading={enableSpace.isPending} onClick={async () => (await enableSpace.mutateAsync({ spaceId, localPart: local.trim() }), onOpenChange(false), setLocal(''))}>
          Create mailbox
        </Button>
      }
    >
      <label className="block text-[12px] font-medium text-muted">
        Space
        <select value={spaceId} onChange={(e) => setSpaceId(e.target.value)} className="mt-1 h-9 w-full rounded-lg border border-line-strong bg-surface px-2 text-[13px] text-ink" aria-label="Space">
          <option value="">Choose a space you manage</option>
          {options.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      <label className="mt-3 block text-[12px] font-medium text-muted">
        Address
        <span className="mt-1 flex h-9 items-center rounded-lg border border-line-strong px-3 text-[13px]">
          <input value={local} onChange={(e) => setLocal(e.target.value.toLowerCase())} placeholder="e.g. support" className="min-w-0 flex-1 bg-transparent outline-none" aria-label="Address" />
          <span className="text-muted">@{domain}</span>
        </span>
      </label>
    </Dialog>
  );
}

function ThreadList({ box, folder, activeId, open }: { box?: Mailbox; folder: MailFolder; activeId: string | null; open: (id: string) => void }) {
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setQuery(q), 300);
    return () => clearTimeout(t);
  }, [q]);
  const { data, isLoading } = useMailThreads(box?.id, query ? 'all' : folder, query);
  const { update } = useMailActions();
  const compose = useCompose((s) => s.compose);
  const label = FOLDERS.find((f) => f.id === folder)?.label ?? 'Mail';
  return (
    <section className="flex w-[420px] shrink-0 flex-col border-r border-line bg-surface" data-testid="thread-list">
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-line px-4">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-semibold text-ink">{query ? 'Search results' : label}</div>
          <div className="truncate text-[11.5px] text-muted">{box?.address}</div>
        </div>
      </div>
      <div className="px-3 pt-3">
        <label className="flex h-9 items-center gap-2 rounded-lg bg-canvas px-3 text-[13px] ring-1 ring-line focus-within:ring-brand-500">
          <Search size={15} className="text-subtle" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search mail" className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-subtle" aria-label="Search mail" />
        </label>
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {isLoading && [0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="m-2 h-14" />)}
        {!isLoading && !data?.length && <EmptyState icon={<MailOpen size={28} />} title={query ? 'Nothing matches' : `No conversations in ${label}`} />}
        {data?.map((t) => (
          <ThreadRow
            key={t.id}
            t={t}
            active={t.id === activeId}
            canWrite={!!box?.perms.write}
            onOpen={() => (t.hasDraft && t.count === 1 && folder === 'drafts' ? openDraft(t, compose) : open(t.id))}
            onAction={(a) => update.mutate({ id: t.id, ...a })}
          />
        ))}
      </ul>
    </section>
  );
}

/** A conversation that is only a draft opens in the compose window. */
async function openDraft(t: MailThreadSummary, compose: ReturnType<typeof useCompose.getState>['compose']) {
  const { api } = await import('@/lib/api');
  const v = await api<MailThreadView>(`/mail/threads/${t.id}`);
  const d = v.messages.find((m) => m.status === 'draft');
  if (d) compose({ mailboxId: t.mailboxId, draftId: d.id, to: d.to, cc: d.cc, bcc: d.bcc, subject: d.subject, text: d.text, attachments: d.attachments });
}

function ThreadRow({ t, active, canWrite, onOpen, onAction }: { t: MailThreadSummary; active: boolean; canWrite: boolean; onOpen: () => void; onAction: (a: { read?: boolean; starred?: boolean; folder?: 'inbox' | 'archive' | 'trash' }) => void }) {
  const inTrash = t.folders.every((f) => f === 'trash');
  return (
    <li className="group relative" data-testid="mail-thread" data-subject={t.subject} data-unread={t.unread}>
      <button onClick={onOpen} className={cn('flex w-full gap-3 rounded-lg px-3 py-2.5 text-left', active ? 'bg-selected' : 'hover:bg-hover')}>
        <span className={cn('mt-1.5 size-2 shrink-0 rounded-full', t.unread ? 'bg-brand-600' : 'bg-transparent')} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className={cn('min-w-0 flex-1 truncate text-[13.5px]', t.unread ? 'font-semibold text-ink' : 'text-ink-2')}>
              {t.participants.slice(-3).join(', ') || (t.hasDraft ? 'Draft' : '—')}
              {t.count > 1 && <span className="ml-1 text-[12px] font-normal text-subtle">{t.count}</span>}
              {t.hasDraft && <span className="ml-1.5 text-[11.5px] font-medium text-red-500">Draft</span>}
            </span>
            <span className="shrink-0 text-[11.5px] text-subtle group-hover:invisible">{formatShort(t.lastAt)}</span>
          </span>
          <span className={cn('mt-0.5 block truncate text-[13px]', t.unread ? 'font-semibold text-ink' : 'text-ink-2')}>{t.subject}</span>
          <span className="mt-0.5 flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-[12.5px] text-muted">{t.snippet}</span>
            {t.hasAttachments && <FileIcon2 size={13} className="shrink-0 text-subtle" />}
            {t.starred && <Star size={13} className="shrink-0 fill-amber-400 text-amber-400" />}
            {t.assignee && <Avatar user={t.assignee} size={18} />}
          </span>
        </span>
      </button>
      {canWrite && (
        <span className="absolute right-2 top-2 hidden items-center gap-0.5 rounded-md bg-surface p-0.5 shadow-sm ring-1 ring-line group-hover:flex">
          {!inTrash && (
            <IconButton label="Archive" size={26} onClick={() => onAction({ folder: 'archive' })}>
              <Archive size={14} />
            </IconButton>
          )}
          <IconButton label={inTrash ? 'Restore' : 'Delete'} size={26} onClick={() => onAction({ folder: inTrash ? 'inbox' : 'trash' })}>
            {inTrash ? <ArchiveRestore size={14} /> : <Trash2 size={14} />}
          </IconButton>
          <IconButton label={t.unread ? 'Mark as read' : 'Mark as unread'} size={26} onClick={() => onAction({ read: t.unread })}>
            <MailOpen size={14} />
          </IconButton>
          <IconButton label={t.starred ? 'Unstar' : 'Star'} size={26} onClick={() => onAction({ starred: !t.starred })}>
            <Star size={14} className={t.starred ? 'fill-amber-400 text-amber-400' : ''} />
          </IconButton>
        </span>
      )}
    </li>
  );
}

function ThreadView({ id, onGone }: { id: string; onGone: () => void }) {
  const { data: t, error } = useMailThread(id);
  const { update, remove } = useMailActions();
  const { data: me } = useMe();
  const { data: users } = useUsers();
  const compose = useCompose((s) => s.compose);
  const marked = useRef(false);
  useEffect(() => {
    if (t && t.unread && t.mailbox.perms.write && !marked.current) {
      marked.current = true;
      update.mutate({ id, read: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t?.id, t?.unread]);

  if (error) return <EmptyState title="This conversation is gone">{(error as Error).message}</EmptyState>;
  if (!t)
    return (
      <div className="space-y-3 p-6">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  const sent = t.messages.filter((m) => m.status === 'sent');
  const last = sent.at(-1);
  const inTrash = t.folders.every((f) => f === 'trash');
  const canWrite = t.mailbox.perms.write;
  const mine = t.mailbox.address;
  const reply = (m: MailMessageView, all: boolean) => {
    const from = m.direction === 'out' ? m.to : [m.from];
    const cc = all ? [...m.to, ...m.cc].filter((a) => a.address !== mine && !from.some((f) => f.address === a.address)) : [];
    compose({ mailboxId: t.mailboxId, to: from, cc, subject: m.subject.match(/^re:/i) ? m.subject : `Re: ${m.subject}`, replyTo: m.id, text: `\n\nOn ${formatDateTime(m.sentAt ?? '')}, ${addrFull(m.from)} wrote:\n${m.text.split('\n').map((l) => `> ${l}`).join('\n')}` });
  };
  const forward = (m: MailMessageView) =>
    compose({
      mailboxId: t.mailboxId,
      subject: m.subject.match(/^fwd?:/i) ? m.subject : `Fwd: ${m.subject}`,
      text: `\n\n---------- Forwarded message ----------\nFrom: ${addrFull(m.from)}\nDate: ${formatDateTime(m.sentAt ?? '')}\nSubject: ${m.subject}\nTo: ${m.to.map(addrFull).join(', ')}\n\n${m.text}`,
      attachments: m.attachments,
    });

  return (
    <div className="flex h-full flex-col" data-testid="mail-thread-view">
      <div className="flex shrink-0 items-start gap-3 border-b border-line bg-surface px-6 py-4">
        <div className="min-w-0 flex-1">
          <h1 className="text-[18px] font-semibold text-ink" data-testid="mail-subject">
            {t.subject}
          </h1>
          <div className="mt-0.5 text-[12px] text-muted">
            {t.mailbox.kind === 'space' ? `Shared mailbox ${t.mailbox.address}` : t.mailbox.address} · {sent.length} message{sent.length === 1 ? '' : 's'}
          </div>
        </div>
        {canWrite && (
          <div className="flex items-center gap-0.5">
            {t.mailbox.kind === 'space' && <Assign t={t} users={users ?? []} />}
            <IconButton label={t.starred ? 'Unstar' : 'Star'} onClick={() => update.mutate({ id, starred: !t.starred })}>
              <Star size={17} className={t.starred ? 'fill-amber-400 text-amber-400' : ''} />
            </IconButton>
            <IconButton label="Mark as unread" onClick={() => (update.mutate({ id, read: false }), onGone())}>
              <MailIcon size={17} />
            </IconButton>
            {!inTrash && (
              <IconButton label="Archive" onClick={() => (update.mutate({ id, folder: 'archive' }), onGone())}>
                <Archive size={17} />
              </IconButton>
            )}
            {inTrash ? (
              <>
                <IconButton label="Restore" onClick={() => update.mutate({ id, folder: 'inbox' })}>
                  <ArchiveRestore size={17} />
                </IconButton>
                <IconButton label="Delete forever" onClick={() => remove.mutate(id, { onSuccess: onGone })}>
                  <Trash2 size={17} className="text-red-600" />
                </IconButton>
              </>
            ) : (
              <IconButton label="Delete" onClick={() => (update.mutate({ id, folder: 'trash' }), onGone())}>
                <Trash2 size={17} />
              </IconButton>
            )}
          </div>
        )}
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-6 py-4">
        {t.messages.map((m, i) => (
          <MessageCard key={m.id} m={m} expanded={i === t.messages.length - 1 || !m.read} me={me?.user.id} canWrite={canWrite} onReply={(all) => reply(m, all)} onForward={() => forward(m)} onOpenDraft={() => compose({ mailboxId: t.mailboxId, draftId: m.id, to: m.to, cc: m.cc, bcc: m.bcc, subject: m.subject, text: m.text, attachments: m.attachments })} />
        ))}
        {canWrite && last && (
          <div className="flex gap-2 pt-1">
            <Button icon={<Reply size={15} />} onClick={() => reply(last, false)} data-testid="reply">
              Reply
            </Button>
            {last.to.length + last.cc.length > 1 && (
              <Button icon={<ReplyAll size={15} />} onClick={() => reply(last, true)} data-testid="reply-all">
                Reply all
              </Button>
            )}
            <Button icon={<Forward size={15} />} onClick={() => forward(last)} data-testid="forward">
              Forward
            </Button>
          </div>
        )}
        {!canWrite && <div className="rounded-xl border border-line bg-surface px-4 py-3 text-[13px] text-muted">You can read this shared mailbox. Editors of the space answer from it.</div>}
      </div>
    </div>
  );
}

function Assign({ t, users }: { t: MailThreadView; users: { id: string; name: string; avatarColor: string }[] }) {
  const { update } = useMailActions();
  return (
    <Menu>
      <MenuTrigger asChild>
        <button className="mr-1 flex h-8 items-center gap-1.5 rounded-lg px-2 text-[12.5px] text-ink-2 ring-1 ring-line hover:bg-hover" data-testid="assign">
          {t.assignee ? <Avatar user={t.assignee} size={18} /> : <UserRound size={15} />}
          {t.assignee ? t.assignee.name.split(' ')[0] : 'Assign'}
        </button>
      </MenuTrigger>
      <MenuContent align="end" className="max-h-80 overflow-y-auto">
        {t.assignee && <MenuItem onSelect={() => update.mutate({ id: t.id, assigneeId: null })}>Unassign</MenuItem>}
        {users.map((u) => (
          <MenuItem key={u.id} icon={<Avatar user={u} size={16} />} onSelect={() => update.mutate({ id: t.id, assigneeId: u.id })}>
            {u.name}
          </MenuItem>
        ))}
      </MenuContent>
    </Menu>
  );
}

function MessageCard({ m, expanded: initial, me, canWrite, onReply, onForward, onOpenDraft }: { m: MailMessageView; expanded: boolean; me?: string; canWrite: boolean; onReply: (all: boolean) => void; onForward: () => void; onOpenDraft: () => void }) {
  const [open, setOpen] = useState(initial);
  const { saveToDrive } = useMailActions();
  const sender = m.author ?? { name: m.from.name ?? m.from.address, avatarColor: m.external ? '#94a3b8' : '#2563eb' };
  if (m.status === 'draft')
    return (
      <button onClick={onOpenDraft} className="w-full rounded-xl border border-dashed border-red-200 bg-red-50/40 px-4 py-3 text-left text-[13px]" data-testid="draft-card">
        <span className="font-semibold text-red-600">Draft</span> <span className="text-muted">— {m.text.slice(0, 120) || 'empty'}</span>
      </button>
    );
  return (
    <article className="rounded-xl border border-line bg-surface shadow-[var(--shadow-card)]" data-testid="mail-message" data-direction={m.direction}>
      <button onClick={() => setOpen(!open)} className="flex w-full items-start gap-3 px-4 py-3 text-left">
        <Avatar user={sender} size={36} />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span className="truncate text-[14px] font-semibold text-ink">{m.author?.id === me ? 'You' : addrLabel(m.from)}</span>
            <span className="truncate text-[12px] text-muted">&lt;{m.from.address}&gt;</span>
            {m.external && <span className="rounded bg-amber-50 px-1.5 text-[10px] font-semibold text-amber-700">EXTERNAL</span>}
            {m.author && m.author.id !== me && m.from.address !== m.author.email && <span className="text-[11px] text-subtle">by {m.author.name}</span>}
            <span className="ml-auto shrink-0 text-[12px] text-subtle">{m.sentAt ? formatDateTime(m.sentAt) : ''}</span>
          </span>
          <span className="mt-0.5 block truncate text-[12px] text-muted">
            {open ? (
              <>
                to {m.to.map(addrLabel).join(', ') || '—'}
                {!!m.cc.length && <> · cc {m.cc.map(addrLabel).join(', ')}</>}
                {!!m.bcc.length && <> · bcc {m.bcc.map(addrLabel).join(', ')}</>}
              </>
            ) : (
              m.text.replace(/\s+/g, ' ').slice(0, 140)
            )}
          </span>
        </span>
      </button>
      {open && (
        <div className="px-4 pb-4 pl-[64px]">
          {m.html ? <HtmlBody html={m.html} /> : <TextBody text={m.text} />}
          {!!m.attachments.length && (
            <div className="mt-3 flex flex-wrap gap-2" data-testid="mail-attachments">
              {m.attachments.map((a) => (
                <span key={a.id} className="flex items-center gap-2 rounded-lg border border-line bg-canvas py-1.5 pl-2.5 pr-1 text-[12.5px]" data-testid="mail-attachment" data-name={a.name}>
                  <FileIcon2 size={15} className="text-muted" />
                  <span className="max-w-[200px] truncate">{a.name}</span>
                  <span className="text-[11px] text-subtle">{formatBytes(a.sizeBytes)}</span>
                  <a href={`${API_ORIGIN}/mail/attachments/${a.id}`} className="rounded p-1 text-muted hover:bg-hover hover:text-ink" aria-label={`Download ${a.name}`}>
                    <Download size={14} />
                  </a>
                  <button onClick={() => saveToDrive.mutate(a.id)} className="rounded p-1 text-muted hover:bg-hover hover:text-ink" aria-label={`Save ${a.name} to Drive`} title="Save to Drive">
                    <HardDriveUpload size={14} />
                  </button>
                </span>
              ))}
            </div>
          )}
          {canWrite && (
            <div className="mt-3 flex gap-1">
              <IconButton label="Reply" size={28} onClick={() => onReply(false)}>
                <Reply size={15} />
              </IconButton>
              <IconButton label="Reply all" size={28} onClick={() => onReply(true)}>
                <ReplyAll size={15} />
              </IconButton>
              <IconButton label="Forward" size={28} onClick={onForward}>
                <Forward size={15} />
              </IconButton>
            </div>
          )}
        </div>
      )}
    </article>
  );
}

function TextBody({ text }: { text: string }) {
  // Quoted lines ("> …") are folded under a toggle, as mail apps do.
  const lines = text.split('\n');
  const firstQuote = lines.findIndex((l, i) => l.startsWith('>') && (i === 0 || /wrote:$/.test(lines[i - 1]) || lines[i - 1].startsWith('>')));
  const head = firstQuote > 0 ? lines.slice(0, Math.max(0, firstQuote - 1)).join('\n') : text;
  const tail = firstQuote > 0 ? lines.slice(firstQuote - 1).join('\n') : '';
  const [show, setShow] = useState(false);
  const linked = useMemo(() => linkify(head), [head]);
  return (
    <div className="whitespace-pre-wrap text-[14px] leading-relaxed text-ink [overflow-wrap:anywhere]" data-testid="mail-body">
      {linked}
      {tail && (
        <>
          <button onClick={() => setShow(!show)} className="mt-2 block rounded bg-hover px-2 text-[12px] text-muted" aria-label="Show quoted text">
            •••
          </button>
          {show && <div className="mt-2 border-l-2 border-line pl-3 text-muted">{linkify(tail)}</div>}
        </>
      )}
    </div>
  );
}

function linkify(text: string) {
  const parts = text.split(/(https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"])/g);
  return parts.map((p, i) =>
    i % 2 ? (
      <a key={i} href={p} target="_blank" rel="noreferrer" className="text-brand-600 underline underline-offset-2">
        {p}
      </a>
    ) : (
      p
    ),
  );
}

/** Mail from outside is shown in a sandboxed frame: no scripts, links open in a new tab. */
function HtmlBody({ html }: { html: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [h, setH] = useState(120);
  const doc = `<!doctype html><html><head><base target="_blank"><meta charset="utf-8"><style>body{margin:0;font-family:Inter,Segoe UI,Arial,sans-serif;font-size:14px;line-height:1.5;color:#0f172a;overflow-wrap:anywhere}img{max-width:100%}</style></head><body>${html}</body></html>`;
  return (
    <iframe
      ref={ref}
      title="Message"
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      srcDoc={doc}
      className="w-full border-0"
      style={{ height: h }}
      onLoad={() => setH(Math.min(4000, (ref.current?.contentDocument?.body.scrollHeight ?? 100) + 16))}
      data-testid="mail-html"
    />
  );
}
