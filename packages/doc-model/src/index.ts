// Internal document model shared by the browser editor and the server (import/export, search, seeding).
// docs/ARCHITECTURE.md §7.1 — ProseMirror schema + Yjs XmlFragment `default`.
import { Extension, Mark, mergeAttributes, Node, type Extensions, type JSONContent } from '@tiptap/core';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';
import Highlight from '@tiptap/extension-highlight';
import Image from '@tiptap/extension-image';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import Mention, { type MentionOptions } from '@tiptap/extension-mention';
import { TableKit } from '@tiptap/extension-table';
import TextAlign from '@tiptap/extension-text-align';
import { TextStyleKit } from '@tiptap/extension-text-style';
import StarterKit from '@tiptap/starter-kit';

export type { JSONContent };
import { Bookmark, DateChip, DropdownChip, formatChipDate, PlaceChip, placeUrl, type DropdownOption, PlaceholderChip, EventChip, eventLabel, type EventInfo } from './chips';
export * from './chips';
import { Equation, equationHtml, Footnote, footnotesOf } from './notes-math';
export * from './notes-math';
export * from './tabs';
import { Column, Columns } from './columns-md';
import { Bibliography, Citation } from './citations';
export * from './columns-md';
import { chartText, DocChart, type ChartPainter, type DocChartSpec } from './doc-chart';
export * from './doc-chart';
export * from './compare';
export * from './templates';
export * from './citations';
export * from './spelling';

/** Yjs field holding the document body (Tiptap Collaboration default). */
export const COLLAB_FIELD = 'default';

/** A tinted box for key points ("Key Goals" in the reference Docs screen). */
export const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,
  addAttributes() {
    return { tone: { default: 'info', parseHTML: (el) => el.getAttribute('data-tone') ?? 'info', renderHTML: (a) => ({ 'data-tone': a.tone }) } };
  },
  parseHTML() {
    return [{ tag: 'div[data-callout]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-callout': '', class: 'mo-callout' }), 0];
  },
});

/**
 * A live card for another resource (file, sheet, deck…). Stores only the resource_id — the card renders
 * current name/type/size from Drive, so there is never a copy (docs/ARCHITECTURE.md §9–10).
 */
export const ResourceEmbed = Node.create({
  name: 'resourceEmbed',
  group: 'block',
  atom: true,
  draggable: true,
  addAttributes() {
    return {
      id: { default: null, parseHTML: (el) => el.getAttribute('data-resource-id'), renderHTML: (a) => ({ 'data-resource-id': a.id }) },
      name: { default: '', parseHTML: (el) => el.getAttribute('data-name') ?? el.textContent ?? '', renderHTML: (a) => ({ 'data-name': a.name }) },
      type: { default: 'file', parseHTML: (el) => el.getAttribute('data-type') ?? 'file', renderHTML: (a) => ({ 'data-type': a.type }) },
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-resource-embed]' }];
  },
  renderHTML({ HTMLAttributes, node }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-resource-embed': '', class: 'mo-embed' }), node.attrs.name || 'Linked file'];
  },
});

/** Task metadata used by Notes: assignee (user id) and due date on checklist items. */
export const TaskItemWithMeta = TaskItem.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      assignee: { default: null, parseHTML: (el) => el.getAttribute('data-assignee'), renderHTML: (a) => (a.assignee ? { 'data-assignee': a.assignee } : {}) },
      due: { default: null, parseHTML: (el) => el.getAttribute('data-due'), renderHTML: (a) => (a.due ? { 'data-due': a.due } : {}) },
    };
  },
});

// ── Phase 2b: Notes ──────────────────────────────────────────────────────────

/**
 * Inline link to another page/resource ("[[Page]]"). Stores the resource_id; powers "Linked pages" and backlinks.
 */
export const ResourceLink = Node.create({
  name: 'resourceLink',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      id: { default: null, parseHTML: (el) => el.getAttribute('data-resource-id'), renderHTML: (a) => ({ 'data-resource-id': a.id }) },
      name: { default: '', parseHTML: (el) => el.getAttribute('data-name') ?? el.textContent ?? '', renderHTML: (a) => ({ 'data-name': a.name }) },
      type: { default: 'document', parseHTML: (el) => el.getAttribute('data-type') ?? 'document', renderHTML: (a) => ({ 'data-type': a.type }) },
    };
  },
  parseHTML() {
    return [{ tag: 'span[data-resource-link]' }];
  },
  renderHTML({ HTMLAttributes, node }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-resource-link': '', class: 'mo-page-link' }), node.attrs.name || 'Untitled'];
  },
  renderText: ({ node }) => node.attrs.name,
});

export const STATUS_COLORS: Record<string, string> = {
  green: '#16a34a',
  amber: '#d97706',
  red: '#dc2626',
  blue: '#2563eb',
  gray: '#64748b',
};

