'use client';

import { TEMPLATES, templateDeck } from '@workos/slide-model';
import { Loader2, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { SlideStyles, SlideView } from './SlideView';

/** "Start a new presentation" row (Google Slides): blank plus the template gallery. */
export function SlideTemplates({ onPick, busy }: { onPick: (template: string | null, name: string) => void; busy: string | null }) {
  // Built after mounting: template slides get random ids, which would not match the server-rendered HTML.
  const [previews, setPreviews] = useState<{ t: (typeof TEMPLATES)[number]; deck: ReturnType<typeof templateDeck> }[] | null>(null);
  useEffect(() => setPreviews(TEMPLATES.map((t) => ({ t, deck: templateDeck(t.id, t.name) }))), []);
  const W = 196;
  return (
    <div className="mt-6" data-testid="slide-templates">
      <SlideStyles />
      <h2 className="mb-2 text-[13px] font-semibold text-ink-2">Start a new presentation</h2>
      <div className="flex gap-3 overflow-x-auto pb-2">
        <button onClick={() => onPick(null, 'Untitled presentation')} disabled={!!busy} className="group shrink-0 text-left" data-testid="template-blank">
          <div className="flex items-center justify-center rounded-lg border border-line bg-surface transition group-hover:border-brand-400 group-hover:shadow-md" style={{ width: W, height: (W * 9) / 16 }}>
            {busy === 'blank' ? <Loader2 size={22} className="animate-spin text-muted" /> : <Plus size={28} className="text-brand-600" />}
          </div>
          <div className="mt-1.5 text-[13px] font-medium text-ink">Blank presentation</div>
        </button>
        {(previews ?? TEMPLATES.map((t) => ({ t, deck: null }))).map(({ t, deck }) => (
          <button key={t.id} onClick={() => onPick(t.id, t.name)} disabled={!!busy} className="group shrink-0 text-left" data-testid={`template-${t.id}`} title={t.description}>
            <div className="relative overflow-hidden rounded-lg border border-line transition group-hover:border-brand-400 group-hover:shadow-md">
              {deck ? <SlideView slide={deck.slides[0]} deck={deck} width={W} /> : <div className="bg-surface" style={{ width: W, height: (W * 9) / 16 }} />}
              {busy === t.id && (
                <div className="absolute inset-0 flex items-center justify-center bg-white/60">
                  <Loader2 size={22} className="animate-spin text-muted" />
                </div>
              )}
            </div>
            <div className="mt-1.5 text-[13px] font-medium text-ink">{t.name}</div>
            <div className="w-[196px] truncate text-[12px] text-muted">{t.description}</div>
          </button>
        ))}
      </div>
    </div>
  );
}
