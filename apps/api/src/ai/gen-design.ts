// AI → designs, the Canva way (docs/ARCHITECTURE.md §80, docs/AI-PROMPTS.md): a small model is good at words and bad
// at placing boxes, so it only writes the COPY and picks a template and a palette; the templates below lay it out
// like the spa / beauty / shop templates on Canva (text block left, round "photo" composition right, a % badge, a
// pill call-to-action, a contact bar; business cards with a brand side and a details side). Everything stays
// editable text and shapes on slides.
import { newId, textDoc, type Background, type DeckSize, type ElementStyle, type Geometry, type PlainElement, type PlainSlide } from '@workos/slide-model';

// ── Palettes ────────────────────────────────────────────────────────────────

export interface Palette {
  id: string;
  label: string;
  /** Words in a request that point to it. */
  words: RegExp;
  bg: string;
  soft: string;
  primary: string;
  accent: string;
  text: string;
  /** Text on primary / accent fills. */
  on: string;
  dark?: boolean;
}

export const PALETTES: Palette[] = [
  { id: 'blush-gold', label: 'Blush & gold (beauty, spa)', words: /hồng|pink|rose|blush|gold|vàng|ピンク|spa|beauty|làm đẹp|thẩm mỹ|nail|salon/i, bg: '#FBEFF1', soft: '#F4D3DB', primary: '#8E3B5B', accent: '#C9A24A', text: '#5B3A44', on: '#FFFFFF' },
  { id: 'sage', label: 'Sage green (wellness, natural)', words: /xanh lá|xanh rêu|sage|green|olive|thiên nhiên|organic|natural|wellness|緑/i, bg: '#F1F3EC', soft: '#DCE3D2', primary: '#4F6146', accent: '#B89B6A', text: '#3E4A38', on: '#FFFFFF' },
  { id: 'mocha', label: 'Mocha & cream (coffee, warm, massage)', words: /nâu|brown|mocha|cà phê|coffee|kem|cream|beige|be |massage|茶/i, bg: '#F5EEE6', soft: '#E7D7C6', primary: '#6B4A35', accent: '#C4935E', text: '#4A372A', on: '#FFFFFF' },
  { id: 'navy-gold', label: 'Navy & gold (luxury, corporate)', words: /navy|xanh đậm|xanh than|sang trọng|luxury|premium|corporate|doanh nghiệp|紺/i, bg: '#0F2340', soft: '#1E3A63', primary: '#F3E3B5', accent: '#D4AF37', text: '#E8EDF5', on: '#0F2340', dark: true },
  { id: 'coral', label: 'Coral & sun (food, summer, sale)', words: /cam|orange|coral|đỏ|red|sale|food|đồ ăn|nhà hàng|restaurant|summer|hè/i, bg: '#FFF4EF', soft: '#FFD9CC', primary: '#D9534F', accent: '#F2A541', text: '#4B2E2A', on: '#FFFFFF' },
  { id: 'ocean', label: 'Ocean blue (clinic, tech, travel)', words: /xanh dương|blue|ocean|biển|clinic|phòng khám|nha khoa|dental|tech|công nghệ|travel|du lịch|青/i, bg: '#EEF6FB', soft: '#CFE6F3', primary: '#1F5F8B', accent: '#2BB3C0', text: '#23415A', on: '#FFFFFF' },
  { id: 'lavender', label: 'Lavender (gentle, feminine, events)', words: /tím|purple|lavender|violet|oải hương|wedding|cưới|event|sự kiện|紫/i, bg: '#F5F1FB', soft: '#E3D9F5', primary: '#5E4B8B', accent: '#C9A0DC', text: '#3F3557', on: '#FFFFFF' },
  { id: 'mono', label: 'Black & white (minimal, fashion)', words: /đen|black|trắng|white|minimal|tối giản|fashion|thời trang|mono/i, bg: '#FAFAFA', soft: '#E7E5E4', primary: '#18181B', accent: '#A8A29E', text: '#27272A', on: '#FFFFFF' },
];

/** The palette the model chose, else the first one the request's words point to, else blush & gold. */
export function pickPalette(id: string | undefined, request: string): Palette {
  const named = PALETTES.find((p) => p.id === id);
  // Colours named in the request win over the model's pick (small models ignore "pink and gold").
  const asked = PALETTES.find((p) => /hồng|pink|xanh|green|blue|nâu|brown|tím|purple|đen|black|cam|orange|đỏ|red|navy|gold|vàng/i.test(request) && p.words.test(request.match(/(hồng|pink|xanh lá|xanh rêu|xanh dương|xanh đậm|xanh than|green|blue|navy|nâu|brown|tím|purple|đen|black|cam|orange|đỏ|red)/i)?.[0] ?? '_'));
  return asked ?? named ?? PALETTES.find((p) => p.words.test(request)) ?? PALETTES[0];
}

