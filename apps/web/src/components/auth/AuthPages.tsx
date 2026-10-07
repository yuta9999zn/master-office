'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, Building2, CheckCircle2, KeyRound, Mail, ShieldCheck, Users } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { api } from '@/lib/api';
import { useSession } from '@/lib/admin';
import { Button, cn, Wordmark } from '../ui/primitives';
import { SmtpForm } from '../admin/SmtpForm';

const input = 'h-10 w-full rounded-lg border border-line-strong bg-surface px-3 text-[14px] outline-none focus:border-brand-500';

export function AuthCard({ title, subtitle, children, wide }: { title: string; subtitle?: ReactNode; children: ReactNode; wide?: boolean }) {
  return (
    <div className="flex min-h-screen flex-col items-center bg-canvas px-4 py-10">
      <Wordmark className="mb-8" />
      <div className={cn('card w-full p-7', wide ? 'max-w-[760px]' : 'max-w-[420px]')}>
        <h1 className="text-[20px] font-bold text-ink">{title}</h1>
        {subtitle && <p className="mt-1 text-[13px] text-muted">{subtitle}</p>}
        <div className="mt-5">{children}</div>
      </div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[12.5px] font-medium text-ink-2">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11.5px] text-subtle">{hint}</span>}
    </label>
  );
}

function ErrorLine({ error }: { error: string | null }) {
  return error ? (
    <p className="rounded-lg bg-red-50 px-3 py-2 text-[12.5px] text-red-700" role="alert" data-testid="auth-error">
      {error}
    </p>
  ) : null;
}

/** After signing in the whole app reloads, so no cached data of another person survives. */
const enter = (to = '/home') => {
  window.location.href = to;
};

function usePost() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run, setError };
}

// ── /login ──────────────────────────────────────────────────────────────────

export function LoginPage() {
  const router = useRouter();
  const { data: s } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const p = usePost();
  useEffect(() => {
    if (s?.needsSetup) router.replace('/setup');
  }, [s, router]);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (await p.run(() => api('/auth/login', { method: 'POST', json: { email, password } }))) enter(new URLSearchParams(location.search).get('next') ?? '/home');
  };
  return (
    <AuthCard title="Sign in" subtitle="Welcome back to your workspace.">
      <form onSubmit={submit} className="space-y-3">
        <Field label="Work e-mail">
          <input autoFocus type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" aria-label="E-mail" className={input} />
        </Field>
        <Field label="Password">
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" aria-label="Password" className={input} />
        </Field>
        <ErrorLine error={p.error} />
        <Button variant="primary" className="h-10 w-full" loading={p.busy} disabled={!email || !password} data-testid="login-submit">
          Sign in
        </Button>
        <div className="flex justify-between text-[12.5px]">
          <Link href="/forgot" className="text-brand-600 hover:underline">Forgot password?</Link>
          {s?.dev && <Link href="/home" className="text-muted hover:underline">Dev mode: continue without signing in</Link>}
        </div>
      </form>
    </AuthCard>
  );
}

// ── /forgot and /reset/:token ───────────────────────────────────────────────

export function ForgotPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const p = usePost();
  return (
    <AuthCard title="Reset your password" subtitle="We e-mail you a link to choose a new one.">
      {sent ? (
        <div className="space-y-3 text-[13px] text-ink-2" data-testid="forgot-sent">
          <p className="flex items-start gap-2"><CheckCircle2 size={18} className="mt-0.5 shrink-0 text-emerald-600" />If an account uses <b>{email}</b>, a link is on its way. It works for one hour.</p>
          <p className="text-muted">Nothing arrived? Check spam, or ask your administrator to send you a password link.</p>
          <Link href="/login" className="inline-flex items-center gap-1 text-brand-600 hover:underline"><ArrowLeft size={14} /> Back to sign in</Link>
        </div>
      ) : (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (await p.run(() => api('/auth/forgot', { method: 'POST', json: { email } }))) setSent(true);
          }}
          className="space-y-3"
        >
          <Field label="Work e-mail">
            <input autoFocus type="email" value={email} onChange={(e) => setEmail(e.target.value)} aria-label="E-mail" className={input} />
          </Field>
          <ErrorLine error={p.error} />
          <Button variant="primary" className="h-10 w-full" loading={p.busy} disabled={!email.includes('@')} data-testid="forgot-submit">Send link</Button>
          <Link href="/login" className="inline-flex items-center gap-1 text-[12.5px] text-brand-600 hover:underline"><ArrowLeft size={14} /> Back to sign in</Link>
        </form>
      )}
    </AuthCard>
  );
}

