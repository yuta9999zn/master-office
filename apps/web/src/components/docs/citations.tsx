'use client';

import { NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from '@tiptap/react';
import type { Editor } from '@tiptap/react';
import {
  Bibliography,
  bibliographySources,
  bibliographyTitle,
  Citation,
  CITATION_STYLES,
  CITATIONS_KEY,
  citationSettingsOf,
  formatInText,
  formatReference,
  SETTINGS_MAP,
  type CitationSettings,
  type CitationStyle,
  type Person,
  type Source,
  type SourceKind,
} from '@workos/doc-model';
import { BookOpen, Plus, Quote, Trash2 } from 'lucide-react';
import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import type * as Y from 'yjs';
import { Button, cn } from '../ui/primitives';

// Tools → Citations (Google Docs). docs/ARCHITECTURE.md §58. Sources and style live in the document's settings
// map (shared, versioned); in-text citations and the bibliography are drawn from them.

const EMPTY: CitationSettings = { style: 'apa', sources: [] };
const cache = new WeakMap<Y.Doc, { raw: unknown; value: CitationSettings }>();

export function useCitations(doc: Y.Doc | null) {
  const value = useSyncExternalStore(
    (cb) => {
      if (!doc) return () => undefined;
      const m = doc.getMap(SETTINGS_MAP);
      m.observe(cb);
      return () => m.unobserve(cb);
    },
    () => {
      if (!doc) return EMPTY;
      const raw = doc.getMap(SETTINGS_MAP).get(CITATIONS_KEY);
      const prev = cache.get(doc);
      if (prev && prev.raw === raw) return prev.value;
      const v = citationSettingsOf(raw);
      cache.set(doc, { raw, value: v });
      return v;
    },
    () => EMPTY,
  );
  const save = (next: CitationSettings) => doc?.getMap(SETTINGS_MAP).set(CITATIONS_KEY, JSON.parse(JSON.stringify(next)));
  return { settings: value, save };
}

const Ctx = createContext<{ settings: CitationSettings; doc: Y.Doc | null }>({ settings: EMPTY, doc: null });
/** Lets the citation / bibliography node views read the document's sources and style. */
export function CitationsProvider({ doc, children }: { doc: Y.Doc; children: ReactNode }) {
  const { settings } = useCitations(doc);
  return <Ctx.Provider value={{ settings, doc }}>{children}</Ctx.Provider>;
}

function CitationView({ node, updateAttributes, deleteNode, editor, selected }: ReactNodeViewProps) {
  const { settings } = useContext(Ctx);
  const src = settings.sources.find((s) => s.id === node.attrs.sourceId);
  const [open, setOpen] = useState(false);
  return (
    <NodeViewWrapper as="span" className="relative" data-testid="citation">
      <span
        contentEditable={false}
        onClick={() => editor.isEditable && setOpen((o) => !o)}
        className={cn('cursor-pointer rounded-sm px-0.5 text-inherit decoration-dotted underline-offset-2 hover:bg-brand-50 hover:underline', selected && 'bg-brand-50')}
        title={src ? src.title : 'Source deleted'}
      >
        {formatInText(src, settings.style, node.attrs.page as string | null)}
      </span>
      {open && (
        <span contentEditable={false} className="pop absolute left-0 top-full z-30 mt-1 flex w-60 flex-col gap-2 p-2.5 text-[12px]" onMouseDown={(e) => e.stopPropagation()}>
          <span className="truncate text-muted">{src?.title ?? 'Source deleted'}</span>
          <input defaultValue={(node.attrs.page as string) ?? ''} placeholder="Page (optional)" onBlur={(e) => updateAttributes({ page: e.target.value.trim() || null })} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} className="input h-8" aria-label="Citation page" />
          <span className="flex gap-2">
            <button onClick={() => setOpen(false)} className="flex-1 rounded-md bg-brand-50 py-1 font-medium text-brand-700">
              Done
            </button>
            <button onClick={deleteNode} className="flex items-center gap-1 rounded-md px-2 py-1 text-muted hover:bg-hover">
              <Trash2 size={12} /> Remove
            </button>
          </span>
        </span>
      )}
    </NodeViewWrapper>
  );
}

