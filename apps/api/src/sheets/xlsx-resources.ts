// Univer plugin state (conditional formats, data validation, notes, named ranges, hyperlinks) → Excel.
// The plugin JSON comes from the workbook's `resources` map; ranges in it are row/column indexes.
import type ExcelJS from 'exceljs';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;
interface IRange {
  startRow: number;
  endRow: number;
  startColumn: number;
  endColumn: number;
}

const colName = (i: number) => {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};
const a1 = (r: IRange) => {
  const a = `${colName(r.startColumn)}${r.startRow + 1}`;
  return r.startRow === r.endRow && r.startColumn === r.endColumn ? a : `${a}:${colName(r.endColumn)}${r.endRow + 1}`;
};
const refOf = (ranges: IRange[]) => ranges.map(a1).join(' ');

/** "#rrggbb", "#rgb" or "rgb(r,g,b)" → "FFRRGGBB". */
export function toArgb(c?: string | null): string | undefined {
  if (!c) return undefined;
  const m = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/i.exec(c);
  if (m) return 'FF' + [m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('').toUpperCase();
  let h = c.replace('#', '');
  if (h.length === 3) h = h.replace(/./g, (x) => x + x);
  return /^[0-9a-f]{6}$/i.test(h) ? 'FF' + h.toUpperCase() : undefined;
}

const parse = (json?: string) => {
  try {
    return json ? JSON.parse(json) : null;
  } catch {
    return null;
  }
};
const formula = (v: unknown) => String(v ?? '').replace(/^=/, '');
const quoted = (v: unknown) => (typeof v === 'number' || (typeof v === 'string' && v !== '' && !Number.isNaN(Number(v))) ? String(v) : `"${String(v ?? '').replace(/"/g, '""')}"`);

function dxf(style: Any = {}): Any {
  const out: Any = {};
  const font: Any = {};
  if (style.bl) font.bold = true;
  if (style.it) font.italic = true;
  if (style.ul?.s) font.underline = true;
  if (style.st?.s) font.strike = true;
  const color = toArgb(style.cl?.rgb);
  if (color) font.color = { argb: color };
  if (Object.keys(font).length) out.font = font;
  const bg = toArgb(style.bg?.rgb);
  if (bg) out.fill = { type: 'pattern', pattern: 'solid', bgColor: { argb: bg }, fgColor: { argb: bg } };
  return out;
}

const CELL_IS: Record<string, string> = {
  between: 'between',
  notBetween: 'notBetween',
  equal: 'equal',
  notEqual: 'notEqual',
  greaterThan: 'greaterThan',
  greaterThanOrEqual: 'greaterThanOrEqual',
  lessThan: 'lessThan',
  lessThanOrEqual: 'lessThanOrEqual',
};
const cfvo = (v: Any) => {
  const t = v?.type ?? 'min';
  const type = t === 'percentile' ? 'percentile' : t === 'percent' ? 'percent' : t === 'num' ? 'num' : t === 'formula' ? 'formula' : t === 'max' ? 'max' : 'min';
  return type === 'min' || type === 'max' ? { type } : { type, value: type === 'formula' ? formula(v.value) : Number(v.value) };
};

/** One Univer conditional-format rule → an ExcelJS rule (null when Excel has no equivalent). */
function cfRule(rule: Any, ranges: IRange[], priority: number): Any | null {
  const style = dxf(rule.style);
  const first = ranges[0];
  const topLeft = first ? `${colName(first.startColumn)}${first.startRow + 1}` : 'A1';
  switch (rule.type) {
    case 'highlightCell':
      switch (rule.subType) {
        case 'number': {
          const op = CELL_IS[rule.operator];
          if (!op) return null;
          const vals = Array.isArray(rule.value) ? rule.value : [rule.value];
          return { type: 'cellIs', operator: op, formulae: vals.map(quoted), style, priority };
        }
        case 'text': {
          const t = String(rule.value ?? '');
          if (rule.operator === 'equal') return { type: 'cellIs', operator: 'equal', formulae: [quoted(t)], style, priority };
          if (rule.operator === 'notEqual') return { type: 'cellIs', operator: 'notEqual', formulae: [quoted(t)], style, priority };
          const op = { containsText: 'containsText', notContainsText: 'notContains', beginsWith: 'beginsWith', endsWith: 'endsWith' }[rule.operator as string];
          return op ? { type: 'containsText', operator: op, text: t, style, priority } : null;
        }
        case 'formula':
          return { type: 'expression', formulae: [formula(rule.value)], style, priority };
        case 'duplicateValues':
        case 'uniqueValues': {
          const all = first ? `$${colName(first.startColumn)}$${first.startRow + 1}:$${colName(first.endColumn)}$${first.endRow + 1}` : 'A:A';
          return { type: 'expression', formulae: [`COUNTIF(${all},${topLeft})${rule.subType === 'duplicateValues' ? '>1' : '=1'}`], style, priority };
        }
        case 'rank':
          return { type: 'top10', rank: Number(rule.value) || 10, percent: !!rule.isPercent, bottom: !!rule.isBottom, style, priority };
        case 'average':
          if (rule.operator === 'greaterThan' || rule.operator === 'lessThan') return { type: 'aboveAverage', aboveAverage: rule.operator === 'greaterThan', style, priority };
          return null;
        default:
          return null;
      }
    case 'colorScale': {
      const pts = [...(rule.config ?? [])].sort((a: Any, b: Any) => a.index - b.index);
      if (pts.length < 2) return null;
      return { type: 'colorScale', cfvo: pts.map((p: Any) => cfvo(p.value)), color: pts.map((p: Any) => ({ argb: toArgb(p.color) ?? 'FFFFFFFF' })), priority };
    }
    case 'dataBar':
      return {
        type: 'dataBar',
        cfvo: [cfvo(rule.config?.min), cfvo(rule.config?.max)],
        color: { argb: toArgb(rule.config?.positiveColor) ?? 'FF638EC6' },
        gradient: rule.config?.isGradient !== false,
        showValue: rule.isShowValue !== false,
        priority,
      };
    case 'iconSet':
      return { type: 'iconSet', iconSet: '3TrafficLights1', showValue: rule.isShowValue !== false, cfvo: [{ type: 'percent', value: 0 }, { type: 'percent', value: 33 }, { type: 'percent', value: 67 }], priority };
    default:
      return null;
  }
}

function dvRule(r: Any): Any | null {
  const base = {
    allowBlank: r.allowBlank !== false,
    showErrorMessage: true,
    errorStyle: r.errorStyle === 2 ? 'warning' : r.errorStyle === 3 ? 'information' : 'stop',
    ...(r.error ? { error: String(r.error), errorTitle: 'Invalid value' } : {}),
    ...(r.prompt ? { showInputMessage: true, prompt: String(r.prompt) } : {}),
  };
  const ops: Record<string, string> = { between: 'between', notBetween: 'notBetween', equal: 'equal', notEqual: 'notEqual', greaterThan: 'greaterThan', greaterThanOrEqual: 'greaterThanOrEqual', lessThan: 'lessThan', lessThanOrEqual: 'lessThanOrEqual' };
  const nums = () => [r.formula1, r.formula2].filter((v) => v !== undefined && v !== null && v !== '').map((v) => formula(v));
  switch (r.type) {
    case 'list':
    case 'listMultiple': {
      const f = String(r.formula1 ?? '');
      if (f.startsWith('=')) return { ...base, type: 'list', formulae: [formula(f)] };
      let items: string[];
      try {
        const parsed = JSON.parse(f);
        items = Array.isArray(parsed) ? parsed.map(String) : f.split(',');
      } catch {
        items = f.split(',');
      }
      return { ...base, type: 'list', formulae: [`"${items.map((s) => s.trim().replace(/"/g, '""')).join(',')}"`] };
    }
    case 'checkbox':
      return { ...base, type: 'list', formulae: ['"TRUE,FALSE"'] };
    case 'decimal':
    case 'whole':
    case 'date':
    case 'textLength':
      return { ...base, type: r.type, operator: ops[r.operator] ?? 'between', formulae: nums() };
    case 'custom':
      return { ...base, type: 'custom', formulae: [formula(r.formula1)] };
    default:
      return null;
  }
}

/**
 * Adds the workbook's plugin state to the ExcelJS sheets (`sheets` maps Master Office sheet ids to ExcelJS sheets).
 * Returns what could not be carried over, for the export report.
 */
export function applyResources(book: ExcelJS.Workbook, sheets: Map<string, ExcelJS.Worksheet>, resources: Record<string, string> = {}) {
  const skipped: string[] = [];

  const cf = parse(resources.SHEET_CONDITIONAL_FORMATTING_PLUGIN) as Record<string, Any[]> | null;
  for (const [sheetId, rules] of Object.entries(cf ?? {})) {
    const ws = sheets.get(sheetId);
    if (!ws) continue;
    // Univer lists the newest rule first, which is also the highest priority.
    (rules ?? []).forEach((r: Any, i: number) => {
      const out = cfRule(r.rule, r.ranges ?? [], i + 1);
      if (out && r.ranges?.length) ws.addConditionalFormatting({ ref: refOf(r.ranges), rules: [out] });
      else skipped.push(`conditional format (${r.rule?.type}/${r.rule?.subType ?? ''})`);
    });
  }

  const dv = parse(resources.SHEET_DATA_VALIDATION_PLUGIN) as Record<string, Any[]> | null;
  for (const [sheetId, rules] of Object.entries(dv ?? {})) {
    const ws = sheets.get(sheetId) as Any;
    if (!ws) continue;
    for (const r of rules ?? []) {
      const out = dvRule(r);
      if (!out) {
        skipped.push(`data validation (${r.type})`);
        continue;
      }
      for (const range of r.ranges ?? []) ws.dataValidations.add(a1(range), out);
    }
  }

  const notes = parse(resources.SHEET_NOTE_PLUGIN) as Record<string, Record<string, Record<string, Any>>> | null;
  for (const [sheetId, rows] of Object.entries(notes ?? {})) {
    const ws = sheets.get(sheetId);
    if (!ws) continue;
    for (const [r, cols] of Object.entries(rows ?? {})) for (const [c, n] of Object.entries(cols ?? {})) if (n?.note) ws.getCell(Number(r) + 1, Number(c) + 1).note = String(n.note);
  }

  const links = parse(resources.SHEET_HYPER_LINK_PLUGIN) as Record<string, Any[]> | null;
  for (const [sheetId, list] of Object.entries(links ?? {})) {
    const ws = sheets.get(sheetId);
    if (!ws) continue;
    for (const l of list ?? []) {
      if (typeof l?.payload !== 'string' || !/^(https?:|mailto:)/i.test(l.payload)) continue;
      const cell = ws.getCell(Number(l.row) + 1, Number(l.column) + 1);
      cell.value = { text: String(l.display || (typeof cell.value === 'string' ? cell.value : '') || l.payload), hyperlink: l.payload };
    }
  }

  const names = parse(resources.SHEET_DEFINED_NAME_PLUGIN) as Record<string, Any> | null;
  for (const n of Object.values(names ?? {})) {
    const ref = String(n?.formulaOrRefString ?? '').replace(/^=/, '');
    if (!n?.name || !/^('[^']+'|[^!]+)!\$?[A-Z]+\$?\d+(:\$?[A-Z]+\$?\d+)?$/i.test(ref)) {
      if (n?.name) skipped.push(`named range ${n.name} (formula)`);
      continue;
    }
    try {
      book.definedNames.add(ref, n.name);
    } catch {
      skipped.push(`named range ${n.name}`);
    }
  }
  return skipped;
}

// ── Excel → Univer plugin state ─────────────────────────────────────────────

const rid = () => Math.random().toString(36).slice(2, 10);
const colIndex = (s: string) => s.toUpperCase().split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
/** "A1", "A1:C5" (with or without $) → range. */
function parseA1(ref: string): IRange | null {
  const m = /^\$?([A-Z]{1,3})\$?(\d+)(?::\$?([A-Z]{1,3})\$?(\d+))?$/i.exec(ref.trim());
  if (!m) return null;
  const r0 = Number(m[2]) - 1;
  const c0 = colIndex(m[1]);
  const r1 = m[4] ? Number(m[4]) - 1 : r0;
  const c1 = m[3] ? colIndex(m[3]) : c0;
  return { startRow: Math.min(r0, r1), endRow: Math.max(r0, r1), startColumn: Math.min(c0, c1), endColumn: Math.max(c0, c1) };
}
const withType = (r: IRange) => ({ ...r, rangeType: 0 });
const hexOf = (argb?: string) => (argb && /^[0-9a-f]{8}$/i.test(argb) ? `#${argb.slice(2)}` : argb && /^[0-9a-f]{6}$/i.test(argb) ? `#${argb}` : undefined);

function styleIn(style: Any = {}): Any {
  const s: Any = {};
  if (style.font?.bold) s.bl = 1;
  if (style.font?.italic) s.it = 1;
  if (style.font?.underline) s.ul = { s: 1 };
  if (style.font?.strike) s.st = { s: 1 };
  const cl = hexOf(style.font?.color?.argb);
  if (cl) s.cl = { rgb: cl };
  const bg = hexOf(style.fill?.bgColor?.argb ?? style.fill?.fgColor?.argb);
  if (bg) s.bg = { rgb: bg };
  return s;
}
const cfvoIn = (v: Any) => ({ type: v?.type === 'number' ? 'num' : (v?.type ?? 'min'), ...(v?.value !== undefined ? { value: v.type === 'formula' ? `=${v.value}` : Number(v.value) } : {}) });
const numOrText = (v: unknown) => (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v)) ? Number(v) : typeof v === 'string' ? v.replace(/^"(.*)"$/, '$1') : v);

