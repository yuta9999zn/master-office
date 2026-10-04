'use client';

import Collaboration from '@tiptap/extension-collaboration';
import Highlight from '@tiptap/extension-highlight';
import TextAlign from '@tiptap/extension-text-align';
import { TextStyleKit } from '@tiptap/extension-text-style';
import { Placeholder } from '@tiptap/extensions';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { textBoxCss, type PlainElement, type Theme } from '@workos/slide-model';
import { useEffect } from 'react';
import type * as Y from 'yjs';
import { cssObject } from './SlideView';

/** The rich-text schema of text boxes and shapes (a subset of Docs: paragraphs, lists, inline formatting). */
export function slideTextExtensions() {
  return [
    StarterKit.configure({
      heading: false,
      blockquote: false,
      codeBlock: false,
      code: false,
      horizontalRule: false,
      undoRedo: false,
      dropcursor: false,
      gapcursor: false,
      trailingNode: false,
      link: { openOnClick: false, autolink: true, HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: '_blank' } },
    }),
    TextStyleKit,
    Highlight.configure({ multicolor: true }),
    TextAlign.configure({ types: ['paragraph'] }),
  ];
}

/**
 * In-place editor for one text box / shape, bound to the element's Y.XmlFragment — typing is shared live with
 * everyone and undo (Ctrl+Z) is per person. Sits exactly over the element inside the scaled slide.
 */
export function TextEditor({
  el,
  frag,
  theme,
  placeholder,
  selectAll,
  onReady,
  onExit,
}: {
  el: PlainElement;
  frag: Y.XmlFragment;
  theme: Theme;
  placeholder?: string;
  selectAll?: boolean;
  onReady: (e: Editor | null) => void;
  onExit: () => void;
}) {
  const editor = useEditor(
    {
      immediatelyRender: false,
      extensions: [
        ...slideTextExtensions(),
        Collaboration.configure({ fragment: frag }),
        Placeholder.configure({ placeholder: placeholder ?? '', showOnlyWhenEditable: true }),
      ],
      editorProps: {
        attributes: { class: 'mo-text', 'data-testid': 'slide-text-editor', spellcheck: 'true' },
        handleKeyDown: (_v, e) => {
          if (e.key === 'Escape') {
            onExit();
            return true;
          }
          return false;
        },
      },
      onCreate: ({ editor: ed }) => {
        // Focus right away so the first keystrokes after the double-click are not lost; the shared content
        // renders a tick later (y-prosemirror), then the caret goes to the end (or everything is selected).
        ed.view.focus();
        setTimeout(() => {
          if (ed.isDestroyed) return;
          if (selectAll) ed.chain().selectAll().focus().run();
          else if (!ed.view.state.doc.textContent || ed.state.selection.from <= 1) ed.commands.focus('end');
        }, 0);
      },
    },
    [frag],
  );
  useEffect(() => {
    onReady(editor);
    return () => onReady(null);
  }, [editor]); // eslint-disable-line react-hooks/exhaustive-deps

  const s = el.style ?? {};
  return (
    <div
      className="mo-el"
      style={{ left: el.x, top: el.y, width: el.w, height: el.h, transform: el.rot ? `rotate(${el.rot}deg)` : undefined, zIndex: 5 }}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <div className="mo-box mo-editing" style={{ ...cssObject(textBoxCss(s, theme, el.ph)), cursor: 'text', overflow: 'visible' }} onMouseDown={(e) => e.target === e.currentTarget && (e.preventDefault(), editor?.commands.focus('end'))}>
        <div style={s.autofit === 'shrink' && s.fontScale && s.fontScale < 1 ? { zoom: s.fontScale } : undefined}>
          <EditorContent editor={editor} />
        </div>
      </div>
    </div>
  );
}