/** Coloured status pill ("● On track") used in notes and tables. */
export const StatusPill = Node.create({
  name: 'status',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      label: { default: 'On track', parseHTML: (el) => el.getAttribute('data-label') ?? el.textContent, renderHTML: (a) => ({ 'data-label': a.label }) },
      color: { default: 'green', parseHTML: (el) => el.getAttribute('data-color') ?? 'green', renderHTML: (a) => ({ 'data-color': a.color }) },
    };
  },
  parseHTML() {
    return [{ tag: 'span[data-status]' }];
  },
  renderHTML({ HTMLAttributes, node }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-status': '', class: `mo-status mo-status-${node.attrs.color}` }), node.attrs.label];
  },
  renderText: ({ node }) => `● ${node.attrs.label}`,
});

/** Resource ids a document points to — for "Linked pages", "Related files" and backlinks. */
export function linksOf(doc: JSONContent | null | undefined): { id: string; kind: 'link' | 'embed' | 'mention-page' }[] {
  const out = new Map<string, 'link' | 'embed' | 'mention-page'>();
  const walk = (n: JSONContent) => {
    if (n.type === 'resourceLink' && n.attrs?.id) out.set(n.attrs.id, out.get(n.attrs.id) ?? 'link');
    if (n.type === 'resourceEmbed' && n.attrs?.id) out.set(n.attrs.id, 'embed');
    for (const m of n.marks ?? []) {
      const href = m.type === 'link' ? String(m.attrs?.href ?? '') : '';
      const hit = href.match(/\/(?:docs|sheets|slides|wiki|notes|base|preview|drive\/folder)\/([0-9a-f-]{36})/);
      if (hit) out.set(hit[1], out.get(hit[1]) ?? 'link');
    }
    n.content?.forEach(walk);
  };
  doc?.content?.forEach(walk);
  return [...out].map(([id, kind]) => ({ id, kind }));
}

// ── Phase 2.1: Word-parity structure ────────────────────────────────────────

/** Hard page break (Word: Ctrl+Enter). */
export const PageBreak = Node.create({
  name: 'pageBreak',
  group: 'block',
  atom: true,
  selectable: true,
  parseHTML() {
    return [{ tag: 'div[data-page-break]' }];
  },
  renderHTML() {
    return ['div', { 'data-page-break': '', class: 'mo-page-break' }];
  },
});

