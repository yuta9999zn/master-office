'use client';

import type { Editor } from '@tiptap/core';
import { Fragment, type Node as PMNode } from '@tiptap/pm/model';
import { markdownToHtml, toMarkdown, type JSONContent } from '@workos/doc-model';
import { toast } from 'sonner';

/** Top-level block range around the selection: [start, end) positions in the document. */
function topRange(editor: Editor) {
  const { $from, $to } = editor.state.selection;
  const start = $from.depth ? $from.before(1) : $from.pos;
  const end = $to.depth ? $to.after(1) : $to.pos;
  return { start, end };
}

/** The columns block around the cursor, if any. */
function columnsAround(editor: Editor): { pos: number; node: PMNode } | null {
  const { $from } = editor.state.selection;
  for (let d = $from.depth; d > 0; d--) {
    const n = $from.node(d);
    if (n.type.name === 'columns') return { pos: $from.before(d), node: n };
  }
  return null;
}

/**
 * Format → Columns (Google Docs): 2 or 3 columns put the selected blocks in the first column; changing the count of
 * an existing block keeps every column's content; 1 column turns the block back into ordinary text.
 */
export function setColumns(editor: Editor, count: 1 | 2 | 3) {
  const { state } = editor;
  const schema = state.schema;
  const existing = columnsAround(editor);
  const tr = state.tr;
  if (existing) {
    const cols: PMNode[] = [];
    existing.node.forEach((c) => cols.push(c));
    if (count === 1) {
      const blocks: PMNode[] = [];
      cols.forEach((c) => c.forEach((b) => blocks.push(b)));
      tr.replaceWith(existing.pos, existing.pos + existing.node.nodeSize, Fragment.from(blocks));
    } else {
      let next = cols.slice(0, count);
      if (cols.length > count) {
        // Content of removed columns moves to the last kept one.
        const extra: PMNode[] = [];
        cols.slice(count).forEach((c) => c.forEach((b) => extra.push(b)));
        const last = next[next.length - 1];
        const kept: PMNode[] = [];
        last.forEach((b) => kept.push(b));
        next[next.length - 1] = schema.nodes.column.create(null, Fragment.from([...kept, ...extra]));
      }
      while (next.length < count) next = [...next, schema.nodes.column.create(null, schema.nodes.paragraph.create())];
      tr.replaceWith(existing.pos, existing.pos + existing.node.nodeSize, schema.nodes.columns.create(null, Fragment.from(next)));
    }
  } else {
    if (count === 1) return;
    const { start, end } = topRange(editor);
    const blocks: PMNode[] = [];
    state.doc.nodesBetween(start, end, (n, pos) => {
      if (pos >= start && pos < end && state.doc.resolve(pos).depth === 0) blocks.push(n);
      return false;
    });
    const first = schema.nodes.column.create(null, Fragment.from(blocks.length ? blocks : [schema.nodes.paragraph.create()]));
    const others = Array.from({ length: count - 1 }, () => schema.nodes.column.create(null, schema.nodes.paragraph.create()));
    tr.replaceWith(start, end, schema.nodes.columns.create(null, Fragment.from([first, ...others])));
  }
  editor.view.dispatch(tr.scrollIntoView());
  editor.commands.focus();
}

/** Edit → Copy as Markdown: the selection, or the whole document when nothing is selected. */
export async function copyAsMarkdown(editor: Editor) {
  const { from, to, empty } = editor.state.selection;
  // `cut` keeps the blocks around a partial selection (a slice inside one heading would be bare text).
  const json: JSONContent = empty ? editor.getJSON() : (editor.state.doc.cut(from, to).toJSON() as JSONContent);
  try {
    await navigator.clipboard.writeText(toMarkdown(json));
    toast.success(empty ? 'Document copied as Markdown' : 'Selection copied as Markdown');
  } catch {
    toast.error('The browser blocked clipboard access');
  }
}

/** Edit → Paste from Markdown: clipboard text converted to formatted content. */
export async function pasteMarkdown(editor: Editor) {
  try {
    const text = await navigator.clipboard.readText();
    if (text.trim()) editor.chain().focus().insertContent(markdownToHtml(text)).run();
  } catch {
    toast.error('The browser blocked clipboard access — paste with Ctrl+V instead');
  }
}

const MD_PREF = 'mo-docs-detect-markdown';
export const markdownPasteEnabled = () => {
  try {
    return localStorage.getItem(MD_PREF) !== '0';
  } catch {
    return true;
  }
};
export const setMarkdownPaste = (on: boolean) => {
  try {
    localStorage.setItem(MD_PREF, on ? '1' : '0');
  } catch {
    /* private mode */
  }
};
