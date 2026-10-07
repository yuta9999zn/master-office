'use client';

import { PROJECT_DOC_SETS, PROJECT_DOC_TEMPLATES, projectDocTemplate, type ProjectDocCategory } from '@workos/doc-model';
import { WORK_TYPES, type IssueType, type Project, type ProjectDocNode, type TaskView } from '@workos/shared';
import { BookOpen, ChevronDown, ChevronRight, ExternalLink, FilePlus2, Folder, GitPullRequestArrow, ListPlus, Search, Table2 } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { formatShort } from '@/lib/format';
import { useDocItems, useProjectDocActions, useProjectDocs, useTraceability } from '@/lib/tasks';
import { Button, cn, Dialog, EmptyState, FileIcon, Skeleton } from '../ui/primitives';
import { IssueIcon, ISSUE_META } from './issue-bits';

type SetId = keyof typeof PROJECT_DOC_SETS;
const CATEGORIES: ProjectDocCategory[] = ['Business', 'Requirements', 'Design', 'Delivery & Quality', 'Agile', 'AI-DLC'];

/**
 * /tasks?view=docs — the project's documentation space (§76, batch 3): a Confluence-like page tree with the BA and
 * AI-DLC templates, pages that open in the Docs editor, issues made from a page, and requirements traceability.
 */