/** Table of contents generated from the document's headings (live in the editor, a real TOC field in Word). */
export const TableOfContents = Node.create({
  name: 'tableOfContents',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() {
    return { maxLevel: { default: 3, parseHTML: (el) => Number(el.getAttribute('data-max-level') ?? 3), renderHTML: (a) => ({ 'data-max-level': a.maxLevel }) } };
  },
  parseHTML() {
    return [{ tag: 'nav[data-toc]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['nav', mergeAttributes(HTMLAttributes, { 'data-toc': '', class: 'mo-toc' }), 'Table of contents'];
  },
});

export const LINE_HEIGHTS = ['1', '1.15', '1.5', '2', '2.5', '3'];

/** Format → Text → Small caps (a mark, so it exports as Word's small caps). §56. */
export const SmallCaps = Mark.create({
  name: 'smallCaps',
  parseHTML: () => [{ tag: 'span[data-small-caps]' }, { style: 'font-variant=small-caps' }, { style: 'font-variant-caps=small-caps' }],
  renderHTML: ({ HTMLAttributes }) => ['span', mergeAttributes(HTMLAttributes, { 'data-small-caps': '', style: 'font-variant:small-caps' }), 0],
});

/**
 * Paragraph formatting from Word's Paragraph group: line spacing, space before/after (pt) and the Title / Subtitle styles.
 * Stored as node attributes so they survive collaboration and export 1:1.
 */
export const ParagraphFormat = Extension.create({
  name: 'paragraphFormat',
  addGlobalAttributes() {
    return [
      {
        types: ['paragraph', 'heading'],
        attributes: {
          lineHeight: {
            default: null,
            parseHTML: (el) => el.style.lineHeight || null,
            renderHTML: (a) => (a.lineHeight ? { style: `line-height:${a.lineHeight}` } : {}),
          },
          spaceBefore: {
            default: null,
            parseHTML: (el) => (el.style.marginTop.endsWith('pt') ? parseFloat(el.style.marginTop) : null),
            renderHTML: (a) => (a.spaceBefore != null ? { style: `margin-top:${a.spaceBefore}pt` } : {}),
          },
          spaceAfter: {
            default: null,
            parseHTML: (el) => (el.style.marginBottom.endsWith('pt') ? parseFloat(el.style.marginBottom) : null),
            renderHTML: (a) => (a.spaceAfter != null ? { style: `margin-bottom:${a.spaceAfter}pt` } : {}),
          },
          // Format → Align & indent → Indentation options (points; firstLine < 0 = hanging). §56.
          indentLeft: {
            default: null,
            parseHTML: (el) => (el.style.marginLeft.endsWith('pt') ? parseFloat(el.style.marginLeft) : null),
            renderHTML: (a) => (a.indentLeft ? { style: `margin-left:${a.indentLeft}pt` } : {}),
          },
          indentRight: {
            default: null,
            parseHTML: (el) => (el.style.marginRight.endsWith('pt') ? parseFloat(el.style.marginRight) : null),
            renderHTML: (a) => (a.indentRight ? { style: `margin-right:${a.indentRight}pt` } : {}),
          },
          firstLine: {
            default: null,
            parseHTML: (el) => (el.style.textIndent.endsWith('pt') ? parseFloat(el.style.textIndent) : null),
            // A hanging indent pulls the first line out: the paragraph needs at least that much left indent.
            renderHTML: (a) => (a.firstLine ? { style: `text-indent:${a.firstLine}pt${a.firstLine < 0 && !a.indentLeft ? `;margin-left:${-a.firstLine}pt` : ''}` } : {}),
          },
          // Borders and shading (Format → Paragraph styles → Borders and shading).
          shading: {
            default: null,
            parseHTML: (el) => el.getAttribute('data-shading'),
            renderHTML: (a) => (a.shading ? { 'data-shading': a.shading } : {}),
          },
          border: {
            default: null,
            parseHTML: (el) => el.getAttribute('data-border'),
            renderHTML: (a) => (a.border ? { 'data-border': a.border } : {}),
          },
          borderColor: { default: null, parseHTML: (el) => el.getAttribute('data-border-color'), renderHTML: (a) => (a.borderColor ? { 'data-border-color': a.borderColor } : {}) },
          borderWidth: { default: null, parseHTML: (el) => Number(el.getAttribute('data-border-width')) || null, renderHTML: (a) => (a.borderWidth ? { 'data-border-width': a.borderWidth } : {}) },
          boxStyle: {
            // Not stored: turns the attributes above into CSS for the editor.
            default: null,
            parseHTML: () => null,
            renderHTML: (a) => {
              const css = borderShadingCss(a);
              return css ? { style: css } : {};
            },
          },
        },
      },
      {
        types: ['paragraph'],
        attributes: {
          docStyle: {
            default: null,
            parseHTML: (el) => el.getAttribute('data-style'),
            renderHTML: (a) => (a.docStyle ? { 'data-style': a.docStyle, class: `mo-style-${a.docStyle}` } : {}),
          },
        },
      },
    ];
  },
});

export type BorderSides = 'all' | 'left' | 'top' | 'bottom' | 'topBottom';

/** CSS for a paragraph's borders and shading (editor, HTML / PDF export). */
export function borderShadingCss(a: Record<string, unknown>): string {
  const out: string[] = [];
  const sides = a.border as BorderSides | null;
  const width = Number(a.borderWidth) || 1;
  const color = (a.borderColor as string) || '#94a3b8';
  if (sides) {
    const line = `${width}px solid ${color}`;
    const map: Record<BorderSides, string[]> = { all: ['border'], left: ['border-left'], top: ['border-top'], bottom: ['border-bottom'], topBottom: ['border-top', 'border-bottom'] };
    for (const p of map[sides] ?? []) out.push(`${p}:${line}`);
  }
  if (a.shading) out.push(`background-color:${a.shading}`);
  if (sides || a.shading) out.push(sides === 'left' ? 'padding:2px 0 2px 10px' : 'padding:4px 8px');
  return out.join(';');
}

/** Attributes carried by suggestion marks (track changes). */
export interface SuggestionAttrs {
  id: string;
  authorId: string;
  authorName: string;
  color: string;
  at: string;
}

const suggestionAttributes = () => ({
  id: { default: null },
  authorId: { default: null },
  authorName: { default: null },
  color: { default: '#2563eb' },
  at: { default: null },
});

/** Suggested insertion (Word: inserted text with track changes on). */
export const Insertion = Mark.create({
  name: 'insertion',
  inclusive: false,
  excludes: 'deletion',
  addAttributes: suggestionAttributes,
  parseHTML() {
    return [{ tag: 'ins[data-suggestion]', getAttrs: (el) => JSON.parse((el as HTMLElement).getAttribute('data-suggestion') ?? '{}') }];
  },
  renderHTML({ mark }) {
    return ['ins', { 'data-suggestion': JSON.stringify(mark.attrs), class: 'mo-ins', style: `--suggest-color:${mark.attrs.color}` }, 0];
  },
});

/** Suggested deletion — the text stays visible (struck through) until someone accepts or rejects it. */
export const Deletion = Mark.create({
  name: 'deletion',
  inclusive: false,
  excludes: 'insertion',
  addAttributes: suggestionAttributes,
  parseHTML() {
    return [{ tag: 'del[data-suggestion]', getAttrs: (el) => JSON.parse((el as HTMLElement).getAttribute('data-suggestion') ?? '{}') }];
  },
  renderHTML({ mark }) {
    return ['del', { 'data-suggestion': JSON.stringify(mark.attrs), class: 'mo-del', style: `--suggest-color:${mark.attrs.color}` }, 0];
  },
});

// ── Document settings (page setup, header/footer) ────────────────────────────

/** Yjs map holding per-document settings, next to the body fragment. */
export const SETTINGS_MAP = 'settings';

export interface PageSetup {
  size: 'A4' | 'Letter' | 'Legal' | 'A5';
  orientation: 'portrait' | 'landscape';
  /** Margins in millimetres. */
  margins: { top: number; right: number; bottom: number; left: number };
  /** Plain text; tokens {page} {pages} {title} {date}. */
  header: string;
  footer: string;
  headerAlign: 'left' | 'center' | 'right';
  footerAlign: 'left' | 'center' | 'right';
  /** Pageless (Google Docs): no pages on screen, the text uses the window's width. Export is still paged. */
  pageless?: boolean;
  /** Watermark shown behind every page (print layout, PDF). */
  watermark?: Watermark | null;
  /** Tools → Line numbers: numbers every visual line in the margin (editor, PDF, DOCX). §56. */
  lineNumbers?: boolean;
}

export interface Watermark {
  text?: string;
  image?: string;
  opacity?: number; // 0..1
}

/** Diagonal text watermark as an SVG data URL sized to a page (w × h, any unit-free ratio). */
export function watermarkSvg(text: string, w: number, h: number, opacity = 0.15): string {
  const size = Math.min(w, h) / Math.max(4, text.length * 0.55);
  const escText = text.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><text x="50%" y="50%" text-anchor="middle" dominant-baseline="middle" font-family="Arial, sans-serif" font-weight="700" font-size="${size.toFixed(1)}" fill="#64748b" fill-opacity="${opacity}" transform="rotate(-35 ${w / 2} ${h / 2})">${escText}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** Paper sizes in millimetres (portrait). */
export const PAPER: Record<PageSetup['size'], { w: number; h: number }> = {
  A4: { w: 210, h: 297 },
  Letter: { w: 215.9, h: 279.4 },
  Legal: { w: 215.9, h: 355.6 },
  A5: { w: 148, h: 210 },
};

export const DEFAULT_PAGE_SETUP: PageSetup = {
  size: 'A4',
  orientation: 'portrait',
  margins: { top: 25.4, right: 25.4, bottom: 25.4, left: 25.4 },
  header: '',
  footer: '',
  headerAlign: 'left',
  footerAlign: 'center',
};

export function pageSetupOf(settings: Record<string, unknown> | null | undefined): PageSetup {
  const s = (settings?.pageSetup ?? {}) as Partial<PageSetup>;
  return { ...DEFAULT_PAGE_SETUP, ...s, margins: { ...DEFAULT_PAGE_SETUP.margins, ...(s.margins ?? {}) } };
}

export function paperSize(p: PageSetup) {
  const { w, h } = PAPER[p.size];
  return p.orientation === 'landscape' ? { w: h, h: w } : { w, h };
}

/** Expands header/footer tokens for renderers that know the page number. */
export function expandTokens(text: string, v: { page?: string | number; pages?: string | number; title: string; date?: string }) {
  return text
    .replaceAll('{page}', String(v.page ?? ''))
    .replaceAll('{pages}', String(v.pages ?? ''))
    .replaceAll('{title}', v.title)
    .replaceAll('{date}', v.date ?? new Date().toISOString().slice(0, 10));
}

/** Headings in document order — shared by the live TOC, the outline and exports. */
export function headingsOf(doc: JSONContent | null | undefined, maxLevel = 6): { level: number; text: string; index: number }[] {
  const out: { level: number; text: string; index: number }[] = [];
  let i = 0;
  const walk = (n: JSONContent) => {
    if (n.type === 'heading') {
      const level = n.attrs?.level ?? 1;
      if (level <= maxLevel) out.push({ level, text: toPlainText({ type: 'doc', content: [n] }), index: i });
      i++;
    } else n.content?.forEach(walk);
  };
  doc?.content?.forEach(walk);
  return out;
}

export interface DocExtensionOptions {
  /** Collaboration replaces the local undo history with Yjs undo. */
  collaboration?: boolean;
  mention?: Partial<MentionOptions>;
}

/** The schema-defining extensions. The browser adds editor-only behaviour (collab, carets, placeholder) on top. */
export function docExtensions(opts: DocExtensionOptions = {}): Extensions {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3, 4, 5, 6] },
      link: { openOnClick: false, autolink: true, HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: '_blank' } },
      ...(opts.collaboration ? { undoRedo: false as const } : {}),
    }),
    TextStyleKit,
    Highlight.configure({ multicolor: true }),
    TextAlign.configure({ types: ['heading', 'paragraph'] }),
    TaskList,
    TaskItemWithMeta.configure({ nested: true }),
    TableKit.configure({ table: { resizable: true } }),
    Image.configure({ inline: false, allowBase64: false }),
    Mention.configure({ HTMLAttributes: { class: 'mo-mention' }, ...opts.mention }),
    Callout,
    ResourceEmbed,
    Subscript,
    Superscript,
    PageBreak,
    TableOfContents,
    ParagraphFormat,
    SmallCaps,
    Insertion,
    Deletion,
    ResourceLink,
    StatusPill,
    DateChip,
    DropdownChip,
    PlaceChip,
    PlaceholderChip,
    EventChip,
    Citation,
    Bibliography,
    Bookmark,
    Footnote,
    Equation,
    Columns,
    Column,
    DocChart,
  ];
}

