'use client';

import type { ResourceDetail, UserSummary } from '@workos/shared';
import { can } from '@workos/shared';
import { CloudCheck, CloudOff, Loader2, Share2, Star } from 'lucide-react';
import Link from 'next/link';
import { forwardRef, useEffect, useImperativeHandle, useState, type ReactNode } from 'react';
import { appById } from '@/lib/apps';
import { useResourceActions } from '@/lib/queries';
import { ROLE_LABEL } from '@/lib/resources';
import { Avatar, AvatarStack, Button, cn, FileIcon, Tip } from '../ui/primitives';

export type SaveState = 'connecting' | 'saving' | 'saved' | 'offline' | 'static';

export interface TitleBarHandle {
  rename: () => void;
}

export function folderHrefOf(r: ResourceDetail) {
  const loc = r.breadcrumb[r.breadcrumb.length - 1];
  return loc?.kind === 'folder' ? `/drive/folder/${loc.id}` : r.spaceId ? `/drive/space/${r.spaceId}` : '/drive/my';
}

const STATUS: Record<SaveState, { icon: ReactNode; text: string; cls?: string }> = {
  connecting: { icon: <Loader2 size={13} className="animate-spin" />, text: 'Connecting…' },
  saving: { icon: <Loader2 size={13} className="animate-spin" />, text: 'Saving…' },
  saved: { icon: <CloudCheck size={13} />, text: 'Saved to cloud' },
  offline: { icon: <CloudOff size={13} />, text: 'Offline — edits kept on this device', cls: 'text-amber-600' },
  static: { icon: <CloudCheck size={13} />, text: 'Saved to cloud' },
};

/** Header shared by every editor (Docs, Sheets, Slides…): icon, editable title, star, location, save state, people, Share. */
export const TitleBar = forwardRef<TitleBarHandle, {
  r: ResourceDetail;
  kind: string;
  members?: UserSummary[];
  online?: { userId: string; name: string; color: string }[];
  status: SaveState;
  onShare: () => void;
  actions?: ReactNode;
}>(function TitleBar({ r, kind, members, online, status, onShare, actions }, ref) {
  const acts = useResourceActions();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(r.name);
  useEffect(() => setTitle(r.name), [r.name]);
  useImperativeHandle(ref, () => ({ rename: () => setEditing(true) }));
  const editable = can(r.myRole, 'editor');
  const commit = () => {
    setEditing(false);
    if (title.trim() && title.trim() !== r.name) acts.update.mutate({ id: r.id, name: title.trim() });
    else setTitle(r.name);
  };
  const st = STATUS[status];

  return (
    <div className="flex shrink-0 items-center gap-3 px-5 pt-3">
      <FileIcon r={r} size={38} className="rounded-lg" />
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          {editing ? (
            <input
              autoFocus
              aria-label="Document title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => e.key === 'Enter' && commit()}
              onFocus={(e) => e.target.select()}
              className="h-7 w-[420px] rounded-md border border-brand-600 px-1.5 text-[18px] font-semibold outline-none"
            />
          ) : (
            <button disabled={!editable} onClick={() => setEditing(true)} className="truncate rounded-md px-1.5 text-left text-[18px] font-semibold text-ink hover:bg-hover disabled:hover:bg-transparent">
              {r.name}
            </button>
          )}
          <button onClick={() => acts.star.mutate({ id: r.id, on: !r.starred })} className="rounded p-1 hover:bg-hover" aria-label="Star">
            <Star size={17} className={r.starred ? 'fill-amber-400 text-amber-400' : 'text-subtle'} />
          </button>
        </div>
        <div className="flex items-center gap-1.5 px-1.5 text-[12px] text-muted">
          <Link href={folderHrefOf(r)} className="hover:text-ink hover:underline">
            {r.breadcrumb.map((b) => b.name).join(' / ')}
          </Link>
          <span>/</span>
          <span>{appById(kind)?.label}</span>
          <span className={cn('ml-2 flex items-center gap-1', st.cls)} data-testid="save-status">
            {st.icon} {st.text}
          </span>
          {!editable && <span className="ml-2 rounded bg-hover px-1.5 py-0.5 text-[11px]">{ROLE_LABEL[r.myRole ?? 'viewer']}</span>}
        </div>
      </div>
      <div className="ml-auto flex items-center gap-1.5">
        {!!online?.length && (
          <div className="mr-1 flex items-center" data-testid="online-users">
            {online.slice(0, 4).map((u, i) => (
              <Tip key={u.userId} label={`${u.name} is here`}>
                <span className={cn('rounded-full ring-2', i && '-ml-1.5')} style={{ ['--tw-ring-color' as string]: u.color }}>
                  <Avatar user={{ name: u.name, avatarColor: u.color }} size={28} ring />
                </span>
              </Tip>
            ))}
          </div>
        )}
        {!online?.length && members && <AvatarStack users={members} max={3} total={members.length} size={30} />}
        <Button variant="primary" icon={<Share2 size={15} />} className="ml-2" onClick={onShare}>
          Share
        </Button>
        {actions}
      </div>
    </div>
  );
});
