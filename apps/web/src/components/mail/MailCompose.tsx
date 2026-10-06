'use client';

import type { ChatAttachment, MailAddr, Mailbox } from '@workos/shared';
import { FolderOpen, Loader2, Maximize2, Minus, Paperclip, Send, Trash2, X } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { toast } from 'sonner';
import { create } from 'zustand';
import { addrFull, uploadMailAttachment, useMailActions, useMailAddresses, useMailboxes } from '@/lib/mail';
import { Button, cn, FileIcon } from '../ui/primitives';
import { ResourcePickerDialog } from '../chat/attachments';

export interface ComposeInit {
  mailboxId?: string;
  to?: MailAddr[];
  cc?: MailAddr[];
  bcc?: MailAddr[];
  subject?: string;
  text?: string;
  replyTo?: string | null;
  draftId?: string | null;
  attachments?: { id: string; name: string }[];
}

interface ComposeState {
  open: ComposeInit | null;
  key: number;
  compose: (init?: ComposeInit) => void;
  close: () => void;
}
/** One compose window at a time, opened from anywhere in Mail (new, reply, reply all, forward, open a draft). */
export const useCompose = create<ComposeState>((set) => ({
  open: null,
  key: 0,
  compose: (init = {}) => set((s) => ({ open: init, key: s.key + 1 })),
  close: () => set({ open: null }),
}));

const EMAIL = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;

