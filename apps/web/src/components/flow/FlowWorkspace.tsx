'use client';

import { bounds, type FlowEdge, type FlowNode } from '@workos/flow-model';
import type { ResourceDetail } from '@workos/shared';
import { can } from '@workos/shared';
import { ChevronDown, ChevronLeft, ChevronRight, Download, FileJson, FileImage, Hand, Maximize, MessageSquarePlus, MousePointer2, Pencil, Play, Plus, Redo2, Spline, Sparkles, SquarePlus, Trash2, Undo2, Upload, X } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useFlowActions } from '@/lib/flow';
import { RunsPanel } from './RunsPanel';
import { useAiUi, useRegisterAi } from '@/lib/ai';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useMe, useResourceMembers } from '@/lib/queries';
import { useCollab } from '../docs/useCollab';
import { HistoryPanel } from '../docs/HistoryPanel';
import { ShareDialog } from '../drive/dialogs';
import { TitleBar } from '../editor/TitleBar';
import { Avatar, Button, cn, EmptyState, IconButton, Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, Skeleton, Tip } from '../ui/primitives';
import { FlowCanvas, type Peer, type Selection, type Tool, type ViewBox } from './FlowCanvas';
import { download, FlowStatic, pngBlob, svgText } from './FlowStatic';
import { FlowStore, useFlow } from './flow-store';
import { Inspector } from './Inspector';
import { ShapeLibrary } from './ShapeLibrary';
import { api } from '@/lib/api';
import type { PlainFlow } from '@workos/flow-model';

type Tab = 'design' | 'runs' | 'prototype' | 'collaborate' | 'history';
// Copied shapes survive switching flows in the same tab.
let clipboard: { nodes: FlowNode[]; edges: FlowEdge[] } | null = null;

