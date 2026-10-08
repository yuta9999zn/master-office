// Image AI connections (docs/ARCHITECTURE.md §81): picture generation and editing by OpenAI (gpt-image-1) or Google
// Gemini (gemini-2.5-flash-image), plus a key-less "demo" provider for trying the studio and for tests. Pictures
// come back as PNG and are cropped to the design's exact size; text removal falls back to a local patch fill.
import sharp, { type OverlayOptions } from 'sharp';

export type ImageProviderId = 'openai' | 'gemini' | 'demo';

export interface ImageResult {
  data: Buffer;
  mime: string;
  provider: ImageProviderId;
  model: string;
}

export interface ImageProvider {
  id: ImageProviderId;
  model: string;
  /** A new picture from a description, at about this aspect ratio. */
  generate(prompt: string, size: { w: number; h: number }, signal?: AbortSignal): Promise<ImageResult>;
  /** The same picture changed as the instruction says (used to take the text off a picture). */
  edit(image: Buffer, instruction: string, signal?: AbortSignal): Promise<ImageResult>;
}

const TIMEOUT = 180_000;
const withTimeout = (signal?: AbortSignal) => (signal ? AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT)]) : AbortSignal.timeout(TIMEOUT));

async function failed(res: Response, who: string): Promise<never> {
  const body = await res.text().catch(() => '');
  let msg = body.slice(0, 400);
  try {
    const j = JSON.parse(body) as { error?: { message?: string } };
    msg = j.error?.message ?? msg;
  } catch {
    /* plain text */
  }
  throw new Error(`${who} answered ${res.status}: ${msg}`);
}

// ── OpenAI ──────────────────────────────────────────────────────────────────

export class OpenAiImages implements ImageProvider {
  readonly id = 'openai' as const;
  constructor(
    private readonly key: string,
    readonly model = 'gpt-image-1',
    private readonly baseUrl = 'https://api.openai.com/v1',
  ) {}

  private size({ w, h }: { w: number; h: number }) {
    return w > h * 1.15 ? '1536x1024' : h > w * 1.15 ? '1024x1536' : '1024x1024';
  }

  async generate(prompt: string, size: { w: number; h: number }, signal?: AbortSignal): Promise<ImageResult> {
    const res = await fetch(`${this.baseUrl}/images/generations`, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: this.model, prompt, size: this.size(size), n: 1 }),
      signal: withTimeout(signal),
    });
    if (!res.ok) await failed(res, 'OpenAI');
    const j = (await res.json()) as { data?: { b64_json?: string; url?: string }[] };
    const d = j.data?.[0];
    const data = d?.b64_json ? Buffer.from(d.b64_json, 'base64') : d?.url ? Buffer.from(await (await fetch(d.url)).arrayBuffer()) : null;
    if (!data) throw new Error('OpenAI returned no picture');
    return { data, mime: 'image/png', provider: 'openai', model: this.model };
  }

  async edit(image: Buffer, instruction: string, signal?: AbortSignal): Promise<ImageResult> {
    const meta = await sharp(image).metadata();
    const form = new FormData();
    form.append('model', this.model);
    form.append('prompt', instruction);
    form.append('size', this.size({ w: meta.width ?? 1024, h: meta.height ?? 1024 }));
    form.append('image', new Blob([await sharp(image).png().toBuffer()], { type: 'image/png' }), 'image.png');
    const res = await fetch(`${this.baseUrl}/images/edits`, { method: 'POST', headers: { authorization: `Bearer ${this.key}` }, body: form, signal: withTimeout(signal) });
    if (!res.ok) await failed(res, 'OpenAI');
    const j = (await res.json()) as { data?: { b64_json?: string }[] };
    if (!j.data?.[0]?.b64_json) throw new Error('OpenAI returned no picture');
    return { data: Buffer.from(j.data[0].b64_json, 'base64'), mime: 'image/png', provider: 'openai', model: this.model };
  }
}

// ── Google Gemini ───────────────────────────────────────────────────────────

const GEMINI_RATIOS = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'];
const nearestRatio = ({ w, h }: { w: number; h: number }) =>
  GEMINI_RATIOS.map((r) => {
    const [a, b] = r.split(':').map(Number);
    return { r, d: Math.abs(Math.log(a / b) - Math.log(w / h)) };
  }).sort((x, y) => x.d - y.d)[0].r;

export class GeminiImages implements ImageProvider {
  readonly id = 'gemini' as const;
  constructor(
    private readonly key: string,
    readonly model = 'gemini-2.5-flash-image',
    private readonly baseUrl = 'https://generativelanguage.googleapis.com/v1beta',
  ) {}

