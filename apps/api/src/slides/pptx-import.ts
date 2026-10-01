import { DOMParser } from '@xmldom/xmldom';
import {
  DEFAULT_THEME,
  newId,
  THEMES,
  type Background,
  type ChartSpec,
  type ElementStyle,
  type Geometry,
  type LayoutId,
  type PlainDeck,
  type PlainElement,
  type PlainSlide,
  type Placeholder,
  type TextNode,
  type Theme,
} from '@workos/slide-model';
import JSZip from 'jszip';

/** Stores an embedded picture and returns the URL the deck should reference. */
export type ImageStore = (data: Buffer, mime: string) => Promise<string>;

export interface PptxImportReport {
  preserved: string[];
  degraded: string[];
  dropped: string[];
  warnings: string[];
}

const EMU = 9525; // EMU per px (96 dpi)
const px = (v: string | null | undefined) => Math.round((Number(v ?? 0) / EMU) * 100) / 100;

type El = Element;

const kids = (e: El | null | undefined, name?: string): El[] => {
  const out: El[] = [];
  if (!e) return out;
  for (let n = e.firstChild; n; n = n.nextSibling) if (n.nodeType === 1 && (!name || (n as El).localName === name)) out.push(n as El);
  return out;
};
const kid = (e: El | null | undefined, name: string) => kids(e, name)[0] ?? null;
const path = (e: El | null | undefined, ...names: string[]) => names.reduce<El | null>((cur, n) => kid(cur, n), e ?? null);
function desc(e: El | null | undefined, name: string): El[] {
  const out: El[] = [];
  const walk = (x: El) => {
    for (const k of kids(x)) {
      if (k.localName === name) out.push(k);
      walk(k);
    }
  };
  if (e) walk(e);
  return out;
}
const attr = (e: El | null | undefined, name: string) => (e && e.hasAttribute(name) ? e.getAttribute(name) : null);

const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', svg: 'image/svg+xml', webp: 'image/webp', tif: 'image/tiff', tiff: 'image/tiff' };

const GEOMS: Record<string, Geometry> = {
  rect: 'rect',
  roundRect: 'roundRect',
  snipRoundRect: 'roundRect',
  round2SameRect: 'roundRect',
  ellipse: 'ellipse',
  triangle: 'triangle',
  rtTriangle: 'rtTriangle',
  diamond: 'diamond',
  pentagon: 'pentagon',
  homePlate: 'pentagon',
  hexagon: 'hexagon',
  parallelogram: 'parallelogram',
  trapezoid: 'trapezoid',
  rightArrow: 'rightArrow',
  leftArrow: 'leftArrow',
  chevron: 'chevron',
  star5: 'star5',
  line: 'line',
  straightConnector1: 'line',
};

// ── Colours ──────────────────────────────────────────────────────────────────

function hsl(hex: string) {
  const n = parseInt(hex, 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h /= 6;
  }
  return { h, s, l };
}
function toHex({ h, s, l }: { h: number; s: number; l: number }) {
  const f = (n: number) => {
    const k = (n + h * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))))
      .toString(16)
      .padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`.toUpperCase();
}

interface Ctx {
  zip: JSZip;
  scheme: Record<string, string>;
  report: PptxImportReport;
  storeImage: ImageStore;
  images: number;
  charts: number;
  tables: number;
  shapes: number;
  texts: number;
  note: (list: 'degraded' | 'dropped', msg: string) => void;
}

/** Colour of a fill-like element (a:solidFill, a:fgClr, …): srgbClr / schemeClr / sysClr / prstClr with lumMod/lumOff/shade/tint. */
function colorOf(holder: El | null | undefined, ctx: Ctx): string | null {
  if (!holder) return null;
  const c = kids(holder).find((k) => ['srgbClr', 'schemeClr', 'sysClr', 'prstClr', 'scrgbClr'].includes(k.localName ?? ''));
  if (!c) return null;
  let hex: string | null = null;
  if (c.localName === 'srgbClr') hex = attr(c, 'val');
  else if (c.localName === 'sysClr') hex = attr(c, 'lastClr') ?? (attr(c, 'val') === 'window' ? 'FFFFFF' : '000000');
  else if (c.localName === 'schemeClr') {
    const v = attr(c, 'val') ?? '';
    const map: Record<string, string> = { tx1: 'dk1', bg1: 'lt1', tx2: 'dk2', bg2: 'lt2', phClr: 'accent1' };
    hex = ctx.scheme[map[v] ?? v]?.replace('#', '') ?? null;
  } else if (c.localName === 'prstClr') {
    const named: Record<string, string> = { black: '000000', white: 'FFFFFF', red: 'FF0000', green: '008000', blue: '0000FF', yellow: 'FFFF00', gray: '808080' };
    hex = named[attr(c, 'val') ?? ''] ?? '000000';
  }
  if (!hex || !/^[0-9a-f]{6}$/i.test(hex)) return null;
  let col = hsl(hex);
  for (const m of kids(c)) {
    const v = Number(attr(m, 'val') ?? 0) / 100000;
    if (m.localName === 'lumMod') col = { ...col, l: col.l * v };
    else if (m.localName === 'lumOff') col = { ...col, l: Math.min(1, col.l + v) };
    else if (m.localName === 'shade') col = { ...col, l: col.l * v };
    else if (m.localName === 'tint') col = { ...col, l: col.l + (1 - col.l) * (1 - v) };
  }
  return kids(c).length ? toHex(col) : `#${hex.toUpperCase()}`;
}

