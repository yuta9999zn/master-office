'use client';

import type { UniverAPI } from '../binding';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;
type IRange = { startRow: number; endRow: number; startColumn: number; endColumn: number };

const colName = (i: number) => {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};
export const a1 = (r: IRange) => {
  const a = `${colName(r.startColumn)}${r.startRow + 1}`;
  return r.startRow === r.endRow && r.startColumn === r.endColumn ? a : `${a}:${colName(r.endColumn)}${r.endRow + 1}`;
};
const lit = (v: unknown) => JSON.stringify(v);

/** Commands that only repeat what `sheet.command.set-style` already says, or that change nothing worth recording. */
const IGNORED = /^sheet\.command\.(set-(bold|italic|underline|stroke|range-(bold|italic|underline|stroke)|font-family|font-size|text-color|background-color|horizontal-text-align|vertical-text-align|text-wrap|text-rotation)|set-range-values-by-paste)$|^(ui\.|doc\.|formula\.)|scroll|zoom|copy|set-cell-edit|editor/;

/**
 * Macro recorder (like Google Sheets' "Record macro"): listens to the commands Univer runs while the user works
 * and turns them into script lines using absolute references. Style commands act on the selection, so the
 * recorder keeps track of the current selection and active sheet.
 */
export class MacroRecorder {
  private lines: string[] = [];
  private sub: { dispose(): void } | null = null;
  private selection: IRange = { startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 };
  private sheet: string | null = null;
  private skipped = new Set<string>();

  constructor(
    private readonly api: UniverAPI,
    private readonly unitId: string,
  ) {}

  start() {
    const wb = this.api.getWorkbook(this.unitId) as Any;
    const ws = wb?.getActiveSheet();
    this.sheet = ws?.getSheetName() ?? null;
    const sel = ws?.getSelection?.()?.getActiveRange?.();
    if (sel) this.selection = sel.getRange();
    this.sub = this.api.addEvent(this.api.Event.CommandExecuted, (e: Any) => this.on(e));
  }

  stop(): string[] {
    this.sub?.dispose();
    this.sub = null;
    return this.lines;
  }

  get count() {
    return this.lines.filter((l) => !l.trimStart().startsWith('//')).length;
  }

  private sheetName(subUnitId?: string) {
    if (!subUnitId) return this.sheet;
    return (this.api.getWorkbook(this.unitId) as Any)?.getSheetBySheetId(subUnitId)?.getSheetName() ?? this.sheet;
  }

  /** Switches the recorded active sheet when a command targets another one. */
  private onSheet(subUnitId?: string) {
    const name = this.sheetName(subUnitId);
    if (name && name !== this.sheet) {
      this.sheet = name;
      this.lines.push(`spreadsheet.setActiveSheet(spreadsheet.getSheetByName(${lit(name)}));`);
    }
  }

  private range(r?: IRange) {
    return `spreadsheet.getActiveSheet().getRange(${lit(a1(r ?? this.selection))})`;
  }

