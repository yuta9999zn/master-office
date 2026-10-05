'use client';

import type { Contact, UserProfile } from '@workos/shared';
import { Briefcase, Building2, CalendarDays, Copy, Ellipsis, Mail, MapPin, MessageCircle, Pencil, Phone, Search, Sparkles, UserRound, Users, Video } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { useChatActions } from '@/lib/chat';
import { useContacts, useProfile, useUpdateProfile } from '@/lib/contacts';
import { formatDate, timeAgo } from '@/lib/format';
import { useMe, useUsers } from '@/lib/queries';
import { useIsOnline } from '@/lib/realtime';
import { hrefFor, typeLabel } from '@/lib/resources';
import { ActivityList } from '../drive/DetailsPanel';
import { Avatar, Button, Chip, cn, Dialog, EmptyState, FileIcon, Menu, MenuContent, MenuItem, MenuTrigger, Skeleton, Tip } from '../ui/primitives';

type Tab = 'all' | 'department' | 'skills' | 'project';

/** /contacts and /contacts/:id — directory beside a profile (docs/ARCHITECTURE.md §67, "over view 2.png"). */
export function ContactsApp({ id }: { id?: string }) {
  return (
    <div className="flex h-full">
      <Directory activeId={id} />
      <div className="min-w-0 flex-1 overflow-y-auto bg-canvas">
        {id ? (
          <ProfileView key={id} id={id} />
        ) : (
          <div className="flex h-full items-center justify-center">
            <EmptyState icon={<Users size={40} />} title="Find people">
              Search by name, department, skill, project or location — then chat with them in one click.
            </EmptyState>
          </div>
        )}
      </div>
    </div>
  );
}

function useStartChat() {
  const { create } = useChatActions();
  const router = useRouter();
  return async (userId: string) => {
    const r = await create.mutateAsync({ kind: 'dm', userId });
    router.push(`/chat/${r.id}`);
  };
}

