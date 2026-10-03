// Connectors: lines whose ends are attached to shapes (docs/ARCHITECTURE.md §33).
import type { PlainElement, PlainSlide } from './index';

export type ConnSite = 'n' | 'e' | 's' | 'w';
export interface Connector {
  kind?: 'straight' | 'elbow' | 'curved';
  from?: { id: string; site: ConnSite };
  to?: { id: string; site: ConnSite };
}

/** Connection point of an element (middle of a side), in slide coordinates, rotation included. */
export function sitePoint(el: Pick<PlainElement, 'x' | 'y' | 'w' | 'h' | 'rot'>, site: ConnSite): { x: number; y: number } {
  const lx = site === 'e' ? el.w / 2 : site === 'w' ? -el.w / 2 : 0;
  const ly = site === 's' ? el.h / 2 : site === 'n' ? -el.h / 2 : 0;
  const a = ((el.rot ?? 0) * Math.PI) / 180;
  return { x: el.x + el.w / 2 + lx * Math.cos(a) - ly * Math.sin(a), y: el.y + el.h / 2 + lx * Math.sin(a) + ly * Math.cos(a) };
}

/** Start / end of a line element (its box plus flips). */
export function lineEnds(el: Pick<PlainElement, 'x' | 'y' | 'w' | 'h' | 'flipH' | 'flipV'>) {
  return {
    s: { x: el.flipH ? el.x + el.w : el.x, y: el.flipV ? el.y + el.h : el.y },
    e: { x: el.flipH ? el.x : el.x + el.w, y: el.flipV ? el.y : el.y + el.h },
  };
}

/** Box + flips of a line from its two ends. */
export function lineBox(s: { x: number; y: number }, e: { x: number; y: number }) {
  return { x: Math.min(s.x, e.x), y: Math.min(s.y, e.y), w: Math.abs(e.x - s.x), h: Math.abs(e.y - s.y), flipH: s.x > e.x || undefined, flipV: s.y > e.y || undefined };
}

/**
 * Attached connector ends follow their shapes: the geometry is derived when drawing (the stored box is only the
 * fallback when a shape it was attached to is gone), so moving a shape never needs to write its connectors.
 */
export function resolveConnectors(slide: PlainSlide): PlainSlide {
  if (!slide.elements.some((e) => e.conn?.from || e.conn?.to)) return slide;
  const byId = new Map(slide.elements.map((e) => [e.id, e]));
  return {
    ...slide,
    elements: slide.elements.map((e) => {
      if (!e.conn || !(e.conn.from || e.conn.to)) return e;
      const ends = lineEnds(e);
      const a = e.conn.from && byId.get(e.conn.from.id);
      const b = e.conn.to && byId.get(e.conn.to.id);
      const s = a && a !== e ? sitePoint(a, e.conn.from!.site) : ends.s;
      const t = b && b !== e ? sitePoint(b, e.conn.to!.site) : ends.e;
      const box = lineBox(s, t);
      return { ...e, x: box.x, y: box.y, w: box.w, h: box.h, flipH: box.flipH, flipV: box.flipV, rot: undefined };
    }),
  };
}

/** After copying elements under new ids: connectors point at the copies of the shapes copied with them. */
export function remapConnectors(els: PlainElement[], ids: Map<string, string>): PlainElement[] {
  return els.map((e) => {
    if (!e.conn || !(e.conn.from || e.conn.to)) return e;
    const end = (x?: { id: string; site: ConnSite }) => (x ? { ...x, id: ids.get(x.id) ?? x.id } : undefined);
    const from = end(e.conn.from);
    const to = end(e.conn.to);
    return { ...e, conn: { ...e.conn, ...(from ? { from } : {}), ...(to ? { to } : {}) } };
  });
}
