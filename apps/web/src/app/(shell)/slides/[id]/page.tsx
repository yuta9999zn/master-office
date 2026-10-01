'use client';

import { useParams } from 'next/navigation';
import { EditorShell } from '@/components/editor/EditorShell';

export default function Page() {
  const { id } = useParams<{ id: string }>();
  return <EditorShell key={id} id={id} kind="slides" />;
}
