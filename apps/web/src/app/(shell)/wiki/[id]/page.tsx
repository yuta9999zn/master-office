'use client';

import { useQuery } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { EditorShell } from '@/components/editor/EditorShell';
import { Skeleton } from '@/components/ui/primitives';
import { api } from '@/lib/api';

/** A wiki page that belongs to a space opens inside its space (§78); a loose wiki file opens on its own. */
export default function Page() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { data, isPending } = useQuery({ queryKey: ['wiki', 'page-space', id], queryFn: () => api<{ spaceId: string }>(`/wiki/pages/${id}/space`), retry: false });
  useEffect(() => {
    if (data?.spaceId) router.replace(`/wiki/s/${data.spaceId}?page=${id}`);
  }, [data, id, router]);
  if (isPending || data?.spaceId) return <div className="space-y-3 p-6"><Skeleton className="h-12 w-96" /><Skeleton className="h-[60vh]" /></div>;
  return <EditorShell key={id} id={id} kind="wiki" />;
}
