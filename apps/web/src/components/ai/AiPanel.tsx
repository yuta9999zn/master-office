'use client';

import { BookOpen, Brain, CheckCircle2, ChevronDown, ChevronRight, CircleAlert, Copy, CreditCard, FileText, Image as ImageIcon, Layers, LayoutTemplate, Loader2, MessageSquare, Presentation, Replace, Settings2, Sheet, Sparkles, Square, TextCursorInput, Upload, Wand2, Workflow, X } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { markdownToHtml } from '@workos/doc-model/columns-md';
import { APP_LABEL, useAiActions, useAiJob, useAiJobs, useAiPrompts, useAiStatus, useAiUi, type AiContext, type AiJob, type AiPrompt } from '@/lib/ai';
import { Button, cn } from '../ui/primitives';
import { SlotsDialog } from '../slides/SlotsDialog';

interface Action {
  id: string;
  promptKey: string;
  label: string;
  note: string;
  icon: ReactNode;
  /** Writes into the open file instead of making a new one. */
  intoFile?: boolean;
  format?: string;
  /** Docs: how the text comes back. */
  docs?: 'insert' | 'replace' | 'summary';
  /** Pictures (§81): paint one with the image AI, make a picture's text editable, or bring one in from elsewhere. */
  picture?: 'generate' | 'editable' | 'import' | 'retext' | 'slots';
}

const NEW_FILE: Action[] = [
  { id: 'flow', promptKey: 'flow.generate', label: 'New workflow', note: 'A diagram from a description, with decisions and roles', icon: <Workflow size={16} /> },
  { id: 'sheet', promptKey: 'sheet.generate', label: 'New workbook', note: 'Sheets, lookups, totals and a report', icon: <Sheet size={16} /> },
  { id: 'deck', promptKey: 'slides.deck', label: 'New presentation', note: 'An outline on slides with notes', icon: <Presentation size={16} /> },
  { id: 'photodeck', promptKey: 'slides.photoDeck', label: 'New presentation with pictures', note: 'AI plans it and writes the picture prompts for ChatGPT', icon: <ImageIcon size={16} /> },
  { id: 'banner', promptKey: 'slides.banner', label: 'New banner', note: 'Web, social post, story or poster', icon: <ImageIcon size={16} />, format: 'banner-web' },
  { id: 'card', promptKey: 'slides.businessCard', label: 'New business card', note: 'Two sides, print-safe', icon: <CreditCard size={16} />, format: 'business-card-eu' },
  { id: 'picture', promptKey: 'image.generate', label: 'New picture', note: 'Painted by the image AI (OpenAI / Gemini)', icon: <Wand2 size={16} />, format: 'banner-web', picture: 'generate' },
  { id: 'ask', promptKey: 'general.ask', label: 'Ask', note: 'A question, an idea, a draft', icon: <MessageSquare size={16} /> },
];