// ── Pure serializers (no DOM) ────────────────────────────────────────────────

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const isDeleted = (n: JSONContent) => !!n.marks?.some((m) => m.type === 'deletion');

/** Plain text of the document as it reads with all suggestions accepted (suggested deletions excluded). */
export function toPlainText(doc: JSONContent | null | undefined): string {
  const out: string[] = [];
  const walk = (n: JSONContent, depth = 0): string => {
    if (n.type === 'text') return isDeleted(n) ? '' : n.text ?? '';
    if (n.type === 'hardBreak') return '\n';
    if (n.type === 'mention') return `@${n.attrs?.label ?? n.attrs?.id ?? ''}`;
    if (n.type === 'image') return n.attrs?.alt ? `[${n.attrs.alt}]` : '';
    if (n.type === 'resourceLink') return n.attrs?.name ?? '';
    if (n.type === 'status') return `● ${n.attrs?.label ?? ''}`;
    if (n.type === 'dateChip') return formatChipDate(n.attrs?.date, n.attrs?.format);
    if (n.type === 'dropdownChip') return n.attrs?.value ?? '';
    if (n.type === 'placeChip') return n.attrs?.name ?? '';
    if (n.type === 'placeholderChip') return `[${n.attrs?.label ?? ''}]`;
    if (n.type === 'eventChip') return eventLabel(n.attrs as EventInfo);
    if (n.type === 'bookmark' || n.type === 'footnote') return '';
    if (n.type === 'equation') return String(n.attrs?.latex ?? '');
    if (n.type === 'docChart') return chartText(n.attrs?.spec as DocChartSpec | null);
    if (n.type === 'resourceEmbed') return `[${n.attrs?.name ?? 'file'}]`;
    if (n.type === 'pageBreak' || n.type === 'tableOfContents') return '';
    const inner = (n.content ?? []).map((c) => walk(c, depth + 1));
    switch (n.type) {
      case 'paragraph':
      case 'heading':
        return inner.join('');
      case 'listItem':
      case 'taskItem':
        return `${n.type === 'taskItem' ? (n.attrs?.checked ? '[x] ' : '[ ] ') : '- '}${inner.join('\n').trim()}`;
      case 'tableRow':
        return inner.join('\t');
      case 'horizontalRule':
        return '---';
      default:
        return inner.join('\n');
    }
  };
  for (const n of doc?.content ?? []) out.push(walk(n));
  const notes = footnotesOf(doc);
  if (notes.length) out.push(notes.map((t, i) => `[${i + 1}] ${t}`).join('\n'));
  return out.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
}