// ── Parts & relationships ────────────────────────────────────────────────────

const xml = async (zip: JSZip, p: string): Promise<Document | null> => {
  const f = zip.file(p);
  if (!f) return null;
  return new DOMParser({ onError: () => undefined } as never).parseFromString(await f.async('string'), 'application/xml');
};

function resolvePath(base: string, target: string) {
  if (target.startsWith('/')) return target.slice(1);
  const parts = base.split('/').slice(0, -1);
  for (const seg of target.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg !== '.') parts.push(seg);
  }
  return parts.join('/');
}

type Rels = Map<string, { target: string; type: string; external: boolean }>;

async function rels(zip: JSZip, part: string): Promise<Rels> {
  const dir = part.split('/').slice(0, -1).join('/');
  const name = part.split('/').pop();
  const doc = await xml(zip, `${dir}/_rels/${name}.rels`);
  const out = new Map<string, { target: string; type: string; external: boolean }>();
  if (!doc) return out;
  for (const r of kids(doc.documentElement, 'Relationship')) {
    const external = attr(r, 'TargetMode') === 'External';
    const target = attr(r, 'Target') ?? '';
    out.set(attr(r, 'Id') ?? '', { target: external ? target : resolvePath(part, target), type: (attr(r, 'Type') ?? '').split('/').pop() ?? '', external });
  }
  return out;
}

// ── Placeholders inherited from layout / master ──────────────────────────────

interface PhInfo {
  type: string;
  idx: string | null;
  xfrm: ReturnType<typeof xfrmOf>;
  anchor: string | null;
  size: number | null;
  color: string | null;
  bold: boolean | null;
}

function xfrmOf(spPr: El | null): { x: number; y: number; w: number; h: number; rot: number; flipH: boolean; flipV: boolean } | null {
  const x = kid(spPr, 'xfrm');
  const off = kid(x, 'off');
  const ext = kid(x, 'ext');
  if (!off || !ext) return null;
  return { x: px(attr(off, 'x')), y: px(attr(off, 'y')), w: px(attr(ext, 'cx')), h: px(attr(ext, 'cy')), rot: Number(attr(x, 'rot') ?? 0) / 60000, flipH: attr(x, 'flipH') === '1', flipV: attr(x, 'flipV') === '1' };
}

function phOf(sp: El): { type: string; idx: string | null } | null {
  const nv = kids(sp).find((k) => k.localName?.startsWith('nv'));
  const ph = path(nv, 'nvPr', 'ph');
  if (!ph) return null;
  return { type: attr(ph, 'type') ?? 'body', idx: attr(ph, 'idx') };
}

function placeholders(doc: Document | null, ctx: Ctx): PhInfo[] {
  if (!doc) return [];
  return desc(doc.documentElement, 'sp')
    .map((sp) => {
      const ph = phOf(sp);
      if (!ph) return null;
      const lvl1 = path(kid(sp, 'txBody'), 'lstStyle', 'lvl1pPr');
      const defRPr = kid(lvl1, 'defRPr');
      const sz = attr(defRPr, 'sz');
      return {
        ...ph,
        xfrm: xfrmOf(kid(sp, 'spPr')),
        anchor: attr(path(sp, 'txBody', 'bodyPr'), 'anchor'),
        size: sz ? Number(sz) / 100 : null,
        color: colorOf(kid(defRPr, 'solidFill'), ctx),
        bold: defRPr && defRPr.hasAttribute('b') ? attr(defRPr, 'b') === '1' : null,
      };
    })
    .filter((x): x is PhInfo => !!x);
}

function findPh(list: PhInfo[], ph: { type: string; idx: string | null }) {
  const norm = (t: string) => (t === 'ctrTitle' ? 'title' : t === 'subTitle' ? 'body' : t === 'obj' ? 'body' : t);
  return list.find((p) => ph.idx !== null && p.idx === ph.idx && norm(p.type) === norm(ph.type)) ?? list.find((p) => p.type === ph.type) ?? list.find((p) => norm(p.type) === norm(ph.type)) ?? (ph.idx !== null ? list.find((p) => p.idx === ph.idx) : undefined);
}

// ── Text ─────────────────────────────────────────────────────────────────────

interface TextDefaults {
  bullets: boolean; // body placeholders show bullets unless buNone
}

