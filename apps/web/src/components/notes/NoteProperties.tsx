'use client';

import type { NoteProperty, Resource, ResourceDetail } from '@workos/shared';
import { can } from '@workos/shared';
import { ChevronDown, Plus, X } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import { formatBytes, formatDate, formatDateTime } from '@/lib/format';
import { useResourceActions, useResourceLinks, useResources } from '@/lib/queries';
import { hrefFor, typeLabel } from '@/lib/resources';
import { TagEditor } from '../drive/DetailsPanel';
import { Avatar, cn, FileIcon } from '../ui/primitives';
import { FIXED_NOTEBOOKS, notebookOf } from './NotesNav';

const FILE_TYPES = new Set(['pdf', 'image', 'video', 'file', 'spreadsheet', 'presentation']);

function Section({ title, count, action, children, defaultOpen = true }: { title: string; count?: number; action?: ReactNode; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="border-b border-line py-3.5">
      <div className="mb-2 flex items-center gap-2">
        <button onClick={() => setOpen(!open)} className="flex flex-1 items-center gap-1.5 text-left text-[13px] font-semibold text-ink">
          {title}
          {count !== undefined && <span className="rounded-full bg-hover px-1.5 text-[11px] font-medium text-muted">{count}</span>}
          <ChevronDown size={14} className={cn('ml-auto text-subtle transition-transform', !open && '-rotate-90')} />
        </button>
        {action}
      </div>
      {open && children}
    </section>
  );
}

function ResourceRow({ r, sub }: { r: Resource; sub: ReactNode }) {
  return (
    <Link href={hrefFor(r)} className="flex items-center gap-2.5 rounded-lg px-1.5 py-1.5 hover:bg-hover">
      <FileIcon r={r} size={22} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] text-ink">{r.name}</div>
        <div className="truncate text-[11px] text-muted">{sub}</div>
      </div>
    </Link>
  );
}

