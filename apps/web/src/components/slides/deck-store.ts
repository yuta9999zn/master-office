'use client';

import { ySyncPluginKey } from '@tiptap/y-tiptap';
import {
  byZ,
  cloneSlide,
  createYElement,
  createYSlide,
  DECK_MAP,
  DEFAULT_SIZE,
  DEFAULT_THEME,
  layoutElements,
  newId,
  newSlide,
  ORDER_ARRAY,
  readSlide,
  regroup,
  slideIds,
  SLIDES_MAP,
  type Crop,
  type DeckSize,
  type ElementAnim,
  type ElementStyle,
  type LayoutId,
  type PlainElement,
  type PlainSlide,
  type SlideMeta,
  type SlideNumbers,
  type TableSpec,
  type Theme,
} from '@workos/slide-model';
import { useSyncExternalStore } from 'react';
import * as Y from 'yjs';

const CAPTURE_TIMEOUT = 500;

/** Origin of every local edit (tracked by the undo manager; remote edits are not). */
export const LOCAL = { local: true };

export interface DeckSnapshot {
  name: string;
  size: DeckSize;
  theme: Theme;
  slides: PlainSlide[];
  numbers?: SlideNumbers;
  ready: boolean;
}

type ElPatch = Partial<Omit<PlainElement, 'id' | 'style' | 'text' | 'table'>> & { style?: Partial<ElementStyle> };

/**
 * Reactive view of the presentation's Y.Doc plus every edit operation (docs/ARCHITECTURE.md §23).
 * Only slides touched by a change are re-read, so unchanged slides keep their identity and thumbnails don't re-render.
 */
export class DeckStore {
  readonly deck: Y.Map<unknown>;
  readonly order: Y.Array<string>;
  readonly slides: Y.Map<Y.Map<unknown>>;
  readonly undo: Y.UndoManager;
  private cache = new Map<string, PlainSlide>();
  private dirty = new Set<string>();
  private all = true;
  private snap: DeckSnapshot = { name: '', size: DEFAULT_SIZE, theme: DEFAULT_THEME, slides: [], ready: false };
  private listeners = new Set<() => void>();

  constructor(readonly doc: Y.Doc) {
    this.deck = doc.getMap(DECK_MAP);
    this.order = doc.getArray<string>(ORDER_ARRAY);
    this.slides = doc.getMap<Y.Map<unknown>>(SLIDES_MAP);
    this.undo = new Y.UndoManager([this.deck, this.order, this.slides], { trackedOrigins: new Set<unknown>([LOCAL, ySyncPluginKey]), captureTimeout: CAPTURE_TIMEOUT });
    this.slides.observeDeep(this.onSlides);
    this.order.observe(this.onOther);
    this.deck.observe(this.onOther);
    this.recompute();
  }

  destroy() {
    this.slides.unobserveDeep(this.onSlides);
    this.order.unobserve(this.onOther);
    this.deck.unobserve(this.onOther);
    this.undo.destroy();
  }

  private onSlides = (events: Y.YEvent<Y.AbstractType<unknown>>[]) => {
    for (const e of events) {
      if (e.target === this.slides) (e as Y.YMapEvent<unknown>).keysChanged.forEach((k) => this.dirty.add(k));
      else if (typeof e.path[0] === 'string') this.dirty.add(e.path[0]);
    }
    this.changed();
  };
  private onOther = () => {
    // Theme / size changes affect every rendered slide but not their content: keep the cache.
    this.changed();
  };
  private changed() {
    this.recompute();
    this.listeners.forEach((l) => l());
  }

