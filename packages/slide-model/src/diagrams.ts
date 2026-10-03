// Ready-made diagrams (Google Slides' Insert → Diagram): one group of shapes, text and connectors, generated from a
// kind, a number of items and a colour scheme. docs/ARCHITECTURE.md §34.
import type { ConnSite } from './connectors';
import { newId, textDoc, type DeckSize, type PlainElement } from './index';

export type DiagramKind = 'process' | 'timeline' | 'cycle' | 'hierarchy' | 'grid' | 'relationship';

export const DIAGRAMS: { kind: DiagramKind; label: string; min: number; max: number; def: number }[] = [
  { kind: 'process', label: 'Process', min: 2, max: 6, def: 4 },
  { kind: 'timeline', label: 'Timeline', min: 2, max: 6, def: 4 },
  { kind: 'cycle', label: 'Cycle', min: 3, max: 6, def: 4 },
  { kind: 'hierarchy', label: 'Hierarchy', min: 2, max: 5, def: 3 },
  { kind: 'grid', label: 'Grid', min: 2, max: 9, def: 4 },
  { kind: 'relationship', label: 'Relationship', min: 2, max: 3, def: 3 },
];

export interface DiagramOptions {
  count: number;
  /** One accent for every item, or 'multi' for a different accent per item. */
  color: number | 'multi';
}

const LABELS: Record<DiagramKind, (i: number) => string> = {
  process: (i) => `Step ${i + 1}`,
  timeline: (i) => `Milestone ${i + 1}`,
  cycle: (i) => `Stage ${i + 1}`,
  hierarchy: (i) => (i === 0 ? 'Lead' : `Team ${i}`),
  grid: (i) => `Item ${i + 1}`,
  relationship: (i) => ['Idea', 'People', 'Process'][i] ?? `Area ${i + 1}`,
};

/** Side of `a` facing `b` (dominant direction). */
function facing(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }): ConnSite {
  const dx = b.x + b.w / 2 - (a.x + a.w / 2);
  const dy = b.y + b.h / 2 - (a.y + a.h / 2);
  return Math.abs(dx) * a.h >= Math.abs(dy) * a.w ? (dx >= 0 ? 'e' : 'w') : dy >= 0 ? 's' : 'n';
}

