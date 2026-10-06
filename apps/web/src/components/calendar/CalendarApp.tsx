'use client';

import type { CalendarEventView, CalendarInfo, EventResponse } from '@workos/shared';
import { CalendarDays, ChevronLeft, ChevronRight, Copy, Globe, MapPin, Paperclip, Pencil, Plus, Repeat, Search, Trash2, Users, Video, X } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { addDays, gmtLabel, hm, sameDay, startOfDay, startOfMonth, startOfWeek, useCalendarActions, useCalendarPeople, useCalendars, useEvent, useEvents } from '@/lib/calendar';
import { useMe } from '@/lib/queries';
import { useMounted } from '@/lib/use-mounted';
import { useIsOnline } from '@/lib/realtime';
import { hrefFor } from '@/lib/resources';
import { Avatar, Button, cn, EmptyState, FileIcon, IconButton, Menu, MenuContent, MenuItem, MenuTrigger, Skeleton } from '../ui/primitives';
import { EventDialog, type EventDraft } from './EventDialog';

type View = 'day' | 'week' | 'month' | 'agenda';
const HOUR = 56; // px per hour in the time grid
const monthFmt = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' });
const dayFmt = new Intl.DateTimeFormat('en-US', { weekday: 'short' });
const longFmt = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
const RESPONSE: Record<EventResponse, { label: string; cls: string }> = {
  accepted: { label: 'Accepted', cls: 'text-emerald-600' },
  tentative: { label: 'Tentative', cls: 'text-amber-600' },
  declined: { label: 'Declined', cls: 'text-red-500' },
  pending: { label: 'Pending', cls: 'text-muted' },
};

