'use client';

import type { Editor } from '@tiptap/react';
import { useEditorState } from '@tiptap/react';
import { cn } from '../ui/primitives';

interface Heading {
  level: number;
  text: string;
  pos: number;
}

/** Page outline from the live document's headings. */
export function Outline({ editor }: { editor: Editor }) {
  const { headings, current } = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      const list: Heading[] = [];
      e.state.doc.descendants((node, pos) => {
        if (node.type.name === 'heading') list.push({ level: node.attrs.level, text: node.textContent, pos });
        return node.type.name !== 'heading';
      });
      const at = e.state.selection.from;
      const cur = [...list].reverse().find((h) => h.pos <= at)?.pos ?? null;
      return { headings: list, current: cur };
    },
    equalityFn: (a, b) => JSON.stringify(a) === JSON.stringify(b),
  }) ?? { headings: [], current: null };

  return (
    <nav className="w-[200px] shrink-0 overflow-y-auto pr-2 pt-2">
      <div className="mb-2 px-2 text-[11px] font-semibold uppercase tracking-wide text-subtle">Outline</div>
      {!headings.length && <p className="px-2 text-[12px] text-muted">Headings you add appear here.</p>}
      {headings.map((h) => (
        <button
          key={h.pos}
          onClick={() => {
            editor.chain().focus().setTextSelection(h.pos + 1).run();
            editor.view.domAtPos(h.pos + 1).node.parentElement?.scrollIntoView({ block: 'start', behavior: 'smooth' });
          }}
          className={cn('block w-full truncate rounded-md py-1 pr-2 text-left text-[13px] hover:bg-hover', current === h.pos ? 'font-semibold text-brand-600' : 'text-ink-2')}
          style={{ paddingLeft: 8 + (h.level - 1) * 12 }}
        >
          {h.text || 'Untitled heading'}
        </button>
      ))}
    </nav>
  );
}
