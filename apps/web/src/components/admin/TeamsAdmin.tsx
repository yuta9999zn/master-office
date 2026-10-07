'use client';

import { SPACE_KINDS, type Role, type Space, type SpaceKind } from '@workos/shared';
import { Building2, ChevronRight, Crown, FolderKanban, Globe2, Lock, Plus, Trash2, UserPlus, Users } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { useSpaceActions, useSpaceMembers, useSpaces, useUsers } from '@/lib/queries';
import { Avatar, Button, cn, Dialog, EmptyState, Skeleton } from '../ui/primitives';

/** cn is plain clsx (no tailwind-merge): sized fields use `field` + their own width, full-width ones `input`. */
const field = 'h-9 rounded-lg border border-line-strong bg-surface px-3 text-[13px] outline-none focus:border-brand-500';
const input = `${field} w-full`;
const KIND_ICON: Record<SpaceKind, typeof Users> = { department: Building2, team: Users, project: FolderKanban, general: Globe2 };
const COLORS = ['#2563eb', '#7c3aed', '#0d9488', '#db2777', '#ea580c', '#16a34a', '#0891b2', '#ca8a04', '#475569', '#ef4444'];
/** Team roles as people say them: lead = space admin (or the owner who made it). */
const TEAM_ROLES: { value: Role; label: string }[] = [
  { value: 'admin', label: 'Lead' },
  { value: 'editor', label: 'Member' },
  { value: 'commenter', label: 'Commenter' },
  { value: 'viewer', label: 'Viewer' },
];

/** Admin → Teams (§79): the organisation chart — departments, teams, projects — with leads, members and positions. */
export function TeamsAdmin() {
  const { data: spaces, isLoading } = useSpaces();
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState<{ parentId: string | null } | null>(null);
  const kids = useMemo(() => {
    const m = new Map<string | null, Space[]>();
    const ids = new Set((spaces ?? []).map((s) => s.id));
    for (const s of spaces ?? []) {
      const p = s.parentId && ids.has(s.parentId) ? s.parentId : null;
      m.set(p, [...(m.get(p) ?? []), s]);
    }
    return m;
  }, [spaces]);
  useEffect(() => {
    if (!selected && spaces?.length) setSelected(spaces[0].id);
  }, [spaces, selected]);
  const current = spaces?.find((s) => s.id === selected) ?? null;

  const node = (s: Space, depth: number) => {
    const Icon = KIND_ICON[s.kind] ?? Users;
    return (
      <li key={s.id}>
        <button onClick={() => setSelected(s.id)} className={cn('flex w-full items-center gap-2 rounded-lg py-1.5 pr-2 text-left text-[13px]', selected === s.id ? 'bg-selected font-medium text-brand-700' : 'text-ink-2 hover:bg-hover')} style={{ paddingLeft: 8 + depth * 16 }} data-testid="team-node" data-name={s.name}>
          {depth > 0 && <ChevronRight size={12} className="-ml-1 text-subtle" />}
          <span className="grid size-6 shrink-0 place-items-center rounded-md text-white" style={{ background: s.color ?? '#64748b' }}>
            <Icon size={13} />
          </span>
          <span className="min-w-0 flex-1 truncate">{s.name}</span>
          {s.visibility === 'private' && <Lock size={12} className="text-subtle" />}
          <span className="text-[11px] text-subtle">{s.memberCount ?? 0}</span>
        </button>
        {(kids.get(s.id) ?? []).length > 0 && <ul>{kids.get(s.id)!.map((c) => node(c, depth + 1))}</ul>}
      </li>
    );
  };

  return (
    <section>
      <div className="mb-4 flex items-start gap-3">
        <div className="flex-1">
          <h1 className="text-[20px] font-bold text-ink">Teams & departments</h1>
          <p className="text-[13px] text-muted">Each one has its own chat, files, calendar and tasks. Leads add people and set their position; one person can be in many teams.</p>
        </div>
        <Button variant="primary" icon={<Plus size={16} />} onClick={() => setCreating({ parentId: null })} data-testid="new-team">New team</Button>
      </div>
      {isLoading ? (
        <Skeleton className="h-96" />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
          <ul className="card max-h-[70vh] space-y-0.5 overflow-y-auto p-2" data-testid="team-tree">
            {(kids.get(null) ?? []).map((s) => node(s, 0))}
          </ul>
          {current ? <TeamDetail key={current.id} s={current} spaces={spaces ?? []} onAddSub={() => setCreating({ parentId: current.id })} /> : <EmptyState title="No teams yet">Create the first department or team.</EmptyState>}
        </div>
      )}
      {creating && <CreateTeam parentId={creating.parentId} spaces={spaces ?? []} onClose={() => setCreating(null)} onMade={(id) => (setSelected(id), setCreating(null))} />}
    </section>
  );
}

