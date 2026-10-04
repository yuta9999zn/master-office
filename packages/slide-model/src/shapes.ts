// More shape sets (Google Slides: Shapes ▸ Arrows / Callouts / Equation) and freeform lines (Line ▸ Curve /
// Polyline / Scribble). Geometry names are the OOXML preset names, so PowerPoint export / import map 1:1.
// docs/ARCHITECTURE.md §52.

export type ExtraGeometry =
  | 'octagon'
  | 'plus'
  | 'heart'
  | 'star4'
  | 'star6'
  | 'cloud'
  | 'lightningBolt'
  | 'can'
  | 'upArrow'
  | 'downArrow'
  | 'leftRightArrow'
  | 'upDownArrow'
  | 'notchedRightArrow'
  | 'homePlate'
  | 'wedgeRectCallout'
  | 'wedgeRoundRectCallout'
  | 'wedgeEllipseCallout'
  | 'mathPlus'
  | 'mathMinus'
  | 'mathMultiply'
  | 'mathDivide'
  | 'mathEqual'
  | 'mathNotEqual'
  | 'freeform';

export type ShapeGroup = 'Shapes' | 'Arrows' | 'Callouts' | 'Equation';

export const EXTRA_SHAPES: { geom: ExtraGeometry; label: string; group: ShapeGroup; aspect?: number }[] = [
  { geom: 'octagon', label: 'Octagon', group: 'Shapes' },
  { geom: 'plus', label: 'Cross', group: 'Shapes' },
  { geom: 'heart', label: 'Heart', group: 'Shapes' },
  { geom: 'star4', label: '4-point star', group: 'Shapes' },
  { geom: 'star6', label: '6-point star', group: 'Shapes' },
  { geom: 'cloud', label: 'Cloud', group: 'Shapes', aspect: 0.66 },
  { geom: 'lightningBolt', label: 'Lightning bolt', group: 'Shapes' },
  { geom: 'can', label: 'Cylinder', group: 'Shapes' },
  { geom: 'upArrow', label: 'Up arrow', group: 'Arrows' },
  { geom: 'downArrow', label: 'Down arrow', group: 'Arrows' },
  { geom: 'leftRightArrow', label: 'Left-right arrow', group: 'Arrows', aspect: 0.5 },
  { geom: 'upDownArrow', label: 'Up-down arrow', group: 'Arrows' },
  { geom: 'notchedRightArrow', label: 'Notched arrow', group: 'Arrows', aspect: 0.5 },
  { geom: 'homePlate', label: 'Pentagon arrow', group: 'Arrows', aspect: 0.5 },
  { geom: 'wedgeRectCallout', label: 'Rectangular callout', group: 'Callouts', aspect: 0.66 },
  { geom: 'wedgeRoundRectCallout', label: 'Rounded callout', group: 'Callouts', aspect: 0.66 },
  { geom: 'wedgeEllipseCallout', label: 'Oval callout', group: 'Callouts', aspect: 0.66 },
  { geom: 'mathPlus', label: 'Plus', group: 'Equation' },
  { geom: 'mathMinus', label: 'Minus', group: 'Equation', aspect: 0.5 },
  { geom: 'mathMultiply', label: 'Multiply', group: 'Equation' },
  { geom: 'mathDivide', label: 'Divide', group: 'Equation' },
  { geom: 'mathEqual', label: 'Equal', group: 'Equation', aspect: 0.66 },
  { geom: 'mathNotEqual', label: 'Not equal', group: 'Equation', aspect: 0.66 },
];

const f = (n: number) => Math.round(n * 100) / 100;
const poly = (pts: [number, number][]) => `M${pts.map(([x, y]) => `${f(x)},${f(y)}`).join(' L')} Z`;
const rect = (x: number, y: number, w: number, h: number) => `M${f(x)},${f(y)} H${f(x + w)} V${f(y + h)} H${f(x)} Z`;
const ellipse = (cx: number, cy: number, rx: number, ry: number) => `M${f(cx - rx)},${f(cy)} A${f(rx)},${f(ry)} 0 1 0 ${f(cx + rx)},${f(cy)} A${f(rx)},${f(ry)} 0 1 0 ${f(cx - rx)},${f(cy)} Z`;
function star(n: number, inner: number, w: number, h: number) {
  const pts: [number, number][] = [];
  for (let i = 0; i < n * 2; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / n;
    const r = i % 2 ? inner : 0.5;
    pts.push([w / 2 + Math.cos(a) * w * r, h / 2 + Math.sin(a) * h * r]);
  }
  return poly(pts);
}