export interface OutlineItem {
  level: number;
  text: string;
  /** Index among the document's headings, used to scroll to it. */
  index: number;
}

export function outline(doc: JSONContent | null | undefined): OutlineItem[] {
  return headingsOf(doc);
}

function markStyle(marks: JSONContent['marks']): { open: string; close: string } {
  let open = '';
  let close = '';
  const style: string[] = [];
  const wrap = (o: string, c: string) => {
    open += o;
    close = c + close;
  };
  for (const m of marks ?? []) {
    switch (m.type) {
      case 'bold':
        wrap('<strong>', '</strong>');
        break;
      case 'italic':
        wrap('<em>', '</em>');
        break;
      case 'underline':
        wrap('<u>', '</u>');
        break;
      case 'strike':
        wrap('<s>', '</s>');
        break;
      case 'code':
        wrap('<code>', '</code>');
        break;
      case 'subscript':
        wrap('<sub>', '</sub>');
        break;
      case 'superscript':
        wrap('<sup>', '</sup>');
        break;
      case 'insertion':
        wrap(`<ins title="${esc(String(m.attrs?.authorName ?? ''))}">`, '</ins>');
        break;
      case 'deletion':
        wrap(`<del title="${esc(String(m.attrs?.authorName ?? ''))}">`, '</del>');
        break;
      case 'link':
        wrap(`<a href="${esc(String(m.attrs?.href ?? '#'))}">`, '</a>');
        break;
      case 'highlight':
        style.push(`background-color:${m.attrs?.color ?? '#fef08a'}`);
        break;
      case 'textStyle':
        if (m.attrs?.color) style.push(`color:${m.attrs.color}`);
        if (m.attrs?.fontFamily) style.push(`font-family:${m.attrs.fontFamily}`);
        if (m.attrs?.fontSize) style.push(`font-size:${m.attrs.fontSize}`);
        if (m.attrs?.backgroundColor) style.push(`background-color:${m.attrs.backgroundColor}`);
        break;
    }
  }
  if (marks?.some((mk) => mk.type === 'smallCaps')) style.push('font-variant:small-caps');
  if (style.length) {
    open = `<span style="${esc(style.join(';'))}">` + open;
    close += '</span>';
  }
  return { open, close };
}

