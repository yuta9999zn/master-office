'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { Button, cn, Dialog } from '../ui/primitives';

const input = 'h-9 w-full rounded-lg border border-line-strong bg-surface px-3 text-[13px] outline-none focus:border-brand-500';

/** Profile menu → Password & sign-in: set or change your password; other browsers are signed out (§79). */
export function PasswordDialog({ onClose }: { onClose: () => void }) {
  const { data } = useQuery({ queryKey: ['auth', 'password'], queryFn: () => api<{ hasPassword: boolean }>('/auth/password') });
  const [current, setCurrent] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api('/auth/password', { method: 'POST', json: { current: current || undefined, password: pw } });
      toast.success('Password saved — other browsers were signed out');
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={data?.hasPassword ? 'Change your password' : 'Set a password'}
      description={data?.hasPassword ? 'Other browsers where you are signed in will be signed out.' : 'Sign in with your e-mail and this password from now on.'}
      footer={
        <Button variant="primary" loading={busy} disabled={pw.length < 10 || pw !== pw2 || (data?.hasPassword && !current)} onClick={save} data-testid="password-save">
          Save password
        </Button>
      }
    >
      <div className="space-y-3">
        {data?.hasPassword && <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} placeholder="Current password" aria-label="Current password" autoComplete="current-password" className={input} />}
        <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="New password (at least 10 characters)" aria-label="New password" autoComplete="new-password" className={input} />
        <input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} placeholder="Repeat the new password" aria-label="Repeat password" autoComplete="new-password" className={cn(input, pw2 && pw !== pw2 && 'border-red-400')} />
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-[12.5px] text-red-700">{error}</p>}
      </div>
    </Dialog>
  );
}
