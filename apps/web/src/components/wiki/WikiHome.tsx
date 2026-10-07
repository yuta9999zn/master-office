'use client';

import { can, WIKI_STATUS } from '@workos/shared';
import { BookOpen, Plus, Search } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { timeAgo } from '@/lib/format';
import { useSpaces } from '@/lib/queries';
import { STARTER_SETS, useWikiActions, useWikiRecent, useWikiSpaces, type StarterSet } from '@/lib/wiki';
import { Avatar, Button, cn, Dialog, EmptyState, Skeleton } from '../ui/primitives';

/** /wiki — every space you can read, recently updated pages, and a new space (§78). */
export function WikiHome() {
  const { data: spaces, isLoading } = useWikiSpaces();
  const { data: recent } = useWikiRecent();
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const shown = (spaces ?? []).filter((s) => `${s.name} ${s.key} ${s.description ?? ''}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="h-full overflow-y-auto" data-testid="wiki-home">
      <div className="mx-auto max-w-[1200px] p-6">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-xl bg-teal-50 text-teal-600">
            <BookOpen size={22} />
          </span>
          <div>
            <h1 className="text-[22px] font-bold text-ink">Wiki</h1>
            <p className="text-[13px] text-muted">Spaces of documentation — requirements, models, designs and know-how, written together</p>
          </div>
          <label className="ml-8 flex h-9 w-72 items-center gap-2 rounded-lg border border-line bg-surface px-3">
            <Search size={15} className="text-subtle" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a space" aria-label="Find a space" className="flex-1 bg-transparent text-[13px] outline-none" />
          </label>
          <Button variant="primary" className="ml-auto" icon={<Plus size={16} />} onClick={() => setCreating(true)} data-testid="create-space">
            Create space
          </Button>
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_340px]">
          <section>
            <h2 className="mb-2 text-[14px] font-semibold text-ink">Spaces</h2>
            {isLoading ? (
              <Skeleton className="h-40" />
            ) : shown.length ? (
              <div className="grid gap-3 sm:grid-cols-2">
                {shown.map((s) => (
                  <Link key={s.id} href={`/wiki/s/${s.id}`} className="card flex gap-3 p-4 transition hover:-translate-y-px hover:shadow-[var(--shadow-pop)]" data-testid="wiki-space" data-name={s.name}>
                    <span className="grid size-10 shrink-0 place-items-center rounded-lg text-[13px] font-bold text-white" style={{ background: s.color }}>
                      {s.key.slice(0, 2)}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-[14px] font-semibold text-ink">{s.name}</span>
                      <span className="block text-[11.5px] text-muted">
                        {s.key} · {s.pages} page{s.pages === 1 ? '' : 's'}
                        {s.projectId ? ' · project docs' : ''}
                        {s.updatedAt ? ` · updated ${timeAgo(s.updatedAt)}` : ''}
                      </span>
                      {s.description && <span className="mt-1 line-clamp-2 block text-[12.5px] text-ink-2">{s.description}</span>}
                    </span>
                  </Link>
                ))}
              </div>
            ) : (
              <EmptyState title={q ? 'No matching space' : 'No spaces yet'}>Create a space for a team or a project, starting from the business-analysis toolkit or a project set.</EmptyState>
            )}
          </section>
          <section>
            <h2 className="mb-2 text-[14px] font-semibold text-ink">Recently updated</h2>
            <ul className="card divide-y divide-line" data-testid="wiki-recent">
              {(recent ?? []).map((r) => (
                <li key={r.id}>
                  <Link href={`/wiki/s/${r.spaceId}?page=${r.id}`} className="flex items-start gap-2.5 px-3 py-2.5 hover:bg-hover">
                    {r.updatedBy ? <Avatar user={r.updatedBy} size={22} /> : <span className="size-[22px]" />}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium text-ink">{r.title}</span>
                      <span className="block text-[11.5px] text-muted">
                        {r.spaceName} · {timeAgo(r.updatedAt)}
                      </span>
                    </span>
                    {r.status && <span className="rounded px-1.5 text-[10.5px] font-semibold uppercase text-white" style={{ background: WIKI_STATUS[r.status as keyof typeof WIKI_STATUS].color }}>{WIKI_STATUS[r.status as keyof typeof WIKI_STATUS].label}</span>}
                  </Link>
                </li>
              ))}
              {!recent?.length && <li className="px-3 py-4 text-[12.5px] text-subtle">Nothing yet</li>}
            </ul>
          </section>
        </div>
      </div>
      {creating && <CreateSpaceDialog onClose={() => setCreating(false)} />}
    </div>
  );
}

const input = 'h-9 w-full rounded-lg border border-line-strong bg-surface px-3 text-[13px] outline-none focus:border-brand-500';

function CreateSpaceDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const a = useWikiActions();
  const { data: spaces } = useSpaces();
  const [name, setName] = useState('');
  const [key, setKey] = useState('');
  const [description, setDescription] = useState('');
  const [spaceId, setSpaceId] = useState('');
  const [set, setSet] = useState<StarterSet>('ba');
  const editable = (spaces ?? []).filter((s) => can(s.myRole, 'editor'));
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Create a space"
      width={600}
      footer={
        <Button
          variant="primary"
          disabled={!name.trim()}
          loading={a.createSpace.isPending}
          onClick={() => a.createSpace.mutate({ name, key: key || undefined, description: description || null, spaceId: spaceId || null, set }, { onSuccess: (s) => router.push(`/wiki/s/${s.id}`) })}
          data-testid="space-save"
        >
          Create space
        </Button>
      }
    >
      <div className="space-y-3 text-[13px]">
        <div className="grid grid-cols-[1fr_120px] gap-2">
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Space name (e.g. Loan system)" aria-label="Space name" className={input} />
          <input value={key} onChange={(e) => setKey(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} placeholder="KEY" maxLength={10} aria-label="Space key" className={input} />
        </div>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="What is this space for?" aria-label="Space description" className={cn(input, 'h-auto py-2')} />
        <label className="block">
          <span className="mb-1 block text-[12px] text-muted">Who can see it</span>
          <select value={spaceId} onChange={(e) => setSpaceId(e.target.value)} className={input} aria-label="Where">
            <option value="">Only me (My Files) — share it later</option>
            {editable.map((s) => (
              <option key={s.id} value={s.id}>
                Members of {s.name}
              </option>
            ))}
          </select>
        </label>
        <div>
          <p className="mb-1 text-[12px] text-muted">Start with</p>
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Starter pages">
            {STARTER_SETS.map((x) => (
              <button key={x.id} role="radio" aria-checked={set === x.id} onClick={() => setSet(x.id)} className={cn('rounded-lg p-2.5 text-left ring-1', set === x.id ? 'bg-selected ring-brand-400' : 'ring-line hover:bg-hover')} data-testid={`starter-${x.id}`}>
                <span className="block text-[13px] font-semibold text-ink">{x.name}</span>
                <span className="block text-[11.5px] text-muted">{x.note}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </Dialog>
  );
}
