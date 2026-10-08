import { BadRequestException, Injectable } from '@nestjs/common';
import { blankDeck, deckToHtmlDocument, readDeck, writeDeck, type PlainDeck } from '@workos/slide-model';
import JSZip from 'jszip';
import sharp from 'sharp';
import * as Y from 'yjs';
import { CollabService } from '../collab/collab.service';
import { DocStore } from '../docs/doc-store';
import { PdfRenderer } from '../docs/pdf-renderer';
import { exportPptx, type ImageLoader } from './pptx-export';
import { importPptx, type ImageStore, type PptxImportReport } from './pptx-import';

export type SlideExportFormat = 'pptx' | 'pdf' | 'png' | 'jpg' | 'html';

export const SLIDE_EXPORT_MIME: Record<SlideExportFormat, string> = {
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  html: 'text/html; charset=utf-8',
};

/** 300 dpi on a 96-px-per-inch canvas. */
export const PRINT_SCALE = 3.125;
/** Pictures are kept under ~40 megapixels: a big format asked at 4× comes back smaller. */
export function pictureScale(size: { w: number; h: number }, want: number): number {
  const max = Math.sqrt(40_000_000 / (size.w * size.h));
  return Math.max(0.25, Math.min(want, max >= want ? want : Math.floor(max * 4) / 4));
}

export const deckBaseName = (name: string) => name.replace(/\.(pptx?|odp|key)$/i, '');

/** Every image a deck references (elements and backgrounds). */
export function deckImages(deck: PlainDeck): string[] {
  const out = new Set<string>();
  for (const s of deck.slides) {
    if (s.meta.background?.type === 'image') out.add(s.meta.background.src);
    for (const e of s.elements) if (e.type === 'image' && e.src) out.add(e.src);
  }
  return [...out];
}

/** Presentations on the collaborative store: create, import, export, restore (docs/ARCHITECTURE.md §23). */
@Injectable()
export class SlidesService {
  constructor(
    private readonly store: DocStore,
    private readonly collab: CollabService,
    private readonly pdf: PdfRenderer,
  ) {}

  static stateOf(deck: PlainDeck) {
    const doc = new Y.Doc();
    writeDeck(doc, deck);
    return { doc, state: Y.encodeStateAsUpdate(doc) };
  }

  static preview(state: Uint8Array): PlainDeck {
    const doc = new Y.Doc();
    Y.applyUpdate(doc, state);
    return readDeck(doc);
  }

  /** The server creates every presentation's containers (new, imported, seeded, copied); clients never do. */
  async init(id: string, name: string, deck: PlainDeck = blankDeck(name)) {
    const { doc, state } = SlidesService.stateOf(deck);
    await this.store.save(id, state, doc, null);
  }

  async deck(id: string, name = 'Presentation'): Promise<PlainDeck> {
    const state = await this.collab.currentState(id);
    if (!state?.length) return blankDeck(name);
    const deck = SlidesService.preview(state);
    return deck.slides.length ? deck : blankDeck(name);
  }

  async importFile(id: string, buf: Buffer, fileName: string, storeImage: ImageStore, editor: { id: string; name: string }): Promise<PptxImportReport & { status: string }> {
    const ext = fileName.split('.').pop()?.toLowerCase();
    if (ext !== 'pptx') {
      throw new BadRequestException(
        ext === 'ppt' || ext === 'odp' || ext === 'key'
          ? `.${ext} presentations need the LibreOffice converter (not installed on this server). Save as .pptx and upload again.`
          : `.${ext} import is not supported yet.`,
      );
    }
    const { deck, report } = await importPptx(buf, fileName, storeImage);
    deck.name = fileName;
    await this.collab.replaceDeck(id, deck, editor);
    return { status: 'done', ...report };
  }

  replace(id: string, deck: PlainDeck, editor: { id: string; name: string }) {
    return this.collab.replaceDeck(id, deck, editor);
  }

  async export(id: string, name: string, format: SlideExportFormat, loadImage: ImageLoader, opts: { author?: string; slide?: number; scale?: number } = {}) {
    const deck = await this.deck(id, name);
    const title = deckBaseName(name);
    if (format === 'pptx') {
      const { buffer } = await exportPptx(deck, loadImage, { author: opts.author, title });
      return { name: `${title}.pptx`, mime: SLIDE_EXPORT_MIME.pptx, body: buffer };
    }
    // HTML-based formats inline every picture so the file (or headless Chromium) never needs our API.
    const inline = new Map<string, string>();
    for (const src of deckImages(deck)) {
      const img = await loadImage(src);
      if (img) inline.set(src, `data:${img.mime};base64,${img.data.toString('base64')}`);
    }
    const resolveSrc = (src: string) => inline.get(src) ?? src;
    if (format === 'png' || format === 'jpg') {
      // Slides are laid out at 96 px per inch: scale 3.125 is print quality (300 dpi), and the file says so.
      const scale = pictureScale(deck.size, opts.scale ?? 2);
      const picture = async (png: Buffer) => {
        const img = sharp(png).withMetadata({ density: Math.round(96 * scale) });
        return format === 'jpg' ? img.flatten({ background: '#ffffff' }).jpeg({ quality: 92, mozjpeg: true }).toBuffer() : img.png().toBuffer();
      };
      const tag = scale === 2 ? '' : ` @${scale === PRINT_SCALE ? '300dpi' : `${scale}x`}`;
      if (opts.slide !== undefined) {
        if (opts.slide < 0 || opts.slide >= deck.slides.length) throw new BadRequestException(`Slide ${opts.slide + 1} does not exist`);
        const [png] = await this.pdf.screenshots(deckToHtmlDocument(deck, { resolveSrc, only: opts.slide }), deck.size, scale);
        const one = deck.slides.length === 1 ? title : `${title} - slide ${opts.slide + 1}`;
        return { name: `${one}${tag}.${format}`, mime: SLIDE_EXPORT_MIME[format], body: await picture(png) };
      }
      const pngs = await this.pdf.screenshots(deckToHtmlDocument(deck, { resolveSrc, includeHidden: true }), deck.size, scale);
      const zip = new JSZip();
      for (const [i, p] of pngs.entries()) zip.file(`${title} - slide ${String(i + 1).padStart(2, '0')}${tag}.${format}`, await picture(p));
      return { name: `${title} (slides).zip`, mime: 'application/zip', body: await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }) };
    }
    const html = deckToHtmlDocument(deck, { resolveSrc, title });
    if (format === 'html') return { name: `${title}.html`, mime: SLIDE_EXPORT_MIME.html, body: Buffer.from(html, 'utf8') };
    return { name: `${title}.pdf`, mime: SLIDE_EXPORT_MIME.pdf, body: await this.pdf.render(html, { title }) };
  }
}
