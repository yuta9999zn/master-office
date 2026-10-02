'use client';

import { ChevronDown, Copy, Eye, EyeOff, List, Palette, PencilLine, Plus, Trash2 } from 'lucide-react';
import { ContextMenu as CM, DropdownMenu as DM } from 'radix-ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import type * as Y from 'yjs';
import { cn, Tip } from '../ui/primitives';
import type { GridHandle } from './UniverGrid';

interface TabInfo {
  id: string;
  name: string;
  color: string | null;
  hidden: boolean;
}

const TAB_COLORS = ['#EF4444', '#F97316', '#F59E0B', '#22C55E', '#14B8A6', '#3B82F6', '#6366F1', '#A855F7', '#EC4899', '#64748B'];

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

/**
 * Sheet tabs above the grid (Lark style — easier to scan than Excel's bottom bar). Univer's own footer
 * sheet bar is turned off; every action goes through the Univer facade, so the Yjs binding syncs it like any edit.
 */
export function SheetTabs({ grid, unitId, doc, editable }: { grid: GridHandle | null; unitId: string; doc: Y.Doc; editable: boolean }) {
  const [tabs, setTabs] = useState<TabInfo[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);
  const dragging = useRef<string | null>(null);
  const wb = useCallback(() => grid?.api.getWorkbook(unitId) as Any, [grid, unitId]);

  const refresh = useCallback(() => {
    const w = wb();
    if (!w) return;
    const list: TabInfo[] = w.getSheets().map((s: Any) => ({ id: s.getSheetId(), name: s.getSheetName(), color: s.getTabColor?.() || null, hidden: !!s.isSheetHidden?.() }));
    setTabs((prev) => (JSON.stringify(prev) === JSON.stringify(list) ? prev : list));
    setActive(w.getActiveSheet()?.getSheetId() ?? null);
  }, [wb]);

  // Re-read after any command (local edits, activation) and any Y.Doc update (remote changes, reloads).
  useEffect(() => {
    if (!grid) return;
    let raf = 0;
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(() => ((raf = 0), refresh()));
    };
    refresh();
    const sub = grid.api.addEvent(grid.api.Event.CommandExecuted, schedule);
    doc.on('update', schedule);
    return () => {
      sub.dispose();
      doc.off('update', schedule);
      cancelAnimationFrame(raf);
    };
  }, [grid, doc, refresh]);

  const sheet = (id: string) => wb()?.getSheetBySheetId(id);
  const activate = (id: string) => {
    const s = sheet(id);
    if (!s) return;
    if (s.isSheetHidden?.()) s.showSheet();
    wb()?.setActiveSheet(s);
    refresh();
  };
  const add = () => {
    const s = wb()?.insertSheet();
    if (s) wb().setActiveSheet(s);
  };
  const rename = (id: string, name: string) => {
    const n = name.trim();
    setRenaming(null);
    if (!n || tabs.some((t) => t.id !== id && t.name.toLowerCase() === n.toLowerCase())) return;
    sheet(id)?.setName(n);
  };
  const visible = tabs.filter((t) => !t.hidden);

  return (
    <div className="flex h-10 shrink-0 items-center gap-1 border-b border-line bg-canvas/60 px-2" data-testid="sheet-tabs" onDragLeave={(e) => e.currentTarget === e.target && setDropAt(null)}>
      <DM.Root>
        <Tip label="All sheets">
          <DM.Trigger asChild>
            <button className="flex size-7 shrink-0 items-center justify-center rounded-md text-ink-2 hover:bg-hover" aria-label="All sheets">
              <List size={16} />
            </button>
          </DM.Trigger>
        </Tip>
        <DM.Portal>
          <DM.Content sideOffset={4} align="start" className="pop z-50 max-h-80 min-w-52 animate-pop overflow-y-auto">
            {tabs.map((t) => (
              <DM.Item key={t.id} className={cn('menu-item', t.id === active && 'font-semibold text-brand-600')} onSelect={() => activate(t.id)}>
                <span className="size-2.5 rounded-full" style={{ background: t.color ?? 'transparent', border: t.color ? undefined : '1px solid #cbd5e1' }} />
                <span className="flex-1 truncate">{t.name}</span>
                {t.hidden && <EyeOff size={13} className="text-subtle" />}
              </DM.Item>
            ))}
          </DM.Content>
        </DM.Portal>
      </DM.Root>
      {editable && (
        <Tip label="Add sheet">
          <button onClick={add} className="flex size-7 shrink-0 items-center justify-center rounded-md text-ink-2 hover:bg-hover" aria-label="Add sheet" data-testid="add-sheet">
            <Plus size={16} />
          </button>
        </Tip>
      )}
      <span className="mx-1 h-5 w-px shrink-0 bg-line" />
      <div className="flex min-w-0 flex-1 items-end gap-0.5 self-stretch overflow-x-auto pt-1.5">
        {visible.map((t, i) => (
          <CM.Root key={t.id}>
            <CM.Trigger asChild>
              <div
                role="tab"
                aria-selected={t.id === active}
                data-sheet-tab={t.name}
                draggable={editable && renaming !== t.id}
                onDragStart={(e) => {
                  dragging.current = t.id;
                  e.dataTransfer.effectAllowed = 'move';
                }}
                onDragOver={(e) => {
                  if (!dragging.current) return;
                  e.preventDefault();
                  const r = e.currentTarget.getBoundingClientRect();
                  setDropAt(e.clientX < r.left + r.width / 2 ? i : i + 1);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  const id = dragging.current;
                  dragging.current = null;
                  const at = dropAt;
                  setDropAt(null);
                  if (!id || at === null) return;
                  // Target index among all sheets (hidden ones keep their place).
                  const target = visible[Math.min(at, visible.length - 1)];
                  let index = tabs.findIndex((x) => x.id === target.id) + (at >= visible.length ? 1 : 0);
                  if (tabs.findIndex((x) => x.id === id) < index) index--;
                  wb()?.moveSheet(sheet(id), index);
                }}
                onDragEnd={() => ((dragging.current = null), setDropAt(null))}
                onClick={() => activate(t.id)}
                onDoubleClick={() => editable && setRenaming(t.id)}
                className={cn(
                  'relative flex h-full max-w-48 shrink-0 cursor-pointer select-none items-center gap-1.5 rounded-t-lg border border-b-0 px-3 text-[13px]',
                  t.id === active ? 'border-line bg-surface font-medium text-ink' : 'border-transparent text-ink-2 hover:bg-hover',
                )}
              >
                {dropAt === i && <span className="absolute -left-0.5 top-1 bottom-1 w-0.5 rounded bg-brand-600" />}
                {dropAt === i + 1 && i === visible.length - 1 && <span className="absolute -right-0.5 top-1 bottom-1 w-0.5 rounded bg-brand-600" />}
                {t.color && <span className="absolute inset-x-2 bottom-0 h-[3px] rounded-t" style={{ background: t.color }} />}
                {renaming === t.id ? (
                  <input
                    autoFocus
                    defaultValue={t.name}
                    onFocus={(e) => e.target.select()}
                    onBlur={(e) => rename(t.id, e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') rename(t.id, (e.target as HTMLInputElement).value);
                      else if (e.key === 'Escape') setRenaming(null);
                      e.stopPropagation();
                    }}
                    onClick={(e) => e.stopPropagation()}
                    className="h-6 w-28 rounded border border-brand-600 bg-white px-1 text-[13px] outline-none"
                    aria-label="Sheet name"
                  />
                ) : (
                  <span className="truncate">{t.name}</span>
                )}
                {t.id === active && editable && renaming !== t.id && <ChevronDown size={12} className="text-subtle" />}
              </div>
            </CM.Trigger>
            <CM.Portal>
              <CM.Content className="pop z-50 min-w-48 animate-pop">
                <CM.Item disabled={!editable} className="menu-item" onSelect={() => setRenaming(t.id)}>
                  <PencilLine size={14} /> Rename
                </CM.Item>
                <CM.Item disabled={!editable} className="menu-item" onSelect={() => wb()?.duplicateSheet(sheet(t.id))}>
                  <Copy size={14} /> Duplicate
                </CM.Item>
                <CM.Sub>
                  <CM.SubTrigger disabled={!editable} className="menu-item">
                    <Palette size={14} /> Tab colour
                  </CM.SubTrigger>
                  <CM.Portal>
                    <CM.SubContent className="pop z-50 grid w-[164px] animate-pop grid-cols-5 gap-1.5 p-2">
                      {TAB_COLORS.map((c) => (
                        <CM.Item key={c} onSelect={() => sheet(t.id)?.setTabColor(c)} className="size-6 cursor-pointer rounded-md outline-none data-[highlighted]:ring-2 data-[highlighted]:ring-brand-600" style={{ background: c }} aria-label={c} />
                      ))}
                      <CM.Item onSelect={() => sheet(t.id)?.setTabColor('')} className="menu-item col-span-5 justify-center">
                        No colour
                      </CM.Item>
                    </CM.SubContent>
                  </CM.Portal>
                </CM.Sub>
                <CM.Item disabled={!editable || visible.length < 2} className="menu-item" onSelect={() => sheet(t.id)?.hideSheet()}>
                  <EyeOff size={14} /> Hide sheet
                </CM.Item>
                {tabs.some((x) => x.hidden) && (
                  <CM.Sub>
                    <CM.SubTrigger disabled={!editable} className="menu-item">
                      <Eye size={14} /> Unhide
                    </CM.SubTrigger>
                    <CM.Portal>
                      <CM.SubContent className="pop z-50 min-w-40 animate-pop">
                        {tabs
                          .filter((x) => x.hidden)
                          .map((x) => (
                            <CM.Item key={x.id} className="menu-item" onSelect={() => sheet(x.id)?.showSheet()}>
                              {x.name}
                            </CM.Item>
                          ))}
                      </CM.SubContent>
                    </CM.Portal>
                  </CM.Sub>
                )}
                <CM.Separator className="my-1 h-px bg-line" />
                <CM.Item disabled={!editable || i === 0} className="menu-item" onSelect={() => wb()?.moveSheet(sheet(t.id), tabs.findIndex((x) => x.id === visible[i - 1].id))}>
                  Move left
                </CM.Item>
                <CM.Item disabled={!editable || i === visible.length - 1} className="menu-item" onSelect={() => wb()?.moveSheet(sheet(t.id), tabs.findIndex((x) => x.id === visible[i + 1].id))}>
                  Move right
                </CM.Item>
                <CM.Separator className="my-1 h-px bg-line" />
                <CM.Item disabled={!editable || tabs.length < 2} className="menu-item text-red-600" onSelect={() => wb()?.deleteSheet(sheet(t.id))}>
                  <Trash2 size={14} /> Delete sheet
                </CM.Item>
              </CM.Content>
            </CM.Portal>
          </CM.Root>
        ))}
      </div>
    </div>
  );
}
