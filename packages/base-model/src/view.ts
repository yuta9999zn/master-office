import { FormulaError } from './formula';
import { cellText, cellValue, choiceOf, isEmptyValue, type CellContext } from './cells';
import { COMPUTED_TYPES, type BaseField, type BaseRecord, type BaseTable, type BaseView, type FieldType, type FilterCondition, type FilterOp, type ViewConfig } from './types';

/** Filter operators that make sense for a field type, in menu order. */
export function filterOps(type: FieldType): FilterOp[] {
  switch (type) {
    case 'number':
    case 'currency':
    case 'percent':
    case 'rating':
    case 'autoNumber':
      return ['eq', 'neq', 'lt', 'lte', 'gt', 'gte', 'isEmpty', 'isNotEmpty'];
    case 'checkbox':
      return ['is'];
    case 'singleSelect':
      return ['is', 'isNot', 'isAnyOf', 'isEmpty', 'isNotEmpty'];
    case 'multiSelect':
      return ['hasAnyOf', 'hasAllOf', 'isEmpty', 'isNotEmpty'];
    case 'date':
    case 'createdTime':
    case 'modifiedTime':
      return ['is', 'before', 'after', 'isEmpty', 'isNotEmpty'];
    case 'person':
    case 'createdBy':
      return ['isMe', 'hasAnyOf', 'isEmpty', 'isNotEmpty'];
    case 'link':
    case 'attachment':
      return ['contains', 'isEmpty', 'isNotEmpty'];
    default:
      return ['contains', 'notContains', 'is', 'isNot', 'isEmpty', 'isNotEmpty'];
  }
}

export const FILTER_OP_LABEL: Record<FilterOp, string> = {
  contains: 'contains',
  notContains: 'does not contain',
  is: 'is',
  isNot: 'is not',
  isEmpty: 'is empty',
  isNotEmpty: 'is not empty',
  eq: '=',
  neq: '≠',
  lt: '<',
  lte: '≤',
  gt: '>',
  gte: '≥',
  isAnyOf: 'is any of',
  hasAnyOf: 'has any of',
  hasAllOf: 'has all of',
  before: 'is before',
  after: 'is after',
  isMe: 'is me',
};

/** Operators that need no value. */
export const UNARY_OPS: FilterOp[] = ['isEmpty', 'isNotEmpty', 'isMe'];

const dayOf = (v: unknown, timeZone?: string) => {
  const s = String(v ?? '');
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', { timeZone: timeZone ?? 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
};
const asList = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : v === null || v === undefined || v === '' ? [] : [String(v)]);

/** Does a record pass one condition? Conditions with no value yet pass (a half-built filter hides nothing). */
export function matchCondition(c: FilterCondition, field: BaseField, rec: BaseRecord, ctx: CellContext, me?: string): boolean {
  const v = cellValue(field, rec, ctx);
  const value = c.value;
  if (c.op === 'isEmpty') return v instanceof FormulaError ? false : isEmptyValue(v);
  if (c.op === 'isNotEmpty') return v instanceof FormulaError ? true : !isEmptyValue(v);
  if (c.op === 'isMe') return !!me && asList(v).includes(me);
  const missing = value === undefined || value === null || value === '' || (Array.isArray(value) && !value.length);
  if (missing && field.type !== 'checkbox') return true;
  switch (field.type) {
    case 'number':
    case 'currency':
    case 'percent':
    case 'rating':
    case 'autoNumber': {
      if (typeof v !== 'number') return c.op === 'neq';
      const n = Number(value);
      return { eq: v === n, neq: v !== n, lt: v < n, lte: v <= n, gt: v > n, gte: v >= n }[c.op as 'eq'] ?? true;
    }
    case 'checkbox':
      return !!v === (value === true || value === 'true');
    case 'singleSelect': {
      const list = asList(value);
      if (c.op === 'is') return v === list[0];
      if (c.op === 'isNot') return v !== list[0];
      return list.includes(String(v ?? ''));
    }
    case 'multiSelect':
    case 'person':
    case 'createdBy': {
      const has = asList(v);
      const want = asList(value);
      return c.op === 'hasAllOf' ? want.every((x) => has.includes(x)) : want.some((x) => has.includes(x));
    }
    case 'date':
    case 'createdTime':
    case 'modifiedTime': {
      const d = dayOf(v, ctx.timeZone);
      if (!d) return false;
      const want = String(value) === 'today' ? dayOf((ctx.now ?? new Date()).toISOString(), ctx.timeZone) : String(value).slice(0, 10);
      return c.op === 'before' ? d < want : c.op === 'after' ? d > want : d === want;
    }
    default: {
      const text = cellText(field, v, ctx).toLowerCase();
      const want = String(value).toLowerCase();
      if (c.op === 'contains') return text.includes(want);
      if (c.op === 'notContains') return !text.includes(want);
      if (c.op === 'is') return text === want;
      if (c.op === 'isNot') return text !== want;
      return true;
    }
  }
}

