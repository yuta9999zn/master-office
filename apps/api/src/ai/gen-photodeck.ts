// AI → a presentation built on pictures (docs/ARCHITECTURE.md §82). The local model is the editor-in-chief: it plans
// the deck (which slide is a picture alone, a picture with a caption, words, or figures) and writes, for every picture,
// the prompt an image AI (ChatGPT, Gemini…) paints it from. Code lays the slides out; pictures come in later — pasted
// from ChatGPT — into the "picture slots", and picture-only slides stay free for people to finish by hand.
import { newId, newSlide, textDoc, type DeckSize, type PlainElement, type PlainSlide, type Theme } from '@workos/slide-model';

export type PhotoKind = 'cover' | 'section' | 'photo' | 'caption' | 'text' | 'data' | 'end';
export const PHOTO_KINDS: PhotoKind[] = ['cover', 'section', 'photo', 'caption', 'text', 'data', 'end'];
/** Kinds that carry a picture (and so an image prompt). */
export const PICTURE_KINDS: PhotoKind[] = ['cover', 'section', 'photo', 'caption', 'end'];

/** Step 1 — the plan: title, theme, and per slide its kind and heading. Short keys: tokens cost time on a CPU. */
export interface PhotoPlan {
  t: string;
  s: { k: PhotoKind; h: string; p?: string }[];
  /** The place or subject of the deck ("Hạ Long") — every picture prompt names it. */
  place?: string;
}
export const PHOTO_PLAN_SCHEMA = {
  type: 'object',
  properties: {
    t: { type: 'string', maxLength: 90 },
    s: { type: 'array', maxItems: 40, items: { type: 'object', properties: { k: { type: 'string', enum: PHOTO_KINDS }, h: { type: 'string', minLength: 4, maxLength: 70 } }, required: ['k', 'h'] } },
  },
  required: ['t', 's'],
};

/** Step 2 — details of a few slides: bullets, caption, figures, the picture prompt, a source hint. */
export interface PhotoDetail {
  i: number;
  b?: string[];
  c?: string;
  d?: { l: string; v: number }[];
  u?: string;
  img?: string;
  src?: string;
}
export const PHOTO_DETAIL_SCHEMA = {
  type: 'object',
  properties: {
    s: {
      type: 'array',
      maxItems: 10,
      items: {
        type: 'object',
        properties: {
          i: { type: 'integer' },
          b: { type: 'array', maxItems: 5, items: { type: 'string', maxLength: 90 } },
          c: { type: 'string', maxLength: 90 },
          d: { type: 'array', maxItems: 6, items: { type: 'object', properties: { l: { type: 'string', maxLength: 30 }, v: { type: 'number' } }, required: ['l', 'v'] } },
          u: { type: 'string', maxLength: 20 },
          img: { type: 'string', maxLength: 400 },
          src: { type: 'string', maxLength: 80 },
        },
        required: ['i'],
      },
    },
  },
  required: ['s'],
};

/**
 * The rules a small model breaks, applied in code (measured with qwen2.5:3b on "Hạ Long, 30 slides": it repeats one
 * pattern, leaves headings empty, puts "thank you" in the middle and gives figures to a rice wine):
 * - a picture slide with no heading shows the previous subject again; a text / data slide with no heading goes;
 * - "end" only last, "cover" only first; the same heading twice in a row goes;
 * - figures on at most one slide in eight (at least 2): the others become text;
 * - never two text slides in a row: the second becomes a picture with a caption.
 */
