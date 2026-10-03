'use client';

import type { Editor } from '@tiptap/react';
import { watermarkSvg, type BorderSides, type PageSetup, type Watermark } from '@workos/doc-model';
import { ImagePlus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';
import { api, uploadFile } from '@/lib/api';
import { useResources, useSearch } from '@/lib/queries';
import { Button, cn, Dialog } from '../ui/primitives';

/** Insert → Watermark (Google Docs): a text or a picture behind every page. */
export function WatermarkDialog({ open, value, resourceId, readOnly, onClose, onSave }: { open: boolean; value: PageSetup; resourceId: string; readOnly: boolean; onClose: () => void; onSave: (p: PageSetup) => void }) {
  const [wm, setWm] = useState<Watermark>({});
  const [kind, setKind] = useState<'text' | 'image'>('text');
  const file = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!open) return;
    setWm(value.watermark ?? { text: 'CONFIDENTIAL', opacity: 0.15 });
    setKind(value.watermark?.image ? 'image' : 'text');
  }, [open, value]);
  const save = (w: Watermark | null) => {
    onSave({ ...value, watermark: w });
    onClose();
  };
  const preview = kind === 'text' ? (wm.text ? watermarkSvg(wm.text, 210, 297, wm.opacity ?? 0.15) : null) : wm.image ?? null;
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => !v && onClose()}
      title="Watermark"
      description="Shown behind the text of every page in print layout and in the PDF."
      width={520}
      footer={
        <>
          {value.watermark && (
            <Button className="mr-auto" disabled={readOnly} onClick={() => save(null)}>
              Remove watermark
            </Button>
          )}
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={readOnly || (kind === 'text' ? !wm.text?.trim() : !wm.image)} onClick={() => save(kind === 'text' ? { text: wm.text!.trim(), opacity: wm.opacity ?? 0.15 } : { image: wm.image, opacity: wm.opacity ?? 0.2 })} data-testid="watermark-save">
            Done
          </Button>
        </>
      }
    >
      <div className="flex gap-4">
        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex gap-1.5">
            {(['text', 'image'] as const).map((k) => (
              <button key={k} onClick={() => setKind(k)} className={cn('h-8 flex-1 rounded-lg border text-[13px] capitalize', kind === k ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-line hover:bg-hover')}>
                {k}
              </button>
            ))}
          </div>
          {kind === 'text' ? (
            <input value={wm.text ?? ''} onChange={(e) => setWm({ ...wm, text: e.target.value })} placeholder="e.g. DRAFT" className="input h-9 w-full" aria-label="Watermark text" />
          ) : (
            <>
              <Button icon={<ImagePlus size={14} />} onClick={() => file.current?.click()}>
                {wm.image ? 'Replace picture' : 'Upload a picture'}
              </Button>
              <input
                ref={file}
                type="file"
                accept="image/*"
                hidden
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  if (!f) return;
                  const fd = new FormData();
                  fd.append('file', f);
                  try {
                    const { url } = await uploadFile<{ url: string }>(`/resources/${resourceId}/assets`, fd);
                    setWm({ ...wm, image: url });
                  } catch (err) {
                    toast.error((err as Error).message);
                  }
                }}
              />
            </>
          )}
          <label className="block text-[12px] text-muted">
            Transparency
            <input type="range" min={5} max={60} value={Math.round((wm.opacity ?? 0.15) * 100)} onChange={(e) => setWm({ ...wm, opacity: Number(e.target.value) / 100 })} className="mt-1 w-full accent-brand-600" aria-label="Watermark opacity" />
          </label>
        </div>
        <div className="relative h-[198px] w-[140px] shrink-0 overflow-hidden rounded border border-line bg-white" aria-label="Watermark preview">
          <div className="space-y-1.5 p-3">
            {Array.from({ length: 9 }, (_, i) => (
              <div key={i} className="h-1 rounded bg-slate-200" style={{ width: `${60 + ((i * 37) % 40)}%` }} />
            ))}
          </div>
          {preview && <div className="absolute inset-0 bg-contain bg-center bg-no-repeat" style={{ backgroundImage: `url("${preview}")`, opacity: kind === 'image' ? wm.opacity ?? 0.2 : 1 }} />}
        </div>
      </div>
    </Dialog>
  );
}

const SIDES: { id: BorderSides | 'none'; label: string }[] = [
  { id: 'none', label: 'None' },
  { id: 'all', label: 'Box' },
  { id: 'left', label: 'Left' },
  { id: 'top', label: 'Top' },
  { id: 'bottom', label: 'Bottom' },
  { id: 'topBottom', label: 'Top & bottom' },
];

