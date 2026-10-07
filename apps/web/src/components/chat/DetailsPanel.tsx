'use client';

import type { ConversationDetail } from '@workos/shared';
import { Ellipsis, Mail, Search, ShieldCheck, UserPlus, X } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useChatActions, useChatSearch } from '@/lib/chat';
import { formatDate, formatShort } from '@/lib/format';
import { useMe, useUsers } from '@/lib/queries';
import { useIsOnline } from '@/lib/realtime';
import { Avatar, Button, Dialog, EmptyState, Menu, MenuContent, MenuItem, MenuTrigger } from '../ui/primitives';
import { ConversationAvatar, MessageText } from './bits';
import { usePeople } from '@/lib/contacts';
import { TeamTags } from '../contacts/TeamTags';
import { PeoplePicker } from './NewChatDialogs';

function PanelShell({ title, onClose, children, testId }: { title: string; onClose: () => void; children: React.ReactNode; testId: string }) {
  return (
    <aside className="flex w-[360px] shrink-0 flex-col border-l border-line bg-surface" data-testid={testId}>
      <div className="flex h-[68px] shrink-0 items-center justify-between border-b border-line px-5">
        <div className="text-[15px] font-semibold text-ink">{title}</div>
        <button onClick={onClose} className="rounded-md p-1.5 text-muted hover:bg-hover" aria-label="Close panel">
          <X size={16} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </aside>
  );
}

export function DetailsPanel({ conv, onClose }: { conv: ConversationDetail; onClose: () => void }) {
  const { data: me } = useMe();
  const { update, removeMember, setRole, addMembers } = useChatActions();
  const [adding, setAdding] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [name, setName] = useState(conv.kind === 'dm' ? '' : conv.title);
  const [description, setDescription] = useState(conv.description ?? '');
  const isAdmin = conv.perms.manage;
  const canRename = isAdmin;
  // Public channels hold the whole space; only private channels and groups have a member list to edit.
  const canAdd = conv.kind === 'group' || (conv.kind === 'channel' && conv.visibility === 'private' && isAdmin);
  const meId = me?.user.id;

  if (conv.kind === 'dm' && conv.peer) return <PeerCard conv={conv} onClose={onClose} />;

  return (
    <PanelShell title="Details" onClose={onClose} testId="details-panel">
      <div className="flex flex-col items-center border-b border-line px-5 py-5 text-center">
        <ConversationAvatar c={conv} size={56} />
        <div className="mt-2 text-[16px] font-semibold text-ink">{conv.title}</div>
        <div className="text-[12px] text-muted">
          {conv.kind === 'channel' ? `${conv.visibility === 'private' ? 'Private' : 'Public'} channel` : 'Group'} · created {formatDate(conv.createdAt)}
          {conv.createdBy ? ` by ${conv.createdBy.name}` : ''}
        </div>
      </div>
      {canRename && (
        <form
          className="space-y-2 border-b border-line px-5 py-4"
          onSubmit={(e) => {
            e.preventDefault();
            update.mutate({ id: conv.id, name: name.trim() || null, ...(conv.kind === 'channel' ? { description: description.trim() || null } : {}) });
          }}
        >
          <label className="block text-[12px] font-medium text-muted">
            Name
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder={conv.kind === 'group' ? 'Name this group' : 'Channel name'} className="mt-1 h-9 w-full rounded-lg border border-line-strong px-2.5 text-[13px] text-ink outline-none focus:border-brand-500" aria-label="Conversation name" />
          </label>
          {conv.kind === 'channel' && (
            <label className="block text-[12px] font-medium text-muted">
              Description
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className="mt-1 w-full resize-none rounded-lg border border-line-strong px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-brand-500" aria-label="Description" />
            </label>
          )}
          <div className="flex items-center justify-between gap-2">
            {conv.kind === 'channel' && isAdmin ? (
              <span className="space-y-1">
                <label className="flex items-center gap-2 text-[13px] text-ink-2">
                  <input type="checkbox" checked={conv.visibility === 'private'} onChange={(e) => update.mutate({ id: conv.id, visibility: e.target.checked ? 'private' : 'public' })} className="accent-brand-600" />
                  Private channel
                </label>
                <label className="flex items-center gap-2 text-[13px] text-ink-2">
                  <input type="checkbox" checked={conv.postPolicy === 'admins'} onChange={(e) => update.mutate({ id: conv.id, postPolicy: e.target.checked ? 'admins' : 'all' })} className="accent-brand-600" aria-label="Announcement channel" />
                  Announcement channel (only admins post)
                </label>
              </span>
            ) : (
              <span />
            )}
            <Button type="submit" size="sm" variant="soft" loading={update.isPending}>
              Save
            </Button>
          </div>
        </form>
      )}
      {!canRename && conv.description && <p className="border-b border-line px-5 py-4 text-[13px] text-ink-2">{conv.description}</p>}

      <div className="px-5 py-4">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[13px] font-semibold text-ink">Members · {conv.members.length}</span>
          {canAdd && (
            <Button size="sm" variant="ghost" icon={<UserPlus size={15} />} onClick={() => setAdding(true)}>
              Add
            </Button>
          )}
        </div>
        <ul className="space-y-0.5" data-testid="member-list">
          {conv.members.map((m) => (
            <MemberRow
              key={m.id}
              m={m}
              me={meId}
              spaceId={conv.spaceId}
              canManage={isAdmin && m.id !== meId && m.role !== 'owner' && !(conv.kind === 'channel' && conv.visibility === 'public')}
              isChannel={conv.kind === 'channel'}
              onRole={(role) => setRole.mutate({ id: conv.id, userId: m.id, role })}
              onRemove={() => removeMember.mutate({ id: conv.id, userId: m.id })}
            />
          ))}
        </ul>
      </div>
      <Dialog
        open={adding}
        onOpenChange={(v) => (setAdding(v), setPicked([]))}
        title={`Add people to ${conv.title}`}
        footer={
          <Button
            variant="primary"
            disabled={!picked.length}
            loading={addMembers.isPending}
            onClick={async () => {
              await addMembers.mutateAsync({ id: conv.id, userIds: picked });
              setAdding(false);
              setPicked([]);
            }}
          >
            Add {picked.length || ''}
          </Button>
        }
      >
        <PeoplePicker selected={picked} onChange={setPicked} exclude={conv.members.map((m) => m.id)} />
      </Dialog>
    </PanelShell>
  );
}

