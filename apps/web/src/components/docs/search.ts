'use client';

import { Extension } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, TextSelection, type EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

/** Find & Replace (Word: Ctrl+F / Ctrl+H). Matches never cross paragraph boundaries, like Word. */

export interface SearchOptions {
  query: string;
  caseSensitive: boolean;
  wholeWord: boolean;
}

interface SearchState extends SearchOptions {
  matches: { from: number; to: number }[];
  index: number;
  decorations: DecorationSet;
}

export const searchKey = new PluginKey<SearchState>('mo-search');

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function find(doc: PMNode, o: SearchOptions) {
  const out: { from: number; to: number }[] = [];
  if (!o.query) return out;
  const re = new RegExp(o.wholeWord ? `(?<![\\p{L}\\p{N}_])${escapeRe(o.query)}(?![\\p{L}\\p{N}_])` : escapeRe(o.query), `g${o.caseSensitive ? '' : 'i'}u`);
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    // Flatten the block: text as-is, inline atoms as one placeholder char so offsets stay aligned with positions.
    let text = '';
    // Text struck through by a pending suggestion is not searchable (it would otherwise match forever on replace).
    node.forEach((child) => {
      if (!child.isText) text += '￼';
      else if (child.marks.some((m) => m.type.name === 'deletion')) text += '�'.repeat(child.text!.length);
      else text += child.text;
    });
    for (const m of text.matchAll(re)) {
      if (m[0].length) out.push({ from: pos + 1 + m.index!, to: pos + 1 + m.index! + m[0].length });
    }
    return false;
  });
  return out;
}

function build(doc: PMNode, o: SearchOptions, index: number, selFrom: number): SearchState {
  const matches = find(doc, o);
  const i = matches.length ? (index >= 0 && index < matches.length ? index : Math.max(0, matches.findIndex((m) => m.from >= selFrom))) : -1;
  const decorations = DecorationSet.create(
    doc,
    matches.map((m, k) => Decoration.inline(m.from, m.to, { class: k === i ? 'mo-search-match current' : 'mo-search-match' })),
  );
  return { ...o, matches, index: i, decorations };
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    search: {
      setSearch: (o: Partial<SearchOptions>) => ReturnType;
      findNext: () => ReturnType;
      findPrevious: () => ReturnType;
      replaceCurrent: (text: string) => ReturnType;
      replaceAll: (text: string) => ReturnType;
    };
  }
}

export function searchState(state: EditorState) {
  return searchKey.getState(state);
}

export const SearchReplace = Extension.create({
  name: 'searchReplace',
  addProseMirrorPlugins() {
    return [
      new Plugin<SearchState>({
        key: searchKey,
        state: {
          init: () => ({ query: '', caseSensitive: false, wholeWord: false, matches: [], index: -1, decorations: DecorationSet.empty }),
          apply(tr, prev, _old, next) {
            const meta = tr.getMeta(searchKey) as (Partial<SearchOptions> & { index?: number }) | undefined;
            if (meta) return build(next.doc, { ...prev, ...meta }, meta.index ?? -1, next.selection.from);
            if (tr.docChanged && prev.query) return build(next.doc, prev, prev.index, next.selection.from);
            return prev;
          },
        },
        props: { decorations: (state) => searchKey.getState(state)?.decorations },
      }),
    ];
  },
  addCommands() {
    const go = (dir: 1 | -1) => ({ state, dispatch }: { state: EditorState; dispatch?: (tr: import('@tiptap/pm/state').Transaction) => void }) => {
      const s = searchKey.getState(state);
      if (!s?.matches.length) return false;
      const index = (s.index + dir + s.matches.length) % s.matches.length;
      const m = s.matches[index];
      dispatch?.(state.tr.setMeta(searchKey, { index }).setSelection(TextSelection.create(state.doc, m.from, m.to)).scrollIntoView());
      return true;
    };
    return {
      setSearch:
        (o) =>
        ({ state, dispatch }) => {
          dispatch?.(state.tr.setMeta(searchKey, o));
          return true;
        },
      findNext: () => go(1),
      findPrevious: () => go(-1),
      replaceCurrent:
        (text) =>
        ({ state, dispatch }) => {
          const s = searchKey.getState(state);
          const m = s?.matches[s.index];
          if (!m) return false;
          const tr = state.tr.insertText(text, m.from, m.to);
          tr.setSelection(TextSelection.create(tr.doc, m.from + text.length));
          dispatch?.(tr);
          return true;
        },
      replaceAll:
        (text) =>
        ({ state, dispatch }) => {
          const s = searchKey.getState(state);
          if (!s?.matches.length) return false;
          const tr = state.tr;
          for (const m of [...s.matches].reverse()) tr.insertText(text, m.from, m.to);
          dispatch?.(tr);
          return true;
        },
    };
  },
});