function NewPassword({ busy, cta, onSubmit, error, name }: { busy: boolean; cta: string; onSubmit: (pw: string, name: string) => void; error: string | null; name?: boolean }) {
  const [full, setFull] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const mismatch = !!pw2 && pw !== pw2;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(pw, full);
      }}
      className="space-y-3"
    >
      {name && (
        <Field label="Your name">
          <input autoFocus value={full} onChange={(e) => setFull(e.target.value)} autoComplete="name" aria-label="Your name" className={input} />
        </Field>
      )}
      <Field label="Password" hint="At least 10 characters. A short sentence is easy to remember and hard to guess.">
        <input autoFocus={!name} type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" aria-label="New password" className={input} />
      </Field>
      <Field label="Repeat the password">
        <input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" aria-label="Repeat password" className={cn(input, mismatch && 'border-red-400')} />
      </Field>
      <ErrorLine error={error ?? (mismatch ? 'The passwords are different' : null)} />
      <Button variant="primary" className="h-10 w-full" loading={busy} disabled={pw.length < 10 || pw !== pw2 || (name && !full.trim())} data-testid="password-submit">
        {cta}
      </Button>
    </form>
  );
}

export function ResetPage({ token }: { token: string }) {
  const info = useQuery({ queryKey: ['auth', 'reset', token], queryFn: () => api<{ email: string; name: string }>(`/auth/reset/${token}`), retry: false });
  const p = usePost();
  if (info.error)
    return (
      <AuthCard title="This link doesn’t work">
        <p className="text-[13px] text-ink-2">{(info.error as Error).message}</p>
        <Link href="/forgot" className="mt-3 inline-block text-[13px] text-brand-600 hover:underline">Ask for a new link</Link>
      </AuthCard>
    );
  return (
    <AuthCard title="Choose a password" subtitle={info.data ? <>For <b>{info.data.email}</b></> : '…'}>
      <NewPassword busy={p.busy} error={p.error} cta="Save and sign in" onSubmit={async (password) => (await p.run(() => api(`/auth/reset/${token}`, { method: 'POST', json: { password } }))) && enter()} />
    </AuthCard>
  );
}

// ── /invite/:token ──────────────────────────────────────────────────────────

interface InviteInfo {
  email: string;
  workspace: string;
  invitedBy: string | null;
  role: string;
  teams: { name: string; title: string | null }[];
  message: string | null;
}

export function InvitePage({ token }: { token: string }) {
  const info = useQuery({ queryKey: ['auth', 'invite', token], queryFn: () => api<InviteInfo>(`/invitations/${token}`), retry: false });
  const p = usePost();
  if (info.error)
    return (
      <AuthCard title="This invitation doesn’t work">
        <p className="text-[13px] text-ink-2">{(info.error as Error).message}</p>
        <Link href="/login" className="mt-3 inline-block text-[13px] text-brand-600 hover:underline">Go to sign in</Link>
      </AuthCard>
    );
  const d = info.data;
  return (
    <AuthCard title={d ? `Join ${d.workspace}` : 'Invitation'} subtitle={d ? <>{d.invitedBy ?? 'An administrator'} invited <b>{d.email}</b> to Master Office.</> : '…'}>
      {d && (
        <div className="mb-4 space-y-2" data-testid="invite-info">
          {d.message && <p className="rounded-lg bg-canvas px-3 py-2 text-[13px] italic text-ink-2 ring-1 ring-line">“{d.message}”</p>}
          {d.teams.length > 0 && (
            <p className="flex flex-wrap items-center gap-1.5 text-[12.5px] text-muted">
              <Users size={14} /> You’ll join
              {d.teams.map((t) => (
                <span key={t.name} className="rounded bg-brand-50 px-1.5 py-0.5 font-medium text-brand-700">
                  {t.name}
                  {t.title ? ` · ${t.title}` : ''}
                </span>
              ))}
            </p>
          )}
        </div>
      )}
      <NewPassword name busy={p.busy} error={p.error} cta="Create my account" onSubmit={async (password, name) => (await p.run(() => api(`/invitations/${token}/accept`, { method: 'POST', json: { name, password } }))) && enter()} />
    </AuthCard>
  );
}

