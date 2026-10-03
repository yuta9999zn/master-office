// Slide → HTML. One renderer for the editor canvas, thumbnails, presenting, version previews and the server's
// PDF / PNG / HTML export — so an exported slide is pixel-for-pixel what people saw in the editor.
// Coordinates are slide px (1280 × 720 for 16:9); callers scale the whole slide with a CSS transform.
import type { Background, ChartSpec, DeckSize, ElementStyle, Geometry, PlainDeck, PlainElement, PlainSlide, SlideNumbers, TextNode, Theme } from './index';
import { youtubeId } from './index';

export const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Base CSS for rendered slides (inject once per page). Text rules are shared with the in-place text editor. */
export const SLIDE_CSS = `
.mo-slide { position: relative; overflow: hidden; font-family: Inter, Arial, sans-serif; -webkit-font-smoothing: antialiased; }
.mo-slide .mo-el { position: absolute; box-sizing: border-box; }
.mo-slide .mo-el > svg { position: absolute; inset: 0; overflow: visible; }
.mo-box { position: absolute; inset: 0; display: flex; flex-direction: column; box-sizing: border-box; overflow: hidden; }
.mo-text { overflow-wrap: break-word; word-break: break-word; white-space: pre-wrap; outline: none; }
.mo-text p { margin: 0; min-height: 1em; }
.mo-text ul, .mo-text ol { margin: 0; padding-left: 1.3em; }
.mo-text li { margin: 0.15em 0; }
.mo-text li > p { min-height: 0; }
.mo-text ul { list-style: disc; }
.mo-text ul ul { list-style: circle; }
.mo-text ol { list-style: decimal; }
.mo-text a { color: inherit; text-decoration: underline; }
.mo-text mark { color: inherit; padding: 0 0.05em; }
.mo-slide table.mo-table { width: 100%; height: 100%; border-collapse: collapse; table-layout: fixed; }
.mo-slide table.mo-table td { padding: 0.35em 0.6em; vertical-align: middle; overflow: hidden; white-space: pre-wrap; overflow-wrap: break-word; }
.mo-ph-prompt { color: #94A3B8; }
.mo-slide-no { position: absolute; font-size: 14px; line-height: 1; pointer-events: none; }
.mo-editing .ProseMirror { outline: none; }
@keyframes mo-appear { from { visibility: hidden } to { visibility: visible } }
@keyframes mo-disappear { from { visibility: visible } to { visibility: hidden } }
@keyframes mo-fadeIn { from { opacity: 0 } to { opacity: 1 } }
@keyframes mo-fadeOut { from { opacity: 1 } to { opacity: 0 } }
@keyframes mo-flyInLeft { from { translate: -1600px 0 } to { translate: 0 0 } }
@keyframes mo-flyInRight { from { translate: 1600px 0 } to { translate: 0 0 } }
@keyframes mo-flyInTop { from { translate: 0 -1000px } to { translate: 0 0 } }
@keyframes mo-flyInBottom { from { translate: 0 1000px } to { translate: 0 0 } }
@keyframes mo-flyOutLeft { from { translate: 0 0 } to { translate: -1600px 0 } }
@keyframes mo-flyOutRight { from { translate: 0 0 } to { translate: 1600px 0 } }
@keyframes mo-flyOutTop { from { translate: 0 0 } to { translate: 0 -1000px } }
@keyframes mo-flyOutBottom { from { translate: 0 0 } to { translate: 0 1000px } }
@keyframes mo-zoomIn { from { scale: 0; opacity: 0 } to { scale: 1; opacity: 1 } }
@keyframes mo-zoomOut { from { scale: 1; opacity: 1 } to { scale: 0; opacity: 0 } }
@keyframes mo-spinIn { from { rotate: -360deg; scale: 0.2; opacity: 0 } to { rotate: 0deg; scale: 1; opacity: 1 } }
.mo-editing p.is-editor-empty:first-child::before { content: attr(data-placeholder); color: #94A3B8; float: left; height: 0; pointer-events: none; }
`;

// ── Fonts ────────────────────────────────────────────────────────────────────

/**
 * Font family → CSS font stack. The browser maps "Inter" to the app's self-hosted copy (next/font registers it under
 * a hashed name exposed as --font-inter); everything gets sensible fallbacks.
 */
