// CSV in and out of a base table (§75): RFC 4180 with the delimiter guessed (comma, semicolon, tab), a BOM on
// export so spreadsheet apps read UTF-8, and a type guess per column on import.
import { parseDate } from './cells';
import type { FieldType } from './types';

/** Splits CSV text into rows of cells. */
export function parseCsv(text: string, delimiter?: string): string[][] {
  const src = text.replace(/^﻿/, '');
  const firstLine = src.slice(0, src.search(/\r?\n|$/));
  const d = delimiter ?? ([',', ';', '\t'].map((c) => [c, firstLine.split(c).length] as const).sort((a, b) => b[1] - a[1])[0][0] || ',');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') (cell += '"'), i++;
        else quoted = false;
      } else cell += c;
    } else if (c === '"' && cell === '') quoted = true;
    else if (c === d) row.push(cell), (cell = '');
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) row.push(cell), rows.push(row);
  return rows.filter((r) => r.some((x) => x.trim() !== ''));
}

const esc = (s: string) => (/[",\n\r]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

/** Rows to CSV (with a BOM so Excel opens it as UTF-8). */
export function toCsv(rows: string[][]): string {
  return '﻿' + rows.map((r) => r.map((c) => esc(c ?? '')).join(',')).join('\r\n') + '\r\n';
}

const BOOL = /^(true|false|yes|no|y|n|x|✓|✔|checked|unchecked|0|1)?$/i;

/** The field type a column of imported text most likely is. */
export function guessFieldType(values: string[]): { type: FieldType; includeTime?: boolean } {
  const vs = values.map((v) => v.trim()).filter(Boolean);
  if (!vs.length) return { type: 'text' };
  if (vs.every((v) => /^-?[\d,]*\.?\d+%$/.test(v))) return { type: 'percent' };
  if (vs.every((v) => /^[¥$€£]\s?-?[\d,]*\.?\d+$/.test(v))) return { type: 'currency' };
  if (vs.every((v) => /^-?[\d,]*\.?\d+(e[+-]?\d+)?$/i.test(v)) && !vs.some((v) => /^0\d/.test(v))) return { type: 'number' };
  if (vs.every((v) => BOOL.test(v)) && vs.some((v) => !/^[01]$/.test(v))) return { type: 'checkbox' };
  if (vs.every((v) => /^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}([ T]\d{1,2}:\d{2}.*)?$|^\d{1,2}\/\d{1,2}\/\d{4}/.test(v) && parseDate(v, true))) return { type: 'date', includeTime: vs.some((v) => /\d{1,2}:\d{2}/.test(v)) };
  if (vs.every((v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v))) return { type: 'email' };
  if (vs.every((v) => /^https?:\/\//i.test(v))) return { type: 'url' };
  if (vs.some((v) => v.length > 120 || v.includes('\n'))) return { type: 'longText' };
  // Few distinct short values repeated → a single select.
  const distinct = new Set(vs);
  if (vs.length >= 4 && distinct.size < vs.length && distinct.size <= Math.min(20, Math.max(3, vs.length / 2)) && [...distinct].every((v) => v.length <= 40)) return { type: 'singleSelect' };
  return { type: 'text' };
}
