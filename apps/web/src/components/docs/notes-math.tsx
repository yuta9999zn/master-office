'use client';

import 'katex/dist/katex.min.css';
import { Extension, type Editor } from '@tiptap/core';
import { NodeViewWrapper, ReactNodeViewRenderer, useEditorState, type ReactNodeViewProps } from '@tiptap/react';
import { Equation, EQUATION_SNIPPETS, equationHtml, Footnote } from '@workos/doc-model';
import { Popover } from 'radix-ui';
import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { cn } from '../ui/primitives';

const FOCUS_EVENT = 'mo-footnote-focus';

/** Inserts a footnote at the cursor and moves the typing to its note (like Google Docs). */
export function insertFootnote(editor: Editor) {
  const before = (() => {
    let n = 0;
    editor.state.doc.nodesBetween(0, editor.state.selection.from, (node) => {
      if (node.type.name === 'footnote') n++;
    });
    return n;
  })();
  // Render the footnote list right away so the note can take the very next keystroke.
  flushSync(() => {
    editor.chain().focus().insertContent({ type: 'footnote', attrs: { text: '' } }).run();
  });
  const el = document.querySelectorAll<HTMLTextAreaElement>('[data-testid="footnote-text"]')[before];
  if (el) el.focus();
  else window.dispatchEvent(new CustomEvent(FOCUS_EVENT, { detail: before }));
}

function FootnoteView({ editor, getPos }: ReactNodeViewProps) {
  return (
    <NodeViewWrapper as="sup" className="mo-fn-ref" data-testid="footnote-ref">
      <button
        contentEditable={false}
        className="absolute inset-0"
        aria-label="Go to footnote"
        onClick={() => {
          let index = 0;
          const pos = typeof getPos === 'function' ? getPos() : 0;
          editor.state.doc.nodesBetween(0, pos ?? 0, (n) => {
            if (n.type.name === 'footnote') index++;
          });
          window.dispatchEvent(new CustomEvent(FOCUS_EVENT, { detail: index }));
        }}
      />
    </NodeViewWrapper>
  );
}

/** The document's footnotes, below the text; each note is edited in place. */
export function FootnotesList({ editor }: { editor: Editor }) {
  const notes = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      const out: { pos: number; text: string }[] = [];
      e.state.doc.descendants((n, pos) => {
        if (n.type.name === 'footnote') out.push({ pos, text: String(n.attrs.text ?? '') });
      });
      return out;
    },
    equalityFn: (a, b) => JSON.stringify(a) === JSON.stringify(b),
  });
  const refs = useRef<(HTMLTextAreaElement | null)[]>([]);
  useEffect(() => {
    const onFocus = (e: Event) => {
      const el = refs.current[(e as CustomEvent<number>).detail];
      if (!el) return;
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      el.focus();
    };
    window.addEventListener(FOCUS_EVENT, onFocus);
    return () => window.removeEventListener(FOCUS_EVENT, onFocus);
  }, []);
  if (!notes?.length) return null;
  const set = (pos: number, text: string) => {
    const node = editor.state.doc.nodeAt(pos);
    if (node?.type.name === 'footnote') editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, text }));
  };
  return (
    <section className="mt-12 border-t border-line pt-3 text-[13px] text-ink-2" data-testid="footnotes">
      <ol className="list-decimal space-y-1 pl-5">
        {notes.map((n, i) => (
          <li key={n.pos} className="pl-1">
            <textarea
              ref={(el) => {
                refs.current[i] = el;
              }}
              value={n.text}
              readOnly={!editor.isEditable}
              onChange={(e) => set(n.pos, e.target.value)}
              placeholder="Footnote text"
              rows={1}
              className="block w-full resize-none bg-transparent leading-relaxed outline-none placeholder:text-subtle focus:bg-brand-50/40"
              style={{ fieldSizing: 'content' } as React.CSSProperties}
              aria-label={`Footnote ${i + 1}`}
              data-testid="footnote-text"
            />
          </li>
        ))}
      </ol>
    </section>
  );
}