export const FONT_ALIASES: Record<string, string> = {};
export function fontStack(family: string | null | undefined): string {
  const f = (family ?? '').split(',')[0].replace(/["']/g, '').trim() || 'Inter';
  return FONT_ALIASES[f] ?? `"${f}", Arial, sans-serif`;
}

// ── Colours ──────────────────────────────────────────────────────────────────

/** Theme colour tokens ("@accent1", "@title", …) follow the deck's theme; anything else is a literal CSS colour. */
export const THEME_TOKENS = ['@bg', '@text', '@title', '@muted', '@accent1', '@accent2', '@accent3', '@accent4', '@accent5', '@accent6'] as const;

export function themeColor(c: string | null | undefined, theme: Theme): string | null {
  if (!c) return null;
  if (!c.startsWith('@')) return c;
  const k = c.slice(1);
  if (k.startsWith('accent')) return theme.colors.accents[(Number(k.slice(6)) || 1) - 1] ?? theme.colors.accents[0];
  return (theme.colors as unknown as Record<string, string>)[k] ?? null;
}

export function alpha(hex: string, a: number) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

export function backgroundCss(bg: Background | null | undefined, theme: Theme, resolve: (src: string) => string = (s) => s): string {
  if (!bg) return `background:${theme.colors.bg}`;
  if (bg.type === 'solid') return `background:${themeColor(bg.color, theme)}`;
  if (bg.type === 'gradient') return `background:linear-gradient(${bg.angle}deg,${themeColor(bg.from, theme)},${themeColor(bg.to, theme)})`;
  return `background:${theme.colors.bg} url("${esc(resolve(bg.src))}") center/cover no-repeat`;
}

// ── Rich text ────────────────────────────────────────────────────────────────

const safeHref = (h: unknown) => (typeof h === 'string' && /^(https?:|mailto:|\/)/i.test(h) ? h : null);
const cssLen = (v: unknown) => (typeof v === 'number' ? `${v}pt` : typeof v === 'string' && /^\d+(\.\d+)?(pt|px|em)?$/.test(v) ? (/\d$/.test(v) ? `${v}pt` : v) : null);

function runHtml(n: TextNode, theme?: Theme): string {
  let html = esc(n.text ?? '');
  const styles: string[] = [];
  for (const m of n.marks ?? []) {
    const a = m.attrs ?? {};
    switch (m.type) {
      case 'bold':
        html = `<strong>${html}</strong>`;
        break;
      case 'italic':
        html = `<em>${html}</em>`;
        break;
      case 'underline':
        html = `<u>${html}</u>`;
        break;
      case 'strike':
        html = `<s>${html}</s>`;
        break;
      case 'highlight':
        html = `<mark style="background:${esc(String((theme ? themeColor(a.color as string, theme) : a.color) ?? '#FEF08A'))}">${html}</mark>`;
        break;
      case 'link': {
        const href = safeHref(a.href);
        if (href) html = `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${html}</a>`;
        break;
      }
      case 'textStyle':
        if (a.color) styles.push(`color:${theme ? themeColor(a.color as string, theme) : a.color}`);
        if (cssLen(a.fontSize)) styles.push(`font-size:${cssLen(a.fontSize)}`);
        if (a.fontFamily) styles.push(`font-family:${fontStack(String(a.fontFamily))}`);
        if (a.backgroundColor) styles.push(`background:${a.backgroundColor}`);
        break;
    }
  }
  return styles.length ? `<span style="${esc(styles.join(';'))}">${html}</span>` : html;
}

function blockHtml(n: TextNode, theme?: Theme): string {
  const inner = () => (n.content ?? []).map((c) => blockHtml(c, theme)).join('');
  switch (n.type) {
    case 'text':
      return runHtml(n, theme);
    case 'hardBreak':
      return '<br>';
    case 'paragraph':
    case 'heading': {
      const align = n.attrs?.textAlign;
      const body = inner();
      return `<p${align && align !== 'left' ? ` style="text-align:${esc(String(align))}"` : ''}>${body || '<br>'}</p>`;
    }
    case 'bulletList':
      return `<ul>${inner()}</ul>`;
    case 'orderedList':
      return `<ol${n.attrs?.start && n.attrs.start !== 1 ? ` start="${Number(n.attrs.start)}"` : ''}>${inner()}</ol>`;
    case 'listItem':
      return `<li>${inner()}</li>`;
    default:
      return inner();
  }
}

export function textHtml(doc: TextNode | null | undefined, theme?: Theme): string {
  return (doc?.content ?? []).map((c) => blockHtml(c, theme)).join('');
}

/** CSS of a text container from the element's default formatting. */
export function textBoxCss(style: ElementStyle | undefined, theme: Theme, ph?: string | null): string {
  const s = style ?? {};
  const pad = s.pad ?? 10;
  const css = [
    `padding:${Math.max(4, pad * 0.5)}px ${pad}px`,
    `font-size:${s.fontSize ?? 18}pt`,
    `font-family:${fontStack(s.fontFamily ?? (ph === 'title' ? theme.fonts.heading : theme.fonts.body))}`,
    `color:${themeColor(s.color, theme) ?? (ph === 'title' ? theme.colors.title : ph === 'subtitle' ? theme.colors.muted : theme.colors.text)}`,
    `line-height:${s.lineHeight ?? 1.2}`,
    `justify-content:${s.vAlign === 'middle' ? 'center' : s.vAlign === 'bottom' ? 'flex-end' : 'flex-start'}`,
  ];
  if (s.bold) css.push('font-weight:700');
  if (s.align) css.push(`text-align:${s.align}`);
  return css.join(';');
}

// ── Shapes ───────────────────────────────────────────────────────────────────

export const SHAPES: { geom: Geometry; label: string }[] = [
  { geom: 'rect', label: 'Rectangle' },
  { geom: 'roundRect', label: 'Rounded rectangle' },
  { geom: 'ellipse', label: 'Oval' },
  { geom: 'triangle', label: 'Triangle' },
  { geom: 'rtTriangle', label: 'Right triangle' },
  { geom: 'diamond', label: 'Diamond' },
  { geom: 'pentagon', label: 'Pentagon' },
  { geom: 'hexagon', label: 'Hexagon' },
  { geom: 'parallelogram', label: 'Parallelogram' },
  { geom: 'trapezoid', label: 'Trapezoid' },
  { geom: 'rightArrow', label: 'Right arrow' },
  { geom: 'leftArrow', label: 'Left arrow' },
  { geom: 'chevron', label: 'Chevron' },
  { geom: 'star5', label: 'Star' },
  { geom: 'line', label: 'Line' },
  { geom: 'arrow', label: 'Arrow' },
];

const f = (n: number) => Math.round(n * 100) / 100;
const poly = (pts: [number, number][]) => `M${pts.map(([x, y]) => `${f(x)},${f(y)}`).join(' L')} Z`;

/** SVG path of a geometry in a w × h box (actual size, so strokes are never distorted). */
export function shapePath(geom: Geometry, w: number, h: number, radius = 16): string {
  switch (geom) {
    case 'roundRect': {
      const r = Math.min(radius, w / 2, h / 2);
      return `M${f(r)},0 H${f(w - r)} A${f(r)},${f(r)} 0 0 1 ${f(w)},${f(r)} V${f(h - r)} A${f(r)},${f(r)} 0 0 1 ${f(w - r)},${f(h)} H${f(r)} A${f(r)},${f(r)} 0 0 1 0,${f(h - r)} V${f(r)} A${f(r)},${f(r)} 0 0 1 ${f(r)},0 Z`;
    }
    case 'ellipse':
      return `M0,${f(h / 2)} A${f(w / 2)},${f(h / 2)} 0 1 0 ${f(w)},${f(h / 2)} A${f(w / 2)},${f(h / 2)} 0 1 0 0,${f(h / 2)} Z`;
    case 'triangle':
      return poly([[w / 2, 0], [w, h], [0, h]]);
    case 'rtTriangle':
      return poly([[0, 0], [w, h], [0, h]]);
    case 'diamond':
      return poly([[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]]);
    case 'pentagon':
      return poly([[w / 2, 0], [w, h * 0.38], [w * 0.81, h], [w * 0.19, h], [0, h * 0.38]]);
    case 'hexagon':
      return poly([[w * 0.25, 0], [w * 0.75, 0], [w, h / 2], [w * 0.75, h], [w * 0.25, h], [0, h / 2]]);
    case 'parallelogram':
      return poly([[w * 0.25, 0], [w, 0], [w * 0.75, h], [0, h]]);
    case 'trapezoid':
      return poly([[w * 0.2, 0], [w * 0.8, 0], [w, h], [0, h]]);
    case 'rightArrow':
      return poly([[0, h * 0.25], [w * 0.6, h * 0.25], [w * 0.6, 0], [w, h / 2], [w * 0.6, h], [w * 0.6, h * 0.75], [0, h * 0.75]]);
    case 'leftArrow':
      return poly([[w, h * 0.25], [w * 0.4, h * 0.25], [w * 0.4, 0], [0, h / 2], [w * 0.4, h], [w * 0.4, h * 0.75], [w, h * 0.75]]);
    case 'chevron':
      return poly([[0, 0], [w * 0.75, 0], [w, h / 2], [w * 0.75, h], [0, h], [w * 0.25, h / 2]]);
    case 'star5': {
      const pts: [number, number][] = [];
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const r = i % 2 ? 0.38 : 0.5;
        pts.push([w / 2 + Math.cos(a) * w * r, h * 0.53 + Math.sin(a) * h * r * 1.05]);
      }
      return poly(pts);
    }
    case 'line':
    case 'arrow':
      return `M0,0 L${f(w)},${f(h)}`;
    default:
      return `M0,0 H${f(w)} V${f(h)} H0 Z`;
  }
}

export const isLine = (g?: Geometry) => g === 'line' || g === 'arrow';

function shapeSvg(el: PlainElement, theme: Theme): string {
  const s = el.style ?? {};
  const geom = el.geom ?? 'rect';
  const line = isLine(geom);
  const sw = s.strokeWidth ?? (line ? 3 : 0);
  const stroke = themeColor(s.stroke, theme) ?? (line ? theme.colors.title : null);
  const fill = line ? 'none' : themeColor(s.fill, theme) ?? 'none';
  const dash = s.dash === 'dash' ? ` stroke-dasharray="${sw * 4} ${sw * 2}"` : s.dash === 'dot' ? ` stroke-dasharray="${sw} ${sw * 1.5}" stroke-linecap="round"` : '';
  const flip = el.flipH || el.flipV ? ` transform="translate(${el.flipH ? el.w : 0} ${el.flipV ? el.h : 0}) scale(${el.flipH ? -1 : 1} ${el.flipV ? -1 : 1})"` : '';
  const marker =
    geom === 'arrow'
      ? `<defs><marker id="ah-${esc(el.id)}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="${Math.max(3, 12 / Math.max(1, sw / 2))}" markerHeight="${Math.max(3, 12 / Math.max(1, sw / 2))}" markerUnits="strokeWidth" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 Z" fill="${esc(stroke ?? '#000')}"/></marker></defs>`
      : '';
  const shadow = s.shadow ? ' style="filter:drop-shadow(0 6px 14px rgba(15,23,42,0.18))"' : '';
  // A zero-height (or zero-width) SVG is not rendered at all: keep 1 px and let the stroke overflow.
  return `<svg width="${f(Math.max(1, el.w))}" height="${f(Math.max(1, el.h))}"${shadow}>${marker}<path d="${shapePath(geom, el.w, Math.max(el.h, line ? 0 : 1), s.radius)}" fill="${esc(fill)}"${
    stroke && sw ? ` stroke="${esc(stroke)}" stroke-width="${sw}" stroke-linejoin="round"` : ''
  }${dash}${geom === 'arrow' ? ` marker-end="url(#ah-${esc(el.id)})"` : ''}${flip}/></svg>`;
}

// ── Charts ───────────────────────────────────────────────────────────────────

export function compactNumber(v: number): string {
  const a = Math.abs(v);
  const t = (n: number, s: string) => `${f(n)}`.replace(/\.0+$/, '') + s;
  if (a >= 1e9) return t(v / 1e9, 'B');
  if (a >= 1e6) return t(v / 1e6, 'M');
  if (a >= 1e3) return t(v / 1e3, 'K');
  return t(v, '');
}

function niceStep(range: number, ticks = 5) {
  const raw = range / ticks || 1;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const n = raw / mag;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag;
}

export function seriesColor(spec: ChartSpec, i: number, theme: Theme) {
  return themeColor(spec.series[i]?.color, theme) ?? theme.colors.accents[i % theme.colors.accents.length];
}

/** Chart as SVG markup sized w × h. */
export function chartSvg(spec: ChartSpec, w: number, h: number, theme: Theme, font = theme.fonts.body): string {
  const txt = theme.colors.text;
  const muted = theme.colors.muted;
  const fs = Math.max(11, Math.min(16, Math.min(w, h) / 22));
  const out: string[] = [`<svg width="${f(w)}" height="${f(h)}" style="font-family:${esc(fontStack(font))}" font-size="${f(fs)}">`];
  let top = 8;
  if (spec.title) {
    out.push(`<text x="${f(w / 2)}" y="${f(fs * 1.3)}" text-anchor="middle" font-weight="700" font-size="${f(fs * 1.15)}" fill="${esc(theme.colors.title)}">${esc(spec.title)}</text>`);
    top = fs * 2.2;
  }
  const pie = spec.kind === 'pie' || spec.kind === 'doughnut';
  const legendItems = pie ? spec.categories.map((c, i) => ({ name: c, color: theme.colors.accents[i % theme.colors.accents.length] })) : spec.series.map((s, i) => ({ name: s.name, color: seriesColor(spec, i, theme) }));
  const showLegend = spec.legend ?? (pie || spec.series.length > 1);
  let bottom = h - 6;
  if (showLegend && legendItems.length) {
    const ly = h - fs * 0.6;
    let total = 0;
    const widths = legendItems.map((l) => fs * 1.4 + l.name.length * fs * 0.58 + fs);
    total = widths.reduce((a, b) => a + b, 0);
    let lx = Math.max(4, (w - total) / 2);
    legendItems.forEach((l, i) => {
      out.push(`<rect x="${f(lx)}" y="${f(ly - fs * 0.8)}" width="${f(fs * 0.85)}" height="${f(fs * 0.85)}" rx="2" fill="${esc(l.color)}"/>`);
      out.push(`<text x="${f(lx + fs * 1.2)}" y="${f(ly)}" fill="${esc(txt)}">${esc(l.name)}</text>`);
      lx += widths[i];
    });
    bottom = h - fs * 2.2;
  }

  if (pie) {
    const values = (spec.series[0]?.values ?? []).map((v) => Math.max(0, Number(v) || 0));
    const sum = values.reduce((a, b) => a + b, 0) || 1;
    const cx = w / 2;
    const cy = (top + bottom) / 2;
    const r = Math.max(10, Math.min(w / 2 - 10, (bottom - top) / 2 - 4));
    const inner = spec.kind === 'doughnut' ? r * 0.58 : 0;
    let a0 = -Math.PI / 2;
    values.forEach((v, i) => {
      const a1 = a0 + (v / sum) * Math.PI * 2;
      const large = a1 - a0 > Math.PI ? 1 : 0;
      const p = (a: number, rr: number) => `${f(cx + Math.cos(a) * rr)},${f(cy + Math.sin(a) * rr)}`;
      const color = theme.colors.accents[i % theme.colors.accents.length];
      if (v / sum >= 0.9999) {
        out.push(`<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r)}" fill="${esc(color)}"/>`);
      } else if (v > 0) {
        out.push(
          inner
            ? `<path d="M${p(a0, r)} A${f(r)},${f(r)} 0 ${large} 1 ${p(a1, r)} L${p(a1, inner)} A${f(inner)},${f(inner)} 0 ${large} 0 ${p(a0, inner)} Z" fill="${esc(color)}" stroke="#fff" stroke-width="2"/>`
            : `<path d="M${f(cx)},${f(cy)} L${p(a0, r)} A${f(r)},${f(r)} 0 ${large} 1 ${p(a1, r)} Z" fill="${esc(color)}" stroke="#fff" stroke-width="2"/>`,
        );
      }
      if (spec.labels !== false && v > 0 && v / sum > 0.04) {
        const am = (a0 + a1) / 2;
        const lr = inner ? (r + inner) / 2 : r * 0.62;
        out.push(`<text x="${f(cx + Math.cos(am) * lr)}" y="${f(cy + Math.sin(am) * lr + fs * 0.35)}" text-anchor="middle" fill="#fff" font-weight="600">${Math.round((v / sum) * 100)}%</text>`);
      }
      a0 = a1;
    });
    if (inner) out.push(`<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(inner)}" fill="none"/>`);
    out.push('</svg>');
    return out.join('');
  }

  const all = spec.series.flatMap((s) => s.values.map((v) => Number(v) || 0));
  const maxV = Math.max(0, ...all);
  const minV = Math.min(0, ...all);
  const step = niceStep(maxV - minV || 1);
  const hi = Math.ceil(maxV / step) * step || step;
  const lo = Math.floor(minV / step) * step;
  const horizontal = spec.kind === 'bar';
  const ticks: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(f(v));
  const labelW = Math.max(...ticks.map((t) => compactNumber(t).length)) * fs * 0.6 + 8;
  const catW = horizontal ? Math.min(w * 0.3, Math.max(...spec.categories.map((c) => c.length), 1) * fs * 0.58 + 10) : 0;
  const left = horizontal ? catW : labelW;
  const right = w - 10;
  const plotTop = top + 6;
  const plotBottom = bottom - (horizontal ? fs * 1.6 : fs * 1.8);
  const n = Math.max(1, spec.categories.length);
  const scale = (v: number) => (horizontal ? left + ((v - lo) / (hi - lo)) * (right - left) : plotBottom - ((v - lo) / (hi - lo)) * (plotBottom - plotTop));

  for (const t of ticks) {
    const p = scale(t);
    out.push(
      horizontal
        ? `<line x1="${f(p)}" y1="${f(plotTop)}" x2="${f(p)}" y2="${f(plotBottom)}" stroke="${alpha(muted, 0.3)}"/><text x="${f(p)}" y="${f(plotBottom + fs * 1.3)}" text-anchor="middle" fill="${esc(muted)}">${compactNumber(t)}</text>`
        : `<line x1="${f(left)}" y1="${f(p)}" x2="${f(right)}" y2="${f(p)}" stroke="${alpha(muted, 0.3)}"/><text x="${f(left - 6)}" y="${f(p + fs * 0.35)}" text-anchor="end" fill="${esc(muted)}">${compactNumber(t)}</text>`,
    );
  }
  const band = horizontal ? (plotBottom - plotTop) / n : (right - left) / n;
  spec.categories.forEach((c, i) => {
    const mid = (horizontal ? plotTop : left) + band * (i + 0.5);
    out.push(
      horizontal
        ? `<text x="${f(left - 6)}" y="${f(mid + fs * 0.35)}" text-anchor="end" fill="${esc(txt)}">${esc(c)}</text>`
        : `<text x="${f(mid)}" y="${f(plotBottom + fs * 1.35)}" text-anchor="middle" fill="${esc(txt)}">${esc(c)}</text>`,
    );
  });

  const zero = scale(0);
  if (spec.kind === 'column' || spec.kind === 'bar') {
    const groups = Math.max(1, spec.series.length);
    const inner = band * 0.7;
    const bw = inner / groups;
    spec.series.forEach((s, si) => {
      const color = seriesColor(spec, si, theme);
      s.values.forEach((raw, i) => {
        const v = Number(raw) || 0;
        const start = (horizontal ? plotTop : left) + band * i + (band - inner) / 2 + bw * si;
        const p = scale(v);
        const r = Math.min(4, bw / 4);
        if (horizontal) {
          const x0 = Math.min(zero, p);
          out.push(`<rect x="${f(x0)}" y="${f(start + 1)}" width="${f(Math.abs(p - zero))}" height="${f(Math.max(1, bw - 2))}" rx="${f(r)}" fill="${esc(color)}"/>`);
          if (spec.labels) out.push(`<text x="${f(p + 4)}" y="${f(start + bw / 2 + fs * 0.35)}" fill="${esc(txt)}">${compactNumber(v)}</text>`);
        } else {
          const y0 = Math.min(zero, p);
          out.push(`<rect x="${f(start + 1)}" y="${f(y0)}" width="${f(Math.max(1, bw - 2))}" height="${f(Math.abs(p - zero))}" rx="${f(r)}" fill="${esc(color)}"/>`);
          if (spec.labels) out.push(`<text x="${f(start + bw / 2)}" y="${f(y0 - 4)}" text-anchor="middle" fill="${esc(txt)}">${compactNumber(v)}</text>`);
        }
      });
    });
  } else {
    spec.series.forEach((s, si) => {
      const color = seriesColor(spec, si, theme);
      const pts = s.values.map((raw, i) => [left + band * (i + 0.5), scale(Number(raw) || 0)] as const);
      if (!pts.length) return;
      const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${f(x)},${f(y)}`).join(' ');
      if (spec.kind === 'area') out.push(`<path d="${d} L${f(pts[pts.length - 1][0])},${f(zero)} L${f(pts[0][0])},${f(zero)} Z" fill="${alpha(color, 0.25)}"/>`);
      out.push(`<path d="${d}" fill="none" stroke="${esc(color)}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>`);
      for (const [x, y] of pts) out.push(`<circle cx="${f(x)}" cy="${f(y)}" r="4" fill="#fff" stroke="${esc(color)}" stroke-width="2.5"/>`);
      if (spec.labels) s.values.forEach((v, i) => out.push(`<text x="${f(pts[i][0])}" y="${f(pts[i][1] - 9)}" text-anchor="middle" fill="${esc(txt)}">${compactNumber(Number(v) || 0)}</text>`));
    });
  }
  out.push(`<line x1="${f(horizontal ? zero : left)}" y1="${f(horizontal ? plotTop : zero)}" x2="${f(horizontal ? zero : right)}" y2="${f(horizontal ? plotBottom : zero)}" stroke="${alpha(muted, 0.8)}"/>`);
  out.push('</svg>');
  return out.join('');
}

// ── Tables ───────────────────────────────────────────────────────────────────

export function tableHtml(t: NonNullable<PlainElement['table']>, theme: Theme): string {
  const cols = t.rows[0]?.length ?? 0;
  const total = (t.colW ?? []).slice(0, cols).reduce((a, b) => a + b, 0);
  const widths = Array.from({ length: cols }, (_, i) => (t.colW && total ? (t.colW[i] / total) * 100 : 100 / Math.max(1, cols)));
  const head = themeColor(t.headerFill, theme) ?? theme.colors.accents[0];
  const border = themeColor(t.border, theme) ?? alpha(theme.colors.muted, 0.45);
  let html = `<table class="mo-table" style="font-size:${t.fontSize ?? 14}pt;font-family:${esc(fontStack(theme.fonts.body))};color:${esc(theme.colors.text)}"><colgroup>${widths.map((w) => `<col style="width:${f(w)}%">`).join('')}</colgroup>`;
  t.rows.forEach((row, r) => {
    const isHead = r === 0 && t.header !== false;
    const bg = isHead ? head : t.banded !== false && r % 2 === (t.header !== false ? 0 : 1) ? alpha(theme.colors.accents[0], 0.07) : 'transparent';
    html += '<tr>';
    row.forEach((v) => {
      html += `<td style="border:1px solid ${esc(border)};background:${esc(bg)}${isHead ? ';color:#fff;font-weight:700' : ''}">${esc(v)}</td>`;
    });
    html += '</tr>';
  });
  return `${html}</table>`;
}

// ── Elements & slides ────────────────────────────────────────────────────────

export interface RenderOptions {
  /** Maps stored image URLs for the output (e.g. to data: URLs for PDF export). */
  resolveSrc?: (src: string) => string;
  /** Show "Click to add title" prompts in empty placeholders (editor only). */
  prompts?: boolean;
  /** Leave the text of these elements out (they are being edited in place). */
  skipText?: Set<string>;
  /** Extra CSS per element id (animation states in the slide show). */
  elementCss?: Record<string, string>;
  /** Real video / audio players (slide show); otherwise a still frame. */
  live?: boolean;
}

export function elementHtml(el: PlainElement, theme: Theme, opts: RenderOptions = {}): string {
  const s = el.style ?? {};
  const wrap = [`left:${f(el.x)}px`, `top:${f(el.y)}px`, `width:${f(el.w)}px`, `height:${f(el.h)}px`];
  if (el.rot) wrap.push(`transform:rotate(${f(el.rot)}deg)`);
  if (s.opacity !== undefined && s.opacity < 1) wrap.push(`opacity:${s.opacity}`);
  const extra = opts.elementCss?.[el.id];
  if (extra) wrap.push(extra);
  let inner = '';
  if (el.type === 'image' && el.src) {
    const src = opts.resolveSrc ? opts.resolveSrc(el.src) : el.src;
    const flip = el.flipH || el.flipV ? `;transform:scale(${el.flipH ? -1 : 1},${el.flipV ? -1 : 1})` : '';
    const filter = imageFilter(s);
    const c = el.crop;
    if (c && (c.l || c.t || c.r || c.b)) {
      // The frame shows the uncropped part: the full picture is scaled up and shifted inside a clipping box.
      const kw = 1 / Math.max(0.01, 1 - c.l - c.r);
      const kh = 1 / Math.max(0.01, 1 - c.t - c.b);
      inner = `<div style="width:100%;height:100%;overflow:hidden;position:relative${s.radius ? `;border-radius:${s.radius}px` : ''}${s.shadow ? ';box-shadow:0 8px 24px -6px rgba(15,23,42,0.3)' : ''}${flip}"><img src="${esc(src)}" alt="${esc(el.alt ?? '')}" draggable="false" style="position:absolute;max-width:none;left:${f(-c.l * kw * 100)}%;top:${f(-c.t * kh * 100)}%;width:${f(kw * 100)}%;height:${f(kh * 100)}%;display:block${filter}"></div>`;
    } else
      inner = `<img src="${esc(src)}" alt="${esc(el.alt ?? '')}" draggable="false" style="width:100%;height:100%;object-fit:fill;display:block${s.radius ? `;border-radius:${s.radius}px` : ''}${s.shadow ? ';box-shadow:0 8px 24px -6px rgba(15,23,42,0.3)' : ''}${flip}${filter}">`;
  } else if ((el.type === 'video' || el.type === 'audio') && el.src) {
    inner = mediaHtml(el, opts);
  } else if (el.type === 'chart' && el.chart) {
    inner = chartSvg(el.chart, el.w, el.h, theme, s.fontFamily);
  } else if (el.type === 'table' && el.table) {
    inner = tableHtml(el.table, theme);
  } else {
    if (el.type === 'shape') inner += shapeSvg(el, theme);
    if (!isLine(el.geom) && !opts.skipText?.has(el.id)) {
      const body = textHtml(el.text, theme);
      const empty = !body || /^(<(ul|ol)><li>)?<p><br><\/p>(<\/li><\/(ul|ol)>)?$/.test(body);
      const content = empty && opts.prompts && el.ph ? `<p class="mo-ph-prompt">${esc(PLACEHOLDER_PROMPT[el.ph] ?? '')}</p>` : body;
      if (content) inner += `<div class="mo-box" style="${esc(textBoxCss(s, theme, el.ph))}"><div class="mo-text">${content}</div></div>`;
    }
  }
  return `<div class="mo-el" data-el="${esc(el.id)}" style="${wrap.join(';')}">${inner}</div>`;
}

const PLAY_BADGE = `<svg viewBox="0 0 64 64" style="position:absolute;left:50%;top:50%;width:64px;height:64px;margin:-32px 0 0 -32px;filter:drop-shadow(0 2px 6px rgba(0,0,0,.4))"><circle cx="32" cy="32" r="30" fill="rgba(15,23,42,.72)"/><path d="M26 20 L46 32 L26 44 Z" fill="#fff"/></svg>`;
const SPEAKER = `<svg viewBox="0 0 24 24" style="width:60%;height:60%" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H2v6h4l5 4V5z" fill="#fff"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M19 5a10 10 0 0 1 0 14"/></svg>`;

/** Video / audio: a still frame with a play badge in the editor and exports; the real player in the slide show. */
function mediaHtml(el: PlainElement, opts: RenderOptions): string {
  const m = el.media ?? {};
  const src = opts.resolveSrc ? opts.resolveSrc(el.src!) : el.src!;
  if (el.type === 'audio') {
    const icon = `<div style="width:100%;height:100%;border-radius:50%;background:#2563EB;display:flex;align-items:center;justify-content:center">${SPEAKER}</div>`;
    if (!opts.live) return icon;
    // The player sits under the icon; it starts on its own when "autoplay" is set, else on a click on the icon.
    return `${icon}<audio data-mo-media src="${esc(src)}${m.start || m.end ? `#t=${m.start ?? 0}${m.end ? `,${m.end}` : ''}` : ''}"${m.autoplay ? ' autoplay' : ''}${m.loop ? ' loop' : ''} preload="auto" style="position:absolute;left:0;top:100%;width:max(240px,100%);height:36px" controls></audio>`;
  }
  const yt = youtubeId(el.src);
  if (yt) {
    if (opts.live) {
      const q = new URLSearchParams({ rel: '0', modestbranding: '1', playsinline: '1' });
      if (m.start) q.set('start', String(Math.floor(m.start)));
      if (m.end) q.set('end', String(Math.floor(m.end)));
      if (m.autoplay) q.set('autoplay', '1');
      if (m.muted) q.set('mute', '1');
      if (m.loop) (q.set('loop', '1'), q.set('playlist', yt));
      return `<iframe data-mo-media src="https://www.youtube-nocookie.com/embed/${yt}?${esc(q.toString())}" style="width:100%;height:100%;border:0;display:block" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe>`;
    }
    return `<div style="width:100%;height:100%;background:#000 url('https://i.ytimg.com/vi/${yt}/hqdefault.jpg') center/cover no-repeat;position:relative">${PLAY_BADGE}</div>`;
  }
  const frag = m.start || m.end ? `#t=${m.start ?? 0}${m.end ? `,${m.end}` : ''}` : '#t=0.1';
  if (opts.live) {
    return `<video data-mo-media src="${esc(src)}${frag}" style="width:100%;height:100%;display:block;background:#000;object-fit:contain"${m.autoplay ? ' autoplay' : ''}${m.muted ? ' muted' : ''}${m.loop ? ' loop' : ''} playsinline controls preload="auto"></video>`;
  }
  return `<div style="width:100%;height:100%;background:#000;position:relative"><video src="${esc(src)}${frag}" muted preload="metadata" style="width:100%;height:100%;display:block;object-fit:contain"></video>${PLAY_BADGE}</div>`;
}

/** CSS filter for picture adjustments (brightness / contrast -100…100, recolour presets). */
export function imageFilter(s: ElementStyle): string {
  const parts: string[] = [];
  if (s.brightness) parts.push(`brightness(${f(1 + s.brightness / 100)})`);
  if (s.contrast) parts.push(`contrast(${f(1 + s.contrast / 100)})`);
  if (s.recolor === 'grayscale') parts.push('grayscale(1)');
  else if (s.recolor === 'sepia') parts.push('sepia(0.85)');
  else if (s.recolor === 'washout') parts.push('brightness(1.35) contrast(0.55) saturate(0.6)');
  return parts.length ? `;filter:${parts.join(' ')}` : '';
}

export const PLACEHOLDER_PROMPT: Record<string, string> = { title: 'Click to add title', subtitle: 'Click to add subtitle', body: 'Click to add text', body2: 'Click to add text' };

/** One slide as an absolutely-sized div (size.w × size.h px). */
export function slideHtml(slide: PlainSlide, deck: { size: DeckSize; theme: Theme; numbers?: SlideNumbers }, opts: RenderOptions = {}): string {
  const els = [...slide.elements].sort((a, b) => a.z - b.z || (a.id < b.id ? -1 : 1));
  const showNo = deck.numbers?.show && slide.no && !(deck.numbers.skipTitle && slide.meta.layout === 'title');
  const no = showNo
    ? `<div class="mo-slide-no" style="right:${f(deck.size.w * 0.035)}px;bottom:${f(deck.size.h * 0.04)}px;color:${esc(deck.theme.colors.muted)};font-family:${esc(fontStack(deck.theme.fonts.body))}" data-testid="slide-number">${slide.no}</div>`
    : '';
  return `<div class="mo-slide" style="width:${deck.size.w}px;height:${deck.size.h}px;${esc(backgroundCss(slide.meta.background, deck.theme, opts.resolveSrc))}">${els
    .map((e) => elementHtml(e, deck.theme, opts))
    .join('')}${no}</div>`;
}

/** Whole deck as a printable HTML page — one slide per page (PDF export, HTML export, PNG rendering). */
export function deckToHtmlDocument(deck: PlainDeck, opts: RenderOptions & { title?: string; includeHidden?: boolean; only?: number } = {}): string {
  const slides = deck.slides.filter((s, i) => (opts.only !== undefined ? i === opts.only : opts.includeHidden || !s.meta.hidden));
  const { w, h } = deck.size;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(opts.title ?? deck.name)}</title><style>
@page { size: ${w}px ${h}px; margin: 0; }
html, body { margin: 0; padding: 0; background: #fff; }
.page { width: ${w}px; height: ${h}px; overflow: hidden; break-after: page; }
.page:last-child { break-after: auto; }
${SLIDE_CSS}
</style></head><body>${slides.map((s) => `<section class="page">${slideHtml(s, deck, opts)}</section>`).join('')}</body></html>`;
}
