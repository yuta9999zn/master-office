'use client';

import { Suspense } from 'react';
import { MeetingsApp } from '@/components/meetings/MeetingsApp';

export default function Page() {
  return (
    <Suspense>
      <MeetingsApp />
    </Suspense>
  );
}
