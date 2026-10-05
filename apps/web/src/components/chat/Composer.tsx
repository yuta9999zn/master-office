'use client';

import type { UserSummary } from '@workos/shared';
import { AtSign, Bold, Code, Italic, SendHorizontal } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { textToTokens, tokensToText } from '@/lib/chat';
import { Avatar, cn } from '../ui/primitives';
import { EmojiPicker } from './bits';

/**
 * Message input: Enter sends, Shift+Enter breaks the line, "@" suggests people (stored as <@id> tokens),
 * ↑ in an empty box edits your last message, Esc cancels an edit.
 */
export function Composer({
  placeholder,
  candidates,
  people,
  onSubmit,
  onTyping,
  onEditLast,
  onCancel,
  initial,
  compact,
  autoFocus,
  testId = 'composer',
}: {
  placeholder: string;
  /** People offered after "@" — members of the conversation first. */
  candidates: UserSummary[];
  people: Map<string, UserSummary>;
  onSubmit: (body: string) => void | Promise<unknown>;
  onTyping?: () => void;
  onEditLast?: () => void;
  onCancel?: () => void;
  /** Stored text when editing a message. */
  initial?: string;
  compact?: boolean;
  autoFocus?: boolean;
  testId?: string;
}) {
  const start = useRef(initial !== undefined ? tokensToText(initial, people) : { text: '', names: new Map<string, string>() });
  const [text, setText] = useState(start.current.text);
  const names = useRef(start.current.names);
  const ref = useRef<HTMLTextAreaElement>(null);
  const [mention, setMention] = useState<{ q: string; at: number } | null>(null);
  const [pick, setPick] = useState(0);
  const lastTyping = useRef(0);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, [text]);
  useEffect(() => {
    if (autoFocus) {
      const el = ref.current;
      el?.focus();
      el?.setSelectionRange(el.value.length, el.value.length);
    }
  }, [autoFocus]);

  const matches = mention
    ? candidates.filter((u) => u.name.toLowerCase().includes(mention.q.toLowerCase()) || u.email.toLowerCase().startsWith(mention.q.toLowerCase())).slice(0, 6)
    : [];

  const detect = (value: string, caret: number) => {
    const before = value.slice(0, caret);
    const m = /(^|\s)@([^\s@]{0,30})$/.exec(before);
    setMention(m ? { q: m[2], at: caret - m[2].length - 1 } : null);
    setPick(0);
  };

  const insertMention = (u: UserSummary) => {
    if (!mention || !ref.current) return;
    const caret = ref.current.selectionStart;
    const next = `${text.slice(0, mention.at)}@${u.name} ${text.slice(caret)}`;
    names.current.set(u.name, u.id);
    setText(next);
    setMention(null);
    const pos = mention.at + u.name.length + 2;
    requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.setSelectionRange(pos, pos);
    });
  };

  const insertAtCaret = (s: string) => {
    const el = ref.current;
    if (!el) return setText((t) => t + s);
    const a = el.selectionStart;
    const b = el.selectionEnd;
    const next = text.slice(0, a) + s + text.slice(b);
    setText(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(a + s.length, a + s.length);
      detect(next, a + s.length);
    });
  };

  const wrap = (mark: string) => {
    const el = ref.current;
    if (!el) return;
    const a = el.selectionStart;
    const b = el.selectionEnd;
    const next = text.slice(0, a) + mark + text.slice(a, b) + mark + text.slice(b);
    setText(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(a + mark.length, b + mark.length);
    });
  };

  const submit = () => {
    const body = textToTokens(text, names.current).trim();
    if (!body) return;
    void onSubmit(body);
    if (initial === undefined) {
      setText('');
      names.current = new Map();
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (matches.length) {
      if (e.key === 'ArrowDown') return (e.preventDefault(), setPick((p) => (p + 1) % matches.length));
      if (e.key === 'ArrowUp') return (e.preventDefault(), setPick((p) => (p - 1 + matches.length) % matches.length));
      if (e.key === 'Enter' || e.key === 'Tab') return (e.preventDefault(), insertMention(matches[pick]));
      if (e.key === 'Escape') return (e.preventDefault(), setMention(null));
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    } else if (e.key === 'Escape' && onCancel) {
      e.preventDefault();
      onCancel();
    } else if (e.key === 'ArrowUp' && !text && onEditLast) {
      e.preventDefault();
      onEditLast();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
      e.preventDefault();
      wrap('**');
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'i') {
      e.preventDefault();
      wrap('_');
    }
  };

  return (
    <div className={cn('relative rounded-xl border border-line-strong bg-surface focus-within:border-brand-500 focus-within:ring-3 focus-within:ring-brand-100', compact && 'rounded-lg')}>
      {!!matches.length && (
        <div className="pop absolute bottom-full left-2 z-30 mb-1.5 w-72 p-1" role="listbox" data-testid="mention-list">
          {matches.map((u, i) => (
            <button
              key={u.id}
              role="option"
              aria-selected={i === pick}
              onMouseDown={(e) => (e.preventDefault(), insertMention(u))}
              onMouseEnter={() => setPick(i)}
              className={cn('flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left', i === pick && 'bg-hover')}
            >
              <Avatar user={u} size={24} />
              <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{u.name}</span>
              <span className="truncate text-[11px] text-subtle">{u.department}</span>
            </button>
          ))}
        </div>
      )}
      <textarea
        ref={ref}
        rows={1}
        value={text}
        placeholder={placeholder}
        aria-label={placeholder}
        data-testid={testId}
        onChange={(e) => {
          setText(e.target.value);
          detect(e.target.value, e.target.selectionStart);
          if (onTyping && e.target.value && Date.now() - lastTyping.current > 2500) {
            lastTyping.current = Date.now();
            onTyping();
          }
        }}
        onKeyDown={onKeyDown}
        onClick={(e) => detect(text, e.currentTarget.selectionStart)}
        className={cn('block w-full resize-none bg-transparent px-3.5 pt-3 text-[14px] leading-[1.45] text-ink outline-none placeholder:text-subtle', compact ? 'pb-1 pt-2' : 'pb-1.5')}
      />
      <div className="flex items-center gap-0.5 px-2 pb-1.5">
        <ToolButton label="Mention someone" onClick={() => insertAtCaret(text && !/\s$/.test(text) ? ' @' : '@')}>
          <AtSign size={16} />
        </ToolButton>
        {!compact && (
          <>
            <ToolButton label="Bold (Ctrl+B)" onClick={() => wrap('**')}>
              <Bold size={16} />
            </ToolButton>
            <ToolButton label="Italic (Ctrl+I)" onClick={() => wrap('_')}>
              <Italic size={16} />
            </ToolButton>
            <ToolButton label="Code" onClick={() => wrap('`')}>
              <Code size={16} />
            </ToolButton>
          </>
        )}
        <EmojiPicker onPick={insertAtCaret} align="start" />
        <span className="flex-1" />
        {onCancel && (
          <button onClick={onCancel} className="mr-1 rounded-md px-2 py-1 text-[12px] text-muted hover:bg-hover">
            Cancel
          </button>
        )}
        <button
          onClick={submit}
          disabled={!text.trim()}
          aria-label={initial !== undefined ? 'Save' : 'Send'}
          className="inline-flex h-8 items-center gap-1 rounded-lg bg-brand-600 px-2.5 text-[13px] font-medium text-white hover:bg-brand-700 disabled:bg-slate-200 disabled:text-slate-400"
        >
          {initial !== undefined ? 'Save' : <SendHorizontal size={16} />}
        </button>
      </div>
    </div>
  );
}

function ToolButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={onClick} aria-label={label} title={label} className="inline-flex size-8 items-center justify-center rounded-lg text-muted hover:bg-hover hover:text-ink">
      {children}
    </button>
  );
}
