'use client';

import type { Editor } from '@tiptap/core';
import { NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from '@tiptap/react';
import { chartFromValues, DocChart, type DocChartSpec } from '@workos/doc-model';
import { chartSvg, DEFAULT_THEME, type ChartSpec } from '@workos/slide-model';
import { ChartColumn, Link2, RefreshCw, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { Button, cn, Dialog } from '../ui/primitives';
import { LinkSheet } from '../slides/SlidePanels';

const KINDS: DocChartSpec['kind'][] = ['column', 'bar', 'line', 'area', 'pie', 'doughnut'];

/** Reads a linked range again ("Update" in Google Docs). */
export async function chartFromSheet(src: NonNullable<DocChartSpec['source']>): Promise<Pick<DocChartSpec, 'categories' | 'series' | 'source'>> {
  const data = await api<{ name: string; sheet: string; values: (string | number | boolean | null)[][] }>(`/resources/${src.resourceId}/sheet-range?range=${encodeURIComponent(src.range)}${src.sheet ? `&sheet=${encodeURIComponent(src.sheet)}` : ''}`);
  const next = chartFromValues(data.values);
  if (!next) throw new Error('The range needs a header row and at least one numeric column');
  return { ...next, source: { ...src, name: data.name, sheet: data.sheet } };
}

function DocChartView({ node, updateAttributes, deleteNode, editor, selected }: ReactNodeViewProps) {
  const spec = node.attrs.spec as DocChartSpec | null;
  const w = Number(node.attrs.width) || 640;
  const h = Number(node.attrs.height) || 360;
  const [busy, setBusy] = useState(false);
  if (!spec) return <NodeViewWrapper />;
  const set = (patch: Partial<DocChartSpec>) => updateAttributes({ spec: { ...spec, ...patch } });
  const update = async () => {
    if (!spec.source) return;
    setBusy(true);
    try {
      set(await chartFromSheet(spec.source));
      toast.success('Chart updated from Sheets');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <NodeViewWrapper className="relative my-4" data-testid="doc-chart" data-drag-handle>
      {selected && editor.isEditable && (
        <div contentEditable={false} className="absolute -top-11 left-0 z-10 flex items-center gap-1.5 rounded-lg border border-line bg-surface px-2 py-1 shadow-md">
          <select value={spec.kind} onChange={(e) => set({ kind: e.target.value as DocChartSpec['kind'] })} className="h-7 rounded border border-line px-1 text-[12px]" aria-label="Chart type">
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {k[0].toUpperCase() + k.slice(1)}
              </option>
            ))}
          </select>
          <input defaultValue={spec.title ?? ''} onBlur={(e) => set({ title: e.target.value || undefined })} placeholder="Title" className="h-7 w-40 rounded border border-line px-1.5 text-[12px]" aria-label="Chart title" />
          {spec.source && (
            <button onClick={() => void update()} disabled={busy} className="flex h-7 items-center gap-1 rounded px-2 text-[12px] font-medium text-emerald-700 hover:bg-emerald-50" data-testid="chart-update">
              <RefreshCw size={13} className={cn(busy && 'animate-spin')} /> Update
            </button>
          )}
          <button onClick={deleteNode} className="rounded p-1 text-muted hover:bg-hover" aria-label="Delete chart">
            <Trash2 size={14} />
          </button>
        </div>
      )}
      <div contentEditable={false} className={cn('mx-auto rounded-md bg-white', selected && 'ring-2 ring-brand-400')} style={{ maxWidth: w }}>
        <div className="[&>svg]:block [&>svg]:h-auto [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: chartSvg(spec as ChartSpec, w, h, DEFAULT_THEME) }} />
        {spec.source && (
          <div className="flex items-center gap-1 px-2 pb-1 text-[11px] text-muted">
            <Link2 size={11} className="text-emerald-600" /> {spec.source.name ?? 'Spreadsheet'} · {spec.source.sheet ? `${spec.source.sheet}!` : ''}
            {spec.source.range}
          </div>
        )}
      </div>
    </NodeViewWrapper>
  );
}

export const DocChartWithView = DocChart.extend({ addNodeView: () => ReactNodeViewRenderer(DocChartView) });

const SAMPLE: DocChartSpec = {
  kind: 'column',
  title: 'Chart title',
  categories: ['Q1', 'Q2', 'Q3', 'Q4'],
  series: [
    { name: 'Revenue', values: [120, 150, 170, 210] },
    { name: 'Costs', values: [90, 100, 110, 120] },
  ],
  legend: true,
};

/** Insert → Chart: linked to a Sheets range (like Google Docs) or a sample chart to edit. */
export function ChartDialog({ open, editor, onClose }: { open: boolean; editor: Editor; onClose: () => void }) {
  const insert = (spec: DocChartSpec) => {
    editor.chain().focus().insertContent({ type: 'docChart', attrs: { spec } }).run();
    onClose();
  };
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()} title="Insert chart" description="Link a range of a spreadsheet — the chart can be updated when the data changes." width={460}>
      <div className="space-y-3 text-[13px]" data-testid="chart-dialog">
        <LinkSheet
          onCancel={onClose}
          onLink={async (src) => {
            try {
              const data = await chartFromSheet(src);
              insert({ kind: 'column', title: src.name, legend: true, ...data });
            } catch (e) {
              toast.error((e as Error).message);
            }
          }}
        />
        <div className="border-t border-line pt-3">
          <Button size="sm" variant="soft" icon={<ChartColumn size={14} />} onClick={() => insert(SAMPLE)}>
            Insert a sample chart instead
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