/** Paragraph-level attributes (alignment, spacing, line height, Title/Subtitle style). */
function blockAttrs(n: JSONContent): string {
  const s: string[] = [];
  const a = n.attrs ?? {};
  const box = borderShadingCss(a);
  if (box) s.push(box);
  if (a.textAlign && a.textAlign !== 'left') s.push(`text-align:${a.textAlign}`);
  if (a.lineHeight) s.push(`line-height:${a.lineHeight}`);
  if (a.spaceBefore != null) s.push(`margin-top:${a.spaceBefore}pt`);
  if (a.spaceAfter != null) s.push(`margin-bottom:${a.spaceAfter}pt`);
  if (a.indentLeft) s.push(`margin-left:${a.indentLeft}pt`);
  if (a.indentRight) s.push(`margin-right:${a.indentRight}pt`);
  if (a.firstLine) s.push(`text-indent:${a.firstLine}pt`, ...(a.firstLine < 0 && !a.indentLeft ? [`margin-left:${-a.firstLine}pt`] : []));
  const cls = a.docStyle === 'title' ? ' class="doc-style-title"' : a.docStyle === 'subtitle' ? ' class="doc-style-subtitle"' : '';
  return (s.length ? ` style="${s.join(';')}"` : '') + cls;
}

/**
 * Self-contained HTML body for export / PDF rendering.
 * `resolveImage` lets the server inline stored images as data URIs.
 */
export function toHTML(doc: JSONContent | null | undefined, opts: { resolveImage?: (src: string) => string; renderChart?: ChartPainter } = {}): string {
  const headings = headingsOf(doc);
  let headingIndex = 0;
  let footnoteNo = 0;
  const render = (n: JSONContent): string => {
    const inner = () => (n.content ?? []).map(render).join('');
    switch (n.type) {
      case 'text': {
        const { open, close } = markStyle(n.marks);
        return open + esc(n.text ?? '') + close;
      }
      case 'paragraph':
        return `<p${blockAttrs(n)}>${inner() || '<br>'}</p>`;
      case 'heading': {
        const lvl = n.attrs?.level ?? 1;
        return `<h${lvl} id="h-${headingIndex++}"${blockAttrs(n)}>${inner()}</h${lvl}>`;
      }
      case 'bulletList':
        return `<ul>${inner()}</ul>`;
      case 'orderedList':
        return `<ol${n.attrs?.start && n.attrs.start !== 1 ? ` start="${n.attrs.start}"` : ''}>${inner()}</ol>`;
      case 'listItem':
        return `<li>${inner()}</li>`;
      case 'taskList':
        return `<ul class="task-list">${inner()}</ul>`;
      case 'taskItem':
        return `<li class="task-item"><input type="checkbox" disabled${n.attrs?.checked ? ' checked' : ''}> <div>${inner()}${n.attrs?.due ? ` <span class="due">${esc(String(n.attrs.due))}</span>` : ''}</div></li>`;
      case 'blockquote':
        return `<blockquote>${inner()}</blockquote>`;
      case 'codeBlock':
        return `<pre><code>${esc((n.content ?? []).map((c) => c.text ?? '').join(''))}</code></pre>`;
      case 'horizontalRule':
        return '<hr>';
      case 'hardBreak':
        return '<br>';
      case 'pageBreak':
        return '<div class="page-break"></div>';
      case 'tableOfContents': {
        const max = n.attrs?.maxLevel ?? 3;
        const items = headings
          .filter((h) => h.level <= max)
          .map((h) => `<li class="toc-l${h.level}"><a href="#h-${h.index}">${esc(h.text)}</a></li>`)
          .join('');
        return `<nav class="toc"><div class="toc-title">Table of contents</div><ul>${items}</ul></nav>`;
      }
      case 'image': {
        const src = String(n.attrs?.src ?? '');
        return `<img src="${esc(opts.resolveImage ? opts.resolveImage(src) : src)}" alt="${esc(String(n.attrs?.alt ?? ''))}">`;
      }
      case 'mention':
        return `<span class="mention">@${esc(String(n.attrs?.label ?? n.attrs?.id ?? ''))}</span>`;
      case 'callout':
        return `<div class="callout">${inner()}</div>`;
      case 'resourceLink':
        return `<span class="page-link">${esc(String(n.attrs?.name ?? ''))}</span>`;
      case 'status':
        return `<span class="status" style="color:${STATUS_COLORS[n.attrs?.color ?? 'green'] ?? '#16a34a'}">● ${esc(String(n.attrs?.label ?? ''))}</span>`;
      case 'dateChip':
        return `<span class="chip">${esc(formatChipDate(n.attrs?.date, n.attrs?.format))}</span>`;
      case 'dropdownChip': {
        const opt = ((n.attrs?.options ?? []) as DropdownOption[]).find((o) => o.label === n.attrs?.value);
        return n.attrs?.value ? `<span class="chip" style="color:${esc(opt?.color ?? '#334155')};background:${esc(opt?.color ?? '#334155')}1a">${esc(String(n.attrs.value))}</span>` : '';
      }
      case 'placeChip':
        return `<a class="chip" href="${esc(placeUrl(String(n.attrs?.name ?? '')))}">📍 ${esc(String(n.attrs?.name ?? ''))}</a>`;
      case 'placeholderChip':
        return `<span class="chip" style="border:1px dashed #94a3b8;background:none;color:#64748b">[${esc(String(n.attrs?.label ?? ''))}]</span>`;
      case 'eventChip':
        return `<span class="chip">📅 ${esc(eventLabel(n.attrs as EventInfo))}</span>`;
      case 'bookmark':
        return `<a id="bm-${esc(String(n.attrs?.id ?? ''))}"></a>`;
      case 'footnote': {
        const no = ++footnoteNo;
        return `<sup class="fn"><a href="#fn-${no}" id="fnref-${no}">${no}</a></sup>`;
      }
      case 'equation':
        return `<span class="equation">${equationHtml(String(n.attrs?.latex ?? ''), 'mathml')}</span>`;
      case 'resourceEmbed':
        return `<div class="embed">📎 ${esc(String(n.attrs?.name ?? 'Linked file'))}</div>`;
      case 'docChart': {
        const spec = n.attrs?.spec as DocChartSpec | null;
        if (!spec) return '';
        const w = Number(n.attrs?.width) || 640;
        const h = Number(n.attrs?.height) || 360;
        return `<figure class="chart" style="max-width:${w}px">${opts.renderChart ? opts.renderChart(spec, w, h) : `<figcaption>${esc(spec.title ?? 'Chart')}</figcaption>`}</figure>`;
      }
      case 'columns':
        return `<div class="columns" style="grid-template-columns:repeat(${(n.content ?? []).length},minmax(0,1fr))">${inner()}</div>`;
      case 'column':
        return `<div class="column">${inner()}</div>`;
      case 'table':
        return `<table>${inner()}</table>`;
      case 'tableRow':
        return `<tr>${inner()}</tr>`;
      case 'tableHeader':
      case 'tableCell': {
        const tag = n.type === 'tableHeader' ? 'th' : 'td';
        const span = `${(n.attrs?.colspan ?? 1) > 1 ? ` colspan="${n.attrs!.colspan}"` : ''}${(n.attrs?.rowspan ?? 1) > 1 ? ` rowspan="${n.attrs!.rowspan}"` : ''}`;
        return `<${tag}${span}>${inner()}</${tag}>`;
      }
      default:
        return inner();
    }
  };
  const body = (doc?.content ?? []).map(render).join('\n');
  const notes = footnotesOf(doc);
  return notes.length
    ? `${body}\n<section class="footnotes"><ol>${notes.map((t, i) => `<li id="fn-${i + 1}">${esc(t)} <a href="#fnref-${i + 1}">↩</a></li>`).join('')}</ol></section>`
    : body;
}