function runMarks(rPr: El | null, ctx: Ctx, defaults: { size?: number | null }): TextNode['marks'] {
  const marks: NonNullable<TextNode['marks']> = [];
  if (!rPr) return marks;
  if (attr(rPr, 'b') === '1') marks.push({ type: 'bold' });
  if (attr(rPr, 'i') === '1') marks.push({ type: 'italic' });
  const u = attr(rPr, 'u');
  if (u && u !== 'none') marks.push({ type: 'underline' });
  const st = attr(rPr, 'strike');
  if (st && st !== 'noStrike') marks.push({ type: 'strike' });
  const ts: Record<string, string> = {};
  const color = colorOf(kid(rPr, 'solidFill'), ctx);
  if (color) ts.color = color;
  const sz = attr(rPr, 'sz');
  if (sz && Number(sz) / 100 !== defaults.size) ts.fontSize = `${Number(sz) / 100}pt`;
  const latin = attr(kid(rPr, 'latin'), 'typeface');
  if (latin && !latin.startsWith('+')) ts.fontFamily = latin;
  if (Object.keys(ts).length) marks.push({ type: 'textStyle', attrs: ts });
  const hl = colorOf(kid(rPr, 'highlight'), ctx);
  if (hl) marks.push({ type: 'highlight', attrs: { color: hl } });
  const link = kid(rPr, 'hlinkClick');
  if (link) marks.push({ type: 'link', attrs: { href: '#' } }); // resolved by caller (needs rels)
  return marks;
}

function textBody(body: El | null, ctx: Ctx, d: TextDefaults & { size?: number | null; links: Map<string, { target: string; external: boolean }> }) {
  const blocks: TextNode[] = [];
  // Stack of open lists by level so consecutive bullet paragraphs nest correctly.
  let stack: { node: TextNode; level: number; kind: string }[] = [];
  let firstSize: number | null = null;
  let firstColor: string | null = null;
  let anyBold = true;
  let runCount = 0;
  for (const p of kids(body, 'p')) {
    const pPr = kid(p, 'pPr');
    const algn = attr(pPr, 'algn');
    const align = algn === 'ctr' ? 'center' : algn === 'r' ? 'right' : algn === 'just' ? 'justify' : null;
    const content: TextNode[] = [];
    for (const r of kids(p)) {
      if (r.localName === 'r' || r.localName === 'fld') {
        const t = kid(r, 't')?.textContent ?? '';
        if (!t) continue;
        const rPr = kid(r, 'rPr');
        const marks = runMarks(rPr, ctx, { size: d.size }) ?? [];
        const link = kid(rPr, 'hlinkClick');
        const rel = link ? d.links.get(attr(link, 'r:id') ?? '') : null;
        const fixed = marks.map((m) => (m.type === 'link' ? (rel?.external ? { type: 'link', attrs: { href: rel.target } } : null) : m)).filter(Boolean) as NonNullable<TextNode['marks']>;
        const sz = attr(rPr, 'sz');
        if (firstSize === null && sz) firstSize = Number(sz) / 100;
        if (firstColor === null) firstColor = colorOf(kid(rPr, 'solidFill'), ctx);
        if (attr(rPr, 'b') !== '1') anyBold = false;
        runCount++;
        content.push({ type: 'text', text: t, ...(fixed.length ? { marks: fixed } : {}) });
      } else if (r.localName === 'br') content.push({ type: 'hardBreak' });
    }
    const para: TextNode = { type: 'paragraph', ...(align ? { attrs: { textAlign: align } } : {}), ...(content.length ? { content } : {}) };
    const lvl = Number(attr(pPr, 'lvl') ?? 0);
    const buNone = !!kid(pPr, 'buNone');
    const buChar = !!kid(pPr, 'buChar');
    const buNum = !!kid(pPr, 'buAutoNum');
    const listKind = buNum ? 'orderedList' : buChar || (d.bullets && !buNone && content.length) ? 'bulletList' : null;
    if (!listKind) {
      stack = [];
      blocks.push(para);
      continue;
    }
    while (stack.length && stack[stack.length - 1].level > lvl) stack.pop();
    if (stack.length && stack[stack.length - 1].level === lvl && stack[stack.length - 1].kind !== listKind) stack.pop();
    let top = stack[stack.length - 1];
    if (!top || top.level < lvl) {
      const list: TextNode = { type: listKind, content: [] };
      if (top) top.node.content![top.node.content!.length - 1].content!.push(list); // nested under the previous item
      else blocks.push(list);
      stack.push({ node: list, level: lvl, kind: listKind });
      top = stack[stack.length - 1];
    }
    top.node.content!.push({ type: 'listItem', content: [para] });
  }
  if (!blocks.length) blocks.push({ type: 'paragraph' });
  return { doc: { type: 'doc', content: blocks } as TextNode, firstSize, firstColor, allBold: runCount > 0 && anyBold };
}

/**
 * PowerPoint writers repeat the formatting on every run. Formatting shared by all runs becomes the box's default
 * (so changing the box's font size later still works), and run attributes equal to the default are dropped.
 */