const FONTS = { elegant: { heading: 'Georgia', body: 'Inter' }, modern: { heading: 'Inter', body: 'Inter' }, classic: { heading: 'Garamond', body: 'Georgia' } };
type FontKey = keyof typeof FONTS;

// ── Copy the model writes ───────────────────────────────────────────────────

export interface BannerCopy {
  template?: 'split' | 'center' | 'band';
  palette?: string;
  font?: FontKey;
  brand?: string;
  headline: string;
  /** The big figure: "30%", "-50%", "199K", "MỚI". */
  highlight?: string;
  /** A word above it: "Giảm", "Only", "Từ". */
  highlightLabel?: string;
  subhead?: string;
  benefits?: string[];
  cta?: string;
  phone?: string;
  website?: string;
  /** Date or condition: "Đến 31/10". */
  note?: string;
}
export interface CardCopy {
  template?: 'classic' | 'minimal' | 'band';
  palette?: string;
  font?: FontKey;
  name: string;
  title?: string;
  company?: string;
  tagline?: string;
  phone?: string;
  email?: string;
  address?: string;
  website?: string;
}

/** Strings are capped: Ollama turns maxLength into its grammar, so a model cannot loop on a phrase forever. */
const str = (n: number) => ({ type: 'string', maxLength: n });
export const BANNER_COPY_SCHEMA = {
  type: 'object',
  properties: {
    template: { type: 'string', enum: ['split', 'center', 'band'] },
    palette: { type: 'string', enum: PALETTES.map((p) => p.id) },
    font: { type: 'string', enum: ['elegant', 'modern', 'classic'] },
    brand: str(40),
    headline: str(70),
    highlight: str(10),
    highlightLabel: str(16),
    subhead: str(90),
    benefits: { type: 'array', items: str(28), maxItems: 4 },
    cta: str(26),
    phone: str(24),
    website: str(40),
    note: str(44),
  },
  required: ['headline', 'template', 'palette'],
};
export const CARD_COPY_SCHEMA = {
  type: 'object',
  properties: {
    template: { type: 'string', enum: ['classic', 'minimal', 'band'] },
    palette: { type: 'string', enum: PALETTES.map((p) => p.id) },
    font: { type: 'string', enum: ['elegant', 'modern', 'classic'] },
    name: str(40),
    title: str(40),
    company: str(40),
    tagline: str(50),
    phone: str(24),
    email: str(40),
    address: str(60),
    website: str(40),
  },
  required: ['name', 'template', 'palette'],
};

// ── Building blocks ─────────────────────────────────────────────────────────