  private async call(parts: unknown[], size: { w: number; h: number } | null, signal?: AbortSignal): Promise<ImageResult> {
    const res = await fetch(`${this.baseUrl}/models/${encodeURIComponent(this.model)}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': this.key },
      body: JSON.stringify({
        contents: [{ role: 'user', parts }],
        generationConfig: { responseModalities: ['IMAGE', 'TEXT'], ...(size ? { imageConfig: { aspectRatio: nearestRatio(size) } } : {}) },
      }),
      signal: withTimeout(signal),
    });
    if (!res.ok) await failed(res, 'Gemini');
    const j = (await res.json()) as { candidates?: { content?: { parts?: { inlineData?: { data: string; mimeType?: string }; inline_data?: { data: string; mime_type?: string } }[] } }[] };
    for (const p of j.candidates?.[0]?.content?.parts ?? []) {
      const d = p.inlineData ?? (p.inline_data ? { data: p.inline_data.data, mimeType: p.inline_data.mime_type } : null);
      if (d?.data) return { data: Buffer.from(d.data, 'base64'), mime: d.mimeType ?? 'image/png', provider: 'gemini', model: this.model };
    }
    throw new Error('Gemini returned no picture (the request may have been blocked by its safety filters)');
  }

  generate(prompt: string, size: { w: number; h: number }, signal?: AbortSignal) {
    return this.call([{ text: prompt }], size, signal);
  }

  async edit(image: Buffer, instruction: string, signal?: AbortSignal) {
    const png = await sharp(image).png().toBuffer();
    const meta = await sharp(png).metadata();
    return this.call([{ inline_data: { mime_type: 'image/png', data: png.toString('base64') } }, { text: instruction }], { w: meta.width ?? 1, h: meta.height ?? 1 }, signal);
  }
}

// ── Demo (no key): a soft gradient composition; "edit" blurs the text away locally ──

export class DemoImages implements ImageProvider {
  readonly id = 'demo' as const;
  readonly model = 'demo';

  async generate(prompt: string, size: { w: number; h: number }): Promise<ImageResult> {
    // Colours from the words of the prompt, so different briefs look different.
    const hues = /pink|hồng|rose|blush/i.test(prompt) ? [340, 30] : /green|sage|xanh lá/i.test(prompt) ? [100, 45] : /blue|ocean|xanh dương/i.test(prompt) ? [205, 180] : /brown|mocha|beige/i.test(prompt) ? [30, 40] : [260, 320];
    const w = Math.min(1600, size.w);
    const h = Math.round((w * size.h) / size.w);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hues[0]},70%,96%)"/><stop offset="1" stop-color="hsl(${hues[0]},55%,84%)"/></linearGradient>
        <radialGradient id="r" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="hsl(${hues[1]},70%,80%)" stop-opacity="0.9"/><stop offset="1" stop-color="hsl(${hues[1]},70%,80%)" stop-opacity="0"/></radialGradient>
      </defs>
      <rect width="100%" height="100%" fill="url(#g)"/>
      <circle cx="${w * 0.78}" cy="${h * 0.45}" r="${h * 0.55}" fill="url(#r)"/>
      <circle cx="${w * 0.9}" cy="${h * 0.9}" r="${h * 0.3}" fill="hsl(${hues[0]},60%,75%)" fill-opacity="0.35"/>
      <circle cx="${w * 0.62}" cy="${h * 0.12}" r="${h * 0.12}" fill="hsl(${hues[1]},60%,70%)" fill-opacity="0.4"/>
    </svg>`;
    return { data: await sharp(Buffer.from(svg)).png().toBuffer(), mime: 'image/png', provider: 'demo', model: 'demo' };
  }

  async edit(image: Buffer): Promise<ImageResult> {
    return { data: await sharp(image).png().toBuffer(), mime: 'image/png', provider: 'demo', model: 'demo' };
  }
}

// ── Local helpers ───────────────────────────────────────────────────────────

/** Covers the picture to exactly w × h (centre crop), as a PNG. */
export async function fitTo(image: Buffer, w: number, h: number) {
  return sharp(image).resize(Math.round(w), Math.round(h), { fit: 'cover', position: 'centre' }).png().toBuffer();
}

export interface TextBox {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/**
 * Takes text off a picture without any service — a small inpainting: boxes of neighbouring lines are merged, every
 * pixel inside a box is interpolated from the pixels just OUTSIDE it (left ↔ right and top ↔ bottom, weighted by
 * nearness), then the fill is smoothed and feathered into the picture. Clean on gradients, studio light and bokeh;
 * on sharp patterns an image AI's edit does better.
 */
export async function patchOutText(image: Buffer, boxes: TextBox[]) {
  const { data, info } = await sharp(image).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width;
  const H = info.height;
  const out = Buffer.from(data);
  // Grow each box around its ink, then merge boxes that touch, so no sample is taken from another line's letters.
  const grown = boxes.map((b) => {
    const h = b.y2 - b.y1;
    const padX = Math.max(4, (b.x2 - b.x1) * 0.04 + h * 0.3);
    const padY = Math.max(3, h * 0.32);
    return { x1: Math.max(1, Math.floor(b.x1 - padX)), y1: Math.max(1, Math.floor(b.y1 - padY)), x2: Math.min(W - 2, Math.ceil(b.x2 + padX)), y2: Math.min(H - 2, Math.ceil(b.y2 + padY)) };
  });
  // Boxes are NOT merged (that would wipe decorations between lines): instead every sample is taken from the first
  // pixels outside all boxes, walking outwards — so a line never borrows the ink of the line next to it.
  const merged = grown;
  const mask = new Uint8Array(W * H);
  for (const b of grown) for (let y = b.y1; y <= b.y2; y++) mask.fill(1, y * W + b.x1, y * W + b.x2 + 1);
  const at = (x: number, y: number, c: number) => data[(Math.min(H - 1, Math.max(0, y)) * W + Math.min(W - 1, Math.max(0, x))) * 3 + c];
  /** The colour 1–3 px beyond the first free pixel when walking from (x, y) in (dx, dy), within 60 px. */
  const sample = (x: number, y: number, dx: number, dy: number): [number, number, number] => {
    let cx = x;
    let cy = y;
    for (let i = 0; i < 60; i++) {
      if (cx < 0 || cy < 0 || cx >= W || cy >= H) break;
      if (!mask[cy * W + cx]) break;
      cx += dx;
      cy += dy;
    }
    const pts = [0, 1, 2].map((k) => [cx + dx * k, cy + dy * k] as const);
    return [0, 1, 2].map((c) => pts.reduce((s, [px, py]) => s + at(px, py, c), 0) / 3) as [number, number, number];
  };
  for (const b of merged) {
    const { x1, y1, x2, y2 } = b;
    if (x2 - x1 < 2 || y2 - y1 < 2) continue;
    const left = Array.from({ length: y2 - y1 + 1 }, (_, i) => sample(x1 - 1, y1 + i, -1, 0));
    const right = Array.from({ length: y2 - y1 + 1 }, (_, i) => sample(x2 + 1, y1 + i, 1, 0));
    const top = Array.from({ length: x2 - x1 + 1 }, (_, i) => sample(x1 + i, y1 - 1, 0, -1));
    const bottom = Array.from({ length: x2 - x1 + 1 }, (_, i) => sample(x1 + i, y2 + 1, 0, 1));
    for (let y = y1; y <= y2; y++)
      for (let x = x1; x <= x2; x++) {
        const u = (x - x1) / (x2 - x1);
        const v = (y - y1) / (y2 - y1);
        const wh = 1 / (Math.min(u, 1 - u) + 0.04);
        const wv = 1 / (Math.min(v, 1 - v) + 0.04);
        const L = left[y - y1];
        const R = right[y - y1];
        const T = top[x - x1];
        const B = bottom[x - x1];
        for (let c = 0; c < 3; c++) {
          const hv = L[c] * (1 - u) + R[c] * u;
          const vv = T[c] * (1 - v) + B[c] * v;
          out[(y * W + x) * 3 + c] = Math.round((hv * wh + vv * wv) / (wh + wv));
        }
      }
  }
  // Smooth the fills and feather them in, so the seams vanish.
  const filled = await sharp(out, { raw: { width: W, height: H, channels: 3 } }).png().toBuffer();
  const overlays: OverlayOptions[] = [];
  for (const b of merged) {
    const w = b.x2 - b.x1 + 1;
    const h = b.y2 - b.y1 + 1;
    if (w < 3 || h < 3) continue;
    const sigma = Math.max(1.2, Math.min(10, Math.min(w, h) * 0.12));
    const patch = await sharp(filled).extract({ left: b.x1, top: b.y1, width: w, height: h }).blur(sigma).toBuffer();
    const feather = Math.max(1, Math.round(Math.min(w, h) * 0.12));
    const mask = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect x="${feather}" y="${feather}" width="${Math.max(1, w - 2 * feather)}" height="${Math.max(1, h - 2 * feather)}" fill="#fff"/></svg>`))
      .blur(feather * 0.7 + 0.4)
      .extractChannel(0)
      .toBuffer();
    overlays.push({ input: await sharp(patch).ensureAlpha().joinChannel(mask).png().toBuffer(), left: b.x1, top: b.y1 });
  }
  return overlays.length ? sharp(filled).composite(overlays).png().toBuffer() : filled;
}

/** The earlier, blur-only fill (kept for comparison in tests). */
export async function blurOutText(image: Buffer, boxes: TextBox[]) {
  const img = sharp(image);
  const meta = await img.metadata();
  const W = meta.width ?? 1;
  const H = meta.height ?? 1;
  const overlays: OverlayOptions[] = [];
  for (const b of boxes) {
    const padX = Math.max(6, (b.x2 - b.x1) * 0.08);
    const padY = Math.max(6, (b.y2 - b.y1) * 0.25);
    const x1 = Math.max(0, Math.floor(b.x1 - padX));
    const y1 = Math.max(0, Math.floor(b.y1 - padY));
    const x2 = Math.min(W, Math.ceil(b.x2 + padX));
    const y2 = Math.min(H, Math.ceil(b.y2 + padY));
    const w = x2 - x1;
    const h = y2 - y1;
    if (w < 2 || h < 2) continue;
    // A wider frame around the box, blurred hard enough that the letters dissolve into their surroundings.
    const fx1 = Math.max(0, x1 - w);
    const fy1 = Math.max(0, y1 - h);
    const fx2 = Math.min(W, x2 + w);
    const fy2 = Math.min(H, y2 + h);
    const sigma = Math.max(8, Math.min(60, h * 0.9));
    const blurred = await sharp(image).extract({ left: fx1, top: fy1, width: fx2 - fx1, height: fy2 - fy1 }).blur(sigma).toBuffer();
    const patch = await sharp(blurred).extract({ left: x1 - fx1, top: y1 - fy1, width: w, height: h }).toBuffer();
    // Feathered mask so the patch melts into the picture.
    const feather = Math.max(2, Math.round(Math.min(w, h) * 0.18));
    const mask = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect x="${feather}" y="${feather}" width="${Math.max(1, w - 2 * feather)}" height="${Math.max(1, h - 2 * feather)}" rx="${feather}" fill="#fff"/></svg>`))
      .blur(feather * 0.6 + 0.5)
      .extractChannel(0)
      .toBuffer();
    const soft = await sharp(patch).ensureAlpha().joinChannel(mask).png().toBuffer();
    overlays.push({ input: soft, left: x1, top: y1 });
  }
  return overlays.length ? sharp(image).composite(overlays).png().toBuffer() : sharp(image).png().toBuffer();
}

