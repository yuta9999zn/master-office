// AI → Slides (docs/ARCHITECTURE.md §80). Two kinds of answers:
//  • a deck outline (slides with a layout, title, bullets) laid onto the deck's own layouts and theme;
//  • a free design (banner, business card, poster): elements placed in PERCENT of the canvas — small models are far
//    better at "left 8 %, top 30 %" than at pixels — scaled here to the real size, clamped and layered.
import { newId, newSlide, textDoc, THEMES, type Background, type DeckSize, type ElementStyle, type Geometry, type LayoutId, type PlainDeck, type PlainElement, type PlainSlide, type Theme } from '@workos/slide-model';

// ── Formats ─────────────────────────────────────────────────────────────────

/** Canvas sizes (CSS px at 96 dpi, as the slide editor and the .pptx export use). */
export const DESIGN_FORMATS: Record<string, { label: string; size: DeckSize; note: string }> = {
  deck: { label: 'Presentation 16:9', size: { w: 1280, h: 720 }, note: 'slides' },
  'banner-web': { label: 'Web banner 1200 × 628', size: { w: 1200, h: 628 }, note: 'Facebook / LinkedIn link image, website hero' },
  'banner-wide': { label: 'Wide banner 1500 × 500', size: { w: 1500, h: 500 }, note: 'website header, X / Twitter header' },
  'banner-square': { label: 'Square post 1080 × 1080', size: { w: 1080, h: 1080 }, note: 'Instagram / Facebook post' },
  'banner-story': { label: 'Story 1080 × 1920', size: { w: 1080, h: 1920 }, note: 'Instagram / TikTok story' },
  'banner-leaderboard': { label: 'Leaderboard 728 × 90', size: { w: 728, h: 90 }, note: 'web ad strip' },
  poster: { label: 'Poster A4', size: { w: 794, h: 1123 }, note: 'printed flyer' },
  'business-card': { label: 'Business card 3.5 × 2 in', size: { w: 336, h: 192 }, note: 'US / Japan card (91 × 55 mm close)' },
  'business-card-eu': { label: 'Business card 85 × 55 mm', size: { w: 321, h: 208 }, note: 'Vietnam / EU card' },
};

// ── Deck outline ────────────────────────────────────────────────────────────

export type OutlineLayout = 'title' | 'section' | 'bullets' | 'twoColumn' | 'bigNumber' | 'quote';
const OUTLINE_LAYOUTS: OutlineLayout[] = ['title', 'section', 'bullets', 'twoColumn', 'bigNumber', 'quote'];
export interface DeckOutline {
  title: string;
  theme?: string;
  slides: { layout: OutlineLayout; title: string; subtitle?: string; bullets?: string[]; right?: string[]; notes?: string }[];
}
export const DECK_OUTLINE_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    theme: { type: 'string', enum: THEMES.map((t) => t.id) },
    slides: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          layout: { type: 'string', enum: OUTLINE_LAYOUTS },
          title: { type: 'string' },
          subtitle: { type: 'string' },
          bullets: { type: 'array', items: { type: 'string' } },
          right: { type: 'array', items: { type: 'string' } },
          notes: { type: 'string' },
        },
        required: ['layout', 'title'],
      },
    },
  },
  required: ['title', 'slides'],
};

const LAYOUT_OF: Record<OutlineLayout, LayoutId> = { title: 'title', section: 'section', bullets: 'titleContent', twoColumn: 'twoContent', bigNumber: 'bigNumber', quote: 'mainPoint' };

