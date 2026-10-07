'use client';

import { bounds, type PlainFlow } from '@workos/flow-model';
import { forwardRef } from 'react';
import { EdgeShape, NodeShape } from './render';

/** One page drawn without editing chrome — Present, Prototype, export, version preview. */
export const FlowStatic = forwardRef<SVGSVGElement, { flow: PlainFlow; page: string; pad?: number; highlight?: string | null; visited?: Set<string>; className?: string; onNode?: (id: string) => void }>(function FlowStatic(
  { flow, page, pad = 40, highlight, visited, className, onNode },
  ref,
) {
  const nodes = flow.nodes.filter((n) => n.page === page).sort((a, b) => a.z - b.z);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const b = bounds(nodes, pad);
  const vb = nodes.length ? `${b.x} ${b.y} ${b.w} ${b.h}` : '0 0 800 600';
  const back = nodes.filter((n) => n.shape === 'container' || n.shape === 'lane');
  const front = nodes.filter((n) => n.shape !== 'container' && n.shape !== 'lane');
  return (
    <svg ref={ref} xmlns="http://www.w3.org/2000/svg" viewBox={vb} width={nodes.length ? b.w : 800} height={nodes.length ? b.h : 600} className={className} style={{ background: '#ffffff' }}>
      {back.map((n) => (
        <g key={n.id} transform={`translate(${n.x},${n.y})`}>
          <NodeShape n={n} />
        </g>
      ))}
      {flow.edges
        .filter((e) => e.page === page && byId.has(e.from) && byId.has(e.to))
        .map((e) => (
          <EdgeShape key={e.id} e={e} a={byId.get(e.from)!} b={byId.get(e.to)!} selected={visited?.has(e.id)} />
        ))}
      {front.map((n) => (
        <g key={n.id} transform={`translate(${n.x},${n.y})`} onClick={onNode ? () => onNode(n.id) : undefined} style={onNode ? { cursor: 'pointer' } : undefined} data-testid="static-node" data-text={n.text}>
          <NodeShape n={n} />
          {highlight === n.id && <rect x={-5} y={-5} width={n.w + 10} height={n.h + 10} rx={10} fill="none" stroke="#2563eb" strokeWidth={3} data-testid="prototype-current" />}
          {highlight !== n.id && visited?.has(n.id) && <rect x={-4} y={-4} width={n.w + 8} height={n.h + 8} rx={9} fill="none" stroke="#93c5fd" strokeWidth={2} />}
        </g>
      ))}
    </svg>
  );
});

/** The page as a standalone SVG file (fonts fall back to the system's). */
export function svgText(el: SVGSVGElement) {
  const clone = el.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.removeAttribute('class');
  return `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(clone)}`;
}

/** The page as a PNG (2× for sharp text). */
export async function pngBlob(el: SVGSVGElement): Promise<Blob> {
  const text = svgText(el);
  const w = Number(el.getAttribute('width')) || 800;
  const h = Number(el.getAttribute('height')) || 600;
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(text)}`;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = w * 2;
  c.height = h * 2;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, c.width, c.height);
  g.drawImage(img, 0, 0, c.width, c.height);
  return new Promise((ok, fail) => c.toBlob((b) => (b ? ok(b) : fail(new Error('Could not draw the picture'))), 'image/png'));
}

export function download(name: string, data: Blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(data);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
