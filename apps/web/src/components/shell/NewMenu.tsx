'use client';

import type { ResourceType } from '@workos/shared';
import { BookOpen, ClipboardList, Database, FileText, FolderPlus, Link2, NotebookPen, Play, Table2, Upload, Workflow } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { useResourceActions } from '@/lib/queries';
import { hrefFor } from '@/lib/resources';
import { Button, Dialog, Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '../ui/primitives';

const ITEMS: { type: ResourceType; label: string; icon: ReactNode; color: string; untitled: string }[] = [
  { type: 'folder', label: 'New folder', icon: <FolderPlus />, color: '#f5b83d', untitled: 'Untitled folder' },
  { type: 'document', label: 'Document', icon: <FileText />, color: '#2563eb', untitled: 'Untitled document' },
  { type: 'spreadsheet', label: 'Spreadsheet', icon: <Table2 />, color: '#10b981', untitled: 'Untitled spreadsheet' },
  { type: 'presentation', label: 'Presentation', icon: <Play />, color: '#f97316', untitled: 'Untitled presentation' },
  { type: 'note', label: 'Note & Mind Map', icon: <NotebookPen />, color: '#4f46e5', untitled: 'Untitled note' },
  { type: 'form', label: 'Form', icon: <ClipboardList />, color: '#4f46e5', untitled: 'Untitled form' },
  { type: 'wiki', label: 'Wiki page', icon: <BookOpen />, color: '#0d9488', untitled: 'Untitled page' },
  { type: 'base', label: 'Base (Database)', icon: <Database />, color: '#7c3aed', untitled: 'Untitled base' },
  { type: 'flow', label: 'Flow (Diagram)', icon: <Workflow />, color: '#6366f1', untitled: 'Untitled flow' },
];

/**
 * The "New" menu from the reference Drive screen. Creates in `target` (a folder, a space root, or My Files)
 * and opens the new item in its editor; folders ask for a name first.
 */
export function NewMenu({
  target = {},
  trigger,
  onUpload,
  openAfterCreate = true,
  onCreated,
}: {
  target?: { parentId?: string | null; spaceId?: string | null };
  trigger?: ReactNode;
  onUpload?: () => void;
  openAfterCreate?: boolean;
  onCreated?: (id: string) => void;
}) {
  const router = useRouter();
  const { create } = useResourceActions();
  const [naming, setNaming] = useState<(typeof ITEMS)[number] | null>(null);
  const [name, setName] = useState('');

  const make = async (type: ResourceType, n: string) => {
    const r = await create.mutateAsync({ type, name: n, parentId: target.parentId ?? null, spaceId: target.parentId ? null : target.spaceId ?? null });
    onCreated?.(r.id);
    if (openAfterCreate && type !== 'folder') router.push(hrefFor(r));
  };

  return (
    <>
      <Menu>
        <MenuTrigger asChild>{trigger ?? <Button variant="primary">New</Button>}</MenuTrigger>
        <MenuContent className="w-56" onCloseAutoFocus={(e) => e.preventDefault()}>
          {ITEMS.map((it, i) => (
            <div key={it.type}>
              {i === 1 && <MenuSeparator />}
              <MenuItem
                icon={<span style={{ color: it.color }}>{it.icon}</span>}
                onSelect={() => {
                  if (it.type === 'folder') {
                    setName(it.untitled);
                    setNaming(it);
                  } else void make(it.type, it.untitled);
                }}
              >
                {it.label}
              </MenuItem>
            </div>
          ))}
          <MenuSeparator />
          {onUpload && (
            <MenuItem icon={<Upload />} onSelect={onUpload}>
              Upload files
            </MenuItem>
          )}
          <MenuItem icon={<Link2 />} disabled>
            Shortcut
          </MenuItem>
        </MenuContent>
      </Menu>
      <Dialog
        open={!!naming}
        onOpenChange={(v) => !v && setNaming(null)}
        title="New folder"
        width={400}
        footer={
          <>
            <Button onClick={() => setNaming(null)}>Cancel</Button>
            <Button
              variant="primary"
              loading={create.isPending}
              disabled={!name.trim()}
              onClick={async () => {
                await make('folder', name.trim());
                setNaming(null);
              }}
            >
              Create
            </Button>
          </>
        }
      >
        <input
          autoFocus
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onFocus={(e) => e.target.select()}
          onKeyDown={async (e) => {
            if (e.key === 'Enter' && name.trim()) {
              await make('folder', name.trim());
              setNaming(null);
            }
          }}
        />
      </Dialog>
    </>
  );
}
