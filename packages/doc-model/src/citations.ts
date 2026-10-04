// Tools → Citations (Google Docs): sources kept with the document, in-text citations and a bibliography in APA,
// MLA or Chicago (author-date). docs/ARCHITECTURE.md §58.
import { mergeAttributes, Node, type JSONContent } from '@tiptap/core';

export type CitationStyle = 'apa' | 'mla' | 'chicago';
export type SourceKind = 'book' | 'website' | 'article';

export interface Person {
  first: string;
  last: string;
}
export interface Source {
  id: string;
  kind: SourceKind;
  authors: Person[];
  title: string;
  /** Publisher (book), website name (website), journal (article). */
  container: string;
  year: string;
  url?: string;
  volume?: string;
  issue?: string;
  pages?: string;
  accessed?: string; // YYYY-MM-DD (websites)
}
export interface CitationSettings {
  style: CitationStyle;
  sources: Source[];
}

/** Settings key in the document's settings map. */
export const CITATIONS_KEY = 'citations';
export const CITATION_STYLES: { id: CitationStyle; label: string }[] = [
  { id: 'apa', label: 'APA (7th ed.)' },
  { id: 'mla', label: 'MLA (9th ed.)' },
  { id: 'chicago', label: 'Chicago (author-date)' },
];
export const citationSettingsOf = (raw: unknown): CitationSettings => {
  const r = (raw ?? {}) as Partial<CitationSettings>;
  return { style: r.style === 'mla' || r.style === 'chicago' ? r.style : 'apa', sources: Array.isArray(r.sources) ? r.sources : [] };
};

const names = (a: Person[]) => a.filter((p) => p.last || p.first);
const initials = (first: string) =>
  first
    .split(/[\s-]+/)
    .filter(Boolean)
    .map((n) => `${n[0].toUpperCase()}.`)
    .join(' ');

/** Short author part of an in-text citation. */
function shortAuthors(s: Source, style: CitationStyle): string {
  const a = names(s.authors);
  if (!a.length) return `“${s.title}”`;
  if (a.length === 1) return a[0].last || a[0].first;
  if (a.length === 2) return `${a[0].last} ${style === 'apa' ? '&' : 'and'} ${a[1].last}`;
  if (style === 'chicago' && a.length === 3) return `${a[0].last}, ${a[1].last}, and ${a[2].last}`;
  return `${a[0].last} et al.`;
}

/** "(Lee, 2024, p. 5)" · "(Lee 5)" · "(Lee 2024, 5)". */
export function formatInText(s: Source | undefined, style: CitationStyle, page?: string | null): string {
  if (!s) return '(source missing)';
  const who = shortAuthors(s, style);
  const year = s.year || 'n.d.';
  if (style === 'mla') return `(${who}${page ? ` ${page}` : ''})`;
  if (style === 'chicago') return `(${who} ${year}${page ? `, ${page}` : ''})`;
  return `(${who}, ${year}${page ? `, ${/[-–]/.test(page) ? 'pp.' : 'p.'} ${page}` : ''})`;
}

export type Run = { text: string; italic?: boolean };

function authorList(s: Source, style: CitationStyle): string {
  const a = names(s.authors);
  if (!a.length) return '';
  if (style === 'apa') {
    const one = (p: Person) => [p.last, initials(p.first)].filter(Boolean).join(', ');
    if (a.length === 1) return one(a[0]);
    return `${a.slice(0, -1).map(one).join(', ')}, & ${one(a[a.length - 1])}`;
  }
  // MLA / Chicago: "Last, First" for the first author, "First Last" for the others.
  const first = [a[0].last, a[0].first].filter(Boolean).join(', ');
  if (a.length === 1) return first;
  if (style === 'mla' && a.length > 2) return `${first}, et al.`;
  const rest = a.slice(1).map((p) => [p.first, p.last].filter(Boolean).join(' '));
  return a.length === 2 ? `${first}, and ${rest[0]}` : `${first}, ${rest.slice(0, -1).join(', ')}, and ${rest[rest.length - 1]}`;
}

const end = (t: string) => (/[.?!]$/.test(t) ? t : `${t}.`);

