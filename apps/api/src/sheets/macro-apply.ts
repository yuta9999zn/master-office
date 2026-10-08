import { cellKey, createYSheet, emptySheet, newId, resolveCell, SHEETS_MAP, toStoredCell, WB_MAP, ySheet, yStyles, type Cell, type CellStyle, type YSheet } from '@workos/sheet-model';
import * as Y from 'yjs';

// Server side of macro execution (docs/ARCHITECTURE.md §48): the operations a macro produced in the sandbox are
// written straight into the workbook's Y.Doc — the same structures the editor's binding writes — so everyone with
// the file open sees them like any remote edit. The browser applies the same operations through Univer (run.ts).

/* eslint-disable @typescript-eslint/no-explicit-any */
type Op = { op: string; sheet?: string; [k: string]: any };
type MacroCell = { v?: string | number | boolean | null; f?: string; s?: Record<string, unknown> } | null;

export interface ApplyReport {
  applied: number;
  skipped: string[];
  toasts: string[];
}

const H_ALIGN: Record<string, CellStyle['ht']> = { left: 1, center: 2, right: 3 };
const V_ALIGN: Record<string, CellStyle['vt']> = { top: 1, middle: 2, bottom: 3 };

function styleFor(kind: string, v: unknown): Partial<CellStyle> | null {
  switch (kind) {
    case 'background':
      return { bg: v ? { rgb: String(v) } : undefined };
    case 'fontColor':
      return { cl: v ? { rgb: String(v) } : undefined };
    case 'fontWeight':
      return { bl: v === 'bold' ? 1 : 0 };
    case 'fontStyle':
      return { it: v === 'italic' ? 1 : 0 };
    case 'fontLine':
      return { ul: { s: v === 'underline' ? 1 : 0 }, st: { s: v === 'line-through' ? 1 : 0 } };
    case 'fontSize':
      return { fs: Number(v) };
    case 'fontFamily':
      return { ff: String(v) };
    case 'hAlign':
      return { ht: H_ALIGN[String(v)] ?? 1 };
    case 'vAlign':
      return { vt: V_ALIGN[String(v)] ?? 3 };
    case 'wrap':
      return { tb: v ? 3 : 1 };
    case 'numberFormat':
      return { n: { pattern: String(v) } };
    default:
      return null;
  }
}

