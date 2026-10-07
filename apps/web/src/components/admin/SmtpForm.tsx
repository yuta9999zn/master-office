'use client';

import { CheckCircle2, ExternalLink, Eye, EyeOff, Lock, Mail, Send, ShieldAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { timeAgo } from '@/lib/format';
import { useAdminActions, useSmtp, type SmtpProvider } from '@/lib/admin';
import { Button, cn } from '../ui/primitives';

const PROVIDERS: { id: SmtpProvider; name: string; note: string }[] = [
  { id: 'gmail', name: 'Gmail / Google Workspace', note: 'Recommended — app password' },
  { id: 'outlook', name: 'Outlook / Microsoft 365', note: 'Only if your tenant still allows SMTP sign-in' },
  { id: 'custom', name: 'Other SMTP server', note: 'Zoho, Brevo, Amazon SES, your own server' },
];

/** The step-by-step guide to an app password, per provider (also in docs/ORG-POLICY.md §4). */
function Guide({ provider }: { provider: SmtpProvider }) {
  const link = (href: string, label: string) => (
    <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 font-medium text-brand-600 hover:underline">
      {label}
      <ExternalLink size={11} />
    </a>
  );
  const steps =
    provider === 'gmail'
      ? [
          <>Sign in to the Google account that will send the e-mails (a dedicated one is best, e.g. <i>noreply.yourcompany@gmail.com</i>).</>,
          <>Open {link('https://myaccount.google.com/security', 'Google Account → Security')}.</>,
          <>Under <b>How you sign in to Google</b>, turn on <b>2-Step Verification</b> (app passwords need it).</>,
          <>Open {link('https://myaccount.google.com/apppasswords', 'App passwords')} (or search “App passwords” in your Google Account).</>,
          <>Type a name such as <b>Master Office</b> and press <b>Create</b>.</>,
          <>Google shows a <b>16-character password</b> (like <code>abcd efgh ijkl mnop</code>). Copy it now — it is shown only once.</>,
          <>Paste it below with the Gmail address, press <b>Save</b>, then <b>Send test e-mail</b>.</>,
        ]
      : provider === 'outlook'
        ? [
            <>Open {link('https://account.microsoft.com/security', 'Microsoft account → Security')} → <b>Advanced security options</b> and turn on <b>Two-step verification</b>.</>,
            <>Under <b>App passwords</b>, choose <b>Create a new app password</b> and copy it.</>,
            <>Microsoft 365 work accounts: an administrator must allow <b>Authenticated SMTP</b> for this mailbox (Microsoft 365 admin center → Users → the person → Mail → Manage email apps).</>,
            <>Paste the address and password below, <b>Save</b>, then <b>Send test e-mail</b>. If the test says the sign-in was refused, Microsoft has turned SMTP passwords off for you — use Gmail or another SMTP service.</>,
          ]
        : [
            <>Ask your e-mail provider for the <b>SMTP server</b>, <b>port</b> and whether it uses <b>SSL (465)</b> or <b>STARTTLS (587)</b>.</>,
            <>Create an <b>app-specific password</b> or SMTP key for this system (e.g. Zoho: Account → Security → App Passwords; Brevo / SES: SMTP keys).</>,
            <>Enter them below, <b>Save</b>, then <b>Send test e-mail</b>.</>,
          ];
  return (
    <ol className="space-y-1.5 text-[12.5px] text-ink-2" data-testid="smtp-guide">
      {steps.map((s, i) => (
        <li key={i} className="flex gap-2">
          <span className="grid size-5 shrink-0 place-items-center rounded-full bg-brand-50 text-[11px] font-bold text-brand-700">{i + 1}</span>
          <span>{s}</span>
        </li>
      ))}
    </ol>
  );
}

const input = 'h-9 w-full rounded-lg border border-line-strong bg-surface px-3 text-[13px] outline-none focus:border-brand-500';

/** Admin → System e-mail (and step 3 of the first-run setup): the mailbox that sends invitations and resets. */
export function SmtpForm({ testTo, onSaved }: { testTo?: string; onSaved?: () => void }) {
  const { data, isLoading } = useSmtp();
  const a = useAdminActions();
  const cur = data?.smtp ?? null;
  const [provider, setProvider] = useState<SmtpProvider>('gmail');
  const [user, setUser] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [fromName, setFromName] = useState('Master Office');
  const [host, setHost] = useState('');
  const [port, setPort] = useState('587');
  const [secure, setSecure] = useState(false);
  const [to, setTo] = useState(testTo ?? '');
  const [testError, setTestError] = useState<string | null>(null);

  useEffect(() => {
    if (!cur) return;
    setProvider(cur.provider);
    setUser(cur.user);
    setFromName(cur.fromName);
    setHost(cur.host);
    setPort(String(cur.port));
    setSecure(cur.secure);
  }, [cur]);
  useEffect(() => setTo((t) => t || testTo || ''), [testTo]);

  const save = () =>
    a.saveSmtp.mutate(
      { provider, user, password: password || null, fromName, ...(provider === 'custom' ? { host, port: Number(port), secure } : {}) },
      {
        onSuccess: () => {
          setPassword('');
          toast.success('System e-mail saved — send a test to check it');
          onSaved?.();
        },
      },
    );
  const test = () => {
    setTestError(null);
    a.testSmtp.mutate(to, { onSuccess: () => toast.success(`Test e-mail sent to ${to}`), onError: (e) => setTestError((e as Error).message) });
  };

  if (isLoading) return null;
  return (
    <div className="space-y-4" data-testid="smtp-form">
      {cur && (
        <div className={cn('flex items-center gap-2 rounded-lg px-3 py-2 text-[12.5px]', cur.verifiedAt ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800')} data-testid="smtp-state">
          {cur.verifiedAt ? <CheckCircle2 size={15} /> : <ShieldAlert size={15} />}
          <span className="flex-1">
            Sending from <b>{cur.user}</b> via {cur.host}:{cur.port}
            {cur.verifiedAt ? ` · tested ${timeAgo(cur.verifiedAt)}` : ' · not tested yet'}
          </span>
          <button onClick={() => a.clearSmtp.mutate()} className="text-[12px] underline">Remove</button>
        </div>
      )}
      <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="E-mail provider">
        {PROVIDERS.map((p) => (
          <button key={p.id} role="radio" aria-checked={provider === p.id} onClick={() => setProvider(p.id)} className={cn('rounded-lg p-2.5 text-left ring-1', provider === p.id ? 'bg-selected ring-brand-400' : 'ring-line hover:bg-hover')} data-testid={`smtp-${p.id}`}>
            <span className="block text-[13px] font-semibold text-ink">{p.name}</span>
            <span className="block text-[11.5px] text-muted">{p.note}</span>
          </button>
        ))}
      </div>
      <div className="rounded-lg bg-canvas p-3 ring-1 ring-line">
        <p className="mb-2 text-[12.5px] font-semibold text-ink">How to get the app password</p>
        <Guide provider={provider} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-[12px] text-muted">{provider === 'custom' ? 'User name (usually the e-mail address)' : 'E-mail address'}</span>
          <input value={user} onChange={(e) => setUser(e.target.value)} placeholder="noreply.company@gmail.com" autoComplete="off" aria-label="Sender e-mail" className={input} />
        </label>
        <label className="block">
          <span className="mb-1 block text-[12px] text-muted">App password {cur?.hasPassword && <i className="text-subtle">(saved — leave empty to keep it)</i>}</span>
          <span className="relative block">
            <input
              type={show ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={cur?.hasPassword ? '••••••••••••••••' : provider === 'gmail' ? 'abcd efgh ijkl mnop' : ''}
              autoComplete="new-password"
              aria-label="App password"
              className={cn(input, 'pr-9')}
            />
            <button type="button" onClick={() => setShow(!show)} className="absolute right-2 top-2 text-subtle" aria-label={show ? 'Hide password' : 'Show password'}>
              {show ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </span>
        </label>
        <label className="block">
          <span className="mb-1 block text-[12px] text-muted">Sender name</span>
          <input value={fromName} onChange={(e) => setFromName(e.target.value)} aria-label="Sender name" className={input} />
        </label>
        {provider === 'custom' && (
          <div className="grid grid-cols-[1fr_80px_110px] gap-2">
            <label className="block">
              <span className="mb-1 block text-[12px] text-muted">SMTP server</span>
              <input value={host} onChange={(e) => setHost(e.target.value)} placeholder="smtp.example.com" aria-label="SMTP server" className={input} />
            </label>
            <label className="block">
              <span className="mb-1 block text-[12px] text-muted">Port</span>
              <input value={port} onChange={(e) => (setPort(e.target.value.replace(/\D/g, '')), setSecure(e.target.value === '465'))} aria-label="Port" className={input} />
            </label>
            <label className="block">
              <span className="mb-1 block text-[12px] text-muted">Security</span>
              <select value={secure ? 'ssl' : 'starttls'} onChange={(e) => setSecure(e.target.value === 'ssl')} aria-label="Security" className={input}>
                <option value="ssl">SSL / TLS</option>
                <option value="starttls">STARTTLS</option>
              </select>
            </label>
          </div>
        )}
      </div>
      <p className="flex items-start gap-1.5 text-[12px] text-muted">
        <Lock size={13} className="mt-0.5 shrink-0" />
        The password is encrypted on the server and never shown again. Enter it only here — never send it by chat or e-mail.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" icon={<Mail size={15} />} loading={a.saveSmtp.isPending} disabled={!user.trim() || (!password && !cur?.hasPassword)} onClick={save} data-testid="smtp-save">
          Save
        </Button>
        {cur && (
          <>
            <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="Send a test to…" aria-label="Test recipient" className={cn(input, 'w-64')} />
            <Button icon={<Send size={15} />} loading={a.testSmtp.isPending} disabled={!to.includes('@')} onClick={test} data-testid="smtp-test">
              Send test e-mail
            </Button>
          </>
        )}
      </div>
      {testError && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-[12.5px] text-red-700" data-testid="smtp-error">
          {testError}
          {/535|534|auth|Username and Password/i.test(testError) && <> — check the address and the app password (not your normal password).</>}
        </p>
      )}
    </div>
  );
}
