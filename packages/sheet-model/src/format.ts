// Excel number-format rendering for server-side outputs (PDF / HTML preview). The browser grid uses Univer's
// own formatter; this covers the formats people actually use: General, fixed/thousands, %, scientific,
// currency literals, negative sections and dates/times.

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Excel "General": up to 11 significant characters, scientific for very large/small numbers. */
export function formatGeneral(n: number): string {
  if (!Number.isFinite(n)) return '#NUM!';
  if (n === 0) return '0';
  const abs = Math.abs(n);
  if (abs >= 1e11 || abs < 1e-9) return n.toExponential(5).replace(/\.?0+e/, 'E').replace(/E([+-])(\d)$/, 'E$10$2').replace('e', 'E');
  const s = String(Number(n.toPrecision(abs >= 1 ? 11 : 10)));
  return s;
}

function splitSections(pattern: string): string[] {
  const out: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === '"') q = !q;
    if (ch === '\\' && i + 1 < pattern.length) {
      cur += ch + pattern[++i];
      continue;
    }
    if (ch === ';' && !q) out.push(cur), (cur = '');
    else cur += ch;
  }
  out.push(cur);
  return out;
}

/** Splits a section into literal text and the format code (quoted strings, \x escapes, [$€-409] currency). */
function tokens(section: string): { lit: boolean; s: string }[] {
  const out: { lit: boolean; s: string }[] = [];
  const push = (lit: boolean, s: string) => {
    const last = out[out.length - 1];
    if (last && last.lit === lit) last.s += s;
    else out.push({ lit, s });
  };
  for (let i = 0; i < section.length; i++) {
    const ch = section[i];
    if (ch === '"') {
      const end = section.indexOf('"', i + 1);
      push(true, section.slice(i + 1, end === -1 ? undefined : end));
      i = end === -1 ? section.length : end;
    } else if (ch === '\\') push(true, section[++i] ?? '');
    else if (ch === '[') {
      const end = section.indexOf(']', i);
      const inner = section.slice(i + 1, end);
      if (inner.startsWith('$')) push(true, inner.slice(1).split('-')[0]);
      // colours / conditions ([Red], [>100]) are ignored
      i = end === -1 ? section.length : end;
    } else if (ch === '_') i++, push(true, ' ');
    else if (ch === '*') i++;
    else push(false, ch);
  }
  return out;
}