export function cleanPhotoPlan(raw: Partial<PhotoPlan>, want: number | null, cleanCjk = false): { plan: PhotoPlan; fixes: string[] } {
  const fixes: string[] = [];
  const note = (m: string) => fixes.includes(m) || fixes.push(m);
  const out: { k: PhotoKind; h: string }[] = [];
  let subject = '';
  for (const x of Array.isArray(raw.s) ? raw.s : []) {
    if (!x || typeof x !== 'object') continue;
    let k: PhotoKind = PHOTO_KINDS.includes(x.k) ? x.k : 'text';
    let h = String(x.h ?? '').split('\n')[0].trim().slice(0, 70);
    if (cleanCjk) h = h.replace(/[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]+/g, '').replace(/\s{2,}/g, ' ').trim();
    if (!h) {
      if (!PICTURE_KINDS.includes(k) || !subject) {
        note('Slides without a heading left out');
        continue;
      }
      h = subject;
      note('Picture slides without a heading show the subject before them');
    }
    if (out.length && out[out.length - 1].h === h && out[out.length - 1].k === k) continue;
    // A heading is a few words, not a sentence (small models write "Sau khi mua vé, hãy đi bộ 10 phút…").
    const words = h.split(/\s+/);
    if (words.length > 9 && k !== 'cover' && k !== 'section') (h = words.slice(0, 7).join(' ').replace(/[,.;:]+$/, '')), note('Long headings shortened');
    out.push({ k, h, ...(x.p ? { p: x.p } : {}) });
    if (k !== 'end') subject = h;
  }
  if (!out.length) throw new Error('The model planned no slides');
  // "end" only last: the others were a thank-you in the middle.
  const ends = out.filter((x) => x.k === 'end');
  const s = out.filter((x) => x.k !== 'end');
  if (ends.length > 1 || (ends.length === 1 && out[out.length - 1].k !== 'end')) note('“Thank you” moved to the end');
  s.push(ends[0] ?? { k: 'end', h: 'Cảm ơn' });
  if (s[0].k !== 'cover') (s[0] = { ...s[0], k: 'cover' }), note('First slide made the cover');
  s.forEach((x, i) => i > 0 && x.k === 'cover' && (x.k = 'section'));
  let data = 0;
  const maxData = Math.max(2, Math.round(s.length / 8));
  for (const [i, x] of s.entries()) {
    if (x.k === 'data' && ++data > maxData) (x.k = 'text'), note(`At most ${maxData} slides of figures`);
    if (x.k === 'text' && s[i - 1]?.k === 'text') (x.k = 'caption'), note('No two text slides in a row');
  }
  let list = s;
  if (want && list.length > want) {
    note(`Trimmed to ${want} slides`);
    list = [...list.slice(0, want - 1), list[list.length - 1]];
  }
  if (want && list.length < want) note(`${list.length} of ${want} slides kept`);
  return { plan: { t: String(raw.t ?? list[0].h).slice(0, 90), s: list, ...(raw.place ? { place: raw.place } : {}) }, fixes };
}

// ── Parts: a 3B model plans 4–6 slides of one part well, 30 slides at once badly ──

export interface DeckPart {
  name: string;
  items: string[];
}
export const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const cap = capitalize;

/**
 * The parts a request names: "… về Hạ Long: vịnh và các hang động, đảo, các hoạt động (du thuyền, chèo kayak), ẩm
 * thực (chả mực, sá sùng), mua sắm. …" → title "Giới thiệu về Hạ Long", parts with their items. Null without a list.
 */
export function partsOfRequest(request: string): { title: string; parts: DeckPart[] } | null {
  const colon = request.indexOf(':');
  if (colon < 0) return null;
  // The list runs to the end of the sentence (a full stop outside parentheses).
  let body = '';
  let depth = 0;
  for (const ch of request.slice(colon + 1)) {
    if (ch === '(') depth++;
    if (ch === ')') depth = Math.max(0, depth - 1);
    if ((ch === '.' || ch === '\n') && depth === 0) break;
    body += ch;
  }
  const chunks: string[] = [];
  let cur = '';
  depth = 0;
  for (const ch of body) {
    if (ch === '(') depth++;
    if (ch === ')') depth = Math.max(0, depth - 1);
    if ((ch === ',' || ch === ';') && depth === 0) (chunks.push(cur), (cur = ''));
    else cur += ch;
  }
  chunks.push(cur);
  const parts = chunks
    .map((c) => c.trim())
    .filter(Boolean)
    .map((c) => {
      const m = /^(.*?)\s*\((.*)\)\s*$/s.exec(c);
      return { name: cap((m ? m[1] : c).trim()), items: m ? m[2].split(/[,;]/).map((x) => x.trim()).filter(Boolean) : [] };
    })
    .filter((p) => p.name.length >= 2);
  if (parts.length < 2) return null;
  const title = cap(
    request
      .slice(0, colon)
      .replace(/^\s*(?:hãy\s+)?(?:làm|tạo|viết|soạn|make|create|write)?\s*(?:cho tôi\s+)?(?:một|1|a)?\s*(?:bộ|bài)?\s*(?:slides?|trình chiếu|thuyết trình|presentation|deck)?\s*(?:\d{1,2}\s*(?:trang|slides?|pages?))?\s*/i, '')
      .trim(),
  );
  return { title: title || parts[0].name, parts };
}

