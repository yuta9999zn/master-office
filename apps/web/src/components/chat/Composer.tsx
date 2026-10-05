'use client';

import type { ChatAttachment, UserSummary } from '@workos/shared';
import { AtSign, Bold, Code, FolderOpen, Italic, Loader2, Plus, SendHorizontal, Upload, X } from 'lucide-react';
import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { toast } from 'sonner';
import { attachmentOf, textToTokens, tokensToText, uploadForChat } from '@/lib/chat';
import { Avatar, cn, FileIcon, Menu, MenuContent, MenuItem, MenuTrigger } from '../ui/primitives';
import { ResourcePickerDialog } from './attachments';
import { EmojiPicker } from './bits';

export interface ComposerHandle {
  /** Files dropped anywhere on the conversation are uploaded into the composer. */
  addFiles: (files: File[]) => void;
}

interface ComposerProps {
  placeholder: string;
  /** People offered after "@" — members of the conversation first. */
  candidates: UserSummary[];
  people: Map<string, UserSummary>;
  /** Text (with <@id> mention tokens) and the files to send. */
  /** `uploadsOnly`: every file was just uploaded into the conversation's folder, so its members can open them. */
  onSubmit: (body: string, files: ChatAttachment[], opts: { uploadsOnly: boolean }) => void | Promise<unknown>;
  onTyping?: () => void;
  onEditLast?: () => void;
  onCancel?: () => void;
  /** Stored text when editing a message. */
  initial?: string;
  compact?: boolean;
  autoFocus?: boolean;
  testId?: string;
  /** Attach files from the computer or from Drive. */
  allowFiles?: boolean;
  /** Where uploads go (the conversation's folder). */
  conversationId?: string;
}

type Item = { key: string; name: string; status: 'uploading' | 'ready'; att?: ChatAttachment; uploaded?: boolean };

/**
 * Message input: Enter sends, Shift+Enter breaks the line, "@" suggests people (stored as <@id> tokens),
 * ↑ in an empty box edits your last message, Esc cancels an edit. Files: "+" (upload / Drive), paste or drop.
 */