function cfRuleIn(r: Any): Any | null {
  switch (r.type) {
    case 'cellIs': {
      const op = CELL_IS[r.operator];
      if (!op) return null;
      const vals = (r.formulae ?? []).map(numOrText);
      return { type: 'highlightCell', subType: 'number', operator: op, value: op === 'between' || op === 'notBetween' ? vals.slice(0, 2) : vals[0], style: styleIn(r.style) };
    }
    case 'containsText': {
      const op = { containsText: 'containsText', notContains: 'notContainsText', beginsWith: 'beginsWith', endsWith: 'endsWith' }[r.operator as string];
      return op ? { type: 'highlightCell', subType: 'text', operator: op, value: String(r.text ?? ''), style: styleIn(r.style) } : null;
    }
    case 'expression':
      return r.formulae?.[0] ? { type: 'highlightCell', subType: 'formula', operator: 'containsText', value: `=${r.formulae[0]}`, style: styleIn(r.style) } : null;
    case 'top10':
      return { type: 'highlightCell', subType: 'rank', isBottom: !!r.bottom, isPercent: !!r.percent, value: Number(r.rank) || 10, style: styleIn(r.style) };
    case 'aboveAverage':
      return { type: 'highlightCell', subType: 'average', operator: r.aboveAverage === false ? 'lessThan' : 'greaterThan', style: styleIn(r.style) };
    case 'colorScale':
      return { type: 'colorScale', config: (r.cfvo ?? []).map((v: Any, i: number) => ({ index: i, color: hexOf(r.color?.[i]?.argb) ?? '#FFFFFF', value: cfvoIn(v) })) };
    case 'dataBar':
      return {
        type: 'dataBar',
        isShowValue: r.showValue !== false,
        config: { min: cfvoIn(r.cfvo?.[0]), max: cfvoIn(r.cfvo?.[1]), positiveColor: hexOf(r.color?.argb) ?? '#638EC6', nativeColor: '#FF0000', isGradient: r.gradient !== false },
      };
    default:
      return null;
  }
}

