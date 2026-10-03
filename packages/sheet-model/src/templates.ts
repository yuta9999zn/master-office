// Spreadsheet templates (Google Sheets' template gallery): a formatted, formula-ready starting workbook.
// docs/ARCHITECTURE.md §44.
import { emptySheet, type Cell, type CellStyle, type PlainSheet, type PlainWorkbook } from './index';

export interface SheetTemplate {
  id: string;
  name: string;
  description: string;
  /** Accent used for the header row and the tab colour. */
  color: string;
  build: (title: string) => PlainWorkbook;
}

const OCT_1 = 46296; // 2026-10-01 as a serial date
const MONEY = { pattern: '#,##0' };
const DATE = { pattern: 'yyyy/mm/dd' };
const PCT = { pattern: '0%' };

type C = Cell | string | number | null;
const v = (x: string | number, s?: CellStyle): Cell => ({ v: x, t: typeof x === 'number' ? 2 : 1, ...(s ? { s } : {}) });
const f = (formula: string, s?: CellStyle): Cell => ({ f: formula, ...(s ? { s } : {}) });
const money = (x: number | null, extra: CellStyle = {}): Cell => (x === null ? { s: { n: MONEY, ...extra } } : v(x, { n: MONEY, ...extra }));
const date = (offset: number): Cell => v(OCT_1 + offset, { n: DATE });

function sheet(name: string, rows: C[][], o: { widths: number[]; color: string; header?: number; freeze?: boolean; merges?: PlainSheet['merges'] }): PlainSheet {
  const s = emptySheet(name);
  const head: CellStyle = { bl: 1, bg: { rgb: o.color }, cl: { rgb: '#FFFFFF' }, vt: 2 };
  rows.forEach((row, r) =>
    row.forEach((c, ci) => {
      if (c === null || c === '') return;
      const cell = typeof c === 'object' ? c : v(c);
      (s.cells[r] ??= {})[ci] = r === o.header ? { ...cell, s: { ...head, ...(cell.s ?? {}) } } : cell;
    }),
  );
  s.colMeta = Object.fromEntries(o.widths.map((w, i) => [i, { w }]));
  if (o.header !== undefined) s.rowMeta = { [o.header]: { h: 30 } };
  s.merges = o.merges ?? [];
  if (o.freeze && o.header !== undefined) s.meta.freeze = { row: o.header + 1, col: 0 };
  s.meta.tabColor = o.color;
  return s;
}
const title = (text: string): Cell => v(text, { bl: 1, fs: 16 });
const note = (text: string): Cell => v(text, { cl: { rgb: '#64748B' }, it: 1 });
const bold = (text: string): Cell => v(text, { bl: 1 });

