'use client';

import { MEETING_CODE, meetingCodeFromUrl, type MeetingDetail, type MeetingSummary } from '@workos/shared';
import { useQueryClient } from '@tanstack/react-query';
import { CalendarPlus, Copy, FileText, Keyboard, Link2, Plus, Radio, Video } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useEvents } from '@/lib/calendar';
import { formatDuration, meetingPath, useMeetings, useStartMeeting } from '@/lib/meetings';
import { AvatarStack, Button, cn, Dialog, EmptyState, Menu, MenuContent, MenuItem, MenuTrigger } from '../ui/primitives';

const dayFmt = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
const timeFmt = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' });

/** /meetings without a room: start or join, what is coming up today and this week, and past meetings. */
export function MeetingsHome() {
  const router = useRouter();
  const start = useStartMeeting();
  const qc = useQueryClient();
  const [code, setCode] = useState('');
  const [later, setLater] = useState<MeetingDetail | null>(null);
  const { data: meetings } = useMeetings();
  const [from, to] = useMemo(() => {
    const f = new Date();
    f.setMinutes(f.getMinutes() - 60);
    return [f, new Date(f.getTime() + 7 * 86400_000)];
  }, []);
  const { data: events } = useEvents(from, to);
  const upcoming = (events ?? []).filter((e) => e.meetingUrl && !e.busyOnly && new Date(e.end) > new Date()).slice(0, 6);

  const typed = meetingCodeFromUrl(code.trim()) ?? code.trim().toLowerCase();
  const join = () => {
    if (!MEETING_CODE.test(typed)) return toast.error('Enter a code like abc-defg-hij or a meeting link');
    router.push(meetingPath(typed));
  };
  const forLater = async () => {
    try {
      const m = await api<MeetingDetail>('/meetings', { method: 'POST', json: {} });
      void qc.invalidateQueries({ queryKey: ['meetings', 'list'] });
      setLater(m);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const link = (c: string) => `${window.location.origin}${meetingPath(c)}`;

  return (
    <div className="flex h-full flex-col bg-surface">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line px-5">
        <Video size={20} className="text-brand-600" />
        <h1 className="text-[17px] font-semibold text-ink">Meetings</h1>
      </header>
      <div className="min-h-0 flex-1 overflow-auto bg-canvas">
        <div className="mx-auto max-w-[1100px] px-8 py-8">
          <section className="flex flex-wrap items-end gap-8 rounded-2xl bg-gradient-to-br from-[#eef4ff] via-white to-[#f4efff] p-8 ring-1 ring-line">
            <div className="min-w-[320px] flex-1">
              <h2 className="text-[26px] font-semibold leading-tight text-ink">Video meetings for your team</h2>
              <p className="mt-2 max-w-[520px] text-[14px] text-muted">Meet face to face, share your screen, record to Drive and take notes together — straight from Chat, Calendar or here.</p>
              <div className="mt-6 flex flex-wrap items-center gap-3">
                <Menu>
                  <MenuTrigger asChild>
                    <Button variant="primary" icon={<Plus size={16} />} data-testid="new-meeting">
                      New meeting
                    </Button>
                  </MenuTrigger>
                  <MenuContent>
                    <MenuItem icon={<Video size={15} />} onSelect={() => start.mutate({})} data-testid="instant-meeting">
                      Start an instant meeting
                    </MenuItem>
                    <MenuItem icon={<Link2 size={15} />} onSelect={() => void forLater()} data-testid="meeting-for-later">
                      Create a meeting for later
                    </MenuItem>
                    <MenuItem icon={<CalendarPlus size={15} />} onSelect={() => router.push('/calendar?create=1')}>
                      Schedule in Calendar
                    </MenuItem>
                  </MenuContent>
                </Menu>
                <form
                  className="flex items-center gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    join();
                  }}
                >
                  <label className="flex h-9 w-64 items-center gap-2 rounded-lg bg-white px-3 text-[13.5px] ring-1 ring-line-strong focus-within:ring-brand-500">
                    <Keyboard size={16} className="text-subtle" />
                    <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Enter a code or link" className="min-w-0 flex-1 bg-transparent outline-none" aria-label="Meeting code" data-testid="meeting-code" />
                  </label>
                  <Button type="submit" variant="ghost" disabled={!code.trim()} data-testid="join-code">
                    Join
                  </Button>
                </form>
              </div>
            </div>
          </section>

          <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_1.4fr]">
            <section>
              <h3 className="mb-3 text-[14px] font-semibold text-ink">Coming up</h3>
              <div className="rounded-xl bg-surface ring-1 ring-line" data-testid="upcoming-meetings">
                {upcoming.length ? (
                  upcoming.map((e) => {
                    const room = e.meetingProvider === 'kaori' ? meetingCodeFromUrl(e.meetingUrl) : null;
                    const now = new Date(e.start) <= new Date();
                    return (
                      <div key={`${e.id}:${e.occurrence}`} className="flex items-center gap-3 border-b border-line px-4 py-3 last:border-0">
                        <div className="w-16 shrink-0 text-[12px] leading-tight text-muted">
                          <div className="font-semibold text-ink-2">{dayFmt.format(new Date(e.start)).split(', ')[0]}</div>
                          {e.allDay ? 'All day' : timeFmt.format(new Date(e.start))}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[13.5px] font-medium text-ink">{e.title}</p>
                          <p className="truncate text-[12px] text-muted">{e.organizer?.name ?? ''}{e.attendees.length > 1 ? ` · ${e.attendees.length} people` : ''}</p>
                        </div>
                        {room ? (
                          <Link href={meetingPath(room)} className={cn('rounded-lg px-3 py-1.5 text-[12.5px] font-medium', now ? 'bg-brand-600 text-white hover:bg-brand-700' : 'text-brand-700 ring-1 ring-brand-200 hover:bg-brand-50')}>
                            {now ? 'Join now' : 'Join'}
                          </Link>
                        ) : (
                          <a href={e.meetingUrl!} target="_blank" rel="noreferrer" className="rounded-lg px-3 py-1.5 text-[12.5px] font-medium text-brand-700 ring-1 ring-brand-200 hover:bg-brand-50">
                            Open link
                          </a>
                        )}
                      </div>
                    );
                  })
                ) : (
                  <p className="px-4 py-8 text-center text-[13px] text-muted">No meetings with a video link in the next 7 days.</p>
                )}
              </div>
            </section>
            <section>
              <h3 className="mb-3 text-[14px] font-semibold text-ink">Your meetings</h3>
              <div className="rounded-xl bg-surface ring-1 ring-line" data-testid="meeting-history">
                {meetings?.length ? meetings.map((m) => <HistoryRow key={m.id} m={m} />) : <EmptyState icon={<Video size={22} />} title="No meetings yet">Meetings you host or join show up here with their recordings and notes.</EmptyState>}
              </div>
            </section>
          </div>
        </div>
      </div>
      <Dialog open={!!later} onOpenChange={(o) => !o && setLater(null)} title="Here's your meeting link">
        {later && (
          <div className="space-y-4">
            <p className="text-[13.5px] text-muted">Copy this link and send it to people you want to meet with. Save it so you can use it later, too.</p>
            <div className="flex items-center gap-2 rounded-lg bg-canvas px-3 py-2.5 text-[13.5px] ring-1 ring-line">
              <span className="min-w-0 flex-1 truncate font-mono text-ink" data-testid="later-link">
                {link(later.code)}
              </span>
              <button
                onClick={() => {
                  void navigator.clipboard?.writeText(link(later.code));
                  toast.success('Link copied');
                }}
                className="rounded p-1 text-muted hover:bg-hover"
                aria-label="Copy link"
              >
                <Copy size={16} />
              </button>
            </div>
            <div className="flex justify-end">
              <Button variant="primary" onClick={() => router.push(meetingPath(later.code))}>
                Join now
              </Button>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
}

function HistoryRow({ m }: { m: MeetingSummary }) {
  const when = m.startedAt ?? m.createdAt;
  const length = m.startedAt && m.endedAt && m.endedAt > m.startedAt ? formatDuration(Date.parse(m.endedAt) - Date.parse(m.startedAt)) : null;
  return (
    <div className="flex items-center gap-3 border-b border-line px-4 py-3 last:border-0" data-testid="meeting-row" data-code={m.code}>
      <span className={cn('grid size-9 shrink-0 place-items-center rounded-lg', m.live ? 'bg-red-50 text-red-600' : 'bg-brand-50 text-brand-600')}>{m.live ? <Radio size={17} /> : <Video size={17} />}</span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13.5px] font-medium text-ink">{m.title}</p>
        <p className="truncate text-[12px] text-muted">
          {dayFmt.format(new Date(when))}, {timeFmt.format(new Date(when))}
          {m.live ? ' · in progress' : length ? ` · ${length}` : m.startedAt ? '' : ' · not started'}
        </p>
        {(m.recordings.length > 0 || m.notesId) && (
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[12px]">
            {m.recordings.map((r) => (
              <Link key={r.id} href={`/preview/${r.id}`} className="inline-flex items-center gap-1 text-brand-700 hover:underline" data-testid="recording-link">
                <Video size={12} /> Recording{r.durationMs ? ` (${formatDuration(r.durationMs)})` : ''}
              </Link>
            ))}
            {m.notesId && (
              <Link href={`/docs/${m.notesId}`} className="inline-flex items-center gap-1 text-brand-700 hover:underline">
                <FileText size={12} /> Notes
              </Link>
            )}
          </div>
        )}
      </div>
      {(m.live ? m.inRoom : m.participants).length > 0 && <AvatarStack users={m.live ? m.inRoom : m.participants} max={4} size={24} />}
      <Link href={meetingPath(m.code)} className={cn('rounded-lg px-3 py-1.5 text-[12.5px] font-medium', m.live ? 'bg-brand-600 text-white hover:bg-brand-700' : 'text-ink-2 ring-1 ring-line-strong hover:bg-hover')}>
        {m.live ? 'Join' : 'Open'}
      </Link>
    </div>
  );
}
