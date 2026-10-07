// Building blocks of the documentation templates (§76, §78): paragraphs, headings, lists, tables, callouts.
import type { JSONContent } from '@tiptap/core';

export const t = (text: string, ...marks: string[]): JSONContent => ({ type: 'text', text, ...(marks.length ? { marks: marks.map((type) => ({ type })) } : {}) });
// Empty strings are dropped: ProseMirror has no empty text nodes.
export const p = (...content: (JSONContent | string)[]): JSONContent => {
  const nodes = content.filter((c) => (typeof c === 'string' ? c !== '' : c.type !== 'text' || !!c.text)).map((c) => (typeof c === 'string' ? t(c) : c));
  return nodes.length ? { type: 'paragraph', content: nodes } : { type: 'paragraph' };
};
export const hint = (text: string): JSONContent => p(t(text, 'italic'));
export const h = (level: number, text: string): JSONContent => ({ type: 'heading', attrs: { level }, content: [t(text)] });
export const ul = (...items: string[]): JSONContent => ({ type: 'bulletList', content: items.map((i) => ({ type: 'listItem', content: [p(i)] })) });
export const ol = (...items: string[]): JSONContent => ({ type: 'orderedList', attrs: { start: 1 }, content: items.map((i) => ({ type: 'listItem', content: [p(i)] })) });
export const tasks = (...items: string[]): JSONContent => ({ type: 'taskList', content: items.map((i) => ({ type: 'taskItem', attrs: { checked: false }, content: [p(i)] })) });
export const callout = (tone: string, ...content: JSONContent[]): JSONContent => ({ type: 'callout', attrs: { tone }, content });
export const table = (head: string[], rows: string[][]): JSONContent => ({
  type: 'table',
  content: [
    { type: 'tableRow', content: head.map((c) => ({ type: 'tableHeader', content: [p(c)] })) },
    ...rows.map((r) => ({ type: 'tableRow', content: r.map((c) => ({ type: 'tableCell', content: [c ? p(c) : { type: 'paragraph' }] })) })),
  ],
});
export const doc = (...content: JSONContent[]): JSONContent => ({ type: 'doc', content });

/** Title, owner line and the revision / approval table every controlled document starts with. */
export const head = (title: string, kind: string): JSONContent[] => [
  h(1, title),
  p(t(kind, 'bold'), ' · Version 0.1 · Status: Draft'),
  h(3, 'Document control'),
  table(['Date', 'Version', 'Change', 'Author', 'Approved by'], [['', '0.1', 'First draft', '', '']]),
];
export const intro = (purpose: string): JSONContent[] => [
  h(2, '1. Introduction'),
  h(3, '1.1 Purpose'),
  hint(purpose),
  h(3, '1.2 Scope'),
  hint('What this document covers — and what it does not.'),
  h(3, '1.3 Stakeholders'),
  table(['Name', 'Role', 'Responsibility', 'Contact'], [['', '', '', ''], ['', '', '', '']]),
  h(3, '1.4 Definitions and acronyms'),
  table(['Term', 'Meaning'], [['', ''], ['', '']]),
  h(3, '1.5 References'),
  ul('Related documents, standards, links'),
];

