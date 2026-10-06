'use client';

import { type CalendarEventView, type Recurrence, zonedParts, zonedToUtc } from '@workos/shared';
import { Clock, FolderOpen, Globe, Link2, MapPin, Paperclip, Repeat, Users, Video, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { localTz, useCalendarActions, useCalendars } from '@/lib/calendar';
import { useUsers } from '@/lib/queries';
import { Avatar, Button, cn, Dialog } from '../ui/primitives';
import { ResourcePickerDialog } from '../chat/attachments';

const ZONES = ['Asia/Tokyo', 'Asia/Ho_Chi_Minh', 'Asia/Bangkok', 'Asia/Singapore', 'Asia/Seoul', 'Asia/Shanghai', 'Europe/London', 'Europe/Paris', 'America/New_York', 'America/Los_Angeles', 'UTC'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const PROVIDERS = [
  { id: 'kaori', label: 'Kaori Meet (default)' },
  { id: 'google', label: 'Google Meet' },
  { id: 'zoom', label: 'Zoom' },
  { id: 'teams', label: 'Microsoft Teams' },
  { id: 'custom', label: 'Custom link' },
] as const;
const EMAIL = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;

export interface EventDraft {
  start: Date;
  end: Date;
  allDay?: boolean;
  calendarId?: string;
}

const pad = (n: number) => String(n).padStart(2, '0');
const dateStr = (d: Date, tz: string) => {
  const p = zonedParts(d, tz);
  return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
};
const timeStr = (d: Date, tz: string) => {
  const p = zonedParts(d, tz);
  return `${pad(p.h)}:${pad(p.mi)}`;
};
const toInstant = (date: string, time: string, tz: string) => {
  const [y, m, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  return zonedToUtc(y, m, d, h, mi, tz);
};

type RepeatChoice = 'none' | 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'yearly';
const recurrenceOf = (choice: RepeatChoice, start: Date, tz: string): Recurrence | null => {
  const wd = zonedParts(start, tz).weekday;
  if (choice === 'none') return null;
  if (choice === 'weekdays') return { freq: 'weekly', interval: 1, byDay: [1, 2, 3, 4, 5] };
  if (choice === 'weekly') return { freq: 'weekly', interval: 1, byDay: [wd] };
  return { freq: choice, interval: 1 };
};
const choiceOf = (r: Recurrence | null): RepeatChoice => (!r ? 'none' : r.freq === 'weekly' ? (r.byDay?.length === 5 ? 'weekdays' : 'weekly') : r.freq);

/** Create or edit an event (Google-Calendar-like form after "giao diện calender.png"). */
export function EventDialog({ open, onOpenChange, draft, edit }: { open: boolean; onOpenChange: (v: boolean) => void; draft?: EventDraft | null; edit?: CalendarEventView | null }) {
  if (!open) return null;
  return <Form key={edit?.id ?? draft?.start.toISOString() ?? 'new'} onClose={() => onOpenChange(false)} draft={draft ?? null} edit={edit ?? null} />;
}

function Form({ onClose, draft, edit }: { onClose: () => void; draft: EventDraft | null; edit: CalendarEventView | null }) {
  const { data: calendars } = useCalendars();
  const { data: users } = useUsers();
  const writable = (calendars ?? []).filter((c) => c.perms.write);
  const { create, update } = useCalendarActions();
  const initStart = edit ? new Date(edit.start) : draft?.start ?? new Date(Math.ceil(Date.now() / 1800_000) * 1800_000);
  const initEnd = edit ? new Date(edit.end) : draft?.end ?? new Date(initStart.getTime() + 3600_000);
  const [tz, setTz] = useState(edit?.timezone ?? localTz());
  const [kind, setKind] = useState<'event' | 'focus' | 'ooo'>(edit?.kind ?? 'event');
  const [title, setTitle] = useState(edit?.title ?? '');
  const [allDay, setAllDay] = useState(edit?.allDay ?? draft?.allDay ?? false);
  const [date, setDate] = useState(dateStr(initStart, edit?.timezone ?? localTz()));
  const [endDate, setEndDate] = useState(dateStr(allDay ? new Date(initEnd.getTime() - 1) : initEnd, edit?.timezone ?? localTz()));
  const [from, setFrom] = useState(timeStr(initStart, edit?.timezone ?? localTz()));
  const [to, setTo] = useState(timeStr(initEnd, edit?.timezone ?? localTz()));
  const [repeat, setRepeat] = useState<RepeatChoice>(choiceOf(edit?.recurrence ?? null));
  const [location, setLocation] = useState(edit?.location ?? '');
  const [video, setVideo] = useState(!!edit?.meetingUrl || (!edit && kind === 'event'));
  const [provider, setProvider] = useState<(typeof PROVIDERS)[number]['id']>(edit?.meetingProvider ?? 'kaori');
  const [link, setLink] = useState(edit?.meetingProvider && edit.meetingProvider !== 'kaori' ? edit.meetingUrl ?? '' : '');
  const [calendarId, setCalendarId] = useState(edit?.calendarId ?? draft?.calendarId ?? writable[0]?.id ?? '');
  const [guests, setGuests] = useState<{ email: string; name: string | null }[]>(
    (edit?.attendees ?? []).filter((a) => a.user?.id !== edit?.organizer?.id).map((a) => ({ email: a.email, name: a.name })),
  );
  const [q, setQ] = useState('');
  const [description, setDescription] = useState(edit?.description ?? '');
  const [files, setFiles] = useState<{ id: string; name: string }[]>((edit?.attachments ?? []).filter((a) => a.accessible).map((a) => ({ id: a.id, name: a.name ?? 'File' })));
  const [picking, setPicking] = useState(false);
  const [notify, setNotify] = useState(true);
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string | null>(null);

  const suggestions = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return [];
    return (users ?? []).filter((u) => !guests.some((g) => g.email === u.email.toLowerCase()) && (u.name.toLowerCase().includes(needle) || u.email.includes(needle))).slice(0, 6);
  }, [q, users, guests]);
  const addGuest = (email: string, name: string | null) => {
    const e = email.trim().toLowerCase();
    if (!EMAIL.test(e)) return setError(`"${email}" is not an e-mail address`);
    if (!guests.some((g) => g.email === e)) setGuests([...guests, { email: e, name }]);
    setQ('');
    setError(null);
  };

  const save = async () => {
    setError(null);
    const start = allDay ? toInstant(date, '00:00', tz) : toInstant(date, from, tz);
    const end = allDay ? toInstant(endDate, '00:00', tz) : toInstant(date, to, tz);
    const endFixed = allDay ? new Date(end.getTime() + 86_400_000) : end <= start ? new Date(end.getTime() + 86_400_000) : end;
    const input = {
      calendarId,
      kind,
      title: title.trim(),
      description: description.trim() || null,
      location: location.trim() || null,
      start: start.toISOString(),
      end: endFixed.toISOString(),
      allDay,
      timezone: tz,
      recurrence: recurrenceOf(repeat, start, tz),
      meeting: video && kind === 'event' ? { provider, url: provider === 'kaori' ? null : link.trim() } : null,
      guests: kind === 'event' ? guests.map((g) => ({ email: g.email, name: g.name })) : [],
      attachments: files.map((f) => f.id),
      notify: notify && guests.length > 0,
      message: message.trim() || null,
    };
    try {
      if (edit) await update.mutateAsync({ id: edit.id, ...input });
      else await create.mutateAsync(input);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const startDate = toInstant(date, allDay ? '00:00' : from, tz);
  const weekday = DAYS[zonedParts(startDate, tz).weekday];
  const field = 'h-9 rounded-lg border border-line-strong bg-surface px-2.5 text-[13px] text-ink outline-none focus:border-brand-500';

  return (
    <Dialog
      open
      onOpenChange={(v) => !v && onClose()}
      title={edit ? 'Edit event' : 'New event'}
      width={600}
      footer={
        <>
          {error && <span className="mr-auto self-center text-[12px] text-red-600">{error}</span>}
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save} loading={create.isPending || update.isPending} disabled={!calendarId} data-testid="event-save">
            {guests.length && notify && kind === 'event' ? (edit ? 'Save and notify' : 'Save and send') : 'Save'}
          </Button>
        </>
      }
    >
      <div className="space-y-3" data-testid="event-dialog">
        <div className="flex gap-1 border-b border-line" role="tablist">
          {(
            [
              ['event', 'Event'],
              ['focus', 'Focus time'],
              ['ooo', 'Out of office'],
            ] as const
          ).map(([k, l]) => (
            <button key={k} role="tab" aria-selected={kind === k} onClick={() => setKind(k)} className={cn('-mb-px border-b-2 px-3 py-1.5 text-[13px]', kind === k ? 'border-brand-600 font-semibold text-brand-600' : 'border-transparent text-muted hover:text-ink')}>
              {l}
            </button>
          ))}
        </div>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={kind === 'focus' ? 'Focus time' : kind === 'ooo' ? 'Out of office' : 'Add title'} aria-label="Title" autoFocus className="h-11 w-full border-b border-line text-[18px] font-semibold text-ink outline-none placeholder:font-normal placeholder:text-subtle focus:border-brand-500" />
        <div className="flex flex-wrap items-center gap-2">
          <Clock size={16} className="text-subtle" />
          <input type="date" value={date} onChange={(e) => (setDate(e.target.value), endDate < e.target.value && setEndDate(e.target.value))} className={field} aria-label="Date" />
          {!allDay ? (
            <>
              <input type="time" value={from} onChange={(e) => setFrom(e.target.value)} className={field} aria-label="Start time" step={300} />
              <span className="text-muted">→</span>
              <input type="time" value={to} onChange={(e) => setTo(e.target.value)} className={field} aria-label="End time" step={300} />
            </>
          ) : (
            <>
              <span className="text-muted">→</span>
              <input type="date" value={endDate} min={date} onChange={(e) => setEndDate(e.target.value)} className={field} aria-label="End date" />
            </>
          )}
          <label className="ml-auto flex items-center gap-2 text-[13px] text-ink-2">
            <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} className="accent-brand-600" aria-label="All day" />
            All day
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-2 pl-6">
          <Globe size={14} className="text-subtle" />
          <select value={tz} onChange={(e) => setTz(e.target.value)} className={field} aria-label="Time zone">
            {[...new Set([tz, localTz(), ...ZONES])].map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </select>
          <Repeat size={14} className="ml-2 text-subtle" />
          <select value={repeat} onChange={(e) => setRepeat(e.target.value as RepeatChoice)} className={field} aria-label="Repeat">
            <option value="none">Does not repeat</option>
            <option value="daily">Daily</option>
            <option value="weekdays">Every weekday (Mon–Fri)</option>
            <option value="weekly">Weekly on {weekday}</option>
            <option value="monthly">Monthly on day {Number(date.slice(8, 10))}</option>
            <option value="yearly">Yearly</option>
          </select>
        </div>
        {kind === 'event' && (
          <>
            <div className="flex items-center gap-2">
              <MapPin size={16} className="text-subtle" />
              <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Add location" aria-label="Location" className={cn(field, 'flex-1')} />
            </div>
            <div className="rounded-xl border border-line p-3">
              <label className="flex items-center gap-2 text-[13px] font-medium text-ink">
                <Video size={16} className="text-brand-600" />
                <span className="flex-1">Add video meeting link</span>
                <input type="checkbox" checked={video} onChange={(e) => setVideo(e.target.checked)} className="accent-brand-600" aria-label="Video meeting" />
              </label>
              {video && (
                <div className="mt-2 grid grid-cols-2 gap-1.5 pl-6">
                  {PROVIDERS.map((p) => (
                    <label key={p.id} className="flex items-center gap-2 text-[12.5px] text-ink-2">
                      <input type="radio" name="provider" checked={provider === p.id} onChange={() => setProvider(p.id)} className="accent-brand-600" />
                      {p.label}
                    </label>
                  ))}
                  {provider !== 'kaori' && (
                    <span className="col-span-2 flex items-center gap-2">
                      <Link2 size={14} className="text-subtle" />
                      <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://…" aria-label="Meeting link" className={cn(field, 'flex-1')} />
                    </span>
                  )}
                  {provider === 'kaori' && <span className="col-span-2 text-[11.5px] text-muted">A link is created when you save.</span>}
                </div>
              )}
            </div>
            <div>
              <div className="flex items-start gap-2">
                <Users size={16} className="mt-2.5 text-subtle" />
                <div className="relative flex-1">
                  <div className="flex min-h-9 flex-wrap items-center gap-1 rounded-lg border border-line-strong px-2 py-1 focus-within:border-brand-500">
                    {guests.map((g) => (
                      <span key={g.email} className="inline-flex h-6 items-center gap-1 rounded-full bg-brand-50 px-2 text-[12px] text-brand-700" data-testid="guest-chip">
                        {g.name ?? g.email}
                        <button onClick={() => setGuests(guests.filter((x) => x.email !== g.email))} aria-label={`Remove ${g.email}`}>
                          <X size={11} />
                        </button>
                      </span>
                    ))}
                    <input
                      value={q}
                      onChange={(e) => setQ(e.target.value)}
                      onKeyDown={(e) => {
                        if ((e.key === 'Enter' || e.key === ',' || e.key === 'Tab') && q.trim()) {
                          e.preventDefault();
                          if (suggestions[0] && !EMAIL.test(q.trim())) addGuest(suggestions[0].email, suggestions[0].name);
                          else addGuest(q, null);
                        } else if (e.key === 'Backspace' && !q && guests.length) setGuests(guests.slice(0, -1));
                      }}
                      placeholder={guests.length ? '' : 'Add guests (people or e-mail addresses)'}
                      aria-label="Add guests"
                      className="min-w-[160px] flex-1 bg-transparent text-[13px] outline-none"
                    />
                  </div>
                  {!!suggestions.length && (
                    <div className="pop absolute left-0 top-full z-30 mt-1 w-80 p-1" data-testid="guest-suggestions">
                      {suggestions.map((u) => (
                        <button key={u.id} onMouseDown={(e) => (e.preventDefault(), addGuest(u.email, u.name))} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-hover">
                          <Avatar user={u} size={22} />
                          <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{u.name}</span>
                          <span className="text-[11px] text-muted">{u.department}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              {!!guests.length && (
                <div className="mt-2 space-y-1.5 rounded-xl bg-canvas p-3 pl-9">
                  <label className="flex items-center gap-2 text-[13px] text-ink-2">
                    <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} className="accent-brand-600" aria-label="Send invitation" />
                    Send invitations (bell, and e-mail with a calendar file for every guest)
                  </label>
                  {notify && <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={2} placeholder="Message to guests (optional)" aria-label="Message to guests" className="w-full resize-none rounded-lg border border-line-strong bg-surface px-2.5 py-1.5 text-[13px] outline-none focus:border-brand-500" />}
                </div>
              )}
            </div>
          </>
        )}
        <div className="flex items-center gap-2">
          <span className="w-4" />
          <select value={calendarId} onChange={(e) => setCalendarId(e.target.value)} className={cn(field, 'flex-1')} aria-label="Calendar">
            {writable.map((c) => (
              <option key={c.id} value={c.id}>
                {c.kind === 'user' ? 'My Calendar' : c.name}
              </option>
            ))}
          </select>
        </div>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} placeholder="Add description" aria-label="Description" className="w-full resize-none rounded-lg border border-line-strong px-2.5 py-2 text-[13px] outline-none focus:border-brand-500" />
        <div className="flex flex-wrap items-center gap-2">
          <Paperclip size={16} className="text-subtle" />
          {files.map((f) => (
            <span key={f.id} className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-line bg-canvas px-2 text-[12.5px]">
              {f.name}
              <button onClick={() => setFiles(files.filter((x) => x.id !== f.id))} aria-label={`Remove ${f.name}`}>
                <X size={12} />
              </button>
            </span>
          ))}
          <Button size="sm" variant="ghost" icon={<FolderOpen size={14} />} onClick={() => setPicking(true)}>
            Attach from Drive
          </Button>
        </div>
        <ResourcePickerDialog open={picking} onOpenChange={setPicking} onPick={(items) => setFiles([...files, ...items.filter((i) => !files.some((f) => f.id === i.id)).map((i) => ({ id: i.id, name: i.name ?? 'File' }))])} />
      </div>
    </Dialog>
  );
}
