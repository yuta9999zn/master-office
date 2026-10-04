'use client';

import { useParams } from 'next/navigation';
import { QaAudience } from '@/components/slides/qa';

/** Audience Q&A page (outside the app shell, like the form respondent page). */
export default function Page() {
  const { token } = useParams<{ token: string }>();
  return <QaAudience token={token} />;
}
