// Smart chips (Google Docs' "@" chips) and bookmarks. docs/ARCHITECTURE.md §36.
import { mergeAttributes, Node } from '@tiptap/core';

export type DateFormat = 'short' | 'long' | 'iso';

/** "2026-10-03" → "Oct 3, 2026" / "Saturday, October 3, 2026" / "2026-10-03". */
export function formatChipDate(date: string | null | undefined, format: DateFormat = 'short'): string {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return date ?? '';
  if (format === 'iso') return date;
  const d = new Date(`${date}T12:00:00Z`);
  return new Intl.DateTimeFormat('en-US', format === 'long' ? { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' } : { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(d);
}

/** Today / tomorrow as YYYY-MM-DD in the viewer's time zone. */
export const isoDay = (offset = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const json = <T>(name: string, fallback: T) => ({
  default: fallback,
  parseHTML: (el: HTMLElement) => {
    try {
      return JSON.parse(el.getAttribute(`data-${name}`) ?? '') as T;
    } catch {
      return fallback;
    }
  },
  renderHTML: (a: Record<string, unknown>) => ({ [`data-${name}`]: JSON.stringify(a[name]) }),
});

/** Date chip: a date shown in the chosen format (click to change it). */
export const DateChip = Node.create({
  name: 'dateChip',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      date: { default: null, parseHTML: (el) => el.getAttribute('data-date'), renderHTML: (a) => ({ 'data-date': a.date }) },
      format: { default: 'short', parseHTML: (el) => el.getAttribute('data-format') ?? 'short', renderHTML: (a) => ({ 'data-format': a.format }) },
    };
  },
  parseHTML() {
    return [{ tag: 'span[data-date-chip]' }];
  },
  renderHTML({ HTMLAttributes, node }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-date-chip': '', class: 'mo-chip mo-chip-date' }), formatChipDate(node.attrs.date, node.attrs.format)];
  },
  renderText: ({ node }) => formatChipDate(node.attrs.date, node.attrs.format),
});

export interface DropdownOption {
  label: string;
  color: string; // hex
}

/** Ready-made dropdowns (Google Docs: "Project status", "Review status"…). */
export const DROPDOWN_PRESETS: { name: string; options: DropdownOption[] }[] = [
  {
    name: 'Project status',
    options: [
      { label: 'Not started', color: '#64748b' },
      { label: 'In progress', color: '#2563eb' },
      { label: 'Blocked', color: '#dc2626' },
      { label: 'Done', color: '#16a34a' },
    ],
  },
  {
    name: 'Review status',
    options: [
      { label: 'Draft', color: '#64748b' },
      { label: 'In review', color: '#d97706' },
      { label: 'Approved', color: '#16a34a' },
    ],
  },
  {
    name: 'Priority',
    options: [
      { label: 'High', color: '#dc2626' },
      { label: 'Medium', color: '#d97706' },
      { label: 'Low', color: '#2563eb' },
    ],
  },
];

/** Dropdown chip: one value picked from the chip's own option list. */
export const DropdownChip = Node.create({
  name: 'dropdownChip',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      options: json<DropdownOption[]>('options', DROPDOWN_PRESETS[0].options),
      value: { default: null, parseHTML: (el) => el.getAttribute('data-value'), renderHTML: (a) => ({ 'data-value': a.value }) },
    };
  },
  parseHTML() {
    return [{ tag: 'span[data-dropdown-chip]' }];
  },
  renderHTML({ HTMLAttributes, node }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-dropdown-chip': '', class: 'mo-chip mo-chip-dropdown' }), node.attrs.value ?? 'Select'];
  },
  renderText: ({ node }) => node.attrs.value ?? '',
});