/** /calendar?view=&date=&event= (docs/ARCHITECTURE.md §71, "giao diện calender.png"). */
export function CalendarApp() {
  const mounted = useMounted();
  const params = useSearchParams();
  const router = useRouter();
  const view = (params.get('view') as View) ?? 'week';
  const date = params.get('date') ? new Date(`${params.get('date')}T00:00:00`) : startOfDay(new Date());
  const eventId = params.get('event');
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [people, setPeople] = useState<string[]>([]);
  const [dialog, setDialog] = useState<{ draft?: EventDraft; edit?: CalendarEventView } | null>(null);
  const [selected, setSelected] = useState<{ id: string; occurrence: string } | null>(null);
  const { data: calendars } = useCalendars();

  const go = (p: { view?: View; date?: Date; event?: string | null }) => {
    const cur = new URLSearchParams(window.location.search);
    const n = new URLSearchParams();
    n.set('view', p.view ?? (cur.get('view') as View | null) ?? view);
    const d = p.date ?? date;
    n.set('date', `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
    const ev = p.event === undefined ? cur.get('event') : p.event;
    if (ev) n.set('event', ev);
    router.push(`/calendar?${n.toString()}`);
  };

  const [from, to] = useMemo(() => {
    if (view === 'day') return [startOfDay(date), addDays(startOfDay(date), 1)];
    if (view === 'week') return [startOfWeek(date), addDays(startOfWeek(date), 7)];
    if (view === 'month') {
      const first = startOfWeek(startOfMonth(date));
      return [first, addDays(first, 42)];
    }
    return [startOfDay(date), addDays(startOfDay(date), 30)];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, date.getTime()]);
  const { data: events, isLoading } = useEvents(from, to, people, mounted);
  const shown = (events ?? []).filter((e) => !hidden.has(e.calendarId));
  const calById = new Map((calendars ?? []).map((c) => [c.id, c]));

  // A link to an event (?event=) opens it and moves the calendar to its week.
  const { data: linked } = useEvent(eventId);
  useEffect(() => {
    if (!linked) return;
    setSelected({ id: linked.id, occurrence: linked.occurrence });
    const d = new Date(linked.start);
    if (d < from || d >= to) go({ date: d });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linked?.id]);

  const step = (dir: number) => go({ date: view === 'day' ? addDays(date, dir) : view === 'week' ? addDays(date, 7 * dir) : view === 'month' ? new Date(date.getFullYear(), date.getMonth() + dir, 1) : addDays(date, 30 * dir) });
  const label = view === 'day' ? longFmt.format(date) : view === 'week' ? `${new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(from)} – ${new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(addDays(to, -1))}` : monthFmt.format(date);
  const openEvent = (e: CalendarEventView) => !e.busyOnly && setSelected({ id: e.id, occurrence: e.occurrence });
  const sel = selected ? shown.find((e) => e.id === selected.id && e.occurrence === selected.occurrence) ?? (linked?.id === selected.id ? linked : undefined) : undefined;

  if (!mounted) return <div className="h-full bg-canvas" />;
  return (
    <div className="flex h-full flex-col bg-surface">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line px-5">
        <CalendarDays size={20} className="text-brand-600" />
        <h1 className="text-[17px] font-semibold text-ink">Calendar</h1>
        <div className="ml-4 flex items-center gap-1">
          <IconButton label="Previous" onClick={() => step(-1)}>
            <ChevronLeft size={18} />
          </IconButton>
          <IconButton label="Next" onClick={() => step(1)}>
            <ChevronRight size={18} />
          </IconButton>
          <Button size="sm" onClick={() => go({ date: startOfDay(new Date()) })}>
            Today
          </Button>
        </div>
        <span className="text-[15px] font-semibold text-ink" data-testid="calendar-range">
          {label}
        </span>
        <div className="ml-auto flex rounded-lg bg-canvas p-0.5 ring-1 ring-line" role="tablist">
          {(['day', 'week', 'month', 'agenda'] as const).map((v) => (
            <button key={v} role="tab" aria-selected={view === v} onClick={() => go({ view: v })} className={cn('rounded-md px-3 py-1 text-[13px] capitalize', view === v ? 'bg-surface font-semibold text-brand-700 shadow-sm' : 'text-muted hover:text-ink')}>
              {v}
            </button>
          ))}
        </div>
        <Button variant="primary" icon={<Plus size={16} />} onClick={() => setDialog({})} data-testid="create-event">
          Create event
        </Button>
      </header>
      <div className="flex min-h-0 flex-1">
        <Sidebar date={date} go={go} calendars={calendars ?? []} hidden={hidden} setHidden={setHidden} people={people} setPeople={setPeople} />
        <main className="min-w-0 flex-1 overflow-hidden">
          {isLoading && !events ? (
            <Skeleton className="m-6 h-96" />
          ) : view === 'month' ? (
            <MonthView date={date} from={from} events={shown} calById={calById} onOpen={openEvent} onDay={(d) => go({ view: 'day', date: d })} onCreate={(d) => setDialog({ draft: { start: new Date(d.getTime() + 9 * 3600_000), end: new Date(d.getTime() + 10 * 3600_000) } })} />
          ) : view === 'agenda' ? (
            <AgendaView from={from} events={shown} calById={calById} onOpen={openEvent} />
          ) : (
            <TimeGrid days={view === 'day' ? [from] : Array.from({ length: 7 }, (_, i) => addDays(from, i))} events={shown} calById={calById} selected={selected} onOpen={openEvent} onCreate={(start, end, allDay) => setDialog({ draft: { start, end, allDay } })} />
          )}
        </main>
        {sel && <EventPanel e={sel} cal={calById.get(sel.calendarId)} onClose={() => (setSelected(null), eventId && go({ event: null }))} onEdit={() => setDialog({ edit: sel })} />}
      </div>
      <EventDialog open={!!dialog} onOpenChange={(v) => !v && setDialog(null)} draft={dialog?.draft} edit={dialog?.edit} />
    </div>
  );
}

// ── Sidebar ─────────────────────────────────────────────────────────────────

function Sidebar({ date, go, calendars, hidden, setHidden, people, setPeople }: { date: Date; go: (p: { date?: Date }) => void; calendars: CalendarInfo[]; hidden: Set<string>; setHidden: (s: Set<string>) => void; people: string[]; setPeople: (p: string[]) => void }) {
  const [month, setMonth] = useState(startOfMonth(date));
  useEffect(() => setMonth(startOfMonth(date)), [date.getFullYear(), date.getMonth()]); // eslint-disable-line react-hooks/exhaustive-deps
  const first = startOfWeek(month);
  const today = new Date();
  const { data: everyone } = useCalendarPeople();
  const [q, setQ] = useState('');
  const toggle = (id: string) => {
    const n = new Set(hidden);
    if (!n.delete(id)) n.add(id);
    setHidden(n);
  };
  const mine = calendars.filter((c) => c.kind === 'user');
  const team = calendars.filter((c) => c.kind === 'space');
  const list = (everyone ?? []).filter((u) => !q.trim() || u.name.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <aside className="flex w-[260px] shrink-0 flex-col overflow-y-auto border-r border-line px-4 py-3" data-testid="calendar-sidebar">
      <div className="flex items-center justify-between">
        <span className="text-[14px] font-semibold text-ink">{monthFmt.format(month)}</span>
        <span className="flex">
          <IconButton label="Previous month" size={26} onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}>
            <ChevronLeft size={15} />
          </IconButton>
          <IconButton label="Next month" size={26} onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}>
            <ChevronRight size={15} />
          </IconButton>
        </span>
      </div>
      <div className="mt-2 grid grid-cols-7 text-center text-[11px] text-subtle">
        {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((d) => (
          <span key={d} className="py-1">
            {d}
          </span>
        ))}
        {Array.from({ length: 42 }, (_, i) => addDays(first, i)).map((d) => (
          <button
            key={d.toISOString()}
            onClick={() => go({ date: d })}
            className={cn('mx-auto flex size-7 items-center justify-center rounded-full text-[12px]', d.getMonth() !== month.getMonth() && 'text-subtle', sameDay(d, today) ? 'bg-brand-600 font-semibold text-white' : sameDay(d, date) ? 'bg-brand-50 font-semibold text-brand-700' : 'text-ink-2 hover:bg-hover')}
            aria-label={longFmt.format(d)}
          >
            {d.getDate()}
          </button>
        ))}
      </div>
      <label className="mt-4 flex h-9 items-center gap-2 rounded-lg bg-canvas px-3 text-[13px] ring-1 ring-line focus-within:ring-brand-500">
        <Search size={14} className="text-subtle" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search people" className="min-w-0 flex-1 bg-transparent outline-none" aria-label="Search people" />
      </label>
      <div className="mt-3 text-[12px] font-semibold uppercase tracking-wide text-subtle">People</div>
      <ul className="mt-1 max-h-56 overflow-y-auto" data-testid="calendar-people">
        {list.map((u) => {
          const on = people.includes(u.id);
          return (
            <li key={u.id}>
              <PersonRow u={u} on={on} onToggle={() => setPeople(on ? people.filter((p) => p !== u.id) : [...people, u.id])} />
            </li>
          );
        })}
      </ul>
      {!!people.length && <div className="mt-1 text-[11.5px] text-muted">Showing their busy time next to yours.</div>}
      <CalendarGroup title="My calendars" list={mine} hidden={hidden} toggle={toggle} />
      <CalendarGroup title="Team calendars" list={team} hidden={hidden} toggle={toggle} />
    </aside>
  );
}

function PersonRow({ u, on, onToggle }: { u: { id: string; name: string; avatarColor: string; department?: string | null }; on: boolean; onToggle: () => void }) {
  const online = useIsOnline(u.id);
  return (
    <button onClick={onToggle} className={cn('flex w-full items-center gap-2.5 rounded-lg px-1.5 py-1.5 text-left hover:bg-hover', on && 'bg-selected')} aria-pressed={on} data-name={u.name}>
      <span className="relative">
        <Avatar user={u} size={28} />
        {online && <span className="absolute bottom-0 right-0 size-2.5 rounded-full border-2 border-white bg-emerald-500" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium text-ink">{u.name}</span>
        <span className="block truncate text-[11px] text-muted">{u.department}</span>
      </span>
      {on && <span className="size-2 rounded-full bg-slate-400" />}
    </button>
  );
}

function CalendarGroup({ title, list, hidden, toggle }: { title: string; list: CalendarInfo[]; hidden: Set<string>; toggle: (id: string) => void }) {
  if (!list.length) return null;
  return (
    <div className="mt-4" data-testid="calendar-group" data-title={title}>
      <div className="text-[12px] font-semibold uppercase tracking-wide text-subtle">{title}</div>
      {list.map((c) => (
        <label key={c.id} className="mt-1 flex cursor-pointer items-center gap-2.5 rounded-md px-1 py-1 text-[13px] text-ink-2 hover:bg-hover">
          <input type="checkbox" checked={!hidden.has(c.id)} onChange={() => toggle(c.id)} className="size-4" style={{ accentColor: c.color }} aria-label={c.kind === 'user' ? 'My Calendar' : c.name} />
          <span className="min-w-0 flex-1 truncate">{c.kind === 'user' ? 'My Calendar' : c.name}</span>
          {!c.perms.write && <span className="text-[10.5px] text-subtle">view</span>}
        </label>
      ))}
    </div>
  );
}

// ── Time grid (day / week) ──────────────────────────────────────────────────

const colorOf = (e: CalendarEventView, calById: Map<string, CalendarInfo>) => (e.busyOnly ? '#94a3b8' : e.kind === 'focus' ? '#8b5cf6' : e.kind === 'ooo' ? '#64748b' : e.color ?? calById.get(e.calendarId)?.color ?? '#2563eb');

/** Side-by-side columns for events that overlap within a day. */
function layout(items: { e: CalendarEventView; s: number; en: number }[]) {
  const sorted = [...items].sort((a, b) => a.s - b.s || b.en - a.en);
  const out: { e: CalendarEventView; s: number; en: number; col: number; cols: number }[] = [];
  let cluster: typeof out = [];
  let clusterEnd = -1;
  const flush = () => {
    const cols = Math.max(1, ...cluster.map((c) => c.col + 1));
    for (const c of cluster) c.cols = cols;
    out.push(...cluster);
    cluster = [];
  };
  for (const it of sorted) {
    if (it.s >= clusterEnd && cluster.length) flush();
    const used = new Set(cluster.filter((c) => c.en > it.s).map((c) => c.col));
    let col = 0;
    while (used.has(col)) col++;
    cluster.push({ ...it, col, cols: 1 });
    clusterEnd = Math.max(clusterEnd, it.en);
  }
  if (cluster.length) flush();
  return out;
}

function TimeGrid({ days, events, calById, selected, onOpen, onCreate }: { days: Date[]; events: CalendarEventView[]; calById: Map<string, CalendarInfo>; selected: { id: string; occurrence: string } | null; onOpen: (e: CalendarEventView) => void; onCreate: (s: Date, e: Date, allDay?: boolean) => void }) {
  const scroller = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    if (scroller.current) scroller.current.scrollTop = HOUR * 7.5;
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);
  const timed = events.filter((e) => !e.allDay && new Date(e.end).getTime() - new Date(e.start).getTime() < 24 * 3600_000);
  const allDay = events.filter((e) => !timed.includes(e));
  return (
    <div className="flex h-full flex-col" data-testid="time-grid">
      <div className="flex shrink-0 border-b border-line pr-3">
        <div className="w-16 shrink-0 pt-7 text-right text-[11px] text-subtle">{gmtLabel()}</div>
        {days.map((d) => {
          const today = sameDay(d, now);
          return (
            <div key={d.toISOString()} className="flex-1 border-l border-line px-1 pb-1 pt-2 text-center">
              <div className={cn('text-[12px]', today ? 'font-semibold text-brand-600' : 'text-muted')}>{dayFmt.format(d)}</div>
              <div className={cn('mx-auto flex size-9 items-center justify-center rounded-full text-[20px]', today ? 'bg-brand-600 font-semibold text-white' : 'text-ink')}>{d.getDate()}</div>
              <div className="mt-1 min-h-[22px] space-y-0.5" onDoubleClick={() => onCreate(d, addDays(d, 1), true)}>
                {allDay
                  .filter((e) => new Date(e.start) < addDays(d, 1) && new Date(e.end) > d)
                  .map((e) => (
                    <button key={e.id + e.occurrence} onClick={() => onOpen(e)} className="block w-full truncate rounded px-1.5 py-0.5 text-left text-[11.5px] font-medium text-white" style={{ background: colorOf(e, calById) }} data-testid="event" data-title={e.title}>
                      {e.title}
                    </button>
                  ))}
              </div>
            </div>
          );
        })}
      </div>
      <div ref={scroller} className="relative min-h-0 flex-1 overflow-y-auto">
        <div className="relative flex" style={{ height: HOUR * 24 }}>
          <div className="w-16 shrink-0">
            {Array.from({ length: 24 }, (_, h) => (
              <div key={h} className="relative text-right text-[11px] text-subtle" style={{ height: HOUR }}>
                {h > 0 && <span className="absolute -top-2 right-2">{String(h).padStart(2, '0')}:00</span>}
              </div>
            ))}
          </div>
          {days.map((d) => {
            const dayStart = d.getTime();
            const items = timed
              .map((e) => ({ e, s: Math.max(new Date(e.start).getTime(), dayStart), en: Math.min(new Date(e.end).getTime(), dayStart + 86_400_000) }))
              .filter((x) => x.en > dayStart && x.s < dayStart + 86_400_000);
            return (
              <div
                key={d.toISOString()}
                className="relative flex-1 border-l border-line"
                onClick={(ev) => {
                  if ((ev.target as HTMLElement).closest('[data-testid="event"]')) return;
                  const y = ev.clientY - (ev.currentTarget as HTMLElement).getBoundingClientRect().top;
                  const minutes = Math.floor((y / HOUR) * 2) * 30;
                  const s = new Date(dayStart + minutes * 60_000);
                  onCreate(s, new Date(s.getTime() + 3600_000));
                }}
                data-testid="day-column"
                data-date={`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`}
              >
                {Array.from({ length: 24 }, (_, h) => (
                  <div key={h} className="border-b border-line/70" style={{ height: HOUR }} />
                ))}
                {sameDay(d, now) && (
                  <div className="pointer-events-none absolute left-0 right-0 z-10 flex items-center" style={{ top: ((now.getTime() - dayStart) / 3600_000) * HOUR }}>
                    <span className="-ml-1 size-2.5 rounded-full bg-red-500" />
                    <span className="h-0.5 flex-1 bg-red-500" />
                  </div>
                )}
                {layout(items).map(({ e, s, en, col, cols }) => {
                  const c = colorOf(e, calById);
                  const top = ((s - dayStart) / 3600_000) * HOUR;
                  const h = Math.max(22, ((en - s) / 3600_000) * HOUR - 2);
                  const declined = e.myResponse === 'declined';
                  const pending = e.myResponse === 'pending';
                  const isSel = selected?.id === e.id && selected.occurrence === e.occurrence;
                  return (
                    <button
                      key={e.id + e.occurrence}
                      onClick={() => onOpen(e)}
                      className={cn('absolute overflow-hidden rounded-md border-l-[3px] px-1.5 py-1 text-left text-[11.5px] leading-tight', isSel && 'ring-2 ring-offset-1', pending && 'border-dashed', e.busyOnly ? 'cursor-default' : 'hover:brightness-95')}
                      style={{
                        top,
                        height: h,
                        left: `calc(${(col / cols) * 100}% + 2px)`,
                        width: `calc(${100 / cols}% - 4px)`,
                        borderLeftColor: c,
                        background: e.busyOnly ? 'repeating-linear-gradient(45deg,#f1f5f9,#f1f5f9 6px,#e2e8f0 6px,#e2e8f0 12px)' : `${c}22`,
                        color: declined ? '#94a3b8' : '#0f172a',
                        ...(isSel ? ({ '--tw-ring-color': c } as React.CSSProperties) : {}),
                      }}
                      data-testid="event"
                      data-title={e.title}
                      data-busy={e.busyOnly}
                    >
                      <div className="font-medium">
                        {hm(new Date(e.start))} – {hm(new Date(e.end))}
                      </div>
                      <div className={cn('truncate font-semibold', declined && 'line-through')}>
                        {e.recurrence && <Repeat size={10} className="mr-0.5 inline" />}
                        {e.title}
                      </div>
                      {h > 50 && e.meetingUrl && <div className="truncate text-[11px] opacity-70">(Online)</div>}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Month & agenda ──────────────────────────────────────────────────────────

function MonthView({ date, from, events, calById, onOpen, onDay, onCreate }: { date: Date; from: Date; events: CalendarEventView[]; calById: Map<string, CalendarInfo>; onOpen: (e: CalendarEventView) => void; onDay: (d: Date) => void; onCreate: (d: Date) => void }) {
  const today = new Date();
  return (
    <div className="grid h-full grid-cols-7 grid-rows-[auto_repeat(6,1fr)]" data-testid="month-view">
      {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
        <div key={d} className="border-b border-line py-1.5 text-center text-[12px] text-muted">
          {d}
        </div>
      ))}
      {Array.from({ length: 42 }, (_, i) => addDays(from, i)).map((d) => {
        const list = events.filter((e) => new Date(e.start) < addDays(d, 1) && new Date(e.end) > d);
        return (
          <div key={d.toISOString()} className={cn('min-h-0 overflow-hidden border-b border-l border-line p-1', d.getMonth() !== date.getMonth() && 'bg-canvas/60')} onDoubleClick={() => onCreate(d)}>
            <button onClick={() => onDay(d)} className={cn('mb-0.5 flex size-6 items-center justify-center rounded-full text-[12px]', sameDay(d, today) ? 'bg-brand-600 font-semibold text-white' : 'text-ink-2 hover:bg-hover')}>
              {d.getDate()}
            </button>
            {list.slice(0, 3).map((e) => (
              <button key={e.id + e.occurrence} onClick={() => onOpen(e)} className="flex w-full items-center gap-1 truncate rounded px-1 text-left text-[11.5px] hover:bg-hover" data-testid="event" data-title={e.title}>
                <span className="size-2 shrink-0 rounded-full" style={{ background: colorOf(e, calById) }} />
                {!e.allDay && <span className="text-muted">{hm(new Date(e.start))}</span>}
                <span className="truncate">{e.title}</span>
              </button>
            ))}
            {list.length > 3 && (
              <button onClick={() => onDay(d)} className="px-1 text-[11px] font-medium text-muted hover:text-ink">
                +{list.length - 3} more
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

function AgendaView({ from, events, calById, onOpen }: { from: Date; events: CalendarEventView[]; calById: Map<string, CalendarInfo>; onOpen: (e: CalendarEventView) => void }) {
  const days = Array.from({ length: 30 }, (_, i) => addDays(from, i)).map((d) => ({ d, list: events.filter((e) => sameDay(new Date(e.start), d) || (e.allDay && new Date(e.start) < addDays(d, 1) && new Date(e.end) > d)) })).filter((x) => x.list.length);
  if (!days.length) return <EmptyState icon={<CalendarDays size={36} />} title="Nothing planned in the next 30 days" />;
  return (
    <div className="h-full overflow-y-auto px-6 py-4" data-testid="agenda-view">
      {days.map(({ d, list }) => (
        <div key={d.toISOString()} className="flex gap-6 border-b border-line py-3">
          <div className="w-28 shrink-0">
            <div className="text-[22px] font-semibold text-ink">{d.getDate()}</div>
            <div className="text-[12px] text-muted">{new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short' }).format(d)}</div>
          </div>
          <ul className="flex-1 space-y-1">
            {list.map((e) => (
              <li key={e.id + e.occurrence}>
                <button onClick={() => onOpen(e)} className="flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left hover:bg-hover" data-testid="event" data-title={e.title}>
                  <span className="size-2.5 rounded-full" style={{ background: colorOf(e, calById) }} />
                  <span className="w-28 text-[13px] text-muted">{e.allDay ? 'All day' : `${hm(new Date(e.start))} – ${hm(new Date(e.end))}`}</span>
                  <span className="flex-1 truncate text-[14px] font-medium text-ink">{e.title}</span>
                  {e.meetingUrl && <Video size={14} className="text-brand-600" />}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

// ── Event panel ─────────────────────────────────────────────────────────────

function EventPanel({ e, cal, onClose, onEdit }: { e: CalendarEventView; cal?: CalendarInfo; onClose: () => void; onEdit: () => void }) {
  const { respond, remove } = useCalendarActions();
  const { data: me } = useMe();
  const isOrganizer = e.organizer?.id === me?.user.id;
  const invited = e.myResponse !== null && !isOrganizer;
  const tzLabel = e.timezone;
  const when = e.allDay
    ? `${longFmt.format(new Date(e.start))}${new Date(e.end).getTime() - new Date(e.start).getTime() > 86_400_000 ? ` – ${longFmt.format(addDays(new Date(e.end), -1))}` : ''} · All day`
    : `${longFmt.format(new Date(e.start))}\n${hm(new Date(e.start))} – ${hm(new Date(e.end))} (${Math.round((new Date(e.end).getTime() - new Date(e.start).getTime()) / 60_000)} min)`;
  const del = (occurrence?: string) => remove.mutate({ id: e.id, occurrence }, { onSuccess: onClose });
  return (
    <aside className="flex w-[360px] shrink-0 flex-col overflow-y-auto border-l border-line bg-surface" data-testid="event-panel">
      <div className="flex items-center gap-1 px-4 pt-3">
        <span className="rounded-md bg-brand-50 px-2 py-0.5 text-[12px] font-medium text-brand-700">{e.kind === 'focus' ? 'Focus time' : e.kind === 'ooo' ? 'Out of office' : e.meetingUrl ? 'Online meeting' : 'Event'}</span>
        <span className="flex-1" />
        {e.canEdit && (
          <IconButton label="Edit" onClick={onEdit}>
            <Pencil size={16} />
          </IconButton>
        )}
        {e.canEdit &&
          (e.recurrence ? (
            <Menu>
              <MenuTrigger asChild>
                <button className="inline-flex size-8 items-center justify-center rounded-lg text-muted hover:bg-hover" aria-label="Delete">
                  <Trash2 size={16} />
                </button>
              </MenuTrigger>
              <MenuContent align="end">
                <MenuItem onSelect={() => del(e.occurrence)}>This event</MenuItem>
                <MenuItem danger onSelect={() => del()}>
                  All events in the series
                </MenuItem>
              </MenuContent>
            </Menu>
          ) : (
            <IconButton label="Delete" onClick={() => del()}>
              <Trash2 size={16} />
            </IconButton>
          ))}
        <IconButton label="Close" onClick={onClose}>
          <X size={16} />
        </IconButton>
      </div>
      <div className="px-5 pb-5">
        <h2 className="mt-2 text-[20px] font-semibold text-ink" data-testid="event-title">
          {e.title}
        </h2>
        <div className="mt-2 whitespace-pre-line text-[13.5px] text-ink-2">{when}</div>
        <div className="mt-1 flex items-center gap-1.5 text-[12px] text-muted">
          <Globe size={13} /> {tzLabel}
          {e.recurrence && (
            <>
              <Repeat size={13} className="ml-2" /> Repeats {e.recurrence.freq}
            </>
          )}
        </div>
        {e.meetingUrl && (
          <div className="mt-4">
            <a href={e.meetingUrl} target="_blank" rel="noreferrer" className="flex h-10 items-center justify-center gap-2 rounded-lg bg-brand-600 text-[14px] font-medium text-white hover:bg-brand-700" data-testid="join-meeting">
              <Video size={17} /> Join meeting
            </a>
            <div className="mt-2 flex items-center gap-2 rounded-lg border border-line px-2.5 py-1.5 text-[12px] text-ink-2">
              <span className="min-w-0 flex-1 truncate">{e.meetingUrl}</span>
              <button onClick={() => (navigator.clipboard.writeText(e.meetingUrl!), toast.success('Link copied'))} className="rounded p-1 text-muted hover:bg-hover" aria-label="Copy link">
                <Copy size={14} />
              </button>
            </div>
          </div>
        )}
        {invited && (
          <div className="mt-4 rounded-xl bg-canvas p-3" data-testid="rsvp">
            <div className="text-[12.5px] font-medium text-ink-2">Going?</div>
            <div className="mt-2 flex gap-1.5">
              {(
                [
                  ['accepted', 'Yes'],
                  ['tentative', 'Maybe'],
                  ['declined', 'No'],
                ] as const
              ).map(([r, l]) => (
                <button key={r} onClick={() => respond.mutate({ id: e.id, response: r })} aria-pressed={e.myResponse === r} className={cn('h-8 flex-1 rounded-lg text-[13px] font-medium ring-1', e.myResponse === r ? 'bg-brand-600 text-white ring-brand-600' : 'bg-surface text-ink-2 ring-line hover:bg-hover')}>
                  {l}
                </button>
              ))}
            </div>
          </div>
        )}
        <dl className="mt-4 space-y-2.5 text-[13px]">
          <div className="flex gap-3">
            <dt className="w-20 shrink-0 text-muted">Calendar</dt>
            <dd className="flex items-center gap-1.5 text-ink">
              <span className="size-2 rounded-full" style={{ background: cal?.color ?? '#2563eb' }} />
              {cal ? (cal.kind === 'user' ? (cal.owner?.id === me?.user.id ? 'My Calendar' : `${cal.owner?.name}`) : cal.name) : e.organizer ? `${e.organizer.name}'s calendar` : '—'}
            </dd>
          </div>
          {e.location && (
            <div className="flex gap-3">
              <dt className="flex w-20 shrink-0 items-center gap-1 text-muted">
                <MapPin size={13} /> Location
              </dt>
              <dd className="text-ink">{e.location}</dd>
            </div>
          )}
        </dl>
        {!!e.attendees.length && (
          <div className="mt-4">
            <div className="flex items-center gap-1.5 text-[13px] font-semibold text-ink">
              <Users size={14} /> Guests ({e.attendees.length})
            </div>
            <ul className="mt-2 space-y-2" data-testid="guests">
              {e.attendees.map((a) => (
                <li key={a.id} className="flex items-center gap-2.5" data-testid="guest" data-email={a.email}>
                  {a.user ? <Avatar user={a.user} size={30} /> : <span className="flex size-[30px] items-center justify-center rounded-full bg-hover text-[11px] text-muted">@</span>}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] text-ink">
                      {a.user?.id === me?.user.id ? 'You' : a.name ?? a.email}
                      {a.optional && <span className="ml-1 text-[11px] text-subtle">(optional)</span>}
                    </span>
                    <span className={cn('block text-[11.5px]', a.user?.id === e.organizer?.id ? 'text-muted' : RESPONSE[a.response].cls)}>{a.user?.id === e.organizer?.id ? 'Organizer' : RESPONSE[a.response].label}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {e.description && (
          <div className="mt-4">
            <div className="text-[13px] font-semibold text-ink">Description</div>
            <p className="mt-1 whitespace-pre-wrap text-[13px] text-ink-2">{e.description}</p>
          </div>
        )}
        {!!e.attachments.length && (
          <div className="mt-4">
            <div className="flex items-center gap-1.5 text-[13px] font-semibold text-ink">
              <Paperclip size={14} /> Attachments ({e.attachments.length})
            </div>
            <ul className="mt-2 space-y-1.5">
              {e.attachments.map((a) =>
                a.accessible && a.type ? (
                  <li key={a.id}>
                    <Link href={hrefFor({ id: a.id, type: a.type, metadata: {} })} className="flex items-center gap-2 rounded-lg border border-line px-2.5 py-2 text-[13px] hover:bg-hover">
                      <FileIcon r={{ type: a.type, mimeType: null, metadata: {} }} size={20} />
                      <span className="truncate">{a.name}</span>
                    </Link>
                  </li>
                ) : (
                  <li key={a.id} className="rounded-lg border border-dashed border-line px-2.5 py-2 text-[12.5px] text-muted">
                    A file you don’t have access to
                  </li>
                ),
              )}
            </ul>
          </div>
        )}
      </div>
    </aside>
  );
}
