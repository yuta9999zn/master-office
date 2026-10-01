'use client';

import type { MentionOptions } from '@tiptap/extension-mention';
import { ReactRenderer } from '@tiptap/react';
import type { SuggestionKeyDownProps, SuggestionProps } from '@tiptap/suggestion';
import type { UserSummary } from '@workos/shared';
import { forwardRef, useEffect, useImperativeHandle, useState } from 'react';
import { Avatar, cn } from '../ui/primitives';

interface ListProps {
  items: UserSummary[];
  command: (item: { id: string; label: string }) => void;
}
export interface ListHandle {
  onKeyDown: (p: SuggestionKeyDownProps) => boolean;
}

const MentionList = forwardRef<ListHandle, ListProps>(function MentionList({ items, command }, ref) {
  const [index, setIndex] = useState(0);
  useEffect(() => setIndex(0), [items]);
  const pick = (i: number) => items[i] && command({ id: items[i].id, label: items[i].name });
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
            key={u.id}
            onMouseDown={(e) => {
              e.preventDefault();
              pick(i);
            }}
            className={cn('menu-item w-full', i === index && 'bg-hover')}
          >
            <Avatar user={u} size={22} />
            <span className="min-w-0 flex-1 text-left">
              <span className="block truncate text-[13px] text-ink">{u.name}</span>
              <span className="block truncate text-[11px] text-muted">{u.title}</span>
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
      items: ({ query }) =>
        getUsers()
          .filter((u) => u.name.toLowerCase().includes(query.toLowerCase()) || u.email.toLowerCase().startsWith(query.toLowerCase()))
          .slice(0, 6),
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
