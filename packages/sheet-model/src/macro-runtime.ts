// Macro runtime (docs/ARCHITECTURE.md §24, §48). This function is serialised with `toString()` and runs alone —
// in a Web Worker in the browser, in an isolated-vm isolate on the server: it must not reference anything outside
// its own body. It exposes a Google Apps Script–style API
// (SpreadsheetApp / Sheet / Range / Logger / Browser / Utilities) over a snapshot of the workbook, records every
// change as an operation, and posts { ops, logs, error } back. The main thread applies the ops through Univer,
// so the changes sync to everyone like any other edit. Network and DOM access are removed before user code runs.

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface MacroCell {
  v?: string | number | boolean | null;
  f?: string;
  s?: Record<string, any>;
}
export interface MacroSheetSnapshot {
  name: string;
  maxRows: number;
  maxCols: number;
  frozenRows: number;
  frozenCols: number;
  cells: Record<string, MacroCell>; // "row:col" (0-based)
}
export interface MacroSnapshot {
  name: string;
  active: string;
  selection: { sheet: string; r: number; c: number; nr: number; nc: number } | null;
  sheets: MacroSheetSnapshot[];
}
export type MacroOp = { op: string; sheet?: string; [k: string]: any };
/** What a trigger passes to onOpen(e) / onEdit(e) / onSelectionChange(e) (Apps Script event objects). */
export interface MacroEvent {
  trigger: 'onOpen' | 'onEdit' | 'onSelectionChange' | 'time' | 'formSubmit';
  range: { sheet: string; r: number; c: number; nr: number; nc: number } | null;
  value?: string | number | boolean | null;
  oldValue?: string | number | boolean | null;
  user: { email: string; name: string };
  /** On form submit: the response row, and answers by question title (Apps Script e.values / e.namedValues). */
  values?: (string | number)[];
  namedValues?: Record<string, string[]>;
}
export interface MacroRequest {
  code: string;
  fn: string | null;
  snapshot: MacroSnapshot;
  event?: MacroEvent | null;
}
export interface MacroResult {
  ok: boolean;
  ops: MacroOp[];
  logs: string[];
  error: string | null;
  ms: number;
}

