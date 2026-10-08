'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Copy, ImagePlus } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { api, uploadFile } from '@/lib/api';
import { Button, cn, Dialog } from '../ui/primitives';

interface Slot {
  slide: number;
  slideId: string;
  elementId: string;
  prompt: string;
  filled: boolean;
}

/**
 * Pictures for a deck planned with picture slots (§82): the prompt of every slot to paste into ChatGPT / Gemini, and
 * the pictures back in — a file named "slide 05.png" goes to slide 5, others fill the empty slots in order.
 */
export function SlotsDialog({ open, onClose, resourceId, onGo }: { open: boolean; onClose: () => void; resourceId: string; onGo?: (slideId: string) => void }) {
  const qc = useQueryClient();
  const { data: slots, isLoading } = useQuery({ queryKey: ['ai', 'slots', resourceId], queryFn: () => api<Slot[]>(`/ai/pictures/${resourceId}/slots`), enabled: open });
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const copy = (t: string) => void navigator.clipboard.writeText(t).then(() => toast.success('Copied — paste it into ChatGPT'));
  const ask = (s: Slot) => `Tạo một bức ảnh ngang tỉ lệ 16:9 (cho slide ${s.slide}): ${s.prompt}`;
  const upload = async (files: FileList) => {
    const fd = new FormData();
    for (const f of Array.from(files)) fd.append('files', f);
    setBusy(true);
    try {
      const r = await uploadFile<{ placed: { slide: number; file: string }[]; left: number; unused: string[] }>(`/ai/pictures/${resourceId}/slots`, fd);
      toast.success(`${r.placed.length} picture${r.placed.length === 1 ? '' : 's'} put in (slides ${r.placed.map((p) => p.slide).join(', ')})${r.left ? ` — ${r.left} slot${r.left === 1 ? '' : 's'} still empty` : ''}`);
      if (r.unused.length) toast.message(`Not used: ${r.unused.join(', ')}`);
      void qc.invalidateQueries({ queryKey: ['ai', 'slots', resourceId] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const empty = (slots ?? []).filter((s) => !s.filled);
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => !v && onClose()}
      title="Pictures for the picture slots"
      description="1 · Copy a prompt and paste it into ChatGPT (or Gemini) — one picture per message. 2 · Save the picture (name it “slide 05.png” to send it to slide 5). 3 · Put the pictures in: they are cropped to the slot, never stretched."
      width={640}
      footer={
        <>
          <Button variant="secondary" icon={<Copy size={14} />} disabled={!empty.length} onClick={() => copy(empty.map(ask).join('\n\n'))}>
            Copy all empty prompts
          </Button>
          <Button variant="primary" icon={<ImagePlus size={14} />} loading={busy} onClick={() => input.current?.click()} data-testid="slots-upload">
            Put pictures in…
          </Button>
          <input ref={input} type="file" accept="image/*" multiple hidden onChange={(e) => (e.target.files?.length && void upload(e.target.files), (e.target.value = ''))} data-testid="slots-input" />
        </>
      }
    >
      <div className="max-h-[55vh] space-y-1.5 overflow-y-auto pr-1" data-testid="slots-dialog">
        {isLoading && <p className="text-[12.5px] text-muted">Loading…</p>}
        {slots && !slots.length && <p className="text-[12.5px] text-muted">No picture slots here. Make a deck with AI → “Presentation with pictures (from ChatGPT)”.</p>}
        {slots?.map((s) => (
          <div key={s.elementId} className={cn('flex items-start gap-2 rounded-lg border px-2.5 py-2', s.filled ? 'border-emerald-200 bg-emerald-50/50' : 'border-line')} data-testid="slot" data-filled={s.filled ? '1' : '0'}>
            <button className="w-14 shrink-0 text-left text-[12px] font-semibold text-brand-700 hover:underline" onClick={() => onGo?.(s.slideId)} title="Go to the slide">
              Slide {s.slide}
            </button>
            <p className="min-w-0 flex-1 text-[12px] leading-snug text-ink-2">{s.prompt}</p>
            {s.filled ? (
              <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-emerald-600" aria-label="Picture in" />
            ) : (
              <button className="shrink-0 rounded p-1 text-muted hover:bg-hover hover:text-ink" onClick={() => copy(ask(s))} aria-label={`Copy the prompt of slide ${s.slide}`}>
                <Copy size={14} />
              </button>
            )}
          </div>
        ))}
      </div>
    </Dialog>
  );
}
