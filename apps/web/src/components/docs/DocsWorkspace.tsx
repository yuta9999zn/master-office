'use client';

import { EditorContent, useEditor, useEditorState, type Editor } from '@tiptap/react';
import { expandTokens, paperSize, type JSONContent } from '@workos/doc-model';
import type { ImportReport, ResourceDetail, ResourceType } from '@workos/shared';
import { can } from '@workos/shared';
import {
  AlertTriangle,
  ArrowLeft,
  Download,
  FileCheck2,
  FolderOpen,
  History,
  Keyboard,
  ListTree,
  MessageSquareText,
  PencilLine,
  RotateCcw,
  Save,
  Share2,
  Sparkles,
  Trash2,
  Upload,
  X,
  Eye,
  FileCog,
  GitPullRequestArrow,
  Printer,
  Replace,
  Search,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { useComments, useMe, useResourceActions, useResourceMembers, useResources, useSearch, useVersionActions, useVersionContent } from '@/lib/queries';
import { typeLabel } from '@/lib/resources';
import { ShareDialog } from '../drive/dialogs';
import { folderHrefOf, TitleBar, type TitleBarHandle } from '../editor/TitleBar';
import { Button, cn, Dialog, EmptyState, FileIcon, IconButton, Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger, Skeleton } from '../ui/primitives';
import { anchorFromSelection, refreshAnchors } from './comment-anchors';
import { CommentsPanel, type Draft } from './CommentsPanel';
import { DocToolbar } from './DocToolbar';
import { HistoryPanel } from './HistoryPanel';
import { Outline } from './Outline';
import { useCollab, type CollabSession } from './useCollab';
import { useLiveEditor } from './useLiveEditor';
import { browserSchema } from './editor-kit';
import { FindBar } from './FindBar';
import { MM_TO_PX, PageSetupDialog, PrintPreview, useDocSettings } from './PageLayout';
import { SuggestionsPanel } from './SuggestionsPanel';

type Panel = 'Comments' | 'Suggestions' | 'AI Assistant' | 'History';


export function DocsWorkspace({ r, kind }: { r: ResourceDetail; kind: 'docs' | 'wiki' }) {
  const { data: me } = useMe();
  const { data: members } = useResourceMembers(r.id);
  const collab = useCollab(r.id, me && { id: me.user.id, name: me.user.name, color: me.user.avatarColor });
  const [share, setShare] = useState(false);
  const titleRef = useRef<TitleBarHandle>(null);

  return (
    <div className="flex h-full flex-col bg-canvas">
      <TitleBar
        ref={titleRef}
        r={r}
        kind={kind}
        members={members?.map((m) => m.principal)}
        online={collab.peers}
        status={collab.error ? 'offline' : collab.status}
        onShare={() => setShare(true)}
      />
      {collab.error ? (
        <EmptyState icon={<AlertTriangle size={30} />} title="Can’t open this document">
          {collab.error}
        </EmptyState>
      ) : collab.session && me ? (
        <DocBody key={r.id} r={r} kind={kind} session={collab.session} synced={collab.synced} me={me.user} onStateless={collab.onStateless} onShare={() => setShare(true)} onRename={() => titleRef.current?.rename()} />
      ) : (
        <div className="space-y-3 p-5">
          <Skeleton className="h-8 w-[520px]" />
          <Skeleton className="h-11" />
          <Skeleton className="mx-auto h-[60vh] max-w-[820px]" />
        </div>
      )}
      <ShareDialog resource={share ? r : null} onClose={() => setShare(false)} />
    </div>
  );
}

function DocBody({
  r,
  kind,
  session,
  synced,
  me,
  onStateless,
  onShare,
  onRename,
}: {
  r: ResourceDetail;
  kind: 'docs' | 'wiki';
  session: CollabSession;
  synced: boolean;
  me: { id: string; name: string; avatarColor: string };
  onStateless: (h: (p: Record<string, unknown>) => void) => () => void;
  onShare: () => void;
  onRename: () => void;
}) {
  const router = useRouter();
  const role = session.role;
  const canEdit = can(role, 'editor');
  const canComment = can(role, 'commenter');

  const { data: threads = [], refetch: refetchComments } = useComments(r.id);
  const threadsRef = useRef(threads);
  threadsRef.current = threads;
  const [active, setActive] = useState<string | null>(null);
  const activeRef = useRef(active);
  activeRef.current = active;

  const [panel, setPanel] = useState<Panel | null>('Comments');
  const [showOutline, setShowOutline] = useState(true);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [embedOpen, setEmbedOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [find, setFind] = useState<{ replace: boolean } | null>(null);
  const [suggesting, setSuggestingState] = useState(false);
  const [pageSetupOpen, setPageSetupOpen] = useState(false);
  const [preview2, setPreview2] = useState<number | null>(null);
  const [printLayout, setPrintLayout] = useState(false);
  const [zoom, setZoom] = useState(100);
  const { pageSetup, update: updatePageSetup } = useDocSettings(session.doc);
  const imageInput = useRef<HTMLInputElement>(null);
  const acts = useResourceActions();
  const versions = useVersionActions(r.id);

  const openLink = useCallback(() => setLinkOpen(true), []);
  const startComment = useCallback((ed: Editor) => {
    const a = anchorFromSelection(ed);
    if (!a) return toast.info('Select some text to comment on');
    setDraft(a);
    setPanel('Comments');
  }, []);

  const { editor, uploadImages } = useLiveEditor({
    resourceId: r.id,
    session,
    me,
    canEdit,
    threadsRef,
    activeRef,
    onSelectComment: (id) => {
      setPanel('Comments');
      setActive(id);
    },
    onLink: openLink,
    onComment: startComment,
    onFind: (replace) => setFind({ replace }),
    onImage: () => imageInput.current?.click(),
    onEmbed: () => setEmbedOpen(true),
  });

  // Comments: reload when another client signals a change, re-resolve anchors when data changes.
  useEffect(() => onStateless((p) => p.type === 'comments' && void refetchComments()), [onStateless, refetchComments]);
  useEffect(() => refreshAnchors(editor), [editor, threads, active, synced]);

  const words = useEditorState({ editor, selector: ({ editor: e }) => (e ? { w: e.storage.characterCount.words() as number, c: e.storage.characterCount.characters() as number } : { w: 0, c: 0 }) }) ?? { w: 0, c: 0 };

  if (!editor) return <Skeleton className="m-5 h-[60vh]" />;
  const report = r.metadata?.import as ImportReport | undefined;
  const exportUrl = (f: string) => `/api/resources/${r.id}/export?format=${f}`;
  const c = () => editor.chain().focus();
  const setSuggesting = (on: boolean) => {
    editor.commands.setSuggesting(on);
    setSuggestingState(on);
    if (on) setPanel('Suggestions');
  };
  const changeCase = (mode: 'upper' | 'lower' | 'title') => {
    const { from, to } = editor.state.selection;
    if (from === to) return;
    const tr = editor.state.tr;
    editor.state.doc.nodesBetween(from, to, (node, pos) => {
      if (!node.isText) return;
      const s0 = Math.max(pos, from);
      const e0 = Math.min(pos + node.nodeSize, to);
      const t = node.text!.slice(s0 - pos, e0 - pos);
      const out =
        mode === 'upper' ? t.toLocaleUpperCase() : mode === 'lower' ? t.toLocaleLowerCase() : t.toLocaleLowerCase().replace(/(^|\s)(\p{L})/gu, (_m, a: string, b: string) => a + b.toLocaleUpperCase());
      if (out !== t) tr.replaceWith(tr.mapping.map(s0), tr.mapping.map(e0), editor.schema.text(out, node.marks));
    });
    editor.view.dispatch(tr);
  };
  const paper = paperSize(pageSetup);
  const hf = (t: string) => expandTokens(t, { title: r.name, page: '#', pages: '#' });

  const menus: { label: string; items: ReactNode }[] = [
    {
      label: 'File',
      items: (
        <>
          <MenuItem icon={<Share2 />} onSelect={onShare}>
            Share
          </MenuItem>
          <MenuItem icon={<PencilLine />} disabled={!canEdit} onSelect={onRename}>
            Rename
          </MenuItem>
          <MenuItem icon={<Save />} disabled={!canEdit} onSelect={() => versions.save.mutate(null)}>
            Save a version
          </MenuItem>
          <MenuItem icon={<History />} onSelect={() => setPanel('History')}>
            Version history
          </MenuItem>
          <MenuSeparator />
          <MenuItem icon={<FileCog />} onSelect={() => setPageSetupOpen(true)}>
            Page setup
          </MenuItem>
          <MenuItem icon={<Eye />} onSelect={() => setPreview2(Date.now())}>
            Print preview
          </MenuItem>
          <MenuItem icon={<Printer />} onSelect={() => window.open(`/api/resources/${r.id}/export?format=pdf&inline=1`, '_blank')}>
            Print
          </MenuItem>
          <MenuSeparator />
          <MenuLabel>Download as</MenuLabel>
          {[
            ['docx', 'Word (.docx)'],
            ['pdf', 'PDF (.pdf)'],
            ['html', 'Web page (.html)'],
            ['txt', 'Plain text (.txt)'],
          ].map(([f, label]) => (
            <MenuItem key={f} icon={<Download />} onSelect={() => (window.location.href = exportUrl(f))}>
              {label}
            </MenuItem>
          ))}
          {r.mimeType && (
            <>
              <MenuSeparator />
              <MenuItem icon={<Download />} onSelect={() => (window.location.href = `/api/resources/${r.id}/download`)}>
                Download original file
              </MenuItem>
              <MenuItem icon={<Upload />} disabled={!canEdit} onSelect={() => versions.reimport.mutate()}>
                Re-import original file
              </MenuItem>
            </>
          )}
          <MenuSeparator />
          <MenuItem icon={<FolderOpen />} onSelect={() => router.push(folderHrefOf(r))}>
            Show in Drive
          </MenuItem>
          <MenuItem
            icon={<Trash2 />}
            danger
            disabled={!canEdit}
            onSelect={async () => {
              await acts.trash.mutateAsync([r.id]);
              router.push(folderHrefOf(r));
            }}
          >
            Move to trash
          </MenuItem>
        </>
      ),
    },
    {
      label: 'Edit',
      items: (
        <>
          <MenuItem disabled={!canEdit} shortcut="Ctrl+Z" onSelect={() => c().undo().run()}>
            Undo
          </MenuItem>
          <MenuItem disabled={!canEdit} shortcut="Ctrl+Y" onSelect={() => c().redo().run()}>
            Redo
          </MenuItem>
          <MenuSeparator />
          <MenuItem shortcut="Ctrl+A" onSelect={() => c().selectAll().run()}>
            Select all
          </MenuItem>
          <MenuSeparator />
          <MenuItem icon={<Search />} shortcut="Ctrl+F" onSelect={() => setFind({ replace: false })}>
            Find
          </MenuItem>
          <MenuItem icon={<Replace />} shortcut="Ctrl+H" disabled={!canEdit} onSelect={() => setFind({ replace: true })}>
            Find and replace
          </MenuItem>
        </>
      ),
    },
    {
      label: 'View',
      items: (
        <>
          <MenuItem icon={<ListTree />} onSelect={() => setShowOutline(!showOutline)}>
            {showOutline ? 'Hide' : 'Show'} outline
          </MenuItem>
          <MenuItem icon={<MessageSquareText />} onSelect={() => setPanel('Comments')}>
            Comments
          </MenuItem>
          <MenuItem icon={<History />} onSelect={() => setPanel('History')}>
            Version history
          </MenuItem>
          <MenuItem icon={<GitPullRequestArrow />} onSelect={() => setPanel('Suggestions')}>
            Suggestions
          </MenuItem>
          <MenuSeparator />
          <MenuItem icon={<FileCog />} onSelect={() => setPrintLayout(!printLayout)}>
            {printLayout ? '✓ ' : ''}Print layout
          </MenuItem>
          <MenuLabel>Zoom</MenuLabel>
          {[75, 100, 125, 150].map((z) => (
            <MenuItem key={z} onSelect={() => setZoom(z)}>
              {zoom === z ? '✓ ' : ''}
              {z}%
            </MenuItem>
          ))}
        </>
      ),
    },
    {
      label: 'Insert',
      items: (
        <>
          <MenuItem disabled={!canEdit} onSelect={() => imageInput.current?.click()}>
            Image
          </MenuItem>
          <MenuItem disabled={!canEdit} onSelect={() => c().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}>
            Table
          </MenuItem>
          <MenuItem disabled={!canEdit} shortcut="Ctrl+K" onSelect={openLink}>
            Link
          </MenuItem>
          <MenuItem disabled={!canEdit} onSelect={() => setEmbedOpen(true)}>
            File from Drive
          </MenuItem>
          <MenuItem disabled={!canEdit} onSelect={() => c().insertContent('@').run()}>
            Mention a person
          </MenuItem>
          <MenuSeparator />
          <MenuItem disabled={!canEdit} onSelect={() => c().toggleTaskList().run()}>
            Checklist
          </MenuItem>
          <MenuItem disabled={!canEdit} onSelect={() => c().wrapIn('callout').run()}>
            Callout
          </MenuItem>
          <MenuItem disabled={!canEdit} onSelect={() => c().toggleCodeBlock().run()}>
            Code block
          </MenuItem>
          <MenuItem disabled={!canEdit} onSelect={() => c().setHorizontalRule().run()}>
            Divider
          </MenuItem>
          <MenuItem disabled={!canEdit} shortcut="Ctrl+Enter" onSelect={() => c().insertContent({ type: 'pageBreak' }).run()}>
            Page break
          </MenuItem>
          <MenuItem disabled={!canEdit} onSelect={() => c().insertContent({ type: 'tableOfContents' }).run()}>
            Table of contents
          </MenuItem>
          <MenuSeparator />
          <MenuItem disabled={!canComment} shortcut="Ctrl+Alt+M" onSelect={() => startComment(editor)}>
            Comment
          </MenuItem>
        </>
      ),
    },
    {
      label: 'Format',
      items: (
        <>
          {(
            [
              ['Bold', 'Ctrl+B', () => c().toggleBold().run()],
              ['Italic', 'Ctrl+I', () => c().toggleItalic().run()],
              ['Underline', 'Ctrl+U', () => c().toggleUnderline().run()],
              ['Strikethrough', 'Ctrl+Shift+S', () => c().toggleStrike().run()],
              ['Inline code', 'Ctrl+E', () => c().toggleCode().run()],
            ] as const
          ).map(([label, sc, fn]) => (
            <MenuItem key={label} disabled={!canEdit} shortcut={sc} onSelect={fn}>
              {label}
            </MenuItem>
          ))}
          <MenuItem disabled={!canEdit} shortcut="Ctrl+." onSelect={() => c().toggleSuperscript().run()}>
            Superscript
          </MenuItem>
          <MenuItem disabled={!canEdit} shortcut="Ctrl+," onSelect={() => c().toggleSubscript().run()}>
            Subscript
          </MenuItem>
          <MenuSeparator />
          <MenuLabel>Change case</MenuLabel>
          <MenuItem disabled={!canEdit} onSelect={() => changeCase('upper')}>
            UPPERCASE
          </MenuItem>
          <MenuItem disabled={!canEdit} onSelect={() => changeCase('lower')}>
            lowercase
          </MenuItem>
          <MenuItem disabled={!canEdit} onSelect={() => changeCase('title')}>
            Title Case
          </MenuItem>
          <MenuSeparator />
          {[1, 2, 3].map((l) => (
            <MenuItem key={l} disabled={!canEdit} shortcut={`Ctrl+Alt+${l}`} onSelect={() => c().toggleHeading({ level: l as 1 | 2 | 3 }).run()}>
              Heading {l}
            </MenuItem>
          ))}
          <MenuSeparator />
          <MenuItem disabled={!canEdit} onSelect={() => c().unsetAllMarks().clearNodes().run()}>
            Clear formatting
          </MenuItem>
        </>
      ),
    },
    {
      label: 'Tools',
      items: (
        <>
          <MenuItem onSelect={() => toast.info(`${words.w} words · ${words.c} characters`)}>Word count</MenuItem>
          <MenuItem icon={<Sparkles />} onSelect={() => setPanel('AI Assistant')}>
            AI Assistant
          </MenuItem>
        </>
      ),
    },
    {
      label: 'Help',
      items: (
        <MenuItem icon={<Keyboard />} onSelect={() => setShortcutsOpen(true)}>
          Keyboard shortcuts
        </MenuItem>
      ),
    },
  ];

  return (
    <>
      <div className="flex shrink-0 items-center gap-0.5 px-5 pt-1">
        {menus.map((m) => (
          <Menu key={m.label}>
            <MenuTrigger asChild>
              <button className="h-7 rounded-md px-2.5 text-[13px] text-ink-2 hover:bg-hover data-[state=open]:bg-hover">{m.label}</button>
            </MenuTrigger>
            <MenuContent className="w-64" onCloseAutoFocus={(e) => e.preventDefault()}>
              {m.items}
            </MenuContent>
          </Menu>
        ))}
        <div className="ml-auto flex items-center gap-0.5">
          <IconButton label="Outline" active={showOutline} onClick={() => setShowOutline(!showOutline)}>
            <ListTree size={17} />
          </IconButton>
          <IconButton label="Comments" active={panel === 'Comments'} onClick={() => setPanel(panel === 'Comments' ? null : 'Comments')}>
            <MessageSquareText size={17} />
          </IconButton>
          <IconButton label="Version history" active={panel === 'History'} onClick={() => setPanel(panel === 'History' ? null : 'History')}>
            <History size={17} />
          </IconButton>
        </div>
      </div>

      <div className="shrink-0 px-5 pt-2">
        <DocToolbar editor={editor} readOnly={!canEdit || !!preview} actions={{ suggesting, setSuggesting, link: openLink, image: () => imageInput.current?.click(), embed: () => setEmbedOpen(true), comment: () => startComment(editor), canComment: canComment && !preview }} />
      </div>

      <ImportBanner report={report} canEdit={canEdit} onRetry={() => versions.reimport.mutate()} retrying={versions.reimport.isPending} downloadHref={`/api/resources/${r.id}/download`} />

      <div className="flex min-h-0 flex-1 gap-3 px-5 pb-3 pt-3">
        {showOutline && !preview && <Outline editor={editor} />}
        <div className="relative min-w-0 flex-1">
        {find && <FindBar editor={editor} withReplace={find.replace} canEdit={canEdit} suggesting={suggesting} onClose={() => setFind(null)} />}
        <div className="h-full overflow-y-auto rounded-xl" id="doc-scroll">
          {preview ? (
            <VersionPreview resourceId={r.id} versionId={preview} canEdit={canEdit} onClose={() => setPreview(null)} />
          ) : (
            <article
              data-testid="doc-page"
              className={cn(
                'relative mx-auto mb-10 min-h-full rounded-sm bg-white shadow-[0_1px_3px_rgba(15,23,42,0.08),0_0_0_1px_rgba(15,23,42,0.04)]',
                !printLayout && 'w-full max-w-[860px] px-16 pb-24 pt-14',
              )}
              style={{
                zoom: zoom / 100,
                ...(printLayout
                  ? {
                      width: paper.w * MM_TO_PX,
                      minHeight: paper.h * MM_TO_PX,
                      padding: `${pageSetup.margins.top * MM_TO_PX}px ${pageSetup.margins.right * MM_TO_PX}px ${pageSetup.margins.bottom * MM_TO_PX}px ${pageSetup.margins.left * MM_TO_PX}px`,
                    }
                  : {}),
              }}
            >
              {printLayout && pageSetup.header && (
                <div
                  className="absolute inset-x-0 top-0 truncate pt-5 text-[11px] text-muted"
                  style={{ textAlign: pageSetup.headerAlign, paddingLeft: pageSetup.margins.left * MM_TO_PX, paddingRight: pageSetup.margins.right * MM_TO_PX }}
                >
                  {hf(pageSetup.header)}
                </div>
              )}
              {r.space && (
                <div className="mb-6 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.25em] text-subtle">
                  <span className="size-2 rounded-full" style={{ background: r.space.color ?? '#2563eb' }} />
                  {r.space.name}
                </div>
              )}
              <h1 className="mb-6 cursor-text text-[34px] font-bold leading-tight tracking-tight text-ink" onClick={() => canEdit && onRename()}>
                {r.name}
              </h1>
              <EditorContent editor={editor} />
              <div className="mt-16 text-right text-[12px] text-subtle" data-testid="word-count">
                {words.w} words
              </div>
              {printLayout && pageSetup.footer && (
                <div
                  className="absolute inset-x-0 bottom-0 truncate pb-5 text-[11px] text-muted"
                  style={{ textAlign: pageSetup.footerAlign, paddingLeft: pageSetup.margins.left * MM_TO_PX, paddingRight: pageSetup.margins.right * MM_TO_PX }}
                >
                  {hf(pageSetup.footer)}
                </div>
              )}
            </article>
          )}
        </div>
        </div>
        {panel && (
          <aside className="flex w-[340px] shrink-0 flex-col overflow-hidden rounded-xl border border-line bg-surface">
            <div className="flex items-center gap-4 overflow-x-auto border-b border-line px-4">
              {(['Comments', 'Suggestions', 'AI Assistant', 'History'] as Panel[]).map((t) => (
                <button key={t} className="tab" aria-current={panel === t ? 'page' : undefined} onClick={() => setPanel(t)}>
                  {t}
                  {t === 'Comments' && threads.some((x) => !x.resolvedAt) && <span className="ml-1.5 rounded-full bg-brand-50 px-1.5 text-[11px] text-brand-600">{threads.filter((x) => !x.resolvedAt).length}</span>}
                </button>
              ))}
              <button onClick={() => setPanel(null)} className="ml-auto rounded p-1 text-muted hover:bg-hover" aria-label="Close panel">
                <X size={15} />
              </button>
            </div>
            <div className="min-h-0 flex-1">
              {panel === 'Comments' && (
                <CommentsPanel
                  resourceId={r.id}
                  threads={threads}
                  me={{ ...me, email: '', title: null, department: null }}
                  role={role}
                  editor={editor}
                  draft={draft}
                  onDraftDone={() => setDraft(null)}
                  active={active}
                  setActive={setActive}
                  onChanged={() => undefined}
                />
              )}
              {panel === 'Suggestions' && <SuggestionsPanel editor={editor} canEdit={canEdit} />}
              {panel === 'History' && <HistoryPanel resourceId={r.id} canEdit={canEdit} previewing={preview} onPreview={setPreview} />}
              {panel === 'AI Assistant' && (
                <EmptyState icon={<Sparkles size={28} />} title="AI Assistant — Phase 6">
                  Summarize this document, rewrite a selection, draft sections from company knowledge, or turn it into slides.
                </EmptyState>
              )}
            </div>
          </aside>
        )}
      </div>

      <input ref={imageInput} type="file" accept="image/*" hidden onChange={(e) => (void uploadImages(editor, [...(e.target.files ?? [])]), (e.target.value = ''))} />
      <LinkDialog editor={editor} open={linkOpen} onClose={() => setLinkOpen(false)} />
      <EmbedDialog open={embedOpen} currentId={r.id} onClose={() => setEmbedOpen(false)} onPick={(x) => c().insertContent({ type: 'resourceEmbed', attrs: x }).run()} />
      <ShortcutsDialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      <PageSetupDialog open={pageSetupOpen} value={pageSetup} readOnly={!canEdit} onClose={() => setPageSetupOpen(false)} onSave={updatePageSetup} />
      <PrintPreview open={preview2 !== null} nonce={preview2 ?? 0} resourceId={r.id} onClose={() => setPreview2(null)} />
    </>
  );
}

// ── Import report ────────────────────────────────────────────────────────────

export function ImportBanner({ report, canEdit, onRetry, retrying, downloadHref }: { report?: ImportReport; canEdit: boolean; onRetry: () => void; retrying: boolean; downloadHref: string }) {
  const [open, setOpen] = useState(false);
  if (!report) return null;
  if (report.status === 'done') {
    return (
      <div className="mx-5 mt-2 flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-1.5 text-[12px] text-emerald-800">
        <FileCheck2 size={14} /> Imported from <b>{report.source}</b>
        <button onClick={() => setOpen(true)} className="font-medium underline">
          View import report
        </button>
        <Dialog open={open} onOpenChange={setOpen} title="Import report" description={`${report.source} → Master Office`} width={520}>
          {(
            [
              ['Preserved', report.preserved, 'text-emerald-700'],
              ['Simplified', report.degraded, 'text-amber-700'],
              ['Not imported', report.dropped, 'text-red-600'],
              ['Converter notes', report.warnings, 'text-muted'],
            ] as const
          ).map(([label, list, cls]) =>
            list?.length ? (
              <div key={label} className="mb-3">
                <div className={cn('mb-1 text-[12px] font-semibold', cls)}>{label}</div>
                <ul className="list-disc space-y-0.5 pl-5 text-[13px] text-ink-2">
                  {list.map((x) => (
                    <li key={x}>{x}</li>
                  ))}
                </ul>
              </div>
            ) : null,
          )}
          <p className="text-[12px] text-muted">The original file is kept unchanged as version 1 and can be downloaded any time.</p>
        </Dialog>
      </div>
    );
  }
  return (
    <div className="mx-5 mt-2 flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-[13px] text-amber-900">
      <AlertTriangle size={16} className="shrink-0" />
      <span className="flex-1">{report.message ?? 'This file has not been imported yet.'}</span>
      {canEdit && report.status !== 'unsupported' && (
        <Button size="sm" loading={retrying} onClick={onRetry}>
          Try again
        </Button>
      )}
      <a href={downloadHref} className="shrink-0 rounded-lg bg-white px-3 py-1.5 font-medium shadow-sm hover:bg-amber-100">
        Download original
      </a>
    </div>
  );
}

// ── Version preview ──────────────────────────────────────────────────────────

function VersionPreview({ resourceId, versionId, canEdit, onClose }: { resourceId: string; versionId: string; canEdit: boolean; onClose: () => void }) {
  const { data, isLoading } = useVersionContent(resourceId, versionId);
  const { restore } = useVersionActions(resourceId);
  const extensions = useMemo(() => browserSchema({}), []);
  const editor = useEditor({ immediatelyRender: false, editable: false, extensions, content: data?.content as JSONContent | undefined, editorProps: { attributes: { class: 'mo-editor' } } }, [data]);
  return (
    <div className="mx-auto w-full max-w-[860px]">
      <div className="sticky top-0 z-[2] mb-3 flex items-center gap-3 rounded-xl border border-brand-200 bg-brand-50 px-4 py-2.5 text-[13px] text-brand-700">
        <History size={16} />
        <span className="flex-1 font-medium">You are viewing an earlier version (read-only)</span>
        <Button size="sm" icon={<ArrowLeft size={14} />} onClick={onClose}>
          Back to current
        </Button>
        {canEdit && (
          <Button
            size="sm"
            variant="primary"
            icon={<RotateCcw size={14} />}
            loading={restore.isPending}
            onClick={async () => {
              await restore.mutateAsync(versionId);
              onClose();
            }}
          >
            Restore this version
          </Button>
        )}
      </div>
      <article className="min-h-[70vh] rounded-sm bg-white px-16 pb-24 pt-14 shadow-[0_1px_3px_rgba(15,23,42,0.08)]" data-testid="version-preview">
        {isLoading || !editor ? <Skeleton className="h-64" /> : <EditorContent editor={editor} />}
      </article>
    </div>
  );
}

// ── Dialogs ──────────────────────────────────────────────────────────────────

/** Headings and bookmarks a link can point to inside the document. */
function linkTargets(editor: Editor) {
  const out: { kind: 'heading' | 'bookmark'; pos: number; label: string; level?: number; bookmark?: string }[] = [];
  editor.state.doc.descendants((n, pos) => {
    if (n.type.name === 'heading' && n.textContent.trim()) {
      let bookmark: string | undefined;
      n.forEach((c) => {
        if (c.type.name === 'bookmark' && !bookmark) bookmark = c.attrs.id as string;
      });
      out.push({ kind: 'heading', pos, label: n.textContent.trim(), level: n.attrs.level as number, bookmark });
      return false;
    }
    if (n.type.name === 'bookmark') {
      const $p = editor.state.doc.resolve(pos);
      out.push({ kind: 'bookmark', pos, label: $p.parent.textContent.trim().slice(0, 60) || 'Bookmark', bookmark: n.attrs.id as string });
    }
    return true;
  });
  return out;
}

function LinkDialog({ editor, open, onClose }: { editor: Editor; open: boolean; onClose: () => void }) {
  const [url, setUrl] = useState('');
  const [targets, setTargets] = useState<ReturnType<typeof linkTargets>>([]);
  useEffect(() => {
    if (!open) return;
    setUrl((editor.getAttributes('link').href as string | undefined) ?? '');
    setTargets(linkTargets(editor));
  }, [open, editor]);
  /** Links to a heading (a bookmark is added at its start if it has none) or to a bookmark. */
  const linkTo = (target: ReturnType<typeof linkTargets>[number]) => {
    const id = target.bookmark ?? Math.random().toString(36).slice(2, 10);
    const href = `#bm-${id}`;
    const chain = editor.chain().focus();
    // Keep the cursor where the link goes (inserting content elsewhere would move the selection there).
    if (!target.bookmark) chain.insertContentAt(target.pos + 1, { type: 'bookmark', attrs: { id } }, { updateSelection: false });
    if (editor.state.selection.empty && !editor.isActive('link')) chain.insertContent({ type: 'text', text: target.label, marks: [{ type: 'link', attrs: { href } }] });
    else chain.extendMarkRange('link').setLink({ href });
    chain.run();
    onClose();
  };
  const apply = () => {
    const href = url.trim() && !/^(https?:|mailto:|\/)/i.test(url.trim()) ? `https://${url.trim()}` : url.trim();
    const chain = editor.chain().focus().extendMarkRange('link');
    if (!href) chain.unsetLink().run();
    else if (editor.state.selection.empty && !editor.isActive('link')) chain.insertContent({ type: 'text', text: href, marks: [{ type: 'link', attrs: { href } }] }).run();
    else chain.setLink({ href }).run();
    onClose();
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => !v && onClose()}
      title="Link"
      width={440}
      footer={
        <>
          {editor.isActive('link') && (
            <Button
              className="mr-auto"
              onClick={() => {
                editor.chain().focus().extendMarkRange('link').unsetLink().run();
                onClose();
              }}
            >
              Remove link
            </Button>
          )}
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={apply}>
            Apply
          </Button>
        </>
      }
    >
      <input className="input" placeholder="https://…" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && apply()} />
      {targets.length > 0 && (
        <div className="mt-3">
          <div className="mb-1 text-[12px] font-semibold uppercase tracking-wide text-subtle">Headings and bookmarks</div>
          <div className="max-h-56 overflow-y-auto rounded-lg border border-line" data-testid="link-targets">
            {targets.map((t) => (
              <button key={`${t.kind}-${t.pos}`} onClick={() => linkTo(t)} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] hover:bg-hover">
                <span className="w-16 shrink-0 text-[11px] text-muted">{t.kind === 'heading' ? `Heading ${t.level}` : 'Bookmark'}</span>
                <span className="truncate text-ink" style={{ paddingLeft: t.level ? (t.level - 1) * 10 : 0 }}>
                  {t.label}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </Dialog>
  );
}

export function EmbedDialog({ open, currentId, onClose, onPick }: { open: boolean; currentId: string; onClose: () => void; onPick: (x: { id: string; name: string; type: ResourceType }) => void }) {
  const [q, setQ] = useState('');
  const { data: hits } = useSearch(q);
  const { data: recent } = useResources(open ? { view: 'recent' } : null);
  const items = (q.trim() ? (hits ?? []).filter((h) => h.kind === 'resource').map((h) => ({ id: h.id, name: h.title, type: h.type! })) : (recent ?? []).map((x) => ({ id: x.id, name: x.name, type: x.type }))).filter(
    (x) => x.id !== currentId && x.type !== 'folder',
  );
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()} title="Attach a file from Drive" description="The card stays linked to the file — nothing is copied." width={520}>
      <input className="input mb-3" placeholder="Search files" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="max-h-80 overflow-y-auto">
        {!q.trim() && <div className="px-1 pb-1 text-[11px] font-semibold uppercase tracking-wide text-subtle">Recent</div>}
        {items.map((x) => (
          <button
            key={x.id}
            onClick={() => {
              onPick(x);
              onClose();
              setQ('');
            }}
            className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-hover"
          >
            <FileIcon r={{ type: x.type, mimeType: null, metadata: {} }} size={24} />
            <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{x.name}</span>
            <span className="text-[12px] text-muted">{typeLabel({ type: x.type, name: x.name, mimeType: null, metadata: {} })}</span>
          </button>
        ))}
        {!items.length && <div className="py-6 text-center text-[13px] text-muted">No files found</div>}
      </div>
    </Dialog>
  );
}

function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const rows = [
    ['Bold / Italic / Underline', 'Ctrl+B / I / U'],
    ['Heading 1–3', 'Ctrl+Alt+1–3'],
    ['Bulleted / numbered list', 'Ctrl+Shift+8 / 7'],
    ['Checklist', 'Ctrl+Shift+9'],
    ['Link', 'Ctrl+K'],
    ['Comment on selection', 'Ctrl+Alt+M'],
    ['Mention someone', '@'],
    ['Indent / outdent list', 'Tab / Shift+Tab'],
    ['Undo / Redo', 'Ctrl+Z / Ctrl+Y'],
    ['Markdown shortcuts', '# ## - 1. [ ] > ```'],
  ];
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()} title="Keyboard shortcuts" width={460}>
      <div className="divide-y divide-line">
        {rows.map(([a, b]) => (
          <div key={a} className="flex justify-between py-2 text-[13px]">
            <span className="text-ink-2">{a}</span>
            <kbd className="font-sans text-muted">{b}</kbd>
          </div>
        ))}
      </div>
    </Dialog>
  );
}
