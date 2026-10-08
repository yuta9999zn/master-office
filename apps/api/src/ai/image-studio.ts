// AI Image Studio (docs/ARCHITECTURE.md §81) — Photoshop-like layers on slides: a picture from an image AI (OpenAI,
// Gemini) or one made elsewhere (ChatGPT, Gemini apps — uploaded or pasted) becomes the locked background layer, and
// its text becomes editable text layers on top: a vision model reads every line with its box, the text is taken off
// the picture (by the image AI, or locally with a patch fill), and the lines come back as text boxes in place.
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { createYElement, createYSlide, newId, ORDER_ARRAY, readSlide, readText as readRichText, SLIDES_MAP, textDoc, textOf, writeText, type DeckSize, type PlainElement, type TextNode } from '@workos/slide-model';
import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import * as Y from 'yjs';
import { decryptSecret } from '../auth/secrets';
import { CollabService } from '../collab/collab.service';
import type { Actor } from '../common/current-user';
import type { Db } from '../db/client';
import { InjectDb } from '../db/db.module';
import { blobs } from '../db/schema';
import { DocsService } from '../docs/docs.service';
import { PermissionsService } from '../permissions/permissions.service';
import { StorageService } from '../storage/storage.service';
import { DemoImages, fitTo, GeminiImages, OpenAiImages, patchOutText, textColourIn, type ImageProvider, type TextBox } from './images';
import { OllamaClient, parseJsonLoose, type LlmModel } from './llm';
import { inkMetrics, ocrWords, snapToWords } from './ocr';

export interface ImageSettings {
  provider: 'none' | 'openai' | 'gemini' | 'demo';
  /** Encrypted (auth/secrets); never sent to the browser. */
  openaiKey?: string;
  openaiModel: string;
  openaiBaseUrl?: string;
  geminiKey?: string;
  geminiModel: string;
  /** Who reads the text in pictures: the local vision model (Ollama) or Gemini. */
  vision: 'local' | 'gemini';
  /** Local vision model; empty = the first vision model of the server. */
  visionModel: string;
}
export const DEFAULT_IMAGE_SETTINGS: ImageSettings = { provider: 'none', openaiModel: 'gpt-image-1', geminiModel: 'gemini-2.5-flash-image', vision: 'local', visionModel: '' };

export interface TextLine {
  text: string;
  box: TextBox;
  colour?: string;
  bold?: boolean;
  /** The box is the letters' own extent (from OCR), not a loose line box. */
  ink?: boolean;
}

/** Short keys: every output token costs ~0.25 s on a CPU. t = text, b = [x1, y1, x2, y2]. Colours are measured locally. */
export const READ_TEXT_SCHEMA = {
  type: 'object',
  properties: { l: { type: 'array', maxItems: 40, items: { type: 'object', properties: { t: { type: 'string', maxLength: 120 }, b: { type: 'array', items: { type: 'integer' }, minItems: 4, maxItems: 4 } }, required: ['t', 'b'] } } },
  required: ['l'],
};
/**
 * Ollama gives Qwen2.5-VL every picture at about this many pixels (sides multiple of 28) and the model answers in
 * those pixels — measured: a 812 × 420 picture is read as ~1288 × 672. Sending it at that size makes boxes exact.
 */
const VISION_PIXELS = 865_000;

/** Where a picture sits on a slide: the slide's background, or an image element. */
interface Source {
  slideId: string;
  elementId: string | null;
  src: string;
  /** Its box on the slide (the whole slide for a background). */
  rect: { x: number; y: number; w: number; h: number };
}

