import { evalFormula, FormulaError, parseFormula, toText, type FValue } from './formula';
import { CHOICE_COLORS, COMPUTED_TYPES, type Attachment, type BaseField, type BaseRecord, type Choice } from './types';

/** What turning ids into words needs: people, linked records' titles, file names. */
export interface CellContext {
  fields: BaseField[];
  people: Map<string, { name: string; email?: string }>;
  /** Title (primary field text) of a record of another table. */
  linkTitle?: (tableId: string, recordId: string) => string | undefined;
  /** Record id from a title (CSV import / paste into a link field). */
  findLinked?: (tableId: string, title: string) => string | undefined;
  timeZone?: string;
  now?: Date;
}

const parsed = new Map<string, ReturnType<typeof parseFormula> | FormulaError>();
function compiled(expr: string) {
  let c = parsed.get(expr);
  if (!c) {
    try {
      c = parseFormula(expr);
    } catch (e) {
      c = e instanceof FormulaError ? e : new FormulaError(String(e));
    }
    if (parsed.size > 2000) parsed.clear();
    parsed.set(expr, c);
  }
  return c;
}

/** Checks a formula against a table's fields; returns the problem or null. */
export function formulaProblem(expr: string, fields: BaseField[], selfId?: string): string | null {
  const c = compiled(expr);
  if (c instanceof FormulaError) return c.message;
  const byName = new Map(fields.map((f) => [f.name, f]));
  for (const name of (expr.match(/\{([^}]*)\}/g) ?? []).map((m) => m.slice(1, -1))) {
    const f = byName.get(name);
    if (!f) return `No field named "${name}"`;
    if (f.id === selfId) return 'A formula cannot use itself';
  }
  return null;
}

/** A field's value as the formula language sees it. */
function asFormula(field: BaseField, rec: BaseRecord, ctx: CellContext, depth: number): FValue {
  const v = cellValue(field, rec, ctx, depth);
  if (v instanceof FormulaError) throw v;
  switch (field.type) {
    case 'singleSelect':
      return choiceName(field, v as string) ?? null;
    case 'multiSelect':
      return ((v as string[]) ?? []).map((id) => choiceName(field, id) ?? '');
    case 'person':
    case 'createdBy':
      return (Array.isArray(v) ? (v as string[]) : v ? [v as string] : []).map((id) => ctx.people.get(id)?.name ?? '');
    case 'link':
      return ((v as string[]) ?? []).map((id) => ctx.linkTitle?.(field.options.tableId ?? '', id) ?? '');
    case 'attachment':
      return ((v as Attachment[]) ?? []).map((a) => a.name);
    case 'checkbox':
      return !!v;
    default:
      return (v as FValue) ?? null;
  }
}

/** The value of any field of a record — stored, or computed (formula, auto number, created / modified). */
export function cellValue(field: BaseField, rec: BaseRecord, ctx: CellContext, depth = 0): unknown {
  switch (field.type) {
    case 'autoNumber':
      return rec.autoNumber;
    case 'createdTime':
      return rec.createdAt;
    case 'modifiedTime':
      return rec.updatedAt;
    case 'createdBy':
      return rec.createdBy;
    case 'formula': {
      if (depth > 8) return new FormulaError('Formulas refer to each other in a loop');
      const c = compiled(field.options.expression ?? '');
      if (c instanceof FormulaError) return c;
      try {
        return evalFormula(
          c,
          (name) => {
            const f = ctx.fields.find((x) => x.name === name);
            if (!f) throw new FormulaError(`No field named "${name}"`);
            if (f.id === field.id) throw new FormulaError('A formula cannot use itself');
            return asFormula(f, rec, ctx, depth + 1);
          },
          ctx.now,
        );
      } catch (e) {
        return e instanceof FormulaError ? e : new FormulaError(String(e));
      }
    }
    default:
      return rec.values[field.id];
  }
}

export const choiceName = (field: BaseField, id: string | null | undefined) => (id ? field.options.choices?.find((c) => c.id === id)?.name : undefined);
export const choiceOf = (field: BaseField, id: string | null | undefined) => (id ? field.options.choices?.find((c) => c.id === id) : undefined);

const pad = (n: number) => String(n).padStart(2, '0');
/** "2026-10-07" or "2026-10-07 14:30" in the given zone. */
export function formatDate(v: string, includeTime: boolean, timeZone = 'UTC') {
  if (!includeTime && /^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(d)
      .map((x) => [x.type, x.value]),
  );
  const day = `${p.year}-${p.month}-${p.day}`;
  return includeTime ? `${day} ${p.hour}:${p.minute}` : day;
}

