'use client';

import { Suspense } from 'react';
import { AdminConsole } from '@/components/admin/AdminConsole';
import { useMounted } from '@/lib/use-mounted';

export default function Page() {
  const mounted = useMounted();
  return <Suspense>{mounted && <AdminConsole />}</Suspense>;
}
