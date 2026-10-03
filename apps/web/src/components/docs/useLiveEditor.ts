'use client';

import { Extension } from '@tiptap/core';
import Collaboration from '@tiptap/extension-collaboration';
import CollaborationCaret from '@tiptap/extension-collaboration-caret';
import { CharacterCount, Placeholder } from '@tiptap/extensions';
import { useEditor, type Editor } from '@tiptap/react';
import { COLLAB_FIELD } from '@workos/doc-model';
import type { CommentThread } from '@workos/shared';
import { useCallback, useRef, type MutableRefObject } from 'react';
import { toast } from 'sonner';
import { uploadFile } from '@/lib/api';
import { useUsers } from '@/lib/queries';
import { CommentAnchors } from './comment-anchors';
import { browserSchema, CollapsibleHeadings, PageLinks, SlashCommands } from './editor-kit';
import { mentionSuggestion } from './mentions';
import { SearchReplace } from './search';
import { SuggestChanges } from './suggestions';
import type { CollabSession } from './useCollab';

export interface LiveEditorOptions {
  resourceId: string;
  session: CollabSession;
  me: { id: string; name: string; avatarColor: string };
  canEdit: boolean;
  testId?: string;
  placeholder?: string;
  threadsRef: MutableRefObject<CommentThread[]>;
  activeRef: MutableRefObject<string | null>;
  onSelectComment: (id: string) => void;
  onLink: () => void;
  onComment: (editor: Editor) => void;
  onFind: (replace: boolean) => void;
  onImage: () => void;
  onEmbed: () => void;
}

/**
 * The collaborative editor used by Docs, Wiki and Notes: shared schema, Yjs binding, carets, comments,
 * suggesting mode, find & replace, slash menu, [[page links]], foldable headings and image upload.
 */
export function useLiveEditor(o: LiveEditorOptions) {
  // Handlers change every render; the editor is built once per session and reads the latest ones.
  const opts = useRef(o);
  opts.current = o;
  const { data: users } = useUsers();
  const usersRef = useRef(users ?? []);
  usersRef.current = users ?? [];

  const uploadImages = useCallback(async (ed: Editor, files: File[], at?: number) => {
    for (const file of files.filter((f) => f.type.startsWith('image/'))) {
      const fd = new FormData();
      fd.append('file', file);
      try {
        const { url } = await uploadFile<{ url: string }>(`/resources/${opts.current.resourceId}/assets`, fd);
        const chain = ed.chain().focus();
        (at !== undefined ? chain.insertContentAt(at, { type: 'image', attrs: { src: url, alt: file.name } }) : chain.setImage({ src: url, alt: file.name })).run();
      } catch (e) {
        toast.error((e as Error).message);
      }
    }
  }, []);

  const { session, me, canEdit } = o;
  const editorRef = useRef<Editor | null>(null);
  const editor = useEditor(
    {
      immediatelyRender: false,
      editable: canEdit,
      extensions: [
        ...browserSchema({ collaboration: true, mention: mentionSuggestion(() => usersRef.current) }),
        Collaboration.configure({ document: session.doc, field: COLLAB_FIELD }),
        CollaborationCaret.configure({ provider: session.provider, user: { id: me.id, name: me.name, color: me.avatarColor } }),
        Placeholder.configure({ placeholder: canEdit ? o.placeholder ?? 'Start writing… type / for blocks, @ to mention, [[ to link a page' : '' }),
        CharacterCount,
        SearchReplace,
        PageLinks,
        CollapsibleHeadings,
        ...(canEdit ? [SlashCommands.configure({ handlers: { image: () => opts.current.onImage(), embed: () => opts.current.onEmbed(), linkTo: () => opts.current.onLink() } })] : []),
        SuggestChanges.configure({ user: { id: me.id, name: me.name, color: me.avatarColor } }),
        CommentAnchors.configure({
          getThreads: () => opts.current.threadsRef.current,
          getActive: () => opts.current.activeRef.current,
          onSelect: (id) => opts.current.onSelectComment(id),
        }),
        Extension.create({
          name: 'moShortcuts',
          addKeyboardShortcuts: () => ({
            'Mod-k': () => (opts.current.onLink(), true),
            'Mod-Alt-m': ({ editor: ed }) => (opts.current.onComment(ed as Editor), true),
            'Mod-f': () => (opts.current.onFind(false), true),
            'Mod-h': () => (opts.current.onFind(true), true),
          }),
        }),
      ],
      editorProps: {
        attributes: { class: 'mo-editor', 'data-testid': o.testId ?? 'doc-editor', spellcheck: 'true' },
        handlePaste: (_view, event) => {
          const files = [...(event.clipboardData?.files ?? [])];
          if (!files.some((f) => f.type.startsWith('image/')) || !opts.current.canEdit) return false;
          void uploadImages(editorRef.current!, files);
          return true;
        },
        handleDrop: (view, event) => {
          const files = [...((event as DragEvent).dataTransfer?.files ?? [])];
          if (!files.some((f) => f.type.startsWith('image/')) || !opts.current.canEdit) return false;
          const pos = view.posAtCoords({ left: (event as DragEvent).clientX, top: (event as DragEvent).clientY })?.pos;
          void uploadImages(editorRef.current!, files, pos);
          return true;
        },
      },
    },
    [session],
  );
  editorRef.current = editor;
  return { editor, uploadImages };
}