  private recompute() {
    const ids = slideIds(this.doc);
    const slides = ids.map((id, i) => {
      let s = this.all || this.dirty.has(id) ? undefined : this.cache.get(id);
      // The slide number is part of what is drawn: a moved slide becomes a new object (others keep theirs).
      if (!s || s.no !== i + 1) {
        s = { ...(s ?? readSlide(id, this.slides.get(id)!)), no: i + 1 };
        this.cache.set(id, s);
      }
      return s;
    });
    for (const k of [...this.cache.keys()]) if (!this.slides.has(k)) this.cache.delete(k);
    this.dirty.clear();
    this.all = false;
    this.snap = {
      name: (this.deck.get('name') as string) ?? '',
      size: (this.deck.get('size') as DeckSize) ?? DEFAULT_SIZE,
      theme: (this.deck.get('theme') as Theme) ?? DEFAULT_THEME,
      slides,
      numbers: this.deck.get('numbers') as SlideNumbers | undefined,
      ready: this.deck.has('size'),
    };
  }

  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
  getSnapshot = () => this.snap;

  get snapshot() {
    return this.snap;
  }

  private tx(fn: () => void) {
    this.doc.transact(fn, LOCAL);
  }

  /** Ends the current undo step (each drag / command is undone separately). */
  checkpoint() {
    this.undo.stopCapturing();
  }

  /**
   * A drag / resize / rotate is one undo step however long it takes: while the gesture lasts, changes are
   * merged regardless of the capture timeout (a slow drag would otherwise need several Ctrl+Z).
   */
  beginGesture() {
    this.undo.stopCapturing();
    this.undo.captureTimeout = Number.POSITIVE_INFINITY;
  }
  endGesture() {
    this.undo.stopCapturing();
    this.undo.captureTimeout = CAPTURE_TIMEOUT;
  }

  // ── Lookups ────────────────────────────────────────────────────────────────

  slideMap(id: string) {
    return this.slides.get(id) ?? null;
  }
  elements(slideId: string) {
    return (this.slideMap(slideId)?.get('elements') as Y.Map<Y.Map<unknown>> | undefined) ?? null;
  }
  el(slideId: string, elId: string) {
    return this.elements(slideId)?.get(elId) ?? null;
  }
  fragment(slideId: string, elId: string) {
    const f = this.el(slideId, elId)?.get('text');
    return f instanceof Y.XmlFragment ? f : null;
  }
  notes(slideId: string) {
    return (this.slideMap(slideId)?.get('notes') as Y.Text | undefined) ?? null;
  }
  slide(id: string) {
    return this.snap.slides.find((s) => s.id === id) ?? null;
  }

  // ── Slides ─────────────────────────────────────────────────────────────────

  private insertPlain(slides: PlainSlide[], index: number) {
    for (const s of slides) {
      const y = createYSlide(s);
      this.slides.set(s.id, y.map);
      y.fill();
    }
    const at = Math.max(0, Math.min(index, this.order.length));
    this.order.insert(at, slides.map((s) => s.id));
  }

  /** Index in the Y.Array of the n-th visible slide (the array can hold stale duplicates). */
  private arrayIndex(visibleIndex: number) {
    const ids = this.snap.slides.map((s) => s.id);
    if (visibleIndex >= ids.length) return this.order.length;
    const target = ids[visibleIndex];
    return this.order.toArray().indexOf(target);
  }

  addSlide(layout: LayoutId, at: number): string {
    const s = newSlide(layout, this.snap.size, this.snap.theme);
    this.tx(() => this.insertPlain([s], this.arrayIndex(at)));
    return s.id;
  }

  insertSlides(slides: PlainSlide[], at: number): string[] {
    const fresh = slides.map(cloneSlide);
    this.tx(() => this.insertPlain(fresh, this.arrayIndex(at)));
    return fresh.map((s) => s.id);
  }

  duplicateSlides(ids: string[]): string[] {
    const list = this.snap.slides.filter((s) => ids.includes(s.id));
    if (!list.length) return [];
    const last = Math.max(...list.map((s) => this.snap.slides.indexOf(s)));
    return this.insertSlides(list, last + 1);
  }

  deleteSlides(ids: string[]) {
    this.tx(() => {
      const arr = this.order.toArray();
      for (let i = arr.length - 1; i >= 0; i--) if (ids.includes(arr[i])) this.order.delete(i, 1);
      ids.forEach((id) => this.slides.delete(id));
      if (!slideIds(this.doc).length) this.insertPlain([newSlide('blank', this.snap.size, this.snap.theme)], 0);
    });
  }

