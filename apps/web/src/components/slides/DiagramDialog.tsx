'use client';

import { DIAGRAMS, diagramElements, type DiagramKind, type PlainSlide } from '@workos/slide-model';
import { Minus, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button, cn, Dialog } from '../ui/primitives';
import type { DeckSnapshot } from './deck-store';
import { SlideView } from './SlideView';

const preview = (kind: DiagramKind, count: number, color: number | 'multi', deck: DeckSnapshot): PlainSlide => ({ id: `preview-${kind}`, meta: { layout: 'blank' }, notes: '', elements: diagramElements(kind, { count, color }, deck.size) });

/** Insert → Diagram (Google Slides): pick a kind, the number of items and the colours; inserted as one group. */
export function DiagramDialog({ open, onOpenChange, deck, onInsert }: { open: boolean; onOpenChange: (v: boolean) => void; deck: DeckSnapshot; onInsert: (kind: DiagramKind, count: number, color: number | 'multi') => void }) {
  const [kind, setKind] = useState<DiagramKind>('process');
  const spec = DIAGRAMS.find((d) => d.kind === kind)!;
  const [count, setCount] = useState(spec.def);
  const [color, setColor] = useState<number | 'multi'>(1);
  const n = Math.min(spec.max, Math.max(spec.min, count));
  const big = useMemo(() => preview(kind, n, color, deck), [kind, n, color, deck]);
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Insert diagram"
      width={760}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => onInsert(kind, n, color)} data-testid="insert-diagram">
            Insert
          </Button>
        </>
      }
    >
      <div className="flex gap-4">
        <div className="grid w-[300px] shrink-0 grid-cols-2 gap-2">
          {DIAGRAMS.map((d) => (
            <button
              key={d.kind}
              onClick={() => (setKind(d.kind), setCount(d.def))}
              className={cn('rounded-lg border p-1.5 text-left', kind === d.kind ? 'border-brand-600 ring-2 ring-brand-200' : 'border-line hover:border-brand-300')}
              aria-label={d.label}
              data-testid={`diagram-${d.kind}`}
            >
              <SlideView slide={preview(d.kind, d.def, 'multi', deck)} deck={deck} width={134} className="rounded border border-line" />
              <span className="mt-1 block text-[12px] font-medium text-ink">{d.label}</span>
            </button>
          ))}
        </div>
        <div className="min-w-0 flex-1 space-y-3">
          <SlideView slide={big} deck={deck} width={410} className="rounded-lg border border-line" />
          <div className="flex items-center gap-2 text-[13px] text-ink-2">
            <span className="w-16 text-muted">Items</span>
            <button onClick={() => setCount(n - 1)} disabled={n <= spec.min} className="rounded-md border border-line p-1 hover:bg-hover disabled:opacity-40" aria-label="Fewer items">
              <Minus size={14} />
            </button>
            <span className="w-6 text-center tabular-nums" data-testid="diagram-count">
              {n}
            </span>
            <button onClick={() => setCount(n + 1)} disabled={n >= spec.max} className="rounded-md border border-line p-1 hover:bg-hover disabled:opacity-40" aria-label="More items">
              <Plus size={14} />
            </button>
          </div>
          <div className="flex items-center gap-2 text-[13px]">
            <span className="w-16 text-muted">Colour</span>
            {deck.theme.colors.accents.map((c, i) => (
              <button key={c + i} onClick={() => setColor(i + 1)} className={cn('size-6 rounded-full border-2', color === i + 1 ? 'border-ink' : 'border-white shadow-[0_0_0_1px_rgba(0,0,0,0.12)]')} style={{ background: c }} aria-label={`Accent ${i + 1}`} />
            ))}
            <button onClick={() => setColor('multi')} className={cn('h-6 rounded-full border-2 px-2 text-[11px] font-medium', color === 'multi' ? 'border-ink' : 'border-line')} aria-label="Multicolour">
              Multi
            </button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
