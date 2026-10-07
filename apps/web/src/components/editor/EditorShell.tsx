'use client';

import { useEffect } from 'react';
import { DocsWorkspace } from '../docs/DocsWorkspace';
import { SheetsWorkspace } from '../sheets/SheetsWorkspace';
import { SlidesWorkspace } from '../slides/SlidesWorkspace';
import { FormsWorkspace } from '../forms/FormsWorkspace';
import { BaseWorkspace } from '../base/BaseWorkspace';
import { useResource, useResourceActions } from '@/lib/queries';
import { EmptyState, Skeleton } from '../ui/primitives';

export type EditorKind = 'docs' | 'sheets' | 'slides' | 'wiki' | 'base' | 'forms';

/** Opens a native file in its editor (Docs, Sheets, Slides, Wiki, Forms, Base) and records the visit. */
export function EditorShell({ id, kind }: { id: string; kind: EditorKind }) {
  const { data: r, error } = useResource(id);
  const acts = useResourceActions();

  useEffect(() => {
    acts.recordAccess.mutate(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (error) return <EmptyState title="Can’t open this file">{(error as Error).message}</EmptyState>;
  if (!r) return <div className="space-y-3 p-6"><Skeleton className="h-12 w-96" /><Skeleton className="h-11" /><Skeleton className="h-[60vh]" /></div>;

  if (kind === 'docs' || kind === 'wiki') return <DocsWorkspace key={id} r={r} kind={kind} />;
  if (kind === 'sheets') return <SheetsWorkspace key={id} r={r} />;
  if (kind === 'slides') return <SlidesWorkspace key={id} r={r} />;
  if (kind === 'forms') return <FormsWorkspace key={id} r={r} />;
  return <BaseWorkspace key={id} r={r} />;
}
