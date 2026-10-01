'use client';

import type { Resource } from '@workos/shared';
import { can } from '@workos/shared';
import { Copy, Download, ExternalLink, FolderInput, Info, PencilLine, RotateCcw, Share2, Star, StarOff, Trash2, X } from 'lucide-react';
import { ContextMenu as CM, DropdownMenu as DM } from 'radix-ui';
import type { ReactNode } from 'react';
import { cn } from '../ui/primitives';

export interface Action {
  id: string;
  label: string;
  icon: ReactNode;
  onSelect: () => void;
  danger?: boolean;
  shortcut?: string;
  separatorBefore?: boolean;
}

export interface ActionHandlers {
  open: (r: Resource) => void;
  share: (r: Resource) => void;
  rename: (r: Resource) => void;
  move: (rs: Resource[]) => void;
  copy: (rs: Resource[]) => void;
  trash: (rs: Resource[]) => void;
  restore: (rs: Resource[]) => void;
  destroy: (rs: Resource[]) => void;
  star: (r: Resource, on: boolean) => void;
  download: (rs: Resource[]) => void;
  details: (r: Resource) => void;
}

export const hasBlob = (r: Resource) => !!r.mimeType;

/** The one action list used by the row "…" menu, the right-click menu and the toolbar. */
export function buildActions(items: Resource[], h: ActionHandlers, inTrash: boolean): Action[] {
  if (!items.length) return [];
  const one = items.length === 1 ? items[0] : null;
  const allEdit = items.every((r) => can(r.myRole, 'editor'));
  if (inTrash) {
    return [
      { id: 'restore', label: 'Restore', icon: <RotateCcw />, onSelect: () => h.restore(items) },
      ...(items.every((r) => r.myRole === 'owner')
        ? [{ id: 'destroy', label: 'Delete forever', icon: <X />, danger: true, onSelect: () => h.destroy(items), separatorBefore: true }]
        : []),
    ];
  }
  const out: Action[] = [];
  if (one) out.push({ id: 'open', label: 'Open', icon: <ExternalLink />, onSelect: () => h.open(one), shortcut: 'Enter' });
  if (one) out.push({ id: 'share', label: 'Share', icon: <Share2 />, onSelect: () => h.share(one) });
  if (items.some(hasBlob)) out.push({ id: 'download', label: 'Download', icon: <Download />, onSelect: () => h.download(items.filter(hasBlob)) });
  if (one && can(one.myRole, 'editor')) out.push({ id: 'rename', label: 'Rename', icon: <PencilLine />, onSelect: () => h.rename(one), shortcut: 'F2', separatorBefore: true });
  if (allEdit) out.push({ id: 'move', label: 'Move to…', icon: <FolderInput />, onSelect: () => h.move(items), separatorBefore: !one || !can(one.myRole, 'editor') });
  out.push({ id: 'copy', label: 'Make a copy', icon: <Copy />, onSelect: () => h.copy(items) });
  if (one) out.push(one.starred ? { id: 'unstar', label: 'Remove from Starred', icon: <StarOff />, onSelect: () => h.star(one, false) } : { id: 'star', label: 'Add to Starred', icon: <Star />, onSelect: () => h.star(one, true) });
  if (one) out.push({ id: 'details', label: 'Details', icon: <Info />, onSelect: () => h.details(one) });
  if (allEdit) out.push({ id: 'trash', label: 'Move to trash', icon: <Trash2 />, danger: true, onSelect: () => h.trash(items), shortcut: 'Del', separatorBefore: true });
  return out;
}

const itemCls = (danger?: boolean) => cn('menu-item', danger && 'text-red-600 data-[highlighted]:bg-red-50 [&_svg]:text-red-500');

function Row({ a }: { a: Action }) {
  return (
    <>
      <span className="flex w-4 justify-center text-muted [&>svg]:size-4">{a.icon}</span>
      <span className="flex-1">{a.label}</span>
      {a.shortcut && <span className="text-[11px] text-subtle">{a.shortcut}</span>}
    </>
  );
}

export function DropdownActions({ actions }: { actions: Action[] }) {
  return (
    <>
      {actions.map((a) => (
        <div key={a.id}>
          {a.separatorBefore && <DM.Separator className="my-1 h-px bg-line" />}
          <DM.Item className={itemCls(a.danger)} onSelect={a.onSelect}>
            <Row a={a} />
          </DM.Item>
        </div>
      ))}
    </>
  );
}

export function ContextActions({ actions }: { actions: Action[] }) {
  return (
    <CM.Portal>
      <CM.Content className="pop z-50 min-w-[210px] animate-pop" onCloseAutoFocus={(e) => e.preventDefault()}>
        {actions.map((a) => (
          <div key={a.id}>
            {a.separatorBefore && <CM.Separator className="my-1 h-px bg-line" />}
            <CM.Item className={itemCls(a.danger)} onSelect={a.onSelect}>
              <Row a={a} />
            </CM.Item>
          </div>
        ))}
      </CM.Content>
    </CM.Portal>
  );
}
