'use client';

import { BookOpen, Copy, Cpu, CreditCard, FileText, Image as ImageIcon, Plus, Presentation, RotateCcw, Save, Settings2, Sheet, Sparkles, Trash2, Workflow } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useAdminRole } from '@/lib/admin';
import { APP_LABEL, OUTPUT_LABEL, useAiActions, useAiPrompts, useAiSettings, useAiStatus, useAiUi, type AiPrompt, type AiSettings, type PromptApp, type PromptOutput } from '@/lib/ai';
import { formatBytes, timeAgo } from '@/lib/format';
import { Button, cn, EmptyState, Skeleton } from '../ui/primitives';

const TABS = [
  { id: 'home', label: 'Overview', icon: Sparkles },
  { id: 'prompts', label: 'Prompt library', icon: BookOpen },
  { id: 'settings', label: 'Model & settings', icon: Settings2 },
] as const;
type Tab = (typeof TABS)[number]['id'];
const field = 'w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-[13px] text-ink outline-none focus:border-brand-500 disabled:bg-canvas';

/** /ai — the assistant's home: what it can do, the prompt library, the model server (§80). */
export function AiHome() {
  const params = useSearchParams();
  const router = useRouter();
  const tab = (TABS.some((t) => t.id === params.get('tab')) ? params.get('tab') : 'home') as Tab;
  return (
    <div className="flex h-full min-h-0" data-testid="ai-home">
      <aside className="w-56 shrink-0 border-r border-line bg-surface p-3">
        <p className="px-2 pb-2 text-[11.5px] font-semibold uppercase tracking-wide text-subtle">AI</p>
        <nav className="space-y-0.5">
          {TABS.map((t) => (
            <button key={t.id} onClick={() => router.replace(`/ai?tab=${t.id}`)} className={cn('flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px]', tab === t.id ? 'bg-selected font-medium text-brand-700' : 'text-ink-2 hover:bg-hover')} data-testid={`ai-tab-${t.id}`}>
              <t.icon size={16} />
              {t.label}
            </button>
          ))}
        </nav>
      </aside>
      <div className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[1100px] p-6">
          {tab === 'home' && <Overview />}
          {tab === 'prompts' && <Library />}
          {tab === 'settings' && <Settings />}
        </div>
      </div>
    </div>
  );
}