/** Right panel "Properties": page info, notebook, tags, custom properties, linked pages, backlinks, related files. */
export function NoteProperties({ r, onInsertLink }: { r: ResourceDetail; onInsertLink: () => void }) {
  const editable = can(r.myRole, 'editor');
  const { update } = useResourceActions();
  const { data: links } = useResourceLinks(r.id);
  const { data: notes = [] } = useResources({ type: 'note' });
  const [props, setProps] = useState<NoteProperty[]>(() => (r.metadata?.properties as NoteProperty[] | undefined) ?? []);
  const [newBook, setNewBook] = useState<string | null>(null);
  useEffect(() => setProps((r.metadata?.properties as NoteProperty[] | undefined) ?? []), [r.metadata?.properties]);

  const saveProps = (next: NoteProperty[]) => {
    setProps(next);
    update.mutate({ id: r.id, properties: next.filter((p) => p.key.trim()) });
  };
  const notebooks = [...new Set([...FIXED_NOTEBOOKS, ...notes.map(notebookOf)])].sort();
  const linkedPages = (links?.linked ?? []).filter((x) => !FILE_TYPES.has(x.type) || (!x.mimeType && x.type !== 'pdf'));
  const files = (links?.linked ?? []).filter((x) => FILE_TYPES.has(x.type) && (x.mimeType || x.type === 'pdf' || x.type === 'image'));

  const Info = ({ k, children }: { k: string; children: ReactNode }) => (
    <div className="grid grid-cols-[88px_1fr] items-center py-1 text-[13px]">
      <span className="text-muted">{k}</span>
      <span className="min-w-0 truncate text-ink">{children}</span>
    </div>
  );

  return (
    <div className="px-4" data-testid="note-properties">
      <Section title="Page info">
        <Info k="Title">{r.name}</Info>
        <Info k="Type">Note &amp; Mind Map</Info>
        <Info k="Owner">
          <span className="flex items-center gap-1.5">
            {r.owner && <Avatar user={r.owner} size={20} />} {r.owner?.name}
          </span>
        </Info>
        <Info k="Created">{formatDateTime(r.createdAt)}</Info>
        <Info k="Updated">{formatDateTime(r.updatedAt)}</Info>
        <Info k="Notebook">
          {newBook !== null ? (
            <input
              autoFocus
              className="input h-7"
              value={newBook}
              placeholder="e.g. Projects/Launch"
              onChange={(e) => setNewBook(e.target.value)}
              onBlur={() => {
                if (newBook.trim()) update.mutate({ id: r.id, notebook: newBook.trim() });
                setNewBook(null);
              }}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            />
          ) : (
            <select
              aria-label="Notebook"
              disabled={!editable}
              value={notebookOf(r)}
              onChange={(e) => (e.target.value === '__new' ? setNewBook('') : update.mutate({ id: r.id, notebook: e.target.value }))}
              className="-ml-1 w-full rounded-md bg-transparent px-1 py-0.5 text-[13px] outline-none hover:bg-hover"
            >
              {notebooks.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
              <option value="__new">New notebook…</option>
            </select>
          )}
        </Info>
      </Section>

      <Section title="Tags">
        <TagEditor r={r} />
      </Section>

      <Section
        title="Properties"
        action={
          editable && (
            <button aria-label="Add a property" onClick={() => setProps([...props, { key: '', value: '' }])} className="rounded p-0.5 text-muted hover:bg-hover">
              <Plus size={15} />
            </button>
          )
        }
      >
        {!props.length && <p className="text-[12px] text-muted">Custom fields such as Status, Quarter or Budget.</p>}
        {props.map((p, i) => (
          <div key={i} className="group flex items-center gap-1.5 py-0.5">
            <input
              aria-label="Property name"
              disabled={!editable}
              defaultValue={p.key}
              placeholder="Property"
              onBlur={(e) => saveProps(props.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)))}
              className="w-[88px] rounded-md bg-transparent px-1 py-0.5 text-[13px] text-muted outline-none hover:bg-hover focus:bg-hover"
            />
            <input
              aria-label="Property value"
              disabled={!editable}
              defaultValue={p.value}
              placeholder="Empty"
              onBlur={(e) => saveProps(props.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))}
              className="min-w-0 flex-1 rounded-md bg-transparent px-1 py-0.5 text-[13px] text-ink outline-none hover:bg-hover focus:bg-hover"
            />
            {editable && (
              <button aria-label="Remove property" onClick={() => saveProps(props.filter((_, j) => j !== i))} className="rounded p-0.5 text-subtle opacity-0 hover:bg-hover group-hover:opacity-100">
                <X size={13} />
              </button>
            )}
          </div>
        ))}
        {editable && (
          <button onClick={() => setProps([...props, { key: '', value: '' }])} className="mt-1 flex items-center gap-1 text-[12px] text-muted hover:text-ink">
            <Plus size={13} /> Add a property
          </button>
        )}
      </Section>

      <Section
        title="Linked pages"
        count={linkedPages.length}
        action={
          editable && (
            <button aria-label="Link a page" onClick={onInsertLink} className="rounded p-0.5 text-muted hover:bg-hover">
              <Plus size={15} />
            </button>
          )
        }
      >
        {!linkedPages.length && <p className="text-[12px] text-muted">Type [[ in the note to link a page.</p>}
        <div data-testid="linked-pages">
          {linkedPages.map((x) => (
            <ResourceRow key={x.id} r={x} sub={typeLabel(x)} />
          ))}
        </div>
      </Section>

      <Section title="Backlinks" count={links?.backlinks.length ?? 0}>
        {!links?.backlinks.length && <p className="text-[12px] text-muted">Pages that link here will show up here.</p>}
        <div data-testid="backlinks">
          {links?.backlinks.map((x) => (
            <ResourceRow key={x.id} r={x} sub="Mentions this page" />
          ))}
        </div>
      </Section>

      <Section title="Related files" count={files.length}>
        {!files.length && <p className="text-[12px] text-muted">Files attached with / → File from Drive.</p>}
        {files.map((x) => (
          <ResourceRow key={x.id} r={x} sub={`${formatBytes(x.sizeBytes)} · ${formatDate(x.updatedAt)}`} />
        ))}
      </Section>
    </div>
  );
}
