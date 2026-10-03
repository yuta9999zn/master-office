// Charts in documents (Google Docs: Insert → Chart, from Sheets or with its own data). docs/ARCHITECTURE.md §41.
// The spec has the same shape as a slide chart (packages/slide-model ChartSpec); renderers pass the SVG painter in,
// so this package stays independent of the slide model.
import { mergeAttributes, Node, type JSONContent } from '@tiptap/core';

export interface DocChartSpec {
  kind: 'column' | 'bar' | 'line' | 'area' | 'pie' | 'doughnut';
  title?: string;
  categories: string[];
  series: { name: string; values: number[]; color?: string }[];
  legend?: boolean;
  labels?: boolean;
  /** Linked spreadsheet range ("Update" re-reads it). */
  source?: { resourceId: string; name?: string; sheet?: string; range: string } | null;
}

export type ChartPainter = (spec: DocChartSpec, w: number, h: number) => string;

export const DocChart = Node.create({
  name: 'docChart',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() {
    return {
      spec: {
        default: null,
        parseHTML: (el) => {
          try {
            return JSON.parse(el.getAttribute('data-spec') ?? 'null');
          } catch {
            return null;
          }
        },
        renderHTML: (a) => ({ 'data-spec': JSON.stringify(a.spec) }),
      },
      width: { default: 640, parseHTML: (el) => Number(el.getAttribute('data-width')) || 640, renderHTML: (a) => ({ 'data-width': a.width }) },
      height: { default: 360, parseHTML: (el) => Number(el.getAttribute('data-height')) || 360, renderHTML: (a) => ({ 'data-height': a.height }) },
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-doc-chart]' }];
  },
  renderHTML({ HTMLAttributes, node }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-doc-chart': '', class: 'mo-doc-chart' }), (node.attrs.spec as DocChartSpec | null)?.title ?? 'Chart'];
  },
});

/** Words of a chart for search: title, categories, series names. */
export const chartText = (spec: DocChartSpec | null | undefined) => (spec ? [spec.title, ...spec.categories, ...spec.series.map((s) => s.name)].filter(Boolean).join(' ') : '');

/** Charts of a document in order (DOCX export rasterises them). */
export function chartsOf(doc: JSONContent | null | undefined): { spec: DocChartSpec; width: number; height: number }[] {
  const out: { spec: DocChartSpec; width: number; height: number }[] = [];
  const walk = (n: JSONContent) => {
    if (n.type === 'docChart' && n.attrs?.spec) out.push({ spec: n.attrs.spec as DocChartSpec, width: Number(n.attrs.width) || 640, height: Number(n.attrs.height) || 360 });
    n.content?.forEach(walk);
  };
  if (doc) walk(doc);
  return out;
}

/** A first table → chart conversion: header row = series names, first column = categories. */
export function chartFromValues(values: (string | number | boolean | null)[][]): Pick<DocChartSpec, 'categories' | 'series'> | null {
  if (values.length < 2 || (values[0]?.length ?? 0) < 2) return null;
  const head = values[0];
  const rows = values.slice(1).filter((r) => r.some((v) => v !== null && v !== ''));
  return { categories: rows.map((r) => String(r[0] ?? '')), series: head.slice(1).map((name, i) => ({ name: String(name ?? `Series ${i + 1}`), values: rows.map((r) => Number(r[i + 1]) || 0) })) };
}
