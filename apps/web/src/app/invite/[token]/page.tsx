'use client';

import { useParams } from 'next/navigation';
import { InvitePage } from '@/components/auth/AuthPages';

export default function Page() {
  const { token } = useParams<{ token: string }>();
  return <InvitePage token={token} />;
}
