'use client';

import { Extension } from '@tiptap/core';
import { isChangeOrigin } from '@tiptap/extension-collaboration';
import { Fragment, Slice, type Mark, type MarkType, type Node as PMNode } from '@tiptap/pm/model';
import { TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state';
import { ReplaceStep } from '@tiptap/pm/transform';
import type { SuggestionAttrs } from '@workos/doc-model';

/**
 * Suggesting mode (Word "Track Changes"): the user's own edits become insertion/deletion marks
 * that anyone with edit access can accept or reject. Remote (Yjs) and undo transactions pass through untouched.
 * Structural edits (joining paragraphs, table operations) are applied directly — only text is tracked.
 */

const INTERNAL = 'mo-suggest-internal';
const BURST_MS = 20_000;

export interface SuggestUser {
  id: string;
  name: string;
  color: string;
}

export interface SuggestionItem {
  id: string;
  authorId: string;
  authorName: string;
  color: string;
  at: string;
  inserted: string;
  deleted: string;
  from: number;
  to: number;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    suggestChanges: {
      setSuggesting: (on: boolean) => ReturnType;
      acceptSuggestion: (id?: string) => ReturnType;
      rejectSuggestion: (id?: string) => ReturnType;
    };
  }
}

function markSlice(slice: Slice, ins: Mark, deletion: MarkType): Slice {
  const mapFragment = (f: Fragment): Fragment => {
    const nodes: PMNode[] = [];
    f.forEach((n) => nodes.push(n.isText ? n.mark(deletion.removeFromSet(ins.addToSet(n.marks))) : n.copy(mapFragment(n.content))));
    return Fragment.fromArray(nodes);
  };
  return new Slice(mapFragment(slice.content), slice.openStart, slice.openEnd);
}

function track(state: EditorState, tr: Transaction, user: SuggestUser, storage: SuggestStorage): Transaction | null {
  if (tr.steps.length !== 1 || !(tr.steps[0] instanceof ReplaceStep)) return null;
  const step = tr.steps[0] as ReplaceStep & { structure?: boolean };
  if (step.structure) return null;
  const { from, to, slice } = step;
  const schema = state.schema;

  // Collect the text being removed. Anything other than text (mentions, images, block boundaries) → untracked.
  const toMark: [number, number][] = [];
  const own: [number, number][] = [];
  let unsupported = false;
  let text = 0;
  state.doc.nodesBetween(from, to, (node, pos) => {
    if (node.isText) {
      const s = Math.max(pos, from);
      const e = Math.min(pos + node.nodeSize, to);
      text += e - s;
      const ins = node.marks.find((m) => m.type.name === 'insertion');
      if (ins && ins.attrs.authorId === user.id) own.push([s, e]);
      else if (!node.marks.some((m) => m.type.name === 'deletion')) toMark.push([s, e]);
      return false;
    }
    if (node.isInline) unsupported = true;
    return true;
  });
  if (unsupported) return null;
  if (to > from && text === 0 && slice.size === 0) return null; // e.g. Backspace joining two paragraphs

  const now = Date.now();
  const burst = storage.burst;
  // Consecutive typing reuses the exact same attributes, so the marks merge into one continuous suggestion.
  const attrs: SuggestionAttrs =
    burst && now - burst.at < BURST_MS && Math.abs(burst.pos - from) <= 1
      ? burst.attrs
      : { id: crypto.randomUUID(), authorId: user.id, authorName: user.name, color: user.color, at: new Date(now).toISOString() };
  const ins = schema.marks.insertion.create(attrs);
  const del = schema.marks.deletion.create(attrs);

  const next = state.tr.setMeta(INTERNAL, true);
  for (const [s, e] of toMark) next.addMark(s, e, del);
  for (const [s, e] of own.sort((a, b) => b[0] - a[0])) next.delete(s, e);
  const insertAt = next.mapping.map(to);
  if (slice.size > 0) next.replace(insertAt, insertAt, markSlice(slice, ins, schema.marks.deletion));

  // Where the caret goes: after the typed text; for Backspace to the left of what was struck through.
  const sel = state.selection;
  let caret: number;
  if (slice.size > 0) caret = next.mapping.map(insertAt, 1) - (slice.openEnd ? 1 : 0);
  else if (sel.empty && sel.from === to) caret = next.mapping.map(from, -1);
  else caret = next.mapping.map(to);
  caret = Math.max(0, Math.min(caret, next.doc.content.size));
  next.setSelection(TextSelection.near(next.doc.resolve(caret)));
  next.scrollIntoView();
  storage.burst = { attrs, at: now, pos: caret };
  return next;
}