function Overview() {
  const { data: status } = useAiStatus();
  const open = useAiUi((s) => s.setOpen);
  const cards: { key: string; label: string; note: string; icon: typeof Sparkles }[] = [
    { key: 'flow.generate', label: 'Workflow', note: 'Describe a process; get a diagram with decisions, roles and automation steps.', icon: Workflow },
    { key: 'sheet.generate', label: 'Workbook', note: 'Describe a register or tracker; get sheets with lookups, totals and a report.', icon: Sheet },
    { key: 'slides.deck', label: 'Presentation', note: 'An outline on slides with speaker notes.', icon: Presentation },
    { key: 'slides.banner', label: 'Banner', note: 'Web, social, story or poster — like a Canva template.', icon: ImageIcon },
    { key: 'slides.businessCard', label: 'Business card', note: 'Front and back, print-safe.', icon: CreditCard },
    { key: 'docs.draft', label: 'Writing', note: 'In Docs: write, summarize, improve the selection.', icon: FileText },
  ];
  return (
    <section>
      <h1 className="text-[22px] font-semibold text-ink">AI Assistant</h1>
      <p className="mt-1 max-w-2xl text-[13px] text-muted">One assistant for every app. Open it from the top bar (or Ctrl+J): inside a file it works on that file, elsewhere it creates new files. It runs on the organisation’s own model server.</p>
      <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-line bg-surface p-4" data-testid="ai-server">
        <Cpu size={18} className={status?.reachable ? 'text-emerald-600' : 'text-red-600'} />
        <div className="min-w-0 flex-1 text-[13px]">
          {status ? (
            status.reachable ? (
              <>
                <b className="text-ink">{status.model}</b> on {status.url} · {status.models.length} model{status.models.length === 1 ? '' : 's'} available
              </>
            ) : (
              <span className="text-red-700">{status.error}</span>
            )
          ) : (
            'Checking the model server…'
          )}
        </div>
      </div>
      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((c) => (
          <button key={c.key} onClick={() => open(true, { promptKey: c.key })} className="card flex items-start gap-3 p-4 text-left hover:ring-brand-300" data-testid="ai-start">
            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-indigo-50 to-violet-100 text-indigo-600">
              <c.icon size={18} />
            </span>
            <span>
              <span className="block text-[14px] font-semibold text-ink">{c.label}</span>
              <span className="block text-[12.5px] text-muted">{c.note}</span>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

// ── Prompt library ──────────────────────────────────────────────────────────

const APPS: PromptApp[] = ['flow', 'sheets', 'slides', 'docs', 'general'];
const OUTPUTS: PromptOutput[] = ['flow', 'sheet', 'deck', 'template', 'design', 'markdown', 'text'];
type Draft = Omit<AiPrompt, 'builtIn' | 'overridden' | 'canEdit' | 'updatedAt' | 'partOf'>;

function Library() {
  const { data: prompts, isLoading } = useAiPrompts();
  const a = useAiActions();
  const open = useAiUi((s) => s.setOpen);
  const [sel, setSel] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [filter, setFilter] = useState<PromptApp | 'all'>('all');
  // A new (or duplicated) prompt being written: nothing is selected, and nothing must get selected under it.
  const [creating, setCreatingState] = useState(false);
  const creatingRef = useRef(false);
  const setCreating = (v: boolean) => ((creatingRef.current = v), setCreatingState(v));
  const current = prompts?.find((p) => p.key === sel) ?? null;
  useEffect(() => {
    // Functional update: a click that lands between paint and this effect must win.
    if (!sel && !creatingRef.current && prompts?.length) setSel((cur) => cur ?? (creatingRef.current ? null : prompts[0].key));
  }, [prompts, sel]);
  useEffect(() => {
    if (current) setDraft({ key: current.key, name: current.name, app: current.app, output: current.output, description: current.description, system: current.system, template: current.template, temperature: current.temperature, variables: current.variables });
  }, [current]);
  const list = useMemo(() => (prompts ?? []).filter((p) => filter === 'all' || p.app === filter), [prompts, filter]);
  if (isLoading || !prompts) return <Skeleton className="h-96" />;
  const dirty = !!(draft && current && JSON.stringify({ ...draft }) !== JSON.stringify({ key: current.key, name: current.name, app: current.app, output: current.output, description: current.description, system: current.system, template: current.template, temperature: current.temperature, variables: current.variables }));
  const isNew = creating && !!draft && !draft.key;
  const editable = isNew || !!current?.canEdit;

  const save = () =>
    draft &&
    a.savePrompt.mutate({ ...draft, key: draft.key || null }, { onSuccess: (p) => (toast.success(isNew ? 'Prompt created' : current?.builtIn ? 'Saved for this organisation' : 'Saved'), setCreating(false), setSel(p.key)) });

  return (
    <section data-testid="ai-library">
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-[22px] font-semibold text-ink">Prompt library</h1>
          <p className="mt-1 max-w-3xl text-[13px] text-muted">
            Every AI feature runs one of these prompts. Built-in ones are written for small local models; administrators can tune them for the organisation (and reset them), and anyone can add their own. Variables in double braces — {'{{request}}'}, {'{{language}}'}, {'{{context}}'}, {'{{selection}}'} — are filled in when a prompt runs.
          </p>
        </div>
        <Button
          variant="primary"
          icon={<Plus size={15} />}
          onClick={() => (setCreating(true), setSel(null), setDraft({ key: '', name: 'My prompt', app: 'general', output: 'text', description: '', system: 'You are a helpful assistant. Answer in {{language}}.', template: '{{request}}', temperature: 0.4, variables: [{ name: 'request', label: 'What to make', example: '' }] }))}
          data-testid="prompt-new"
        >
          New prompt
        </Button>
      </div>
      <div className="flex gap-4">
        <div className="w-72 shrink-0">
          <select value={filter} onChange={(e) => setFilter(e.target.value as PromptApp | 'all')} className={cn(field, 'mb-2 h-9 py-0')} aria-label="Filter by app">
            <option value="all">All apps</option>
            {APPS.map((x) => (
              <option key={x} value={x}>
                {APP_LABEL[x]}
              </option>
            ))}
          </select>
          <ul className="card divide-y divide-line" data-testid="prompt-list">
            {list.map((p) => (
              <li key={p.key}>
                <button onClick={() => (setCreating(false), setSel(p.key))} className={cn('w-full px-3 py-2 text-left', sel === p.key ? 'bg-selected' : 'hover:bg-hover', p.partOf && 'pl-6')} data-testid="prompt-row" data-key={p.key}>
                  <div className="flex items-center gap-1.5 text-[13px] font-medium text-ink">
                    <span className="truncate">{p.name}</span>
                    {p.overridden && <span className="rounded bg-amber-50 px-1 text-[10px] font-medium text-amber-700">edited</span>}
                    {!p.builtIn && <span className="rounded bg-violet-50 px-1 text-[10px] font-medium text-violet-700">custom</span>}
                  </div>
                  <div className="truncate text-[11px] text-muted">
                    {APP_LABEL[p.app]} · {OUTPUT_LABEL[p.output]} · <code>{p.key}</code>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </div>
        <div className="min-w-0 flex-1">
          {!draft ? (
            <EmptyState icon={<BookOpen size={28} />} title="Pick a prompt" />
          ) : (
            <div className="card space-y-3 p-4" data-testid="prompt-editor">
              {current?.partOf && <p className="rounded-md bg-canvas px-3 py-2 text-[12px] text-muted">A step of “{prompts.find((p) => p.key === current.partOf)?.name}”: it runs as part of that prompt.</p>}
              <div className="grid gap-3 sm:grid-cols-[1fr_140px_150px_90px]">
                <Labeled label="Name">
                  <input disabled={!editable} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className={field} aria-label="Prompt name" />
                </Labeled>
                <Labeled label="App">
                  <select disabled={!editable || current?.builtIn} value={draft.app} onChange={(e) => setDraft({ ...draft, app: e.target.value as PromptApp })} className={field} aria-label="Prompt app">
                    {APPS.map((x) => (
                      <option key={x} value={x}>
                        {APP_LABEL[x]}
                      </option>
                    ))}
                  </select>
                </Labeled>
                <Labeled label="Result">
                  <select disabled={!editable || current?.builtIn} value={draft.output} onChange={(e) => setDraft({ ...draft, output: e.target.value as PromptOutput })} className={field} aria-label="Prompt result">
                    {OUTPUTS.map((x) => (
                      <option key={x} value={x}>
                        {OUTPUT_LABEL[x]}
                      </option>
                    ))}
                  </select>
                </Labeled>
                <Labeled label="Creativity">
                  <input disabled={!editable} type="number" min={0} max={2} step={0.1} value={draft.temperature} onChange={(e) => setDraft({ ...draft, temperature: Number(e.target.value) })} className={field} aria-label="Temperature" />
                </Labeled>
              </div>
              <Labeled label="Description">
                <input disabled={!editable} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} className={field} aria-label="Prompt description" />
              </Labeled>
              <Labeled label="System prompt — the rules">
                <textarea disabled={!editable} value={draft.system} onChange={(e) => setDraft({ ...draft, system: e.target.value })} rows={14} className={cn(field, 'font-mono text-[12px] leading-relaxed')} aria-label="System prompt" data-testid="prompt-system" />
              </Labeled>
              <Labeled label="Message template — what is sent each time">
                <textarea disabled={!editable} value={draft.template} onChange={(e) => setDraft({ ...draft, template: e.target.value })} rows={3} className={cn(field, 'font-mono text-[12px]')} aria-label="Message template" />
              </Labeled>
              {draft.variables.length > 0 && (
                <div className="text-[12px] text-muted">
                  Variables: {draft.variables.map((v) => <code key={v.name} className="mr-1.5 rounded bg-canvas px-1">{`{{${v.name}}}`}</code>)}
                  {draft.variables.find((v) => v.example)?.example && <div className="mt-1">Example request: “{draft.variables.find((v) => v.example)!.example}”</div>}
                </div>
              )}
              <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
                {editable && (
                  <Button variant="primary" icon={<Save size={14} />} disabled={!dirty && !isNew} loading={a.savePrompt.isPending} onClick={save} data-testid="prompt-save">
                    {isNew ? 'Create' : 'Save'}
                  </Button>
                )}
                {current && !current.partOf && (
                  <Button variant="secondary" icon={<Sparkles size={14} />} onClick={() => open(true, { promptKey: current.key })}>
                    Try it
                  </Button>
                )}
                {current && (
                  <Button variant="ghost" icon={<Copy size={14} />} onClick={() => (setCreating(true), setSel(null), setDraft({ ...draft, key: '', name: `${draft.name} (copy)` }))} data-testid="prompt-duplicate">
                    Duplicate
                  </Button>
                )}
                {current?.overridden && current.canEdit && (
                  <Button variant="ghost" icon={<RotateCcw size={14} />} onClick={() => a.deletePrompt.mutate(current.key, { onSuccess: () => toast.success('Back to the built-in version') })} data-testid="prompt-reset">
                    Reset to built-in
                  </Button>
                )}
                {current && !current.builtIn && current.canEdit && (
                  <Button variant="ghost" icon={<Trash2 size={14} />} onClick={() => a.deletePrompt.mutate(current.key, { onSuccess: () => (setCreating(false), setSel(null), setDraft(null), toast.success('Deleted')) })} data-testid="prompt-delete">
                    Delete
                  </Button>
                )}
                {current?.updatedAt && <span className="ml-auto text-[11.5px] text-muted">Changed {timeAgo(current.updatedAt)}</span>}
                {!editable && <span className="ml-auto text-[11.5px] text-muted">Only administrators change built-in prompts — duplicate it to make your own.</span>}
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[12px] font-medium text-ink-2">{label}</span>
      {children}
    </label>
  );
}

// ── Settings ────────────────────────────────────────────────────────────────

function Settings() {
  const { data: me } = useAdminRole();
  const admin = me?.role === 'owner' || me?.role === 'admin';
  const { data: status, refetch } = useAiStatus();
  const { data: settings } = useAiSettings(admin);
  const a = useAiActions();
  const [draft, setDraft] = useState<AiSettings | null>(null);
  useEffect(() => setDraft(settings ?? null), [settings]);
  return (
    <section data-testid="ai-settings">
      <h1 className="text-[22px] font-semibold text-ink">Model & settings</h1>
      <p className="mt-1 max-w-3xl text-[13px] text-muted">
        Master Office talks to an <b>Ollama</b> server (local or on your network). On a laptop without a graphics card a 3 B model writes about 10 tokens a second and a 7 B model about 5: a workflow takes ~30 s, a workbook 2–4 minutes. A machine with a GPU is 10–30× faster.
      </p>
      <div className="mt-4 card overflow-hidden">
        <table className="w-full text-[13px]" data-testid="ai-models">
          <thead className="bg-canvas text-left text-[12px] text-muted">
            <tr>
              <th className="px-4 py-2 font-medium">Model on {status?.url}</th>
              <th className="px-4 py-2 font-medium">Size</th>
              <th className="px-4 py-2 font-medium">Parameters</th>
              <th className="px-4 py-2 font-medium">Kind</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {!status && (
              <tr>
                <td colSpan={4} className="px-4 py-3 text-muted">
                  Checking the model server…
                </td>
              </tr>
            )}
            {status?.models.map((m) => (
              <tr key={m.name} data-testid="ai-model-row">
                <td className="px-4 py-2 font-medium text-ink">{m.name}</td>
                <td className="px-4 py-2 text-ink-2">{formatBytes(m.size)}</td>
                <td className="px-4 py-2 text-ink-2">{m.parameters}</td>
                <td className="px-4 py-2 text-ink-2">{m.vision ? 'text + images' : 'text'}</td>
              </tr>
            ))}
            {status && !status.reachable && (
              <tr>
                <td colSpan={4} className="px-4 py-3 text-red-700">
                  {status.error}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[12px] text-muted">
        Add a model on the server with <code className="rounded bg-canvas px-1">ollama pull qwen2.5:7b</code>, then <button className="text-brand-600 hover:underline" onClick={() => void refetch()}>refresh</button>.
      </p>
      {!admin ? (
        <p className="mt-4 text-[13px] text-muted">Only administrators change the AI settings.</p>
      ) : !draft ? (
        <Skeleton className="mt-4 h-40" />
      ) : (
        <div className="mt-4 card space-y-3 p-5">
          <label className="flex items-center gap-2 text-[13px] text-ink">
            <input type="checkbox" checked={draft.enabled} onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })} className="accent-brand-600" aria-label="AI enabled" /> AI is on for this organisation
          </label>
          <div className="grid gap-3 sm:grid-cols-[1fr_200px_140px]">
            <Labeled label="Model server (Ollama)">
              <input value={draft.url} onChange={(e) => setDraft({ ...draft, url: e.target.value })} className={field} aria-label="Model server address" />
            </Labeled>
            <Labeled label="Default model">
              <select value={draft.model} onChange={(e) => setDraft({ ...draft, model: e.target.value })} className={field} aria-label="Default model">
                <option value="">Automatic (largest text model)</option>
                {status?.models.map((m) => (
                  <option key={m.name}>{m.name}</option>
                ))}
              </select>
            </Labeled>
            <Labeled label="Context (tokens)">
              <input type="number" min={2048} step={1024} value={draft.numCtx} onChange={(e) => setDraft({ ...draft, numCtx: Number(e.target.value) })} className={field} aria-label="Context window" />
            </Labeled>
          </div>
          <div className="grid gap-3 sm:grid-cols-5">
            {APPS.map((x) => (
              <Labeled key={x} label={`${APP_LABEL[x]} model`}>
                <select value={draft.models[x] ?? ''} onChange={(e) => setDraft({ ...draft, models: { ...draft.models, [x]: e.target.value } })} className={field} aria-label={`${APP_LABEL[x]} model`}>
                  <option value="">Default</option>
                  {status?.models.map((m) => (
                    <option key={m.name}>{m.name}</option>
                  ))}
                </select>
              </Labeled>
            ))}
          </div>
          <Button variant="primary" loading={a.saveSettings.isPending} onClick={() => a.saveSettings.mutate(draft, { onSuccess: () => toast.success('AI settings saved') })} data-testid="ai-settings-save">
            Save
          </Button>
        </div>
      )}
    </section>
  );
}
