'use client';

import type { ImportReport, ResourceDetail } from '@workos/shared';
import { can } from '@workos/shared';
import { useRegisterAi } from '@/lib/ai';
import { cellValue, colName, formatValue, usedRange, type PlainWorkbook } from '@workos/sheet-model';
import { AlertTriangle, ArrowLeft, BarChart3, BarChartHorizontal, Brush, CheckSquare, Circle, Columns3, CopyMinus, Table2, Code2, Download, FolderOpen, Globe, History, MessageSquareText, PencilLine, Play, Printer, RotateCcw, Share2, Square, Trash2, X, Paintbrush, Sigma, ListTree, Filter } from 'lucide-react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useRef } from 'react';
import { toast } from 'sonner';
import { useMe, useResourceActions, useResourceMembers, useUsers, useVersionActions, useVersionContent } from '@/lib/queries';
import { ShareDialog } from '../drive/dialogs';
import { PublishDialog } from '../editor/PublishDialog';
import { ActivityDashboard } from '../editor/ActivityDashboard';
import { ImportBanner } from '../docs/DocsWorkspace';
import { HistoryPanel } from '../docs/HistoryPanel';
import { SheetTabs } from './SheetTabs';
import { ChartEditor } from './charts/ChartEditor';
import { insertChart } from './charts/chart-actions';
import { insertCheckboxes, trimWhitespace } from './data-tools';
import { PivotEditor } from './pivots/PivotEditor';
import { RemoteCursors } from './presence';
import { insertPivot, pivotAt } from './pivots/pivot-engine';
import { ColumnStatsPanel, RemoveDuplicatesDialog, runSplit } from './DataTools';
import type { GridHandle } from './UniverGrid';
import { useCollab } from '../docs/useCollab';
import { folderHrefOf, TitleBar, type TitleBarHandle } from '../editor/TitleBar';
import { Button, cn, Dialog, EmptyState, IconButton, Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger, Skeleton } from '../ui/primitives';
import { MacrosPanel, SHORTCUT_LABEL } from './macros/MacrosPanel';
import { functionNameOf, MacroRecorder, recordedCode } from './macros/recorder';
import { runMacro } from './macros/run';
import type { MacroResult } from './macros/runtime';
import { macrosOf, saveMacro, useMacros, type MacroDef } from './macros/store';
import { ImportMacrosDialog } from './macros/ImportMacrosDialog';
import { BandingPanel, openBanding } from './banding';
import { addGroup, GroupGutter, removeGroup, selectionSpan, setAll, type Axis } from './groups';
import { createFilterView, FilterViewBar, FilterViewPanel, useApplyFilterView, useFilterViews } from './filter-views';
import { findTriggers, setTriggerEnabled, TriggerRunner, useDisabledTriggers, type Execution } from './macros/triggers';

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
  const { data: people } = useUsers();
  const collab = useCollab(r.id, me && { id: me.user.id, name: me.user.name, color: me.user.avatarColor });
  const acts = useResourceActions();
  const versions = useVersionActions(r.id);
  const [share, setShare] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const [panel, setPanel] = useState<'History' | 'Macros' | 'Chart' | 'Column stats' | 'Pivot table' | 'Alternating colors' | 'Filter view' | null>(null);
  const [viewId, setViewId] = useState<string | null>(null);
  const [bandingId, setBandingId] = useState<string | null>(null);
  const [formulasShown, setFormulasShown] = useState(false);
  const [pivotId, setPivotId] = useState<string | null>(null);
  const [pivotHere, setPivotHere] = useState<string | null>(null);
  const [dedupe, setDedupe] = useState(false);
  const [chartId, setChartId] = useState<string | null>(null);
  const [recorder, setRecorder] = useState<MacroRecorder | null>(null);
  const [recCount, setRecCount] = useState(0);
  const [saveRecording, setSaveRecording] = useState<string[] | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  const [lastRun, setLastRun] = useState<(MacroResult & { macro: string }) | null>(null);
  const [editingMacro, setEditingMacro] = useState<string | null>(null);
  const macros = useMacros(collab.session?.doc ?? null);
  const disabledTriggers = useDisabledTriggers(collab.session?.doc ?? null);
  const [executions, setExecutions] = useState<Execution[]>([]);
  const [importOpen, setImportOpen] = useState(false);
  const logExecution = (x: Execution) => setExecutions((list) => [x, ...list].slice(0, 50));
  // Read by the trigger runner at event time, so it always sees the current macros and switches.
  const activeTriggers = useRef(() => findTriggers(macros).filter((t) => !disabledTriggers.includes(t.key)));
  activeTriggers.current = () => findTriggers(macros).filter((t) => !disabledTriggers.includes(t.key));
  const [previewing, setPreviewing] = useState<string | null>(null);
  const titleRef = useRef<TitleBarHandle>(null);
  const activeSheet = useRef<string | null>(null);
  const [grid, setGrid] = useState<GridHandle | null>(null);
  // Filter views: definitions are shared, the one turned on is this person's own.
  const filterViews = useFilterViews(collab.session?.doc ?? null);
  const activeView = filterViews.find((v) => v.id === viewId) ?? null;
  useApplyFilterView(grid?.api ?? null, collab.session?.doc ?? null, r.id, activeView, grid?.rowFilter ?? null);
  const openView = (id: string) => {
    const v = filterViews.find((x) => x.id === id);
    const wb = grid?.api.getWorkbook(r.id) as { getSheetBySheetId(id: string): unknown; setActiveSheet(s: unknown): void } | null;
    if (v && wb) wb.setActiveSheet(wb.getSheetBySheetId(v.sheetId));
    setViewId(id);
    setPanel('Filter view');
  };
  const closeView = () => {
    setViewId(null);
    if (panel === 'Filter view') setPanel(null);
  };
  const editable = can(collab.session?.role ?? r.myRole, 'editor');
  useRegisterAi({ app: 'sheets', resourceId: r.id, name: r.name, editable });
  const report = (r.metadata as { import?: ImportReport } | undefined)?.import;
  const run = async (m: MacroDef) => {
    if (!grid || running) return;
    setRunning(m.id);
    try {
      const res = await runMacro(grid.api, r.id, m.code, m.fn, (t) => toast(t));
      setLastRun({ ...res, macro: m.id });
      logExecution({ id: crypto.randomUUID(), at: new Date().toISOString(), macro: m.name, fn: m.fn, trigger: 'manual', result: res });
      if (res.error) toast.error(`${m.name}: ${res.error}`);
      else toast.success(`${m.name} finished`, { description: `${res.ops.length} change${res.ops.length === 1 ? '' : 's'} in ${Math.round(res.ms)} ms` });
    } finally {
      setRunning(null);
    }
  };
  const startRecording = () => {
    if (!grid || recorder) return;
    const rec = new MacroRecorder(grid.api, r.id);
    rec.start();
    setRecorder(rec);
    setRecCount(0);
  };
  useEffect(() => {
    const onEdit = (e: Event) => {
      const d = (e as CustomEvent<{ chartId: string; unitId: string }>).detail;
      if (d.unitId !== r.id) return;
      setChartId(d.chartId);
      setPanel('Chart');
    };
    window.addEventListener('mo-chart-edit', onEdit);
    return () => window.removeEventListener('mo-chart-edit', onEdit);
  }, [r.id]);
  // Simple triggers (onOpen / onEdit / onSelectionChange) run for editors, in their own browser.
  const macrosLoaded = macros.length > 0;
  // onOpen fires once per opening, and only for macros that were there when the grid finished loading.
  const openState = useRef<'pending' | 'skip' | 'done'>('pending');
  useEffect(() => {
    // Read the document itself: the hook's list can lag a render behind the grid.
    if (grid && collab.session && openState.current === 'pending' && !macrosOf(collab.session.doc).size) openState.current = 'skip';
  }, [grid, collab.session]);
  useEffect(() => {
    if (!grid || !editable || !me || !macrosLoaded) return;
    const runner = new TriggerRunner(grid.api, r.id, {
      triggers: () => activeTriggers.current(),
      user: { email: me.user.email, name: me.user.name },
      toast: (t) => toast(t),
      onExecution: (x) => {
        logExecution(x);
        if (x.result.error) toast.error(`${x.macro} · ${x.fn}: ${x.result.error}`);
      },
    });
    runner.start();
    if (openState.current === 'pending') {
      openState.current = 'done';
      runner.open();
    }
    return () => runner.destroy();
  }, [grid, editable, me, macrosLoaded, r.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // Other people's selections on the grid.
  useEffect(() => {
    const aw = collab.session?.provider.awareness;
    if (!grid || !aw) return;
    const cursors = new RemoteCursors(grid.api, r.id, aw as never);
    cursors.start();
    return () => cursors.destroy();
  }, [grid, collab.session, r.id]);
  // "Edit pivot table" appears while the selection is inside one (like Google Sheets).
  useEffect(() => {
    const doc = collab.session?.doc;
    if (!grid || !doc) return;
    const check = () => {
      const ws = (grid.api.getWorkbook(r.id) as { getActiveSheet(): { getSheetId(): string; getSelection(): { getActiveRange(): { getRange(): { startRow: number; startColumn: number } } | null } | null } } | null)?.getActiveSheet();
      const sel = ws?.getSelection()?.getActiveRange()?.getRange();
      setPivotHere(ws && sel ? pivotAt(doc, ws.getSheetId(), sel.startRow, sel.startColumn) : null);
    };
    const sub = grid.api.addEvent(grid.api.Event.CommandExecuted, (e: { id: string }) => {
      if (/set-selections|set-worksheet-activ|set-range-values/.test(e.id)) check();
    });
    return () => sub.dispose();
  }, [grid, collab.session, r.id]);
  // Live action count in the recording bar.
  useEffect(() => {
    if (!recorder) return;
    const t = setInterval(() => setRecCount(recorder.count), 300);
    return () => clearInterval(t);
  }, [recorder]);
  // View → Show formulas follows the grid (restored from this browser when it loads); Ctrl+` toggles it.
  useEffect(() => setFormulasShown(grid?.showFormulas.get() ?? false), [grid]);
  const toggleFormulas = () => {
    if (!grid) return;
    grid.showFormulas.set(!grid.showFormulas.get());
    setFormulasShown(grid.showFormulas.get());
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.altKey || e.code !== 'Backquote') return;
      e.preventDefault();
      e.stopPropagation();
      toggleFormulas();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });
  // View → Group / Ungroup (Alt+Shift+→ / ←): whole columns selected → columns, otherwise rows.
  const group = (axis: Axis, on: boolean) => {
    if (!grid || !collab.session) return;
    const s = selectionSpan(grid.api, r.id);
    if (!s) return;
    const [from, to] = axis === 'rows' ? s.rows : s.cols;
    if (on) {
      const err = addGroup(grid.api, collab.session.doc, r.id, axis, from, to);
      if (err) toast.error(err);
    } else if (!removeGroup(grid.api, collab.session.doc, r.id, axis, from, to)) toast.info('Nothing to ungroup here');
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || !e.shiftKey || e.ctrlKey || (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') || !editable) return;
      const s = grid && selectionSpan(grid.api, r.id);
      if (!s) return;
      e.preventDefault();
      e.stopPropagation();
      group(s.wholeCols ? 'cols' : 'rows', e.key === 'ArrowRight');
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });
  // Ctrl+Alt+Shift+1…9 runs the macro bound to that number (like Google Sheets).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey && e.altKey && e.shiftKey) || !/^Digit[1-9]$/.test(e.code)) return;
      const m = macros.find((x) => x.shortcut === Number(e.code.slice(5)));
      if (!m || !editable) return;
      e.preventDefault();
      e.stopPropagation();
      void run(m);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });
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
            <MenuItem icon={<Globe />} onSelect={() => setPublishOpen(true)}>
              Publish to web…
            </MenuItem>
            <MenuItem disabled={!editable} onSelect={() => setActivityOpen(true)}>
              Activity dashboard
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
        <Menu>
          <MenuTrigger asChild>
            <button className="h-7 rounded-md px-2.5 text-[13px] text-ink-2 hover:bg-hover data-[state=open]:bg-hover">Insert</button>
          </MenuTrigger>
          <MenuContent className="w-64" onCloseAutoFocus={(e) => e.preventDefault()}>
            <MenuItem
              icon={<BarChart3 />}
              disabled={!editable || !grid}
              onSelect={() => {
                if (!grid || !collab.session) return;
                const id = insertChart(grid.api, collab.session.doc, r.id);
                if (!id) return void toast.error('Select the data for the chart first');
                setChartId(id);
                setPanel('Chart');
              }}
            >
              Chart
            </MenuItem>
            <MenuItem
              icon={<Table2 />}
              disabled={!editable || !grid}
              onSelect={() => {
                if (!grid || !collab.session) return;
                const id = insertPivot(grid.api, collab.session.doc, r.id);
                if (!id) return void toast.error('Select the data (with a header row) for the pivot table first');
                setPivotId(id);
                setPanel('Pivot table');
              }}
            >
              Pivot table
            </MenuItem>
            <MenuItem icon={<CheckSquare />} disabled={!editable || !grid} onSelect={() => grid && insertCheckboxes(grid.api, r.id)}>
              Checkbox
            </MenuItem>
          </MenuContent>
        </Menu>
        <Menu>
          <MenuTrigger asChild>
            <button className="h-7 rounded-md px-2.5 text-[13px] text-ink-2 hover:bg-hover data-[state=open]:bg-hover">View</button>
          </MenuTrigger>
          <MenuContent className="w-64" onCloseAutoFocus={(e) => e.preventDefault()}>
            <MenuItem icon={<Sigma />} shortcut="Ctrl+`" disabled={!grid} onSelect={toggleFormulas}>
              {formulasShown ? '✓ ' : ''}Show formulas
            </MenuItem>
            <MenuSeparator />
            <MenuItem icon={<ListTree />} shortcut="Alt+Shift+→" disabled={!editable || !grid} onSelect={() => group('rows', true)}>
              Group rows
            </MenuItem>
            <MenuItem icon={<ListTree />} disabled={!editable || !grid} onSelect={() => group('cols', true)}>
              Group columns
            </MenuItem>
            <MenuItem shortcut="Alt+Shift+←" disabled={!editable || !grid} onSelect={() => group('rows', false)}>
              Ungroup rows
            </MenuItem>
            <MenuItem disabled={!editable || !grid} onSelect={() => group('cols', false)}>
              Ungroup columns
            </MenuItem>
            <MenuItem disabled={!editable || !grid} onSelect={() => grid && collab.session && setAll(grid.api, collab.session.doc, r.id, 'rows', false)}>
              Expand all row groups
            </MenuItem>
            <MenuItem disabled={!editable || !grid} onSelect={() => grid && collab.session && setAll(grid.api, collab.session.doc, r.id, 'rows', true)}>
              Collapse all row groups
            </MenuItem>
          </MenuContent>
        </Menu>
        <Menu>
          <MenuTrigger asChild>
            <button className="h-7 rounded-md px-2.5 text-[13px] text-ink-2 hover:bg-hover data-[state=open]:bg-hover">Format</button>
          </MenuTrigger>
          <MenuContent className="w-64" onCloseAutoFocus={(e) => e.preventDefault()}>
            <MenuItem
              icon={<Paintbrush />}
              disabled={!editable || !grid}
              onSelect={() => {
                if (!grid || !collab.session) return;
                const res = openBanding(grid.api, collab.session.doc, r.id);
                if ('error' in res) return void toast.error(res.error);
                setBandingId(res.banding.id);
                setPanel('Alternating colors');
              }}
            >
              Alternating colors
            </MenuItem>
          </MenuContent>
        </Menu>
        <Menu>
          <MenuTrigger asChild>
            <button className="h-7 rounded-md px-2.5 text-[13px] text-ink-2 hover:bg-hover data-[state=open]:bg-hover">Data</button>
          </MenuTrigger>
          <MenuContent className="w-64" onCloseAutoFocus={(e) => e.preventDefault()}>
            <MenuItem
              icon={<Filter />}
              disabled={!grid}
              onSelect={() => {
                if (!grid || !collab.session) return;
                const v = createFilterView(grid.api, collab.session.doc, r.id);
                if (typeof v === 'string') return void toast.error(v);
                openView(v.id);
              }}
            >
              Create filter view
            </MenuItem>
            {filterViews.map((v) => (
              <MenuItem key={v.id} icon={<Filter />} disabled={!grid} onSelect={() => openView(v.id)}>
                {v.id === viewId ? '✓ ' : ''}
                {v.name}
              </MenuItem>
            ))}
            {activeView && <MenuItem onSelect={closeView}>Close filter view</MenuItem>}
            <MenuSeparator />
            <MenuItem icon={<BarChartHorizontal />} disabled={!grid} onSelect={() => setPanel('Column stats')}>
              Column stats
            </MenuItem>
            <MenuSeparator />
            <MenuLabel>Data cleanup</MenuLabel>
            <MenuItem icon={<CopyMinus />} disabled={!editable || !grid} onSelect={() => setDedupe(true)}>
              Remove duplicates
            </MenuItem>
            <MenuItem
              icon={<Brush />}
              disabled={!editable || !grid}
              onSelect={() => {
                if (!grid) return;
                const n = trimWhitespace(grid.api, r.id);
                toast.success(n ? `Trimmed whitespace in ${n} cell${n === 1 ? '' : 's'}` : 'No whitespace to trim');
              }}
            >
              Trim whitespace
            </MenuItem>
            <MenuSeparator />
            <MenuLabel>Split text to columns</MenuLabel>
            {(
              [
                ['auto', 'Detect automatically'],
                [',', 'Comma'],
                [';', 'Semicolon'],
                ['.', 'Period'],
                [' ', 'Space'],
              ] as const
            ).map(([sep, label]) => (
              <MenuItem key={label} icon={<Columns3 />} disabled={!editable || !grid} onSelect={() => grid && runSplit(grid.api, r.id, sep)}>
                {label}
              </MenuItem>
            ))}
          </MenuContent>
        </Menu>
        <Menu>
          <MenuTrigger asChild>
            <button className="h-7 rounded-md px-2.5 text-[13px] text-ink-2 hover:bg-hover data-[state=open]:bg-hover">Extensions</button>
          </MenuTrigger>
          {/* Keep focus off the trigger after closing so typing goes straight to the grid (e.g. right after "Record macro"). */}
          <MenuContent className="w-72" onCloseAutoFocus={(e) => e.preventDefault()}>
            <MenuLabel>Macros</MenuLabel>
            {recorder ? (
              <MenuItem icon={<Square />} onSelect={() => setSaveRecording(recorder.stop())}>
                Stop recording
              </MenuItem>
            ) : (
              <MenuItem icon={<Circle />} disabled={!editable || !grid} onSelect={startRecording}>
                Record macro
              </MenuItem>
            )}
            <MenuItem icon={<Code2 />} onSelect={() => (setEditingMacro(null), setPanel('Macros'))}>
              Manage macros & scripts
            </MenuItem>
            {macros.length > 0 && <MenuSeparator />}
            {macros.map((m) => (
              <MenuItem key={m.id} icon={<Play />} disabled={!editable || !!running} shortcut={m.shortcut ? SHORTCUT_LABEL(m.shortcut) : undefined} onSelect={() => void run(m)}>
                {m.name}
              </MenuItem>
            ))}
          </MenuContent>
        </Menu>
        {pivotHere && (
          <button
            onClick={() => (setPivotId(pivotHere), setPanel('Pivot table'))}
            className="ml-2 flex h-7 items-center gap-1.5 rounded-md bg-brand-50 px-2.5 text-[13px] font-medium text-brand-700 hover:bg-brand-100"
            data-testid="edit-pivot"
          >
            <Table2 size={14} />
            Edit pivot table
          </button>
        )}
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
              {recorder && (
                <div className="flex shrink-0 items-center gap-3 border-b border-red-200 bg-red-50 px-4 py-2 text-[13px] text-red-800" data-testid="macro-recording">
                  <span className="size-2.5 animate-pulse rounded-full bg-red-500" />
                  <span className="flex-1">
                    Recording new macro… <b>{recCount}</b> action{recCount === 1 ? '' : 's'} so far. Work on the sheet as usual.
                  </span>
                  <Button size="sm" variant="primary" onClick={() => setSaveRecording(recorder.stop())} data-testid="macro-stop">
                    Save
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => (recorder.stop(), setRecorder(null))}>
                    Cancel
                  </Button>
                </div>
              )}
              <SheetTabs grid={grid} unitId={r.id} doc={collab.session.doc} editable={editable} />
              {activeView && <FilterViewBar doc={collab.session.doc} view={activeView} onClose={closeView} />}
              <div className="relative min-h-0 flex-1">
              <UniverGrid
                key={r.id}
                unitId={r.id}
                doc={collab.session.doc}
                synced={collab.synced}
                editable={editable}
                user={me ? { id: me.user.id, name: me.user.name, color: me.user.avatarColor } : undefined}
                people={people}
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
              {grid && <GroupGutter api={grid.api} doc={collab.session.doc} unitId={r.id} editable={editable} />}
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
          <aside className={cn('flex shrink-0 flex-col rounded-xl border border-line bg-surface', panel === 'Macros' ? 'w-[520px]' : 'w-[320px]')}>
            <div className="flex items-center gap-4 border-b border-line px-4">
              {(['Macros', 'History', ...(chartId ? (['Chart'] as const) : []), ...(panel === 'Column stats' ? (['Column stats'] as const) : []), ...(pivotId ? (['Pivot table'] as const) : []), ...(bandingId ? (['Alternating colors'] as const) : []), ...(activeView ? (['Filter view'] as const) : [])] as const).map((t) => (
                <button key={t} className="tab" aria-current={panel === t ? 'page' : undefined} onClick={() => setPanel(t)}>
                  {t}
                </button>
              ))}
              <button onClick={() => (setPanel(null), setPreviewing(null))} className="ml-auto rounded p-1 text-muted hover:bg-hover" aria-label="Close panel">
                <X size={15} />
              </button>
            </div>
            <div className="min-h-0 flex-1">
              {panel === 'Filter view' && activeView && grid && collab.session ? (
                <FilterViewPanel api={grid.api} doc={collab.session.doc} unitId={r.id} view={activeView} editable={editable} onClose={closeView} />
              ) : panel === 'Alternating colors' && bandingId && grid && collab.session ? (
                <BandingPanel api={grid.api} doc={collab.session.doc} unitId={r.id} id={bandingId} editable={editable} onClose={() => (setBandingId(null), setPanel(null))} />
              ) : panel === 'Pivot table' && pivotId && grid && collab.session ? (
                <PivotEditor doc={collab.session.doc} api={grid.api} unitId={r.id} pivotId={pivotId} editable={editable} onClose={() => (setPivotId(null), setPanel(null))} />
              ) : panel === 'Column stats' && grid ? (
                <ColumnStatsPanel api={grid.api} unitId={r.id} />
              ) : panel === 'Chart' && chartId && grid && collab.session ? (
                <ChartEditor doc={collab.session.doc} api={grid.api} unitId={r.id} chartId={chartId} editable={editable} onClose={() => (setChartId(null), setPanel(null))} />
              ) : panel === 'History' ? (
                <HistoryPanel resourceId={r.id} canEdit={editable} previewing={previewing} onPreview={setPreviewing} />
              ) : collab.session ? (
                <MacrosPanel
                  doc={collab.session.doc}
                  grid={grid}
                  editable={editable}
                  me={me?.user.name ?? 'Someone'}
                  running={running}
                  lastRun={lastRun}
                  editingId={editingMacro}
                  setEditingId={setEditingMacro}
                  onRun={(m) => void run(m)}
                  onRecord={startRecording}
                  onImport={() => setImportOpen(true)}
                  resourceId={r.id}
                  disabledTriggers={disabledTriggers}
                  onToggleTrigger={(key, on) => setTriggerEnabled(collab.session!.doc, key, on)}
                  executions={executions}
                />
              ) : null}
            </div>
          </aside>
        )}
      </div>
      <ShareDialog resource={share ? r : null} onClose={() => setShare(false)} />
      {collab.session && <ImportMacrosDialog open={importOpen} doc={collab.session.doc} currentId={r.id} me={me?.user.name ?? 'Someone'} onClose={() => setImportOpen(false)} />}
      <PublishDialog r={r} open={publishOpen} canEdit={editable} onClose={() => setPublishOpen(false)} />
      <ActivityDashboard r={r} open={activityOpen} onClose={() => setActivityOpen(false)} />
      {grid && <RemoveDuplicatesDialog api={grid.api} unitId={r.id} open={dedupe} onOpenChange={setDedupe} />}
      <SaveMacroDialog
        lines={saveRecording}
        taken={macros}
        onCancel={() => (setSaveRecording(null), setRecorder(null))}
        onSave={(name, shortcut) => {
          if (!collab.session || !saveRecording) return;
          const fn = functionNameOf(name, macros.map((m) => m.fn));
          const m: MacroDef = { id: crypto.randomUUID(), name, fn, code: recordedCode(fn, saveRecording, me?.user.name ?? 'someone'), shortcut, updatedBy: me?.user.name ?? 'Someone', updatedAt: new Date().toISOString() };
          saveMacro(collab.session.doc, m);
          setSaveRecording(null);
          setRecorder(null);
          toast.success(`Macro "${name}" saved`, { description: shortcut ? `Run it with ${SHORTCUT_LABEL(shortcut)}` : 'Run it from Extensions → Macros' });
        }}
      />
    </div>
  );
}