  /** Moves slides so the first lands at visible index `to` (counted without the moved slides). */
  moveSlides(ids: string[], to: number) {
    const current = this.snap.slides.map((s) => s.id);
    const moving = current.filter((id) => ids.includes(id));
    const rest = current.filter((id) => !ids.includes(id));
    const next = [...rest.slice(0, to), ...moving, ...rest.slice(to)];
    if (next.join() === current.join()) return;
    this.tx(() => {
      this.order.delete(0, this.order.length);
      this.order.insert(0, next);
    });
  }

  setSlideMeta(ids: string[], patch: Partial<SlideMeta>) {
    this.tx(() => {
      for (const id of ids) {
        const m = this.slideMap(id);
        if (m) m.set('meta', { ...((m.get('meta') as SlideMeta) ?? { layout: 'blank' }), ...patch });
      }
    });
  }

  /** Applies a layout: placeholders move to the layout's boxes, missing ones are added, empty extra ones removed. */
  applyLayout(slideId: string, layout: LayoutId) {
    const s = this.slide(slideId);
    if (!s) return;
    const target = layoutElements(layout, this.snap.size, this.snap.theme);
    this.tx(() => {
      const els = this.elements(slideId)!;
      const used = new Set<string>();
      for (const t of target) {
        const existing = s.elements.find((e) => e.ph === t.ph && !used.has(e.id)) ?? (t.ph === 'body' ? s.elements.find((e) => e.ph === 'body2' && !used.has(e.id)) : undefined);
        if (existing) {
          used.add(existing.id);
          const m = els.get(existing.id)!;
          m.set('x', t.x);
          m.set('y', t.y);
          m.set('w', t.w);
          m.set('h', t.h);
          m.set('ph', t.ph);
        } else {
          const y = createYElement({ ...t, z: this.maxZ(s) + 1 + target.indexOf(t) });
          els.set(t.id, y.map);
          y.fill();
        }
      }
      for (const e of s.elements) {
        if (e.ph && !used.has(e.id) && !(e.text && JSON.stringify(e.text).includes('"text":'))) els.delete(e.id);
      }
      const m = this.slideMap(slideId)!;
      m.set('meta', { ...((m.get('meta') as SlideMeta) ?? {}), layout });
    });
  }

  // ── Elements ───────────────────────────────────────────────────────────────

  private maxZ(s: PlainSlide | null) {
    return s?.elements.length ? Math.max(...s.elements.map((e) => e.z)) : 0;
  }

  addElements(slideId: string, els: PlainElement[]): string[] {
    const s = this.slide(slideId);
    let z = this.maxZ(s);
    const ids: string[] = [];
    this.tx(() => {
      const map = this.elements(slideId);
      if (!map) return;
      for (const e of regroup(els)) {
        const el = { ...structuredClone(e), id: newId(), z: ++z };
        const y = createYElement(el);
        map.set(el.id, y.map);
        y.fill();
        ids.push(el.id);
      }
    });
    return ids;
  }

  updateElements(slideId: string, patches: { id: string; patch: ElPatch }[]) {
    this.tx(() => {
      for (const { id, patch } of patches) {
        const m = this.el(slideId, id);
        if (!m) continue;
        for (const [k, v] of Object.entries(patch)) {
          if (k === 'style') {
            const cur = (m.get('style') as ElementStyle | undefined) ?? {};
            const next: Record<string, unknown> = { ...cur };
            for (const [sk, sv] of Object.entries(v as object)) {
              if (sv === undefined) delete next[sk];
              else next[sk] = sv;
            }
            m.set('style', next);
          } else if (v === undefined || v === null) m.delete(k);
          else if (typeof v === 'number') m.set(k, Math.round(v * 100) / 100);
          else m.set(k, v);
        }
      }
    });
  }