export function slidesFromOutline(raw: Partial<DeckOutline>, size: DeckSize, theme: Theme): PlainSlide[] {
  const slides = (raw.slides ?? []).filter((s) => s && typeof s === 'object').slice(0, 40);
  if (!slides.length) throw new Error('The model wrote no slides');
  return slides.map((s, i) => {
    // Small-model slips: a title that is just a number, two columns with nothing in them.
    const bullets = (s.bullets ?? []).filter((b) => String(b).trim());
    if (/^\s*\d+\s*$/.test(String(s.title ?? '')) && s.layout !== 'bigNumber') s.title = bullets.shift() ?? `${i + 1}`;
    if (s.layout === 'twoColumn' && !bullets.length && !(s.right ?? []).some((b) => String(b).trim())) s.layout = s.subtitle ? 'section' : 'bullets';
    s.bullets = bullets;
    const layout = LAYOUT_OF[OUTLINE_LAYOUTS.includes(s.layout) ? s.layout : i === 0 ? 'title' : 'bullets'];
    const slide = newSlide(layout, size, theme);
    const clean = (xs?: string[]) => (xs ?? []).map((x) => String(x).replace(/^[-•*\d.)\s]+/, '').trim()).filter(Boolean).slice(0, 8);
    for (const el of slide.elements) {
      if (el.ph === 'title') el.text = textDoc(String(s.title ?? '').slice(0, 140), el.style?.align ? { align: el.style.align } : {});
      if (el.ph === 'subtitle') el.text = textDoc(String(s.subtitle ?? '').slice(0, 200), el.style?.align ? { align: el.style.align } : {});
      if (el.ph === 'body') {
        const lines = layout === 'bigNumber' ? [s.subtitle ?? clean(s.bullets)[0] ?? ''] : clean(s.bullets);
        el.text = textDoc(lines.length ? lines : [s.subtitle ?? ''], layout === 'bigNumber' ? { align: 'center' } : { bullets: true });
      }
      if (el.ph === 'body2') el.text = textDoc(clean(s.right).length ? clean(s.right) : [''], { bullets: true });
    }
    slide.notes = String(s.notes ?? '').slice(0, 2000);
    return slide;
  });
}

// ── Free design: banner, card, poster ───────────────────────────────────────

export type DesignShape = 'rect' | 'roundRect' | 'ellipse' | 'triangle' | 'diamond' | 'hexagon' | 'chevron' | 'star5' | 'line' | 'parallelogram' | 'heart' | 'cloud';
const DESIGN_SHAPES: DesignShape[] = ['rect', 'roundRect', 'ellipse', 'triangle', 'diamond', 'hexagon', 'chevron', 'star5', 'line', 'parallelogram', 'heart', 'cloud'];
export interface DesignElement {
  kind: 'text' | 'shape';
  /** What the element is for — helps the model plan and the editor label it. */
  role?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  text?: string;
  fontSize?: number;
  bold?: boolean;
  italic?: boolean;
  color?: string;
  align?: 'left' | 'center' | 'right';
  font?: string;
  shape?: DesignShape;
  fill?: string;
  opacity?: number;
  radius?: number;
}
export interface DesignSpec {
  title: string;
  background: { type: 'solid' | 'gradient'; color?: string; from?: string; to?: string; angle?: number };
  /** Card / poster: a second side or page. */
  pages: { elements: DesignElement[] }[];
}
const color = { type: 'string', pattern: '^#[0-9A-Fa-f]{6}$' };
export const DESIGN_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    background: { type: 'object', properties: { type: { type: 'string', enum: ['solid', 'gradient'] }, color, from: color, to: color, angle: { type: 'number' } }, required: ['type'] },
    pages: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          elements: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                kind: { type: 'string', enum: ['text', 'shape'] },
                role: { type: 'string' },
                x: { type: 'number' },
                y: { type: 'number' },
                w: { type: 'number' },
                h: { type: 'number' },
                text: { type: 'string' },
                fontSize: { type: 'number' },
                bold: { type: 'boolean' },
                color,
                align: { type: 'string', enum: ['left', 'center', 'right'] },
                shape: { type: 'string', enum: DESIGN_SHAPES },
                fill: color,
                opacity: { type: 'number' },
              },
              required: ['kind', 'x', 'y', 'w', 'h'],
            },
          },
        },
        required: ['elements'],
      },
    },
  },
  required: ['title', 'background', 'pages'],
};

const HEX = /^#[0-9a-f]{6}$/i;
const hex = (c: unknown, fallback: string) => (typeof c === 'string' && HEX.test(c.trim()) ? c.trim().toUpperCase() : fallback);
const clamp = (v: unknown, lo: number, hi: number, d: number) => {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : d;
  return Math.min(hi, Math.max(lo, n));
};
/** Relative luminance, to keep text readable on its background. */
function lum(c: string) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrast = (a: string, b: string) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);

