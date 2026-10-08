'use client';

import { BookOpen, Copy, Plus, RotateCcw, Save, Settings2, Sparkles, Trash2 } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useAdminRole } from '@/lib/admin';
import { AiWorkspace } from './AiWorkspace';
import { APP_LABEL, OUTPUT_LABEL, useAiActions, useAiPrompts, useAiSettings, useAiStatus, useAiUi, type AiPrompt, type AiSettings, type PromptApp, type PromptOutput } from '@/lib/ai';
import { formatBytes, timeAgo } from '@/lib/format';
import { Button, cn, EmptyState, Skeleton } from '../ui/primitives';

const TABS = [
  { id: 'workspace', label: 'Workspace', icon: Sparkles },
  { id: 'prompts', label: 'Prompt library', icon: BookOpen },
  { id: 'settings', label: 'Model & settings', icon: Settings2 },
] as const;
type Tab = (typeof TABS)[number]['id'];
const field = 'w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-[13px] text-ink outline-none focus:border-brand-500 disabled:bg-canvas';

/** /ai — the assistant's home: what it can do, the prompt library, the model server (§80). */
export function AiHome() {
  const params = useSearchParams();
  const router = useRouter();
  const tab = (TABS.some((t) => t.id === params.get('tab')) ? params.get('tab') : 'workspace') as Tab;
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
        <div className="mx-auto max-w-[1400px] p-6">
          {tab === 'workspace' && <AiWorkspace />}
          {tab === 'prompts' && <Library />}
          {tab === 'settings' && <Settings />}
        </div>
      </div>
    </div>
  );
}

// ── Prompt library ──────────────────────────────────────────────────────────

const APPS: PromptApp[] = ['flow', 'sheets', 'slides', 'docs', 'general'];
const OUTPUTS: PromptOutput[] = ['flow', 'sheet', 'deck', 'photodeck', 'template', 'design', 'image', 'layers', 'retext', 'markdown', 'text'];
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
          <Button
            variant="primary"
            loading={a.saveSettings.isPending}
            onClick={() => {
              const { images: _images, ...rest } = draft;
              void _images;
              a.saveSettings.mutate(rest, { onSuccess: () => toast.success('AI settings saved') });
            }}
            data-testid="ai-settings-save"
          >
            Save
          </Button>
        </div>
      )}
      {admin && settings && <ImageConnections settings={settings} visionModels={status?.models.filter((m) => m.vision).map((m) => m.name) ?? []} />}
    </section>
  );
}

/**
 * Image AI connections (§81): who paints pictures (OpenAI gpt-image, Google Gemini, or a key-less demo) and who reads
 * the text in pictures (the local vision model or Gemini). Keys are sent once and stored encrypted; they never come back.
 */
