import { isLine, slideTitle, textOf, themeColor, youtubeId, resolveConnectors, type ElementStyle, type PlainDeck, type PlainElement, type TextNode, type Theme, isOpenStroke, freeformSegments } from '@workos/slide-model';
import JSZip from 'jszip';
import PptxGenJS from 'pptxgenjs';

/** Image bytes for an element's src (asset URL or data: URL); null when it can't be loaded. */
export type ImageLoader = (src: string) => Promise<{ data: Buffer; mime: string } | null>;

const PX = 96; // slide px → inches
const inch = (px: number) => Math.round((px / PX) * 10000) / 10000;

/** '#RRGGBB' / '#RGB' / 'rgba(…)' → 'RRGGBB' (pptxgenjs colour); alpha is returned separately as transparency %. */
export function hex(c: string | null | undefined): { color: string; transparency?: number } | null {
  if (!c) return null;
  const s = c.trim();
  let m = /^#?([0-9a-f]{6})$/i.exec(s);
  if (m) return { color: m[1].toUpperCase() };
  m = /^#?([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(s);
  if (m) return { color: `${m[1]}${m[1]}${m[2]}${m[2]}${m[3]}${m[3]}`.toUpperCase() };
  const r = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(s);
  if (r) {
    const color = [r[1], r[2], r[3]].map((v) => Math.min(255, Number(v)).toString(16).padStart(2, '0')).join('').toUpperCase();
    const a = r[4] === undefined ? 1 : Number(r[4]);
    return a < 1 ? { color, transparency: Math.round((1 - a) * 100) } : { color };
  }
  return null;
}

const ptOf = (v: unknown, fallback?: number) => {
  if (typeof v === 'number') return v;
  const m = typeof v === 'string' ? /^(\d+(?:\.\d+)?)(pt|px)?$/.exec(v) : null;
  if (!m) return fallback;
  return m[2] === 'px' ? Number(m[1]) * 0.75 : Number(m[1]);
};

type Run = { text: string; options?: PptxGenJS.TextPropsOptions };