/** The diagram's elements (z from 1, one shared group id), laid out in the middle of the slide. */
export function diagramElements(kind: DiagramKind, opts: DiagramOptions, size: DeckSize): PlainElement[] {
  const spec = DIAGRAMS.find((d) => d.kind === kind)!;
  const n = Math.min(spec.max, Math.max(spec.min, Math.round(opts.count)));
  const group = newId();
  const { w: W, h: H } = size;
  const area = { x: W * 0.08, y: H * 0.26, w: W * 0.84, h: H * 0.62 };
  const accent = (i: number) => `@accent${opts.color === 'multi' ? (i % 6) + 1 : opts.color}`;
  const out: PlainElement[] = [];
  let z = 1;
  const box = (i: number, x: number, y: number, w: number, h: number, geom: PlainElement['geom'] = 'roundRect', extra: Partial<PlainElement> = {}): PlainElement => {
    const el: PlainElement = {
      id: newId(),
      type: 'shape',
      geom,
      x: Math.round(x),
      y: Math.round(y),
      w: Math.round(w),
      h: Math.round(h),
      z: z++,
      group,
      style: { fill: accent(i), stroke: null, color: '#FFFFFF', fontSize: 16, bold: true, align: 'center', vAlign: 'middle', radius: 12 },
      text: textDoc(LABELS[kind](i), { align: 'center' }),
      ...extra,
    };
    out.push(el);
    return el;
  };
  const link = (a: PlainElement, b: PlainElement, kindOf: 'straight' | 'elbow' | 'curved' = 'straight', arrow = true) =>
    out.push({
      id: newId(),
      type: 'shape',
      geom: arrow ? 'arrow' : 'line',
      x: a.x,
      y: a.y,
      w: 1,
      h: 1,
      z: z++,
      group,
      style: { stroke: '@muted', strokeWidth: 3 },
      conn: { kind: kindOf, from: { id: a.id, site: facing(a, b) }, to: { id: b.id, site: facing(b, a) } },
    });

  switch (kind) {
    case 'process': {
      const gap = area.w * 0.05;
      const bw = (area.w - gap * (n - 1)) / n;
      const bh = Math.min(area.h * 0.45, bw * 0.75);
      const items = Array.from({ length: n }, (_, i) => box(i, area.x + i * (bw + gap), area.y + (area.h - bh) / 2, bw, bh));
      for (let i = 0; i < n - 1; i++) link(items[i], items[i + 1]);
      break;
    }
    case 'timeline': {
      const midY = area.y + area.h / 2;
      out.push({ id: newId(), type: 'shape', geom: 'arrow', x: area.x, y: midY, w: area.w, h: 0, z: z++, group, style: { stroke: '@muted', strokeWidth: 4 } });
      const step = area.w / n;
      for (let i = 0; i < n; i++) {
        const cx = area.x + step * (i + 0.5);
        const d = 26;
        box(i, cx - d / 2, midY - d / 2, d, d, 'ellipse', { text: null, style: { fill: accent(i), stroke: '#FFFFFF', strokeWidth: 3 } });
        const up = i % 2 === 0;
        const tw = Math.min(step * 1.6, 260);
        out.push({
          id: newId(),
          type: 'text',
          x: Math.round(cx - tw / 2),
          y: Math.round(up ? midY - 120 : midY + 34),
          w: Math.round(tw),
          h: 86,
          z: z++,
          group,
          style: { fontSize: 16, align: 'center', vAlign: up ? 'bottom' : 'top', color: '@text' },
          text: { type: 'doc', content: [{ type: 'paragraph', attrs: { textAlign: 'center' }, content: [{ type: 'text', text: LABELS.timeline(i), marks: [{ type: 'bold' }] }] }, { type: 'paragraph', attrs: { textAlign: 'center' }, content: [{ type: 'text', text: `Q${(i % 4) + 1}` }] }] },
        });
      }
      break;
    }
    case 'cycle': {
      const r = Math.min(area.w, area.h) * 0.38;
      const cx = area.x + area.w / 2;
      const cy = area.y + area.h / 2;
      const d = Math.min(150, (2 * Math.PI * r) / n / 1.6);
      const items = Array.from({ length: n }, (_, i) => {
        const a = -Math.PI / 2 + (2 * Math.PI * i) / n;
        return box(i, cx + r * Math.cos(a) - d / 2, cy + r * Math.sin(a) - d / 2, d, d, 'ellipse', { style: { fill: accent(i), stroke: null, color: '#FFFFFF', fontSize: 14, bold: true, align: 'center', vAlign: 'middle' } });
      });
      for (let i = 0; i < n; i++) link(items[i], items[(i + 1) % n]);
      break;
    }
    case 'hierarchy': {
      const bw = Math.min(220, (area.w - 40 * (n - 2)) / Math.max(1, n - 1));
      const bh = 80;
      const root = box(0, area.x + (area.w - bw) / 2, area.y, bw, bh);
      const kids = n - 1;
      const gap = kids > 1 ? (area.w - kids * bw) / (kids - 1) : 0;
      const startX = kids > 1 ? area.x : area.x + (area.w - bw) / 2;
      for (let i = 0; i < kids; i++) {
        const kid = box(i + 1, startX + i * (bw + gap), area.y + area.h - bh - 20, bw, bh);
        out.push({ id: newId(), type: 'shape', geom: 'line', x: root.x, y: root.y, w: 1, h: 1, z: z++, group, style: { stroke: '@muted', strokeWidth: 3 }, conn: { kind: 'elbow', from: { id: root.id, site: 's' }, to: { id: kid.id, site: 'n' } } });
      }
      break;
    }
    case 'grid': {
      const cols = Math.ceil(Math.sqrt(n));
      const rows = Math.ceil(n / cols);
      const gap = 24;
      const bw = (area.w - gap * (cols - 1)) / cols;
      const bh = (area.h - gap * (rows - 1)) / rows;
      for (let i = 0; i < n; i++) box(i, area.x + (i % cols) * (bw + gap), area.y + Math.floor(i / cols) * (bh + gap), bw, bh);
      break;
    }
    case 'relationship': {
      const d = Math.min(area.h * 0.75, area.w / (n * 0.75 + 0.25));
      const total = d + (n - 1) * d * 0.7;
      const x0 = area.x + (area.w - total) / 2;
      for (let i = 0; i < n; i++) {
        const y = n === 3 && i === 1 ? area.y + area.h - d : area.y + (n === 3 ? 0 : (area.h - d) / 2);
        box(i, x0 + i * d * 0.7, y, d, d, 'ellipse', { style: { fill: accent(opts.color === 'multi' ? i : i + 1), stroke: null, color: '#FFFFFF', fontSize: 18, bold: true, align: 'center', vAlign: 'middle', opacity: 0.78 } });
      }
      break;
    }
  }
  return out;
}
