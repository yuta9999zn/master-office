'use client';

import { THEME_COLORS, type ItemType } from '@workos/form-model';
import type { ResourceDetail } from '@workos/shared';
import { can } from '@workos/shared';
import { AlertTriangle, Copy, Eye, FileText, GripHorizontal, History, Image as ImageIcon, Import, Link2, ListOrdered, Palette, PlusCircle, QrCode, Rows3, Send, Type, Video, X } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { Popover } from 'radix-ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { api, uploadFile } from '@/lib/api';
import { useMe, useResourceMembers } from '@/lib/queries';
import { ShareDialog } from '../drive/dialogs';
import { HistoryPanel } from '../docs/HistoryPanel';
import { useCollab } from '../docs/useCollab';
import { TitleBar } from '../editor/TitleBar';
import { Button, cn, Dialog, EmptyState, IconButton, Skeleton, Tip } from '../ui/primitives';
import { FormQrCode, ImportQuestionsDialog } from './FormDialogs';
import { FormStore, useForm } from './form-store';
import { QuestionCard } from './QuestionCard';
import { ResponsesTab, type FormResponseRow } from './ResponsesTab';
import { SettingsTab } from './SettingsTab';

const FONTS = ['Inter', 'Georgia', 'Verdana', 'Trebuchet MS', 'Courier New'];

