// Connectors (§77): ports on the four sides of a node, the sides an edge uses when it has none, and the route —
// orthogonal elbows (default), a straight line or a curve — with the point where its label sits.
import type { FlowEdge, FlowNode, Side } from './types';

export interface Pt {
  x: number;
  y: number;
}
type Box = Pick<FlowNode, 'x' | 'y' | 'w' | 'h'>;

export function port(n: Box, side: Side): Pt {
  switch (side) {
    case 'top':
      return { x: n.x + n.w / 2, y: n.y };
    case 'bottom':
      return { x: n.x + n.w / 2, y: n.y + n.h };
    case 'left':
      return { x: n.x, y: n.y + n.h / 2 };
    case 'right':
      return { x: n.x + n.w, y: n.y + n.h / 2 };
  }
}

const dir: Record<Side, Pt> = { top: { x: 0, y: -1 }, bottom: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };
const vertical = (s: Side) => s === 'top' || s === 'bottom';

/** Sides that face each other: mostly above / below → bottom / top, mostly beside → right / left. */
export function pickSides(a: Box, b: Box): [Side, Side] {
  const dx = b.x + b.w / 2 - (a.x + a.w / 2);
  const dy = b.y + b.h / 2 - (a.y + a.h / 2);
  // Vertical when the boxes do not overlap vertically and the gap is mostly vertical.
  const gapY = dy > 0 ? b.y - (a.y + a.h) : a.y - (b.y + b.h);
  const gapX = dx > 0 ? b.x - (a.x + a.w) : a.x - (b.x + b.w);
  if (gapY >= 8 && (gapY >= gapX || gapX < 8)) return dy > 0 ? ['bottom', 'top'] : ['top', 'bottom'];
  return dx > 0 ? ['right', 'left'] : ['left', 'right'];
}

/** The nearest side of a box to a point (dropping a connector on a node). */
export function nearestSide(n: Box, p: Pt): Side {
  const d: [Side, number][] = [
    ['top', Math.abs(p.y - n.y)],
    ['bottom', Math.abs(p.y - (n.y + n.h))],
    ['left', Math.abs(p.x - n.x)],
    ['right', Math.abs(p.x - (n.x + n.w))],
  ];
  return d.sort((a, b) => a[1] - b[1])[0][0];
}

const STUB = 18;

/** Points of an edge between two nodes (or a node and a free point while dragging). */
export function routePoints(a: Box, b: Box | Pt, e: Pick<FlowEdge, 'fromSide' | 'toSide'> & { route?: string }): Pt[] {
  const bBox: Box = 'w' in b ? b : { x: b.x, y: b.y, w: 0, h: 0 };
  const [sa, sb] = pickSides(a, bBox);
  const s1 = e.fromSide ?? sa;
  const s2 = 'w' in b ? (e.toSide ?? sb) : opposite(s1, a, b);
  const p1 = port(a, s1);
  const p2 = 'w' in b ? port(b, s2) : b;
  if (e.route === 'straight' || e.route === 'curved') return [p1, p2];
  const q1 = { x: p1.x + dir[s1].x * STUB, y: p1.y + dir[s1].y * STUB };
  const q2 = 'w' in b ? { x: p2.x + dir[s2].x * STUB, y: p2.y + dir[s2].y * STUB } : p2;
  let mid: Pt[];
  if (vertical(s1) && vertical(s2)) {
    // Facing each other: turn half way; otherwise step aside half way between them.
    if (sameWay(s1, s2, p1, p2)) {
      const my = (q1.y + q2.y) / 2;
      mid = [{ x: q1.x, y: my }, { x: q2.x, y: my }];
    } else {
      const mx = (q1.x + q2.x) / 2;
      mid = [{ x: mx, y: q1.y }, { x: mx, y: q2.y }];
    }
  } else if (!vertical(s1) && !vertical(s2)) {
    if (sameWay(s1, s2, p1, p2)) {
      const mx = (q1.x + q2.x) / 2;
      mid = [{ x: mx, y: q1.y }, { x: mx, y: q2.y }];
    } else {
      const my = (q1.y + q2.y) / 2;
      mid = [{ x: q1.x, y: my }, { x: q2.x, y: my }];
    }
  } else if (vertical(s1)) mid = [{ x: q1.x, y: q2.y }];
  else mid = [{ x: q2.x, y: q1.y }];
  return simplify([p1, q1, ...mid, q2, p2]);
}

