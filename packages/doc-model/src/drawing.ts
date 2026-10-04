// Insert → Drawing (Google Docs' drawing canvas). docs/ARCHITECTURE.md §60.
// A drawing is a small slide: shapes, lines, freeforms and text boxes from slide-model, kept as the node's
// attributes. doc-model does not depend on slide-model: renderers are passed in (like charts).
import { mergeAttributes, Node, type JSONContent } from '@tiptap/core';

export interface DrawingAttrs {
  /** Canvas size in px. */
  w: number;
  h: number;
  /** slide-model PlainElement[] */
  elements: unknown[];
}

/** HTML of a drawing (the server and the browser plug in slide-model's renderer). */
export type DrawingPainter = (d: DrawingAttrs) => string;

export const Drawing = Node.create({
  name: 'drawing',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() {
    return {
      w: { default: 640 },
      h: { default: 360 },
      elements: { default: [], parseHTML: (el) => JSON.parse(el.getAttribute('data-elements') ?? '[]'), renderHTML: (a) => ({ 'data-elements': JSON.stringify(a.elements ?? []) }) },
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-drawing]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-drawing': '' })];
  },
});

export function drawingsOf(doc: JSONContent | null | undefined): DrawingAttrs[] {
  const out: DrawingAttrs[] = [];
  const walk = (n: JSONContent) => {
    if (n.type === 'drawing') out.push({ w: Number(n.attrs?.w) || 640, h: Number(n.attrs?.h) || 360, elements: (n.attrs?.elements as unknown[]) ?? [] });
    n.content?.forEach(walk);
  };
  if (doc) walk(doc);
  return out;
}