function ImageConnections({ settings, visionModels }: { settings: AiSettings; visionModels: string[] }) {
  const a = useAiActions();
  const cur = settings.images;
  const [provider, setProvider] = useState(cur.provider);
  const [openaiKey, setOpenaiKey] = useState('');
  const [geminiKey, setGeminiKey] = useState('');
  const [openaiModel, setOpenaiModel] = useState(cur.openaiModel);
  const [geminiModel, setGeminiModel] = useState(cur.geminiModel);
  const [vision, setVision] = useState(cur.vision);
  const [visionModel, setVisionModel] = useState(cur.visionModel);
  const [tested, setTested] = useState<string | null>(null);
  useEffect(() => {
    setProvider(cur.provider);
    setOpenaiModel(cur.openaiModel);
    setGeminiModel(cur.geminiModel);
    setVision(cur.vision);
    setVisionModel(cur.visionModel);
  }, [cur.provider, cur.openaiModel, cur.geminiModel, cur.vision, cur.visionModel]);
  const save = () =>
    a.saveSettings.mutate(
      { images: { provider, openaiModel, geminiModel, vision, visionModel, ...(openaiKey ? { openaiKey } : {}), ...(geminiKey ? { geminiKey } : {}) } },
      { onSuccess: () => (setOpenaiKey(''), setGeminiKey(''), toast.success('Image AI saved')) },
    );
  const options: { id: typeof provider; label: string; note: string }[] = [
    { id: 'none', label: 'Off', note: 'No pictures are painted; text in pictures is still made editable locally.' },
    { id: 'openai', label: 'OpenAI', note: 'gpt-image-1 — the pictures of ChatGPT. Needs an API key from platform.openai.com (billed by OpenAI).' },
    { id: 'gemini', label: 'Google Gemini', note: 'gemini-2.5-flash-image — strong at editing (removing text). API key from aistudio.google.com.' },
    { id: 'demo', label: 'Demo', note: 'No key: soft generated backgrounds, to try the studio. Not real pictures.' },
  ];
  return (
    <div className="mt-6" data-testid="ai-images">
      <h2 className="text-[16px] font-semibold text-ink">Image AI (pictures and editable text on pictures)</h2>
      <p className="mt-1 max-w-3xl text-[13px] text-muted">
        Like Photoshop layers: a picture painted by OpenAI or Gemini (or one you made in ChatGPT / Gemini and bring in) is the background, and its text becomes editable text boxes on top. Prompts sent to these services are in the prompt library (Picture …, Editable text …).
      </p>
      <div className="mt-3 card space-y-4 p-5">
        <div className="grid gap-2 sm:grid-cols-4" role="radiogroup" aria-label="Image AI">
          {options.map((o) => (
            <button key={o.id} role="radio" aria-checked={provider === o.id} onClick={() => setProvider(o.id)} className={cn('rounded-lg border px-3 py-2 text-left', provider === o.id ? 'border-brand-500 bg-brand-50' : 'border-line hover:bg-hover')} data-testid="image-provider" data-provider={o.id}>
              <div className="text-[13px] font-medium text-ink">{o.label}</div>
              <div className="text-[11.5px] leading-snug text-muted">{o.note}</div>
            </button>
          ))}
        </div>
        {provider === 'openai' && (
          <div className="grid gap-3 sm:grid-cols-[1fr_200px]">
            <Labeled label={`OpenAI API key ${cur.hasOpenaiKey ? '(saved — type to replace)' : ''}`}>
              <input type="password" autoComplete="off" value={openaiKey} onChange={(e) => setOpenaiKey(e.target.value)} placeholder={cur.hasOpenaiKey ? '••••••••••••' : 'sk-…'} className={field} aria-label="OpenAI API key" />
            </Labeled>
            <Labeled label="Model">
              <input value={openaiModel} onChange={(e) => setOpenaiModel(e.target.value)} className={field} aria-label="OpenAI image model" />
            </Labeled>
          </div>
        )}
        {(provider === 'gemini' || vision === 'gemini') && (
          <div className="grid gap-3 sm:grid-cols-[1fr_200px]">
            <Labeled label={`Gemini API key ${cur.hasGeminiKey ? '(saved — type to replace)' : ''}`}>
              <input type="password" autoComplete="off" value={geminiKey} onChange={(e) => setGeminiKey(e.target.value)} placeholder={cur.hasGeminiKey ? '••••••••••••' : 'AIza…'} className={field} aria-label="Gemini API key" />
            </Labeled>
            <Labeled label="Model">
              <input value={geminiModel} onChange={(e) => setGeminiModel(e.target.value)} className={field} aria-label="Gemini image model" />
            </Labeled>
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-[260px_1fr]">
          <Labeled label="Who reads the text in pictures">
            <select value={vision} onChange={(e) => setVision(e.target.value as typeof vision)} className={field} aria-label="Text reader">
              <option value="local">The local vision model (private, ~3–5 min on a CPU)</option>
              <option value="gemini">Gemini (fast, needs its key)</option>
            </select>
          </Labeled>
          {vision === 'local' && (
            <Labeled label="Local vision model">
              <select value={visionModel} onChange={(e) => setVisionModel(e.target.value)} className={field} aria-label="Local vision model">
                <option value="">Automatic {visionModels[0] ? `(${visionModels[0]})` : '— none on the server: ollama pull qwen2.5vl:7b'}</option>
                {visionModels.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
            </Labeled>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" loading={a.saveSettings.isPending} onClick={save} data-testid="image-save">
            Save
          </Button>
          <Button variant="secondary" disabled={cur.provider === 'none'} loading={a.testImages.isPending} onClick={() => a.testImages.mutate(undefined, { onSuccess: (r) => setTested(`${r.provider} · ${r.model} · ${Math.round(r.bytes / 1024)} KB in ${(r.ms / 1000).toFixed(1)} s`) })} data-testid="image-test">
            Test: paint one picture
          </Button>
          {tested && <span className="text-[12px] text-emerald-700" data-testid="image-tested">✓ {tested}</span>}
        </div>
      </div>
    </div>
  );
}
