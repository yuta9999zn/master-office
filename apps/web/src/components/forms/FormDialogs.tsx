'use client';

import { TYPE_LABEL, type FormItem } from '@workos/form-model';
import { ChevronLeft, Download } from 'lucide-react';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useResources, useSearch } from '@/lib/queries';
import { Button, Dialog } from '../ui/primitives';
import { TYPE_ICON } from './QuestionCard';

/**
 * Import questions (Google Forms' toolbar button, §61): pick another form you can open, tick its questions and
 * they are copied after the selected item — with fresh ids, answer keys and validation included.
 */
export function ImportQuestionsDialog({ open, formId, onClose, onImport }: { open: boolean; formId: string; onClose: () => void; onImport: (items: FormItem[]) => void }) {
  const [q, setQ] = useState('');
  const [source, setSource] = useState<{ id: string; title: string; items: FormItem[] } | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState<string | null>(null);
  const { data: hits } = useSearch(q);
  const { data: recent } = useResources(open ? { type: 'form' } : null);
  const forms = (q.trim() ? (hits ?? []).filter((h) => h.kind === 'resource' && h.type === 'form').map((h) => ({ id: h.id, name: h.title })) : (recent ?? []).map((r) => ({ id: r.id, name: r.name }))).filter((x) => x.id !== formId).slice(0, 12);

  useEffect(() => {
    if (!open) (setSource(null), setPicked(new Set()), setQ(''));
  }, [open]);

  const choose = async (id: string) => {
    setLoading(id);
    try {
      const def = await api<{ title: string; items: FormItem[] }>(`/forms/${id}/definition`);
      setSource({ id, ...def });
      setPicked(new Set(def.items.filter((i) => i.type !== 'section').map((i) => i.id)));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(null);
    }
  };
  // Copy before changing: React may call the updater twice, so it must not mutate the current set.
  const toggle = (id: string) =>
    setPicked((p) => {
      const next = new Set(p);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const chosen = source?.items.filter((i) => picked.has(i.id)) ?? [];

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => !v && onClose()}
      title={source ? `Import from "${source.title}"` : 'Import questions'}
      description={source ? 'Tick the items to copy into this form.' : 'Choose the form to import questions from.'}
      width={540}
      footer={
        source && (
          <>
            <Button variant="ghost" icon={<ChevronLeft size={14} />} onClick={() => setSource(null)}>
              Other form
            </Button>
            <Button variant="primary" disabled={!chosen.length} onClick={() => (onImport(chosen), onClose())} data-testid="import-confirm">
              Import {chosen.length} item{chosen.length === 1 ? '' : 's'}
            </Button>
          </>
        )
      }
    >
      {!source ? (
        <>
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search forms…" className="input h-9 w-full" aria-label="Search forms" />
          <div className="mt-2 max-h-72 overflow-y-auto rounded-lg border border-line" data-testid="import-form-list">
            {forms.length ? (
              forms.map((x) => (
                <button key={x.id} disabled={!!loading} onClick={() => void choose(x.id)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] hover:bg-hover disabled:opacity-50">
                  <span className="min-w-0 flex-1 truncate">{x.name}</span>
                  {loading === x.id && <span className="text-[12px] text-muted">Loading…</span>}
                </button>
              ))
            ) : (
              <p className="px-3 py-4 text-[13px] text-muted">No other forms found.</p>
            )}
          </div>
        </>
      ) : (
        <div className="max-h-80 overflow-y-auto rounded-lg border border-line" data-testid="import-items">
          <label className="flex items-center gap-2 border-b border-line px-3 py-2 text-[13px] font-medium">
            <input type="checkbox" checked={chosen.length === source.items.length} onChange={(e) => setPicked(new Set(e.target.checked ? source.items.map((i) => i.id) : []))} />
            Select all
          </label>
          {source.items.map((it) => (
            <label key={it.id} className="flex items-center gap-2 px-3 py-2 text-[13px] hover:bg-hover">
              <input type="checkbox" checked={picked.has(it.id)} onChange={() => toggle(it.id)} aria-label={it.title || TYPE_LABEL[it.type]} />
              <span className="text-slate-500">{TYPE_ICON[it.type]}</span>
              <span className="min-w-0 flex-1 truncate">{it.title || <span className="text-muted">{TYPE_LABEL[it.type]}</span>}</span>
              <span className="text-[12px] text-muted">{TYPE_LABEL[it.type]}</span>
            </label>
          ))}
        </div>
      )}
    </Dialog>
  );
}

/** QR code of the responder link (Send → QR), drawn as SVG; downloads as PNG for posters and slides. */
export function FormQrCode({ url, title, color }: { url: string; title: string; color: string }) {
  const [svg, setSvg] = useState('');
  useEffect(() => {
    void QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#0F172A', light: '#FFFFFF' } }).then(setSvg);
  }, [url]);
  const download = async () => {
    const png = await QRCode.toDataURL(url, { width: 1024, margin: 2, errorCorrectionLevel: 'M' });
    const a = document.createElement('a');
    a.href = png;
    a.download = `${title || 'Form'} QR.png`;
    a.click();
  };
  return (
    <div className="flex items-center gap-4">
      <div className="size-40 shrink-0 rounded-lg border border-line bg-white p-2" style={{ borderColor: `${color}55` }} dangerouslySetInnerHTML={{ __html: svg }} data-testid="form-qr" aria-label="QR code of the responder link" role="img" />
      <div className="space-y-2 text-[13px] text-muted">
        <p>Scan to open the form on a phone. Print it on posters, handouts or a slide.</p>
        <Button size="sm" variant="soft" icon={<Download size={13} />} onClick={() => void download()} data-testid="qr-download">
          Download PNG
        </Button>
      </div>
    </div>
  );
}
