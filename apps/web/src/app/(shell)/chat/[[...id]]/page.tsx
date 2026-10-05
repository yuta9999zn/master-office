'use client';

import { useParams } from 'next/navigation';
import { ChatApp } from '@/components/chat/ChatApp';

export default function Page() {
  const { id = [] } = useParams<{ id?: string[] }>();
  return <ChatApp id={id[0]} />;
}
