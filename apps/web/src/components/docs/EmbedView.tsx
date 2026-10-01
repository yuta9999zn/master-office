'use client';

import { ResourceEmbed } from '@workos/doc-model';
import type { ResourceType } from '@workos/shared';
import { NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from '@tiptap/react';
import { ExternalLink } from 'lucide-react';
import Link from 'next/link';
import { formatBytes, formatDate } from '@/lib/format';
import { useResource } from '@/lib/queries';
import { hrefFor, typeLabel } from '@/lib/resources';
import { cn, FileIcon } from '../ui/primitives';

/** Live card: name, type, size and date always come from Drive, never from the document (no copies). */
function EmbedCard({ node, selected }: ReactNodeViewProps) {
  const id = node.attrs.id as string | null;
  const { data: r, error } = useResource(id);
  const fallback = { type: (node.attrs.type as ResourceType) ?? 'file', mimeType: null, metadata: {} };
  return (
    <NodeViewWrapper data-drag-handle className={cn('my-2 flex items-center gap-3 rounded-xl border bg-white px-4 py-3', selected ? 'border-brand-600 ring-2 ring-brand-100' : 'border-line')}>
      <FileIcon r={r ?? fallback} size={36} className="rounded-lg" />
      <div className="min-w-0 flex-1" contentEditable={false}>
        <div className="truncate text-[14px] font-semibold text-ink">{r?.name ?? node.attrs.name ?? 'Linked file'}</div>
        <div className="truncate text-[12px] text-muted">
          {error ? 'You don’t have access to this file' : r ? `${typeLabel(r)}${r.sizeBytes ? ` · ${formatBytes(r.sizeBytes)}` : ''} · Updated ${formatDate(r.updatedAt)}` : 'Loading…'}
        </div>
      </div>
      {r && (
        <Link href={hrefFor(r)} contentEditable={false} className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[13px] font-medium text-brand-600 hover:bg-brand-50">
          Open <ExternalLink size={13} />
        </Link>
      )}
    </NodeViewWrapper>
  );
}

export const ResourceEmbedWithView = ResourceEmbed.extend({
  addNodeView() {
    return ReactNodeViewRenderer(EmbedCard);
  },
});
