'use client';

import { useQuery } from '@tanstack/react-query';
import { Code2, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import type * as Y from 'yjs';
import { api } from '@/lib/api';
import { useResources } from '@/lib/queries';
import { Button, cn, Dialog } from '../../ui/primitives';
import { listMacros, saveMacro } from './store';

type Remote = { name: string; fn: string; code: string };

/** Extensions → Macros → Import macros: copy macros from another spreadsheet you can open. */
export function ImportMacrosDialog({ open, doc, currentId, me, onClose }: { open: boolean; doc: Y.Doc; currentId: string; me: string; onClose: () => void }) {
  const { data: sheets } = useResources({ type: 'spreadsheet', sort: 'updatedAt', order: 'desc' });
  const [from, setFrom] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const { data: remote, isLoading } = useQuery({ queryKey: ['macros-of', from], queryFn: () => api<Remote[]>(`/resources/${from}/macros`), enabled: open && !!from });
  const sources = (sheets ?? []).filter((s) => s.id !== currentId);

  const doImport = () => {
    const taken = new Set(listMacros(doc).map((m) => m.name));
    const chosen = (remote ?? []).filter((_, i) => picked.has(i));
    for (const m of chosen) {
      let name = m.name;
      for (let n = 2; taken.has(name); n++) name = `${m.name} (${n})`;
      taken.add(name);
      // Shortcuts are not copied: they would clash with this file's own.
      saveMacro(doc, { id: crypto.randomUUID(), name, fn: m.fn, code: m.code, shortcut: null, updatedBy: me, updatedAt: new Date().toISOString() });
    }
    toast.success(`Imported ${chosen.length} macro${chosen.length === 1 ? '' : 's'}`);
    setPicked(new Set());
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()} title="Import macros" description="Copy macros from another spreadsheet. Shortcuts are not copied." width={560}>
      <div className="flex h-72 gap-3" data-testid="import-macros">
        <ul className="w-56 shrink-0 overflow-y-auto rounded-lg border border-line p-1">
          {sources.map((s) => (
            <li key={s.id}>
              <button
                onClick={() => (setFrom(s.id), setPicked(new Set()))}
                className={cn('w-full truncate rounded-md px-2 py-1.5 text-left text-[13px]', from === s.id ? 'bg-brand-50 font-medium text-brand-700' : 'text-ink-2 hover:bg-hover')}
              >
                {s.name}
              </button>
            </li>
          ))}
        </ul>
        <div className="min-w-0 flex-1 overflow-y-auto rounded-lg border border-line p-2">
          {!from ? (
            <p className="p-2 text-[13px] text-muted">Choose a spreadsheet.</p>
          ) : isLoading ? (
            <Loader2 size={16} className="m-2 animate-spin text-muted" />
          ) : !remote?.length ? (
            <p className="p-2 text-[13px] text-muted">This spreadsheet has no macros.</p>
          ) : (
            remote.map((m, i) => (
              <label key={i} className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 hover:bg-hover">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={picked.has(i)}
                  onChange={(e) => {
                    const next = new Set(picked);
                    if (e.target.checked) next.add(i);
                    else next.delete(i);
                    setPicked(next);
                  }}
                  aria-label={m.name}
                />
                <Code2 size={14} className="mt-1 shrink-0 text-emerald-600" />
                <span className="min-w-0">
                  <span className="block truncate text-[13px] text-ink">{m.name}</span>
                  <span className="block truncate text-[11px] text-muted">
                    {m.fn}() · {m.code.split('\n').length} lines
                  </span>
                </span>
              </label>
            ))
          )}
        </div>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={!picked.size} onClick={doImport} data-testid="import-macros-confirm">
          Import {picked.size || ''}
        </Button>
      </div>
    </Dialog>
  );
}