/** Slides per part: the inner slides (all but cover and end) shared by weight (items count), at least 2 each. */
export function partBudget(parts: DeckPart[], total: number): number[] {
  const inner = Math.max(parts.length * 2, total - 2);
  const w = parts.map((p) => 2 + p.items.length * 0.7);
  const sum = w.reduce((a, b) => a + b, 0);
  const raw = w.map((x) => (x / sum) * inner);
  const n = raw.map((x) => Math.max(2, Math.floor(x)));
  let left = inner - n.reduce((a, b) => a + b, 0);
  const order = raw.map((x, i) => [x - Math.floor(x), i] as const).sort((a, b) => b[0] - a[0]);
  for (let k = 0; left > 0; k = (k + 1) % order.length, left--) n[order[k][1]]++;
  for (let k = n.length - 1; left < 0 && k >= 0; k--) while (left < 0 && n[k] > 2) (n[k]--, left++);
  return n;
}

/** The slides of one part: exactly `count`, inner kinds only (cover / end are the deck's). */
export function partSchema(count: number) {
  return {
    type: 'object',
    properties: { s: { type: 'array', minItems: count, maxItems: count, items: { type: 'object', properties: { k: { type: 'string', enum: ['photo', 'caption', 'text', 'data'] }, h: { type: 'string', minLength: 4, maxLength: 70 } }, required: ['k', 'h'] } } },
    required: ['s'],
  };
}
export const PARTS_SCHEMA = {
  type: 'object',
  properties: { t: { type: 'string', maxLength: 90 }, p: { type: 'array', minItems: 4, maxItems: 8, items: { type: 'object', properties: { n: { type: 'string', maxLength: 60 }, i: { type: 'array', maxItems: 6, items: { type: 'string', maxLength: 40 } } }, required: ['n'] } } },
  required: ['t', 'p'],
};

/** The plan as the detail step reads it: "3 · photo · Vịnh Hạ Long lúc bình minh". */
export const photoPlanText = (p: PhotoPlan) => p.s.map((x, i) => `${i + 1} · ${x.k} · ${x.h}`).join('\n');

/** How many slides the request asks for ("30 trang", "20 slides", "12 slide"). */
export function slideCountOf(request: string): number | null {
  const m = /(\d{1,2})\s*(?:trang|slides?|pages?|枚|ページ)/i.exec(request);
  const n = m ? Number(m[1]) : NaN;
  return n >= 3 && n <= 40 ? n : null;
}

/**
 * Figures worth a chart: at least two, labels that say something, and not the small integers a model writes when it
 * has no idea (1, 2, 3 for "how many ways to get there").
 */
export function plausibleFigures(data: { l: string; v: number }[]): boolean {
  if (data.length < 2) return false;
  // "c1", "2" are not labels; a year ("2019") is.
  if (data.some((x) => /^([a-z]\d{1,2}|\d{1,2})$/i.test(String(x.l).trim()) || String(x.l).trim().length < 2)) return false;
  const v = data.map((x) => Number(x.v));
  if (v.every((x) => Number.isInteger(x) && x >= 0 && x <= 5)) return false;
  return new Set(v).size > 1;
}

