'use client';

import type { GeneralAccess, Resource, Role } from '@workos/shared';
import { can } from '@workos/shared';
import { ChevronRight, Copy, Folder, Globe2, HardDrive, Lock } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { useMe, useResource, useResourceActions, useResourceMembers, useResources, useSpaces, useUsers } from '@/lib/queries';
import { hrefFor, ROLE_LABEL } from '@/lib/resources';
import { SpaceBadge } from '../shell/Sidebar';
import { Avatar, Button, cn, Dialog, FileIcon } from '../ui/primitives';

const SHARE_ROLES: Role[] = ['viewer', 'commenter', 'editor', 'admin'];

function RoleSelect({ value, onChange, allowRemove, disabled }: { value: Role; onChange: (r: Role | null) => void; allowRemove?: boolean; disabled?: boolean }) {
  return (
    <select
      disabled={disabled}
      value={value}
      onChange={(e) => onChange(e.target.value === '__remove' ? null : (e.target.value as Role))}
      className="h-8 rounded-md bg-transparent px-1.5 text-[13px] text-ink-2 outline-none hover:bg-hover disabled:hover:bg-transparent"
    >
      {SHARE_ROLES.map((r) => (
        <option key={r} value={r}>
          {ROLE_LABEL[r]}
        </option>
      ))}
      {allowRemove && <option value="__remove">Remove access</option>}
    </select>
  );
}

// ── Share ────────────────────────────────────────────────────────────────────

