'use client';

import { useQueryClient } from '@tanstack/react-query';
import type { ResourceDetail } from '@workos/shared';
import { Copy, ExternalLink, Globe } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { Button, Dialog } from '../ui/primitives';

/**
 * File → Publish to web (Google Docs / Sheets / Slides): a public, read-only page that always shows the current
 * content, and an iframe to embed it. Anyone with the link can view it.
 */
export function PublishDialog({ r, open, canEdit, onClose }: { r: ResourceDetail; open: boolean; canEdit: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) setToken(((r.metadata as { publish?: { token: string } } | undefined)?.publish?.token as string | undefined) ?? null);
  }, [open, r.metadata]);
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const link = token ? `${origin}/pub/${token}` : '';
  const size = r.type === 'presentation' ? { w: 960, h: 569 } : { w: 800, h: 600 };
  const embed = token ? `<iframe src="${link}?embed=1" width="${size.w}" height="${size.h}" frameborder="0" allowfullscreen></iframe>` : '';
  const toggle = async (on: boolean) => {
    setBusy(true);
    try {
      const res = await api<{ token: string | null }>(`/resources/${r.id}/publish`, { method: 'POST', json: { on } });
      setToken(res.token);
      void qc.invalidateQueries({ queryKey: ['resources', 'one', r.id] });
      toast.success(on ? 'Published to the web' : 'No longer published');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${what} copied`);
    } catch {
      toast.error('The browser blocked clipboard access');
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => !v && onClose()}
      title="Publish to the web"
      description="Anyone with the link can view a read-only copy that always shows the latest version. Comments, history and unpublished drafts stay private."
      width={540}
      footer={
        token ? (
          <>
            <Button className="mr-auto text-red-600" variant="ghost" disabled={!canEdit || busy} onClick={() => void toggle(false)} data-testid="unpublish">
              Stop publishing
            </Button>
            <Button onClick={onClose}>Done</Button>
          </>
        ) : (
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" icon={<Globe size={14} />} disabled={!canEdit || busy} onClick={() => void toggle(true)} data-testid="publish">
              Publish
            </Button>
          </>
        )
      }
    >
      {token ? (
        <div className="space-y-3 text-[13px]" data-testid="publish-info">
          <label className="block">
            <span className="mb-1 block text-[12px] font-medium text-muted">Link</span>
            <div className="flex gap-1.5">
              <input readOnly value={link} className="input h-9 flex-1 font-mono text-[12px]" aria-label="Published link" onFocus={(e) => e.target.select()} />
              <Button icon={<Copy size={14} />} onClick={() => void copy(link, 'Link')}>
                Copy
              </Button>
              <a href={link} target="_blank" rel="noopener noreferrer" className="flex h-9 items-center rounded-lg border border-line px-2.5 text-muted hover:bg-hover" aria-label="Open published page">
                <ExternalLink size={15} />
              </a>
            </div>
          </label>
          <label className="block">
            <span className="mb-1 block text-[12px] font-medium text-muted">Embed</span>
            <textarea readOnly value={embed} rows={3} className="input w-full resize-none font-mono text-[12px]" aria-label="Embed code" onFocus={(e) => e.target.select()} />
            <Button size="sm" variant="soft" icon={<Copy size={13} />} className="mt-1.5" onClick={() => void copy(embed, 'Embed code')}>
              Copy embed code
            </Button>
          </label>
        </div>
      ) : (
        <p className="text-[13px] text-muted">{canEdit ? 'Not published yet.' : 'Only editors can publish.'}</p>
      )}
    </Dialog>
  );
}