/** A comparable key: numbers, day strings, choice order, text; empty values sort last whatever the direction. */
function sortKey(field: BaseField, rec: BaseRecord, ctx: CellContext): number | string | null {
  const v = cellValue(field, rec, ctx);
  if (v instanceof FormulaError || isEmptyValue(v)) return field.type === 'checkbox' ? 0 : null;
  switch (field.type) {
    case 'number':
    case 'currency':
    case 'percent':
    case 'rating':
    case 'autoNumber':
      return Number(v);
    case 'checkbox':
      return v ? 1 : 0;
    case 'singleSelect': {
      const i = field.options.choices?.findIndex((x) => x.id === v) ?? -1;
      return i < 0 ? null : i;
    }
    case 'date':
    case 'createdTime':
    case 'modifiedTime':
      return String(v);
    case 'formula':
      return typeof v === 'number' ? v : cellText(field, v, ctx).toLowerCase();
    default:
      return cellText(field, v, ctx).toLowerCase();
  }
}

const cmp = (a: number | string | null, b: number | string | null) => {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true });
};

export interface ViewGroup {
  /** Stable key of the group value ('' for empty). */
  key: string;
  label: string;
  color?: string;
  records: BaseRecord[];
}

export interface ViewResult {
  records: BaseRecord[];
  groups: ViewGroup[] | null;
}

/** Filters, searches, sorts and groups a table's records the way a view says. */
export function applyView(table: Pick<BaseTable, 'fields'>, records: BaseRecord[], view: Pick<BaseView, 'config'> | null, ctx: CellContext, opts: { me?: string; search?: string } = {}): ViewResult {
  const cfg = view?.config;
  const byId = new Map(table.fields.map((f) => [f.id, f]));
  let out = records;
  const conds = (cfg?.filters.conditions ?? []).filter((c) => byId.has(c.fieldId));
  if (conds.length) {
    const and = cfg!.filters.conjunction !== 'or';
    out = out.filter((r) => (and ? conds.every((c) => matchCondition(c, byId.get(c.fieldId)!, r, ctx, opts.me)) : conds.some((c) => matchCondition(c, byId.get(c.fieldId)!, r, ctx, opts.me))));
  }
  const q = opts.search?.trim().toLowerCase();
  if (q) {
    const shown = visibleFields(table, view);
    out = out.filter((r) => shown.some((f) => cellText(f, cellValue(f, r, ctx), ctx).toLowerCase().includes(q)));
  }
  const sorts = (cfg?.sorts ?? []).filter((s) => byId.has(s.fieldId));
  const group = cfg?.groupBy && byId.has(cfg.groupBy.fieldId) ? cfg.groupBy : null;
  const keys = [...(group ? [group] : []), ...sorts];
  if (keys.length) {
    const cache = new Map<string, (number | string | null)[]>();
    const keyOf = (r: BaseRecord) => {
      let k = cache.get(r.id);
      if (!k) cache.set(r.id, (k = keys.map((s) => sortKey(byId.get(s.fieldId)!, r, ctx))));
      return k;
    };
    out = [...out].sort((a, b) => {
      const ka = keyOf(a);
      const kb = keyOf(b);
      for (let i = 0; i < keys.length; i++) {
        const c = cmp(ka[i], kb[i]);
        if (c) return keys[i].dir === 'desc' && ka[i] !== null && kb[i] !== null ? -c : c;
      }
      return a.position < b.position ? -1 : a.position > b.position ? 1 : 0;
    });
  }
  if (!group) return { records: out, groups: null };
  const gf = byId.get(group.fieldId)!;
  const groups: ViewGroup[] = [];
  const at = new Map<string, ViewGroup>();
  for (const r of out) {
    const v = cellValue(gf, r, ctx);
    const key = v instanceof FormulaError || isEmptyValue(v) ? '' : Array.isArray(v) ? v.join(',') : String(v);
    let g = at.get(key);
    if (!g) {
      const choice = gf.type === 'singleSelect' ? choiceOf(gf, key) : undefined;
      g = { key, label: key ? cellText(gf, v, ctx) || key : `No ${gf.name}`, color: choice?.color, records: [] };
      at.set(key, g);
      groups.push(g);
    }
    g.records.push(r);
  }
  return { records: out, groups };
}