const isDateCode = (code: string) => /[ymdhs]/i.test(code.replace(/General/gi, '')) && !/[0#?]/.test(code.replace(/\.0+/, ''));

function formatDate(serial: number, code: string): string {
  const ms = Math.round((serial - 25569) * 86_400_000);
  const d = new Date(ms);
  const Y = d.getUTCFullYear();
  const M = d.getUTCMonth();
  const D = d.getUTCDate();
  const h = d.getUTCHours();
  const mi = d.getUTCMinutes();
  const s = d.getUTCSeconds();
  const ampm = /AM\/PM|A\/P/i.test(code);
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  const parts = code.match(/yyyy|yy|mmmmm|mmmm|mmm|mm|m|dddd|ddd|dd|d|hh|h|ss|s|AM\/PM|am\/pm|A\/P|a\/p|\.0+|[^ymdhsAa]+|./gi) ?? [];
  let out = '';
  parts.forEach((p, i) => {
    const lower = p.toLowerCase();
    // "m" after an hour or before a second is minutes, like Excel.
    const prev = parts.slice(0, i).reverse().find((x) => /^[a-z]/i.test(x))?.toLowerCase() ?? '';
    const next = parts.slice(i + 1).find((x) => /^[a-z]/i.test(x))?.toLowerCase() ?? '';
    const minute = (lower === 'm' || lower === 'mm') && (prev.startsWith('h') || next.startsWith('s'));
    if (lower === 'yyyy') out += Y;
    else if (lower === 'yy') out += pad(Y % 100);
    else if (lower === 'mmmmm') out += MONTHS[M][0];
    else if (lower === 'mmmm') out += MONTHS[M];
    else if (lower === 'mmm') out += MONTHS[M].slice(0, 3);
    else if (lower === 'mm') out += minute ? pad(mi) : pad(M + 1);
    else if (lower === 'm') out += minute ? mi : M + 1;
    else if (lower === 'dddd') out += DAYS[d.getUTCDay()];
    else if (lower === 'ddd') out += DAYS[d.getUTCDay()].slice(0, 3);
    else if (lower === 'dd') out += pad(D);
    else if (lower === 'd') out += D;
    else if (lower === 'hh') out += pad(ampm ? h % 12 || 12 : h);
    else if (lower === 'h') out += ampm ? h % 12 || 12 : h;
    else if (lower === 'ss') out += pad(s);
    else if (lower === 's') out += s;
    else if (lower === 'am/pm') out += h < 12 ? 'AM' : 'PM';
    else if (lower === 'a/p') out += h < 12 ? 'A' : 'P';
    else if (/^\.0+$/.test(p)) out += (((serial * 86400) % 1) + '').slice(1, p.length + 1).padEnd(p.length, '0');
    else out += p;
  });
  return out;
}

function formatNumber(n: number, code: string): string {
  const percent = (code.match(/%/g) ?? []).length;
  let v = n * 100 ** percent;
  const sci = code.match(/([0#?.,]+)E([+-])([0#]+)/i);
  if (sci) {
    const decimals = (sci[1].split('.')[1] ?? '').length;
    const [m, e] = Math.abs(v).toExponential(decimals).split('e');
    const exp = Number(e);
    return code.replace(sci[0], `${m}E${exp < 0 ? '-' : sci[2] === '+' ? '+' : ''}${String(Math.abs(exp)).padStart(sci[3].length, '0')}`).replace(/%/g, '%');
  }
  const numPart = code.match(/[0#?][0#?,]*(\.[0#?]*)?|\.[0#?]+/)?.[0] ?? '';
  // Trailing commas scale by 1000 each ("#,##0," shows thousands).
  const scale = (code.match(/[0#?](,+)(?![0#?])/)?.[1].length ?? 0) as number;
  v /= 1000 ** scale;
  const [intCode, decCode = ''] = numPart.split('.');
  const minDec = (decCode.match(/0/g) ?? []).length;
  const maxDec = decCode.length;
  let fixed = Math.abs(v).toFixed(maxDec);
  if (maxDec > minDec) fixed = fixed.replace(new RegExp(`0{0,${maxDec - minDec}}$`), '');
  let [int, dec] = fixed.split('.');
  const minInt = (intCode.replace(/,/g, '').match(/0/g) ?? []).length;
  if (int === '0' && minInt === 0) int = '';
  int = int.padStart(minInt, '0');
  if (/[0#?],[0#?]/.test(intCode)) int = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const body = dec !== undefined && decCode.length ? `${int}.${dec}` : int;
  return code.replace(numPart, body);
}

/** Renders a value with an Excel number format. */
export function formatValue(v: unknown, pattern?: string | null): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v !== 'number') {
    const sections = pattern ? splitSections(pattern) : [];
    const textSection = sections[3] ?? sections.find((s) => s.includes('@'));
    return textSection ? tokens(textSection).map((t) => (t.lit ? t.s : t.s.replace(/@/g, String(v)))).join('') : String(v);
  }
  if (!pattern || /^General$/i.test(pattern)) return formatGeneral(v);
  const sections = splitSections(pattern);
  let section = sections[0];
  let n = v;
  if (v < 0 && sections.length > 1 && sections[1] !== '') (section = sections[1]), (n = -v);
  else if (v === 0 && sections.length > 2 && sections[2] !== '') section = sections[2];
  // Literal text is swapped for private-use placeholders so format codes keep their positions.
  const lits: string[] = [];
  const code = tokens(section)
    .map((p) => (p.lit ? String.fromCharCode(0xe000 + lits.push(p.s) - 1) : p.s))
    .join('');
  const restore = (x: string) => x.replace(/[-]/g, (ch) => lits[ch.charCodeAt(0) - 0xe000]);
  let rendered: string;
  if (/General/i.test(code)) rendered = code.replace(/General/i, formatGeneral(n));
  else if (isDateCode(code)) rendered = formatDate(n, code);
  else if (/[0#?]/.test(code)) rendered = formatNumber(n, code);
  else rendered = code;
  // Negative numbers keep their minus sign unless a dedicated negative section was used.
  const sign = v < 0 && section === sections[0] && !isDateCode(code) && /[0#?]/.test(code) ? '-' : '';
  const out = restore(rendered);
  return sign + out;
}