/** Rich text → pptxgenjs runs (paragraph props ride on every run of the paragraph; the last run breaks the line). */
export function textRuns(doc: TextNode | null | undefined, base: ElementStyle, theme: Theme): Run[] {
  const runs: Run[] = [];
  const para = (p: TextNode, list: { kind: 'bullet' | 'number'; level: number } | null) => {
    const align = (p.attrs?.textAlign as string | undefined) ?? base.align;
    const paraOpts: PptxGenJS.TextPropsOptions = {
      ...(align && align !== 'left' ? { align: align as PptxGenJS.HAlign } : {}),
      ...(list ? { bullet: list.kind === 'number' ? { type: 'number' } : true, indentLevel: list.level } : {}),
    };
    const start = runs.length;
    for (const n of p.content ?? []) {
      if (n.type === 'hardBreak') {
        runs.push({ text: '', options: { ...paraOpts, softBreakBefore: true } });
        continue;
      }
      if (n.type !== 'text' || !n.text) continue;
      const o: PptxGenJS.TextPropsOptions = { ...paraOpts };
      for (const m of n.marks ?? []) {
        const a = m.attrs ?? {};
        if (m.type === 'bold') o.bold = true;
        else if (m.type === 'italic') o.italic = true;
        else if (m.type === 'underline') o.underline = { style: 'sng' };
        else if (m.type === 'strike') o.strike = 'sngStrike';
        else if (m.type === 'highlight') {
          const h = hex(themeColor(a.color as string, theme));
          if (h) o.highlight = h.color;
        } else if (m.type === 'link' && typeof a.href === 'string' && /^https?:|^mailto:/.test(a.href)) o.hyperlink = { url: a.href };
        else if (m.type === 'textStyle') {
          const c = hex(themeColor(a.color as string, theme));
          if (c) o.color = c.color;
          const size = ptOf(a.fontSize);
          if (size) o.fontSize = size;
          if (typeof a.fontFamily === 'string') o.fontFace = a.fontFamily.split(',')[0].replace(/["']/g, '').trim();
        }
      }
      runs.push({ text: n.text, options: o });
    }
    if (runs.length === start) runs.push({ text: '', options: paraOpts });
    runs[runs.length - 1].options = { ...runs[runs.length - 1].options, breakLine: true };
  };
  const walk = (nodes: TextNode[] | undefined, list: { kind: 'bullet' | 'number'; level: number } | null) => {
    for (const n of nodes ?? []) {
      if (n.type === 'paragraph' || n.type === 'heading') para(n, list);
      else if (n.type === 'bulletList' || n.type === 'orderedList') walk(n.content, { kind: n.type === 'orderedList' ? 'number' : 'bullet', level: list ? list.level + 1 : 0 });
      else if (n.type === 'listItem') walk(n.content, list);
    }
  };
  walk(doc?.content, null);
  if (runs.length) delete runs[runs.length - 1].options!.breakLine;
  const outline = hex(themeColor(base.outline, theme));
  if (outline) for (const r of runs) r.options = { ...r.options, outline: { color: outline.color, size: base.outlineWidth ?? 2 } };
  return runs;
}

const boxProps = (el: PlainElement) => ({
  x: inch(el.x),
  y: inch(el.y),
  w: inch(Math.max(1, el.w)),
  h: inch(Math.max(isLine(el.geom) ? 0 : 1, el.h)),
  ...(el.rot ? { rotate: el.rot } : {}),
  ...(el.flipH ? { flipH: true } : {}),
  ...(el.flipV ? { flipV: true } : {}),
});

function textOptions(el: PlainElement, theme: Theme): PptxGenJS.TextPropsOptions {
  const s = el.style ?? {};
  const color = hex(themeColor(s.color, theme) ?? (el.ph === 'title' ? theme.colors.title : el.ph === 'subtitle' ? theme.colors.muted : theme.colors.text));
  const pad = (s.pad ?? 10) * 0.75;
  return {
    ...boxProps(el),
    fontSize: s.fontSize ?? 18,
    fontFace: s.fontFamily ?? (el.ph === 'title' ? theme.fonts.heading : theme.fonts.body),
    ...(color ? { color: color.color } : {}),
    ...(s.bold ? { bold: true } : {}),
    ...(s.align ? { align: s.align as PptxGenJS.HAlign } : {}),
    valign: s.vAlign === 'middle' ? 'middle' : s.vAlign === 'bottom' ? 'bottom' : 'top',
    margin: [pad, pad, Math.max(3, pad / 2), Math.max(3, pad / 2)],
    lineSpacingMultiple: s.lineHeight ?? 1.2,
    fit: 'none',
  };
}

function shapeOptions(el: PlainElement, theme: Theme) {
  const s = el.style ?? {};
  const line = isOpenStroke(el);
  const fill = !line && s.fill ? hex(themeColor(s.fill, theme)) : null;
  const stroke = hex(themeColor(s.stroke, theme) ?? (line ? theme.colors.title : null));
  const sw = s.strokeWidth ?? (line ? 3 : 0);
  return {
    ...(fill ? { fill: { color: fill.color, ...(fill.transparency || s.opacity !== undefined ? { transparency: fill.transparency ?? Math.round((1 - (s.opacity ?? 1)) * 100) } : {}) } } : {}),
    ...(stroke && sw
      ? {
          line: {
            color: stroke.color,
            width: sw * 0.75,
            ...(s.dash === 'dash' ? { dashType: 'dash' as const } : s.dash === 'dot' ? { dashType: 'sysDot' as const } : {}),
            ...(el.geom === 'arrow' ? { endArrowType: 'triangle' as const } : {}),
          },
        }
      : {}),
    ...(el.geom === 'roundRect' ? { rectRadius: inch(Math.min(s.radius ?? 16, el.w / 2, el.h / 2)) } : {}),
    ...(s.shadow ? { shadow: { type: 'outer' as const, blur: 10, offset: 4, angle: 90, color: '0F172A', opacity: 0.18 } } : {}),
  };
}

export interface PptxReport {
  images: number;
  charts: number;
  tables: number;
  degraded: string[];
}

/** The deck as an editable PowerPoint file (native shapes, text, tables and charts — not pictures of slides). */
export async function exportPptx(deck: PlainDeck, loadImage: ImageLoader, opts: { author?: string; title?: string } = {}): Promise<{ buffer: Buffer; report: PptxReport }> {
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: 'MO', width: inch(deck.size.w), height: inch(deck.size.h) });
  pptx.layout = 'MO';
  pptx.title = opts.title ?? deck.name;
  if (opts.author) pptx.author = opts.author;
  pptx.company = 'Master Office';
  pptx.theme = { headFontFace: deck.theme.fonts.heading, bodyFontFace: deck.theme.fonts.body };
  const theme = deck.theme;
  const report: PptxReport = { images: 0, charts: 0, tables: 0, degraded: [] };
  const degrade = (msg: string) => !report.degraded.includes(msg) && report.degraded.push(msg);

  for (const s of deck.slides) {
    const slide = pptx.addSlide();
    const bg = s.meta.background;
    if (!bg) slide.background = { color: hex(theme.colors.bg)?.color ?? 'FFFFFF' };
    else if (bg.type === 'solid') slide.background = { color: hex(themeColor(bg.color, theme))?.color ?? 'FFFFFF' };
    else if (bg.type === 'gradient') {
      slide.background = { color: hex(themeColor(bg.from, theme))?.color ?? 'FFFFFF' };
      degrade('gradient backgrounds → solid colour');
    } else {
      const img = await loadImage(bg.src);
      if (img) slide.background = { data: `${img.mime};base64,${img.data.toString('base64')}` };
    }
    if (s.meta.hidden) slide.hidden = true;
    if (deck.numbers?.show && !(deck.numbers.skipTitle && s.meta.layout === 'title'))
      slide.slideNumber = { x: inch(deck.size.w * 0.9), y: inch(deck.size.h * 0.9), w: inch(deck.size.w * 0.065), h: inch(deck.size.h * 0.06), fontSize: 11, color: hex(theme.colors.muted)?.color ?? '94A3B8', align: 'right' } as never;
    if (s.notes) slide.addNotes(s.notes);

    // Attached connectors are exported where their shapes are.
    for (const el of [...resolveConnectors(s).elements].sort((a, b) => a.z - b.z)) {
      if (el.conn?.kind && el.conn.kind !== 'straight') degrade('elbow and curved connectors → straight lines');
      if (el.type === 'image' && el.src) {
        const img = await loadImage(el.src);
        if (!img) {
          degrade('some images could not be loaded');
          continue;
        }
        // Cropped pictures: the full picture's size, and the visible part as pptxgenjs' crop rectangle (→ a:srcRect).
        const c = el.crop;
        const cropped = c && (c.l || c.t || c.r || c.b);
        const fw = cropped ? el.w / Math.max(0.05, 1 - c.l - c.r) : el.w;
        const fh = cropped ? el.h / Math.max(0.05, 1 - c.t - c.b) : el.h;
        slide.addImage({
          data: `${img.mime};base64,${img.data.toString('base64')}`,
          ...boxProps(el),
          ...(cropped ? { w: inch(fw), h: inch(fh), sizing: { type: 'crop' as const, x: inch(c.l * fw), y: inch(c.t * fh), w: inch(el.w), h: inch(el.h) } } : {}),
          ...(el.alt ? { altText: el.alt } : {}),
          ...(el.style?.opacity !== undefined ? { transparency: Math.round((1 - el.style.opacity) * 100) } : {}),
        });
        if (el.style?.brightness || el.style?.contrast || el.style?.recolor) degrade('picture brightness / contrast / recolour → original picture');
        report.images++;
      } else if ((el.type === 'video' || el.type === 'audio') && el.src) {
        const yt = youtubeId(el.src);
        if (yt) {
          slide.addMedia({ type: 'online', link: `https://www.youtube.com/embed/${yt}`, ...boxProps(el) });
          continue;
        }
        const file = await loadImage(el.src);
        if (!file) {
          degrade('some video / audio files could not be loaded');
          continue;
        }
        const extn = (file.mime.split('/')[1] ?? '').replace('mpeg', 'mp3').replace('quicktime', 'mov').replace('x-m4a', 'm4a');
        slide.addMedia({ type: el.type, data: `${file.mime};base64,${file.data.toString('base64')}`, extn, ...boxProps(el) } as never);
        if (el.media?.start || el.media?.end || el.media?.autoplay || el.media?.loop) degrade('video / audio start, end, autoplay and loop settings');
      } else if (el.type === 'table' && el.table) {
        const t = el.table;
        const cols = t.rows[0]?.length ?? 0;
        const total = (t.colW ?? []).slice(0, cols).reduce((a, b) => a + b, 0);
        const colW = Array.from({ length: cols }, (_, i) => inch((t.colW && total ? t.colW[i] / total : 1 / Math.max(1, cols)) * el.w));
        const head = hex(themeColor(t.headerFill, theme) ?? theme.colors.accents[0])?.color ?? '2563EB';
        const band = hex(theme.colors.accents[0]);
        const rows = t.rows.map((row, r) =>
          row.map((v) => {
            const isHead = r === 0 && t.header !== false;
            const banded = !isHead && t.banded !== false && r % 2 === (t.header !== false ? 0 : 1);
            return {
              text: v,
              options: {
                ...(isHead ? { bold: true, color: 'FFFFFF', fill: { color: head } } : {}),
                ...(banded && band ? { fill: { color: band.color, transparency: 93 } } : {}),
              },
            };
          }),
        );
        const border = hex(themeColor(t.border, theme) ?? theme.colors.muted)?.color ?? 'CBD5E1';
        slide.addTable(rows, {
          ...boxProps(el),
          colW,
          fontSize: t.fontSize ?? 14,
          fontFace: theme.fonts.body,
          color: hex(theme.colors.text)?.color,
          valign: 'middle',
          border: { type: 'solid', pt: 0.75, color: border },
          margin: [3, 6, 3, 6],
        });
        report.tables++;
      } else if (el.type === 'chart' && el.chart) {
        const c = el.chart;
        const pie = c.kind === 'pie' || c.kind === 'doughnut';
        const type = { column: 'bar', bar: 'bar', line: 'line', area: 'area', pie: 'pie', doughnut: 'doughnut' }[c.kind] as PptxGenJS.CHART_NAME;
        const data = (pie ? c.series.slice(0, 1) : c.series).map((x) => ({ name: x.name, labels: c.categories, values: c.categories.map((_, i) => Number(x.values[i]) || 0) }));
        const colors = pie ? c.categories.map((_, i) => theme.colors.accents[i % theme.colors.accents.length]) : c.series.map((x, i) => themeColor(x.color, theme) ?? theme.colors.accents[i % theme.colors.accents.length]);
        slide.addChart(type, data, {
          ...boxProps(el),
          ...(c.kind === 'column' ? { barDir: 'col' } : c.kind === 'bar' ? { barDir: 'bar' } : {}),
          chartColors: colors.map((x) => hex(x)?.color ?? '2563EB'),
          showLegend: c.legend ?? (pie || c.series.length > 1),
          legendPos: 'b',
          ...(c.title ? { showTitle: true, title: c.title, titleFontSize: 14 } : {}),
          ...(pie ? { showPercent: c.labels !== false, showValue: false } : { showValue: !!c.labels }),
          ...(c.kind === 'doughnut' ? { holeSize: 58 } : {}),
          catAxisLabelFontFace: theme.fonts.body,
          valAxisLabelFontFace: theme.fonts.body,
          lineSize: 2,
        });
        report.charts++;
      } else if (el.type === 'shape' || el.type === 'text') {
        const runs = el.type === 'shape' && isLine(el.geom) ? [] : textRuns(el.text, el.style ?? {}, theme);
        const hasText = !!textOf(el.text).trim();
        const shape = el.type === 'shape' ? shapeOptions(el, theme) : {};
        if (el.type === 'shape' && el.geom === 'freeform') {
          // Freeform → custom geometry (cubic segments for curves and scribbles), in inches within the box.
          const { start, segs } = freeformSegments(el.path ?? { pts: [] }, el.w, el.h);
          const P = (p: [number, number]) => ({ x: inch(p[0]), y: inch(p[1]) });
          const points = [
            { ...P(start), moveTo: true },
            ...segs.map((g) => (g.c1 && g.c2 ? { ...P(g.to), curve: { type: 'cubic' as const, x1: inch(g.c1[0]), y1: inch(g.c1[1]), x2: inch(g.c2[0]), y2: inch(g.c2[1]) } } : P(g.to))),
            ...(el.path?.closed ? [{ close: true as const }] : []),
          ];
          slide.addShape('custGeom' as PptxGenJS.SHAPE_NAME, { ...boxProps(el), ...shape, points } as PptxGenJS.ShapeProps);
          continue;
        }
        const prst = el.type === 'shape' ? (el.geom === 'arrow' ? 'line' : el.geom ?? 'rect') : 'rect';
        if (!hasText && el.type === 'text') continue; // empty placeholder: PowerPoint shows nothing either
        if (!hasText) slide.addShape(prst as PptxGenJS.SHAPE_NAME, { ...boxProps(el), ...shape });
        else slide.addText(runs as PptxGenJS.TextProps[], { ...textOptions(el, theme), ...shape, shape: prst as PptxGenJS.SHAPE_NAME });
      }
    }
  }
  const raw = (await pptx.write({ outputType: 'nodebuffer', compression: true })) as Buffer;
  return { buffer: await applyTheme(raw, theme), report };
}

