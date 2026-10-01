'use client';

import { BRANCH_COLORS, ROOT_ID, type MindEdge, type MindNode } from '@workos/doc-model';
import type { ResourceType } from '@workos/shared';
import {
  ChevronRight,
  Hand,
  Maximize2,
  Minus,
  MousePointer2,
  Paperclip,
  Plus,
  Redo2,
  Spline,
  StickyNote,
  Target,
  Trash2,
  Undo2,
  ListPlus,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent, type ReactNode } from 'react';
import { useResource } from '@/lib/queries';
import { hrefFor } from '@/lib/resources';
import { cn, FileIcon, Tip } from '../ui/primitives';
import { bounds, G, layout, port, type Placed } from './layout';
import type { MindMapActions } from './useMindMap';

type Tool = 'select' | 'hand' | 'sticky' | 'connect';
interface View {
  x: number;
  y: number;
  z: number;
}

const STICKY_COLORS = ['#fef08a', '#fbcfe8', '#bbf7d0', '#bae6fd', '#ddd6fe', '#fed7aa'];

function LinkCard({ n }: { n: MindNode }) {
  const { data: r } = useResource(n.resourceId);
  return (
    <div className="flex h-full items-center gap-2.5 rounded-xl border border-line bg-white px-3 shadow-sm">
      <FileIcon r={{ type: (r?.type ?? n.resourceType ?? 'file') as ResourceType, mimeType: null, metadata: {} }} size={24} />
      <div className="min-w-0">
        <div className="truncate text-[12px] font-semibold text-ink">{r?.name ?? n.text}</div>
        <div className="text-[11px] text-subtle">Linked from notes</div>
      </div>
    </div>
  );
}

/** Inline editor for topic text / notes. Module-level so live re-renders never remount it mid-typing. */
function NodeTextEditor({ initial, multiline, onCommit, onCancel }: { initial: string; multiline: boolean; onCommit: (v: string) => void; onCancel: () => void }) {
  return (
    <textarea
      autoFocus
      defaultValue={initial}
      aria-label={multiline ? 'Topic notes' : 'Topic text'}
      onFocus={(e) => e.target.select()}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') onCancel();
        if (e.key === 'Enter' && !e.shiftKey && !multiline) {
          e.preventDefault();
          (e.target as HTMLTextAreaElement).blur();
        }
      }}
      onBlur={(e) => onCommit(e.target.value)}
      className={cn('w-full resize-none bg-white/90 text-center outline-none', multiline ? 'h-full p-2 text-left text-[12px]' : 'h-full rounded-lg p-1 text-[13px] font-semibold')}
    />
  );
}

function curve(a: { x: number; y: number }, b: { x: number; y: number }) {
  const mx = (a.x + b.x) / 2;
  return `M ${a.x} ${a.y} C ${mx} ${a.y}, ${mx} ${b.y}, ${b.x} ${b.y}`;
}

