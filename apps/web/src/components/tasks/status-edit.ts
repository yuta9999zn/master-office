import type { TaskStatus } from '@workos/shared';

/** Board-side workflow edits (§76): statuses are the project's own list, not fixed in code. */
const PALETTE = ['#64748b', '#0ea5e9', '#2563eb', '#8b5cf6', '#14b8a6', '#f59e0b', '#f97316', '#ec4899', '#10b981', '#ef4444'];
export const STATUS_COLORS = PALETTE;

const slug = (name: string) => name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'status';

/**
 * Adds a status before the first finished one (so work flows left to right); in a strict workflow it is put on
 * the path: the column before it may move to it, and it may move to the column after it.
 */
export function addStatus(list: TaskStatus[], name: string, strict: boolean): TaskStatus[] {
  let id = slug(name);
  for (let i = 2; list.some((s) => s.id === id); i++) id = `${slug(name)}-${i}`;
  const at = list.findIndex((s) => s.category === 'done');
  const pos = at < 0 ? list.length : at;
  const prev = list[pos - 1];
  const next = list[pos];
  const color = PALETTE.find((c) => !list.some((s) => s.color === c)) ?? PALETTE[list.length % PALETTE.length];
  const created: TaskStatus = { id, name: name.trim().slice(0, 40), color, category: pos === 0 ? 'todo' : 'doing', ...(strict ? { next: next ? [next.id] : [] } : {}) };
  const out = [...list];
  out.splice(pos, 0, created);
  return strict && prev ? out.map((s) => (s.id === prev.id ? { ...s, next: [...new Set([...(s.next ?? []), id])] } : s)) : out;
}

export const renameStatus = (list: TaskStatus[], id: string, name: string) => list.map((s) => (s.id === id ? { ...s, name: name.trim().slice(0, 40) || s.name } : s));
export const recolorStatus = (list: TaskStatus[], id: string, color: string) => list.map((s) => (s.id === id ? { ...s, color } : s));
export function moveStatus(list: TaskStatus[], id: string, by: -1 | 1) {
  const i = list.findIndex((s) => s.id === id);
  const j = i + by;
  if (i < 0 || j < 0 || j >= list.length) return list;
  const out = [...list];
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}
/** Removes a status; the server moves its issues to the first status of the same kind. */
export const removeStatus = (list: TaskStatus[], id: string) => list.filter((s) => s.id !== id).map((s) => ({ ...s, ...(s.next ? { next: s.next.filter((n) => n !== id) } : {}) }));