/** Stylesheet shared by HTML export and PDF rendering — mirrors the editor's page style. */
export const EXPORT_CSS = `
  body { font-family: Inter, 'Segoe UI', Arial, sans-serif; color: #0f172a; font-size: 11pt; line-height: 1.6; margin: 0; }
  main { max-width: 760px; margin: 40px auto; padding: 0 24px; }
  @media print { main { max-width: none; margin: 0; padding: 0; } }
  h1 { font-size: 24pt; line-height: 1.2; margin: 24px 0 12px; } h2 { font-size: 17pt; margin: 22px 0 10px; } h3 { font-size: 14pt; margin: 18px 0 8px; } h4 { font-size: 12pt; }
  p { margin: 6px 0; } a { color: #2563eb; } code { font-family: Consolas, monospace; background: #f1f5f9; padding: 1px 4px; border-radius: 4px; }
  pre { background: #0f172a; color: #e2e8f0; padding: 12px 14px; border-radius: 8px; white-space: pre-wrap; } pre code { background: none; color: inherit; }
  blockquote { border-left: 3px solid #cbd5e1; margin: 8px 0; padding: 2px 14px; color: #475569; }
  table { border-collapse: collapse; width: 100%; margin: 10px 0; } th, td { border: 1px solid #d7dde6; padding: 6px 10px; vertical-align: top; } th { background: #eef4ff; text-align: left; }
  img { max-width: 100%; } hr { border: none; border-top: 1px solid #e6eaf0; margin: 18px 0; }
  .callout { background: #eff5ff; border: 1px solid #dbe7fe; border-radius: 10px; padding: 10px 16px; margin: 10px 0; }
  .task-list { list-style: none; padding-left: 4px; } .task-item { display: flex; gap: 8px; } .task-item p { margin: 0; } .due { color: #64748b; font-size: 9pt; }
  .mention { color: #2563eb; background: #eff5ff; border-radius: 4px; padding: 0 3px; }
  .page-link { color: #2563eb; text-decoration: underline; } .status { font-weight: 600; }
  figure.chart { margin: 1em auto; } figure.chart svg { width: 100%; height: auto; display: block; }
  .columns { display: grid; gap: 2em; margin: 1em 0; } .column > :first-child { margin-top: 0; }
  sup.fn a { text-decoration: none; color: #2563eb; } .footnotes { margin-top: 2em; border-top: 1px solid #cbd5e1; padding-top: 0.5em; font-size: 0.85em; color: #334155; } .footnotes ol { padding-left: 1.4em; }
  .chip { display: inline-block; border-radius: 999px; padding: 0 0.5em; background: #f1f5f9; color: #334155; font-size: 0.92em; text-decoration: none; }
  .embed { border: 1px solid #e6eaf0; border-radius: 10px; padding: 10px 14px; margin: 8px 0; }
  .page-break { break-after: page; page-break-after: always; height: 0; }
  .toc { margin: 12px 0 20px; } .toc-title { font-weight: 700; margin-bottom: 6px; } .toc ul { list-style: none; padding: 0; margin: 0; }
  .toc li { margin: 3px 0; } .toc a { color: inherit; text-decoration: none; } .toc-l2 { padding-left: 16px; } .toc-l3 { padding-left: 32px; } .toc-l4 { padding-left: 48px; }
  ins { color: #15803d; text-decoration: underline; } del { color: #b91c1c; text-decoration: line-through; }
  .doc-style-title { font-size: 26pt; font-weight: 700; line-height: 1.2; } .doc-style-subtitle { font-size: 14pt; color: #64748b; }
  .doc-title { font-size: 28pt; font-weight: 700; margin: 0 0 18px; }
`;