export function FormsWorkspace({ r }: { r: ResourceDetail }) {
  const { data: me } = useMe();
  const { data: members } = useResourceMembers(r.id);
  const collab = useCollab(r.id, me && { id: me.user.id, name: me.user.name, color: me.user.avatarColor });
  const store = useMemo(() => (collab.session ? new FormStore(collab.session.doc) : null), [collab.session]);
  useEffect(() => () => store?.destroy(), [store]);
  const form = useForm(store);
  const editable = can(collab.session?.role ?? r.myRole, 'editor');
  const initialTab = useSearchParams().get('tab');
  const [tab, setTab] = useState<'questions' | 'responses' | 'settings'>(initialTab === 'responses' || initialTab === 'settings' ? initialTab : 'questions');
  const [importing, setImporting] = useState(false);
  const [selected, setSelected] = useState<string | null>('__header');
  const [share, setShare] = useState(false);
  const [send, setSend] = useState(false);
  const [history, setHistory] = useState(false);
  const [rows, setRows] = useState<FormResponseRow[]>([]);
  const [linking, setLinking] = useState(false);
  const [remote, setRemote] = useState<{ clientId: number; name: string; color: string; item: string | null }[]>([]);
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);
  const cardRefs = useRef(new Map<string, HTMLDivElement>());

  const loadResponses = useCallback(async () => {
    if (!editable) return;
    try {
      setRows(await api<FormResponseRow[]>(`/forms/${r.id}/responses`));
    } catch {
      /* not an editor */
    }
  }, [r.id, editable]);
  useEffect(() => void loadResponses(), [loadResponses]);
  useEffect(() => {
    const off = collab.onStateless((p) => p.type === 'responses' && void loadResponses());
    return () => void off();
  }, [collab, loadResponses]);

  // Presence: which item each person has selected.
  useEffect(() => collab.session?.provider.awareness?.setLocalStateField('form', { item: selected }), [collab.session, selected]);
  useEffect(() => {
    const aw = collab.session?.provider.awareness;
    if (!aw) return;
    const read = () => {
      const out: typeof remote = [];
      aw.getStates().forEach((st, clientId) => {
        if (clientId === aw.clientID) return;
        const u = st.user as { name: string; color: string } | undefined;
        if (u) out.push({ clientId, name: u.name, color: u.color, item: (st.form as { item: string | null } | undefined)?.item ?? null });
      });
      setRemote(out);
    };
    read();
    aw.on('change', read);
    return () => aw.off('change', read);
  }, [collab.session]);

  // Ctrl+Z / Ctrl+Y outside text fields.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (!store || !(e.ctrlKey || e.metaKey) || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)) return;
      if (e.key.toLowerCase() === 'z') (e.preventDefault(), e.shiftKey ? store.undo.redo() : store.undo.undo());
      else if (e.key.toLowerCase() === 'y') (e.preventDefault(), store.undo.redo());
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [store]);

  const uploadImage = async (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    try {
      return (await uploadFile<{ url: string }>(`/resources/${r.id}/assets`, fd)).url;
    } catch (e) {
      toast.error((e as Error).message);
      return null;
    }
  };

  const add = (type: ItemType) => {
    if (!store || !form) return;
    const after = selected && selected !== '__header' ? selected : form.items[form.items.length - 1]?.id ?? null;
    const id = store.addItem(type, after);
    setSelected(id);
    setTimeout(() => cardRefs.current.get(id)?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 50);
  };

  const respondUrl = typeof window !== 'undefined' ? `${window.location.origin}/f/${r.id}` : `/f/${r.id}`;
  const color = form?.theme.color ?? '#4F46E5';
  let sectionNo = 1;

  return (
    <div className="flex h-full flex-col" style={{ background: form?.theme.background ?? '#EEF2FF' }} data-testid="forms-workspace">
      <div className="bg-surface pb-1">
        <TitleBar
          r={r}
          kind="forms"
          members={members?.map((m) => m.principal)}
          online={collab.peers}
          status={collab.error ? 'offline' : collab.status}
          onShare={() => setShare(true)}
          actions={
            <>
              {form && editable && <ThemePicker form={form} store={store!} onUpload={uploadImage} />}
              <IconButton label="Preview" onClick={() => window.open(`/f/${r.id}`, '_blank')}>
                <Eye size={18} />
              </IconButton>
              <IconButton label="Version history" active={history} onClick={() => setHistory(!history)}>
                <History size={18} />
              </IconButton>
              <Button variant="primary" icon={<Send size={14} />} onClick={() => setSend(true)} data-testid="form-send">
                Send
              </Button>
            </>
          }
        />
        <div className="mt-1 flex justify-center gap-6">
          {(['questions', 'responses', 'settings'] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)} className={cn('border-b-[3px] px-2 pb-2 pt-1 text-[14px] capitalize', tab === t ? 'font-medium' : 'border-transparent text-slate-600 hover:text-slate-900')} style={tab === t ? { borderColor: color, color } : undefined} data-testid={`tab-${t}`}>
              {t}
              {t === 'responses' && rows.length > 0 && (
                <span className="ml-1.5 rounded-full px-1.5 text-[11px] text-white" style={{ background: color }}>
                  {rows.length}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="min-h-0 flex-1 overflow-y-auto">
          {collab.error ? (
            <EmptyState icon={<AlertTriangle size={30} />} title="Can’t open this form">
              {collab.error}
            </EmptyState>
          ) : !form?.ready || !store ? (
            <div className="mx-auto max-w-3xl space-y-3 p-6">
              <Skeleton className="h-36" />
              <Skeleton className="h-28" />
            </div>
          ) : tab === 'responses' ? (
            <div className="mx-auto max-w-3xl px-4 py-6">
              <ResponsesTab
                form={form}
                store={store}
                rows={rows}
                resourceId={r.id}
                editable={editable}
                onDelete={async (ids) => {
                  await api(`/forms/${r.id}/responses/delete`, { method: 'POST', json: { ids } });
                  void loadResponses();
                }}
                linking={linking}
                onChanged={() => void loadResponses()}
                onLinkSheet={async () => {
                  setLinking(true);
                  try {
                    await api(`/forms/${r.id}/sheet`, { method: 'POST' });
                    toast.success('Responses are now linked to a spreadsheet');
                  } catch (e) {
                    toast.error((e as Error).message);
                  } finally {
                    setLinking(false);
                  }
                }}
              />
            </div>
          ) : tab === 'settings' ? (
            <div className="mx-auto max-w-3xl px-4 py-6">
              <SettingsTab form={form} store={store} editable={editable} />
            </div>
          ) : (
            <div className="mx-auto flex max-w-3xl gap-3 px-4 py-6">
              <div className="min-w-0 flex-1 space-y-3">
                {/* Header card */}
                <div onClick={() => setSelected('__header')} className={cn('overflow-hidden rounded-lg border bg-white shadow-sm', selected === '__header' ? 'border-l-[6px] border-l-blue-500' : 'border-slate-200')}>
                  {form.theme.header && <img src={form.theme.header} alt="" className="h-36 w-full object-cover" />}
                  <div className="h-2.5" style={{ background: color }} />
                  <div className="px-6 py-5">
                    <input disabled={!editable} value={form.title} onChange={(e) => store.setMeta({ title: e.target.value })} className="w-full border-b border-transparent bg-transparent py-1 text-[32px] outline-none hover:border-slate-200 focus:border-b-2" style={{ fontFamily: form.theme.font }} aria-label="Form title" data-testid="form-title" />
                    <textarea disabled={!editable} value={form.description} onChange={(e) => store.setMeta({ description: e.target.value })} rows={1} placeholder="Form description" className="mt-1 w-full resize-none border-b border-transparent bg-transparent py-1 text-[14px] outline-none hover:border-slate-200 focus:border-b-2" aria-label="Form description" />
                  </div>
                </div>

                {form.items.map((it, i) => {
                  if (it.type === 'section') sectionNo++;
                  const others = remote.filter((p) => p.item === it.id);
                  return (
                    <div
                      key={it.id}
                      ref={(n) => {
                        if (n) cardRefs.current.set(it.id, n);
                      }}
                      onDragOver={(e) => {
                        if (!dragging) return;
                        e.preventDefault();
                        const rect = e.currentTarget.getBoundingClientRect();
                        setDropAt(e.clientY < rect.top + rect.height / 2 ? i : i + 1);
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        if (dragging && dropAt !== null) {
                          const from = form.items.findIndex((x) => x.id === dragging);
                          store.moveItem(dragging, dropAt > from ? dropAt - 1 : dropAt);
                        }
                        setDragging(null);
                        setDropAt(null);
                      }}
                      className="relative"
                    >
                      {dropAt === i && <div className="absolute -top-2 left-0 right-0 h-1 rounded" style={{ background: color }} />}
                      {dropAt === i + 1 && i === form.items.length - 1 && <div className="absolute -bottom-2 left-0 right-0 h-1 rounded" style={{ background: color }} />}
                      <QuestionCard
                        item={it}
                        form={form}
                        store={store}
                        index={i}
                        selected={selected === it.id}
                        onSelect={() => setSelected(it.id)}
                        color={color}
                        editable={editable}
                        sectionNumber={sectionNo}
                        remote={others}
                        onUploadImage={uploadImage}
                        dragHandle={
                          editable ? (
                            <div
                              draggable
                              onDragStart={(e) => {
                                setDragging(it.id);
                                e.dataTransfer.effectAllowed = 'move';
                              }}
                              onDragEnd={() => (setDragging(null), setDropAt(null))}
                              className="flex cursor-grab justify-center pt-1 text-slate-300 hover:text-slate-500"
                              aria-label="Drag to reorder"
                            >
                              <GripHorizontal size={16} />
                            </div>
                          ) : null
                        }
                      />
                    </div>
                  );
                })}
              </div>

              {/* Floating toolbar */}
              {editable && (
                <div className="sticky top-6 flex h-fit flex-col gap-1 rounded-lg border border-slate-200 bg-white p-1 shadow-sm" data-testid="form-toolbar">
                  {(
                    [
                      ['choice', <PlusCircle key="q" size={20} />, 'Add question'],
                      ['text', <Type key="t" size={20} />, 'Add title and description'],
                      ['image', <ImageIcon key="i" size={20} />, 'Add image'],
                      ['video', <Video key="v" size={20} />, 'Add video'],
                      ['section', <Rows3 key="s" size={20} />, 'Add section'],
                    ] as const
                  ).map(([t, icon, label]) => (
                    <Tip key={t} label={label} side="right">
                      <button onClick={() => add(t)} className="rounded-md p-2 text-slate-600 hover:bg-slate-100" aria-label={label}>
                        {icon}
                      </button>
                    </Tip>
                  ))}
                  <Tip label="Import questions" side="right">
                    <button onClick={() => setImporting(true)} className="rounded-md p-2 text-slate-600 hover:bg-slate-100" aria-label="Import questions" data-testid="import-questions">
                      <Import size={20} />
                    </button>
                  </Tip>
                </div>
              )}
            </div>
          )}
        </div>
        {history && (
          <aside className="flex w-[320px] shrink-0 flex-col border-l border-line bg-surface">
            <div className="flex items-center border-b border-line px-4">
              <span className="tab" aria-current="page">
                History
              </span>
              <button onClick={() => setHistory(false)} className="ml-auto rounded p-1 text-muted hover:bg-hover" aria-label="Close panel">
                <X size={15} />
              </button>
            </div>
            <div className="min-h-0 flex-1">
              <HistoryPanel resourceId={r.id} canEdit={editable} previewing={null} onPreview={() => toast('Restore a version to see it — the current form is kept as a version first.')} />
            </div>
          </aside>
        )}
      </div>

      <ShareDialog resource={share ? r : null} onClose={() => setShare(false)} />
      <ImportQuestionsDialog
        open={importing}
        formId={r.id}
        onClose={() => setImporting(false)}
        onImport={(src) => {
          if (!store || !form) return;
          const after = selected && selected !== '__header' ? selected : form.items[form.items.length - 1]?.id ?? null;
          const ids = store.importItems(src, after);
          toast.success(`Imported ${ids.length} item${ids.length === 1 ? '' : 's'}`);
          if (ids.length) {
            setSelected(ids[ids.length - 1]);
            setTimeout(() => cardRefs.current.get(ids[0])?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 50);
          }
        }}
      />
      <Dialog open={send} onOpenChange={setSend} title="Send form" description={form?.settings.access === 'public' ? 'Anyone with the link can respond' : 'People in your workspace with the link can respond'} width={540}>
        <div className="space-y-4">
          <div>
            <div className="mb-1.5 flex items-center gap-1.5 text-[13px] font-medium text-ink">
              <Link2 size={14} /> Link
            </div>
            <div className="flex gap-2">
              <input readOnly value={respondUrl} className="input h-9 flex-1 text-[13px]" aria-label="Responder link" data-testid="respond-link" onFocus={(e) => e.target.select()} />
              <Button size="sm" variant="primary" icon={<Copy size={13} />} onClick={() => void navigator.clipboard.writeText(respondUrl).then(() => toast.success('Link copied'))}>
                Copy
              </Button>
            </div>
          </div>
          <div>
            <div className="mb-1.5 flex items-center gap-1.5 text-[13px] font-medium text-ink">
              <FileText size={14} /> Embed HTML
            </div>
            <textarea readOnly rows={2} value={`<iframe src="${respondUrl}" width="640" height="800" frameborder="0">Loading…</iframe>`} className="input resize-none py-2 font-mono text-[12px]" onFocus={(e) => e.target.select()} aria-label="Embed HTML" />
          </div>
          <div>
            <div className="mb-1.5 flex items-center gap-1.5 text-[13px] font-medium text-ink">
              <QrCode size={14} /> QR code
            </div>
            <FormQrCode url={respondUrl} title={form?.title ?? r.name} color={color} />
          </div>
          <p className="text-[12px] text-muted">
            <ListOrdered size={12} className="mr-1 inline" />
            Pre-filled link: add <code>?entry.&lt;question id&gt;=value</code> to the link.
          </p>
        </div>
      </Dialog>
    </div>
  );
}

function ThemePicker({ form, store, onUpload }: { form: NonNullable<ReturnType<typeof useForm>>; store: FormStore; onUpload: (f: File) => Promise<string | null> }) {
  const tint = (hex: string) => {
    const n = parseInt(hex.slice(1), 16);
    const mix = (c: number) => Math.round(c + (255 - c) * 0.88);
    return `#${[(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => mix(c).toString(16).padStart(2, '0')).join('')}`;
  };
  return (
    <Popover.Root>
      <Tip label="Customize theme">
        <Popover.Trigger asChild>
          <button className="flex size-9 items-center justify-center rounded-lg text-ink-2 hover:bg-hover" aria-label="Customize theme">
            <Palette size={18} />
          </button>
        </Popover.Trigger>
      </Tip>
      <Popover.Portal>
        <Popover.Content sideOffset={6} align="end" className="pop z-50 w-72 animate-pop space-y-4 p-4">
          <div>
            <div className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-subtle">Colour</div>
            <div className="grid grid-cols-6 gap-2">
              {THEME_COLORS.map((c) => (
                <button key={c} onClick={() => store.setTheme({ color: c, background: tint(c) })} className={cn('size-8 rounded-full border-2', form.theme.color === c ? 'border-slate-900' : 'border-transparent')} style={{ background: c }} aria-label={c} />
              ))}
            </div>
          </div>
          <div>
            <div className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-subtle">Font</div>
            <select value={form.theme.font} onChange={(e) => store.setTheme({ font: e.target.value })} className="input h-9 text-[13px]" aria-label="Font">
              {FONTS.map((f) => (
                <option key={f}>{f}</option>
              ))}
            </select>
          </div>
          <div>
            <div className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-subtle">Header image</div>
            <div className="flex gap-2">
              <label className="flex h-8 cursor-pointer items-center rounded-md border border-line px-3 text-[13px] hover:bg-hover">
                Choose image
                <input
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    e.target.value = '';
                    const url = f ? await onUpload(f) : null;
                    if (url) store.setTheme({ header: url });
                  }}
                />
              </label>
              {form.theme.header && (
                <button onClick={() => store.setTheme({ header: null })} className="h-8 rounded-md px-2 text-[13px] text-muted hover:bg-hover">
                  Remove
                </button>
              )}
            </div>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