export function macroWorker() {
  const g = globalThis as any;
  // Sandbox: no network, no storage, no nested workers.
  for (const k of ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'importScripts', 'indexedDB', 'caches', 'Worker', 'SharedWorker', 'BroadcastChannel', 'navigator']) {
    try {
      Object.defineProperty(g, k, { value: undefined, configurable: false, writable: false });
    } catch {
      /* not configurable in this browser */
    }
  }

  const colName = (i: number) => {
    let s = '';
    for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
    return s;
  };
  const colIndex = (s: string) => s.toUpperCase().split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;

  g.onmessage = async (e: { data: MacroRequest }) => {
    const t0 = Date.now();
    const { code, fn, snapshot, event } = e.data;
    const ops: MacroOp[] = [];
    const logs: string[] = [];
    const fmt = (a: unknown) => (typeof a === 'string' ? a : a instanceof Error ? a.message : (() => { try { return JSON.stringify(a); } catch { return String(a); } })());
    const log = (...a: unknown[]) => logs.push(a.map(fmt).join(' '));

    // ── In-memory workbook ────────────────────────────────────────────────
    type SheetModel = MacroSheetSnapshot & { map: Map<string, MacroCell> };
    const sheets: SheetModel[] = snapshot.sheets.map((s) => ({ ...s, map: new Map(Object.entries(s.cells)) }));
    let activeName = snapshot.active;
    const findSheet = (name: string) => sheets.find((s) => s.name === name) ?? null;
    const need = (name: string) => {
      const s = findSheet(name);
      if (!s) throw new Error(`Sheet "${name}" does not exist (it may have been renamed or deleted)`);
      return s;
    };
    const key = (r: number, c: number) => `${r}:${c}`;
    const shift = (s: SheetModel, axis: 'r' | 'c', at: number, n: number) => {
      const next = new Map<string, MacroCell>();
      for (const [k, v] of s.map) {
        const [r, c] = k.split(':').map(Number);
        const p = axis === 'r' ? r : c;
        if (n < 0 && p >= at && p < at - n) continue; // deleted
        const q = p >= at ? p + n : p;
        next.set(axis === 'r' ? key(q, c) : key(r, q), v);
      }
      s.map = next;
      if (axis === 'r') s.maxRows += n;
      else s.maxCols += n;
    };
    const toCell = (v: unknown): MacroCell => {
      if (v === null || v === undefined || v === '') return {};
      if (typeof v === 'string' && v.startsWith('=') && v.length > 1) return { f: v };
      if (v instanceof Date) return { v: v.getTime() / 86_400_000 + 25569 }; // Excel serial date
      if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string') return { v };
      return { v: String(v) };
    };
    const outValue = (c: MacroCell | undefined) => (c?.v === undefined || c?.v === null ? '' : c.v);

    // ── Range ─────────────────────────────────────────────────────────────
    class Range {
      constructor(readonly sheetName: string, readonly r: number, readonly c: number, readonly nr: number, readonly nc: number) {
        if (r < 0 || c < 0 || nr < 1 || nc < 1) throw new Error('The coordinates of the range are out of bounds');
      }
      private get s() {
        return need(this.sheetName);
      }
      private each(fn: (r: number, c: number, i: number, j: number) => void) {
        for (let i = 0; i < this.nr; i++) for (let j = 0; j < this.nc; j++) fn(this.r + i, this.c + j, i, j);
      }
      private grid<T>(fn: (r: number, c: number) => T): T[][] {
        return Array.from({ length: this.nr }, (_, i) => Array.from({ length: this.nc }, (_, j) => fn(this.r + i, this.c + j)));
      }
      private write(rows: (MacroCell | null)[][]) {
        const s = this.s;
        rows.forEach((row, i) =>
          row.forEach((cell, j) => {
            const k = key(this.r + i, this.c + j);
            const prev = s.map.get(k) ?? {};
            const next: MacroCell = { ...(prev.s ? { s: prev.s } : {}), ...(cell ?? {}) };
            if (next.v === undefined && !next.f && !next.s) s.map.delete(k);
            else s.map.set(k, next);
          }),
        );
        s.maxRows = Math.max(s.maxRows, this.r + rows.length);
        ops.push({ op: 'cells', sheet: this.sheetName, r: this.r, c: this.c, rows });
        return this;
      }
      private style(kind: string, value: unknown, apply: (st: Record<string, any>) => void) {
        this.each((r, c) => {
          const cell = this.s.map.get(key(r, c)) ?? {};
          const st = { ...(cell.s ?? {}) };
          apply(st);
          this.s.map.set(key(r, c), { ...cell, s: st });
        });
        ops.push({ op: 'style', sheet: this.sheetName, r: this.r, c: this.c, nr: this.nr, nc: this.nc, kind, value });
        return this;
      }
      getSheet() {
        return new Sheet(this.sheetName);
      }
      getA1Notation() {
        const a = `${colName(this.c)}${this.r + 1}`;
        return this.nr === 1 && this.nc === 1 ? a : `${a}:${colName(this.c + this.nc - 1)}${this.r + this.nr}`;
      }
      getRow() {
        return this.r + 1;
      }
      getColumn() {
        return this.c + 1;
      }
      getLastRow() {
        return this.r + this.nr;
      }
      getLastColumn() {
        return this.c + this.nc;
      }
      getNumRows() {
        return this.nr;
      }
      getNumColumns() {
        return this.nc;
      }
      getCell(row: number, col: number) {
        return new Range(this.sheetName, this.r + row - 1, this.c + col - 1, 1, 1);
      }
      offset(rows: number, cols: number, nr?: number, nc?: number) {
        return new Range(this.sheetName, this.r + rows, this.c + cols, nr ?? this.nr, nc ?? this.nc);
      }
      getValue() {
        return outValue(this.s.map.get(key(this.r, this.c)));
      }
      getValues() {
        return this.grid((r, c) => outValue(this.s.map.get(key(r, c))));
      }
      getDisplayValue() {
        return String(this.getValue());
      }
      getDisplayValues() {
        return this.getValues().map((row) => row.map((v) => String(v)));
      }
      getFormula() {
        return this.s.map.get(key(this.r, this.c))?.f ?? '';
      }
      getFormulas() {
        return this.grid((r, c) => this.s.map.get(key(r, c))?.f ?? '');
      }
      getNumberFormat() {
        return this.s.map.get(key(this.r, this.c))?.s?.n?.pattern ?? 'General';
      }
      getBackground() {
        return this.s.map.get(key(this.r, this.c))?.s?.bg?.rgb ?? '#ffffff';
      }
      getFontColor() {
        return this.s.map.get(key(this.r, this.c))?.s?.cl?.rgb ?? '#000000';
      }
      getFontWeight() {
        return this.s.map.get(key(this.r, this.c))?.s?.bl ? 'bold' : 'normal';
      }
      isBlank() {
        return this.getValues().every((row) => row.every((v) => v === '')) && this.getFormulas().every((row) => row.every((f) => !f));
      }
      setValue(v: unknown) {
        return this.write(Array.from({ length: this.nr }, () => Array.from({ length: this.nc }, () => toCell(v))));
      }
      setValues(values: unknown[][]) {
        if (!Array.isArray(values) || values.length !== this.nr || values.some((row) => !Array.isArray(row) || row.length !== this.nc)) {
          throw new Error(`The number of rows/columns in the data (${values?.length}×${values?.[0]?.length}) does not match the range (${this.nr}×${this.nc})`);
        }
        return this.write(values.map((row) => row.map(toCell)));
      }
      setFormula(f: string) {
        return this.setValue(f.startsWith('=') ? f : `=${f}`);
      }
      setFormulas(fs: string[][]) {
        return this.setValues(fs.map((row) => row.map((f) => (f ? (f.startsWith('=') ? f : `=${f}`) : ''))));
      }
      clearContent() {
        return this.write(Array.from({ length: this.nr }, () => Array.from({ length: this.nc }, () => null)));
      }
      clearFormat() {
        this.each((r, c) => {
          const cell = this.s.map.get(key(r, c));
          if (cell?.s) this.s.map.set(key(r, c), { ...cell, s: undefined });
        });
        ops.push({ op: 'clear', sheet: this.sheetName, r: this.r, c: this.c, nr: this.nr, nc: this.nc, what: 'format' });
        return this;
      }
      clear(opts?: { contentsOnly?: boolean; formatOnly?: boolean }) {
        if (opts?.contentsOnly) return this.clearContent();
        if (opts?.formatOnly) return this.clearFormat();
        this.each((r, c) => this.s.map.delete(key(r, c)));
        ops.push({ op: 'clear', sheet: this.sheetName, r: this.r, c: this.c, nr: this.nr, nc: this.nc, what: 'all' });
        return this;
      }
      setBackground(color: string | null) {
        return this.style('background', color, (st) => (color ? (st.bg = { rgb: color }) : delete st.bg));
      }
      setFontColor(color: string | null) {
        return this.style('fontColor', color, (st) => (color ? (st.cl = { rgb: color }) : delete st.cl));
      }
      setFontWeight(w: 'bold' | 'normal' | null) {
        return this.style('fontWeight', w ?? 'normal', (st) => (st.bl = w === 'bold' ? 1 : 0));
      }
      setFontStyle(s: 'italic' | 'normal' | null) {
        return this.style('fontStyle', s ?? 'normal', (st) => (st.it = s === 'italic' ? 1 : 0));
      }
      setFontLine(l: 'underline' | 'line-through' | 'none' | null) {
        return this.style('fontLine', l ?? 'none', (st) => {
          st.ul = { s: l === 'underline' ? 1 : 0 };
          st.st = { s: l === 'line-through' ? 1 : 0 };
        });
      }
      setFontSize(n: number) {
        return this.style('fontSize', n, (st) => (st.fs = n));
      }
      setFontFamily(f: string) {
        return this.style('fontFamily', f, (st) => (st.ff = f));
      }
      setHorizontalAlignment(a: 'left' | 'center' | 'right' | 'normal' | null) {
        return this.style('hAlign', a ?? 'left', (st) => (st.ht = a === 'center' ? 2 : a === 'right' ? 3 : 1));
      }
      setVerticalAlignment(a: 'top' | 'middle' | 'bottom' | null) {
        return this.style('vAlign', a ?? 'bottom', (st) => (st.vt = a === 'top' ? 1 : a === 'middle' ? 2 : 3));
      }
      setWrap(on: boolean) {
        return this.style('wrap', !!on, (st) => (st.tb = on ? 3 : 1));
      }
      setNumberFormat(pattern: string) {
        return this.style('numberFormat', pattern, (st) => (st.n = { pattern }));
      }
      setBorder(top: boolean | null, left: boolean | null, bottom: boolean | null, right: boolean | null, vertical?: boolean | null, horizontal?: boolean | null, color?: string) {
        ops.push({ op: 'border', sheet: this.sheetName, r: this.r, c: this.c, nr: this.nr, nc: this.nc, top, left, bottom, right, vertical: vertical ?? null, horizontal: horizontal ?? null, color: color ?? '#000000' });
        return this;
      }
      merge() {
        ops.push({ op: 'merge', sheet: this.sheetName, r: this.r, c: this.c, nr: this.nr, nc: this.nc });
        return this;
      }
      breakApart() {
        ops.push({ op: 'unmerge', sheet: this.sheetName, r: this.r, c: this.c, nr: this.nr, nc: this.nc });
        return this;
      }
      activate() {
        activeName = this.sheetName;
        ops.push({ op: 'select', sheet: this.sheetName, r: this.r, c: this.c, nr: this.nr, nc: this.nc });
        return this;
      }
      copyTo(dest: Range) {
        const vals = this.grid((r, c) => {
          const cell = this.s.map.get(key(r, c));
          return cell ? { ...cell } : null;
        });
        return new Range(dest.sheetName, dest.r, dest.c, this.nr, this.nc).write(vals);
      }
      /** Sorts rows of the range by one or more columns: sort(2), sort({column: 2, ascending: false}), sort([…]). */
      sort(spec: number | { column: number; ascending?: boolean } | { column: number; ascending?: boolean }[]) {
        const list = (Array.isArray(spec) ? spec : [spec]).map((x) => (typeof x === 'number' ? { column: x, ascending: true } : { ascending: true, ...x }));
        const rows = this.grid((r, c) => this.s.map.get(key(r, c)) ?? null);
        rows.sort((a, b) => {
          for (const { column, ascending } of list) {
            const j = column - 1 - this.c;
            const x = a[j]?.v ?? '';
            const y = b[j]?.v ?? '';
            if (x === y) continue;
            const cmp = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y));
            return ascending ? cmp : -cmp;
          }
          return 0;
        });
        return this.write(rows.map((row) => row.map((c) => (c ? { ...c } : null))));
      }
    }

    // ── Sheet ─────────────────────────────────────────────────────────────
    const parseA1 = (sheetName: string, a1: string): Range => {
      let name = sheetName;
      let ref = a1.trim();
      const bang = ref.lastIndexOf('!');
      if (bang > 0) {
        name = ref.slice(0, bang).replace(/^'(.*)'$/, '$1').replace(/''/g, "'");
        ref = ref.slice(bang + 1);
      }
      const s = need(name);
      const part = (p: string) => {
        const m = /^\$?([A-Za-z]*)\$?(\d*)$/.exec(p);
        if (!m || (!m[1] && !m[2])) throw new Error(`Range not found: ${a1}`);
        return { c: m[1] ? colIndex(m[1]) : null, r: m[2] ? Number(m[2]) - 1 : null };
      };
      const [x, y = x] = ref.split(':');
      const p = part(x);
      const q = part(y);
      const r0 = p.r ?? 0;
      const r1 = q.r ?? s.maxRows - 1;
      const c0 = p.c ?? 0;
      const c1 = q.c ?? s.maxCols - 1;
      return new Range(name, Math.min(r0, r1), Math.min(c0, c1), Math.abs(r1 - r0) + 1, Math.abs(c1 - c0) + 1);
    };

    class Sheet {
      constructor(private sheetName: string) {}
      private get s() {
        return need(this.sheetName);
      }
      getName() {
        return this.sheetName;
      }
      setName(name: string) {
        if (findSheet(name) && name !== this.sheetName) throw new Error(`A sheet with the name "${name}" already exists`);
        ops.push({ op: 'renameSheet', sheet: this.sheetName, name });
        this.s.name = name;
        if (activeName === this.sheetName) activeName = name;
        this.sheetName = name;
        return this;
      }
      getRange(a: string | number, col?: number, nr = 1, nc = 1) {
        if (typeof a === 'string') return parseA1(this.sheetName, a);
        return new Range(this.sheetName, a - 1, (col ?? 1) - 1, nr, nc);
      }
      getLastRow() {
        let m = 0;
        for (const [k, v] of this.s.map) if (v.v !== undefined && v.v !== null && v.v !== '' ? true : !!v.f) m = Math.max(m, Number(k.split(':')[0]) + 1);
        return m;
      }
      getLastColumn() {
        let m = 0;
        for (const [k, v] of this.s.map) if (v.v !== undefined && v.v !== null && v.v !== '' ? true : !!v.f) m = Math.max(m, Number(k.split(':')[1]) + 1);
        return m;
      }
      getDataRange() {
        return new Range(this.sheetName, 0, 0, Math.max(1, this.getLastRow()), Math.max(1, this.getLastColumn()));
      }
      getMaxRows() {
        return this.s.maxRows;
      }
      getMaxColumns() {
        return this.s.maxCols;
      }
      appendRow(values: unknown[]) {
        const r = this.getLastRow();
        new Range(this.sheetName, r, 0, 1, values.length).setValues([values]);
        return this;
      }
      insertRows(row: number, n = 1) {
        shift(this.s, 'r', row - 1, n);
        ops.push({ op: 'insertRows', sheet: this.sheetName, at: row - 1, n });
        return this;
      }
      insertRowBefore(row: number) {
        return this.insertRows(row, 1);
      }
      insertRowAfter(row: number) {
        return this.insertRows(row + 1, 1);
      }
      insertRowsBefore(row: number, n: number) {
        return this.insertRows(row, n);
      }
      insertRowsAfter(row: number, n: number) {
        return this.insertRows(row + 1, n);
      }
      deleteRows(row: number, n = 1) {
        shift(this.s, 'r', row - 1, -n);
        ops.push({ op: 'deleteRows', sheet: this.sheetName, at: row - 1, n });
        return this;
      }
      deleteRow(row: number) {
        return this.deleteRows(row, 1);
      }
      insertColumns(col: number, n = 1) {
        shift(this.s, 'c', col - 1, n);
        ops.push({ op: 'insertCols', sheet: this.sheetName, at: col - 1, n });
        return this;
      }
      insertColumnBefore(col: number) {
        return this.insertColumns(col, 1);
      }
      insertColumnAfter(col: number) {
        return this.insertColumns(col + 1, 1);
      }
      insertColumnsBefore(col: number, n: number) {
        return this.insertColumns(col, n);
      }
      insertColumnsAfter(col: number, n: number) {
        return this.insertColumns(col + 1, n);
      }
      deleteColumns(col: number, n = 1) {
        shift(this.s, 'c', col - 1, -n);
        ops.push({ op: 'deleteCols', sheet: this.sheetName, at: col - 1, n });
        return this;
      }
      deleteColumn(col: number) {
        return this.deleteColumns(col, 1);
      }
      hideRows(row: number, n = 1) {
        ops.push({ op: 'hideRows', sheet: this.sheetName, at: row - 1, n });
        return this;
      }
      showRows(row: number, n = 1) {
        ops.push({ op: 'showRows', sheet: this.sheetName, at: row - 1, n });
        return this;
      }
      hideColumns(col: number, n = 1) {
        ops.push({ op: 'hideCols', sheet: this.sheetName, at: col - 1, n });
        return this;
      }
      showColumns(col: number, n = 1) {
        ops.push({ op: 'showCols', sheet: this.sheetName, at: col - 1, n });
        return this;
      }
      setColumnWidth(col: number, w: number) {
        ops.push({ op: 'colWidth', sheet: this.sheetName, c: col - 1, w });
        return this;
      }
      setRowHeight(row: number, h: number) {
        ops.push({ op: 'rowHeight', sheet: this.sheetName, r: row - 1, h });
        return this;
      }
      setFrozenRows(n: number) {
        this.s.frozenRows = n;
        ops.push({ op: 'freeze', sheet: this.sheetName, rows: n, cols: this.s.frozenCols });
        return this;
      }
      setFrozenColumns(n: number) {
        this.s.frozenCols = n;
        ops.push({ op: 'freeze', sheet: this.sheetName, rows: this.s.frozenRows, cols: n });
        return this;
      }
      getFrozenRows() {
        return this.s.frozenRows;
      }
      getFrozenColumns() {
        return this.s.frozenCols;
      }
      setTabColor(color: string | null) {
        ops.push({ op: 'tabColor', sheet: this.sheetName, color: color ?? '' });
        return this;
      }
      clear() {
        this.getDataRange().clear();
        return this;
      }
      clearContents() {
        this.getDataRange().clearContent();
        return this;
      }
      clearFormats() {
        this.getDataRange().clearFormat();
        return this;
      }
      activate() {
        activeName = this.sheetName;
        ops.push({ op: 'activate', sheet: this.sheetName });
        return this;
      }
      /** Sorts the data rows (below frozen rows) by a column. */
      sort(col: number, ascending = true) {
        const start = this.s.frozenRows;
        const last = this.getLastRow();
        if (last > start) new Range(this.sheetName, start, 0, last - start, Math.max(1, this.getLastColumn())).sort({ column: col, ascending });
        return this;
      }
    }

    // ── Spreadsheet / services ────────────────────────────────────────────
    const spreadsheet = {
      getName: () => snapshot.name,
      getSheets: () => sheets.map((s) => new Sheet(s.name)),
      getSheetByName: (name: string) => (findSheet(name) ? new Sheet(name) : null),
      getActiveSheet: () => new Sheet(activeName),
      setActiveSheet: (sh: Sheet) => sh.activate(),
      getActiveRange: () =>
        snapshot.selection ? new Range(snapshot.selection.sheet, snapshot.selection.r, snapshot.selection.c, snapshot.selection.nr, snapshot.selection.nc) : new Range(activeName, 0, 0, 1, 1),
      getRange: (a1: string) => parseA1(activeName, a1),
      insertSheet: (name?: string, index?: number) => {
        let n = name;
        for (let i = sheets.length + 1; !n || findSheet(n); i++) n = `Sheet${i}`;
        sheets.splice(index ?? sheets.length, 0, { name: n, maxRows: 1000, maxCols: 26, frozenRows: 0, frozenCols: 0, cells: {}, map: new Map() });
        ops.push({ op: 'insertSheet', name: n, index: index ?? null });
        activeName = n;
        return new Sheet(n);
      },
      deleteSheet: (sh: Sheet) => {
        if (sheets.length < 2) throw new Error('A spreadsheet must keep at least one sheet');
        const i = sheets.findIndex((s) => s.name === sh.getName());
        if (i < 0) return;
        sheets.splice(i, 1);
        ops.push({ op: 'deleteSheet', sheet: sh.getName() });
        if (activeName === sh.getName()) activeName = sheets[0].name;
      },
      toast: (msg: unknown, title?: string) => ops.push({ op: 'toast', text: title ? `${title}: ${fmt(msg)}` : fmt(msg) }),
    };
    const SpreadsheetApp = {
      getActiveSpreadsheet: () => spreadsheet,
      getActive: () => spreadsheet,
      getActiveSheet: () => spreadsheet.getActiveSheet(),
      getActiveRange: () => spreadsheet.getActiveRange(),
      setActiveSheet: (sh: Sheet) => sh.activate(),
      flush: () => undefined,
      getUi: () => ({ alert: (msg: unknown) => spreadsheet.toast(msg) }),
    };
    const Logger = { log: (...a: unknown[]) => log(...a) };
    const Browser = { msgBox: (msg: unknown) => spreadsheet.toast(msg) };
    const Utilities = {
      sleep: () => undefined,
      formatDate: (d: Date, _tz: string, pattern: string) => {
        const p = (n: number, l = 2) => String(n).padStart(l, '0');
        return pattern
          .replace(/yyyy/g, String(d.getFullYear()))
          .replace(/MM/g, p(d.getMonth() + 1))
          .replace(/dd/g, p(d.getDate()))
          .replace(/HH/g, p(d.getHours()))
          .replace(/mm/g, p(d.getMinutes()))
          .replace(/ss/g, p(d.getSeconds()));
      },
    };
    const consoleShim = { log, info: log, warn: log, error: log };

    // Trigger event object, shaped like Apps Script's (e.range, e.value, e.oldValue, e.source, e.user, e.triggerUid).
    const ev = event
      ? {
          triggerUid: event.trigger,
          authMode: 'LIMITED',
          source: spreadsheet,
          range: event.range ? new Range(event.range.sheet, event.range.r, event.range.c, event.range.nr, event.range.nc) : undefined,
          value: event.value === null ? undefined : event.value,
          oldValue: event.oldValue === null ? undefined : event.oldValue,
          user: { getEmail: () => event.user.email, getName: () => event.user.name, email: event.user.email },
          values: event.values,
          namedValues: event.namedValues,
        }
      : undefined;

    try {
      const name = fn && /^[A-Za-z_$][\w$]*$/.test(fn) ? fn : null;
      const body = `${code}\n;return ${name ? `(typeof ${name} === 'function') ? ${name}(__event) : undefined` : 'undefined'};`;
      const run = new Function('SpreadsheetApp', 'Logger', 'Browser', 'Utilities', 'console', '__event', body);
      await run(SpreadsheetApp, Logger, Browser, Utilities, consoleShim, ev);
      g.postMessage({ ok: true, ops, logs, error: null, ms: Date.now() - t0 } satisfies MacroResult);
    } catch (err) {
      const m = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      g.postMessage({ ok: false, ops, logs, error: m, ms: Date.now() - t0 } satisfies MacroResult);
    }
  };
}