/** SVG path of an extra preset in a w × h box, or null when the geometry is not one of them. */
export function extraShapePath(geom: string, w: number, h: number): string | null {
  switch (geom as ExtraGeometry) {
    case 'octagon': {
      const a = Math.min(w, h) * 0.29;
      return poly([[a, 0], [w - a, 0], [w, a], [w, h - a], [w - a, h], [a, h], [0, h - a], [0, a]]);
    }
    case 'plus': {
      // Arms a quarter of the shorter side in from each edge (OOXML "plus", adj 25 %).
      const a = Math.min(w, h) * 0.25;
      return poly([[a, 0], [w - a, 0], [w - a, a], [w, a], [w, h - a], [w - a, h - a], [w - a, h], [a, h], [a, h - a], [0, h - a], [0, a], [a, a]]);
    }
    case 'heart':
      return `M${f(w / 2)},${f(h * 0.25)} C${f(w / 2)},${f(h * 0.05)} ${f(w * 0.08)},${f(-h * 0.05)} ${f(w * 0.02)},${f(h * 0.3)} C${f(-w * 0.02)},${f(h * 0.55)} ${f(w * 0.3)},${f(h * 0.75)} ${f(w / 2)},${f(h)} C${f(w * 0.7)},${f(h * 0.75)} ${f(w * 1.02)},${f(h * 0.55)} ${f(w * 0.98)},${f(h * 0.3)} C${f(w * 0.92)},${f(-h * 0.05)} ${f(w / 2)},${f(h * 0.05)} ${f(w / 2)},${f(h * 0.25)} Z`;
    case 'star4':
      return star(4, 0.19, w, h);
    case 'star6':
      return star(6, 0.29, w, h);
    case 'cloud': {
      // Bumps around an ellipse: one arc per bump, the outline only (no inner seams).
      const n = 9;
      const pts = Array.from({ length: n }, (_, i) => {
        const a = (i / n) * Math.PI * 2 - Math.PI / 2;
        return [w / 2 + Math.cos(a) * w * 0.4, h / 2 + Math.sin(a) * h * 0.38] as [number, number];
      });
      const r = Math.min(w, h) * 0.2;
      return `M${f(pts[0][0])},${f(pts[0][1])} ${pts.map((_, i) => {
        const [x, y] = pts[(i + 1) % n];
        return `A${f(r * (w / Math.min(w, h)) * 0.75)},${f(r * (h / Math.min(w, h)) * 0.75)} 0 0 1 ${f(x)},${f(y)}`;
      }).join(' ')} Z`;
    }
    case 'lightningBolt':
      return poly([[w * 0.39, 0], [w * 0.62, h * 0.34], [w * 0.52, h * 0.38], [w * 0.8, h * 0.66], [w * 0.7, h * 0.7], [w, h], [w * 0.42, h * 0.76], [w * 0.53, h * 0.7], [w * 0.17, h * 0.47], [w * 0.29, h * 0.42], [0, h * 0.17]]);
    case 'can': {
      const ry = h * 0.1;
      // Body and the full top ellipse wound the same way (clockwise): filled as one, the lip's outline shows.
      return `M0,${f(ry)} A${f(w / 2)},${f(ry)} 0 0 1 ${f(w)},${f(ry)} V${f(h - ry)} A${f(w / 2)},${f(ry)} 0 0 1 0,${f(h - ry)} Z M0,${f(ry)} A${f(w / 2)},${f(ry)} 0 0 1 ${f(w)},${f(ry)} A${f(w / 2)},${f(ry)} 0 0 1 0,${f(ry)} Z`;
    }
    case 'upArrow':
      return poly([[w / 2, 0], [w, h * 0.5], [w * 0.75, h * 0.5], [w * 0.75, h], [w * 0.25, h], [w * 0.25, h * 0.5], [0, h * 0.5]]);
    case 'downArrow':
      return poly([[w * 0.25, 0], [w * 0.75, 0], [w * 0.75, h * 0.5], [w, h * 0.5], [w / 2, h], [0, h * 0.5], [w * 0.25, h * 0.5]]);
    case 'leftRightArrow':
      return poly([[0, h / 2], [w * 0.2, 0], [w * 0.2, h * 0.25], [w * 0.8, h * 0.25], [w * 0.8, 0], [w, h / 2], [w * 0.8, h], [w * 0.8, h * 0.75], [w * 0.2, h * 0.75], [w * 0.2, h]]);
    case 'upDownArrow':
      return poly([[w / 2, 0], [w, h * 0.2], [w * 0.75, h * 0.2], [w * 0.75, h * 0.8], [w, h * 0.8], [w / 2, h], [0, h * 0.8], [w * 0.25, h * 0.8], [w * 0.25, h * 0.2], [0, h * 0.2]]);
    case 'notchedRightArrow':
      return poly([[0, h * 0.25], [w * 0.6, h * 0.25], [w * 0.6, 0], [w, h / 2], [w * 0.6, h], [w * 0.6, h * 0.75], [0, h * 0.75], [w * 0.12, h / 2]]);
    case 'homePlate':
      return poly([[0, 0], [w * 0.75, 0], [w, h / 2], [w * 0.75, h], [0, h]]);
    case 'wedgeRectCallout': {
      const b = h * 0.78;
      return poly([[0, 0], [w, 0], [w, b], [w * 0.4, b], [w * 0.2, h], [w * 0.22, b], [0, b]]);
    }
    case 'wedgeRoundRectCallout': {
      const b = h * 0.78;
      const r = Math.min(w, b) * 0.16;
      return `M${f(r)},0 H${f(w - r)} Q${f(w)},0 ${f(w)},${f(r)} V${f(b - r)} Q${f(w)},${f(b)} ${f(w - r)},${f(b)} H${f(w * 0.4)} L${f(w * 0.2)},${f(h)} L${f(w * 0.22)},${f(b)} H${f(r)} Q0,${f(b)} 0,${f(b - r)} V${f(r)} Q0,0 ${f(r)},0 Z`;
    }
    case 'wedgeEllipseCallout': {
      const cy = h * 0.42;
      const ry = h * 0.42;
      // Ellipse with a wedge out of its lower left.
      const a1 = (110 * Math.PI) / 180;
      const a2 = (135 * Math.PI) / 180;
      const p = (a: number) => `${f(w / 2 + Math.cos(a) * w / 2)},${f(cy + Math.sin(a) * ry)}`;
      return `M${p(a1)} A${f(w / 2)},${f(ry)} 0 1 0 ${p(a2)} L${f(w * 0.08)},${f(h)} Z`;
    }
    case 'mathPlus': {
      const t = Math.min(w, h) * 0.235;
      return poly([[w / 2 - t / 2, h * 0.12], [w / 2 + t / 2, h * 0.12], [w / 2 + t / 2, h / 2 - t / 2], [w * 0.88, h / 2 - t / 2], [w * 0.88, h / 2 + t / 2], [w / 2 + t / 2, h / 2 + t / 2], [w / 2 + t / 2, h * 0.88], [w / 2 - t / 2, h * 0.88], [w / 2 - t / 2, h / 2 + t / 2], [w * 0.12, h / 2 + t / 2], [w * 0.12, h / 2 - t / 2], [w / 2 - t / 2, h / 2 - t / 2]]);
    }
    case 'mathMinus':
      return rect(w * 0.12, h * 0.35, w * 0.76, h * 0.3);
    case 'mathMultiply': {
      const t = Math.min(w, h) * 0.16;
      const c = [w / 2, h / 2];
      const arm = (ang: number) => {
        const dx = Math.cos(ang);
        const dy = Math.sin(ang);
        const L = Math.min(w, h) * 0.42;
        return [
          [c[0] + dx * L - dy * t, c[1] + dy * L + dx * t],
          [c[0] + dx * L + dy * t, c[1] + dy * L - dx * t],
          [c[0] - dx * L + dy * t, c[1] - dy * L - dx * t],
          [c[0] - dx * L - dy * t, c[1] - dy * L + dx * t],
        ] as [number, number][];
      };
      return `${poly(arm(Math.PI / 4))} ${poly(arm(-Math.PI / 4))}`;
    }
    case 'mathDivide':
      return `${rect(w * 0.12, h * 0.42, w * 0.76, h * 0.16)} ${ellipse(w / 2, h * 0.22, Math.min(w, h) * 0.1, Math.min(w, h) * 0.1)} ${ellipse(w / 2, h * 0.78, Math.min(w, h) * 0.1, Math.min(w, h) * 0.1)}`;
    case 'mathEqual':
      return `${rect(w * 0.12, h * 0.2, w * 0.76, h * 0.22)} ${rect(w * 0.12, h * 0.58, w * 0.76, h * 0.22)}`;
    case 'mathNotEqual':
      return `${rect(w * 0.12, h * 0.2, w * 0.76, h * 0.22)} ${rect(w * 0.12, h * 0.58, w * 0.76, h * 0.22)} ${poly([[w * 0.58, 0], [w * 0.7, 0], [w * 0.42, h], [w * 0.3, h]])}`;
    default:
      return null;
  }
}

