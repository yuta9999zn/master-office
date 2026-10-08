// AI → Sheets (docs/ARCHITECTURE.md §80). Small local models write wrong A1 formulas, so they don't write formulas:
// they DECLARE them — a lookup ("price comes from Price list, matched by Service"), a calculation ("Sessions * Unit
// price"), metrics ("sum of Amount where Payment = Cash") and breakdowns ("Amount by Payment"). This file writes the
// Excel-identical formulas (INDEX/MATCH, SUMIFS, COUNTIFS, SUBTOTAL), resolves column names loosely (accents, near
// matches, the column's type), repairs A1 formulas the model wrote anyway, and lays the workbook out like a hand-made
// business file: styled header, number / date formats, drop-down lists, checkboxes, frozen header, filter, totals.
import { emptySheet, newId, type Cell, type CellStyle, type PlainSheet, type PlainWorkbook } from '@workos/sheet-model';

export type ColumnType = 'text' | 'number' | 'money' | 'percent' | 'date' | 'select' | 'checkbox' | 'id' | 'lookup' | 'calc' | 'formula';
const COLUMN_TYPES: ColumnType[] = ['text', 'number', 'money', 'percent', 'date', 'select', 'checkbox', 'id', 'lookup', 'calc', 'formula'];
type Op = 'sum' | 'count' | 'average' | 'min' | 'max' | 'calc';

export interface SheetSpecColumn {
  name: string;
  type: ColumnType;
  /** select: the drop-down choices. */
  options?: string[];
  /** lookup: take `value` from `sheet`, on the row where `match` (default: same name as `key`) equals this row's `key`. */
  lookup?: { sheet: string; key: string; value: string; match?: string; also?: { key: string; match: string }[] };
  /** lookup / calc: what the result looks like. */
  format?: 'text' | 'number' | 'money' | 'percent' | 'date';
  /** calc: an expression with column names, e.g. "Sessions * Unit price" or "Amount - Discount". */
  calc?: string;
  /** formula: a raw formula, columns in braces: "=IF({Paid},{Amount},0)". */
  formula?: string;
}
export interface SheetSpecMetric {
  label: string;
  op: Op;
  sheet?: string;
  column?: string;
  where?: { column: string; equals: string };
  /** op calc: an expression with other metric labels, e.g. "Revenue - Expenses". */
  expr?: string;
}
export interface SheetSpecBreakdown {
  title?: string;
  sheet: string;
  /** A select (or text) column: one row per choice. */
  by: string;
  op: 'sum' | 'count';
  value?: string;
}
export interface SheetSpecTable {
  name: string;
  columns?: SheetSpecColumn[];
  rows?: (string | number | boolean | null)[][];
  totals?: boolean;
  metrics?: SheetSpecMetric[];
  breakdowns?: SheetSpecBreakdown[];
}
export interface SheetSpec {
  title: string;
  sheets: SheetSpecTable[];
  /** Read from the request (not from the model): drop-down choices and lookup sources by sheet and column. */
  hints?: SheetHints;
}
export type SheetHints = Record<string, Record<string, { options?: string[]; from?: string }>>;

const cellValue = { anyOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }, { type: 'null' }] };
const resultFormat = { type: 'string', enum: ['text', 'number', 'money', 'percent', 'date'] };
export const SHEET_SPEC_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    sheets: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          columns: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                type: { type: 'string', enum: COLUMN_TYPES },
                options: { type: 'array', items: { type: 'string' } },
                lookup: { type: 'object', properties: { sheet: { type: 'string' }, key: { type: 'string' }, match: { type: 'string' }, value: { type: 'string' } }, required: ['sheet', 'key', 'value'] },
                calc: { type: 'string' },
                format: resultFormat,
                formula: { type: 'string' },
              },
              required: ['name', 'type'],
            },
          },
          rows: { type: 'array', items: { type: 'array', items: cellValue } },
          totals: { type: 'boolean' },
          metrics: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                label: { type: 'string' },
                op: { type: 'string', enum: ['sum', 'count', 'average', 'min', 'max', 'calc'] },
                sheet: { type: 'string' },
                column: { type: 'string' },
                where: { type: 'object', properties: { column: { type: 'string' }, equals: { type: 'string' } }, required: ['column', 'equals'] },
                expr: { type: 'string' },
              },
              required: ['label', 'op'],
            },
          },
          breakdowns: {
            type: 'array',
            items: {
              type: 'object',
              properties: { title: { type: 'string' }, sheet: { type: 'string' }, by: { type: 'string' }, op: { type: 'string', enum: ['sum', 'count'] }, value: { type: 'string' } },
              required: ['sheet', 'by', 'op'],
            },
          },
        },
        required: ['name'],
      },
    },
  },
  required: ['title', 'sheets'],
};

// ── Styles ──────────────────────────────────────────────────────────────────

function border(rgb: string): CellStyle['bd'] {
  const b = { s: 1, cl: { rgb } };
  return { t: b, b, l: b, r: b };
}
const HEADER: CellStyle = { bl: 1, cl: { rgb: '#FFFFFF' }, bg: { rgb: '#2563EB' }, ht: 2, vt: 2, tb: 3, bd: border('#1D4ED8') };
const AUTO: CellStyle = { bg: { rgb: '#F8FAFC' } }; // computed columns: a hint not to type there
const TOTAL: CellStyle = { bl: 1, bg: { rgb: '#EFF6FF' }, bd: border('#BFDBFE') };
const LABEL: CellStyle = { bl: 1 };
const SECTION: CellStyle = { bl: 1, fs: 12, cl: { rgb: '#1E3A8A' } };

// ── Names ───────────────────────────────────────────────────────────────────

const col = (i: number) => {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};
/** Lower case, no accents (đ → d), single spaces: "Thành tiền" ≈ "thanh tien". */
const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
const quoteSheet = (name: string) => (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ? name : `'${name.replace(/'/g, "''")}'`);

