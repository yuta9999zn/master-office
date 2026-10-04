'use client';

import type { Editor } from '@tiptap/react';
import { isLine, isOpenStroke, mediaHtml, PLACEHOLDER_PROMPT, resolveConnectors, sitePoint, slideHtml, type ConnSite, type Connector, type DeckSize, type PlainElement, type PlainSlide, type Theme } from '@workos/slide-model';
import { DrawLayer, type Drawn, type DrawTool } from './DrawLayer';
import { MessageSquare, X } from 'lucide-react';
import { ContextMenu as CM } from 'radix-ui';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { cn } from '../ui/primitives';
import type { DeckStore } from './deck-store';
import { TextEditor } from './TextEditor';

export interface RemoteSelection {
  clientId: number;
  name: string;
  color: string;
  slideId: string | null;
  sel: string[];
  editing: string | null;
}

type Box = { x: number; y: number; w: number; h: number; rot: number };
type Drag =
  | { kind: 'move'; start: { x: number; y: number }; boxes: Map<string, Box>; moved: boolean }
  | { kind: 'resize'; id: string; handle: string; box: Box; aspect: boolean }
  | { kind: 'rotate'; id: string; box: Box }
  | { kind: 'line'; id: string; end: 'start' | 'end'; box: Box; flipH: boolean; flipV: boolean; conn?: Connector }
  | { kind: 'scale'; handle: string; union: Box; boxes: Map<string, Box> }
  | { kind: 'marquee'; start: { x: number; y: number }; additive: string[] };

const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const;
const CURSOR: Record<string, string> = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize' };

const rad = (d: number) => (d * Math.PI) / 180;
const rotate = (x: number, y: number, deg: number) => {
  const c = Math.cos(rad(deg));
  const s = Math.sin(rad(deg));
  return { x: x * c - y * s, y: x * s + y * c };
};
const boxOf = (e: PlainElement): Box => ({ x: e.x, y: e.y, w: e.w, h: e.h, rot: e.rot ?? 0 });

const SITES: ConnSite[] = ['n', 'e', 's', 'w'];

