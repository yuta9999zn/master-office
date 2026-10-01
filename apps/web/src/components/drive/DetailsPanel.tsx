'use client';

import type { ActivityEvent, Resource, Space } from '@workos/shared';
import { can } from '@workos/shared';
import { MoreHorizontal, Plus, X } from 'lucide-react';
import Link from 'next/link';
import { Tabs } from 'radix-ui';
import { useEffect, useState, type ReactNode } from 'react';
import { describe } from '@/lib/activity';
import { formatBytes, formatDateTime, timeAgo } from '@/lib/format';
import { useResource, useResourceActions, useResourceActivity, useResourceMembers, useResourceVersions, useSpaceActivity, useSpaceMembers } from '@/lib/queries';
import { hrefFor, ROLE_LABEL, typeLabel } from '@/lib/resources';
import { SpaceBadge } from '../shell/Sidebar';
import { Avatar, Button, Chip, FileIcon, IconButton, Skeleton } from '../ui/primitives';
import { type Action, DropdownActions } from './actions';
import { DropdownMenu as DM } from 'radix-ui';

const TAG_COLORS = ['#8b5cf6', '#2563eb', '#10b981', '#f97316', '#ec4899', '#0ea5e9'];
const tagColor = (t: string) => TAG_COLORS[[...t].reduce((a, c) => a + c.charCodeAt(0), 0) % TAG_COLORS.length];

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[92px_1fr] gap-2 py-1.5 text-[13px]">
      <span className="text-muted">{label}</span>
      <span className="min-w-0 break-words text-ink">{children}</span>
    </div>
  );
}

