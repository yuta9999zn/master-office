'use client';

import { Check, Hash, Lock, Megaphone, Search } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useCategories, useChatActions } from '@/lib/chat';
import { useMe, useUsers } from '@/lib/queries';
import { Avatar, Button, Chip, cn, Dialog } from '../ui/primitives';

/** Search-and-tick list of workspace people (yourself and `exclude` left out). */
export function PeoplePicker({ selected, onChange, exclude = [], single, max }: { selected: string[]; onChange: (ids: string[]) => void; exclude?: string[]; single?: boolean; max?: number }) {
  const { data: users } = useUsers();
  const { data: me } = useMe();
  const [q, setQ] = useState('');
  const skip = new Set([...exclude, me?.user.id]);
  const needle = q.trim().toLowerCase();
  const list = (users ?? []).filter((u) => !skip.has(u.id) && (!needle || u.name.toLowerCase().includes(needle) || u.email.includes(needle) || (u.department ?? '').toLowerCase().includes(needle)));
  const byId = new Map((users ?? []).map((u) => [u.id, u]));
  const toggle = (id: string) => onChange(selected.includes(id) ? selected.filter((x) => x !== id) : single ? [id] : max && selected.length >= max ? selected : [...selected, id]);
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
      description="One person for a direct message, or up to 9 for a group. Bigger teams talk in a space’s channels."
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
      <PeoplePicker selected={picked} onChange={setPicked} max={9} />
    </Dialog>
  );
}

/** A channel in the current space (space admins only — the button is hidden for everyone else). */
export function NewChannelDialog({ open, onOpenChange, spaceId, spaceName }: { open: boolean; onOpenChange: (v: boolean) => void; spaceId: string; spaceName: string }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState<'public' | 'private'>('public');
  const [announcements, setAnnouncements] = useState(false);
  const [categoryId, setCategoryId] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const { data: categories } = useCategories(open ? spaceId : null);
  const { create } = useChatActions();
  const router = useRouter();
  const close = () => (onOpenChange(false), setName(''), setDescription(''), setVisibility('public'), setAnnouncements(false), setCategoryId(''), setPicked([]));
  const go = async () => {
    const r = await create.mutateAsync({
      kind: 'channel',
      name: name.trim(),
      description: description.trim() || null,
      visibility,
      memberIds: visibility === 'private' ? picked : [],
      spaceId,
      categoryId: categoryId || null,
      postPolicy: announcements ? 'admins' : 'all',
    });
    close();
    router.push(`/chat/${r.id}`);
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => (v ? onOpenChange(true) : close())}
      title={`Create a channel in ${spaceName}`}
      description="Everyone in the space sees public channels; private ones only the people you add."
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
            {visibility === 'private' ? <Lock size={14} className="text-subtle" /> : announcements ? <Megaphone size={14} className="text-subtle" /> : <Hash size={14} className="text-subtle" />}
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. autumn-campaign" maxLength={80} className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none" aria-label="Channel name" />
          </span>
        </label>
        <label className="block text-[12px] font-medium text-muted">
          Description <span className="font-normal">(optional)</span>
          <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What is this channel about?" className="mt-1 h-9 w-full rounded-lg border border-line-strong px-3 text-[13px] text-ink outline-none focus:border-brand-500" aria-label="Channel description" />
        </label>
        <label className="block text-[12px] font-medium text-muted">
          Category
          <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="mt-1 h-9 w-full rounded-lg border border-line-strong bg-surface px-2 text-[13px] text-ink" aria-label="Category">
            <option value="">No category</option>
            {categories?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
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
              <span className="mt-0.5 block text-[12px] text-muted">{v === 'public' ? `Everyone in ${spaceName}` : 'Only the people you add (and space admins)'}</span>
            </button>
          ))}
        </div>
        <label className="flex items-start gap-2 rounded-lg border border-line px-3 py-2 text-[13px] text-ink-2">
          <input type="checkbox" checked={announcements} onChange={(e) => setAnnouncements(e.target.checked)} className="mt-0.5 accent-brand-600" aria-label="Announcement channel" />
          <span>
            <span className="font-medium text-ink">Announcement channel</span>
            <span className="block text-[12px] text-muted">Only admins post; everyone reads and reacts.</span>
          </span>
        </label>
        {visibility === 'private' && (
          <div>
            <div className="mb-1 text-[12px] font-medium text-muted">Add people from {spaceName}</div>
            <PeoplePicker selected={picked} onChange={setPicked} />
          </div>
        )}
      </div>
    </Dialog>
  );
}

export function NewCategoryDialog({ open, onOpenChange, spaceId }: { open: boolean; onOpenChange: (v: boolean) => void; spaceId: string }) {
  const [name, setName] = useState('');
  const { createCategory } = useChatActions();
  const close = () => (onOpenChange(false), setName(''));
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => (v ? onOpenChange(true) : close())}
      title="Create a category"
      description="Group related channels, like “Projects” or “Branches”."
      width={420}
      footer={
        <Button variant="primary" disabled={!name.trim()} loading={createCategory.isPending} onClick={async () => (await createCategory.mutateAsync({ spaceId, name: name.trim() }), close())} data-testid="create-category">
          Create category
        </Button>
      }
    >
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Category name" maxLength={60} aria-label="Category name" className="h-9 w-full rounded-lg border border-line-strong px-3 text-[13px] outline-none focus:border-brand-500" />
    </Dialog>
  );
}
