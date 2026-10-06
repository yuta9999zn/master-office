'use client';

import { Suspense } from 'react';
import { ApprovalsApp } from '@/components/approvals/ApprovalsApp';

export default function Page() {
  return (
    <Suspense>
      <ApprovalsApp />
    </Suspense>
  );
}
