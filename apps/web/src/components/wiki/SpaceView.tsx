'use client';

import { can, WIKI_STATUS, type WikiPageNode, type WikiPageStatus, type WikiSpaceDetail } from '@workos/shared';
import { ChevronDown, ChevronRight, Copy, FileText, Home, Link2, MoreHorizontal, Plus, Search, Settings, Tag, Trash2, X } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState, type DragEvent } from 'react';
import { timeAgo } from '@/lib/format';
import { useResource } from '@/lib/queries';
import { useWikiActions, useWikiSpace } from '@/lib/wiki';
import { EditorShell } from '../editor/EditorShell';
import { Avatar, Button, cn, Dialog, EmptyState, IconButton, Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, Skeleton } from '../ui/primitives';
import { TemplatePicker } from './TemplatePicker';

type Drop = { id: string; where: 'before' | 'after' | 'inside' };

/** /wiki/s/:spaceId — a space: its page tree on the left, the open page (meta + editor) on the right (§78). */
export function SpaceView({ spaceId }: { spaceId: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const { data: s, error } = useWikiSpace(spaceId);
  const pageId = params.get('page') ?? s?.homePageId ?? null;
  const open = (id: string) => router.push(`/wiki/s/${spaceId}?page=${id}`);
  const [settings, setSettings] = useState(false);

  if (error) return <EmptyState title="Can’t open this space">{(error as Error).message}</EmptyState>;
  if (!s) return <div className="flex h-full gap-4 p-4"><Skeleton className="h-full w-72" /><Skeleton className="h-full flex-1" /></div>;
  const page = s.tree.find((p) => p.id === pageId) ?? null;
  return (
    <div className="flex h-full min-h-0" data-testid="wiki-space-view">
      <Sidebar s={s} current={page?.id ?? null} open={open} onSettings={() => setSettings(true)} />
      <main className="flex min-w-0 flex-1 flex-col">
        {page ? (
          <>
            <PageMeta s={s} page={page} open={open} />
            <div className="min-h-0 flex-1">
              <EditorShell key={page.id} id={page.id} kind="wiki" />
            </div>
          </>
        ) : (
          <EmptyState title="Pick a page">Choose a page in the tree, or create one.</EmptyState>
        )}
      </main>
      {settings && <SpaceSettings s={s} onClose={() => setSettings(false)} />}
    </div>
  );
}

// ── The page tree ───────────────────────────────────────────────────────────

function Sidebar({ s, current, open, onSettings }: { s: WikiSpaceDetail; current: string | null; open: (id: string) => void; onSettings: () => void }) {
  const a = useWikiActions();
  const canEdit = can(s.role, 'editor');
  const [q, setQ] = useState('');
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState<{ parentId: string | null } | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [drop, setDrop] = useState<Drop | null>(null);
  const [removing, setRemoving] = useState<WikiPageNode | null>(null);

  const kids = useMemo(() => {
    const m = new Map<string | null, WikiPageNode[]>();
    for (const p of s.tree) m.set(p.parentId, [...(m.get(p.parentId) ?? []), p]);
    return m;
  }, [s.tree]);
  const needle = q.trim().toLowerCase();
  const matches = needle ? s.tree.filter((p) => `${p.title} ${p.labels.join(' ')}`.toLowerCase().includes(needle)) : [];

  // The ancestors of the open page stay expanded.
  const isUnder = (id: string, anc: string) => {
    for (let p = s.tree.find((x) => x.id === id); p?.parentId; p = s.tree.find((x) => x.id === p!.parentId)) if (p.parentId === anc) return true;
    return false;
  };
  const expanded = (id: string) => !closed.has(id) || (!!current && isUnder(current, id));
  const toggle = (id: string) => setClosed((c) => { const n = new Set(c); if (expanded(id)) n.add(id); else n.delete(id); return n; });

  const onOver = (e: DragEvent, p: WikiPageNode) => {
    if (!dragId || dragId === p.id || isUnder(p.id, dragId)) return;
    e.preventDefault();
    const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const y = (e.clientY - box.top) / box.height;
    const where = y < 0.28 ? 'before' : y > 0.72 ? 'after' : 'inside';
    if (drop?.id !== p.id || drop.where !== where) setDrop({ id: p.id, where });
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    const d = drop;
    const id = dragId;
    setDrop(null);
    setDragId(null);
    if (!d || !id) return;
    const target = s.tree.find((x) => x.id === d.id)!;
    if (d.where === 'inside') {
      setClosed((c) => { const n = new Set(c); n.delete(target.id); return n; });
      return a.updatePage.mutate({ spaceId: s.id, id, parentId: target.id });
    }
    const sibs = (kids.get(target.parentId) ?? []).filter((x) => x.id !== id);
    const i = sibs.findIndex((x) => x.id === target.id);
    const [afterId, beforeId] = d.where === 'before' ? [sibs[i - 1]?.id ?? null, target.id] : [target.id, sibs[i + 1]?.id ?? null];
    a.updatePage.mutate({ spaceId: s.id, id, parentId: target.parentId, afterId, beforeId });
  };

  const row = (p: WikiPageNode, depth: number) => {
    const children = kids.get(p.id) ?? [];
    const isOpen = expanded(p.id);
    const status = p.status ? WIKI_STATUS[p.status as Exclude<WikiPageStatus, ''>] : null;
    return (
      <li key={p.id}>
        <div
          draggable={canEdit && p.id !== s.homePageId}
          onDragStart={(e) => (e.dataTransfer.setData('text/plain', p.id), (e.dataTransfer.effectAllowed = 'move'), setDragId(p.id))}
          onDragEnd={() => (setDragId(null), setDrop(null))}
          onDragOver={(e) => onOver(e, p)}
          onDragLeave={() => drop?.id === p.id && setDrop(null)}
          onDrop={onDrop}
          className={cn(
            'group relative flex h-8 cursor-pointer items-center gap-1 rounded-md pr-1 text-[13px]',
            current === p.id ? 'bg-selected font-medium text-brand-700' : 'text-ink-2 hover:bg-hover',
            dragId === p.id && 'opacity-40',
            drop?.id === p.id && drop.where === 'inside' && 'ring-2 ring-brand-400',
          )}
          style={{ paddingLeft: 4 + depth * 14 }}
          onClick={() => open(p.id)}
          aria-current={current === p.id ? 'page' : undefined}
          data-testid="wiki-node"
          data-title={p.title}
        >
          {drop?.id === p.id && drop.where !== 'inside' && <span className={cn('pointer-events-none absolute inset-x-1 h-0.5 rounded bg-brand-500', drop.where === 'before' ? 'top-0' : 'bottom-0')} />}
          {children.length ? (
            <button onClick={(e) => (e.stopPropagation(), toggle(p.id))} className="grid size-5 place-items-center rounded text-subtle hover:bg-hover" aria-label={isOpen ? 'Collapse' : 'Expand'}>
              {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button>
          ) : (
            <span className="size-5" />
          )}
          {p.id === s.homePageId ? <Home size={14} className="shrink-0 text-subtle" /> : <FileText size={14} className="shrink-0 text-subtle" />}
          <span className="min-w-0 flex-1 truncate">{p.title}</span>
          {status && <span className="size-2 shrink-0 rounded-full" style={{ background: status.color }} title={status.label} />}
          {canEdit && (
            <span className="hidden items-center group-hover:flex has-[[data-state=open]]:flex" onClick={(e) => e.stopPropagation()}>
              <button onClick={() => setAdding({ parentId: p.id })} className="grid size-6 place-items-center rounded text-muted hover:bg-active" aria-label={`Add a page under ${p.title}`} data-testid="node-add">
                <Plus size={14} />
              </button>
              <Menu>
                <MenuTrigger asChild>
                  <button className="grid size-6 place-items-center rounded text-muted hover:bg-active" aria-label={`More for ${p.title}`} data-testid="node-menu">
                    <MoreHorizontal size={14} />
                  </button>
                </MenuTrigger>
                <MenuContent align="start">
                  <MenuItem icon={<Copy />} onSelect={() => a.copyPage.mutate({ id: p.id }, { onSuccess: (r) => open(r.id) })}>Copy</MenuItem>
                  {children.length > 0 && <MenuItem icon={<Copy />} onSelect={() => a.copyPage.mutate({ id: p.id, withChildren: true }, { onSuccess: (r) => open(r.id) })}>Copy with subpages</MenuItem>}
                  <MenuItem icon={<Link2 />} onSelect={() => void navigator.clipboard?.writeText(`${location.origin}/wiki/s/${s.id}?page=${p.id}`)}>Copy link</MenuItem>
                  {p.id !== s.homePageId && p.parentId && <MenuItem icon={<ChevronRight />} onSelect={() => a.updatePage.mutate({ spaceId: s.id, id: p.id, parentId: null })}>Move to top level</MenuItem>}
                  {p.id !== s.homePageId && <MenuItem icon={<Home />} onSelect={() => a.updateSpace.mutate({ id: s.id, homePageId: p.id })}>Set as space home</MenuItem>}
                  {p.id !== s.homePageId && (
                    <>
                      <MenuSeparator />
                      <MenuItem icon={<Trash2 />} danger onSelect={() => setRemoving(p)}>Delete…</MenuItem>
                    </>
                  )}
                </MenuContent>
              </Menu>
            </span>
          )}
        </div>
        {children.length > 0 && isOpen && <ul>{children.map((c) => row(c, depth + 1))}</ul>}
      </li>
    );
  };

  const subtree = (id: string): number => (kids.get(id) ?? []).reduce((n, c) => n + 1 + subtree(c.id), 0);
  return (
    <aside className="flex w-72 shrink-0 flex-col border-r border-line bg-surface" data-testid="wiki-sidebar">
      <div className="flex items-center gap-2.5 border-b border-line px-3 py-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg text-[12px] font-bold text-white" style={{ background: s.color }}>
          {s.key.slice(0, 2)}
        </span>
        <div className="min-w-0 flex-1">
          <Link href="/wiki" className="block text-[11px] text-subtle hover:text-brand-600">Wiki</Link>
          <p className="truncate text-[14px] font-semibold text-ink" data-testid="space-name">{s.name}</p>
        </div>
        {can(s.role, 'editor') && <IconButton label="Space settings" onClick={onSettings} data-testid="space-settings"><Settings size={16} /></IconButton>}
      </div>
      <div className="px-3 pt-3">
        <label className="flex h-8 items-center gap-2 rounded-lg bg-canvas px-2.5 ring-1 ring-line focus-within:ring-brand-500">
          <Search size={14} className="text-subtle" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search pages and labels" aria-label="Search pages" className="min-w-0 flex-1 bg-transparent text-[12.5px] outline-none" />
          {q && <button onClick={() => setQ('')} aria-label="Clear search" className="text-subtle"><X size={13} /></button>}
        </label>
      </div>
      <div className="flex items-center px-3 pb-1 pt-3">
        <span className="flex-1 text-[11.5px] font-semibold uppercase tracking-wide text-subtle">Pages · {s.tree.length}</span>
        {canEdit && <IconButton label="Create a page" size={26} onClick={() => setAdding({ parentId: null })} data-testid="wiki-add-page"><Plus size={15} /></IconButton>}
      </div>
      <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        {needle ? (
          <ul>
            {matches.map((p) => (
              <li key={p.id}>
                <button onClick={() => open(p.id)} className={cn('flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-hover', current === p.id && 'bg-selected')} data-testid="wiki-match">
                  <FileText size={14} className="shrink-0 text-subtle" />
                  <span className="min-w-0 flex-1 truncate">{p.title}</span>
                </button>
              </li>
            ))}
            {!matches.length && <li className="px-2 py-3 text-[12.5px] text-subtle">No page matches</li>}
          </ul>
        ) : (
          <ul onDragOver={(e) => dragId && e.preventDefault()}>{(kids.get(null) ?? []).map((p) => row(p, 0))}</ul>
        )}
      </nav>
      {adding && (
        <TemplatePicker
          title={adding.parentId ? `New page under “${s.tree.find((x) => x.id === adding.parentId)?.title}”` : 'New page'}
          busy={a.createPage.isPending}
          onClose={() => setAdding(null)}
          onPick={(template) =>
            a.createPage.mutate(
              { spaceId: s.id, parentId: adding.parentId, template },
              {
                onSuccess: (r) => {
                  if (adding.parentId) setClosed((c) => { const n = new Set(c); n.delete(adding.parentId!); return n; });
                  setAdding(null);
                  open(r.id);
                },
              },
            )
          }
        />
      )}
      {removing && (
        <Dialog
          open
          onOpenChange={(o) => !o && setRemoving(null)}
          title={`Delete “${removing.title}”?`}
          description={subtree(removing.id) ? `Its ${subtree(removing.id)} subpage(s) go to the trash too. You can restore them from Drive’s trash.` : 'The page goes to the trash. You can restore it from Drive’s trash.'}
          footer={
            <Button
              variant="danger"
              loading={a.deletePage.isPending}
              onClick={() =>
                a.deletePage.mutate(removing.id, {
                  onSuccess: () => {
                    if (current === removing.id || (current && isUnder(current, removing.id))) open(removing.parentId ?? s.homePageId ?? '');
                    setRemoving(null);
                  },
                })
              }
              data-testid="confirm-delete-page"
            >
              Delete
            </Button>
          }
        />
      )}
    </aside>
  );
}

// ── The page header: breadcrumbs, status, labels, owner ─────────────────────

function PageMeta({ s, page, open }: { s: WikiSpaceDetail; page: WikiPageNode; open: (id: string) => void }) {
  const a = useWikiActions();
  const canEdit = can(s.role, 'editor');
  const [label, setLabel] = useState('');
  const qc = useQueryClient();
  // A rename in the editor's title bar shows in the tree.
  const { data: r } = useResource(page.id);
  useEffect(() => {
    if (r && r.name !== page.title) void qc.invalidateQueries({ queryKey: ['wiki', 'space', s.id] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [r?.name]);
  const crumbs: WikiPageNode[] = [];
  for (let p = s.tree.find((x) => x.id === page.parentId); p; p = s.tree.find((x) => x.id === p!.parentId)) crumbs.unshift(p);
  const status = page.status ? WIKI_STATUS[page.status as Exclude<WikiPageStatus, ''>] : null;
  const setStatus = (v: WikiPageStatus) => a.updatePage.mutate({ spaceId: s.id, id: page.id, status: v });
  const addLabel = () => {
    const v = label.trim();
    if (v) a.updatePage.mutate({ spaceId: s.id, id: page.id, labels: [...page.labels, v] });
    setLabel('');
  };
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-line bg-surface px-4 py-2 text-[12.5px]" data-testid="wiki-page-meta">
      <nav className="flex min-w-0 items-center gap-1 text-muted" aria-label="Breadcrumbs">
        <button onClick={() => s.homePageId && open(s.homePageId)} className="hover:text-brand-600">{s.name}</button>
        {crumbs.map((c) => (
          <span key={c.id} className="flex items-center gap-1">
            <ChevronRight size={12} className="text-subtle" />
            <button onClick={() => open(c.id)} className="max-w-48 truncate hover:text-brand-600">{c.title}</button>
          </span>
        ))}
      </nav>
      <span className="ml-auto" />
      <Menu>
        <MenuTrigger asChild disabled={!canEdit}>
          <button className="rounded px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ring-1 ring-line" style={status ? { background: status.color, color: '#fff' } : undefined} data-testid="page-status">
            {status?.label ?? 'Set status'}
          </button>
        </MenuTrigger>
        <MenuContent align="end">
          {(Object.keys(WIKI_STATUS) as Exclude<WikiPageStatus, ''>[]).map((k) => (
            <MenuItem key={k} icon={<span className="size-2.5 rounded-full" style={{ background: WIKI_STATUS[k].color }} />} onSelect={() => setStatus(k)}>
              {WIKI_STATUS[k].label}
            </MenuItem>
          ))}
          <MenuSeparator />
          <MenuItem onSelect={() => setStatus('')}>No status</MenuItem>
        </MenuContent>
      </Menu>
      <div className="flex flex-wrap items-center gap-1" data-testid="page-labels">
        <Tag size={13} className="text-subtle" />
        {page.labels.map((l) => (
          <span key={l} className="flex items-center gap-0.5 rounded bg-canvas px-1.5 py-0.5 text-[11.5px] text-ink-2 ring-1 ring-line">
            {l}
            {canEdit && (
              <button onClick={() => a.updatePage.mutate({ spaceId: s.id, id: page.id, labels: page.labels.filter((x) => x !== l) })} aria-label={`Remove label ${l}`} className="text-subtle hover:text-red-600">
                <X size={11} />
              </button>
            )}
          </span>
        ))}
        {canEdit && (
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addLabel()}
            onBlur={addLabel}
            placeholder="Add label"
            aria-label="Add label"
            className="h-6 w-24 rounded bg-transparent px-1 text-[12px] outline-none focus:ring-1 focus:ring-brand-400"
          />
        )}
      </div>
      {page.linked > 0 && <span className="text-muted" title="Issues that trace to this page">{page.linked} linked issue{page.linked === 1 ? '' : 's'}</span>}
      {page.owner && (
        <span className="flex items-center gap-1 text-muted" title="Owner">
          <Avatar user={page.owner} size={18} />
          {page.owner.name}
        </span>
      )}
      <span className="text-subtle">
        Edited {timeAgo(page.updatedAt)}
        {page.updatedBy ? ` by ${page.updatedBy.name}` : ''}
      </span>
    </div>
  );
}

// ── Space settings ──────────────────────────────────────────────────────────

const COLORS = ['#0d9488', '#2563eb', '#7c3aed', '#db2777', '#ea580c', '#ca8a04', '#16a34a', '#475569'];
const input = 'h-9 w-full rounded-lg border border-line-strong bg-surface px-3 text-[13px] outline-none focus:border-brand-500';

function SpaceSettings({ s, onClose }: { s: WikiSpaceDetail; onClose: () => void }) {
  const a = useWikiActions();
  const [name, setName] = useState(s.name);
  const [description, setDescription] = useState(s.description ?? '');
  const [color, setColor] = useState(s.color);
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Space settings"
      description={`Key ${s.key}. Who can read and edit follows the space folder’s sharing in Drive.`}
      width={520}
      footer={
        <>
          <Link href={`/drive/folder/${s.folderId}`} className="mr-auto text-[13px] text-brand-600 hover:underline">Manage access in Drive</Link>
          <Button variant="primary" disabled={!name.trim()} loading={a.updateSpace.isPending} onClick={() => a.updateSpace.mutate({ id: s.id, name, description: description || null, color }, { onSuccess: onClose })} data-testid="space-settings-save">
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <input value={name} onChange={(e) => setName(e.target.value)} aria-label="Space name" className={input} />
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} placeholder="What is this space for?" aria-label="Space description" className={cn(input, 'h-auto py-2')} />
        <div className="flex gap-2" role="radiogroup" aria-label="Colour">
          {COLORS.map((c) => (
            <button key={c} role="radio" aria-checked={color === c} aria-label={c} onClick={() => setColor(c)} className={cn('size-7 rounded-full', color === c && 'ring-2 ring-offset-2 ring-brand-500')} style={{ background: c }} />
          ))}
        </div>
      </div>
    </Dialog>
  );
}
