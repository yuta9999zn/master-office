'use client';

import type { Editor } from '@tiptap/react';
import type { ImportReport, ResourceDetail } from '@workos/shared';
import { can } from '@workos/shared';
import {
  diagramElements,
  FONTS,
  isLine,
  isOpenStroke,
  EXTRA_SHAPES,
  shapePath,
  LAYOUTS,
  SHAPES,
  slideTitle,
  textDoc,
  textOf,
  type ChartSpec,
  type DiagramKind,
  type Geometry,
  type LayoutId,
  type PlainDeck,
  type PlainElement,
  type PlainSlide,
} from '@workos/slide-model';
import {
  AlertTriangle,
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  ArrowLeft,
  Bold,
  ChartColumn,
  ChevronDown,
  Clipboard,
  Copy,
  CopyPlus,
  Download,
  Eye,
  EyeOff,
  FolderOpen,
  Grid2x2,
  Highlighter,
  History,
  Image as ImageIcon,
  Italic,
  Keyboard,
  LayoutTemplate,
  List,
  ListOrdered,
  Maximize2,
  MessageSquareText,
  Minus,
  MonitorPlay,
  PencilLine,
  Play,
  Plus,
  Presentation,
  Printer,
  Redo2,
  RotateCcw,
  Scissors,
  Shapes,
  Share2,
  StickyNote,
  Strikethrough,
  Table,
  Trash2,
  Type,
  Underline,
  Undo2,
  X,
  Globe,
  Group as GroupIcon,
  Network,
  WholeWord,
  Spline,
  Music,
  Video as VideoIcon,
  Hash,
  Sparkles,
  Ungroup as UngroupIcon,
  RotateCw,
  FlipHorizontal2,
  FlipVertical2,
  PenLine,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { ContextMenu as CM, DropdownMenu as DM } from 'radix-ui';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import * as Y from 'yjs';
import { uploadFile } from '@/lib/api';
import { useComments, useMe, useResourceActions, useResourceMembers, useVersionActions, useVersionContent } from '@/lib/queries';
import { ShareDialog } from '../drive/dialogs';
import { PublishDialog } from '../editor/PublishDialog';
import { ActivityDashboard } from '../editor/ActivityDashboard';
import { ImportBanner } from '../docs/DocsWorkspace';
import { HistoryPanel } from '../docs/HistoryPanel';
import { useCollab } from '../docs/useCollab';
import { folderHrefOf, TitleBar, type TitleBarHandle } from '../editor/TitleBar';
import { Button, cn, Dialog, EmptyState, IconButton, Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger, Skeleton, Tip } from '../ui/primitives';
import { allRunsHave, DeckStore, LOCAL, setAlignEverywhere, setMarkEverywhere, setTextStyleEverywhere, useDeck, type DeckSnapshot } from './deck-store';
import { DiagramDialog } from './DiagramDialog';
import { VideoDialog } from './MediaDialog';
import { MotionPanel } from './MotionPanel';
import { Presenter } from './Presenter';
import { CtxItem, CtxSep, SlideCanvas, type RemoteSelection } from './SlideCanvas';
import type { DrawTool, Drawn } from './DrawLayer';
import { anchorOf, SlideComments, type SlideAnchor } from './SlideComments';
import { ColorPicker, DesignTab, FormatTab, LayoutTab, LayoutWire, PALETTE, ThemeTab } from './SlidePanels';
import { SlideStyles, SlideView } from './SlideView';

const EXPORTS = [
  { f: 'pptx', label: 'Microsoft PowerPoint (.pptx)' },
  { f: 'pdf', label: 'PDF document (.pdf)' },
  { f: 'png', label: 'PNG images (.zip, one per slide)' },
  { f: 'html', label: 'Web page (.html)' },
];
const SIZES = [8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 44, 48, 54, 60, 66, 72, 80, 96];
const CLIP_PREFIX = 'MO-SLIDES:';
type Clip = { kind: 'elements'; items: PlainElement[] } | { kind: 'slides'; items: PlainSlide[] };
let clipboard: Clip | null = null;

type Tab = 'Design' | 'Layout' | 'Theme' | 'Format' | 'Motion' | 'Comments' | 'History';

const isTextual = (e: PlainElement) => e.type === 'text' || (e.type === 'shape' && !isOpenStroke(e));
const typingTarget = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
};

