'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useSession } from '@/lib/admin';

/** Sends a fresh install to /setup and, outside dev mode, signed-out people to /login (§79). */
export function AuthGate() {
  const { data: s } = useSession();
  const router = useRouter();
  const path = usePathname();
  useEffect(() => {
    if (!s) return;
    if (s.needsSetup) router.replace('/setup');
    else if (!s.signedIn && !s.dev) router.replace(`/login?next=${encodeURIComponent(path)}`);
  }, [s, path, router]);
  return null;
}
