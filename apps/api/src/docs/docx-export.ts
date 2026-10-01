import { DEFAULT_PAGE_SETUP, headingsOf, PAPER, type JSONContent, type PageSetup } from '@workos/doc-model';
import {
  AlignmentType,
  DeletedTextRun,
  Footer,
  Header,
  InsertedTextRun,
  PageBreak,
  PageNumber,
  PageOrientation,
  TableOfContents,
  BorderStyle,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type IRunOptions,
  type ParagraphChild,
} from 'docx';

/** Internal document JSON → Office Open XML (.docx). docs/ARCHITECTURE.md §8. */

export interface DocxImage {
  data: Buffer;
  type: 'png' | 'jpg' | 'gif' | 'bmp';
  width: number;
  height: number;
}

type Block = Paragraph | Table | TableOfContents;

const HEADINGS = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4];
const ALIGN: Record<string, (typeof AlignmentType)[keyof typeof AlignmentType]> = {
  left: AlignmentType.LEFT,
  center: AlignmentType.CENTER,
  right: AlignmentType.RIGHT,
  justify: AlignmentType.JUSTIFIED,
};
const MAX_IMAGE_WIDTH = 600;

/** "#2563eb" | "rgb(37, 99, 235)" | "2563EB" → "2563EB" */
function hex(color: unknown): string | undefined {
  if (typeof color !== 'string' || !color) return undefined;
  const rgb = color.match(/rgba?\((\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (rgb) return rgb.slice(1, 4).map((n) => Number(n).toString(16).padStart(2, '0')).join('').toUpperCase();
  const h = color.replace('#', '');
  if (/^[0-9a-f]{3}$/i.test(h)) return h.split('').map((c) => c + c).join('').toUpperCase();
  return /^[0-9a-f]{6}$/i.test(h) ? h.toUpperCase() : undefined;
}

/** CSS font size → docx half-points. */
function halfPoints(size: unknown): number | undefined {
  if (typeof size !== 'string') return undefined;
  const n = parseFloat(size);
  if (!n) return undefined;
  const pt = size.endsWith('pt') ? n : n * 0.75;
  return Math.round(pt * 2);
}

class DocxWriter {
  private orderedInstance = 0;
  private revisionId = 1;
  constructor(
    private readonly images: Map<string, DocxImage>,
    private readonly headings: { level: number; text: string }[],
  ) {}

  runs(nodes: JSONContent[] | undefined, base: Partial<IRunOptions> = {}): ParagraphChild[] {
    const out: ParagraphChild[] = [];
    for (const n of nodes ?? []) {
      if (n.type === 'hardBreak') {
        out.push(new TextRun({ break: 1 }));
        continue;
      }
      if (n.type === 'mention') {
        out.push(new TextRun({ ...base, text: `@${n.attrs?.label ?? n.attrs?.id ?? ''}`, color: '2563EB' }));
        continue;
      }
      if (n.type === 'image') {
        const img = this.image(n);
        if (img) out.push(img);
        continue;
      }
      if (n.type !== 'text') continue;
      const opts: Record<string, unknown> = { ...base, text: n.text ?? '' };
      let link: string | undefined;
      let revision: { kind: string; author: string; date: string } | undefined;
      for (const m of n.marks ?? []) {
        switch (m.type) {
          case 'bold':
            opts.bold = true;
            break;
          case 'italic':
            opts.italics = true;
            break;
          case 'underline':
            opts.underline = {};
            break;
          case 'strike':
            opts.strike = true;
            break;
          case 'code':
            opts.font = 'Consolas';
            opts.shading = { type: ShadingType.CLEAR, fill: 'F1F5F9', color: 'auto' };
            break;
          case 'highlight':
            opts.shading = { type: ShadingType.CLEAR, fill: hex(m.attrs?.color) ?? 'FEF08A', color: 'auto' };
            break;
          case 'textStyle':
            if (hex(m.attrs?.color)) opts.color = hex(m.attrs?.color);
            if (m.attrs?.fontFamily) opts.font = String(m.attrs.fontFamily).split(',')[0].replace(/['"]/g, '').trim();
            if (halfPoints(m.attrs?.fontSize)) opts.size = halfPoints(m.attrs?.fontSize);
            if (hex(m.attrs?.backgroundColor)) opts.shading = { type: ShadingType.CLEAR, fill: hex(m.attrs?.backgroundColor), color: 'auto' };
            break;
          case 'link':
            link = String(m.attrs?.href ?? '');
            break;
          case 'subscript':
            opts.subScript = true;
            break;
          case 'superscript':
            opts.superScript = true;
            break;
          case 'insertion':
          case 'deletion':
            revision = { kind: m.type, author: String(m.attrs?.authorName ?? 'Master Office'), date: String(m.attrs?.at ?? new Date().toISOString()) };
            break;
        }
      }
      if (revision) {
        // Real Word track changes: the reviewer can Accept / Reject them in Word.
        const rev = { ...(opts as IRunOptions), id: this.revisionId++, author: revision.author, date: revision.date };
        out.push(revision.kind === 'insertion' ? new InsertedTextRun(rev) : new DeletedTextRun(rev));
      } else if (link) out.push(new ExternalHyperlink({ link, children: [new TextRun({ ...(opts as IRunOptions), style: 'Hyperlink' })] }));
      else out.push(new TextRun(opts as IRunOptions));
    }
    return out;
  }

  /** Table cells hold paragraphs and tables only. */
  private cellBlocks(nodes: JSONContent[] | undefined): (Paragraph | Table)[] {
    return this.blocks(nodes).filter((b): b is Paragraph | Table => !(b instanceof TableOfContents));
  }

  private image(n: JSONContent): ImageRun | null {
    const img = this.images.get(String(n.attrs?.src ?? ''));
    if (!img) return null;
    const scale = Math.min(1, MAX_IMAGE_WIDTH / img.width);
    return new ImageRun({ type: img.type, data: img.data, transformation: { width: Math.round(img.width * scale), height: Math.round(img.height * scale) } });
  }

  blocks(nodes: JSONContent[] | undefined, ctx: { indent?: number; list?: { reference: string; level: number; instance?: number } } = {}): Block[] {
    const out: Block[] = [];
    for (const n of nodes ?? []) out.push(...this.block(n, ctx));
    return out;
  }

  private block(n: JSONContent, ctx: { indent?: number; list?: { reference: string; level: number; instance?: number } }): Block[] {
    const alignment = n.attrs?.textAlign ? ALIGN[n.attrs.textAlign] : undefined;
    const indent = ctx.indent ? { left: ctx.indent } : undefined;
    const a = n.attrs ?? {};
    const spacing =
      a.lineHeight || a.spaceBefore != null || a.spaceAfter != null
        ? {
            ...(a.lineHeight ? { line: Math.round(Number(a.lineHeight) * 240) } : {}),
            ...(a.spaceBefore != null ? { before: Math.round(Number(a.spaceBefore) * 20) } : {}),
            ...(a.spaceAfter != null ? { after: Math.round(Number(a.spaceAfter) * 20) } : {}),
          }
        : undefined;
    switch (n.type) {
      case 'paragraph':
        if (n.attrs?.docStyle === 'title') return [new Paragraph({ heading: HeadingLevel.TITLE, children: this.runs(n.content), alignment, spacing })];
        if (n.attrs?.docStyle === 'subtitle') return [new Paragraph({ children: this.runs(n.content, { size: 28, color: '64748B' }), alignment, spacing })];
        return [new Paragraph({ children: this.runs(n.content), alignment, indent, numbering: ctx.list, spacing })];
      case 'heading':
        return [new Paragraph({ heading: HEADINGS[(n.attrs?.level ?? 1) - 1] ?? HeadingLevel.HEADING_4, children: this.runs(n.content), alignment, spacing })];
      case 'pageBreak':
        return [new Paragraph({ children: [new PageBreak()] })];
      case 'tableOfContents': {
        const max = Number(n.attrs?.maxLevel ?? 3);
        // A real Word TOC field; cached entries show until the reader updates fields (F9) to add page numbers.
        return [
          new TableOfContents('Table of contents', {
            hyperlink: true,
            headingStyleRange: `1-${max}`,
            cachedEntries: this.headings.filter((h) => h.level <= max).map((h) => ({ title: h.text, level: h.level })),
          }),
        ];
      }
      case 'bulletList':
      case 'orderedList': {
        const level = ctx.list ? ctx.list.level + 1 : 0;
        const reference = n.type === 'bulletList' ? 'mo-bullets' : 'mo-numbers';
        const instance = n.type === 'orderedList' && level === 0 ? ++this.orderedInstance : ctx.list?.instance;
        return (n.content ?? []).flatMap((item) => this.listItem(item, { reference, level, instance }));
      }
      case 'taskList':
        return (n.content ?? []).flatMap((item) => {
          const [first, ...rest] = item.content ?? [];
          const box = new TextRun({ text: item.attrs?.checked ? '☒ ' : '☐ ', font: 'Segoe UI Symbol' });
          return [
            new Paragraph({
              children: [box, ...this.runs(first?.content), ...(item.attrs?.due ? [new TextRun({ text: ` — due ${item.attrs.due}`, color: '64748B' })] : [])],
              indent: { left: (ctx.indent ?? 0) + 360 },
            }),
            ...this.blocks(rest, { indent: (ctx.indent ?? 0) + 720 }),
          ];
        });
      case 'blockquote':
        return (n.content ?? []).flatMap((c) =>
          this.block(c, { indent: (ctx.indent ?? 0) + 567 }).map((b) =>
            b instanceof Paragraph && c.type === 'paragraph'
              ? new Paragraph({
                  children: this.runs(c.content, { italics: true, color: '475569' }),
                  indent: { left: (ctx.indent ?? 0) + 567 },
                  border: { left: { style: BorderStyle.SINGLE, size: 12, color: 'CBD5E1', space: 8 } },
                })
              : b,
          ),
        );
      case 'codeBlock': {
        const text = (n.content ?? []).map((c) => c.text ?? '').join('');
        return text.split('\n').map(
          (line) =>
            new Paragraph({
              children: [new TextRun({ text: line || ' ', font: 'Consolas', size: 19 })],
              shading: { type: ShadingType.CLEAR, fill: 'F1F5F9', color: 'auto' },
              spacing: { before: 0, after: 0 },
            }),
        );
      }
      case 'resourceEmbed':
        return [
          new Paragraph({
            children: [new TextRun({ text: '📎 ' }), new TextRun({ text: String(n.attrs?.name ?? 'Linked file'), bold: true })],
            border: { top: { style: BorderStyle.SINGLE, size: 4, color: 'E6EAF0', space: 4 }, bottom: { style: BorderStyle.SINGLE, size: 4, color: 'E6EAF0', space: 4 } },
          }),
        ];
      case 'horizontalRule':
        return [new Paragraph({ children: [], border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'D7DDE6', space: 1 } } })];
      case 'image': {
        const img = this.image(n);
        return img ? [new Paragraph({ children: [img], alignment: AlignmentType.CENTER })] : [];
      }
      case 'callout':
        return [
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              new TableRow({
                children: [
                  new TableCell({
                    children: this.cellBlocks(n.content),
                    shading: { type: ShadingType.CLEAR, fill: 'EFF5FF', color: 'auto' },
                    margins: { top: 120, bottom: 120, left: 200, right: 200 },
                    borders: {
                      top: { style: BorderStyle.SINGLE, size: 6, color: 'DBE7FE' },
                      bottom: { style: BorderStyle.SINGLE, size: 6, color: 'DBE7FE' },
                      left: { style: BorderStyle.SINGLE, size: 6, color: 'DBE7FE' },
                      right: { style: BorderStyle.SINGLE, size: 6, color: 'DBE7FE' },
                    },
                  }),
                ],
              }),
            ],
          }),
          new Paragraph({ children: [] }),
        ];
      case 'table':
        return [
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: (n.content ?? []).map(
              (row) =>
                new TableRow({
                  tableHeader: row.content?.every((c) => c.type === 'tableHeader'),
                  children: (row.content ?? []).map((cell) => {
                    const header = cell.type === 'tableHeader';
                    const content = header
                      ? (cell.content ?? []).map((p) => new Paragraph({ children: this.runs(p.content, { bold: true }), alignment: p.attrs?.textAlign ? ALIGN[p.attrs.textAlign] : undefined }))
                      : this.cellBlocks(cell.content);
                    return new TableCell({
                      children: content.length ? content : [new Paragraph({ children: [] })],
                      columnSpan: (cell.attrs?.colspan ?? 1) > 1 ? cell.attrs!.colspan : undefined,
                      rowSpan: (cell.attrs?.rowspan ?? 1) > 1 ? cell.attrs!.rowspan : undefined,
                      shading: header ? { type: ShadingType.CLEAR, fill: 'EEF4FF', color: 'auto' } : undefined,
                      margins: { top: 60, bottom: 60, left: 100, right: 100 },
                    });
                  }),
                }),
            ),
          }),
          new Paragraph({ children: [] }),
        ];
      default:
        return this.blocks(n.content, ctx);
    }
  }

  private listItem(item: JSONContent, list: { reference: string; level: number; instance?: number }): Block[] {
    const out: Block[] = [];
    let first = true;
    for (const c of item.content ?? []) {
      if (c.type === 'bulletList' || c.type === 'orderedList') out.push(...this.block(c, { list }));
      else if (c.type === 'paragraph' && first) {
        out.push(new Paragraph({ children: this.runs(c.content), numbering: { reference: list.reference, level: list.level, instance: list.instance } }));
        first = false;
      } else out.push(...this.block(c, { indent: 720 * (list.level + 1) }));
    }
    return out;
  }

}

