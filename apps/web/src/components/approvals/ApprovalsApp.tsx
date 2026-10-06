'use client';

import type { ApprovalBox, ApprovalRequestSummary, ApprovalTemplate } from '@workos/shared';
import { CheckCircle2, Copy, FileStack, Inbox, LayoutGrid, ListChecks, Pencil, Plus, Search, Send } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { useApprovalCounts, useApprovalList, useApprovalTemplates } from '@/lib/approvals';
import { formatShort } from '@/lib/format';
import { useMounted } from '@/lib/use-mounted';
import { Avatar, AvatarStack, Button, cn, Dialog, EmptyState, Skeleton } from '../ui/primitives';
import { StatusPill, TemplateIcon } from './bits';
import { RequestDetail } from './RequestDetail';
import { SubmitForm } from './SubmitForm';
import { TemplateEditor } from './TemplateEditor';

type View = ApprovalBox | 'templates';
const BOXES: { id: ApprovalBox; label: string; icon: typeof Inbox }[] = [
  { id: 'pending', label: 'Pending', icon: Inbox },
  { id: 'processed', label: 'Processed', icon: CheckCircle2 },
  { id: 'submitted', label: 'Submitted', icon: Send },
  { id: 'cc', label: "CC'd to me", icon: Copy },
];
const STATUSES = [
  { id: '', label: 'All' },
  { id: 'pending', label: 'In review' },
  { id: 'approved', label: 'Approved' },
  { id: 'rejected', label: 'Rejected' },
  { id: 'withdrawn', label: 'Withdrawn' },
];