function EquationView({ node, updateAttributes, deleteNode, editor, selected }: ReactNodeViewProps) {
  const latex = String(node.attrs.latex ?? '');
  const [open, setOpen] = useState(!latex && editor.isEditable);
  const [draft, setDraft] = useState(latex);
  const area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => setDraft(latex), [latex]);
  const commit = (v = draft) => {
    if (v.trim()) updateAttributes({ latex: v });
    else deleteNode();
  };
  const insert = (snippet: string) => {
    const el = area.current;
    const start = el?.selectionStart ?? draft.length;
    const end = el?.selectionEnd ?? draft.length;
    const next = draft.slice(0, start) + snippet + draft.slice(end);
    setDraft(next);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + snippet.length, start + snippet.length);
    });
  };
  const rendered = (
    <span
      contentEditable={false}
      className={cn('mo-equation-view inline-block cursor-pointer rounded px-0.5', selected && 'bg-brand-50 ring-1 ring-brand-300', !latex && 'text-subtle')}
      dangerouslySetInnerHTML={{ __html: latex ? equationHtml(latex) : 'Equation' }}
      data-testid="equation"
    />
  );
  if (!editor.isEditable) return <NodeViewWrapper as="span">{rendered}</NodeViewWrapper>;
  return (
    <NodeViewWrapper as="span">
      <Popover.Root
        open={open}
        onOpenChange={(o) => {
          if (!o) commit();
          setOpen(o);
        }}
      >
        <Popover.Trigger asChild>{rendered}</Popover.Trigger>
        <Popover.Portal>
          <Popover.Content align="start" sideOffset={6} className="pop z-50 w-[360px] space-y-2 p-3 animate-pop" onCloseAutoFocus={(e) => e.preventDefault()}>
            <div className="flex flex-wrap gap-1">
              {EQUATION_SNIPPETS.map((s) => (
                <button key={s.label} onClick={() => insert(s.latex)} className="h-7 min-w-7 rounded border border-line px-1.5 text-[13px] hover:bg-hover" title={s.latex}>
                  {s.label}
                </button>
              ))}
            </div>
            <textarea
              ref={area}
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  commit();
                  setOpen(false);
                }
              }}
              placeholder="LaTeX, e.g. E = mc^2"
              className="input h-16 w-full resize-none font-mono text-[13px]"
              aria-label="Equation (LaTeX)"
            />
            <div className="min-h-10 overflow-x-auto rounded-md bg-hover px-2 py-1.5 text-center" dangerouslySetInnerHTML={{ __html: draft.trim() ? equationHtml(draft) : '<span style="color:#94a3b8">Preview</span>' }} />
            <div className="flex justify-end gap-2">
              <button onClick={() => (deleteNode(), setOpen(false))} className="rounded-md px-2 py-1 text-[12px] text-muted hover:bg-hover">
                Remove
              </button>
              <button onClick={() => (commit(), setOpen(false))} className="rounded-md bg-brand-600 px-3 py-1 text-[12px] font-medium text-white hover:bg-brand-700" data-testid="equation-done">
                Done
              </button>
            </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </NodeViewWrapper>
  );
}

export const FootnoteWithView = Footnote.extend({ addNodeView: () => ReactNodeViewRenderer(FootnoteView) });
export const EquationWithView = Equation.extend({ addNodeView: () => ReactNodeViewRenderer(EquationView) });

/** Ctrl+Alt+F inserts a footnote (Google Docs shortcut). */
export const FootnoteShortcut = Extension.create({
  name: 'footnoteShortcut',
  addKeyboardShortcuts() {
    return { 'Mod-Alt-f': ({ editor }) => (editor.isEditable ? (insertFootnote(editor as Editor), true) : false) };
  },
});