/** Format → Borders and shading: borders and background colour of the selected paragraphs. */
export function BordersDialog({ open, editor, onClose }: { open: boolean; editor: Editor; onClose: () => void }) {
  const [sides, setSides] = useState<BorderSides | 'none'>('none');
  const [width, setWidth] = useState(1);
  const [color, setColor] = useState('#94a3b8');
  const [shading, setShading] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    const a = editor.isActive('heading') ? editor.getAttributes('heading') : editor.getAttributes('paragraph');
    setSides((a.border as BorderSides) ?? 'none');
    setWidth(Number(a.borderWidth) || 1);
    setColor((a.borderColor as string) || '#94a3b8');
    setShading((a.shading as string) || null);
  }, [open, editor]);
  const apply = (reset = false) => {
    const attrs = reset ? { border: null, borderWidth: null, borderColor: null, shading: null } : { border: sides === 'none' ? null : sides, borderWidth: sides === 'none' ? null : width, borderColor: sides === 'none' ? null : color, shading };
    editor.chain().focus().updateAttributes('paragraph', attrs).updateAttributes('heading', attrs).run();
    onClose();
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => !v && onClose()}
      title="Borders and shading"
      width={460}
      footer={
        <>
          <Button className="mr-auto" onClick={() => apply(true)}>
            Reset
          </Button>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => apply()} data-testid="borders-apply">
            Apply
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-[13px]">
        <div>
          <span className="mb-1 block text-[12px] text-muted">Border</span>
          <div className="grid grid-cols-3 gap-1.5">
            {SIDES.map((s) => (
              <button key={s.id} onClick={() => setSides(s.id)} className={cn('h-8 rounded-lg border', sides === s.id ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-line hover:bg-hover')} aria-pressed={sides === s.id}>
                {s.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-[12px] text-muted">
            Width
            <select value={width} onChange={(e) => setWidth(Number(e.target.value))} className="input h-8 w-20" aria-label="Border width">
              {[1, 2, 3, 4, 6].map((w) => (
                <option key={w} value={w}>
                  {w} px
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-[12px] text-muted">
            Colour
            <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="size-8 rounded border border-line p-0.5" aria-label="Border colour" />
          </label>
          <label className="flex items-center gap-2 text-[12px] text-muted">
            Background
            <input type="color" value={shading ?? '#ffffff'} onChange={(e) => setShading(e.target.value)} className="size-8 rounded border border-line p-0.5" aria-label="Background colour" />
          </label>
          {shading && (
            <button onClick={() => setShading(null)} className="text-[12px] text-brand-700 hover:underline">
              No background
            </button>
          )}
        </div>
      </div>
    </Dialog>
  );
}

/** Tools → Compare documents: pick another document; the differences open as suggestions in a new document. */
export function CompareDialog({ open, resourceId, onClose }: { open: boolean; resourceId: string; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const router = useRouter();
  const { data: hits } = useSearch(q);
  const { data: recent } = useResources(open ? { type: 'document' } : null);
  const items = (q.trim() ? (hits ?? []).filter((h) => h.kind === 'resource' && h.type === 'document').map((h) => ({ id: h.id, name: h.title })) : (recent ?? []).map((r) => ({ id: r.id, name: r.name }))).filter((x) => x.id !== resourceId).slice(0, 12);
  const compare = async (otherId: string) => {
    setBusy(otherId);
    try {
      const r = await api<{ id: string; changes: { insertions: number; deletions: number } }>(`/resources/${resourceId}/compare`, { method: 'POST', json: { otherId } });
      toast.success(`Comparison ready: ${r.changes.insertions} insertion${r.changes.insertions === 1 ? '' : 's'}, ${r.changes.deletions} deletion${r.changes.deletions === 1 ? '' : 's'}`);
      onClose();
      router.push(`/docs/${r.id}?panel=Suggestions`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()} title="Compare documents" description="Pick the document to compare with this one. Its differences open as suggestions in a new document." width={500}>
      <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search documents…" className="input h-9 w-full" aria-label="Search documents to compare" />
      <div className="mt-2 max-h-72 overflow-y-auto rounded-lg border border-line" data-testid="compare-list">
        {items.length ? (
          items.map((x) => (
            <button key={x.id} disabled={!!busy} onClick={() => void compare(x.id)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] hover:bg-hover disabled:opacity-50">
              <span className="min-w-0 flex-1 truncate">{x.name}</span>
              {busy === x.id && <span className="text-[12px] text-muted">Comparing…</span>}
            </button>
          ))
        ) : (
          <p className="px-3 py-4 text-[13px] text-muted">No documents found.</p>
        )}
      </div>
    </Dialog>
  );
}