/** The colour of the letters inside a box: the pixels that differ most from the box's edge. */
export async function textColourIn(image: Buffer, b: TextBox): Promise<string> {
  const meta = await sharp(image).metadata();
  const left = Math.max(0, Math.floor(b.x1));
  const top = Math.max(0, Math.floor(b.y1));
  const width = Math.max(1, Math.min((meta.width ?? 1) - left, Math.ceil(b.x2 - b.x1)));
  const height = Math.max(1, Math.min((meta.height ?? 1) - top, Math.ceil(b.y2 - b.y1)));
  const { data, info } = await sharp(image).extract({ left, top, width, height }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const px = (i: number) => [data[i], data[i + 1], data[i + 2]];
  const edge: number[][] = [];
  for (let x = 0; x < info.width; x++) edge.push(px(x * 3), px(((info.height - 1) * info.width + x) * 3));
  const bg = [0, 1, 2].map((k) => edge.reduce((s, p) => s + p[k], 0) / edge.length);
  let best = { d: -1, c: [0, 0, 0] };
  const cand: { d: number; c: number[] }[] = [];
  for (let i = 0; i < data.length; i += 3 * 3) {
    const c = px(i);
    const d = Math.hypot(c[0] - bg[0], c[1] - bg[1], c[2] - bg[2]);
    cand.push({ d, c });
    if (d > best.d) best = { d, c };
  }
  // The top 15 % most different pixels, averaged: the ink without the anti-aliased rim.
  cand.sort((a, b2) => b2.d - a.d);
  const top15 = cand.slice(0, Math.max(1, Math.round(cand.length * 0.15)));
  const avg = [0, 1, 2].map((k) => Math.round(top15.reduce((s, p) => s + p.c[k], 0) / top15.length));
  return `#${avg.map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}