function hoistRunDefaults(doc: TextNode, style: ElementStyle) {
  const runs: TextNode[] = [];
  const walk = (n: TextNode) => (n.type === 'text' ? runs.push(n) : n.content?.forEach(walk));
  walk(doc);
  if (!runs.length) return;
  const ts = (r: TextNode) => r.marks?.find((m) => m.type === 'textStyle')?.attrs ?? {};
  const uniform = (k: string) => {
    const v = ts(runs[0])[k];
    return v !== undefined && runs.every((r) => ts(r)[k] === v) ? v : undefined;
  };
  const size = uniform('fontSize');
  if (typeof size === 'string') style.fontSize = parseFloat(size);
  const color = uniform('color');
  if (typeof color === 'string') style.color = color;
  const font = uniform('fontFamily');
  if (typeof font === 'string') style.fontFamily = font;
  if (runs.every((r) => r.marks?.some((m) => m.type === 'bold'))) style.bold = true;
  for (const r of runs) {
    r.marks = (r.marks ?? [])
      .filter((m) => !(m.type === 'bold' && style.bold))
      .map((m) => {
        if (m.type !== 'textStyle') return m;
        const a = { ...m.attrs };
        if (style.fontSize !== undefined && a.fontSize === `${style.fontSize}pt`) delete a.fontSize;
        if (a.color === style.color) delete a.color;
        if (a.fontFamily === style.fontFamily) delete a.fontFamily;
        return Object.keys(a).length ? { ...m, attrs: a } : null;
      })
      .filter((m): m is NonNullable<typeof m> => !!m);
    if (!r.marks.length) delete r.marks;
  }
}

// ── Charts ───────────────────────────────────────────────────────────────────

function cacheValues(e: El | null): string[] {
  const cache = desc(e, 'strCache')[0] ?? desc(e, 'numCache')[0] ?? desc(e, 'multiLvlStrCache')[0] ?? null;
  const pts = cache?.localName === 'multiLvlStrCache' ? kids(kid(cache, 'lvl'), 'pt') : kids(cache, 'pt');
  const count = Number(attr(kid(cache, 'ptCount'), 'val') ?? pts.length);
  const out = Array.from({ length: count }, () => '');
  for (const pt of pts) out[Number(attr(pt, 'idx') ?? 0)] = kid(pt, 'v')?.textContent ?? '';
  return out;
}

async function parseChart(ctx: Ctx, part: string): Promise<ChartSpec | null> {
  const doc = await xml(ctx.zip, part);
  if (!doc) return null;
  const plot = desc(doc.documentElement, 'plotArea')[0];
  const ct = kids(plot).find((k) => /^(bar|bar3D|line|line3D|area|area3D|pie|pie3D|doughnut)Chart$/.test(k.localName ?? ''));
  if (!ct) return null;
  const name = ct.localName!.replace(/3D/, '');
  if (name !== ct.localName) ctx.note('degraded', '3-D charts → flat charts');
  const dir = attr(kid(ct, 'barDir'), 'val');
  const kind: ChartSpec['kind'] = name === 'barChart' ? (dir === 'bar' ? 'bar' : 'column') : name === 'lineChart' ? 'line' : name === 'areaChart' ? 'area' : name === 'pieChart' ? 'pie' : 'doughnut';
  const sers = kids(ct, 'ser');
  let categories: string[] = [];
  const series = sers.map((s, i) => {
    const cats = cacheValues(kid(s, 'cat'));
    if (cats.length > categories.length) categories = cats;
    const color = colorOf(path(s, 'spPr', 'solidFill'), ctx) ?? undefined;
    return { name: cacheValues(kid(s, 'tx'))[0] || kid(kid(s, 'tx'), 'v')?.textContent || `Series ${i + 1}`, values: cacheValues(kid(s, 'val')).map((v) => Number(v) || 0), ...(color && kind !== 'pie' && kind !== 'doughnut' ? { color } : {}) };
  });
  if (!categories.length) categories = (series[0]?.values ?? []).map((_, i) => String(i + 1));
  const title = desc(kid(desc(doc.documentElement, 'chart')[0], 'title'), 't')
    .map((t) => t.textContent ?? '')
    .join('');
  const legend = !!desc(doc.documentElement, 'legend')[0];
  const labels = [...desc(ct, 'showVal'), ...desc(ct, 'showPercent')].some((e) => attr(e, 'val') === '1');
  return { kind, categories, series, legend, labels, ...(title ? { title } : {}) };
}

// ── Shapes tree ──────────────────────────────────────────────────────────────

interface Transform {
  (b: { x: number; y: number; w: number; h: number }): { x: number; y: number; w: number; h: number };
}
const identity: Transform = (b) => b;