/** Flow designer (§77): shapes on the left, the canvas, styles and workflow info on the right. */
export function FlowWorkspace({ r }: { r: ResourceDetail }) {
  const { data: me } = useMe();
  const { data: members } = useResourceMembers(r.id);
  const collab = useCollab(r.id, me && { id: me.user.id, name: me.user.name, color: me.user.avatarColor });
  const store = useMemo(() => (collab.session ? new FlowStore(collab.session.doc) : null), [collab.session]);
  useEffect(() => () => store?.destroy(), [store]);
  const flow = useFlow(store);
  const editable = can(collab.session?.role ?? r.myRole, 'editor');
  useRegisterAi({ app: 'flow', resourceId: r.id, name: r.name, editable });
  const openAi = useAiUi((s) => s.setOpen);
  const params = useSearchParams();
  const [tab, setTab] = useState<Tab>(params.get('tab') === 'runs' ? 'runs' : 'design');
  const flowActions = useFlowActions(r.id);
  const importInput = useRef<HTMLInputElement>(null);
  const selectNode = useCallback((id: string) => {
    setTab('design');
    setSel({ nodes: [id], edges: [] });
  }, []);
  const [share, setShare] = useState(false);
  const [pageId, setPageId] = useState<string | null>(null);
  const page = flow?.pages.find((p) => p.id === pageId)?.id ?? flow?.pages[0]?.id ?? null;
  const [tool, setTool] = useState<Tool>('select');
  const [view, setView] = useState<ViewBox>({ x: 0, y: 0, zoom: 1 });
  const [sel, setSel] = useState<Selection>({ nodes: [], edges: [] });
  const [editing, setEditing] = useState<{ kind: 'node' | 'edge'; id: string } | null>(null);
  const [present, setPresent] = useState(false);
  const [peers, setPeers] = useState<Peer[]>([]);
  const area = useRef<HTMLDivElement>(null);
  const exportRef = useRef<SVGSVGElement>(null);
  const fitted = useRef<string | null>(null);

  /** Fits the page into the canvas. */
  const fit = useCallback(() => {
    if (!flow || !page || !area.current) return;
    const nodes = flow.nodes.filter((n) => n.page === page);
    const el = area.current.getBoundingClientRect();
    if (!nodes.length) return setView({ x: el.width / 2 - 400, y: 80, zoom: 1 });
    const b = bounds(nodes, 60);
    const zoom = Math.max(0.2, Math.min(1.25, el.width / b.w, el.height / b.h));
    setView({ zoom, x: (el.width - b.w * zoom) / 2 - b.x * zoom, y: (el.height - b.h * zoom) / 2 - b.y * zoom });
  }, [flow, page]);
  // Open each page fitted to the screen.
  useEffect(() => {
    if (flow?.ready && page && fitted.current !== page && tab === 'design') {
      fitted.current = page;
      requestAnimationFrame(fit);
    }
  }, [flow?.ready, page, tab, fit]);
  useEffect(() => setSel({ nodes: [], edges: [] }), [page]);

  // Presence: where everyone's pointer is and what they selected (same page only).
  const lastCursor = useRef(0);
  const awareness = collab.session?.provider.awareness;
  useEffect(() => awareness?.setLocalStateField('flow', { page, sel: sel.nodes, cursor: null }), [awareness, page, sel.nodes]);
  useEffect(() => {
    if (!awareness) return;
    const read = () => {
      const out: Peer[] = [];
      awareness.getStates().forEach((st, clientId) => {
        if (clientId === awareness.clientID) return;
        const u = st.user as { name: string; color: string } | undefined;
        const f = st.flow as { page: string; sel: string[]; cursor: { x: number; y: number } | null } | undefined;
        if (u && f && f.page === page) out.push({ clientId, name: u.name, color: u.color, cursor: f.cursor, sel: f.sel ?? [] });
      });
      setPeers(out);
    };
    read();
    awareness.on('change', read);
    return () => awareness.off('change', read);
  }, [awareness, page]);
  const onCursor = (p: { x: number; y: number } | null) => {
    const now = Date.now();
    if (p && now - lastCursor.current < 50) return;
    lastCursor.current = now;
    awareness?.setLocalStateField('flow', { page, sel: sel.nodes, cursor: p });
  };

  // Keyboard shortcuts (design tab, outside text fields).
  useEffect(() => {
    if (!store || !flow || !page || tab !== 'design') return;
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, select, [contenteditable="true"]') || present) return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (mod && k === 'z') return void (e.preventDefault(), e.shiftKey ? store.undo.redo() : store.undo.undo());
      if (mod && k === 'y') return void (e.preventDefault(), store.undo.redo());
      if (mod && k === 'a') return void (e.preventDefault(), setSel({ nodes: flow.nodes.filter((n) => n.page === page).map((n) => n.id), edges: flow.edges.filter((x) => x.page === page).map((x) => x.id) }));
      if (mod && k === 'c') return void copy();
      if (mod && k === 'x' && editable) return void (copy(), store.remove(sel.nodes, sel.edges), setSel({ nodes: [], edges: [] }));
      if (mod && k === 'v' && editable) return void (e.preventDefault(), paste(40));
      if (mod && k === 'd' && editable) return void (e.preventDefault(), copy(), paste(30));
      if ((k === 'delete' || k === 'backspace') && editable && (sel.nodes.length || sel.edges.length)) return void (e.preventDefault(), store.remove(sel.nodes, sel.edges), setSel({ nodes: [], edges: [] }));
      if (k === 'escape') return void (setSel({ nodes: [], edges: [] }), setTool('select'));
      if (k === 'enter' && sel.nodes.length === 1 && editable) return void (e.preventDefault(), setEditing({ kind: 'node', id: sel.nodes[0] }));
      const step: Record<string, [number, number]> = { arrowleft: [-1, 0], arrowright: [1, 0], arrowup: [0, -1], arrowdown: [0, 1] };
      if (step[k] && sel.nodes.length && editable) {
        e.preventDefault();
        const d = e.shiftKey ? 10 : 1;
        return store.updateNodes(sel.nodes.map((id) => {
          const n = flow.nodes.find((x) => x.id === id)!;
          return { id, x: n.x + step[k][0] * d, y: n.y + step[k][1] * d };
        }));
      }
      if (!mod && k === 'v') setTool('select');
      if (!mod && k === 'c' && editable) setTool('connect');
      if (!mod && k === 'h') setTool('hand');
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  const copy = () => {
    if (!flow) return;
    const ids = new Set(sel.nodes);
    if (!ids.size) return;
    clipboard = { nodes: flow.nodes.filter((n) => ids.has(n.id)), edges: flow.edges.filter((e) => ids.has(e.from) && ids.has(e.to)) };
  };
  const paste = (offset: number) => {
    if (!clipboard || !store || !page) return;
    const ids = store.paste(page, clipboard.nodes, clipboard.edges, offset, offset);
    setSel({ nodes: ids, edges: [] });
  };
  const center = () => {
    const el = area.current?.getBoundingClientRect();
    return el ? { x: (el.width / 2 - view.x) / view.zoom, y: (el.height / 2 - view.y) / view.zoom } : { x: 400, y: 300 };
  };
  const addAtCenter = (shape: string, extra: Partial<FlowNode> = {}) => {
    if (!store || !page) return;
    const c = center();
    const id = store.addNode(page, shape, Math.round(c.x / 10) * 10 - 80, Math.round(c.y / 10) * 10 - 30, extra);
    setSel({ nodes: [id], edges: [] });
    setTool('select');
  };
  const zoomTo = (z: number) => {
    const el = area.current?.getBoundingClientRect();
    if (!el) return;
    setView((v) => {
      const cx = el.width / 2;
      const cy = el.height / 2;
      return { zoom: z, x: cx - ((cx - v.x) / v.zoom) * z, y: cy - ((cy - v.y) / v.zoom) * z };
    });
  };

  const [exporting, setExporting] = useState<'png' | 'svg' | null>(null);
  useEffect(() => {
    if (!exporting || !exportRef.current || !flow) return;
    const el = exportRef.current;
    const name = `${r.name}${flow.pages.length > 1 ? ` - ${flow.pages.find((p) => p.id === page)?.name}` : ''}`;
    (async () => {
      try {
        if (exporting === 'svg') download(`${name}.svg`, new Blob([svgText(el)], { type: 'image/svg+xml' }));
        else download(`${name}.png`, await pngBlob(el));
      } catch (e) {
        toast.error((e as Error).message);
      } finally {
        setExporting(null);
      }
    })();
  }, [exporting]); // eslint-disable-line react-hooks/exhaustive-deps

  const current = flow?.pages.find((p) => p.id === page);
  return (
    <div className="flex h-full flex-col bg-surface" data-testid="flow-workspace">
      <TitleBar
        r={r}
        kind="flow"
        members={members?.map((m) => m.principal)}
        online={collab.peers}
        status={collab.error ? 'offline' : collab.status}
        onShare={() => setShare(true)}
        actions={
          <>
            <IconButton label="Undo (Ctrl+Z)" disabled={!editable} onClick={() => store?.undo.undo()}>
              <Undo2 size={18} />
            </IconButton>
            <IconButton label="Redo (Ctrl+Y)" disabled={!editable} onClick={() => store?.undo.redo()}>
              <Redo2 size={18} />
            </IconButton>
            <Button variant="secondary" icon={<Play size={14} />} onClick={() => setPresent(true)} disabled={!flow?.ready} data-testid="flow-present">
              Present
            </Button>
            <Menu>
              <MenuTrigger asChild>
                <Button variant="secondary" icon={<Download size={14} />} disabled={!flow?.ready} data-testid="flow-export">
                  Export
                </Button>
              </MenuTrigger>
              <MenuContent align="end">
                <MenuItem icon={<FileImage size={15} />} onSelect={() => setExporting('png')}>
                  PNG image (this page)
                </MenuItem>
                <MenuItem icon={<FileImage size={15} />} onSelect={() => setExporting('svg')}>
                  SVG image (this page)
                </MenuItem>
                <MenuItem icon={<FileJson size={15} />} onSelect={() => flow && download(`${r.name}.flow.json`, new Blob([JSON.stringify({ info: flow.info, pages: flow.pages, nodes: flow.nodes, edges: flow.edges }, null, 2)], { type: 'application/json' }))}>
                  Flow data (.json)
                </MenuItem>
                {editable && (
                  <>
                    <MenuSeparator />
                    <MenuItem icon={<Upload size={15} />} onSelect={() => importInput.current?.click()}>
                      Import flow data (.json)…
                    </MenuItem>
                  </>
                )}
              </MenuContent>
            </Menu>
          </>
        }
      />
      <nav className="mt-1 flex gap-1 border-b border-line px-5" role="tablist">
        {(['design', 'runs', 'prototype', 'collaborate', 'history'] as Tab[]).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={cn('-mb-px border-b-2 px-3 py-2 text-[13.5px] capitalize', tab === t ? 'border-brand-600 font-semibold text-brand-700' : 'border-transparent text-muted hover:text-ink')} data-testid={`flow-tab-${t}`}>
            {t}
          </button>
        ))}
      </nav>

      {collab.error ? (
        <EmptyState title="Can’t open this flow">{collab.error}</EmptyState>
      ) : !store || !flow?.ready || !page ? (
        <div className="flex flex-1 gap-3 p-4">
          <Skeleton className="w-60" />
          <Skeleton className="flex-1" />
          <Skeleton className="w-72" />
        </div>
      ) : tab === 'design' ? (
        <div className="flex min-h-0 flex-1">
          <ShapeLibrary editable={editable} onAdd={(s) => addAtCenter(s)} onAddIcon={(icon) => addAtCenter('process', { icon, text: 'Step' })} />
          <div ref={area} className="relative min-w-0 flex-1">
            <FlowCanvas store={store} flow={flow} page={page} editable={editable} tool={tool} view={view} setView={setView} sel={sel} setSel={setSel} peers={peers} onCursor={onCursor} editing={editing} setEditing={setEditing} />
            {/* Tools */}
            <div className="absolute left-1/2 top-3 z-10 flex -translate-x-1/2 items-center gap-0.5 rounded-xl border border-line bg-surface p-1 shadow-md" data-testid="flow-tools">
              <ToolBtn on={tool === 'select'} onClick={() => setTool('select')} label="Select (V)" icon={<MousePointer2 size={16} />} />
              <ToolBtn on={tool === 'hand'} onClick={() => setTool('hand')} label="Hand (H, or hold Space)" icon={<Hand size={16} />} />
              <span className="mx-1 h-5 w-px bg-line" />
              <ToolBtn disabled={!editable} onClick={() => addAtCenter('process', { text: 'New step' })} label="Add node" icon={<SquarePlus size={16} />} text="Add Node" testid="tool-add" />
              <ToolBtn disabled={!editable} on={tool === 'connect'} onClick={() => setTool(tool === 'connect' ? 'select' : 'connect')} label="Connect (C): drag from one shape to another" icon={<Spline size={16} />} text="Connect" testid="tool-connect" />
              <ToolBtn disabled={!editable} onClick={() => addAtCenter('note', { text: `${me?.user.name ?? 'Comment'}: ` })} label="Comment: a sticky note on the canvas" icon={<MessageSquarePlus size={16} />} text="Comment" testid="tool-comment" />
              <ToolBtn disabled={!editable} onClick={() => openAi(true, { promptKey: 'flow.generate' })} label="AI: draw a workflow from a description (opens the assistant)" icon={<Sparkles size={16} className="text-violet-500" />} text="AI Suggest" testid="tool-ai" />
            </div>
            {/* Pages and zoom */}
            <div className="absolute bottom-3 left-3 z-10 flex items-center gap-1 rounded-xl border border-line bg-surface p-1 shadow-md" data-testid="flow-pages">
              <Menu>
                <MenuTrigger asChild>
                  <button className="flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[13px] hover:bg-hover" data-testid="page-picker">
                    {current?.name} <ChevronDown size={13} />
                  </button>
                </MenuTrigger>
                <MenuContent>
                  {flow.pages.map((p) => (
                    <MenuItem key={p.id} onSelect={() => setPageId(p.id)}>
                      {p.id === page ? '● ' : ''}
                      {p.name}
                    </MenuItem>
                  ))}
                  {editable && (
                    <>
                      <MenuSeparator />
                      <MenuItem
                        icon={<Pencil size={15} />}
                        onSelect={() => {
                          const name = window.prompt('Page name', current?.name);
                          if (name?.trim()) store.renamePage(page, name.trim());
                        }}
                      >
                        Rename page
                      </MenuItem>
                      <MenuItem
                        icon={<Trash2 size={15} />}
                        danger
                        disabled={flow.pages.length < 2}
                        onSelect={() => {
                          if (window.confirm(`Delete "${current?.name}" and everything on it?`)) {
                            store.deletePage(page);
                            setPageId(null);
                          }
                        }}
                      >
                        Delete page
                      </MenuItem>
                    </>
                  )}
                </MenuContent>
              </Menu>
              {editable && (
                <IconButton label="Add page" onClick={() => setPageId(store.addPage(`Page ${flow.pages.length + 1}`))} data-testid="add-page">
                  <Plus size={16} />
                </IconButton>
              )}
            </div>
            <div className="absolute bottom-3 right-3 z-10 flex items-center gap-1 rounded-xl border border-line bg-surface p-1 shadow-md">
              <IconButton label="Fit to screen" onClick={fit} data-testid="zoom-fit">
                <Maximize size={16} />
              </IconButton>
              <Menu>
                <MenuTrigger asChild>
                  <button className="flex h-8 w-20 items-center justify-center gap-1 rounded-lg text-[13px] tabular-nums hover:bg-hover" data-testid="zoom-menu">
                    {Math.round(view.zoom * 100)}% <ChevronDown size={13} />
                  </button>
                </MenuTrigger>
                <MenuContent align="end">
                  {[0.5, 0.75, 1, 1.25, 1.5, 2].map((z) => (
                    <MenuItem key={z} onSelect={() => zoomTo(z)}>
                      {z * 100}%
                    </MenuItem>
                  ))}
                  <MenuSeparator />
                  <MenuItem onSelect={fit}>Fit to screen</MenuItem>
                </MenuContent>
              </Menu>
              <span className="hidden px-1.5 text-[11.5px] text-subtle xl:block">Ctrl + scroll to zoom</span>
            </div>
          </div>
          <Inspector store={store} flow={flow} sel={sel} owner={r.owner ?? null} editable={editable} />
        </div>
      ) : tab === 'runs' ? (
        <RunsPanel r={r} flow={flow} store={store} editable={editable} onStateless={collab.onStateless} onSelectNode={selectNode} />
      ) : tab === 'prototype' ? (
        <Prototype flow={flow} page={page} />
      ) : tab === 'collaborate' ? (
        <Collaborate r={r} peers={collab.peers} members={members?.map((m) => ({ ...m.principal, role: m.role })) ?? []} />
      ) : (
        <VersionsTab resourceId={r.id} editable={editable} page={page} />
      )}

      <input
        ref={importInput}
        type="file"
        accept="application/json,.json"
        className="hidden"
        aria-label="Import flow data"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          try {
            const data = JSON.parse(await f.text()) as PlainFlow;
            flowActions.importFlow.mutate(data, { onSuccess: (res) => toast.success(`Imported ${res.nodes} shapes`) });
          } catch {
            toast.error('That file is not a flow export');
          }
        }}
      />
      {present && flow?.ready && page && <Present flow={flow} startPage={page} onClose={() => setPresent(false)} />}
      {exporting && flow && page && (
        <div style={{ position: 'fixed', left: -100000, top: 0 }} aria-hidden>
          <FlowStatic ref={exportRef} flow={flow} page={page} />
        </div>
      )}
      <ShareDialog resource={share ? r : null} onClose={() => setShare(false)} />
    </div>
  );
}