function actionsFor(ctx: AiContext | null): Action[] {
  if (!ctx) return NEW_FILE;
  switch (ctx.app) {
    case 'flow':
      return [{ id: 'flow-page', promptKey: 'flow.generate', label: 'Draw a workflow here', note: 'Added as a new page of this flow', icon: <Workflow size={16} />, intoFile: true }, ...NEW_FILE.filter((a) => a.id !== 'flow')];
    case 'sheets':
      return [{ id: 'sheet-tabs', promptKey: 'sheet.generate', label: 'Add sheets here', note: 'New tabs in this workbook', icon: <Sheet size={16} />, intoFile: true }, ...NEW_FILE.filter((a) => a.id !== 'sheet')];
    case 'slides':
      return [
        { id: 'deck-slides', promptKey: 'slides.deck', label: 'Add slides here', note: 'Appended to this presentation', icon: <Presentation size={16} />, intoFile: true },
        { id: 'slide-picture', promptKey: 'image.generate', label: 'AI picture on this slide', note: 'Painted as the background — your text stays on top', icon: <Wand2 size={16} />, intoFile: true, picture: 'generate' },
        { id: 'slide-editable', promptKey: 'image.editable', label: 'Make the picture’s text editable', note: 'Like Photoshop: the text of the picture becomes text boxes', icon: <Layers size={16} />, intoFile: true, picture: 'editable' },
        { id: 'slide-retext', promptKey: 'image.retext', label: 'Put new information into this design', note: 'New dates, prices, offers… into the text of the slide', icon: <Replace size={16} />, intoFile: true, picture: 'retext' },
        { id: 'slide-slots', promptKey: 'slides.photoDeck', label: 'Pictures for the picture slots', note: 'Prompts to paste into ChatGPT, then the pictures in', icon: <ImageIcon size={16} />, intoFile: true, picture: 'slots' },
        { id: 'slide-import', promptKey: 'image.editable', label: 'Bring in a picture from ChatGPT / Gemini', note: 'As a new slide, then its text becomes editable', icon: <Upload size={16} />, intoFile: true, picture: 'import' },
        ...NEW_FILE.filter((a) => a.id !== 'deck'),
      ];
    case 'docs':
      return [
        { id: 'draft', promptKey: 'docs.draft', label: 'Write here', note: 'Inserted where the cursor is', icon: <TextCursorInput size={16} />, docs: 'insert' },
        { id: 'summary', promptKey: 'docs.summarize', label: 'Summarize', note: 'The selection, or the whole document', icon: <FileText size={16} />, docs: 'summary' },
        { id: 'rewrite', promptKey: 'docs.rewrite', label: 'Improve the selection', note: 'Clearer, more professional', icon: <Replace size={16} />, docs: 'replace' },
        ...NEW_FILE,
      ];
    default:
      return NEW_FILE;
  }
}

