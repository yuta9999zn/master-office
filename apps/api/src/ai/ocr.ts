// Exact text boxes for the AI Image Studio (docs/ARCHITECTURE.md §81). A vision model (local Qwen2.5-VL, Gemini) reads
// the WORDS of a picture well, even in fancy lettering, but places small text badly; Tesseract (local, ~2 s) places
// every word to the pixel but misreads decorative type. So the model's lines are kept and each one is moved onto the
// run of Tesseract words that spells the same thing.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { Logger } from '@nestjs/common';
import sharp from 'sharp';
import { createWorker, type Worker } from 'tesseract.js';
import type { TextBox } from './images';

export interface OcrWord {
  text: string;
  box: TextBox;
  /** Tesseract's line: words are only joined within one. */
  line: number;
}

const log = new Logger('Ocr');
/** Language data is fetched once (Vietnamese + English, ~15 MB) and kept here. */
const CACHE = process.env.OCR_CACHE_DIR ?? join(process.cwd(), '.cache', 'tessdata');
let worker: Promise<Worker> | null = null;

function getWorker() {
  if (!worker) {
    mkdirSync(CACHE, { recursive: true });
    worker = createWorker(['vie', 'eng'], 1, { cachePath: CACHE }).catch((e: Error) => {
      worker = null;
      throw e;
    });
  }
  return worker;
}

/** Every word Tesseract finds, in pixels of `png`; [] when OCR is not available (no language data, offline). */
export async function ocrWords(png: Buffer): Promise<OcrWord[]> {
  try {
    const meta = await sharp(png).metadata();
    // Small pictures are read at 2× — Tesseract wants letters at least ~20 px tall.
    const k = (meta.width ?? 0) < 1400 ? 2 : 1;
    const input = k === 1 ? png : await sharp(png).resize({ width: (meta.width ?? 1) * k }).png().toBuffer();
    const w = await getWorker();
    const { data } = await w.recognize(input, {}, { blocks: true });
    const out: OcrWord[] = [];
    let line = 0;
    for (const b of data.blocks ?? [])
      for (const p of b.paragraphs)
        for (const l of p.lines) {
          line++;
          for (const wd of l.words) {
            if (!wd.text.trim()) continue;
            out.push({ text: wd.text, line, box: { x1: wd.bbox.x0 / k, y1: wd.bbox.y0 / k, x2: wd.bbox.x1 / k, y2: wd.bbox.y1 / k } });
          }
        }
    return out;
  } catch (e) {
    log.warn(`OCR unavailable: ${(e as Error).message}`);
    return [];
  }
}

/** Letters and digits only, without accents: "Tỏa sáng!" → "toasang". */
export const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9%]/g, '');

function lev(a: string, b: string) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[b.length];
}

/**
 * Moves each line onto the run of OCR words (within one OCR line) that spells it best; a line no run spells closely
 * enough keeps the model's box. Longer lines choose first, and a word is used once. Returns the lines (with `ink`
 * boxes where snapped) and how many were snapped.
 */
export function snapToWords<T extends { text: string; box: TextBox; ink?: boolean }>(lines: T[], words: OcrWord[], size: { w: number; h: number }): { lines: T[]; snapped: number } {
  if (!words.length) return { lines, snapped: 0 };
  const folded = words.map((w) => fold(w.text));
  const used = new Set<number>();
  const diag = Math.hypot(size.w, size.h);
  const out = [...lines];
  let snapped = 0;
  const order = lines.map((l, i) => i).sort((a, b) => fold(lines[b].text).length - fold(lines[a].text).length);
  for (const li of order) {
    const l = lines[li];
    const target = fold(l.text);
    if (!target) continue;
    const cx = (l.box.x1 + l.box.x2) / 2;
    const cy = (l.box.y1 + l.box.y2) / 2;
    let best: { score: number; from: number; to: number } | null = null;
    for (let i = 0; i < words.length; i++) {
      if (used.has(i) || !folded[i]) continue;
      let acc = '';
      let prev = i;
      for (let j = i; j < words.length && words[j].line === words[i].line && !used.has(j); j++) {
        if (!folded[j]) continue; // marks like "*" or "&)" add nothing and must not stretch the box
        // Words far apart (another column of the design) are not one line.
        if (j > i && words[j].box.x1 - words[prev].box.x2 > 2.5 * (words[prev].box.y2 - words[prev].box.y1)) break;
        prev = j;
        acc += folded[j];
        if (acc.length > target.length * 1.5 + 3) break;
        const sim = 1 - lev(acc, target) / Math.max(acc.length, target.length);
        // Short texts ("SPA", "30%", "31/10") must match exactly; longer ones may differ by a few letters.
        if (target.length <= 4 ? sim < 1 : sim < 0.72) continue;
        const run = words.slice(i, j + 1).filter((_, k) => folded[i + k]);
        const bx = { x1: Math.min(...run.map((w) => w.box.x1)), x2: Math.max(...run.map((w) => w.box.x2)), y1: Math.min(...run.map((w) => w.box.y1)), y2: Math.max(...run.map((w) => w.box.y2)) };
        const dist = Math.hypot((bx.x1 + bx.x2) / 2 - cx, (bx.y1 + bx.y2) / 2 - cy) / diag;
        const score = sim - dist * 0.6;
        if (!best || score > best.score) best = { score, from: i, to: j };
      }
    }
    if (!best) continue;
    const ws = words.slice(best.from, best.to + 1).filter((_, k) => folded[best!.from + k]);
    for (let k = best.from; k <= best.to; k++) used.add(k);
    out[li] = { ...l, ink: true, box: { x1: Math.min(...ws.map((w) => w.box.x1)), y1: Math.min(...ws.map((w) => w.box.y1)), x2: Math.max(...ws.map((w) => w.box.x2)), y2: Math.max(...ws.map((w) => w.box.y2)) } };
    snapped++;
  }
  return { lines: out, snapped };
}

/**
 * Font size and baseline from an ink box (the letters' own extent, as OCR gives it): how far the letters reach above
 * the baseline (accented capitals ~0.95 em, capitals/digits 0.72, x-height 0.52) and below it (descenders 0.21).
 */
export function inkMetrics(text: string, box: TextBox): { fontPx: number; baseline: number } {
  const t = text.normalize('NFD');
  const capAccent = /[A-ZĐ][̀-̛̉̑]/.test(t) || /[A-Z]̂[̀-̉]/.test(t);
  const tall = /[A-ZĐ0-9bdfhklt%/]/.test(t);
  const lowAccent = /[a-z][̀-̛̉̑]/.test(t);
  const top = capAccent ? 0.95 : tall ? (lowAccent ? 0.8 : 0.72) : lowAccent ? 0.78 : 0.52;
  const bottom = /[gjpqy]/.test(t) ? 0.21 : /̣/.test(t) ? 0.12 : 0.01;
  const fontPx = (box.y2 - box.y1) / (top + bottom);
  return { fontPx, baseline: box.y2 - bottom * fontPx };
}
