'use client';

import type { ChatMessage, UserSummary } from '@workos/shared';
import { Copy, Ellipsis, MessageSquareText, Pencil, Pin, PinOff, SmilePlus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { useChatActions } from '@/lib/chat';
import { formatShort } from '@/lib/format';
import { Avatar, AvatarStack, cn, Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, Tip } from '../ui/primitives';
import { FileCard } from './attachments';
import { Composer } from './Composer';
import { EmojiPicker, MessageText, QUICK_REACTIONS } from './bits';

const timeFmt = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' });
const fullFmt = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });

export function SystemLine({ m, me }: { m: ChatMessage; me?: string }) {
  return (
    <div className="flex justify-center py-1.5" data-testid="system-message">
      <span className="rounded-full bg-hover px-3 py-1 text-[12px] text-muted">
        <span className="font-medium text-ink-2">{m.sender?.id === me ? 'You' : m.sender?.name ?? 'Someone'}</span> {m.body} · {timeFmt.format(new Date(m.createdAt))}
      </span>
    </div>
  );
}

export function MessageItem({
  m,
  me,
  people,
  candidates,
  grouped,
  canModerate,
  inThread,
  editing,
  setEditing,
  onOpenThread,
  readers,
  receipt,
  highlight,
}: {
  m: ChatMessage;
  me?: string;
  people: Map<string, UserSummary>;
  candidates: UserSummary[];
  /** Follows a message from the same person within a few minutes: no avatar or name. */
  grouped: boolean;
  canModerate: boolean;
  inThread?: boolean;
  editing: boolean;
  setEditing: (v: boolean) => void;
  onOpenThread?: (m: ChatMessage) => void;
  /** People whose read marker stops at this message. */
  readers?: UserSummary[];
  /** "Sent" / "Seen" under your latest message in a DM. */
  receipt?: string;
  highlight?: boolean;
}) {
  const { react, edit, remove, pin } = useChatActions();
  const [menuOpen, setMenuOpen] = useState(false);
  const mine = !!me && m.sender?.id === me;
  const pending = m.id.startsWith('tmp-');
  const deleted = !!m.deletedAt;
  const toggle = (emoji: string) => !pending && react.mutate({ id: m.id, emoji });

  const textless = !deleted && !m.body && m.attachments.length > 0;
  const bubble = textless ? null : (
    <div
      className={cn(
        'relative w-fit max-w-full rounded-2xl px-3.5 py-2 text-[14px] leading-[1.5] text-ink [overflow-wrap:anywhere]',
        mine ? 'rounded-tr-md bg-[#dbe7fe]' : 'rounded-tl-md bg-[#f1f4f9]',
        deleted && 'bg-transparent px-0 italic text-subtle ring-0',
        pending && 'opacity-60',
        highlight && 'ring-2 ring-amber-300',
      )}
      data-testid="message-bubble"
    >
      {deleted ? 'This message was deleted' : <MessageText body={m.body} people={people} me={me} />}
      {m.editedAt && !deleted && <span className="ml-1.5 text-[11px] text-subtle">(edited)</span>}
    </div>
  );

  return (
    <div className={cn('group relative flex gap-2.5 px-5', grouped ? 'pt-0.5' : 'pt-3', mine && 'flex-row-reverse')} data-testid="message" data-message-id={m.id} data-seq={m.seq}>
      <div className="w-9 shrink-0">{!grouped && !mine && m.sender && <Avatar user={m.sender} size={36} />}</div>
      <div className={cn('flex min-w-0 max-w-[72%] flex-col', mine ? 'items-end' : 'items-start')}>
        {!grouped && (
          <div className={cn('mb-1 flex items-baseline gap-2 text-[12px]', mine && 'flex-row-reverse')}>
            {!mine && <span className="font-semibold text-ink-2">{m.sender?.name ?? 'Unknown'}</span>}
            <Tip label={fullFmt.format(new Date(m.createdAt))}>
              <span className="text-subtle">{timeFmt.format(new Date(m.createdAt))}</span>
            </Tip>
          </div>
        )}
        {m.pinnedAt && !deleted && (
          <div className="mb-0.5 flex items-center gap-1 text-[11px] font-medium text-amber-700" data-testid="pinned-label">
            <Pin size={11} className="rotate-45" /> Pinned{m.pinnedBy ? ` by ${m.pinnedBy.id === me ? 'you' : m.pinnedBy.name}` : ''}
          </div>
        )}
        {editing ? (
          <div className="w-[min(560px,60vw)]">
            <Composer
              initial={m.body}
              placeholder="Edit message"
              people={people}
              candidates={candidates}
              compact
              autoFocus
              testId="edit-composer"
              onCancel={() => setEditing(false)}
              onSubmit={async (body) => {
                setEditing(false);
                if (body !== m.body) await edit.mutateAsync({ id: m.id, body });
              }}
            />
            <div className="mt-1 text-[11px] text-subtle">Enter to save · Esc to cancel</div>
          </div>
        ) : (
          bubble
        )}
        {!!m.attachments.length && !deleted && (
          <div className={cn('mt-1 flex flex-col gap-1.5', mine && 'items-end', pending && 'opacity-60')}>
            {m.attachments.map((a) => (
              <FileCard key={a.id} a={a} />
            ))}
          </div>
        )}
        {!!m.reactions.length && !deleted && (
          <div className={cn('mt-1 flex flex-wrap gap-1', mine && 'justify-end')}>
            {m.reactions.map((r) => (
              <Tip key={r.emoji} label={`${r.users.join(', ')}${r.count > r.users.length ? ` and ${r.count - r.users.length} more` : ''}`}>
                <button
                  onClick={() => toggle(r.emoji)}
                  className={cn('inline-flex h-6 items-center gap-1 rounded-full border px-2 text-[12px]', r.mine ? 'border-brand-200 bg-brand-50 text-brand-700' : 'border-line bg-surface text-ink-2 hover:bg-hover')}
                  aria-pressed={r.mine}
                  data-testid="reaction"
                >
                  <span className="text-[14px] leading-none">{r.emoji}</span>
                  {r.count}
                </button>
              </Tip>
            ))}
            <EmojiPicker
              onPick={toggle}
              side="bottom"
              align={mine ? 'end' : 'start'}
              trigger={
                <button className="inline-flex h-6 items-center rounded-full border border-line px-1.5 text-muted opacity-0 hover:bg-hover group-hover:opacity-100" aria-label="Add reaction">
                  <SmilePlus size={13} />
                </button>
              }
            />
          </div>
        )}
        {!inThread && m.replyCount > 0 && (
          <button onClick={() => onOpenThread?.(m)} className="mt-1 flex items-center gap-2 rounded-lg px-1.5 py-1 text-[12px] hover:bg-hover" data-testid="thread-summary">
            <AvatarStack users={m.repliers} size={20} max={3} />
            <span className="font-semibold text-brand-600">
              {m.replyCount} {m.replyCount === 1 ? 'reply' : 'replies'}
            </span>
            {m.lastReplyAt && <span className="text-subtle">Last reply {formatShort(m.lastReplyAt)}</span>}
          </button>
        )}
        {receipt && <div className="mt-0.5 text-[11px] text-subtle" data-testid="receipt">{receipt}</div>}
        {!!readers?.length && (
          <div className="mt-1" data-testid="readers" title={`Seen by ${readers.map((r) => r.name).join(', ')}`}>
            <AvatarStack users={readers} size={16} max={5} />
          </div>
        )}
      </div>

      {!editing && !pending && !deleted && m.kind === 'text' && (
        <div
          className={cn('absolute -top-3 z-10 hidden items-center gap-0.5 rounded-lg border border-line bg-surface p-0.5 shadow-sm group-hover:flex', mine ? 'left-16' : 'right-6', menuOpen && 'flex')}
          data-testid="message-actions"
        >
          {QUICK_REACTIONS.slice(0, 4).map((e) => (
            <button key={e} onClick={() => toggle(e)} className="flex size-7 items-center justify-center rounded-md text-[15px] hover:bg-hover" aria-label={`React ${e}`}>
              {e}
            </button>
          ))}
          <EmojiPicker onPick={toggle} side="bottom" trigger={<button className="flex size-7 items-center justify-center rounded-md text-muted hover:bg-hover" aria-label="More reactions"><SmilePlus size={15} /></button>} />
          {!inThread && (
            <Tip label="Reply in thread">
              <button onClick={() => onOpenThread?.(m)} className="flex size-7 items-center justify-center rounded-md text-muted hover:bg-hover" aria-label="Reply in thread">
                <MessageSquareText size={15} />
              </button>
            </Tip>
          )}
          <Menu open={menuOpen} onOpenChange={setMenuOpen}>
            <MenuTrigger asChild>
              <button className="flex size-7 items-center justify-center rounded-md text-muted hover:bg-hover" aria-label="More actions">
                <Ellipsis size={15} />
              </button>
            </MenuTrigger>
            <MenuContent align="end">
              {mine && (
                <MenuItem icon={<Pencil />} onSelect={() => setEditing(true)}>
                  Edit
                </MenuItem>
              )}
              <MenuItem icon={m.pinnedAt ? <PinOff /> : <Pin />} onSelect={() => pin.mutate({ id: m.id, pinned: !m.pinnedAt })}>
                {m.pinnedAt ? 'Unpin' : 'Pin to conversation'}
              </MenuItem>
              <MenuItem
                icon={<Copy />}
                onSelect={() => {
                  void navigator.clipboard.writeText(m.body.replace(/<@([0-9a-f-]{36})>/gi, (_x, id: string) => `@${people.get(id)?.name ?? ''}`));
                  toast.success('Copied');
                }}
              >
                Copy text
              </MenuItem>
              {(mine || canModerate) && (
                <>
                  <MenuSeparator />
                  <MenuItem icon={<Trash2 />} danger onSelect={() => remove.mutate(m.id)}>
                    Delete
                  </MenuItem>
                </>
              )}
            </MenuContent>
          </Menu>
        </div>
      )}
    </div>
  );
}