export function ActivityList({ events, loading }: { events?: ActivityEvent[]; loading?: boolean }) {
  if (loading) return <div className="space-y-3 p-1">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-10" />)}</div>;
  if (!events?.length) return <div className="py-8 text-center text-[13px] text-muted">No activity yet</div>;
  return (
    <ol className="space-y-3.5">
      {events.map((e) => {
        const d = describe(e);
        return (
          <li key={e.id} className="flex gap-2.5">
            {e.actor ? <Avatar user={e.actor} size={28} /> : <span className="size-7 rounded-full bg-hover" />}
            <div className="min-w-0 text-[13px] leading-snug">
              <div>
                <span className="font-medium text-ink">{e.actor?.name ?? 'System'}</span> <span className="text-muted">{d.verb}</span>{' '}
                {d.object &&
                  (e.resourceId && e.action !== 'resource.deleted' ? (
                    <Link href={hrefFor({ id: e.resourceId, type: (e.data.type as Resource['type']) ?? 'file', metadata: {} })} className="text-brand-600 hover:underline">
                      {d.object}
                    </Link>
                  ) : (
                    <span className="text-ink">{d.object}</span>
                  ))}
                {d.extra && <span className="text-muted"> {d.extra}</span>}
              </div>
              <div className="mt-0.5 text-[12px] text-subtle">{timeAgo(e.createdAt)}</div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export function TagEditor({ r }: { r: Resource }) {
  const { update } = useResourceActions();
  const [adding, setAdding] = useState(false);
  const [value, setValue] = useState('');
  const editable = can(r.myRole, 'editor');
  const save = (tags: string[]) => update.mutate({ id: r.id, tags });
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {r.tags.map((t) => (
        <Chip key={t} color={tagColor(t)} onRemove={editable ? () => save(r.tags.filter((x) => x !== t)) : undefined}>
          {t}
        </Chip>
      ))}
      {editable &&
        (adding ? (
          <input
            autoFocus
            className="h-6 w-24 rounded-full border border-line-strong px-2.5 text-[12px] outline-none focus:border-brand-600"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onBlur={() => {
              if (value.trim()) save([...r.tags, value.trim()]);
              setAdding(false);
              setValue('');
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              if (e.key === 'Escape') {
                setValue('');
                setAdding(false);
              }
            }}
          />
        ) : (
          <button onClick={() => setAdding(true)} className="flex size-6 items-center justify-center rounded-full text-muted hover:bg-hover" aria-label="Add tag">
            <Plus size={14} />
          </button>
        ))}
      {!r.tags.length && !editable && <span className="text-muted">—</span>}
    </div>
  );
}

function DescriptionEditor({ r }: { r: Resource }) {
  const { update } = useResourceActions();
  const [value, setValue] = useState(r.description ?? '');
  useEffect(() => setValue(r.description ?? ''), [r.id, r.description]);
  if (!can(r.myRole, 'editor')) return <p className="text-[13px] text-ink-2">{r.description || <span className="text-muted">No description</span>}</p>;
  return (
    <textarea
      value={value}
      placeholder="Add a description…"
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => value !== (r.description ?? '') && update.mutate({ id: r.id, description: value || null })}
      className="min-h-[52px] w-full resize-none rounded-lg border border-transparent bg-transparent px-2 py-1.5 text-[13px] text-ink-2 outline-none -mx-2 hover:border-line focus:border-brand-600 focus:bg-surface"
    />
  );
}

const TabList = ({ items }: { items: string[] }) => (
  <Tabs.List className="flex gap-6 border-b border-line px-5">
    {items.map((t) => (
      <Tabs.Trigger key={t} value={t.toLowerCase()} className="tab">
        {t}
      </Tabs.Trigger>
    ))}
  </Tabs.List>
);

function PanelShell({ onClose, header, children }: { onClose: () => void; header: ReactNode; children: ReactNode }) {
  return (
    <aside className="flex w-[330px] shrink-0 flex-col border-l border-line bg-surface">
      <div className="flex justify-end px-3 pt-3">
        <IconButton label="Close details" onClick={onClose} size={28}>
          <X size={16} />
        </IconButton>
      </div>
      {header}
      {children}
    </aside>
  );
}

// ── Resource ─────────────────────────────────────────────────────────────────

export function ResourceDetails({ id, onClose, onShare, actions }: { id: string; onClose: () => void; onShare: (r: Resource) => void; actions: (r: Resource) => Action[] }) {
  const { data: r, isLoading } = useResource(id);
  const [tab, setTab] = useState('details');
  const { data: members } = useResourceMembers(tab === 'members' ? id : null);
  const { data: activity, isLoading: loadingActivity } = useResourceActivity(tab === 'activity' ? id : null);
  const { data: versions } = useResourceVersions(tab === 'details' && r?.mimeType ? id : null);

  if (isLoading || !r) {
    return (
      <PanelShell onClose={onClose} header={<div className="space-y-2 px-5 pb-4"><Skeleton className="size-12" /><Skeleton className="h-5 w-40" /></div>}>
        <div />
      </PanelShell>
    );
  }
  const location = r.breadcrumb.map((b) => b.name).join(' / ');
  const permission = r.generalAccess === 'workspace' ? `Everyone ${ROLE_LABEL[r.generalRole ?? 'viewer'].toLowerCase()}` : r.spaceId ? 'Space members' : 'Only people with access';

  return (
    <PanelShell
      onClose={onClose}
      header={
        <div className="px-5 pb-4">
          <div className="flex items-start gap-3">
            <FileIcon r={r} size={44} className="rounded-lg" />
            <div className="min-w-0 flex-1">
              <div className="break-words text-[16px] font-semibold leading-snug text-ink">{r.name}</div>
              <div className="mt-0.5 text-[12px] text-muted">
                {typeLabel(r)}
                {r.type !== 'folder' && r.sizeBytes ? ` · ${formatBytes(r.sizeBytes)}` : ''}
              </div>
            </div>
          </div>
          <div className="mt-3 flex gap-2">
            <Button variant="soft" size="sm" className="px-5" onClick={() => onShare(r)}>
              Share
            </Button>
            <DM.Root>
              <DM.Trigger asChild>
                <Button size="sm" aria-label="More">
                  <MoreHorizontal size={16} />
                </Button>
              </DM.Trigger>
              <DM.Portal>
                <DM.Content sideOffset={4} className="pop z-50 min-w-[210px] animate-pop" onCloseAutoFocus={(e) => e.preventDefault()}>
                  <DropdownActions actions={actions(r).filter((a) => a.id !== 'details')} />
                </DM.Content>
              </DM.Portal>
            </DM.Root>
          </div>
        </div>
      }
    >
      <Tabs.Root value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col">
        <TabList items={['Details', 'Members', 'Activity']} />
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <Tabs.Content value="details" className="space-y-4">
            <div>
              <div className="mb-1 text-[12px] font-medium text-muted">Description</div>
              <DescriptionEditor r={r} />
            </div>
            <div className="border-t border-line pt-3">
              <Field label="Type">{typeLabel(r) === 'Folder' ? 'Folder' : `${typeLabel(r)} ${r.mimeType ? '(original file)' : ''}`}</Field>
              <Field label="Location">{location}</Field>
              <Field label="Owner">{r.owner?.name}</Field>
              <Field label="Created">{formatDateTime(r.createdAt)}</Field>
              <Field label="Modified">{formatDateTime(r.updatedAt)}</Field>
              <Field label="Permission">{permission}</Field>
              <Field label="Your access">{ROLE_LABEL[r.myRole ?? 'viewer']}</Field>
            </div>
            <div className="border-t border-line pt-3">
              <div className="mb-2 text-[12px] font-medium text-muted">Tags</div>
              <TagEditor r={r} />
            </div>
            {!!versions?.length && (
              <div className="border-t border-line pt-3">
                <div className="mb-2 text-[12px] font-medium text-muted">Version history</div>
                {versions.map((v) => (
                  <div key={v.id} className="flex items-center justify-between py-1 text-[13px]">
                    <span>
                      v{v.version} · {v.label ?? 'Version'}
                    </span>
                    <span className="text-muted">{formatDateTime(v.createdAt)}</span>
                  </div>
                ))}
              </div>
            )}
            {!!r.metadata?.import && (
              <div className="rounded-lg bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
                Office file kept as the original. It will be imported into the native editor when the converter ships (docs/ARCHITECTURE.md §8).
              </div>
            )}
          </Tabs.Content>
          <Tabs.Content value="members" className="space-y-1">
            {members?.map((m) => (
              <div key={m.principal.id} className="flex items-center gap-2.5 py-1.5">
                <Avatar user={m.principal} size={30} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] text-ink">{m.principal.name}</div>
                  <div className="truncate text-[11px] text-muted">{m.source === 'space' ? `via ${m.sourceName}` : m.source === 'inherited' ? `from ${m.sourceName}` : m.principal.title}</div>
                </div>
                <span className="text-[12px] text-muted">{ROLE_LABEL[m.role]}</span>
              </div>
            ))}
          </Tabs.Content>
          <Tabs.Content value="activity">
            <ActivityList events={activity} loading={loadingActivity} />
          </Tabs.Content>
        </div>
      </Tabs.Root>
    </PanelShell>
  );
}

// ── Space ────────────────────────────────────────────────────────────────────

export function SpaceDetails({ space, onClose }: { space: Space; onClose: () => void }) {
  const [tab, setTab] = useState('details');
  const { data: members } = useSpaceMembers(space.id);
  const { data: activity, isLoading } = useSpaceActivity(tab === 'activity' ? space.id : undefined);
  return (
    <PanelShell
      onClose={onClose}
      header={
        <div className="px-5 pb-4">
          <div className="flex items-center gap-3">
            <SpaceBadge space={space} size={44} />
            <div>
              <div className="text-[16px] font-semibold text-ink">{space.name}</div>
              <div className="text-[12px] text-muted">Space · {space.memberCount ?? members?.length ?? 0} members</div>
            </div>
          </div>
          <Link href={`/spaces/${space.id}`} className="mt-3 inline-flex h-8 items-center rounded-lg bg-brand-50 px-4 text-[13px] font-medium text-brand-600 hover:bg-brand-100">
            Open space
          </Link>
        </div>
      }
    >
      <Tabs.Root value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col">
        <TabList items={['Details', 'Members', 'Activity']} />
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <Tabs.Content value="details">
            <p className="mb-3 text-[13px] text-ink-2">{space.description}</p>
            <Field label="Created">{formatDateTime(space.createdAt)}</Field>
            <Field label="Your role">{space.myRole ? ROLE_LABEL[space.myRole] : '—'}</Field>
            <Field label="Members">{space.memberCount}</Field>
          </Tabs.Content>
          <Tabs.Content value="members" className="space-y-1">
            {members?.map((m) => (
              <div key={m.user.id} className="flex items-center gap-2.5 py-1.5">
                <Avatar user={m.user} size={30} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] text-ink">{m.user.name}</div>
                  <div className="truncate text-[11px] text-muted">{m.user.title}</div>
                </div>
                <span className="text-[12px] text-muted">{ROLE_LABEL[m.role]}</span>
              </div>
            ))}
          </Tabs.Content>
          <Tabs.Content value="activity">
            <ActivityList events={activity} loading={isLoading} />
          </Tabs.Content>
        </div>
      </Tabs.Root>
    </PanelShell>
  );
}