export function SlidesWorkspace({ r }: { r: ResourceDetail }) {
  const router = useRouter();
  const { data: me } = useMe();
  const { data: members } = useResourceMembers(r.id);
  const collab = useCollab(r.id, me && { id: me.user.id, name: me.user.name, color: me.user.avatarColor });
  const acts = useResourceActions();
  const versions = useVersionActions(r.id);
  const { data: threads = [], refetch: refetchComments } = useComments(r.id);
  const titleRef = useRef<TitleBarHandle>(null);

  const store = useMemo(() => (collab.session ? new DeckStore(collab.session.doc) : null), [collab.session]);
  useEffect(() => {
    if (store) (window as unknown as { __moDeck?: DeckStore }).__moDeck = store; // e2e hooks
    return () => store?.destroy();
  }, [store]);
  const deck = useDeck(store);
  const editable = can(collab.session?.role ?? r.myRole, 'editor');

  const [current, setCurrent] = useState<string | null>(null);
  const [slideSel, setSlideSel] = useState<string[]>([]);
  const [selection, setSelection] = useState<string[]>([]);
  const [editing, setEditingState] = useState<string | null>(null);
  const [selectAllOnEdit, setSelectAllOnEdit] = useState(false);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [tableCell, setTableCell] = useState<{ r: number; c: number } | null>(null);
  const [view, setView] = useState<'normal' | 'sorter'>('normal');
  const [zoom, setZoom] = useState<number | 'fit'>('fit');
  const [scale, setScale] = useState(1);
  const [tab, setTab] = useState<Tab | null>('Design');
  const [presenting, setPresenting] = useState<number | null>(null);
  const [notesOpen, setNotesOpen] = useState(true);
  const [previewing, setPreviewing] = useState<string | null>(null);
  const [share, setShare] = useState(false);
  const [activeThread, setActiveThread] = useState<string | null>(null);
  const [focusArea, setFocusArea] = useState<'canvas' | 'rail'>('canvas');
  const [remote, setRemote] = useState<RemoteSelection[]>([]);
  const [shortcuts, setShortcuts] = useState(false);
  const [, force] = useState(0);
  const pendingCommand = useRef<((e: Editor) => void) | null>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const audioInput = useRef<HTMLInputElement>(null);
  const [videoDialog, setVideoDialog] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const [diagramDialog, setDiagramDialog] = useState(false);
  const replaceTarget = useRef<string | null>(null);

  const slides = deck?.slides ?? [];
  const index = Math.max(0, slides.findIndex((s) => s.id === current));
  const slide = slides[index] ?? null;
  useEffect(() => {
    if (slides.length && (!current || !slides.some((s) => s.id === current))) setCurrent(slides[Math.min(index, slides.length - 1)].id);
  }, [slides, current]); // eslint-disable-line react-hooks/exhaustive-deps

  // Drop selection entries whose element was deleted (by anyone).
  const selected = useMemo(() => (slide ? selection.map((id) => slide.elements.find((e) => e.id === id)).filter((e): e is PlainElement => !!e) : []), [slide, selection]);
  useEffect(() => {
    if (selected.length !== selection.length) setSelection(selected.map((e) => e.id));
    if (editing && !slide?.elements.some((e) => e.id === editing)) setEditingState(null);
  }, [selected, selection.length, editing, slide]);

  const setEditing = useCallback((id: string | null, selectAll = false) => {
    setSelectAllOnEdit(selectAll);
    setEditingState(id);
    if (!id) setTableCell(null);
  }, []);

  const goSlide = useCallback(
    (id: string) => {
      setCurrent(id);
      setSlideSel([id]);
      setSelection([]);
      setEditing(null);
    },
    [setEditing],
  );

  // Contextual Format tab: open it when something gets selected, return to Design when the selection clears.
  const hadSelection = useRef(false);
  useEffect(() => {
    const has = selection.length > 0;
    if (has && !hadSelection.current && (tab === 'Design' || tab === 'Layout' || tab === 'Theme')) setTab('Format');
    if (!has && hadSelection.current && tab === 'Format') setTab('Design');
    hadSelection.current = has;
  }, [selection.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-render the toolbar on editor selection / formatting changes.
  useEffect(() => {
    if (!editor) return;
    const up = () => force((n) => n + 1);
    editor.on('transaction', up);
    if (pendingCommand.current) {
      const cmd = pendingCommand.current;
      pendingCommand.current = null;
      setTimeout(() => !editor.isDestroyed && cmd(editor), 60);
    }
    return () => void editor.off('transaction', up);
  }, [editor]);

  // ── Presence ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const aw = collab.session?.provider.awareness;
    if (!aw) return;
    aw.setLocalStateField('slides', { slide: current, sel: selection, editing });
  }, [collab.session, current, selection, editing]);
  useEffect(() => {
    const aw = collab.session?.provider.awareness;
    if (!aw) return;
    const read = () => {
      const out: RemoteSelection[] = [];
      aw.getStates().forEach((st, clientId) => {
        if (clientId === aw.clientID) return;
        const u = st.user as { name: string; color: string } | undefined;
        const s = st.slides as { slide: string | null; sel: string[]; editing: string | null } | undefined;
        if (u && s) out.push({ clientId, name: u.name, color: u.color, slideId: s.slide, sel: s.sel ?? [], editing: s.editing ?? null });
      });
      setRemote(out);
    };
    read();
    aw.on('change', read);
    return () => aw.off('change', read);
  }, [collab.session]);

  useEffect(() => {
    const off = collab.onStateless((p) => p.type === 'comments' && void refetchComments());
    return () => void off();
  }, [collab, refetchComments]);

  // ── Images ───────────────────────────────────────────────────────────────
  const upload = useCallback(
    async (file: File, kinds: string[] = ['image']): Promise<string | null> => {
      if (!kinds.some((k) => file.type.startsWith(`${k}/`))) {
        toast.error(kinds.includes('image') ? 'Only pictures can be inserted' : `Choose a ${kinds.join(' or ')} file`);
        return null;
      }
      const fd = new FormData();
      fd.append('file', file);
      try {
        return (await uploadFile<{ url: string }>(`/resources/${r.id}/assets`, fd)).url;
      } catch (e) {
        toast.error((e as Error).message);
        return null;
      }
    },
    [r.id],
  );
  const naturalSize = (url: string) =>
    new Promise<{ w: number; h: number }>((res) => {
      const img = new Image();
      img.onload = () => res({ w: img.naturalWidth || 400, h: img.naturalHeight || 300 });
      img.onerror = () => res({ w: 400, h: 300 });
      img.src = url;
    });

  const insertImages = async (files: File[], at?: { x: number; y: number }) => {
    if (!store || !slide || !deck) return;
    for (const f of files) {
      const url = await upload(f);
      if (!url) continue;
      const n = await naturalSize(url);
      const k = Math.min(1, (deck.size.w * 0.6) / n.w, (deck.size.h * 0.6) / n.h);
      const w = Math.round(n.w * k);
      const h = Math.round(n.h * k);
      if (replaceTarget.current) {
        const id = replaceTarget.current;
        replaceTarget.current = null;
        const el = slide.elements.find((e) => e.id === id);
        store.updateElements(slide.id, [{ id, patch: { src: url, h: el ? Math.round((el.w * n.h) / n.w) : h } }]);
        continue;
      }
      const x = at ? at.x - w / 2 : (deck.size.w - w) / 2;
      const y = at ? at.y - h / 2 : (deck.size.h - h) / 2;
      const ids = store.addElements(slide.id, [{ id: '', type: 'image', x, y, w, h, z: 0, src: url, alt: f.name.replace(/\.[^.]+$/, '') }]);
      setSelection(ids);
    }
  };

  // ── Video & audio ────────────────────────────────────────────────────────
  const insertMedia = async (type: 'video' | 'audio', source: File | string) => {
    if (!store || !slide || !deck) return;
    const src = typeof source === 'string' ? source : await upload(source, [type]);
    if (!src) return;
    setVideoDialog(false);
    const w = type === 'video' ? Math.round(deck.size.w * 0.5) : 72;
    const h = type === 'video' ? Math.round((w * 9) / 16) : 72;
    const x = type === 'video' ? (deck.size.w - w) / 2 : deck.size.w - w - 48;
    const y = type === 'video' ? (deck.size.h - h) / 2 : deck.size.h - h - 48;
    store.checkpoint();
    setSelection(store.addElements(slide.id, [{ id: '', type, x, y, w, h, z: 0, src, alt: typeof source === 'string' ? undefined : source.name.replace(/\.[^.]+$/, ''), media: {} }]));
    store.checkpoint();
  };

  // ── Diagrams & word art ──────────────────────────────────────────────────
  const insertDiagram = (kind: DiagramKind, count: number, color: number | 'multi') => {
    if (!store || !slide || !deck) return;
    setDiagramDialog(false);
    store.checkpoint();
    setSelection(store.addElements(slide.id, diagramElements(kind, { count, color }, deck.size)));
    store.checkpoint();
  };
  const insertWordArt = () =>
    insert(
      {
        type: 'text',
        x: W / 2 - 360,
        y: H / 2 - 70,
        w: 720,
        h: 140,
        style: { fontSize: 66, bold: true, color: '@accent1', outline: '@title', outlineWidth: 1, align: 'center', vAlign: 'middle' },
        text: textDoc('Word art', { align: 'center' }),
      },
      'selectAll',
    );

  // ── Insert ───────────────────────────────────────────────────────────────
  const insert = (el: Omit<PlainElement, 'id' | 'z'>, edit: boolean | 'selectAll' = false) => {
    if (!store || !slide || !editable) return;
    store.checkpoint();
    const ids = store.addElements(slide.id, [{ ...el, id: '', z: 0 }]);
    setSelection(ids);
    if (edit) setEditing(ids[0], edit === 'selectAll');
    store.checkpoint();
  };
  const W = deck?.size.w ?? 1280;
  const H = deck?.size.h ?? 720;
  const insertText = () => insert({ type: 'text', x: W / 2 - 240, y: H / 2 - 40, w: 480, h: 80, style: { fontSize: 20 }, text: { type: 'doc', content: [{ type: 'paragraph' }] } }, true);
  const insertShape = (geom: Geometry) => {
    const aspect = EXTRA_SHAPES.find((x) => x.geom === geom)?.aspect;
    if (aspect) return insert({ type: 'shape', geom, x: W / 2 - 120, y: H / 2 - (240 * aspect) / 2, w: 240, h: 240 * aspect, style: { fill: '@accent1', color: '#FFFFFF', align: 'center', vAlign: 'middle', fontSize: 18 }, text: { type: 'doc', content: [{ type: 'paragraph' }] } });
    return insert(
      isLine(geom)
        ? { type: 'shape', geom, x: W / 2 - 150, y: H / 2, w: 300, h: 0, style: { stroke: '@text', strokeWidth: 3 } }
        : { type: 'shape', geom, x: W / 2 - 120, y: H / 2 - 80, w: 240, h: geom === 'rightArrow' || geom === 'leftArrow' || geom === 'chevron' ? 120 : 160, style: { fill: '@accent1', color: '#FFFFFF', align: 'center', vAlign: 'middle', fontSize: 18 }, text: { type: 'doc', content: [{ type: 'paragraph' }] } },
    );
  };
  // Line ▸ Curve / Polyline / Scribble: the canvas collects the points (DrawLayer), we add the element.
  const [drawTool, setDrawTool] = useState<DrawTool | null>(null);
  const onDrawn = (d: Drawn) => {
    setDrawTool(null);
    insert({ type: 'shape', geom: 'freeform', ...d, style: d.path.closed ? { fill: '@accent1' } : { stroke: '@text', strokeWidth: 3 } });
  };
  // Arrange ▸ Rotate (rotation snaps to quarter turns from where it is) and flips.
  const rotateBy = (deg: number) =>
    store &&
    slide &&
    (store.checkpoint(), store.updateElements(slide.id, selected.map((e) => ({ id: e.id, patch: { rot: (((Math.round(((e.rot ?? 0) + deg) / 90) * 90) % 360) + 360) % 360 || undefined } }))), store.checkpoint());
  const flip = (axis: 'flipH' | 'flipV') => store && slide && (store.checkpoint(), store.updateElements(slide.id, selected.map((e) => ({ id: e.id, patch: { [axis]: !e[axis] || undefined } }))), store.checkpoint());
  const insertTable = (rows: number, cols: number) => {
    const w = Math.min(W * 0.8, cols * 180);
    const h = rows * 46;
    insert({ type: 'table', x: (W - w) / 2, y: (H - h) / 2, w, h, table: { rows: Array.from({ length: rows }, (_, i) => Array.from({ length: cols }, (_, j) => (i === 0 ? `Column ${j + 1}` : ''))), header: true, banded: true } });
  };
  const insertChart = (kind: ChartSpec['kind']) => {
    const pie = kind === 'pie' || kind === 'doughnut';
    const chart: ChartSpec = pie
      ? { kind, categories: ['Social', 'Search', 'Email', 'Stores'], series: [{ name: 'Share', values: [40, 25, 15, 20] }], legend: true, labels: true }
      : { kind, categories: ['Oct', 'Nov', 'Dec'], series: [{ name: 'Revenue', values: [800000, 1200000, 1700000] }, { name: 'Target', values: [900000, 1100000, 1500000] }], legend: true };
    insert({ type: 'chart', x: W / 2 - 300, y: H / 2 - 190, w: 600, h: 380, chart });
    setTab('Format');
  };
  const newSlide = (layout: LayoutId = 'titleContent') => {
    if (!store || !editable) return;
    const id = store.addSlide(layout, index + 1);
    goSlide(id);
  };

  // ── Text formatting (open editor → Tiptap; selected boxes → whole box) ───
  const textEls = selected.filter(isTextual);
  const boxFormat = (fn: (frag: Y.XmlFragment, el: PlainElement) => void) => {
    if (!store || !slide) return;
    store.checkpoint();
    store.doc.transact(() => {
      for (const el of textEls) {
        const frag = store.fragment(slide.id, el.id);
        if (frag) fn(frag, el);
      }
    }, LOCAL);
    store.checkpoint();
  };
  const runInEditor = (cmd: (e: Editor) => void) => {
    if (editor && editing) {
      cmd(editor);
      return true;
    }
    return false;
  };
  const fmt = {
    mark(mark: 'bold' | 'italic' | 'underline' | 'strike') {
      if (runInEditor((e) => e.chain().focus()[`toggle${mark[0].toUpperCase()}${mark.slice(1)}` as 'toggleBold']().run())) return;
      boxFormat((frag, el) => {
        const on = (mark === 'bold' && !!el.style?.bold) || allRunsHave(frag, mark);
        if (mark === 'bold') {
          store!.updateElements(slide!.id, [{ id: el.id, patch: { style: { bold: on ? undefined : true } } }]);
          setMarkEverywhere(frag, 'bold', null);
        } else setMarkEverywhere(frag, mark, on ? null : {});
      });
    },
    size(n: number) {
      if (runInEditor((e) => e.chain().focus().setFontSize(`${n}pt`).run())) return;
      boxFormat((frag, el) => {
        store!.updateElements(slide!.id, [{ id: el.id, patch: { style: { fontSize: n } } }]);
        setTextStyleEverywhere(frag, 'fontSize', null);
      });
    },
    family(f: string) {
      if (runInEditor((e) => e.chain().focus().setFontFamily(f).run())) return;
      boxFormat((frag, el) => {
        store!.updateElements(slide!.id, [{ id: el.id, patch: { style: { fontFamily: f } } }]);
        setTextStyleEverywhere(frag, 'fontFamily', null);
      });
    },
    color(c: string | null) {
      if (runInEditor((e) => (c ? e.chain().focus().setColor(c).run() : e.chain().focus().unsetColor().run()))) return;
      boxFormat((frag, el) => {
        store!.updateElements(slide!.id, [{ id: el.id, patch: { style: { color: c ?? undefined } } }]);
        setTextStyleEverywhere(frag, 'color', null);
      });
    },
    highlight(c: string | null) {
      if (runInEditor((e) => (c ? e.chain().focus().setHighlight({ color: c }).run() : e.chain().focus().unsetHighlight().run()))) return;
      boxFormat((frag) => setMarkEverywhere(frag, 'highlight', c ? { color: c } : null));
    },
    align(a: 'left' | 'center' | 'right' | 'justify') {
      if (runInEditor((e) => e.chain().focus().setTextAlign(a).run())) return;
      boxFormat((frag, el) => {
        store!.updateElements(slide!.id, [{ id: el.id, patch: { style: { align: a === 'left' ? undefined : a } } }]);
        setAlignEverywhere(frag, null);
      });
    },
    list(kind: 'bullet' | 'ordered') {
      const cmd = (e: Editor) => (kind === 'bullet' ? e.chain().focus().toggleBulletList().run() : e.chain().focus().toggleOrderedList().run());
      if (runInEditor(cmd)) return;
      if (textEls.length !== 1) return;
      // Lists change the structure: open the box's editor with everything selected, then apply.
      pendingCommand.current = cmd;
      setEditing(textEls[0].id, true);
    },
  };
  const firstText = textEls[0];
  const ts = editor && editing ? (editor.getAttributes('textStyle') as { fontSize?: string; fontFamily?: string; color?: string }) : null;
  const curSize = ts?.fontSize ? parseFloat(ts.fontSize) : firstText?.style?.fontSize ?? (editing ? slide?.elements.find((e) => e.id === editing)?.style?.fontSize : undefined) ?? 18;
  const curFont = (ts?.fontFamily ?? firstText?.style?.fontFamily ?? (firstText?.ph === 'title' ? deck?.theme.fonts.heading : deck?.theme.fonts.body) ?? 'Inter').split(',')[0].replace(/["']/g, '');
  const isOn = (mark: string) => (editor && editing ? editor.isActive(mark) : !!firstText && ((mark === 'bold' && !!firstText.style?.bold) || (!!store && !!slide && !!store.fragment(slide.id, firstText.id) && allRunsHave(store.fragment(slide.id, firstText.id)!, mark))));
  const textEnabled = editable && (!!editing || textEls.length > 0);

  // ── Clipboard ────────────────────────────────────────────────────────────
  const copy = (cut = false) => {
    if (!store || !slide) return;
    if (focusArea === 'rail' && !selected.length) {
      const items = slides.filter((s) => slideSel.includes(s.id));
      if (!items.length) return;
      clipboard = { kind: 'slides', items: structuredClone(items) };
      void navigator.clipboard?.writeText(CLIP_PREFIX + JSON.stringify(clipboard)).catch(() => undefined);
      if (cut && editable) store.deleteSlides(items.map((s) => s.id));
      return;
    }
    if (!selected.length) return;
    clipboard = { kind: 'elements', items: structuredClone(selected) };
    void navigator.clipboard?.writeText(CLIP_PREFIX + JSON.stringify(clipboard)).catch(() => undefined);
    if (cut && editable) store.deleteElements(slide.id, selected.map((e) => e.id));
  };
  const pasteClip = (clip: Clip) => {
    if (!store || !slide || !editable) return;
    if (clip.kind === 'slides') {
      const ids = store.insertSlides(clip.items, index + 1);
      if (ids[0]) goSlide(ids[0]);
    } else {
      const same = clip.items.every((e) => slide.elements.some((x) => x.id !== e.id && x.x === e.x && x.y === e.y)) || clip.items.some((e) => slide.elements.some((x) => x.x === e.x && x.y === e.y));
      const ids = store.addElements(slide.id, clip.items.map((e) => (same ? { ...e, x: e.x + 20, y: e.y + 20 } : e)));
      setSelection(ids);
    }
  };
  const paste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text.startsWith(CLIP_PREFIX)) return pasteClip(JSON.parse(text.slice(CLIP_PREFIX.length)));
    } catch {
      /* clipboard permission denied: fall back to the in-app clipboard */
    }
    if (clipboard) pasteClip(clipboard);
  };
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (typingTarget(e.target) || presenting !== null || !editable) return;
      const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/'));
      if (files.length) {
        e.preventDefault();
        void insertImages(files);
        return;
      }
      const text = e.clipboardData?.getData('text/plain') ?? '';
      if (text.startsWith(CLIP_PREFIX)) {
        e.preventDefault();
        try {
          pasteClip(JSON.parse(text.slice(CLIP_PREFIX.length)));
        } catch {
          /* ignore malformed */
        }
      } else if (text.trim() && slide) {
        e.preventDefault();
        insert({ type: 'text', x: W / 2 - 300, y: H / 2 - 50, w: 600, h: 100, style: { fontSize: 20 }, text: { type: 'doc', content: text.split('\n').map((t) => ({ type: 'paragraph', ...(t ? { content: [{ type: 'text', text: t }] } : {}) })) } });
      } else if (clipboard) {
        e.preventDefault();
        pasteClip(clipboard);
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  });

  const duplicate = () => {
    if (!store || !slide || !editable) return;
    if (selected.length) setSelection(store.addElements(slide.id, selected.map((e) => ({ ...e, x: e.x + 20, y: e.y + 20 }))));
    else {
      const ids = store.duplicateSlides(slideSel.length ? slideSel : [slide.id]);
      if (ids[0]) goSlide(ids[0]);
    }
  };
  const deleteSelection = () => {
    if (!store || !slide || !editable) return;
    if (selected.length) {
      store.deleteElements(slide.id, selected.map((e) => e.id));
      setSelection([]);
    } else if (focusArea === 'rail') {
      const ids = slideSel.length ? slideSel : [slide.id];
      const next = slides.find((s, i) => i > index && !ids.includes(s.id)) ?? [...slides].reverse().find((s) => !ids.includes(s.id));
      store.deleteSlides(ids);
      if (next) goSlide(next.id);
    }
  };
  const present = (from: number) => {
    setEditing(null);
    setPresenting(from);
  };

  // ── Groups ───────────────────────────────────────────────────────────────
  const canGroup = editable && selected.length > 1 && !(selected[0].group && selected.every((e) => e.group === selected[0].group));
  const canUngroup = editable && selected.some((e) => e.group);
  const groupSelection = () => {
    if (!store || !slide || !canGroup) return;
    store.group(slide.id, selection);
    store.checkpoint();
  };
  const ungroupSelection = () => {
    if (!store || !slide || !canUngroup) return;
    store.ungroup(slide.id, selection);
    store.checkpoint();
  };

  // ── Keyboard ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (presenting !== null || !store || !slide) return;
      const mod = e.ctrlKey || e.metaKey;
      if (e.key === 'F5') {
        e.preventDefault();
        present(e.shiftKey ? index : 0);
        return;
      }
      if (typingTarget(e.target) || editing) return;
      const k = e.key.toLowerCase();
      if (mod && k === 'z') (e.preventDefault(), e.shiftKey ? store.undo.redo() : store.undo.undo());
      else if (mod && k === 'y') (e.preventDefault(), store.undo.redo());
      else if (mod && k === 'c') copy();
      else if (mod && k === 'x') (e.preventDefault(), copy(true));
      else if (mod && k === 'd') (e.preventDefault(), duplicate());
      else if (mod && k === 'm') (e.preventDefault(), newSlide());
      else if (mod && e.altKey && e.code === 'KeyG') (e.preventDefault(), e.shiftKey ? ungroupSelection() : groupSelection());
      else if (mod && k === 'a') (e.preventDefault(), setSelection(slide.elements.map((x) => x.id)));
      else if (mod && (k === 'b' || k === 'i' || k === 'u') && textEls.length) (e.preventDefault(), fmt.mark(k === 'b' ? 'bold' : k === 'i' ? 'italic' : 'underline'));
      else if (e.key === 'Delete' || e.key === 'Backspace') (e.preventDefault(), deleteSelection());
      else if (e.key === 'Escape') (setSelection([]), setTab((t) => (t === 'Format' ? 'Design' : t)));
      else if (e.key === 'Enter' && selected.length === 1 && isTextual(selected[0]) && editable) (e.preventDefault(), setEditing(selected[0].id, true));
      else if (e.key.startsWith('Arrow') && selected.length && editable) {
        e.preventDefault();
        const d = e.shiftKey ? 10 : 1;
        const dx = e.key === 'ArrowLeft' ? -d : e.key === 'ArrowRight' ? d : 0;
        const dy = e.key === 'ArrowUp' ? -d : e.key === 'ArrowDown' ? d : 0;
        store.updateElements(slide.id, selected.map((x) => ({ id: x.id, patch: { x: x.x + dx, y: x.y + dy } })));
      } else if ((e.key === 'PageDown' || (e.key === 'ArrowDown' && focusArea === 'rail')) && slides[index + 1]) (e.preventDefault(), goSlide(slides[index + 1].id));
      else if ((e.key === 'PageUp' || (e.key === 'ArrowUp' && focusArea === 'rail')) && index > 0) (e.preventDefault(), goSlide(slides[index - 1].id));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // ── Comments ─────────────────────────────────────────────────────────────
  const openThreads = threads.filter((t) => !t.resolvedAt);
  const slideCommentCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of openThreads) {
      const a = anchorOf(t);
      if (a) m.set(a.slide, (m.get(a.slide) ?? 0) + 1);
    }
    return m;
  }, [openThreads]);
  const elementComments = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of openThreads) {
      const a = anchorOf(t);
      if (a?.el && a.slide === slide?.id) m.set(a.el, (m.get(a.el) ?? 0) + 1);
    }
    return m;
  }, [openThreads, slide?.id]);
  const commentTarget: SlideAnchor | null = slide ? { slide: slide.id, el: selected.length === 1 ? selected[0].id : null } : null;
  const targetLabel = slide
    ? selected.length === 1
      ? `${textOf(selected[0].text).trim().split('\n')[0]?.slice(0, 60) || ({ text: 'Text box', shape: 'Shape', image: 'Picture', table: 'Table', chart: 'Chart', video: 'Video', audio: 'Audio' } as const)[selected[0].type]} (slide ${index + 1})`
      : `Slide ${index + 1}${slideTitle(slide) ? ` · ${slideTitle(slide)}` : ''}`
    : '';

  const report = (r.metadata as { import?: ImportReport } | undefined)?.import;
  const peersBySlide = useMemo(() => {
    const m = new Map<string, RemoteSelection[]>();
    for (const p of remote) if (p.slideId) m.set(p.slideId, [...(m.get(p.slideId) ?? []), p]);
    return m;
  }, [remote]);

  // ── Context menu (canvas) ────────────────────────────────────────────────
  const contextMenu = () =>
    selected.length ? (
      <>
        <CtxItem icon={<Scissors />} shortcut="Ctrl+X" disabled={!editable} onSelect={() => copy(true)}>
          Cut
        </CtxItem>
        <CtxItem icon={<Copy />} shortcut="Ctrl+C" onSelect={() => copy()}>
          Copy
        </CtxItem>
        <CtxItem icon={<Clipboard />} shortcut="Ctrl+V" disabled={!editable} onSelect={() => void paste()}>
          Paste
        </CtxItem>
        <CtxItem icon={<CopyPlus />} shortcut="Ctrl+D" disabled={!editable} onSelect={duplicate}>
          Duplicate
        </CtxItem>
        <CtxSep />
        {selected.length === 1 && isTextual(selected[0]) && (
          <CtxItem icon={<Type />} disabled={!editable} onSelect={() => setEditing(selected[0].id, true)}>
            Edit text
          </CtxItem>
        )}
        <CtxItem icon={<Shapes />} onSelect={() => setTab('Format')}>
          Format options…
        </CtxItem>
        <CtxItem icon={<MessageSquareText />} onSelect={() => setTab('Comments')}>
          Comment
        </CtxItem>
        <CtxItem icon={<Sparkles />} onSelect={() => setTab('Motion')}>
          Animate
        </CtxItem>
        <CtxSep />
        {canGroup && (
          <CtxItem icon={<GroupIcon />} shortcut="Ctrl+Alt+G" onSelect={groupSelection}>
            Group
          </CtxItem>
        )}
        {canUngroup && (
          <CtxItem icon={<UngroupIcon />} shortcut="Ctrl+Alt+Shift+G" onSelect={ungroupSelection}>
            Ungroup
          </CtxItem>
        )}
        <CtxItem disabled={!editable} onSelect={() => store!.arrange(slide!.id, selection, 'front')}>
          Bring to front
        </CtxItem>
        <CtxItem disabled={!editable} onSelect={() => store!.arrange(slide!.id, selection, 'forward')}>
          Bring forward
        </CtxItem>
        <CtxItem disabled={!editable} onSelect={() => store!.arrange(slide!.id, selection, 'backward')}>
          Send backward
        </CtxItem>
        <CtxItem disabled={!editable} onSelect={() => store!.arrange(slide!.id, selection, 'back')}>
          Send to back
        </CtxItem>
        <CtxSep />
        <CtxItem icon={<Trash2 />} danger shortcut="Del" disabled={!editable} onSelect={deleteSelection}>
          Delete
        </CtxItem>
      </>
    ) : (
      <>
        <CtxItem icon={<Clipboard />} shortcut="Ctrl+V" disabled={!editable} onSelect={() => void paste()}>
          Paste
        </CtxItem>
        <CtxSep />
        <CtxItem icon={<Plus />} shortcut="Ctrl+M" disabled={!editable} onSelect={() => newSlide()}>
          New slide
        </CtxItem>
        <CtxItem icon={<LayoutTemplate />} onSelect={() => setTab('Layout')}>
          Change layout…
        </CtxItem>
        <CtxItem icon={<Shapes />} onSelect={() => setTab('Design')}>
          Format background…
        </CtxItem>
        <CtxItem icon={<MessageSquareText />} onSelect={() => setTab('Comments')}>
          Comment on slide
        </CtxItem>
      </>
    );

  const exportUrl = (f: string, extra = '') => `/api/resources/${r.id}/export?format=${f}${extra}`;

  // ── Render ───────────────────────────────────────────────────────────────
  if (presenting !== null && deck) {
    return <Presenter resourceId={r.id} slides={slides} deck={deck} start={presenting} onExit={(i) => (setPresenting(null), slides[i] && goSlide(slides.filter((s) => !s.meta.hidden)[i]?.id ?? slides[i].id))} />;
  }

  return (
    <div className="flex h-full flex-col bg-canvas" data-testid="slides-workspace">
      <SlideStyles />
      <TitleBar
        ref={titleRef}
        r={r}
        kind="slides"
        members={members?.map((m) => m.principal)}
        online={collab.peers}
        status={collab.error ? 'offline' : collab.status}
        onShare={() => setShare(true)}
        actions={
          <>
            <IconButton label="Present (F5)" onClick={() => present(0)} disabled={!deck?.ready}>
              <Play size={18} />
            </IconButton>
            <IconButton label="Comments" active={tab === 'Comments'} onClick={() => setTab(tab === 'Comments' ? 'Design' : 'Comments')}>
              <MessageSquareText size={18} />
            </IconButton>
            <IconButton label="Version history" active={tab === 'History'} onClick={() => setTab(tab === 'History' ? 'Design' : 'History')}>
              <History size={18} />
            </IconButton>
          </>
        }
      />

      {/* Menu bar */}
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
            <MenuItem icon={<ImageIcon />} onSelect={() => (window.location.href = exportUrl('png', `&slide=${index + 1}`))}>
              Download current slide as PNG
            </MenuItem>
            {r.mimeType && (
              <MenuItem icon={<Download />} onSelect={() => (window.location.href = `/api/resources/${r.id}/download`)}>
                Download original ({r.name.split('.').pop()?.toUpperCase()})
              </MenuItem>
            )}
            <MenuItem icon={<Printer />} onSelect={() => window.open(exportUrl('pdf', '&inline=1'), '_blank')}>
              Print (PDF)
            </MenuItem>
            <MenuItem icon={<Globe />} onSelect={() => setPublishOpen(true)}>
              Publish to web…
            </MenuItem>
            <MenuItem disabled={!editable} onSelect={() => setActivityOpen(true)}>
              Activity dashboard
            </MenuItem>
            <MenuSeparator />
            <MenuItem icon={<History />} onSelect={() => setTab('History')}>
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
            <button className="h-7 rounded-md px-2.5 text-[13px] text-ink-2 hover:bg-hover data-[state=open]:bg-hover">Edit</button>
          </MenuTrigger>
          <MenuContent className="w-60">
            <MenuItem icon={<Undo2 />} shortcut="Ctrl+Z" disabled={!editable} onSelect={() => store?.undo.undo()}>
              Undo
            </MenuItem>
            <MenuItem icon={<Redo2 />} shortcut="Ctrl+Y" disabled={!editable} onSelect={() => store?.undo.redo()}>
              Redo
            </MenuItem>
            <MenuSeparator />
            <MenuItem icon={<Scissors />} shortcut="Ctrl+X" disabled={!editable || !selected.length} onSelect={() => copy(true)}>
              Cut
            </MenuItem>
            <MenuItem icon={<Copy />} shortcut="Ctrl+C" disabled={!selected.length} onSelect={() => copy()}>
              Copy
            </MenuItem>
            <MenuItem icon={<Clipboard />} shortcut="Ctrl+V" disabled={!editable} onSelect={() => void paste()}>
              Paste
            </MenuItem>
            <MenuItem icon={<CopyPlus />} shortcut="Ctrl+D" disabled={!editable} onSelect={duplicate}>
              Duplicate
            </MenuItem>
            <MenuItem icon={<Trash2 />} shortcut="Del" disabled={!editable || !selected.length} onSelect={deleteSelection}>
              Delete
            </MenuItem>
            <MenuSeparator />
            <MenuItem shortcut="Ctrl+A" onSelect={() => slide && setSelection(slide.elements.map((e) => e.id))}>
              Select all
            </MenuItem>
          </MenuContent>
        </Menu>
        <Menu>
          <MenuTrigger asChild>
            <button className="h-7 rounded-md px-2.5 text-[13px] text-ink-2 hover:bg-hover data-[state=open]:bg-hover">View</button>
          </MenuTrigger>
          <MenuContent className="w-60">
            <MenuItem icon={<Presentation />} onSelect={() => setView('normal')}>
              Normal {view === 'normal' && '✓'}
            </MenuItem>
            <MenuItem icon={<Grid2x2 />} onSelect={() => setView('sorter')}>
              Slide sorter {view === 'sorter' && '✓'}
            </MenuItem>
            <MenuItem icon={<StickyNote />} onSelect={() => setNotesOpen((n) => !n)}>
              Speaker notes {notesOpen && '✓'}
            </MenuItem>
            <MenuSeparator />
            <MenuItem icon={<Maximize2 />} onSelect={() => setZoom('fit')}>
              Fit slide to window
            </MenuItem>
            <MenuItem onSelect={() => setZoom(1)}>Zoom 100%</MenuItem>
          </MenuContent>
        </Menu>
        <Menu>
          <MenuTrigger asChild>
            <button className="h-7 rounded-md px-2.5 text-[13px] text-ink-2 hover:bg-hover data-[state=open]:bg-hover">Insert</button>
          </MenuTrigger>
          <MenuContent className="w-60">
            <MenuItem icon={<Plus />} shortcut="Ctrl+M" disabled={!editable} onSelect={() => newSlide()}>
              New slide
            </MenuItem>
            <MenuItem icon={<Type />} disabled={!editable} onSelect={insertText}>
              Text box
            </MenuItem>
            <MenuItem icon={<ImageIcon />} disabled={!editable} onSelect={() => imageInput.current?.click()}>
              Picture…
            </MenuItem>
            <MenuItem icon={<Network />} disabled={!editable} onSelect={() => setDiagramDialog(true)}>
              Diagram…
            </MenuItem>
            <MenuItem icon={<WholeWord />} disabled={!editable} onSelect={insertWordArt}>
              Word art
            </MenuItem>
            <MenuItem icon={<VideoIcon />} disabled={!editable} onSelect={() => setVideoDialog(true)}>
              Video…
            </MenuItem>
            <MenuItem icon={<Music />} disabled={!editable} onSelect={() => audioInput.current?.click()}>
              Audio…
            </MenuItem>
            <MenuItem icon={<Hash />} disabled={!editable} onSelect={() => setTab('Design')}>
              Slide numbers…
            </MenuItem>
            <MenuItem icon={<Table />} disabled={!editable} onSelect={() => insertTable(3, 3)}>
              Table (3 × 3)
            </MenuItem>
            <MenuLabel>Chart</MenuLabel>
            {(['column', 'bar', 'line', 'pie'] as const).map((k) => (
              <MenuItem key={k} icon={<ChartColumn />} disabled={!editable} onSelect={() => insertChart(k)}>
                <span className="capitalize">{k} chart</span>
              </MenuItem>
            ))}
            <MenuLabel>Shape</MenuLabel>
            {SHAPES.slice(0, 6).map((s) => (
              <MenuItem key={s.geom} icon={<Shapes />} disabled={!editable} onSelect={() => insertShape(s.geom)}>
                {s.label}
              </MenuItem>
            ))}
            <MenuLabel>Connector</MenuLabel>
            {(
              [
                ['straight', 'Straight connector'],
                ['elbow', 'Elbow connector'],
                ['curved', 'Curved connector'],
              ] as const
            ).map(([kind, label]) => (
              <MenuItem
                key={kind}
                icon={<Spline />}
                disabled={!editable}
                onSelect={() => insert({ type: 'shape', geom: 'arrow', x: W / 2 - 150, y: H / 2 - 60, w: 300, h: kind === 'straight' ? 0 : 120, style: { stroke: '@text', strokeWidth: 3 }, conn: { kind } })}
              >
                {label}
              </MenuItem>
            ))}
          </MenuContent>
        </Menu>
        <Menu>
          <MenuTrigger asChild>
            <button className="h-7 rounded-md px-2.5 text-[13px] text-ink-2 hover:bg-hover data-[state=open]:bg-hover">Format</button>
          </MenuTrigger>
          <MenuContent className="w-60">
            <MenuItem icon={<Bold />} shortcut="Ctrl+B" disabled={!textEnabled} onSelect={() => fmt.mark('bold')}>
              Bold
            </MenuItem>
            <MenuItem icon={<Italic />} shortcut="Ctrl+I" disabled={!textEnabled} onSelect={() => fmt.mark('italic')}>
              Italic
            </MenuItem>
            <MenuItem icon={<Underline />} shortcut="Ctrl+U" disabled={!textEnabled} onSelect={() => fmt.mark('underline')}>
              Underline
            </MenuItem>
            <MenuItem icon={<Strikethrough />} disabled={!textEnabled} onSelect={() => fmt.mark('strike')}>
              Strikethrough
            </MenuItem>
            <MenuSeparator />
            <MenuItem icon={<Shapes />} disabled={!selected.length} onSelect={() => setTab('Format')}>
              Format options…
            </MenuItem>
            <MenuItem icon={<LayoutTemplate />} onSelect={() => setTab('Design')}>
              Background…
            </MenuItem>
          </MenuContent>
        </Menu>
        <Menu>
          <MenuTrigger asChild>
            <button className="h-7 rounded-md px-2.5 text-[13px] text-ink-2 hover:bg-hover data-[state=open]:bg-hover">Slide</button>
          </MenuTrigger>
          <MenuContent className="w-64">
            <MenuItem icon={<Plus />} shortcut="Ctrl+M" disabled={!editable} onSelect={() => newSlide()}>
              New slide
            </MenuItem>
            <MenuItem icon={<CopyPlus />} disabled={!editable} onSelect={() => slide && store && goSlide(store.duplicateSlides([slide.id])[0])}>
              Duplicate slide
            </MenuItem>
            <MenuItem icon={<Trash2 />} disabled={!editable} onSelect={() => (setFocusArea('rail'), slide && store?.deleteSlides([slide.id]))}>
              Delete slide
            </MenuItem>
            <MenuItem icon={slide?.meta.hidden ? <Eye /> : <EyeOff />} disabled={!editable} onSelect={() => slide && store?.setSlideMeta([slide.id], { hidden: !slide.meta.hidden })}>
              {slide?.meta.hidden ? 'Unhide slide' : 'Hide slide'}
            </MenuItem>
            <MenuSeparator />
            <MenuItem disabled={!editable || index === 0} onSelect={() => slide && store?.moveSlides([slide.id], index - 1)}>
              Move slide up
            </MenuItem>
            <MenuItem disabled={!editable || index >= slides.length - 1} onSelect={() => slide && store?.moveSlides([slide.id], index + 1)}>
              Move slide down
            </MenuItem>
            <MenuSeparator />
            <MenuItem icon={<LayoutTemplate />} onSelect={() => setTab('Layout')}>
              Change layout…
            </MenuItem>
            <MenuItem icon={<Shapes />} onSelect={() => setTab('Theme')}>
              Change theme…
            </MenuItem>
            <MenuItem icon={<Sparkles />} onSelect={() => setTab('Motion')}>
              Transition & animations…
            </MenuItem>
            <MenuItem icon={<Play />} onSelect={() => present(index)}>
              Present from this slide
            </MenuItem>
          </MenuContent>
        </Menu>
        <Menu>
          <MenuTrigger asChild>
            <button className="h-7 rounded-md px-2.5 text-[13px] text-ink-2 hover:bg-hover data-[state=open]:bg-hover">Arrange</button>
          </MenuTrigger>
          <MenuContent className="w-60">
            {(
              [
                ['front', 'Bring to front'],
                ['forward', 'Bring forward'],
                ['backward', 'Send backward'],
                ['back', 'Send to back'],
              ] as const
            ).map(([how, label]) => (
              <MenuItem key={how} disabled={!editable || !selected.length} onSelect={() => store?.arrange(slide!.id, selection, how)}>
                {label}
              </MenuItem>
            ))}
            <MenuSeparator />
            <MenuItem icon={<GroupIcon />} shortcut="Ctrl+Alt+G" disabled={!canGroup} onSelect={groupSelection}>
              Group
            </MenuItem>
            <MenuItem icon={<UngroupIcon />} shortcut="Ctrl+Alt+Shift+G" disabled={!canUngroup} onSelect={ungroupSelection}>
              Ungroup
            </MenuItem>
            <MenuSeparator />
            <MenuLabel>Rotate</MenuLabel>
            <MenuItem icon={<RotateCw />} disabled={!editable || !selected.length} onSelect={() => rotateBy(90)}>
              Rotate clockwise 90°
            </MenuItem>
            <MenuItem icon={<RotateCcw />} disabled={!editable || !selected.length} onSelect={() => rotateBy(-90)}>
              Rotate counter-clockwise 90°
            </MenuItem>
            <MenuItem icon={<FlipHorizontal2 />} disabled={!editable || !selected.length} onSelect={() => flip('flipH')}>
              Flip horizontally
            </MenuItem>
            <MenuItem icon={<FlipVertical2 />} disabled={!editable || !selected.length} onSelect={() => flip('flipV')}>
              Flip vertically
            </MenuItem>
            <MenuSeparator />
            <MenuItem disabled={!selected.length} onSelect={() => setTab('Format')}>
              Align & distribute…
            </MenuItem>
          </MenuContent>
        </Menu>
        <Menu>
          <MenuTrigger asChild>
            <button className="h-7 rounded-md px-2.5 text-[13px] text-ink-2 hover:bg-hover data-[state=open]:bg-hover">Help</button>
          </MenuTrigger>
          <MenuContent className="w-60">
            <MenuItem icon={<Keyboard />} onSelect={() => setShortcuts(true)}>
              Keyboard shortcuts
            </MenuItem>
          </MenuContent>
        </Menu>
        {!editable && collab.session && <span className="ml-3 rounded-md bg-hover px-2 py-0.5 text-[12px] text-muted">View only</span>}
      </div>

      {/* Toolbar */}
      <div className="shrink-0 px-5 pt-2">
        <div className="flex h-11 items-center gap-0.5 overflow-x-auto rounded-xl border border-line bg-surface px-2" data-testid="slides-toolbar">
          <Btn label="Undo (Ctrl+Z)" disabled={!editable} onClick={() => store?.undo.undo()} icon={<Undo2 size={17} />} />
          <Btn label="Redo (Ctrl+Y)" disabled={!editable} onClick={() => store?.undo.redo()} icon={<Redo2 size={17} />} />
          <Sep />
          <DM.Root>
            <Tip label="New slide (Ctrl+M)">
              <div className="flex">
                <button onClick={() => newSlide()} disabled={!editable} className="flex h-8 items-center rounded-l-md pl-1.5 pr-0.5 text-ink-2 hover:bg-hover disabled:opacity-40" aria-label="New slide">
                  <Presentation size={17} />
                  <Plus size={11} className="-ml-1 mt-2" />
                </button>
                <DM.Trigger asChild>
                  <button disabled={!editable} className="flex h-8 items-center rounded-r-md px-0.5 text-subtle hover:bg-hover disabled:opacity-40" aria-label="New slide with layout">
                    <ChevronDown size={13} />
                  </button>
                </DM.Trigger>
              </div>
            </Tip>
            <DM.Portal>
              <DM.Content sideOffset={4} align="start" className="pop z-50 grid w-[340px] animate-pop grid-cols-3 gap-2 p-2.5">
                {LAYOUTS.map((l) => (
                  <DM.Item key={l.id} onSelect={() => newSlide(l.id)} className="cursor-pointer rounded-lg p-1 outline-none data-[highlighted]:bg-hover">
                    <LayoutWire layout={l.id} />
                    <div className="mt-1 text-center text-[11px] text-ink-2">{l.label}</div>
                  </DM.Item>
                ))}
              </DM.Content>
            </DM.Portal>
          </DM.Root>
          <DM.Root>
            <Tip label="Present (F5)">
              <div className="flex">
                <button onClick={() => present(0)} className="flex h-8 items-center rounded-l-md px-1.5 text-ink-2 hover:bg-hover" aria-label="Present">
                  <Play size={17} />
                </button>
                <DM.Trigger asChild>
                  <button className="flex h-8 items-center rounded-r-md px-0.5 text-subtle hover:bg-hover" aria-label="Present options">
                    <ChevronDown size={13} />
                  </button>
                </DM.Trigger>
              </div>
            </Tip>
            <DM.Portal>
              <DM.Content sideOffset={4} align="start" className="pop z-50 w-60 animate-pop">
                <DM.Item className="menu-item" onSelect={() => present(0)}>
                  <Play size={14} /> From beginning <span className="ml-auto text-[11px] text-subtle">F5</span>
                </DM.Item>
                <DM.Item className="menu-item" onSelect={() => present(index)}>
                  <Play size={14} /> From current slide <span className="ml-auto text-[11px] text-subtle">Shift+F5</span>
                </DM.Item>
                <DM.Item
                  className="menu-item"
                  onSelect={() => {
                    present(index);
                    setTimeout(() => window.open(`/present/${r.id}`, 'mo-presenter', 'width=1200,height=760'), 300);
                  }}
                >
                  <MonitorPlay size={14} /> Presenter view
                </DM.Item>
              </DM.Content>
            </DM.Portal>
          </DM.Root>
          <Sep />
          <select
            aria-label="Font"
            disabled={!textEnabled}
            value={FONTS.includes(curFont) ? curFont : ''}
            onChange={(e) => fmt.family(e.target.value)}
            onMouseDown={(e) => editing && e.stopPropagation()}
            className="h-8 w-[118px] rounded-md bg-transparent px-1.5 text-[13px] text-ink-2 outline-none hover:bg-hover disabled:opacity-40"
          >
            {!FONTS.includes(curFont) && <option value="">{curFont}</option>}
            {FONTS.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
          <select aria-label="Font size" disabled={!textEnabled} value={SIZES.includes(curSize) ? String(curSize) : ''} onChange={(e) => fmt.size(Number(e.target.value))} className="h-8 w-[62px] rounded-md bg-transparent px-1.5 text-[13px] text-ink-2 outline-none hover:bg-hover disabled:opacity-40">
            {!SIZES.includes(curSize) && <option value="">{curSize}</option>}
            {SIZES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <Btn label="Decrease font size" disabled={!textEnabled} onClick={() => fmt.size(SIZES.filter((s) => s < curSize).pop() ?? curSize)} icon={<Minus size={14} />} />
          <Btn label="Increase font size" disabled={!textEnabled} onClick={() => fmt.size(SIZES.find((s) => s > curSize) ?? curSize)} icon={<Plus size={14} />} />
          <Sep />
          <Btn label="Bold (Ctrl+B)" disabled={!textEnabled} active={isOn('bold')} onClick={() => fmt.mark('bold')} icon={<Bold size={17} />} />
          <Btn label="Italic (Ctrl+I)" disabled={!textEnabled} active={isOn('italic')} onClick={() => fmt.mark('italic')} icon={<Italic size={17} />} />
          <Btn label="Underline (Ctrl+U)" disabled={!textEnabled} active={isOn('underline')} onClick={() => fmt.mark('underline')} icon={<Underline size={17} />} />
          {deck && (
            <ColorPicker label="Text colour" value={ts?.color ?? firstText?.style?.color ?? null} theme={deck.theme} allowNone onChange={(c) => fmt.color(c)}>
              <button disabled={!textEnabled} onMouseDown={(e) => e.preventDefault()} className="flex size-8 flex-col items-center justify-center rounded-md text-ink-2 hover:bg-hover disabled:opacity-40" aria-label="Text colour">
                <Type size={15} />
                <span className="mt-0.5 h-1 w-4 rounded-sm" style={{ background: (ts?.color ?? firstText?.style?.color)?.startsWith('@') ? deck.theme.colors.accents[0] : ts?.color ?? firstText?.style?.color ?? '#0F172A' }} />
              </button>
            </ColorPicker>
          )}
          <DM.Root>
            <Tip label="Highlight">
              <DM.Trigger asChild>
                <button disabled={!textEnabled} onMouseDown={(e) => e.preventDefault()} className="flex size-8 items-center justify-center rounded-md text-ink-2 hover:bg-hover disabled:opacity-40" aria-label="Highlight">
                  <Highlighter size={16} />
                </button>
              </DM.Trigger>
            </Tip>
            <DM.Portal>
              <DM.Content sideOffset={4} className="pop z-50 grid w-[176px] animate-pop grid-cols-5 gap-1.5 p-2" onCloseAutoFocus={(e) => e.preventDefault()}>
                {['#FEF08A', '#BBF7D0', '#BFDBFE', '#FBCFE8', '#FED7AA'].map((c) => (
                  <DM.Item key={c} onSelect={() => fmt.highlight(c)} className="size-7 cursor-pointer rounded-md border border-black/5 outline-none data-[highlighted]:ring-2 data-[highlighted]:ring-brand-600" style={{ background: c }} aria-label={c} />
                ))}
                <DM.Item onSelect={() => fmt.highlight(null)} className="menu-item col-span-5">
                  No highlight
                </DM.Item>
              </DM.Content>
            </DM.Portal>
          </DM.Root>
          <Sep />
          <Btn label="Bulleted list" disabled={!textEnabled} active={!!editing && !!editor?.isActive('bulletList')} onClick={() => fmt.list('bullet')} icon={<List size={17} />} />
          <Btn label="Numbered list" disabled={!textEnabled} active={!!editing && !!editor?.isActive('orderedList')} onClick={() => fmt.list('ordered')} icon={<ListOrdered size={17} />} />
          <DM.Root>
            <Tip label="Align">
              <DM.Trigger asChild>
                <button disabled={!textEnabled} onMouseDown={(e) => e.preventDefault()} className="flex h-8 items-center gap-0.5 rounded-md px-1.5 text-ink-2 hover:bg-hover disabled:opacity-40" aria-label="Align">
                  <AlignLeft size={17} />
                  <ChevronDown size={12} className="text-subtle" />
                </button>
              </DM.Trigger>
            </Tip>
            <DM.Portal>
              <DM.Content sideOffset={4} className="pop z-50 flex animate-pop gap-0.5 p-1" onCloseAutoFocus={(e) => e.preventDefault()}>
                {(
                  [
                    ['left', <AlignLeft key="l" size={16} />],
                    ['center', <AlignCenter key="c" size={16} />],
                    ['right', <AlignRight key="r" size={16} />],
                    ['justify', <AlignJustify key="j" size={16} />],
                  ] as const
                ).map(([a, icon]) => (
                  <DM.Item key={a} onSelect={() => fmt.align(a)} className="flex size-8 cursor-pointer items-center justify-center rounded-md outline-none data-[highlighted]:bg-hover" aria-label={`Align ${a}`}>
                    {icon}
                  </DM.Item>
                ))}
              </DM.Content>
            </DM.Portal>
          </DM.Root>
          <Sep />
          <ToolText label="Text box" icon={<Type size={16} />} disabled={!editable} onClick={insertText} />
          <DM.Root>
            <DM.Trigger asChild>
              <button disabled={!editable} className="flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2 text-[13px] text-ink-2 hover:bg-hover disabled:opacity-40" aria-label="Shape">
                <Shapes size={16} /> Shape
              </button>
            </DM.Trigger>
            <DM.Portal>
              <DM.Content sideOffset={4} className="pop z-50 max-h-[70vh] w-[300px] animate-pop overflow-y-auto p-2">
                {(
                  [
                    ['Shapes', [...SHAPES.filter((s) => !isLine(s.geom)), ...EXTRA_SHAPES.filter((s) => s.group === 'Shapes')]],
                    ['Arrows', EXTRA_SHAPES.filter((s) => s.group === 'Arrows')],
                    ['Callouts', EXTRA_SHAPES.filter((s) => s.group === 'Callouts')],
                    ['Equation', EXTRA_SHAPES.filter((s) => s.group === 'Equation')],
                  ] as const
                ).map(([title, list]) => (
                  <div key={title}>
                    <div className="px-1 pb-0.5 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-subtle">{title}</div>
                    <div className="grid grid-cols-5 gap-1">
                      {list.map((s) => (
                        <DM.Item key={s.geom} onSelect={() => insertShape(s.geom as Geometry)} className="flex h-11 cursor-pointer flex-col items-center justify-center gap-0.5 rounded-md text-[9.5px] text-muted outline-none data-[highlighted]:bg-hover" aria-label={s.label} title={s.label}>
                          <ShapeIcon geom={s.geom as Geometry} />
                          <span className="max-w-full truncate">{s.label}</span>
                        </DM.Item>
                      ))}
                    </div>
                  </div>
                ))}
              </DM.Content>
            </DM.Portal>
          </DM.Root>
          <DM.Root>
            <DM.Trigger asChild>
              <button disabled={!editable} className={cn('flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2 text-[13px] text-ink-2 hover:bg-hover disabled:opacity-40', drawTool && 'bg-selected text-brand-700')} aria-label="Line">
                <PenLine size={16} /> Line
              </button>
            </DM.Trigger>
            <DM.Portal>
              <DM.Content sideOffset={4} className="pop z-50 w-52 animate-pop p-1">
                {(
                  [
                    ['line', 'Line', null],
                    ['arrow', 'Arrow', null],
                    [null, 'Curve', 'curve'],
                    [null, 'Polyline', 'polyline'],
                    [null, 'Scribble', 'scribble'],
                  ] as const
                ).map(([geom, label, tool]) => (
                  <DM.Item
                    key={label}
                    onSelect={() => (geom ? insertShape(geom) : (setSelection([]), setEditing(null), setDrawTool(tool)))}
                    className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[13px] outline-none data-[highlighted]:bg-hover"
                  >
                    {label}
                  </DM.Item>
                ))}
              </DM.Content>
            </DM.Portal>
          </DM.Root>
          <ToolText label="Image" icon={<ImageIcon size={16} />} disabled={!editable} onClick={() => imageInput.current?.click()} />
          <DM.Root>
            <DM.Trigger asChild>
              <button disabled={!editable} className="flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2 text-[13px] text-ink-2 hover:bg-hover disabled:opacity-40" aria-label="Chart">
                <ChartColumn size={16} /> Chart
              </button>
            </DM.Trigger>
            <DM.Portal>
              <DM.Content sideOffset={4} className="pop z-50 w-48 animate-pop">
                {(['column', 'bar', 'line', 'area', 'pie', 'doughnut'] as const).map((k) => (
                  <DM.Item key={k} className="menu-item capitalize" onSelect={() => insertChart(k)}>
                    <ChartColumn size={14} /> {k}
                  </DM.Item>
                ))}
              </DM.Content>
            </DM.Portal>
          </DM.Root>
          <TablePicker disabled={!editable} onPick={insertTable} />
        </div>
      </div>
      <input
        ref={imageInput}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = '';
          void insertImages(files);
        }}
      />

      <input
        ref={audioInput}
        type="file"
        accept="audio/*"
        hidden
        data-testid="audio-input"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) void insertMedia('audio', f);
        }}
      />
      {deck && <DiagramDialog open={diagramDialog} onOpenChange={setDiagramDialog} deck={deck} onInsert={insertDiagram} />}
      <VideoDialog open={videoDialog} onOpenChange={setVideoDialog} onLink={(u) => void insertMedia('video', u)} onFile={(f) => void insertMedia('video', f)} />

      <ImportBanner report={report} canEdit={editable} onRetry={() => versions.reimport.mutate()} retrying={versions.reimport.isPending} downloadHref={`/api/resources/${r.id}/download`} />

      {/* Body */}
      <div className="flex min-h-0 flex-1 gap-3 px-5 pb-0 pt-2">
        {collab.error ? (
          <div className="flex-1 rounded-xl border border-line bg-surface">
            <EmptyState icon={<AlertTriangle size={30} />} title="Can’t open this presentation">
              {collab.error}
            </EmptyState>
          </div>
        ) : !deck?.ready || !slide || !store ? (
          <div className="flex flex-1 gap-4">
            <div className="w-44 space-y-3">
              <Skeleton className="aspect-video" />
              <Skeleton className="aspect-video" />
            </div>
            <Skeleton className="flex-1" />
          </div>
        ) : view === 'sorter' ? (
          <Sorter store={store} deck={deck} selected={slideSel} setSelected={setSlideSel} current={slide.id} editable={editable} onOpen={(id) => (goSlide(id), setView('normal'))} comments={slideCommentCount} />
        ) : (
          <>
            <SlideRail
              store={store}
              deck={deck}
              current={slide.id}
              selected={slideSel}
              setSelected={setSlideSel}
              onGo={goSlide}
              editable={editable}
              onFocus={() => setFocusArea('rail')}
              comments={slideCommentCount}
              peers={peersBySlide}
              onNew={() => newSlide()}
              onPresent={(i) => present(i)}
            />
            <div
              className="relative flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-line bg-[#eef1f6]"
              onPointerDownCapture={() => setFocusArea('canvas')}
              onDragOver={(e) => editable && e.dataTransfer.types.includes('Files') && e.preventDefault()}
              onDrop={(e) => {
                const files = [...e.dataTransfer.files].filter((f) => f.type.startsWith('image/'));
                if (!files.length || !editable) return;
                e.preventDefault();
                void insertImages(files);
              }}
            >
              <SlideCanvas
                store={store}
                slide={slide}
                deck={deck}
                zoom={zoom}
                selection={selection}
                setSelection={(ids) => {
                  setSelection(ids);
                  if (editing && !ids.includes(editing)) setEditing(null);
                }}
                editing={editing}
                setEditing={(id) => setEditing(id)}
                editable={editable}
                remote={remote}
                comments={elementComments}
                onEditorReady={setEditor}
                onOpenFormat={() => setTab('Format')}
                onComment={(elId) => {
                  const t = openThreads.find((x) => anchorOf(x)?.el === elId);
                  setTab('Comments');
                  if (t) setActiveThread(t.id);
                }}
                onTableCell={setTableCell}
                contextMenu={contextMenu}
                onFitScale={setScale}
                selectAllOnEdit={selectAllOnEdit}
                draw={drawTool}
                onDrawn={onDrawn}
                onDrawCancel={() => setDrawTool(null)}
              />
              {previewing && <VersionPreview resourceId={r.id} versionId={previewing} canEdit={editable} onClose={() => setPreviewing(null)} />}
              {notesOpen && <NotesEditor key={slide.id} store={store} slideId={slide.id} editable={editable} />}
            </div>
          </>
        )}

        {tab && deck?.ready && slide && store && (
          <aside className="flex w-[320px] shrink-0 flex-col rounded-xl border border-line bg-surface" data-testid="slides-panel">
            <div className="flex items-center gap-4 overflow-x-auto border-b border-line px-4">
              {(['Design', 'Layout', 'Theme', 'Format', 'Motion', 'Comments'] as const).map((t) => (
                <button key={t} className="tab shrink-0" aria-current={tab === t ? 'page' : undefined} onClick={() => setTab(t)}>
                  {t}
                  {t === 'Comments' && openThreads.length > 0 && <span className="ml-1 rounded-full bg-amber-100 px-1.5 text-[10px] font-semibold text-amber-700">{openThreads.length}</span>}
                </button>
              ))}
              {tab === 'History' && (
                <span className="tab shrink-0" aria-current="page">
                  History
                </span>
              )}
              <button onClick={() => (setTab(null), setPreviewing(null))} className="ml-auto rounded p-1 text-muted hover:bg-hover" aria-label="Close panel">
                <X size={15} />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {tab === 'Design' && <DesignTab store={store} deck={deck} slide={slide} editable={editable} onUploadImage={upload} />}
              {tab === 'Layout' && <LayoutTab store={store} slide={slide} editable={editable} onNewSlide={newSlide} />}
              {tab === 'Theme' && <ThemeTab store={store} deck={deck} editable={editable} />}
              {tab === 'Format' && (
                <FormatTab
                  store={store}
                  deck={deck}
                  slide={slide}
                  selected={selected}
                  editable={editable}
                  tableCell={tableCell}
                  onReplaceImage={(id) => {
                    replaceTarget.current = id;
                    imageInput.current?.click();
                  }}
                />
              )}
              {tab === 'Motion' && <MotionPanel store={store} deck={deck} slide={slide} selected={selected} editable={editable} onSelect={setSelection} />}
              {tab === 'Comments' && (
                <SlideComments
                  resourceId={r.id}
                  threads={threads}
                  me={me?.user}
                  role={collab.session?.role ?? r.myRole}
                  target={commentTarget}
                  targetLabel={targetLabel}
                  active={activeThread}
                  setActive={setActiveThread}
                  slideNumber={(id) => slides.findIndex((s) => s.id === id) + 1}
                  onGo={(a) => {
                    goSlide(a.slide);
                    if (a.el) setSelection([a.el]);
                  }}
                  onChanged={() => collab.broadcast({ type: 'comments' })}
                />
              )}
              {tab === 'History' && <HistoryPanel resourceId={r.id} canEdit={editable} previewing={previewing} onPreview={setPreviewing} />}
            </div>
          </aside>
        )}
      </div>

      {/* Status bar */}
      <div className="flex h-10 shrink-0 items-center gap-3 px-5 text-[12px] text-muted" data-testid="slides-status">
        <span data-testid="slide-counter">
          Slide {slides.length ? index + 1 : 0} of {slides.length}
        </span>
        <span className="h-4 w-px bg-line" />
        <span>English (US)</span>
        {remote.length > 0 && (
          <>
            <span className="h-4 w-px bg-line" />
            <span>{remote.length === 1 ? `${remote[0].name} is editing` : `${remote.length} people editing`}</span>
          </>
        )}
        <div className="ml-auto flex items-center gap-1">
          <StatusBtn label="Speaker notes" active={notesOpen} onClick={() => setNotesOpen((n) => !n)}>
            <StickyNote size={16} />
          </StatusBtn>
          <StatusBtn label="Normal view" active={view === 'normal'} onClick={() => setView('normal')}>
            <Presentation size={16} />
          </StatusBtn>
          <StatusBtn label="Slide sorter" active={view === 'sorter'} onClick={() => setView('sorter')}>
            <Grid2x2 size={16} />
          </StatusBtn>
          <StatusBtn label="Slide show" onClick={() => present(index)}>
            <MonitorPlay size={16} />
          </StatusBtn>
          <span className="mx-1 h-4 w-px bg-line" />
          <StatusBtn label="Zoom out" onClick={() => setZoom(Math.max(0.1, Math.round((scale - 0.1) * 10) / 10))}>
            <Minus size={15} />
          </StatusBtn>
          <button onClick={() => setZoom('fit')} className="w-12 rounded px-1 py-0.5 text-center tabular-nums hover:bg-hover" data-testid="zoom-level" title="Fit to window">
            {Math.round(scale * 100)}%
          </button>
          <StatusBtn label="Zoom in" onClick={() => setZoom(Math.min(4, Math.round((scale + 0.1) * 10) / 10))}>
            <Plus size={15} />
          </StatusBtn>
          <StatusBtn label="Fit slide to window" active={zoom === 'fit'} onClick={() => setZoom('fit')}>
            <Maximize2 size={15} />
          </StatusBtn>
          <StatusBtn label="Keyboard shortcuts" onClick={() => setShortcuts(true)}>
            <Keyboard size={15} />
          </StatusBtn>
        </div>
      </div>

      <ShareDialog resource={share ? r : null} onClose={() => setShare(false)} />
      <PublishDialog r={r} open={publishOpen} canEdit={editable} onClose={() => setPublishOpen(false)} />
      <ActivityDashboard r={r} open={activityOpen} onClose={() => setActivityOpen(false)} />
      <Dialog open={shortcuts} onOpenChange={setShortcuts} title="Keyboard shortcuts" width={520}>
        <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-[13px]">
          {[
            ['Present from start / current', 'F5 / Shift+F5'],
            ['New slide', 'Ctrl+M'],
            ['Duplicate', 'Ctrl+D'],
            ['Copy / cut / paste', 'Ctrl+C / X / V'],
            ['Undo / redo', 'Ctrl+Z / Ctrl+Y'],
            ['Select all objects', 'Ctrl+A'],
            ['Edit selected text', 'Enter'],
            ['Stop editing / deselect', 'Esc'],
            ['Nudge (10 px with Shift)', 'Arrow keys'],
            ['Delete', 'Del'],
            ['Bold / italic / underline', 'Ctrl+B / I / U'],
            ['Previous / next slide', 'Page Up / Down'],
            ['Keep proportions / straight lines', 'Shift + drag'],
            ['Move without snapping', 'Alt + drag'],
            ['In show: black screen / laser', 'B / L'],
          ].map(([a, b]) => (
            <div key={a} className="contents">
              <span className="text-ink-2">{a}</span>
              <kbd className="justify-self-end rounded bg-hover px-1.5 font-mono text-[12px] text-ink">{b}</kbd>
            </div>
          ))}
        </div>
      </Dialog>
    </div>
  );
}