export const Composer = forwardRef<ComposerHandle, ComposerProps>(function Composer(
  { placeholder, candidates, people, onSubmit, onTyping, onEditLast, onCancel, initial, compact, autoFocus, testId = 'composer', allowFiles, conversationId },
  handle,
) {
  const start = useRef(initial !== undefined ? tokensToText(initial, people) : { text: '', names: new Map<string, string>() });
  const [text, setText] = useState(start.current.text);
  const names = useRef(start.current.names);
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [mention, setMention] = useState<{ q: string; at: number } | null>(null);
  const [pick, setPick] = useState(0);
  const [items, setItems] = useState<Item[]>([]);
  const [picking, setPicking] = useState(false);
  const [dragging, setDragging] = useState(false);
  const lastTyping = useRef(0);

  const addFiles = (files: File[]) => {
    if (!allowFiles || !conversationId || !files.length) return;
    const batch: Item[] = files.map((f) => ({ key: Math.random().toString(36).slice(2), name: f.name || 'Pasted file', status: 'uploading', uploaded: true }));
    setItems((cur) => [...cur, ...batch]);
    uploadForChat(conversationId, files).then(
      (created) => {
        ref.current?.focus();
        setItems((cur) =>
          cur.map((it) => {
            const i = batch.findIndex((b) => b.key === it.key);
            return i < 0 ? it : { ...it, status: 'ready', att: attachmentOf(created[i]) };
          }),
        );
      },
      (e: Error) => {
        toast.error(e.message);
        setItems((cur) => cur.filter((it) => !batch.some((b) => b.key === it.key)));
      },
    );
  };
  useImperativeHandle(handle, () => ({ addFiles }));

  // Where the caret goes after a programmatic edit — applied in the same commit as the new text, so keys typed
  // right after picking a mention land after it (a frame later would be too late for fast typists).
  const nextCaret = useRef<[number, number] | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
    if (nextCaret.current) {
      el.focus();
      el.setSelectionRange(...nextCaret.current);
      nextCaret.current = null;
    }
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
    nextCaret.current = [pos, pos];
  };

  const insertAtCaret = (s: string) => {
    const el = ref.current;
    if (!el) return setText((t) => t + s);
    const a = el.selectionStart;
    const b = el.selectionEnd;
    const next = text.slice(0, a) + s + text.slice(b);
    setText(next);
    nextCaret.current = [a + s.length, a + s.length];
    detect(next, a + s.length);
  };

  const wrap = (mark: string) => {
    const el = ref.current;
    if (!el) return;
    const a = el.selectionStart;
    const b = el.selectionEnd;
    const next = text.slice(0, a) + mark + text.slice(a, b) + mark + text.slice(b);
    setText(next);
    nextCaret.current = [a + mark.length, b + mark.length];
  };

  const uploading = items.some((i) => i.status === 'uploading');
  const files = items.filter((i) => i.att).map((i) => i.att!);
  const canSend = !uploading && (!!text.trim() || !!files.length);

  const submit = () => {
    if (!canSend) return;
    const body = textToTokens(text, names.current).trim();
    void onSubmit(body, files, { uploadsOnly: items.length > 0 && items.every((i) => i.uploaded) });
    if (initial === undefined) {
      setText('');
      setItems([]);
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
    } else if (e.key === 'ArrowUp' && !text && !items.length && onEditLast) {
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
    <div
      className={cn(
        'relative rounded-xl border border-line-strong bg-surface focus-within:border-brand-500 focus-within:ring-3 focus-within:ring-brand-100',
        compact && 'rounded-lg',
        dragging && 'border-brand-500 ring-3 ring-brand-100',
      )}
      onDragOver={(e) => {
        if (allowFiles && e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        if (!allowFiles || !e.dataTransfer.files.length) return;
        e.preventDefault();
        e.stopPropagation();
        setDragging(false);
        addFiles([...e.dataTransfer.files]);
      }}
    >
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
      {!!items.length && (
        <div className="flex flex-wrap gap-2 px-3 pt-3" data-testid="composer-files">
          {items.map((it) => (
            <span key={it.key} className="flex max-w-[260px] items-center gap-2 rounded-lg border border-line bg-canvas py-1.5 pl-2 pr-1 text-[12.5px]" data-testid="composer-file" data-status={it.status}>
              {it.status === 'uploading' || !it.att?.type ? <Loader2 size={16} className="animate-spin text-muted" /> : <FileIcon r={{ type: it.att.type, mimeType: it.att.mimeType, metadata: it.att.metadata ?? {} }} size={18} />}
              <span className="min-w-0 flex-1 truncate text-ink-2">{it.name}</span>
              <button onClick={() => setItems((cur) => cur.filter((x) => x.key !== it.key))} className="rounded p-0.5 text-muted hover:bg-hover" aria-label={`Remove ${it.name}`}>
                <X size={13} />
              </button>
            </span>
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
        onPaste={(e) => {
          if (allowFiles && e.clipboardData.files.length) {
            e.preventDefault();
            addFiles([...e.clipboardData.files]);
          }
        }}
        onKeyDown={onKeyDown}
        onClick={(e) => detect(text, e.currentTarget.selectionStart)}
        className={cn('block w-full resize-none bg-transparent px-3.5 pt-3 text-[14px] leading-[1.45] text-ink outline-none placeholder:text-subtle', compact ? 'pb-1 pt-2' : 'pb-1.5')}
      />
      <div className="flex items-center gap-0.5 px-2 pb-1.5">
        {allowFiles && (
          <>
            <Menu>
              <MenuTrigger asChild>
                <button className="inline-flex size-8 items-center justify-center rounded-lg text-muted hover:bg-hover hover:text-ink" aria-label="Attach">
                  <Plus size={18} />
                </button>
              </MenuTrigger>
              <MenuContent align="start" side="top">
                <MenuItem icon={<Upload />} onSelect={() => fileInput.current?.click()}>
                  Upload from computer
                </MenuItem>
                <MenuItem icon={<FolderOpen />} onSelect={() => setPicking(true)}>
                  Share from Drive
                </MenuItem>
              </MenuContent>
            </Menu>
            <input
              ref={fileInput}
              type="file"
              multiple
              hidden
              data-testid="composer-upload"
              onChange={(e) => {
                addFiles([...(e.target.files ?? [])]);
                e.target.value = '';
              }}
            />
            <ResourcePickerDialog
              open={picking}
              onOpenChange={setPicking}
              onPick={(atts) => {
                setItems((cur) => [...cur, ...atts.filter((a) => !cur.some((c) => c.att?.id === a.id)).map((a) => ({ key: a.id, name: a.name ?? 'File', status: 'ready' as const, att: a }))]);
                // The dialog hands focus back to the + button; the next keystroke belongs in the message.
                setTimeout(() => ref.current?.focus(), 60);
              }}
            />
          </>
        )}
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
          disabled={!canSend}
          aria-label={initial !== undefined ? 'Save' : 'Send'}
          className="inline-flex h-8 items-center gap-1 rounded-lg bg-brand-600 px-2.5 text-[13px] font-medium text-white hover:bg-brand-700 disabled:bg-slate-200 disabled:text-slate-400"
        >
          {initial !== undefined ? 'Save' : <SendHorizontal size={16} />}
        </button>
      </div>
    </div>
  );
});

function ToolButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={onClick} aria-label={label} title={label} className="inline-flex size-8 items-center justify-center rounded-lg text-muted hover:bg-hover hover:text-ink">
      {children}
    </button>
  );
}
