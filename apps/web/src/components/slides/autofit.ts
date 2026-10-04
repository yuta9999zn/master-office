'use client';

import type { PlainSlide } from '@workos/slide-model';
import { useLayoutEffect, useRef, type RefObject } from 'react';
import type { DeckStore } from './deck-store';

// Format options ▸ Text fitting (Google Slides / PowerPoint autofit). docs/ARCHITECTURE.md §53.
// The editor measures the rendered text after each change and stores the result in the element — a font scale
// for "shrink on overflow" (in 5 % steps, like PowerPoint's normAutofit), a new height for "resize shape to fit
// text" — so every viewer, the slide show and the exports show the same thing without measuring again.

const STEP = 0.05;
const MIN_SCALE = 0.3;

export function useAutofit(store: DeckStore, slide: PlainSlide, html: string, page: RefObject<HTMLDivElement | null>, k: number, editable: boolean, editing: string | null) {
  const overflowed = useRef(new Map<string, { sig: string; z: number }>());
  useLayoutEffect(() => {
    const root = page.current;
    if (!editable || !root || !k) return;
    const patches: { id: string; patch: Record<string, unknown> }[] = [];
    for (const el of slide.elements) {
      const mode = el.style?.autofit;
      if (!mode || mode === 'none' || el.id === editing) continue;
      const box = root.querySelector<HTMLElement>(`.mo-el[data-el="${CSS.escape(el.id)}"] .mo-box`);
      const text = box?.querySelector<HTMLElement>('.mo-text');
      if (!box || !text || !text.textContent?.trim()) continue;
      const cs = getComputedStyle(box);
      const pad = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
      // Screen pixels (the slide is scaled by k) → slide units.
      const avail = box.getBoundingClientRect().height / k - pad;
      const used = text.getBoundingClientRect().height / k;
      if (mode === 'shrink') {
        const z = el.style?.fontScale ?? 1;
        // Wrapping is not linear: a scale that overflowed for this exact text and box is never tried again,
        // or the text would flip between two sizes forever.
        const sig = `${el.w}|${el.h}|${JSON.stringify(el.text)}|${JSON.stringify({ ...el.style, fontScale: undefined })}`;
        const known = overflowed.current.get(el.id);
        const tooBig = known && known.sig === sig ? known.z : Infinity;
        let next = z;
        if (used > avail + 1 && z > MIN_SCALE) {
          next = Math.max(MIN_SCALE, z - STEP);
          overflowed.current.set(el.id, { sig, z: Math.min(z, tooBig) });
        } else if (z < 1 && z + STEP < tooBig - 0.001 && (used * (z + STEP)) / z < avail * 0.95) next = Math.min(1, z + STEP);
        next = Math.round(next * 100) / 100;
        if (next !== z) patches.push({ id: el.id, patch: { style: { fontScale: next >= 1 ? undefined : next } } });
      } else {
        const want = Math.ceil(used + pad);
        if (Math.abs(want - el.h) > 2) patches.push({ id: el.id, patch: { h: want } });
      }
    }
    // One step per render: the next render measures again until it settles.
    if (patches.length) store.updateElements(slide.id, patches as never);
  }, [store, slide, html, page, k, editable, editing]);
}
