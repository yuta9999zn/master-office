'use client';

import { Suspense } from 'react';
import { MailApp } from '@/components/mail/MailApp';

export default function Page() {
  return (
    <Suspense>
      <MailApp />
    </Suspense>
  );
}
