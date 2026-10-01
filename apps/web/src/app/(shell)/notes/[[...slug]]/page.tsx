'use client';

import { useParams } from 'next/navigation';
import { Suspense, useEffect } from 'react';
import { NotesList } from '@/components/notes/NotesList';
import { NotesNav } from '@/components/notes/NotesNav';
import { NoteWorkspace } from '@/components/notes/NoteWorkspace';
import { EmptyState, Skeleton } from '@/components/ui/primitives';
import { useResource, useResourceActions } from '@/lib/queries';

/** /notes (lists, filtered by ?nb= ?tag= ?fav= ?view=mindmaps) and /notes/:id (note + mind map). */
function NotesApp() {
  const { slug = [] } = useParams<{ slug?: string[] }>();
  const id = slug[0];
  const { data: note, error } = useResource(id);
  const { recordAccess } = useResourceActions();
  useEffect(() => {
    if (id) recordAccess.mutate(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  return (
    <div className="flex h-full">
      <NotesNav currentNote={note ?? null} />
      <div className="min-w-0 flex-1">
        {!id ? (
          <NotesList />
        ) : error ? (
          <EmptyState title="Can’t open this note">{(error as Error).message}</EmptyState>
        ) : note ? (
          <NoteWorkspace r={note} />
        ) : (
          <Skeleton className="m-6 h-[70vh]" />
        )}
      </div>
    </div>
  );
}

export default function NotesPage() {
  return (
    <Suspense>
      <NotesApp />
    </Suspense>
  );
}