/** Spaces a team may move under: not itself or one of its sub-teams. */
function parents(spaces: Space[], self?: string) {
  if (!self) return spaces;
  const below = new Set([self]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const s of spaces) if (s.parentId && below.has(s.parentId) && !below.has(s.id)) (below.add(s.id), (grew = true));
  }
  return spaces.filter((s) => !below.has(s.id));
}

function CreateTeam({ parentId, spaces, onClose, onMade }: { parentId: string | null; spaces: Space[]; onClose: () => void; onMade: (id: string) => void }) {
  const a = useSpaceActions();
  const { data: users } = useUsers();
  const [name, setName] = useState('');
  const [kind, setKind] = useState<SpaceKind>(parentId ? 'team' : 'department');
  const [parent, setParent] = useState(parentId ?? '');
  const [visibility, setVisibility] = useState<'public' | 'private'>('public');
  const [lead, setLead] = useState('');
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  // The lead is in before the team opens, so its member list is complete.
  const save = async () => {
    setBusy(true);
    try {
      const s = await a.create.mutateAsync({ name, kind, parentId: parent || null, visibility, color: COLORS[(spaces.length * 3) % COLORS.length] });
      if (lead) await a.setMember.mutateAsync({ spaceId: s.id, userId: lead, role: 'admin', title: title.trim() || 'Team lead' });
      toast.success(`${s.name} created`);
      onMade(s.id);
    } catch {
      /* shown by the mutation */
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="New team or department" width={520} footer={<Button variant="primary" disabled={!name.trim()} loading={busy} onClick={() => void save()} data-testid="team-save">Create</Button>}>
      <div className="space-y-3 text-[13px]">
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Name (e.g. Sales, Team North, Website project)" aria-label="Team name" className={input} />
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Kind">
          {(Object.keys(SPACE_KINDS) as SpaceKind[]).map((k) => {
            const Icon = KIND_ICON[k];
            return (
              <button key={k} role="radio" aria-checked={kind === k} onClick={() => setKind(k)} className={cn('flex items-start gap-2 rounded-lg p-2 text-left ring-1', kind === k ? 'bg-selected ring-brand-400' : 'ring-line hover:bg-hover')}>
                <Icon size={16} className="mt-0.5 text-muted" />
                <span>
                  <span className="block font-semibold text-ink">{SPACE_KINDS[k].label}</span>
                  <span className="block text-[11.5px] text-muted">{SPACE_KINDS[k].note}</span>
                </span>
              </button>
            );
          })}
        </div>
        <label className="block">
          <span className="mb-1 block text-[12px] text-muted">Part of</span>
          <select value={parent} onChange={(e) => setParent(e.target.value)} aria-label="Parent team" className={input}>
            <option value="">— Top level —</option>
            {spaces.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-[12px] text-muted">Who can see it</span>
          <select value={visibility} onChange={(e) => setVisibility(e.target.value as 'public' | 'private')} aria-label="Visibility" className={input}>
            <option value="public">Public — every member of the organisation can read</option>
            <option value="private">Private — only its members (and admins)</option>
          </select>
        </label>
        <div className="grid grid-cols-[1fr_1fr] gap-2">
          <label className="block">
            <span className="mb-1 block text-[12px] text-muted">Lead (optional)</span>
            <select value={lead} onChange={(e) => setLead(e.target.value)} aria-label="Lead" className={input}>
              <option value="">— you —</option>
              {users?.map((u) => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-[12px] text-muted">Lead’s position</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Team lead" aria-label="Lead position" className={input} />
          </label>
        </div>
      </div>
    </Dialog>
  );
}

function TeamDetail({ s, spaces, onAddSub }: { s: Space; spaces: Space[]; onAddSub: () => void }) {
  const a = useSpaceActions();
  const { data: members } = useSpaceMembers(s.id);
  const { data: users } = useUsers();
  const [form, setForm] = useState({ name: s.name, description: s.description ?? '', kind: s.kind, parentId: s.parentId ?? '', visibility: s.visibility, color: s.color ?? '#2563eb' });
  const [adding, setAdding] = useState({ userId: '', role: 'editor' as Role, title: '' });
  const dirty = form.name !== s.name || form.description !== (s.description ?? '') || form.kind !== s.kind || form.parentId !== (s.parentId ?? '') || form.visibility !== s.visibility || form.color !== (s.color ?? '#2563eb');
  const outside = (users ?? []).filter((u) => !members?.some((m) => m.user.id === u.id));
  const leads = (members ?? []).filter((m) => m.role === 'owner' || m.role === 'admin');
  const set = (userId: string, role: Role | null, title?: string | null) => a.setMember.mutate({ spaceId: s.id, userId, role, title });
  return (
    <div className="space-y-4" data-testid="team-detail">
      <div className="card space-y-3 p-4">
        <div className="flex items-center gap-2">
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} aria-label="Name" className={cn(field, 'h-10 min-w-0 flex-1 text-[15px] font-semibold')} />
          <Link href={`/spaces/${s.id}`} className="text-[12.5px] text-brand-600 hover:underline">Open space</Link>
        </div>
        <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} placeholder="What does this team do?" aria-label="Description" className={cn(input, 'h-auto py-2')} />
        <div className="grid gap-2 sm:grid-cols-3">
          <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as SpaceKind })} aria-label="Kind" className={input}>
            {(Object.keys(SPACE_KINDS) as SpaceKind[]).map((k) => (
              <option key={k} value={k}>{SPACE_KINDS[k].label}</option>
            ))}
          </select>
          <select value={form.parentId} onChange={(e) => setForm({ ...form, parentId: e.target.value })} aria-label="Part of" className={input}>
            <option value="">— Top level —</option>
            {parents(spaces, s.id).map((p) => (
              <option key={p.id} value={p.id}>Part of {p.name}</option>
            ))}
          </select>
          <select value={form.visibility} onChange={(e) => setForm({ ...form, visibility: e.target.value as 'public' | 'private' })} aria-label="Visibility" className={input}>
            <option value="public">Public</option>
            <option value="private">Private</option>
          </select>
        </div>
        <div className="flex items-center gap-1.5">
          {COLORS.map((c) => (
            <button key={c} onClick={() => setForm({ ...form, color: c })} aria-label={`Colour ${c}`} className={cn('size-6 rounded-full', form.color === c && 'ring-2 ring-brand-500 ring-offset-2')} style={{ background: c }} />
          ))}
          <span className="flex-1" />
          <Button variant="ghost" size="sm" icon={<Plus size={14} />} onClick={onAddSub}>Sub-team</Button>
          <Button
            variant="primary"
            size="sm"
            disabled={!dirty || !form.name.trim()}
            loading={a.update.isPending}
            onClick={() => a.update.mutate({ id: s.id, name: form.name, description: form.description || null, kind: form.kind, parentId: form.parentId || null, visibility: form.visibility, color: form.color }, { onSuccess: () => toast.success('Saved') })}
            data-testid="team-update"
          >
            Save
          </Button>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
          <span className="flex-1 text-[14px] font-semibold text-ink">
            Members · {members?.length ?? 0}
            {leads.length > 0 && <span className="ml-2 text-[12px] font-normal text-muted">Lead: {leads.map((l) => l.user.name).join(', ')}</span>}
          </span>
        </div>
        <ul className="divide-y divide-line" data-testid="team-members">
          {(members ?? []).map((m) => (
            <li key={m.user.id} className="flex items-center gap-3 px-4 py-2" data-testid="team-member" data-name={m.user.name}>
              <Avatar user={m.user} size={28} />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1 truncate text-[13px] font-medium text-ink">
                  {m.user.name}
                  {(m.role === 'owner' || m.role === 'admin') && <Crown size={12} className="text-amber-500" aria-label="Lead" />}
                </span>
                <span className="block truncate text-[11.5px] text-muted">{m.user.email}</span>
              </span>
              <input
                key={m.title ?? ''}
                defaultValue={m.title ?? ''}
                onBlur={(e) => e.target.value !== (m.title ?? '') && set(m.user.id, m.role, e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                placeholder="Position"
                aria-label={`Position of ${m.user.name}`}
                className={cn(field, 'h-8 w-48')}
              />
              {m.role === 'owner' ? (
                <span className="w-32 text-[12.5px] text-muted">Owner · lead</span>
              ) : (
                <select value={m.role} onChange={(e) => set(m.user.id, e.target.value as Role)} aria-label={`Team role of ${m.user.name}`} className={cn(field, 'h-8 w-32')}>
                  {TEAM_ROLES.map((r) => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
                </select>
              )}
              {m.role !== 'owner' ? (
                <button onClick={() => set(m.user.id, null)} className="grid size-8 place-items-center rounded-md text-muted hover:bg-red-50 hover:text-red-600" aria-label={`Remove ${m.user.name}`}>
                  <Trash2 size={14} />
                </button>
              ) : (
                <span className="size-8" />
              )}
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap items-center gap-2 border-t border-line bg-canvas px-4 py-2.5">
          <UserPlus size={15} className="text-muted" />
          <select value={adding.userId} onChange={(e) => setAdding({ ...adding, userId: e.target.value })} aria-label="Add a person" className={cn(field, 'h-8 w-56')}>
            <option value="">Add a person…</option>
            {outside.map((u) => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </select>
          <select value={adding.role} onChange={(e) => setAdding({ ...adding, role: e.target.value as Role })} aria-label="New member role" className={cn(field, 'h-8 w-32')}>
            {TEAM_ROLES.map((r) => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>
          <input value={adding.title} onChange={(e) => setAdding({ ...adding, title: e.target.value })} placeholder="Position" aria-label="New member position" className={cn(field, 'h-8 w-44')} />
          <Button size="sm" variant="primary" disabled={!adding.userId} onClick={() => (set(adding.userId, adding.role, adding.title.trim() || null), setAdding({ userId: '', role: 'editor', title: '' }))} data-testid="team-add-member">
            Add
          </Button>
        </div>
      </div>
    </div>
  );
}
