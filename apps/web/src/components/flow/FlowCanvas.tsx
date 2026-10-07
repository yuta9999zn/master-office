'use client';

import { labelPoint, nearestSide, pathD, port, routePoints, SIDES, shapeDef, type FlowEdge, type FlowNode, type PlainFlow, type Side } from '@workos/flow-model';
import { useEffect, useRef, useState } from 'react';
import { cn } from '../ui/primitives';
import type { FlowStore } from './flow-store';
import { EdgeShape, NodeShape } from './render';

export type Tool = 'select' | 'connect' | 'hand';
export interface ViewBox {
  x: number;
  y: number;
  zoom: number;
}
export interface Selection {
  nodes: string[];
  edges: string[];
}
export interface Peer {
  clientId: number;
  name: string;
  color: string;
  cursor: { x: number; y: number } | null;
  sel: string[];
}

const GRID = 10;
const snap = (v: number) => Math.round(v / GRID) * GRID;
type Box = { x: number; y: number; w: number; h: number };
type Drag =
  | { kind: 'move'; ids: string[]; x0: number; y0: number; dx: number; dy: number; moved: boolean }
  | { kind: 'resize'; id: string; handle: string; orig: Box; box: Box }
  | { kind: 'marquee'; x0: number; y0: number; x1: number; y1: number; add: boolean }
  | { kind: 'pan'; cx: number; cy: number; vx: number; vy: number }
  | { kind: 'connect'; from: string; side: Side | null; x: number; y: number; over: string | null };

const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

