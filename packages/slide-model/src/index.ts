// Presentation model shared by the browser editor and the server (PPTX/PDF/PNG import-export, seeding, search).
// docs/ARCHITECTURE.md §7.3 — every element is its own Y.Map so two people moving / recolouring different
// elements (or different properties of one element) never overwrite each other.
//
// Yjs layout (created by the server when a presentation is created, imported, seeded or copied; clients never
// lazily create the top-level containers):
//   Y.Map   'deck'        name, size {w,h}, theme (Theme JSON), numbers (SlideNumbers)
//   Y.Array 'slideOrder'  slideId[]  (a slide moved by two people at once may appear twice: readers dedupe)
//   Y.Map   'slides'      slideId → Y.Map {
//                            meta:     SlideMeta (layout, background, hidden, transition)
//                            notes:    Y.Text (speaker notes)
//                            elements: Y.Map<elementId, Y.Map {
//                                         type, x, y, w, h, rot, z, flipH, flipV, geom, ph, name, style, src, alt, chart, table,
//                                         group (id shared by grouped elements), anim (ElementAnim),
//                                         text:  Y.XmlFragment   (text boxes and shapes — same encoding as y-prosemirror)
//                                         cells: Y.Map<"rowId:colId", string>  (tables)
//                                      }>
//                          }
import * as Y from 'yjs';

export const DECK_MAP = 'deck';
export const ORDER_ARRAY = 'slideOrder';
export const SLIDES_MAP = 'slides';

// ── Types ────────────────────────────────────────────────────────────────────

/** ProseMirror JSON (same shape as Tiptap's JSONContent) for rich text inside text boxes and shapes. */
export interface TextNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: TextNode[];
  text?: string;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
}

export interface Theme {
  id: string;
  name: string;
  colors: { bg: string; text: string; title: string; muted: string; accents: string[] };
  fonts: { heading: string; body: string };
}

export type Background =
  | { type: 'solid'; color: string }
  | { type: 'gradient'; from: string; to: string; angle: number }
  | { type: 'image'; src: string };

export type LayoutId = 'title' | 'titleContent' | 'section' | 'twoContent' | 'titleOnly' | 'blank';
export type Transition = 'none' | 'fade' | 'push' | 'wipe';

export interface SlideMeta {
  layout: LayoutId;
  background?: Background | null;
  hidden?: boolean;
  transition?: Transition;
}

export type ElementType = 'text' | 'shape' | 'image' | 'table' | 'chart' | 'video' | 'audio';
export type Geometry =
  | 'rect'
  | 'roundRect'
  | 'ellipse'
  | 'triangle'
  | 'rtTriangle'
  | 'diamond'
  | 'pentagon'
  | 'hexagon'
  | 'parallelogram'
  | 'trapezoid'
  | 'rightArrow'
  | 'leftArrow'
  | 'chevron'
  | 'star5'
  | 'line'
  | 'arrow';

export type Placeholder = 'title' | 'subtitle' | 'body' | 'body2';

export interface ElementStyle {
  fill?: string | null; // shape fill colour (null / undefined = none)
  stroke?: string | null;
  strokeWidth?: number;
  dash?: 'solid' | 'dash' | 'dot';
  radius?: number; // roundRect corner radius (px)
  opacity?: number; // 0..1
  shadow?: boolean;
  // Pictures: adjustments (-100…100, 0 = unchanged) and recolouring
  brightness?: number;
  contrast?: number;
  recolor?: 'grayscale' | 'sepia' | 'washout';
  // Default text formatting of the box (runs may override)
  fontSize?: number; // pt
  fontFamily?: string;
  color?: string;
  bold?: boolean;
  align?: 'left' | 'center' | 'right' | 'justify';
  vAlign?: 'top' | 'middle' | 'bottom';
  lineHeight?: number;
  pad?: number; // inner padding (px)
}

export interface ChartSeries {
  name: string;
  values: number[];
  color?: string;
}
export interface ChartSpec {
  kind: 'column' | 'bar' | 'line' | 'area' | 'pie' | 'doughnut';
  title?: string;
  categories: string[];
  series: ChartSeries[];
  legend?: boolean;
  labels?: boolean;
  /** Data linked from a Master Office spreadsheet ("Refresh from Sheets" re-reads it). */
  source?: { resourceId: string; name?: string; sheet?: string; range: string } | null;
}

