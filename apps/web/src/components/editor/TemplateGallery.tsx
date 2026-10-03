'use client';

import { DOC_TEMPLATES, toHTML } from '@workos/doc-model';
import { formatValue, SHEET_TEMPLATES, type PlainSheet } from '@workos/sheet-model';
import { Loader2, Plus } from 'lucide-react';
import { useMemo, type ReactNode } from 'react';

type Pick = (template: string | null, name: string) => void;
interface Item {
  id: string;
  name: string;
  description: string;
  preview: ReactNode;
}

const W = 168;

/** "Start a new …" row (Google Docs / Sheets): blank plus the template gallery. Slides has its own (SlideTemplates). */
function TemplateRow({ heading, blank, items, height, onPick, busy }: { heading: string; blank: string; items: Item[]; height: number; onPick: Pick; busy: string | null }) {
  const spinner = (
    <div className="absolute inset-0 flex items-center justify-center bg-white/60">
      <Loader2 size={22} className="animate-spin text-muted" />
    </div>
  );
  return (
    <div className="mt-6" data-testid="templates">
      <h2 className="mb-2 text-[13px] font-semibold text-ink-2">{heading}</h2>
      <div className="flex gap-3 overflow-x-auto pb-2">
        <button onClick={() => onPick(null, blank.replace('Blank', 'Untitled'))} disabled={!!busy} className="group shrink-0 text-left" data-testid="template-blank">
          <div className="relative flex items-center justify-center rounded-lg border border-line bg-surface transition group-hover:border-brand-400 group-hover:shadow-md" style={{ width: W, height }}>
            {busy === 'blank' ? <Loader2 size={22} className="animate-spin text-muted" /> : <Plus size={28} className="text-brand-600" />}
          </div>
          <div className="mt-1.5 text-[13px] font-medium text-ink">{blank}</div>
        </button>
        {items.map((t) => (
          <button key={t.id} onClick={() => onPick(t.id, t.name)} disabled={!!busy} className="group shrink-0 text-left" data-testid={`template-${t.id}`} title={t.description}>
            <div className="relative overflow-hidden rounded-lg border border-line bg-white transition group-hover:border-brand-400 group-hover:shadow-md" style={{ width: W, height }} aria-hidden>
              {t.preview}
              {busy === t.id && spinner}
            </div>
            <div className="mt-1.5 text-[13px] font-medium text-ink">{t.name}</div>
            <div className="truncate text-[12px] text-muted" style={{ width: W }}>
              {t.description}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

/** First page of a document, scaled down: the same HTML the exporter writes. */
function DocThumb({ html }: { html: string }) {
  const scale = W / 640;
  return (
    <div className="mo-tpl-page pointer-events-none absolute left-0 top-0 origin-top-left" style={{ width: 640, transform: `scale(${scale})` }} dangerouslySetInnerHTML={{ __html: html }} />
  );
}

export function DocTemplates({ onPick, busy }: { onPick: Pick; busy: string | null }) {
  const items = useMemo(() => DOC_TEMPLATES.map((t) => ({ ...t, preview: <DocThumb html={toHTML(t.build(t.name))} /> })), []);
  return <TemplateRow heading="Start a new document" blank="Blank document" items={items} height={Math.round(W * 1.294)} onPick={onPick} busy={busy} />;
}

/** Top-left corner of the first sheet as a tiny grid: fills, bold, colours and number formats. Formulas show once opened. */
function SheetThumb({ sheet, color }: { sheet: PlainSheet; color: string }) {
  // Whole columns only (up to 5, at least 420px of sheet), drawn at full size and scaled to the card's width.
  const widths: number[] = [];
  for (let c = 0; c < 5 && widths.reduce((a, b) => a + b, 0) < 420; c++) widths.push(sheet.colMeta[c]?.w ?? 88);
  const cols = widths.map((_, c) => c);
  const rows = Array.from({ length: 14 }, (_, r) => r);
  const total = widths.reduce((a, b) => a + b, 0);
  return (
    <div className="pointer-events-none absolute inset-0">
      <div className="h-1.5" style={{ background: color }} />
      <table className="origin-top-left table-fixed border-collapse text-[13px] leading-[19px]" style={{ width: total, transform: `scale(${W / total})` }}>
        <colgroup>
          {widths.map((w, i) => (
            <col key={i} style={{ width: w }} />
          ))}
        </colgroup>
        <tbody>
          {rows.map((r) => (
            <tr key={r} style={{ height: 21 }}>
              {cols.map((c) => {
                const row = sheet.cells[r] ?? {};
                // Covered by text spilling over from the left (as in the grid: left-aligned text runs into empty cells).
                for (let l = c - 1; l >= 0 && !row[l + 1]; l--) if (row[l] && typeof row[l].v === 'string' && !row[l].s?.bg) return null;
                const cell = row[c];
                const s = cell?.s ?? {};
                const text = cell && !cell.f ? formatValue(cell.v, s.n?.pattern) : '';
                let span = 1;
                if (typeof cell?.v === 'string' && !s.bg) while (c + span < cols.length && !row[c + span]) span++;
                return (
                  <td
                    key={c}
                    colSpan={span}
                    className="overflow-hidden whitespace-nowrap border border-[#e5e7eb] px-1"
                    style={{ background: s.bg?.rgb, color: s.cl?.rgb ?? '#1f2937', fontWeight: s.bl ? 700 : 400, fontSize: s.fs && s.fs > 12 ? 17 : undefined, textAlign: s.ht === 3 || typeof cell?.v === 'number' ? 'right' : undefined }}
                  >
                    {text}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SheetTemplates({ onPick, busy }: { onPick: Pick; busy: string | null }) {
  const items = useMemo(() => SHEET_TEMPLATES.map((t) => ({ ...t, preview: <SheetThumb sheet={t.build(t.name).sheets[0]} color={t.color} /> })), []);
  return <TemplateRow heading="Start a new spreadsheet" blank="Blank spreadsheet" items={items} height={Math.round((W * 3) / 4)} onPick={onPick} busy={busy} />;
}