/** One reference-list entry, as runs (titles of books / sites / journals in italics). */
export function formatReference(s: Source, style: CitationStyle): Run[] {
  const who = authorList(s, style);
  const year = s.year || 'n.d.';
  const vol = [s.volume, s.issue ? `(${s.issue})` : ''].filter(Boolean).join('');
  const out: Run[] = [];
  const t = (text: string, italic = false) => text && out.push({ text, italic });
  if (style === 'apa' && !who) {
    // No author: the title takes the author's place (APA 9.12).
    t(s.title, s.kind !== 'article');
    t(` (${year}). `);
    if (s.kind === 'article') {
      t(s.container, true);
      t(vol ? `, ${vol}` : '');
      t(s.pages ? `, ${s.pages}` : '');
      t('. ');
    } else t(s.container ? `${end(s.container)} ` : '');
    t(s.url ?? '');
  } else if (style === 'apa') {
    t(who ? `${end(who)} ` : '');
    t(`(${year}). `);
    if (s.kind === 'article') {
      t(`${end(s.title)} `);
      t(s.container, true);
      t(vol ? `, ${vol}` : '');
      t(s.pages ? `, ${s.pages}` : '');
      t('. ');
    } else {
      t(s.title, s.kind === 'book');
      t('. ');
      t(s.kind === 'website' ? (s.container ? `${end(s.container)} ` : '') : s.container ? `${end(s.container)} ` : '');
    }
    t(s.url ?? '');
  } else if (style === 'mla') {
    t(who ? `${end(who)} ` : '');
    if (s.kind === 'book') {
      t(s.title, true);
      t('. ');
      t(s.container ? `${s.container}, ` : '');
      t(`${year}.`);
    } else {
      t(`“${end(s.title)}” `);
      t(s.container, true);
      t(s.kind === 'article' && vol ? `, vol. ${s.volume}${s.issue ? `, no. ${s.issue}` : ''}` : '');
      t(`, ${year}`);
      t(s.pages ? `, pp. ${s.pages}` : '');
      t(s.url ? `, ${s.url.replace(/^https?:\/\//, '')}` : '');
      t('.');
      t(s.kind === 'website' && s.accessed ? ` Accessed ${s.accessed}.` : '');
    }
  } else if (!who) {
    // Chicago without an author: title first, then the year.
    t(s.kind === 'book' ? s.title : `“${end(s.title)}”`, s.kind === 'book');
    t(s.kind === 'book' ? '. ' : ' ');
    t(`${year}. `);
    t(s.container, true);
    t(s.container ? '.' : '');
    t(s.url ? ` ${s.url}` : '');
  } else {
    t(who ? `${end(who)} ` : '');
    t(`${year}. `);
    if (s.kind === 'book') {
      t(s.title, true);
      t('. ');
      t(s.container ? `${end(s.container)}` : '');
    } else {
      t(`“${end(s.title)}” `);
      t(s.container, true);
      t(s.kind === 'article' && vol ? ` ${vol}` : '');
      t(s.pages ? `: ${s.pages}` : '');
      t('.');
    }
    t(s.url ? ` ${s.url}` : '');
  }
  return out.map((r, i) => (i === out.length - 1 ? { ...r, text: r.text.trimEnd() } : r));
}

/** Sort key of the reference list: first author's last name, then year, then title. */
const sortKey = (s: Source) => `${names(s.authors)[0]?.last ?? s.title}`.toLowerCase() + `|${s.year}|${s.title.toLowerCase()}`;

/** Sources cited in the document (by first use), or every source when none is cited yet. */
export function bibliographySources(doc: JSONContent | null | undefined, settings: CitationSettings): Source[] {
  const cited = new Set<string>();
  const walk = (n: JSONContent) => {
    if (n.type === 'citation' && n.attrs?.sourceId) cited.add(String(n.attrs.sourceId));
    n.content?.forEach(walk);
  };
  if (doc) walk(doc);
  const list = cited.size ? settings.sources.filter((s) => cited.has(s.id)) : settings.sources;
  return [...list].sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
}

export const bibliographyTitle = (style: CitationStyle) => (style === 'apa' ? 'References' : style === 'mla' ? 'Works Cited' : 'Bibliography');

/**
 * Exports: citations become plain text and the bibliography becomes a heading plus one paragraph per source
 * (hanging indent, titles in italics), so every exporter shows them without knowing about citations.
 */
export function resolveCitations(doc: JSONContent, raw: unknown): JSONContent {
  const settings = citationSettingsOf(raw);
  const byId = new Map(settings.sources.map((s) => [s.id, s]));
  const map = (n: JSONContent): JSONContent[] => {
    if (n.type === 'citation') return [{ type: 'text', text: formatInText(byId.get(String(n.attrs?.sourceId)), settings.style, n.attrs?.page as string | null), ...(n.marks ? { marks: n.marks } : {}) }];
    if (n.type === 'bibliography') {
      const list = bibliographySources(doc, settings);
      return [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: bibliographyTitle(settings.style) }] },
        ...list.map((s) => ({
          type: 'paragraph',
          attrs: { firstLine: -36 },
          content: formatReference(s, settings.style).map((r) => ({ type: 'text', text: r.text, ...(r.italic ? { marks: [{ type: 'italic' }] } : {}) })),
        })),
      ];
    }
    return [n.content ? { ...n, content: n.content.flatMap(map) } : n];
  };
  return map(doc)[0];
}

/** In-text citation (inline). Its text depends on the document's sources and style: editors draw it with a view. */
export const Citation = Node.create({
  name: 'citation',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      sourceId: { default: null, parseHTML: (el) => el.getAttribute('data-source'), renderHTML: (a) => ({ 'data-source': a.sourceId }) },
      page: { default: null, parseHTML: (el) => el.getAttribute('data-page'), renderHTML: (a) => (a.page ? { 'data-page': a.page } : {}) },
    };
  },
  parseHTML() {
    return [{ tag: 'span[data-citation]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-citation': '' }), '(citation)'];
  },
  renderText: () => '(citation)',
});

/** Bibliography block: the formatted reference list of the cited sources. */
export const Bibliography = Node.create({
  name: 'bibliography',
  group: 'block',
  atom: true,
  selectable: true,
  parseHTML() {
    return [{ tag: 'div[data-bibliography]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-bibliography': '' })];
  },
});