  deleteElements(slideId: string, ids: string[]) {
    this.tx(() => ids.forEach((id) => this.elements(slideId)?.delete(id)));
  }

  arrange(slideId: string, ids: string[], how: 'front' | 'back' | 'forward' | 'backward') {
    const s = this.slide(slideId);
    if (!s || !ids.length) return;
    const sorted = [...s.elements].sort(byZ);
    let next = sorted.map((e) => e.id);
    if (how === 'front') next = [...next.filter((i) => !ids.includes(i)), ...next.filter((i) => ids.includes(i))];
    else if (how === 'back') next = [...next.filter((i) => ids.includes(i)), ...next.filter((i) => !ids.includes(i))];
    else {
      const dir = how === 'forward' ? 1 : -1;
      const idx = next.map((id, i) => (ids.includes(id) ? i : -1)).filter((i) => i >= 0);
      for (const i of dir > 0 ? idx.reverse() : idx) {
        const j = i + dir;
        if (j < 0 || j >= next.length || ids.includes(next[j])) continue;
        [next[i], next[j]] = [next[j], next[i]];
      }
    }
    this.tx(() => next.forEach((id, i) => this.el(slideId, id)?.set('z', i + 1)));
  }

  // ── Groups ─────────────────────────────────────────────────────────────────

  /** Ids of the elements in the same group as `id` (just `[id]` when it is not grouped). */
  groupMembers(slideId: string, id: string): string[] {
    const s = this.slide(slideId);
    const g = s?.elements.find((e) => e.id === id)?.group;
    return g ? s!.elements.filter((e) => e.group === g).map((e) => e.id) : [id];
  }

  /** Groups the elements (and the groups they belong to) into one group. */
  group(slideId: string, ids: string[]): string | null {
    const s = this.slide(slideId);
    if (!s) return null;
    const groups = new Set(s.elements.filter((e) => ids.includes(e.id) && e.group).map((e) => e.group));
    const members = s.elements.filter((e) => ids.includes(e.id) || (e.group && groups.has(e.group)));
    if (members.length < 2) return null;
    const gid = newId();
    this.tx(() => members.forEach((e) => this.el(slideId, e.id)?.set('group', gid)));
    return gid;
  }

  ungroup(slideId: string, ids: string[]) {
    const s = this.slide(slideId);
    if (!s) return;
    const groups = new Set(s.elements.filter((e) => ids.includes(e.id) && e.group).map((e) => e.group));
    if (!groups.size) return;
    this.tx(() => s.elements.filter((e) => e.group && groups.has(e.group)).forEach((e) => this.el(slideId, e.id)?.delete('group')));
  }

  // ── Animations ─────────────────────────────────────────────────────────────

  /** Adds an animation to each element (appended to the end of the slide's list). */
  addAnimation(slideId: string, ids: string[], anim: Omit<ElementAnim, 'order'>) {
    const s = this.slide(slideId);
    if (!s) return;
    let order = Math.max(0, ...s.elements.map((e) => e.anim?.order ?? 0));
    this.tx(() => ids.forEach((id, i) => this.el(slideId, id)?.set('anim', { ...anim, start: i === 0 ? anim.start : 'with', order: ++order })));
  }

  setAnimation(slideId: string, id: string, patch: Partial<ElementAnim> | null) {
    const m = this.el(slideId, id);
    if (!m) return;
    const cur = m.get('anim') as ElementAnim | undefined;
    this.tx(() => (patch === null ? m.delete('anim') : cur && m.set('anim', { ...cur, ...patch })));
  }

  /** Writes the slide's animation order (element ids, first to last). */
  orderAnimations(slideId: string, ids: string[]) {
    this.tx(() =>
      ids.forEach((id, i) => {
        const m = this.el(slideId, id);
        const cur = m?.get('anim') as ElementAnim | undefined;
        if (m && cur && cur.order !== i + 1) m.set('anim', { ...cur, order: i + 1 });
      }),
    );
  }

  // ── Tables ─────────────────────────────────────────────────────────────────