function BibliographyView({ editor, selected }: ReactNodeViewProps) {
  const { settings } = useContext(Ctx);
  // The list depends on which sources are cited anywhere in the document: follow every edit.
  const [, bump] = useState(0);
  useEffect(() => {
    const on = () => bump((n) => n + 1);
    editor.on('update', on);
    return () => void editor.off('update', on);
  }, [editor]);
  const list = bibliographySources(editor.getJSON(), settings);
  return (
    <NodeViewWrapper className={cn('my-4 rounded-md', selected && 'outline outline-2 outline-brand-300')} contentEditable={false} data-testid="bibliography">
      <h2 className="!mt-2">{bibliographyTitle(settings.style)}</h2>
      {list.length ? (
        list.map((s) => (
          <p key={s.id} className="!my-1.5" style={{ paddingLeft: '36pt', textIndent: '-36pt' }}>
            {formatReference(s, settings.style).map((r, i) => (r.italic ? <i key={i}>{r.text}</i> : <span key={i}>{r.text}</span>))}
          </p>
        ))
      ) : (
        <p className="text-muted">Add sources in Tools → Citations; they are listed here.</p>
      )}
    </NodeViewWrapper>
  );
}

export const CitationWithView = Citation.extend({ addNodeView: () => ReactNodeViewRenderer(CitationView) });
export const BibliographyWithView = Bibliography.extend({ addNodeView: () => ReactNodeViewRenderer(BibliographyView) });

const KIND_LABEL: Record<SourceKind, string> = { book: 'Book', website: 'Website', article: 'Journal article' };
const CONTAINER_LABEL: Record<SourceKind, string> = { book: 'Publisher', website: 'Website name', article: 'Journal' };

function SourceForm({ initial, onSave, onCancel }: { initial: Source; onSave: (s: Source) => void; onCancel: () => void }) {
  const [s, setS] = useState<Source>(initial);
  const set = (patch: Partial<Source>) => setS({ ...s, ...patch });
  const setAuthor = (i: number, patch: Partial<Person>) => set({ authors: s.authors.map((a, j) => (j === i ? { ...a, ...patch } : a)) });
  const field = (label: string, value: string | undefined, k: keyof Source, placeholder?: string) => (
    <label className="block">
      <span className="text-[11.5px] text-muted">{label}</span>
      <input value={value ?? ''} onChange={(e) => set({ [k]: e.target.value } as Partial<Source>)} placeholder={placeholder} className="input mt-0.5 h-8 w-full" aria-label={label} />
    </label>
  );
  return (
    <div className="space-y-2 rounded-lg border border-line p-2.5 text-[13px]" data-testid="source-form">
      <select value={s.kind} onChange={(e) => set({ kind: e.target.value as SourceKind })} className="input h-8 w-full" aria-label="Source type">
        {(Object.keys(KIND_LABEL) as SourceKind[]).map((k) => (
          <option key={k} value={k}>
            {KIND_LABEL[k]}
          </option>
        ))}
      </select>
      <div className="text-[11.5px] text-muted">Contributors</div>
      {s.authors.map((a, i) => (
        <div key={i} className="flex gap-1.5">
          <input value={a.first} onChange={(e) => setAuthor(i, { first: e.target.value })} placeholder="First name" className="input h-8 min-w-0 flex-1" aria-label={`Author ${i + 1} first name`} />
          <input value={a.last} onChange={(e) => setAuthor(i, { last: e.target.value })} placeholder="Last name" className="input h-8 min-w-0 flex-1" aria-label={`Author ${i + 1} last name`} />
          <button onClick={() => set({ authors: s.authors.filter((_, j) => j !== i) })} className="rounded p-1 text-subtle hover:text-red-600" aria-label={`Remove author ${i + 1}`}>
            <Trash2 size={13} />
          </button>
        </div>
      ))}
      <button onClick={() => set({ authors: [...s.authors, { first: '', last: '' }] })} className="text-[12px] font-medium text-brand-600 hover:underline">
        + Add contributor
      </button>
      {field('Title', s.title, 'title')}
      {field(CONTAINER_LABEL[s.kind], s.container, 'container')}
      <div className="flex gap-1.5">
        {field('Year', s.year, 'year', '2026')}
        {s.kind === 'article' && field('Volume', s.volume, 'volume')}
        {s.kind === 'article' && field('Issue', s.issue, 'issue')}
      </div>
      {s.kind === 'article' && field('Pages', s.pages, 'pages', '45-60')}
      {s.kind !== 'book' && field('URL', s.url, 'url', 'https://…')}
      <div className="flex justify-end gap-2 pt-1">
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" variant="primary" disabled={!s.title.trim()} onClick={() => onSave({ ...s, authors: s.authors.filter((a) => a.first.trim() || a.last.trim()) })} data-testid="source-save">
          Save source
        </Button>
      </div>
    </div>
  );
}

