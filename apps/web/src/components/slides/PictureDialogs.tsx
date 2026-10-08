'use client';

import { Download, Scaling } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useAiStatus } from '@/lib/ai';
import { Button, cn, Dialog } from '../ui/primitives';

/** Slides are laid out at 96 px per inch; 3.125 × is print quality (300 dpi). */
const SCALES = [
  { scale: 1, label: '1× · screen' },
  { scale: 2, label: '2× · sharp (default)' },
  { scale: 3, label: '3× · extra sharp' },
  { scale: 3.125, label: 'Print · 300 dpi' },
  { scale: 4, label: '4× · largest' },
];

/** Download one slide (or all) as a picture: PNG or JPG, at a chosen size. */
export function PictureDownloadDialog({ open, onClose, resourceId, slideNo, slides, size }: { open: boolean; onClose: () => void; resourceId: string; slideNo: number; slides: number; size: { w: number; h: number } }) {
  const [format, setFormat] = useState<'png' | 'jpg'>('png');
  const [scale, setScale] = useState(2);
  const [all, setAll] = useState(false);
  // The server keeps pictures under ~40 megapixels.
  const cap = Math.sqrt(40_000_000 / (size.w * size.h));
  const px = (s: number) => {
    const k = Math.min(s, cap >= s ? s : Math.floor(cap * 4) / 4);
    return `${Math.round(size.w * k)} × ${Math.round(size.h * k)} px`;
  };
  const inches = (s: number) => (s === 3.125 ? ` · ${((size.w / 96) * 25.4).toFixed(0)} × ${((size.h / 96) * 25.4).toFixed(0)} mm` : '');
  const download = () => {
    window.location.href = `/api/resources/${resourceId}/export?format=${format}&scale=${scale}${all ? '' : `&slide=${slideNo}`}`;
    onClose();
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => !v && onClose()}
      title="Download as picture"
      description={`The slide is ${size.w} × ${size.h} px. Pick the file type and how big the picture should be.`}
      width={460}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" icon={<Download size={14} />} onClick={download} data-testid="picture-download">
            Download
          </Button>
        </>
      }
    >
      <div className="space-y-3" data-testid="picture-download-dialog">
        <div className="flex gap-2" role="radiogroup" aria-label="File type">
          {(['png', 'jpg'] as const).map((f) => (
            <button key={f} role="radio" aria-checked={format === f} onClick={() => setFormat(f)} className={cn('flex-1 rounded-lg border px-3 py-2 text-left text-[12.5px]', format === f ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-line text-ink-2 hover:bg-hover')}>
              <b>{f.toUpperCase()}</b>
              <div className="text-[11.5px] text-muted">{f === 'png' ? 'Crisp text, transparent-safe — web, chat' : 'Smaller file — photos, e-mail, print shops'}</div>
            </button>
          ))}
        </div>
        <div className="space-y-1" role="radiogroup" aria-label="Size">
          {SCALES.map((s) => (
            <label key={s.scale} className={cn('flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[12.5px]', scale === s.scale ? 'bg-brand-50' : 'hover:bg-hover')}>
              <input type="radio" name="scale" checked={scale === s.scale} onChange={() => setScale(s.scale)} className="accent-brand-600" />
              <span className="w-40 text-ink">{s.label}</span>
              <span className="tabular-nums text-muted">
                {px(s.scale)}
                {inches(s.scale)}
              </span>
            </label>
          ))}
        </div>
        {slides > 1 && (
          <label className="flex items-center gap-2 text-[12.5px] text-ink-2">
            <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} className="accent-brand-600" />
            All {slides} slides (a .zip, one picture per slide) — otherwise slide {slideNo}
          </label>
        )}
      </div>
    </Dialog>
  );
}

/** Canva-style Resize: the slide as a new design in another format; text and shapes are placed again, nothing is stretched. */
export function ResizeDialog({ open, onClose, resourceId, slideId, size, picture }: { open: boolean; onClose: () => void; resourceId: string; slideId: string | null; size: { w: number; h: number }; picture: boolean }) {
  const { data: status } = useAiStatus();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  // A design on a picture keeps its text on the picture's decorations: keep it whole by default.
  const [mode, setMode] = useState<'fit' | 'fill'>(picture ? 'fit' : 'fill');
  const formats = (status?.formats ?? []).filter((f) => f.size.w !== size.w || f.size.h !== size.h);
  const resize = async (format: string) => {
    setBusy(format);
    try {
      const r = await api<{ resourceId: string; url: string; name: string }>(`/ai/pictures/${resourceId}/resize`, { method: 'POST', json: { slideId, format, mode } });
      toast.success(`Created “${r.name}”`);
      onClose();
      router.push(r.url);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()} title="Resize to another format" description="A copy of this slide in the new size, next to this file." width={540}>
      <div className="mb-3 grid gap-1.5 sm:grid-cols-2" role="radiogroup" aria-label="How">
        {(
          [
            ['fit', 'Keep the design whole', 'Scaled into the new shape; the edges are filled with a soft, blurred copy of the picture. Best for pictures from ChatGPT / Gemini.'],
            ['fill', 'Fill and rearrange', 'Fills the new shape: the background picture is cropped and text and shapes are spread out again. Best for template designs.'],
          ] as const
        ).map(([m, label, note]) => (
          <button key={m} role="radio" aria-checked={mode === m} onClick={() => setMode(m)} className={cn('rounded-lg border px-3 py-2 text-left', mode === m ? 'border-brand-500 bg-brand-50' : 'border-line hover:bg-hover')} data-testid="resize-mode" data-mode={m}>
            <span className={cn('block text-[12.5px] font-medium', mode === m ? 'text-brand-700' : 'text-ink')}>{label}</span>
            <span className="block text-[11px] leading-snug text-muted">{note}</span>
          </button>
        ))}
      </div>
      <div className="grid gap-1.5 sm:grid-cols-2" data-testid="resize-dialog">
        {formats.map((f) => {
          const k = 34 / Math.max(f.size.w, f.size.h);
          return (
            <button key={f.id} disabled={!!busy} onClick={() => void resize(f.id)} className="flex items-center gap-2.5 rounded-lg border border-line px-2.5 py-2 text-left hover:bg-hover disabled:opacity-60" data-testid="resize-format" data-format={f.id}>
              <span className="grid size-9 shrink-0 place-items-center">
                <span className="rounded-[2px] border border-brand-500 bg-brand-50" style={{ width: Math.max(4, f.size.w * k), height: Math.max(3, f.size.h * k) }} />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-[12.5px] font-medium text-ink">{busy === f.id ? 'Creating…' : f.label}</span>
                <span className="block truncate text-[11px] text-muted">{f.note}</span>
              </span>
            </button>
          );
        })}
        {!formats.length && <p className="text-[12.5px] text-muted">Loading formats…</p>}
      </div>
      <p className="mt-3 flex items-center gap-1.5 text-[11.5px] text-muted">
        <Scaling size={13} /> Works without AI. To change the words for the new format, use AI → “Put new information into a design”.
      </p>
    </Dialog>
  );
}