  table(slideId: string, elId: string) {
    const m = this.el(slideId, elId);
    const spec = m?.get('table') as TableSpec | undefined;
    const cells = m?.get('cells') as Y.Map<string> | undefined;
    return m && spec && cells ? { m, spec, cells } : null;
  }

  setCell(slideId: string, elId: string, r: number, c: number, value: string) {
    const t = this.table(slideId, elId);
    if (!t) return;
    const key = `${t.spec.rows[r]}:${t.spec.cols[c]}`;
    if ((t.cells.get(key) ?? '') === value) return;
    this.tx(() => (value ? t.cells.set(key, value) : t.cells.delete(key)));
  }

  tableStructure(slideId: string, elId: string, op: 'rowAbove' | 'rowBelow' | 'colLeft' | 'colRight' | 'delRow' | 'delCol', r: number, c: number) {
    const t = this.table(slideId, elId);
    if (!t) return;
    const spec: TableSpec = structuredClone(t.spec);
    const colW = spec.colW ?? spec.cols.map(() => 1);
    if (op === 'rowAbove' || op === 'rowBelow') spec.rows.splice(op === 'rowAbove' ? r : r + 1, 0, newId());
    else if (op === 'colLeft' || op === 'colRight') {
      const at = op === 'colLeft' ? c : c + 1;
      spec.cols.splice(at, 0, newId());
      colW.splice(at, 0, colW[c] ?? 1);
      spec.colW = colW;
    } else if (op === 'delRow' && spec.rows.length > 1) spec.rows.splice(r, 1);
    else if (op === 'delCol' && spec.cols.length > 1) {
      spec.cols.splice(c, 1);
      colW.splice(c, 1);
      spec.colW = colW;
    } else return;
    const grow = op === 'rowAbove' || op === 'rowBelow' ? 1 : op === 'delRow' ? -1 : 0;
    this.tx(() => {
      t.m.set('table', spec);
      if (grow) t.m.set('h', Math.max(40, ((t.m.get('h') as number) ?? 100) * (spec.rows.length / (spec.rows.length - grow))));
    });
  }

  setTableSpec(slideId: string, elId: string, patch: Partial<TableSpec>) {
    const t = this.table(slideId, elId);
    if (t) this.tx(() => t.m.set('table', { ...t.spec, ...patch }));
  }

  // ── Deck ───────────────────────────────────────────────────────────────────

  setNumbers(numbers: SlideNumbers | null) {
    this.tx(() => (numbers ? this.deck.set('numbers', numbers) : this.deck.delete('numbers')));
  }

  /**
   * Crops a picture: the frame grows or shrinks with the visible part, so the picture keeps its scale and position
   * on the slide (like dragging Google Slides' crop handles).
   */
  setCrop(slideId: string, id: string, crop: Crop | null) {
    const e = this.slide(slideId)?.elements.find((x) => x.id === id);
    const m = this.el(slideId, id);
    if (!e || !m) return;
    const old = e.crop ?? { l: 0, t: 0, r: 0, b: 0 };
    const next = crop ?? { l: 0, t: 0, r: 0, b: 0 };
    const clamp = (v: number) => Math.min(0.95, Math.max(0, v));
    const c = { l: clamp(next.l), t: clamp(next.t), r: clamp(next.r), b: clamp(next.b) };
    if (c.l + c.r > 0.95) c.r = 0.95 - c.l;
    if (c.t + c.b > 0.95) c.b = 0.95 - c.t;
    const fw = e.w / Math.max(0.05, 1 - old.l - old.r);
    const fh = e.h / Math.max(0.05, 1 - old.t - old.b);
    const r2 = (v: number) => Math.round(v * 100) / 100;
    this.tx(() => {
      m.set('x', r2(e.x + (c.l - old.l) * fw));
      m.set('y', r2(e.y + (c.t - old.t) * fh));
      m.set('w', r2(fw * (1 - c.l - c.r)));
      m.set('h', r2(fh * (1 - c.t - c.b)));
      if (c.l || c.t || c.r || c.b) m.set('crop', { l: r2(c.l * 1000) / 1000, t: r2(c.t * 1000) / 1000, r: r2(c.r * 1000) / 1000, b: r2(c.b * 1000) / 1000 });
      else m.delete('crop');
    });
  }

