// Formula fields (§75): a small expression language in the style of Airtable / Lark Base.
//   {Price} * {Qty}            IF({Status} = "Done", "✓", "")         DATETIME_DIFF({Due}, TODAY(), 'days')
// Operators: + - * / (numbers), & (join text), = != <> < <= > >= (compare). Functions are listed in FUNCTIONS.
// Parsed once per field, evaluated per record. Errors evaluate to a FormulaError (shown as #ERROR!).

export type FValue = number | string | boolean | null | FValue[];

export class FormulaError extends Error {}

type Node =
  | { t: 'num'; v: number }
  | { t: 'str'; v: string }
  | { t: 'bool'; v: boolean }
  | { t: 'ref'; name: string }
  | { t: 'un'; op: '-' | '+'; a: Node }
  | { t: 'bin'; op: string; a: Node; b: Node }
  | { t: 'call'; name: string; args: Node[] };

interface Tok {
  k: 'num' | 'str' | 'ref' | 'id' | 'op' | '(' | ')' | ',';
  v: string;
}

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j])) j++;
      if (src[j] === 'e' || src[j] === 'E') {
        j++;
        if (src[j] === '+' || src[j] === '-') j++;
        while (j < src.length && /[0-9]/.test(src[j])) j++;
      }
      out.push({ k: 'num', v: src.slice(i, j) });
      i = j;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      let s = '';
      while (j < src.length && src[j] !== c) {
        if (src[j] === '\\' && j + 1 < src.length) j++;
        s += src[j++];
      }
      if (j >= src.length) throw new FormulaError('Unclosed text');
      out.push({ k: 'str', v: s });
      i = j + 1;
      continue;
    }
    if (c === '{') {
      const j = src.indexOf('}', i);
      if (j < 0) throw new FormulaError('Unclosed {field}');
      out.push({ k: 'ref', v: src.slice(i + 1, j) });
      i = j + 1;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_]/.test(src[j])) j++;
      out.push({ k: 'id', v: src.slice(i, j) });
      i = j;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (['<=', '>=', '!=', '<>'].includes(two)) {
      out.push({ k: 'op', v: two === '<>' ? '!=' : two });
      i += 2;
      continue;
    }
    if ('+-*/&=<>'.includes(c)) {
      out.push({ k: 'op', v: c });
      i++;
      continue;
    }
    if (c === '(' || c === ')' || c === ',') {
      out.push({ k: c, v: c });
      i++;
      continue;
    }
    throw new FormulaError(`Unexpected "${c}"`);
  }
  return out;
}

const PREC: Record<string, number> = { '=': 1, '!=': 1, '<': 1, '<=': 1, '>': 1, '>=': 1, '&': 2, '+': 3, '-': 3, '*': 4, '/': 4 };

export function parseFormula(src: string): Node {
  const toks = tokenize(src);
  let p = 0;
  const peek = () => toks[p];
  const expect = (k: Tok['k']) => {
    if (toks[p]?.k !== k) throw new FormulaError(`Expected ${k === ')' ? 'a closing )' : k}`);
    return toks[p++];
  };
  const primary = (): Node => {
    const t = toks[p++];
    if (!t) throw new FormulaError('The formula ends too early');
    if (t.k === 'num') {
      const v = Number(t.v);
      if (!Number.isFinite(v)) throw new FormulaError(`Bad number ${t.v}`);
      return { t: 'num', v };
    }
    if (t.k === 'str') return { t: 'str', v: t.v };
    if (t.k === 'ref') return { t: 'ref', name: t.v };
    if (t.k === 'op' && (t.v === '-' || t.v === '+')) return { t: 'un', op: t.v, a: expr(5) };
    if (t.k === '(') {
      const e = expr(0);
      expect(')');
      return e;
    }
    if (t.k === 'id') {
      const name = t.v.toUpperCase();
      if (peek()?.k === '(') {
        p++;
        const args: Node[] = [];
        if (peek()?.k !== ')') {
          args.push(expr(0));
          while (peek()?.k === ',') {
            p++;
            args.push(expr(0));
          }
        }
        expect(')');
        if (!FUNCTIONS[name]) throw new FormulaError(`Unknown function ${name}`);
        return { t: 'call', name, args };
      }
      if (name === 'TRUE' || name === 'FALSE') return { t: 'bool', v: name === 'TRUE' };
      throw new FormulaError(`Unknown name ${t.v} — put field names in {braces}`);
    }
    throw new FormulaError(`Unexpected "${t.v}"`);
  };
  const expr = (min: number): Node => {
    let left = primary();
    for (;;) {
      const t = peek();
      if (!t || t.k !== 'op' || PREC[t.v] === undefined || PREC[t.v] < min) break;
      p++;
      const right = expr(PREC[t.v] + 1);
      left = { t: 'bin', op: t.v, a: left, b: right };
    }
    return left;
  };
  if (!toks.length) throw new FormulaError('Empty formula');
  const node = expr(0);
  if (p < toks.length) throw new FormulaError(`Unexpected "${toks[p].v}"`);
  return node;
}