/** The fields a view shows, in its order (the primary field always first). */
export function visibleFields(table: Pick<BaseTable, 'fields'> & { primaryFieldId?: string }, view: Pick<BaseView, 'config'> | null): BaseField[] {
  const cfg = view?.config;
  const hidden = new Set(cfg?.hidden ?? []);
  const order = cfg?.order ?? [];
  const rank = (f: BaseField) => {
    if (f.id === table.primaryFieldId) return -1;
    const i = order.indexOf(f.id);
    return i < 0 ? 10_000 + f.position : i;
  };
  return table.fields.filter((f) => f.id === table.primaryFieldId || !hidden.has(f.id)).sort((a, b) => rank(a) - rank(b));
}

/** Values a new record gets so that it shows in the filtered view it was added from. */
export function defaultsForView(table: Pick<BaseTable, 'fields'>, view: Pick<BaseView, 'config'> | null, me?: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!view || view.config.filters.conjunction === 'or') return out;
  for (const c of view.config.filters.conditions) {
    const f = table.fields.find((x) => x.id === c.fieldId);
    if (!f || COMPUTED_TYPES.includes(f.type)) continue;
    if (c.op === 'is' && f.type === 'singleSelect' && c.value) out[f.id] = Array.isArray(c.value) ? c.value[0] : c.value;
    else if (c.op === 'is' && f.type === 'checkbox') out[f.id] = c.value === true || c.value === 'true';
    else if (c.op === 'isMe' && f.type === 'person' && me) out[f.id] = [me];
    else if ((c.op === 'is' || c.op === 'eq') && c.value !== undefined && c.value !== '' && ['text', 'number', 'currency', 'percent', 'rating', 'date', 'email', 'url', 'phone'].includes(f.type)) out[f.id] = c.value;
  }
  return out;
}

/** Summary row of the grid: per-field aggregate over the shown records. */
export type Summary = NonNullable<ViewConfig['summaries']>[string];
export function summarize(field: BaseField, records: BaseRecord[], ctx: CellContext, how: Summary): string {
  if (how === 'none') return '';
  const vals = records.map((r) => cellValue(field, r, ctx));
  if (how === 'count') return String(records.length);
  if (how === 'filled') return String(vals.filter((v) => !(v instanceof FormulaError) && !isEmptyValue(v)).length);
  if (how === 'empty') return String(vals.filter((v) => !(v instanceof FormulaError) && isEmptyValue(v)).length);
  if (how === 'checked') return `${vals.filter((v) => v === true).length} / ${vals.length}`;
  const nums = vals.filter((v): v is number => typeof v === 'number');
  if (!nums.length) return '—';
  const n = how === 'sum' ? nums.reduce((s, x) => s + x, 0) : how === 'avg' ? nums.reduce((s, x) => s + x, 0) / nums.length : how === 'min' ? Math.min(...nums) : Math.max(...nums);
  // An average of whole numbers still shows its decimals.
  const precision = Number.isInteger(n) ? (field.options.precision ?? 0) : Math.max(field.options.precision ?? 0, 2);
  const shown = field.type === 'currency' || field.type === 'percent' ? field : { ...field, type: 'number' as const, options: { precision } };
  return cellText(shown, n, ctx);
}
