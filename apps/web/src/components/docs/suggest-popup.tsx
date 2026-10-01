'use client';

import { ReactRenderer } from '@tiptap/react';
import type { SuggestionKeyDownProps, SuggestionOptions, SuggestionProps } from '@tiptap/suggestion';
import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type ReactNode } from 'react';
import { cn } from '../ui/primitives';

/** Generic keyboard-driven popup for Tiptap suggestions (slash menu, [[page links]]). */
export interface PopupItem {
  id: string;
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  group?: string;
}

interface Props {
  items: PopupItem[];
  command: (item: PopupItem) => void;
  empty?: string;
}
export interface PopupHandle {
  onKeyDown: (p: SuggestionKeyDownProps) => boolean;
}

const PopupList = forwardRef<PopupHandle, Props>(function PopupList({ items, command, empty }, ref) {
  const [index, setIndex] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => setIndex(0), [items]);
  useEffect(() => list.current?.querySelector(`[data-index="${index}"]`)?.scrollIntoView({ block: 'nearest' }), [index]);
  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      if (event.key === 'ArrowDown') setIndex((i) => (i + 1) % Math.max(items.length, 1));
      else if (event.key === 'ArrowUp') setIndex((i) => (i - 1 + items.length) % Math.max(items.length, 1));
      else if (event.key === 'Enter' || event.key === 'Tab') {
        if (items[index]) command(items[index]);
      } else return false;
      return true;
    },
  }));
  let lastGroup: string | undefined;
  return (
    <div ref={list} className="pop max-h-80 w-72 overflow-y-auto animate-pop" role="listbox">
      {items.length ? (
        items.map((it, i) => {
          const header = it.group && it.group !== lastGroup ? it.group : null;
          lastGroup = it.group;
          return (
            <div key={it.id}>
              {header && <div className="px-2.5 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-subtle">{header}</div>}
              <button
                data-index={i}
                role="option"
                aria-selected={i === index}
                onMouseDown={(e) => {
                  e.preventDefault();
                  command(it);
                }}
                onMouseEnter={() => setIndex(i)}
                className={cn('menu-item w-full', i === index && 'bg-hover')}
              >
                {it.icon && <span className="flex size-7 shrink-0 items-center justify-center rounded-md border border-line bg-surface text-ink-2 [&>svg]:size-4">{it.icon}</span>}
                <span className="min-w-0 flex-1 text-left">
                  <span className="block truncate text-[13px] text-ink">{it.title}</span>
                  {it.subtitle && <span className="block truncate text-[11px] text-muted">{it.subtitle}</span>}
                </span>
              </button>
            </div>
          );
        })
      ) : (
        <div className="px-3 py-2 text-[13px] text-muted">{empty ?? 'No results'}</div>
      )}
    </div>
  );
});

/** Positions the popup under the caret and wires keyboard handling. */
export function popupRender(empty?: string): NonNullable<SuggestionOptions<PopupItem>['render']> {
  return () => {
    let renderer: ReactRenderer<PopupHandle, Props> | null = null;
    let host: HTMLDivElement | null = null;
    const place = (p: SuggestionProps<PopupItem>) => {
      const rect = p.clientRect?.();
      if (!rect || !host) return;
      const below = window.innerHeight - rect.bottom > 340;
      host.style.left = `${Math.min(rect.left, window.innerWidth - 300)}px`;
      host.style.top = below ? `${rect.bottom + 6}px` : `${Math.max(8, rect.top - 330)}px`;
    };
    return {
      onStart: (p) => {
        renderer = new ReactRenderer(PopupList, { props: { ...p, empty } as unknown as Props, editor: p.editor });
        host = document.createElement('div');
        host.style.position = 'fixed';
        host.style.zIndex = '60';
        host.appendChild(renderer.element);
        document.body.appendChild(host);
        place(p);
      },
      onUpdate: (p) => {
        renderer?.updateProps({ ...p, empty });
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
  };
}
