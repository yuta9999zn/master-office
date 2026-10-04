'use client';

import { freeformPath, pathFromPoints, type FreePath } from '@workos/slide-model';
import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react';

// Line ▸ Curve / Polyline / Scribble (Google Slides). docs/ARCHITECTURE.md §52.
// Curve and polyline: click to add points, double-click or Enter to finish, click the first point to close the
// shape, Esc to cancel. Scribble: press, draw, release. Lives inside the scaled slide layer, so points are in
// slide units.

export type DrawTool = 'curve' | 'polyline' | 'scribble';
export interface Drawn {
  x: number;
  y: number;
  w: number;
  h: number;
  path: FreePath;
}

const CLOSE_PX = 10; // screen pixels around the first point that close the shape

export function DrawLayer({ tool, W, H, scale, onDone, onCancel }: { tool: DrawTool; W: number; H: number; scale: number; onDone: (d: Drawn) => void; onCancel: () => void }) {
  const [pts, setPts] = useState<[number, number][]>([]);
  const [hover, setHover] = useState<[number, number] | null>(null);
  const drawing = useRef(false);
  const layer = useRef<HTMLDivElement>(null);
  const smooth = tool !== 'polyline';

  const at = (e: { clientX: number; clientY: number }): [number, number] => {
    const r = layer.current!.getBoundingClientRect();
    return [Math.max(0, Math.min(W, (e.clientX - r.left) / scale)), Math.max(0, Math.min(H, (e.clientY - r.top) / scale))];
  };
  const finish = (list: [number, number][], closed = false) => {
    const clean = list.filter((p, i) => i === 0 || Math.hypot(p[0] - list[i - 1][0], p[1] - list[i - 1][1]) > 0.5);
    if (clean.length < 2) return onCancel();
    onDone(pathFromPoints(clean, { closed, smooth, simplify: tool === 'scribble' }));
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Capture phase: the workspace's own shortcuts (Esc deselects…) must not see these keys while drawing.
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onCancel();
      } else if (e.key === 'Enter' && tool !== 'scribble') {
        e.preventDefault();
        e.stopPropagation();
        finish(pts);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  const down = (e: RPointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const p = at(e);
    if (tool === 'scribble') {
      drawing.current = true;
      layer.current?.setPointerCapture(e.pointerId);
      setPts([p]);
      return;
    }
    if (e.detail >= 2) return; // the second click of a double-click: handled by onDoubleClick
    if (pts.length >= 3 && Math.hypot(p[0] - pts[0][0], p[1] - pts[0][1]) * scale <= CLOSE_PX) return finish(pts, true);
    setPts([...pts, p]);
  };
  const move = (e: RPointerEvent) => {
    e.stopPropagation();
    const p = at(e);
    if (tool === 'scribble') {
      if (!drawing.current) return;
      const last = pts[pts.length - 1];
      if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) * scale >= 2) setPts([...pts, p]);
      return;
    }
    setHover(p);
  };
  const up = (e: RPointerEvent) => {
    e.stopPropagation();
    if (tool !== 'scribble' || !drawing.current) return;
    drawing.current = false;
    finish(pts);
  };

  const preview = tool === 'scribble' || !hover ? pts : [...pts, hover];
  const d = preview.length >= 2 ? freeformPath({ pts: preview.map(([x, y]) => [x / W, y / H]), smooth }, W, H) : '';
  const nearStart = tool !== 'scribble' && pts.length >= 3 && hover && Math.hypot(hover[0] - pts[0][0], hover[1] - pts[0][1]) * scale <= CLOSE_PX;
  return (
    <div
      ref={layer}
      className="absolute inset-0 cursor-crosshair"
      style={{ zIndex: 60 }}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onDoubleClick={(e) => {
        e.stopPropagation();
        finish(pts);
      }}
      onContextMenu={(e) => e.preventDefault()}
      data-testid="draw-layer"
      data-tool={tool}
    >
      <svg width={W} height={H} className="pointer-events-none absolute inset-0 overflow-visible">
        {d && <path d={d} fill="none" stroke="#2563eb" strokeWidth={3 / Math.min(1, scale) / 1.5} strokeLinejoin="round" strokeLinecap="round" />}
        {tool !== 'scribble' &&
          pts.map(([x, y], i) => <circle key={i} cx={x} cy={y} r={(i === 0 && nearStart ? 7 : 4) / scale} fill={i === 0 && nearStart ? '#2563eb' : '#fff'} stroke="#2563eb" strokeWidth={1.5 / scale} />)}
      </svg>
    </div>
  );
}
