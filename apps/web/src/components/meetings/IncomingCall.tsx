'use client';

import { Phone, PhoneOff, Video } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { api } from '@/lib/api';
import { meetingPath, useRinging } from '@/lib/meetings';
import { Avatar } from '../ui/primitives';

const RING_MS = 40_000;

/** Incoming video calls (a call started in one of your DMs or groups): Join / Decline, bottom-right of every page. */
export function IncomingCall() {
  const calls = useRinging((s) => s.calls);
  const router = useRouter();
  const path = usePathname();

  // Calls stop ringing on their own after a while.
  useEffect(() => {
    if (!calls.length) return;
    const t = setInterval(() => useRinging.setState((s) => ({ calls: s.calls.filter((c) => Date.now() - c.at < RING_MS) })), 2000);
    return () => clearInterval(t);
  }, [calls.length]);

  const drop = (id: string) => useRinging.setState((s) => ({ calls: s.calls.filter((c) => c.meetingId !== id) }));
  const visible = calls.filter((c) => !(path === '/meetings' && typeof window !== 'undefined' && window.location.search.includes(c.code)));
  if (!visible.length) return null;

  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col gap-3">
      {visible.map((c) => (
        <div key={c.meetingId} className="flex w-[340px] items-center gap-3 rounded-2xl bg-[#0f172a] p-4 text-white shadow-2xl animate-pop" role="alertdialog" aria-label={`Incoming call from ${c.from.name}`} data-testid="incoming-call">
          <span className="animate-ring rounded-full">
            <Avatar user={c.from} size={44} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1.5 text-[12px] text-white/60">
              <Video size={13} /> Incoming video call
            </p>
            <p className="truncate text-[14.5px] font-semibold">{c.from.name}</p>
          </div>
          <button
            onClick={() => {
              drop(c.meetingId);
              void api(`/meetings/${c.code}/decline`, { method: 'POST' }).catch(() => undefined);
            }}
            className="grid size-10 place-items-center rounded-full bg-red-500 hover:bg-red-600"
            aria-label="Decline"
            data-testid="decline-call"
          >
            <PhoneOff size={18} />
          </button>
          <button
            onClick={() => {
              drop(c.meetingId);
              router.push(meetingPath(c.code));
            }}
            className="grid size-10 place-items-center rounded-full bg-emerald-500 hover:bg-emerald-600"
            aria-label="Join"
            data-testid="accept-call"
          >
            <Phone size={18} />
          </button>
        </div>
      ))}
    </div>
  );
}
