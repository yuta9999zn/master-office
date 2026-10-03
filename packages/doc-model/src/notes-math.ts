// Footnotes and equations (Google Docs: Insert → Footnote / Equation). docs/ARCHITECTURE.md §37.
import { mergeAttributes, Node, type JSONContent } from '@tiptap/core';
import katex from 'katex';

/**
 * Footnote: a numbered reference in the text; its note is the `text` attribute. Numbers are not stored — they
 * follow the order of the footnotes in the document (a CSS counter in the editor, a running count in exports).
 */
export const Footnote = Node.create({
  name: 'footnote',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return { text: { default: '', parseHTML: (el) => el.getAttribute('data-text') ?? '', renderHTML: (a) => ({ 'data-text': a.text }) } };
  },
  parseHTML() {
    return [{ tag: 'sup[data-footnote]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['sup', mergeAttributes(HTMLAttributes, { 'data-footnote': '', class: 'mo-footnote' })];
  },
  renderText: () => '',
});

/** Footnote texts in document order. */
export function footnotesOf(doc: JSONContent | null | undefined): string[] {
  const out: string[] = [];
  const walk = (n: JSONContent) => {
    if (n.type === 'footnote') out.push(String(n.attrs?.text ?? ''));
    n.content?.forEach(walk);
  };
  if (doc) walk(doc);
  return out;
}

/** Equation written in LaTeX, typeset with KaTeX. */
export const Equation = Node.create({
  name: 'equation',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return { latex: { default: '', parseHTML: (el) => el.getAttribute('data-latex') ?? el.textContent ?? '', renderHTML: (a) => ({ 'data-latex': a.latex }) } };
  },
  parseHTML() {
    return [{ tag: 'span[data-equation]' }];
  },
  renderHTML({ HTMLAttributes, node }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-equation': '', class: 'mo-equation' }), node.attrs.latex];
  },
  renderText: ({ node }) => node.attrs.latex,
});

/**
 * Typeset LaTeX. `mathml` output needs no stylesheet or fonts (exports, PDF); `html` is KaTeX's own layout plus
 * MathML for accessibility (the editor, which loads katex.css).
 */
export function equationHtml(latex: string, output: 'html' | 'mathml' = 'html'): string {
  if (!latex.trim()) return '';
  return katex.renderToString(latex, { throwOnError: false, output: output === 'mathml' ? 'mathml' : 'htmlAndMathml', strict: false });
}

/** Ready-made symbols for the equation editor (Google Docs' equation toolbar, condensed). */
export const EQUATION_SNIPPETS: { label: string; latex: string }[] = [
  { label: 'x²', latex: 'x^{2}' },
  { label: 'xₙ', latex: 'x_{n}' },
  { label: '½', latex: '\\frac{a}{b}' },
  { label: '√', latex: '\\sqrt{x}' },
  { label: 'Σ', latex: '\\sum_{i=1}^{n}' },
  { label: '∫', latex: '\\int_{a}^{b}' },
  { label: 'π', latex: '\\pi' },
  { label: 'α', latex: '\\alpha' },
  { label: 'β', latex: '\\beta' },
  { label: 'Δ', latex: '\\Delta' },
  { label: '≤', latex: '\\le' },
  { label: '≥', latex: '\\ge' },
  { label: '≠', latex: '\\neq' },
  { label: '±', latex: '\\pm' },
  { label: '×', latex: '\\times' },
  { label: '∞', latex: '\\infty' },
  { label: '→', latex: '\\to' },
  { label: 'lim', latex: '\\lim_{x \\to 0}' },
];