/** Applies macro operations to a workbook Y.Doc (call inside a transaction). `active` is the sheet a macro sees as active. */
export function applyMacroOps(doc: Y.Doc, ops: Op[], active: string): ApplyReport {
  const report: ApplyReport = { applied: 0, skipped: [], toasts: [] };
  const wbMeta = doc.getMap(WB_MAP);
  const sheets = doc.getMap(SHEETS_MAP);
  const styles = yStyles(doc);
  const order = () => ((wbMeta.get('sheetOrder') as string[] | undefined) ?? []).filter((id) => sheets.has(id));
  const byName = (name?: string): { id: string; ys: YSheet } => {
    const want = name ?? active;
    const id = order().find((sid) => ySheet(sheets.get(sid) as Y.Map<unknown>).meta().name === want);
    if (!id) throw new Error(`Sheet "${want}" not found while applying the macro`);
    return { id, ys: ySheet(sheets.get(id) as Y.Map<unknown>) };
  };
  /** Row / column ids up to an index, growing the sheet when a macro writes past its end. */
  const ids = (arr: Y.Array<string>, upTo: number) => {
    if (arr.length <= upTo) arr.push(Array.from({ length: upTo + 1 - arr.length }, newId));
    return arr.toArray();
  };
  const eachCell = (ys: YSheet, o: Op, fn: (key: string, cell: Cell | undefined) => Cell | null | undefined) => {
    const rows = ids(ys.rows, o.r + (o.nr ?? 1) - 1);
    const cols = ids(ys.cols, o.c + (o.nc ?? 1) - 1);
    for (let i = 0; i < (o.nr ?? 1); i++)
      for (let j = 0; j < (o.nc ?? 1); j++) {
        const key = cellKey(rows[o.r + i], cols[o.c + j]);
        const next = fn(key, resolveCell(styles, ys.cells.get(key)) ?? undefined);
        if (next === undefined) continue;
        if (next === null || (next.v === undefined && !next.f && !next.s)) ys.cells.delete(key);
        else ys.cells.set(key, toStoredCell(styles, next));
      }
  };
  const setMeta = (ys: YSheet, patch: Record<string, unknown>) => ys.map.set('meta', { ...ys.meta(), ...patch });

  for (const o of ops) {
    const { ys } = ['toast', 'insertSheet'].includes(o.op) ? { ys: null as unknown as YSheet } : byName(o.sheet);
    switch (o.op) {
      case 'cells': {
        const rows = o.rows as MacroCell[][];
        const nc = Math.max(1, ...rows.map((r) => r.length));
        const rowIds = ids(ys.rows, o.r + rows.length - 1);
        const colIds = ids(ys.cols, o.c + nc - 1);
        rows.forEach((row, i) =>
          row.forEach((mc, j) => {
            const key = cellKey(rowIds[o.r + i], colIds[o.c + j]);
            const prev = resolveCell(styles, ys.cells.get(key));
            const style = (mc?.s as CellStyle | undefined) ?? prev?.s ?? undefined;
            let next: Cell | null;
            if (!mc || (mc.v === undefined && !mc.f)) next = style ? { s: style } : null;
            else if (mc.f) next = { f: mc.f, ...(style ? { s: style } : {}) };
            else next = { v: mc.v ?? null, t: typeof mc.v === 'number' ? 2 : typeof mc.v === 'boolean' ? 3 : 1, ...(style ? { s: style } : {}) };
            if (next && typeof next.v === 'boolean') next.v = next.v ? 1 : 0;
            // A formula's cached result is stale now: editors recompute it when they open the file.
            ys.values?.delete(key);
            if (next) ys.cells.set(key, toStoredCell(styles, next));
            else ys.cells.delete(key);
          }),
        );
        break;
      }
      case 'style': {
        const patch = styleFor(o.kind, o.value);
        if (!patch) {
          report.skipped.push(`style ${o.kind}`);
          continue;
        }
        eachCell(ys, o, (_k, c) => ({ ...(c ?? {}), s: { ...(c?.s ?? {}), ...patch } as CellStyle }));
        break;
      }
      case 'clear':
        eachCell(ys, o, (key, c) => {
          if (!c) return undefined;
          if (o.what === 'format') return { ...c, s: undefined };
          ys.values?.delete(key);
          return o.what === 'content' && c.s ? { s: c.s } : null;
        });
        break;
      case 'insertRows':
        ys.rows.insert(o.at, Array.from({ length: o.n }, newId));
        break;
      case 'deleteRows':
        ys.rows.delete(o.at, Math.min(o.n, ys.rows.length - o.at));
        break;
      case 'insertCols':
        ys.cols.insert(o.at, Array.from({ length: o.n }, newId));
        break;
      case 'deleteCols':
        ys.cols.delete(o.at, Math.min(o.n, ys.cols.length - o.at));
        break;
      case 'hideRows':
      case 'showRows': {
        const rows = ids(ys.rows, o.at + o.n - 1);
        for (let i = o.at; i < o.at + o.n; i++) ys.rowMeta.set(rows[i], { ...(ys.rowMeta.get(rows[i]) ?? {}), hd: o.op === 'hideRows' ? 1 : 0 });
        break;
      }
      case 'hideCols':
      case 'showCols': {
        const cols = ids(ys.cols, o.at + o.n - 1);
        for (let i = o.at; i < o.at + o.n; i++) ys.colMeta.set(cols[i], { ...(ys.colMeta.get(cols[i]) ?? {}), hd: o.op === 'hideCols' ? 1 : 0 });
        break;
      }
      case 'colWidth': {
        const cols = ids(ys.cols, o.c);
        ys.colMeta.set(cols[o.c], { ...(ys.colMeta.get(cols[o.c]) ?? {}), w: o.w });
        break;
      }
      case 'rowHeight': {
        const rows = ids(ys.rows, o.r);
        ys.rowMeta.set(rows[o.r], { ...(ys.rowMeta.get(rows[o.r]) ?? {}), h: o.h });
        break;
      }
      case 'merge': {
        const rows = ids(ys.rows, o.r + (o.nr ?? 1) - 1);
        const cols = ids(ys.cols, o.c + (o.nc ?? 1) - 1);
        ys.merges.set(newId(), { r0: rows[o.r], r1: rows[o.r + (o.nr ?? 1) - 1], c0: cols[o.c], c1: cols[o.c + (o.nc ?? 1) - 1] });
        break;
      }
      case 'unmerge': {
        const rows = ys.rows.toArray();
        const cols = ys.cols.toArray();
        const ri = new Map(rows.map((r, i) => [r, i]));
        const ci = new Map(cols.map((c, i) => [c, i]));
        ys.merges.forEach((g, id) => {
          const r0 = ri.get(g.r0) ?? -1;
          const c0 = ci.get(g.c0) ?? -1;
          if (r0 >= o.r && r0 < o.r + (o.nr ?? 1) && c0 >= o.c && c0 < o.c + (o.nc ?? 1)) ys.merges.delete(id);
        });
        break;
      }
      case 'freeze':
        setMeta(ys, { freeze: o.rows || o.cols ? { row: o.rows ?? 0, col: o.cols ?? 0 } : null });
        break;
      case 'tabColor':
        setMeta(ys, { tabColor: o.color ?? null });
        break;
      case 'renameSheet':
        setMeta(ys, { name: String(o.name) });
        break;
      case 'insertSheet': {
        const s = emptySheet(String(o.name));
        sheets.set(s.id, createYSheet(s));
        const next = order();
        next.splice(o.index ?? next.length, 0, s.id);
        wbMeta.set('sheetOrder', next.filter((id, i, a) => a.indexOf(id) === i));
        break;
      }
      case 'deleteSheet': {
        const { id } = byName(o.sheet);
        if (order().length < 2) throw new Error('A spreadsheet must keep at least one sheet');
        wbMeta.set('sheetOrder', order().filter((x) => x !== id));
        sheets.delete(id);
        break;
      }
      case 'toast':
        report.toasts.push(String(o.text));
        break;
      case 'activate':
      case 'select':
        // Nobody is looking at the sheet when a scheduled trigger runs.
        continue;
      default:
        report.skipped.push(o.op);
        continue;
    }
    report.applied++;
  }
  return report;
}
