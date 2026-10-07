'use client';

import { can } from '@workos/shared';
import { Ban, Copy, Crown, Globe, KeyRound, Mail, MoreHorizontal, Network, RotateCcw, Search, Send, ShieldCheck, UserPlus, Users, X } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { timeAgo } from '@/lib/format';
import { useSpaces } from '@/lib/queries';
import { ORG_ROLES, useAdminActions, useAdminMembers, useAdminRole, useGeneral, useInvitations, type AdminMember, type InviteResult, type OrgRole } from '@/lib/admin';
import { Avatar, Button, cn, Dialog, EmptyState, Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, Skeleton } from '../ui/primitives';
import { SmtpForm } from './SmtpForm';
import { TeamsAdmin } from './TeamsAdmin';

const TABS = [
  { id: 'members', label: 'Members', icon: Users },
  { id: 'teams', label: 'Teams', icon: Network },
  { id: 'email', label: 'System e-mail', icon: Mail },
  { id: 'general', label: 'General', icon: Globe },
] as const;
type Tab = (typeof TABS)[number]['id'];

const input = 'h-9 w-full rounded-lg border border-line-strong bg-surface px-3 text-[13px] outline-none focus:border-brand-500';

/** /admin — the organisation's console for owners and admins (§79). */
export function AdminConsole() {
  const router = useRouter();
  const params = useSearchParams();
  const { data: me, isLoading } = useAdminRole();
  const tab = (TABS.some((t) => t.id === params.get('tab')) ? params.get('tab') : 'members') as Tab;
  if (isLoading) return <div className="p-6"><Skeleton className="h-96" /></div>;
  if (me?.role !== 'owner' && me?.role !== 'admin') return <EmptyState icon={<ShieldCheck size={30} />} title="Administrators only">Ask an administrator of your organisation for access.</EmptyState>;
  return (
    <div className="flex h-full min-h-0" data-testid="admin-console">
      <aside className="w-56 shrink-0 border-r border-line bg-surface p-3">
        <p className="px-2 pb-2 text-[11.5px] font-semibold uppercase tracking-wide text-subtle">Admin console</p>
        <nav className="space-y-0.5">
          {TABS.map((t) => (
            <button key={t.id} onClick={() => router.replace(`/admin?tab=${t.id}`)} className={cn('flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px]', tab === t.id ? 'bg-selected font-medium text-brand-700' : 'text-ink-2 hover:bg-hover')} data-testid={`admin-tab-${t.id}`}>
              <t.icon size={16} />
              {t.label}
            </button>
          ))}
        </nav>
        <p className="mt-6 px-2 text-[11.5px] leading-relaxed text-subtle">You are the <b>{ORG_ROLES[me.role].label.toLowerCase()}</b> of this organisation.</p>
      </aside>
      <div className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[1100px] p-6">
          {tab === 'members' && <Members myRole={me.role} />}
          {tab === 'teams' && <TeamsAdmin />}
          {tab === 'email' && (
            <section>
              <Header title="System e-mail" note="The mailbox that sends invitations, password resets and notifications. Connect it with an app password." />
              <div className="card p-5">
                <SmtpForm />
              </div>
            </section>
          )}
          {tab === 'general' && <General />}
        </div>
      </div>
    </div>
  );
}

function Header({ title, note, action }: { title: string; note?: string; action?: React.ReactNode }) {
  return (
    <div className="mb-4 flex items-start gap-3">
      <div className="flex-1">
        <h1 className="text-[20px] font-bold text-ink">{title}</h1>
        {note && <p className="text-[13px] text-muted">{note}</p>}
      </div>
      {action}
    </div>
  );
}

// ── Members ─────────────────────────────────────────────────────────────────

