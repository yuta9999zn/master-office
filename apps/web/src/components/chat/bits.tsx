'use client';

import type { ConversationSummary, UserSummary } from '@workos/shared';
import { Hash, Lock, SmilePlus } from 'lucide-react';
import { Popover } from 'radix-ui';
import { Fragment, useState, type ReactNode } from 'react';
import { useIsOnline } from '@/lib/realtime';
import { Avatar, cn } from '../ui/primitives';

/** Avatar of a conversation: the person for a DM (with an online dot), stacked faces for a group, a tile for a channel. */
export function ConversationAvatar({ c, size = 40 }: { c: Pick<ConversationSummary, 'kind' | 'peer' | 'faces' | 'color' | 'title' | 'visibility'>; size?: number }) {
  const online = useIsOnline(c.peer?.id);
  if (c.kind === 'dm' && c.peer)
    return (
      <span className="relative inline-flex shrink-0">
        <Avatar user={c.peer} size={size} />
        {online && <span className="absolute bottom-0 right-0 rounded-full border-2 border-white bg-emerald-500" style={{ width: size * 0.3, height: size * 0.3 }} data-testid="online-dot" />}
      </span>
    );
  if (c.kind === 'group') {
    const [a, b] = c.faces;
    if (!a) return <span className="inline-flex shrink-0 rounded-full bg-hover" style={{ width: size, height: size }} />;
    return (
      <span className="relative inline-flex shrink-0" style={{ width: size, height: size }}>
        <Avatar user={a} size={size * 0.68} className="absolute left-0 top-0" />
        {b && <Avatar user={b} size={size * 0.68} ring className="absolute bottom-0 right-0" />}
      </span>
    );
  }
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-xl font-bold text-white"
      style={{ width: size, height: size, fontSize: size * 0.42, background: `linear-gradient(145deg, ${c.color ?? '#2563eb'}bb, ${c.color ?? '#2563eb'})` }}
    >
      {c.title.trim()[0]?.toUpperCase() ?? '#'}
    </span>
  );
}

export function ChannelGlyph({ visibility, size = 14 }: { visibility: 'public' | 'private'; size?: number }) {
  return visibility === 'private' ? <Lock size={size} className="text-subtle" /> : <Hash size={size} className="text-subtle" />;
}

// ── Message text ─────────────────────────────────────────────────────────────

const INLINE = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(~~[^~\n]+~~)|(\*[^*\s][^*\n]*\*|(?<![\w])_[^_\s][^_\n]*_(?![\w]))|(<@[0-9a-f-]{36}>)|(https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"])/gi;

function inline(text: string, people: Map<string, UserSummary>, me: string | undefined, key = 'i'): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let n = 0;
  for (const m of text.matchAll(INLINE)) {
    const at = m.index!;
    if (at > last) out.push(text.slice(last, at));
    const k = `${key}-${n++}`;
    const [all, code, bold, strike, italic, mention, url] = m;
    if (code) out.push(<code key={k} className="rounded bg-black/[0.06] px-1 py-px font-mono text-[0.9em]">{code.slice(1, -1)}</code>);
    else if (bold) out.push(<strong key={k} className="font-semibold">{inline(bold.slice(2, -2), people, me, k)}</strong>);
    else if (strike) out.push(<s key={k}>{inline(strike.slice(2, -2), people, me, k)}</s>);
    else if (italic) out.push(<em key={k}>{inline(italic.slice(1, -1), people, me, k)}</em>);
    else if (mention) {
      const id = mention.slice(2, -1);
      const u = people.get(id);
      out.push(
        <span key={k} className={cn('rounded px-0.5 font-medium', id === me ? 'bg-amber-100 text-amber-800' : 'text-brand-600')} data-mention={id}>
          @{u?.name ?? 'unknown'}
        </span>,
      );
    } else if (url)
      out.push(
        <a key={k} href={url} target="_blank" rel="noreferrer" className="text-brand-600 underline underline-offset-2 [overflow-wrap:anywhere]">
          {url}
        </a>,
      );
    else out.push(all);
    last = at + all.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Light Markdown (bold, italic, strike, `code`, ``` blocks, links) and @mentions — rendered as React nodes, never HTML. */
export function MessageText({ body, people, me }: { body: string; people: Map<string, UserSummary>; me?: string }) {
  const parts = body.split(/```/);
  return (
    <>
      {parts.map((part, i) =>
        i % 2 ? (
          <pre key={i} className="my-1 overflow-x-auto rounded-lg bg-slate-900 px-3 py-2 font-mono text-[12.5px] leading-relaxed text-slate-100">
            {part.replace(/^\w*\n/, '').replace(/\n$/, '')}
          </pre>
        ) : (
          <Fragment key={i}>
            {part.split('\n').map((line, j, lines) => (
              <Fragment key={j}>
                {inline(line, people, me, `${i}-${j}`)}
                {j < lines.length - 1 && <br />}
              </Fragment>
            ))}
          </Fragment>
        ),
      )}
    </>
  );
}

// ── Emoji ────────────────────────────────────────────────────────────────────

export const QUICK_REACTIONS = ['👍', '❤️', '😂', '🎉', '🙏', '👀'];
const EMOJI = [
  '😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😂', '🙂', '😉', '😊', '😇', '🥰', '😍', '🤩', '😘', '😋', '😜', '🤔', '🤗',
  '🤭', '🤫', '😐', '😶', '🙄', '😏', '😬', '😌', '😴', '😷', '🤒', '🥳', '😎', '🤓', '😕', '😟', '😮', '😲', '🥺', '😢',
  '😭', '😱', '😤', '😡', '👍', '👎', '👏', '🙌', '👐', '🤝', '🙏', '💪', '👀', '👋', '✌️', '🤞', '👌', '👉', '☝️', '✋',
  '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '💯', '💥', '✨', '🔥', '⭐', '🌟', '🎉', '🎊', '🎁', '🏆', '🚀', '✅', '❌',
  '⚠️', '❓', '❗', '💡', '📌', '📎', '📅', '📈', '📉', '📝', '📣', '☕', '🍵', '🍰', '🌸', '🌈', '☀️', '🌙', '⏰', '🎯',
];

export function EmojiPicker({ onPick, trigger, side = 'top', align = 'end' }: { onPick: (e: string) => void; trigger?: ReactNode; side?: 'top' | 'bottom'; align?: 'start' | 'end' }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        {trigger ?? (
          <button className="inline-flex size-8 items-center justify-center rounded-lg text-muted hover:bg-hover hover:text-ink" aria-label="Add emoji">
            <SmilePlus size={17} />
          </button>
        )}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content side={side} align={align} sideOffset={6} className="pop z-50 w-[296px] p-2 animate-pop" data-testid="emoji-picker" onOpenAutoFocus={(e) => e.preventDefault()}>
          <div className="grid grid-cols-10 gap-0.5">
            {EMOJI.map((e) => (
              <button
                key={e}
                className="flex size-7 items-center justify-center rounded-md text-[18px] hover:bg-hover"
                onClick={() => {
                  onPick(e);
                  setOpen(false);
                }}
                aria-label={e}
              >
                {e}
              </button>
            ))}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
