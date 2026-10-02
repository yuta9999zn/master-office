'use client';

import type { Editor } from '@tiptap/react';
import { isLine, PLACEHOLDER_PROMPT, slideHtml, type DeckSize, type PlainElement, type PlainSlide, type Theme } from '@workos/slide-model';
import { MessageSquare } from 'lucide-react';
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
  | { kind: 'line'; id: string; end: 'start' | 'end'; box: Box; flipH: boolean; flipV: boolean }
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

export function SlideCanvas({
  store,
  slide,
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
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const page = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(0.5);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [guides, setGuides] = useState<{ x: number[]; y: number[] }>({ x: [], y: [] });
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
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      setSelection(selection.includes(id) ? selection.filter((s) => s !== id) : [...selection, id]);
      return;
    }
    const sel = selection.includes(id) ? selection : [id];
    if (!selection.includes(id)) setSelection(sel);
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
    if (handle === 'rot') setDrag({ kind: 'rotate', id: el.id, box: boxOf(el) });
    else if (handle === 'start' || handle === 'end') setDrag({ kind: 'line', id: el.id, end: handle, box: boxOf(el), flipH: !!el.flipH, flipV: !!el.flipV });
    else setDrag({ kind: 'resize', id: el.id, handle, box: boxOf(el), aspect: el.type === 'image' && handle.length === 2 });
  };

  const startMarquee = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    if (editing) setEditing(null);
    onTableCell(null);
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
      write([...drag.boxes].map(([id, b]) => ({ id, patch: { x: b.x + dx + s.dx, y: b.y + dy + s.dy } })));
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
      const s0 = drag.end === 'start' ? q : start;
      const e0 = drag.end === 'end' ? q : end;
      write([{ id: drag.id, patch: { x: Math.min(s0.x, e0.x), y: Math.min(s0.y, e0.y), w: Math.abs(e0.x - s0.x), h: Math.abs(e0.y - s0.y), flipH: s0.x > e0.x || undefined, flipV: s0.y > e0.y || undefined } }]);
    } else if (drag.kind === 'marquee') {
      const r = { x: Math.min(p.x, drag.start.x), y: Math.min(p.y, drag.start.y), w: Math.abs(p.x - drag.start.x), h: Math.abs(p.y - drag.start.y) };
      setMarquee(r);
      const hit = slide.elements.filter((el) => el.x < r.x + r.w && el.x + el.w > r.x && el.y < r.y + r.h && el.y + Math.max(el.h, 1) > r.y).map((el) => el.id);
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
    setGuides({ x: [], y: [] });
  };

  const startEdit = (el: PlainElement) => {
    if (!editable) return;
    if (el.type === 'text' || (el.type === 'shape' && !isLine(el.geom))) {
      setSelection([el.id]);
      setEditing(el.id);
    } else if (el.type === 'table') {
      setSelection([el.id]);
      setEditing(el.id);
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

                {/* Hit targets, one per element in z order (lines get a thicker grab area). */}
                <div className="absolute inset-0" style={{ zIndex: 10 }}>
                  {slide.elements.map((el) => {
                    if (el.id === editing && el.type !== 'chart' && el.type !== 'image') return null;
                    const line = el.type === 'shape' && isLine(el.geom);
                    const pad = line ? 8 / k : 0;
                    return (
                      <div
                        key={el.id}
                        data-hit={el.id}
                        className={cn('absolute', editable ? 'cursor-move' : 'cursor-default')}
                        style={{ left: el.x - pad, top: el.y - pad, width: Math.max(el.w, 1) + pad * 2, height: Math.max(el.h, 1) + pad * 2, transform: el.rot ? `rotate(${el.rot}deg)` : undefined }}
                        onPointerDown={(e) => startMove(e, el.id)}
                        onDoubleClick={(e) => (e.stopPropagation(), startEdit(el))}
                        onContextMenu={() => !selection.includes(el.id) && setSelection([el.id])}
                      />
                    );
                  })}
                </div>

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
                  {selected.map((el) => {
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
