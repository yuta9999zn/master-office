'use client';

import { NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from '@tiptap/react';
import { SectionBreak } from '@workos/doc-model';
import { RectangleHorizontal, RectangleVertical } from 'lucide-react';

/**
 * Section break (next page) in the editor: a labelled divider; the button switches the orientation of the section
 * that follows (PDF and Word lay that section out on landscape / portrait pages). §59.
 */
function SectionBreakView({ node, updateAttributes, editor, selected }: ReactNodeViewProps) {
  const landscape = node.attrs.orientation !== 'portrait';
  return (
    <NodeViewWrapper className="mo-section-break-view my-4 flex items-center gap-2 text-[11px] uppercase tracking-wider text-subtle" contentEditable={false} data-testid="section-break" data-orientation={node.attrs.orientation}>
      <span className="h-px flex-1 border-t border-dashed border-slate-300" />
      <span className={selected ? 'text-brand-600' : ''}>Section break (next page)</span>
      <button
        disabled={!editor.isEditable}
        onClick={() => updateAttributes({ orientation: landscape ? 'portrait' : 'landscape' })}
        className="flex items-center gap-1 rounded-md border border-line px-1.5 py-0.5 normal-case tracking-normal text-ink-2 hover:bg-hover disabled:opacity-60"
        aria-label="Section orientation"
        title="Orientation of the pages after this break"
      >
        {landscape ? <RectangleHorizontal size={13} /> : <RectangleVertical size={13} />}
        {landscape ? 'Landscape' : 'Portrait'}
      </button>
      <span className="h-px flex-1 border-t border-dashed border-slate-300" />
    </NodeViewWrapper>
  );
}

export const SectionBreakWithView = SectionBreak.extend({ addNodeView: () => ReactNodeViewRenderer(SectionBreakView) });