// ── /setup: the first run ───────────────────────────────────────────────────

const STEPS = [
  { icon: Building2, title: 'Organisation' },
  { icon: ShieldCheck, title: 'Admin account' },
  { icon: Mail, title: 'System e-mail' },
  { icon: Users, title: 'Invite people' },
];

export function SetupPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const { data: s } = useSession();
  const [step, setStep] = useState(0);
  const [org, setOrg] = useState({ orgName: '', mailDomain: '' });
  const [admin, setAdmin] = useState({ name: '', email: '', password: '', password2: '' });
  const p = usePost();
  // Opened after setup (another browser, a reload past step 2): nothing to do here.
  useEffect(() => {
    if (s && !s.needsSetup && step < 2) router.replace(s.signedIn ? '/home' : '/login');
  }, [s, step, router]);

  const create = async () => {
    const ok = await p.run(() => api('/setup', { method: 'POST', json: { orgName: org.orgName, mailDomain: org.mailDomain || null, name: admin.name, email: admin.email, password: admin.password, appUrl: location.origin } }));
    if (ok) {
      qc.clear();
      setStep(2);
    }
  };
  const mismatch = !!admin.password2 && admin.password !== admin.password2;
  return (
    <AuthCard wide title="Set up Master Office" subtitle="Four short steps. You can change everything later in Admin.">
      <ol className="mb-6 grid grid-cols-4 gap-2" data-testid="setup-steps">
        {STEPS.map((x, i) => (
          <li key={x.title} className={cn('flex items-center gap-2 rounded-lg px-2.5 py-2 text-[12.5px]', i === step ? 'bg-selected font-semibold text-brand-700' : i < step ? 'text-emerald-700' : 'text-subtle')}>
            {i < step ? <CheckCircle2 size={16} /> : <x.icon size={16} />}
            <span className="truncate">{i + 1}. {x.title}</span>
          </li>
        ))}
      </ol>

      {step === 0 && (
        <form onSubmit={(e) => (e.preventDefault(), setStep(1))} className="space-y-3">
          <Field label="Organisation name">
            <input autoFocus value={org.orgName} onChange={(e) => setOrg({ ...org, orgName: e.target.value })} placeholder="ABC Company" aria-label="Organisation name" className={input} />
          </Field>
          <Field label="E-mail domain (optional)" hint="Your people’s addresses end with it, e.g. abc.vn. Used for workspace mailboxes.">
            <input value={org.mailDomain} onChange={(e) => setOrg({ ...org, mailDomain: e.target.value })} placeholder="abc.vn" aria-label="E-mail domain" className={input} />
          </Field>
          <div className="flex justify-end">
            <Button variant="primary" disabled={!org.orgName.trim()} icon={<ArrowRight size={15} />} data-testid="setup-next">Next</Button>
          </div>
        </form>
      )}

      {step === 1 && (
        <form onSubmit={(e) => (e.preventDefault(), void create())} className="space-y-3">
          <p className="rounded-lg bg-canvas px-3 py-2 text-[12.5px] text-ink-2 ring-1 ring-line">
            This is the <b>owner</b> account — the highest role. It configures the system, invites people and names other administrators. Use the work e-mail of the person in charge.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Your name">
              <input autoFocus value={admin.name} onChange={(e) => setAdmin({ ...admin, name: e.target.value })} autoComplete="name" aria-label="Your name" className={input} />
            </Field>
            <Field label="Work e-mail">
              <input type="email" value={admin.email} onChange={(e) => setAdmin({ ...admin, email: e.target.value })} autoComplete="username" aria-label="E-mail" className={input} />
            </Field>
            <Field label="Password" hint="At least 10 characters.">
              <input type="password" value={admin.password} onChange={(e) => setAdmin({ ...admin, password: e.target.value })} autoComplete="new-password" aria-label="New password" className={input} />
            </Field>
            <Field label="Repeat the password">
              <input type="password" value={admin.password2} onChange={(e) => setAdmin({ ...admin, password2: e.target.value })} autoComplete="new-password" aria-label="Repeat password" className={cn(input, mismatch && 'border-red-400')} />
            </Field>
          </div>
          <ErrorLine error={p.error ?? (mismatch ? 'The passwords are different' : null)} />
          <div className="flex justify-between">
            <Button type="button" variant="ghost" icon={<ArrowLeft size={15} />} onClick={() => setStep(0)}>Back</Button>
            <Button variant="primary" loading={p.busy} disabled={!admin.name.trim() || !admin.email.includes('@') || admin.password.length < 10 || admin.password !== admin.password2} icon={<KeyRound size={15} />} data-testid="setup-create">
              Create the organisation
            </Button>
          </div>
        </form>
      )}

      {step === 2 && (
        <div className="space-y-4">
          <p className="text-[13px] text-ink-2">
            Connect a mailbox that sends <b>invitations</b> and <b>password resets</b>. You need an <b>app password</b> — not your normal e-mail password. The steps are below.
          </p>
          <SmtpForm testTo={admin.email} />
          <div className="flex justify-end gap-2 border-t border-line pt-4">
            <Button variant="ghost" onClick={() => setStep(3)} data-testid="setup-skip-mail">Skip for now</Button>
            <Button variant="primary" icon={<ArrowRight size={15} />} onClick={() => setStep(3)} data-testid="setup-next-mail">Next</Button>
          </div>
        </div>
      )}

      {step === 3 && <SetupInvite onDone={() => enter('/home')} />}
    </AuthCard>
  );
}