export function SlideCanvas({
  store,
  slide: rawSlide,
  deck,
  zoom,
  selection,
  setSelection,
  editing,
  setEditing,
  editable,
  remote,
  comments,
  onEditorReady,
  onOpenFormat,
  onComment,
  onTableCell,
  contextMenu,
  onFitScale,
  selectAllOnEdit,
  draw,
  onDrawn,
  onDrawCancel,
}: {
  store: DeckStore;
  slide: PlainSlide;
  deck: { size: DeckSize; theme: Theme };
  zoom: number | 'fit';
  selection: string[];
  setSelection: (ids: string[]) => void;
  editing: string | null;
  setEditing: (id: string | null) => void;
  editable: boolean;
  remote: RemoteSelection[];
  comments: Map<string, number>;
  onEditorReady: (e: Editor | null) => void;
  onOpenFormat: (id: string) => void;
  onComment: (elementId: string) => void;
  onTableCell: (cell: { r: number; c: number } | null) => void;
  contextMenu: () => ReactNode;
  onFitScale: (k: number) => void;
  selectAllOnEdit: boolean;
  /** Line ▸ Curve / Polyline / Scribble in progress. */
  draw?: DrawTool | null;
  onDrawn?: (d: Drawn) => void;
  onDrawCancel?: () => void;
}) {
  // Connectors attached to shapes are drawn (and hit-tested) where their shapes are now.
  const slide = useMemo(() => resolveConnectors(rawSlide), [rawSlide]);
  const viewport = useRef<HTMLDivElement>(null);
  // While a line end is dragged: the shape whose connection points are shown, and the point it snapped to.
  const [siteHint, setSiteHint] = useState<{ id: string; site: ConnSite | null } | null>(null);
  const page = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(0.5);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [guides, setGuides] = useState<{ x: number[]; y: number[] }>({ x: [], y: [] });
  // A group "entered" by double-click: its members are then picked one by one (like Google Slides).
  const [inGroup, setInGroup] = useState<string | null>(null);
  // Video / audio being played in place (double-click, like Google Slides' play button).
  const [playingMedia, setPlayingMedia] = useState<string | null>(null);
  useEffect(() => {
    if (playingMedia && !selection.includes(playingMedia)) setPlayingMedia(null);
  }, [selection, playingMedia]);
  useEffect(() => setPlayingMedia(null), [slide.id]);
  const pending = useRef<{ id: string; patch: Record<string, unknown> }[] | null>(null);
  const raf = useRef(0);
  const { w: W, h: H } = deck.size;

  // Fit the slide into the viewport (zoom "fit") and report the scale for the status bar.
  useLayoutEffect(() => {
    const el = viewport.current;
    if (!el) return;
    // Fit mode has no scrollbars (overflow hidden) and ignores sub-pixel changes: otherwise, at fractional
    // display scales, a scrollbar appearing/disappearing changes the viewport, which changes the fit, which
    // toggles the scrollbar again — the slide visibly shakes.
    let last = { w: -1, h: -1 };
    const measure = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (Math.abs(w - last.w) < 1 && Math.abs(h - last.h) < 1) return;
      last = { w, h };
      const k = Math.max(0.1, Math.floor(Math.min((w - 66) / W, (h - 66) / H) * 1000) / 1000);
      setFit(k);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [W, H]);
  const k = zoom === 'fit' ? fit : zoom;
  useEffect(() => onFitScale(k), [k]); // eslint-disable-line react-hooks/exhaustive-deps

  const html = useMemo(() => slideHtml(slide, deck, { prompts: editable, skipText: editing ? new Set([editing]) : undefined }), [slide, deck, editable, editing]);
  const byId = useMemo(() => new Map(slide.elements.map((e) => [e.id, e])), [slide]);
  const selected = selection.map((id) => byId.get(id)).filter((e): e is PlainElement => !!e);
  /** What a click on an element selects: its whole group, unless that group was entered. */
  const unitOf = (id: string) => {
    const g = byId.get(id)?.group;
    return g && g !== inGroup ? slide.elements.filter((e) => e.group === g).map((e) => e.id) : [id];
  };
  // One whole group selected → a single box that scales every member.
  const groupBox = (() => {
    const g = selected[0]?.group;
    if (!g || g === inGroup || selected.length < 2 || !selected.every((e) => e.group === g)) return null;
    if (slide.elements.filter((e) => e.group === g).length !== selected.length) return null;
    const x = Math.min(...selected.map((e) => e.x));
    const y = Math.min(...selected.map((e) => e.y));
    return { x, y, w: Math.max(...selected.map((e) => e.x + e.w)) - x, h: Math.max(...selected.map((e) => e.y + Math.max(e.h, 1))) - y, rot: 0 };
  })();

  const toSlide = (e: { clientX: number; clientY: number }) => {
    const r = page.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / k, y: (e.clientY - r.top) / k };
  };

  const flush = () => {
    raf.current = 0;
    if (pending.current) store.updateElements(slide.id, pending.current);
    pending.current = null;
  };
  const write = (patches: { id: string; patch: Record<string, unknown> }[]) => {
    pending.current = patches;
    if (!raf.current) raf.current = requestAnimationFrame(flush);
  };

  // ── Snapping ─────────────────────────────────────────────────────────────
  const snap = (moving: Set<string>, b: { x: number; y: number; w: number; h: number }) => {
    const thr = 6 / k;
    const xs = [0, W / 2, W];
    const ys = [0, H / 2, H];
    for (const e of slide.elements) {
      if (moving.has(e.id) || e.rot) continue;
      xs.push(e.x, e.x + e.w / 2, e.x + e.w);
      ys.push(e.y, e.y + e.h / 2, e.y + e.h);
    }
    const best = (edges: number[], cands: number[]) => {
      let d = Infinity;
      let line: number | null = null;
      for (const c of cands) for (const ed of edges) if (Math.abs(c - ed) < Math.abs(d) && Math.abs(c - ed) < thr) ((d = c - ed), (line = c));
      return { d: Number.isFinite(d) ? d : 0, line };
    };
    const sx = best([b.x, b.x + b.w / 2, b.x + b.w], xs);
    const sy = best([b.y, b.y + b.h / 2, b.y + b.h], ys);
    return { dx: sx.d, dy: sy.d, gx: sx.line === null ? [] : [sx.line], gy: sy.line === null ? [] : [sy.line] };
  };

  // ── Pointer handling ─────────────────────────────────────────────────────
  const startMove = (e: React.PointerEvent, id: string) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    if (editing && editing !== id) setEditing(null);
    if (inGroup && byId.get(id)?.group !== inGroup) setInGroup(null);
    const unit = byId.get(id)?.group === inGroup && inGroup ? [id] : unitOf(id);
    const has = unit.every((u) => selection.includes(u));
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      setSelection(has ? selection.filter((s) => !unit.includes(s)) : [...new Set([...selection, ...unit])]);
      return;
    }
    const sel = has ? selection : unit;
    if (!has) setSelection(sel);
    if (!editable) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    store.beginGesture();
    setDrag({ kind: 'move', start: toSlide(e), boxes: new Map(sel.map((s) => [s, boxOf(byId.get(s)!)])), moved: false });
  };

  const startHandle = (e: React.PointerEvent, el: PlainElement, handle: string) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    store.beginGesture();
    if (handle.startsWith('g-')) setDrag({ kind: 'scale', handle: handle.slice(2), union: groupBox!, boxes: new Map(selected.map((s) => [s.id, boxOf(s)])) });
    else if (handle === 'rot') setDrag({ kind: 'rotate', id: el.id, box: boxOf(el) });
    else if (handle === 'start' || handle === 'end') setDrag({ kind: 'line', id: el.id, end: handle, box: boxOf(el), flipH: !!el.flipH, flipV: !!el.flipV, conn: el.conn });
    else setDrag({ kind: 'resize', id: el.id, handle, box: boxOf(el), aspect: el.type === 'image' && handle.length === 2 });
  };

  const startMarquee = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    if (editing) setEditing(null);
    onTableCell(null);
    setInGroup(null);
    const additive = e.shiftKey ? selection : [];
    if (!e.shiftKey) setSelection([]);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDrag({ kind: 'marquee', start: toSlide(e), additive });
  };

  const onMove = (e: React.PointerEvent) => {
    if (!drag) return;
    const p = toSlide(e);
    if (drag.kind === 'move') {
      let dx = p.x - drag.start.x;
      let dy = p.y - drag.start.y;
      if (!drag.moved && Math.hypot(dx, dy) * k < 3) return;
      if (!drag.moved) setDrag({ ...drag, moved: true });
      if (e.shiftKey) Math.abs(dx) > Math.abs(dy) ? (dy = 0) : (dx = 0);
      const boxes = [...drag.boxes.values()];
      const union = {
        x: Math.min(...boxes.map((b) => b.x)) + dx,
        y: Math.min(...boxes.map((b) => b.y)) + dy,
        w: Math.max(...boxes.map((b) => b.x + b.w)) - Math.min(...boxes.map((b) => b.x)),
        h: Math.max(...boxes.map((b) => b.y + b.h)) - Math.min(...boxes.map((b) => b.y)),
      };
      const s = e.altKey ? { dx: 0, dy: 0, gx: [], gy: [] } : snap(new Set(drag.boxes.keys()), union);
      setGuides({ x: s.gx, y: s.gy });
      write(
        [...drag.boxes].map(([id, b]) => {
          const c = byId.get(id)?.conn;
          // A connector dragged away from its shapes lets go of them (kept when its shapes move along).
          const keep = (end?: { id: string }) => !!end && drag.boxes.has(end.id);
          const conn = c && (c.from || c.to) ? { kind: c.kind, ...(keep(c.from) ? { from: c.from } : {}), ...(keep(c.to) ? { to: c.to } : {}) } : undefined;
          return { id, patch: { x: b.x + dx + s.dx, y: b.y + dy + s.dy, ...(conn ? { conn } : {}) } };
        }),
      );
    } else if (drag.kind === 'resize') {
      const b = drag.box;
      const sx = drag.handle.includes('e') ? 1 : drag.handle.includes('w') ? -1 : 0;
      const sy = drag.handle.includes('s') ? 1 : drag.handle.includes('n') ? -1 : 0;
      const c = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
      // Anchor = the opposite handle, in slide space (stays fixed while resizing a rotated box).
      const ar = rotate((-sx * b.w) / 2, (-sy * b.h) / 2, b.rot);
      const anchor = { x: c.x + ar.x, y: c.y + ar.y };
      const local = rotate(p.x - anchor.x, p.y - anchor.y, -b.rot);
      let w = sx ? Math.max(8, local.x * sx) : b.w;
      let h = sy ? Math.max(8, local.y * sy) : b.h;
      if ((drag.aspect || e.shiftKey) && sx && sy) {
        const r = b.w / b.h;
        if (w / h > r) h = w / r;
        else w = h * r;
      }
      // New centre = anchor + half the new size along the handle's direction (edge handles: anchor is the opposite edge's midpoint).
      const off = rotate((sx * w) / 2, (sy * h) / 2, b.rot);
      const center = { x: anchor.x + off.x, y: anchor.y + off.y };
      write([{ id: drag.id, patch: { x: center.x - w / 2, y: center.y - h / 2, w, h } }]);
    } else if (drag.kind === 'rotate') {
      const b = drag.box;
      const c = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
      let deg = (Math.atan2(p.y - c.y, p.x - c.x) * 180) / Math.PI + 90;
      if (e.shiftKey) deg = Math.round(deg / 15) * 15;
      else if (Math.abs(((deg % 90) + 90) % 90) < 3) deg = Math.round(deg / 90) * 90;
      deg = ((deg % 360) + 360) % 360;
      write([{ id: drag.id, patch: { rot: deg ? Math.round(deg * 10) / 10 : undefined } }]);
    } else if (drag.kind === 'line') {
      const b = drag.box;
      const start = { x: drag.flipH ? b.x + b.w : b.x, y: drag.flipV ? b.y + b.h : b.y };
      const end = { x: drag.flipH ? b.x : b.x + b.w, y: drag.flipV ? b.y : b.y + b.h };
      let q = p;
      const other = drag.end === 'start' ? end : start;
      if (e.shiftKey) {
        // Constrain to 0 / 45 / 90°.
        const a = Math.round(Math.atan2(p.y - other.y, p.x - other.x) / (Math.PI / 4)) * (Math.PI / 4);
        const len = Math.hypot(p.x - other.x, p.y - other.y);
        q = { x: other.x + Math.cos(a) * len, y: other.y + Math.sin(a) * len };
      }
      // Snap to the nearest connection point (middle of a side) of another shape, like Google Slides' connectors.
      let target: { id: string; site: ConnSite } | null = null;
      let near: string | null = null;
      if (!e.altKey) {
        let best = 14 / k;
        let nearD = 60 / k;
        for (const o of slide.elements) {
          if (o.id === drag.id || (o.type === 'shape' && isLine(o.geom))) continue;
          for (const site of SITES) {
            const sp = sitePoint(o, site);
            const d = Math.hypot(sp.x - p.x, sp.y - p.y);
            if (d < best) ((best = d), (target = { id: o.id, site }));
            if (d < nearD) ((nearD = d), (near = o.id));
          }
          if (p.x >= o.x && p.x <= o.x + o.w && p.y >= o.y && p.y <= o.y + o.h && !near) near = o.id;
        }
      }
      const tgt = target as { id: string; site: ConnSite } | null;
      if (tgt) q = sitePoint(byId.get(tgt.id)!, tgt.site);
      setSiteHint(tgt ? { id: tgt.id, site: tgt.site } : near ? { id: near, site: null } : null);
      const key = drag.end === 'start' ? 'from' : 'to';
      const conn: Connector = { ...(drag.conn ?? {}), [key]: tgt ?? undefined };
      if (!conn[key]) delete conn[key];
      const s0 = drag.end === 'start' ? q : start;
      const e0 = drag.end === 'end' ? q : end;
      write([
        {
          id: drag.id,
          patch: { x: Math.min(s0.x, e0.x), y: Math.min(s0.y, e0.y), w: Math.abs(e0.x - s0.x), h: Math.abs(e0.y - s0.y), flipH: s0.x > e0.x || undefined, flipV: s0.y > e0.y || undefined, conn: conn.kind || conn.from || conn.to ? conn : undefined },
        },
      ]);
    } else if (drag.kind === 'scale') {
      // Scale the whole group from the opposite handle (members keep their relative layout).
      const u = drag.union;
      const sx = drag.handle.includes('e') ? 1 : drag.handle.includes('w') ? -1 : 0;
      const sy = drag.handle.includes('s') ? 1 : drag.handle.includes('n') ? -1 : 0;
      const ax = sx > 0 ? u.x : u.x + u.w;
      const ay = sy > 0 ? u.y : u.y + u.h;
      let w = sx ? Math.max(8, (p.x - ax) * sx) : u.w;
      let h = sy ? Math.max(8, (p.y - ay) * sy) : u.h;
      if (sx && sy) {
        const r = u.w / u.h;
        if (w / h > r) h = w / r;
        else w = h * r;
      }
      const nx = sx < 0 ? ax - w : sx > 0 ? ax : u.x;
      const ny = sy < 0 ? ay - h : sy > 0 ? ay : u.y;
      const kx = w / u.w;
      const ky = h / u.h;
      write([...drag.boxes].map(([id, b]) => ({ id, patch: { x: nx + (b.x - u.x) * kx, y: ny + (b.y - u.y) * ky, w: b.w * kx, h: b.h * ky } })));
    } else if (drag.kind === 'marquee') {
      const r = { x: Math.min(p.x, drag.start.x), y: Math.min(p.y, drag.start.y), w: Math.abs(p.x - drag.start.x), h: Math.abs(p.y - drag.start.y) };
      setMarquee(r);
      const hit = slide.elements.filter((el) => el.x < r.x + r.w && el.x + el.w > r.x && el.y < r.y + r.h && el.y + Math.max(el.h, 1) > r.y).flatMap((el) => unitOf(el.id));
      setSelection([...new Set([...drag.additive, ...hit])]);
    }
  };

  const onUp = () => {
    if (raf.current) {
      cancelAnimationFrame(raf.current);
      flush();
    }
    if (drag && drag.kind !== 'marquee') store.endGesture();
    setDrag(null);
    setMarquee(null);
    setSiteHint(null);
    setGuides({ x: [], y: [] });
  };

  const startEdit = (el: PlainElement) => {
    if (!editable) return;
    if (el.type === 'text' || (el.type === 'shape' && !isOpenStroke(el))) {
      setSelection([el.id]);
      setEditing(el.id);
    } else if (el.type === 'table') {
      setSelection([el.id]);
      setEditing(el.id);
    } else if (el.type === 'video' || el.type === 'audio') {
      // A double-click also selects the slide's content in the browser: that highlight would cover the player.
      window.getSelection()?.removeAllRanges();
      setSelection([el.id]);
      setPlayingMedia(el.id);
    } else onOpenFormat(el.id);
  };

  const editingEl = editing ? byId.get(editing) : undefined;
  const frag = editingEl && editingEl.type !== 'table' ? store.fragment(slide.id, editingEl.id) : null;
  const hs = 9 / k; // handle size in slide px

  const remoteHere = remote.filter((r) => r.slideId === slide.id);

  return (
    <CM.Root>
      <CM.Trigger asChild>
        <div ref={viewport} className={cn('relative min-h-0 min-w-0 flex-1', zoom === 'fit' ? 'overflow-hidden' : 'overflow-auto')} onPointerDown={startMarquee} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} data-testid="slide-viewport">
          <div className="flex min-h-full min-w-full items-center justify-center p-8" style={{ width: W * k + 64, height: H * k + 64 }}>
            <div ref={page} className="relative shrink-0 rounded-[3px] bg-white shadow-[0_4px_24px_-6px_rgba(15,23,42,0.25)]" style={{ width: W * k, height: H * k }} data-testid="slide-canvas">
              <div className="absolute left-0 top-0" style={{ width: W, height: H, transform: `scale(${k})`, transformOrigin: '0 0' }}>
                <div dangerouslySetInnerHTML={{ __html: html }} />
                {draw && onDrawn && onDrawCancel && <DrawLayer tool={draw} W={W} H={H} scale={k} onDone={onDrawn} onCancel={onDrawCancel} />}

                {/* Hit targets, one per element in z order (lines get a thicker grab area). */}
                <div className="absolute inset-0" style={{ zIndex: 10 }}>
                  {slide.elements.map((el) => {
                    if (el.id === editing && el.type !== 'chart' && el.type !== 'image') return null;
                    const line = el.type === 'shape' && isOpenStroke(el);
                    const pad = line ? 8 / k : 0;
                    return (
                      <div
                        key={el.id}
                        data-hit={el.id}
                        className={cn('absolute', editable ? 'cursor-move' : 'cursor-default')}
                        style={{ left: el.x - pad, top: el.y - pad, width: Math.max(el.w, 1) + pad * 2, height: Math.max(el.h, 1) + pad * 2, transform: el.rot ? `rotate(${el.rot}deg)` : undefined }}
                        onPointerDown={(e) => startMove(e, el.id)}
                        onDoubleClick={(e) => {
                          e.stopPropagation();
                          // First double-click on a group enters it and picks this member; the next one edits.
                          if (el.group && inGroup !== el.group) {
                            setInGroup(el.group);
                            setSelection([el.id]);
                          } else startEdit(el);
                        }}
                        onContextMenu={() => !selection.includes(el.id) && setSelection([el.id])}
                      />
                    );
                  })}
                </div>

                {/* Video / audio playing in place */}
                {playingMedia &&
                  byId.get(playingMedia) &&
                  (() => {
                    const el = byId.get(playingMedia)!;
                    return (
                      <div
                        className="absolute select-none"
                        style={{ left: el.x, top: el.y, width: el.w, height: el.h, zIndex: 25, transform: el.rot ? `rotate(${el.rot}deg)` : undefined }}
                        onPointerDown={(e) => e.stopPropagation()}
                        data-testid="media-player"
                      >
                        <div className="h-full w-full" dangerouslySetInnerHTML={{ __html: mediaHtml({ ...el, media: { ...el.media, autoplay: true } }, { live: true }) }} />
                        <button
                          className="absolute flex items-center justify-center rounded-full bg-slate-900/80 text-white hover:bg-slate-900"
                          style={{ right: -40 / k, top: 0, width: 28 / k, height: 28 / k }}
                          onClick={() => setPlayingMedia(null)}
                          aria-label="Stop playing"
                        >
                          <X style={{ width: 16 / k, height: 16 / k }} />
                        </button>
                      </div>
                    );
                  })()}

                {/* In-place editors */}
                {editingEl && frag && (
                  <div className="mo-slide" style={{ position: 'absolute', inset: 0, zIndex: 20, overflow: 'visible', background: 'transparent', pointerEvents: 'none' }}>
                    <div style={{ pointerEvents: 'auto' }}>
                      <TextEditor
                        key={editingEl.id}
                        el={editingEl}
                        frag={frag}
                        theme={deck.theme}
                        placeholder={editingEl.ph ? PLACEHOLDER_PROMPT[editingEl.ph] : 'Type something'}
                        selectAll={selectAllOnEdit}
                        onReady={onEditorReady}
                        onExit={() => setEditing(null)}
                      />
                    </div>
                  </div>
                )}
                {editingEl?.type === 'table' && editingEl.table && (
                  <TableEditor store={store} slideId={slide.id} el={editingEl} theme={deck.theme} onCell={onTableCell} onExit={() => setEditing(null)} />
                )}

                {/* Selection, handles, guides */}
                <div className="pointer-events-none absolute inset-0" style={{ zIndex: 30 }}>
                  {remoteHere.flatMap((r) =>
                    r.sel.map((id) => {
                      const el = byId.get(id);
                      if (!el) return null;
                      return (
                        <div key={`${r.clientId}-${id}`} className="absolute" style={{ left: el.x, top: el.y, width: el.w, height: Math.max(el.h, 1), transform: el.rot ? `rotate(${el.rot}deg)` : undefined, outline: `${2 / k}px solid ${r.color}` }}>
                          <span className="absolute left-0 whitespace-nowrap rounded-sm px-1 font-medium text-white" style={{ top: -18 / k, fontSize: 11 / k, lineHeight: `${15 / k}px`, background: r.color }}>
                            {r.name}
                            {r.editing === id ? ' (typing)' : ''}
                          </span>
                        </div>
                      );
                    }),
                  )}
                  {[...comments].map(([id, n]) => {
                    const el = byId.get(id);
                    if (!el) return null;
                    return (
                      <button
                        key={`c-${id}`}
                        className="pointer-events-auto absolute flex items-center justify-center rounded-full bg-amber-400 text-white shadow"
                        style={{ left: el.x + el.w - 10 / k, top: el.y - 14 / k, width: 22 / k, height: 22 / k, fontSize: 10 / k }}
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={() => onComment(id)}
                        aria-label={`${n} comment${n > 1 ? 's' : ''}`}
                      >
                        <MessageSquare style={{ width: 12 / k, height: 12 / k }} />
                      </button>
                    );
                  })}
                  {groupBox && (
                    <div className="absolute" data-testid="group-box" style={{ left: groupBox.x, top: groupBox.y, width: groupBox.w, height: groupBox.h, outline: `${1.5 / k}px solid #2563eb` }}>
                      {editable &&
                        HANDLES.map((h) => {
                          const x = h.includes('w') ? 0 : h.includes('e') ? groupBox.w : groupBox.w / 2;
                          const y = h.includes('n') ? 0 : h.includes('s') ? groupBox.h : groupBox.h / 2;
                          return (
                            <div
                              key={h}
                              data-handle={`g-${h}`}
                              className="pointer-events-auto absolute rounded-[2px] border-brand-600 bg-white"
                              style={{ left: x - hs / 2, top: y - hs / 2, width: hs, height: hs, borderWidth: 1.5 / k, borderStyle: 'solid', cursor: CURSOR[h] }}
                              onPointerDown={(e) => startHandle(e, selected[0], `g-${h}`)}
                            />
                          );
                        })}
                    </div>
                  )}
                  {selected.map((el) => {
                    if (groupBox) return <div key={el.id} className="absolute" style={{ left: el.x, top: el.y, width: el.w, height: Math.max(el.h, 1), transform: el.rot ? `rotate(${el.rot}deg)` : undefined, outline: `${1 / k}px dashed #93c5fd` }} />;
                    const line = el.type === 'shape' && isLine(el.geom) && !el.rot;
                    const single = selected.length === 1 && editable && editing !== el.id;
                    if (line) {
                      const s = { x: el.flipH ? el.x + el.w : el.x, y: el.flipV ? el.y + el.h : el.y };
                      const t = { x: el.flipH ? el.x : el.x + el.w, y: el.flipV ? el.y : el.y + el.h };
                      return (
                        <div key={el.id}>
                          <svg className="absolute left-0 top-0 overflow-visible" width={1} height={1}>
                            <line x1={s.x} y1={s.y} x2={t.x} y2={t.y} stroke="#2563eb" strokeWidth={1.5 / k} strokeDasharray={`${4 / k} ${3 / k}`} />
                          </svg>
                          {single &&
                            (['start', 'end'] as const).map((h) => {
                              const p = h === 'start' ? s : t;
                              return (
                                <div
                                  key={h}
                                  className="pointer-events-auto absolute rounded-full border border-brand-600 bg-white"
                                  style={{ left: p.x - hs / 2, top: p.y - hs / 2, width: hs, height: hs, borderWidth: 1.5 / k, cursor: 'crosshair' }}
                                  onPointerDown={(e) => startHandle(e, el, h)}
                                />
                              );
                            })}
                        </div>
                      );
                    }
                    return (
                      <div
                        key={el.id}
                        className="absolute"
                        data-testid="selection-box"
                        style={{ left: el.x, top: el.y, width: el.w, height: Math.max(el.h, 1), transform: el.rot ? `rotate(${el.rot}deg)` : undefined, outline: `${1.5 / k}px solid #2563eb`, outlineOffset: 0 }}
                      >
                        {single && (
                          <>
                            {HANDLES.map((h) => {
                              const x = h.includes('w') ? 0 : h.includes('e') ? el.w : el.w / 2;
                              const y = h.includes('n') ? 0 : h.includes('s') ? el.h : el.h / 2;
                              return (
                                <div
                                  key={h}
                                  data-handle={h}
                                  className="pointer-events-auto absolute rounded-[2px] border-brand-600 bg-white"
                                  style={{ left: x - hs / 2, top: y - hs / 2, width: hs, height: hs, borderWidth: 1.5 / k, borderStyle: 'solid', cursor: CURSOR[h] }}
                                  onPointerDown={(e) => startHandle(e, el, h)}
                                />
                              );
                            })}
                            <div className="absolute border-l border-brand-600" style={{ left: el.w / 2, top: -22 / k, height: 22 / k, borderLeftWidth: 1 / k }} />
                            <div
                              data-handle="rot"
                              className="pointer-events-auto absolute rounded-full border-brand-600 bg-white"
                              style={{ left: el.w / 2 - hs / 1.6, top: -22 / k - hs / 1.6, width: hs * 1.25, height: hs * 1.25, borderWidth: 1.5 / k, borderStyle: 'solid', cursor: 'grab' }}
                              onPointerDown={(e) => startHandle(e, el, 'rot')}
                            />
                          </>
                        )}
                      </div>
                    );
                  })}
                  {guides.x.map((x) => (
                    <div key={`gx${x}`} className="absolute top-0 bg-pink-500" style={{ left: x - 0.5 / k, width: 1 / k, height: H }} />
                  ))}
                  {guides.y.map((y) => (
                    <div key={`gy${y}`} className="absolute left-0 bg-pink-500" style={{ top: y - 0.5 / k, height: 1 / k, width: W }} />
                  ))}
                  {siteHint &&
                    byId.get(siteHint.id) &&
                    SITES.map((site) => {
                      const sp = sitePoint(byId.get(siteHint.id)!, site);
                      const on = siteHint.site === site;
                      const r = (on ? 7 : 5) / k;
                      return <div key={site} className={cn('absolute rounded-full border', on ? 'border-brand-700 bg-brand-500' : 'border-brand-600 bg-white')} style={{ left: sp.x - r, top: sp.y - r, width: r * 2, height: r * 2, borderWidth: 1.5 / k }} data-testid="conn-site" />;
                    })}
                  {marquee && <div className="absolute border border-brand-600 bg-brand-500/10" style={{ left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h, borderWidth: 1 / k }} />}
                </div>
              </div>
            </div>
          </div>
        </div>
      </CM.Trigger>
      <CM.Portal>
        <CM.Content className="pop z-50 min-w-56 animate-pop">{contextMenu()}</CM.Content>
      </CM.Portal>
    </CM.Root>
  );
}

