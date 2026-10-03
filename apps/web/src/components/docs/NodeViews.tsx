'use client';

import { PageBreak, TableOfContents } from '@workos/doc-model';
import { NodeViewWrapper, ReactNodeViewRenderer, useEditorState, type ReactNodeViewProps } from '@tiptap/react';
import { ListTree } from 'lucide-react';
import { cn } from '../ui/primitives';

function PageBreakView({ selected }: ReactNodeViewProps) {
  return (
    <NodeViewWrapper contentEditable={false} className={cn('mo-page-break my-4 flex items-center gap-3 text-[11px] font-medium uppercase tracking-wider text-subtle', selected && 'text-brand-600')}>
      <span className="h-px flex-1 border-t border-dashed border-current" />
      Page break
      <span className="h-px flex-1 border-t border-dashed border-current" />
    </NodeViewWrapper>
  );
}

/** Live table of contents: always reflects the current headings; entries jump to the heading. */
function TocView({ editor, node, selected }: ReactNodeViewProps) {
  const max = (node.attrs.maxLevel as number) ?? 3;
  const headings =
    useEditorState({
      editor,
      selector: ({ editor: e }) => {
        const list: { level: number; text: string; pos: number }[] = [];
        e.state.doc.descendants((n, pos) => {
          if (n.type.name === 'heading') {
            if (n.attrs.level <= max) list.push({ level: n.attrs.level, text: n.textContent, pos });
            return false;
          }
          return true;
        });
        return list;
      },
      equalityFn: (a, b) => JSON.stringify(a) === JSON.stringify(b),
    }) ?? [];
  return (
    <NodeViewWrapper contentEditable={false} className={cn('my-3 rounded-xl border bg-canvas/60 px-5 py-4', selected ? 'border-brand-600' : 'border-line')} data-testid="toc">
      <div className="mb-2 flex items-center gap-2 text-[13px] font-semibold text-ink">
        <ListTree size={15} className="text-brand-600" /> Table of contents
      </div>
      {!headings.length && <div className="text-[13px] text-muted">Add headings to build the table of contents.</div>}
      {headings.map((h) => (
        <button
          key={h.pos}
          onClick={() => {
            editor.chain().focus().setTextSelection(h.pos + 1).run();
            editor.view.domAtPos(h.pos + 1).node.parentElement?.scrollIntoView({ block: 'start', behavior: 'smooth' });
          }}
          className="block w-full truncate py-0.5 text-left text-[14px] text-brand-700 hover:underline"
          style={{ paddingLeft: (h.level - 1) * 18 }}
        >
          {h.text || 'Untitled heading'}
        </button>
      ))}
    </NodeViewWrapper>
  );
}

export const PageBreakWithView = PageBreak.extend({
  addNodeView: () => ReactNodeViewRenderer(PageBreakView),
  addKeyboardShortcuts() {
    return { 'Mod-Enter': () => this.editor.chain().insertContent({ type: 'pageBreak' }).run() };
  },
});

export const TableOfContentsWithView = TableOfContents.extend({
  addNodeView: () => ReactNodeViewRenderer(TocView),
});