// ── Toolbar bits ─────────────────────────────────────────────────────────────

function Btn({ label, icon, active, disabled, onClick }: { label: string; icon: ReactNode; active?: boolean; disabled?: boolean; onClick: () => void }) {
  return (
    <Tip label={label}>
      <button
        type="button"
        aria-label={label}
        aria-pressed={active}
        disabled={disabled}
        onMouseDown={(e) => e.preventDefault()}
        onClick={onClick}
        className={cn('flex size-8 shrink-0 items-center justify-center rounded-md text-ink-2 hover:bg-hover disabled:opacity-35 disabled:hover:bg-transparent', active && 'bg-selected text-brand-600 hover:bg-selected')}
      >
        {icon}
      </button>
    </Tip>
  );
}
const Sep = () => <span className="mx-1 h-5 w-px shrink-0 bg-line" />;
function ToolText({ label, icon, onClick, disabled }: { label: string; icon: ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" disabled={disabled} onClick={onClick} className="flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2 text-[13px] text-ink-2 hover:bg-hover disabled:opacity-40" aria-label={label}>
      {icon} {label === 'Text box' ? 'Text' : label}
    </button>
  );
}
function StatusBtn({ label, onClick, active, children }: { label: string; onClick: () => void; active?: boolean; children: ReactNode }) {
  return (
    <Tip label={label} side="top">
      <button onClick={onClick} aria-label={label} className={cn('flex size-7 items-center justify-center rounded-md hover:bg-hover', active && 'bg-selected text-brand-600')}>
        {children}
      </button>
    </Tip>
  );
}