/** English words small models fall back to → the kind of column they mean. */
const KIND_WORDS: [RegExp, (c: SheetSpecColumn) => boolean][] = [
  [/\b(amount|total|revenue|subtotal|thanh tien|so tien|tong tien|doanh thu|kingaku|gokei)\b|金額|合計|売上/, (c) => c.type === 'money' || c.format === 'money'],
  [/\b(price|unit price|don gia|gia)\b|単価|価格/, (c) => c.type === 'money' || c.format === 'money'],
  [/\b(id|code|ma|ma kh|ma khach hang|customer id)\b|コード|番号/, (c) => c.type === 'id'],
  [/\b(date|ngay)\b|日付|日/, (c) => c.type === 'date'],
  [/\b(qty|quantity|so luong|so buoi|sessions|count)\b|数量|回数/, (c) => c.type === 'number'],
  [/\b(name|ten|ho ten)\b|名前|氏名/, (c) => c.type === 'text' || c.type === 'lookup'],
  [/\b(payment|method|status|type|loai|hinh thuc|trang thai)\b|支払|状態|種類/, (c) => c.type === 'select'],
];

function tokens(s: string) {
  return new Set(fold(s).split(' ').filter((w) => w.length > 1));
}

interface Table {
  name: string;
  columns: SheetSpecColumn[];
  rows: (string | number | boolean | null)[][];
  totals: boolean;
  metrics: SheetSpecMetric[];
  breakdowns: SheetSpecBreakdown[];
  summary: boolean;
}

// ── Values ──────────────────────────────────────────────────────────────────