export function ShareDialog({ resource, onClose }: { resource: Resource | null; onClose: () => void }) {
  const id = resource?.id;
  const { data: detail } = useResource(id);
  const { data: members } = useResourceMembers(id);
  const { data: users } = useUsers();
  const { data: me } = useMe();
  const { share, update } = useResourceActions();
  const [query, setQuery] = useState('');
  const [role, setRole] = useState<Role>('editor');

  const canManage = can(detail?.myRole ?? resource?.myRole, 'admin');
  const memberIds = new Set(members?.map((m) => m.principal.id));
  const candidates = useMemo(
    () =>
      query.trim()
        ? (users ?? []).filter((u) => !memberIds.has(u.id) && (u.name.toLowerCase().includes(query.toLowerCase()) || u.email.toLowerCase().includes(query.toLowerCase()))).slice(0, 6)
        : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [query, users, members],
  );

  const access: GeneralAccess = detail?.generalAccess ?? 'restricted';
  const copyLink = async () => {
    if (!resource) return;
    await navigator.clipboard.writeText(`${window.location.origin}${hrefFor(resource)}`);
    toast.success('Link copied');
  };

  return (
    <Dialog
      open={!!resource}
      onOpenChange={(v) => !v && onClose()}
      width={520}
      title={
        <span className="block max-w-[420px] truncate">Share “{resource?.name}”</span>
      }
      footer={
        <div className="flex w-full items-center justify-between">
          <Button icon={<Copy size={15} />} onClick={copyLink}>
            Copy link
          </Button>
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        </div>
      }
    >
      {canManage ? (
        <div className="relative mb-4 flex gap-2">
          <input className="input" placeholder="Add members, groups, or email" value={query} onChange={(e) => setQuery(e.target.value)} />
          <select value={role} onChange={(e) => setRole(e.target.value as Role)} className="input w-40 shrink-0">
            {SHARE_ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </select>
          {!!candidates.length && (
            <div className="pop absolute left-0 right-44 top-10 z-10">
              {candidates.map((u) => (
                <button
                  key={u.id}
                  className="menu-item w-full hover:bg-hover"
                  onClick={async () => {
                    await share.mutateAsync({ id: id!, userId: u.id, role });
                    toast.success(`${u.name} can now ${ROLE_LABEL[role].toLowerCase().replace('can ', '')}`);
                    setQuery('');
                  }}
                >
                  <Avatar user={u} size={24} />
                  <span className="flex-1 text-left">
                    <span className="block text-[13px] text-ink">{u.name}</span>
                    <span className="block text-[11px] text-muted">{u.email}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <p className="mb-4 rounded-lg bg-canvas px-3 py-2 text-[12px] text-muted">You can view who has access. Ask an owner or admin to change sharing.</p>
      )}

      <div className="mb-1 text-[12px] font-medium text-muted">People with access</div>
      <div className="-mx-2 max-h-64 overflow-auto">
        {members?.map((m) => (
          <div key={m.principal.id} className="flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-canvas">
            <Avatar user={m.principal} size={30} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] text-ink">
                {m.principal.name}
                {m.principal.id === me?.user.id && <span className="text-muted"> (you)</span>}
              </div>
              <div className="truncate text-[11px] text-muted">
                {m.source === 'space' ? `Via space · ${m.sourceName}` : m.source === 'inherited' ? `Inherited from ${m.sourceName}` : m.principal.email}
              </div>
            </div>
            {m.source === 'direct' && canManage ? (
              <RoleSelect value={m.role} allowRemove onChange={(r) => share.mutate({ id: id!, userId: m.principal.id, role: r })} />
            ) : (
              <span className="px-2 text-[13px] text-muted">{ROLE_LABEL[m.role]}</span>
            )}
          </div>
        ))}
      </div>

      <div className="mb-1 mt-4 text-[12px] font-medium text-muted">General access</div>
      <div className="flex items-center gap-3 rounded-lg border border-line px-3 py-2.5">
        <span className={cn('flex size-8 items-center justify-center rounded-full', access === 'restricted' ? 'bg-hover text-muted' : 'bg-emerald-50 text-emerald-600')}>
          {access === 'restricted' ? <Lock size={16} /> : <Globe2 size={16} />}
        </span>
        <div className="flex-1">
          <select
            disabled={!canManage}
            value={access}
            onChange={(e) => update.mutate({ id: id!, generalAccess: e.target.value as GeneralAccess })}
            className="-ml-1 rounded-md bg-transparent px-1 text-[13px] font-medium text-ink outline-none hover:bg-hover"
          >
            <option value="restricted">Restricted</option>
            <option value="workspace">Anyone in {me?.workspace?.name ?? 'the workspace'}</option>
          </select>
          <div className="text-[11px] text-muted">
            {access === 'restricted' ? 'Only people with access can open' : 'Anyone in the organisation can find and open'}
          </div>
        </div>
        {access !== 'restricted' && (
          <RoleSelect disabled={!canManage} value={detail?.generalRole ?? 'viewer'} onChange={(r) => r && update.mutate({ id: id!, generalRole: r })} />
        )}
      </div>
    </Dialog>
  );
}

// ── Rename ───────────────────────────────────────────────────────────────────

export function RenameDialog({ resource, onClose }: { resource: Resource | null; onClose: () => void }) {
  const { update } = useResourceActions();
  const [name, setName] = useState('');
  useEffect(() => setName(resource?.name ?? ''), [resource]);
  const submit = async () => {
    if (!resource || !name.trim() || name.trim() === resource.name) return onClose();
    await update.mutateAsync({ id: resource.id, name: name.trim() });
    onClose();
  };
  return (
    <Dialog
      open={!!resource}
      onOpenChange={(v) => !v && onClose()}
      title="Rename"
      width={420}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={update.isPending} onClick={submit} disabled={!name.trim()}>
            Rename
          </Button>
        </>
      }
    >
      <input
        autoFocus
        className="input"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
        onFocus={(e) => {
          const dot = e.target.value.lastIndexOf('.');
          e.target.setSelectionRange(0, dot > 0 && resource?.type !== 'folder' ? dot : e.target.value.length);
        }}
      />
    </Dialog>
  );
}

// ── Move / Copy ──────────────────────────────────────────────────────────────

type Dest = { kind: 'my' } | { kind: 'space'; id: string; name: string } | { kind: 'folder'; id: string; name: string; spaceName?: string };

export function MoveDialog({ items, mode, onClose }: { items: Resource[] | null; mode: 'move' | 'copy'; onClose: () => void }) {
  const { update, copy } = useResourceActions();
  const { data: spaces } = useSpaces();
  const [trail, setTrail] = useState<Dest[]>([]);
  const here = trail[trail.length - 1];
  useEffect(() => setTrail([]), [items]);

  const q = !here ? null : here.kind === 'my' ? { view: 'my' as const, type: 'folder' as const } : here.kind === 'space' ? { spaceId: here.id, type: 'folder' as const } : { parentId: here.id, type: 'folder' as const };
  const { data: folders, isLoading } = useResources(q);
  const moving = new Set(items?.map((i) => i.id));
  const writableSpaces = spaces?.filter((s) => can(s.myRole, 'editor')) ?? [];

  const submit = async () => {
    if (!items || !here) return;
    const target = here.kind === 'my' ? { parentId: null, spaceId: null } : here.kind === 'space' ? { parentId: null, spaceId: here.id } : { parentId: here.id };
    for (const it of items) {
      if (mode === 'move') await update.mutateAsync({ id: it.id, ...target });
      else await copy.mutateAsync({ id: it.id, ...target });
    }
    toast.success(`${mode === 'move' ? 'Moved' : 'Copied'} ${items.length > 1 ? `${items.length} items` : `“${items[0].name}”`} to ${here.kind === 'my' ? 'My Files' : here.name}`);
    onClose();
  };

  const Row = ({ icon, label, onClick, disabled }: { icon: ReactNode; label: string; onClick: () => void; disabled?: boolean }) => (
    <button disabled={disabled} onClick={onClick} className="flex h-10 w-full items-center gap-3 rounded-lg px-3 text-left text-[13px] hover:bg-hover disabled:opacity-40">
      {icon}
      <span className="flex-1 truncate">{label}</span>
      <ChevronRight size={15} className="text-subtle" />
    </button>
  );

  return (
    <Dialog
      open={!!items}
      onOpenChange={(v) => !v && onClose()}
      width={520}
      title={`${mode === 'move' ? 'Move' : 'Copy'} ${items && items.length > 1 ? `${items.length} items` : `“${items?.[0]?.name ?? ''}”`}`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!here} loading={update.isPending || copy.isPending} onClick={submit}>
            {mode === 'move' ? 'Move here' : 'Copy here'}
          </Button>
        </>
      }
    >
      <div className="mb-2 flex min-h-7 flex-wrap items-center gap-1 text-[13px]">
        <button className={cn('rounded px-1.5 py-0.5 hover:bg-hover', !here && 'font-semibold')} onClick={() => setTrail([])}>
          Locations
        </button>
        {trail.map((d, i) => (
          <span key={i} className="flex items-center gap-1">
            <ChevronRight size={14} className="text-subtle" />
            <button className={cn('rounded px-1.5 py-0.5 hover:bg-hover', i === trail.length - 1 && 'font-semibold')} onClick={() => setTrail(trail.slice(0, i + 1))}>
              {d.kind === 'my' ? 'My Files' : d.name}
            </button>
          </span>
        ))}
      </div>
      <div className="h-72 overflow-auto rounded-xl border border-line p-1">
        {!here ? (
          <>
            <Row icon={<HardDrive size={18} className="text-brand-600" />} label="My Files" onClick={() => setTrail([{ kind: 'my' }])} />
            <div className="px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide text-subtle">Spaces</div>
            {writableSpaces.map((s) => (
              <Row key={s.id} icon={<SpaceBadge space={s} />} label={s.name} onClick={() => setTrail([{ kind: 'space', id: s.id, name: s.name }])} />
            ))}
          </>
        ) : isLoading ? (
          <div className="p-6 text-center text-[13px] text-muted">Loading…</div>
        ) : folders?.length ? (
          folders.map((f) => (
            <Row
              key={f.id}
              disabled={moving.has(f.id)}
              icon={<FileIcon r={f} size={18} />}
              label={f.name}
              onClick={() => setTrail([...trail, { kind: 'folder', id: f.id, name: f.name }])}
            />
          ))
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-[13px] text-muted">
            <Folder size={28} className="text-subtle" />
            No folders here — {mode === 'move' ? 'move' : 'copy'} into this location
          </div>
        )}
      </div>
    </Dialog>
  );
}