function ShapeIcon({ geom }: { geom: Geometry }) {
  return (
    <svg width={26} height={20} viewBox="0 0 26 20" className="text-ink-2">
      {geom === 'line' || geom === 'arrow' ? (
        <>
          <line x1={3} y1={17} x2={23} y2={3} stroke="currentColor" strokeWidth={1.6} />
          {geom === 'arrow' && <path d="M23,3 L17,4 L21,8 Z" fill="currentColor" />}
        </>
      ) : (
        <path d={SHAPE_ICON_PATHS[geom] ?? `${shapePath(geom, 22, 16)}`} transform={SHAPE_ICON_PATHS[geom] ? undefined : 'translate(2 2)'} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" />
      )}
    </svg>
  );
}
// Pre-computed with shapePath(geom, 22, 16) offset by (2, 2).
const SHAPE_ICON_PATHS: Partial<Record<Geometry, string>> = {
  rect: 'M2,2 H24 V18 H2 Z',
  roundRect: 'M6,2 H20 A4,4 0 0 1 24,6 V14 A4,4 0 0 1 20,18 H6 A4,4 0 0 1 2,14 V6 A4,4 0 0 1 6,2 Z',
  ellipse: 'M2,10 A11,8 0 1 0 24,10 A11,8 0 1 0 2,10 Z',
  triangle: 'M13,2 L24,18 L2,18 Z',
  rtTriangle: 'M2,2 L24,18 L2,18 Z',
  diamond: 'M13,2 L24,10 L13,18 L2,10 Z',
  pentagon: 'M13,2 L24,8 L20,18 L6,18 L2,8 Z',
  hexagon: 'M7.5,2 L18.5,2 L24,10 L18.5,18 L7.5,18 L2,10 Z',
  parallelogram: 'M7.5,2 L24,2 L18.5,18 L2,18 Z',
  trapezoid: 'M6.4,2 L19.6,2 L24,18 L2,18 Z',
  rightArrow: 'M2,6 L15,6 L15,2 L24,10 L15,18 L15,14 L2,14 Z',
  leftArrow: 'M24,6 L11,6 L11,2 L2,10 L11,18 L11,14 L24,14 Z',
  chevron: 'M2,2 L18.5,2 L24,10 L18.5,18 L2,18 L7.5,10 Z',
  star5: 'M13,2 L15.6,7.6 L21.5,8.4 L17.2,12.4 L18.3,18 L13,15.2 L7.7,18 L8.8,12.4 L4.5,8.4 L10.4,7.6 Z',
};

