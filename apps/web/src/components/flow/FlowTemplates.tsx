'use client';

import { FLOW_TEMPLATES } from '@workos/flow-model';
import { Loader2 } from 'lucide-react';
import { FlowStatic } from './FlowStatic';

/** New flow: blank or from a template, each shown as a small picture of itself. */
export function FlowTemplates({ onPick, busy }: { onPick: (template: string, name: string) => void; busy: string | null }) {
  return (
    <div className="mt-6 flex flex-wrap gap-4" data-testid="flow-templates">
      {FLOW_TEMPLATES.map((t) => {
        const f = t.make();
        return (
          <button key={t.id} onClick={() => onPick(t.id, t.id === 'blank' ? 'Untitled flow' : t.name)} className="card flex w-56 flex-col overflow-hidden text-left transition hover:-translate-y-px hover:shadow-[var(--shadow-pop)]" data-testid="flow-template" data-template={t.id}>
            <div className="relative grid h-36 place-items-center bg-canvas p-2">
              <FlowStatic flow={f} page={f.pages[0].id} pad={20} className="h-full w-full" />
              {busy === t.id && <Loader2 size={20} className="absolute animate-spin text-brand-600" />}
            </div>
            <div className="p-3">
              <p className="text-[13px] font-medium text-ink">{t.name}</p>
              <p className="text-[11.5px] text-muted">{t.description}</p>
            </div>
          </button>
        );
      })}
    </div>
  );
}