/** Freeform lines and shapes: points normalised to the element box (0…1), so resizing scales them. */
export interface FreePath {
  pts: [number, number][];
  closed?: boolean;
  /** Curve / scribble: drawn through the points smoothly (Catmull-Rom → cubic Bézier). */
  smooth?: boolean;
}

/** Cubic segments through the points (Catmull-Rom with tension 0.5), in element coordinates. */
export function freeformSegments(path: FreePath, w: number, h: number) {
  const p = path.pts.map(([x, y]) => [x * w, y * h] as [number, number]);
  const n = p.length;
  const segs: { to: [number, number]; c1?: [number, number]; c2?: [number, number] }[] = [];
  for (let i = 1; i < n + (path.closed ? 1 : 0); i++) {
    const to = p[i % n];
    if (!path.smooth || n < 3) {
      segs.push({ to });
      continue;
    }
    const p0 = p[(i - 2 + n) % n] ?? p[0];
    const p1 = p[(i - 1) % n];
    const p3 = p[(i + 1) % n];
    const a = path.closed ? p0 : i - 2 < 0 ? p1 : p0;
    const d = path.closed ? p3 : i + 1 >= n ? to : p3;
    segs.push({ to, c1: [p1[0] + (to[0] - a[0]) / 6, p1[1] + (to[1] - a[1]) / 6], c2: [to[0] - (d[0] - p1[0]) / 6, to[1] - (d[1] - p1[1]) / 6] });
  }
  return { start: p[0] ?? [0, 0], segs };
}