/** Recipients as chips: type a name or address, pick a suggestion, Enter / comma / Tab to add. */
function AddressField({ label, value, onChange, autoFocus }: { label: string; value: MailAddr[]; onChange: (v: MailAddr[]) => void; autoFocus?: boolean }) {
  const [q, setQ] = useState('');
  const [pick, setPick] = useState(0);
  const { data: hits } = useMailAddresses(q);
  const shown = (hits ?? []).filter((h) => !value.some((v) => v.address === h.address)).slice(0, 6);
  const add = (a: MailAddr) => {
    if (!value.some((v) => v.address === a.address.toLowerCase())) onChange([...value, { address: a.address.toLowerCase(), name: a.name }]);
    setQ('');
    setPick(0);
  };
  const commit = () => {
    const t = q.trim().replace(/[,;]$/, '');
    if (!t) return false;
    if (shown[pick] && !EMAIL.test(t)) add(shown[pick]);
    else if (EMAIL.test(t)) add({ address: t, name: null });
    else {
      toast.error(`"${t}" is not an e-mail address`);
      return false;
    }
    return true;
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' && shown.length) return (e.preventDefault(), setPick((p) => (p + 1) % shown.length));
    if (e.key === 'ArrowUp' && shown.length) return (e.preventDefault(), setPick((p) => (p - 1 + shown.length) % shown.length));
    if ((e.key === 'Enter' || e.key === 'Tab' || e.key === ',' || e.key === ';') && q.trim()) {
      e.preventDefault();
      if (shown.length && !EMAIL.test(q.trim())) add(shown[pick]);
      else commit();
    } else if (e.key === 'Backspace' && !q && value.length) onChange(value.slice(0, -1));
  };
  return (
    <div className="relative flex min-h-10 flex-wrap items-center gap-1 border-b border-line px-3 py-1.5" data-testid={`compose-${label.toLowerCase()}`}>
      <span className="mr-1 text-[13px] text-muted">{label}</span>
      {value.map((a) => (
        <span key={a.address} className="inline-flex h-6 items-center gap-1 rounded-full bg-brand-50 px-2 text-[12px] text-brand-700" title={a.address} data-testid="address-chip">
          {a.name || a.address}
          <button onClick={() => onChange(value.filter((v) => v.address !== a.address))} className="rounded-full hover:bg-brand-100" aria-label={`Remove ${a.address}`}>
            <X size={11} />
          </button>
        </span>
      ))}
      <input
        value={q}
        autoFocus={autoFocus}
        onChange={(e) => (setQ(e.target.value), setPick(0))}
        onKeyDown={onKey}
        onBlur={() => q.trim() && EMAIL.test(q.trim()) && add({ address: q.trim(), name: null })}
        className="min-w-[120px] flex-1 bg-transparent py-0.5 text-[13px] outline-none"
        aria-label={label}
      />
      {!!shown.length && q.trim() && (
        <div className="pop absolute left-12 top-full z-30 mt-1 w-80 p-1" role="listbox" data-testid="address-suggestions">
          {shown.map((h, i) => (
            <button key={h.address} onMouseDown={(e) => (e.preventDefault(), add(h))} className={cn('flex w-full flex-col rounded-md px-2 py-1.5 text-left', i === pick && 'bg-hover')} role="option" aria-selected={i === pick}>
              <span className="text-[13px] text-ink">
                {h.name ?? h.address} {h.kind === 'space' && <span className="ml-1 rounded bg-violet-50 px-1 text-[10px] font-semibold text-violet-700">SHARED</span>}
                {h.kind === 'external' && <span className="ml-1 rounded bg-amber-50 px-1 text-[10px] font-semibold text-amber-700">EXTERNAL</span>}
              </span>
              <span className="text-[11.5px] text-muted">{h.address}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

type Att = { key: string; id?: string; name: string; status: 'uploading' | 'ready'; resourceId?: string; drive?: ChatAttachment };

/** The floating compose window (bottom right, as in Gmail). Drafts save themselves while you type. */
export function MailCompose() {
  const { open, key, close } = useCompose();
  if (!open) return null;
  return <ComposeWindow key={key} init={open} onClose={close} />;
}

function ComposeWindow({ init, onClose }: { init: ComposeInit; onClose: () => void }) {
  const { data: boxes } = useMailboxes();
  const writable = (boxes ?? []).filter((b) => b.perms.write);
  const [mailboxId, setMailboxId] = useState(init.mailboxId ?? writable[0]?.id ?? '');
  const [to, setTo] = useState<MailAddr[]>(init.to ?? []);
  const [cc, setCc] = useState<MailAddr[]>(init.cc ?? []);
  const [bcc, setBcc] = useState<MailAddr[]>(init.bcc ?? []);
  const [showCc, setShowCc] = useState(!!(init.cc?.length || init.bcc?.length));
  const [subject, setSubject] = useState(init.subject ?? '');
  const [text, setText] = useState(init.text ?? '');
  const [atts, setAtts] = useState<Att[]>((init.attachments ?? []).map((a) => ({ key: a.id, id: a.id, name: a.name, status: 'ready' })));
  const [min, setMin] = useState(false);
  const [big, setBig] = useState(false);
  const [picking, setPicking] = useState(false);
  const draftId = useRef<string | null>(init.draftId ?? null);
  const fileInput = useRef<HTMLInputElement>(null);
  const { send, saveDraft, deleteDraft } = useMailActions();
  const box: Mailbox | undefined = boxes?.find((b) => b.id === mailboxId);
  useEffect(() => {
    if (!mailboxId && writable[0]) setMailboxId(writable[0].id);
  }, [mailboxId, writable]);

  // Autosave: a draft appears in Drafts as soon as there is something to keep.
  const dirty = !!(to.length || cc.length || bcc.length || subject.trim() || text.trim());
  const payload = () => ({
    mailboxId,
    to,
    cc,
    bcc,
    subject,
    text,
    replyTo: init.replyTo ?? null,
    attachmentIds: atts.filter((a) => a.id).map((a) => a.id!),
  });
  useEffect(() => {
    if (!dirty || !mailboxId) return;
    const t = setTimeout(async () => {
      const r = await saveDraft.mutateAsync({ ...payload(), draftId: draftId.current }).catch(() => null);
      if (r) draftId.current = r.id;
    }, 1500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [to, cc, bcc, subject, text, atts, mailboxId]);

  const addFiles = (files: File[]) => {
    for (const f of files) {
      const k = Math.random().toString(36).slice(2);
      setAtts((cur) => [...cur, { key: k, name: f.name, status: 'uploading' }]);
      uploadMailAttachment(f).then(
        (r) => setAtts((cur) => cur.map((a) => (a.key === k ? { ...a, id: r.id, status: 'ready' } : a))),
        (e: Error) => (toast.error(e.message), setAtts((cur) => cur.filter((a) => a.key !== k))),
      );
    }
  };
  const uploading = atts.some((a) => a.status === 'uploading');
  const doSend = async () => {
    if (!to.length && !cc.length && !bcc.length) return toast.error('Add at least one recipient');
    const r = await send.mutateAsync({ ...payload(), resourceIds: atts.filter((a) => a.resourceId).map((a) => a.resourceId!), draftId: draftId.current });
    toast.success(r.external ? `Sent — ${r.external} outside address${r.external > 1 ? 'es' : ''} delivered by e-mail` : 'Sent');
    onClose();
  };
  const discard = async () => {
    if (draftId.current) await deleteDraft.mutateAsync(draftId.current).catch(() => undefined);
    onClose();
  };

  return (
    <div
      className={cn('fixed bottom-0 right-6 z-40 flex flex-col overflow-hidden rounded-t-xl border border-line bg-surface shadow-[var(--shadow-pop)]', big ? 'left-1/2 top-16 w-auto -translate-x-1/2 sm:w-[860px]' : 'w-[560px]', min ? 'h-11' : big ? '' : 'h-[560px]')}
      data-testid="mail-compose"
      onDragOver={(e) => e.dataTransfer.types.includes('Files') && e.preventDefault()}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        addFiles([...e.dataTransfer.files]);
      }}
    >
      <div className="flex h-11 shrink-0 items-center gap-2 bg-ink px-4 text-white">
        <span className="flex-1 truncate text-[13px] font-semibold">{subject.trim() || (init.replyTo ? 'Reply' : 'New message')}</span>
        {saveDraft.isPending && <span className="text-[11px] text-white/60">Saving…</span>}
        {!saveDraft.isPending && draftId.current && <span className="text-[11px] text-white/60" data-testid="draft-saved">Draft saved</span>}
        <button onClick={() => setMin(!min)} className="rounded p-1 hover:bg-white/10" aria-label="Minimise">
          <Minus size={15} />
        </button>
        <button onClick={() => setBig(!big)} className="rounded p-1 hover:bg-white/10" aria-label="Full size">
          <Maximize2 size={14} />
        </button>
        <button onClick={onClose} className="rounded p-1 hover:bg-white/10" aria-label="Close (keeps the draft)">
          <X size={15} />
        </button>
      </div>
      {!min && (
        <>
          <div className="flex items-center gap-2 border-b border-line px-3 py-2 text-[13px]">
            <span className="text-muted">From</span>
            <select value={mailboxId} onChange={(e) => setMailboxId(e.target.value)} className="flex-1 bg-transparent text-ink outline-none" aria-label="From">
              {writable.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} &lt;{b.address}&gt;
                </option>
              ))}
            </select>
            {!showCc && (
              <button onClick={() => setShowCc(true)} className="text-[12px] text-muted hover:text-ink">
                Cc / Bcc
              </button>
            )}
          </div>
          <AddressField label="To" value={to} onChange={setTo} autoFocus={!init.to?.length} />
          {showCc && <AddressField label="Cc" value={cc} onChange={setCc} />}
          {showCc && <AddressField label="Bcc" value={bcc} onChange={setBcc} />}
          <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject" aria-label="Subject" className="h-10 border-b border-line px-3 text-[14px] outline-none" />
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            autoFocus={!!init.to?.length}
            aria-label="Message"
            placeholder={box?.signature ? `\n\n--\n${box.signature}` : 'Write your message…'}
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault();
                void doSend();
              }
            }}
            className={cn('min-h-0 flex-1 resize-none px-3 py-2.5 text-[14px] leading-relaxed outline-none', big && 'min-h-[50vh]')}
            data-testid="compose-body"
          />
          {!!atts.length && (
            <div className="flex flex-wrap gap-2 border-t border-line px-3 py-2" data-testid="compose-attachments">
              {atts.map((a) => (
                <span key={a.key} className="flex max-w-[240px] items-center gap-2 rounded-lg border border-line bg-canvas py-1 pl-2 pr-1 text-[12.5px]" data-status={a.status}>
                  {a.status === 'uploading' ? <Loader2 size={14} className="animate-spin text-muted" /> : a.drive?.type ? <FileIcon r={{ type: a.drive.type, mimeType: a.drive.mimeType, metadata: a.drive.metadata ?? {} }} size={16} /> : <Paperclip size={14} className="text-muted" />}
                  <span className="min-w-0 flex-1 truncate">{a.name}</span>
                  <button onClick={() => setAtts((cur) => cur.filter((x) => x.key !== a.key))} className="rounded p-0.5 text-muted hover:bg-hover" aria-label={`Remove ${a.name}`}>
                    <X size={12} />
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="flex items-center gap-1 border-t border-line px-3 py-2">
            <Button variant="primary" icon={<Send size={15} />} onClick={doSend} loading={send.isPending} disabled={uploading || !mailboxId} data-testid="compose-send">
              Send
            </Button>
            <button onClick={() => fileInput.current?.click()} className="ml-1 inline-flex size-8 items-center justify-center rounded-lg text-muted hover:bg-hover hover:text-ink" aria-label="Attach files" title="Attach files">
              <Paperclip size={17} />
            </button>
            <button onClick={() => setPicking(true)} className="inline-flex size-8 items-center justify-center rounded-lg text-muted hover:bg-hover hover:text-ink" aria-label="Attach from Drive" title="Attach from Drive">
              <FolderOpen size={17} />
            </button>
            <input ref={fileInput} type="file" multiple hidden data-testid="compose-upload" onChange={(e) => (addFiles([...(e.target.files ?? [])]), (e.target.value = ''))} />
            <span className="flex-1 text-[11px] text-subtle">{to.some((t) => !box?.address.endsWith(t.address.split('@')[1] ?? '')) && to.length ? 'Outside addresses get it by e-mail' : ''}</span>
            <button onClick={discard} className="inline-flex size-8 items-center justify-center rounded-lg text-muted hover:bg-hover hover:text-red-600" aria-label="Discard draft" title="Discard draft">
              <Trash2 size={16} />
            </button>
          </div>
          <ResourcePickerDialog
            open={picking}
            onOpenChange={setPicking}
            onPick={(items) => setAtts((cur) => [...cur, ...items.filter((i) => !cur.some((c) => c.resourceId === i.id)).map((i) => ({ key: i.id, name: i.name ?? 'File', status: 'ready' as const, resourceId: i.id, drive: i }))])}
          />
        </>
      )}
    </div>
  );
}

export { addrFull };