export function MindMapCanvas({
  nodes,
  edges,
  actions,
  editable,
  onAttach,
  onConvert,
  hasMap,
}: {
  nodes: MindNode[];
  edges: MindEdge[];
  actions: MindMapActions;
  editable: boolean;
  onAttach: (parentId: string) => void;
  onConvert: () => void;
  hasMap: boolean;
}) {
  const router = useRouter();
  const box = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>({ x: 0, y: 0, z: 1 });
  const [tool, setTool] = useState<Tool>('select');
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; field: 'text' | 'notes' } | null>(null);
  const [drag, setDrag] = useState<{ id: string; dx: number; dy: number } | null>(null);
  const [connectFrom, setConnectFrom] = useState<string | null>(null);
  // Fit once the real map is there (the first render may only have the placeholder root).
  const fittedFor = useRef(0);

  const placed = useMemo(() => {
    const p = layout(nodes);
    if (!drag) return p;
    // Live drag preview: move the dragged node and (for topics) its subtree.
    const moving = new Set<string>([drag.id]);
    const n0 = nodes.find((n) => n.id === drag.id);
    if (n0 && n0.kind !== 'sticky') {
      const walk = (id: string) => nodes.filter((c) => c.parentId === id).forEach((c) => (moving.add(c.id), walk(c.id)));
      walk(drag.id);
    }
    return p.map((q) => (moving.has(q.node.id) ? { ...q, x: q.x + drag.dx, y: q.y + drag.dy } : q));
  }, [nodes, drag]);
  const byId = useMemo(() => new Map(placed.map((p) => [p.node.id, p])), [placed]);

  const fit = useCallback(() => {
    const el = box.current;
    if (!el) return;
    const b = bounds(placed);
    const z = Math.min(1.2, Math.max(0.3, Math.min((el.clientWidth - 80) / b.w, (el.clientHeight - 80) / b.h)));
    setView({ z, x: el.clientWidth / 2 - (b.x + b.w / 2) * z, y: el.clientHeight / 2 - (b.y + b.h / 2) * z });
  }, [placed]);

  useEffect(() => {
    const count = placed.length;
    if (box.current && count && (fittedFor.current === 0 || (fittedFor.current <= 1 && count > 1))) {
      fittedFor.current = count;
      fit();
    }
  }, [placed, fit]);

  // Wheel: Ctrl/⌘ zooms around the cursor, otherwise pans. Needs a non-passive listener.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        const rect = el.getBoundingClientRect();
        const cx = e.clientX - rect.left;
        const cy = e.clientY - rect.top;
        setView((v) => {
          const z = Math.min(2.5, Math.max(0.25, v.z * (e.deltaY < 0 ? 1.1 : 0.9)));
          return { z, x: cx - ((cx - v.x) * z) / v.z, y: cy - ((cy - v.y) * z) / v.z };
        });
      } else setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const toWorld = (clientX: number, clientY: number) => {
    const rect = box.current!.getBoundingClientRect();
    return { x: (clientX - rect.left - view.x) / view.z, y: (clientY - rect.top - view.y) / view.z };
  };

  // ── Pointer handling ──────────────────────────────────────────────────────
  const startPan = (e: RPointerEvent) => {
    const start = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
    const move = (ev: PointerEvent) => setView((v) => ({ ...v, x: start.vx + ev.clientX - start.x, y: start.vy + ev.clientY - start.y }));
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const onBackgroundDown = (e: RPointerEvent) => {
    box.current?.focus();
    if (e.button !== 0) return;
    if (tool === 'sticky' && editable) {
      // Keep the browser from moving focus to the canvas after this press — the new sticky's text box takes it.
      e.preventDefault();
      const w = toWorld(e.clientX, e.clientY);
      const id = actions.addSticky(Math.round(w.x - G.STICKY_W / 2), Math.round(w.y - G.STICKY_H / 2));
      setSelected(id);
      setEditing({ id, field: 'text' });
      setTool('select');
      return;
    }
    setSelected(null);
    setEditing(null);
    setConnectFrom(null);
    startPan(e);
  };

  const onNodeDown = (e: RPointerEvent, p: Placed) => {
    e.stopPropagation();
    box.current?.focus();
    if (e.button !== 0) return;
    if (tool === 'hand') return startPan(e);
    if (tool === 'connect' && editable) {
      if (!connectFrom) setConnectFrom(p.node.id);
      else {
        actions.addEdge(connectFrom, p.node.id);
        setConnectFrom(null);
        setTool('select');
      }
      return;
    }
    setSelected(p.node.id);
    if (!editable || editing?.id === p.node.id || p.node.kind === 'root') return;
    const start = { x: e.clientX, y: e.clientY };
    let moved = false;
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - start.x) / view.z;
      const dy = (ev.clientY - start.y) / view.z;
      if (!moved && Math.hypot(dx, dy) < 4) return;
      moved = true;
      setDrag({ id: p.node.id, dx, dy });
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (moved) {
        const dx = (ev.clientX - start.x) / view.z;
        const dy = (ev.clientY - start.y) / view.z;
        actions.update(p.node.id, { x: Math.round(p.x + dx), y: Math.round(p.y + dy) });
      }
      setDrag(null);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  // ── Keyboard ──────────────────────────────────────────────────────────────
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (editing || (e.target as HTMLElement).tagName === 'TEXTAREA') return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      (e.shiftKey ? actions.redo : actions.undo)();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      actions.redo();
      return;
    }
    if (!selected || !editable) return;
    const node = nodes.find((n) => n.id === selected);
    if (!node) return;
    if (e.key === 'Tab' && node.kind !== 'sticky') {
      e.preventDefault();
      const id = actions.addChild(selected);
      if (id) (setSelected(id), setEditing({ id, field: 'text' }));
    } else if (e.key === 'Enter' && node.kind !== 'sticky') {
      e.preventDefault();
      const id = node.kind === 'root' ? actions.addChild(ROOT_ID) : actions.addSibling(selected);
      if (id) (setSelected(id), setEditing({ id, field: 'text' }));
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && node.kind !== 'root') {
      e.preventDefault();
      actions.remove(selected);
      setSelected(node.parentId);
    } else if (e.key === 'F2') {
      e.preventDefault();
      setEditing({ id: selected, field: 'text' });
    } else if (e.key === 'Escape') setSelected(null);
  };

  // ── Rendering ─────────────────────────────────────────────────────────────
  const sel = selected ? byId.get(selected) : undefined;
  const selNode = sel?.node;
  const hasKids = (id: string) => nodes.some((n) => n.parentId === id);

  const commit = (p: Placed, field: 'text' | 'notes', v: string) => {
    const initial = field === 'text' ? p.node.text : (p.node.notes ?? []).join('\n');
    if (field === 'text' && v.trim() && v !== initial) actions.update(p.node.id, { text: v.trim() });
    if (field === 'notes' && v !== initial) actions.update(p.node.id, { notes: v.split('\n').map((l) => l.trim()).filter(Boolean) });
    setEditing(null);
    box.current?.focus();
  };
  const editorFor = (p: Placed, field: 'text' | 'notes') => (
    <NodeTextEditor
      initial={field === 'text' ? p.node.text : (p.node.notes ?? []).join('\n')}
      multiline={field === 'notes'}
      onCommit={(v) => commit(p, field, v)}
      onCancel={() => setEditing(null)}
    />
  );

  const renderNode = (p: Placed) => {
    const n = p.node;
    const isSel = selected === n.id || connectFrom === n.id;
    const ring = isSel ? 'ring-2 ring-brand-600 ring-offset-2' : '';
    const common = {
      'data-node-id': n.id,
      'data-testid': `mind-node-${n.kind}`,
      onPointerDown: (e: RPointerEvent) => onNodeDown(e, p),
      onDoubleClick: (e: React.MouseEvent) => {
        e.stopPropagation();
        if (n.kind === 'link' && n.resourceId) router.push(hrefFor({ id: n.resourceId, type: (n.resourceType ?? 'file') as ResourceType, metadata: {} }));
        else if (editable) setEditing({ id: n.id, field: 'text' });
      },
    };
    const style = { left: p.x, top: p.y, width: p.w, height: p.h };
    const plusSide = p.side ?? 'right';
    const addBtn = editable && n.kind !== 'sticky' && n.kind !== 'link' && (
      <button
        aria-label="Add child topic"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          const id = actions.addChild(n.id);
          if (id) (setSelected(id), setEditing({ id, field: 'text' }));
        }}
        className={cn('absolute top-1/2 flex size-5 -translate-y-1/2 items-center justify-center rounded-full border border-line bg-white text-muted opacity-0 shadow-sm transition group-hover/node:opacity-100 hover:text-brand-600', plusSide === 'right' ? '-right-7' : '-left-7')}
      >
        <Plus size={12} />
      </button>
    );
    const collapseBtn = hasKids(n.id) && n.kind !== 'root' && (
      <button
        aria-label={n.collapsed ? 'Expand branch' : 'Collapse branch'}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          if (editable) actions.update(n.id, { collapsed: !n.collapsed });
        }}
        className={cn('absolute top-1/2 flex h-4 min-w-4 -translate-y-1/2 items-center justify-center rounded-full px-1 text-[10px] font-bold text-white', plusSide === 'right' ? '-right-2.5' : '-left-2.5')}
        style={{ background: n.color }}
      >
        {n.collapsed ? nodes.filter((c) => c.parentId === n.id).length : <ChevronRight size={10} className={plusSide === 'left' ? 'rotate-180' : ''} />}
      </button>
    );

    if (n.kind === 'root') {
      return (
        <div key={n.id} {...common} style={style} className={cn('group/node absolute cursor-pointer select-none rounded-2xl bg-gradient-to-br from-indigo-500 to-brand-600 px-4 text-white shadow-[0_10px_30px_-10px_rgba(37,99,235,0.6)]', ring)}>
          {editing?.id === n.id ? (
            <div className="flex h-full items-center">
              {editorFor(p, 'text')}
            </div>
          ) : (
            <div className="flex h-full items-center gap-3">
              <Target size={26} className="shrink-0 opacity-90" />
              <div className="min-w-0">
                <div className="truncate text-[17px] font-bold leading-tight">{n.text}</div>
                {n.subtitle && <div className="truncate text-[11px] opacity-80">{n.subtitle}</div>}
              </div>
            </div>
          )}
          {editable && (
            <>
              <button
                aria-label="Add branch on the right"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => {
                  const id = actions.addChild(n.id, { side: 'right' });
                  if (id) (setSelected(id), setEditing({ id, field: 'text' }));
                }}
                className="absolute -right-3 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded-full border border-white bg-brand-600 text-white shadow"
              >
                <Plus size={13} />
              </button>
            </>
          )}
        </div>
      );
    }
    if (n.kind === 'sticky') {
      return (
        <div key={n.id} {...common} style={{ ...style, background: n.color ?? '#fef08a' }} className={cn('group/node absolute cursor-grab select-none rounded-md p-3 text-[13px] leading-snug text-ink shadow-[0_6px_16px_-6px_rgba(15,23,42,0.35)]', ring)}>
          {editing?.id === n.id ? <textarea autoFocus defaultValue={n.text} aria-label="Sticky note text" onPointerDown={(e) => e.stopPropagation()} onKeyDown={(e) => (e.stopPropagation(), e.key === 'Escape' && setEditing(null))} onBlur={(e) => (actions.update(n.id, { text: e.target.value }), setEditing(null))} className="size-full resize-none bg-transparent outline-none" /> : <div className="line-clamp-5 whitespace-pre-wrap">{n.text}</div>}
        </div>
      );
    }
    if (n.kind === 'link') {
      return (
        <div key={n.id} {...common} style={style} className={cn('group/node absolute cursor-pointer select-none rounded-xl', ring)}>
          <LinkCard n={n} />
        </div>
      );
    }
    return (
      <div key={n.id}>
        <div
          {...common}
          style={{ ...style, borderColor: n.color, background: `${n.color}14` }}
          className={cn('group/node absolute flex cursor-pointer select-none items-center justify-center rounded-xl border-2 px-3 text-center text-[13px] font-semibold text-ink shadow-sm', ring)}
        >
          {editing?.id === n.id && editing.field === 'text' ? editorFor(p, 'text') : <span className="line-clamp-2">{n.text}</span>}
          {addBtn}
          {collapseBtn}
        </div>
        {p.notesH > 0 && (
          <div
            data-testid="mind-notes"
            onPointerDown={(e) => (e.stopPropagation(), setSelected(n.id))}
            onDoubleClick={(e) => (e.stopPropagation(), editable && setEditing({ id: n.id, field: 'notes' }))}
            style={{ left: p.x, top: p.y + p.h + 8, width: G.NOTE_W, height: p.notesH }}
            className="absolute rounded-xl border bg-white px-3 py-2 text-[12px] leading-[19px] text-ink-2 shadow-sm"
          >
            {editing?.id === n.id && editing.field === 'notes' ? (
              editorFor(p, 'notes')
            ) : (
              <ul className="list-disc pl-4">
                {n.notes!.map((l, i) => (
                  <li key={i} className="truncate">
                    {l}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    );
  };

  const b = bounds(placed);
  const vpW = box.current?.clientWidth ?? 800;
  const vpH = box.current?.clientHeight ?? 600;
  const mini = { w: 180, h: 112 };
  const ms = Math.min(mini.w / (b.w + 200), mini.h / (b.h + 200));
  const toMini = (x: number, y: number) => ({ x: (x - b.x + 100) * ms, y: (y - b.y + 100) * ms });

  const ToolBtn = ({ t, label, icon }: { t: Tool; label: string; icon: ReactNode }) => (
    <Tip label={label}>
      <button aria-label={label} aria-pressed={tool === t} onClick={() => (setTool(t), setConnectFrom(null))} className={cn('flex size-8 items-center justify-center rounded-lg text-ink-2 hover:bg-hover', tool === t && 'bg-selected text-brand-600')}>
        {icon}
      </button>
    </Tip>
  );

  return (
    <div
      ref={box}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onPointerDown={onBackgroundDown}
      data-testid="mindmap"
      className={cn('relative h-full w-full overflow-hidden rounded-xl border border-line bg-[#fbfcfe] outline-none', tool === 'hand' ? 'cursor-grab' : tool === 'sticky' ? 'cursor-crosshair' : 'cursor-default')}
      style={{ backgroundImage: 'radial-gradient(circle, #dfe4ec 1px, transparent 1px)', backgroundSize: `${22 * view.z}px ${22 * view.z}px`, backgroundPosition: `${view.x}px ${view.y}px` }}
    >
      {/* World */}
      <div className="absolute left-0 top-0 origin-top-left" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.z})` }}>
        <svg className="pointer-events-none absolute overflow-visible" style={{ left: 0, top: 0 }} width={1} height={1}>
          <defs>
            <marker id="mm-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#64748b" />
            </marker>
          </defs>
          {placed
            .filter((p) => p.node.parentId && p.node.kind !== 'sticky')
            .map((p) => {
              const parent = byId.get(p.node.parentId!);
              if (!parent) return null;
              const towards = p.side === 'left' ? 'left' : 'right';
              const a = port(parent, towards);
              const c = port(p, towards === 'right' ? 'left' : 'right');
              return <path key={`c-${p.node.id}`} d={curve(a, c)} fill="none" stroke={p.node.color ?? '#94a3b8'} strokeWidth={2.4} strokeLinecap="round" />;
            })}
          {edges.map((e) => {
            const a = byId.get(e.from);
            const c = byId.get(e.to);
            if (!a || !c) return null;
            const ac = { x: a.x + a.w / 2, y: a.y + a.h / 2 };
            const cc = { x: c.x + c.w / 2, y: c.y + c.h / 2 };
            return <path key={e.id} d={`M ${ac.x} ${ac.y} Q ${(ac.x + cc.x) / 2} ${Math.min(ac.y, cc.y) - 60}, ${cc.x} ${cc.y}`} fill="none" stroke="#64748b" strokeWidth={1.8} strokeDasharray="5 4" markerEnd="url(#mm-arrow)" />;
          })}
        </svg>
        {placed.map(renderNode)}
      </div>

      {/* Canvas toolbar */}
      <div className="absolute left-3 top-3 flex items-center gap-0.5 rounded-xl border border-line bg-white p-1 shadow-sm" onPointerDown={(e) => e.stopPropagation()}>
        <ToolBtn t="select" label="Select (V)" icon={<MousePointer2 size={16} />} />
        <ToolBtn t="hand" label="Pan (H)" icon={<Hand size={16} />} />
        {editable && <ToolBtn t="sticky" label="Sticky note — click on the canvas" icon={<StickyNote size={16} />} />}
        {editable && <ToolBtn t="connect" label="Connector — click two topics" icon={<Spline size={16} />} />}
        {editable && (
          <>
            <span className="mx-1 h-5 w-px bg-line" />
            <Tip label="Undo (Ctrl+Z)">
              <button aria-label="Undo" onClick={() => actions.undo()} className="flex size-8 items-center justify-center rounded-lg text-ink-2 hover:bg-hover">
                <Undo2 size={16} />
              </button>
            </Tip>
            <Tip label="Redo (Ctrl+Y)">
              <button aria-label="Redo" onClick={() => actions.redo()} className="flex size-8 items-center justify-center rounded-lg text-ink-2 hover:bg-hover">
                <Redo2 size={16} />
              </button>
            </Tip>
          </>
        )}
      </div>
      {connectFrom && <div className="absolute left-1/2 top-3 -translate-x-1/2 rounded-full bg-ink px-3 py-1 text-[12px] text-white">Now click the topic to connect to</div>}

      {/* Selection toolbar */}
      {sel && selNode && editable && !editing && !drag && (
        <div
          className="absolute z-10 flex items-center gap-0.5 rounded-xl border border-line bg-white p-1 shadow-[var(--shadow-pop)]"
          style={{ left: view.x + (sel.x + sel.w / 2) * view.z, top: view.y + sel.y * view.z - 48, transform: 'translateX(-50%)' }}
          onPointerDown={(e) => e.stopPropagation()}
          data-testid="mind-toolbar"
        >
          {(selNode.kind === 'sticky' ? STICKY_COLORS : BRANCH_COLORS.slice(0, 6)).map((c) => (
            <button key={c} aria-label={`Colour ${c}`} onClick={() => actions.update(selNode.id, { color: c })} className={cn('size-5 rounded-full border border-black/10', selNode.color === c && 'ring-2 ring-brand-600 ring-offset-1')} style={{ background: c }} />
          ))}
          <span className="mx-1 h-5 w-px bg-line" />
          {selNode.kind !== 'sticky' && selNode.kind !== 'link' && (
            <>
              <Tip label="Add child (Tab)">
                <button aria-label="Add child" onClick={() => { const id = actions.addChild(selNode.id); if (id) (setSelected(id), setEditing({ id, field: 'text' })); }} className="flex size-7 items-center justify-center rounded-md hover:bg-hover">
                  <Plus size={15} />
                </button>
              </Tip>
              {selNode.kind === 'topic' && (
                <Tip label="Edit notes">
                  <button aria-label="Edit notes" onClick={() => (selNode.notes?.length ? setEditing({ id: selNode.id, field: 'notes' }) : actions.update(selNode.id, { notes: ['New point'] }))} className="flex size-7 items-center justify-center rounded-md hover:bg-hover">
                    <ListPlus size={15} />
                  </button>
                </Tip>
              )}
              <Tip label="Attach a file from Drive">
                <button aria-label="Attach file" onClick={() => onAttach(selNode.id)} className="flex size-7 items-center justify-center rounded-md hover:bg-hover">
                  <Paperclip size={15} />
                </button>
              </Tip>
            </>
          )}
          {selNode.kind !== 'root' && (
            <Tip label="Delete (Del)">
              <button aria-label="Delete topic" onClick={() => (actions.remove(selNode.id), setSelected(null))} className="flex size-7 items-center justify-center rounded-md text-red-600 hover:bg-red-50">
                <Trash2 size={15} />
              </button>
            </Tip>
          )}
        </div>
      )}

      {/* Empty state */}
      {!hasMap && (
        <div className="absolute inset-x-0 bottom-24 flex justify-center" onPointerDown={(e) => e.stopPropagation()}>
          <div className="rounded-xl border border-line bg-white px-5 py-3 text-center shadow-sm">
            <div className="text-[13px] text-ink-2">Build the map from scratch with Tab / Enter — or generate it from your notes.</div>
            {editable && (
              <button onClick={onConvert} className="mt-2 text-[13px] font-semibold text-brand-600 hover:underline">
                Convert notes to mind map
              </button>
            )}
          </div>
        </div>
      )}

      {/* Minimap + zoom */}
      <div className="absolute bottom-3 right-3 rounded-xl border border-line bg-white p-2 shadow-sm" onPointerDown={(e) => e.stopPropagation()}>
        <svg
          width={mini.w}
          height={mini.h}
          className="cursor-pointer rounded-md bg-canvas"
          onClick={(e) => {
            const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
            const wx = (e.clientX - r.left) / ms + b.x - 100;
            const wy = (e.clientY - r.top) / ms + b.y - 100;
            setView((v) => ({ ...v, x: vpW / 2 - wx * v.z, y: vpH / 2 - wy * v.z }));
          }}
          aria-label="Minimap"
        >
          {placed.map((p) => {
            const m = toMini(p.x, p.y);
            return <rect key={p.node.id} x={m.x} y={m.y} width={Math.max(3, p.w * ms)} height={Math.max(2, p.h * ms)} rx={2} fill={p.node.kind === 'root' ? '#2563eb' : p.node.kind === 'sticky' ? '#facc15' : p.node.color ?? '#94a3b8'} opacity={0.8} />;
          })}
          {(() => {
            const tl = toMini(-view.x / view.z, -view.y / view.z);
            return <rect x={tl.x} y={tl.y} width={(vpW / view.z) * ms} height={(vpH / view.z) * ms} fill="none" stroke="#2563eb" strokeWidth={1.5} rx={2} />;
          })()}
        </svg>
        <div className="mt-1.5 flex items-center justify-between text-[12px] text-muted">
          <button aria-label="Zoom out" onClick={() => setView((v) => ({ ...v, z: Math.max(0.25, v.z * 0.85) }))} className="rounded p-0.5 hover:bg-hover">
            <Minus size={14} />
          </button>
          <span data-testid="mind-zoom">{Math.round(view.z * 100)}%</span>
          <button aria-label="Zoom in" onClick={() => setView((v) => ({ ...v, z: Math.min(2.5, v.z * 1.15) }))} className="rounded p-0.5 hover:bg-hover">
            <Plus size={14} />
          </button>
          <button aria-label="Fit to screen" onClick={fit} className="rounded p-0.5 hover:bg-hover">
            <Maximize2 size={13} />
          </button>
        </div>
      </div>
    </div>
  );
}
