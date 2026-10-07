'use client';

import { useParams } from 'next/navigation';
import { ResetPage } from '@/components/auth/AuthPages';

export default function Page() {
  const { token } = useParams<{ token: string }>();
  return <ResetPage token={token} />;
}
