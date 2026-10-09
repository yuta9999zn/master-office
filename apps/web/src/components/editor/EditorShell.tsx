'use client';

import dynamic from 'next/dynamic';
import { useEffect } from 'react';
import { useResource, useResourceActions } from '@/lib/queries';
import { EmptyState, Skeleton } from '../ui/primitives';

export type EditorKind = 'docs' | 'sheets' | 'slides' | 'wiki' | 'base' | 'forms' | 'flow';

const Loading = () => (
  <div className="space-y-3 p-6">
    <Skeleton className="h-12 w-96" />
    <Skeleton className="h-11" />
    <Skeleton className="h-[60vh]" />
  </div>
);

// Every editor is a separate chunk (§85 E): opening a document does not download the spreadsheet, slide, form,
// base and flow editors too. They only run in the browser (Yjs, IndexedDB, canvases), so no server render.
const DocsWorkspace = dynamic(() => import('../docs/DocsWorkspace').then((m) => m.DocsWorkspace), { ssr: false, loading: Loading });
const SheetsWorkspace = dynamic(() => import('../sheets/SheetsWorkspace').then((m) => m.SheetsWorkspace), { ssr: false, loading: Loading });
const SlidesWorkspace = dynamic(() => import('../slides/SlidesWorkspace').then((m) => m.SlidesWorkspace), { ssr: false, loading: Loading });
const FormsWorkspace = dynamic(() => import('../forms/FormsWorkspace').then((m) => m.FormsWorkspace), { ssr: false, loading: Loading });
const BaseWorkspace = dynamic(() => import('../base/BaseWorkspace').then((m) => m.BaseWorkspace), { ssr: false, loading: Loading });
const FlowWorkspace = dynamic(() => import('../flow/FlowWorkspace').then((m) => m.FlowWorkspace), { ssr: false, loading: Loading });

/** Opens a native file in its editor (Docs, Sheets, Slides, Wiki, Forms, Base, Flow) and records the visit. */
export function EditorShell({ id, kind }: { id: string; kind: EditorKind }) {
  const { data: r, error } = useResource(id);
  const acts = useResourceActions();

  useEffect(() => {
    acts.recordAccess.mutate(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (error) return <EmptyState title="Can’t open this file">{(error as Error).message}</EmptyState>;
  if (!r) return <Loading />;

  if (kind === 'docs' || kind === 'wiki') return <DocsWorkspace key={id} r={r} kind={kind} />;
  if (kind === 'sheets') return <SheetsWorkspace key={id} r={r} />;
  if (kind === 'slides') return <SlidesWorkspace key={id} r={r} />;
  if (kind === 'forms') return <FormsWorkspace key={id} r={r} />;
  if (kind === 'flow') return <FlowWorkspace key={id} r={r} />;
  return <BaseWorkspace key={id} r={r} />;
}
