import { emptySheet, writeWorkbook, workbookText, type Cell, type CellStyle, type PlainSheet, type PlainWorkbook } from '@workos/sheet-model';
import * as Y from 'yjs';

// Seed spreadsheets, stored exactly as the editor would (formulas with cached results left empty:
// the grid computes them on open, and XLSX export asks Excel to recalculate on load).

const SEP_1 = 46266; // 2026-09-01 as an Excel serial date
const HEADER: CellStyle = { bl: 1, bg: { rgb: '#E8F0FE' }, cl: { rgb: '#1F2937' }, vt: 2 };
const MONEY: CellStyle = { n: { pattern: '#,##0' } };
const DATE: CellStyle = { n: { pattern: 'yyyy/mm/dd' } };
const PCT: CellStyle = { n: { pattern: '0.0%' } };
const TITLE: CellStyle = { bl: 1, fs: 14 };

const v = (x: string | number | boolean, s?: CellStyle): Cell => ({ v: x, t: typeof x === 'number' ? 2 : typeof x === 'boolean' ? 3 : 1, ...(s ? { s } : {}) });
const f = (formula: string, s?: CellStyle): Cell => ({ f: formula, ...(s ? { s } : {}) });

function sheet(name: string, rows: (Cell | string | number | null)[][], opts: Partial<Pick<PlainSheet, 'colMeta' | 'rowMeta' | 'merges'>> & { freeze?: { row: number; col: number }; tabColor?: string } = {}): PlainSheet {
  const s = emptySheet(name);
  rows.forEach((row, r) =>
    row.forEach((c, ci) => {
      if (c === null || c === '') return;
      (s.cells[r] ??= {})[ci] = typeof c === 'object' ? c : v(c);
    }),
  );
  s.colMeta = opts.colMeta ?? {};
  s.rowMeta = opts.rowMeta ?? {};
  s.merges = opts.merges ?? [];
  if (opts.freeze) s.meta.freeze = opts.freeze;
  if (opts.tabColor) s.meta.tabColor = opts.tabColor;
  return s;
}

const header = (...labels: string[]) => labels.map((l) => v(l, HEADER));

// Sales Data rows from the reference screen: day offset, branch, service, customer, staff, amount, status, notes.
const SALES: [number, string, string, string, string, number, string, string][] = [
  [0, '575', 'Wax (VIO)', 'A. Tanaka', 'Hana', 12000, 'Completed', 'Repeat customer'],
  [0, '625', 'Facial', 'M. Sato', 'Yuki', 8000, 'Confirmed', '—'],
  [0, 'S2', 'Underarm', 'Y. Suzuki', 'Mika', 6000, 'Completed', 'First visit'],
  [1, '575', 'Body Care', 'H. Yamada', 'Sora', 15000, 'Canceled', '—'],
  [1, '625', 'Legs', 'K. Ito', 'Rina', 9000, 'Confirmed', '—'],
  [2, 'S2', 'Arms', 'R. Nakamura', 'Emi', 8000, 'Completed', '—'],
  [2, '575', 'Underarm', 'S. Kato', 'Ayaka', 10000, 'Completed', 'Recommend next appointment'],
  [3, '575', 'Wax (VIO)', 'N. Hashimoto', 'Mika', 12000, 'Completed', 'VIP'],
  [3, '625', 'Body Care', 'M. Watanabe', 'Rina', 7000, 'Completed', '—'],
  [4, 'S2', 'Legs', 'A. Kobayashi', 'Rina', 15000, 'Canceled', '—'],
  [4, '575', 'Legs', 'Y. Matsuda', 'Mika', 9000, 'Completed', '—'],
  [5, '625', 'Arms', 'T. Kimura', 'Mina', 6000, 'Completed', '—'],
  [5, 'S2', 'Wax (VIO)', 'S. Igarashi', 'Hana', 12000, 'Completed', '—'],
  [6, '575', 'Facial', 'M. Tanaka', 'Yuki', 8000, 'Completed', '—'],
  [6, '625', 'Underarm', 'R. Arai', 'Mika', 14000, 'Completed', '—'],
  [7, 'S2', 'Facial', 'Y. Okada', 'Rina', 10000, 'Completed', '—'],
  [7, '625', 'Body Care', 'H. Mori', 'Ayaka', 8000, 'Confirmed', 'First visit'],
  [8, '575', 'Legs', 'K. Hayashi', 'Mina', 9000, 'Confirmed', '—'],
  [8, '625', 'Arms', 'N. Saito', 'Rina', 12000, 'Completed', 'First visit'],
  [9, 'S2', 'Underarm', 'A. Fujita', 'Yuki', 6000, 'Completed', '—'],
];
const N = SALES.length;
const LAST = N + 1; // last data row (1-based, header in row 1)
const col = (c: string) => `'Sales Data'!$${c}$2:$${c}$${LAST}`;