function Directory({ activeId }: { activeId?: string }) {
  const [q, setQ] = useState('');
  const [tab, setTab] = useState<Tab>('all');
  const { data, isLoading } = useContacts(q);
  const groups = useMemo(() => {
    const list = data ?? [];
    if (tab === 'all') return [{ key: 'all', title: null as string | null, people: list }];
    const by = new Map<string, Contact[]>();
    for (const c of list) {
      const keys = tab === 'department' ? [c.department ?? 'No department'] : tab === 'skills' ? (c.skills.length ? c.skills : ['No skills listed']) : c.projects.length ? c.projects.map((p) => p.name) : ['No projects'];
      for (const k of keys) by.set(k, [...(by.get(k) ?? []), c]);
    }
    return [...by].sort((a, b) => a[0].localeCompare(b[0])).map(([k, people]) => ({ key: k, title: k, people }));
  }, [data, tab]);

  return (
    <section className="flex w-[460px] shrink-0 flex-col border-r border-line bg-surface" data-testid="directory">
      <div className="flex items-center gap-2 px-5 pb-3 pt-4">
        <h1 className="flex-1 text-[17px] font-semibold text-ink">Contacts</h1>
        <span className="text-[12px] text-muted">{data ? `${data.length} people` : ''}</span>
      </div>
      <div className="px-5">
        <label className="flex h-9 items-center gap-2 rounded-lg bg-canvas px-3 text-[13px] ring-1 ring-line focus-within:ring-brand-500">
          <Search size={15} className="text-subtle" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search people, departments, skills…" className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-subtle" aria-label="Search contacts" />
        </label>
      </div>
      <div className="mt-3 flex gap-1.5 px-5 pb-3" role="tablist">
        {(['all', 'department', 'skills', 'project'] as const).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={cn('rounded-full px-3 py-1 text-[12.5px] capitalize', tab === t ? 'bg-brand-50 font-semibold text-brand-700 ring-1 ring-brand-200' : 'text-muted ring-1 ring-line hover:bg-hover')}
          >
            {t === 'all' ? 'All' : t}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto border-t border-line px-3 py-2">
        {isLoading && [0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="m-2 h-14" />)}
        {!isLoading && !data?.length && <EmptyState icon={<UserRound size={28} />} title="No one found">Try a name, a department, a skill or a project.</EmptyState>}
        {groups.map((g) => (
          <div key={g.key} data-testid="contact-group" data-title={g.title ?? ''}>
            {g.title && (
              <div className="flex items-center justify-between px-2 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide text-subtle">
                {g.title}
                <span className="font-normal normal-case">{g.people.length}</span>
              </div>
            )}
            {g.people.map((c) => (
              <ContactRow key={`${g.key}:${c.id}`} c={c} active={c.id === activeId} />
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}

function ContactRow({ c, active }: { c: Contact; active: boolean }) {
  const online = useIsOnline(c.id);
  const startChat = useStartChat();
  const { data: me } = useMe();
  const router = useRouter();
  return (
    <div className={cn('group flex items-center gap-3 rounded-lg px-2 py-2', active ? 'bg-selected' : 'hover:bg-hover')} data-testid="contact" data-name={c.name}>
      <Link href={`/contacts/${c.id}`} className="flex min-w-0 flex-1 items-center gap-3">
        <span className="relative shrink-0">
          <Avatar user={c} size={40} />
          {online && <span className="absolute bottom-0 right-0 size-3 rounded-full border-2 border-white bg-emerald-500" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] font-semibold text-ink">{c.name}</span>
          <span className="block truncate text-[12px] text-muted">{[c.title, c.department].filter(Boolean).join(' · ')}</span>
          {!!c.skills.length && (
            <span className="mt-1 flex flex-wrap gap-1">
              {c.skills.slice(0, 3).map((s) => (
                <span key={s} className="rounded-full bg-brand-50 px-2 py-px text-[11px] font-medium text-brand-700">
                  {s}
                </span>
              ))}
            </span>
          )}
        </span>
      </Link>
      {c.id !== me?.user.id && (
        <Button size="sm" variant="primary" onClick={() => startChat(c.id)} aria-label={`Chat with ${c.name}`}>
          Chat
        </Button>
      )}
      <Menu>
        <MenuTrigger asChild>
          <button className="rounded-md p-1.5 text-muted hover:bg-surface" aria-label={`More for ${c.name}`}>
            <Ellipsis size={16} />
          </button>
        </MenuTrigger>
        <MenuContent align="end">
          <MenuItem icon={<UserRound />} onSelect={() => router.push(`/contacts/${c.id}`)}>
            View profile
          </MenuItem>
          <MenuItem
            icon={<Copy />}
            onSelect={() => {
              void navigator.clipboard.writeText(c.email);
              toast.success('E-mail copied');
            }}
          >
            Copy e-mail
          </MenuItem>
        </MenuContent>
      </Menu>
    </div>
  );
}

type ProfileTab = 'overview' | 'organization' | 'files' | 'activity';

function ProfileView({ id }: { id: string }) {
  const { data: p, error } = useProfile(id);
  const online = useIsOnline(id);
  const startChat = useStartChat();
  const [tab, setTab] = useState<ProfileTab>('overview');
  const [editing, setEditing] = useState(false);

  if (error) return <EmptyState title="Can’t open this profile">{(error as Error).message}</EmptyState>;
  if (!p)
    return (
      <div className="mx-auto max-w-[860px] space-y-4 p-6">
        <Skeleton className="h-44 w-full rounded-2xl" />
        <Skeleton className="h-8 w-60" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  return (
    <div className="mx-auto max-w-[860px] p-6" data-testid="profile">
      <div className="card overflow-hidden">
        <div className="h-36" style={{ background: `linear-gradient(120deg, ${p.avatarColor}33, ${p.avatarColor}88 60%, #8b5cf688)` }} />
        <div className="px-6 pb-5">
          <div className="-mt-12 flex items-end justify-between gap-4">
            <span className="relative">
              <Avatar user={p} size={96} ring className="ring-4" />
              {online && <span className="absolute bottom-1.5 right-1.5 size-5 rounded-full border-[3px] border-white bg-emerald-500" data-testid="profile-online" />}
            </span>
            <div className="flex gap-2 pb-1">
              {!p.isMe && (
                <Button variant="primary" icon={<MessageCircle size={16} />} onClick={() => startChat(p.id)} data-testid="profile-chat">
                  Chat
                </Button>
              )}
              {!p.isMe && (
                <Tip label="Video meetings arrive with Meetings (Phase 7)">
                  <span>
                    <Button icon={<Video size={16} />} disabled>
                      Video call
                    </Button>
                  </span>
                </Tip>
              )}
              <a href={`mailto:${p.email}`} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line-strong bg-surface px-3.5 text-[13px] font-medium text-ink-2 hover:bg-hover">
                <Mail size={16} /> E-mail
              </a>
              {p.canEdit && (
                <Button icon={<Pencil size={15} />} onClick={() => setEditing(true)} data-testid="edit-profile">
                  Edit profile
                </Button>
              )}
            </div>
          </div>
          <h2 className="mt-3 text-[22px] font-bold text-ink" data-testid="profile-name">
            {p.name}
          </h2>
          <div className="text-[14px] text-muted">{[p.title, p.department].filter(Boolean).join(' · ')}</div>
          {p.status && (
            <div className="mt-1.5 text-[14px] text-ink-2" data-testid="profile-status">
              {p.status}
            </div>
          )}
        </div>
        <nav className="flex gap-1 border-t border-line px-4" role="tablist">
          {(['overview', 'organization', 'files', 'activity'] as const).map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={cn('-mb-px border-b-2 px-3 py-2.5 text-[13px] capitalize', tab === t ? 'border-brand-600 font-semibold text-brand-600' : 'border-transparent text-muted hover:text-ink')}
            >
              {t}
            </button>
          ))}
        </nav>
      </div>
      <div className="card mt-4 p-5">
        {tab === 'overview' && <Overview p={p} />}
        {tab === 'organization' && <Organization p={p} />}
        {tab === 'files' && <Files p={p} />}
        {tab === 'activity' && <ActivityList events={p.activity} loading={false} />}
      </div>
      {editing && <EditProfileDialog p={p} onClose={() => setEditing(false)} />}
    </div>
  );
}

function Field({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-3 py-2" data-testid="profile-field" data-label={label}>
      <span className="mt-0.5 text-subtle [&>svg]:size-4">{icon}</span>
      <span className="w-28 shrink-0 text-[13px] text-muted">{label}</span>
      <span className="min-w-0 flex-1 text-[13.5px] text-ink">{children}</span>
    </div>
  );
}

function Overview({ p }: { p: UserProfile }) {
  return (
    <div className="divide-y divide-line/60">
      <Field icon={<Mail />} label="E-mail">
        <a href={`mailto:${p.email}`} className="text-brand-600 hover:underline">
          {p.email}
        </a>
      </Field>
      <Field icon={<Phone />} label="Phone">
        {p.phone ?? <span className="text-subtle">—</span>}
      </Field>
      <Field icon={<Building2 />} label="Department">
        {p.department ?? <span className="text-subtle">—</span>}
      </Field>
      <Field icon={<Briefcase />} label="Position">
        {p.title ?? <span className="text-subtle">—</span>}
      </Field>
      <Field icon={<MapPin />} label="Location">
        {p.location ?? <span className="text-subtle">—</span>}
      </Field>
      <Field icon={<Sparkles />} label="Skills">
        {p.skills.length ? (
          <span className="flex flex-wrap gap-1.5">
            {p.skills.map((s) => (
              <Chip key={s}>{s}</Chip>
            ))}
          </span>
        ) : (
          <span className="text-subtle">—</span>
        )}
      </Field>
      <Field icon={<Users />} label="Projects">
        {p.projects.length ? (
          <span className="flex flex-wrap gap-1.5">
            {p.projects.map((s) => (
              <Link key={s.id} href={`/spaces/${s.id}`}>
                <Chip color={s.color ?? '#2563eb'}>{s.name}</Chip>
              </Link>
            ))}
          </span>
        ) : (
          <span className="text-subtle">—</span>
        )}
      </Field>
      <Field icon={<UserRound />} label="Manager">
        {p.manager ? (
          <Link href={`/contacts/${p.manager.id}`} className="inline-flex items-center gap-2 hover:underline">
            <Avatar user={p.manager} size={20} /> {p.manager.name}
          </Link>
        ) : (
          <span className="text-subtle">—</span>
        )}
      </Field>
      <Field icon={<CalendarDays />} label="Joined">
        {p.joinedAt ? formatDate(p.joinedAt) : <span className="text-subtle">—</span>}
      </Field>
    </div>
  );
}

function PersonLink({ u, me }: { u: { id: string; name: string; avatarColor: string; title?: string | null }; me?: boolean }) {
  return (
    <Link href={`/contacts/${u.id}`} className={cn('flex items-center gap-3 rounded-lg border px-3 py-2', me ? 'border-brand-200 bg-brand-50' : 'border-line hover:bg-hover')}>
      <Avatar user={u} size={32} />
      <span className="min-w-0">
        <span className="block truncate text-[13.5px] font-medium text-ink">{u.name}</span>
        <span className="block truncate text-[12px] text-muted">{u.title}</span>
      </span>
    </Link>
  );
}

function Organization({ p }: { p: UserProfile }) {
  const above = [...p.chain].reverse();
  return (
    <div className="mx-auto max-w-sm space-y-2" data-testid="org-chart">
      {[...above, ...(p.manager ? [p.manager] : [])].map((u) => (
        <div key={u.id} className="flex flex-col items-center gap-2">
          <div className="w-full">
            <PersonLink u={u} />
          </div>
          <span className="h-3 w-px bg-line-strong" />
        </div>
      ))}
      <PersonLink u={p} me />
      {!!p.reports.length && (
        <div className="pt-3">
          <div className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-subtle">Direct reports · {p.reports.length}</div>
          <div className="space-y-2 border-l-2 border-line pl-4">
            {p.reports.map((u) => (
              <PersonLink key={u.id} u={u} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Files({ p }: { p: UserProfile }) {
  if (!p.files.length) return <EmptyState title="No files to show">Files {p.isMe ? 'you own' : `${p.name.split(' ')[0]} owns and you can open`} show up here.</EmptyState>;
  return (
    <ul className="divide-y divide-line/60" data-testid="profile-files">
      {p.files.map((r) => (
        <li key={r.id}>
          <Link href={hrefFor(r)} className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-hover">
            <FileIcon r={r} size={26} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[14px] font-medium text-ink">{r.name}</span>
              <span className="block text-[12px] text-muted">
                {typeLabel(r)} · updated {timeAgo(r.updatedAt)}
              </span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function EditProfileDialog({ p, onClose }: { p: UserProfile; onClose: () => void }) {
  const update = useUpdateProfile(p.id);
  const { data: users } = useUsers();
  const [f, setF] = useState({
    status: p.status ?? '',
    phone: p.phone ?? '',
    location: p.location ?? '',
    skills: p.skills.join(', '),
    title: p.title ?? '',
    department: p.department ?? '',
    managerId: p.managerId ?? '',
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));
  const input = (k: keyof typeof f, label: string, placeholder = '') => (
    <label className="block text-[12px] font-medium text-muted">
      {label}
      <input value={f[k]} onChange={set(k)} placeholder={placeholder} aria-label={label} className="mt-1 h-9 w-full rounded-lg border border-line-strong px-3 text-[13px] text-ink outline-none focus:border-brand-500" />
    </label>
  );
  const save = async () => {
    await update.mutateAsync({
      status: f.status,
      phone: f.phone,
      location: f.location,
      skills: f.skills.split(',').map((s) => s.trim()).filter(Boolean),
      ...(p.canEditOrg ? { title: f.title, department: f.department, managerId: f.managerId || null } : {}),
    });
    onClose();
  };
  return (
    <Dialog
      open
      onOpenChange={(v) => !v && onClose()}
      title={p.isMe ? 'Edit your profile' : `Edit ${p.name}`}
      width={500}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={update.isPending} onClick={save} data-testid="save-profile">
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {input('status', 'Status', 'What are you working on?')}
        <div className="grid grid-cols-2 gap-3">
          {input('phone', 'Phone')}
          {input('location', 'Location')}
        </div>
        {input('skills', 'Skills', 'Comma separated, e.g. Design, Japanese')}
        {p.canEditOrg && (
          <div className="space-y-3 rounded-xl border border-line bg-canvas p-3">
            <div className="text-[12px] font-semibold text-ink-2">Organization (workspace owners)</div>
            <div className="grid grid-cols-2 gap-3">
              {input('title', 'Position')}
              {input('department', 'Department')}
            </div>
            <label className="block text-[12px] font-medium text-muted">
              Manager
              <select value={f.managerId} onChange={set('managerId')} aria-label="Manager" className="mt-1 h-9 w-full rounded-lg border border-line-strong bg-surface px-2 text-[13px] text-ink">
                <option value="">No manager</option>
                {users
                  ?.filter((u) => u.id !== p.id)
                  .map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
              </select>
            </label>
          </div>
        )}
      </div>
    </Dialog>
  );
}
