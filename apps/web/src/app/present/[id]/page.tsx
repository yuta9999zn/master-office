'use client';

import { useParams } from 'next/navigation';
import { PresenterView } from '@/components/slides/Presenter';

/** Presenter window (opened from a slide show): notes, next slide, timer; the show runs in the other window. */
export default function Page() {
  const { id } = useParams<{ id: string }>();
  return <PresenterView resourceId={id} />;
}