export function freeformPath(path: FreePath | undefined, w: number, h: number): string {
  if (!path?.pts.length) return '';
  const { start, segs } = freeformSegments(path, w, h);
  const body = segs.map((s) => (s.c1 && s.c2 ? `C${f(s.c1[0])},${f(s.c1[1])} ${f(s.c2[0])},${f(s.c2[1])} ${f(s.to[0])},${f(s.to[1])}` : `L${f(s.to[0])},${f(s.to[1])}`)).join(' ');
  return `M${f(start[0])},${f(start[1])} ${body}${path.closed ? ' Z' : ''}`;
}

/**
 * Points drawn in slide coordinates → an element box and normalised points. Scribbles are thinned first
 * (Ramer–Douglas–Peucker, 1.5 px) so a stroke stays a few dozen points.
 */
export function pathFromPoints(raw: [number, number][], opts: { closed?: boolean; smooth?: boolean; simplify?: boolean }) {
  const pts = opts.simplify ? rdp(raw, 1.5) : raw;
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  const w = Math.max(1, Math.max(...xs) - x);
  const h = Math.max(1, Math.max(...ys) - y);
  return { x, y, w, h, path: { pts: pts.map(([px, py]) => [Math.round(((px - x) / w) * 10000) / 10000, Math.round(((py - y) / h) * 10000) / 10000] as [number, number]), ...(opts.closed ? { closed: true } : {}), ...(opts.smooth ? { smooth: true } : {}) } as FreePath };
}

function rdp(pts: [number, number][], eps: number): [number, number][] {
  if (pts.length < 3) return pts;
  const [a, b] = [pts[0], pts[pts.length - 1]];
  let max = 0;
  let idx = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = distToSegment(pts[i], a, b);
    if (d > max) {
      max = d;
      idx = i;
    }
  }
  if (max <= eps) return [a, b];
  return [...rdp(pts.slice(0, idx + 1), eps).slice(0, -1), ...rdp(pts.slice(idx), eps)];
}
function distToSegment(p: [number, number], a: [number, number], b: [number, number]) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len)) : 0;
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}
