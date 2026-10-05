'use client';

import { Check, Hash, Lock, Search } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useChannels, useChatActions } from '@/lib/chat';
import { useMe, useSpaces, useUsers } from '@/lib/queries';
import { Avatar, Button, Chip, cn, Dialog, EmptyState } from '../ui/primitives';
import { ConversationAvatar } from './bits';

/** Search-and-tick list of workspace people (yourself and `exclude` left out). */
export function PeoplePicker({ selected, onChange, exclude = [], single }: { selected: string[]; onChange: (ids: string[]) => void; exclude?: string[]; single?: boolean }) {
  const { data: users } = useUsers();
  const { data: me } = useMe();
  const [q, setQ] = useState('');
  const skip = new Set([...exclude, me?.user.id]);
  const needle = q.trim().toLowerCase();
  const list = (users ?? []).filter((u) => !skip.has(u.id) && (!needle || u.name.toLowerCase().includes(needle) || u.email.includes(needle) || (u.department ?? '').toLowerCase().includes(needle)));
  const byId = new Map((users ?? []).map((u) => [u.id, u]));
  const toggle = (id: string) => onChange(selected.includes(id) ? selected.filter((x) => x !== id) : single ? [id] : [...selected, id]);
  return (
    <div>
      {!!selected.length && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {selected.map((id) => (
            <Chip key={id} onRemove={() => toggle(id)}>
              {byId.get(id)?.name}
            </Chip>
          ))}
        </div>
      )}
      <label className="flex h-9 items-center gap-2 rounded-lg border border-line-strong px-3 text-[13px] focus-within:border-brand-500">
        <Search size={15} className="text-subtle" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search people by name, e-mail or department" className="min-w-0 flex-1 bg-transparent outline-none" aria-label="Search people" />
      </label>
      <ul className="mt-2 max-h-64 overflow-y-auto" data-testid="people-picker">
        {list.map((u) => {
          const on = selected.includes(u.id);
          return (
            <li key={u.id}>
              <button type="button" onClick={() => toggle(u.id)} className={cn('flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-hover', on && 'bg-selected')} aria-pressed={on} data-name={u.name}>
                <Avatar user={u} size={30} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium text-ink">{u.name}</span>
                  <span className="block truncate text-[11.5px] text-muted">{[u.title, u.department].filter(Boolean).join(' · ')}</span>
                </span>
                {on && <Check size={16} className="text-brand-600" />}
              </button>
            </li>
          );
        })}
        {!list.length && <li className="px-2 py-4 text-center text-[13px] text-muted">No one found</li>}
      </ul>
    </div>
  );
}

/** One person → a direct message; several → a group (optionally named). */
export function NewMessageDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [picked, setPicked] = useState<string[]>([]);
  const [name, setName] = useState('');
  const { create } = useChatActions();
  const router = useRouter();
  const close = () => (onOpenChange(false), setPicked([]), setName(''));
  const go = async () => {
    const r = await create.mutateAsync(picked.length === 1 ? { kind: 'dm', userId: picked[0] } : { kind: 'group', memberIds: picked, name: name.trim() || null });
    close();
    router.push(`/chat/${r.id}`);
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => (v ? onOpenChange(true) : close())}
      title="New message"
      description="Pick one person for a direct message, or several to start a group."
      width={480}
      footer={
        <Button variant="primary" disabled={!picked.length} loading={create.isPending} onClick={go} data-testid="start-chat">
          {picked.length > 1 ? 'Create group' : 'Start chat'}
        </Button>
      }
    >
      {picked.length > 1 && (
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Group name (optional)" className="mb-3 h-9 w-full rounded-lg border border-line-strong px-3 text-[13px] outline-none focus:border-brand-500" aria-label="Group name" />
      )}
      <PeoplePicker selected={picked} onChange={setPicked} />
    </Dialog>
  );
}