function ToolBtn({ on, onClick, label, icon, text, disabled, testid }: { on?: boolean; onClick: () => void; label: string; icon: React.ReactNode; text?: string; disabled?: boolean; testid?: string }) {
  return (
    <Tip label={label}>
      <button disabled={disabled} onClick={onClick} aria-label={label} aria-pressed={on} className={cn('flex h-8 items-center gap-1.5 whitespace-nowrap rounded-lg px-2 text-[12.5px] disabled:opacity-40', on ? 'bg-selected text-brand-700' : 'text-ink-2 hover:bg-hover')} data-testid={testid}>
        {icon}
        {text}
      </button>
    </Tip>
  );
}

/** Full-screen slides of the pages: arrows move, Esc leaves. */
function Present({ flow, startPage, onClose }: { flow: PlainFlow; startPage: string; onClose: () => void }) {
  const [i, setI] = useState(Math.max(0, flow.pages.findIndex((p) => p.id === startPage)));
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') setI((x) => Math.min(flow.pages.length - 1, x + 1));
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') setI((x) => Math.max(0, x - 1));
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [flow.pages.length, onClose]);
  const p = flow.pages[i];
  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-white" data-testid="flow-presenting">
      <div className="flex items-center gap-3 px-5 py-3 text-[13px] text-muted">
        <b className="text-ink">{p.name}</b> {i + 1} / {flow.pages.length}
        <span className="ml-auto">← → to move · Esc to leave</span>
        <IconButton label="Leave presentation" onClick={onClose}>
          <X size={18} />
        </IconButton>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center p-6">
        <FlowStatic flow={flow} page={p.id} className="h-full max-h-full w-full max-w-full" />
      </div>
      {flow.pages.length > 1 && (
        <div className="flex justify-center gap-2 pb-5">
          <IconButton label="Previous page" onClick={() => setI(Math.max(0, i - 1))}>
            <ChevronLeft size={18} />
          </IconButton>
          <IconButton label="Next page" onClick={() => setI(Math.min(flow.pages.length - 1, i + 1))}>
            <ChevronRight size={18} />
          </IconButton>
        </div>
      )}
    </div>
  );
}