function TablePicker({ onPick, disabled }: { onPick: (rows: number, cols: number) => void; disabled?: boolean }) {
  const [hover, setHover] = useState({ r: 3, c: 3 });
  return (
    <DM.Root>
      <DM.Trigger asChild>
        <button disabled={disabled} className="flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2 text-[13px] text-ink-2 hover:bg-hover disabled:opacity-40" aria-label="Table">
          <Table size={16} /> Table
        </button>
      </DM.Trigger>
      <DM.Portal>
        <DM.Content sideOffset={4} className="pop z-50 animate-pop p-2.5">
          <div className="mb-1.5 text-[12px] text-muted">
            {hover.r} × {hover.c} table
          </div>
          <div className="grid grid-cols-8 gap-0.5" onMouseLeave={() => setHover({ r: 3, c: 3 })}>
            {Array.from({ length: 64 }, (_, i) => {
              const r = Math.floor(i / 8) + 1;
              const c = (i % 8) + 1;
              return (
                <DM.Item
                  key={i}
                  onMouseEnter={() => setHover({ r, c })}
                  onSelect={() => onPick(r, c)}
                  className={cn('size-4 cursor-pointer rounded-[2px] border outline-none', r <= hover.r && c <= hover.c ? 'border-brand-600 bg-brand-100' : 'border-line')}
                  aria-label={`${r} by ${c}`}
                />
              );
            })}
          </div>
        </DM.Content>
      </DM.Portal>
    </DM.Root>
  );
}