function toSerial(v: unknown): number | null {
  if (typeof v === 'number') return v > 20000 && v < 80000 ? v : null;
  const s = String(v ?? '').trim();
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(s);
  let y: number, mo: number, d: number;
  if (m) [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  else if ((m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/.exec(s))) [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  else return null;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return (Date.UTC(y, mo - 1, d) - Date.UTC(1899, 11, 30)) / 86_400_000;
}
const num = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const s = String(v ?? '').replace(/[^\d.,-]/g, '');
  if (!s) return null;
  const parts = s.split(/[.,]/);
  const n = parts.length === 2 && parts[1].length <= 2 ? Number(`${parts[0]}.${parts[1]}`) : Number(parts.join(''));
  return Number.isFinite(n) ? n : null;
};

export interface SheetBuild {
  workbook: PlainWorkbook;
  warnings: string[];
  fixes: string[];
}

const WORDS = {
  vi: { metric: 'Chỉ tiêu', value: 'Giá trị', total: 'Tổng cộng', by: 'theo' },
  ja: { metric: '項目', value: '値', total: '合計', by: '別' },
  en: { metric: 'Metric', value: 'Value', total: 'Total', by: 'by' },
};

/** Repairs and builds the workbook. */
export function workbookFromSpec(raw: Partial<SheetSpec>, opts: { locale?: 'vi' | 'ja' | 'en'; hints?: SheetHints } = {}): SheetBuild {
  const warnings: string[] = [];
  const fixes: string[] = [];
  const words = WORDS[opts.locale ?? 'en'];
  const dateFmt = opts.locale === 'vi' ? 'dd/mm/yyyy' : opts.locale === 'ja' ? 'yyyy/mm/dd' : 'yyyy-mm-dd';

  // ── 1. Clean tables ───────────────────────────────────────────────────────
  const used = new Set<string>();
  const tables: Table[] = (raw.sheets ?? [])
    .filter((t) => t && typeof t === 'object')
    .slice(0, 10)
    .map((t, i) => {
      let name = String(t.name ?? `Sheet${i + 1}`).replace(/[\\/?*[\]:]/g, ' ').trim().slice(0, 31) || `Sheet${i + 1}`;
      while (used.has(fold(name))) name = `${name.slice(0, 28)} ${i + 1}`;
      used.add(fold(name));
      const columns = (Array.isArray(t.columns) ? t.columns : []).slice(0, 40).map((c, ci) => {
        const type = (COLUMN_TYPES.includes(c?.type) ? c.type : c?.lookup ? 'lookup' : c?.calc ? 'calc' : c?.formula ? 'formula' : 'text') as ColumnType;
        return { ...c, name: String(c?.name ?? `Column ${ci + 1}`).trim().slice(0, 60) || `Column ${ci + 1}`, type, options: (c?.options ?? []).map((o) => String(o).trim()).filter(Boolean).slice(0, 50) };
      });
      const metrics = (t.metrics ?? []).filter((m) => m && m.label && m.op).slice(0, 40);
      const breakdowns = (t.breakdowns ?? []).filter((b) => b && b.sheet && b.by).slice(0, 10);
      const rows = (Array.isArray(t.rows) ? t.rows : []).filter(Array.isArray).slice(0, 500);
      return { name, columns, rows, totals: !!t.totals, metrics, breakdowns, summary: !!(metrics.length || breakdowns.length) && !rows.some((r) => r.some((v) => v !== null && v !== '')) };
    })
    .filter((t) => t.columns.length || t.metrics.length || t.breakdowns.length);
  if (!tables.length) throw new Error('The model described no sheet');

  // ── 2. Loose name resolution ──────────────────────────────────────────────
  const findTable = (name: string | undefined, from?: Table): Table | null => {
    if (!name) return from ?? null;
    const f = fold(name);
    return (
      tables.find((t) => fold(t.name) === f) ??
      tables.find((t) => fold(t.name).includes(f) || f.includes(fold(t.name))) ??
      [...tables].map((t) => ({ t, s: overlap(tokens(t.name), tokens(name)) })).sort((a, b) => b.s - a.s).find((x) => x.s >= 0.5)?.t ??
      null
    );
  };
  const findColumn = (t: Table, name: string | undefined, prefer?: (c: SheetSpecColumn) => boolean): number => {
    if (!name || !t.columns.length) return -1;
    const f = fold(name);
    let i = t.columns.findIndex((c) => fold(c.name) === f);
    if (i < 0) i = t.columns.findIndex((c) => fold(c.name).includes(f) || f.includes(fold(c.name)));
    if (i < 0) {
      const scored = t.columns.map((c, ci) => ({ ci, s: overlap(tokens(c.name), tokens(name)) })).sort((a, b) => b.s - a.s);
      if (scored[0]?.s >= 0.5) i = scored[0].ci;
    }
    if (i < 0) {
      // By meaning: "Amount" → the money column, "Customer ID" → the id column…
      for (const [re, test] of KIND_WORDS) {
        if (!re.test(f)) continue;
        const hits = t.columns.map((c, ci) => ({ c, ci })).filter(({ c }) => test(c) && (!prefer || prefer(c)));
        // The last money column is usually the line total; the first id / date / name column is the key one.
        const pick = /amount|total|thanh tien|so tien|doanh thu|金額|合計/.test(f) ? hits[hits.length - 1] : hits[0];
        if (pick) {
          i = pick.ci;
          break;
        }
      }
    }
    return i;
  };
  function overlap(a: Set<string>, b: Set<string>) {
    if (!a.size || !b.size) return 0;
    let n = 0;
    for (const w of a) if (b.has(w)) n++;
    return n / Math.min(a.size, b.size);
  }

  // ── 3. Layout: data tables first, then summaries (they reference the others) ──
  const dataLast = (t: Table) => Math.max(1000, t.rows.length + 1);
  const range = (t: Table, ci: number, from?: Table) => `${from && from === t ? '' : `${quoteSheet(t.name)}!`}$${col(ci)}$2:$${col(ci)}$${dataLast(t)}`;

  // Repairs A1 formulas the model wrote anyway: "{...}" placeholders resolve, raw A1 is kept only if it looks sane.
  const resolveBraces = (formula: string, t: Table, r: number) =>
    formula.replace(/\{([^{}]+)\}/g, (m, ref: string) => {
      const bang = ref.lastIndexOf('!');
      const [sheetName, colName] = bang >= 0 ? [ref.slice(0, bang), ref.slice(bang + 1)] : [null, ref];
      const target = sheetName === null ? t : findTable(sheetName);
      const ci = target ? findColumn(target, colName) : -1;
      if (!target || ci < 0) {
        warnings.push(`${t.name}: unknown column ${m}`);
        return '#REF!';
      }
      return sheetName === null || target === t ? (sheetName === null ? `${col(ci)}${r + 1}` : range(target, ci, t)) : range(target, ci, t);
    });

  const lookupFormula = (t: Table, c: SheetSpecColumn, r: number): string | null => {
    const lk = c.lookup!;
    const src = findTable(lk.sheet);
    if (!src || src === t) return null;
    const keyHere = findColumn(t, lk.key);
    const matchThere = findColumn(src, lk.match ?? lk.key);
    const valueThere = findColumn(src, lk.value ?? c.name);
    if (keyHere < 0 || matchThere < 0 || valueThere < 0) return null;
    // Two or more keys ("Service" + "Type" in a price list) and a numeric value: SUMIFS on every key.
    const more = (lk.also ?? []).map((a) => ({ here: findColumn(t, a.key), there: findColumn(src, a.match) })).filter((a) => a.here >= 0 && a.there >= 0);
    const numeric = ['money', 'number', 'percent'].includes(src.columns[valueThere].type) || ['money', 'number'].includes(src.columns[valueThere].format ?? '');
    if (more.length && numeric) {
      const crit = [{ here: keyHere, there: matchThere }, ...more].map((k) => `${range(src, k.there)},${col(k.here)}${r + 1}`).join(',');
      return `=SUMIFS(${range(src, valueThere)},${crit})`;
    }
    return `=IFERROR(INDEX(${range(src, valueThere)},MATCH(${col(keyHere)}${r + 1},${range(src, matchThere)},0)),"")`;
  };

  /** "Sessions * Unit price - Discount" → "=E5*G5-H5": column names (longest first) become this row's cells. */
  const calcFormula = (t: Table, expr: string, r: number): string | null => {
    let e = ` ${expr.replace(/^=/, '')} `;
    const names = t.columns.map((c, ci) => ({ n: c.name, ci })).sort((a, b) => b.n.length - a.n.length);
    let hit = false;
    for (const { n, ci } of names) {
      const esc = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(`(^|[\\s(+\\-*/,])${esc}(?=$|[\\s)+\\-*/,])`, 'giu');
      e = e.replace(re, (_m, pre: string) => {
        hit = true;
        return `${pre}${col(ci)}${r + 1}`;
      });
    }
    // Braces work too: {Sessions} * {Unit price}.
    if (/\{/.test(e)) {
      e = resolveBraces(e, t, r);
      hit = true;
    }
    const out = e.trim();
    if (!hit || !/^[A-Z0-9$.\s()+\-*/%,"<>=!&^]+$/i.test(out.replace(/[A-Z]{1,3}\d+/g, 'X'))) return null;
    return `=${out}`;
  };

  /** What the model wrote as a raw A1 formula is usually wrong; infer the intent from the column instead. */
  const inferFormula = (t: Table, c: SheetSpecColumn, ci: number): Partial<SheetSpecColumn> | null => {
    const f = fold(c.name);
    // Line total = quantity × price of this row.
    if (/amount|total|subtotal|thanh tien|so tien|金額|合計/.test(f)) {
      const qty = t.columns.findIndex((x, xi) => xi !== ci && x.type === 'number');
      const price = t.columns.findIndex((x, xi) => xi !== ci && (x.type === 'money' || x.format === 'money' || x.lookup) && /price|gia|単価|価格/.test(fold(x.name)));
      if (qty >= 0 && price >= 0) return { type: 'calc', calc: `${t.columns[qty].name} * ${t.columns[price].name}`, format: 'money' };
    }
    // A value another sheet holds under the same name, looked up by a key both sheets share.
    for (const src of tables) {
      if (src === t || src.summary) continue;
      const valueThere = findColumn(src, c.name);
      if (valueThere < 0) continue;
      const key = t.columns.findIndex((x, xi) => xi !== ci && (x.type === 'id' || x.type === 'select' || x.type === 'text') && findColumn(src, x.name) >= 0 && findColumn(src, x.name) !== valueThere);
      if (key < 0) continue;
      const fmt = src.columns[valueThere].type;
      return { type: 'lookup', lookup: { sheet: src.name, key: t.columns[key].name, match: src.columns[findColumn(src, t.columns[key].name)].name, value: src.columns[valueThere].name }, format: fmt === 'money' || fmt === 'number' || fmt === 'date' ? fmt : 'text' };
    }
    return null;
  };

  /**
   * A lookup of column `c` into `src`: the value is src's column of the same name (or meaning: "Đơn giá" → the price
   * column), the key is a column this sheet shares with src ("Mã KH" ↔ "Mã KH", "Dịch vụ" ↔ "Tên dịch vụ").
   */
  const inferLookup = (t: Table, c: SheetSpecColumn, ci: number, src: Table): SheetSpecColumn['lookup'] | null => {
    // Exact name first; then by meaning — a name column for "Tên KH" (not "Mã KH", which shares "KH"), a price for
    // "Đơn giá"; then a loose match.
    let value = src.columns.findIndex((x) => fold(x.name) === fold(c.name));
    if (value < 0 && /\b(ten|name|ho ten)\b|名/.test(fold(c.name))) value = src.columns.findIndex((x, xi) => xi > 0 && /\b(ten|name|ho ten)\b|名/.test(fold(x.name)));
    if (value < 0 && /\b(gia|price|don gia)\b|単価|価格/.test(fold(c.name))) value = src.columns.findIndex((x) => x.type === 'money' || x.format === 'money');
    if (value < 0) value = findColumn(src, c.name);
    if (value < 0) return null;
    // Every column the two sheets share is a candidate key; the best one leads, the others narrow it down.
    const pairs: { key: number; match: number; score: number }[] = [];
    t.columns.forEach((x, xi) => {
      // Computed columns are not keys — except one the model wrongly marked as a lookup that the master really has ("Mã KH").
      if (xi === ci || x.type === 'calc' || (x.type === 'lookup' && !src.columns.some((y) => fold(y.name) === fold(x.name)))) return;
      if (x.type === 'date' || /^(ngay|date)\b|日付/.test(fold(x.name))) return; // dates are never keys
      let bestHere = { key: -1, match: -1, score: 0 };
      src.columns.forEach((y, yi) => {
        if (yi === value || y.type === 'date') return;
        const s = fold(x.name) === fold(y.name) ? 2 : overlap(tokens(x.name), tokens(y.name));
        // Identifiers and the first column of a master list make the best keys.
        const bonus = (y.type === 'id' || yi === 0 ? 0.3 : 0) + (x.type === 'id' ? 0.2 : 0);
        if (s >= 0.5 && s + bonus > bestHere.score) bestHere = { key: xi, match: yi, score: s + bonus };
      });
      if (bestHere.key >= 0 && !pairs.some((p) => p.match === bestHere.match)) pairs.push(bestHere);
    });
    if (!pairs.length) return null;
    pairs.sort((a, b) => b.score - a.score);
    const [first, ...rest] = pairs;
    // A unique code identifies the row alone; names and types together (service + package) need every key.
    const unique = src.columns[first.match].type === 'id' || (first.match === 0 && /\b(ma|id|code)\b|コード|番号/.test(fold(src.columns[0].name)));
    return {
      sheet: src.name,
      key: t.columns[first.key].name,
      match: src.columns[first.match].name,
      value: src.columns[value].name,
      ...(!unique && rest.length ? { also: rest.slice(0, 2).map((p) => ({ key: t.columns[p.key].name, match: src.columns[p.match].name })) } : {}),
    };
  };
  const amountLike = (s: string) => /\b(amount|total|subtotal|line total|thanh tien|tong tien)\b|金額|合計/.test(fold(s)) || /thành tiền|tổng tiền/i.test(s);
  const priceLike = (s: string) => /\b(price|unit price|don gia|gia)\b|単価|価格/.test(fold(s));
  const qtyLike = (s: string) => /\b(qty|quantity|so luong|so buoi|sessions|count|so lan)\b|数量|回数/.test(fold(s));

  // Hints read from the request ("giới tính (Nam/Nữ)", "tên KH tự lấy từ DATA KH").
  for (const [sheetName, cols] of Object.entries(opts.hints ?? {})) {
    const t = findTable(sheetName);
    if (!t) continue;
    for (const [colName, h] of Object.entries(cols)) {
      const ci = findColumn(t, colName);
      if (ci < 0) continue;
      const c = t.columns[ci];
      if (h.options?.length && c.type !== 'lookup' && c.type !== 'calc') Object.assign(c, { type: 'select', options: h.options });
      if (h.from) {
        const src = findTable(h.from);
        const lk = src && src !== t ? inferLookup(t, c, ci, src) : null;
        if (lk) {
          const fmt = src!.columns[findColumn(src!, lk.value)]?.type;
          Object.assign(c, { type: 'lookup', lookup: lk, format: fmt === 'money' || fmt === 'number' || fmt === 'date' ? fmt : 'text' });
        }
      }
    }
  }

  for (const t of tables) {
    t.columns.forEach((c, ci) => {
      if (c.type === 'formula' && c.formula && !/\{/.test(c.formula)) {
        const fix = inferFormula(t, c, ci);
        if (fix) {
          Object.assign(c, fix, { formula: undefined });
          fixes.push(`${t.name} › ${c.name}: replaced a hand-written formula with a ${fix.type}`);
        }
      }
      if (c.type === 'lookup') {
        const src = c.lookup ? findTable(c.lookup.sheet) : null;
        // The master's own key ("Mã KH" in sales, keyed by "Mã KH" in the customer list) is typed in, not looked up.
        if (src && src !== t && src.columns.length && (fold(src.columns[0].name) === fold(c.name) || src.columns.some((x) => x.type === 'id' && fold(x.name) === fold(c.name)))) {
          c.type = 'id';
          delete c.lookup;
          return;
        }
        // A lookup must copy another column than its key, through a key this sheet really has.
        const ok = src && src !== t && findColumn(t, c.lookup!.key) >= 0 && findColumn(t, c.lookup!.key) !== ci && findColumn(src, c.lookup!.value) >= 0 && findColumn(src, c.lookup!.match ?? c.lookup!.key) >= 0 && findColumn(src, c.lookup!.value) !== findColumn(src, c.lookup!.match ?? c.lookup!.key);
        if (!ok) {
          const lk = src && src !== t ? inferLookup(t, c, ci, src) : null;
          const fix = lk ? { lookup: lk } : inferFormula(t, c, ci);
          if (fix && (fix.lookup || fix.type)) {
            Object.assign(c, fix);
            fixes.push(`${t.name} › ${c.name}: corrected the lookup`);
          } else {
            // A key column the model marked as a lookup ("Mã KH") is just typed in.
            c.type = /\b(ma|id|code)\b|コード/.test(fold(c.name)) ? 'id' : 'text';
            delete c.lookup;
            fixes.push(`${t.name} › ${c.name}: kept as a typed column (nothing to look it up in)`);
          }
        } else if (!c.lookup!.also) {
          // The model's key may need a second one (service AND package type pick the price).
          const lk = inferLookup(t, c, ci, src!);
          if (lk?.also && fold(lk.value) === fold(c.lookup!.value)) c.lookup = lk;
        }
      }
      if (c.type === 'calc' && !c.calc) {
        const fix = inferFormula(t, c, ci);
        if (fix?.calc) Object.assign(c, fix);
        else c.type = 'number';
      }
    });
    // A line total is quantity × price, whatever type the model gave it.
    const amount = t.columns.findIndex((c) => amountLike(c.name) && c.type !== 'lookup');
    const qty = t.columns.findIndex((c) => (c.type === 'number' || c.type === 'calc') && qtyLike(c.name));
    const price = t.columns.findIndex((c, ci) => ci !== amount && priceLike(c.name));
    if (amount >= 0 && qty >= 0 && price >= 0 && t.columns[amount].type !== 'calc' && t.rows.length) {
      Object.assign(t.columns[amount], { type: 'calc', calc: `${t.columns[qty].name} * ${t.columns[price].name}`, format: 'money' });
      fixes.push(`${t.name} › ${t.columns[amount].name}: = ${t.columns[qty].name} × ${t.columns[price].name}`);
    }
    // A data sheet without its line total gets one when it has a quantity and a price.
    if (amount < 0 && qty >= 0 && price >= 0 && !t.summary && t.rows.length) {
      const name = opts.locale === 'vi' ? 'Thành tiền' : opts.locale === 'ja' ? '金額' : 'Amount';
      t.columns.splice(price + 1, 0, { name, type: 'calc', calc: `${t.columns[qty].name} * ${t.columns[price].name}`, format: 'money' });
      t.rows = t.rows.map((r) => [...r.slice(0, price + 1), null, ...r.slice(price + 1)]);
      fixes.push(`${t.name}: added ${name} = ${t.columns[qty].name} × ${t.columns[price].name}`);
    }
    // The money columns of a priced sheet show its total.
    if (!t.summary && t.rows.length && t.columns.some((c) => c.type === 'money' || c.format === 'money')) t.totals ||= t.columns.some((c) => amountLike(c.name));
  }
  // A column named like a drop-down of another sheet is that drop-down ("Loại" in sales = "Loại" in the price list).
  for (const t of tables)
    for (const c of t.columns) {
      if (c.type !== 'text' || c.options?.length) continue;
      for (const o of tables) {
        if (o === t) continue;
        const oi = o.columns.findIndex((x) => fold(x.name) === fold(c.name) && x.type === 'select' && x.options?.length);
        if (oi >= 0) {
          Object.assign(c, { type: 'select', options: o.columns[oi].options });
          break;
        }
      }
    }
  // Reports: revenue sums money, not quantities or unit prices.
  for (const t of tables.filter((x) => x.summary)) {
    const amountOf = (src: Table) => src.columns.findIndex((c) => amountLike(c.name)) >= 0 ? src.columns.findIndex((c) => amountLike(c.name)) : src.columns.findIndex((c) => c.type === 'money' || c.format === 'money');
    for (const m of t.metrics) {
      const src = findTable(m.sheet);
      if (!src || src.summary || m.op === 'count' || m.op === 'calc') continue;
      const ci = findColumn(src, m.column);
      const money = ci >= 0 && (src.columns[ci].type === 'money' || src.columns[ci].format === 'money');
      const wantsMoney = /doanh thu|revenue|sales|chi phi|expense|cost|売上|経費|費用/.test(fold(m.label));
      if (wantsMoney && (!money || priceLike(src.columns[ci]?.name ?? '')) && amountOf(src) >= 0) m.column = src.columns[amountOf(src)].name;
    }
    for (const b of t.breakdowns) {
      const src = findTable(b.sheet);
      if (!src || b.op !== 'sum') continue;
      const ci = findColumn(src, b.value);
      if ((ci < 0 || priceLike(src.columns[ci].name)) && amountOf(src) >= 0) b.value = src.columns[amountOf(src)].name;
    }
  }

  // Sample rows of a data sheet that left its key empty ("Mã KH") take real codes from the master list,
  // so every lookup in the sample finds its row.
  for (const t of tables) {
    if (t.summary || !t.rows.length) continue;
    t.columns.forEach((c, ci) => {
      if (c.type === 'lookup' || c.type === 'calc' || t.rows.some((r) => r[ci] !== null && r[ci] !== undefined && r[ci] !== '')) return;
      for (const m of tables) {
        if (m === t || m.summary || !m.rows.length) continue;
        const mi = m.columns.findIndex((x) => fold(x.name) === fold(c.name));
        if (mi < 0) continue;
        const values = m.rows.map((r) => r[mi]).filter((v) => v !== null && v !== undefined && v !== '');
        if (!values.length) continue;
        t.rows.forEach((r, ri) => (r[ci] = values[ri % values.length]));
        fixes.push(`${t.name} › ${c.name}: sample values taken from ${m.name}`);
        break;
      }
    });
  }
  // A metric "revenue by payment method" is what a breakdown shows: keep the breakdown only.
  for (const t of tables.filter((x) => x.summary && x.breakdowns.length)) t.metrics = t.metrics.filter((m) => !/\b(theo|by|per)\b|別/.test(fold(m.label)) || m.op === 'calc');

  // ── 4. Sheets ─────────────────────────────────────────────────────────────
  const resources: { dv: Record<string, unknown[]>; filter: Record<string, unknown> } = { dv: {}, filter: {} };
  const fmtOf = (c: SheetSpecColumn, t?: Table, ci?: number): CellStyle | undefined => {
    const k = c.type === 'lookup' || c.type === 'calc' || c.type === 'formula' ? (c.format ?? (c.type === 'calc' ? 'number' : 'text')) : c.type;
    if (k === 'number') {
      // Years read as 1990, not 1,990; whole numbers without a trailing point.
      if (/\b(nam|year|nam sinh)\b|年/.test(fold(c.name))) return { n: { pattern: '0' } };
      const decimals = t && ci !== undefined && t.rows.some((r) => typeof r[ci] === 'number' && !Number.isInteger(r[ci]));
      return { n: { pattern: decimals ? '#,##0.00' : '#,##0' } };
    }
    return k === 'money' ? { n: { pattern: '#,##0' } } : k === 'percent' ? { n: { pattern: '0%' } } : k === 'date' ? { n: { pattern: dateFmt } } : undefined;
  };
  const sheets: PlainSheet[] = [];
  for (const t of tables) {
    const sheet = emptySheet(t.name, 1000, 26);
    sheet.id = newId();
    const cells: PlainSheet['cells'] = {};
    const put = (r: number, c: number, cell: Cell) => ((cells[r] ??= {})[c] = cell);

    if (t.summary) {
      // Summary: "Metric | Value" rows, then one small table per breakdown.
      put(0, 0, { v: words.metric, t: 1, s: HEADER });
      put(0, 1, { v: words.value, t: 1, s: HEADER });
      sheet.colMeta[0] = { w: 260 };
      sheet.colMeta[1] = { w: 160 };
      sheet.rowMeta[0] = { h: 30 };
      const rowOf = new Map<string, number>();
      let r = 1;
      for (const m of t.metrics) {
        const f = metricFormula(m);
        put(r, 0, { v: m.label, t: 1, s: LABEL });
        put(r, 1, f ? { f, s: { n: { pattern: '#,##0' } } } : { v: '—', t: 1 });
        if (!f && m.op !== 'calc') warnings.push(`${t.name} › ${m.label}: could not build the formula`);
        rowOf.set(fold(m.label), r);
        r++;
      }
      // calc metrics reference other metric rows by label.
      t.metrics.forEach((m, i) => {
        if (m.op !== 'calc' || !m.expr) return;
        let e = ` ${m.expr} `;
        for (const [label, row] of [...rowOf.entries()].sort((a, b) => b[0].length - a[0].length)) {
          const orig = t.metrics.find((x) => fold(x.label) === label)!.label;
          e = e.replace(new RegExp(orig.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), `B${row + 1}`);
        }
        const out = e.trim();
        if (/^[B0-9\s()+\-*/.]+$/.test(out) && /B\d/.test(out)) put(1 + i, 1, { f: `=${out}`, s: { n: { pattern: '#,##0' } } });
      });
      r++;
      for (const b of t.breakdowns) {
        const src = findTable(b.sheet);
        const byCol = src ? findColumn(src, b.by) : -1;
        const valCol = src && b.op === 'sum' ? findColumn(src, b.value ?? 'amount', (c) => c.type === 'money' || c.type === 'number' || c.type === 'calc' || c.type === 'lookup') : -1;
        if (!src || byCol < 0 || (b.op === 'sum' && valCol < 0)) {
          warnings.push(`${t.name}: a breakdown by “${b.by}” could not be built`);
          continue;
        }
        const choices = src.columns[byCol].options?.length ? src.columns[byCol].options! : [...new Set(src.rows.map((x) => String(x[byCol] ?? '')).filter(Boolean))].slice(0, 30);
        put(r, 0, { v: b.title || `${b.op === 'sum' ? src.columns[valCol].name : words.metric} ${words.by} ${src.columns[byCol].name}`, t: 1, s: SECTION });
        r++;
        const first = r;
        for (const ch of choices) {
          put(r, 0, { v: ch, t: 1 });
          put(r, 1, { f: b.op === 'sum' ? `=SUMIFS(${range(src, valCol)},${range(src, byCol)},A${r + 1})` : `=COUNTIFS(${range(src, byCol)},A${r + 1})`, s: { n: { pattern: '#,##0' } } });
          r++;
        }
        if (choices.length) {
          put(r, 0, { v: words.total, t: 1, s: TOTAL });
          put(r, 1, { f: `=SUM(B${first + 1}:B${r})`, s: { ...TOTAL, n: { pattern: '#,##0' } } });
          r += 2;
        }
      }
      sheet.cells = cells;
      sheet.meta = { name: t.name, freeze: { row: 1, col: 0 } };
      sheets.push(sheet);
      continue;
    }

    t.columns.forEach((c, ci) => {
      put(0, ci, { v: c.name, t: 1, s: HEADER });
      const width = Math.min(320, Math.max(90, c.name.length * 9 + 24, c.type === 'date' ? 110 : 0, c.type === 'money' || c.format === 'money' ? 120 : 0, c.type === 'text' || c.type === 'lookup' ? 150 : 0));
      sheet.colMeta[ci] = { w: width };
    });
    sheet.rowMeta[0] = { h: 34 };
    t.rows.forEach((row, ri) => {
      const r = ri + 1;
      t.columns.forEach((c, ci) => {
        const v = row[ci];
        const s = fmtOf(c, t, ci);
        const auto = c.type === 'lookup' || c.type === 'calc' || c.type === 'formula';
        if (auto) {
          const f = c.type === 'lookup' ? lookupFormula(t, c, r) : c.type === 'calc' ? calcFormula(t, c.calc ?? '', r) : resolveBraces(c.formula!.startsWith('=') ? c.formula! : `=${c.formula}`, t, r);
          if (f) put(r, ci, { f, s: { ...AUTO, ...(s ?? {}) } });
          else if (v !== null && v !== undefined && v !== '') put(r, ci, { v: typeof v === 'number' ? v : String(v), t: typeof v === 'number' ? 2 : 1, ...(s ? { s } : {}) });
          return;
        }
        if (typeof v === 'string' && v.startsWith('=')) return put(r, ci, { f: resolveBraces(v, t, r), ...(s ? { s } : {}) });
        if (v === null || v === undefined || v === '') return;
        if (c.type === 'checkbox') return put(r, ci, { v: v === true || /^(true|yes|x|1|có|✓)$/i.test(String(v)) ? 1 : 0, t: 3 });
        if (c.type === 'date') {
          const serial = toSerial(v);
          return put(r, ci, serial !== null ? { v: serial, t: 2, s } : { v: String(v), t: 1 });
        }
        if (c.type === 'number' || c.type === 'money' || c.type === 'percent') {
          let n = num(v);
          if (n !== null && c.type === 'percent' && n > 1) n /= 100;
          return put(r, ci, n !== null ? { v: n, t: 2, ...(s ? { s } : {}) } : { v: String(v), t: 1 });
        }
        put(r, ci, { v: String(v), t: 1 });
      });
    });
    const dataEnd = t.rows.length;
    if (t.totals && t.rows.length) {
      const tr = dataEnd + 1;
      put(tr, 0, { v: words.total, t: 1, s: TOTAL });
      t.columns.forEach((c, ci) => {
        if (ci === 0) return;
        const numeric = c.type === 'money' || c.format === 'money' || (c.type === 'number' && !/year|nam sinh|年/.test(fold(c.name)));
        put(tr, ci, numeric ? { f: `=SUBTOTAL(9,${col(ci)}2:${col(ci)}${dataEnd + 1})`, s: { ...TOTAL, ...(fmtOf(c, t, ci) ?? {}) } } : { s: TOTAL });
      });
    }
    sheet.cells = cells;
    sheet.meta = { name: t.name, freeze: { row: 1, col: 0 } };
    const rules: unknown[] = [];
    t.columns.forEach((c, ci) => {
      const ranges = [{ startRow: 1, endRow: Math.max(dataEnd, 1) + 200, startColumn: ci, endColumn: ci, rangeType: 0 }];
      if (c.type === 'select' && c.options?.length) rules.push({ uid: newId(), type: 'list', formula1: JSON.stringify(c.options), showDropDown: true, allowBlank: true, errorStyle: 2, ranges });
      if (c.type === 'checkbox') rules.push({ uid: newId(), type: 'checkbox', allowBlank: true, errorStyle: 1, ranges });
    });
    if (rules.length) resources.dv[sheet.id] = rules;
    if (t.rows.length) resources.filter[sheet.id] = { ref: { startRow: 0, endRow: dataEnd, startColumn: 0, endColumn: t.columns.length - 1 }, filterColumns: [] };
    sheets.push(sheet);
  }

  function metricFormula(m: SheetSpecMetric): string | null {
    if (m.op === 'calc') return null; // filled in after every metric has a row
    const src = findTable(m.sheet) ?? tables.find((t) => !t.summary && t.columns.some((c) => findColumn(t, m.column) >= 0));
    if (!src || src.summary) return null;
    const numeric = (c: SheetSpecColumn) => c.type === 'money' || c.type === 'number' || c.type === 'calc' || c.format === 'money' || c.format === 'number';
    const ci = m.op === 'count' ? Math.max(0, m.column ? findColumn(src, m.column) : 0) : findColumn(src, m.column ?? 'amount', numeric);
    if (ci < 0) return null;
    const r = range(src, ci);
    if (m.where) {
      const wi = findColumn(src, m.where.column);
      if (wi < 0) return null;
      const crit = `"${String(m.where.equals).replace(/"/g, '""')}"`;
      if (m.op === 'count') return `=COUNTIFS(${range(src, wi)},${crit})`;
      if (m.op === 'sum') return `=SUMIFS(${r},${range(src, wi)},${crit})`;
      if (m.op === 'average') return `=IFERROR(AVERAGEIFS(${r},${range(src, wi)},${crit}),0)`;
      return `=${m.op.toUpperCase()}IFS(${r},${range(src, wi)},${crit})`;
    }
    return m.op === 'count' ? `=COUNTA(${r})` : m.op === 'sum' ? `=SUM(${r})` : m.op === 'average' ? `=IFERROR(AVERAGE(${r}),0)` : `=${m.op.toUpperCase()}(${r})`;
  }

  const res: Record<string, string> = {};
  if (Object.keys(resources.dv).length) res.SHEET_DATA_VALIDATION_PLUGIN = JSON.stringify(resources.dv);
  if (Object.keys(resources.filter).length) res.SHEET_FILTER_PLUGIN = JSON.stringify(resources.filter);
  const title = String(raw.title ?? 'Workbook').replace(/^\s*(workbook to build|workbook|description)\s*:\s*/i, '').slice(0, 120) || 'Workbook';
  return { workbook: { name: title, sheets, resources: res }, warnings: [...new Set(warnings)].slice(0, 20), fixes: [...new Set(fixes)].slice(0, 20) };
}

// ── Multi-step generation (small models): plan → each sheet → report ───────

const props = SHEET_SPEC_SCHEMA.properties.sheets.items.properties;
export const SHEET_PLAN_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    sheets: {
      type: 'array',
      items: { type: 'object', properties: { name: { type: 'string' }, kind: { type: 'string', enum: ['master', 'data', 'summary'] }, columns: { type: 'array', items: { type: 'string' } } }, required: ['name', 'kind', 'columns'] },
    },
  },
  required: ['title', 'sheets'],
};
export const SHEET_TABLE_SCHEMA = { type: 'object', properties: { columns: props.columns, rows: props.rows, totals: props.totals }, required: ['columns', 'rows'] };
export const SHEET_SUMMARY_SCHEMA = { type: 'object', properties: { metrics: props.metrics, breakdowns: props.breakdowns }, required: ['metrics'] };

export interface SheetPlan {
  title: string;
  sheets: { name: string; kind: 'master' | 'data' | 'summary'; columns: string[] }[];
}

/** Cleans a plan: names, kinds, column lists; reports are put last. */
export function cleanPlan(raw: Partial<SheetPlan>): SheetPlan {
  const sheets = (raw.sheets ?? [])
    .filter((s) => s && s.name)
    .slice(0, 8)
    .map((s) => ({
      name: String(s.name).trim().slice(0, 31),
      kind: (['master', 'data', 'summary'].includes(s.kind) ? s.kind : (s.columns?.length ?? 0) ? 'data' : 'summary') as SheetPlan['sheets'][number]['kind'],
      columns: [...new Set((s.columns ?? []).map((c) => String(c).trim()).filter(Boolean))].slice(0, 30),
    }))
    .map((s) => (s.kind !== 'summary' && !s.columns.length ? { ...s, kind: 'summary' as const } : s));
  const order = { master: 0, data: 1, summary: 2 };
  return { title: String(raw.title ?? 'Workbook').slice(0, 120), sheets: sheets.sort((a, b) => order[a.kind] - order[b.kind]) };
}

/** "Products: Product, Category, Unit price" lines for the prompts. */
export const planText = (p: SheetPlan) => p.sheets.map((s) => `${s.name}${s.kind === 'summary' ? ' (report)' : `: ${s.columns.join(', ')}`}`).join('\n');

/** The data the report may use: "Sales › Amount (money)". */
export function catalogText(tables: { name: string; columns?: SheetSpecColumn[] }[]) {
  return tables
    .filter((t) => t.columns?.length)
    .map((t) => t.columns!.map((c) => `${t.name} › ${c.name} (${c.type === 'lookup' || c.type === 'calc' ? (c.format ?? 'number') : c.type}${c.options?.length ? `: ${c.options.join(' / ')}` : ''})`).join('\n'))
    .join('\n');
}

/** Keeps the planned column names and order even if the model renamed or dropped some. */
export function alignColumns(planned: string[], cols: SheetSpecColumn[], rows: unknown[][]): { columns: SheetSpecColumn[]; rows: (string | number | boolean | null)[][] } {
  const used = new Set<number>();
  const pick = planned.map((name) => {
    const f = fold(name);
    let i = cols.findIndex((c, ci) => !used.has(ci) && fold(c.name) === f);
    if (i < 0) i = cols.findIndex((c, ci) => !used.has(ci) && (fold(c.name).includes(f) || f.includes(fold(c.name))));
    if (i >= 0) used.add(i);
    return i;
  });
  // Columns the model added beyond the plan are kept at the end.
  const extra = cols.map((_, ci) => ci).filter((ci) => !used.has(ci));
  const order = [...pick, ...extra];
  const columns = order.map((ci, k) => (ci >= 0 ? { ...cols[ci], name: k < planned.length ? planned[k] : cols[ci].name } : { name: planned[k], type: 'text' as ColumnType }));
  const outRows = rows.filter(Array.isArray).map((r) => order.map((ci) => (ci >= 0 ? ((r[ci] ?? null) as string | number | boolean | null) : null)));
  return { columns, rows: outRows };
}

// ── Reading the structure straight from the request ─────────────────────────

const SUMMARY_NAME = /tổng hợp|báo cáo|thống kê|report|summary|dashboard|overview|集計|レポート|サマリー/i;
const LOOKUP_WORDS = /\s+(?:tự lấy từ|tự động lấy từ|lấy từ|lấy theo|tra từ|tham chiếu|lookup from|looked up from|taken from|from|から取得|から)\s+/i;
const cap = (s: string) => s.charAt(0).toLocaleUpperCase() + s.slice(1);

/** Splits "a, b (x/y), c" on commas that are not inside parentheses. */
function splitList(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '(' || ch === '（') depth++;
    if (ch === ')' || ch === '）') depth = Math.max(0, depth - 1);
    if ((ch === ',' || ch === '、' || ch === ';') && !depth) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out.map((x) => x.trim().replace(/[.。]+$/, '').trim()).filter(Boolean);
}

/**
 * When a request lists its sheets ("1) DATA KH: mã KH, họ tên, giới tính (Nam/Nữ) … 3) Doanh thu: …, tên KH tự lấy
 * từ DATA KH"), that IS the plan: no model call, no columns forgotten. Drop-down choices in parentheses and
 * "taken from" sources become hints the builder enforces.
 */
export function planFromRequest(request: string): { plan: SheetPlan; hints: SheetHints; asked: Record<string, string[]> } | null {
  const text = request.replace(/\r/g, '');
  const segs: { name: string; list: string }[] = [];
  const numbered = /(?:^|[\s;])(\d{1,2})\s*[).．]\s*([^:\n：]{1,48})[:：]\s*/g;
  const marks = [...text.matchAll(numbered)];
  marks.forEach((m, i) => {
    const start = m.index! + m[0].length;
    const end = i + 1 < marks.length ? marks[i + 1].index! : text.length;
    segs.push({ name: m[2].trim(), list: text.slice(start, end).trim() });
  });
  if (segs.length < 2) {
    segs.length = 0;
    for (const line of text.split('\n')) {
      const m = /^\s*[-•*]?\s*([^:\n：]{1,48})[:：]\s*(.+)$/.exec(line);
      if (m && m[2].includes(',')) segs.push({ name: m[1].trim(), list: m[2].trim() });
    }
  }
  if (segs.length < 2) return null;
  const firstAt = marks.length >= 2 ? marks[0].index! : text.indexOf(segs[0].name);
  const title = text.slice(0, Math.max(0, firstAt)).replace(/\([^)]*\)/g, '').replace(/[:：\s]+$/, '').trim().slice(0, 100);
  const hints: SheetHints = {};
  const asked: Record<string, string[]> = {};
  const sheets: SheetPlan['sheets'] = segs.map((s) => {
    const name = s.name.replace(/^(sheet|trang|bảng|シート)\s+/i, '').trim().slice(0, 31);
    const items = splitList(s.list);
    if (SUMMARY_NAME.test(name)) {
      asked[name] = items.map(cap);
      return { name, kind: 'summary' as const, columns: [] };
    }
    const columns: string[] = [];
    for (const raw of items) {
      let item = raw;
      let from: string | undefined;
      const lk = LOOKUP_WORDS.exec(item);
      if (lk) {
        from = item.slice(lk.index + lk[0].length).trim();
        item = item.slice(0, lk.index).trim();
      }
      const opt = /[(（]([^)）]+)[)）]/.exec(item);
      const options = opt && /[/|]/.test(opt[1]) ? opt[1].split(/[/|]/).map((x) => x.trim()).filter(Boolean) : undefined;
      const col = cap(item.replace(/[(（][^)）]*[)）]/g, '').trim()).slice(0, 60);
      if (!col || columns.includes(col)) continue;
      columns.push(col);
      if (options || from) (hints[name] ??= {})[col] = { ...(options ? { options } : {}), ...(from ? { from } : {}) };
    }
    // A data sheet starts with a date or takes values from other sheets; the sheets it takes them from are master lists.
    const isData = /^(ngay|date)\b|日付|^日/.test(fold(columns[0] ?? '')) || Object.values(hints[name] ?? {}).some((h) => h.from);
    return { name, kind: isData ? ('data' as const) : ('master' as const), columns };
  });
  const referenced = [...new Set(Object.values(hints).flatMap((cols) => Object.values(cols).map((h) => fold(h.from ?? ''))))].filter(Boolean);
  for (const s of sheets) if (s.kind === 'data' && referenced.some((r) => r === fold(s.name) || r.includes(fold(s.name)) || fold(s.name).includes(r))) s.kind = 'master';
  const order = { master: 0, data: 1, summary: 2 };
  return { plan: { title: title || 'Workbook', sheets: [...sheets].sort((a, b) => order[a.kind] - order[b.kind]) }, hints, asked };
}