  private on(e: Any) {
    if ((e.params?.unitId && e.params.unitId !== this.unitId) || e.type === 2 /* mutation */ || e.options?.fromCollab) return;
    const p = e.params ?? {};
    const id: string = e.id;
    if (id === 'sheet.operation.set-selections') {
      const s = p.selections?.find((x: Any) => x.primary) ?? p.selections?.[0];
      if (s?.range) this.selection = s.range;
      if (p.subUnitId) this.sheet = this.sheetName(p.subUnitId);
      return;
    }
    if (id === 'sheet.operation.set-worksheet-active') return this.onSheet(p.subUnitId);
    if (e.type === 1 /* operation */ || IGNORED.test(id)) return;

    if (p.subUnitId) this.onSheet(p.subUnitId);
    const rg = (p.range as IRange | undefined) ?? (p.ranges?.[0] as IRange | undefined) ?? this.selection;
    switch (id) {
      case 'sheet.command.set-range-values': {
        const v = p.value;
        if (v && ('v' in v || 'f' in v)) {
          this.lines.push(v.f ? `${this.range(rg)}.setFormula(${lit(v.f)});` : `${this.range(rg)}.setValue(${lit(v.v ?? '')});`);
        } else if (v && typeof v === 'object') {
          // Matrix of cells (multi-cell input): one setValues call over the bounding range.
          const rows: unknown[][] = [];
          for (let r = rg.startRow; r <= rg.endRow; r++) {
            const row: unknown[] = [];
            for (let c = rg.startColumn; c <= rg.endColumn; c++) {
              const cell = v[r]?.[c] ?? v[r - rg.startRow]?.[c - rg.startColumn];
              row.push(cell?.f ?? cell?.v ?? '');
            }
            rows.push(row);
          }
          this.lines.push(`${this.range(rg)}.setValues(${lit(rows)});`);
        }
        return;
      }
      case 'sheet.command.set-style': {
        const { type, value } = p.style ?? {};
        const r = this.range(p.range ?? this.selection);
        const map: Record<string, () => string> = {
          bl: () => `${r}.setFontWeight(${lit(value ? 'bold' : 'normal')});`,
          it: () => `${r}.setFontStyle(${lit(value ? 'italic' : 'normal')});`,
          ul: () => `${r}.setFontLine(${lit(value?.s ? 'underline' : 'none')});`,
          st: () => `${r}.setFontLine(${lit(value?.s ? 'line-through' : 'none')});`,
          bg: () => `${r}.setBackground(${lit(value?.rgb ?? null)});`,
          cl: () => `${r}.setFontColor(${lit(value?.rgb ?? null)});`,
          fs: () => `${r}.setFontSize(${lit(value)});`,
          ff: () => `${r}.setFontFamily(${lit(value)});`,
          ht: () => `${r}.setHorizontalAlignment(${lit(value === 2 ? 'center' : value === 3 ? 'right' : 'left')});`,
          vt: () => `${r}.setVerticalAlignment(${lit(value === 1 ? 'top' : value === 2 ? 'middle' : 'bottom')});`,
          tb: () => `${r}.setWrap(${value === 3});`,
        };
        this.lines.push(map[type]?.() ?? `// Not recorded: style "${type}"`);
        return;
      }
      case 'sheet.command.numfmt.set.numfmt': {
        const pattern = p.values?.[0]?.pattern;
        if (pattern) this.lines.push(`${this.range()}.setNumberFormat(${lit(pattern)});`);
        return;
      }
      case 'sheet.command.clear-selection-content':
        this.lines.push(`${this.range()}.clearContent();`);
        return;
      case 'sheet.command.clear-selection-format':
        this.lines.push(`${this.range()}.clearFormat();`);
        return;
      case 'sheet.command.clear-selection-all':
        this.lines.push(`${this.range()}.clear();`);
        return;
      case 'sheet.command.insert-row-before':
      case 'sheet.command.insert-multi-rows-above':
        this.lines.push(`spreadsheet.getActiveSheet().insertRowsBefore(${this.selection.startRow + 1}, ${p.value ?? this.selection.endRow - this.selection.startRow + 1});`);
        return;
      case 'sheet.command.insert-row-after':
      case 'sheet.command.insert-multi-rows-after':
        this.lines.push(`spreadsheet.getActiveSheet().insertRowsAfter(${this.selection.endRow + 1}, ${p.value ?? this.selection.endRow - this.selection.startRow + 1});`);
        return;
      case 'sheet.command.insert-col-before':
      case 'sheet.command.insert-multi-cols-before':
        this.lines.push(`spreadsheet.getActiveSheet().insertColumnsBefore(${this.selection.startColumn + 1}, ${p.value ?? this.selection.endColumn - this.selection.startColumn + 1});`);
        return;
      case 'sheet.command.insert-col-after':
      case 'sheet.command.insert-multi-cols-right':
        this.lines.push(`spreadsheet.getActiveSheet().insertColumnsAfter(${this.selection.endColumn + 1}, ${p.value ?? this.selection.endColumn - this.selection.startColumn + 1});`);
        return;
      case 'sheet.command.remove-row':
      case 'sheet.command.remove-row-confirm': {
        const r = (p.range as IRange | undefined) ?? this.selection;
        this.lines.push(`spreadsheet.getActiveSheet().deleteRows(${r.startRow + 1}, ${r.endRow - r.startRow + 1});`);
        return;
      }
      case 'sheet.command.remove-col':
      case 'sheet.command.remove-col-confirm': {
        const r = (p.range as IRange | undefined) ?? this.selection;
        this.lines.push(`spreadsheet.getActiveSheet().deleteColumns(${r.startColumn + 1}, ${r.endColumn - r.startColumn + 1});`);
        return;
      }
      case 'sheet.command.add-worksheet-merge':
      case 'sheet.command.add-worksheet-merge-all':
        this.lines.push(`${this.range()}.merge();`);
        return;
      case 'sheet.command.remove-worksheet-merge':
        this.lines.push(`${this.range()}.breakApart();`);
        return;
      case 'sheet.command.set-worksheet-col-width':
        for (let c = this.selection.startColumn; c <= this.selection.endColumn; c++) this.lines.push(`spreadsheet.getActiveSheet().setColumnWidth(${c + 1}, ${lit(p.value)});`);
        return;
      case 'sheet.command.set-worksheet-row-height':
        for (let r = this.selection.startRow; r <= this.selection.endRow; r++) this.lines.push(`spreadsheet.getActiveSheet().setRowHeight(${r + 1}, ${lit(p.value)});`);
        return;
      case 'sheet.command.set-frozen':
        this.lines.push(`spreadsheet.getActiveSheet().setFrozenRows(${p.ySplit ?? 0});`, `spreadsheet.getActiveSheet().setFrozenColumns(${p.xSplit ?? 0});`);
        return;
      case 'sheet.command.cancel-frozen':
        this.lines.push('spreadsheet.getActiveSheet().setFrozenRows(0);', 'spreadsheet.getActiveSheet().setFrozenColumns(0);');
        return;
      case 'sheet.command.set-worksheet-name':
        this.lines.push(`spreadsheet.getActiveSheet().setName(${lit(p.name)});`);
        this.sheet = p.name;
        return;
      case 'sheet.command.insert-sheet':
        this.lines.push(`spreadsheet.insertSheet(${p.sheet?.name ? lit(p.sheet.name) : ''});`);
        if (p.sheet?.name) this.sheet = p.sheet.name;
        return;
      case 'sheet.command.remove-sheet':
        this.lines.push(`spreadsheet.deleteSheet(spreadsheet.getActiveSheet());`);
        return;
      case 'sheet.command.set-tab-color':
        this.lines.push(`spreadsheet.getActiveSheet().setTabColor(${lit(p.color || null)});`);
        return;
      case 'univer.command.undo':
      case 'univer.command.redo':
        this.lines.push(`// ${id.endsWith('undo') ? 'Undo' : 'Redo'} is not recorded — remove the line(s) above if needed`);
        return;
      default:
        if (!this.skipped.has(id)) {
          this.skipped.add(id);
          this.lines.push(`// Not recorded: ${id.replace(/^sheet\.command\./, '')}`);
        }
    }
  }
}

/** A valid JavaScript function name from a macro name ("Format header" → formatHeader). */
export function functionNameOf(name: string, taken: string[] = []) {
  const words = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
  let base = words.map((w, i) => (i ? w[0].toUpperCase() + w.slice(1) : w[0].toLowerCase() + w.slice(1))).join('') || 'myMacro';
  if (/^\d/.test(base)) base = `macro${base}`;
  let fn = base;
  for (let i = 2; taken.includes(fn); i++) fn = `${base}${i}`;
  return fn;
}

export function recordedCode(fn: string, lines: string[], author: string) {
  const body = lines.length ? lines.map((l) => `  ${l}`).join('\n') : '  // Nothing was recorded.';
  return `/** Recorded by ${author} on ${new Date().toISOString().slice(0, 10)}. */\nfunction ${fn}() {\n  var spreadsheet = SpreadsheetApp.getActive();\n${body}\n}\n`;
}