async function walkTree(tree: El, ctx: Ctx, out: PlainElement[], tf: Transform, slidePart: string, slideRels: Rels, phs: PhInfo[]) {
  for (const node of kids(tree)) {
    const ln = node.localName;
    if (ln === 'AlternateContent') {
      const choice = kid(node, 'Choice') ?? kid(node, 'Fallback');
      if (choice) await walkTree(choice, ctx, out, tf, slidePart, slideRels, phs);
      continue;
    }
    if (ln === 'grpSp') {
      const x = path(node, 'grpSpPr', 'xfrm');
      const off = kid(x, 'off');
      const ext = kid(x, 'ext');
      const chOff = kid(x, 'chOff');
      const chExt = kid(x, 'chExt');
      let inner = tf;
      if (off && ext && chOff && chExt) {
        const sx = Number(attr(ext, 'cx')) / (Number(attr(chExt, 'cx')) || 1);
        const sy = Number(attr(ext, 'cy')) / (Number(attr(chExt, 'cy')) || 1);
        const ox = px(attr(off, 'x'));
        const oy = px(attr(off, 'y'));
        const cx = px(attr(chOff, 'x'));
        const cy = px(attr(chOff, 'y'));
        inner = (b) => tf({ x: ox + (b.x - cx) * sx, y: oy + (b.y - cy) * sy, w: b.w * sx, h: b.h * sy });
        if (Number(attr(x, 'rot') ?? 0)) ctx.note('degraded', 'rotated groups are placed without their rotation');
      }
      await walkTree(node, ctx, out, inner, slidePart, slideRels, phs);
      continue;
    }
    const z = out.length + 1;
    if (ln === 'sp' || ln === 'cxnSp') {
      const spPr = kid(node, 'spPr');
      const ph = phOf(node);
      const inherited = ph ? findPh(phs, ph) : undefined;
      const xf = xfrmOf(spPr) ?? (inherited?.xfrm ? { ...inherited.xfrm, rot: 0, flipH: false, flipV: false } : null);
      if (!xf) continue;
      if (ph && ['dt', 'ftr', 'sldNum'].includes(ph.type)) continue; // date / footer / slide number placeholders
      const box = tf(xf);
      const prst = attr(kid(spPr, 'prstGeom'), 'prst');
      if (kid(spPr, 'custGeom')) ctx.note('degraded', 'custom (freeform) shapes → rectangles');
      if (kid(spPr, 'gradFill')) ctx.note('degraded', 'gradient fills → first gradient colour');
      if (kid(spPr, 'effectLst') && kids(kid(spPr, 'effectLst')).length) ctx.note('degraded', 'shape effects (glow, reflection, 3-D) are not kept; shadows become a soft shadow');
      const fill = kid(spPr, 'noFill') ? null : colorOf(kid(spPr, 'solidFill'), ctx) ?? colorOf(desc(kid(spPr, 'gradFill'), 'gs')[0], ctx) ?? (ln === 'sp' && !ph && path(node, 'style', 'fillRef') ? colorOf(path(node, 'style', 'fillRef'), ctx) : null);
      const lnEl = kid(spPr, 'ln');
      const stroke = lnEl && kid(lnEl, 'noFill') ? null : colorOf(kid(lnEl, 'solidFill'), ctx) ?? (path(node, 'style', 'lnRef') && Number(attr(path(node, 'style', 'lnRef'), 'idx')) > 0 ? colorOf(path(node, 'style', 'lnRef'), ctx) : null);
      const sw = lnEl && attr(lnEl, 'w') ? Math.max(0.5, Math.round((Number(attr(lnEl, 'w')) / 12700) * (4 / 3) * 10) / 10) : stroke ? 1 : 0;
      const dash = attr(kid(lnEl, 'prstDash'), 'val');
      const arrowTail = attr(kid(lnEl, 'tailEnd'), 'type');
      let geom: Geometry = (prst && GEOMS[prst]) || 'rect';
      if (prst && !GEOMS[prst]) ctx.note('degraded', `uncommon shapes (${prst}, …) → rectangles`);
      if (ln === 'cxnSp' || geom === 'line') geom = arrowTail && arrowTail !== 'none' ? 'arrow' : 'line';
      const body = kid(node, 'txBody');
      const phRole: Placeholder | null = ph ? (ph.type === 'title' || ph.type === 'ctrTitle' ? 'title' : ph.type === 'subTitle' ? 'subtitle' : 'body') : null;
      const links = new Map([...slideRels].map(([k, v]) => [k, { target: v.target, external: v.external }]));
      const text = body ? textBody(body, ctx, { bullets: phRole === 'body', size: inherited?.size ?? null, links }) : null;
      const bodyPr = kid(body, 'bodyPr');
      const anchor = attr(bodyPr, 'anchor') ?? inherited?.anchor ?? (phRole === 'title' ? 'ctr' : 't');
      const style: ElementStyle = {
        ...(fill ? { fill } : {}),
        ...(stroke && sw ? { stroke, strokeWidth: sw } : {}),
        ...(dash && dash !== 'solid' ? { dash: /dot/i.test(dash) ? 'dot' : 'dash' } : {}),
        ...(geom === 'roundRect' ? { radius: Math.round(Math.min(box.w, box.h) * (Number(attr(desc(kid(spPr, 'prstGeom'), 'gd')[0], 'fmla')?.replace('val ', '') ?? 16667) / 100000)) } : {}),
        ...(desc(kid(spPr, 'effectLst'), 'outerShdw').length ? { shadow: true } : {}),
        fontSize: inherited?.size ?? text?.firstSize ?? (phRole === 'title' ? 40 : 18),
        ...(inherited?.color ? { color: inherited.color } : phRole === 'title' ? { color: ctx.scheme.dk1 } : {}),
        ...(inherited?.bold ? { bold: true } : {}),
        vAlign: anchor === 'ctr' ? 'middle' : anchor === 'b' ? 'bottom' : 'top',
        pad: bodyPr && attr(bodyPr, 'lIns') ? Math.round(px(attr(bodyPr, 'lIns'))) : 10,
      };
      if (text) hoistRunDefaults(text.doc, style);
      const isText = !fill && !(stroke && sw) && geom === 'rect';
      const hasText = !!text && text.doc.content!.some((b) => JSON.stringify(b).includes('"text":'));
      if (!isText || hasText || ph) {
        out.push({
          id: newId(),
          type: isText ? 'text' : 'shape',
          ...(isText ? {} : { geom }),
          x: box.x,
          y: box.y,
          w: box.w,
          h: box.h,
          z,
          ...(xf.rot ? { rot: Math.round(xf.rot * 100) / 100 } : {}),
          ...(xf.flipH ? { flipH: true } : {}),
          ...(xf.flipV ? { flipV: true } : {}),
          ...(phRole ? { ph: phRole } : {}),
          style,
          ...(geom === 'line' || geom === 'arrow' ? {} : { text: text?.doc ?? { type: 'doc', content: [{ type: 'paragraph' }] } }),
        });
        if (isText) ctx.texts++;
        else ctx.shapes++;
      }
      continue;
    }
    if (ln === 'pic') {
      const xf = xfrmOf(kid(node, 'spPr'));
      const embed = attr(path(node, 'blipFill', 'blip'), 'r:embed');
      const rel = embed ? slideRels.get(embed) : null;
      if (path(node, 'nvPicPr', 'nvPr', 'videoFile') || path(node, 'nvPicPr', 'nvPr', 'audioFile')) ctx.note('dropped', 'video and audio (the poster image is kept)');
      if (!xf || !rel || rel.external) continue;
      const file = ctx.zip.file(rel.target);
      if (!file) continue;
      const ext = rel.target.split('.').pop()?.toLowerCase() ?? '';
      const mime = MIME[ext];
      if (!mime) {
        ctx.note('dropped', `pictures in .${ext} format`);
        continue;
      }
      const src = await ctx.storeImage(Buffer.from(await file.async('uint8array')), mime);
      const box = tf(xf);
      if (path(node, 'blipFill', 'srcRect') && kids(path(node, 'blipFill', 'srcRect')).length === 0 && path(node, 'blipFill', 'srcRect')!.attributes.length) ctx.note('degraded', 'picture cropping → full picture stretched to the frame');
      out.push({ id: newId(), type: 'image', x: box.x, y: box.y, w: box.w, h: box.h, z, src, ...(xf.rot ? { rot: xf.rot } : {}), ...(xf.flipH ? { flipH: true } : {}), ...(xf.flipV ? { flipV: true } : {}), alt: attr(path(node, 'nvPicPr', 'cNvPr'), 'descr') ?? undefined });
      ctx.images++;
      continue;
    }
    if (ln === 'graphicFrame') {
      const x = kid(node, 'xfrm');
      const off = kid(x, 'off');
      const ext = kid(x, 'ext');
      if (!off || !ext) continue;
      const box = tf({ x: px(attr(off, 'x')), y: px(attr(off, 'y')), w: px(attr(ext, 'cx')), h: px(attr(ext, 'cy')) });
      const data = path(node, 'graphic', 'graphicData');
      const uri = attr(data, 'uri') ?? '';
      const tbl = kid(data, 'tbl');
      if (tbl) {
        const colW = kids(kid(tbl, 'tblGrid'), 'gridCol').map((g) => px(attr(g, 'w')));
        const rows = kids(tbl, 'tr').map((tr) =>
          kids(tr, 'tc').map((tc) =>
            kids(kid(tc, 'txBody'), 'p')
              .map((p) => desc(p, 't').map((t) => t.textContent ?? '').join(''))
              .join('\n'),
          ),
        );
        const sizes = desc(tbl, 'rPr').map((r) => Number(attr(r, 'sz') ?? 0)).filter(Boolean);
        const firstPr = kid(tbl, 'tblPr');
        out.push({
          id: newId(),
          type: 'table',
          ...box,
          z,
          table: { rows, colW, header: attr(firstPr, 'firstRow') !== '0', banded: attr(firstPr, 'bandRow') !== '0', ...(sizes.length ? { fontSize: Math.min(...sizes) / 100 } : {}) },
        });
        if (desc(tbl, 'tcPr').some((t) => kid(t, 'solidFill'))) ctx.note('degraded', 'table cell colours → the deck’s table style');
        if (desc(tbl, 'tc').some((t) => attr(t, 'gridSpan') || attr(t, 'rowSpan'))) ctx.note('degraded', 'merged table cells are shown unmerged');
        ctx.tables++;
        continue;
      }
      if (uri.endsWith('/chart')) {
        const rid = attr(kid(data, 'chart'), 'r:id');
        const rel = rid ? slideRels.get(rid) : null;
        const chart = rel ? await parseChart(ctx, rel.target) : null;
        if (chart) {
          out.push({ id: newId(), type: 'chart', ...box, z, chart });
          ctx.charts++;
        } else ctx.note('dropped', 'charts of unsupported types (scatter, radar, combo…)');
        continue;
      }
      if (uri.endsWith('/diagram')) ctx.note('dropped', 'SmartArt graphics');
      else if (uri.includes('ole') || uri.endsWith('/oleObject')) ctx.note('dropped', 'embedded OLE objects');
      else ctx.note('dropped', 'other embedded objects');
      continue;
    }
    if (ln === 'contentPart') ctx.note('dropped', 'ink drawings');
  }
}