/** pptxgenjs always writes the stock Office theme: replace its colour scheme and fonts with the deck's theme. */
async function applyTheme(buf: Buffer, theme: Theme): Promise<Buffer> {
  const zip = await JSZip.loadAsync(buf);
  const part = Object.keys(zip.files).find((p) => /^ppt\/theme\/theme\d+\.xml$/.test(p));
  if (!part) return buf;
  const c = theme.colors;
  const slots: Record<string, string> = { dk1: c.text, lt1: c.bg, dk2: c.title, lt2: c.muted };
  c.accents.slice(0, 6).forEach((a, i) => (slots[`accent${i + 1}`] = a));
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  let x = await zip.file(part)!.async('string');
  for (const [slot, color] of Object.entries(slots)) {
    const h = hex(color);
    if (h) x = x.replace(new RegExp(`<a:${slot}>[\\s\\S]*?</a:${slot}>`), `<a:${slot}><a:srgbClr val="${h.color}"/></a:${slot}>`);
  }
  x = x.replace(/(<a:theme\b[^>]*\bname=")[^"]*"/, `$1${esc(`Master Office: ${theme.id}`)}"`);
  x = x.replace(/(<a:clrScheme\b[^>]*\bname=")[^"]*"/, `$1${esc(theme.name)}"`);
  x = x.replace(/(<a:majorFont>\s*<a:latin typeface=")[^"]*"/, `$1${esc(theme.fonts.heading)}"`);
  x = x.replace(/(<a:minorFont>\s*<a:latin typeface=")[^"]*"/, `$1${esc(theme.fonts.body)}"`);
  zip.file(part, x);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

export const deckOutline = (deck: PlainDeck) => deck.slides.map((s, i) => `${i + 1}. ${slideTitle(s) || '(untitled)'}`);
