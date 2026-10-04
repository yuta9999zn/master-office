'use client';

import { slideTitle, type PlainSlide } from '@workos/slide-model';
import { Link2, Presentation } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button, cn, Dialog } from '../ui/primitives';

// Insert ▸ Link (Ctrl+K) in Slides: a web address, or another slide of this presentation (`#slide=<id>`),
// on the selected text or on the selected shape / picture. docs/ARCHITECTURE.md §53.

export function LinkDialog({ open, slides, current, onApply, onClose }: { open: boolean; slides: PlainSlide[]; current: string | null; onApply: (href: string | null) => void; onClose: () => void }) {
  const [url, setUrl] = useState('');
  const [slideId, setSlideId] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    const id = current?.startsWith('#slide=') ? current.slice(7) : null;
    setSlideId(id);
    setUrl(id ? '' : current ?? '');
  }, [open, current]);
  const normalized = url.trim() && !/^(https?:|mailto:)/i.test(url.trim()) ? `https://${url.trim()}` : url.trim();
  const href = slideId ? `#slide=${slideId}` : normalized || null;
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()} title="Insert link" width={460}>
      <div className="space-y-3" data-testid="slide-link-dialog">
        <label className="flex h-9 items-center gap-2 rounded-lg border border-line px-2.5 focus-within:border-brand-500">
          <Link2 size={15} className="text-subtle" />
          <input
            autoFocus
            value={url}
            onChange={(e) => (setUrl(e.target.value), setSlideId(null))}
            onKeyDown={(e) => e.key === 'Enter' && href && (onApply(href), onClose())}
            placeholder="Paste a link (https://…)"
            className="flex-1 bg-transparent text-[13px] outline-none"
            aria-label="Link address"
          />
        </label>
        <div>
          <div className="mb-1 text-[12px] font-medium text-muted">Slides in this presentation</div>
          <ul className="max-h-56 overflow-y-auto rounded-lg border border-line p-1" data-testid="slide-link-targets">
            {slides.map((s, i) => (
              <li key={s.id}>
                <button
                  onClick={() => (setSlideId(s.id), setUrl(''))}
                  className={cn('flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px]', slideId === s.id ? 'bg-brand-50 font-medium text-brand-700' : 'text-ink-2 hover:bg-hover')}
                >
                  <Presentation size={14} className="shrink-0 text-subtle" />
                  <span className="truncate">
                    Slide {i + 1}: {slideTitle(s) || 'Untitled'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
        <div className="flex items-center gap-2 pt-1">
          {current && (
            <Button variant="ghost" onClick={() => (onApply(null), onClose())}>
              Remove link
            </Button>
          )}
          <Button className="ml-auto" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!href} onClick={() => (onApply(href), onClose())} data-testid="slide-link-apply">
            Apply
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
