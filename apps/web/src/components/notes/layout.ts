import { ROOT_ID, type MindNode } from '@workos/doc-model';

/** Geometry of the mind map (world px; origin = centre of the root topic). */
export const G = {
  ROOT_W: 240,
  ROOT_H: 76,
  TOPIC_H: 42,
  LINK_H: 48,
  LINK_W: 196,
  NOTE_W: 208,
  NOTE_LINE: 19,
  NOTE_PAD: 16,
  H_GAP: 72,
  V_GAP: 18,
  STICKY_W: 150,
  STICKY_H: 104,
};

export interface Placed {
  node: MindNode;
  x: number;
  y: number;
  /** Box of the topic itself. */
  w: number;
  h: number;
  /** Height of the attached note card (0 if none). */
  notesH: number;
  side: 'left' | 'right' | null;
  depth: number;
}

const textW = (s: string) => Math.min(250, Math.max(120, s.length * 7.6 + 60));

function topicSize(n: MindNode) {
  if (n.kind === 'root') return { w: G.ROOT_W, h: G.ROOT_H };
  if (n.kind === 'link') return { w: G.LINK_W, h: G.LINK_H };
  if (n.kind === 'sticky') return { w: G.STICKY_W, h: G.STICKY_H };
  return { w: textW(n.text), h: G.TOPIC_H };
}
const notesHeight = (n: MindNode) => (n.kind === 'topic' && n.notes?.length ? G.NOTE_PAD + n.notes.length * G.NOTE_LINE : 0);
const block = (n: MindNode) => {
  const s = topicSize(n);
  const nh = notesHeight(n);
  return { w: Math.max(s.w, nh ? G.NOTE_W : 0), h: s.h + (nh ? 8 + nh : 0) };
};

/** Two-sided tree layout; manual positions (x/y) shift a node together with its subtree. */
export function layout(nodes: MindNode[]): Placed[] {
  const byParent = new Map<string, MindNode[]>();
  for (const n of nodes) {
    if (!n.parentId) continue;
    const list = byParent.get(n.parentId) ?? [];
    list.push(n);
    byParent.set(n.parentId, list);
  }
  for (const list of byParent.values()) list.sort((a, b) => a.order - b.order);
  const kids = (id: string, side?: 'left' | 'right') => (byParent.get(id) ?? []).filter((c) => c.kind !== 'sticky' && (!side || (c.side ?? 'right') === side));

  const heights = new Map<string, number>();
  const subtreeH = (n: MindNode): number => {
    const own = block(n).h;
    const cs = n.collapsed ? [] : kids(n.id);
    const total = cs.reduce((s, c) => s + subtreeH(c), 0) + Math.max(0, cs.length - 1) * G.V_GAP;
    const h = Math.max(own, total);
    heights.set(n.id, h);
    return h;
  };

  const out: Placed[] = [];
  const place = (n: MindNode, anchorX: number, centerY: number, side: 'left' | 'right', depth: number, off: { dx: number; dy: number }) => {
    const size = topicSize(n);
    const b = block(n);
    const autoX = side === 'right' ? anchorX : anchorX - b.w;
    const autoY = centerY - b.h / 2;
    let { dx, dy } = off;
    if (n.x !== undefined && n.y !== undefined) {
      dx = n.x - autoX;
      dy = n.y - autoY;
    }
    const x = autoX + dx;
    const y = autoY + dy;
    out.push({ node: n, x, y, w: size.w, h: size.h, notesH: notesHeight(n), side, depth });
    if (n.collapsed) return;
    const cs = kids(n.id);
    const total = cs.reduce((s, c) => s + (heights.get(c.id) ?? 0), 0) + Math.max(0, cs.length - 1) * G.V_GAP;
    let top = centerY - total / 2;
    const nextAnchor = side === 'right' ? autoX + b.w + G.H_GAP : autoX - G.H_GAP;
    for (const c of cs) {
      const h = heights.get(c.id) ?? 0;
      place(c, nextAnchor, top + h / 2, side, depth + 1, { dx, dy });
      top += h + G.V_GAP;
    }
  };

  const root = nodes.find((n) => n.kind === 'root') ?? nodes.find((n) => n.id === ROOT_ID);
  if (root) {
    const rs = topicSize(root);
    const rx = root.x ?? -rs.w / 2;
    const ry = root.y ?? -rs.h / 2;
    const off = { dx: rx + rs.w / 2, dy: ry + rs.h / 2 };
    out.push({ node: root, x: rx, y: ry, w: rs.w, h: rs.h, notesH: 0, side: null, depth: 0 });
    if (!root.collapsed) {
      for (const side of ['right', 'left'] as const) {
        const cs = kids(root.id, side);
        cs.forEach(subtreeH);
        const total = cs.reduce((s, c) => s + (heights.get(c.id) ?? 0), 0) + Math.max(0, cs.length - 1) * G.V_GAP;
        let top = -total / 2;
        for (const c of cs) {
          const h = heights.get(c.id) ?? 0;
          place(c, side === 'right' ? rs.w / 2 + G.H_GAP : -rs.w / 2 - G.H_GAP, top + h / 2, side, 1, { dx: off.dx, dy: off.dy });
          top += h + G.V_GAP;
        }
      }
    }
  }
  // Free-floating sticky notes.
  for (const n of nodes) {
    if (n.kind === 'sticky') out.push({ node: n, x: n.x ?? 0, y: n.y ?? 0, w: G.STICKY_W, h: G.STICKY_H, notesH: 0, side: null, depth: 0 });
  }
  return out;
}

export function bounds(placed: Placed[]) {
  if (!placed.length) return { x: -200, y: -120, w: 400, h: 240 };
  const xs = placed.flatMap((p) => [p.x, p.x + Math.max(p.w, p.notesH ? G.NOTE_W : 0)]);
  const ys = placed.flatMap((p) => [p.y, p.y + p.h + (p.notesH ? 8 + p.notesH : 0)]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

/** Attachment point on the topic box for connectors. */
export function port(p: Placed, towards: 'left' | 'right') {
  const cy = p.y + p.h / 2;
  return { x: towards === 'right' ? p.x + p.w : p.x, y: cy };
}