export function formatNumber(field: BaseField, n: number) {
  const precision = field.options.precision ?? (field.type === 'currency' ? 0 : field.type === 'percent' ? 0 : 0);
  if (field.type === 'currency')
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: field.options.currency || 'JPY', minimumFractionDigits: precision, maximumFractionDigits: precision }).format(n);
  if (field.type === 'percent') return `${(n * 100).toFixed(precision)}%`;
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: precision, maximumFractionDigits: precision }).format(n);
}

/** A value as plain text (CSV, search, group labels). */
export function cellText(field: BaseField, value: unknown, ctx: CellContext): string {
  if (value instanceof FormulaError) return '#ERROR!';
  if (value === null || value === undefined || value === '') return '';
  switch (field.type) {
    case 'number':
    case 'currency':
    case 'percent':
      return typeof value === 'number' ? formatNumber(field, value) : String(value);
    case 'checkbox':
      return value ? 'checked' : '';
    case 'singleSelect':
      return choiceName(field, value as string) ?? '';
    case 'multiSelect':
      return ((value as string[]) ?? []).map((id) => choiceName(field, id) ?? '').filter(Boolean).join(', ');
    case 'date':
      return formatDate(String(value), !!field.options.includeTime, ctx.timeZone);
    case 'createdTime':
    case 'modifiedTime':
      return formatDate(String(value), true, ctx.timeZone);
    case 'person':
    case 'createdBy':
      return (Array.isArray(value) ? (value as string[]) : [value as string]).map((id) => ctx.people.get(id)?.name ?? 'Unknown').join(', ');
    case 'link':
      return ((value as string[]) ?? []).map((id) => ctx.linkTitle?.(field.options.tableId ?? '', id) ?? '').filter(Boolean).join(', ');
    case 'attachment':
      return ((value as Attachment[]) ?? []).map((a) => a.name).join(', ');
    case 'rating':
      return '★'.repeat(Number(value) || 0);
    case 'formula':
      return typeof value === 'number' ? (Number.isInteger(value) ? String(value) : String(Math.round(value * 1e6) / 1e6)) : toText(value as FValue);
    default:
      return String(value);
  }
}

/** Title of a record = its primary field as text. */
export function recordTitle(primary: BaseField | undefined, rec: BaseRecord, ctx: CellContext) {
  if (!primary) return '';
  return cellText(primary, cellValue(primary, rec, ctx), ctx);
}

export const isEmptyValue = (v: unknown) => v === null || v === undefined || v === '' || v === false || (Array.isArray(v) && !v.length);

const TRUE = new Set(['true', 'yes', 'y', '1', 'x', '✓', '✔', 'checked', 'on']);

/** Parses a date the way people type it: 2026-10-07, 2026/10/07, 10/07/2026, ISO date-times. */
export function parseDate(s: string, includeTime: boolean): string | null {
  const t = s.trim();
  if (!t) return null;
  let m = t.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?/);
  let y: number, mo: number, d: number, h = 0, mi = 0;
  if (m) [y, mo, d, h, mi] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4] ?? 0), Number(m[5] ?? 0)];
  else if ((m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/))) [mo, d, y, h, mi] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4] ?? 0), Number(m[5] ?? 0)];
  else {
    const dt = new Date(t);
    if (Number.isNaN(dt.getTime())) return null;
    return includeTime ? dt.toISOString() : dt.toISOString().slice(0, 10);
  }
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  if (/T.*(Z|[+-]\d{2}:?\d{2})$/.test(t)) {
    const dt = new Date(t);
    return includeTime ? dt.toISOString() : dt.toISOString().slice(0, 10);
  }
  const day = `${y}-${pad(mo)}-${pad(d)}`;
  return includeTime ? new Date(`${day}T${pad(h)}:${pad(mi)}:00Z`).toISOString() : day;
}

export interface CoerceOptions {
  /** Adds a missing choice (CSV import / paste); without it unknown options are dropped. */
  addChoice?: (field: BaseField, name: string) => Choice;
}

/**
 * Turns input (typed by the API client, pasted text, a CSV cell, a value of another field type) into what a field
 * stores. Returns undefined for computed fields and null for "empty / not understood".
 */