export function NewChannelDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState<'public' | 'private'>('public');
  const [spaceId, setSpaceId] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const { data: spaces } = useSpaces();
  const { create } = useChatActions();
  const router = useRouter();
  const close = () => (onOpenChange(false), setName(''), setDescription(''), setVisibility('public'), setSpaceId(''), setPicked([]));
  const go = async () => {
    const r = await create.mutateAsync({ kind: 'channel', name: name.trim(), description: description.trim() || null, visibility, memberIds: picked, spaceId: spaceId || null });
    close();
    router.push(`/chat/${r.id}`);
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => (v ? onOpenChange(true) : close())}
      title="Create a channel"
      description="Channels are where a team, project or topic talks."
      width={520}
      footer={
        <Button variant="primary" disabled={!name.trim()} loading={create.isPending} onClick={go} data-testid="create-channel">
          Create channel
        </Button>
      }
    >
      <div className="space-y-3">
        <label className="block text-[12px] font-medium text-muted">
          Name
          <span className="mt-1 flex h-9 items-center gap-2 rounded-lg border border-line-strong px-3 focus-within:border-brand-500">
            {visibility === 'private' ? <Lock size={14} className="text-subtle" /> : <Hash size={14} className="text-subtle" />}
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Autumn campaign" maxLength={80} className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none" aria-label="Channel name" />
          </span>
        </label>
        <label className="block text-[12px] font-medium text-muted">
          Description <span className="font-normal">(optional)</span>
          <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What is this channel about?" className="mt-1 h-9 w-full rounded-lg border border-line-strong px-3 text-[13px] text-ink outline-none focus:border-brand-500" aria-label="Channel description" />
        </label>
        <div className="grid grid-cols-2 gap-2">
          {(['public', 'private'] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setVisibility(v)}
              aria-pressed={visibility === v}
              className={cn('rounded-xl border p-3 text-left', visibility === v ? 'border-brand-500 bg-brand-50' : 'border-line hover:bg-hover')}
            >
              <span className="flex items-center gap-1.5 text-[13px] font-semibold capitalize text-ink">
                {v === 'private' ? <Lock size={14} /> : <Hash size={14} />} {v}
              </span>
              <span className="mt-0.5 block text-[12px] text-muted">{v === 'public' ? 'Anyone in the workspace can find and join' : 'Only invited people can see it'}</span>
            </button>
          ))}
        </div>
        <label className="block text-[12px] font-medium text-muted">
          Space <span className="font-normal">(optional)</span>
          <select value={spaceId} onChange={(e) => setSpaceId(e.target.value)} className="mt-1 h-9 w-full rounded-lg border border-line-strong bg-surface px-2 text-[13px] text-ink" aria-label="Space">
            <option value="">None</option>
            {spaces?.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <div>
          <div className="mb-1 text-[12px] font-medium text-muted">Add people</div>
          <PeoplePicker selected={picked} onChange={setPicked} />
        </div>
      </div>
    </Dialog>
  );
}

export function BrowseChannelsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [q, setQ] = useState('');
  const { data, isLoading } = useChannels(q, open);
  const { join } = useChatActions();
  const router = useRouter();
  const openChannel = (id: string) => (onOpenChange(false), router.push(`/chat/${id}`));
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Browse channels" description="Public channels in your workspace." width={520}>
      <label className="flex h-9 items-center gap-2 rounded-lg border border-line-strong px-3 text-[13px] focus-within:border-brand-500">
        <Search size={15} className="text-subtle" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search channels" className="min-w-0 flex-1 bg-transparent outline-none" aria-label="Search channels" />
      </label>
      <ul className="mt-3 max-h-80 space-y-1 overflow-y-auto" data-testid="channel-directory">
        {data?.map((c) => (
          <li key={c.id} className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-hover" data-name={c.title}>
            <ConversationAvatar c={{ kind: 'channel', peer: null, faces: [], color: c.color, title: c.title, visibility: 'public' }} size={36} />
            <button onClick={() => openChannel(c.id)} className="min-w-0 flex-1 text-left">
              <span className="block truncate text-[14px] font-medium text-ink">{c.title}</span>
              <span className="block truncate text-[12px] text-muted">
                {c.memberCount} member{c.memberCount === 1 ? '' : 's'}
                {c.description ? ` · ${c.description}` : ''}
              </span>
            </button>
            {c.joined ? (
              <Button size="sm" variant="ghost" onClick={() => openChannel(c.id)}>
                Open
              </Button>
            ) : (
              <Button size="sm" variant="soft" loading={join.isPending && join.variables === c.id} onClick={async () => (await join.mutateAsync(c.id), openChannel(c.id))}>
                Join
              </Button>
            )}
          </li>
        ))}
        {!isLoading && !data?.length && <EmptyState title="No channels found" />}
      </ul>
    </Dialog>
  );
}