/** Walk through the flow: start at the start, pick a branch at each decision. */
function Prototype({ flow, page }: { flow: PlainFlow; page: string }) {
  const nodes = flow.nodes.filter((n) => n.page === page);
  const edges = flow.edges.filter((e) => e.page === page);
  const startNode = nodes.find((n) => n.shape === 'terminal' && /start/i.test(n.text)) ?? nodes.find((n) => n.shape === 'bpmnStart') ?? nodes.find((n) => !edges.some((e) => e.to === n.id) && edges.some((e) => e.from === n.id)) ?? nodes[0];
  const [at, setAt] = useState<string | null>(startNode?.id ?? null);
  const [trail, setTrail] = useState<string[]>([]);
  const node = nodes.find((n) => n.id === at);
  const next = edges.filter((e) => e.from === at);
  const visited = new Set(trail);
  const go = (e: FlowEdge) => {
    setTrail([...trail, at!, e.id]);
    setAt(e.to);
  };
  if (!node) return <EmptyState title="Nothing to walk through on this page" />;
  return (
    <div className="flex min-h-0 flex-1" data-testid="flow-prototype">
      <div className="min-w-0 flex-1 overflow-auto bg-canvas p-6">
        <FlowStatic flow={flow} page={page} highlight={at} visited={visited} className="mx-auto h-auto max-w-full" onNode={(id) => setAt(id)} />
      </div>
      <aside className="w-80 shrink-0 space-y-3 border-l border-line bg-surface p-4">
        <p className="text-[11.5px] font-semibold uppercase tracking-wide text-subtle">Step {trail.length / 2 + 1}</p>
        <p className="text-[16px] font-semibold text-ink" data-testid="prototype-step">
          {node.text || 'Untitled step'}
        </p>
        {Object.entries(node.data).length > 0 && (
          <dl className="space-y-1 text-[12.5px]">
            {Object.entries(node.data).map(([k, v]) => (
              <div key={k} className="flex gap-2">
                <dt className="w-24 shrink-0 text-muted">{k}</dt>
                <dd className="text-ink-2">{v}</dd>
              </div>
            ))}
          </dl>
        )}
        {next.length ? (
          <div className="space-y-1.5">
            <p className="text-[12.5px] text-muted">{next.length > 1 ? 'Choose what happens:' : 'Next:'}</p>
            {next.map((e) => (
              <Button key={e.id} className="w-full justify-start" variant={next.length > 1 ? 'secondary' : 'primary'} onClick={() => go(e)} data-testid="prototype-next">
                {e.label ? `${e.label} → ` : '→ '}
                {nodes.find((n) => n.id === e.to)?.text || 'next step'}
              </Button>
            ))}
          </div>
        ) : (
          <p className="rounded-lg bg-emerald-50 px-3 py-2 text-[13px] text-emerald-800" data-testid="prototype-end">
            The flow ends here.
          </p>
        )}
        <Button variant="ghost" onClick={() => (setAt(startNode?.id ?? null), setTrail([]))}>
          Start over
        </Button>
        <p className="text-[11.5px] text-subtle">Running the flow for real (forms, Base records, approvals → emails, tasks…) comes with Flow automation.</p>
      </aside>
    </div>
  );
}

