'use client';

import { useParams } from 'next/navigation';
import { FormFill } from '@/components/base/FormFill';

/** Answer page of a Base form view (outside the app shell). */
export default function Page() {
  const { viewId } = useParams<{ viewId: string }>();
  return <FormFill viewId={viewId} />;
}
