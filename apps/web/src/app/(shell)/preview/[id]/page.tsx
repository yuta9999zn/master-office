'use client';

import { can } from '@workos/shared';
import { ArrowLeft, Download, Share2, Star } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ActivityList } from '@/components/drive/DetailsPanel';
import { ShareDialog } from '@/components/drive/dialogs';
import { Button, EmptyState, FileIcon, Skeleton } from '@/components/ui/primitives';
import { downloadUrl } from '@/lib/api';
import { formatBytes, formatDateTime } from '@/lib/format';
import { useResource, useResourceActions, useResourceActivity } from '@/lib/queries';
import { typeLabel } from '@/lib/resources';

function TextPreview({ id }: { id: string }) {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    fetch(downloadUrl(id, true))
      .then((r) => r.text())
      .then((t) => setText(t.slice(0, 200_000)));
  }, [id]);
  return <pre className="h-full overflow-auto whitespace-pre-wrap rounded-xl bg-white p-6 font-mono text-[13px] text-ink-2 shadow-sm">{text ?? 'Loading…'}</pre>;
}

/** Viewer for binary resources (PDF, image, video, text, other files). */
export default function PreviewPage() {
  const { id } = useParams<{ id: string }>();
  const { data: r, error } = useResource(id);
  const { data: activity } = useResourceActivity(id);
  const acts = useResourceActions();
  const [share, setShare] = useState(false);
  useEffect(() => {
    acts.recordAccess.mutate(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (error) return <EmptyState title="Can’t open this file">{(error as Error).message}</EmptyState>;
  if (!r) return <div className="p-6"><Skeleton className="h-[70vh]" /></div>;

  const src = downloadUrl(id, true);
  const isText = r.mimeType?.startsWith('text/') || /\.(txt|md|csv|json|log)$/i.test(r.name);
  const back = r.parentId ? `/drive/folder/${r.parentId}` : r.spaceId ? `/drive/space/${r.spaceId}` : '/drive/my';

  return (
    <div className="flex h-full flex-col bg-canvas">
      <div className="flex h-16 shrink-0 items-center gap-3 border-b border-line bg-surface px-5">
        <Link href={back} className="rounded-lg p-1.5 text-muted hover:bg-hover" aria-label="Back">
          <ArrowLeft size={18} />
        </Link>
        <FileIcon r={r} size={32} />
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 truncate text-[16px] font-semibold text-ink">
            {r.name}
            <button onClick={() => acts.star.mutate({ id, on: !r.starred })} className="rounded p-1 hover:bg-hover" aria-label="Star">
              <Star size={16} className={r.starred ? 'fill-amber-400 text-amber-400' : 'text-subtle'} />
            </button>
          </div>
          <div className="text-[12px] text-muted">
            {r.breadcrumb.map((b) => b.name).join(' / ')} · {typeLabel(r)} · {formatBytes(r.sizeBytes)}
          </div>
        </div>
        <div className="ml-auto flex gap-2">
          <Button icon={<Download size={15} />} onClick={() => (window.location.href = downloadUrl(id))}>
            Download
          </Button>
          <Button variant="primary" icon={<Share2 size={15} />} onClick={() => setShare(true)}>
            Share
          </Button>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 gap-4 p-5">
        <div className="flex min-w-0 flex-1 items-center justify-center overflow-hidden rounded-xl border border-line bg-[#eef1f6]">
          {r.type === 'image' ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={src} alt={r.name} className="max-h-full max-w-full object-contain p-6" />
          ) : r.type === 'pdf' ? (
            <iframe src={src} title={r.name} className="size-full bg-white" />
          ) : r.type === 'video' ? (
            <video src={src} controls className="max-h-full max-w-full" />
          ) : isText ? (
            <div className="size-full p-4">
              <TextPreview id={id} />
            </div>
          ) : (
            <EmptyState icon={<FileIcon r={r} size={48} />} title="No preview available" action={<Button onClick={() => (window.location.href = downloadUrl(id))}>Download</Button>} />
          )}
        </div>
        <aside className="w-[300px] shrink-0 overflow-y-auto rounded-xl border border-line bg-surface p-4">
          <div className="mb-3 text-[13px] font-semibold text-ink">Details</div>
          {[
            ['Owner', r.owner?.name],
            ['Created', formatDateTime(r.createdAt)],
            ['Modified', formatDateTime(r.updatedAt)],
            ['Size', formatBytes(r.sizeBytes)],
            ['Access', can(r.myRole, 'editor') ? 'You can edit' : 'You can view'],
          ].map(([k, v]) => (
            <div key={k} className="grid grid-cols-[80px_1fr] py-1 text-[13px]">
              <span className="text-muted">{k}</span>
              <span>{v}</span>
            </div>
          ))}
          <div className="mb-3 mt-5 text-[13px] font-semibold text-ink">Activity</div>
          <ActivityList events={activity} />
        </aside>
      </div>
      <ShareDialog resource={share ? r : null} onClose={() => setShare(false)} />
    </div>
  );
}