function bgOf(cSld: El | null, ctx: Ctx, rels: Rels): { bg: Background | null; image?: string } | null {
  const bg = kid(cSld, 'bg');
  if (!bg) return null;
  const pr = kid(bg, 'bgPr');
  if (pr) {
    const solid = colorOf(kid(pr, 'solidFill'), ctx);
    if (solid) return { bg: { type: 'solid', color: solid } };
    const grad = kid(pr, 'gradFill');
    if (grad) {
      const gs = desc(grad, 'gs');
      const angle = Number(attr(kid(grad, 'lin'), 'ang') ?? 5400000) / 60000;
      const from = colorOf(gs[0], ctx);
      const to = colorOf(gs[gs.length - 1], ctx);
      if (from && to) return { bg: { type: 'gradient', from, to, angle: Math.round(angle + 90) } };
    }
    const blip = attr(path(pr, 'blipFill', 'blip'), 'r:embed');
    if (blip && rels.get(blip)) return { bg: null, image: rels.get(blip)!.target };
  }
  const ref = kid(bg, 'bgRef');
  if (ref) {
    const c = colorOf(ref, ctx);
    if (c) return { bg: { type: 'solid', color: c } };
  }
  return null;
}

/** Reads a .pptx into the presentation model (docs/ARCHITECTURE.md §8). Pictures are stored through `storeImage`. */
export async function importPptx(buf: Buffer, fileName: string, storeImage: ImageStore): Promise<{ deck: PlainDeck; report: PptxImportReport }> {
  const zip = await JSZip.loadAsync(buf);
  const pres = await xml(zip, 'ppt/presentation.xml');
  if (!pres) throw new Error('not a PowerPoint presentation (ppt/presentation.xml is missing)');
  const report: PptxImportReport = { preserved: [], degraded: [], dropped: [], warnings: [] };
  const presRels = await rels(zip, 'ppt/presentation.xml');
  const sz = kid(pres.documentElement, 'sldSz');
  const size = { w: Math.round(px(attr(sz, 'cx') ?? String(1280 * EMU))), h: Math.round(px(attr(sz, 'cy') ?? String(720 * EMU))) };

  // Theme (colour scheme + fonts) from the first theme part.
  const themeRel = [...presRels.values()].find((r) => r.type === 'theme');
  const themeDoc = await xml(zip, themeRel?.target ?? 'ppt/theme/theme1.xml');
  const scheme: Record<string, string> = { dk1: '#000000', lt1: '#FFFFFF', dk2: '#44546A', lt2: '#E7E6E6' };
  const ctx: Ctx = {
    zip,
    scheme,
    report,
    storeImage,
    images: 0,
    charts: 0,
    tables: 0,
    shapes: 0,
    texts: 0,
    note: (list, msg) => !report[list].includes(msg) && report[list].push(msg),
  };
  const clr = desc(themeDoc?.documentElement, 'clrScheme')[0];
  for (const c of kids(clr)) {
    const v = colorOf(c, ctx);
    if (v) scheme[c.localName!] = v;
  }
  const major = attr(desc(desc(themeDoc?.documentElement, 'majorFont')[0], 'latin')[0], 'typeface');
  const minor = attr(desc(desc(themeDoc?.documentElement, 'minorFont')[0], 'latin')[0], 'typeface');
  const builtIn = /^Master Office: (.+)$/.exec(attr(themeDoc?.documentElement, 'name') ?? '');
  const known = builtIn ? THEMES.find((t) => t.id === builtIn[1]) : undefined;
  const theme: Theme = known ?? {
    id: 'imported',
    name: attr(themeDoc?.documentElement, 'name') ?? 'Imported theme',
    colors: {
      bg: scheme.lt1,
      text: scheme.dk1,
      title: scheme.dk1,
      muted: scheme.dk2 ?? DEFAULT_THEME.colors.muted,
      accents: [1, 2, 3, 4, 5, 6].map((i) => scheme[`accent${i}`] ?? DEFAULT_THEME.colors.accents[i - 1]),
    },
    fonts: { heading: major || DEFAULT_THEME.fonts.heading, body: minor || DEFAULT_THEME.fonts.body },
  };

  const slideParts = kids(kid(pres.documentElement, 'sldIdLst'), 'sldId')
    .map((s) => presRels.get(attr(s, 'r:id') ?? ''))
    .filter((r): r is NonNullable<typeof r> => !!r && r.type === 'slide')
    .map((r) => r.target);

  const slides: PlainSlide[] = [];
  let notesCount = 0;
  const bgImages = new Map<string, string>();
  for (const part of slideParts) {
    const doc = await xml(zip, part);
    if (!doc) continue;
    const sRels = await rels(zip, part);
    const layoutPart = [...sRels.values()].find((r) => r.type === 'slideLayout')?.target;
    const layoutDoc = layoutPart ? await xml(zip, layoutPart) : null;
    const masterPart = layoutPart ? [...(await rels(zip, layoutPart)).values()].find((r) => r.type === 'slideMaster')?.target : undefined;
    const masterDoc = masterPart ? await xml(zip, masterPart) : null;
    const phs = [...placeholders(layoutDoc, ctx), ...placeholders(masterDoc, ctx)];
    // Master text styles: default title / body sizes when neither slide nor layout sets one.
    const txStyles = kid(masterDoc?.documentElement, 'txStyles');
    const titleSz = attr(path(txStyles, 'titleStyle', 'lvl1pPr', 'defRPr'), 'sz');
    const bodySz = attr(path(txStyles, 'bodyStyle', 'lvl1pPr', 'defRPr'), 'sz');
    for (const p of phs) {
      if (p.size === null) p.size = p.type === 'title' || p.type === 'ctrTitle' ? (titleSz ? Number(titleSz) / 100 : 44) : bodySz && p.type === 'body' ? Number(bodySz) / 100 : p.size;
    }
    const cSld = kid(doc.documentElement, 'cSld');
    const elements: PlainElement[] = [];
    const tree = kid(cSld, 'spTree');
    if (tree) await walkTree(tree, ctx, elements, identity, part, sRels, phs);

    // Background: slide → layout → master.
    let background: Background | null = null;
    for (const [d, r] of [
      [doc, sRels],
      [layoutDoc, layoutPart ? await rels(zip, layoutPart) : new Map()],
      [masterDoc, masterPart ? await rels(zip, masterPart) : new Map()],
    ] as const) {
      const found = d ? bgOf(kid(d.documentElement, 'cSld'), ctx, r as Rels) : null;
      if (!found) continue;
      if (found.image) {
        let src = bgImages.get(found.image);
        const file = zip.file(found.image);
        const mime = MIME[found.image.split('.').pop()?.toLowerCase() ?? ''];
        if (!src && file && mime) {
          src = await storeImage(Buffer.from(await file.async('uint8array')), mime);
          bgImages.set(found.image, src);
        }
        if (src) background = { type: 'image', src };
      } else background = found.bg?.type === 'solid' && found.bg.color.toUpperCase() === theme.colors.bg.toUpperCase() ? null : found.bg;
      break;
    }
    // Pictures and shapes drawn on the layout / master ("background graphics") are not imported.
    if (layoutDoc && desc(kid(layoutDoc.documentElement, 'cSld'), 'pic').length) ctx.note('dropped', 'layout / master background graphics (logos, decorations)');

    // Speaker notes.
    let notes = '';
    const notesPart = [...sRels.values()].find((r) => r.type === 'notesSlide')?.target;
    if (notesPart) {
      const nd = await xml(zip, notesPart);
      const body = desc(nd?.documentElement, 'sp').find((sp) => phOf(sp)?.type === 'body');
      notes = kids(kid(body!, 'txBody'), 'p')
        .map((p) => desc(p, 't').map((t) => t.textContent ?? '').join(''))
        .join('\n')
        .trim();
      if (notes) notesCount++;
    }
    if (desc(doc.documentElement, 'timing').length) ctx.note('dropped', 'animations');
    const transition = kid(doc.documentElement, 'transition');
    const trKind = transition ? kids(transition)[0]?.localName : null;
    const layoutType = attr(kid(layoutDoc?.documentElement, 'cSld'), 'name')?.toLowerCase() ?? '';
    const layout: LayoutId = /title slide|^title$/.test(layoutType) ? 'title' : /section/.test(layoutType) ? 'section' : /two/.test(layoutType) ? 'twoContent' : /title only/.test(layoutType) ? 'titleOnly' : /blank/.test(layoutType) ? 'blank' : 'titleContent';
    slides.push({
      id: newId(),
      meta: {
        layout,
        ...(background ? { background } : {}),
        ...(attr(doc.documentElement, 'show') === '0' ? { hidden: true } : {}),
        ...(trKind ? { transition: trKind === 'push' ? 'push' : trKind === 'wipe' ? 'wipe' : 'fade' } : {}),
      },
      notes,
      elements,
    });
  }
  if (!slides.length) throw new Error('the presentation has no slides');
  if (size.w < size.h) report.warnings.push('portrait slides');
  report.preserved.unshift(
    `slides: ${slides.length}`,
    `slide size: ${size.w} × ${size.h} px`,
    `theme colours and fonts (${theme.name})`,
    `text boxes: ${ctx.texts}`,
    `shapes: ${ctx.shapes}`,
    `pictures: ${ctx.images}`,
    `tables: ${ctx.tables}`,
    `charts: ${ctx.charts} (editable data)`,
    `speaker notes: ${notesCount}`,
    'fonts, sizes, colours, bold / italic / underline, bullets, alignment',
  );
  if (slides.some((s) => s.meta.transition)) report.degraded.push('slide transitions → fade / push / wipe');
  return { deck: { name: fileName.replace(/\.pptx?$/i, ''), size, theme, slides }, report };
}
