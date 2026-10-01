'use client';

import { useParams } from 'next/navigation';
import { ComingSoon } from '@/components/shell/ComingSoon';

export default function AppPlaceholder() {
  const { app } = useParams<{ app: string }>();
  return <ComingSoon id={app} />;
}