const BRANCH_COLORS: Record<string, string> = { '575': '#FCE7F3', '625': '#DBEAFE', S2: '#DCFCE7' };
const STATUS_STYLE: Record<string, CellStyle> = {
  Completed: { cl: { rgb: '#15803D' }, bg: { rgb: '#DCFCE7' } },
  Confirmed: { cl: { rgb: '#1D4ED8' }, bg: { rgb: '#DBEAFE' } },
  Canceled: { cl: { rgb: '#B91C1C' }, bg: { rgb: '#FEE2E2' } },
};

function salesReport(): PlainWorkbook {
  const data = sheet(
    'Sales Data',
    [
      header('Date', 'Branch', 'Service', 'Customer', 'Staff', 'Amount (¥)', 'Status', 'Notes'),
      ...SALES.map(([d, b, svc, cust, staff, amt, st, note]) => [
        v(SEP_1 + d, DATE),
        v(b, { ht: 2, bg: { rgb: BRANCH_COLORS[b] } }),
        svc,
        cust,
        staff,
        v(amt, MONEY),
        v(st, STATUS_STYLE[st]),
        note,
      ]),
    ],
    { colMeta: { 0: { w: 120 }, 1: { w: 90 }, 2: { w: 140 }, 3: { w: 140 }, 4: { w: 100 }, 5: { w: 120 }, 6: { w: 120 }, 7: { w: 220 } }, rowMeta: { 0: { h: 30 } }, freeze: { row: 1, col: 0 } },
  );

  const summary = sheet(
    'Monthly Summary',
    [
      [v('September 2026 — Summary', TITLE)],
      [],
      header('Metric', 'Value'),
      ['Total bookings', f(`=COUNTA(${col('A')})`)],
      ['Completed', f(`=COUNTIF(${col('G')},"Completed")`)],
      ['Confirmed', f(`=COUNTIF(${col('G')},"Confirmed")`)],
      ['Canceled', f(`=COUNTIF(${col('G')},"Canceled")`)],
      ['Revenue (completed)', f(`=SUMIF(${col('G')},"Completed",${col('F')})`, MONEY)],
      ['Pipeline (confirmed)', f(`=SUMIFS(${col('F')},${col('G')},"Confirmed")`, MONEY)],
      ['Average ticket', f(`=AVERAGEIF(${col('G')},"<>Canceled",${col('F')})`, MONEY)],
      ['Largest booking', f(`=MAX(${col('F')})`, MONEY)],
      ['Completion rate', f('=B5/B4', PCT)],
      ['Cancellation rate', f('=IFERROR(B7/B4,0)', PCT)],
      ['Target (¥)', v(200000, MONEY)],
      ['vs target', f('=B8/B14', PCT)],
      ['On track?', f('=IF(B15>=1,"Yes","Behind by "&TEXT(B14-B8,"#,##0"))')],
    ],
    { colMeta: { 0: { w: 200 }, 1: { w: 160 } }, merges: [{ r0: 0, c0: 0, r1: 0, c1: 1 }], tabColor: '#3B82F6' },
  );

  const branches = ['575', '625', 'S2'];
  const byBranch = sheet(
    'By Branch',
    [
      header('Branch', 'Bookings', 'Completed', 'Revenue (¥)', 'Share'),
      ...branches.map((b, i) => [
        v(b, { ht: 2 }),
        f(`=COUNTIF(${col('B')},A${i + 2})`),
        f(`=COUNTIFS(${col('B')},A${i + 2},${col('G')},"Completed")`),
        f(`=SUMIFS(${col('F')},${col('B')},A${i + 2},${col('G')},"Completed")`, MONEY),
        f(`=IFERROR(D${i + 2}/$D$5,0)`, PCT),
      ]),
      [v('Total', { bl: 1 }), f('=SUM(B2:B4)', { bl: 1 }), f('=SUM(C2:C4)', { bl: 1 }), f('=SUM(D2:D4)', { bl: 1, n: MONEY.n }), f('=SUM(E2:E4)', { bl: 1, n: PCT.n })],
    ],
    { colMeta: { 0: { w: 100 }, 1: { w: 100 }, 2: { w: 100 }, 3: { w: 130 }, 4: { w: 90 } } },
  );

  const services = ['Wax (VIO)', 'Facial', 'Underarm', 'Body Care', 'Legs', 'Arms'];
  const byService = sheet(
    'By Service',
    [
      header('Service', 'Bookings', 'Revenue (¥)', 'Avg ticket (¥)', 'Rank'),
      ...services.map((svc, i) => {
        const r = i + 2;
        return [
          svc,
          f(`=COUNTIF(${col('C')},A${r})`),
          f(`=SUMIFS(${col('F')},${col('C')},A${r},${col('G')},"<>Canceled")`, MONEY),
          f(`=IFERROR(ROUND(C${r}/COUNTIFS(${col('C')},A${r},${col('G')},"<>Canceled"),0),0)`, MONEY),
          f(`=RANK(C${r},$C$2:$C$${services.length + 1})`),
        ];
      }),
      [],
      ['Top service', f(`=INDEX(A2:A${services.length + 1},MATCH(MAX(C2:C${services.length + 1}),C2:C${services.length + 1},0))`)],
    ],
    { colMeta: { 0: { w: 140 }, 1: { w: 90 }, 2: { w: 120 }, 3: { w: 120 }, 4: { w: 70 } } },
  );

  const staff = ['Hana', 'Yuki', 'Mika', 'Sora', 'Rina', 'Emi', 'Ayaka', 'Mina'];
  const staffPerf = sheet(
    'Staff Performance',
    [
      header('Staff', 'Bookings', 'Completed', 'Revenue (¥)', 'Status'),
      ...staff.map((name, i) => {
        const r = i + 2;
        return [
          name,
          f(`=COUNTIF(${col('E')},A${r})`),
          f(`=COUNTIFS(${col('E')},A${r},${col('G')},"Completed")`),
          f(`=SUMIFS(${col('F')},${col('E')},A${r},${col('G')},"Completed")`, MONEY),
          f(`=IF(D${r}>=20000,"Top performer",IF(D${r}>0,"Active","—"))`),
        ];
      }),
    ],
    { colMeta: { 0: { w: 110 }, 1: { w: 90 }, 2: { w: 90 }, 3: { w: 120 }, 4: { w: 130 } } },
  );

  const charts = sheet('Charts', [[v('Charts', TITLE)], ['Revenue by branch and by service — insert charts from the Insert menu.']], { colMeta: { 0: { w: 480 } } });

  return { name: 'Sales Report - September 2026', sheets: [data, summary, byBranch, byService, staffPerf, charts] };
}