let z = 0;
function text(x: number, y: number, w: number, h: number, value: string, st: ElementStyle & { italic?: boolean; name?: string }): PlainElement {
  const { italic, name, ...style } = st;
  return {
    id: newId(),
    type: 'text',
    x: Math.round(x),
    y: Math.round(y),
    w: Math.round(w),
    h: Math.round(h),
    z: ++z,
    name,
    text: textDoc(value.split('\n'), { align: style.align ?? 'left', ...(italic ? { marks: [{ type: 'italic' }] } : {}) }),
    style: { vAlign: 'middle', autofit: 'shrink', pad: 2, lineHeight: 1.15, ...style },
  };
}
function shape(geom: Geometry, x: number, y: number, w: number, h: number, style: ElementStyle, name?: string, value?: string, textStyle?: ElementStyle): PlainElement {
  return {
    id: newId(),
    type: 'shape',
    geom,
    x: Math.round(x),
    y: Math.round(y),
    w: Math.round(w),
    h: Math.round(h),
    z: ++z,
    name,
    style: { stroke: null, ...style, ...(textStyle ?? {}) },
    ...(value ? { text: textDoc(value.split('\n'), { align: textStyle?.align ?? 'center' }) } : {}),
  };
}
const slide = (bg: Background, elements: PlainElement[], notes = ''): PlainSlide => ({ id: newId(), meta: { layout: 'blank', background: bg }, notes, elements });
const clean = (v: unknown, max: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const initials = (s: string) =>
  s
    .replace(/\b(spa|salon|co|ltd|công ty|cty|the)\b/gi, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('') || 'NB';

// ── Banners ─────────────────────────────────────────────────────────────────

/** One page: wide sizes use split / band / center; square and tall sizes always stack in the centre. */
export function bannerSlides(raw: Partial<BannerCopy>, size: DeckSize, request: string): PlainSlide[] {
  z = 0;
  const pal = pickPalette(raw.palette, request);
  const f = FONTS[raw.font && FONTS[raw.font] ? raw.font : pal.dark || /sang trọng|luxury|spa|beauty|elegant/i.test(request) ? 'elegant' : 'modern'];
  const facts = factsOf(request);
  const c = {
    brand: clean(raw.brand, 40) || facts.brand,
    headline: clean(raw.headline, 70) || 'Ưu đãi đặc biệt',
    highlight: clean(raw.highlight, 8),
    highlightLabel: clean(raw.highlightLabel, 14),
    subhead: clean(raw.subhead, 90),
    benefits: (raw.benefits ?? []).map((b) => clean(b, 26)).filter(Boolean).slice(0, 4),
    cta: clean(raw.cta, 24) || 'Đặt lịch ngay',
    // Contact details come from the request itself — a model must never invent a phone number.
    phone: facts.phone,
    website: facts.website,
    note: dropInventedYears(clean(raw.note, 44), request)
      .split(/,\s*/)
      .filter((part) => !/hotline|điện thoại|phone|tel|\d{4}\s?\d{3}/i.test(part))
      .join(', '),
  };
  // A headline that only repeats the big figure ("Giảm 30%") says nothing: use the offer the request names.
  if (c.highlight && c.headline.replace(/\s/g, '').includes(c.highlight.replace(/\s/g, ''))) {
    const offer = /(khuyến mãi|ưu đãi|siêu sale|sale|promotion|special offer|キャンペーン)[^,.:;!]{0,40}/i
      .exec(request)?.[0]
      ?.split(/\s+(?:cho|for|tại|at|của|of)\s+/i)[0]
      .trim();
    if (offer) c.headline = offer.charAt(0).toUpperCase() + offer.slice(1);
  }
  const { w: W, h: H } = size;
  const wide = W >= H * 1.3;
  const tpl = !wide ? 'center' : raw.template === 'band' || raw.template === 'center' ? raw.template : 'split';
  const bg: Background = pal.dark ? { type: 'gradient', from: pal.bg, to: pal.soft, angle: 135 } : { type: 'gradient', from: '#FFFFFF', to: pal.bg, angle: 120 };
  const els: PlainElement[] = [];
  const u = Math.min(W, H); // unit for round things
  const pt = (k: number) => Math.max(6, Math.round(H * k)); // font sizes follow the canvas height
  // One line each, so a long address never wraps into the next.
  const contact = [c.phone && `☎  ${c.phone}`, c.website && `⊕  ${c.website}`].filter(Boolean).join('\n');

  if (tpl === 'split' || tpl === 'band') {
    const mx = W * 0.06;
    const colW = W * (tpl === 'band' ? 0.5 : 0.52);
    const left = tpl === 'band' ? W * 0.42 : mx;
    if (tpl === 'split') {
      // The round composition on the right: soft disc, gold ring, the "photo" circle, dots — Canva's spa banners.
      els.push(shape('ellipse', W - H * 0.95, -H * 0.18, H * 1.25, H * 1.25, { fill: pal.soft, opacity: 0.9 }, 'decor'));
      els.push(shape('ellipse', W - H * 0.8, H * 0.08, H * 0.86, H * 0.86, { fill: null, stroke: pal.accent, strokeWidth: Math.max(1.5, H * 0.004) }, 'decor ring'));
      els.push(shape('ellipse', W - H * 0.74, H * 0.14, H * 0.74, H * 0.74, { fill: pal.primary, opacity: 0.18 }, 'photo — replace with a picture'));
      els.push(shape('ellipse', W - H * 1.02, H * 0.78, H * 0.07, H * 0.07, { fill: pal.accent, opacity: 0.8 }, 'decor'));
      els.push(shape('ellipse', W - H * 0.18, H * 0.06, H * 0.05, H * 0.05, { fill: pal.accent, opacity: 0.6 }, 'decor'));
      if (c.highlight) {
        const d = H * 0.38;
        els.push(shape('ellipse', W - H * 1.0, H * 0.46, d, d, { fill: pal.accent, shadow: true }, 'badge'));
        if (c.highlightLabel) els.push(text(W - H * 1.0, H * 0.46 + d * 0.12, d, d * 0.2, c.highlightLabel, { fontSize: pt(0.032), color: pal.on, align: 'center', italic: true, fontFamily: f.heading, name: 'badge label' }));
        els.push(text(W - H * 1.0, H * 0.46 + d * 0.28, d, d * 0.48, c.highlight, { fontSize: pt(0.1), bold: true, color: pal.on, align: 'center', fontFamily: f.heading, name: 'highlight' }));
      }
    } else {
      // Band: a coloured column on the left with the big figure.
      els.push(shape('rect', 0, 0, W * 0.36, H, { fill: pal.primary }, 'band'));
      els.push(shape('ellipse', W * 0.36 - H * 0.2, H * 0.62, H * 0.4, H * 0.4, { fill: pal.accent, opacity: 0.35 }, 'decor'));
      if (c.highlightLabel) els.push(text(W * 0.04, H * 0.18, W * 0.28, H * 0.1, c.highlightLabel, { fontSize: pt(0.05), color: pal.on, italic: true, fontFamily: f.heading, name: 'badge label' }));
      els.push(text(W * 0.04, H * 0.28, W * 0.3, H * 0.32, c.highlight || c.headline.split(' ').slice(0, 2).join(' '), { fontSize: pt(c.highlight ? 0.2 : 0.1), bold: true, color: pal.on, fontFamily: f.heading, name: 'highlight' }));
      if (c.note) els.push(text(W * 0.04, H * 0.64, W * 0.28, H * 0.08, c.note, { fontSize: pt(0.032), color: pal.on, name: 'note' }));
    }
    let y = H * 0.09;
    if (c.brand) {
      els.push(text(left, y, colW, H * 0.06, c.brand.toUpperCase(), { fontSize: pt(0.028), bold: true, color: pal.accent, fontFamily: f.body, name: 'brand' }));
      y += H * 0.08;
    }
    els.push(text(left, y, colW, H * 0.3, c.headline, { fontSize: pt(0.085), bold: true, color: pal.dark ? pal.primary : pal.primary, fontFamily: f.heading, vAlign: 'top', name: 'headline' }));
    y += H * 0.31;
    if (c.subhead) {
      els.push(text(left, y, colW, H * 0.09, c.subhead, { fontSize: pt(0.036), color: pal.text, fontFamily: f.body, vAlign: 'top', name: 'subhead' }));
      y += H * 0.1;
    }
    if (c.benefits.length) {
      els.push(text(left, y, colW, H * 0.07, c.benefits.map((b) => `✓ ${b}`).join('    '), { fontSize: pt(0.026), color: pal.text, fontFamily: f.body, name: 'benefits' }));
      y += H * 0.09;
    }
    const by = Math.max(y + H * 0.02, H * 0.72);
    const bw = Math.min(colW * 0.42, W * 0.22);
    els.push(shape('roundRect', left, by, bw, H * 0.11, { fill: pal.primary === pal.on ? pal.accent : pal.dark ? pal.accent : pal.primary, radius: H * 0.055, shadow: true }, 'cta', c.cta.toUpperCase(), { fontSize: pt(0.03), bold: true, color: pal.dark ? pal.on : '#FFFFFF', align: 'center', vAlign: 'middle' }));
    if (contact) els.push(text(left + bw + W * 0.02, by, colW - bw - W * 0.02, H * 0.11, contact, { fontSize: pt(0.028), bold: true, color: pal.text, fontFamily: f.body, name: 'contact' }));
    if (c.note && tpl === 'split') els.push(text(left, by + H * 0.13, colW, H * 0.06, c.note, { fontSize: pt(0.024), color: pal.text, italic: true, fontFamily: f.body, name: 'note' }));
  } else {
    // Centre: square post, story, poster.
    const cw = W * 0.84;
    const x0 = (W - cw) / 2;
    els.push(shape('ellipse', -u * 0.25, -u * 0.25, u * 0.7, u * 0.7, { fill: pal.soft, opacity: 0.9 }, 'decor'));
    els.push(shape('ellipse', W - u * 0.42, H - u * 0.42, u * 0.6, u * 0.6, { fill: pal.soft, opacity: 0.9 }, 'decor'));
    els.push(shape('ellipse', W - u * 0.3, u * 0.08, u * 0.12, u * 0.12, { fill: pal.accent, opacity: 0.7 }, 'decor'));
    let y = H * 0.07;
    if (c.brand) {
      els.push(text(x0, y, cw, H * 0.05, c.brand.toUpperCase(), { fontSize: pt(0.024), bold: true, color: pal.accent, align: 'center', name: 'brand' }));
      y += H * 0.07;
    }
    els.push(text(x0, y, cw, H * 0.2, c.headline, { fontSize: pt(0.06), bold: true, color: pal.primary, align: 'center', fontFamily: f.heading, name: 'headline' }));
    y += H * 0.22;
    if (c.highlight) {
      const d = Math.min(W * 0.46, H * 0.3);
      els.push(shape('ellipse', (W - d) / 2, y, d, d, { fill: pal.accent, shadow: true }, 'badge'));
      if (c.highlightLabel) els.push(text((W - d) / 2, y + d * 0.13, d, d * 0.18, c.highlightLabel, { fontSize: pt(0.03), color: pal.on, italic: true, align: 'center', fontFamily: f.heading }));
      els.push(text((W - d) / 2, y + d * 0.28, d, d * 0.46, c.highlight, { fontSize: pt(0.085), bold: true, color: pal.on, align: 'center', fontFamily: f.heading, name: 'highlight' }));
      y += d + H * 0.03;
    }
    if (c.subhead) {
      els.push(text(x0, y, cw, H * 0.08, c.subhead, { fontSize: pt(0.03), color: pal.text, align: 'center', name: 'subhead' }));
      y += H * 0.09;
    }
    if (c.benefits.length) {
      els.push(text(x0, y, cw, H * 0.06, c.benefits.map((b) => `✓ ${b}`).join('   '), { fontSize: pt(0.022), color: pal.text, align: 'center', name: 'benefits' }));
      y += H * 0.07;
    }
    const bw = Math.min(W * 0.5, cw);
    els.push(shape('roundRect', (W - bw) / 2, Math.max(y, H * 0.76), bw, H * 0.075, { fill: pal.primary, radius: H * 0.0375, shadow: true }, 'cta', c.cta.toUpperCase(), { fontSize: pt(0.026), bold: true, color: pal.dark ? pal.on : '#FFFFFF', align: 'center', vAlign: 'middle' }));
    if (contact) els.push(text(x0, H * 0.87, cw, H * 0.05, contact, { fontSize: pt(0.022), bold: true, color: pal.text, align: 'center', name: 'contact' }));
    if (c.note) els.push(text(x0, H * 0.92, cw, H * 0.04, c.note, { fontSize: pt(0.018), italic: true, color: pal.text, align: 'center', name: 'note' }));
  }
  return [slide(bg, els, `Template: ${tpl} · palette: ${pal.label}. Replace the round "photo" shape with a picture (Insert → Image).`)];
}

// ── Business cards ──────────────────────────────────────────────────────────

/** Two pages: 1 = brand side, 2 = details side. */
export function cardSlides(raw: Partial<CardCopy>, size: DeckSize, request: string): PlainSlide[] {
  z = 0;
  const pal = pickPalette(raw.palette, request);
  const f = FONTS[raw.font && FONTS[raw.font] ? raw.font : 'elegant'];
  const facts = factsOf(request);
  // Words a model tacked onto a contact ("sakurabeauty.example · Sáng tạo · Tinh tế") are a tagline.
  const spill = [raw.website, raw.email, raw.phone].map((v) => String(v ?? '').split('·').slice(1).map((x) => x.trim()).filter(Boolean)).find((x) => x.length >= 2);
  const c = {
    name: grounded(clean(raw.name, 40), facts.person) || 'Your Name',
    title: clean(raw.title, 40),
    company: clean(raw.company, 40) || facts.brand,
    tagline: clean(raw.tagline, 50) || (spill ? spill.slice(0, 3).join(' · ') : ''),
    phone: facts.phone,
    email: facts.email,
    address: grounded(clean(raw.address, 60).split('·')[0].trim(), facts.address),
    website: facts.website,
  };
  const tpl = raw.template === 'minimal' || raw.template === 'band' ? raw.template : 'classic';
  const { w: W, h: H } = size;
  const pt = (k: number) => Math.max(5, Math.round(H * k * 10) / 10);
  const mono = initials(c.company || c.name);
  const lines = [
    c.phone && { icon: '☎', text: c.phone },
    c.email && { icon: '✉', text: c.email },
    c.address && { icon: '⌂', text: c.address },
    c.website && { icon: '⊕', text: c.website },
  ].filter(Boolean) as { icon: string; text: string }[];

  // Brand side: the logo mark, the company, the tagline.
  const front: PlainElement[] = [];
  const brandBg: Background = tpl === 'minimal' ? { type: 'solid', color: pal.bg } : { type: 'gradient', from: pal.dark ? pal.bg : pal.primary, to: pal.dark ? pal.soft : shade(pal.primary), angle: 135 };
  const ink = tpl === 'minimal' ? pal.primary : pal.dark ? pal.primary : '#FFFFFF';
  const d = H * 0.34;
  front.push(shape('ellipse', (W - d) / 2, H * 0.14, d, d, { fill: null, stroke: pal.accent, strokeWidth: Math.max(1, H * 0.008) }, 'logo ring'));
  front.push(text((W - d) / 2, H * 0.14, d, d, mono, { fontSize: pt(0.13), bold: true, color: pal.accent, align: 'center', fontFamily: f.heading, name: 'logo' }));
  front.push(text(W * 0.08, H * 0.54, W * 0.84, H * 0.14, (c.company || c.name).toUpperCase(), { fontSize: pt(0.075), bold: true, color: ink, align: 'center', fontFamily: f.heading, name: 'company' }));
  front.push(shape('line', W * 0.38, H * 0.71, W * 0.24, 1, { stroke: pal.accent, strokeWidth: 1, fill: null }, 'rule'));
  if (c.tagline) front.push(text(W * 0.08, H * 0.74, W * 0.84, H * 0.1, c.tagline.toUpperCase(), { fontSize: pt(0.04), color: tpl === 'minimal' ? pal.text : pal.dark ? pal.text : '#FFFFFF', align: 'center', name: 'tagline' }));

  // Details side.
  const back: PlainElement[] = [];
  const m = W * 0.08;
  if (tpl === 'band') back.push(shape('rect', 0, 0, W * 0.06, H, { fill: pal.primary }, 'band'));
  if (tpl === 'classic') {
    back.push(shape('ellipse', W - H * 0.42, -H * 0.2, H * 0.6, H * 0.6, { fill: pal.soft, opacity: 0.9 }, 'decor'));
    back.push(text(W - H * 0.3, H * 0.06, H * 0.24, H * 0.2, mono, { fontSize: pt(0.08), bold: true, color: pal.accent, align: 'center', fontFamily: f.heading, name: 'logo' }));
  }
  const nx = tpl === 'band' ? W * 0.12 : m;
  back.push(text(nx, H * 0.1, W * 0.62, H * 0.18, c.name, { fontSize: pt(0.1), bold: true, color: pal.dark ? pal.primary : pal.primary, fontFamily: f.heading, name: 'name' }));
  if (c.title) back.push(text(nx, H * 0.28, W * 0.62, H * 0.09, c.title.toUpperCase(), { fontSize: pt(0.042), color: pal.accent, bold: true, name: 'title' }));
  if (tpl === 'minimal') back.push(shape('line', W * 0.62, H * 0.12, 1, H * 0.76, { stroke: pal.accent, strokeWidth: 1, fill: null }, 'divider'));
  else back.push(shape('line', nx, H * 0.4, W * 0.2, 1, { stroke: pal.accent, strokeWidth: 1, fill: null }, 'rule'));
  const top = H * 0.46;
  const step = Math.min(H * 0.105, (H * 0.48) / Math.max(1, lines.length));
  lines.forEach((l, i) => {
    const y = top + i * step;
    const r = step * 0.78;
    back.push(shape('ellipse', nx, y + (step - r) / 2, r, r, { fill: pal.soft }, 'icon', l.icon, { fontSize: pt(0.034), color: pal.primary, align: 'center', vAlign: 'middle' }));
    back.push(text(nx + r + W * 0.025, y, W * (tpl === 'minimal' ? 0.46 : 0.78) - r, step, l.text, { fontSize: pt(0.042), color: pal.text, name: 'contact' }));
  });
  if (tpl === 'minimal' && c.company) back.push(text(W * 0.65, H * 0.12, W * 0.3, H * 0.3, c.company, { fontSize: pt(0.05), color: pal.primary, fontFamily: f.heading, vAlign: 'top', name: 'company' }));
  const backBg: Background = { type: 'solid', color: pal.bg };
  return [slide(brandBg, front, `Brand side · template ${tpl} · ${pal.label}`), slide(backBg, back, 'Details side')];
}

/**
 * A picture from the image AI becomes the slide's background (§81): the template's drawn decoration and the photo
 * placeholder step aside, and a soft panel keeps the text readable on any picture. Text, badge and button stay.
 */
export function adaptForPicture(slide: PlainSlide, size: DeckSize, src: string, card: boolean) {
  slide.meta = { ...slide.meta, background: { type: 'image', src } };
  slide.elements = slide.elements.filter((e) => !/^(decor|photo|band|logo ring)/.test(e.name ?? ''));
  const texts = slide.elements.filter((e) => e.type === 'text' || (e.type === 'shape' && e.text));
  if (!texts.length) return;
  const x1 = Math.min(...texts.map((e) => e.x));
  const y1 = Math.min(...texts.map((e) => e.y));
  const x2 = Math.max(...texts.map((e) => e.x + e.w));
  const y2 = Math.max(...texts.map((e) => e.y + e.h));
  const pad = Math.min(size.w, size.h) * 0.04;
  const panel: PlainElement = {
    id: newId(),
    type: 'shape',
    geom: 'roundRect',
    x: Math.round(Math.max(0, x1 - pad)),
    y: Math.round(Math.max(0, y1 - pad)),
    w: Math.round(Math.min(size.w, x2 + pad) - Math.max(0, x1 - pad)),
    h: Math.round(Math.min(size.h, y2 + pad) - Math.max(0, y1 - pad)),
    z: 0,
    name: 'text panel',
    style: { fill: '#FFFFFF', stroke: null, opacity: card ? 0.55 : 0.72, radius: Math.min(size.w, size.h) * 0.04 },
  };
  // Light text on a picture reads badly through a white panel: make it dark.
  for (const e of texts) if (e.type === 'text' && e.style?.color && /^#F/i.test(e.style.color)) e.style = { ...e.style, color: '#1F2937' };
  slide.elements.unshift(panel);
}

/** Contact details and the business name, read from the request itself (a model must not make them up). */
export function factsOf(request: string) {
  const emails = request.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g) ?? [];
  const noMail = request.replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, ' ');
  const phone = (noMail.match(/(?:\+\d{1,3}[\s.-]?)?\(?0?\d{2,4}\)?[\s.-]?\d{3,4}[\s.-]?\d{3,4}\b/g) ?? []).map((p) => p.trim()).find((p) => p.replace(/\D/g, '').length >= 9) ?? '';
  const website = (noMail.match(/\b(?:https?:\/\/)?(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:vn|com|net|org|jp|io|co|asia|shop|store|biz|info|me|app)(?:\/[^\s,;]*)?/gi) ?? [])[0] ?? '';
  // "… cho Sakura Beauty Spa", "for Lotus Clinic": a run of capitalised words.
  const runs = (request.match(/\b(?:[A-Z][\p{L}&'’-]+)(?:\s+[A-Z][\p{L}&'’-]+){1,4}/gu) ?? []).filter((b) => !/^(Banner|Card|Phong|Website|Email|Hotline|Quản|Giám|Trưởng)\b/.test(b));
  // A run with a business word is the company; a person's name is not.
  const brand = runs.find((b) => /\b(Spa|Salon|Clinic|Beauty|Studio|Shop|Store|Café|Cafe|Coffee|Hotel|Restaurant|Company|Ltd|Group|Center|Centre|Academy|Nail|Dental|Food|Bakery|Boutique)\b/i.test(b)) ?? runs.find((b) => !/^(Nguyễn|Trần|Lê|Phạm|Hoàng|Huỳnh|Phan|Vũ|Võ|Đặng|Bùi|Đỗ|Hồ|Ngô|Dương|Lý)\b/.test(b)) ?? '';
  // "địa chỉ 12 Lê Lợi, Quận 1, TP.HCM, website …" → up to the next labelled detail.
  const address = /(?:địa chỉ|address|住所)\s*:?\s*(.+?)(?=,?\s*(?:website|web|email|e-mail|điện thoại|đt|sđt|hotline|phone|tel|phong cách|màu|style)\b|[;]|\.\s|$)/i.exec(request)?.[1]?.trim().replace(/[.,]$/, '') ?? '';
  const person = runs.find((b) => /^(Nguyễn|Trần|Lê|Phạm|Hoàng|Huỳnh|Phan|Vũ|Võ|Đặng|Bùi|Đỗ|Hồ|Ngô|Dương|Lý)\b/.test(b)) ?? '';
  return { phone, email: emails[0] ?? '', website: website.replace(/^https?:\/\//, ''), brand, address, person };
}

/** What a model wrote, unless the request says it differently (a typo in a name or an address is worse than none). */
export function grounded(value: string, fact: string) {
  if (!fact) return value;
  const norm = (s: string) => s.normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();
  return value && norm(fact).includes(norm(value)) ? value : fact;
}

/** "Đến 31/10/2023" when the request said "đến 31/10": drop a year the request never mentioned. */
export function dropInventedYears(text: string, request: string) {
  return text
    .replace(/(\d{1,2}[/.-]\d{1,2})[/.-](\d{4})/g, (m, d: string, y: string) => (request.includes(y) ? m : d))
    .replace(/\b(19|20)\d{2}\b/g, (y) => (request.includes(y) ? y : ''))
    .replace(/,\s*(áp dụng|apply)\s*hotline\s*$/i, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** A slightly darker shade for gradients. */
function shade(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number) => Math.max(0, Math.round(v * 0.78));
  return `#${[(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => f(v).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

// ── Magic resize ────────────────────────────────────────────────────────────

/**
 * A slide laid out again for another format (Canva's "Resize"): every element keeps its place relative to the page
 * centre-to-centre, scaled by the smaller of the two ratios so nothing is stretched; fonts follow. A picture that
 * fills the page keeps filling it (cropped like CSS cover); the background picture is already drawn "cover".
 */
export function resizeSlide(slide: PlainSlide, from: DeckSize, to: DeckSize): PlainSlide {
  const sx = to.w / from.w;
  const sy = to.h / from.h;
  const s = Math.min(sx, sy);
  const round = (n: number) => Math.round(n * 10) / 10;
  const elements = slide.elements.map((e): PlainElement => {
    const full = e.type === 'image' && e.x <= from.w * 0.03 && e.y <= from.h * 0.03 && e.x + e.w >= from.w * 0.97 && e.y + e.h >= from.h * 0.97;
    if (full) {
      // Crop the picture to the new page's shape instead of squashing it.
      const crop = { l: e.crop?.l ?? 0, t: e.crop?.t ?? 0, r: e.crop?.r ?? 0, b: e.crop?.b ?? 0 };
      const was = e.w / e.h;
      const now = to.w / to.h;
      if (now > was) {
        const vh = 1 - crop.t - crop.b;
        const cut = (vh * (1 - was / now)) / 2;
        crop.t += cut;
        crop.b += cut;
      } else if (now < was) {
        const vw = 1 - crop.l - crop.r;
        const cut = (vw * (1 - now / was)) / 2;
        crop.l += cut;
        crop.r += cut;
      }
      return { ...e, x: 0, y: 0, w: to.w, h: to.h, crop };
    }
    const w = e.w * s;
    const h = e.h * s;
    const cx = (e.x + e.w / 2) * sx;
    const cy = (e.y + e.h / 2) * sy;
    const x = Math.min(Math.max(cx - w / 2, 0), Math.max(0, to.w - w));
    const y = Math.min(Math.max(cy - h / 2, 0), Math.max(0, to.h - h));
    const style: ElementStyle | undefined = e.style && {
      ...e.style,
      ...(e.style.fontSize ? { fontSize: Math.max(4, round(e.style.fontSize * s)) } : {}),
      ...(e.style.strokeWidth ? { strokeWidth: round(e.style.strokeWidth * s) } : {}),
      ...(e.style.radius ? { radius: round(e.style.radius * s) } : {}),
    };
    return {
      ...e,
      x: Math.round(x),
      y: Math.round(y),
      w: Math.round(w),
      h: Math.round(h),
      ...(style ? { style } : {}),
      ...(e.table?.fontSize ? { table: { ...e.table, fontSize: Math.max(4, round(e.table.fontSize * s)) } } : {}),
    };
  });
  return { ...slide, id: newId(), elements };
}

/**
 * The whole slide scaled into another format without moving anything relative to anything else (for designs built on
 * a picture, whose text sits on the picture's own decorations): one scale, centred; the caller fills the margins.
 */
export function fitSlide(slide: PlainSlide, from: DeckSize, to: DeckSize): { slide: PlainSlide; frame: { x: number; y: number; w: number; h: number } } {
  const k = Math.min(to.w / from.w, to.h / from.h);
  const ox = (to.w - from.w * k) / 2;
  const oy = (to.h - from.h * k) / 2;
  const round = (n: number) => Math.round(n * 10) / 10;
  const elements = slide.elements.map((e): PlainElement => ({
    ...e,
    x: Math.round(ox + e.x * k),
    y: Math.round(oy + e.y * k),
    w: Math.round(e.w * k),
    h: Math.round(e.h * k),
    ...(e.style
      ? {
          style: {
            ...e.style,
            ...(e.style.fontSize ? { fontSize: Math.max(4, round(e.style.fontSize * k)) } : {}),
            ...(e.style.strokeWidth ? { strokeWidth: round(e.style.strokeWidth * k) } : {}),
            ...(e.style.radius ? { radius: round(e.style.radius * k) } : {}),
          },
        }
      : {}),
    ...(e.table?.fontSize ? { table: { ...e.table, fontSize: Math.max(4, round(e.table.fontSize * k)) } } : {}),
  }));
  return { slide: { ...slide, id: newId(), elements }, frame: { x: Math.round(ox), y: Math.round(oy), w: Math.round(from.w * k), h: Math.round(from.h * k) } };
}