function Members({ myRole }: { myRole: OrgRole }) {
  const { data: members, isLoading } = useAdminMembers();
  const { data: invites } = useInvitations();
  const a = useAdminActions();
  const [q, setQ] = useState('');
  const [inviting, setInviting] = useState(false);
  const [transfer, setTransfer] = useState<AdminMember | null>(null);
  const shown = (members ?? []).filter((m) => `${m.user.name} ${m.user.email} ${m.user.title ?? ''}`.toLowerCase().includes(q.toLowerCase()));
  const roles: ('admin' | 'editor' | 'viewer')[] = myRole === 'owner' ? ['admin', 'editor', 'viewer'] : ['editor', 'viewer'];
  const link = async (id: string, name: string) => {
    const r = await a.passwordLink.mutateAsync(id).catch(() => null);
    if (r) toast.success(r.delivered ? `Password link sent to ${name}` : 'Link recorded — connect the system e-mail so it is delivered');
  };
  return (
    <section>
      <Header
        title="Members"
        note={`${members?.length ?? 0} people · ${members?.filter((m) => m.status === 'active').length ?? 0} active`}
        action={<Button variant="primary" icon={<UserPlus size={16} />} onClick={() => setInviting(true)} data-testid="invite-people">Invite people</Button>}
      />
      <label className="mb-3 flex h-9 w-80 items-center gap-2 rounded-lg border border-line bg-surface px-3">
        <Search size={15} className="text-subtle" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a member" aria-label="Find a member" className="flex-1 bg-transparent text-[13px] outline-none" />
      </label>
      {isLoading ? (
        <Skeleton className="h-80" />
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-[13px]" data-testid="members-table">
            <thead className="bg-canvas text-left text-[11.5px] uppercase tracking-wide text-subtle">
              <tr>
                <th className="px-4 py-2 font-semibold">Person</th>
                <th className="px-3 py-2 font-semibold">Role</th>
                <th className="px-3 py-2 font-semibold">Teams</th>
                <th className="px-3 py-2 font-semibold">Sign-in</th>
                <th className="px-3 py-2 font-semibold">Last active</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {shown.map((m) => {
                const locked = m.role === 'owner' || (m.role === 'admin' && myRole !== 'owner');
                return (
                  <tr key={m.user.id} className={cn(m.status === 'suspended' && 'bg-canvas text-muted')} data-testid="member-row" data-email={m.user.email}>
                    <td className="px-4 py-2.5">
                      <span className="flex items-center gap-2.5">
                        <Avatar user={m.user} size={30} className={cn(m.status === 'suspended' && 'opacity-50')} />
                        <span className="min-w-0">
                          <span className="block truncate font-medium text-ink">{m.user.name}</span>
                          <span className="block truncate text-[12px] text-muted">{m.user.email}{m.user.title ? ` · ${m.user.title}` : ''}</span>
                        </span>
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      {locked ? (
                        <span className="inline-flex items-center gap-1 font-medium text-ink-2">{m.role === 'owner' && <Crown size={13} className="text-amber-500" />}{ORG_ROLES[m.role as OrgRole]?.label ?? m.role}</span>
                      ) : (
                        <select
                          value={m.role}
                          onChange={(e) => a.updateMember.mutate({ id: m.user.id, role: e.target.value as 'admin' | 'editor' | 'viewer' })}
                          aria-label={`Role of ${m.user.name}`}
                          className="h-8 rounded-md border border-line bg-surface px-2 text-[12.5px]"
                          data-testid="member-role"
                        >
                          {roles.map((r) => (
                            <option key={r} value={r}>{ORG_ROLES[r].label}</option>
                          ))}
                        </select>
                      )}
                      {m.status === 'suspended' && <span className="ml-2 rounded bg-red-50 px-1.5 py-0.5 text-[11px] font-semibold text-red-700">Suspended</span>}
                    </td>
                    <td className="px-3 py-2.5 text-ink-2">{m.teams}</td>
                    <td className="px-3 py-2.5 text-[12px]">{m.hasPassword ? <span className="text-emerald-700">Password set</span> : <span className="text-subtle">No password yet</span>}</td>
                    <td className="px-3 py-2.5 text-[12px] text-muted">{m.lastSeenAt ? timeAgo(m.lastSeenAt) : '—'}</td>
                    <td className="pr-3">
                      {m.role !== 'owner' && (
                        <Menu modal={false}>
                          <MenuTrigger asChild>
                            <button className="grid size-8 place-items-center rounded-md text-muted hover:bg-hover" aria-label={`More for ${m.user.name}`} data-testid="member-menu">
                              <MoreHorizontal size={16} />
                            </button>
                          </MenuTrigger>
                          <MenuContent align="end">
                            <MenuItem icon={<KeyRound />} disabled={m.status !== 'active'} onSelect={() => void link(m.user.id, m.user.name)}>Send password link</MenuItem>
                            {!locked && (m.status === 'active' ? (
                              <MenuItem icon={<Ban />} danger onSelect={() => a.updateMember.mutate({ id: m.user.id, status: 'suspended' }, { onSuccess: () => toast.success(`${m.user.name} is suspended and signed out`) })}>Suspend</MenuItem>
                            ) : (
                              <MenuItem icon={<RotateCcw />} onSelect={() => a.updateMember.mutate({ id: m.user.id, status: 'active' })}>Reactivate</MenuItem>
                            ))}
                            {myRole === 'owner' && m.status === 'active' && (
                              <>
                                <MenuSeparator />
                                <MenuItem icon={<Crown />} onSelect={() => setTransfer(m)}>Make owner…</MenuItem>
                              </>
                            )}
                          </MenuContent>
                        </Menu>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <h2 className="mb-2 mt-8 text-[15px] font-semibold text-ink">Pending invitations</h2>
      <ul className="card divide-y divide-line" data-testid="invitations">
        {(invites ?? []).map((i) => (
          <li key={i.id} className="flex items-center gap-3 px-4 py-2.5 text-[13px]" data-testid="invitation" data-email={i.email}>
            <Mail size={16} className="text-subtle" />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium text-ink">{i.email}</span>
              <span className="block text-[12px] text-muted">
                {ORG_ROLES[i.role as OrgRole]?.label ?? i.role} · invited by {i.invitedBy ?? '—'} {timeAgo(i.createdAt)} · {i.expired ? <b className="text-red-600">expired</b> : `expires ${timeAgo(i.expiresAt)}`}
              </span>
            </span>
            <Button
              size="sm"
              icon={<Send size={14} />}
              onClick={() =>
                a.resend.mutate(i.id, {
                  onSuccess: (r) => {
                    if (r.link) void navigator.clipboard?.writeText(r.link).catch(() => undefined);
                    toast.success(r.delivered ? 'Invitation sent again' : 'New link copied — send it yourself (no system e-mail yet)');
                  },
                })
              }
            >
              {i.expired ? 'Renew' : 'Resend'}
            </Button>
            <Button size="sm" variant="ghost" icon={<X size={14} />} onClick={() => a.revoke.mutate(i.id)} aria-label={`Cancel invitation for ${i.email}`}>Cancel</Button>
          </li>
        ))}
        {!invites?.length && <li className="px-4 py-4 text-[12.5px] text-subtle">No pending invitations</li>}
      </ul>

      {inviting && <InviteDialog myRole={myRole} onClose={() => setInviting(false)} />}
      {transfer && (
        <Dialog
          open
          onOpenChange={(o) => !o && setTransfer(null)}
          title={`Make ${transfer.user.name} the owner?`}
          description="You become an admin. Only the new owner can name admins or hand ownership back."
          footer={<Button variant="danger" loading={a.transfer.isPending} onClick={() => a.transfer.mutate(transfer.user.id, { onSuccess: () => setTransfer(null) })}>Hand over ownership</Button>}
        />
      )}
    </section>
  );
}

function InviteDialog({ myRole, onClose }: { myRole: OrgRole; onClose: () => void }) {
  const a = useAdminActions();
  const { data: spaces } = useSpaces();
  const [emails, setEmails] = useState('');
  const [role, setRole] = useState<'admin' | 'editor' | 'viewer'>('editor');
  const [teams, setTeams] = useState<{ spaceId: string; role: 'admin' | 'editor' | 'viewer'; title: string }[]>([]);
  const [message, setMessage] = useState('');
  const [result, setResult] = useState<InviteResult | null>(null);
  const list = emails.split(/[\s,;]+/).filter((x) => x.includes('@'));
  const free = (spaces ?? []).filter((s) => can(s.myRole, 'viewer') && !teams.some((t) => t.spaceId === s.id));
  if (result) {
    const links = result.results.filter((r) => r.link);
    return (
      <Dialog open onOpenChange={(o) => !o && onClose()} title="Invitations" width={620} footer={<Button variant="primary" onClick={onClose}>Done</Button>}>
        <ul className="space-y-1.5 text-[13px]" data-testid="invite-results">
          {result.results.map((r) => (
            <li key={r.email} className="flex items-center gap-2">
              <span className="w-56 truncate font-medium">{r.email}</span>
              {r.status === 'member' ? (
                <span className="text-muted">already a member</span>
              ) : r.link ? (
                <>
                  <input readOnly value={r.link} onFocus={(e) => e.currentTarget.select()} className={cn(input, 'h-8 flex-1 text-[12px]')} aria-label={`Invitation link for ${r.email}`} data-testid="invite-link" />
                  <button onClick={() => void navigator.clipboard?.writeText(r.link!).then(() => toast.success('Link copied'))} className="grid size-8 place-items-center rounded-md hover:bg-hover" aria-label="Copy link"><Copy size={14} /></button>
                </>
              ) : (
                <span className="text-emerald-700">invitation sent</span>
              )}
            </li>
          ))}
        </ul>
        {links.length > 0 && <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-[12.5px] text-amber-800">No system e-mail is connected, so send these links yourself. Connect one in <b>System e-mail</b> to deliver invitations automatically.</p>}
      </Dialog>
    );
  }
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Invite people"
      description="They get an e-mail with a link (valid 7 days) to set their name and password."
      width={620}
      footer={
        <Button variant="primary" disabled={!list.length} loading={a.invite.isPending} onClick={() => a.invite.mutate({ emails: list, role, teams: teams.map((t) => ({ ...t, title: t.title.trim() || null })), message: message.trim() || null }, { onSuccess: setResult })} data-testid="invite-send">
          {list.length ? `Invite ${list.length} ${list.length === 1 ? 'person' : 'people'}` : 'Invite'}
        </Button>
      }
    >
      <div className="space-y-3 text-[13px]">
        <textarea autoFocus value={emails} onChange={(e) => setEmails(e.target.value)} rows={3} placeholder="E-mail addresses, separated by commas or new lines" aria-label="Invite e-mails" className={cn(input, 'h-auto py-2')} />
        <label className="block">
          <span className="mb-1 block text-[12px] text-muted">Role in the organisation</span>
          <select value={role} onChange={(e) => setRole(e.target.value as typeof role)} aria-label="Organisation role" className={input}>
            {(myRole === 'owner' ? (['editor', 'viewer', 'admin'] as const) : (['editor', 'viewer'] as const)).map((r) => (
              <option key={r} value={r}>{ORG_ROLES[r].label} — {ORG_ROLES[r].note}</option>
            ))}
          </select>
        </label>
        <div>
          <span className="mb-1 block text-[12px] text-muted">Teams to join, with their position there</span>
          <ul className="space-y-1.5">
            {teams.map((t, i) => (
              <li key={t.spaceId} className="grid grid-cols-[1fr_130px_1fr_32px] items-center gap-2">
                <span className="truncate font-medium">{spaces?.find((s) => s.id === t.spaceId)?.name}</span>
                <select value={t.role} onChange={(e) => setTeams(teams.map((x, j) => (j === i ? { ...x, role: e.target.value as typeof x.role } : x)))} aria-label="Team role" className={cn(input, 'h-8')}>
                  <option value="editor">Member</option>
                  <option value="admin">Team lead</option>
                  <option value="viewer">Viewer</option>
                </select>
                <input value={t.title} onChange={(e) => setTeams(teams.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} placeholder="Position (e.g. Designer)" aria-label="Position" className={cn(input, 'h-8')} />
                <button onClick={() => setTeams(teams.filter((_, j) => j !== i))} className="grid size-8 place-items-center rounded-md text-muted hover:bg-hover" aria-label="Remove team"><X size={14} /></button>
              </li>
            ))}
          </ul>
          {free.length > 0 && (
            <select value="" onChange={(e) => e.target.value && setTeams([...teams, { spaceId: e.target.value, role: 'editor', title: '' }])} aria-label="Add a team" className={cn(input, 'mt-1.5 text-muted')} data-testid="invite-team">
              <option value="">+ Add a team…</option>
              {free.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          )}
        </div>
        <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={2} placeholder="A personal note (optional)" aria-label="Message" className={cn(input, 'h-auto py-2')} />
      </div>
    </Dialog>
  );
}

// ── General ─────────────────────────────────────────────────────────────────

function General() {
  const { data } = useGeneral();
  const a = useAdminActions();
  const [url, setUrl] = useState('');
  useEffect(() => setUrl(data?.appUrl ?? ''), [data]);
  return (
    <section>
      <Header title="General" note="Settings of the whole organisation." />
      <div className="card space-y-3 p-5">
        <label className="block max-w-xl">
          <span className="mb-1 block text-[13px] font-medium text-ink">System address</span>
          <span className="mb-2 block text-[12px] text-muted">Where people open Master Office. Links in invitations and password e-mails point here.</span>
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://office.abc.vn" aria-label="System address" className={input} />
        </label>
        <div className="flex gap-2">
          <Button variant="primary" loading={a.saveGeneral.isPending} onClick={() => a.saveGeneral.mutate({ appUrl: url || null }, { onSuccess: () => toast.success('Saved') })} data-testid="general-save">Save</Button>
          <Button variant="ghost" onClick={() => setUrl(location.origin)}>Use this address ({typeof window !== 'undefined' ? location.origin : ''})</Button>
        </div>
      </div>
    </section>
  );
}
