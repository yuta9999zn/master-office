'use client';

import { useParams, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { FormRespond } from '@/components/forms/FormRespond';

/** Respondent page of a form (outside the app shell, like Google Forms' viewform). */
function Respond() {
  const { id } = useParams<{ id: string }>();
  const q = useSearchParams();
  const prefill: Record<string, string> = {};
  for (const key of new Set(q.keys())) {
    if (key.startsWith('entry.')) prefill[key.slice(6)] = q.getAll(key).join('\u0000');
  }
  return <FormRespond formId={id} editToken={q.get('edit')} prefill={prefill} summary={q.get('view') === 'summary'} />;
}

export default function Page() {
  return (
    <Suspense>
      <Respond />
    </Suspense>
  );
}