function SetupInvite({ onDone }: { onDone: () => void }) {
  const [team, setTeam] = useState('');
  const [emails, setEmails] = useState('');
  const [links, setLinks] = useState<{ email: string; link?: string }[] | null>(null);
  const p = usePost();
  const list = emails.split(/[\s,;]+/).filter((x) => x.includes('@'));
  const go = async () => {
    let shared: { email: string; link?: string }[] = [];
    const ok = await p.run(async () => {
      const teamId = team.trim() ? (await api<{ id: string }>('/spaces', { method: 'POST', json: { name: team.trim(), visibility: 'public' } })).id : null;
      if (!list.length) return;
      const r = await api<{ delivered: boolean; results: { email: string; status: string; link?: string }[] }>('/admin/invitations', {
        method: 'POST',
        json: { emails: list, role: 'editor', teams: teamId ? [{ spaceId: teamId, role: 'editor' }] : [] },
      });
      // Without a system e-mail the admin sends the links by hand.
      shared = r.delivered ? [] : r.results.filter((x) => x.link);
    });
    if (!ok) return;
    if (shared.length) setLinks(shared);
    else onDone();
  };
  if (links)
    return (
      <div className="space-y-3" data-testid="setup-links">
        <p className="text-[13px] text-ink-2">No system e-mail yet, so send these links yourself (chat, Zalo, e-mail). Each works once, for 7 days.</p>
        <ul className="space-y-1.5">
          {links.map((l) => (
            <li key={l.email} className="flex items-center gap-2 text-[12.5px]">
              <span className="w-56 truncate font-medium">{l.email}</span>
              <input readOnly value={l.link} className={cn(input, 'h-8 flex-1 text-[12px]')} onFocus={(e) => e.currentTarget.select()} aria-label={`Invitation link for ${l.email}`} />
            </li>
          ))}
        </ul>
        <div className="flex justify-end">
          <Button variant="primary" onClick={onDone} data-testid="setup-finish">Open Master Office</Button>
        </div>
      </div>
    );
  return (
    <div className="space-y-3">
      <Field label="Your first team or department (optional)" hint="A space with its own chat, files, calendar and tasks. Add more in Admin → Teams.">
        <input value={team} onChange={(e) => setTeam(e.target.value)} placeholder="Sales" aria-label="First team" className={input} />
      </Field>
      <Field label="Invite people (optional)" hint="E-mail addresses, separated by commas or new lines. They join as members of the team above.">
        <textarea value={emails} onChange={(e) => setEmails(e.target.value)} rows={3} placeholder="an@abc.vn, binh@abc.vn" aria-label="Invite e-mails" className={cn(input, 'h-auto py-2')} />
      </Field>
      <ErrorLine error={p.error} />
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onDone} data-testid="setup-skip-invite">Skip</Button>
        <Button variant="primary" loading={p.busy} disabled={!team.trim() && !list.length} onClick={() => void go()} data-testid="setup-invite">
          {list.length ? `Invite ${list.length} ${list.length === 1 ? 'person' : 'people'}` : 'Create team'}
        </Button>
      </div>
    </div>
  );
}
