import { cellValue, emptySheet, usedRange, type Cell, type PlainSheet } from '@workos/sheet-model';

/** RFC 4180 parser; the delimiter is sniffed from the first line (comma, semicolon or tab — Excel regional variants). */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, '');
  const first = src.slice(0, src.indexOf('\n') === -1 ? undefined : src.indexOf('\n'));
  const count = (ch: string) => first.split(ch).length - 1;
  const delim = [',', ';', '\t'].reduce((best, ch) => (count(ch) > count(best) ? ch : best), ',');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') (field += '"'), i++;
        else quoted = false;
      } else field += ch;
    } else if (ch === '"' && field === '') quoted = true;
    else if (ch === delim) row.push(field), (field = '');
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field !== '' || row.length) row.push(field), rows.push(row);
  return rows;
}

const NUMBER = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/;

/** Converts CSV text to a sheet the way Excel opens it: numbers become numbers, "=..." becomes a formula. */
export function csvToSheet(text: string, name: string): PlainSheet {
  const rows = parseCsv(text);
  const s = emptySheet(name.slice(0, 31) || 'Sheet1', Math.max(1000, rows.length + 100), Math.max(26, ...rows.map((r) => r.length + 2)));
  rows.forEach((r, ri) =>
    r.forEach((raw, ci) => {
      if (raw === '') return;
      let cell: Cell;
      const trimmed = raw.trim();
      if (trimmed.startsWith('=') && trimmed.length > 1) cell = { f: trimmed };
      else if (NUMBER.test(trimmed)) cell = { v: Number(trimmed), t: 2 };
      else if (/^(TRUE|FALSE)$/i.test(trimmed)) cell = { v: trimmed.toUpperCase() === 'TRUE', t: 3 };
      else if (/^-?\d+(\.\d+)?%$/.test(trimmed)) cell = { v: Number(trimmed.slice(0, -1)) / 100, t: 2, s: { n: { pattern: '0%' } } };
      else cell = { v: raw, t: 1 };
      (s.cells[ri] ??= {})[ci] = cell;
    }),
  );
  return s;
}

const quote = (v: string) => (/[",\r\n]/.test(v) || /^\s|\s$/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** Exports the values (computed results for formulas) of one sheet, like Excel "Save as CSV UTF-8". */
export function sheetToCsv(s: PlainSheet): string {
  const { maxR, maxC } = usedRange(s);
  const lines: string[] = [];
  for (let r = 0; r <= maxR; r++) {
    const out: string[] = [];
    for (let c = 0; c <= maxC; c++) {
      const cell = s.cells[r]?.[c];
      const v = cellValue(cell);
      out.push(v === null || v === undefined ? '' : typeof v === 'boolean' ? (v ? 'TRUE' : 'FALSE') : quote(String(v)));
    }
    lines.push(out.join(','));
  }
  return `﻿${lines.join('\r\n')}\r\n`;
}