function simple(name: string, head: string[], rows: (string | number)[][], widths: number[] = []): PlainWorkbook {
  return {
    name,
    sheets: [
      sheet('Sheet1', [header(...head), ...rows], {
        colMeta: Object.fromEntries(widths.map((w, i) => [i, { w }])),
        freeze: { row: 1, col: 0 },
      }),
    ],
  };
}

export const SEED_SHEETS: Record<string, () => PlainWorkbook> = {
  'Sales Report - September 2026': salesReport,
  'Budget 2027': () => {
    const lines: [string, number][] = [
      ['Rent', 2400000],
      ['Salaries', 18600000],
      ['Marketing', 3200000],
      ['Supplies', 1500000],
      ['Training', 600000],
    ];
    const wb = simple('Budget 2027', ['Category', 'Q1', 'Q2', 'Q3', 'Q4', 'Total'], [], [140, 110, 110, 110, 110, 130]);
    const s = wb.sheets[0];
    lines.forEach(([cat, total], i) => {
      const r = i + 1;
      s.cells[r] = { 0: v(cat) };
      for (let q = 1; q <= 4; q++) s.cells[r][q] = v(Math.round(total / 4), MONEY);
      s.cells[r][5] = f(`=SUM(B${r + 1}:E${r + 1})`, MONEY);
    });
    const t = lines.length + 1;
    s.cells[t] = { 0: v('Total', { bl: 1 }) };
    for (let q = 1; q <= 5; q++) {
      const L = String.fromCharCode(65 + q);
      s.cells[t][q] = f(`=SUM(${L}2:${L}${t})`, { bl: 1, n: MONEY.n });
    }
    return wb;
  },
  'Branch KPI': () =>
    simple(
      'Branch KPI',
      ['Branch', 'Revenue (¥)', 'Target (¥)', 'Achievement', 'Return rate'],
      [],
      [110, 130, 130, 110, 110],
    ),
};

/** Fills Branch KPI rows with formulas (kept separate so the builder above stays readable). */
const kpi = SEED_SHEETS['Branch KPI'];
SEED_SHEETS['Branch KPI'] = () => {
  const wb = kpi();
  const s = wb.sheets[0];
  [
    ['Branch 575', 1240000, 1200000, 0.74],
    ['Branch 625', 980000, 1100000, 0.69],
    ['Branch S2', 860000, 900000, 0.71],
  ].forEach(([b, rev, tgt, ret], i) => {
    const r = i + 1;
    s.cells[r] = { 0: v(b), 1: v(rev, MONEY), 2: v(tgt, MONEY), 3: f(`=B${r + 1}/C${r + 1}`, PCT), 4: v(ret, PCT) };
  });
  return wb;
};

export function seedSheetState(wb: PlainWorkbook) {
  const doc = new Y.Doc();
  writeWorkbook(doc, wb);
  return { state: Buffer.from(Y.encodeStateAsUpdate(doc)), text: workbookText(wb) };
}

export const blankWorkbook = (name: string): PlainWorkbook => ({ name, sheets: [emptySheet()] });