interface SuggestStorage {
  enabled: boolean;
  burst: { attrs: SuggestionAttrs; at: number; pos: number } | null;
}

function resolve(state: EditorState, dispatch: ((tr: Transaction) => void) | undefined, id: string | undefined, accept: boolean) {
  const ranges: { from: number; to: number; mark: Mark }[] = [];
  state.doc.descendants((node, pos) => {
    if (!node.isText) return;
    for (const m of node.marks) {
      if ((m.type.name === 'insertion' || m.type.name === 'deletion') && (!id || m.attrs.id === id)) ranges.push({ from: pos, to: pos + node.nodeSize, mark: m });
    }
  });
  if (!ranges.length) return false;
  if (!dispatch) return true;
  const tr = state.tr.setMeta(INTERNAL, true);
  const remove: typeof ranges = [];
  for (const r of ranges) {
    const drop = accept ? r.mark.type.name === 'deletion' : r.mark.type.name === 'insertion';
    if (drop) remove.push(r);
    else tr.removeMark(r.from, r.to, r.mark);
  }
  for (const r of remove.sort((a, b) => b.from - a.from)) tr.delete(r.from, r.to);
  dispatch(tr);
  return true;
}

/** Suggestions grouped by id, in document order — for the review panel. */
export function collectSuggestions(doc: PMNode): SuggestionItem[] {
  const byId = new Map<string, SuggestionItem>();
  doc.descendants((node, pos) => {
    if (!node.isText) return;
    for (const m of node.marks) {
      if (m.type.name !== 'insertion' && m.type.name !== 'deletion') continue;
      const a = m.attrs as SuggestionAttrs;
      const item = byId.get(a.id) ?? { id: a.id, authorId: a.authorId, authorName: a.authorName, color: a.color, at: a.at, inserted: '', deleted: '', from: pos, to: pos };
      if (m.type.name === 'insertion') item.inserted += node.text;
      else item.deleted += node.text;
      item.to = pos + node.nodeSize;
      byId.set(a.id, item);
    }
  });
  return [...byId.values()];
}

export const SuggestChanges = Extension.create<{ user: SuggestUser }, SuggestStorage>({
  name: 'suggestChanges',
  addOptions() {
    return { user: { id: '', name: '', color: '#2563eb' } };
  },
  addStorage() {
    return { enabled: false, burst: null };
  },
  addCommands() {
    return {
      setSuggesting:
        (on) =>
        ({ editor }) => {
          this.storage.enabled = on;
          this.storage.burst = null;
          editor.view.dispatch(editor.state.tr.setMeta(INTERNAL, true).setMeta('suggestMode', on));
          return true;
        },
      acceptSuggestion:
        (id) =>
        ({ state, dispatch }) =>
          resolve(state, dispatch, id, true),
      rejectSuggestion:
        (id) =>
        ({ state, dispatch }) =>
          resolve(state, dispatch, id, false),
    };
  },
  dispatchTransaction({ transaction, next }) {
    if (!this.storage.enabled || !transaction.docChanged || transaction.getMeta(INTERNAL) || isChangeOrigin(transaction)) return next(transaction);
    next(track(this.editor.state, transaction, this.options.user, this.storage) ?? transaction);
  },
});