function dvRuleIn(v: Any): Any | null {
  const common = {
    allowBlank: v.allowBlank !== false,
    errorStyle: v.errorStyle === 'warning' ? 2 : v.errorStyle === 'information' ? 3 : 1,
    ...(v.error ? { error: String(v.error) } : {}),
    ...(v.prompt ? { prompt: String(v.prompt) } : {}),
  };
  const f = (x: unknown) => (x === undefined || x === null ? undefined : String(x));
  switch (v.type) {
    case 'list': {
      const raw = String(v.formulae?.[0] ?? '');
      if (/^".*"$/.test(raw)) {
        const items = raw.slice(1, -1).split(',').map((s) => s.trim()).filter(Boolean);
        if (items.length === 2 && items.map((s) => s.toUpperCase()).join(',') === 'TRUE,FALSE') return { ...common, type: 'checkbox' };
        // Univer's own list format is a JSON array of options.
        return { ...common, type: 'list', formula1: JSON.stringify(items), showDropDown: true };
      }
      return raw ? { ...common, type: 'list', formula1: `=${raw}`, showDropDown: true } : null;
    }
    case 'decimal':
    case 'whole':
    case 'date':
    case 'textLength':
      return { ...common, type: v.type, operator: v.operator ?? 'between', formula1: f(v.formulae?.[0]), ...(v.formulae?.[1] !== undefined ? { formula2: f(v.formulae[1]) } : {}) };
    case 'custom':
      return v.formulae?.[0] ? { ...common, type: 'custom', formula1: `=${v.formulae[0]}` } : null;
    default:
      return null;
  }
}

