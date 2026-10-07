'use client';

import { useParams } from 'next/navigation';
import { Suspense } from 'react';
import { SpaceView } from '@/components/wiki/SpaceView';

export default function Page() {
  const { spaceId } = useParams<{ spaceId: string }>();
  return (
    <Suspense>
      <SpaceView key={spaceId} spaceId={spaceId} />
    </Suspense>
  );
}