  setTheme(theme: Theme) {
    this.tx(() => this.deck.set('theme', theme));
  }

  /** Changes the slide size; content is scaled to fit (like PowerPoint's "Ensure fit"). */
  setSize(size: DeckSize) {
    const old = this.snap.size;
    if (old.w === size.w && old.h === size.h) return;
    const k = Math.min(size.w / old.w, size.h / old.h);
    const dx = (size.w - old.w * k) / 2;
    const dy = (size.h - old.h * k) / 2;
    this.tx(() => {
      this.deck.set('size', size);
      for (const s of this.snap.slides) {
        for (const e of s.elements) {
          const m = this.el(s.id, e.id);
          if (!m) continue;
          m.set('x', Math.round(e.x * k + dx));
          m.set('y', Math.round(e.y * k + dy));
          m.set('w', Math.round(e.w * k));
          m.set('h', Math.round(e.h * k));
          if (e.style?.fontSize && k < 0.98) m.set('style', { ...e.style, fontSize: Math.max(6, Math.round(e.style.fontSize * k)) });
        }
      }
    });
  }
}

export function useDeck(store: DeckStore | null): DeckSnapshot | null {
  return useSyncExternalStore(
    store?.subscribe ?? noopSubscribe,
    () => store?.getSnapshot() ?? null,
    () => null,
  );
}
const noopSubscribe = () => () => undefined;

// ── Direct rich-text formatting (whole text boxes, without opening an editor) ──

function forEachText(node: Y.XmlFragment | Y.XmlElement, fn: (t: Y.XmlText) => void) {
  for (const c of node.toArray()) {
    if (c instanceof Y.XmlText) fn(c);
    else if (c instanceof Y.XmlElement) forEachText(c, fn);
  }
}

type Delta = { insert: unknown; attributes?: Record<string, Record<string, unknown> | null> };

export function allRunsHave(frag: Y.XmlFragment, mark: string): boolean {
  let any = false;
  let all = true;
  forEachText(frag, (t) =>
    (t.toDelta() as Delta[]).forEach((d) => {
      if (typeof d.insert !== 'string' || !d.insert) return;
      any = true;
      if (!d.attributes?.[mark]) all = false;
    }),
  );
  return any && all;
}

/** Adds (attrs object) or removes (null) a mark on every run. */
export function setMarkEverywhere(frag: Y.XmlFragment, mark: string, attrs: Record<string, unknown> | null) {
  forEachText(frag, (t) => t.length && t.format(0, t.length, { [mark]: attrs }));
}

/** Sets or clears one textStyle attribute (color, fontSize, fontFamily) on every run, keeping the others. */
export function setTextStyleEverywhere(frag: Y.XmlFragment, key: string, value: string | null) {
  forEachText(frag, (t) => {
    let pos = 0;
    for (const d of t.toDelta() as Delta[]) {
      const len = typeof d.insert === 'string' ? d.insert.length : 1;
      const cur = (d.attributes?.textStyle as Record<string, unknown> | undefined) ?? {};
      if ((cur[key] ?? null) !== value) {
        const next: Record<string, unknown> = { ...cur };
        if (value === null) delete next[key];
        else next[key] = value;
        t.format(pos, len, { textStyle: Object.keys(next).length ? next : null });
      }
      pos += len;
    }
  });
}

export function setAlignEverywhere(frag: Y.XmlFragment | Y.XmlElement, align: string | null) {
  for (const c of frag.toArray()) {
    if (!(c instanceof Y.XmlElement)) continue;
    if (c.nodeName === 'paragraph') {
      if (align && align !== 'left') c.setAttribute('textAlign', align);
      else c.removeAttribute('textAlign');
    } else setAlignEverywhere(c, align);
  }
}