function MemberRow({ m, me, canManage, isChannel, onRole, onRemove, spaceId }: { m: ConversationDetail['members'][number]; me?: string; canManage: boolean; isChannel: boolean; onRole: (r: 'admin' | 'member') => void; onRemove: () => void; spaceId?: string | null }) {
  const online = useIsOnline(m.id);
  const card = usePeople().get(m.id);
  return (
    <li className="group flex items-center gap-2.5 rounded-lg px-1.5 py-1.5 hover:bg-hover" data-testid="member" data-name={m.name}>
      <span className="relative">
        <Avatar user={m} size={30} />
        {online && <span className="absolute bottom-0 right-0 size-2.5 rounded-full border-2 border-white bg-emerald-500" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium text-ink">
          {m.name}
          {m.id === me && <span className="font-normal text-muted"> (you)</span>}
        </span>
        <span className="block truncate text-[11.5px] text-muted">{m.title ?? m.department ?? m.email}</span>
        {card && card.projects.length > 0 && <TeamTags teams={card.projects} prefer={[spaceId]} max={2} className="mt-0.5" />}
      </span>
      {m.role !== 'member' && (
        <span className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-medium capitalize text-brand-700">
          <ShieldCheck size={11} /> {m.role}
        </span>
      )}
      {canManage && (
        <Menu>
          <MenuTrigger asChild>
            <button className="rounded-md p-1 text-muted opacity-0 hover:bg-surface group-hover:opacity-100 data-[state=open]:opacity-100" aria-label={`Manage ${m.name}`}>
              <Ellipsis size={15} />
            </button>
          </MenuTrigger>
          <MenuContent align="end">
            {isChannel && (m.role === 'admin' ? <MenuItem onSelect={() => onRole('member')}>Remove admin</MenuItem> : <MenuItem onSelect={() => onRole('admin')}>Make admin</MenuItem>)}
            <MenuItem danger onSelect={onRemove}>
              Remove from conversation
            </MenuItem>
          </MenuContent>
        </Menu>
      )}
    </li>
  );
}

function PeerCard({ conv, onClose }: { conv: ConversationDetail; onClose: () => void }) {
  const p = conv.peer!;
  const online = useIsOnline(p.id);
  const card = usePeople().get(p.id);
  return (
    <PanelShell title="Profile" onClose={onClose} testId="details-panel">
      <div className="flex flex-col items-center px-5 py-6 text-center">
        <span className="relative">
          <Avatar user={p} size={72} />
          {online && <span className="absolute bottom-1 right-1 size-4 rounded-full border-2 border-white bg-emerald-500" />}
        </span>
        <div className="mt-3 text-[17px] font-semibold text-ink">{p.name}</div>
        <div className="text-[13px] text-muted">{[p.title, p.department].filter(Boolean).join(' · ')}</div>
        <div className="mt-1 text-[12px] text-subtle">{online ? 'Active now' : 'Away'}</div>
        {card && card.projects.length > 0 && <TeamTags teams={card.projects} max={8} links className="mt-3 justify-center" />}
        <Link href={`/contacts/${p.id}`} className="mt-3 rounded-lg border border-line-strong px-3 py-1.5 text-[13px] font-medium text-ink-2 hover:bg-hover" data-testid="view-profile">
          View profile
        </Link>
      </div>
      <dl className="space-y-3 border-t border-line px-5 py-4 text-[13px]">
        <div className="flex items-center gap-3">
          <Mail size={15} className="text-subtle" />
          <a href={`mailto:${p.email}`} className="text-brand-600 hover:underline">
            {p.email}
          </a>
        </div>
      </dl>
    </PanelShell>
  );
}

export function SearchPanel({ conv, onClose, onOpenThread }: { conv: ConversationDetail; onClose: () => void; onOpenThread: (mid: string) => void }) {
  const [q, setQ] = useState('');
  const { data, isFetching } = useChatSearch(conv.id, q);
  const { data: users } = useUsers();
  const { data: me } = useMe();
  const people = useMemo(() => new Map((users ?? []).map((u) => [u.id, u])), [users]);
  return (
    <PanelShell title="Search" onClose={onClose} testId="search-panel">
      <div className="p-4">
        <label className="flex h-9 items-center gap-2 rounded-lg bg-canvas px-3 text-[13px] ring-1 ring-line focus-within:ring-brand-500">
          <Search size={15} className="text-subtle" />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search in ${conv.title}`} className="min-w-0 flex-1 bg-transparent outline-none" aria-label="Search messages" />
        </label>
      </div>
      {q.trim().length > 1 && !isFetching && !data?.length && <EmptyState title="No messages found" />}
      <ul className="space-y-1 px-3 pb-4" data-testid="search-results">
        {data?.map((m) => (
          <li key={m.id}>
            <button onClick={() => onOpenThread(m.threadRootId ?? m.id)} className="w-full rounded-lg px-2 py-2 text-left hover:bg-hover">
              <div className="flex items-center gap-2 text-[12px]">
                {m.sender && <Avatar user={m.sender} size={18} />}
                <span className="font-medium text-ink-2">{m.sender?.name}</span>
                <span className="text-subtle">{formatShort(m.createdAt)}</span>
              </div>
              <div className="mt-1 line-clamp-3 text-[13px] text-ink">
                <MessageText body={m.body} people={people} me={me?.user.id} />
              </div>
            </button>
          </li>
        ))}
      </ul>
    </PanelShell>
  );
}