export interface TableSpec {
  rows: string[]; // row ids
  cols: string[]; // column ids
  colW?: number[]; // relative widths
  header?: boolean;
  banded?: boolean;
  fontSize?: number; // pt
  headerFill?: string;
  border?: string;
}

/** Index-based element — what importers produce, exporters and renderers consume. */
export interface PlainElement {
  id: string;
  type: ElementType;
  x: number;
  y: number;
  w: number;
  h: number;
  rot?: number;
  z: number;
  flipH?: boolean;
  flipV?: boolean;
  geom?: Geometry;
  ph?: Placeholder | null;
  name?: string;
  style?: ElementStyle;
  text?: TextNode | null; // { type: 'doc', content: [...] }
  src?: string;
  alt?: string;
  chart?: ChartSpec;
  table?: { rows: string[][]; colW?: number[]; header?: boolean; banded?: boolean; fontSize?: number; headerFill?: string; border?: string };
  /** Elements sharing a group id are selected, moved and resized together (one level, like Google Slides). */
  group?: string;
  anim?: ElementAnim;
  /** Picture crop: fraction of the source image cut off each side (0…1). */
  crop?: Crop;
  /** Video / audio playback options (`src` is a YouTube link or an uploaded file). */
  media?: MediaOptions;
}

export interface MediaOptions {
  start?: number; // seconds
  end?: number;
  autoplay?: boolean; // when the slide appears in the slide show
  muted?: boolean;
  loop?: boolean;
}

