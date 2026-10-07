'use client';

import { PROJECT_DOC_TEMPLATES, type ProjectDocCategory } from '@workos/doc-model';
import { Search } from 'lucide-react';
import { useState } from 'react';
import { Dialog } from '../ui/primitives';

const CATEGORIES: ProjectDocCategory[] = ['Business', 'Planning', 'Elicitation', 'Requirements', 'Modelling', 'Design', 'Delivery & Quality', 'Agile', 'AI-DLC'];

/** Picks what a new wiki page starts from: blank, or one of the business-analysis / project templates (§78). */
export function TemplatePicker({ title = 'New page', busy, onPick, onClose }: { title?: string; busy?: boolean; onPick: (template: string | null) => void; onClose: () => void }) {
  const [q, setQ] = useState('');
  const needle = q.trim().toLowerCase();
  const list = PROJECT_DOC_TEMPLATES.filter((t) => !t.hidden && (!needle || `${t.name} ${t.code} ${t.description}`.toLowerCase().includes(needle)));
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={title} description="Start blank or from a template — requirements, models, plans, checklists." width={760}>
      <label className="mb-3 flex h-9 items-center gap-2 rounded-lg bg-canvas px-3 text-[13px] ring-1 ring-line focus-within:ring-brand-500">
        <Search size={14} className="text-subtle" />
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search templates (FRS, BPMN, interview, risk…)" aria-label="Search templates" className="min-w-0 flex-1 bg-transparent outline-none" />
      </label>
      <div className="max-h-[60vh] space-y-4 overflow-y-auto pr-1">
        {!needle && (
          <button disabled={busy} onClick={() => onPick(null)} className="w-full rounded-lg px-3 py-2 text-left text-[13px] ring-1 ring-line hover:bg-hover" data-testid="blank-page">
            <b>Blank page</b>
          </button>
        )}
        {CATEGORIES.map((c) => {
          const items = list.filter((t) => t.category === c);
          if (!items.length) return null;
          return (
            <section key={c}>
              <p className="mb-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-subtle">{c}</p>
              <div className="grid grid-cols-2 gap-2">
                {items.map((t) => (
                  <button key={t.id} disabled={busy} onClick={() => onPick(t.id)} className="flex items-start gap-2.5 rounded-lg p-2.5 text-left ring-1 ring-line hover:bg-hover" data-testid="doc-template" data-id={t.id}>
                    <span className="grid h-8 min-w-10 place-items-center rounded-md bg-brand-50 px-1 text-[11px] font-bold text-brand-700">{t.code}</span>
                    <span className="min-w-0">
                      <span className="block text-[13px] font-semibold text-ink">{t.name}</span>
                      <span className="line-clamp-2 text-[12px] text-muted">{t.description}</span>
                    </span>
                  </button>
                ))}
              </div>
            </section>
          );
        })}
        {!list.length && <p className="py-6 text-center text-[13px] text-subtle">No template matches “{q}”</p>}
      </div>
    </Dialog>
  );
}
