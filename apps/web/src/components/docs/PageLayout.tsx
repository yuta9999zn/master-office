'use client';

import { DEFAULT_PAGE_SETUP, PAPER, pageSetupOf, SETTINGS_MAP, type PageSetup } from '@workos/doc-model';
import { useEffect, useState } from 'react';
import type * as Y from 'yjs';
import { Button, cn, Dialog } from '../ui/primitives';

/** Page setup lives in the document's Yjs "settings" map, so it is shared, versioned and exported. */
export function useDocSettings(doc: Y.Doc) {
  const map = doc.getMap(SETTINGS_MAP);
  const [pageSetup, setPageSetup] = useState<PageSetup>(() => pageSetupOf(map.toJSON()));
  useEffect(() => {
    const sync = () => setPageSetup(pageSetupOf(map.toJSON()));
    map.observe(sync);
    sync();
    return () => map.unobserve(sync);
  }, [map]);
  return { pageSetup, update: (p: PageSetup) => map.set('pageSetup', p) };
}

export const MM_TO_PX = 96 / 25.4;

const PRESETS: { id: string; label: string; m: PageSetup['margins'] }[] = [
  { id: 'normal', label: 'Normal (2.54 cm)', m: { top: 25.4, right: 25.4, bottom: 25.4, left: 25.4 } },
  { id: 'narrow', label: 'Narrow (1.27 cm)', m: { top: 12.7, right: 12.7, bottom: 12.7, left: 12.7 } },
  { id: 'moderate', label: 'Moderate', m: { top: 25.4, right: 19.1, bottom: 25.4, left: 19.1 } },
  { id: 'wide', label: 'Wide (5.08 cm sides)', m: { top: 25.4, right: 50.8, bottom: 25.4, left: 50.8 } },
];

export function PageSetupDialog({ open, value, onClose, onSave, readOnly }: { open: boolean; value: PageSetup; onClose: () => void; onSave: (p: PageSetup) => void; readOnly: boolean }) {
  const [p, setP] = useState(value);
  useEffect(() => {
    if (open) setP(value);
  }, [open, value]);
  const set = <K extends keyof PageSetup>(k: K, v: PageSetup[K]) => setP((x) => ({ ...x, [k]: v }));
  const Num = ({ side }: { side: keyof PageSetup['margins'] }) => (
    <label className="block">
      <span className="mb-1 block text-[12px] capitalize text-muted">{side} (mm)</span>
      <input
        type="number"
        min={0}
        max={100}
        step={0.1}
        disabled={readOnly}
        value={p.margins[side]}
        onChange={(e) => set('margins', { ...p.margins, [side]: Number(e.target.value) })}
        className="input h-8"
      />
    </label>
  );
  const Align = ({ k }: { k: 'headerAlign' | 'footerAlign' }) => (
    <select disabled={readOnly} value={p[k]} onChange={(e) => set(k, e.target.value as PageSetup['headerAlign'])} className="input h-8 w-28">
      <option value="left">Left</option>
      <option value="center">Center</option>
      <option value="right">Right</option>
    </select>
  );
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => !v && onClose()}
      title="Page setup"
      description="Applies to print layout, PDF and Word export."
      width={560}
      footer={
        <>
          <Button className="mr-auto" disabled={readOnly} onClick={() => setP(DEFAULT_PAGE_SETUP)}>
            Reset
          </Button>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={readOnly}
            onClick={() => {
              onSave(p);
              onClose();
            }}
          >
            Apply
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <span className="mb-1 block text-[12px] text-muted">Format</span>
          <div className="flex gap-2">
            {([false, true] as const).map((pl) => (
              <button
                key={String(pl)}
                disabled={readOnly}
                onClick={() => set('pageless', pl)}
                className={cn('flex-1 rounded-lg border px-3 py-2 text-left text-[13px]', !!p.pageless === pl ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-line hover:bg-hover')}
                data-testid={pl ? 'format-pageless' : 'format-pages'}
              >
                <span className="block font-medium">{pl ? 'Pageless' : 'Pages'}</span>
                <span className="block text-[12px] text-muted">{pl ? 'One continuous page that uses your window width' : 'Pages with margins, header and footer'}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label>
            <span className="mb-1 block text-[12px] text-muted">Paper size</span>
            <select disabled={readOnly} value={p.size} onChange={(e) => set('size', e.target.value as PageSetup['size'])} className="input h-8">
              {Object.entries(PAPER).map(([k, v]) => (
                <option key={k} value={k}>
                  {k} ({v.w} × {v.h} mm)
                </option>
              ))}
            </select>
          </label>
          <div>
            <span className="mb-1 block text-[12px] text-muted">Orientation</span>
            <div className="flex gap-2">
              {(['portrait', 'landscape'] as const).map((o) => (
                <button key={o} disabled={readOnly} onClick={() => set('orientation', o)} className={cn('flex h-8 flex-1 items-center justify-center gap-2 rounded-lg border text-[13px] capitalize', p.orientation === o ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-line hover:bg-hover')}>
                  <span className={cn('border-2 border-current', o === 'portrait' ? 'h-4 w-3' : 'h-3 w-4')} />
                  {o}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div>
          <span className="mb-1 block text-[12px] text-muted">Margins</span>
          <div className="mb-2 flex flex-wrap gap-1.5">
            {PRESETS.map((x) => (
              <button key={x.id} disabled={readOnly} onClick={() => set('margins', x.m)} className={cn('rounded-full border px-2.5 py-1 text-[12px]', JSON.stringify(x.m) === JSON.stringify(p.margins) ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-line hover:bg-hover')}>
                {x.label}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-4 gap-2">
            <Num side="top" />
            <Num side="bottom" />
            <Num side="left" />
            <Num side="right" />
          </div>
        </div>
        <div className="space-y-2">
          <span className="block text-[12px] text-muted">
            Header &amp; footer — use <code className="rounded bg-hover px-1">{'{page}'}</code> <code className="rounded bg-hover px-1">{'{pages}'}</code>{' '}
            <code className="rounded bg-hover px-1">{'{title}'}</code> <code className="rounded bg-hover px-1">{'{date}'}</code>
          </span>
          <div className="flex gap-2">
            <input disabled={readOnly} value={p.header} onChange={(e) => set('header', e.target.value)} placeholder="Header text" aria-label="Header text" className="input h-8 flex-1" />
            <Align k="headerAlign" />
          </div>
          <div className="flex gap-2">
            <input disabled={readOnly} value={p.footer} onChange={(e) => set('footer', e.target.value)} placeholder="Footer text, e.g. Page {page} of {pages}" aria-label="Footer text" className="input h-8 flex-1" />
            <Align k="footerAlign" />
          </div>
          <button disabled={readOnly} onClick={() => setP((x) => ({ ...x, footer: 'Page {page} of {pages}', footerAlign: 'center' }))} className="text-[12px] font-medium text-brand-600 hover:underline">
            Add page numbers
          </button>
        </div>
      </div>
    </Dialog>
  );
}

/** Shows the real PDF the server renders — true pagination, header/footer and page numbers. */
export function PrintPreview({ open, resourceId, onClose, nonce }: { open: boolean; resourceId: string; onClose: () => void; nonce: number }) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()} title="Print preview" width={980}>
      {open && (
        <iframe
          title="Print preview"
          data-testid="print-preview"
          src={`/api/resources/${resourceId}/export?format=pdf&inline=1&v=${nonce}`}
          className="h-[68vh] w-full rounded-lg border border-line bg-canvas"
        />
      )}
    </Dialog>
  );
}
