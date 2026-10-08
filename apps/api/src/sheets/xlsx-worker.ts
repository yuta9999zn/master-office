// An .xlsx import in a child process (docs/ARCHITECTURE.md §83). ExcelJS needs ~1.7 GB and 20 s of CPU for a
// 14 MB workbook; in the API process that would stall every other request and keep the memory afterwards. The
// worker reads the file, builds the Yjs state (with the shared style table) and writes it to a temp file; pictures
// go beside it. The parent only loads the finished state. Forked by SheetsService (dist/…/xlsx-worker.js).
import { writeFileSync } from 'node:fs';
import * as Y from 'yjs';
import { writeWorkbook } from '@workos/sheet-model';
import { importXlsx, type XlsxReport } from './xlsx';
import type { ImportedImage } from './xlsx-images';

export interface WorkerRequest {
  file: string;
  name: string;
  /** Where the Yjs state goes; pictures are written as `${out}.<n>.<ext>`. */
  out: string;
}
export type WorkerImage = Omit<ImportedImage, 'data'> & { path: string };
export interface WorkerResult {
  ok: true;
  report: XlsxReport;
  images: WorkerImage[];
  stats: { cells: number; stateBytes: number; importMs: number; totalMs: number };
}

export async function importToState(req: WorkerRequest): Promise<WorkerResult> {
  const { readFileSync } = await import('node:fs');
  const t0 = Date.now();
  const { wb, report, images } = await importXlsx(readFileSync(req.file), req.name);
  const t1 = Date.now();
  const doc = new Y.Doc();
  writeWorkbook(doc, wb);
  const state = Y.encodeStateAsUpdate(doc);
  writeFileSync(req.out, state);
  const out: WorkerImage[] = images.map((img, i) => {
    const path = `${req.out}.${i}.${img.ext}`;
    writeFileSync(path, img.data);
    const { data: _d, ...rest } = img;
    return { ...rest, path };
  });
  let cells = 0;
  for (const s of wb.sheets) for (const row of Object.values(s.cells)) cells += Object.keys(row).length;
  return { ok: true, report, images: out, stats: { cells, stateBytes: state.length, importMs: t1 - t0, totalMs: Date.now() - t0 } };
}

if (require.main === module) {
  process.on('message', (req: WorkerRequest) => {
    importToState(req)
      .then((r) => process.send!(r))
      .catch((e: Error) => process.send!({ ok: false, error: String(e?.message ?? e) }))
      .finally(() => setTimeout(() => process.exit(0), 50));
  });
}