export function DocsView({ project, tasks, open }: { project: Project; tasks: TaskView[]; open: (id: string) => void }) {
  const { data, isLoading } = useProjectDocs(project.id);
  const { data: trace } = useTraceability(project.id);
  const a = useProjectDocActions();
  const [selected, setSelected] = useState<string | null>(null);
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const [gallery, setGallery] = useState(false);
  const [matrix, setMatrix] = useState(false);
  const [making, setMaking] = useState<ProjectDocNode | null>(null);
  const canEdit = project.perms.write;

  if (isLoading) return <Skeleton className="m-6 h-80" />;
  if (!data?.folderId) return <Setup project={project} />;
  const nodes = data.nodes;
  const page = nodes.find((n) => n.id === selected && n.type !== 'folder') ?? null;
  const children = (parent: string | null) => nodes.filter((n) => n.parentId === parent).sort((x, y) => (x.type === 'folder' ? 0 : 1) - (y.type === 'folder' ? 0 : 1) || x.name.localeCompare(y.name));
  const row = trace?.find((r) => r.doc.id === page?.id);
  const branch = (parent: string | null, depth: number): React.ReactNode =>
    children(parent).map((n) => (
      <li key={n.id}>
        {n.type === 'folder' ? (
          <button
            onClick={() =>
              setClosed((v) => {
                const s = new Set(v);
                if (!s.delete(n.id)) s.add(n.id);
                return s;
              })
            }
            className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-[13px] font-medium text-ink-2 hover:bg-hover"
            style={{ paddingLeft: 8 + depth * 14 }}
            data-testid="docs-folder"
            data-name={n.name}
          >
            {closed.has(n.id) ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
            <Folder size={14} className="text-amber-500" /> <span className="truncate">{n.name}</span>
          </button>
        ) : (
          <button onClick={() => setSelected(n.id)} className={cn('flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-[13px] hover:bg-hover', selected === n.id && 'bg-selected font-medium text-brand-700')} style={{ paddingLeft: 22 + depth * 14 }} data-testid="docs-page" data-name={n.name}>
            <FileIcon r={{ type: n.type, metadata: {}, mimeType: null }} size={15} />
            <span className="min-w-0 flex-1 truncate">{n.name}</span>
            {n.linked > 0 && <span className="rounded-full bg-brand-50 px-1.5 text-[10.5px] font-semibold text-brand-700" title="Linked issues">{n.linked}</span>}
          </button>
        )}
        {n.type === 'folder' && !closed.has(n.id) && <ul>{branch(n.id, depth + 1)}</ul>}
      </li>
    ));

  return (
    <div className="flex h-full min-h-0" data-testid="docs-view">
      <aside className="flex w-[320px] shrink-0 flex-col border-r border-line bg-surface">
        <div className="flex items-center gap-2 border-b border-line px-3 py-2.5">
          <BookOpen size={16} className="text-brand-600" />
          <span className="flex-1 truncate text-[13.5px] font-semibold text-ink">{project.name} — Docs</span>
          {canEdit && (
            <Button size="sm" variant="primary" icon={<FilePlus2 size={14} />} onClick={() => setGallery(true)} data-testid="new-page">
              New page
            </Button>
          )}
        </div>
        <ul className="min-h-0 flex-1 overflow-y-auto p-2" data-testid="docs-tree">
          {branch(null, 0)}
        </ul>
        <button onClick={() => (setMatrix(true), setSelected(null))} className={cn('flex items-center gap-2 border-t border-line px-4 py-2.5 text-[13px] hover:bg-hover', matrix && !page && 'bg-selected font-semibold text-brand-700')} data-testid="traceability">
          <Table2 size={15} /> Traceability matrix
        </button>
      </aside>
      <div className="min-w-0 flex-1 overflow-y-auto bg-canvas p-6">
        {page ? (
          <div className="mx-auto max-w-[860px] space-y-4" data-testid="docs-page-detail">
            <div className="rounded-xl bg-surface p-5 ring-1 ring-line">
              <div className="flex items-start gap-3">
                <FileIcon r={{ type: page.type, metadata: {}, mimeType: null }} size={34} />
                <div className="min-w-0 flex-1">
                  <h2 className="text-[17px] font-semibold text-ink">{page.name}</h2>
                  <p className="text-[12.5px] text-muted">
                    Updated {formatShort(page.updatedAt)}
                    {page.updatedBy ? ` by ${page.updatedBy.name}` : ''}
                  </p>
                </div>
                <Link href={`/docs/${page.id}`} className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-[13px] font-medium text-white hover:bg-brand-700" data-testid="open-page">
                  <ExternalLink size={14} /> Open
                </Link>
                {canEdit && (
                  <Button icon={<ListPlus size={15} />} onClick={() => setMaking(page)} data-testid="issues-from-page">
                    Create issues
                  </Button>
                )}
              </div>
            </div>
            <div className="rounded-xl bg-surface p-5 ring-1 ring-line">
              <h3 className="mb-2 flex items-center gap-1.5 text-[14px] font-semibold text-ink">
                <GitPullRequestArrow size={15} /> Issues tracing to this page
              </h3>
              {row?.issues.length ? (
                <ul className="space-y-1" data-testid="page-issues">
                  {row.issues.map((t) => (
                    <li key={t.id}>
                      <button onClick={() => open(t.id)} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-hover">
                        <IssueIcon type={t.type} size={15} />
                        <span className="w-[80px] font-mono text-[11.5px] text-subtle">{t.ref}</span>
                        <span className={cn('min-w-0 flex-1 truncate', t.done && 'text-muted line-through')}>{t.title}</span>
                        <StatusChip project={project} status={t.status} />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[13px] text-muted">No issues yet. Use “Create issues” on the requirement lines of this page, or link a page from an issue’s panel.</p>
              )}
            </div>
          </div>
        ) : matrix ? (
          <Matrix project={project} open={open} select={setSelected} />
        ) : (
          <EmptyState icon={<BookOpen size={28} />} title="Pick a page">
            Pages open in the Docs editor — everyone in the space reads them, editors write.
          </EmptyState>
        )}
      </div>
      {gallery && <Gallery project={project} onClose={() => setGallery(false)} onMade={(id) => setSelected(id)} />}
      {making && <IssuesFromPage project={project} page={making} tasks={tasks} onClose={() => setMaking(null)} />}
    </div>
  );
}

function StatusChip({ project, status }: { project: Project; status: string }) {
  const s = project.statuses.find((x) => x.id === status);
  if (!s) return null;
  return (
    <span className="shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium" style={{ background: `${s.color}1f`, color: s.color }}>
      {s.name}
    </span>
  );
}

function Setup({ project }: { project: Project }) {
  const a = useProjectDocActions();
  const recommended: SetId = project.methodology === 'waterfall' ? 'waterfall' : project.methodology === 'hybrid' ? 'hybrid' : project.methodology === 'kanban' ? 'kanban' : 'scrum';
  const [set, setSet] = useState<SetId>(recommended);
  return (
    <div className="h-full overflow-y-auto bg-canvas p-8" data-testid="docs-setup">
      <div className="mx-auto max-w-[900px]">
        <div className="mb-5 flex items-center gap-3">
          <span className="grid size-11 place-items-center rounded-xl bg-brand-50 text-brand-600">
            <BookOpen size={22} />
          </span>
          <div>
            <h2 className="text-[19px] font-semibold text-ink">Set up the project documentation</h2>
            <p className="text-[13px] text-muted">A documentation space in the project’s Space — business, requirements, design, delivery and quality — so the team can read, analyse and build from the same pages.</p>
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-2" role="radiogroup" aria-label="Starter set">
          {(Object.keys(PROJECT_DOC_SETS) as SetId[]).map((k) => (
            <button key={k} role="radio" aria-checked={set === k} onClick={() => setSet(k)} className={cn('rounded-xl bg-surface p-4 text-left ring-1', set === k ? 'ring-2 ring-brand-400' : 'ring-line hover:ring-line-strong')} data-testid={`docset-${k}`}>
              <span className="flex items-center gap-2 text-[14px] font-semibold text-ink">
                {PROJECT_DOC_SETS[k].name}
                {k === recommended && <span className="rounded-full bg-emerald-50 px-2 text-[11px] font-medium text-emerald-700">Recommended</span>}
              </span>
              <span className="mt-2 flex flex-wrap gap-1">
                {PROJECT_DOC_SETS[k].templates.map((id) => {
                  const t = projectDocTemplate(id)!;
                  return (
                    <span key={id} className="rounded bg-hover px-1.5 py-0.5 text-[11px] text-ink-2" title={t.description}>
                      {t.code} · {t.name.replace(/^AI-DLC · /, '')}
                    </span>
                  );
                })}
              </span>
            </button>
          ))}
        </div>
        {project.perms.write ? (
          <Button className="mt-5" variant="primary" loading={a.setup.isPending} onClick={() => a.setup.mutate({ projectId: project.id, set }, { onSuccess: () => toast.success('Documentation space ready') })} data-testid="setup-docs">
            Create the documentation space
          </Button>
        ) : (
          <p className="mt-5 text-[13px] text-muted">Editors of the project set this up.</p>
        )}
      </div>
    </div>
  );
}

function Gallery({ project, onClose, onMade }: { project: Project; onClose: () => void; onMade: (id: string) => void }) {
  const a = useProjectDocActions();
  const [q, setQ] = useState('');
  const needle = q.trim().toLowerCase();
  const list = PROJECT_DOC_TEMPLATES.filter((t) => !needle || `${t.name} ${t.code} ${t.description}`.toLowerCase().includes(needle));
  const make = (template: string | null) =>
    a.create.mutate(
      { projectId: project.id, template, ...(template ? {} : { name: 'Untitled page' }) },
      {
        onSuccess: (r) => {
          onMade(r.id);
          onClose();
        },
      },
    );
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="New page" description="Business analysis and AI-DLC templates; the page goes into its section." width={760}>
      <label className="mb-3 flex h-9 items-center gap-2 rounded-lg bg-canvas px-3 text-[13px] ring-1 ring-line focus-within:ring-brand-500">
        <Search size={14} className="text-subtle" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search templates (BRD, use case, test plan…)" aria-label="Search templates" className="min-w-0 flex-1 bg-transparent outline-none" />
      </label>
      <div className="max-h-[60vh] space-y-4 overflow-y-auto pr-1">
        {!needle && (
          <button onClick={() => make(null)} className="w-full rounded-lg px-3 py-2 text-left text-[13px] ring-1 ring-line hover:bg-hover" data-testid="blank-page">
            <b>Blank page</b>
          </button>
        )}
        {CATEGORIES.map((c) => {
          const items = list.filter((t) => t.category === c);
          if (!items.length) return null;
          return (
            <section key={c}>
              <p className="mb-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-subtle">{c}</p>
              <div className="grid grid-cols-2 gap-2">
                {items.map((t) => (
                  <button key={t.id} disabled={a.create.isPending} onClick={() => make(t.id)} className="flex items-start gap-2.5 rounded-lg p-2.5 text-left ring-1 ring-line hover:bg-hover" data-testid="doc-template" data-id={t.id}>
                    <span className="grid h-8 min-w-10 place-items-center rounded-md bg-brand-50 px-1 text-[11px] font-bold text-brand-700">{t.code}</span>
                    <span className="min-w-0">
                      <span className="block text-[13px] font-semibold text-ink">{t.name}</span>
                      <span className="line-clamp-2 text-[12px] text-muted">{t.description}</span>
                    </span>
                  </button>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </Dialog>
  );
}

function IssuesFromPage({ project, page, tasks, onClose }: { project: Project; page: ProjectDocNode; tasks: TaskView[]; onClose: () => void }) {
  const { data: items, isLoading } = useDocItems(page.id);
  const a = useProjectDocActions();
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [type, setType] = useState<IssueType>('story');
  const [parent, setParent] = useState('');
  const groups = useMemo(() => {
    const m = new Map<string, { i: number; text: string }[]>();
    (items ?? []).forEach((x, i) => m.set(x.section ?? '—', [...(m.get(x.section ?? '—') ?? []), { i, text: x.text }]));
    return [...m];
  }, [items]);
  const parents = tasks.filter((t) => !t.triage && (type === 'epic' ? t.type === 'phase' : t.type === 'epic' || t.type === 'phase'));
  const go = () =>
    a.issues.mutate(
      { projectId: project.id, docId: page.id, items: [...picked].sort((x, y) => x - y).map((i) => items![i].text), type, parentId: parent || null },
      {
        onSuccess: (r) => {
          toast.success(`${r.length} ${type === 'story' ? 'stories' : `${ISSUE_META[type].label.toLowerCase()}s`} created and linked to the page`);
          onClose();
        },
      },
    );
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Create issues from this page"
      description="Pick the lines that are work: requirements, stories, units of work. Each issue stays linked to the page."
      width={680}
      footer={
        <Button variant="primary" disabled={!picked.size} loading={a.issues.isPending} onClick={go} data-testid="confirm-issues">
          Create {picked.size || ''}
        </Button>
      }
    >
      <div className="mb-3 flex gap-2">
        <select value={type} onChange={(e) => (setType(e.target.value as IssueType), setParent(''))} aria-label="Issue type" className="h-9 rounded-lg border border-line-strong bg-surface px-2 text-[13px]">
          {(['story', 'task', 'bug', 'epic'] as IssueType[]).map((t) => (
            <option key={t} value={t}>
              {ISSUE_META[t].label}
            </option>
          ))}
        </select>
        <select value={parent} onChange={(e) => setParent(e.target.value)} aria-label="Parent" className="h-9 min-w-0 flex-1 rounded-lg border border-line-strong bg-surface px-2 text-[13px]">
          <option value="">{WORK_TYPES.includes(type) ? 'No epic' : 'No phase'}</option>
          {parents.map((p) => (
            <option key={p.id} value={p.id}>
              {ISSUE_META[p.type].label}: {p.title}
            </option>
          ))}
        </select>
      </div>
      {isLoading ? (
        <Skeleton className="h-40" />
      ) : !items?.length ? (
        <p className="text-[13px] text-muted">No bullet points, checklist items or table rows on this page yet.</p>
      ) : (
        <div className="max-h-[50vh] space-y-3 overflow-y-auto" data-testid="doc-items">
          {groups.map(([section, lines]) => (
            <section key={section}>
              <label className="mb-1 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wide text-subtle">
                <input
                  type="checkbox"
                  checked={lines.every((l) => picked.has(l.i))}
                  onChange={(e) =>
                    setPicked((s) => {
                      const n = new Set(s);
                      for (const l of lines) (e.target.checked ? n.add(l.i) : n.delete(l.i));
                      return n;
                    })
                  }
                  className="accent-brand-600"
                  aria-label={`All of ${section}`}
                />
                {section}
              </label>
              {lines.map((l) => (
                <label key={l.i} className="flex items-start gap-2 rounded-md px-2 py-1 text-[13px] hover:bg-hover">
                  <input
                    type="checkbox"
                    checked={picked.has(l.i)}
                    onChange={() =>
                      setPicked((s) => {
                        const n = new Set(s);
                        if (!n.delete(l.i)) n.add(l.i);
                        return n;
                      })
                    }
                    className="mt-0.5 accent-brand-600"
                    data-testid="doc-item"
                  />
                  <span>{l.text}</span>
                </label>
              ))}
            </section>
          ))}
        </div>
      )}
    </Dialog>
  );
}

function Matrix({ project, open, select }: { project: Project; open: (id: string) => void; select: (id: string) => void }) {
  const { data } = useTraceability(project.id);
  if (!data) return <Skeleton className="h-60" />;
  const rows = data.filter((r) => r.issues.length || r.doc.inProjectDocs);
  return (
    <div className="mx-auto max-w-[1000px] rounded-xl bg-surface ring-1 ring-line" data-testid="trace-matrix">
      <div className="border-b border-line px-5 py-3">
        <h2 className="text-[15px] font-semibold text-ink">Requirements traceability</h2>
        <p className="text-[12.5px] text-muted">Every page and the issues that implement it — coverage shows how much of it is done.</p>
      </div>
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b border-line text-left text-[12px] text-muted">
            <th className="px-5 py-2 font-medium">Document</th>
            <th className="py-2 font-medium">Issues</th>
            <th className="w-32 py-2 pr-5 font-medium">Coverage</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const done = r.issues.filter((i) => i.done).length;
            const pct = r.issues.length ? Math.round((done / r.issues.length) * 100) : 0;
            return (
              <tr key={r.doc.id} className="border-b border-line/70 align-top last:border-0" data-testid="trace-row" data-doc={r.doc.name}>
                <td className="px-5 py-2.5">
                  <button onClick={() => (r.doc.inProjectDocs ? select(r.doc.id) : window.open(`/docs/${r.doc.id}`, '_blank'))} className="text-left font-medium text-ink hover:underline">
                    {r.doc.name}
                  </button>
                  {!r.doc.inProjectDocs && <span className="ml-1.5 text-[11px] text-subtle">(elsewhere in Drive)</span>}
                </td>
                <td className="py-2.5">
                  <span className="flex flex-wrap gap-1">
                    {r.issues.map((i) => (
                      <button key={i.id} onClick={() => open(i.id)} className={cn('inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11.5px] ring-1 ring-line hover:bg-hover', i.done && 'text-muted line-through')} title={i.title}>
                        <IssueIcon type={i.type} size={12} /> {i.ref}
                      </button>
                    ))}
                    {!r.issues.length && <span className="text-[12px] text-red-600">Not covered</span>}
                  </span>
                </td>
                <td className="py-2.5 pr-5">
                  {r.issues.length > 0 && (
                    <span className="flex items-center gap-2">
                      <span className="h-1.5 flex-1 rounded-full bg-hover">
                        <span className="block h-1.5 rounded-full bg-emerald-500" style={{ width: `${pct}%` }} />
                      </span>
                      <span className="w-12 text-right text-[12px] tabular-nums text-ink-2">
                        {done}/{r.issues.length}
                      </span>
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
