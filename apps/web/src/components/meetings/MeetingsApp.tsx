'use client';

import { useSearchParams } from 'next/navigation';
import { useMounted } from '@/lib/use-mounted';
import { MeetingRoom } from './MeetingRoom';
import { MeetingsHome } from './MeetingsHome';

/** /meetings (home) and /meetings?room=abc-defg-hij (a room) — docs/ARCHITECTURE.md §73. */
export function MeetingsApp() {
  const room = useSearchParams().get('room');
  const mounted = useMounted();
  if (!mounted) return <div className="h-full bg-canvas" />;
  return room ? <MeetingRoom key={room} code={room.toLowerCase()} /> : <MeetingsHome />;
}
