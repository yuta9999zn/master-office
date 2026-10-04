'use client';

import { NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from '@tiptap/react';
import { Drawing, type DrawingAttrs } from '@workos/doc-model';
import { DEFAULT_THEME, EXTRA_SHAPES, isLine, newId, SHAPES, slideHtml, writeDeck, type Geometry, type PlainDeck, type PlainElement } from '@workos/slide-model';
import { DropdownMenu as DM } from 'radix-ui';
import { Brush, PenLine, Pencil, Redo2, Shapes, Trash2, Type, Undo2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import * as Y from 'yjs';
import { DeckStore } from '../slides/deck-store';
import type { DrawTool, Drawn } from '../slides/DrawLayer';
import { SlideCanvas } from '../slides/SlideCanvas';
import { ColorPicker } from '../slides/SlidePanels';
import { SlideStyles } from '../slides/SlideView';
import { Button, cn, Dialog } from '../ui/primitives';

// Insert → Drawing (Google Docs). docs/ARCHITECTURE.md §60. The drawing canvas is the Slides canvas on a
// throwaway one-slide deck (its own Y.Doc, its own undo); Save writes the elements back into the document node.

export const EMPTY_DRAWING: DrawingAttrs = { w: 640, h: 360, elements: [] };
const noop = () => () => undefined;

function useDeckStore(open: boolean, initial: DrawingAttrs) {
  const [store, setStore] = useState<DeckStore | null>(null);
  useEffect(() => {
    if (!open) return;
    const doc = new Y.Doc();
    const deck: PlainDeck = { name: 'Drawing', size: { w: initial.w, h: initial.h }, theme: DEFAULT_THEME, slides: [{ id: newId(), meta: { layout: 'blank' }, notes: '', elements: structuredClone(initial.elements) as PlainElement[] } as PlainDeck['slides'][number]] };
    writeDeck(doc, deck);
    const st = new DeckStore(doc);
    setStore(st);
    return () => {
      st.destroy();
      doc.destroy();
      setStore(null);
    };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  return store;
}

export function DrawingEditor({ open, initial, onSave, onClose }: { open: boolean; initial: DrawingAttrs; onSave: (d: DrawingAttrs) => void; onClose: () => void }) {
  const store = useDeckStore(open, initial);
  const snap = useSyncExternalStore(store?.subscribe ?? noop, () => store?.getSnapshot() ?? null, () => null);
  const slide = snap?.slides[0] ?? null;
  const [selection, setSelection] = useState<string[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [draw, setDraw] = useState<DrawTool | null>(null);
  const W = initial.w;
  const H = initial.h;
  const selected = slide?.elements.filter((e) => selection.includes(e.id)) ?? [];

  const add = (el: Omit<PlainElement, 'id' | 'z'>, edit = false) => {
    if (!store || !slide) return;
    const ids = store.addElements(slide.id, [{ ...el, id: '', z: 0 } as PlainElement]);
    setSelection(ids);
    if (edit) setEditing(ids[0]);
  };
  // Each new shape lands a little lower-right of the previous one, so they never hide each other.
  const cascade = ((slide?.elements.length ?? 0) % 6) * 20;
  const addShape = (geom: Geometry) =>
    isLine(geom)
      ? add({ type: 'shape', geom, x: W / 2 - 100 + cascade, y: H / 2 + cascade, w: 200, h: 0, style: { stroke: '#1f2937', strokeWidth: 3 } })
      : add({ type: 'shape', geom, x: W / 2 - 80 + cascade - 50, y: H / 2 - 50 + cascade - 50, w: 160, h: 100, style: { fill: '#5B95F9', color: '#FFFFFF', align: 'center', vAlign: 'middle', fontSize: 16 }, text: { type: 'doc', content: [{ type: 'paragraph' }] } });
  const style = (patch: Record<string, unknown>) => store && slide && store.updateElements(slide.id, selected.map((e) => ({ id: e.id, patch: { style: patch } })) as never);
  const remove = () => store && slide && selection.length && (store.deleteElements(slide.id, selection), setSelection([]));
  const onDrawn = (d: Drawn) => {
    setDraw(null);
    add({ type: 'shape', geom: 'freeform', ...d, style: d.path.closed ? { fill: '#5B95F9' } : { stroke: '#1f2937', strokeWidth: 3 } });
  };

  // Delete / Backspace / undo while not typing in a text box (the docs editor below must not get them).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      // Esc ends typing in a text box / the line tool first; only then does it close the dialog (Radix listens later).
      if (e.key === 'Escape' && (editing || draw)) {
        e.preventDefault();
        e.stopPropagation();
        if (editing) setEditing(null);
        return;
      }
      if (editing || (e.target as HTMLElement).closest('input, textarea, [contenteditable="true"]')) return;
      const mod = e.ctrlKey || e.metaKey;
      if (e.key === 'Delete' || e.key === 'Backspace') (e.preventDefault(), remove());
      else if (mod && e.key.toLowerCase() === 'z') (e.preventDefault(), e.shiftKey ? store?.undo.redo() : store?.undo.undo());
      else return;
      e.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  const save = () => {
    if (!slide) return;
    onSave({ w: W, h: H, elements: JSON.parse(JSON.stringify(slide.elements.map(({ text, ...e }) => (text ? { ...e, text } : e)))) });
    onClose();
  };
  const toolBtn = 'flex h-8 items-center gap-1.5 rounded-md px-2 text-[13px] text-ink-2 hover:bg-hover disabled:opacity-40';
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()} title="Drawing" width={1000}>
      <SlideStyles />
      <div className="flex flex-wrap items-center gap-1 border-b border-line pb-2" data-testid="drawing-toolbar">
        <button className={toolBtn} onClick={() => store?.undo.undo()} aria-label="Undo drawing">
          <Undo2 size={15} />
        </button>
        <button className={toolBtn} onClick={() => store?.undo.redo()} aria-label="Redo drawing">
          <Redo2 size={15} />
        </button>
        <DM.Root>
          <DM.Trigger asChild>
            <button className={toolBtn} aria-label="Drawing shape">
              <Shapes size={15} /> Shape
            </button>
          </DM.Trigger>
          <DM.Portal>
            <DM.Content sideOffset={4} className="pop z-[200] grid max-h-[60vh] w-[260px] animate-pop grid-cols-3 gap-1 overflow-y-auto p-2">
              {[...SHAPES.filter((s) => !isLine(s.geom)), ...EXTRA_SHAPES].map((s) => (
                <DM.Item key={s.geom} onSelect={() => addShape(s.geom as Geometry)} className="cursor-pointer truncate rounded-md px-2 py-1.5 text-[12px] outline-none data-[highlighted]:bg-hover">
                  {s.label}
                </DM.Item>
              ))}
            </DM.Content>
          </DM.Portal>
        </DM.Root>
        <DM.Root>
          <DM.Trigger asChild>
            <button className={cn(toolBtn, draw && 'bg-selected text-brand-700')} aria-label="Drawing line">
              <PenLine size={15} /> Line
            </button>
          </DM.Trigger>
          <DM.Portal>
            <DM.Content sideOffset={4} className="pop z-[200] w-44 animate-pop p-1">
              {(
                [
                  ['line', 'Line', null],
                  ['arrow', 'Arrow', null],
                  [null, 'Curve', 'curve'],
                  [null, 'Polyline', 'polyline'],
                  [null, 'Scribble', 'scribble'],
                ] as const
              ).map(([geom, label, tool]) => (
                <DM.Item key={label} onSelect={() => (geom ? addShape(geom) : (setSelection([]), setEditing(null), setDraw(tool)))} className="cursor-pointer rounded-md px-2 py-1.5 text-[13px] outline-none data-[highlighted]:bg-hover">
                  {label}
                </DM.Item>
              ))}
            </DM.Content>
          </DM.Portal>
        </DM.Root>
        <button className={toolBtn} onClick={() => add({ type: 'text', x: W / 2 - 120, y: H / 2 - 20, w: 240, h: 40, style: { fontSize: 18, color: '#0f172a' }, text: { type: 'doc', content: [{ type: 'paragraph' }] } }, true)} aria-label="Drawing text box">
          <Type size={15} /> Text
        </button>
        <span className="mx-1 h-5 w-px bg-line" />
        <ColorPicker label="Fill colour" allowNone value={selected[0]?.style?.fill ?? null} theme={DEFAULT_THEME} onChange={(c) => style({ fill: c ?? undefined })}>
          <span className={cn(toolBtn, !selected.length && 'pointer-events-none opacity-40')}>
            <Brush size={15} /> Fill
          </span>
        </ColorPicker>
        <ColorPicker label="Border colour" allowNone value={selected[0]?.style?.stroke ?? null} theme={DEFAULT_THEME} onChange={(c) => style({ stroke: c ?? undefined, strokeWidth: c ? selected[0]?.style?.strokeWidth ?? 2 : undefined })}>
          <span className={cn(toolBtn, !selected.length && 'pointer-events-none opacity-40')}>
            <Pencil size={15} /> Border
          </span>
        </ColorPicker>
        <button className={toolBtn} disabled={!selected.length} onClick={remove} aria-label="Delete from drawing">
          <Trash2 size={15} />
        </button>
        <span className="ml-auto" />
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={save} data-testid="drawing-save">
          Save and close
        </Button>
      </div>
      <div className="relative mt-2 flex h-[480px] min-h-0 bg-canvas" data-testid="drawing-canvas">
        {store && slide && snap && (
          <SlideCanvas
            store={store}
            slide={slide}
            deck={{ size: snap.size, theme: snap.theme }}
            zoom="fit"
            selection={selection}
            setSelection={(ids) => {
              setSelection(ids);
              if (editing && !ids.includes(editing)) setEditing(null);
            }}
            editing={editing}
            setEditing={setEditing}
            editable
            remote={[]}
            comments={new Map()}
            onEditorReady={() => undefined}
            onOpenFormat={() => undefined}
            onComment={() => undefined}
            onTableCell={() => undefined}
            contextMenu={() => null}
            onFitScale={() => undefined}
            selectAllOnEdit={false}
            draw={draw}
            onDrawn={onDrawn}
            onDrawCancel={() => setDraw(null)}
          />
        )}
      </div>
    </Dialog>
  );
}

/** The drawing in the document: its picture, fitted to the text width; double-click (or Edit) opens the canvas. */
function DrawingView({ node, updateAttributes, editor, selected }: ReactNodeViewProps) {
  const d = { w: Number(node.attrs.w) || 640, h: Number(node.attrs.h) || 360, elements: (node.attrs.elements as unknown[]) ?? [] };
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(d.w);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(Math.min(d.w, el.clientWidth)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [d.w]);
  const html = useMemo(() => slideHtml({ id: 'drawing', meta: {}, notes: '', elements: d.elements as PlainElement[] } as never, { size: { w: d.w, h: d.h }, theme: DEFAULT_THEME }), [node.attrs.elements, d.w, d.h]); // eslint-disable-line react-hooks/exhaustive-deps
  const k = width / d.w;
  return (
    <NodeViewWrapper className="my-3" data-testid="drawing" data-drag-handle>
      <SlideStyles />
      <div ref={box} className="relative w-full" contentEditable={false}>
        <div
          className={cn('group relative mx-auto overflow-hidden rounded-sm', selected ? 'outline outline-2 outline-brand-400' : 'outline outline-1 outline-transparent hover:outline-line')}
          style={{ width, height: d.h * k }}
          onDoubleClick={() => editor.isEditable && setOpen(true)}
        >
          <div className="pointer-events-none origin-top-left" style={{ width: d.w, height: d.h, transform: `scale(${k})` }} dangerouslySetInnerHTML={{ __html: html }} />
          {editor.isEditable && (
            <button onClick={() => setOpen(true)} className="absolute right-2 top-2 rounded-md bg-white/90 px-2 py-0.5 text-[12px] font-medium text-ink-2 opacity-0 shadow group-hover:opacity-100" aria-label="Edit drawing">
              Edit
            </button>
          )}
        </div>
      </div>
      {open && <DrawingEditor open initial={d} onSave={(next) => updateAttributes(next)} onClose={() => setOpen(false)} />}
    </NodeViewWrapper>
  );
}

export const DrawingWithView = Drawing.extend({ addNodeView: () => ReactNodeViewRenderer(DrawingView) });