/** Field names a formula refers to. */
export function formulaRefs(src: string): string[] {
  try {
    return tokenize(src)
      .filter((t) => t.k === 'ref')
      .map((t) => t.v);
  } catch {
    return [];
  }
}

/** Rewrites {Old name} to {New name} (field renamed). */
export function renameFormulaRef(src: string, from: string, to: string) {
  return src.split(`{${from}}`).join(`{${to}}`);
}

const flat = (args: FValue[]): FValue[] => args.flatMap((a) => (Array.isArray(a) ? flat(a) : [a]));
const isBlank = (v: FValue) => v === null || v === '' || (Array.isArray(v) && !v.length);
export const toNum = (v: FValue): number => {
  if (Array.isArray(v)) return v.length === 1 ? toNum(v[0]) : flat(v).reduce<number>((s, x) => s + toNum(x), 0);
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v === null || v === '') return 0;
  const n = Number(String(v).replace(/[, ]/g, ''));
  if (Number.isNaN(n)) throw new FormulaError(`"${v}" is not a number`);
  return n;
};
export const toText = (v: FValue): string => {
  if (v === null) return '';
  if (Array.isArray(v)) return flat(v).map(toText).join(', ');
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(Math.round(v * 1e10) / 1e10);
  return v;
};
const truthy = (v: FValue): boolean => (Array.isArray(v) ? v.length > 0 : typeof v === 'string' ? v !== '' : !!v);
const toDate = (v: FValue): Date => {
  const s = toText(v);
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T00:00:00Z` : s);
  if (Number.isNaN(d.getTime())) throw new FormulaError(`"${s}" is not a date`);
  return d;
};
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const UNIT_MS: Record<string, number> = { seconds: 1e3, minutes: 6e4, hours: 36e5, days: 864e5, weeks: 6048e5 };

const FUNCTIONS: Record<string, (args: FValue[], now: Date) => FValue> = {
  SUM: (a) => flat(a).reduce<number>((s, x) => s + (isBlank(x) ? 0 : toNum(x)), 0),
  AVERAGE: (a) => {
    const xs = flat(a).filter((x) => !isBlank(x));
    return xs.length ? xs.reduce<number>((s, x) => s + toNum(x), 0) / xs.length : 0;
  },
  MIN: (a) => Math.min(...flat(a).filter((x) => !isBlank(x)).map(toNum)),
  MAX: (a) => Math.max(...flat(a).filter((x) => !isBlank(x)).map(toNum)),
  COUNT: (a) => flat(a).filter((x) => typeof x === 'number').length,
  COUNTA: (a) => flat(a).filter((x) => !isBlank(x)).length,
  ROUND: ([x, n]) => {
    const f = 10 ** (n === undefined ? 0 : toNum(n));
    return Math.round(toNum(x) * f) / f;
  },
  ROUNDUP: ([x, n]) => {
    const f = 10 ** (n === undefined ? 0 : toNum(n));
    return Math.ceil(toNum(x) * f) / f;
  },
  ROUNDDOWN: ([x, n]) => {
    const f = 10 ** (n === undefined ? 0 : toNum(n));
    return Math.floor(toNum(x) * f) / f;
  },
  ABS: ([x]) => Math.abs(toNum(x)),
  MOD: ([a, b]) => toNum(a) % toNum(b),
  POWER: ([a, b]) => toNum(a) ** toNum(b),
  SQRT: ([a]) => Math.sqrt(toNum(a)),
  IF: ([c, a, b]) => (truthy(c) ? (a ?? null) : (b ?? null)),
  AND: (a) => flat(a).every(truthy),
  OR: (a) => flat(a).some(truthy),
  NOT: ([a]) => !truthy(a),
  BLANK: () => null,
  ISBLANK: ([a]) => isBlank(a ?? null),
  CONCAT: (a) => flat(a).map(toText).join(''),
  UPPER: ([a]) => toText(a).toUpperCase(),
  LOWER: ([a]) => toText(a).toLowerCase(),
  TRIM: ([a]) => toText(a).trim(),
  LEN: ([a]) => toText(a).length,
  LEFT: ([a, n]) => toText(a).slice(0, n === undefined ? 1 : toNum(n)),
  RIGHT: ([a, n]) => {
    const s = toText(a);
    const k = n === undefined ? 1 : toNum(n);
    return k ? s.slice(-k) : '';
  },
  FIND: ([needle, hay]) => toText(hay).indexOf(toText(needle)) + 1,
  SUBSTITUTE: ([s, a, b]) => toText(s).split(toText(a)).join(toText(b)),
  VALUE: ([a]) => toNum(a),
  T: ([a]) => (typeof a === 'string' ? a : ''),
  TODAY: (_a, now) => ymd(now),
  NOW: (_a, now) => now.toISOString(),
  YEAR: ([d]) => toDate(d).getUTCFullYear(),
  MONTH: ([d]) => toDate(d).getUTCMonth() + 1,
  DAY: ([d]) => toDate(d).getUTCDate(),
  WEEKDAY: ([d]) => toDate(d).getUTCDay(),
  DATETIME_DIFF: ([a, b, unit]) => {
    const u = toText(unit ?? 'days').toLowerCase();
    const ms = UNIT_MS[u] ?? UNIT_MS[u + 's'];
    if (!ms) throw new FormulaError(`Unknown unit ${u}`);
    return Math.floor((toDate(a).getTime() - toDate(b).getTime()) / ms);
  },
  DATEADD: ([d, n, unit]) => {
    const u = toText(unit ?? 'days').toLowerCase();
    const date = toDate(d);
    if (u.startsWith('month')) date.setUTCMonth(date.getUTCMonth() + toNum(n));
    else if (u.startsWith('year')) date.setUTCFullYear(date.getUTCFullYear() + toNum(n));
    else {
      const ms = UNIT_MS[u] ?? UNIT_MS[u + 's'];
      if (!ms) throw new FormulaError(`Unknown unit ${u}`);
      date.setTime(date.getTime() + toNum(n) * ms);
    }
    return /^\d{4}-\d{2}-\d{2}$/.test(toText(d)) ? ymd(date) : date.toISOString();
  },
  DATESTR: ([d]) => ymd(toDate(d)),
};
export const FORMULA_FUNCTIONS = Object.keys(FUNCTIONS).sort();

const compare = (a: FValue, b: FValue): number => {
  if (typeof a === 'number' || typeof b === 'number') return toNum(a) - toNum(b);
  const x = toText(a);
  const y = toText(b);
  return x < y ? -1 : x > y ? 1 : 0;
};

/** Evaluates a parsed formula; `ref` returns a field's value by name (throws for unknown names). */
export function evalFormula(node: Node, ref: (name: string) => FValue, now = new Date()): FValue {
  const ev = (n: Node): FValue => {
    switch (n.t) {
      case 'num':
      case 'str':
      case 'bool':
        return n.v;
      case 'ref':
        return ref(n.name);
      case 'un':
        return n.op === '-' ? -toNum(ev(n.a)) : toNum(ev(n.a));
      case 'call':
        return FUNCTIONS[n.name](n.args.map(ev), now);
      case 'bin': {
        const a = ev(n.a);
        const b = ev(n.b);
        switch (n.op) {
          case '+':
            return toNum(a) + toNum(b);
          case '-':
            return toNum(a) - toNum(b);
          case '*':
            return toNum(a) * toNum(b);
          case '/': {
            const d = toNum(b);
            if (d === 0) throw new FormulaError('Division by zero');
            return toNum(a) / d;
          }
          case '&':
            return toText(a) + toText(b);
          case '=':
            return compare(a, b) === 0;
          case '!=':
            return compare(a, b) !== 0;
          case '<':
            return compare(a, b) < 0;
          case '<=':
            return compare(a, b) <= 0;
          case '>':
            return compare(a, b) > 0;
          case '>=':
            return compare(a, b) >= 0;
        }
      }
    }
    throw new FormulaError('Bad formula');
  };
  const v = ev(node);
  if (typeof v === 'number' && !Number.isFinite(v)) throw new FormulaError('Not a finite number');
  return v;
}