/** The drawing surface of one page (§77). */
export function FlowCanvas({
  store,
  flow,
  page,
  editable,
  tool,
  view,
  setView,
  sel,
  setSel,
  peers,
  onCursor,
  editing,
  setEditing,
}: {
  store: FlowStore;
  flow: PlainFlow;
  page: string;
  editable: boolean;
  tool: Tool;
  view: ViewBox;
  setView: (v: ViewBox | ((v: ViewBox) => ViewBox)) => void;
  sel: Selection;
  setSel: (s: Selection) => void;
  peers: Peer[];
  onCursor: (p: { x: number; y: number } | null) => void;
  editing: { kind: 'node' | 'edge'; id: string } | null;
  setEditing: (e: { kind: 'node' | 'edge'; id: string } | null) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  dragRef.current = drag;
  const [hover, setHover] = useState<string | null>(null);
  const [space, setSpace] = useState(false);
  const nodes = flow.nodes.filter((n) => n.page === page);
  const edges = flow.edges.filter((e) => e.page === page);
  const byId = new Map(nodes.map((n) => [n.id, n]));

  const world = (cx: number, cy: number) => {
    const r = box.current!.getBoundingClientRect();
    return { x: (cx - r.left - view.x) / view.zoom, y: (cy - r.top - view.y) / view.zoom };
  };
  /** A node as it looks right now (with the move / resize in progress). */
  const live = (n: FlowNode): FlowNode => {
    if (drag?.kind === 'move' && drag.ids.includes(n.id)) return { ...n, x: n.x + drag.dx, y: n.y + drag.dy };
    if (drag?.kind === 'resize' && drag.id === n.id) return { ...n, ...drag.box };
    return n;
  };
  const nodeAt = (p: { x: number; y: number }, except?: string) =>
    [...nodes]
      .sort((a, b) => b.z - a.z)
      .find((n) => n.id !== except && p.x >= n.x && p.x <= n.x + n.w && p.y >= n.y && p.y <= n.y + n.h && !(n.shape === 'container' || n.shape === 'lane'));

  // Space held = hand tool.
  useEffect(() => {
    const down = (e: KeyboardEvent) => e.code === 'Space' && !(e.target as HTMLElement).closest('input, textarea, [contenteditable]') && (e.preventDefault(), setSpace(true));
    const up = (e: KeyboardEvent) => e.code === 'Space' && setSpace(false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => (window.removeEventListener('keydown', down), window.removeEventListener('keyup', up));
  }, []);

  // Wheel: scroll pans, Ctrl / ⌘ + wheel zooms around the pointer.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) {
        setView((v) => {
          const zoom = Math.max(0.2, Math.min(3, v.zoom * Math.exp(-e.deltaY * 0.0015)));
          const px = e.clientX - r.left;
          const py = e.clientY - r.top;
          return { zoom, x: px - ((px - v.x) / v.zoom) * zoom, y: py - ((py - v.y) / v.zoom) * zoom };
        });
      } else setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, [setView]);

  // Pointer moves / ups during a gesture.
  useEffect(() => {
    if (!drag) return;
    const move = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const p = world(e.clientX, e.clientY);
      if (d.kind === 'pan') setView((v) => ({ ...v, x: d.vx + e.clientX - d.cx, y: d.vy + e.clientY - d.cy }));
      else if (d.kind === 'move') {
        const dx = snap(p.x - d.x0);
        const dy = snap(p.y - d.y0);
        if (dx !== d.dx || dy !== d.dy) setDrag({ ...d, dx, dy, moved: true });
      } else if (d.kind === 'resize') {
        const o = d.orig;
        let { x, y, w, h } = o;
        if (d.handle.includes('e')) w = Math.max(20, snap(p.x - o.x));
        if (d.handle.includes('s')) h = Math.max(20, snap(p.y - o.y));
        if (d.handle.includes('w')) (x = Math.min(o.x + o.w - 20, snap(p.x))), (w = o.x + o.w - x);
        if (d.handle.includes('n')) (y = Math.min(o.y + o.h - 20, snap(p.y))), (h = o.y + o.h - y);
        setDrag({ ...d, box: { x, y, w, h } });
      } else if (d.kind === 'marquee') setDrag({ ...d, x1: p.x, y1: p.y });
      else if (d.kind === 'connect') setDrag({ ...d, x: p.x, y: p.y, over: nodeAt(p, d.from)?.id ?? null });
    };
    const up = () => {
      const d = dragRef.current;
      setDrag(null);
      if (!d) return;
      if (d.kind === 'move' && d.moved && (d.dx || d.dy))
        store.updateNodes(d.ids.map((id) => ({ id, x: byId.get(id)!.x + d.dx, y: byId.get(id)!.y + d.dy })));
      if (d.kind === 'resize') store.updateNode(d.id, d.box);
      if (d.kind === 'marquee') {
        const x0 = Math.min(d.x0, d.x1);
        const x1 = Math.max(d.x0, d.x1);
        const y0 = Math.min(d.y0, d.y1);
        const y1 = Math.max(d.y0, d.y1);
        const inside = nodes.filter((n) => n.x >= x0 && n.x + n.w <= x1 && n.y >= y0 && n.y + n.h <= y1).map((n) => n.id);
        if (Math.abs(d.x1 - d.x0) > 3 || Math.abs(d.y1 - d.y0) > 3) setSel({ nodes: d.add ? [...new Set([...sel.nodes, ...inside])] : inside, edges: d.add ? sel.edges : [] });
      }
      if (d.kind === 'connect') {
        const from = byId.get(d.from);
        if (!from) return;
        const target = d.over ? byId.get(d.over) : null;
        if (target) {
          const id = store.addEdge(page, from.id, target.id, d.side, nearestSide(target, { x: d.x, y: d.y }));
          setSel({ nodes: [], edges: [id] });
        } else if (Math.hypot(d.x - (from.x + from.w / 2), d.y - (from.y + from.h / 2)) > Math.max(from.w, from.h)) {
          // Dropped on empty canvas: a new step there, connected.
          const def = shapeDef('process');
          const nid = store.addNode(page, 'process', snap(d.x - def.w / 2), snap(d.y - def.h / 2), { text: 'New step' });
          store.addEdge(page, from.id, nid, d.side, null);
          setSel({ nodes: [nid], edges: [] });
          setEditing({ kind: 'node', id: nid });
        }
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => (window.removeEventListener('pointermove', move), window.removeEventListener('pointerup', up));
  }, [drag?.kind]); // eslint-disable-line react-hooks/exhaustive-deps

  const startNode = (n: FlowNode, e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    if (tool === 'hand' || space) return startPan(e);
    const p = world(e.clientX, e.clientY);
    if (tool === 'connect' && editable) return setDrag({ kind: 'connect', from: n.id, side: null, x: p.x, y: p.y, over: null });
    let ids = sel.nodes;
    if (e.shiftKey) {
      ids = ids.includes(n.id) ? ids.filter((x) => x !== n.id) : [...ids, n.id];
      setSel({ nodes: ids, edges: sel.edges });
      return;
    }
    if (!ids.includes(n.id)) {
      ids = [n.id];
      setSel({ nodes: ids, edges: [] });
    }
    if (editable) setDrag({ kind: 'move', ids, x0: p.x, y0: p.y, dx: 0, dy: 0, moved: false });
  };
  const startPan = (e: React.PointerEvent) => setDrag({ kind: 'pan', cx: e.clientX, cy: e.clientY, vx: view.x, vy: view.y });
  const startBackground = (e: React.PointerEvent) => {
    if (e.button === 1 || tool === 'hand' || space) return startPan(e);
    if (e.button !== 0) return;
    const p = world(e.clientX, e.clientY);
    if (!e.shiftKey) setSel({ nodes: [], edges: [] });
    setEditing(null);
    setDrag({ kind: 'marquee', x0: p.x, y0: p.y, x1: p.x, y1: p.y, add: e.shiftKey });
  };

  const selected = new Set(sel.nodes);
  const single = sel.nodes.length === 1 && !sel.edges.length ? byId.get(sel.nodes[0]) : undefined;
  const peerSel = new Map<string, Peer>();
  for (const p of peers) for (const id of p.sel) peerSel.set(id, p);
  const order = [...nodes].sort((a, b) => a.z - b.z);
  const editingNode = editing?.kind === 'node' ? byId.get(editing.id) : undefined;
  const editingEdge = editing?.kind === 'edge' ? edges.find((x) => x.id === editing.id) : undefined;
  const cursor = drag?.kind === 'pan' ? 'grabbing' : tool === 'hand' || space ? 'grab' : tool === 'connect' ? 'crosshair' : 'default';

  return (
    <div
      ref={box}
      className="relative h-full w-full overflow-hidden"
      style={{
        cursor,
        backgroundColor: '#fbfcfe',
        backgroundImage: 'radial-gradient(#d7dde8 1px, transparent 1px)',
        backgroundSize: `${20 * view.zoom}px ${20 * view.zoom}px`,
        backgroundPosition: `${view.x}px ${view.y}px`,
      }}
      onPointerMove={(e) => onCursor(world(e.clientX, e.clientY))}
      onPointerLeave={() => onCursor(null)}
      onDragOver={(e) => editable && e.dataTransfer.types.includes('application/x-flow-shape') && e.preventDefault()}
      onDrop={(e) => {
        const shape = e.dataTransfer.getData('application/x-flow-shape');
        if (!shape || !editable) return;
        e.preventDefault();
        const p = world(e.clientX, e.clientY);
        const def = shapeDef(shape);
        const id = store.addNode(page, shape, snap(p.x - def.w / 2), snap(p.y - def.h / 2));
        setSel({ nodes: [id], edges: [] });
      }}
      data-testid="flow-canvas"
    >
      <svg className="absolute inset-0 h-full w-full" onPointerDown={startBackground} onDoubleClick={(e) => {
        if (!editable || e.target !== e.currentTarget) return;
        const p = world(e.clientX, e.clientY);
        const id = store.addNode(page, 'process', snap(p.x - 90), snap(p.y - 28), { text: '' });
        setSel({ nodes: [id], edges: [] });
        setEditing({ kind: 'node', id });
      }}>
        <g transform={`translate(${view.x},${view.y}) scale(${view.zoom})`}>
          {/* Containers first, then edges, then the other shapes (by z). */}
          {order
            .filter((n) => n.shape === 'container' || n.shape === 'lane')
            .map((n) => (
              <NodeG key={n.id} n={live(n)} selected={selected.has(n.id)} peer={peerSel.get(n.id)} hideText={editingNode?.id === n.id} onDown={(e) => startNode(n, e)} onDouble={() => editable && setEditing({ kind: 'node', id: n.id })} onHover={setHover} />
            ))}
          {edges.map((e) => {
            const a = byId.get(e.from);
            const b = byId.get(e.to);
            if (!a || !b) return null;
            const on = sel.edges.includes(e.id);
            const la = live(a);
            const lb = live(b);
            const pts = routePoints(la, lb, { ...e, route: e.style.route });
            return (
              <g key={e.id}>
                <EdgeShape e={e} a={la} b={lb} selected={on} labelEditing={editingEdge?.id === e.id} />
                <path
                  d={pathD(pts, e.style.route)}
                  fill="none"
                  stroke="transparent"
                  strokeWidth={12 / view.zoom}
                  style={{ cursor: 'pointer' }}
                  onPointerDown={(ev) => {
                    ev.stopPropagation();
                    if (ev.button !== 0) return;
                    setSel(ev.shiftKey ? { nodes: sel.nodes, edges: on ? sel.edges.filter((x) => x !== e.id) : [...sel.edges, e.id] } : { nodes: [], edges: [e.id] });
                  }}
                  onDoubleClick={(ev) => (ev.stopPropagation(), editable && setEditing({ kind: 'edge', id: e.id }))}
                  data-testid="edge-hit"
                  data-edge={e.id}
                />
              </g>
            );
          })}
          {order
            .filter((n) => n.shape !== 'container' && n.shape !== 'lane')
            .map((n) => (
              <NodeG key={n.id} n={live(n)} selected={selected.has(n.id)} peer={peerSel.get(n.id)} hideText={editingNode?.id === n.id} onDown={(e) => startNode(n, e)} onDouble={() => editable && setEditing({ kind: 'node', id: n.id })} onHover={setHover} />
            ))}

          {/* Connector being drawn */}
          {drag?.kind === 'connect' &&
            (() => {
              const from = byId.get(drag.from)!;
              const target = drag.over ? byId.get(drag.over) : null;
              const pts = target ? routePoints(from, target, { fromSide: drag.side, toSide: nearestSide(target, drag) }) : routePoints(from, { x: drag.x, y: drag.y }, { fromSide: drag.side, toSide: null });
              return (
                <>
                  {target && <rect x={target.x - 4} y={target.y - 4} width={target.w + 8} height={target.h + 8} rx={8} fill="none" stroke="#3b82f6" strokeDasharray="4 3" />}
                  <path d={pathD(pts, 'orthogonal')} fill="none" stroke="#3b82f6" strokeWidth={1.5 / view.zoom} strokeDasharray="5 4" />
                </>
              );
            })()}

          {/* Selection: resize handles for one node */}
          {single && editable && !drag && (
            <g>
              {HANDLES.map((h) => {
                const n = live(single);
                const hx = h.includes('w') ? n.x : h.includes('e') ? n.x + n.w : n.x + n.w / 2;
                const hy = h.includes('n') ? n.y : h.includes('s') ? n.y + n.h : n.y + n.h / 2;
                const s = 8 / view.zoom;
                return (
                  <rect
                    key={h}
                    x={hx - s / 2}
                    y={hy - s / 2}
                    width={s}
                    height={s}
                    rx={1.5 / view.zoom}
                    fill="#fff"
                    stroke="#2563eb"
                    strokeWidth={1.2 / view.zoom}
                    style={{ cursor: `${h}-resize` }}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      setDrag({ kind: 'resize', id: single.id, handle: h, orig: { x: n.x, y: n.y, w: n.w, h: n.h }, box: { x: n.x, y: n.y, w: n.w, h: n.h } });
                    }}
                    data-testid="resize-handle"
                    data-handle={h}
                  />
                );
              })}
            </g>
          )}

          {/* Ports: drag one to draw a connector */}
          {editable &&
            tool !== 'hand' &&
            !drag &&
            [...new Set([hover, single?.id].filter((x): x is string => !!x))].map((id) => {
              const n = byId.get(id);
              if (!n) return null;
              return SIDES.map((side) => {
                const p = port(n, side);
                const off = 10 / view.zoom;
                const q = { x: p.x + (side === 'left' ? -off : side === 'right' ? off : 0), y: p.y + (side === 'top' ? -off : side === 'bottom' ? off : 0) };
                return (
                  <circle
                    key={`${id}${side}`}
                    cx={q.x}
                    cy={q.y}
                    r={5 / view.zoom}
                    fill="#fff"
                    stroke="#3b82f6"
                    strokeWidth={1.5 / view.zoom}
                    style={{ cursor: 'crosshair' }}
                    onPointerEnter={() => setHover(id)}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      const w = world(e.clientX, e.clientY);
                      setDrag({ kind: 'connect', from: id, side, x: w.x, y: w.y, over: null });
                    }}
                    data-testid="port"
                    data-node={id}
                    data-side={side}
                  />
                );
              });
            })}

          {drag?.kind === 'marquee' && (
            <rect x={Math.min(drag.x0, drag.x1)} y={Math.min(drag.y0, drag.y1)} width={Math.abs(drag.x1 - drag.x0)} height={Math.abs(drag.y1 - drag.y0)} fill="rgba(59,130,246,0.08)" stroke="#3b82f6" strokeWidth={1 / view.zoom} strokeDasharray="4 3" />
          )}

          {/* Other people */}
          {peers.map(
            (p) =>
              p.cursor && (
                <g key={p.clientId} transform={`translate(${p.cursor.x},${p.cursor.y}) scale(${1 / view.zoom})`} style={{ pointerEvents: 'none' }} data-testid="peer-cursor">
                  <path d="M0,0 L0,16 L4.5,12 L8,19 L10.5,18 L7,11 L13,11 Z" fill={p.color} stroke="#fff" strokeWidth={1} />
                  <g transform="translate(12,18)">
                    <rect width={p.name.length * 6.6 + 10} height={18} rx={4} fill={p.color} />
                    <text x={5} y={13} fontSize={11} fill="#fff" fontFamily="Inter, sans-serif">
                      {p.name}
                    </text>
                  </g>
                </g>
              ),
          )}
        </g>
      </svg>

      {editingNode && <TextEditor key={editingNode.id} n={editingNode} view={view} onDone={(text) => (text !== null && store.updateNode(editingNode.id, { text }), setEditing(null))} />}
      {editingEdge &&
        (() => {
          const a = byId.get(editingEdge.from);
          const b = byId.get(editingEdge.to);
          if (!a || !b) return null;
          const pts = routePoints(a, b, { ...editingEdge, route: editingEdge.style.route });
          const at = labelPoint(pts);
          return <LabelEditor key={editingEdge.id} e={editingEdge} at={{ x: at.x * view.zoom + view.x, y: at.y * view.zoom + view.y }} onDone={(label) => (label !== null && store.updateEdge(editingEdge.id, { label }), setEditing(null))} />;
        })()}
    </div>
  );
}