@Injectable()
export class ImageStudioService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly collab: CollabService,
    private readonly perms: PermissionsService,
    private readonly storage: StorageService,
    private readonly docs: DocsService,
  ) {}

  provider(s: ImageSettings): ImageProvider | null {
    const key = (k?: string) => {
      try {
        return k ? decryptSecret(k) : '';
      } catch {
        return '';
      }
    };
    if (s.provider === 'openai' && s.openaiKey) return new OpenAiImages(key(s.openaiKey), s.openaiModel || 'gpt-image-1', s.openaiBaseUrl || undefined);
    if (s.provider === 'gemini' && s.geminiKey) return new GeminiImages(key(s.geminiKey), s.geminiModel || 'gemini-2.5-flash-image');
    if (s.provider === 'demo') return new DemoImages();
    return null;
  }

  // ── Pictures in and out of the deck ─────────────────────────────────────

  /** The bytes behind a slide picture: one of the deck's assets, or a data: URL. */
  async bytesOf(resourceId: string, src: string): Promise<Buffer> {
    const data = /^data:[^;]+;base64,(.*)$/s.exec(src);
    if (data) return Buffer.from(data[1], 'base64');
    const m = /\/resources\/([0-9a-f-]{36})\/assets\/([0-9a-f-]{36})/.exec(src);
    if (!m || m[1] !== resourceId) throw new BadRequestException('Only pictures stored in this presentation can be edited');
    const [b] = await this.db.select().from(blobs).where(eq(blobs.id, m[2]));
    if (!b) throw new NotFoundException('Picture not found');
    return this.storage.getBuffer(b.storageKey);
  }

  async store(actor: Actor, resourceId: string, png: Buffer): Promise<string> {
    return (await this.docs.saveAsset(actor, resourceId, png, 'image/png')).url;
  }

  /** The picture to work on: an image element (given, or the largest on the slide) or the slide's background picture. */
  async sourceOf(resourceId: string, slideId: string | null, elementId: string | null, size: DeckSize): Promise<Source> {
    const state = await this.collab.currentState(resourceId);
    if (!state) throw new NotFoundException('Presentation not found');
    const doc = new Y.Doc();
    Y.applyUpdate(doc, state);
    const slides = doc.getMap<Y.Map<unknown>>(SLIDES_MAP);
    const ids = slideId ? [slideId] : [...slides.keys()];
    for (const id of ids) {
      const ym = slides.get(id);
      if (!ym) continue;
      const s = readSlide(id, ym);
      const images = s.elements.filter((e) => e.type === 'image' && e.src && (!elementId || e.id === elementId)).sort((a, b) => b.w * b.h - a.w * a.h);
      if (images[0]) return { slideId: id, elementId: images[0].id, src: images[0].src!, rect: { x: images[0].x, y: images[0].y, w: images[0].w, h: images[0].h } };
      if (s.meta.background?.type === 'image' && !elementId) return { slideId: id, elementId: null, src: s.meta.background.src, rect: { x: 0, y: 0, w: size.w, h: size.h } };
    }
    throw new BadRequestException('There is no picture on this slide: add one (Insert → Image, or paste it) or generate one first');
  }

  /** Sets a slide's background picture, or puts the picture in as a locked bottom layer element. */
  async place(actor: Actor, resourceId: string, slideId: string, src: string, as: 'background' | 'element', size: DeckSize) {
    await this.collab.transact(resourceId, { id: actor.id, name: `${actor.name} (AI)` }, (doc) => {
      const slide = doc.getMap<Y.Map<unknown>>(SLIDES_MAP).get(slideId);
      if (!slide) return;
      if (as === 'background') {
        slide.set('meta', { ...((slide.get('meta') as object) ?? {}), background: { type: 'image', src } });
        return;
      }
      const els = slide.get('elements') as Y.Map<Y.Map<unknown>>;
      const el: PlainElement = { id: newId(), type: 'image', x: 0, y: 0, w: size.w, h: size.h, z: 0, src, name: 'AI picture' };
      const y = createYElement(el);
      els.set(el.id, y.map);
      y.fill();
    });
  }

  // ── Reading the text of a picture ───────────────────────────────────────

  /**
   * Every line of text with its box, in pixels of `png`. Local: the picture is resized so both sides are multiples
   * of 28 (Qwen2.5-VL's patch size) and the model answers in those pixels; Gemini answers in 0–1000 boxes.
   */
  async readText(png: Buffer, s: ImageSettings, ollama: { url: string; models: LlmModel[] }, prompt: { system: string; template: string }, signal?: AbortSignal, onText?: (t: string, n: number) => void): Promise<TextLine[]> {
    const meta = await sharp(png).metadata();
    const W0 = meta.width ?? 1;
    const H0 = meta.height ?? 1;
    if (s.vision === 'gemini' && s.geminiKey) return this.readTextGemini(png, W0, H0, decryptSecret(s.geminiKey), prompt, signal);
    const model = s.visionModel || ollama.models.find((m) => m.vision)?.name;
    if (!model) throw new BadRequestException('No vision model on the model server: pull one with “ollama pull qwen2.5vl:7b”, or let Gemini read the text (AI → Model & settings)');
    const k = Math.sqrt(VISION_PIXELS / (W0 * H0));
    const W = Math.max(28, Math.round((W0 * k) / 28) * 28);
    const H = Math.max(28, Math.round((H0 * k) / 28) * 28);
    const small = await sharp(png).resize(W, H, { fit: 'fill' }).png().toBuffer();
    const fill = (t: string) => t.replace(/\{\{\s*width\s*\}\}/g, String(W)).replace(/\{\{\s*height\s*\}\}/g, String(H));
    const res = await new OllamaClient(ollama.url).chat({ model, system: fill(prompt.system), prompt: fill(prompt.template), images: [small.toString('base64')], format: READ_TEXT_SCHEMA, temperature: 0, numCtx: 8192, maxTokens: 1500, signal, onText });
    const out = parseJsonLoose<{ l?: { t?: string; b?: number[] }[] }>(res.text);
    const kx = W0 / W;
    const ky = H0 / H;
    return this.cleanLines((out.l ?? []).map((x) => ({ text: x.t, box: x.b })), (b) => ({ x1: b[0] * kx, y1: b[1] * ky, x2: b[2] * kx, y2: b[3] * ky }), W0, H0);
  }

  /** The model's lines moved onto the exact word boxes of a local OCR pass (see ocr.ts). */
  async exactBoxes(png: Buffer, lines: TextLine[]): Promise<{ lines: TextLine[]; snapped: number }> {
    const meta = await sharp(png).metadata();
    return snapToWords(lines, await ocrWords(png), { w: meta.width ?? 1, h: meta.height ?? 1 });
  }

  private async readTextGemini(png: Buffer, W0: number, H0: number, key: string, prompt: { system: string; template: string }, signal?: AbortSignal) {
    const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ inline_data: { mime_type: 'image/png', data: png.toString('base64') } }, { text: `${prompt.system}\nGive each box as [ymin, xmin, ymax, xmax] normalised to 0–1000.` }] }],
        generationConfig: { responseMimeType: 'application/json' },
      }),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(120_000)]) : AbortSignal.timeout(120_000),
    });
    if (!res.ok) throw new Error(`Gemini answered ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const j = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const out = parseJsonLoose<{ lines?: { text?: string; box?: number[]; box_2d?: number[]; color?: string; bold?: boolean }[] }>(j.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '');
    return this.cleanLines(
      (out.lines ?? []).map((l) => ({ ...l, box: l.box_2d ?? l.box })),
      (b) => ({ x1: (b[1] / 1000) * W0, y1: (b[0] / 1000) * H0, x2: (b[3] / 1000) * W0, y2: (b[2] / 1000) * H0 }),
      W0,
      H0,
    );
  }

  private cleanLines(raw: { text?: string; box?: number[]; color?: string; bold?: boolean }[], toBox: (b: number[]) => TextBox, W: number, H: number): TextLine[] {
    const lines: TextLine[] = [];
    for (const l of raw) {
      const text = String(l.text ?? '').trim();
      if (!text || !Array.isArray(l.box) || l.box.length !== 4 || l.box.some((v) => typeof v !== 'number' || !Number.isFinite(v))) continue;
      let b = toBox(l.box);
      // Some answers swap corners.
      b = { x1: Math.min(b.x1, b.x2), y1: Math.min(b.y1, b.y2), x2: Math.max(b.x1, b.x2), y2: Math.max(b.y1, b.y2) };
      b = { x1: Math.max(0, b.x1), y1: Math.max(0, b.y1), x2: Math.min(W, b.x2), y2: Math.min(H, b.y2) };
      if (b.x2 - b.x1 < 4 || b.y2 - b.y1 < 4) continue;
      // The same line twice (models repeat themselves): keep the first.
      if (lines.some((x) => x.text === text && Math.abs(x.box.y1 - b.y1) < (b.y2 - b.y1) * 0.5)) continue;
      lines.push({ text, box: b, colour: /^#[0-9a-f]{6}$/i.test(l.color ?? '') ? l.color!.toUpperCase() : undefined, bold: !!l.bold });
    }
    return lines;
  }

  // ── Picture → editable text layers ──────────────────────────────────────

  /**
   * The text of the picture becomes text boxes on the slide; the picture underneath loses its text (image AI edit,
   * else a local patch fill) and stays where it was, as the background layer.
   */
  async makeEditable(actor: Actor, resourceId: string, src: Source, lines: TextLine[], original: Buffer, cleaned: Buffer, size: DeckSize) {
    const meta = await sharp(original).metadata();
    const W0 = meta.width ?? 1;
    const H0 = meta.height ?? 1;
    const url = await this.store(actor, resourceId, cleaned);
    // An image element is stretched to its box; a background picture is drawn like CSS "cover" (centred, cropped).
    const cover = src.elementId ? null : Math.max(src.rect.w / W0, src.rect.h / H0);
    const kx = cover ?? src.rect.w / W0;
    const ky = cover ?? src.rect.h / H0;
    const ox = src.rect.x + (cover ? (src.rect.w - W0 * cover) / 2 : 0);
    const oy = src.rect.y + (cover ? (src.rect.h - H0 * cover) / 2 : 0);
    const els: PlainElement[] = [];
    let z = 50;
    // Bold = clearly bigger than the rest of the design (a headline), not "big on the page": on a card every line is.
    const sizes = lines.map((l) => (l.ink ? inkMetrics(l.text, l.box).fontPx : (l.box.y2 - l.box.y1) / 1.25)).sort((a, b) => a - b);
    const median = sizes[Math.floor(sizes.length / 2)] ?? 0;
    for (const l of lines) {
      const colour = l.colour && l.colour !== '#000000' ? l.colour : await textColourIn(original, l.box).catch(() => '#1F2937');
      const x = ox + l.box.x1 * kx;
      const y = oy + l.box.y1 * ky;
      const w = (l.box.x2 - l.box.x1) * kx;
      const h = (l.box.y2 - l.box.y1) * ky;
      if (l.ink) {
        // An exact ink box: size the font from the letters and sit the text on the picture's baseline. In a line box
        // of line height 1.1 with the text centred, the baseline is ~0.365 em below the middle.
        const m = inkMetrics(l.text, l.box);
        const px = m.fontPx * ky;
        const base = oy + m.baseline * ky;
        els.push({
          id: newId(),
          type: 'text',
          x: Math.round(x - px * 0.06),
          y: Math.round(base - px * 0.365 - px * 0.7),
          w: Math.round(w * 1.12 + px * 0.6),
          h: Math.round(px * 1.4),
          z: ++z,
          name: 'text from picture',
          text: textDoc([l.text], { align: 'left' }),
          style: { fontSize: Math.max(5, Math.round(px * 0.75 * 10) / 10), bold: l.bold || m.fontPx >= median * 1.7, color: colour, vAlign: 'middle', pad: 0, lineHeight: 1.1, autofit: 'shrink' },
        });
        continue;
      }
      // Slide font sizes are points on a 96-dpi canvas: a line box ≈ 1.25 × the font size.
      const fontSize = Math.max(5, Math.round((h / 1.25) * 0.75 * 10) / 10);
      els.push({
        id: newId(),
        type: 'text',
        x: Math.round(x - w * 0.04),
        y: Math.round(y - h * 0.08),
        w: Math.round(w * 1.08 + 4),
        h: Math.round(h * 1.16),
        z: ++z,
        name: 'text from picture',
        text: textDoc([l.text], { align: 'left' }),
        style: { fontSize, bold: l.bold || h / 1.25 >= median * 1.7, color: colour, vAlign: 'middle', pad: 0, lineHeight: 1.1, autofit: 'shrink' },
      });
    }
    await this.collab.transact(resourceId, { id: actor.id, name: `${actor.name} (AI)` }, (doc) => {
      const slide = doc.getMap<Y.Map<unknown>>(SLIDES_MAP).get(src.slideId);
      if (!slide) return;
      const map = slide.get('elements') as Y.Map<Y.Map<unknown>>;
      if (src.elementId) map.get(src.elementId)?.set('src', url);
      else slide.set('meta', { ...((slide.get('meta') as object) ?? {}), background: { type: 'image', src: url } });
      for (const el of els) {
        const y = createYElement(el);
        map.set(el.id, y.map);
        y.fill();
      }
    });
    return { url, lines: els.length };
  }

  /** Text taken off the picture: the image AI's edit when one is connected (not the demo), else a local patch fill. */
  async removeText(png: Buffer, lines: TextLine[], provider: ImageProvider | null, instruction: string, signal?: AbortSignal): Promise<{ data: Buffer; by: string }> {
    if (!lines.length) return { data: png, by: 'nothing to remove' };
    if (provider && provider.id !== 'demo') {
      const meta = await sharp(png).metadata();
      const edited = await provider.edit(png, instruction, signal);
      // The edit may come back at another size: bring it back onto the original frame.
      return { data: await fitTo(edited.data, meta.width ?? 1, meta.height ?? 1), by: `${provider.id} (${provider.model})` };
    }
    return { data: await patchOutText(png, lines.map((l) => l.box)), by: 'local patch fill' };
  }

  /**
   * A picture made elsewhere (ChatGPT, Gemini, a designer) comes in as the background of a new slide — or of the given
   * slide — in the presentation's size; the next step can make its text editable.
   */
  async importPicture(actor: Actor, resourceId: string, file: { buffer: Buffer; mimetype: string }, opts: { slideId?: string | null; newSlide?: boolean }, size: DeckSize) {
    await this.requireEditor(actor, resourceId);
    if (!/^image\/(png|jpe?g|webp|gif|avif|heic|heif|tiff|bmp)$/i.test(file.mimetype)) throw new BadRequestException('Choose a picture (PNG, JPEG, WebP…)');
    // Large photos are scaled to at most 2400 px wide: plenty for a slide, light to read.
    const png = await sharp(file.buffer).rotate().resize({ width: 2400, withoutEnlargement: true }).png().toBuffer();
    const url = await this.store(actor, resourceId, png);
    let slideId = opts.slideId ?? null;
    await this.collab.transact(resourceId, { id: actor.id, name: actor.name }, (doc) => {
      const slides = doc.getMap<Y.Map<unknown>>(SLIDES_MAP);
      if (!opts.newSlide && slideId && slides.get(slideId)) {
        const s = slides.get(slideId)!;
        s.set('meta', { ...((s.get('meta') as object) ?? {}), background: { type: 'image', src: url } });
        return;
      }
      slideId = newId();
      const y = createYSlide({ id: slideId, meta: { layout: 'blank', background: { type: 'image', src: url } }, notes: 'Imported picture', elements: [] });
      slides.set(slideId, y.map);
      y.fill();
      doc.getArray<string>(ORDER_ARRAY).push([slideId]);
    });
    const meta = await sharp(png).metadata();
    return { slideId, url, width: meta.width, height: meta.height, deck: size };
  }

  // ── New information into the text layers ────────────────────────────────

  /** The text layers of a slide (the given one, else the first with text), top to bottom. */
  async textsOf(resourceId: string, slideId: string | null): Promise<{ slideId: string; items: { id: string; text: string }[] }> {
    const state = await this.collab.currentState(resourceId);
    if (!state) throw new NotFoundException('Presentation not found');
    const doc = new Y.Doc();
    Y.applyUpdate(doc, state);
    const slides = doc.getMap<Y.Map<unknown>>(SLIDES_MAP);
    const order = doc.getArray<string>(ORDER_ARRAY).toArray();
    for (const id of slideId ? [slideId] : order) {
      const ym = slides.get(id);
      if (!ym) continue;
      const items = readSlide(id, ym)
        .elements.filter((e) => (e.type === 'text' || e.type === 'shape') && textOf(e.text).trim())
        .sort((a, b) => a.y - b.y || a.x - b.x)
        .map((e) => ({ id: e.id, text: textOf(e.text).trim() }));
      if (items.length || slideId) return { slideId: id, items };
    }
    return { slideId: slideId ?? order[0] ?? '', items: [] };
  }

  /**
   * New words in text layers, keeping their look: the marks of the first run and the paragraph alignment are carried
   * over, and a box grows (to the edge of the slide) when its text got longer.
   */
  async retext(actor: Actor, resourceId: string, slideId: string, changes: { id: string; text: string }[], size: DeckSize) {
    let n = 0;
    await this.collab.transact(resourceId, { id: actor.id, name: `${actor.name} (AI)` }, (doc) => {
      const els = doc.getMap<Y.Map<unknown>>(SLIDES_MAP).get(slideId)?.get('elements') as Y.Map<Y.Map<unknown>> | undefined;
      for (const c of changes) {
        const el = els?.get(c.id);
        const frag = el?.get('text');
        if (!el || !(frag instanceof Y.XmlFragment)) continue;
        const before = readRichText(frag);
        const old = textOf(before);
        const first = (n: TextNode | undefined): TextNode | undefined => (!n ? undefined : n.type === 'text' ? n : n.content?.map(first).find(Boolean));
        const para = before.content?.[0];
        const list = para?.type === 'bulletList' || para?.type === 'orderedList' ? para.type : null;
        const align = (list ? para?.content?.[0]?.content?.[0] : para)?.attrs?.textAlign as string | undefined;
        writeText(frag, textDoc(c.text.split('\n'), { align, marks: first(before)?.marks, bullets: list === 'bulletList', ordered: list === 'orderedList' }));
        const longest = (t: string) => Math.max(1, ...t.split('\n').map((l) => l.length));
        const grow = longest(c.text) / longest(old);
        const x = Number(el.get('x') ?? 0);
        const w = Number(el.get('w') ?? 0);
        if (grow > 1.05 && el.get('type') === 'text') el.set('w', Math.round(Math.min(w * grow, size.w - x)));
        n++;
      }
    });
    return n;
  }

  /** The page size a picture's design gets: a known format when the shape matches (±2 %), else its own shape. */
  static sizeFor(w: number, h: number, formats: Record<string, { size: DeckSize }>): DeckSize {
    for (const f of Object.values(formats)) if (Math.abs(f.size.w / f.size.h / (w / h) - 1) < 0.02) return f.size;
    const W = w >= h ? 1200 : Math.round((1200 * w) / h);
    return { w: W, h: Math.round((W * h) / w) };
  }

  // ── Picture slots (§82): pictures made in ChatGPT / Gemini go into the slots a deck was planned with ──

  /** Every picture slot of the deck, in slide order: its slide number, the prompt to paint it from, filled or not. */
  async slotsOf(resourceId: string) {
    const state = await this.collab.currentState(resourceId);
    if (!state) throw new NotFoundException('Presentation not found');
    const doc = new Y.Doc();
    Y.applyUpdate(doc, state);
    const slides = doc.getMap<Y.Map<unknown>>(SLIDES_MAP);
    const out: { slide: number; slideId: string; elementId: string; prompt: string; filled: boolean; w: number; h: number }[] = [];
    doc
      .getArray<string>(ORDER_ARRAY)
      .toArray()
      .forEach((sid, i) => {
        const ym = slides.get(sid);
        if (!ym) return;
        for (const e of readSlide(sid, ym).elements)
          if (e.type === 'image' && e.name === 'picture slot') out.push({ slide: i + 1, slideId: sid, elementId: e.id, prompt: e.alt ?? '', filled: !String(e.src ?? '').startsWith('data:image/svg+xml'), w: e.w, h: e.h });
      });
    return out;
  }

  /**
   * Pictures into slots: a file named after its slide ("slide 05.png", "trang-5.jpg", "05 vịnh.png") goes to that
   * slide's slot; the others fill the empty slots in order. Each picture is cropped to its slot's shape (like
   * "cover"), never stretched.
   */
  async fillSlots(actor: Actor, resourceId: string, files: { buffer: Buffer; mimetype: string; originalname: string }[]) {
    await this.requireEditor(actor, resourceId);
    const slots = await this.slotsOf(resourceId);
    if (!slots.length) throw new BadRequestException('This presentation has no picture slots — make one with AI → “Presentation with pictures”');
    const named = (f: { originalname: string }) => {
      const name = Buffer.from(f.originalname, 'latin1').toString('utf8');
      const m = /(?:slide|trang|page|ảnh|anh)[\s_-]*0*(\d{1,2})(?!\d)/i.exec(name) ?? /^0*(\d{1,2})(?!\d)/.exec(name);
      return { name, no: m ? Number(m[1]) : null };
    };
    const list = files.map((f) => ({ f, ...named(f) })).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    const taken = new Set<string>();
    const plan: { slot: (typeof slots)[number]; f: (typeof list)[number] }[] = [];
    for (const x of list.filter((x) => x.no !== null)) {
      const slot = slots.find((s) => s.slide === x.no && !taken.has(s.elementId));
      if (slot) (taken.add(slot.elementId), plan.push({ slot, f: x }));
      else x.no = null;
    }
    for (const x of list.filter((x) => x.no === null)) {
      const slot = slots.find((s) => !s.filled && !taken.has(s.elementId));
      if (!slot) break;
      taken.add(slot.elementId);
      plan.push({ slot, f: x });
    }
    const placed: { slide: number; elementId: string; slideId: string; url: string; crop: { l: number; t: number; r: number; b: number }; file: string }[] = [];
    for (const { slot, f } of plan) {
      if (!/^image\//i.test(f.f.mimetype)) continue;
      const png = await sharp(f.f.buffer).rotate().resize({ width: 2400, withoutEnlargement: true }).png().toBuffer().catch(() => null);
      if (!png) continue;
      const meta = await sharp(png).metadata();
      const pic = (meta.width ?? 1) / (meta.height ?? 1);
      const box = slot.w / slot.h;
      const crop = { l: 0, t: 0, r: 0, b: 0 };
      if (pic > box) crop.l = crop.r = Math.round(((1 - box / pic) / 2) * 1000) / 1000;
      else if (pic < box) crop.t = crop.b = Math.round(((1 - pic / box) / 2) * 1000) / 1000;
      placed.push({ slide: slot.slide, elementId: slot.elementId, slideId: slot.slideId, url: await this.store(actor, resourceId, png), crop, file: f.name });
    }
    await this.collab.transact(resourceId, { id: actor.id, name: actor.name }, (doc) => {
      const slides = doc.getMap<Y.Map<unknown>>(SLIDES_MAP);
      for (const p of placed) {
        const el = (slides.get(p.slideId)?.get('elements') as Y.Map<Y.Map<unknown>> | undefined)?.get(p.elementId);
        if (!el) continue;
        el.set('src', p.url);
        el.set('crop', p.crop);
      }
    });
    const left = slots.filter((s) => !s.filled && !placed.some((p) => p.elementId === s.elementId)).length;
    return { placed: placed.map((p) => ({ slide: p.slide, file: p.file })), left, unused: list.filter((x) => !placed.some((p) => p.file === x.name)).map((x) => x.name) };
  }

  async requireEditor(actor: Actor, resourceId: string) {
    const { row } = await this.perms.require(actor, resourceId, 'editor');
    if (row.type !== 'presentation') throw new BadRequestException('Pictures with editable text live in Slides');
    return row;
  }
}
