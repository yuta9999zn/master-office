'use client';

import { Suspense } from 'react';
import { CalendarApp } from '@/components/calendar/CalendarApp';

export default function Page() {
  return (
    <Suspense>
      <CalendarApp />
    </Suspense>
  );
}