const bulletLevels = ['•', '◦', '▪', '•', '◦', '▪', '•', '◦', '▪'];
const numberFormats = [LevelFormat.DECIMAL, LevelFormat.LOWER_LETTER, LevelFormat.LOWER_ROMAN];

const mmToTwip = (mm: number) => Math.round(mm * 56.6929);

/** Header/footer paragraph with {page} {pages} {title} {date} turned into live Word fields. */
function headerFooter(text: string, align: PageSetup['headerAlign'], title: string) {
  const children: ParagraphChild[] = [];
  for (const part of text.split(/(\{page\}|\{pages\}|\{title\}|\{date\})/)) {
    if (!part) continue;
    if (part === '{page}') children.push(new TextRun({ children: [PageNumber.CURRENT], color: '64748B', size: 18 }));
    else if (part === '{pages}') children.push(new TextRun({ children: [PageNumber.TOTAL_PAGES], color: '64748B', size: 18 }));
    else children.push(new TextRun({ text: part === '{title}' ? title : part === '{date}' ? new Date().toISOString().slice(0, 10) : part, color: '64748B', size: 18 }));
  }
  return new Paragraph({ children, alignment: ALIGN[align] });
}

export async function toDocx(
  title: string,
  doc: JSONContent,
  images: Map<string, DocxImage>,
  meta: { author?: string; pageSetup?: PageSetup } = {},
): Promise<Buffer> {
  const p = meta.pageSetup ?? DEFAULT_PAGE_SETUP;
  const paper = PAPER[p.size];
  const w = new DocxWriter(images, headingsOf(doc));
  const body = w.blocks(doc.content);
  const document = new Document({
    title,
    creator: meta.author ?? 'Master Office',
    description: 'Exported from Master Office',
    styles: {
      default: { document: { run: { font: 'Calibri', size: 22, color: '0F172A' }, paragraph: { spacing: { after: 120, line: 300 } } } },
    },
    numbering: {
      config: [
        {
          reference: 'mo-bullets',
          levels: bulletLevels.map((text, level) => ({
            level,
            format: LevelFormat.BULLET,
            text,
            alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } },
          })),
        },
        {
          reference: 'mo-numbers',
          levels: Array.from({ length: 9 }, (_, level) => ({
            level,
            format: numberFormats[level % 3],
            text: `%${level + 1}.`,
            alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } },
          })),
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            // docx expects portrait dimensions and swaps them for landscape.
            size: { width: mmToTwip(paper.w), height: mmToTwip(paper.h), orientation: p.orientation === 'landscape' ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT },
            margin: { top: mmToTwip(p.margins.top), right: mmToTwip(p.margins.right), bottom: mmToTwip(p.margins.bottom), left: mmToTwip(p.margins.left) },
          },
        },
        headers: p.header ? { default: new Header({ children: [headerFooter(p.header, p.headerAlign, title)] }) } : undefined,
        footers: p.footer ? { default: new Footer({ children: [headerFooter(p.footer, p.footerAlign, title)] }) } : undefined,
        children: [new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun({ text: title })] }), ...body],
      },
    ],
  });
  return Packer.toBuffer(document);
}

/** Reads pixel dimensions from PNG / JPEG / GIF / BMP headers (no image library needed). */
export function imageInfo(buf: Buffer): Omit<DocxImage, 'data'> | null {
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) return { type: 'png', width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  if (buf.length > 10 && buf.toString('ascii', 0, 3) === 'GIF') return { type: 'gif', width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
  if (buf.length > 26 && buf.toString('ascii', 0, 2) === 'BM') return { type: 'bmp', width: buf.readInt32LE(18), height: Math.abs(buf.readInt32LE(22)) };
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i < buf.length) {
      if (buf[i] !== 0xff) return null;
      const marker = buf[i + 1];
      const len = buf.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { type: 'jpg', height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
      }
      i += 2 + len;
    }
  }
  return null;
}