const field = 'w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-[13px] text-ink outline-none focus:border-brand-500';
const secs = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`;

/** The one AI entry point (§80): a panel beside every app, opened from the top bar. */
export function AiPanel() {
  const { open, setOpen, context, preset } = useAiUi();
  const { data: status } = useAiStatus(open);
  const { data: prompts } = useAiPrompts();
  const { data: jobs } = useAiJobs();
  const a = useAiActions();
  const router = useRouter();
  const imagesReady = !!status?.images?.ready;
  const actions = useMemo(() => actionsFor(context).filter((x) => x.picture !== 'generate' || imagesReady), [context, imagesReady]);
  const [actionId, setActionId] = useState<string>(actions[0].id);
  const [request, setRequest] = useState('');
  const [format, setFormat] = useState<string>('banner-web');
  const [notation, setNotation] = useState<'auto' | 'flowchart' | 'bpmn'>('auto');
  const [model, setModel] = useState('');
  const [jobId, setJobId] = useState<string | null>(null);
  const [showLive, setShowLive] = useState(false);
  const [customKey, setCustomKey] = useState('');
  const [bgAi, setBgAi] = useState(false);
  const [slotsOpen, setSlotsOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const { data: job } = useAiJob(jobId);
  const box = useRef<HTMLTextAreaElement>(null);

  // A new file or app: back to its first action.
  useEffect(() => setActionId(actions[0].id), [actions]);
  useEffect(() => {
    if (!preset) return;
    const hit = actions.find((x) => x.promptKey === preset.promptKey);
    if (hit) setActionId(hit.id);
    if (preset.request) setRequest(preset.request);
  }, [preset, actions]);
  useEffect(() => {
    if (open) setTimeout(() => box.current?.focus(), 50);
  }, [open, actionId]);
  const action = actions.find((x) => x.id === actionId) ?? actions[0];
  useEffect(() => {
    if (action.format) setFormat(action.format);
  }, [action]);
  const custom = (prompts ?? []).filter((p) => !p.builtIn && !p.partOf);
  const prompt: AiPrompt | undefined = prompts?.find((p) => p.key === (customKey || action.promptKey));
  const running = job && ['queued', 'running'].includes(job.status);

  if (!open) return null;

  const run = () => {
    const text = context?.getText?.();
    const variables: Record<string, string> = {};
    if (action.docs === 'summary') variables.selection = (text?.selection || text?.document || '').slice(0, 24_000);
    if (action.docs === 'replace') {
      if (!text?.selection) return toast.error('Select the text to improve first');
      variables.selection = text.selection;
    }
    if (action.docs === 'insert' && text?.document) variables.context = `The document so far (for tone and context):\n${text.document.slice(0, 3000)}`;
    if (context && !action.docs && !action.picture) variables.context = `The open file is “${context.name}”.`;
    if (action.picture === 'import') return fileInput.current?.click();
    if (action.picture === 'slots') return setSlotsOpen(true);
    const slide = action.picture ? context?.getSlide?.() : null;
    a.start.mutate(
      {
        slideId: slide?.slideId ?? null,
        elementId: action.picture === 'editable' ? (slide?.elementId ?? null) : null,
        background: prompt?.output === 'template' && bgAi && imagesReady ? 'ai' : null,
        promptKey: customKey || action.promptKey,
        request: request.trim(),
        variables,
        targetId: action.intoFile && context?.editable ? context.resourceId : null,
        format: prompt?.output === 'design' || prompt?.output === 'template' || (prompt?.output === 'image' && !action.intoFile) ? format : null,
        model: model || null,
        notation: notation === 'auto' ? null : notation,
      },
      { onSuccess: (j) => (setJobId(j.id), setShowLive(false)) },
    );
  };

  const imported = async (file: File) => {
    if (!context) return;
    const res = await a.importPicture.mutateAsync({ id: context.resourceId, file });
    toast.success('Picture added as a new slide — reading its text…');
    a.start.mutate({ promptKey: 'image.editable', request: '', targetId: context.resourceId, slideId: res.slideId }, { onSuccess: (j) => (setJobId(j.id), setShowLive(false)) });
  };

  const finish = (j: AiJob) => {
    const text = String(j.result?.text ?? '');
    if (!text) return null;
    return (
      <div className="space-y-2">
        <div className="max-h-72 overflow-y-auto rounded-lg border border-line bg-canvas p-3 text-[13px] leading-relaxed text-ink [&_h2]:mt-2 [&_h2]:font-semibold [&_li]:ml-4 [&_li]:list-disc [&_table]:my-2 [&_td]:border [&_td]:border-line [&_td]:px-1.5 [&_th]:border [&_th]:border-line [&_th]:px-1.5" data-testid="ai-text" dangerouslySetInnerHTML={{ __html: markdownToHtml(text) }} />
        <div className="flex flex-wrap gap-2">
          {context?.insert && context.editable && action.docs !== 'replace' && (
            <Button size="sm" variant="primary" onClick={() => (context.insert!(text, 'insert'), toast.success('Inserted'))} data-testid="ai-insert">
              Insert in the document
            </Button>
          )}
          {context?.insert && context.editable && action.docs === 'replace' && (
            <Button size="sm" variant="primary" onClick={() => (context.insert!(text, 'replace'), toast.success('Replaced'))} data-testid="ai-replace">
              Replace the selection
            </Button>
          )}
          <Button size="sm" variant="ghost" icon={<Copy size={14} />} onClick={() => void navigator.clipboard.writeText(text).then(() => toast.success('Copied'))}>
            Copy
          </Button>
        </div>
      </div>
    );
  };

  return (
    <aside className="flex w-[400px] shrink-0 flex-col border-l border-line bg-surface" data-testid="ai-panel">
      {slotsOpen && context && <SlotsDialog open onClose={() => setSlotsOpen(false)} resourceId={context.resourceId} />}
      <input ref={fileInput} type="file" accept="image/*" hidden onChange={(e) => (e.target.files?.[0] && void imported(e.target.files[0]), (e.target.value = ''))} data-testid="ai-picture-input" />
      <header className="flex items-center gap-2.5 border-b border-line px-4 py-3">
        <span className="grid size-8 place-items-center rounded-lg bg-gradient-to-br from-indigo-400 to-violet-600 text-white">
          <Sparkles size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-semibold text-ink">AI Assistant</div>
          <div className="flex items-center gap-1.5 text-[11.5px] text-muted" data-testid="ai-model">
            <span className={cn('size-1.5 rounded-full', status?.reachable ? 'bg-emerald-500' : status ? 'bg-red-500' : 'bg-line-strong')} />
            {status ? (status.reachable ? `${status.model || 'no model'} · local` : 'model server offline') : 'checking…'}
          </div>
        </div>
        <Link href="/ai?tab=prompts" className="grid size-8 place-items-center rounded-lg text-muted hover:bg-hover hover:text-ink" title="Prompt library" aria-label="Prompt library">
          <BookOpen size={16} />
        </Link>
        <Link href="/ai?tab=settings" className="grid size-8 place-items-center rounded-lg text-muted hover:bg-hover hover:text-ink" title="AI settings" aria-label="AI settings">
          <Settings2 size={16} />
        </Link>
        <button onClick={() => setOpen(false)} className="grid size-8 place-items-center rounded-lg text-muted hover:bg-hover hover:text-ink" aria-label="Close AI">
          <X size={16} />
        </button>
      </header>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        {status && !status.reachable && (
          <div className="flex gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-[12.5px] text-red-700" data-testid="ai-offline">
            <CircleAlert size={15} className="mt-0.5 shrink-0" />
            <span>{status.error}</span>
          </div>
        )}
        <div className="rounded-lg bg-canvas px-3 py-2 text-[12px] text-muted" data-testid="ai-context">
          {context ? (
            <>
              Working in <b className="text-ink">{context.name}</b> · {APP_LABEL[context.app]}
              {!context.editable && ' (view only)'}
            </>
          ) : (
            'Not in a file — results are created as new files in My Files.'
          )}
        </div>

        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="What to do">
          {actions.map((x) => (
            <button
              key={x.id}
              role="radio"
              aria-checked={x.id === action.id && !customKey}
              onClick={() => (setActionId(x.id), setCustomKey(''))}
              className={cn('flex flex-col items-start gap-1 rounded-lg border px-2.5 py-2 text-left', x.id === action.id && !customKey ? 'border-brand-500 bg-brand-50' : 'border-line hover:bg-hover', x.intoFile || x.docs ? 'col-span-2' : '')}
              data-testid="ai-action"
              data-action={x.id}
            >
              <span className="flex items-center gap-1.5 text-[12.5px] font-medium text-ink">
                <span className="text-brand-600">{x.icon}</span>
                {x.label}
              </span>
              <span className="text-[11px] leading-snug text-muted">{x.note}</span>
            </button>
          ))}
        </div>

        {custom.length > 0 && (
          <label className="block">
            <span className="mb-1 block text-[12px] font-medium text-ink-2">Or one of the organisation’s prompts</span>
            <select value={customKey} onChange={(e) => setCustomKey(e.target.value)} className={field} aria-label="Custom prompt">
              <option value="">—</option>
              {custom.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        )}

        <div className="space-y-2">
          {prompt?.description && <p className="text-[11.5px] leading-snug text-muted">{prompt.description}</p>}
          {action.docs !== 'summary' && action.picture !== 'editable' && action.picture !== 'import' && action.picture !== 'slots' && (
            <textarea
              ref={box}
              value={request}
              onChange={(e) => setRequest(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !running && run()}
              rows={5}
              placeholder={prompt?.variables.find((v) => v.name === 'request')?.example || 'Describe what you want…'}
              className={cn(field, 'resize-y leading-relaxed')}
              aria-label="Request"
              data-testid="ai-request"
            />
          )}
          {action.picture === 'editable' && <p className="rounded-lg bg-canvas px-3 py-2 text-[12px] text-muted">Works on the selected picture, or the picture of the slide on screen. The text is read by {status?.images?.vision === 'gemini' ? 'Gemini' : `the local vision model (${status?.images?.visionModel ?? 'none — pull qwen2.5vl:7b'})`}; {status?.images?.ready && status.images.provider !== 'demo' ? `${status.images.provider} takes it off the picture.` : 'it is taken off the picture locally (connect OpenAI or Gemini for a cleaner result).'} A local read takes 3–5 minutes on a CPU.</p>}
          {action.picture === 'import' && <p className="rounded-lg bg-canvas px-3 py-2 text-[12px] text-muted">Save the picture from ChatGPT or Gemini (or any design), then choose it here. It becomes a new slide; its text is then made editable.</p>}
          {prompt?.output === 'template' && (
            <label className={cn('flex items-center gap-2 text-[12.5px]', imagesReady ? 'text-ink-2' : 'text-muted')} title={imagesReady ? '' : 'Connect an image AI in AI → Model & settings'}>
              <input type="checkbox" disabled={!imagesReady} checked={bgAi && imagesReady} onChange={(e) => setBgAi(e.target.checked)} className="accent-brand-600" data-testid="ai-bg-ai" />
              Background painted by the image AI{imagesReady ? ` (${status?.images?.provider})` : ' — not connected'}
            </label>
          )}
          {(prompt?.output === 'design' || prompt?.output === 'template' || (prompt?.output === 'image' && !action.intoFile)) && (
            <select value={format} onChange={(e) => setFormat(e.target.value)} className={field} aria-label="Format" data-testid="ai-format">
              {status?.formats
                .filter((f) => f.id !== 'deck' && (/card/i.test(prompt.key) ? f.id.startsWith('business') : !f.id.startsWith('business')))
                .map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label} — {f.note}
                  </option>
                ))}
            </select>
          )}
          {prompt?.output === 'flow' && (
            <div className="flex gap-1 rounded-lg bg-canvas p-1 text-[12px]" role="radiogroup" aria-label="Notation">
              {(['auto', 'flowchart', 'bpmn'] as const).map((n) => (
                <button key={n} role="radio" aria-checked={notation === n} onClick={() => setNotation(n)} className={cn('flex-1 rounded-md py-1 capitalize', notation === n ? 'bg-surface font-medium text-ink shadow-sm' : 'text-muted')}>
                  {n === 'bpmn' ? 'BPMN' : n}
                </button>
              ))}
            </div>
          )}
          <div className="flex items-center gap-2">
            <select value={model} onChange={(e) => setModel(e.target.value)} className={cn(field, 'h-9 flex-1 py-0 text-[12px]')} aria-label="Model" title="Model">
              <option value="">Model: {status?.perApp?.[prompt?.app ?? 'general'] || 'automatic'}</option>
              {status?.models.map((m) => (
                <option key={m.name} value={m.name}>
                  {m.name} ({m.parameters ?? '?'}{m.vision ? ', vision' : ''})
                </option>
              ))}
            </select>
            <Button variant="primary" icon={<Sparkles size={14} />} onClick={run} loading={a.start.isPending} disabled={!!running || !status?.reachable || (!request.trim() && action.docs !== 'summary' && action.picture !== 'editable' && action.picture !== 'import' && action.picture !== 'slots')} data-testid="ai-run">
              {action.picture === 'slots' ? 'Open' : action.picture === 'import' ? 'Choose a picture' : action.picture === 'editable' ? 'Make editable' : 'Generate'}
            </Button>
          </div>
          <p className="text-[11px] text-muted">Runs on the organisation’s own model server — nothing leaves it. Ctrl+Enter to start.</p>
        </div>

        {job && (
          <section className="space-y-2 rounded-lg border border-line p-3" data-testid="ai-job" data-status={job.status}>
            <div className="flex items-center gap-2 text-[12.5px]">
              {running ? <Loader2 size={15} className="animate-spin text-brand-600" /> : job.status === 'done' ? <CheckCircle2 size={15} className="text-emerald-600" /> : <CircleAlert size={15} className="text-red-600" />}
              <span className="font-medium text-ink">
                {job.status === 'queued' ? `Waiting (${job.queuePosition} in line)` : job.status === 'running' ? 'Writing…' : job.status === 'done' ? 'Done' : job.status === 'cancelled' ? 'Cancelled' : 'Failed'}
              </span>
              <span className="ml-auto tabular-nums text-muted">
                {secs(job.elapsedMs)} · {job.tokens} tokens{job.elapsedMs > 3000 && job.tokens ? ` · ${(job.tokens / (job.elapsedMs / 1000)).toFixed(1)}/s` : ''}
              </span>
            </div>
            {job.model && <div className="text-[11px] text-muted">{job.model}</div>}
            {running && (
              <div className="h-1 overflow-hidden rounded-full bg-line">
                <div className="h-full w-1/3 animate-[mo-progress_1.4s_ease-in-out_infinite] rounded-full bg-brand-500" />
              </div>
            )}
            {job.error && <p className="text-[12px] text-red-700">{job.error}</p>}
            {job.status === 'done' && job.result?.url && (
              <div className="space-y-1.5">
                <div className="text-[13px] text-ink">
                  <b>{String(job.result.title ?? 'Result')}</b>
                  {job.result.resourceId === context?.resourceId ? ' — added to this file' : ''}
                </div>
                {[...((job.result.fixes as string[]) ?? []), ...((job.result.warnings as string[]) ?? [])].length > 0 && (
                  <ul className="list-disc pl-4 text-[11.5px] text-muted">
                    {[...((job.result.fixes as string[]) ?? []), ...((job.result.warnings as string[]) ?? [])].slice(0, 6).map((f) => (
                      <li key={f}>{f}</li>
                    ))}
                  </ul>
                )}
                {Array.isArray(job.result.changes) && (
                  <ul className="space-y-0.5 text-[12px]" data-testid="ai-changes">
                    {(job.result.changes as { from: string; to: string }[]).map((c, i) => (
                      <li key={i}>
                        <s className="text-muted">{c.from}</s> → <b className="text-ink">{c.to}</b>
                      </li>
                    ))}
                  </ul>
                )}
                {job.result.resourceId !== context?.resourceId && (
                  <Button size="sm" variant="primary" icon={<LayoutTemplate size={14} />} onClick={() => router.push(String(job.result!.url))} data-testid="ai-open">
                    Open
                  </Button>
                )}
              </div>
            )}
            {job.status === 'done' && finish(job)}
            <div className="flex items-center gap-2">
              {(job.partial || running) && (
                <button onClick={() => setShowLive(!showLive)} className="flex items-center gap-1 text-[11.5px] text-brand-600 hover:underline" aria-expanded={showLive}>
                  {showLive ? <ChevronDown size={12} /> : <ChevronRight size={12} />} {running ? 'What the model is writing' : 'Model answer'}
                </button>
              )}
              {running && (
                <Button size="sm" variant="ghost" icon={<Square size={12} />} className="ml-auto" onClick={() => a.cancel.mutate(job.id)} data-testid="ai-cancel">
                  Stop
                </Button>
              )}
            </div>
            {showLive && <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded bg-canvas p-2 font-mono text-[10.5px] text-ink-2">{job.partial || '…'}</pre>}
          </section>
        )}

        {(jobs?.length ?? 0) > 0 && (
          <section>
            <div className="mb-1 flex items-center gap-1.5 text-[12px] font-medium text-ink-2">
              <Brain size={13} /> Recent
            </div>
            <ul className="space-y-0.5">
              {jobs!.slice(0, 6).map((j) => (
                <li key={j.id}>
                  <button onClick={() => setJobId(j.id)} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] hover:bg-hover">
                    <span className={cn('size-1.5 shrink-0 rounded-full', j.status === 'done' ? 'bg-emerald-500' : j.status === 'failed' ? 'bg-red-500' : j.status === 'cancelled' ? 'bg-line-strong' : 'bg-amber-500')} />
                    <span className="min-w-0 flex-1 truncate text-ink-2">{String(j.result?.title ?? '') || j.request || j.promptKey}</span>
                    <span className="shrink-0 text-muted">{secs(j.elapsedMs)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </aside>
  );
}
