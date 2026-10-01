'use client';

import type { DriveView } from '@workos/shared';
import { notFound, useParams } from 'next/navigation';
import { DriveNav } from '@/components/drive/DriveNav';
import { FileBrowser, type DriveLocation } from '@/components/drive/FileBrowser';
import { useResource } from '@/lib/queries';

const VIEWS: DriveView[] = ['home', 'my', 'shared', 'recent', 'starred', 'trash'];

/** /drive, /drive/{my|shared|recent|starred|trash}, /drive/folder/:id, /drive/space/:id */
export default function DrivePage() {
  const { slug = [] } = useParams<{ slug?: string[] }>();
  let location: DriveLocation | null = null;
  if (slug.length === 0) location = { kind: 'view', view: 'home' };
  else if (slug.length === 1 && VIEWS.includes(slug[0] as DriveView)) location = { kind: 'view', view: slug[0] as DriveView };
  else if (slug.length === 2 && slug[0] === 'folder') location = { kind: 'folder', id: slug[1] };
  else if (slug.length === 2 && slug[0] === 'space') location = { kind: 'space', id: slug[1] };

  const { data: folder } = useResource(location?.kind === 'folder' ? location.id : null);
  if (!location) notFound();
  const activeSpaceId = location.kind === 'space' ? location.id : folder?.spaceId ?? undefined;

  return (
    <div className="flex h-full">
      <DriveNav activeSpaceId={activeSpaceId} />
      <div className="min-w-0 flex-1">
        <FileBrowser key={JSON.stringify(location)} location={location} />
      </div>
    </div>
  );
}