function NodeG({ n, selected, peer, hideText, onDown, onDouble, onHover }: { n: FlowNode; selected: boolean; peer?: Peer; hideText: boolean; onDown: (e: React.PointerEvent) => void; onDouble: () => void; onHover: (id: string | null) => void }) {
  return (
    <g
      transform={`translate(${n.x},${n.y})`}
      onPointerDown={onDown}
      onDoubleClick={(e) => (e.stopPropagation(), onDouble())}
      onPointerEnter={() => onHover(n.id)}
      onPointerLeave={() => onHover(null)}
      style={{ cursor: 'move' }}
      data-testid="flow-node"
      data-node={n.id}
      data-text={n.text}
      data-shape={n.shape}
    >
      <NodeShape n={n} hideText={hideText} />
      {selected && <rect x={-3} y={-3} width={n.w + 6} height={n.h + 6} rx={6} fill="none" stroke="#2563eb" strokeWidth={1.5} strokeDasharray="0" pointerEvents="none" />}
      {peer && !selected && <rect x={-4} y={-4} width={n.w + 8} height={n.h + 8} rx={7} fill="none" stroke={peer.color} strokeWidth={2} pointerEvents="none" />}
    </g>
  );
}

function TextEditor({ n, view, onDone }: { n: FlowNode; view: ViewBox; onDone: (text: string | null) => void }) {
  const [v, setV] = useState(n.text);
  const done = useRef(false);
  const finish = (t: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(t);
  };
  const s = n.style;
  return (
    <textarea
      autoFocus
      value={v}
      onChange={(e) => setV(e.target.value)}
      onFocus={(e) => e.currentTarget.select()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') finish(null);
        if (e.key === 'Enter' && !e.shiftKey) (e.preventDefault(), finish(v));
      }}
      onBlur={() => finish(v)}
      className={cn('absolute z-20 resize-none rounded-md border-2 border-brand-500 bg-white/95 p-1 outline-none')}
      style={{
        left: n.x * view.zoom + view.x,
        top: n.y * view.zoom + view.y,
        width: n.w * view.zoom,
        height: n.h * view.zoom,
        fontSize: s.fontSize * view.zoom,
        fontFamily: s.fontFamily,
        fontWeight: s.bold ? 600 : 500,
        textAlign: s.align,
        color: s.textColor,
        lineHeight: 1.25,
      }}
      aria-label="Shape text"
      data-testid="node-text-editor"
    />
  );
}

function LabelEditor({ e, at, onDone }: { e: FlowEdge; at: { x: number; y: number }; onDone: (label: string | null) => void }) {
  const [v, setV] = useState(e.label);
  const done = useRef(false);
  const finish = (t: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(t);
  };
  return (
    <input
      autoFocus
      value={v}
      onChange={(ev) => setV(ev.target.value)}
      onKeyDown={(ev) => {
        ev.stopPropagation();
        if (ev.key === 'Escape') finish(null);
        if (ev.key === 'Enter') finish(v);
      }}
      onBlur={() => finish(v)}
      placeholder="Label"
      className="absolute z-20 h-7 w-32 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-brand-500 bg-white px-2 text-center text-[12px] outline-none"
      style={{ left: at.x, top: at.y }}
      aria-label="Connector label"
      data-testid="edge-label-editor"
    />
  );
}
