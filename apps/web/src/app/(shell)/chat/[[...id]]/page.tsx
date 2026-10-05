'use client';

import { useParams } from 'next/navigation';
import { Suspense } from 'react';
import { ChatApp } from '@/components/chat/ChatApp';

export default function Page() {
  const { id = [] } = useParams<{ id?: string[] }>();
  return (
    <Suspense>
      <ChatApp id={id[0]} />
    </Suspense>
  );
}