export function CtxItem({ icon, children, onSelect, disabled, shortcut, danger }: { icon?: ReactNode; children: ReactNode; onSelect: () => void; disabled?: boolean; shortcut?: string; danger?: boolean }) {
  return (
    <CM.Item disabled={disabled} onSelect={onSelect} className={cn('menu-item', danger && 'text-red-600')}>
      {icon && <span className="flex size-4 items-center justify-center text-muted [&>svg]:size-4">{icon}</span>}
      <span className="flex-1">{children}</span>
      {shortcut && <span className="text-[11px] text-subtle">{shortcut}</span>}
    </CM.Item>
  );
}
export const CtxSep = () => <CM.Separator className="my-1 h-px bg-line" />;

// ── Table editing ────────────────────────────────────────────────────────────

function TableEditor({ store, slideId, el, theme, onCell, onExit }: { store: DeckStore; slideId: string; el: PlainElement; theme: Theme; onCell: (c: { r: number; c: number } | null) => void; onExit: () => void }) {
  const t = el.table!;
  const cols = t.rows[0]?.length ?? 0;
  const total = (t.colW ?? []).slice(0, cols).reduce((a, b) => a + b, 0);
  const widths = Array.from({ length: cols }, (_, i) => (t.colW && total ? (t.colW[i] / total) * 100 : 100 / Math.max(1, cols)));
  const refs = useRef(new Map<string, HTMLTextAreaElement>());
  useEffect(() => {
    refs.current.get('0:0')?.focus();
  }, []);
  const focus = (r: number, c: number) => refs.current.get(`${r}:${c}`)?.focus();
  return (
    <div className="absolute" style={{ left: el.x, top: el.y, width: el.w, height: el.h, transform: el.rot ? `rotate(${el.rot}deg)` : undefined, zIndex: 20 }} onPointerDown={(e) => e.stopPropagation()} data-testid="table-editor">
      <table className="h-full w-full table-fixed border-collapse" style={{ fontSize: `${t.fontSize ?? 14}pt`, fontFamily: theme.fonts.body, color: theme.colors.text }}>
        <colgroup>
          {widths.map((w, i) => (
            <col key={i} style={{ width: `${w}%` }} />
          ))}
        </colgroup>
        <tbody>
          {t.rows.map((row, r) => (
            <tr key={r}>
              {row.map((v, c) => {
                const head = r === 0 && t.header !== false;
                return (
                  <td key={c} className="p-0" style={{ border: '1px solid #94a3b8', background: head ? theme.colors.accents[0] : 'rgba(255,255,255,0.92)' }}>
                    <textarea
                      ref={(n) => {
                        if (n) refs.current.set(`${r}:${c}`, n);
                      }}
                      defaultValue={v}
                      data-cell={`${r}:${c}`}
                      onFocus={() => onCell({ r, c })}
                      onChange={(e) => store.setCell(slideId, el.id, r, c, e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') onExit();
                        else if (e.key === 'Tab') {
                          e.preventDefault();
                          const i = r * cols + c + (e.shiftKey ? -1 : 1);
                          if (i >= 0 && i < t.rows.length * cols) focus(Math.floor(i / cols), i % cols);
                        }
                      }}
                      className="block h-full w-full resize-none bg-transparent px-[0.6em] py-[0.35em] outline-none focus:bg-brand-50/60"
                      style={{ color: head ? '#fff' : undefined, fontWeight: head ? 700 : undefined, font: 'inherit' }}
                    />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
