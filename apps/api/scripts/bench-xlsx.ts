// Measures an .xlsx import without the server: ExcelJS time, Yjs write / encode time, state size (the shared style
// table, §83) and memory.   npx tsx apps/api/scripts/bench-xlsx.ts <file.xlsx>
import { readFileSync } from 'node:fs';
import * as Y from 'yjs';
import { writeWorkbook } from '@workos/sheet-model';
import { importXlsx } from '../src/sheets/xlsx';
(async () => {
  const buf = readFileSync(process.argv[2]);
  const mb = () => Math.round(process.memoryUsage().rss / 1048576);
  const t0 = Date.now();
  const { wb } = await importXlsx(buf, 'nb.xlsx');
  const t1 = Date.now();
  const doc = new Y.Doc();
  writeWorkbook(doc, wb);
  const t2 = Date.now();
  const state = Y.encodeStateAsUpdate(doc);
  const t3 = Date.now();
  let cells = 0, styled = 0;
  for (const s of wb.sheets) for (const row of Object.values(s.cells)) for (const c of Object.values(row)) (cells++, c.s && styled++);
  console.log(JSON.stringify({ importMs: t1 - t0, writeMs: t2 - t1, encodeMs: t3 - t2, stateMB: +(state.length / 1048576).toFixed(1), cells, styled, rssMB: mb() }));
  const d2 = new Y.Doc();
  const t4 = Date.now();
  Y.applyUpdate(d2, state);
  console.log('applyUpdate ms', Date.now() - t4);
  process.exit(0);
})();
