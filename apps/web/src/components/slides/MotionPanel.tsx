'use client';

import { ANIM_EFFECTS, animCss, animTimeline, textOf, type AnimEffect, type ElementAnim, type PlainElement, type PlainSlide, type Transition } from '@workos/slide-model';
import { ArrowDown, ArrowUp, Play, Plus, Square, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '../ui/primitives';
import type { DeckSnapshot, DeckStore } from './deck-store';
import { NumberField, Row, Section, Select } from './SlidePanels';
import { SlideView } from './SlideView';

const START: { value: ElementAnim['start']; label: string }[] = [
  { value: 'click', label: 'On click' },
  { value: 'with', label: 'With previous' },
  { value: 'after', label: 'After previous' },
];

export const elementLabel = (e: PlainElement) =>
  textOf(e.text).trim().split('\n')[0]?.slice(0, 40) || ({ text: 'Text box', shape: 'Shape', image: 'Picture', table: 'Table', chart: 'Chart' } as Record<string, string>)[e.type] || e.type;

/** Plays the slide's animations step after step in a small preview. */
function Preview({ slide, deck, onDone }: { slide: PlainSlide; deck: DeckSnapshot; onDone: () => void }) {
  const { items, clicks } = useMemo(() => animTimeline(slide), [slide]);
  const [step, setStep] = useState(items.some((i) => i.step === 0) ? 0 : 1);
  useEffect(() => {
    const len = Math.max(0, ...items.filter((i) => i.step === step).map((i) => i.at + i.dur));
    const t = setTimeout(() => (step >= clicks ? onDone() : setStep(step + 1)), len + 600);
    return () => clearTimeout(t);
  }, [step, clicks, items, onDone]);
  const opts = useMemo(() => ({ elementCss: animCss(slide, step, true) }), [slide, step]);
  return <SlideView key={step} slide={slide} deck={deck} width={288} opts={opts} className="rounded-md border border-line" />;
}

/** Motion panel (Google Slides): the slide transition and the animations of the slide's objects. */
export function MotionPanel({ store, deck, slide, selected, editable, onSelect }: { store: DeckStore; deck: DeckSnapshot; slide: PlainSlide; selected: PlainElement[]; editable: boolean; onSelect: (ids: string[]) => void }) {
  const [playing, setPlaying] = useState(false);
  const list = slide.elements.filter((e) => e.anim).sort((a, b) => a.anim!.order - b.anim!.order);
  const { items } = animTimeline(slide);
  const stepOf = new Map(items.map((i) => [i.id, i.step]));
  const move = (i: number, d: -1 | 1) => {
    const ids = list.map((e) => e.id);
    const j = i + d;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    store.orderAnimations(slide.id, ids);
  };
  const addable = selected.filter((e) => !e.anim);
  return (
    <fieldset disabled={!editable} data-testid="motion-panel">
      <Section title="Slide transition">
        <Row label="Effect">
          <Select<Transition>
            label="Slide transition"
            value={slide.meta.transition ?? 'none'}
            options={[
              { value: 'none', label: 'None' },
              { value: 'fade', label: 'Fade' },
              { value: 'push', label: 'Push' },
              { value: 'wipe', label: 'Wipe' },
            ]}
            onChange={(t) => store.setSlideMeta([slide.id], { transition: t })}
          />
        </Row>
      </Section>
      <Section
        title="Object animations"
        action={
          <button onClick={() => setPlaying((p) => !p)} disabled={!list.length} className="flex items-center gap-1 rounded-md px-2 py-1 text-[12px] font-medium text-brand-700 hover:bg-brand-50 disabled:opacity-40" data-testid="motion-play">
            {playing ? <Square size={12} /> : <Play size={12} />}
            {playing ? 'Stop' : 'Play'}
          </button>
        }
      >
        {playing && <Preview slide={slide} deck={deck} onDone={() => setPlaying(false)} />}
        {list.length === 0 && <p className="text-[12px] text-muted">Select an object on the slide, then add an animation.</p>}
        {list.map((e, i) => {
          const a = e.anim!;
          const active = selected.some((s) => s.id === e.id);
          return (
            <div key={e.id} className={`rounded-lg border px-2.5 py-2 ${active ? 'border-brand-500 bg-brand-50/50' : 'border-line'}`} data-testid="anim-item">
              <div className="mb-1.5 flex items-center gap-1.5">
                <span className="flex size-5 shrink-0 items-center justify-center rounded bg-hover text-[11px] font-semibold text-muted" title="Click number">
                  {stepOf.get(e.id) || '▶'}
                </span>
                <button className="min-w-0 flex-1 truncate text-left text-[13px] font-medium text-ink" onClick={() => onSelect([e.id])}>
                  {elementLabel(e)}
                </button>
                <button onClick={() => move(i, -1)} disabled={i === 0} className="rounded p-0.5 text-muted hover:bg-hover disabled:opacity-30" aria-label="Move animation up">
                  <ArrowUp size={13} />
                </button>
                <button onClick={() => move(i, 1)} disabled={i === list.length - 1} className="rounded p-0.5 text-muted hover:bg-hover disabled:opacity-30" aria-label="Move animation down">
                  <ArrowDown size={13} />
                </button>
                <button onClick={() => store.setAnimation(slide.id, e.id, null)} className="rounded p-0.5 text-muted hover:bg-hover" aria-label="Remove animation">
                  <Trash2 size={13} />
                </button>
              </div>
              <div className="space-y-1.5">
                <Select<AnimEffect> label="Animation effect" value={a.effect} options={ANIM_EFFECTS.map((x) => ({ value: x.id, label: x.label }))} onChange={(effect) => store.setAnimation(slide.id, e.id, { effect })} className="w-full" />
                <Select<ElementAnim['start']> label="Animation start" value={a.start} options={START} onChange={(start) => store.setAnimation(slide.id, e.id, { start })} className="w-full" />
                <div className="flex items-center gap-2 text-[12px] text-muted">
                  Duration
                  <NumberField label="Duration (seconds)" value={a.dur / 1000} min={0.1} max={20} step={0.1} suffix="s" w={70} onCommit={(v) => store.setAnimation(slide.id, e.id, { dur: Math.round(v * 1000) })} />
                  Delay
                  <NumberField label="Delay (seconds)" value={(a.delay ?? 0) / 1000} min={0} max={60} step={0.1} suffix="s" w={70} onCommit={(v) => store.setAnimation(slide.id, e.id, { delay: Math.round(v * 1000) })} />
                </div>
              </div>
            </div>
          );
        })}
        <Button
          size="sm"
          variant="soft"
          icon={<Plus size={14} />}
          disabled={!addable.length}
          onClick={() => store.addAnimation(slide.id, addable.map((e) => e.id), { effect: 'fadeIn', start: 'click', dur: 500 })}
          data-testid="add-animation"
        >
          Add animation{addable.length > 1 ? ` (${addable.length} objects)` : ''}
        </Button>
      </Section>
    </fieldset>
  );
}