function SaveMacroDialog({ lines, taken, onSave, onCancel }: { lines: string[] | null; taken: MacroDef[]; onSave: (name: string, shortcut: number | null) => void; onCancel: () => void }) {
  const [name, setName] = useState('');
  const free = [1, 2, 3, 4, 5, 6, 7, 8, 9].filter((n) => !taken.some((m) => m.shortcut === n));
  const [shortcut, setShortcut] = useState<string>('');
  useEffect(() => {
    if (lines) {
      setName(`Recorded macro ${taken.length + 1}`);
      setShortcut(free[0] ? String(free[0]) : '');
    }
  }, [lines]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Dialog open={!!lines} onOpenChange={(o) => !o && onCancel()} title="Save new macro" description={`${(lines ?? []).filter((l) => !l.startsWith('//')).length} recorded action(s)`} width={460}>
      <div className="space-y-3">
        <label className="block text-[13px] text-ink-2">
          Name
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} className="input mt-1 h-9" aria-label="Macro name" data-testid="macro-name" />
        </label>
        <label className="block text-[13px] text-ink-2">
          Shortcut
          <select value={shortcut} onChange={(e) => setShortcut(e.target.value)} className="input mt-1 h-9" aria-label="Macro shortcut">
            <option value="">None</option>
            {free.map((n) => (
              <option key={n} value={n}>
                {SHORTCUT_LABEL(n)}
              </option>
            ))}
          </select>
        </label>
        <pre className="max-h-40 overflow-auto rounded-lg bg-canvas p-2 font-mono text-[11px] text-ink-2">{(lines ?? []).join('\n') || '// Nothing was recorded'}</pre>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel}>
            Discard
          </Button>
          <Button variant="primary" disabled={!name.trim()} onClick={() => onSave(name.trim(), shortcut ? Number(shortcut) : null)} data-testid="macro-save">
            Save
          </Button>
        </div>
      </div>
    </Dialog>
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