/** YouTube video id of a watch / share / embed / shorts link, else null. */
export function youtubeId(url: string | null | undefined): string | null {
  const m = /(?:youtube(?:-nocookie)?\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([\w-]{11})/.exec(url ?? '');
  return m ? m[1] : null;
}

export interface Crop {
  l: number;
  t: number;
  r: number;
  b: number;
}

/** "Insert → Slide numbers" (deck-wide, like Google Slides). */
export interface SlideNumbers {
  show: boolean;
  skipTitle?: boolean;
}

// ── Animations ───────────────────────────────────────────────────────────────

export type AnimEffect =
  | 'appear'
  | 'fadeIn'
  | 'flyInLeft'
  | 'flyInRight'
  | 'flyInTop'
  | 'flyInBottom'
  | 'zoomIn'
  | 'spinIn'
  | 'disappear'
  | 'fadeOut'
  | 'flyOutLeft'
  | 'flyOutRight'
  | 'flyOutTop'
  | 'flyOutBottom'
  | 'zoomOut';

export interface ElementAnim {
  effect: AnimEffect;
  /** On click, with the previous animation, or after it (Google Slides / PowerPoint semantics). */
  start: 'click' | 'with' | 'after';
  dur: number; // ms
  delay?: number; // ms
  order: number; // position in the slide's animation list
}

export const ANIM_EFFECTS: { id: AnimEffect; label: string; exit?: boolean }[] = [
  { id: 'appear', label: 'Appear' },
  { id: 'fadeIn', label: 'Fade in' },
  { id: 'flyInLeft', label: 'Fly in from left' },
  { id: 'flyInRight', label: 'Fly in from right' },
  { id: 'flyInBottom', label: 'Fly in from bottom' },
  { id: 'flyInTop', label: 'Fly in from top' },
  { id: 'zoomIn', label: 'Zoom in' },
  { id: 'spinIn', label: 'Spin' },
  { id: 'disappear', label: 'Disappear', exit: true },
  { id: 'fadeOut', label: 'Fade out', exit: true },
  { id: 'flyOutLeft', label: 'Fly out to left', exit: true },
  { id: 'flyOutRight', label: 'Fly out to right', exit: true },
  { id: 'flyOutBottom', label: 'Fly out to bottom', exit: true },
  { id: 'flyOutTop', label: 'Fly out to top', exit: true },
  { id: 'zoomOut', label: 'Zoom out', exit: true },
];
export const isExitEffect = (e: AnimEffect) => ANIM_EFFECTS.find((x) => x.id === e)?.exit === true;

export interface AnimItem {
  id: string;
  effect: AnimEffect;
  dur: number;
  /** Start time within its step (ms). */
  at: number;
  /** 0 = plays when the slide appears; 1… = the n-th click. */
  step: number;
}

/**
 * The slide's animations as steps: items before the first "on click" play when the slide appears (step 0);
 * each "on click" opens a new step; "with" starts together with the previous item, "after" when it ends.
 */
export function animTimeline(slide: PlainSlide): { items: AnimItem[]; clicks: number } {
  const list = slide.elements.filter((e) => e.anim).sort((a, b) => a.anim!.order - b.anim!.order || (a.id < b.id ? -1 : 1));
  const items: AnimItem[] = [];
  let step = 0;
  let prevStart = 0;
  let prevEnd = 0;
  list.forEach((e, i) => {
    const a = e.anim!;
    const delay = Math.max(0, a.delay ?? 0);
    const dur = a.effect === 'appear' || a.effect === 'disappear' ? 0 : Math.max(0, a.dur);
    let at: number;
    if (a.start === 'click') {
      step++;
      prevStart = 0;
      prevEnd = 0;
      at = delay;
    } else if (i === 0) at = delay;
    else if (a.start === 'with') at = prevStart + delay;
    else at = prevEnd + delay;
    prevStart = at;
    prevEnd = Math.max(prevEnd, at + dur);
    items.push({ id: e.id, effect: a.effect, dur, at, step });
  });
  return { items, clicks: step };
}

/**
 * Per-element CSS for a slide shown at a given step of its animations (`playing`: animate the items of that step,
 * otherwise show their end state). Used by the slide show and the motion panel preview.
 */
export function animCss(slide: PlainSlide, step: number, playing: boolean): Record<string, string> {
  const css: Record<string, string> = {};
  for (const it of animTimeline(slide).items) {
    const exit = isExitEffect(it.effect);
    if (it.step > step) {
      if (!exit) css[it.id] = 'visibility:hidden';
    } else if (it.step === step && playing) {
      css[it.id] = it.dur
        ? `animation:mo-${it.effect} ${it.dur}ms ease-out ${it.at}ms both`
        : `animation:mo-${exit ? 'disappear' : 'appear'} 1ms linear ${it.at}ms both`;
    } else if (exit) css[it.id] = 'visibility:hidden';
  }
  return css;
}

export interface PlainSlide {
  id: string;
  meta: SlideMeta;
  notes: string;
  elements: PlainElement[];
  /** Position in the deck (1-based), filled in when the deck is read; not stored. */
  no?: number;
}

export interface DeckSize {
  w: number;
  h: number;
}

export interface PlainDeck {
  name: string;
  size: DeckSize;
  theme: Theme;
  slides: PlainSlide[];
  numbers?: SlideNumbers;
}

// ── Constants ────────────────────────────────────────────────────────────────

/** Slide coordinates are CSS px at 96 dpi: 1280 × 720 = 13.333" × 7.5" (PowerPoint widescreen). */
export const SLIDE_SIZES: { id: string; label: string; size: DeckSize }[] = [
  { id: '16:9', label: 'Widescreen (16:9)', size: { w: 1280, h: 720 } },
  { id: '4:3', label: 'Standard (4:3)', size: { w: 960, h: 720 } },
  { id: '16:10', label: 'Widescreen (16:10)', size: { w: 1280, h: 800 } },
  { id: 'a4', label: 'A4 paper', size: { w: 1123, h: 794 } },
];
export const DEFAULT_SIZE: DeckSize = { w: 1280, h: 720 };

export const FONTS = ['Inter', 'Arial', 'Calibri', 'Helvetica', 'Georgia', 'Times New Roman', 'Garamond', 'Verdana', 'Trebuchet MS', 'Courier New', 'Roboto', 'Noto Sans JP'];

export const THEMES: Theme[] = [
  {
    id: 'master',
    name: 'Master Office',
    colors: { bg: '#FFFFFF', text: '#334155', title: '#0F172A', muted: '#94A3B8', accents: ['#2563EB', '#8B5CF6', '#38BDF8', '#10B981', '#F59E0B', '#EF4444'] },
    fonts: { heading: 'Inter', body: 'Inter' },
  },
  {
    id: 'natural-beauty',
    name: 'Natural Beauty',
    colors: { bg: '#FFFFFF', text: '#475569', title: '#111827', muted: '#9CA3AF', accents: ['#F28B9B', '#F9C5CF', '#3B82F6', '#22C55E', '#A7F3D0', '#E11D48'] },
    fonts: { heading: 'Inter', body: 'Inter' },
  },
  {
    id: 'midnight',
    name: 'Midnight',
    colors: { bg: '#0F172A', text: '#CBD5E1', title: '#F8FAFC', muted: '#64748B', accents: ['#38BDF8', '#8B5CF6', '#F472B6', '#34D399', '#FBBF24', '#F87171'] },
    fonts: { heading: 'Inter', body: 'Inter' },
  },
  {
    id: 'sunset',
    name: 'Sunset',
    colors: { bg: '#FFF7ED', text: '#57534E', title: '#7C2D12', muted: '#A8A29E', accents: ['#EA580C', '#F59E0B', '#DC2626', '#DB2777', '#65A30D', '#0891B2'] },
    fonts: { heading: 'Georgia', body: 'Arial' },
  },
  {
    id: 'forest',
    name: 'Forest',
    colors: { bg: '#F0FDF4', text: '#365314', title: '#14532D', muted: '#86A17A', accents: ['#16A34A', '#65A30D', '#0D9488', '#CA8A04', '#9333EA', '#DC2626'] },
    fonts: { heading: 'Trebuchet MS', body: 'Verdana' },
  },
  {
    id: 'minimal',
    name: 'Minimal',
    colors: { bg: '#FAFAFA', text: '#3F3F46', title: '#18181B', muted: '#A1A1AA', accents: ['#18181B', '#52525B', '#A1A1AA', '#2563EB', '#16A34A', '#DC2626'] },
    fonts: { heading: 'Helvetica', body: 'Helvetica' },
  },
];
export const DEFAULT_THEME = THEMES[0];

export const LAYOUTS: { id: LayoutId; label: string }[] = [
  { id: 'title', label: 'Title slide' },
  { id: 'titleContent', label: 'Title and content' },
  { id: 'section', label: 'Section header' },
  { id: 'twoContent', label: 'Two content' },
  { id: 'titleOnly', label: 'Title only' },
  { id: 'blank', label: 'Blank' },
];

// ── Ids ──────────────────────────────────────────────────────────────────────

let counter = 0;
const prefix = Math.random().toString(36).slice(2, 7);
export const newId = () => `${prefix}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;

// ── Text helpers ─────────────────────────────────────────────────────────────

/** Rich text from plain lines; `bullets` makes a bulleted list. */
export function textDoc(lines: string | string[], opts: { bullets?: boolean; ordered?: boolean; align?: string; marks?: TextNode['marks'] } = {}): TextNode {
  const list = Array.isArray(lines) ? lines : lines.split('\n');
  const para = (t: string): TextNode => ({
    type: 'paragraph',
    ...(opts.align ? { attrs: { textAlign: opts.align } } : {}),
    ...(t ? { content: [{ type: 'text', text: t, ...(opts.marks?.length ? { marks: opts.marks } : {}) }] } : {}),
  });
  if (opts.bullets || opts.ordered) {
    return { type: 'doc', content: [{ type: opts.ordered ? 'orderedList' : 'bulletList', content: list.map((t) => ({ type: 'listItem', content: [para(t)] })) }] };
  }
  return { type: 'doc', content: list.map(para) };
}

/** Plain text of a rich-text doc: paragraphs separated by newlines. */
export function textOf(doc: TextNode | null | undefined): string {
  if (!doc) return '';
  const out: string[] = [];
  const walk = (n: TextNode, line: string[]) => {
    if (n.type === 'text') line.push(n.text ?? '');
    else if (n.type === 'hardBreak') line.push('\n');
    else if (n.type === 'paragraph' || n.type === 'heading') {
      const l: string[] = [];
      n.content?.forEach((c) => walk(c, l));
      out.push(l.join(''));
    } else n.content?.forEach((c) => walk(c, line));
  };
  walk(doc, []);
  return out.join('\n');
}

export const isEmptyText = (doc: TextNode | null | undefined) => !textOf(doc).trim();

// y-prosemirror encoding: a node is a Y.XmlElement named after its type with its non-null attrs as attributes;
// consecutive text nodes form one Y.XmlText whose formatting attributes are { [markType]: markAttrs }.

function fillXml(parent: Y.XmlFragment | Y.XmlElement, nodes: TextNode[]) {
  const items: (Y.XmlElement | Y.XmlText)[] = [];
  let pending: TextNode[] = [];
  const flushText = () => {
    if (!pending.length) return;
    const t = new Y.XmlText();
    items.push(t);
    const runs = pending;
    pending = [];
    // XmlText content can only be inserted once the type is integrated: defer via closure.
    (t as unknown as { _moRuns: TextNode[] })._moRuns = runs;
  };
  for (const n of nodes) {
    if (n.type === 'text') pending.push(n);
    else {
      flushText();
      const el = new Y.XmlElement(n.type);
      for (const [k, v] of Object.entries(n.attrs ?? {})) if (v !== null && v !== undefined) el.setAttribute(k, v as string);
      (el as unknown as { _moChildren: TextNode[] })._moChildren = n.content ?? [];
      items.push(el);
    }
  }
  flushText();
  parent.insert(0, items);
  for (const it of items) {
    if (it instanceof Y.XmlText) {
      let pos = 0;
      for (const r of (it as unknown as { _moRuns: TextNode[] })._moRuns) {
        const attrs: Record<string, unknown> = {};
        for (const m of r.marks ?? []) attrs[m.type] = m.attrs ?? {};
        it.insert(pos, r.text ?? '', attrs);
        pos += (r.text ?? '').length;
      }
    } else fillXml(it, (it as unknown as { _moChildren: TextNode[] })._moChildren);
  }
}

/** Writes rich text into an (integrated, empty) XmlFragment. */
export function writeText(frag: Y.XmlFragment, doc: TextNode | null | undefined) {
  if (frag.length) frag.delete(0, frag.length);
  fillXml(frag, doc?.content?.length ? doc.content : [{ type: 'paragraph' }]);
}

/** Reads an XmlFragment back to ProseMirror JSON (no schema needed). */
export function readText(frag: Y.XmlFragment): TextNode {
  const conv = (n: Y.XmlElement | Y.XmlText): TextNode[] => {
    if (n instanceof Y.XmlText) {
      return (n.toDelta() as { insert: unknown; attributes?: Record<string, Record<string, unknown>> }[])
        .filter((d) => typeof d.insert === 'string')
        .map((d) => {
          const marks = Object.entries(d.attributes ?? {}).map(([k, attrs]) => ({ type: k.split('--')[0], ...(attrs && Object.keys(attrs).length ? { attrs } : {}) }));
          return { type: 'text', text: d.insert as string, ...(marks.length ? { marks } : {}) };
        });
    }
    const attrs = n.getAttributes() as Record<string, unknown>;
    const content = n.toArray().flatMap((c) => conv(c as Y.XmlElement | Y.XmlText));
    return [{ type: n.nodeName, ...(Object.keys(attrs).length ? { attrs } : {}), ...(content.length ? { content } : {}) }];
  };
  return { type: 'doc', content: frag.toArray().flatMap((c) => conv(c as Y.XmlElement | Y.XmlText)) };
}

// ── Yjs ⇄ plain ──────────────────────────────────────────────────────────────

const SCALAR_KEYS = ['type', 'x', 'y', 'w', 'h', 'rot', 'z', 'flipH', 'flipV', 'geom', 'ph', 'name', 'style', 'src', 'alt', 'chart', 'group', 'anim', 'crop', 'media'] as const;
export const TEXT_TYPES: ElementType[] = ['text', 'shape'];

/** Builds the Y.Map of one element. Call inside a transaction; the result must be integrated before text is written. */
export function createYElement(el: PlainElement): { map: Y.Map<unknown>; fill: () => void } {
  const m = new Y.Map<unknown>();
  for (const k of SCALAR_KEYS) if (el[k] !== undefined && el[k] !== null) m.set(k, el[k]);
  let frag: Y.XmlFragment | null = null;
  let cells: Y.Map<string> | null = null;
  if (TEXT_TYPES.includes(el.type)) {
    frag = new Y.XmlFragment();
    m.set('text', frag);
  }
  if (el.type === 'table' && el.table) {
    const rows = el.table.rows.map(() => newId());
    const cols = (el.table.rows[0] ?? []).map(() => newId());
    const spec: TableSpec = { rows, cols, colW: el.table.colW, header: el.table.header ?? true, banded: el.table.banded ?? true, fontSize: el.table.fontSize, headerFill: el.table.headerFill, border: el.table.border };
    m.set('table', JSON.parse(JSON.stringify(spec)));
    cells = new Y.Map<string>();
    m.set('cells', cells);
    const values = el.table.rows;
    return {
      map: m,
      fill: () => values.forEach((row, r) => row.forEach((v, c) => v && cells!.set(`${rows[r]}:${cols[c]}`, v))),
    };
  }
  return { map: m, fill: () => frag && writeText(frag, el.text) };
}

export function createYSlide(s: PlainSlide): { map: Y.Map<unknown>; fill: () => void } {
  const m = new Y.Map<unknown>();
  const notes = new Y.Text();
  const elements = new Y.Map<Y.Map<unknown>>();
  m.set('meta', s.meta);
  m.set('notes', notes);
  m.set('elements', elements);
  return {
    map: m,
    fill: () => {
      if (s.notes) notes.insert(0, s.notes);
      for (const el of s.elements) {
        const y = createYElement(el);
        elements.set(el.id, y.map);
        y.fill();
      }
    },
  };
}

export function writeDeck(doc: Y.Doc, deck: PlainDeck) {
  doc.transact(() => {
    const meta = doc.getMap(DECK_MAP);
    meta.set('name', deck.name);
    meta.set('size', deck.size);
    meta.set('theme', deck.theme);
    if (deck.numbers) meta.set('numbers', deck.numbers);
    const slides = doc.getMap<Y.Map<unknown>>(SLIDES_MAP);
    for (const s of deck.slides) {
      const y = createYSlide(s);
      slides.set(s.id, y.map);
      y.fill();
    }
    const order = doc.getArray<string>(ORDER_ARRAY);
    order.push(deck.slides.map((s) => s.id));
  });
}

export function hasDeck(doc: Y.Doc) {
  return doc.getMap(DECK_MAP).has('size');
}

/** Visible slide order: dedupes ids and drops ids whose slide was deleted. */
export function slideIds(doc: Y.Doc): string[] {
  const slides = doc.getMap(SLIDES_MAP);
  const seen = new Set<string>();
  return doc
    .getArray<string>(ORDER_ARRAY)
    .toArray()
    .filter((id) => slides.has(id) && !seen.has(id) && seen.add(id));
}

export function readElement(id: string, m: Y.Map<unknown>): PlainElement {
  const el = { id } as PlainElement;
  for (const k of SCALAR_KEYS) {
    const v = m.get(k);
    if (v !== undefined) (el as unknown as Record<string, unknown>)[k] = v;
  }
  el.x ??= 0;
  el.y ??= 0;
  el.w ??= 100;
  el.h ??= 100;
  el.z ??= 0;
  const frag = m.get('text');
  if (frag instanceof Y.XmlFragment) el.text = readText(frag);
  const spec = m.get('table') as TableSpec | undefined;
  const cells = m.get('cells');
  if (el.type === 'table' && spec && cells instanceof Y.Map) {
    el.table = {
      rows: spec.rows.map((r) => spec.cols.map((c) => (cells.get(`${r}:${c}`) as string) ?? '')),
      colW: spec.colW,
      header: spec.header,
      banded: spec.banded,
      fontSize: spec.fontSize,
      headerFill: spec.headerFill,
      border: spec.border,
    };
  }
  return el;
}

export const byZ = (a: PlainElement, b: PlainElement) => a.z - b.z || (a.id < b.id ? -1 : 1);

export function readSlide(id: string, m: Y.Map<unknown>): PlainSlide {
  const elements: PlainElement[] = [];
  (m.get('elements') as Y.Map<Y.Map<unknown>> | undefined)?.forEach((em, eid) => elements.push(readElement(eid, em)));
  elements.sort(byZ);
  return { id, meta: (m.get('meta') as SlideMeta) ?? { layout: 'blank' }, notes: (m.get('notes') as Y.Text | undefined)?.toString() ?? '', elements };
}

export function readDeck(doc: Y.Doc): PlainDeck {
  const meta = doc.getMap(DECK_MAP);
  const slides = doc.getMap<Y.Map<unknown>>(SLIDES_MAP);
  return {
    name: (meta.get('name') as string) ?? 'Presentation',
    size: (meta.get('size') as DeckSize) ?? DEFAULT_SIZE,
    theme: (meta.get('theme') as Theme) ?? DEFAULT_THEME,
    slides: slideIds(doc).map((id, i) => ({ ...readSlide(id, slides.get(id)!), no: i + 1 })),
    numbers: (meta.get('numbers') as SlideNumbers | undefined) ?? undefined,
  };
}

/** Fresh ids for a slide and its elements (duplicate slide, paste, copy of a deck). */
export function cloneSlide(s: PlainSlide): PlainSlide {
  return { ...structuredClone(s), id: newId(), elements: regroup(s.elements.map((e) => ({ ...structuredClone(e), id: newId() }))) };
}

/** Fresh group ids for copied elements, so a pasted copy never joins the original's group. */
export function regroup(els: PlainElement[]): PlainElement[] {
  const map = new Map<string, string>();
  return els.map((e) => {
    if (!e.group) return e;
    if (!map.has(e.group)) map.set(e.group, newId());
    return { ...e, group: map.get(e.group) };
  });
}

// ── Layouts ──────────────────────────────────────────────────────────────────

const ph = (p: Placeholder, x: number, y: number, w: number, h: number, style: ElementStyle, z: number, text: TextNode | null = null): PlainElement => ({
  id: newId(),
  type: 'text',
  ph: p,
  x: Math.round(x),
  y: Math.round(y),
  w: Math.round(w),
  h: Math.round(h),
  z,
  style,
  text,
});

/** Placeholder boxes of a layout, sized for the deck. */
export function layoutElements(layout: LayoutId, size: DeckSize, theme: Theme): PlainElement[] {
  const { w, h } = size;
  const mx = w * 0.07;
  void theme; // placeholders take colours and fonts from the theme at render time
  const title: ElementStyle = { fontSize: 36, bold: true, vAlign: 'bottom' };
  const body: ElementStyle = { fontSize: 20, vAlign: 'top', lineHeight: 1.3 };
  const bullets = textDoc([''], { bullets: true });
  switch (layout) {
    case 'title':
      return [
        ph('title', mx, h * 0.28, w - 2 * mx, h * 0.24, { ...title, fontSize: 48, align: 'center' }, 1),
        ph('subtitle', mx, h * 0.55, w - 2 * mx, h * 0.14, { ...body, fontSize: 24, align: 'center' }, 2),
      ];
    case 'titleContent':
      return [ph('title', mx, h * 0.06, w - 2 * mx, h * 0.15, title, 1), ph('body', mx, h * 0.25, w - 2 * mx, h * 0.66, body, 2, bullets)];
    case 'section':
      return [
        ph('title', mx, h * 0.34, w - 2 * mx, h * 0.2, { ...title, fontSize: 44 }, 1),
        ph('subtitle', mx, h * 0.56, w - 2 * mx, h * 0.12, { ...body, fontSize: 22 }, 2),
      ];
    case 'twoContent': {
      const gap = w * 0.04;
      const cw = (w - 2 * mx - gap) / 2;
      return [
        ph('title', mx, h * 0.06, w - 2 * mx, h * 0.15, title, 1),
        ph('body', mx, h * 0.25, cw, h * 0.66, body, 2, bullets),
        ph('body2', mx + cw + gap, h * 0.25, cw, h * 0.66, body, 3, bullets),
      ];
    }
    case 'titleOnly':
      return [ph('title', mx, h * 0.06, w - 2 * mx, h * 0.15, title, 1)];
    default:
      return [];
  }
}

export function newSlide(layout: LayoutId, size: DeckSize, theme: Theme): PlainSlide {
  return { id: newId(), meta: { layout }, notes: '', elements: layoutElements(layout, size, theme) };
}

export function blankDeck(name: string, theme = DEFAULT_THEME, size = DEFAULT_SIZE): PlainDeck {
  const first = newSlide('title', size, theme);
  first.elements[0].text = textDoc(name.replace(/\.(pptx?|odp|key)$/i, ''), { align: 'center' });
  return { name, size, theme, slides: [first] };
}

// ── Search text ──────────────────────────────────────────────────────────────

export function deckText(deck: PlainDeck, limit = 200_000): string {
  const parts: string[] = [];
  let size = 0;
  for (const s of deck.slides) {
    for (const el of s.elements) {
      const t = el.text ? textOf(el.text) : el.table ? el.table.rows.flat().join(' ') : el.chart ? [el.chart.title, ...el.chart.categories, ...el.chart.series.map((x) => x.name)].join(' ') : '';
      if (!t.trim()) continue;
      parts.push(t);
      size += t.length;
    }
    if (s.notes) parts.push(s.notes);
    if (size > limit) break;
  }
  return parts.join('\n').slice(0, limit);
}

/** The slide's title: its title placeholder, else its first text. */
export function slideTitle(s: PlainSlide): string {
  const t = s.elements.find((e) => e.ph === 'title' && !isEmptyText(e.text)) ?? s.elements.find((e) => e.text && !isEmptyText(e.text));
  return t ? textOf(t.text).split('\n')[0] : '';
}

export * from './render';
