'use client';

import type { ResourceDetail } from '@workos/shared';
import { can } from '@workos/shared';
import { EditorContent, type Editor } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import {
  AlertTriangle,
  Bold,
  ChevronRight,
  Columns2,
  Download,
  FileText,
  Highlighter,
  Italic,
  Link2,
  MessageSquarePlus,
  MoreHorizontal,
  Network,
  PanelRight,
  PencilLine,
  RefreshCw,
  Share2,
  Star,
  Strikethrough,
  Trash2,
  Underline,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { useComments, useMe, useResourceActions, useResourceActivity, useResourceMembers } from '@/lib/queries';
import { ActivityList } from '../drive/DetailsPanel';
import { ShareDialog } from '../drive/dialogs';
import { anchorFromSelection, refreshAnchors } from '../docs/comment-anchors';
import { CommentsPanel, type Draft } from '../docs/CommentsPanel';
import { EmbedDialog } from '../docs/DocsWorkspace';
import { FindBar } from '../docs/FindBar';
import { useCollab, type CollabSession } from '../docs/useCollab';
import { useLiveEditor } from '../docs/useLiveEditor';
import { Avatar, AvatarStack, Button, cn, Dialog, EmptyState, IconButton, Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, Skeleton, Tip } from '../ui/primitives';
import { MindMapCanvas } from './MindMapCanvas';
import { NoteProperties } from './NoteProperties';
import { notebookOf } from './NotesNav';
import { useMindMap } from './useMindMap';

type ViewMode = 'note' | 'mindmap' | 'both';
type Panel = 'Properties' | 'Comments' | 'Activity';

export function NoteWorkspace({ r }: { r: ResourceDetail }) {
  const { data: me } = useMe();
  const collab = useCollab(r.id, me && { id: me.user.id, name: me.user.name, color: me.user.avatarColor });
  if (collab.error) return <EmptyState icon={<AlertTriangle size={30} />} title="Can’t open this note">{collab.error}</EmptyState>;
  if (!collab.session || !me)
    return (
      <div className="space-y-3 p-6">
        <Skeleton className="h-8 w-96" />
        <Skeleton className="h-[70vh]" />
      </div>
    );
  return <NoteBody key={r.id} r={r} session={collab.session} synced={collab.synced} status={collab.status} peers={collab.peers} me={me.user} onStateless={collab.onStateless} />;
}

function NoteBody({
  r,
  session,
  synced,
  status,
  peers,
  me,
  onStateless,
}: {
  r: ResourceDetail;
  session: CollabSession;
  synced: boolean;
  status: string;
  peers: { userId: string; name: string; color: string }[];
  me: { id: string; name: string; avatarColor: string };
  onStateless: (h: (p: Record<string, unknown>) => void) => () => void;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const canEdit = can(session.role, 'editor');
  const canComment = can(session.role, 'commenter');
  const acts = useResourceActions();
  const { data: members } = useResourceMembers(r.id);
  const { data: activity, isLoading: loadingActivity } = useResourceActivity(r.id);
  const { data: threads = [], refetch: refetchComments } = useComments(r.id);
  const threadsRef = useRef(threads);
  threadsRef.current = threads;
  const [active, setActive] = useState<string | null>(null);
  const activeRef = useRef(active);
  activeRef.current = active;

  const [view, setView] = useState<ViewMode>((params.get('view') as ViewMode) ?? 'note');
  const [panel, setPanel] = useState<Panel | null>('Properties');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [find, setFind] = useState<{ replace: boolean } | null>(null);
  const [share, setShare] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [confirmConvert, setConfirmConvert] = useState(false);
  const [attach, setAttach] = useState<{ target: 'note' } | { target: 'mind'; parentId: string } | null>(null);
  const imageInput = useRef<HTMLInputElement>(null);

  const { editor, uploadImages } = useLiveEditor({
    resourceId: r.id,
    session,
    me,
    canEdit,
    testId: 'note-editor',
    placeholder: 'Write your notes… type / for blocks, [[ to link a page, @ to mention',
    threadsRef,
    activeRef,
    onSelectComment: (id) => (setPanel('Comments'), setActive(id)),
    onLink: () => editor?.chain().focus().insertContent('[[').run(),
    onComment: (ed) => startComment(ed),
    onFind: (replace) => setFind({ replace }),
    onImage: () => imageInput.current?.click(),
    onEmbed: () => setAttach({ target: 'note' }),
  });
  const mind = useMindMap(session.doc, r.name, canEdit);

  function startComment(ed: Editor) {
    const a = anchorFromSelection(ed);
    if (!a) return toast.info('Select some text to comment on');
    setDraft(a);
    setPanel('Comments');
  }

  useEffect(() => onStateless((p) => p.type === 'comments' && void refetchComments()), [onStateless, refetchComments]);
  useEffect(() => refreshAnchors(editor), [editor, threads, active, synced]);
  useEffect(() => {
    const url = new URL(window.location.href);
    if (view === 'note') url.searchParams.delete('view');
    else url.searchParams.set('view', view);
    window.history.replaceState(null, '', url);
  }, [view]);

  const convert = () => {
    if (!editor) return;
    mind.actions.convertFrom(r.name, editor.getJSON());
    setConfirmConvert(false);
    if (view === 'note') setView('mindmap');
    toast.success('Mind map generated from your notes');
  };

  const crumbs = notebookOf(r).split('/');
  const tabs: { id: ViewMode; label: string; icon: ReactNode }[] = [
    { id: 'note', label: 'Note', icon: <FileText size={15} /> },
    { id: 'mindmap', label: 'Mind Map', icon: <Network size={15} /> },
    { id: 'both', label: 'Both', icon: <Columns2 size={15} /> },
  ];

  const noteView = editor && (
    <div className="relative h-full">
      {find && <FindBar editor={editor} withReplace={find.replace} canEdit={canEdit} suggesting={false} onClose={() => setFind(null)} />}
      <div className="h-full overflow-y-auto">
        <article className="mx-auto max-w-[760px] px-10 pb-24 pt-2">
          <EditorContent editor={editor} />
        </article>
      </div>
      <BubbleMenu editor={editor} options={{ placement: 'top' }} className="flex items-center gap-0.5 rounded-xl border border-line bg-white p-1 shadow-[var(--shadow-pop)]">
        {canEdit &&
          (
            [
              ['Bold', <Bold key="b" size={15} />, () => editor.chain().focus().toggleBold().run(), editor.isActive('bold')],
              ['Italic', <Italic key="i" size={15} />, () => editor.chain().focus().toggleItalic().run(), editor.isActive('italic')],
              ['Underline', <Underline key="u" size={15} />, () => editor.chain().focus().toggleUnderline().run(), editor.isActive('underline')],
              ['Strikethrough', <Strikethrough key="s" size={15} />, () => editor.chain().focus().toggleStrike().run(), editor.isActive('strike')],
              ['Highlight', <Highlighter key="h" size={15} />, () => editor.chain().focus().toggleHighlight({ color: '#fef08a' }).run(), editor.isActive('highlight')],
              ['Link to page', <Link2 key="l" size={15} />, () => editor.chain().focus().insertContent('[[').run(), false],
            ] as const
          ).map(([label, icon, fn, on]) => (
            <button key={label} aria-label={label} onMouseDown={(e) => e.preventDefault()} onClick={fn} className={cn('flex size-8 items-center justify-center rounded-md text-ink-2 hover:bg-hover', on && 'bg-selected text-brand-600')}>
              {icon}
            </button>
          ))}
        {canComment && (
          <button aria-label="Comment" onMouseDown={(e) => e.preventDefault()} onClick={() => startComment(editor)} className="flex h-8 items-center gap-1 rounded-md px-2 text-[13px] text-ink-2 hover:bg-hover">
            <MessageSquarePlus size={15} /> Comment
          </button>
        )}
      </BubbleMenu>
    </div>
  );

  const mindView = (
    <MindMapCanvas
      nodes={mind.nodes}
      edges={mind.edges}
      actions={mind.actions}
      editable={canEdit}
      hasMap={mind.hasMap}
      onAttach={(parentId) => setAttach({ target: 'mind', parentId })}
      onConvert={() => (mind.hasMap ? setConfirmConvert(true) : convert())}
    />
  );

  return (
    <div className="flex h-full min-w-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Header */}
        <div className="shrink-0 px-6 pt-4">
          <div className="flex items-center gap-3">
            <div className="flex min-w-0 items-center gap-1 text-[13px] text-muted">
              <Link href="/notes" className="rounded px-1 hover:bg-hover hover:text-ink">
                Notes
              </Link>
              {crumbs.map((c, i) => (
                <span key={i} className="flex items-center gap-1">
                  <ChevronRight size={13} className="text-subtle" />
                  <Link href={`/notes?nb=${encodeURIComponent(crumbs.slice(0, i + 1).join('/'))}`} className="rounded px-1 hover:bg-hover hover:text-ink">
                    {c}
                  </Link>
                </span>
              ))}
            </div>
            <div className="ml-auto flex items-center gap-2">
              <span className="text-[12px] text-muted" data-testid="save-status">
                {status === 'saving' ? 'Saving…' : status === 'offline' ? 'Offline' : 'Saved'}
              </span>
              {peers.length ? (
                <div className="flex" data-testid="online-users">
                  {peers.slice(0, 4).map((p, i) => (
                    <Tip key={p.userId} label={`${p.name} is here`}>
                      <span className={i ? '-ml-1.5' : ''}>
                        <Avatar user={{ name: p.name, avatarColor: p.color }} size={28} ring />
                      </span>
                    </Tip>
                  ))}
                </div>
              ) : (
                members && <AvatarStack users={members.map((m) => m.principal)} max={3} total={members.length} size={28} />
              )}
              <Button variant="primary" icon={<Share2 size={15} />} onClick={() => setShare(true)}>
                Share
              </Button>
              <Menu>
                <MenuTrigger asChild>
                  <IconButton label="More">
                    <MoreHorizontal size={17} />
                  </IconButton>
                </MenuTrigger>
                <MenuContent align="end" className="w-56" onCloseAutoFocus={(e) => e.preventDefault()}>
                  <MenuItem icon={<Star />} onSelect={() => acts.star.mutate({ id: r.id, on: !r.starred })}>
                    {r.starred ? 'Remove from Favorites' : 'Add to Favorites'}
                  </MenuItem>
                  <MenuItem icon={<Download />} onSelect={() => (window.location.href = `/api/resources/${r.id}/export?format=docx`)}>
                    Download note as Word
                  </MenuItem>
                  <MenuItem icon={<Download />} onSelect={() => (window.location.href = `/api/resources/${r.id}/export?format=pdf`)}>
                    Download note as PDF
                  </MenuItem>
                  <MenuSeparator />
                  <MenuItem
                    icon={<Trash2 />}
                    danger
                    disabled={!canEdit}
                    onSelect={async () => {
                      await acts.trash.mutateAsync([r.id]);
                      router.push('/notes');
                    }}
                  >
                    Move to trash
                  </MenuItem>
                </MenuContent>
              </Menu>
              <IconButton label="Details panel" active={!!panel} onClick={() => setPanel(panel ? null : 'Properties')}>
                <PanelRight size={17} />
              </IconButton>
            </div>
          </div>

          <div className="mt-2 flex items-center gap-2">
            {editingTitle ? (
              <input
                autoFocus
                aria-label="Note title"
                defaultValue={r.name}
                onFocus={(e) => e.target.select()}
                onBlur={(e) => {
                  if (e.target.value.trim() && e.target.value.trim() !== r.name) acts.update.mutate({ id: r.id, name: e.target.value.trim() });
                  setEditingTitle(false);
                }}
                onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                className="h-10 w-[520px] rounded-lg border border-brand-600 px-2 text-[26px] font-bold outline-none"
              />
            ) : (
              <h1 className="truncate text-[26px] font-bold tracking-tight text-ink" data-testid="note-title">
                {r.name}
              </h1>
            )}
            {canEdit && !editingTitle && (
              <button aria-label="Rename note" onClick={() => setEditingTitle(true)} className="rounded-md p-1 text-subtle hover:bg-hover hover:text-ink">
                <PencilLine size={17} />
              </button>
            )}
          </div>

          <div className="mt-3 flex items-center gap-3 border-b border-line">
            {tabs.map((t) => (
              <button key={t.id} aria-current={view === t.id ? 'page' : undefined} onClick={() => setView(t.id)} className="tab gap-1.5 px-1.5">
                {t.icon} {t.label}
              </button>
            ))}
            {canEdit && (
              <Button size="sm" variant="soft" className="mb-1.5 ml-4" icon={<RefreshCw size={14} />} onClick={() => (mind.hasMap ? setConfirmConvert(true) : convert())}>
                Convert notes to mind map
              </Button>
            )}
          </div>
        </div>

        {/* Body */}
        <div className={cn('min-h-0 flex-1 p-4', view === 'both' && 'grid grid-cols-2 gap-4')}>
          {view !== 'mindmap' && <div className="h-full min-h-0 overflow-hidden rounded-xl border border-line bg-white">{noteView}</div>}
          {view !== 'note' && <div className="h-full min-h-0">{mindView}</div>}
        </div>
      </div>

      {panel && (
        <aside className="flex w-[330px] shrink-0 flex-col border-l border-line bg-surface">
          <div className="flex items-center gap-5 border-b border-line px-4">
            {(['Properties', 'Comments', 'Activity'] as Panel[]).map((t) => (
              <button key={t} className="tab" aria-current={panel === t ? 'page' : undefined} onClick={() => setPanel(t)}>
                {t}
                {t === 'Comments' && threads.some((x) => !x.resolvedAt) && <span className="ml-1.5 rounded-full bg-brand-50 px-1.5 text-[11px] text-brand-600">{threads.filter((x) => !x.resolvedAt).length}</span>}
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {panel === 'Properties' && <NoteProperties r={r} onInsertLink={() => (setView(view === 'mindmap' ? 'both' : view), editor?.chain().focus('end').insertContent(' [[').run())} />}
            {panel === 'Comments' && (
              <CommentsPanel
                resourceId={r.id}
                threads={threads}
                me={{ ...me, email: '', title: null, department: null }}
                role={session.role}
                editor={editor}
                draft={draft}
                onDraftDone={() => setDraft(null)}
                active={active}
                setActive={setActive}
                onChanged={() => undefined}
              />
            )}
            {panel === 'Activity' && (
              <div className="p-4">
                <ActivityList events={activity} loading={loadingActivity} />
              </div>
            )}
          </div>
        </aside>
      )}

      <input ref={imageInput} type="file" accept="image/*" hidden onChange={(e) => (editor && void uploadImages(editor, [...(e.target.files ?? [])]), (e.target.value = ''))} />
      <ShareDialog resource={share ? r : null} onClose={() => setShare(false)} />
      <EmbedDialog
        open={!!attach}
        currentId={r.id}
        onClose={() => setAttach(null)}
        onPick={(x) => {
          if (attach?.target === 'mind') mind.actions.addChild(attach.parentId, { kind: 'link', text: x.name, resourceId: x.id, resourceType: x.type });
          else editor?.chain().focus().insertContent({ type: 'resourceEmbed', attrs: x }).run();
        }}
      />
      <Dialog
        open={confirmConvert}
        onOpenChange={setConfirmConvert}
        title="Replace the mind map?"
        description="The mind map will be rebuilt from the current note: headings become branches, bullets and tasks become notes, attached files become link cards. Sticky notes are kept."
        width={460}
        footer={
          <>
            <Button onClick={() => setConfirmConvert(false)}>Cancel</Button>
            <Button variant="primary" onClick={convert}>
              Convert
            </Button>
          </>
        }
      />
    </div>
  );
}