export const placeUrl = (name: string) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(name)}`;

/** Place chip: a named place that opens in Maps. */
export const PlaceChip = Node.create({
  name: 'placeChip',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return { name: { default: '', parseHTML: (el) => el.getAttribute('data-name') ?? el.textContent, renderHTML: (a) => ({ 'data-name': a.name }) } };
  },
  parseHTML() {
    return [{ tag: 'span[data-place-chip]' }];
  },
  renderHTML({ HTMLAttributes, node }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-place-chip': '', class: 'mo-chip mo-chip-place' }), `📍 ${node.attrs.name}`];
  },
  renderText: ({ node }) => node.attrs.name,
});

/** Bookmark: an invisible anchor that links can point to ("#bm-<id>"). */
export const Bookmark = Node.create({
  name: 'bookmark',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return { id: { default: null, parseHTML: (el) => el.getAttribute('data-bookmark'), renderHTML: (a) => ({ 'data-bookmark': a.id, id: `bm-${a.id}` }) } };
  },
  parseHTML() {
    return [{ tag: 'span[data-bookmark]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { class: 'mo-bookmark' })];
  },
  renderText: () => '',
});

/** Placeholder chip (Google Docs, for templates): "[Client name]" — click it and type to fill it in. §57. */
export const PlaceholderChip = Node.create({
  name: 'placeholderChip',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return { label: { default: 'Placeholder', parseHTML: (el) => el.getAttribute('data-label') ?? el.textContent?.replace(/^\[|\]$/g, ''), renderHTML: (a) => ({ 'data-label': a.label }) } };
  },
  parseHTML() {
    return [{ tag: 'span[data-placeholder-chip]' }];
  },
  renderHTML({ HTMLAttributes, node }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-placeholder-chip': '', class: 'mo-chip mo-chip-placeholder' }), `[${node.attrs.label}]`];
  },
  renderText: ({ node }) => `[${node.attrs.label}]`,
});

export interface EventInfo {
  title: string;
  date: string | null; // YYYY-MM-DD
  start: string | null; // HH:MM
  end: string | null;
  location: string;
}

/** "Team sync · Oct 3, 2026, 10:00–10:30". */
export function eventLabel(e: Partial<EventInfo>): string {
  const when = [formatChipDate(e.date ?? null), e.start ? `${e.start}${e.end ? `–${e.end}` : ''}` : ''].filter(Boolean).join(', ');
  return [e.title || 'Event', when].filter(Boolean).join(' · ');
}

/** iCalendar file of the event (floating local time; all-day without a start). */
export function eventIcs(e: Partial<EventInfo>, uid = 'mo-event'): string {
  const day = (e.date ?? '').replace(/-/g, '');
  const t = (hm: string | null | undefined) => (hm ? `${day}T${hm.replace(':', '')}00` : null);
  const esc = (s: string) => s.replace(/[\\;,]/g, (c) => `\\${c}`).replace(/\n/g, '\\n');
  const next = (d: string) => {
    const x = new Date(`${d}T12:00:00Z`);
    x.setUTCDate(x.getUTCDate() + 1);
    return x.toISOString().slice(0, 10).replace(/-/g, '');
  };
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Master Office//Docs//EN',
    'BEGIN:VEVENT',
    `UID:${uid}@master-office`,
    `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`,
    ...(e.start ? [`DTSTART:${t(e.start)}`, `DTEND:${t(e.end || e.start)}`] : e.date ? [`DTSTART;VALUE=DATE:${day}`, `DTEND;VALUE=DATE:${next(e.date)}`] : []),
    `SUMMARY:${esc(e.title || 'Event')}`,
    ...(e.location ? [`LOCATION:${esc(e.location)}`] : []),
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.join('\r\n');
}

/** Calendar event chip: title, date, time and place of a meeting, with "Add to calendar" (.ics). §57. */
export const EventChip = Node.create({
  name: 'eventChip',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    const attr = (name: string, fallback: string | null) => ({ default: fallback, parseHTML: (el: HTMLElement) => el.getAttribute(`data-${name}`) ?? fallback, renderHTML: (a: Record<string, unknown>) => (a[name] ? { [`data-${name}`]: a[name] } : {}) });
    return { title: attr('title', 'Event'), date: attr('date', null), start: attr('start', null), end: attr('end', null), location: attr('location', '') };
  },
  parseHTML() {
    return [{ tag: 'span[data-event-chip]' }];
  },
  renderHTML({ HTMLAttributes, node }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-event-chip': '', class: 'mo-chip mo-chip-event' }), `📅 ${eventLabel(node.attrs as EventInfo)}`];
  },
  renderText: ({ node }) => eventLabel(node.attrs as EventInfo),
});

export const CHIP_NODES = ['dateChip', 'dropdownChip', 'placeChip', 'bookmark', 'placeholderChip', 'eventChip'];
