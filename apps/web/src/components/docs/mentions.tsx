'use client';

import type { MentionOptions } from '@tiptap/extension-mention';
import { ReactRenderer } from '@tiptap/react';
import type { SuggestionKeyDownProps, SuggestionProps } from '@tiptap/suggestion';
import { DROPDOWN_PRESETS, isoDay, type JSONContent } from '@workos/doc-model';
import type { UserSummary } from '@workos/shared';
import { CalendarDays, ChevronDownCircle, MapPin, TextCursorInput, CalendarClock } from 'lucide-react';
import { forwardRef, useEffect, useImperativeHandle, useState } from 'react';
import { Avatar, cn } from '../ui/primitives';

/** "@" also inserts smart chips (Google Docs): @date, @today, @tomorrow, @dropdown, @place. */
interface ChipItem {
  chip: string;
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  node: () => JSONContent;
}
const CHIPS: (ChipItem & { keys: string[] })[] = [
  { chip: 'today', keys: ['today', 'date'], title: 'Today', subtitle: 'Date', icon: <CalendarDays size={16} />, node: () => ({ type: 'dateChip', attrs: { date: isoDay(), format: 'short' } }) },
  { chip: 'tomorrow', keys: ['tomorrow', 'date'], title: 'Tomorrow', subtitle: 'Date', icon: <CalendarDays size={16} />, node: () => ({ type: 'dateChip', attrs: { date: isoDay(1), format: 'short' } }) },
  { chip: 'yesterday', keys: ['yesterday'], title: 'Yesterday', subtitle: 'Date', icon: <CalendarDays size={16} />, node: () => ({ type: 'dateChip', attrs: { date: isoDay(-1), format: 'short' } }) },
  ...DROPDOWN_PRESETS.map((p, i) => ({ chip: `dropdown-${i}`, keys: ['dropdown', p.name.toLowerCase()], title: p.name, subtitle: 'Dropdown', icon: <ChevronDownCircle size={16} />, node: () => ({ type: 'dropdownChip', attrs: { options: p.options, value: null } }) })),
  { chip: 'place', keys: ['place', 'location', 'map'], title: 'Place', subtitle: 'Opens in Maps', icon: <MapPin size={16} />, node: () => ({ type: 'placeChip', attrs: { name: 'Place' } }) },
  { chip: 'placeholder', keys: ['placeholder', 'fill'], title: 'Placeholder', subtitle: 'Fill in later', icon: <TextCursorInput size={16} />, node: () => ({ type: 'placeholderChip', attrs: { label: 'Placeholder' } }) },
  { chip: 'event', keys: ['event', 'meeting', 'calendar'], title: 'Calendar event', subtitle: 'Date, time and place', icon: <CalendarClock size={16} />, node: () => ({ type: 'eventChip', attrs: { title: 'Meeting', date: isoDay(1), start: '10:00', end: '10:30', location: '' } }) },
];
const chipsFor = (q: string) => (q.length >= 2 ? CHIPS.filter((c) => c.keys.some((k) => k.startsWith(q.toLowerCase()))) : []);

type Item = UserSummary | ChipItem;
const isChip = (i: Item): i is ChipItem => 'chip' in i;

interface ListProps {
  items: Item[];
  command: (item: { id: string; label: string; chip?: ChipItem }) => void;
}
export interface ListHandle {
  onKeyDown: (p: SuggestionKeyDownProps) => boolean;
}

const MentionList = forwardRef<ListHandle, ListProps>(function MentionList({ items, command }, ref) {
  const [index, setIndex] = useState(0);
  useEffect(() => setIndex(0), [items]);
  const pick = (i: number) => {
    const it = items[i];
    if (!it) return;
    if (isChip(it)) command({ id: `chip:${it.chip}`, label: it.title, chip: it });
    else command({ id: it.id, label: it.name });
  };
  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      if (event.key === 'ArrowDown') setIndex((i) => (i + 1) % Math.max(items.length, 1));
      else if (event.key === 'ArrowUp') setIndex((i) => (i - 1 + items.length) % Math.max(items.length, 1));
      else if (event.key === 'Enter' || event.key === 'Tab') pick(index);
      else return false;
      return true;
    },
  }));
  return (
    <div className="pop w-64 animate-pop">
      {items.length ? (
        items.map((u, i) => (
          <button
            key={isChip(u) ? u.chip : u.id}
            onMouseDown={(e) => {
              e.preventDefault();
              pick(i);
            }}
            className={cn('menu-item w-full', i === index && 'bg-hover')}
            data-testid={isChip(u) ? `chip-${u.chip}` : undefined}
          >
            {isChip(u) ? <span className="flex size-[22px] items-center justify-center text-muted">{u.icon}</span> : <Avatar user={u} size={22} />}
            <span className="min-w-0 flex-1 text-left">
              <span className="block truncate text-[13px] text-ink">{isChip(u) ? u.title : u.name}</span>
              <span className="block truncate text-[11px] text-muted">{isChip(u) ? u.subtitle : u.title}</span>
            </span>
          </button>
        ))
      ) : (
        <div className="px-3 py-2 text-[13px] text-muted">No people found</div>
      )}
    </div>
  );
});

/** @-mention suggestion wired to the workspace directory. */
export function mentionSuggestion(getUsers: () => UserSummary[]): Partial<MentionOptions> {
  return {
    suggestion: {
      items: ({ query }) => [
        ...chipsFor(query),
        ...getUsers()
          .filter((u) => u.name.toLowerCase().includes(query.toLowerCase()) || u.email.toLowerCase().startsWith(query.toLowerCase()))
          .slice(0, 6),
      ] as never,
      command: ({ editor, range, props }) => {
        const p = props as unknown as { id: string; label: string; chip?: ChipItem };
        const node = p.chip ? p.chip.node() : { type: 'mention', attrs: { id: p.id, label: p.label } };
        editor.chain().focus().insertContentAt(range, [node, { type: 'text', text: ' ' }]).run();
      },
      render: () => {
        let renderer: ReactRenderer<ListHandle, ListProps> | null = null;
        let host: HTMLDivElement | null = null;
        const place = (p: SuggestionProps) => {
          const rect = p.clientRect?.();
          if (!rect || !host) return;
          host.style.left = `${rect.left}px`;
          host.style.top = `${rect.bottom + 6}px`;
        };
        return {
          onStart: (p) => {
            renderer = new ReactRenderer(MentionList, { props: p as unknown as ListProps, editor: p.editor });
            host = document.createElement('div');
            host.style.position = 'fixed';
            host.style.zIndex = '60';
            host.appendChild(renderer.element);
            document.body.appendChild(host);
            place(p);
          },
          onUpdate: (p) => {
            renderer?.updateProps(p);
            place(p);
          },
          onKeyDown: (p) => {
            if (p.event.key === 'Escape') {
              host?.remove();
              return true;
            }
            return renderer?.ref?.onKeyDown(p) ?? false;
          },
          onExit: () => {
            host?.remove();
            renderer?.destroy();
            host = null;
            renderer = null;
          },
        };
      },
    },
  };
}
