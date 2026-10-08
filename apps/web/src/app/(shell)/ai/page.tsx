'use client';

import { Suspense } from 'react';
import { AiHome } from '@/components/ai/AiHome';
import { useMounted } from '@/lib/use-mounted';

export default function Page() {
  const mounted = useMounted();
  return <Suspense>{mounted && <AiHome />}</Suspense>;
}
