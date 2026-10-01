'use client';

import { Extension, type Editor } from '@tiptap/core';
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { absolutePositionToRelativePosition, relativePositionToAbsolutePosition, ySyncPluginKey } from '@tiptap/y-tiptap';
import type { CommentAnchor, CommentThread } from '@workos/shared';
import * as Y from 'yjs';

/**
 * Comment anchors are Yjs relative positions (docs/ARCHITECTURE.md §7.1): they stick to the characters
 * they were created on while other people type, and creating one needs no write access to the document.
 */

function binding(state: EditorState) {
  const s = ySyncPluginKey.getState(state) as { doc: Y.Doc; type: Y.XmlFragment; binding: { mapping: Map<unknown, unknown> } } | undefined;
  return s?.binding ? s : null;
}

export function anchorFromSelection(editor: Editor): { anchor: CommentAnchor; quote: string } | null {
  const { state } = editor;
  const { from, to, empty } = state.selection;
  const b = binding(state);
  if (empty || !b) return null;
  const rel = (pos: number) => Y.relativePositionToJSON(absolutePositionToRelativePosition(pos, b.type, b.binding.mapping as never));
  return { anchor: { from: rel(from), to: rel(to) }, quote: state.doc.textBetween(from, to, ' ').slice(0, 500) };
}

export function resolveAnchor(state: EditorState, anchor: CommentAnchor | null): { from: number; to: number } | null {
  const b = binding(state);
  if (!anchor || !b) return null;
  try {
    const abs = (json: unknown) => relativePositionToAbsolutePosition(b.doc, b.type, Y.createRelativePositionFromJSON(json), b.binding.mapping as never);
    const from = abs(anchor.from);
    const to = abs(anchor.to);
    if (from === null || to === null || to <= from) return null;
    return { from, to };
  } catch {
    return null;
  }
}

const key = new PluginKey<DecorationSet>('mo-comment-anchors');

export interface CommentAnchorsOptions {
  getThreads: () => CommentThread[];
  getActive: () => string | null;
  onSelect: (threadId: string) => void;
}

function build(state: EditorState, opts: CommentAnchorsOptions) {
  const active = opts.getActive();
  const decos: Decoration[] = [];
  for (const t of opts.getThreads()) {
    if (t.resolvedAt) continue;
    const range = resolveAnchor(state, t.anchor);
    if (range) decos.push(Decoration.inline(range.from, range.to, { class: `mo-comment${t.id === active ? ' active' : ''}`, 'data-comment-id': t.id }));
  }
  return DecorationSet.create(state.doc, decos);
}

export const CommentAnchors = Extension.create<CommentAnchorsOptions>({
  name: 'commentAnchors',
  addOptions() {
    return { getThreads: () => [], getActive: () => null, onSelect: () => undefined };
  },
  addProseMirrorPlugins() {
    const opts = this.options;
    return [
      new Plugin<DecorationSet>({
        key,
        state: {
          init: () => DecorationSet.empty,
          // Rebuild when content changes (positions move) or when threads change (meta).
          apply: (tr, old, _o, next) => (tr.docChanged || tr.getMeta(key) ? build(next, opts) : old),
        },
        props: {
          decorations: (state) => key.getState(state),
          handleClick: (view, pos, event) => {
            const el = (event.target as HTMLElement).closest('[data-comment-id]');
            if (el) opts.onSelect(el.getAttribute('data-comment-id')!);
            return false;
          },
        },
      }),
    ];
  },
});

/** Ask the plugin to re-resolve anchors (after comments load or the active thread changes). */
export function refreshAnchors(editor: Editor | null) {
  if (editor && !editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta(key, true));
}
