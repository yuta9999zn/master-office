'use client';

import type { Resource, Role, Space } from '@workos/shared';
import { can } from '@workos/shared';
import { BookOpen, ChevronRight, Clock, FileStack, Folder, Globe2, Link2, Lock, Megaphone, MoreHorizontal, Search, Share2, Users } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState, type ReactNode } from 'react';
import { ActivityList } from '@/components/drive/DetailsPanel';
import { FileBrowser } from '@/components/drive/FileBrowser';
import { FileList } from '@/components/drive/FileViews';
import { SpaceBadge } from '@/components/shell/Sidebar';
import { Avatar, AvatarStack, Button, CardHeader, EmptyState, FileIcon, Skeleton } from '@/components/ui/primitives';
import { formatDate, formatDateTime } from '@/lib/format';
import { useResources, useSpace, useSpaceActions, useSpaceActivity, useSpaceMembers, useSpaces, useUsers } from '@/lib/queries';
import { hrefFor, ROLE_LABEL, typeLabel } from '@/lib/resources';

const TABS = ['Overview', 'Pages', 'Files', 'Knowledge', 'Members', 'Activity', 'Settings'] as const;
type Tab = (typeof TABS)[number];

function ViewAll({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex items-center gap-1 text-[13px] font-medium text-brand-600 hover:underline">
      View all <ChevronRight size={14} />
    </button>
  );
}

function ResourceRow({ r, sub }: { r: Resource; sub?: ReactNode }) {
  return (
    <Link href={hrefFor(r)} className="flex items-center gap-3 rounded-lg px-2.5 py-2 hover:bg-canvas">
      <FileIcon r={r} size={r.type === 'folder' ? 30 : 26} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[14px] font-medium text-ink">{r.name}</div>
        <div className="truncate text-[12px] text-muted">{sub ?? `${r.owner?.name} · ${formatDate(r.updatedAt)}`}</div>
      </div>
    </Link>
  );
}

