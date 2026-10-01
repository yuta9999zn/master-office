'use client';

import type { Editor } from '@tiptap/react';
import { useEditorState } from '@tiptap/react';
import { CaseSensitive, ChevronDown, ChevronUp, WholeWord, X } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button, cn, Tip } from '../ui/primitives';
import { searchState } from './search';

/** Word-style Find & Replace bar docked over the page. */
export function FindBar({ editor, withReplace, canEdit, suggesting, onClose }: { editor: Editor; withReplace: boolean; canEdit: boolean; suggesting: boolean; onClose: () => void }) {
  const [query, setQuery] = useState(() => editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to, ' ').slice(0, 100));
  const [replace, setReplace] = useState('');
  const [caseSensitive, setCase] = useState(false);
  const [wholeWord, setWhole] = useState(false);
  const [showReplace, setShowReplace] = useState(withReplace);
  const input = useRef<HTMLInputElement>(null);
  const s = useEditorState({ editor, selector: ({ editor: e }) => ({ count: searchState(e.state)?.matches.length ?? 0, index: searchState(e.state)?.index ?? -1 }) }) ?? { count: 0, index: -1 };

  useEffect(() => setShowReplace(withReplace), [withReplace]);
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, [withReplace]);
  useEffect(() => {
    editor.commands.setSearch({ query, caseSensitive, wholeWord });
  }, [editor, query, caseSensitive, wholeWord]);
  useEffect(() => () => void editor.commands.setSearch({ query: '' }), [editor]);

  const replaceAll = () => {
    if (!suggesting) return editor.commands.replaceAll(replace);
    // In suggesting mode each replacement must be its own tracked change.
    let guard = 1000;
    while (guard-- > 0 && (searchState(editor.state)?.matches.length ?? 0) > 0) {
      editor.commands.findNext();
      if (!editor.commands.replaceCurrent(replace)) break;
    }
  };

  const Toggle = ({ on, set, label, icon }: { on: boolean; set: (v: boolean) => void; label: string; icon: ReactNode }) => (
    <Tip label={label}>
      <button aria-label={label} aria-pressed={on} onClick={() => set(!on)} className={cn('flex size-7 items-center justify-center rounded-md text-muted hover:bg-hover', on && 'bg-selected text-brand-600')}>
        {icon}
      </button>
    </Tip>
  );

  return (
    <div className="absolute right-4 top-2 z-20 w-[420px] rounded-xl border border-line bg-surface p-2.5 shadow-[var(--shadow-pop)]" role="search" data-testid="find-bar">
      <div className="flex items-center gap-1.5">
        <button onClick={() => setShowReplace(!showReplace)} disabled={!canEdit} className="rounded p-1 text-muted hover:bg-hover disabled:opacity-30" aria-label="Toggle replace">
          <ChevronDown size={15} className={cn('transition-transform', !showReplace && '-rotate-90')} />
        </button>
        <input
          ref={input}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.shiftKey ? editor.commands.findPrevious : editor.commands.findNext)();
            if (e.key === 'Escape') onClose();
          }}
          placeholder="Find in document"
          aria-label="Find"
          className="input h-8 flex-1"
        />
        <span className="w-14 text-center text-[12px] text-muted" data-testid="find-count">
          {query ? (s.count ? `${s.index + 1}/${s.count}` : 'No results') : ''}
        </span>
        <Toggle on={caseSensitive} set={setCase} label="Match case" icon={<CaseSensitive size={16} />} />
        <Toggle on={wholeWord} set={setWhole} label="Whole words" icon={<WholeWord size={16} />} />
        <button onClick={() => editor.commands.findPrevious()} className="rounded p-1 text-muted hover:bg-hover" aria-label="Previous match">
          <ChevronUp size={16} />
        </button>
        <button onClick={() => editor.commands.findNext()} className="rounded p-1 text-muted hover:bg-hover" aria-label="Next match">
          <ChevronDown size={16} />
        </button>
        <button onClick={onClose} className="rounded p-1 text-muted hover:bg-hover" aria-label="Close find">
          <X size={16} />
        </button>
      </div>
      {showReplace && canEdit && (
        <div className="mt-2 flex items-center gap-1.5 pl-8">
          <input value={replace} onChange={(e) => setReplace(e.target.value)} placeholder="Replace with" aria-label="Replace with" className="input h-8 flex-1" />
          <Button size="sm" disabled={!s.count} onClick={() => editor.commands.replaceCurrent(replace) && editor.commands.findNext()}>
            Replace
          </Button>
          <Button size="sm" disabled={!s.count} onClick={replaceAll}>
            Replace all
          </Button>
        </div>
      )}
    </div>
  );
}