/** Joins single cells of the same rule into column runs (ExcelJS expands validation ranges into cells). */
function runsOf(cells: IRange[]): IRange[] {
  const byCol = new Map<number, number[]>();
  for (const c of cells)
    for (let col = c.startColumn; col <= c.endColumn; col++) {
      const rows = byCol.get(col) ?? [];
      for (let r = c.startRow; r <= c.endRow; r++) rows.push(r);
      byCol.set(col, rows);
    }
  const out: IRange[] = [];
  for (const [col, rows] of byCol) {
    const sorted = [...new Set(rows)].sort((a, b) => a - b);
    let start = sorted[0];
    for (let i = 1; i <= sorted.length; i++) {
      if (i < sorted.length && sorted[i] === sorted[i - 1] + 1) continue;
      out.push({ startRow: start, endRow: sorted[i - 1], startColumn: col, endColumn: col });
      start = sorted[i];
    }
  }
  return out;
}

/** Reads conditional formats, data validation, notes and named ranges into Univer plugin JSON. */
export function readResources(book: ExcelJS.Workbook, sheets: { id: string; ws: ExcelJS.Worksheet }[]) {
  const counts = { conditional: 0, conditionalSkipped: 0, validations: 0, validationsSkipped: 0, notes: 0, names: 0 };
  const cf: Record<string, Any[]> = {};
  const dv: Record<string, Any[]> = {};
  const notes: Record<string, Record<number, Record<number, Any>>> = {};
  for (const { id, ws } of sheets) {
    const list: { priority: number; rule: Any }[] = [];
    for (const block of ((ws as Any).conditionalFormattings ?? []) as Any[]) {
      const ranges = String(block.ref ?? '')
        .split(/\s+/)
        .map(parseA1)
        .filter((r): r is IRange => !!r);
      for (const r of block.rules ?? []) {
        const rule = ranges.length ? cfRuleIn(r) : null;
        if (!rule) {
          counts.conditionalSkipped++;
          continue;
        }
        counts.conditional++;
        list.push({ priority: Number(r.priority) || 999, rule: { cfId: rid(), ranges: ranges.map(withType), rule, stopIfTrue: !!r.stopIfTrue } });
      }
    }
    // Univer keeps the highest priority first.
    if (list.length) cf[id] = list.sort((a, b) => a.priority - b.priority).map((x) => x.rule);

    const groups = new Map<string, { rule: Any; cells: IRange[] }>();
    for (const [addr, v] of Object.entries(((ws as Any).dataValidations?.model ?? {}) as Record<string, Any>)) {
      const range = parseA1(addr.replace(/^range:/, ''));
      const rule = range ? dvRuleIn(v) : null;
      if (!rule || !range) {
        counts.validationsSkipped++;
        continue;
      }
      const key = JSON.stringify(rule);
      const g = groups.get(key) ?? { rule, cells: [] };
      g.cells.push(range);
      groups.set(key, g);
    }
    if (groups.size) {
      dv[id] = [...groups.values()].map((g) => ({ uid: rid(), ranges: runsOf(g.cells).map(withType), ...g.rule }));
      counts.validations += groups.size;
    }

    ws.eachRow({ includeEmpty: false }, (row, r) =>
      row.eachCell({ includeEmpty: false }, (cell, c) => {
        const n = cell.note as Any;
        const text = typeof n === 'string' ? n : (n?.texts ?? []).map((t: Any) => t.text).join('');
        if (!text) return;
        ((notes[id] ??= {})[r - 1] ??= {})[c - 1] = { id: rid(), note: text, width: 200, height: 80, row: r - 1, col: c - 1 };
        counts.notes++;
      }),
    );
  }
  const names: Record<string, Any> = {};
  for (const n of ((book.definedNames as Any).model ?? []) as { name: string; ranges: string[] }[]) {
    if (!n?.name || !n.ranges?.length || n.name.startsWith('_xlnm.')) continue;
    const id = rid();
    names[id] = { id, name: n.name, formulaOrRefString: n.ranges.join(','), localSheetId: 'AllDefaultWorkbook' };
    counts.names++;
  }
  const resources: Record<string, string> = {};
  if (Object.keys(cf).length) resources.SHEET_CONDITIONAL_FORMATTING_PLUGIN = JSON.stringify(cf);
  if (Object.keys(dv).length) resources.SHEET_DATA_VALIDATION_PLUGIN = JSON.stringify(dv);
  if (Object.keys(notes).length) resources.SHEET_NOTE_PLUGIN = JSON.stringify(notes);
  if (Object.keys(names).length) resources.SHEET_DEFINED_NAME_PLUGIN = JSON.stringify(names);
  return { resources, counts };
}
