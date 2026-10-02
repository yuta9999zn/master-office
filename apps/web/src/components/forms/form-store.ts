'use client';

import {
  createYItem,
  DEFAULT_SETTINGS,
  DEFAULT_THEME,
  FORM_MAP,
  itemIds,
  ITEMS_MAP,
  newId,
  newItem,
  ORDER_ARRAY,
  readItem,
  type FormItem,
  type FormSettings,
  type FormTheme,
  type ItemType,
  type PlainForm,
} from '@workos/form-model';
import { useSyncExternalStore } from 'react';
import * as Y from 'yjs';

const LOCAL = { local: true };

/**
 * Reactive view of a form's Y.Doc plus every builder operation (docs/ARCHITECTURE.md §25). Each item is its own
 * Y.Map with one key per property, so two people editing different questions — or different parts of one — merge.
 */
export class FormStore {
  readonly meta: Y.Map<unknown>;
  readonly order: Y.Array<string>;
  readonly items: Y.Map<Y.Map<unknown>>;
  readonly undo: Y.UndoManager;
  private snap: PlainForm & { ready: boolean };
  private listeners = new Set<() => void>();

  constructor(readonly doc: Y.Doc) {
    this.meta = doc.getMap(FORM_MAP);
    this.order = doc.getArray<string>(ORDER_ARRAY);
    this.items = doc.getMap<Y.Map<unknown>>(ITEMS_MAP);
    this.undo = new Y.UndoManager([this.meta, this.order, this.items], { trackedOrigins: new Set([LOCAL]), captureTimeout: 600 });
    this.snap = this.read();
    doc.on('update', this.onUpdate);
  }

  destroy() {
    this.doc.off('update', this.onUpdate);
    this.undo.destroy();
  }

  private onUpdate = () => {
    this.snap = this.read();
    this.listeners.forEach((l) => l());
  };

  private read() {
    return {
      ready: this.meta.has('settings'),
      title: (this.meta.get('title') as string) ?? '',
      description: (this.meta.get('description') as string) ?? '',
      theme: { ...DEFAULT_THEME, ...((this.meta.get('theme') as FormTheme) ?? {}) },
      settings: { ...DEFAULT_SETTINGS, ...((this.meta.get('settings') as FormSettings) ?? {}) },
      items: itemIds(this.doc).map((id) => readItem(id, this.items.get(id)!)),
    };
  }

  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
  getSnapshot = () => this.snap;

  private tx(fn: () => void) {
    this.doc.transact(fn, LOCAL);
  }

  setMeta(patch: Partial<Pick<PlainForm, 'title' | 'description'>>) {
    this.tx(() => Object.entries(patch).forEach(([k, v]) => this.meta.set(k, v)));
  }
  setTheme(patch: Partial<FormTheme>) {
    this.tx(() => this.meta.set('theme', { ...this.snap.theme, ...patch }));
  }
  setSettings(patch: Partial<FormSettings>) {
    this.tx(() => this.meta.set('settings', { ...this.snap.settings, ...patch }));
  }

  /** Inserts a new item after `afterId` (or at the end) and returns its id. */
  addItem(type: ItemType, afterId: string | null): string {
    const it = newItem(type);
    this.insert(it, afterId);
    return it.id;
  }

  private insert(it: FormItem, afterId: string | null) {
    this.tx(() => {
      this.items.set(it.id, createYItem(it));
      const arr = this.order.toArray();
      const at = afterId ? arr.indexOf(afterId) + 1 : arr.length;
      this.order.insert(at > 0 ? at : arr.length, [it.id]);
    });
  }

  updateItem(id: string, patch: Partial<Omit<FormItem, 'id'>>) {
    this.tx(() => {
      const m = this.items.get(id);
      if (!m) return;
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined || v === null) m.delete(k);
        else m.set(k, v);
      }
    });
  }

  /** Changes the type, keeping what still makes sense (title, description, options between choice types). */
  changeType(id: string, type: ItemType) {
    const cur = this.snap.items.find((i) => i.id === id);
    if (!cur) return;
    const fresh = newItem(type);
    const keepOptions = ['choice', 'checkbox', 'dropdown'].includes(type) && cur.options?.length;
    this.tx(() => {
      const m = this.items.get(id);
      if (!m) return;
      for (const k of [...m.keys()]) if (!['title', 'description', 'required'].includes(k)) m.delete(k);
      m.set('type', type);
      for (const [k, v] of Object.entries(fresh)) if (!['id', 'title', 'type'].includes(k) && v !== undefined) m.set(k, v);
      if (keepOptions) m.set('options', cur.options);
    });
  }

  duplicateItem(id: string): string | null {
    const cur = this.snap.items.find((i) => i.id === id);
    if (!cur) return null;
    const copy: FormItem = { ...structuredClone(cur), id: newId(), options: cur.options?.map((o) => ({ ...o, id: newId() })) };
    this.insert(copy, id);
    return copy.id;
  }

  deleteItem(id: string) {
    this.tx(() => {
      const arr = this.order.toArray();
      for (let i = arr.length - 1; i >= 0; i--) if (arr[i] === id) this.order.delete(i, 1);
      this.items.delete(id);
      // Branching that pointed at a deleted section falls back to "next section".
      for (const it of this.snap.items) {
        const m = this.items.get(it.id);
        if (!m) continue;
        if (it.after === id) m.delete('after');
        if (it.options?.some((o) => o.goTo === id)) m.set('options', it.options.map((o) => (o.goTo === id ? { ...o, goTo: null } : o)));
      }
    });
  }

  moveItem(id: string, to: number) {
    const ids = this.snap.items.map((i) => i.id);
    const from = ids.indexOf(id);
    if (from < 0 || from === to) return;
    ids.splice(from, 1);
    ids.splice(Math.max(0, Math.min(to, ids.length)), 0, id);
    this.tx(() => {
      this.order.delete(0, this.order.length);
      this.order.insert(0, ids);
    });
  }
}

export function useForm(store: FormStore | null) {
  return useSyncExternalStore(store?.subscribe ?? noop, () => store?.getSnapshot() ?? null, () => null);
}
const noop = () => () => undefined;
