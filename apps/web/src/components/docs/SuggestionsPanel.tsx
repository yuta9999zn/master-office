'use client';

import type { Editor } from '@tiptap/react';
import { useEditorState } from '@tiptap/react';
import { Check, GitPullRequestArrow, X } from 'lucide-react';
import { formatShort } from '@/lib/format';
import { Avatar, Button, EmptyState } from '../ui/primitives';
import { collectSuggestions } from './suggestions';

/** Review panel for suggestions (Word: Review → Accept / Reject). */
export function SuggestionsPanel({ editor, canEdit }: { editor: Editor; canEdit: boolean }) {
  const items =
    useEditorState({ editor, selector: ({ editor: e }) => collectSuggestions(e.state.doc), equalityFn: (a, b) => JSON.stringify(a) === JSON.stringify(b) }) ?? [];
  return (
    <div className="flex h-full flex-col">
      {canEdit && items.length > 0 && (
        <div className="flex gap-2 border-b border-line px-4 py-2.5">
          <Button size="sm" variant="soft" icon={<Check size={14} />} onClick={() => editor.commands.acceptSuggestion()}>
            Accept all
          </Button>
          <Button size="sm" icon={<X size={14} />} onClick={() => editor.commands.rejectSuggestion()}>
            Reject all
          </Button>
        </div>
      )}
      <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto p-4" data-testid="suggestions">
        {!items.length && (
          <EmptyState icon={<GitPullRequestArrow size={28} />} title="No suggestions">
            Switch the mode to <b>Suggesting</b> in the toolbar — your edits become suggestions others can accept or reject.
          </EmptyState>
        )}
        {items.map((s) => (
          <div
            key={s.id}
            onClick={() => editor.chain().setTextSelection({ from: s.from, to: s.to }).scrollIntoView().run()}
            className="cursor-pointer rounded-xl border border-line bg-surface p-3 hover:border-line-strong"
          >
            <div className="flex items-center gap-2">
              <Avatar user={{ name: s.authorName, avatarColor: s.color }} size={24} />
              <span className="text-[13px] font-semibold text-ink">{s.authorName.split(' ')[0]}</span>
              <span className="text-[11px] text-subtle">{formatShort(s.at)}</span>
            </div>
            <div className="mt-2 space-y-1 text-[13px]">
              {s.deleted && (
                <div>
                  <span className="text-muted">Delete: </span>
                  <del className="text-red-600">{s.deleted.slice(0, 160)}</del>
                </div>
              )}
              {s.inserted && (
                <div>
                  <span className="text-muted">{s.deleted ? 'Replace with: ' : 'Add: '}</span>
                  <ins className="text-emerald-700">{s.inserted.slice(0, 160)}</ins>
                </div>
              )}
            </div>
            {canEdit && (
              <div className="mt-2.5 flex justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
                <Button size="sm" variant="ghost" icon={<X size={14} />} onClick={() => editor.commands.rejectSuggestion(s.id)} aria-label="Reject suggestion">
                  Reject
                </Button>
                <Button size="sm" variant="soft" icon={<Check size={14} />} onClick={() => editor.commands.acceptSuggestion(s.id)} aria-label="Accept suggestion">
                  Accept
                </Button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