/**
 * Tools → Line numbers (§56): the top of every visual line of text inside `root`, relative to `base`, in CSS
 * pixels of `base` (divided by `scale` when the page is zoomed). Self-contained — the PDF export serialises it into
 * the page — so it must not reference anything outside its body. Tables and footnotes are not numbered (Word).
 */
export function lineBoxes(root: HTMLElement, base: HTMLElement, scale = 1): { top: number; height: number }[] {
  const out: { top: number; height: number }[] = [];
  const b = base.getBoundingClientRect();
  const blocks = root.querySelectorAll('p, h1, h2, h3, h4, h5, h6, pre');
  for (const el of Array.from(blocks)) {
    if (el.closest('table, .footnotes, [data-no-line-numbers]') || (el.parentElement && el.parentElement.closest('p, h1, h2, h3, h4, h5, h6, pre'))) continue;
    const range = document.createRange();
    range.selectNodeContents(el);
    const rects = Array.from(range.getClientRects()).filter((r) => r.width > 0 && r.height > 0).sort((x, y) => x.top - y.top);
    if (!rects.length) {
      const r = el.getBoundingClientRect();
      if (r.height > 0) out.push({ top: (r.top - b.top) / scale, height: r.height / scale });
      continue;
    }
    let last = -1e9;
    let lastH = 0;
    for (const r of rects) {
      // Fragments of one line share (almost) its top; a new line starts more than half a line below.
      if (r.top - last > Math.max(4, lastH * 0.5)) {
        out.push({ top: (r.top - b.top) / scale, height: r.height / scale });
        last = r.top;
        lastH = r.height;
      }
    }
  }
  return out;
}

export function toHTMLDocument(
  title: string,
  doc: JSONContent | null | undefined,
  opts: { resolveImage?: (src: string) => string; pageSetup?: PageSetup; renderChart?: ChartPainter } = {},
): string {
  const p = opts.pageSetup ?? DEFAULT_PAGE_SETUP;
  const { w, h } = paperSize(p);
  const m = p.margins;
  const page = `@page { size: ${w}mm ${h}mm; margin: ${m.top}mm ${m.right}mm ${m.bottom}mm ${m.left}mm; }`;
  // A fixed element is repeated on every printed page by Chromium: the watermark sits behind the text.
  const wm = p.watermark;
  const wmSrc = wm?.image ? (opts.resolveImage ? opts.resolveImage(wm.image) : wm.image) : wm?.text ? watermarkSvg(wm.text, w, h, wm.opacity ?? 0.15) : null;
  const watermark = wmSrc
    ? `<div class="watermark" style="position:fixed;inset:-${m.top}mm -${m.right}mm -${m.bottom}mm -${m.left}mm;z-index:-1;background:url('${esc(wmSrc)}') center/${wm?.image ? '60% auto' : 'contain'} no-repeat;${wm?.image ? `opacity:${wm.opacity ?? 0.2};` : ''}"></div>`
    : '';
  // Line numbers: laid out by the browser that renders the PDF, with the same function as the editor.
  const numbers = p.lineNumbers
    ? `<style>main{position:relative}.ln{position:absolute;left:-12mm;width:8mm;text-align:right;font:8pt Inter,Arial,sans-serif;color:#94a3b8}</style><script>(function(){var lineBoxes=${lineBoxes.toString()};var m=document.querySelector('main');var go=function(){var n=1;lineBoxes(m,m,1).forEach(function(l){var d=document.createElement('div');d.className='ln';d.style.top=(l.top+Math.max(0,(l.height-11)/2))+'px';d.textContent=String(n++);m.appendChild(d);});};if(document.fonts&&document.fonts.ready)document.fonts.ready.then(go);else go();})();</script>`
    : '';
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>${EXPORT_CSS}${page}</style></head><body>${watermark}<main><div class="doc-title" data-no-line-numbers>${esc(title)}</div>${toHTML(doc, opts)}</main>${numbers}</body></html>`;
}
export * from './mindmap';