function Collaborate({ r, peers, members }: { r: ResourceDetail; peers: { userId: string; name: string; color: string }[]; members: { id: string; name: string; avatarColor: string; role: string }[] }) {
  const online = new Set(peers.map((p) => p.userId));
  return (
    <div className="mx-auto w-full max-w-xl p-6" data-testid="flow-collaborate">
      <h2 className="text-[15px] font-semibold text-ink">People in this flow</h2>
      <p className="mt-1 text-[12.5px] text-muted">Everyone editing sees the others’ pointers and selections live on the canvas. Share to invite more people.</p>
      <ul className="mt-4 space-y-2">
        {r.owner && (
          <li className="flex items-center gap-2.5 text-[13px]">
            <Avatar user={r.owner} size={28} /> <span className="flex-1">{r.owner.name}</span> <span className="text-muted">Owner</span>
          </li>
        )}
        {members
          .filter((m) => m.id !== r.owner?.id)
          .map((m) => (
            <li key={m.id} className="flex items-center gap-2.5 text-[13px]">
              <Avatar user={m} size={28} /> <span className="flex-1">{m.name}</span>
              {online.has(m.id) && <span className="text-[11.5px] text-emerald-600">● here now</span>}
              <span className="capitalize text-muted">{m.role}</span>
            </li>
          ))}
      </ul>
      {peers.filter((p) => !members.some((m) => m.id === p.userId) && p.userId !== r.owner?.id).length > 0 && <p className="mt-3 text-[12.5px] text-muted">Also here: {peers.map((p) => p.name).join(', ')}</p>}
    </div>
  );
}

function VersionsTab({ resourceId, editable, page }: { resourceId: string; editable: boolean; page: string }) {
  const [previewing, setPreviewing] = useState<string | null>(null);
  const [flow, setFlow] = useState<PlainFlow | null>(null);
  useEffect(() => {
    setFlow(null);
    if (previewing) api<{ flow: PlainFlow }>(`/resources/${resourceId}/versions/${previewing}/content`).then((x) => setFlow(x.flow), () => setFlow(null));
  }, [previewing, resourceId]);
  return (
    <div className="flex min-h-0 flex-1">
      <div className="min-w-0 flex-1 overflow-auto bg-canvas p-6">
        {previewing && flow ? (
          <FlowStatic flow={flow} page={flow.pages.some((p) => p.id === page) ? page : flow.pages[0]?.id} className="mx-auto h-auto max-w-full" />
        ) : (
          <EmptyState title="Version history">Pick a version on the right to see it. Restoring keeps the current flow as a version too.</EmptyState>
        )}
      </div>
      <aside className="w-80 shrink-0 border-l border-line bg-surface">
        <HistoryPanel resourceId={resourceId} canEdit={editable} previewing={previewing} onPreview={setPreviewing} />
      </aside>
    </div>
  );
}