// ── Slide rail (thumbnails) ──────────────────────────────────────────────────

function SlideRail({
  store,
  deck,
  current,
  selected,
  setSelected,
  onGo,
  editable,
  onFocus,
  comments,
  peers,
  onNew,
  onPresent,
}: {
  store: DeckStore;
  deck: DeckSnapshot;
  current: string;
  selected: string[];
  setSelected: (ids: string[]) => void;
  onGo: (id: string) => void;
  editable: boolean;
  onFocus: () => void;
  comments: Map<string, number>;
  peers: Map<string, RemoteSelection[]>;
  onNew: () => void;
  onPresent: (i: number) => void;
}) {
  const [dropAt, setDropAt] = useState<number | null>(null);
  const dragging = useRef<string[] | null>(null);
  const railRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    railRef.current?.querySelector(`[data-slide="${current}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [current]);
  const sel = selected.includes(current) ? selected : [current];
  return (
    <div className="flex w-[196px] shrink-0 flex-col" onPointerDownCapture={onFocus}>
      <div ref={railRef} className="min-h-0 flex-1 space-y-1 overflow-y-auto pb-2 pr-1" data-testid="slide-rail" onDragLeave={(e) => e.currentTarget === e.target && setDropAt(null)}>
        {deck.slides.map((s, i) => (
          <CMenu
            key={s.id}
            items={(Item, SepC) => (
              <>
                <Item onSelect={onNew} disabled={!editable}>
                  New slide
                </Item>
                <Item onSelect={() => onGo(store.duplicateSlides(sel)[0])} disabled={!editable}>
                  Duplicate slide
                </Item>
                <Item onSelect={() => store.deleteSlides(sel)} disabled={!editable} danger>
                  Delete slide{sel.length > 1 ? 's' : ''}
                </Item>
                <SepC />
                <Item onSelect={() => store.setSlideMeta(sel, { hidden: !s.meta.hidden })} disabled={!editable}>
                  {s.meta.hidden ? 'Unhide slide' : 'Hide slide'}
                </Item>
                <Item onSelect={() => onPresent(i)}>Present from here</Item>
              </>
            )}
          >
            <div
              data-slide={s.id}
              data-testid="slide-thumb"
              draggable={editable}
              onDragStart={(e) => {
                dragging.current = selected.includes(s.id) ? selected : [s.id];
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/x-mo-slide', s.id);
              }}
              onDragOver={(e) => {
                if (!dragging.current) return;
                e.preventDefault();
                const r = e.currentTarget.getBoundingClientRect();
                setDropAt(e.clientY < r.top + r.height / 2 ? i : i + 1);
              }}
              onDrop={(e) => {
                e.preventDefault();
                const ids = dragging.current;
                dragging.current = null;
                if (!ids || dropAt === null) return setDropAt(null);
                const before = deck.slides.slice(0, dropAt).filter((x) => ids.includes(x.id)).length;
                store.moveSlides(ids, dropAt - before);
                setDropAt(null);
              }}
              onDragEnd={() => ((dragging.current = null), setDropAt(null))}
              onClick={(e) => {
                if (e.shiftKey) {
                  const a = deck.slides.findIndex((x) => x.id === current);
                  setSelected(deck.slides.slice(Math.min(a, i), Math.max(a, i) + 1).map((x) => x.id));
                } else if (e.ctrlKey || e.metaKey) setSelected(selected.includes(s.id) ? selected.filter((x) => x !== s.id) : [...selected, s.id]);
                else onGo(s.id);
              }}
              onDoubleClick={() => onPresent(i)}
              className="relative flex cursor-pointer gap-2 py-1"
            >
              {dropAt === i && <div className="absolute -top-0.5 left-5 right-0 h-0.5 rounded bg-brand-600" />}
              {dropAt === i + 1 && i === deck.slides.length - 1 && <div className="absolute -bottom-0.5 left-5 right-0 h-0.5 rounded bg-brand-600" />}
              <div className="flex w-4 shrink-0 flex-col items-end gap-1 pt-0.5 text-[12px] text-muted">
                <span className={cn(s.id === current && 'font-semibold text-ink')}>{i + 1}</span>
                {s.meta.hidden && <EyeOff size={11} className="text-subtle" />}
                {(comments.get(s.id) ?? 0) > 0 && <MessageSquareText size={11} className="text-amber-500" />}
              </div>
              <div className={cn('relative overflow-hidden rounded-lg border-2 bg-white', s.id === current ? 'border-brand-600' : selected.includes(s.id) ? 'border-brand-300' : 'border-transparent ring-1 ring-line hover:ring-line-strong', s.meta.hidden && 'opacity-50')}>
                <SlideView slide={s} deck={deck} width={160} />
                {(peers.get(s.id) ?? []).length > 0 && (
                  <div className="absolute bottom-1 right-1 flex -space-x-1">
                    {peers.get(s.id)!.slice(0, 3).map((p) => (
                      <span key={p.clientId} title={p.name} className="size-3.5 rounded-full border border-white" style={{ background: p.color }} />
                    ))}
                  </div>
                )}
              </div>
            </div>
          </CMenu>
        ))}
      </div>
      <button disabled={!editable} onClick={onNew} className="mb-2 ml-6 mt-1 flex h-10 items-center justify-center gap-2 rounded-xl border border-line bg-surface text-[13px] font-medium text-ink-2 shadow-sm hover:bg-hover disabled:opacity-50" data-testid="new-slide">
        <Plus size={16} /> New Slide
      </button>
    </div>
  );
}

type ItemC = (p: { onSelect: () => void; disabled?: boolean; danger?: boolean; children: ReactNode }) => ReactNode;
function CMenu({ children, items }: { children: ReactNode; items: (Item: ItemC, Sep: () => ReactNode) => ReactNode }) {
  const Item: ItemC = ({ onSelect, disabled, danger, children: c }) => (
    <CM.Item onSelect={onSelect} disabled={disabled} className={cn('menu-item', danger && 'text-red-600')}>
      {c}
    </CM.Item>
  );
  return (
    <CM.Root>
      <CM.Trigger asChild>{children}</CM.Trigger>
      <CM.Portal>
        <CM.Content className="pop z-50 min-w-48 animate-pop">{items(Item, () => <CM.Separator className="my-1 h-px bg-line" />)}</CM.Content>
      </CM.Portal>
    </CM.Root>
  );
}

// ── Slide sorter ─────────────────────────────────────────────────────────────

function Sorter({ store, deck, selected, setSelected, current, editable, onOpen, comments }: { store: DeckStore; deck: DeckSnapshot; selected: string[]; setSelected: (ids: string[]) => void; current: string; editable: boolean; onOpen: (id: string) => void; comments: Map<string, number> }) {
  const [dropAt, setDropAt] = useState<number | null>(null);
  const dragging = useRef<string[] | null>(null);
  return (
    <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-line bg-surface p-6" data-testid="slide-sorter">
      <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-6">
        {deck.slides.map((s, i) => (
          <div
            key={s.id}
            draggable={editable}
            onDragStart={() => (dragging.current = selected.includes(s.id) ? selected : [s.id])}
            onDragOver={(e) => {
              if (!dragging.current) return;
              e.preventDefault();
              const r = e.currentTarget.getBoundingClientRect();
              setDropAt(e.clientX < r.left + r.width / 2 ? i : i + 1);
            }}
            onDrop={(e) => {
              e.preventDefault();
              const ids = dragging.current;
              dragging.current = null;
              if (ids && dropAt !== null) store.moveSlides(ids, dropAt - deck.slides.slice(0, dropAt).filter((x) => ids.includes(x.id)).length);
              setDropAt(null);
            }}
            onClick={(e) => (e.ctrlKey || e.metaKey ? setSelected(selected.includes(s.id) ? selected.filter((x) => x !== s.id) : [...selected, s.id]) : setSelected([s.id]))}
            onDoubleClick={() => onOpen(s.id)}
            className="relative cursor-pointer"
          >
            {dropAt === i && <div className="absolute -left-3.5 top-0 h-full w-1 rounded bg-brand-600" />}
            {dropAt === i + 1 && <div className="absolute -right-3.5 top-0 h-full w-1 rounded bg-brand-600" />}
            <div className={cn('overflow-hidden rounded-lg border-2', selected.includes(s.id) || (!selected.length && s.id === current) ? 'border-brand-600' : 'border-line', s.meta.hidden && 'opacity-50')}>
              <SlideView slide={s} deck={deck} width={236} />
            </div>
            <div className="mt-1.5 flex items-center gap-1.5 text-[12px] text-muted">
              <b className="text-ink-2">{i + 1}</b>
              <span className="truncate">{slideTitle(s) || 'Untitled'}</span>
              {s.meta.hidden && <EyeOff size={12} />}
              {(comments.get(s.id) ?? 0) > 0 && <MessageSquareText size={12} className="text-amber-500" />}
              {s.meta.transition && s.meta.transition !== 'none' && <span className="ml-auto rounded bg-hover px-1 text-[10px] uppercase">{s.meta.transition}</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Speaker notes (Y.Text ⇄ textarea) ────────────────────────────────────────

function NotesEditor({ store, slideId, editable }: { store: DeckStore; slideId: string; editable: boolean }) {
  const ytext = store.notes(slideId);
  const ref = useRef<HTMLTextAreaElement>(null);
  const [value, setValue] = useState(() => ytext?.toString() ?? '');
  useEffect(() => {
    if (!ytext) return;
    setValue(ytext.toString());
    const obs = (e: Y.YTextEvent, tr: Y.Transaction) => {
      if (tr.origin === LOCAL && tr.local) return;
      const ta = ref.current;
      let s = ta?.selectionStart ?? 0;
      let en = ta?.selectionEnd ?? 0;
      let pos = 0;
      for (const d of e.delta) {
        if (d.retain) pos += d.retain;
        else if (typeof d.insert === 'string') {
          const l = d.insert.length;
          if (pos <= s) s += l;
          if (pos <= en) en += l;
          pos += l;
        } else if (d.delete) {
          if (pos < s) s = Math.max(pos, s - d.delete);
          if (pos < en) en = Math.max(pos, en - d.delete);
        }
      }
      setValue(ytext.toString());
      if (ta && document.activeElement === ta) requestAnimationFrame(() => ta.setSelectionRange(s, en));
    };
    ytext.observe(obs);
    return () => ytext.unobserve(obs);
  }, [ytext]);
  if (!ytext) return null;
  return (
    <div className="shrink-0 border-t border-line bg-surface">
      <textarea
        ref={ref}
        value={value}
        readOnly={!editable}
        onChange={(e) => {
          const next = e.target.value;
          const prev = ytext.toString();
          let a = 0;
          while (a < prev.length && a < next.length && prev[a] === next[a]) a++;
          let b = 0;
          while (b < prev.length - a && b < next.length - a && prev[prev.length - 1 - b] === next[next.length - 1 - b]) b++;
          store.doc.transact(() => {
            if (prev.length - a - b) ytext.delete(a, prev.length - a - b);
            if (next.length - a - b) ytext.insert(a, next.slice(a, next.length - b));
          }, LOCAL);
          setValue(next);
        }}
        placeholder={editable ? 'Click to add speaker notes' : 'No speaker notes'}
        className="block h-[88px] w-full resize-none bg-transparent px-5 py-3 text-[13px] text-ink-2 outline-none placeholder:text-subtle"
        aria-label="Speaker notes"
        data-testid="speaker-notes"
      />
    </div>
  );
}

// ── Version preview ──────────────────────────────────────────────────────────

function VersionPreview({ resourceId, versionId, canEdit, onClose }: { resourceId: string; versionId: string; canEdit: boolean; onClose: () => void }) {
  const { data, isLoading } = useVersionContent(resourceId, versionId);
  const { restore } = useVersionActions(resourceId);
  const deck = (data as { deck?: PlainDeck } | undefined)?.deck;
  return (
    <div className="absolute inset-0 z-40 flex flex-col bg-surface">
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
      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        {isLoading || !deck ? (
          <Skeleton className="h-[40vh]" />
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-5">
            {deck.slides.map((s, i) => (
              <div key={s.id}>
                <SlideView slide={s} deck={deck} width={260} className="rounded-lg border border-line" />
                <div className="mt-1 text-[12px] text-muted">
                  {i + 1}. {slideTitle(s) || 'Untitled'}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