/** Builds one slide per page of the design. Coordinates arrive in percent (0–100) of the canvas. */
export function slidesFromDesign(raw: Partial<DesignSpec>, size: DeckSize, theme: Theme): { slides: PlainSlide[]; warnings: string[] } {
  const warnings: string[] = [];
  const bgIn = raw.background ?? { type: 'solid', color: '#FFFFFF' };
  const background: Background =
    bgIn.type === 'gradient' && HEX.test(String(bgIn.from)) && HEX.test(String(bgIn.to))
      ? { type: 'gradient', from: hex(bgIn.from, '#FFFFFF'), to: hex(bgIn.to, '#FFFFFF'), angle: clamp(bgIn.angle, 0, 360, 135) }
      : { type: 'solid', color: hex(bgIn.color ?? bgIn.from, '#FFFFFF') };
  const bgColor = background.type === 'solid' ? background.color : background.from;
  const pages = (raw.pages ?? []).filter((p) => p && Array.isArray(p.elements)).slice(0, 4);
  if (!pages.length) throw new Error('The model placed no elements');
  // Typical font sizes scale with the canvas: a 192 px-high card needs ~7–16 pt, a 628 px banner ~18–64 pt.
  const maxFont = Math.max(10, Math.round(size.h * 0.22));
  const slides = pages.map((p) => {
    const slide: PlainSlide = { id: newId(), meta: { layout: 'blank', background }, notes: '', elements: [] };
    // Shapes first (behind), then text, in the order given.
    const els = [...p.elements].filter((e) => e && typeof e === 'object').slice(0, 30);
    const ordered = [...els.filter((e) => e.kind === 'shape'), ...els.filter((e) => e.kind !== 'shape')];
    ordered.forEach((e, i) => {
      const x = (clamp(e.x, -10, 100, 0) / 100) * size.w;
      const y = (clamp(e.y, -10, 100, 0) / 100) * size.h;
      const w = Math.max(4, (clamp(e.w, 0.5, 120, 20) / 100) * size.w);
      const h = Math.max(2, (clamp(e.h, 0.3, 120, 10) / 100) * size.h);
      const base: PlainElement = { id: newId(), type: 'text', x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h), z: i + 1, name: e.role ? String(e.role).slice(0, 40) : undefined };
      if (e.kind === 'shape') {
        const shape = (DESIGN_SHAPES.includes(e.shape as DesignShape) ? e.shape : 'rect') as Geometry;
        const style: ElementStyle = { fill: hex(e.fill, theme.colors.accents[0]), stroke: null, opacity: clamp(e.opacity, 0.05, 1, 1), ...(shape === 'roundRect' ? { radius: clamp(e.radius, 0, 200, Math.min(w, h) * 0.2) } : {}) };
        if (shape === 'line') Object.assign(style, { stroke: hex(e.fill ?? e.color, theme.colors.title), strokeWidth: 2, fill: null });
        slide.elements.push({ ...base, type: 'shape', geom: shape, style, ...(e.text ? { text: textDoc(String(e.text).slice(0, 200), { align: e.align ?? 'center' }) } : {}) });
        return;
      }
      const text = String(e.text ?? '').slice(0, 400);
      if (!text.trim()) return;
      // Text colour: what was asked, unless it vanishes on the background.
      let c = hex(e.color, theme.colors.title);
      if (contrast(c, bgColor) < 2.2) {
        const fixed = lum(bgColor) > 0.4 ? '#0F172A' : '#FFFFFF';
        warnings.push(`text “${text.slice(0, 20)}” recoloured for contrast`);
        c = fixed;
      }
      const fontSize = clamp(e.fontSize, 5, maxFont, Math.max(8, Math.round(size.h * 0.06)));
      slide.elements.push({
        ...base,
        type: 'text',
        text: textDoc(text.split('\n'), { align: e.align ?? 'left', ...(e.italic ? { marks: [{ type: 'italic' }] } : {}) }),
        style: { fontSize, bold: !!e.bold, color: c, align: e.align ?? 'left', vAlign: 'middle', fontFamily: e.font || theme.fonts.heading, autofit: 'shrink', pad: 2 } as ElementStyle,
      });
    });
    return slide;
  });
  return { slides, warnings: [...new Set(warnings)].slice(0, 10) };
}

export function deckOf(name: string, size: DeckSize, theme: Theme, slides: PlainSlide[]): PlainDeck {
  return { name, size, theme, slides };
}

export const themeById = (id?: string) => THEMES.find((t) => t.id === id) ?? THEMES[0];