/** Facing sides heading toward each other (bottom → top with the target below, …). */
function sameWay(s1: Side, s2: Side, p1: Pt, p2: Pt) {
  if (s1 === 'bottom' && s2 === 'top') return p2.y >= p1.y;
  if (s1 === 'top' && s2 === 'bottom') return p2.y <= p1.y;
  if (s1 === 'right' && s2 === 'left') return p2.x >= p1.x;
  if (s1 === 'left' && s2 === 'right') return p2.x <= p1.x;
  return false;
}

function opposite(s: Side, _a: Box, _b: Pt): Side {
  return s === 'top' ? 'bottom' : s === 'bottom' ? 'top' : s === 'left' ? 'right' : 'left';
}

/** Drops repeated and collinear points. */
function simplify(pts: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - p.x) < 0.5 && Math.abs(last.y - p.y) < 0.5) continue;
    out.push(p);
  }
  for (let i = out.length - 2; i > 0; i--) {
    const a = out[i - 1];
    const b = out[i];
    const c = out[i + 1];
    if ((Math.abs(a.x - b.x) < 0.5 && Math.abs(b.x - c.x) < 0.5) || (Math.abs(a.y - b.y) < 0.5 && Math.abs(b.y - c.y) < 0.5)) out.splice(i, 1);
  }
  return out;
}

/** SVG path data: elbows get small rounded corners; curves bend along the ports' directions. */
export function pathD(pts: Pt[], route: string, sides?: [Side, Side]): string {
  if (pts.length < 2) return '';
  if (route === 'curved' && sides) {
    const [a, b] = [pts[0], pts[pts.length - 1]];
    const k = Math.max(40, Math.hypot(b.x - a.x, b.y - a.y) / 2.5);
    const c1 = { x: a.x + dir[sides[0]].x * k, y: a.y + dir[sides[0]].y * k };
    const c2 = { x: b.x + dir[sides[1]].x * k, y: b.y + dir[sides[1]].y * k };
    return `M${a.x},${a.y} C${c1.x},${c1.y} ${c2.x},${c2.y} ${b.x},${b.y}`;
  }
  if (pts.length === 2 || route === 'straight') return `M${pts[0].x},${pts[0].y} L${pts[pts.length - 1].x},${pts[pts.length - 1].y}`;
  let d = `M${pts[0].x},${pts[0].y}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i - 1];
    const c = pts[i];
    const n = pts[i + 1];
    const r = Math.min(8, Math.hypot(c.x - p.x, c.y - p.y) / 2, Math.hypot(n.x - c.x, n.y - c.y) / 2);
    const a = { x: c.x - Math.sign(c.x - p.x) * r, y: c.y - Math.sign(c.y - p.y) * r };
    const b = { x: c.x + Math.sign(n.x - c.x) * r, y: c.y + Math.sign(n.y - c.y) * r };
    d += ` L${a.x},${a.y} Q${c.x},${c.y} ${b.x},${b.y}`;
  }
  const last = pts[pts.length - 1];
  return `${d} L${last.x},${last.y}`;
}

/** Where an edge's label sits: the middle of its longest segment. */
export function labelPoint(pts: Pt[]): Pt {
  let best = { len: -1, at: pts[0] };
  for (let i = 1; i < pts.length; i++) {
    const len = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    if (len > best.len) best = { len, at: { x: (pts[i].x + pts[i - 1].x) / 2, y: (pts[i].y + pts[i - 1].y) / 2 } };
  }
  return best.at;
}

/** Everything an edge needs to be drawn. */
export function edgeGeometry(e: FlowEdge, a: Box, b: Box) {
  const [sa, sb] = pickSides(a, b);
  const sides: [Side, Side] = [e.fromSide ?? sa, e.toSide ?? sb];
  const pts = routePoints(a, b, { ...e, route: e.style.route });
  return { pts, d: pathD(pts, e.style.route, sides), label: labelPoint(pts), sides };
}

/** Bounding box of nodes (fit to screen, export). */
export function bounds(nodes: Box[], pad = 0) {
  if (!nodes.length) return { x: 0, y: 0, w: 0, h: 0 };
  const x0 = Math.min(...nodes.map((n) => n.x)) - pad;
  const y0 = Math.min(...nodes.map((n) => n.y)) - pad;
  const x1 = Math.max(...nodes.map((n) => n.x + n.w)) + pad;
  const y1 = Math.max(...nodes.map((n) => n.y + n.h)) + pad;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
