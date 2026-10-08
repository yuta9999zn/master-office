// New information into a design's text layers (docs/ARCHITECTURE.md §81, prompt image.retext). A 3B model asked to
// "change the month to November and the discount to 40 %" rewrites lines it was never asked to touch, so the work is
// split: what can be done exactly is done in code, and the model's proposals are only accepted when every word they
// add comes from the request.
//   1. explicit pairs: "old → new" lines, or 'old' thành / sang / to 'new' anywhere in the request;
//   2. typed facts: a percentage, a date, a phone number, an e-mail, a web address or "tháng N" that appears once in
//      the design and once in the request is swapped;
//   3. the model, only when the request asks for more than that (words that are neither facts, nor instructions, nor
//      already in the design) — and its changes are checked (see `acceptChange`).
import { fold } from './ocr';

export interface RetextItem {
  id: string;
  text: string;
}
export interface RetextPlan {
  /** Final text per layer id, for layers that change. */
  texts: Map<string, string>;
  /** What was applied without the model, for the run's report. */
  exact: string[];
  /** The part of the request the model still has to handle ('' = nothing left). */
  rest: string;
}

const QUOTE = `["'“”‘’«»]`;
const PAIR_IN_TEXT = new RegExp(`${QUOTE}([^"'“”‘’«»]{1,80})${QUOTE}\\s*(?:thành|thanh|sang|->|=>|→|to|into|by)\\s*${QUOTE}([^"'“”‘’«»]{0,80})${QUOTE}`, 'giu');
const PAIR_LINE = /^\s*["“']?(.+?)["”']?\s*(?:->|=>|→)\s*["“']?(.*?)["”']?\s*$/u;

const FACTS: { kind: string; re: RegExp; key: (m: RegExpExecArray) => string; swap: (m: RegExpExecArray, to: RegExpExecArray) => string }[] = [
  { kind: 'percentage', re: /(\d{1,3}(?:[.,]\d+)?)\s?%/gu, key: (m) => m[1], swap: (m, to) => m[0].replace(m[1], to[1]) },
  { kind: 'date', re: /(?<![\d/])(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?(?![\d/])/gu, key: (m) => m[0], swap: (_m, to) => to[0] },
  { kind: 'phone', re: /(?<![\d/])\+?\d[\d .-]{7,14}\d(?![\d/])/gu, key: (m) => m[0].replace(/\D/g, ''), swap: (_m, to) => to[0] },
  { kind: 'e-mail', re: /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/gu, key: (m) => m[0].toLowerCase(), swap: (_m, to) => to[0] },
  { kind: 'website', re: /(?<![@\w.-])(?:https?:\/\/)?(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:vn|com|net|org|io|jp|co|info|biz|shop|store)\b(?!@)/giu, key: (m) => m[0].toLowerCase().replace(/^https?:\/\/(www\.)?/, ''), swap: (_m, to) => to[0] },
  { kind: 'month', re: /(tháng|thang|month)\s+(\d{1,2})(?!\s*\/)/giu, key: (m) => m[2], swap: (m, to) => m[0].replace(m[2], to[2]) },
];

/** Words of a request that only say "change": they never have to appear in the design. */
const INSTRUCTION_WORDS = new Set(
  ('doi sang sua thanh thay the cap nhat update change replace to into from by the a an and va voi cho la thi de nhe giup minh toi ban hay vao trong cua ra moi new set make it this that please con lai giu nguyen keep ' +
    // labels of facts: "số điện thoại 09…", "email …", "địa chỉ …"
    'so dien thoai sdt dt hotline phone tel mobile email mail website web trang dia chi address ten name').split(' '),
);

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const words = (s: string) => s.split(/[\s,.;:!?()\-–—/]+/u).map(fold).filter(Boolean);

function all(re: RegExp, s: string) {
  return [...s.matchAll(new RegExp(re.source, re.flags))] as RegExpExecArray[];
}

export function planRetext(request: string, items: RetextItem[]): RetextPlan {
  const texts = new Map<string, string>();
  const cur = (it: RetextItem) => texts.get(it.id) ?? it.text;
  const set = (it: RetextItem, t: string) => (t === it.text ? texts.delete(it.id) : texts.set(it.id, t));
  const exact: string[] = [];
  let rest = request;

  // 1. Explicit pairs.
  const pairs: [string, string][] = [];
  const lines = request.split(/\n|;/).map((s) => s.trim()).filter(Boolean);
  if (lines.length && lines.every((l) => PAIR_LINE.test(l))) {
    for (const l of lines) {
      const m = PAIR_LINE.exec(l)!;
      pairs.push([m[1].trim(), m[2].trim()]);
    }
    rest = '';
  } else {
    for (const m of all(PAIR_IN_TEXT, request)) pairs.push([m[1].trim(), m[2].trim()]);
    rest = request.replace(new RegExp(PAIR_IN_TEXT.source, PAIR_IN_TEXT.flags), ' ');
  }
  for (const [from, to] of pairs) {
    const re = new RegExp(esc(from), 'giu');
    let hit = false;
    for (const it of items) {
      const t = cur(it);
      if (re.test(t)) {
        set(it, t.replace(new RegExp(esc(from), 'giu'), to));
        hit = true;
      }
    }
    if (hit) exact.push(`“${from}” → “${to}”`);
  }

  // 2. Typed facts, each once in the design and once in what is left of the request.
  for (const f of FACTS) {
    const asked = all(f.re, rest);
    const wanted = [...new Map(asked.map((m) => [f.key(m), m])).values()];
    const found = items.flatMap((it) => all(f.re, cur(it)).map((m) => ({ it, m })));
    const have = [...new Set(found.map((x) => f.key(x.m)))];
    if (wanted.length === 1 && have.length === 1 && have[0] !== f.key(wanted[0])) {
      for (const it of items) {
        const t = cur(it);
        let nt = '';
        let last = 0;
        for (const m of all(f.re, t)) {
          nt += t.slice(last, m.index) + f.swap(m, wanted[0]);
          last = m.index + m[0].length;
        }
        nt += t.slice(last);
        if (nt !== t) set(it, nt);
      }
      exact.push(`${f.kind}: ${found[0].m[0]} → ${f.swap(found[0].m, wanted[0])}`);
    }
    // A fact of the request that is now in the design needs nothing more; an ambiguous one is left to the model.
    const now = new Set(items.flatMap((it) => all(f.re, cur(it)).map((m) => f.key(m))));
    // Its label goes with it ("hotline 0909…", "đến 30/11", "giảm 40%").
    for (const m of asked) if (now.has(f.key(m))) rest = rest.replace(new RegExp(`(?:[\\p{L}]+\\s+)?${esc(m[0])}`, 'u'), ' ');
  }

  // 3. Anything else to do? Words neither instructions nor already in the design.
  const design = new Set(items.flatMap((it) => words(cur(it))));
  const left = words(rest).filter((w) => !INSTRUCTION_WORDS.has(w) && !design.has(w) && !/^\d+$/.test(w));
  return { texts, exact, rest: left.length ? rest.trim() : '' };
}

/**
 * A change proposed by the model is kept only when every word it ADDS (beyond the words the line already had) is a
 * word of the request, and a short line does not grow into a long one.
 */
export function acceptChange(from: string, to: string, request: string): boolean {
  const req = new Set(words(request));
  const before = words(from);
  const after = words(to);
  if (!after.length) return false;
  const pool = new Map<string, number>();
  for (const w of before) pool.set(w, (pool.get(w) ?? 0) + 1);
  for (const w of after) {
    const n = pool.get(w) ?? 0;
    if (n > 0) pool.set(w, n - 1);
    else if (!req.has(w)) return false;
  }
  return after.length <= before.length + (before.length >= 3 ? 2 : 0);
}
