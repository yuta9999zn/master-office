'use client';

import { FileText, Video } from 'lucide-react';
import Link from 'next/link';
import { formatDuration, meetingPath, useMeeting } from '@/lib/meetings';
import { AvatarStack, cn } from '../ui/primitives';

/** A meeting link in a chat message (§73): live state with Join, or how long it lasted, recordings and notes. */
export function MeetingCard({ code }: { code: string }) {
  const { data: m, isError } = useMeeting(code);
  const ended = m && !m.live && m.endedAt;
  const status = !m
    ? isError
      ? 'Video meeting'
      : 'Loading…'
    : m.live
      ? `In progress · ${m.inRoom.length} ${m.inRoom.length === 1 ? 'person' : 'people'}`
      : ended && m.startedAt
        ? `Ended · ${formatDuration(Date.parse(m.endedAt!) - Date.parse(m.startedAt))}`
        : 'Not started yet';
  return (
    <div className="mt-1 w-[300px] max-w-full rounded-xl bg-surface p-3 ring-1 ring-line" data-testid="meeting-card" data-live={m?.live ? '1' : undefined}>
      <div className="flex items-center gap-3">
        <span className={cn('grid size-10 shrink-0 place-items-center rounded-lg', m?.live ? 'bg-emerald-50 text-emerald-600' : 'bg-brand-50 text-brand-600')}>
          <Video size={19} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13.5px] font-semibold text-ink">{m?.title ?? 'Video meeting'}</p>
          <p className={cn('truncate text-[12px]', m?.live ? 'text-emerald-700' : 'text-muted')} data-testid="meeting-card-status">
            {status}
          </p>
        </div>
        {m?.live && <AvatarStack users={m.inRoom} max={3} size={22} />}
      </div>
      {m && (m.recordings.length > 0 || m.notesId) && (
        <div className="mt-2 flex flex-wrap gap-x-3 text-[12px]">
          {m.recordings.map((r) => (
            <Link key={r.id} href={`/preview/${r.id}`} className="inline-flex items-center gap-1 text-brand-700 hover:underline">
              <Video size={12} /> Recording
            </Link>
          ))}
          {m.notesId && (
            <Link href={`/docs/${m.notesId}`} className="inline-flex items-center gap-1 text-brand-700 hover:underline">
              <FileText size={12} /> Notes
            </Link>
          )}
        </div>
      )}
      <Link
        href={meetingPath(code)}
        className={cn('mt-3 block rounded-lg py-1.5 text-center text-[13px] font-medium', m?.live ? 'bg-brand-600 text-white hover:bg-brand-700' : 'text-brand-700 ring-1 ring-brand-200 hover:bg-brand-50')}
        data-testid="meeting-card-join"
      >
        {m?.live ? 'Join' : ended ? 'Start again' : 'Join'}
      </Link>
    </div>
  );
}
