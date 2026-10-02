'use client';

import type { ResourceDetail } from '@workos/shared';
import { can } from '@workos/shared';
import {
  AlignLeft,
  Bold,
  ChartColumn,
  Download,
  FolderOpen,
  Highlighter,
  Image as ImageIcon,
  IndentIncrease,
  Italic,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  MessageSquareText,
  Paintbrush,
  PencilLine,
  Play,
  Printer,
  Redo2,
  Share2,
  Shapes,
  Sigma,
  Sparkles,
  Table,
  Trash2,
  Type,
  Underline,
  Undo2,
  Video,
  X,
  Filter,
  AtSign,
  Merge,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { DocsWorkspace } from '../docs/DocsWorkspace';
import { SheetsWorkspace } from '../sheets/SheetsWorkspace';
import { SlidesWorkspace } from '../slides/SlidesWorkspace';
import { FormsWorkspace } from '../forms/FormsWorkspace';
import { folderHrefOf, TitleBar, type TitleBarHandle } from './TitleBar';
import { downloadUrl } from '@/lib/api';
import { appById } from '@/lib/apps';
import { useResource, useResourceActions, useResourceActivity, useResourceMembers } from '@/lib/queries';
import { ShareDialog } from '../drive/dialogs';
import { ActivityList } from '../drive/DetailsPanel';
import { cn, EmptyState, IconButton, Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, Skeleton, Tip } from '../ui/primitives';

export type EditorKind = 'docs' | 'sheets' | 'slides' | 'wiki' | 'base' | 'forms';

const PHASE: Record<EditorKind, { phase: number; engine: string }> = {
  docs: { phase: 2, engine: 'Tiptap / ProseMirror + Yjs' },
  wiki: { phase: 2, engine: 'Tiptap / ProseMirror + Yjs' },
  sheets: { phase: 3, engine: 'Univer + Yjs workbook binding' },
  slides: { phase: 4, engine: 'element tree + Yjs (SlidesWorkspace)' },
  base: { phase: 7, engine: 'Postgres JSONB records + realtime views' },
  forms: { phase: 8, engine: 'Yjs form + Postgres responses (FormsWorkspace)' },
};

const MENUS: Record<EditorKind, string[]> = {
  docs: ['File', 'Edit', 'View', 'Insert', 'Format', 'Tools', 'Extensions', 'Help'],
  wiki: ['File', 'Edit', 'View', 'Insert', 'Format', 'Help'],
  sheets: ['File', 'Edit', 'View', 'Insert', 'Format', 'Data', 'Tools', 'Extensions', 'Help'],
  slides: ['File', 'Edit', 'View', 'Insert', 'Format', 'Slide', 'Arrange', 'Tools', 'Help'],
  base: ['File', 'Edit', 'View', 'Help'],
  forms: [],
};

const EXPORTS: Record<EditorKind, string[]> = {
  docs: ['Word (.docx)', 'PDF (.pdf)', 'Web page (.html)', 'Plain text (.txt)'],
  wiki: ['PDF (.pdf)', 'Web page (.html)'],
  sheets: ['Excel (.xlsx)', 'CSV (.csv)', 'PDF (.pdf)'],
  slides: ['PowerPoint (.pptx)', 'PDF (.pdf)', 'Images (.png)'],
  base: ['CSV (.csv)', 'Excel (.xlsx)'],
  forms: [],
};

function Tool({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <Tip label={label}>
      <span className="flex size-8 cursor-not-allowed items-center justify-center rounded-md text-ink-2/70">{icon}</span>
    </Tip>
  );
}
function Select({ value, w = 96 }: { value: string; w?: number }) {
  return (
    <span className="flex h-8 cursor-not-allowed items-center justify-between rounded-md px-2 text-[13px] text-ink-2/80 hover:bg-hover" style={{ width: w }}>
      {value} <span className="text-[10px] text-subtle">▾</span>
    </span>
  );
}
const Sep = () => <span className="mx-1 h-5 w-px bg-line" />;

function Toolbar({ kind }: { kind: EditorKind }) {
  const common = (
    <>
      <Tool icon={<Undo2 size={17} />} label="Undo" />
      <Tool icon={<Redo2 size={17} />} label="Redo" />
      <Tool icon={<Paintbrush size={17} />} label="Paint format" />
      <Sep />
    </>
  );
  const text = (
    <>
      <Select value="Inter" w={110} />
      <Select value={kind === 'slides' ? '28' : kind === 'sheets' ? '10' : '16'} w={56} />
      <Sep />
      <Tool icon={<Bold size={17} />} label="Bold" />
      <Tool icon={<Italic size={17} />} label="Italic" />
      <Tool icon={<Underline size={17} />} label="Underline" />
      <Tool icon={<Type size={17} />} label="Text color" />
      <Tool icon={<Highlighter size={17} />} label="Highlight" />
      <Sep />
    </>
  );
  return (
    <div className="flex h-11 items-center gap-0.5 overflow-x-auto rounded-xl border border-line bg-surface px-2">
      {common}
      {kind === 'docs' || kind === 'wiki' ? (
        <>
          <Select value="Heading 1" w={104} />
          {text}
          <Tool icon={<AlignLeft size={17} />} label="Align" />
          <Tool icon={<List size={17} />} label="Bulleted list" />
          <Tool icon={<ListOrdered size={17} />} label="Numbered list" />
          <Tool icon={<ListChecks size={17} />} label="Checklist" />
          <Tool icon={<IndentIncrease size={17} />} label="Indent" />
          <Sep />
          <Tool icon={<Link2 size={17} />} label="Link" />
          <Tool icon={<ImageIcon size={17} />} label="Image" />
          <Tool icon={<Table size={17} />} label="Table" />
          <Tool icon={<AtSign size={17} />} label="Mention" />
        </>
      ) : kind === 'sheets' ? (
        <>
          <Tool icon={<Printer size={17} />} label="Print" />
          {text}
          <Tool icon={<Table size={17} />} label="Borders" />
          <Tool icon={<Merge size={17} />} label="Merge cells" />
          <Tool icon={<Filter size={17} />} label="Filter" />
          <Tool icon={<Sigma size={17} />} label="Functions" />
          <Tool icon={<ChartColumn size={17} />} label="Insert chart" />
        </>
      ) : kind === 'slides' ? (
        <>
          <Tool icon={<Play size={17} />} label="Present" />
          {text}
          <Tool icon={<List size={17} />} label="Bulleted list" />
          <Tool icon={<AlignLeft size={17} />} label="Align" />
          <Sep />
          <Tool icon={<Type size={17} />} label="Text box" />
          <Tool icon={<Shapes size={17} />} label="Shape" />
          <Tool icon={<ImageIcon size={17} />} label="Image" />
          <Tool icon={<ChartColumn size={17} />} label="Chart" />
          <Tool icon={<Table size={17} />} label="Table" />
        </>
      ) : (
        <Tool icon={<Filter size={17} />} label="Filter" />
      )}
      <span className="ml-auto flex items-center gap-1.5 whitespace-nowrap pl-3 text-[12px] text-subtle">Editing tools arrive with the {appById(kind)?.label} editor</span>
    </div>
  );
}

// ── Canvases (static previews of the target layout) ─────────────────────────


// ── Right panel ──────────────────────────────────────────────────────────────

function SidePanel({ id, kind, onClose }: { id: string; kind: EditorKind; onClose: () => void }) {
  const tabs = kind === 'slides' ? ['Design', 'Comments', 'History'] : ['Comments', 'AI Assistant', 'History'];
  const [tab, setTab] = useState(tabs[0]);
  const { data: activity, isLoading } = useResourceActivity(tab === 'History' ? id : null);
  return (
    <aside className="flex w-[320px] shrink-0 flex-col rounded-xl border border-line bg-surface">
      <div className="flex items-center gap-5 border-b border-line px-4">
        {tabs.map((t) => (
          <button key={t} className="tab" aria-current={tab === t ? 'page' : undefined} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
        <button onClick={onClose} className="ml-auto rounded p-1 text-muted hover:bg-hover" aria-label="Close panel">
          <X size={15} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {tab === 'Comments' && (
          <EmptyState icon={<MessageSquareText size={28} />} title="No comments yet">
            Comments anchored to text, cells or shapes arrive with the editor.
          </EmptyState>
        )}
        {tab === 'AI Assistant' && (
          <EmptyState icon={<Sparkles size={28} />} title="AI Assistant — Phase 6">
            Summarize, rewrite, generate formulas, charts and slides with permission-aware company knowledge.
          </EmptyState>
        )}
        {tab === 'Design' && (
          <EmptyState icon={<Shapes size={28} />} title="Design panel">
            Background, color scheme, fonts, slide size and orientation.
          </EmptyState>
        )}
        {tab === 'History' && <ActivityList events={activity} loading={isLoading} />}
      </div>
    </aside>
  );
}

// ── Shell ────────────────────────────────────────────────────────────────────

export function EditorShell({ id, kind }: { id: string; kind: EditorKind }) {
  const router = useRouter();
  const { data: r, error } = useResource(id);
  const { data: members } = useResourceMembers(id);
  const acts = useResourceActions();
  const [share, setShare] = useState(false);
  const [panel, setPanel] = useState(kind !== 'sheets');
  const titleRef = useRef<TitleBarHandle>(null);

  useEffect(() => {
    acts.recordAccess.mutate(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (error) return <EmptyState title="Can’t open this file">{(error as Error).message}</EmptyState>;
  if (!r) return <div className="space-y-3 p-6"><Skeleton className="h-12 w-96" /><Skeleton className="h-11" /><Skeleton className="h-[60vh]" /></div>;

  if (kind === 'docs' || kind === 'wiki') return <DocsWorkspace key={id} r={r} kind={kind} />;
  if (kind === 'sheets') return <SheetsWorkspace key={id} r={r} />;
  if (kind === 'slides') return <SlidesWorkspace key={id} r={r} />;
  if (kind === 'forms') return <FormsWorkspace key={id} r={r} />;
  const app = appById(kind)!;
  const editable = can(r.myRole, 'editor');
  const hasOriginal = !!r.mimeType;
  const folderHref = folderHrefOf(r);

  return (
    <div className="flex h-full flex-col bg-canvas">
      <TitleBar
        r={r}
        kind={kind}
        members={members?.map((m) => m.principal)}
        status="static"
        onShare={() => setShare(true)}
        actions={
          <>
            <IconButton label="Comments & history" active={panel} onClick={() => setPanel(!panel)}>
              <MessageSquareText size={18} />
            </IconButton>
            <IconButton label="Start a meeting (Phase 7)">
              <Video size={18} />
            </IconButton>
          </>
        }
        ref={titleRef}
      />

      {/* Menu bar */}
      <div className="flex shrink-0 items-center gap-0.5 px-5 pt-1">
        {MENUS[kind].map((m) =>
          m === 'File' ? (
            <Menu key={m}>
              <MenuTrigger asChild>
                <button className="h-7 rounded-md px-2.5 text-[13px] text-ink-2 hover:bg-hover data-[state=open]:bg-hover">File</button>
              </MenuTrigger>
              <MenuContent className="w-64">
                <MenuItem icon={<Share2 />} onSelect={() => setShare(true)}>
                  Share
                </MenuItem>
                <MenuItem icon={<PencilLine />} disabled={!editable} onSelect={() => titleRef.current?.rename()}>
                  Rename
                </MenuItem>
                <MenuItem icon={<FolderOpen />} onSelect={() => router.push(folderHref)}>
                  Show in Drive
                </MenuItem>
                <MenuSeparator />
                {hasOriginal && (
                  <MenuItem icon={<Download />} onSelect={() => (window.location.href = downloadUrl(id))}>
                    Download original ({r.name.split('.').pop()?.toUpperCase()})
                  </MenuItem>
                )}
                {EXPORTS[kind].map((e) => (
                  <MenuItem key={e} icon={<Download />} disabled shortcut={`Phase ${PHASE[kind].phase}`}>
                    Download as {e}
                  </MenuItem>
                ))}
                <MenuSeparator />
                <MenuItem
                  icon={<Trash2 />}
                  danger
                  disabled={!editable}
                  onSelect={async () => {
                    await acts.trash.mutateAsync([id]);
                    router.push(folderHref);
                  }}
                >
                  Move to trash
                </MenuItem>
              </MenuContent>
            </Menu>
          ) : (
            <span key={m} className="flex h-7 cursor-default items-center rounded-md px-2.5 text-[13px] text-ink-2/60">
              {m}
            </span>
          ),
        )}
      </div>

      <div className="shrink-0 px-5 pt-2">
        <Toolbar kind={kind} />
      </div>

      {hasOriginal && (
        <div className="mx-5 mt-2 flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-[13px] text-amber-900">
          <span className="flex-1">
            Uploaded Office file — the original <b>{r.name}</b> is stored unchanged. It will be imported into the native {app.label} model when the converter ships
            (Phase {PHASE[kind].phase}); the original stays available as version 1.
          </span>
          <a href={downloadUrl(id)} className="shrink-0 rounded-lg bg-white px-3 py-1.5 font-medium text-amber-900 shadow-sm hover:bg-amber-100">
            Download original
          </a>
        </div>
      )}

      {/* Body */}
      <div className="flex min-h-0 flex-1 gap-3 p-5 pt-3">
        <div className="min-w-0 flex-1 overflow-auto">
          {kind === 'base' ? (
            <div className="card"><EmptyState title="Base — Phase 7">Tables, fields, records and views (grid, kanban, gallery, form) arrive with the Base module.</EmptyState></div>
          ) : null}
        </div>
        {panel && <SidePanel id={id} kind={kind} onClose={() => setPanel(false)} />}
      </div>

      <ShareDialog resource={share ? r : null} onClose={() => setShare(false)} />
    </div>
  );
}

