'use client';

import type { Editor } from '@tiptap/react';
import { DEFAULT_TAB, SETTINGS_MAP, tabField, tabsOf, TABS_KEY, type DocTab } from '@workos/doc-model';
import { ArrowDown, ArrowUp, FileText, MoreVertical, PencilLine, Plus, Trash2 } from 'lucide-react';
import { DropdownMenu as DM } from 'radix-ui';
import { useEffect, useState } from 'react';
import type * as Y from 'yjs';
import { cn } from '../ui/primitives';
import { Outline } from './Outline';

/** The document's tabs (Yjs settings map) and the operations on them. */
export function useDocTabs(doc: Y.Doc) {
  const map = doc.getMap(SETTINGS_MAP);
  const [tabs, setTabs] = useState<DocTab[]>(() => tabsOf(map.toJSON()));
  useEffect(() => {
    const sync = () => setTabs(tabsOf(map.toJSON()));
    map.observe(sync);
    sync();
    return () => map.unobserve(sync);
  }, [map]);
  const write = (next: DocTab[]) => map.set(TABS_KEY, next);
  return {
    tabs,
    add(title?: string): string {
      const id = Math.random().toString(36).slice(2, 10);
      const current = tabsOf(map.toJSON());
      write([...current, { id, title: title ?? `Tab ${current.length + 1}` }]);
      return id;
    },
    rename(id: string, title: string) {
      write(tabsOf(map.toJSON()).map((t) => (t.id === id ? { ...t, title: title.trim() || t.title } : t)));
    },
    move(id: string, d: -1 | 1) {
      const list = tabsOf(map.toJSON());
      const i = list.findIndex((t) => t.id === id);
      const j = i + d;
      if (i < 0 || j < 0 || j >= list.length) return;
      [list[i], list[j]] = [list[j], list[i]];
      write(list);
    },
    /** Deletes a tab and its content (the first, original tab cannot be deleted). */
    remove(id: string) {
      if (id === DEFAULT_TAB) return;
      doc.transact(() => {
        write(tabsOf(map.toJSON()).filter((t) => t.id !== id));
        const frag = doc.getXmlFragment(tabField(id));
        frag.delete(0, frag.length);
      });
    },
  };
}

/** Left column (Google Docs): the tabs, with the open tab's outline under it. */
export function DocTabsPanel({ tabs, current, onOpen, editor, canEdit, ops, commentCounts }: { tabs: DocTab[]; current: string; onOpen: (id: string) => void; editor: Editor; canEdit: boolean; ops: Omit<ReturnType<typeof useDocTabs>, 'tabs'>; commentCounts: Map<string, number> }) {
  const [renaming, setRenaming] = useState<string | null>(null);
  return (
    <div className="w-60 shrink-0 overflow-y-auto pr-1" data-testid="doc-tabs">
      <div className="mb-1 flex items-center justify-between pl-2 text-[12px] font-semibold uppercase tracking-wide text-subtle">
        Document tabs
        {canEdit && (
          <button
            onClick={() => {
              const id = ops.add();
              onOpen(id);
              setRenaming(id);
            }}
            className="rounded p-1 text-muted hover:bg-hover hover:text-ink"
            aria-label="Add tab"
            data-testid="add-tab"
          >
            <Plus size={15} />
          </button>
        )}
      </div>
      {tabs.map((t, i) => (
        <div key={t.id}>
          <div className={cn('group flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[13px]', t.id === current ? 'bg-brand-50 font-medium text-brand-700' : 'text-ink-2 hover:bg-hover')}>
            <FileText size={14} className="shrink-0" />
            {renaming === t.id ? (
              <input
                autoFocus
                defaultValue={t.title}
                onBlur={(e) => (ops.rename(t.id, e.target.value), setRenaming(null))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                  if (e.key === 'Escape') setRenaming(null);
                }}
                className="min-w-0 flex-1 rounded border border-brand-300 bg-white px-1 text-[13px] text-ink outline-none"
                aria-label="Tab name"
              />
            ) : (
              <button className="min-w-0 flex-1 truncate text-left" onClick={() => onOpen(t.id)} onDoubleClick={() => canEdit && setRenaming(t.id)} data-testid="doc-tab">
                {t.title}
              </button>
            )}
            {(commentCounts.get(t.id) ?? 0) > 0 && t.id !== current && <span className="rounded-full bg-amber-100 px-1.5 text-[10px] font-semibold text-amber-700">{commentCounts.get(t.id)}</span>}
            {canEdit && (
              <DM.Root>
                <DM.Trigger asChild>
                  <button className="rounded p-0.5 text-muted opacity-0 hover:bg-white group-hover:opacity-100 data-[state=open]:opacity-100" aria-label={`Tab options ${t.title}`}>
                    <MoreVertical size={14} />
                  </button>
                </DM.Trigger>
                <DM.Portal>
                  <DM.Content align="start" className="pop z-50 min-w-40 animate-pop">
                    <DM.Item className="menu-item" onSelect={() => setTimeout(() => setRenaming(t.id), 0)}>
                      <PencilLine size={14} /> Rename
                    </DM.Item>
                    <DM.Item className="menu-item" disabled={i === 0} onSelect={() => ops.move(t.id, -1)}>
                      <ArrowUp size={14} /> Move up
                    </DM.Item>
                    <DM.Item className="menu-item" disabled={i === tabs.length - 1} onSelect={() => ops.move(t.id, 1)}>
                      <ArrowDown size={14} /> Move down
                    </DM.Item>
                    <DM.Item
                      className="menu-item text-red-600"
                      disabled={t.id === DEFAULT_TAB}
                      onSelect={() => {
                        if (t.id === current) onOpen(DEFAULT_TAB);
                        ops.remove(t.id);
                      }}
                    >
                      <Trash2 size={14} /> Delete tab
                    </DM.Item>
                  </DM.Content>
                </DM.Portal>
              </DM.Root>
            )}
          </div>
          {t.id === current && (
            <div className="ml-4 border-l border-line pl-1">
              <Outline editor={editor} compact />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
