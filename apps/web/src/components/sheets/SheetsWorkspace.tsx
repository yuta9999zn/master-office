'use client';

import type { ImportReport, ResourceDetail } from '@workos/shared';
import { can } from '@workos/shared';
import { cellValue, colName, formatValue, usedRange, type PlainWorkbook } from '@workos/sheet-model';
import { AlertTriangle, ArrowLeft, Download, FolderOpen, History, MessageSquareText, PencilLine, Printer, RotateCcw, Share2, Trash2, X } from 'lucide-react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { useState, useRef } from 'react';
import { useMe, useResourceActions, useResourceMembers, useVersionActions, useVersionContent } from '@/lib/queries';
import { ShareDialog } from '../drive/dialogs';
import { ImportBanner } from '../docs/DocsWorkspace';
import { HistoryPanel } from '../docs/HistoryPanel';
import { SheetTabs } from './SheetTabs';
import type { GridHandle } from './UniverGrid';
import { useCollab } from '../docs/useCollab';
import { folderHrefOf, TitleBar, type TitleBarHandle } from '../editor/TitleBar';
import { Button, cn, EmptyState, IconButton, Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, Skeleton } from '../ui/primitives';

// Univer touches the DOM at import time: load it on the client only.
const UniverGrid = dynamic(() => import('./UniverGrid').then((m) => m.UniverGrid), {
  ssr: false,
  loading: () => <div className="flex h-full items-center justify-center text-[13px] text-muted">Loading spreadsheet…</div>,
});

const EXPORTS = [
  { f: 'xlsx', label: 'Microsoft Excel (.xlsx)' },
  { f: 'csv', label: 'Comma-separated values (.csv, current sheet)' },
  { f: 'pdf', label: 'PDF document (.pdf)' },
  { f: 'html', label: 'Web page (.html)' },
];

export function SheetsWorkspace({ r }: { r: ResourceDetail }) {
  const router = useRouter();
  const { data: me } = useMe();
  const { data: members } = useResourceMembers(r.id);
  const collab = useCollab(r.id, me && { id: me.user.id, name: me.user.name, color: me.user.avatarColor });
  const acts = useResourceActions();
  const versions = useVersionActions(r.id);
  const [share, setShare] = useState(false);
  const [panel, setPanel] = useState<'History' | null>(null);
  const [previewing, setPreviewing] = useState<string | null>(null);
  const titleRef = useRef<TitleBarHandle>(null);
  const activeSheet = useRef<string | null>(null);
  const [grid, setGrid] = useState<GridHandle | null>(null);
  const editable = can(collab.session?.role ?? r.myRole, 'editor');
  const report = (r.metadata as { import?: ImportReport } | undefined)?.import;
  const exportUrl = (f: string) => `/api/resources/${r.id}/export?format=${f}${f === 'csv' && activeSheet.current ? `&sheet=${activeSheet.current}` : ''}`;

  return (
    <div className="flex h-full flex-col bg-canvas">
      <TitleBar
        ref={titleRef}
        r={r}
        kind="sheets"
        members={members?.map((m) => m.principal)}
        online={collab.peers}
        status={collab.error ? 'offline' : collab.status}
        onShare={() => setShare(true)}
        actions={
          <>
            <IconButton label="Version history" active={panel === 'History'} onClick={() => setPanel(panel === 'History' ? null : 'History')}>
              <History size={18} />
            </IconButton>
            <IconButton label="Comments (coming soon for cells)" disabled>
              <MessageSquareText size={18} />
            </IconButton>
          </>
        }
      />

      <div className="flex shrink-0 items-center gap-0.5 px-5 pt-1">
        <Menu>
          <MenuTrigger asChild>
            <button className="h-7 rounded-md px-2.5 text-[13px] text-ink-2 hover:bg-hover data-[state=open]:bg-hover">File</button>
          </MenuTrigger>
          <MenuContent className="w-72">
            <MenuItem icon={<Share2 />} onSelect={() => setShare(true)}>
              Share
            </MenuItem>
            <MenuItem icon={<PencilLine />} disabled={!editable} onSelect={() => titleRef.current?.rename()}>
              Rename
            </MenuItem>
            <MenuItem icon={<FolderOpen />} onSelect={() => router.push(folderHrefOf(r))}>
              Show in Drive
            </MenuItem>
            <MenuSeparator />
            {EXPORTS.map((x) => (
              <MenuItem key={x.f} icon={<Download />} onSelect={() => (window.location.href = exportUrl(x.f))}>
                Download as {x.label}
              </MenuItem>
            ))}
            {r.mimeType && (
              <MenuItem icon={<Download />} onSelect={() => (window.location.href = `/api/resources/${r.id}/download`)}>
                Download original ({r.name.split('.').pop()?.toUpperCase()})
              </MenuItem>
            )}
            <MenuItem icon={<Printer />} shortcut="Ctrl+P" onSelect={() => window.open(`/api/resources/${r.id}/export?format=pdf&inline=1`, '_blank')}>
              Print (PDF)
            </MenuItem>
            <MenuSeparator />
            <MenuItem icon={<History />} onSelect={() => setPanel('History')}>
              Version history
            </MenuItem>
            <MenuItem
              icon={<Trash2 />}
              danger
              disabled={!editable}
              onSelect={async () => {
                await acts.trash.mutateAsync([r.id]);
                router.push(folderHrefOf(r));
              }}
            >
              Move to trash
            </MenuItem>
          </MenuContent>
        </Menu>
        {!editable && collab.session && <span className="ml-3 rounded-md bg-hover px-2 py-0.5 text-[12px] text-muted">View only</span>}
      </div>

      <ImportBanner report={report} canEdit={editable} onRetry={() => versions.reimport.mutate()} retrying={versions.reimport.isPending} downloadHref={`/api/resources/${r.id}/download`} />

      <div className="flex min-h-0 flex-1 gap-3 p-5 pt-2">
        <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-line bg-surface">
          {collab.error ? (
            <EmptyState icon={<AlertTriangle size={30} />} title="Can’t open this spreadsheet">
              {collab.error}
            </EmptyState>
          ) : collab.session ? (
            <>
              <SheetTabs grid={grid} unitId={r.id} doc={collab.session.doc} editable={editable} />
              <div className="relative min-h-0 flex-1">
              <UniverGrid
                key={r.id}
                unitId={r.id}
                doc={collab.session.doc}
                synced={collab.synced}
                editable={editable}
                onReady={(h) => {
                  setGrid(h);
                  if (!h) return;
                  const wb = h.api.getWorkbook(r.id);
                  activeSheet.current = wb?.getActiveSheet()?.getSheetId() ?? null;
                  h.api.addEvent(h.api.Event.ActiveSheetChanged ?? 'ActiveSheetChanged', (e: { worksheet?: { getSheetId(): string } }) => {
                    activeSheet.current = e.worksheet?.getSheetId() ?? activeSheet.current;
                  });
                }}
              />
              </div>
              {previewing && <VersionPreview resourceId={r.id} versionId={previewing} canEdit={editable} onClose={() => setPreviewing(null)} />}
            </>
          ) : (
            <div className="space-y-3 p-5">
              <Skeleton className="h-10" />
              <Skeleton className="h-[50vh]" />
            </div>
          )}
        </div>
        {panel && (
          <aside className="flex w-[320px] shrink-0 flex-col rounded-xl border border-line bg-surface">
            <div className="flex items-center border-b border-line px-4">
              <span className="tab" aria-current="page">
                History
              </span>
              <button onClick={() => (setPanel(null), setPreviewing(null))} className="ml-auto rounded p-1 text-muted hover:bg-hover" aria-label="Close panel">
                <X size={15} />
              </button>
            </div>
            <div className="min-h-0 flex-1">
              <HistoryPanel resourceId={r.id} canEdit={editable} previewing={previewing} onPreview={setPreviewing} />
            </div>
          </aside>
        )}
      </div>
      <ShareDialog resource={share ? r : null} onClose={() => setShare(false)} />
    </div>
  );
}