/** /approvals?box=&r=  ·  ?new=<template>[&from=<request>]  ·  ?view=templates  ·  ?edit=<template|new> (docs/ARCHITECTURE.md §74). */
export function ApprovalsApp() {
  const mounted = useMounted();
  const params = useSearchParams();
  const router = useRouter();
  const view = (params.get('view') ?? params.get('box') ?? 'pending') as View;
  const requestId = params.get('r');
  const newFor = params.get('new');
  const editing = params.get('edit');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [template, setTemplate] = useState('');
  const [gallery, setGallery] = useState(false);
  const { data: counts } = useApprovalCounts();
  const { data: templates } = useApprovalTemplates();
  const box: ApprovalBox = view === 'templates' ? 'pending' : view;
  const { data: list, isLoading } = useApprovalList(box, { template, status, q });

  const go = (p: Record<string, string | null>) => {
    const n = new URLSearchParams();
    for (const [k, v] of Object.entries(p)) if (v) n.set(k, v);
    router.push(`/approvals${n.size ? `?${n}` : ''}`);
  };
  const tpl = (id: string | null) => templates?.find((t) => t.id === id) ?? null;

  if (!mounted) return <div className="h-full bg-canvas" />;
  return (
    <div className="flex h-full flex-col bg-surface">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line px-5">
        <ListChecks size={20} className="text-brand-600" />
        <h1 className="text-[17px] font-semibold text-ink">Approvals</h1>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="primary" icon={<Plus size={16} />} onClick={() => setGallery(true)} data-testid="new-request">
            New request
          </Button>
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        <nav className="w-[220px] shrink-0 border-r border-line bg-canvas/60 p-3" aria-label="Approval boxes">
          {BOXES.map((b) => {
            const n = b.id === 'pending' ? counts?.pending : undefined;
            const active = view === b.id && !newFor && !editing;
            return (
              <button key={b.id} onClick={() => go({ box: b.id })} className={cn('flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-[13.5px]', active ? 'bg-selected font-semibold text-brand-700' : 'text-ink-2 hover:bg-hover')} data-testid={`box-${b.id}`}>
                <b.icon size={16} />
                <span className="flex-1 text-left">{b.label}</span>
                {!!n && <span className="rounded-full bg-red-500 px-1.5 text-[11px] font-semibold text-white" data-testid="pending-count">{n}</span>}
              </button>
            );
          })}
          <p className="mb-1 mt-5 px-3 text-[11px] font-semibold uppercase tracking-wide text-subtle">Manage</p>
          {counts?.manages && (
            <button onClick={() => go({ box: 'all' })} className={cn('flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-[13.5px]', view === 'all' && !newFor && !editing ? 'bg-selected font-semibold text-brand-700' : 'text-ink-2 hover:bg-hover')} data-testid="box-all">
              <FileStack size={16} /> All requests
            </button>
          )}
          <button onClick={() => go({ view: 'templates' })} className={cn('flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-[13.5px]', view === 'templates' && !newFor && !editing ? 'bg-selected font-semibold text-brand-700' : 'text-ink-2 hover:bg-hover')} data-testid="view-templates">
            <LayoutGrid size={16} /> Templates
          </button>
        </nav>

        <div className="min-w-0 flex-1">
          {newFor && tpl(newFor) ? (
            <SubmitForm template={tpl(newFor)!} from={params.get('from')} onBack={() => router.back()} onDone={(id) => go({ box: 'submitted', r: id })} />
          ) : editing ? (
            editing === 'new' || tpl(editing) ? (
              <TemplateEditor key={editing} template={editing === 'new' ? null : tpl(editing)} canDelete={!!counts?.admin} onClose={() => go({ view: 'templates' })} />
            ) : (
              <Skeleton className="m-6 h-40" />
            )
          ) : view === 'templates' ? (
            <TemplatesView templates={templates ?? []} admin={!!counts?.admin} onSubmit={(id) => go({ new: id })} onEdit={(id) => go({ edit: id })} />
          ) : (
            <div className="flex h-full min-h-0">
              <section className="flex w-[400px] shrink-0 flex-col border-r border-line">
                <div className="space-y-2 border-b border-line p-3">
                  <label className="flex h-9 items-center gap-2 rounded-lg bg-canvas px-3 text-[13px] ring-1 ring-line focus-within:ring-brand-500">
                    <Search size={14} className="text-subtle" />
                    <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search requests" className="min-w-0 flex-1 bg-transparent outline-none" aria-label="Search requests" data-testid="request-search" />
                  </label>
                  <div className="flex items-center gap-2">
                    <select value={status} onChange={(e) => setStatus(e.target.value)} className="h-8 rounded-lg border border-line-strong bg-surface px-2 text-[12.5px]" aria-label="Status">
                      {STATUSES.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                    <select value={template} onChange={(e) => setTemplate(e.target.value)} className="h-8 min-w-0 flex-1 rounded-lg border border-line-strong bg-surface px-2 text-[12.5px]" aria-label="Template">
                      <option value="">All types</option>
                      {templates?.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <ul className="min-h-0 flex-1 overflow-auto" data-testid="request-list">
                  {isLoading
                    ? [0, 1, 2].map((i) => <Skeleton key={i} className="m-3 h-16" />)
                    : list?.length
                      ? list.map((r) => <Row key={r.id} r={r} active={r.id === requestId} onOpen={() => go({ box: view, r: r.id })} />)
                      : <EmptyState icon={<Inbox size={26} />} title={view === 'pending' ? 'Nothing waiting for you' : 'No requests'}>{view === 'pending' ? 'Requests that need your approval show up here.' : ''}</EmptyState>}
                </ul>
              </section>
              <section className="min-w-0 flex-1">
                {requestId ? (
                  <RequestDetail key={requestId} id={requestId} onSubmitAgain={(r) => go({ new: r.template.id, from: r.id })} />
                ) : (
                  <EmptyState icon={<ListChecks size={26} />} title="Select a request">
                    Or start a new one with <b>New request</b>.
                  </EmptyState>
                )}
              </section>
            </div>
          )}
        </div>
      </div>
      <Dialog open={gallery} onOpenChange={setGallery} title="New request" description="Choose what you want approved." width={720}>
        <Gallery
          templates={(templates ?? []).filter((t) => t.enabled)}
          onPick={(id) => {
            setGallery(false);
            go({ new: id });
          }}
        />
      </Dialog>
    </div>
  );
}

function Row({ r, active, onOpen }: { r: ApprovalRequestSummary; active: boolean; onOpen: () => void }) {
  return (
    <li>
      <button onClick={onOpen} className={cn('flex w-full gap-3 border-b border-line px-4 py-3 text-left hover:bg-hover', active && 'bg-selected hover:bg-selected')} data-testid="request-row" data-serial={r.serial} data-mine={r.mine ? '1' : undefined}>
        <TemplateIcon icon={r.template.icon} color={r.template.color} size={34} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className={cn('min-w-0 flex-1 truncate text-[13.5px] text-ink', r.mine ? 'font-semibold' : 'font-medium')}>{r.template.name}</p>
            <span className="shrink-0 text-[11.5px] text-subtle">{formatShort(r.submittedAt)}</span>
          </div>
          <p className="flex items-center gap-1.5 text-[12.5px] text-ink-2">
            <Avatar user={r.submitter} size={16} /> {r.submitter.name} · <span className="text-subtle">{r.serial}</span>
          </p>
          {r.summary.length > 0 && <p className="mt-0.5 truncate text-[12px] text-muted">{r.summary.map((s) => `${s.label}: ${s.value}`).join(' · ')}</p>}
          <div className="mt-1.5 flex items-center gap-2">
            <StatusPill status={r.status} />
            {r.waitingOn.length > 0 && (
              <span className="flex items-center gap-1 text-[11.5px] text-muted">
                <AvatarStack users={r.waitingOn} size={16} max={3} /> waiting on {r.waitingOn.length === 1 ? r.waitingOn[0].name.split(' ')[0] : `${r.waitingOn.length} people`}
              </span>
            )}
          </div>
        </div>
      </button>
    </li>
  );
}

function byCategory(templates: ApprovalTemplate[]) {
  const m = new Map<string, ApprovalTemplate[]>();
  for (const t of templates) m.set(t.category, [...(m.get(t.category) ?? []), t]);
  return [...m];
}

function Gallery({ templates, onPick }: { templates: ApprovalTemplate[]; onPick: (id: string) => void }) {
  const groups = useMemo(() => byCategory(templates), [templates]);
  return (
    <div className="space-y-5" data-testid="template-gallery">
      {groups.map(([cat, list]) => (
        <div key={cat}>
          <p className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-subtle">{cat}</p>
          <div className="grid grid-cols-2 gap-2">
            {list.map((t) => (
              <button key={t.id} onClick={() => onPick(t.id)} className="flex items-start gap-3 rounded-xl p-3 text-left ring-1 ring-line hover:bg-hover" data-testid="gallery-template" data-name={t.name}>
                <TemplateIcon icon={t.icon} color={t.color} size={36} />
                <span className="min-w-0">
                  <span className="block text-[13.5px] font-semibold text-ink">{t.name}</span>
                  {t.description && <span className="line-clamp-2 text-[12px] text-muted">{t.description}</span>}
                </span>
              </button>
            ))}
          </div>
        </div>
      ))}
      {!templates.length && <p className="py-6 text-center text-[13px] text-muted">No approval types yet.</p>}
    </div>
  );
}

function TemplatesView({ templates, admin, onSubmit, onEdit }: { templates: ApprovalTemplate[]; admin: boolean; onSubmit: (id: string) => void; onEdit: (id: string) => void }) {
  const groups = byCategory(templates);
  return (
    <div className="h-full overflow-auto bg-canvas p-6" data-testid="templates-view">
      <div className="mx-auto max-w-[980px]">
        <div className="mb-5 flex items-center">
          <h2 className="text-[16px] font-semibold text-ink">Approval types</h2>
          {admin && (
            <Button className="ml-auto" icon={<Plus size={15} />} onClick={() => onEdit('new')} data-testid="new-template">
              New template
            </Button>
          )}
        </div>
        {groups.map(([cat, list]) => (
          <section key={cat} className="mb-6">
            <p className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-subtle">{cat}</p>
            <div className="grid gap-3 md:grid-cols-2">
              {list.map((t) => (
                <div key={t.id} className={cn('flex gap-3 rounded-xl bg-surface p-4 ring-1 ring-line', !t.enabled && 'opacity-60')} data-testid="template-card" data-name={t.name}>
                  <TemplateIcon icon={t.icon} color={t.color} size={40} />
                  <div className="min-w-0 flex-1">
                    <p className="text-[14px] font-semibold text-ink">
                      {t.name} {!t.enabled && <span className="ml-1 rounded bg-hover px-1.5 text-[11px] font-normal text-muted">Off</span>}
                    </p>
                    {t.description && <p className="mt-0.5 text-[12.5px] text-muted">{t.description}</p>}
                    <p className="mt-1.5 text-[12px] text-subtle">
                      {t.fields.length} fields · {t.steps.filter((s) => s.type === 'approve').length} approval step{t.steps.filter((s) => s.type === 'approve').length === 1 ? '' : 's'}
                    </p>
                    <div className="mt-3 flex gap-2">
                      {t.enabled && (
                        <Button size="sm" variant="primary" onClick={() => onSubmit(t.id)}>
                          Submit
                        </Button>
                      )}
                      {t.canManage && (
                        <Button size="sm" icon={<Pencil size={13} />} onClick={() => onEdit(t.id)} data-testid="edit-template">
                          Edit
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