/** Side panel: style, sources (add / edit / delete / cite), insert bibliography. */
export function CitationsPanel({ doc, editor, canEdit }: { doc: Y.Doc; editor: Editor; canEdit: boolean }) {
  const { settings, save } = useCitations(doc);
  const [editing, setEditing] = useState<Source | null>(null);
  const blank = (): Source => ({ id: crypto.randomUUID(), kind: 'book', authors: [{ first: '', last: '' }], title: '', container: '', year: '' });
  const upsert = (s: Source) => {
    const exists = settings.sources.some((x) => x.id === s.id);
    save({ ...settings, sources: exists ? settings.sources.map((x) => (x.id === s.id ? s : x)) : [...settings.sources, s] });
    setEditing(null);
  };
  const hasBibliography = () => {
    let found = false;
    editor.state.doc.descendants((n) => {
      if (n.type.name === 'bibliography') found = true;
      return !found;
    });
    return found;
  };
  return (
    <div className="space-y-3 p-3 text-[13px]" data-testid="citations-panel">
      <label className="block">
        <span className="text-[12px] text-muted">Citation style</span>
        <select value={settings.style} disabled={!canEdit} onChange={(e) => save({ ...settings, style: e.target.value as CitationStyle })} className="input mt-0.5 h-8 w-full" aria-label="Citation style">
          {CITATION_STYLES.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </label>
      {editing ? (
        <SourceForm initial={editing} onSave={upsert} onCancel={() => setEditing(null)} />
      ) : (
        canEdit && (
          <Button size="sm" icon={<Plus size={13} />} onClick={() => setEditing(blank())} data-testid="source-add">
            Add citation source
          </Button>
        )
      )}
      <ul className="space-y-1.5" data-testid="sources">
        {settings.sources.map((s) => (
          <li key={s.id} className="group rounded-lg border border-line p-2">
            <div className="flex items-start gap-2">
              <BookOpen size={14} className="mt-0.5 shrink-0 text-subtle" />
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium text-ink">{s.title}</div>
                <div className="truncate text-[11.5px] text-muted">{formatInText(s, settings.style)}</div>
              </div>
            </div>
            {canEdit && (
              <div className="mt-1.5 flex gap-1.5">
                <button onClick={() => editor.chain().focus().insertContent({ type: 'citation', attrs: { sourceId: s.id } }).run()} className="flex items-center gap-1 rounded-md bg-brand-50 px-2 py-0.5 text-[12px] font-medium text-brand-700 hover:bg-brand-100" aria-label={`Cite ${s.title}`}>
                  <Quote size={11} /> Cite
                </button>
                <button onClick={() => setEditing(s)} className="rounded-md px-2 py-0.5 text-[12px] text-muted hover:bg-hover">
                  Edit
                </button>
                <button onClick={() => save({ ...settings, sources: settings.sources.filter((x) => x.id !== s.id) })} className="ml-auto rounded-md px-1.5 text-subtle opacity-0 hover:text-red-600 group-hover:opacity-100" aria-label={`Delete ${s.title}`}>
                  <Trash2 size={13} />
                </button>
              </div>
            )}
          </li>
        ))}
        {!settings.sources.length && <li className="text-[12px] text-muted">No sources yet.</li>}
      </ul>
      {canEdit && (
        <Button
          size="sm"
          variant="ghost"
          disabled={!settings.sources.length}
          onClick={() => (hasBibliography() ? undefined : editor.chain().focus('end').insertContent({ type: 'bibliography' }).run())}
          data-testid="insert-bibliography"
        >
          Insert bibliography
        </Button>
      )}
    </div>
  );
}