export const SHEET_TEMPLATES: SheetTemplate[] = [
  {
    id: 'todo',
    name: 'To-do list',
    description: 'Tasks with owner, due date and status',
    color: '#2563EB',
    build: (name) => ({
      name,
      sheets: [
        sheet(
          'To-do',
          [
            [title(name)],
            [note('Status: Not started · In progress · Done')],
            [],
            ['Task', 'Owner', 'Due', 'Status', 'Notes'],
            ['Book the venue', 'Aya', date(6), 'In progress', ''],
            ['Send invitations', 'Ken', date(9), 'Not started', ''],
            ['Order supplies', 'Mika', date(13), 'Not started', 'Check stock first'],
            ['Confirm staff schedule', 'Claudia', date(2), 'Done', ''],
          ],
          { widths: [240, 110, 110, 120, 240], color: '#2563EB', header: 3, freeze: true },
        ),
      ],
    }),
  },
  {
    id: 'monthly-budget',
    name: 'Monthly budget',
    description: 'Planned vs actual income and expenses',
    color: '#059669',
    build: (name) => {
      const lines: [string, number, number][] = [
        ['Rent', 200000, 200000],
        ['Salaries', 1550000, 1580000],
        ['Marketing', 260000, 241000],
        ['Supplies', 120000, 133500],
        ['Utilities', 48000, 45200],
      ];
      const first = 6; // first expense row (1-based)
      const last = first + lines.length - 1;
      return {
        name,
        sheets: [
          sheet(
            'Budget',
            [
              [title(name)],
              [note('Enter planned and actual amounts; differences and totals update automatically.')],
              [],
              [bold('Income'), money(2400000, { bl: 1 })],
              ['Category', 'Planned (¥)', 'Actual (¥)', 'Difference (¥)'],
              ...lines.map(([c, pl, ac], i) => [c, money(pl), money(ac), f(`=B${first + i}-C${first + i}`, { n: MONEY })]),
              [bold('Total expenses'), f(`=SUM(B${first}:B${last})`, { bl: 1, n: MONEY }), f(`=SUM(C${first}:C${last})`, { bl: 1, n: MONEY }), f(`=SUM(D${first}:D${last})`, { bl: 1, n: MONEY })],
              [bold('Remaining'), f(`=B4-B${last + 1}`, { bl: 1, n: MONEY }), f(`=B4-C${last + 1}`, { bl: 1, n: MONEY })],
            ],
            { widths: [180, 130, 130, 140], color: '#059669', header: 4 },
          ),
        ],
      };
    },
  },
  {
    id: 'invoice',
    name: 'Invoice',
    description: 'Line items, tax and total due',
    color: '#7C3AED',
    build: (name) => {
      const items: [string, number, number][] = [
        ['Facial treatment', 2, 12000],
        ['Body care package', 1, 18000],
        ['Aftercare kit', 3, 3500],
      ];
      const first = 9;
      const last = first + items.length - 1;
      return {
        name,
        sheets: [
          sheet(
            'Invoice',
            [
              [v('INVOICE', { bl: 1, fs: 20, cl: { rgb: '#7C3AED' } }), null, null, v('No. 2026-001', { ht: 3 })],
              ['Natural Beauty Co., Ltd.', null, null, { ...date(2), s: { n: DATE, ht: 3 } }],
              ['1-2-3 Shibuya, Tokyo'],
              [],
              [bold('Bill to')],
              ['Customer name'],
              ['Address'],
              ['Description', 'Qty', 'Unit price (¥)', 'Amount (¥)'],
              ...items.map(([d, q, pr], i) => [d, q, money(pr), f(`=B${first + i}*C${first + i}`, { n: MONEY })]),
              [],
              [null, null, 'Subtotal', f(`=SUM(D${first}:D${last})`, { n: MONEY })],
              [null, null, 'Tax (10%)', f(`=ROUND(D${last + 2}*0.1,0)`, { n: MONEY })],
              [null, null, bold('Total due'), f(`=D${last + 2}+D${last + 3}`, { bl: 1, n: MONEY, bg: { rgb: '#EDE9FE' } })],
              [],
              [note('Payment due within 30 days. Thank you for your business.')],
            ],
            { widths: [240, 70, 130, 140], color: '#7C3AED', header: 7 },
          ),
        ],
      };
    },
  },
  {
    id: 'project-tracker',
    name: 'Project tracker',
    description: 'Tasks, dates, duration and progress',
    color: '#EA580C',
    build: (name) => {
      const tasks: [string, string, number, number, string, number][] = [
        ['Research', 'Aya', 0, 9, 'Done', 1],
        ['Design', 'Ken', 7, 20, 'In progress', 0.6],
        ['Build', 'Mika', 14, 41, 'Not started', 0],
        ['Pilot', 'Claudia', 42, 55, 'Not started', 0],
      ];
      return {
        name,
        sheets: [
          sheet(
            'Tracker',
            [
              [title(name)],
              [],
              ['Task', 'Owner', 'Start', 'End', 'Days', 'Status', 'Progress'],
              ...tasks.map(([t, o, s, e, st, pc], i) => [t, o, date(s), date(e), f(`=D${i + 4}-C${i + 4}+1`), st, v(pc, { n: PCT })]),
              [],
              [bold('Overall'), null, null, null, f(`=SUM(E4:E${tasks.length + 3})`, { bl: 1 }), null, f(`=SUMPRODUCT(E4:E${tasks.length + 3},G4:G${tasks.length + 3})/E${tasks.length + 5}`, { bl: 1, n: PCT })],
            ],
            { widths: [200, 110, 110, 110, 70, 120, 90], color: '#EA580C', header: 2, freeze: true },
          ),
        ],
      };
    },
  },
  {
    id: 'weekly-schedule',
    name: 'Weekly schedule',
    description: 'Hour-by-hour plan for the week',
    color: '#0891B2',
    build: (name) => {
      const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
      const hours = Array.from({ length: 11 }, (_, i) => `${String(8 + i).padStart(2, '0')}:00`);
      const plan: Record<string, Record<number, string>> = { '09:00': { 0: 'Team meeting' }, '10:00': { 2: 'Training' }, '14:00': { 4: 'Inventory check' }, '11:00': { 5: 'Open day' } };
      return {
        name,
        sheets: [
          sheet(
            'Schedule',
            [
              [title(name)],
              [],
              ['Time', ...days],
              ...hours.map((h) => [v(h, { cl: { rgb: '#64748B' } }), ...days.map((_, d) => (plan[h]?.[d] ? v(plan[h][d], { bg: { rgb: '#CFFAFE' } }) : null))]),
            ],
            { widths: [70, 120, 120, 120, 120, 120, 120, 120], color: '#0891B2', header: 2, freeze: true },
          ),
        ],
      };
    },
  },
  {
    id: 'expense-report',
    name: 'Expense report',
    description: 'Receipts by date and category, with a total',
    color: '#DB2777',
    build: (name) => {
      const rows: [number, string, string, number][] = [
        [0, 'Train to Osaka branch', 'Travel', 14450],
        [0, 'Lunch with supplier', 'Meals', 6200],
        [1, 'Hotel, 1 night', 'Lodging', 12800],
        [2, 'Sample products', 'Supplies', 8900],
      ];
      const last = rows.length + 4;
      return {
        name,
        sheets: [
          sheet(
            'Expenses',
            [
              [title(name)],
              [bold('Employee'), 'Your name'],
              [],
              ['Date', 'Description', 'Category', 'Amount (¥)'],
              ...rows.map(([d, desc, cat, amt]) => [date(d), desc, cat, money(amt)]),
              [null, null, bold('Total'), f(`=SUM(D5:D${last})`, { bl: 1, n: MONEY })],
            ],
            { widths: [110, 240, 120, 130], color: '#DB2777', header: 3, freeze: true },
          ),
        ],
      };
    },
  },
];

/** The template's workbook, or null for a blank spreadsheet / an unknown id. */
export function templateWorkbook(id: string | null | undefined, name: string): PlainWorkbook | null {
  const tpl = SHEET_TEMPLATES.find((x) => x.id === id);
  return tpl ? tpl.build(name) : null;
}
