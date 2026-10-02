'use client';

import { useSyncExternalStore } from 'react';
import * as Y from 'yjs';

/**
 * Macros live in the spreadsheet's own Y.Doc (top-level map `macros`), so they sync live, travel with the file
 * (copies, version history) and need no extra API. Top-level Yjs types are addressed by name, so creating the
 * map on first use is safe even if two people do it at once.
 */
export const MACROS_MAP = 'macros';

export interface MacroDef {
  id: string;
  name: string;
  fn: string; // function to call
  code: string;
  shortcut: number | null; // Ctrl+Alt+Shift+<n>, 1–9
  updatedBy: string;
  updatedAt: string;
}

export const macrosOf = (doc: Y.Doc) => doc.getMap<MacroDef>(MACROS_MAP);

export function listMacros(doc: Y.Doc): MacroDef[] {
  return [...macrosOf(doc).values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function saveMacro(doc: Y.Doc, m: MacroDef) {
  macrosOf(doc).set(m.id, m);
}

export function deleteMacro(doc: Y.Doc, id: string) {
  macrosOf(doc).delete(id);
}

export interface VbaModule {
  name: string;
  kind: 'module' | 'document' | 'class';
  code: string;
}

/** VBA source kept from an imported .xlsm (written by the server at import; read-only here). */
export function useVba(doc: Y.Doc | null): VbaModule[] {
  return useSyncExternalStore(
    (cb) => {
      if (!doc) return () => undefined;
      const m = doc.getMap<VbaModule>('vba');
      m.observe(cb);
      return () => m.unobserve(cb);
    },
    () => {
      if (!doc) return EMPTY_VBA;
      const list = [...doc.getMap<VbaModule>('vba').entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, v]) => v);
      const key = JSON.stringify(list);
      const prev = vbaCache.get(doc);
      if (prev && prev.key === key) return prev.list;
      vbaCache.set(doc, { key, list });
      return list;
    },
    () => EMPTY_VBA,
  );
}
const EMPTY_VBA: VbaModule[] = [];
const vbaCache = new WeakMap<Y.Doc, { key: string; list: VbaModule[] }>();

/** Live list of macros. */
export function useMacros(doc: Y.Doc | null): MacroDef[] {
  return useSyncExternalStore(
    (cb) => {
      if (!doc) return () => undefined;
      const m = macrosOf(doc);
      m.observe(cb);
      return () => m.unobserve(cb);
    },
    () => (doc ? snapshot(doc) : EMPTY),
    () => EMPTY,
  );
}
const EMPTY: MacroDef[] = [];
const snapshots = new WeakMap<Y.Doc, { key: string; list: MacroDef[] }>();
function snapshot(doc: Y.Doc) {
  const list = listMacros(doc);
  const key = JSON.stringify(list);
  const prev = snapshots.get(doc);
  if (prev && prev.key === key) return prev.list;
  snapshots.set(doc, { key, list });
  return list;
}