/** Read-only rendering of a saved version (values formatted as they were saved). */
function VersionPreview({ resourceId, versionId, canEdit, onClose }: { resourceId: string; versionId: string; canEdit: boolean; onClose: () => void }) {
  const { data, isLoading } = useVersionContent(resourceId, versionId);
  const { restore } = useVersionActions(resourceId);
  const wb = (data as { workbook?: PlainWorkbook } | undefined)?.workbook;
  const [tab, setTab] = useState(0);
  const sheet = wb?.sheets[tab];
  const { maxR, maxC } = sheet ? usedRange(sheet) : { maxR: -1, maxC: -1 };
  const rows = Math.min(maxR + 1, 500);
  const cols = Math.min(maxC + 1, 52);
  return (
    <div className="absolute inset-0 z-10 flex flex-col bg-surface">
      <div className="flex items-center gap-3 border-b border-brand-200 bg-brand-50 px-4 py-2.5 text-[13px] text-brand-700">
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
      <div className="min-h-0 flex-1 overflow-auto">
        {isLoading || !sheet ? (
          <div className="p-5">
            <Skeleton className="h-[40vh]" />
          </div>
        ) : (
          <table className="border-collapse text-[13px]">
            <thead>
              <tr>
                <th className="sticky left-0 top-0 z-[2] h-7 w-12 border-b border-r border-line bg-canvas" />
                {Array.from({ length: cols }, (_, c) => (
                  <th key={c} className="sticky top-0 z-[1] h-7 border-b border-r border-line bg-canvas px-2 font-medium text-muted" style={{ minWidth: sheet.colMeta[c]?.w ?? 88 }}>
                    {colName(c)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: rows }, (_, r) => (
                <tr key={r}>
                  <td className="sticky left-0 h-7 border-b border-r border-line bg-canvas text-center text-[12px] text-muted">{r + 1}</td>
                  {Array.from({ length: cols }, (_, c) => {
                    const cell = sheet.cells[r]?.[c];
                    return (
                      <td key={c} className={cn('h-7 whitespace-nowrap border-b border-r border-line/70 px-2', typeof cell?.v === 'number' && 'text-right', cell?.s?.bl && 'font-semibold')}>
                        {cell ? formatValue(cellValue(cell), cell.s?.n?.pattern) : ''}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {wb && (
        <div className="flex h-10 shrink-0 items-center gap-1 border-t border-line px-3">
          {wb.sheets.map((s, i) => (
            <button key={s.id} onClick={() => setTab(i)} className={cn('rounded-md px-3 py-1 text-[13px]', i === tab ? 'bg-brand-50 font-medium text-brand-600' : 'text-ink-2 hover:bg-hover')}>
              {s.meta.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