// ── Layout ──────────────────────────────────────────────────────────────────

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
/** The empty picture: what to paint, and that it comes from an image AI. Replaced when a picture is put in. */
export function slotPicture(n: number, size: DeckSize, prompt: string): string {
  const words = prompt.split(/\s+/).slice(0, 26).join(' ');
  const lines = words.match(/.{1,70}(\s|$)/g) ?? [words];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size.w}" height="${size.h}" viewBox="0 0 ${size.w} ${size.h}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e2e8f0"/><stop offset="1" stop-color="#cbd5e1"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><g fill="none" stroke="#94a3b8" stroke-width="6" transform="translate(${size.w / 2 - 60} ${size.h / 2 - 150})"><rect x="0" y="20" width="120" height="86" rx="14"/><circle cx="60" cy="63" r="24"/><path d="M38 20 l10 -16 h24 l10 16"/></g><text x="50%" y="${size.h / 2 - 10}" text-anchor="middle" font-family="Arial" font-size="30" font-weight="bold" fill="#475569">Ảnh cho slide ${n}</text><text x="50%" y="${size.h / 2 + 30}" text-anchor="middle" font-family="Arial" font-size="20" fill="#64748b">Tạo bằng ChatGPT / Gemini với prompt bên dưới, rồi AI → “Put pictures into the slots”</text>${lines
    .slice(0, 3)
    .map((l, i) => `<text x="50%" y="${size.h / 2 + 80 + i * 28}" text-anchor="middle" font-family="Arial" font-size="18" font-style="italic" fill="#64748b">${esc(l.trim())}</text>`)
    .join('')}</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}
export const isSlot = (e: PlainElement) => e.type === 'image' && e.name === 'picture slot';

const text = (x: number, y: number, w: number, h: number, t: string, style: PlainElement['style'], align = 'left'): PlainElement => ({ id: newId(), type: 'text', x, y, w, h, z: 0, text: textDoc(t, { align }), style: { vAlign: 'middle', autofit: 'shrink', ...style } });
const band = (x: number, y: number, w: number, h: number, opacity: number): PlainElement => ({ id: newId(), type: 'shape', x, y, w, h, z: 0, geom: 'rect', name: 'shade', style: { fill: '#000000', stroke: null, opacity } });

