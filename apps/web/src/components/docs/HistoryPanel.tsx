'use client';

import { History, Save } from 'lucide-react';
import { useState } from 'react';
import { formatBytes, formatDateTime } from '@/lib/format';
import { useResourceVersions, useVersionActions } from '@/lib/queries';
import { Avatar, Button, cn, EmptyState, Skeleton } from '../ui/primitives';

export function HistoryPanel({ resourceId, canEdit, previewing, onPreview }: { resourceId: string; canEdit: boolean; previewing: string | null; onPreview: (id: string | null) => void }) {
  const { data: versions, isLoading } = useResourceVersions(resourceId);
  const { save } = useVersionActions(resourceId);
  const [label, setLabel] = useState('');

  return (
    <div className="flex h-full flex-col">
      {canEdit && (
        <div className="flex gap-2 border-b border-line px-4 py-3">
          <input className="input h-8" placeholder="Name this version (optional)" value={label} onChange={(e) => setLabel(e.target.value)} />
          <Button
            size="sm"
            variant="soft"
            icon={<Save size={14} />}
            loading={save.isPending}
            onClick={async () => {
              await save.mutateAsync(label.trim() || null);
              setLabel('');
            }}
          >
            Save
          </Button>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {isLoading ? (
          <div className="space-y-2 p-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-12" />)}</div>
        ) : !versions?.length ? (
          <EmptyState icon={<History size={28} />} title="No versions yet">
            Versions are saved automatically every 15 minutes of editing, and whenever you save one here.
          </EmptyState>
        ) : (
          <>
            <button onClick={() => onPreview(null)} className={cn('mb-1 flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left', !previewing ? 'bg-selected' : 'hover:bg-hover')}>
              <span className="size-2 rounded-full bg-emerald-500" />
              <span className="text-[13px] font-semibold text-ink">Current version</span>
            </button>
            {versions.map((v) => {
              const snapshot = !v.label?.startsWith('Original upload');
              return (
                <button
                  key={v.id}
                  disabled={!snapshot}
                  onClick={() => onPreview(v.id)}
                  className={cn('flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left disabled:cursor-default', previewing === v.id ? 'bg-selected' : 'hover:bg-hover disabled:hover:bg-transparent')}
                >
                  {v.createdBy ? <Avatar user={v.createdBy} size={26} /> : <span className="size-[26px] rounded-full bg-hover" />}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium text-ink">{v.label ?? 'Auto-saved'}</span>
                    <span className="block text-[11px] text-muted">
                      {formatDateTime(v.createdAt)} · {v.createdBy?.name.split(' ')[0] ?? 'System'}
                      {!snapshot && ` · ${formatBytes(v.sizeBytes)} original file`}
                    </span>
                  </span>
                  <span className="text-[11px] text-subtle">v{v.version}</span>
                </button>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}