function Overview({ space, children, go }: { space: Space; children: Space[]; go: (t: Tab) => void }) {
  const { data: root, isLoading } = useResources({ spaceId: space.id, sort: 'updatedAt', order: 'desc' });
  const { data: knowledge } = useResources({ spaceId: space.id, deep: true, type: 'wiki' });
  const { data: docs } = useResources({ spaceId: space.id, deep: true, type: 'document', sort: 'updatedAt', order: 'desc' });
  const { data: members } = useSpaceMembers(space.id);
  const { data: activity, isLoading: loadingActivity } = useSpaceActivity(space.id);
  const knowledgeItems = [...(knowledge ?? []), ...(docs ?? [])].slice(0, 6);

  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <section className="card">
        <CardHeader title="Announcements" icon={<Megaphone size={18} className="text-brand-600" />} />
        <EmptyState icon={<Megaphone size={28} />} title="No announcements yet">
          Space announcements are posted from Chat channels (Phase 5).
        </EmptyState>
      </section>

      <section className="card">
        <CardHeader title="Quick Links" icon={<Link2 size={18} className="text-brand-600" />} />
        <div className="px-2 pb-2">
          {children.map((c) => (
            <Link key={c.id} href={`/spaces/${c.id}`} className="flex items-center gap-3 rounded-lg px-2.5 py-2 hover:bg-canvas">
              <SpaceBadge space={c} size={34} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[14px] font-medium text-ink">{c.name}</div>
                <div className="truncate text-[12px] text-muted">{c.description}</div>
              </div>
              <ChevronRight size={16} className="text-subtle" />
            </Link>
          ))}
          {(docs ?? []).slice(0, Math.max(0, 5 - children.length)).map((r) => (
            <ResourceRow key={r.id} r={r} sub={r.description ?? typeLabel(r)} />
          ))}
          {!children.length && !docs?.length && <EmptyState title="Nothing pinned yet" />}
        </div>
      </section>

      <section className="card">
        <CardHeader title="Team Members" icon={<Users size={18} className="text-brand-600" />} action={<ViewAll onClick={() => go('Members')} />} />
        <div className="px-2 pb-2">
          {members?.slice(0, 6).map((m) => (
            <div key={m.user.id} className="flex items-center gap-3 rounded-lg px-2.5 py-1.5">
              <Avatar user={m.user} size={36} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[14px] font-medium text-ink">{m.user.name}</div>
                <div className="truncate text-[12px] text-muted">{m.user.title}</div>
              </div>
              <span className="rounded-full bg-canvas px-2 py-0.5 text-[11px] font-medium text-muted">{ROLE_LABEL[m.role]}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="card">
        <CardHeader title="Shared Files" icon={<Folder size={18} className="text-amber-500" />} action={<ViewAll onClick={() => go('Files')} />} />
        <div className="px-2 pb-2">
          {isLoading ? <Skeleton className="mx-2 h-40" /> : root?.length ? root.slice(0, 6).map((r) => <ResourceRow key={r.id} r={r} />) : <EmptyState title="No files yet" />}
        </div>
      </section>

      <section className="card">
        <CardHeader title="Team Knowledge" icon={<BookOpen size={18} className="text-violet-brand" />} action={<ViewAll onClick={() => go('Knowledge')} />} />
        <div className="px-2 pb-2">
          {knowledgeItems.length ? knowledgeItems.map((r) => <ResourceRow key={r.id} r={r} sub={r.description ?? `${typeLabel(r)} · ${formatDate(r.updatedAt)}`} />) : <EmptyState title="No knowledge pages yet" />}
        </div>
      </section>

      <section className="card">
        <CardHeader title="Recent Activity" icon={<Clock size={18} className="text-brand-600" />} action={<ViewAll onClick={() => go('Activity')} />} />
        <div className="px-4 pb-4">
          <ActivityList events={activity?.slice(0, 5)} loading={loadingActivity} />
        </div>
      </section>
    </div>
  );
}

function TypedList({ space, types, emptyTitle }: { space: Space; types: Resource['type'][]; emptyTitle: string }) {
  const router = useRouter();
  const { data: a } = useResources({ spaceId: space.id, deep: true, type: types[0] });
  const { data: b } = useResources(types[1] ? { spaceId: space.id, deep: true, type: types[1] } : null);
  const items = [...(a ?? []), ...(b ?? [])];
  if (!items.length) return <div className="card"><EmptyState icon={<FileStack size={30} />} title={emptyTitle} /></div>;
  return (
    <div className="card overflow-hidden px-4">
      <FileList
        items={items}
        selected={new Set()}
        onSelect={(_, r) => router.push(hrefFor(r))}
        onOpen={(r) => router.push(hrefFor(r))}
        actionsFor={() => []}
        onContextSelect={() => undefined}
        sort={{}}
        onSort={() => undefined}
      />
    </div>
  );
}

function Members({ space }: { space: Space }) {
  const { data: members } = useSpaceMembers(space.id);
  const { data: users } = useUsers();
  const { setMember } = useSpaceActions();
  const [pick, setPick] = useState('');
  const [role, setRole] = useState<Role>('editor');
  const admin = can(space.myRole, 'admin');
  const candidates = users?.filter((u) => !members?.some((m) => m.user.id === u.id)) ?? [];
  return (
    <div className="card max-w-3xl">
      {admin && (
        <div className="flex gap-2 border-b border-line p-4">
          <select className="input" value={pick} onChange={(e) => setPick(e.target.value)}>
            <option value="">Add a member…</option>
            {candidates.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} — {u.title}
              </option>
            ))}
          </select>
          <select className="input w-44" value={role} onChange={(e) => setRole(e.target.value as Role)}>
            {(['viewer', 'commenter', 'editor', 'admin'] as Role[]).map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </select>
          <Button variant="primary" disabled={!pick} loading={setMember.isPending} onClick={() => setMember.mutate({ spaceId: space.id, userId: pick, role }, { onSuccess: () => setPick('') })}>
            Add
          </Button>
        </div>
      )}
      <div className="p-2">
        {members?.map((m) => (
          <div key={m.user.id} className="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-canvas">
            <Avatar user={m.user} size={36} />
            <div className="min-w-0 flex-1">
              <div className="text-[14px] font-medium text-ink">{m.user.name}</div>
              <div className="text-[12px] text-muted">
                {m.user.title} · {m.user.email}
              </div>
            </div>
            {admin && m.role !== 'owner' ? (
              <select
                value={m.role}
                onChange={(e) => setMember.mutate({ spaceId: space.id, userId: m.user.id, role: e.target.value === '__remove' ? null : (e.target.value as Role) })}
                className="h-8 rounded-md bg-transparent px-1.5 text-[13px] text-ink-2 outline-none hover:bg-hover"
              >
                {(['viewer', 'commenter', 'editor', 'admin'] as Role[]).map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABEL[r]}
                  </option>
                ))}
                <option value="__remove">Remove</option>
              </select>
            ) : (
              <span className="px-2 text-[13px] text-muted">{ROLE_LABEL[m.role]}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function SpaceView() {
  const { id } = useParams<{ id: string }>();
  const params = useSearchParams();
  const router = useRouter();
  const tab = (TABS.find((t) => t.toLowerCase() === params.get('tab')) ?? 'Overview') as Tab;
  const go = (t: Tab) => router.replace(`/spaces/${id}${t === 'Overview' ? '' : `?tab=${t.toLowerCase()}`}`, { scroll: false });
  const { data: space, error } = useSpace(id);
  const { data: spaces } = useSpaces();
  const { data: members } = useSpaceMembers(id);
  const [q, setQ] = useState('');

  if (error) return <EmptyState title="Space not found">{(error as Error).message}</EmptyState>;
  if (!space) return <div className="p-6"><Skeleton className="h-56 rounded-2xl" /></div>;
  const children = spaces?.filter((s) => s.parentId === space.id) ?? [];
  const parent = spaces?.find((s) => s.id === space.parentId);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Top header */}
      <div className="flex h-16 shrink-0 items-center gap-3 border-b border-line bg-surface px-6">
        <SpaceBadge space={space} size={38} />
        <div className="min-w-0">
          <div className="flex items-center gap-1 text-[16px] font-semibold text-ink">
            {parent && (
              <>
                <Link href={`/spaces/${parent.id}`} className="font-normal text-muted hover:text-ink">
                  {parent.name}
                </Link>
                <ChevronRight size={15} className="text-subtle" />
              </>
            )}
            {space.name}
          </div>
          <div className="flex items-center gap-1.5 text-[12px] text-muted">
            {space.visibility === 'public' ? <Globe2 size={12} /> : <Lock size={12} />}
            {space.visibility === 'public' ? 'Public' : 'Private'} · {space.memberCount} members · Your role: {space.myRole ? ROLE_LABEL[space.myRole] : '—'}
          </div>
        </div>
        <div className="ml-auto flex items-center gap-3">
          {members && <AvatarStack users={members.map((m) => m.user)} max={3} total={members.length} size={32} />}
          <Button variant="primary" icon={<Share2 size={15} />} onClick={() => go('Members')}>
            Share
          </Button>
          <Button aria-label="More">
            <MoreHorizontal size={16} />
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* Banner */}
        <div className="px-6 pt-5">
          <div className="relative overflow-hidden rounded-2xl border border-line" style={{ background: `linear-gradient(120deg, ${space.color}1f, #eef3ff 45%, ${space.color}14)` }}>
            <div aria-hidden className="absolute -right-10 -top-16 size-72 rounded-full opacity-40 blur-2xl" style={{ background: space.color ?? '#2563eb' }} />
            <div className="relative flex items-center gap-6 px-8 pb-2 pt-7">
              <span className="flex size-24 items-center justify-center rounded-3xl bg-white shadow-sm">
                <SpaceBadge space={space} size={64} />
              </span>
              <div className="min-w-0 flex-1">
                <h1 className="text-[28px] font-bold tracking-tight text-ink">{space.name}</h1>
                <p className="mt-1 max-w-2xl text-[14px] text-ink-2/80">{space.description}</p>
              </div>
              <div className="hidden w-80 items-center gap-2 rounded-xl border border-line bg-white/90 px-3.5 lg:flex">
                <Search size={16} className="text-subtle" />
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && go('Files')}
                  placeholder="Search in this space"
                  className="h-10 flex-1 bg-transparent text-[13px] outline-none"
                />
              </div>
            </div>
            <div className="relative mt-3 flex gap-8 px-8">
              {TABS.map((t) => (
                <button key={t} className="tab h-11 text-[14px]" aria-current={tab === t ? 'page' : undefined} onClick={() => go(t)}>
                  {t}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="p-6">
          {tab === 'Overview' && <Overview space={space} children={children} go={go} />}
          {tab === 'Pages' && <TypedList space={space} types={['document']} emptyTitle="No pages yet" />}
          {tab === 'Knowledge' && <TypedList space={space} types={['wiki', 'base']} emptyTitle="No knowledge pages yet" />}
          {tab === 'Files' && (
            <div className="card h-[calc(100vh-340px)] min-h-[480px] overflow-hidden">
              <FileBrowser location={{ kind: 'space', id: space.id }} embedded />
            </div>
          )}
          {tab === 'Members' && <Members space={space} />}
          {tab === 'Activity' && (
            <div className="card max-w-3xl p-5">
              <SpaceActivity id={space.id} />
            </div>
          )}
          {tab === 'Settings' && (
            <div className="card max-w-2xl divide-y divide-line">
              {[
                ['Name', space.name],
                ['Description', space.description ?? '—'],
                ['Visibility', space.visibility === 'public' ? 'Public — everyone in the workspace can view' : 'Private — members only'],
                ['Parent space', parent?.name ?? 'None'],
                ['Created', formatDateTime(space.createdAt)],
              ].map(([k, v]) => (
                <div key={k} className="grid grid-cols-[160px_1fr] px-5 py-3.5 text-[13px]">
                  <span className="text-muted">{k}</span>
                  <span className="text-ink">{v}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SpaceActivity({ id }: { id: string }) {
  const { data, isLoading } = useSpaceActivity(id);
  return <ActivityList events={data} loading={isLoading} />;
}

export default function SpacePage() {
  return (
    <Suspense>
      <SpaceView />
    </Suspense>
  );
}