export function coerceValue(field: BaseField, raw: unknown, ctx: CellContext, opt: CoerceOptions = {}): unknown {
  if (COMPUTED_TYPES.includes(field.type)) return undefined;
  if (raw === undefined || raw === null || (typeof raw === 'string' && !raw.trim() && field.type !== 'text' && field.type !== 'longText')) return null;
  const s = typeof raw === 'string' ? raw : Array.isArray(raw) ? raw.map(String).join(',') : String(raw);
  switch (field.type) {
    case 'text':
      return s.replace(/\r?\n/g, ' ').slice(0, 10_000) || null;
    case 'longText':
      return s.slice(0, 100_000) || null;
    case 'url':
    case 'phone':
      return s.trim().slice(0, 2000) || null;
    case 'email': {
      const e = s.trim();
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : null;
    }
    case 'number':
    case 'currency':
    case 'rating':
    case 'percent': {
      let n: number;
      if (typeof raw === 'number') n = raw;
      else {
        const pct = /%\s*$/.test(s);
        n = Number(s.replace(/[^0-9.eE+-]/g, ''));
        if (s.replace(/[^0-9]/g, '') === '') return null;
        if (field.type === 'percent') n = pct || n > 1 ? n / 100 : n;
      }
      if (!Number.isFinite(n)) return null;
      if (field.type === 'rating') return Math.max(0, Math.min(field.options.max ?? 5, Math.round(n))) || null;
      return n;
    }
    case 'checkbox':
      return typeof raw === 'boolean' ? raw : TRUE.has(s.trim().toLowerCase());
    case 'singleSelect': {
      const name = s.trim();
      const c = field.options.choices?.find((x) => x.id === name || x.name.toLowerCase() === name.toLowerCase()) ?? (name && opt.addChoice ? opt.addChoice(field, name) : undefined);
      return c?.id ?? null;
    }
    case 'multiSelect': {
      const parts = Array.isArray(raw) ? raw.map(String) : s.split(',');
      const ids = parts
        .map((p) => p.trim())
        .filter(Boolean)
        .map((name) => (field.options.choices?.find((x) => x.id === name || x.name.toLowerCase() === name.toLowerCase()) ?? (opt.addChoice ? opt.addChoice(field, name) : undefined))?.id)
        .filter((x): x is string => !!x);
      return ids.length ? [...new Set(ids)] : null;
    }
    case 'date':
      if (typeof raw === 'string' || typeof raw === 'number') return parseDate(String(raw), !!field.options.includeTime);
      return null;
    case 'person': {
      const parts = Array.isArray(raw) ? raw.map(String) : s.split(',');
      const ids = parts
        .map((p) => p.trim().toLowerCase())
        .filter(Boolean)
        .map((p) => [...ctx.people].find(([id, u]) => id === p || u.name.toLowerCase() === p || u.email?.toLowerCase() === p)?.[0])
        .filter((x): x is string => !!x);
      const uniq = [...new Set(ids)];
      return uniq.length ? (field.options.multiple ? uniq : uniq.slice(0, 1)) : null;
    }
    case 'link': {
      const tableId = field.options.tableId ?? '';
      const parts = Array.isArray(raw) ? raw.map(String) : s.split(',');
      const ids = parts
        .map((p) => p.trim())
        .filter(Boolean)
        .map((p) => (/^[0-9a-f-]{36}$/i.test(p) ? p : ctx.findLinked?.(tableId, p)))
        .filter((x): x is string => !!x);
      return ids.length ? [...new Set(ids)] : null;
    }
    case 'attachment':
      if (!Array.isArray(raw)) return null;
      const files = raw
        .filter((a): a is Attachment => !!a && typeof a === 'object' && /^[0-9a-f-]{36}$/i.test(String((a as Attachment).id)))
        .map((a) => ({ id: a.id, name: String(a.name ?? 'file').slice(0, 255), mime: String(a.mime ?? 'application/octet-stream'), size: Number(a.size) || 0 }));
      return files.length ? [...new Map(files.map((a) => [a.id, a])).values()] : null;
    default:
      return null;
  }
}

let choiceSeq = 0;
/** A new select option with the next color. */
export function newChoice(field: BaseField, name: string): Choice {
  const n = field.options.choices?.length ?? 0;
  return { id: `c${Date.now().toString(36)}${(choiceSeq++).toString(36)}`, name: name.slice(0, 100), color: CHOICE_COLORS[n % CHOICE_COLORS.length] };
}