export function slidesFromPhotoPlan(plan: PhotoPlan, details: Map<number, PhotoDetail>, size: DeckSize, theme: Theme): { slides: PlainSlide[]; prompts: { slide: number; prompt: string }[] } {
  const W = size.w;
  const H = size.h;
  const prompts: { slide: number; prompt: string }[] = [];
  const slides = plan.s.map((s, i) => {
    const n = i + 1;
    const d = details.get(n) ?? { i: n };
    const els: PlainElement[] = [];
    let notes = '';
    if (PICTURE_KINDS.includes(s.k)) {
      const prompt = picturePrompt(plan, s, d.img);
      prompts.push({ slide: n, prompt });
      els.push({ id: newId(), type: 'image', x: 0, y: 0, w: W, h: H, z: 0, src: slotPicture(n, size, prompt), name: 'picture slot', alt: prompt });
      notes = `Ảnh (prompt cho ChatGPT / Gemini): ${prompt}`;
    }
    // A line under a picture must be about that picture: the model wrote “Đảo Đầu Ngựa” under a cruise and a theme park.
    const said = String(d.c ?? '').trim();
    const caption = s.k === 'caption' && said && !fold(said).includes(fold(s.h).slice(0, 12)) ? s.h : said;
    if (s.k === 'cover') {
      els.push(band(0, H * 0.52, W, H * 0.48, 0.45));
      els.push(text(64, H * 0.55, W - 128, 150, s.h || plan.t, { fontSize: 40, bold: true, color: '#FFFFFF', lineHeight: 1.15 }));
      if (caption) els.push(text(64, H * 0.55 + 152, W - 128, 56, caption, { fontSize: 22, color: '#F1F5F9' }));
    } else if (s.k === 'section' || s.k === 'end') {
      els.push(band(0, 0, W * 0.48, H, 0.5));
      els.push(text(56, H * 0.3, W * 0.48 - 96, 140, s.h, { fontSize: s.k === 'end' ? 48 : 40, bold: true, color: '#FFFFFF' }));
      if (caption) els.push(text(56, H * 0.3 + 150, W * 0.48 - 96, 90, caption, { fontSize: 20, color: '#E2E8F0' }));
    } else if (s.k === 'caption') {
      els.push(band(0, H - 120, W, 120, 0.45));
      els.push(text(48, H - 108, W - 96, 96, caption || s.h, { fontSize: 26, bold: !caption, color: '#FFFFFF' }));
    } else if (s.k === 'photo') {
      notes += `\nTrang ảnh: không có chữ — để người dùng tự thêm nếu cần (gợi ý tiêu đề: ${s.h}).`;
    } else if (s.k === 'data') {
      const data = (d.d ?? []).filter((x) => x.l && Number.isFinite(Number(x.v))).slice(0, 6);
      const slide = newSlide('titleOnly', size, theme);
      for (const el of slide.elements) if (el.ph === 'title') el.text = textDoc(s.h);
      if (!plausibleFigures(data)) {
        // Figures that look made up (labels "c1", "c2"; values 1, 2, 3) make a worse slide than none: a table to
        // fill in instead — the labels the model thought of, the figures and their source left for people.
        const labels = data.map((x) => String(x.l).trim()).filter((l) => l.length > 2 && !/^([a-z]\d{1,2}|\d{1,2})$/i.test(l));
        const rows = (labels.length ? labels : ['', '', '']).slice(0, 5).map((l) => [l, '', '']);
        els.push(...slide.elements);
        els.push({ id: newId(), type: 'table', x: 80, y: 160, w: W - 160, h: 60 + rows.length * 56, z: 0, table: { rows: [['Hạng mục', d.u ? `Số liệu (${d.u})` : 'Số liệu', 'Nguồn'], ...rows], colW: [3, 2, 2], header: true, fontSize: 16 } });
        els.push(text(80, H - 92, W - 160, 40, 'Điền số liệu thật và nguồn — AI local không có số liệu đáng tin cho trang này', { fontSize: 13, color: '#64748B' }));
        notes = `Slide số liệu để điền tay.${data.length ? ` AI gợi ý (không đáng tin): ${data.map((x) => `${x.l}: ${x.v}`).join('; ')}` : ''}`;
        els.forEach((e, k) => (e.z = k + 1));
        return { id: newId(), meta: { layout: 'titleOnly' }, notes, elements: els } as PlainSlide;
      }
      els.push(...slide.elements);
      els.push({ id: newId(), type: 'chart', x: 80, y: 150, w: W - 160, h: H - 250, z: 0, chart: { kind: 'column', categories: data.map((x) => String(x.l)), series: [{ name: String(d.u ?? '') || s.h, values: data.map((x) => Number(x.v)) }], legend: false, labels: true } });
      els.push(text(80, H - 92, W - 160, 40, `${d.src ? `Nguồn gợi ý: ${d.src} · ` : ''}Số liệu do AI đề xuất — cần kiểm tra trước khi dùng`, { fontSize: 13, color: '#64748B' }));
      notes = 'Slide số liệu: kiểm tra lại từng con số với nguồn chính thức.';
    } else {
      // Words (and a data slide whose figures did not come): title + bullets on the theme's layout.
      const slide = newSlide('titleContent', size, theme);
      // A small model leaks its plan ("section: …", "end") and picture prompts into bullets, or repeats the heading.
      const bullets = (d.b ?? [])
        .map((b) => String(b).replace(/^[-•*\d.)\s]+/, '').trim())
        .filter((b) => b && b.length > 2 && fold(b) !== fold(s.h) && !/^[{[]/.test(b) && !/^(cover|section|photo|caption|text|data|end)\b/i.test(b) && !/photograph|no text|16:9|drone shot|low angle/i.test(b))
        .slice(0, 5);
      for (const el of slide.elements) {
        if (el.ph === 'title') el.text = textDoc(s.h);
        if (el.ph === 'body') el.text = textDoc(bullets.length ? bullets : [caption || ''], { bullets: true });
      }
      els.push(...slide.elements);
    }
    els.forEach((e, k) => (e.z = k + 1));
    return { id: newId(), meta: { layout: PICTURE_KINDS.includes(s.k) ? 'blank' : s.k === 'data' ? 'titleOnly' : 'titleContent' }, notes: notes.trim(), elements: els } as PlainSlide;
  });
  return { slides, prompts };
}

const FOOD = /ẩm thực|đặc sản|món|food|dish|cuisine|料理/i;
/**
 * The prompt an image AI paints a slide from. It always starts with the subject in the deck's own words ("Sá sùng —
 * Hạ Long, Vietnam"): ChatGPT and Gemini read Vietnamese, and a 3B model does not know the dishes — it turned sá sùng
 * into "sashimi in Japanese style" and rượu ba kích into "wine bottles at a vineyard". Its description is kept only
 * when it names the subject or the place; otherwise a plain food / travel photograph of the subject is asked for.
 */
export function picturePrompt(plan: PhotoPlan, s: { k: PhotoKind; h: string; p?: string }, img?: string): string {
  const place = plan.place || plan.t;
  const subject = s.k === 'cover' || s.k === 'end' ? place : s.h;
  const food = s.k !== 'cover' && s.k !== 'end' && (FOOD.test(s.p ?? '') || FOOD.test(s.h));
  let text = String(img ?? '')
    .replace(/\s+/g, ' ')
    .replace(/^(?:ai\s+)?(?:generate|create|make)\s+(?:an?\s+)?(?:picture|image|photo)?\s*(?:of\s+)?/i, '')
    .replace(/\b(?:src|i|k|c)\s*=.*$/i, '')
    .trim();
  const names = [fold(subject), fold(place), 'halong'].filter((x) => x.length >= 3);
  // Dishes: always the plain food photograph — the small model's descriptions of Vietnamese dishes were all wrong.
  const relevant = !food && text.length >= 40 && names.some((n) => fold(text).includes(n)) && !/màn hình|screenshot|presentation|slide/i.test(text);
  if (!relevant) text = food ? `Professional food photography of ${subject}, the local speciality, served the traditional way, close-up, appetising, natural light.` : `Professional travel photography of ${subject}, natural light, rich colours, wide view.`;
  let out = `${subject} — ${place === subject ? '' : `${place}, `}Vietnam. ${text}`.replace(/ — Vietnam/, ', Vietnam');
  if (!/no text/i.test(out)) out += ' No text, no letters, no logos, no watermark.';
  if (!/16:9/.test(out)) out += ' Wide 16:9 landscape frame.';
  return out.slice(0, 650);
}

/** Letters and digits only, without accents ("Hạ Long" → "halong") — to see whether a prompt names its subject. */
function fold(s: string) {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[đĐ]/g, 'd').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * The request asks for figures and the model planned none: the text slides of the parts most likely to have them
 * (how to get there, seasons, prices, visitors) become data slides — at most two, the figures marked "to check".
 */
export function ensureData(plan: PhotoPlan, request: string): string | null {
  if (!/số liệu|thống kê|biểu đồ|figures|statistics|data|chart/i.test(request) || plan.s.some((x) => x.k === 'data')) return null;
  const likely = /đi|mùa|giá|khách|chi phí|thời tiết|khoảng cách|nhiệt độ|travel|season|price|cost|visitor|weather/i;
  const texts = plan.s.filter((x) => x.k === 'text');
  const pick = [...texts.filter((x) => likely.test(`${x.p ?? ''} ${x.h}`)), ...texts].filter((x, i, a) => a.indexOf(x) === i).slice(0, 2);
  for (const x of pick) x.k = 'data';
  return pick.length ? `${pick.length} text slides made figure slides (the request asks for figures)` : null;
}
