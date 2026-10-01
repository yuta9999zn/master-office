'use client';

import type { DriveView, ListResourcesQuery, Resource, ResourceType, Space } from '@workos/shared';
import { can } from '@workos/shared';
import {
  ArrowDownUp,
  ChevronDown,
  ChevronRight,
  Clock,
  CloudUpload,
  Download,
  GalleryVerticalEnd,
  HardDrive,
  House,
  LayoutGrid,
  List,
  MoreHorizontal,
  PanelRight,
  Plus,
  Rows3,
  Share2,
  Star,
  Trash2,
  Upload,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { downloadUrl } from '@/lib/api';
import { useResource, useResourceActions, useResourceMembers, useResources, useSpaceMembers, useSpaces } from '@/lib/queries';
import { hrefFor, TYPE_TABS } from '@/lib/resources';
import { useUi, type ViewMode } from '@/lib/store';
import { NewMenu } from '../shell/NewMenu';
import { SpaceBadge } from '../shell/Sidebar';
import { AvatarStack, Button, cn, Dialog, EmptyState, FileIcon, IconButton, Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger, Skeleton } from '../ui/primitives';
import { buildActions, DropdownActions, hasBlob, type ActionHandlers } from './actions';
import { ResourceDetails, SpaceDetails } from './DetailsPanel';
import { MoveDialog, RenameDialog, ShareDialog } from './dialogs';
import { FileGallery, FileView } from './FileViews';
import { DropdownMenu as DM } from 'radix-ui';

export type DriveLocation = { kind: 'view'; view: DriveView } | { kind: 'folder'; id: string } | { kind: 'space'; id: string };

const VIEW_META: Record<DriveView, { title: string; icon: ReactNode; subtitle: string }> = {
  home: { title: 'Home', icon: <House size={22} />, subtitle: 'Recently opened files and quick access' },
  my: { title: 'My files', icon: <HardDrive size={22} />, subtitle: 'Files you own that are not in a space' },
  shared: { title: 'Shared with me', icon: <Users size={22} />, subtitle: 'Files other people shared with you directly' },
  recent: { title: 'Recent', icon: <Clock size={22} />, subtitle: 'Files you opened recently' },
  starred: { title: 'Starred', icon: <Star size={22} />, subtitle: 'Your favorites across every space' },
  trash: { title: 'Trash', icon: <Trash2 size={22} />, subtitle: 'Restore items or delete them forever' },
};

const VIEW_MODES: { id: ViewMode; label: string; icon: ReactNode }[] = [
  { id: 'list', label: 'List', icon: <List size={17} /> },
  { id: 'grid', label: 'Grid', icon: <LayoutGrid size={17} /> },
  { id: 'gallery', label: 'Gallery', icon: <GalleryVerticalEnd size={17} /> },
  { id: 'compact', label: 'Compact', icon: <Rows3 size={17} /> },
];

function spaceChain(spaces: Space[] | undefined, id: string | null | undefined): Space[] {
  const out: Space[] = [];
  let cur = spaces?.find((s) => s.id === id);
  while (cur) {
    out.unshift(cur);
    cur = spaces?.find((s) => s.id === cur!.parentId);
  }
  return out;
}

export function FileBrowser({ location, embedded = false }: { location: DriveLocation; embedded?: boolean }) {
  const router = useRouter();
  const { viewMode, setViewMode, detailsOpen, setDetailsOpen } = useUi();
  const acts = useResourceActions();
  const { data: spaces } = useSpaces();

  const view = location.kind === 'view' ? location.view : null;
  const inTrash = view === 'trash';
  const folderId = location.kind === 'folder' ? location.id : null;
  const spaceId = location.kind === 'space' ? location.id : null;

  // ── Data ──────────────────────────────────────────────────────────────────
  const [sort, setSort] = useState<Pick<ListResourcesQuery, 'sort' | 'order'>>({});
  const [tab, setTab] = useState('all');
  const query: ListResourcesQuery = useMemo(() => {
    const base = folderId ? { parentId: folderId } : spaceId ? { spaceId } : { view: view === 'home' ? 'recent' : view! };
    return { ...base, ...sort } as ListResourcesQuery;
  }, [folderId, spaceId, view, sort]);
  const { data: items, isLoading, error } = useResources(query);
  const { data: folder } = useResource(folderId);
  const { data: folderMembers } = useResourceMembers(folderId);
  const space = spaces?.find((s) => s.id === (spaceId ?? folder?.spaceId));
  const { data: spaceMembers } = useSpaceMembers(spaceId ?? undefined);

  const tabTypes = TYPE_TABS.find((t) => t.id === tab)?.types;
  const visible = useMemo(() => (items ?? []).filter((r) => !tabTypes || tabTypes.includes(r.type as ResourceType)), [items, tabTypes]);

  // ── Selection ─────────────────────────────────────────────────────────────
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const anchor = useRef<number>(-1);
  useEffect(() => {
    setSelected(new Set());
    setTab('all');
  }, [location.kind, folderId, spaceId, view]);
  const selectedItems = visible.filter((r) => selected.has(r.id));

  const onSelect = useCallback(
    (e: MouseEvent, r: Resource, index: number) => {
      if (e.shiftKey && anchor.current >= 0) {
        const [a, b] = [Math.min(anchor.current, index), Math.max(anchor.current, index)];
        setSelected(new Set(visible.slice(a, b + 1).map((x) => x.id)));
        return;
      }
      if (e.ctrlKey || e.metaKey) {
        setSelected((s) => {
          const n = new Set(s);
          if (n.has(r.id)) n.delete(r.id);
          else n.add(r.id);
          return n;
        });
      } else setSelected(new Set([r.id]));
      anchor.current = index;
    },
    [visible],
  );

  // ── Dialogs & actions ─────────────────────────────────────────────────────
  const [shareTarget, setShareTarget] = useState<Resource | null>(null);
  const [renameTarget, setRenameTarget] = useState<Resource | null>(null);
  const [confirmDestroy, setConfirmDestroy] = useState<Resource[] | null>(null);
  const [moveTargets, setMoveTargets] = useState<{ items: Resource[]; mode: 'move' | 'copy' } | null>(null);

  const open = useCallback(
    (r: Resource) => {
      if (inTrash) return;
      acts.recordAccess.mutate(r.id);
      router.push(r.type === 'folder' ? `/drive/folder/${r.id}` : hrefFor(r));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [inTrash, router],
  );

  const download = (rs: Resource[]) => {
    rs.forEach((r, i) =>
      setTimeout(() => {
        const a = document.createElement('a');
        a.href = downloadUrl(r.id);
        a.download = r.name;
        a.click();
      }, i * 250),
    );
  };

  const handlers: ActionHandlers = {
    open,
    share: setShareTarget,
    rename: setRenameTarget,
    move: (rs) => setMoveTargets({ items: rs, mode: 'move' }),
    copy: (rs) => (rs.length === 1 ? acts.copy.mutate({ id: rs[0].id }) : setMoveTargets({ items: rs, mode: 'copy' })),
    trash: (rs) => {
      acts.trash.mutate(rs.map((r) => r.id));
      setSelected(new Set());
    },
    restore: (rs) => acts.restore.mutate(rs.map((r) => r.id)),
    destroy: setConfirmDestroy,
    star: (r, on) => acts.star.mutate({ id: r.id, on }),
    download,
    details: (r) => {
      setSelected(new Set([r.id]));
      setDetailsOpen(true);
    },
  };
  const actionsFor = (r: Resource) => buildActions(selected.has(r.id) && selected.size > 1 ? selectedItems : [r], handlers, inTrash);

  // ── Upload (button + drag & drop) ─────────────────────────────────────────
  const fileInput = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const target = folderId ? { parentId: folderId } : spaceId ? { spaceId } : {};
  const canWrite = inTrash ? false : folderId ? can(folder?.myRole, 'editor') : spaceId ? can(space?.myRole, 'editor') : true;
  const upload = (files: FileList | File[] | null) => {
    if (!files?.length || !canWrite) return;
    acts.upload.mutate({ files: [...files], ...target });
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    upload(e.dataTransfer.files);
  };

  // ── Keyboard ──────────────────────────────────────────────────────────────
  const onKeyDown = (e: KeyboardEvent) => {
    // Ignore keys from portaled dialogs/menus (React bubbles them here) and from text fields.
    if (!e.currentTarget.contains(e.target as Node)) return;
    if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'TEXTAREA') return;
    if (e.key === 'Delete' && selectedItems.length && !inTrash && selectedItems.every((r) => can(r.myRole, 'editor'))) handlers.trash(selectedItems);
    if (e.key === 'Enter' && selectedItems.length === 1) open(selectedItems[0]);
    if (e.key === 'F2' && selectedItems.length === 1 && can(selectedItems[0].myRole, 'editor')) setRenameTarget(selectedItems[0]);
    if (e.key === 'Escape') setSelected(new Set());
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      setSelected(new Set(visible.map((r) => r.id)));
    }
  };

  // ── Header model ──────────────────────────────────────────────────────────
  const crumbs: { label: string; href?: string }[] = [];
  let title = '';
  let subtitle: string | null | undefined = '';
  let icon: ReactNode = null;
  let members = folderId ? folderMembers?.map((m) => m.principal) : spaceMembers?.map((m) => m.user);
  if (view) {
    ({ title, subtitle, icon } = VIEW_META[view]);
    icon = <span className="flex size-11 items-center justify-center rounded-xl bg-brand-50 text-brand-600">{icon}</span>;
    members = undefined;
  } else if (spaceId) {
    const chain = spaceChain(spaces, spaceId);
    chain.slice(0, -1).forEach((s) => crumbs.push({ label: s.name, href: `/drive/space/${s.id}` }));
    title = space?.name ?? '';
    subtitle = space?.description;
    icon = space ? <SpaceBadge space={space} size={44} /> : <Skeleton className="size-11" />;
  } else if (folder) {
    const chain = spaceChain(spaces, folder.spaceId);
    chain.slice(0, -1).forEach((s) => crumbs.push({ label: s.name, href: `/drive/space/${s.id}` }));
    for (const b of folder.breadcrumb) {
      crumbs.push({ label: b.name, href: b.kind === 'space' ? `/drive/space/${b.id}` : b.kind === 'root' ? `/drive/${b.id}` : `/drive/folder/${b.id}` });
    }
    title = folder.name;
    subtitle = folder.description;
    icon = <FileIcon r={folder} size={44} />;
  }

  const shareContainer = () => {
    if (selectedItems.length === 1) setShareTarget(selectedItems[0]);
    else if (folder) setShareTarget(folder);
    else if (spaceId) router.push(`/spaces/${spaceId}?tab=members`);
  };

  const detailsTarget = selectedItems.length === 1 ? { kind: 'resource' as const, id: selectedItems[0].id } : folderId ? { kind: 'resource' as const, id: folderId } : space && spaceId ? { kind: 'space' as const, space } : null;
  const showDetails = detailsOpen && !!detailsTarget && !inTrash;

  const quickAccess = view === 'home' ? (items ?? []).slice(0, 6) : [];
  const moreTabs = TYPE_TABS.slice(5);
  const activeMore = moreTabs.find((t) => t.id === tab);

  return (
    <div className="flex h-full min-w-0">
      <div
        className="relative flex min-w-0 flex-1 flex-col bg-surface outline-none"
        tabIndex={0}
        onKeyDown={onKeyDown}
        onDragOver={(e) => {
          if (canWrite && e.dataTransfer.types.includes('Files')) {
            e.preventDefault();
            setDragging(true);
          }
        }}
        onDragLeave={(e) => e.currentTarget === e.target && setDragging(false)}
        onDrop={onDrop}
      >
        {/* Header */}
        {!embedded && (
          <div className="px-6 pt-4">
            <div className="flex min-h-5 items-center gap-1 text-[13px] text-muted">
              {crumbs.map((c, i) => (
                <span key={i} className="flex items-center gap-1">
                  {c.href ? (
                    <Link href={c.href} className="rounded px-1 hover:bg-hover hover:text-ink">
                      {c.label}
                    </Link>
                  ) : (
                    c.label
                  )}
                  <ChevronRight size={13} className="text-subtle" />
                </span>
              ))}
              {!!crumbs.length && <span className="px-1 text-ink-2">{title}</span>}
            </div>
            <div className="mt-2 flex items-start gap-3.5">
              {icon}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h1 className="truncate text-[22px] font-bold tracking-tight text-ink">{title || ' '}</h1>
                  {folder && (
                    <button onClick={() => acts.star.mutate({ id: folder.id, on: !folder.starred })} aria-label="Star" className="rounded p-1 hover:bg-hover">
                      <Star size={18} className={folder.starred ? 'fill-amber-400 text-amber-400' : 'text-subtle'} />
                    </button>
                  )}
                </div>
                {subtitle && <p className="mt-0.5 truncate text-[13px] text-muted">{subtitle}</p>}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {!!members?.length && <AvatarStack users={members} max={3} size={30} />}
                {!view && (
                  <Button variant="primary" icon={<Share2 size={15} />} onClick={shareContainer}>
                    Share
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Type tabs */}
        <div className={cn('flex items-center gap-6 border-b border-line px-6', embedded ? 'mt-0' : 'mt-3')}>
          {TYPE_TABS.slice(0, 5).map((t) => (
            <button key={t.id} data-state={tab === t.id ? 'active' : undefined} className="tab" onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
          <Menu>
            <MenuTrigger asChild>
              <button data-state={activeMore ? 'active' : undefined} className="tab gap-1">
                {activeMore?.label ?? 'More'} <ChevronDown size={14} />
              </button>
            </MenuTrigger>
            <MenuContent>
              {moreTabs.map((t) => (
                <MenuItem key={t.id} onSelect={() => setTab(t.id)}>
                  {t.label}
                </MenuItem>
              ))}
            </MenuContent>
          </Menu>
        </div>

        {/* Toolbar */}
        <div className="flex items-center gap-2 px-6 py-3">
          {!inTrash && (
            <NewMenu
              target={target}
              onUpload={() => fileInput.current?.click()}
              openAfterCreate
              trigger={
                <Button variant="primary" disabled={!canWrite} icon={<Plus size={16} />}>
                  New <ChevronDown size={14} className="-mr-1 opacity-80" />
                </Button>
              }
            />
          )}
          {!inTrash && (
            <Button icon={<Upload size={15} />} disabled={!canWrite} loading={acts.upload.isPending} onClick={() => fileInput.current?.click()}>
              Upload
            </Button>
          )}
          {!inTrash && (
            <Button icon={<Share2 size={15} />} disabled={!view ? false : selectedItems.length !== 1} onClick={shareContainer}>
              Share
            </Button>
          )}
          {!inTrash && (
            <Button icon={<Download size={15} />} disabled={!selectedItems.some(hasBlob)} onClick={() => download(selectedItems.filter(hasBlob))}>
              Download
            </Button>
          )}
          {!!selectedItems.length && (
            <DM.Root>
              <DM.Trigger asChild>
                <Button aria-label="More actions">
                  <MoreHorizontal size={16} />
                </Button>
              </DM.Trigger>
              <DM.Portal>
                <DM.Content sideOffset={4} className="pop z-50 min-w-[210px] animate-pop" onCloseAutoFocus={(e) => e.preventDefault()}>
                  <DropdownActions actions={buildActions(selectedItems, handlers, inTrash)} />
                </DM.Content>
              </DM.Portal>
            </DM.Root>
          )}
          {selectedItems.length > 1 && <span className="ml-1 text-[13px] text-muted">{selectedItems.length} selected</span>}

          <div className="ml-auto flex items-center gap-0.5">
            {VIEW_MODES.map((m) => (
              <IconButton key={m.id} label={m.label} active={viewMode === m.id} onClick={() => setViewMode(m.id)}>
                {m.icon}
              </IconButton>
            ))}
            <Menu>
              <MenuTrigger asChild>
                <IconButton label="Sort">
                  <ArrowDownUp size={17} />
                </IconButton>
              </MenuTrigger>
              <MenuContent align="end">
                <MenuLabel>Sort by</MenuLabel>
                {(
                  [
                    ['name', 'Name'],
                    ['updatedAt', 'Last modified'],
                    ['size', 'Size'],
                    ['type', 'Type'],
                  ] as const
                ).map(([k, label]) => (
                  <MenuItem key={k} onSelect={() => setSort({ sort: k, order: sort.sort === k && sort.order === 'asc' ? 'desc' : 'asc' })}>
                    {label} {sort.sort === k && <span className="ml-auto text-[11px] text-muted">{sort.order === 'asc' ? '↑' : '↓'}</span>}
                  </MenuItem>
                ))}
                <MenuSeparator />
                <MenuItem onSelect={() => setSort({})}>Default</MenuItem>
              </MenuContent>
            </Menu>
            {!inTrash && (
              <IconButton label="Details" active={showDetails} onClick={() => setDetailsOpen(!detailsOpen)}>
                <PanelRight size={17} />
              </IconButton>
            )}
          </div>
        </div>

        {/* Content */}
        <div className="min-h-0 flex-1 overflow-auto" onClick={(e) => e.target === e.currentTarget && setSelected(new Set())}>
          {quickAccess.length > 0 && tab === 'all' && (
            <div className="border-b border-line pb-2">
              <div className="px-6 pt-1 text-[13px] font-semibold text-ink">Quick access</div>
              <FileGallery
                items={quickAccess}
                selected={selected}
                onSelect={(e, r) => onSelect(e, r, visible.indexOf(r))}
                onOpen={open}
                actionsFor={actionsFor}
                onContextSelect={(r) => !selected.has(r.id) && setSelected(new Set([r.id]))}
                sort={sort}
                onSort={() => undefined}
              />
            </div>
          )}
          {isLoading ? (
            <div className="space-y-2 px-6 py-3">
              {Array.from({ length: 8 }, (_, i) => (
                <Skeleton key={i} className="h-9" />
              ))}
            </div>
          ) : error ? (
            <EmptyState title="Can’t open this location">{(error as Error).message}</EmptyState>
          ) : visible.length === 0 ? (
            <EmptyState
              icon={inTrash ? <Trash2 size={36} /> : <CloudUpload size={40} />}
              title={inTrash ? 'Trash is empty' : tab !== 'all' ? 'Nothing of this type here' : 'This location is empty'}
              action={
                canWrite && tab === 'all' ? (
                  <Button variant="primary" icon={<Upload size={15} />} onClick={() => fileInput.current?.click()}>
                    Upload files
                  </Button>
                ) : undefined
              }
            >
              {canWrite && tab === 'all' ? 'Drag files here or use New to create a document, spreadsheet or presentation.' : undefined}
            </EmptyState>
          ) : (
            <div className={cn(viewMode === 'list' || viewMode === 'compact' ? 'px-4' : '')}>
              <FileView
                mode={viewMode}
                items={visible}
                selected={selected}
                onSelect={onSelect}
                onOpen={open}
                actionsFor={actionsFor}
                onContextSelect={(r) => !selected.has(r.id) && setSelected(new Set([r.id]))}
                sort={sort}
                onSort={(k) => setSort({ sort: k, order: sort.sort === k && sort.order === 'asc' ? 'desc' : 'asc' })}
              />
            </div>
          )}
        </div>

        {dragging && (
          <div className="pointer-events-none absolute inset-2 z-10 flex items-center justify-center rounded-2xl border-2 border-dashed border-brand-600 bg-brand-50/80">
            <div className="flex flex-col items-center gap-2 text-brand-600">
              <CloudUpload size={40} />
              <div className="text-[15px] font-semibold">Drop to upload to {title || 'this location'}</div>
            </div>
          </div>
        )}
        <input ref={fileInput} type="file" multiple hidden onChange={(e) => (upload(e.target.files), (e.target.value = ''))} />
      </div>

      {showDetails &&
        (detailsTarget.kind === 'resource' ? (
          <ResourceDetails id={detailsTarget.id} onClose={() => setDetailsOpen(false)} onShare={setShareTarget} actions={(r) => buildActions([r], handlers, inTrash)} />
        ) : (
          <SpaceDetails space={detailsTarget.space} onClose={() => setDetailsOpen(false)} />
        ))}

      <ShareDialog resource={shareTarget} onClose={() => setShareTarget(null)} />
      <RenameDialog resource={renameTarget} onClose={() => setRenameTarget(null)} />
      <Dialog
        open={!!confirmDestroy}
        onOpenChange={(v) => !v && setConfirmDestroy(null)}
        title="Delete forever?"
        description={
          confirmDestroy &&
          `${confirmDestroy.length > 1 ? `${confirmDestroy.length} items` : `“${confirmDestroy[0].name}”`} and everything inside will be permanently deleted. This cannot be undone.`
        }
        width={420}
        footer={
          <>
            <Button onClick={() => setConfirmDestroy(null)}>Cancel</Button>
            <Button
              variant="danger"
              loading={acts.destroy.isPending}
              onClick={async () => {
                await acts.destroy.mutateAsync(confirmDestroy!.map((r) => r.id));
                setConfirmDestroy(null);
                setSelected(new Set());
              }}
            >
              Delete forever
            </Button>
          </>
        }
      />
      <MoveDialog items={moveTargets?.items ?? null} mode={moveTargets?.mode ?? 'move'} onClose={() => setMoveTargets(null)} />
    </div>
  );
}
