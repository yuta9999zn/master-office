'use client';

import { AlertTriangle } from 'lucide-react';
import Link from 'next/link';
import { useMyStorage, useSpaceStorage, type StorageStatus } from '@/lib/storage';
import { Meter } from '../admin/StorageAdmin';

/** Drive's storage meter (§79 C): My Files, plus the team's when browsing a space. Amber from 80 %, red when full. */
export function StorageMeter({ spaceId, spaceName }: { spaceId?: string; spaceName?: string }) {
  const { data: mine } = useMyStorage();
  const { data: team } = useSpaceStorage(spaceId);
  if (!mine) return null;
  return (
    <div className="space-y-3 border-t border-line px-4 py-3" data-testid="storage-meter">
      <Block label="My files" s={mine} testId="storage-mine" />
      {spaceId && team && <Block label={spaceName ?? 'This team'} s={team} testId="storage-team" />}
      {(mine.full || team?.full) && (
        <p className="flex items-start gap-1.5 text-[11.5px] leading-snug text-red-600" data-testid="storage-full-note">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          <span>
            Storage is full: uploads are refused until space is freed. <Link href="/drive/trash" className="underline">Empty the trash</Link> or ask an administrator for more.
          </span>
        </p>
      )}
      {!mine.full && !team?.full && (mine.warning || team?.warning) && (
        <p className="text-[11.5px] leading-snug text-amber-700" data-testid="storage-warning-note">
          Storage is almost full. Free some space before uploads stop.
        </p>
      )}
    </div>
  );
}

function Block({ label, s, testId }: { label: string; s: StorageStatus; testId: string }) {
  return (
    <div data-testid={testId} data-percent={s.percent ?? ''} data-full={s.full ? '1' : '0'}>
      <div className="mb-0.5 text-[11.5px] font-medium text-subtle">{label}</div>
      <Meter used={s.used} limit={s.limit} percent={s.percent} compact />
    </div>
  );
}
