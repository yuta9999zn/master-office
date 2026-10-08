'use client';

import { CheckCircle2, CircleAlert, Clock, ExternalLink, Image as ImageIcon, Layers, Loader2, Play, RotateCcw, Square, Upload } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { markdownToHtml } from '@workos/doc-model';
import type { ResourceType } from '@workos/shared';
import { APP_LABEL, OUTPUT_LABEL, useAiActions, useAiJob, useAiJobs, useAiPrompts, useAiStatus, type AiJob, type AiPrompt, type PromptApp } from '@/lib/ai';
import { formatDateTime } from '@/lib/format';
import { useResources } from '@/lib/queries';
import { Button, cn, Skeleton } from '../ui/primitives';

const field = 'w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-[13px] text-ink outline-none focus:border-brand-500 disabled:bg-canvas';
const secs = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`;
/** Which kind of file a result can be written into. */
const TARGET: Partial<Record<AiPrompt['output'], ResourceType>> = { flow: 'flow', sheet: 'spreadsheet', deck: 'presentation', image: 'presentation', layers: 'presentation', retext: 'presentation' };
const APPS: PromptApp[] = ['flow', 'sheets', 'slides', 'docs', 'general'];

/**
 * /ai — the AI workspace (§80–81), opened from the left navigation: every task of the prompt library with all its
 * options, where the result goes (a new file or one you pick), pictures (bring one in, make its text editable), a
 * large live view and the full history. The top-bar button stays the quick way in from any app.
 */
export function AiWorkspace() {
  const { data: prompts, isLoading } = useAiPrompts();
  const { data: status } = useAiStatus();
  const { data: jobs } = useAiJobs();
  const a = useAiActions();
  const router = useRouter();
  const tasks = useMemo(() => (prompts ?? []).filter((p) => !p.partOf), [prompts]);
  const [key, setKey] = useState('flow.generate');
  const p = tasks.find((x) => x.key === key) ?? tasks[0];
  const [request, setRequest] = useState('');
  const [vars, setVars] = useState<Record<string, string>>({});
  const [targetId, setTargetId] = useState('');
  const [format, setFormat] = useState('banner-web');
  const [notation, setNotation] = useState<'auto' | 'flowchart' | 'bpmn'>('auto');
  const [bgAi, setBgAi] = useState(false);
  const [model, setModel] = useState('');
  const [jobId, setJobId] = useState<string | null>(null);
  const { data: job } = useAiJob(jobId);
  const [viewing, setViewing] = useState<AiJob | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const targetType = p ? TARGET[p.output] : undefined;
  const { data: files } = useResources(targetType ? { type: targetType, view: 'recent' } : null);
  const fileList = (Array.isArray(files) ? files : []).slice(0, 50);
  const running = job && ['queued', 'running'].includes(job.status);
  const imagesReady = !!status?.images?.ready;

  useEffect(() => {
    setVars({});
    setTargetId('');
    if (p?.output === 'template') setFormat(/card/i.test(p.key) ? 'business-card-eu' : 'banner-web');
  }, [p?.key, p?.output]);

  if (isLoading || !p) return <Skeleton className="h-96" />;
  const extra = p.variables.filter((v) => !['request', 'language', 'today', 'format', 'canvas', 'headline', 'subhead', 'small', 'width', 'height', 'space', 'plan', 'catalog', 'sheet', 'columns', 'samples', 'asked', 'lines'].includes(v.name));
  const needsTarget = p.output === 'layers' || p.output === 'retext';
  const usesRequest = p.output !== 'layers';

  const start = () =>
    a.start.mutate(
      {
        promptKey: p.key,
        request: request.trim(),
        variables: vars,
        targetId: targetId || null,
        format: p.output === 'template' || p.output === 'design' || (p.output === 'image' && !targetId) ? format : null,
        notation: notation === 'auto' ? null : notation,
        background: p.output === 'template' && bgAi ? 'ai' : null,
        model: model || null,
      },
      { onSuccess: (j) => setJobId(j.id) },
    );
  const importPicture = async (file: File) => {
    const res = await a.importPicture.mutateAsync({ id: targetId || null, file });
    const into = res.resourceId ?? targetId;
    toast.success(targetId ? 'Picture added as a new slide — reading its text…' : 'New design made from the picture — reading its text…');
    if (!targetId && res.resourceId) setTargetId(res.resourceId);
    a.start.mutate({ promptKey: 'image.editable', request: '', targetId: into, slideId: res.slideId }, { onSuccess: (j) => setJobId(j.id) });
  };

  return (
    <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]" data-testid="ai-workspace">
      <div className="space-y-4">
        <div>
          <h1 className="text-[22px] font-semibold text-ink">AI workspace</h1>
          <p className="mt-1 max-w-3xl text-[13px] text-muted">Every AI task with all its options. The AI button in the top bar (Ctrl+J) is the quick way in from inside any file; here you choose the task, where the result goes, the model — and follow every run.</p>
        </div>
        {status && !status.reachable && (
          <div className="flex gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-[12.5px] text-red-700">
            <CircleAlert size={15} className="mt-0.5 shrink-0" /> {status.error}
          </div>
        )}
        {/* Tasks */}
        <div className="card p-4">
          <div className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-subtle">1 · Task</div>
          <div className="space-y-3">
            {APPS.map((app) => {
              const list = tasks.filter((t) => t.app === app);
              if (!list.length) return null;
              return (
                <div key={app}>
                  <div className="mb-1 text-[12px] font-medium text-muted">{APP_LABEL[app]}</div>
                  <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={`${APP_LABEL[app]} tasks`}>
                    {list.map((t) => (
                      <button
                        key={t.key}
                        role="radio"
                        aria-checked={t.key === p.key}
                        onClick={() => setKey(t.key)}
                        disabled={t.output === 'image' && !imagesReady}
                        title={t.output === 'image' && !imagesReady ? 'Connect an image AI in Model & settings' : t.description}
                        className={cn('rounded-lg border px-2.5 py-1.5 text-[12.5px] disabled:opacity-50', t.key === p.key ? 'border-brand-500 bg-brand-50 font-medium text-brand-700' : 'border-line text-ink-2 hover:bg-hover')}
                        data-testid="ai-task"
                        data-key={t.key}
                      >
                        {t.name}
                        {!t.builtIn && <span className="ml-1 text-[10px] text-violet-600">custom</span>}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
          <p className="mt-3 rounded-md bg-canvas px-3 py-2 text-[12px] leading-relaxed text-ink-2">{p.description}</p>
        </div>

        {/* Input */}
        <div className="card space-y-3 p-4">
          <div className="text-[12px] font-semibold uppercase tracking-wide text-subtle">2 · What to make</div>
          {usesRequest && (
            <textarea value={request} onChange={(e) => setRequest(e.target.value)} rows={6} placeholder={p.variables.find((v) => v.name === 'request')?.example || 'Describe what you want…'} className={cn(field, 'resize-y leading-relaxed')} aria-label="Request" data-testid="ws-request" />
          )}
          {extra.map((v) => (
            <label key={v.name} className="block">
              <span className="mb-1 block text-[12px] font-medium text-ink-2">{v.label}</span>
              <textarea value={vars[v.name] ?? ''} onChange={(e) => setVars({ ...vars, [v.name]: e.target.value })} rows={v.name === 'selection' ? 6 : 2} placeholder={v.example} className={field} aria-label={v.label} />
            </label>
          ))}
          <div className="grid gap-3 sm:grid-cols-2">
            {(p.output === 'template' || p.output === 'design' || (p.output === 'image' && !targetId)) && (
              <label className="block">
                <span className="mb-1 block text-[12px] font-medium text-ink-2">Format</span>
                <select value={format} onChange={(e) => setFormat(e.target.value)} className={field} aria-label="Format" data-testid="ws-format">
                  {status?.formats
                    .filter((f) => f.id !== 'deck' && (/card/i.test(p.key) ? f.id.startsWith('business') : p.output === 'image' ? true : !f.id.startsWith('business')))
                    .map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.label} — {f.note}
                      </option>
                    ))}
                </select>
              </label>
            )}
            {p.output === 'flow' && (
              <label className="block">
                <span className="mb-1 block text-[12px] font-medium text-ink-2">Notation</span>
                <select value={notation} onChange={(e) => setNotation(e.target.value as typeof notation)} className={field} aria-label="Notation">
                  <option value="auto">Automatic (BPMN when roles are named)</option>
                  <option value="flowchart">Flowchart</option>
                  <option value="bpmn">BPMN 2.0</option>
                </select>
              </label>
            )}
            {p.output === 'template' && (
              <label className={cn('flex items-center gap-2 self-end pb-2 text-[12.5px]', imagesReady ? 'text-ink-2' : 'text-muted')}>
                <input type="checkbox" disabled={!imagesReady} checked={bgAi && imagesReady} onChange={(e) => setBgAi(e.target.checked)} className="accent-brand-600" data-testid="ws-bg-ai" />
                Background painted by the image AI{imagesReady ? ` (${status?.images.provider})` : ' — connect one in Model & settings'}
              </label>
            )}
          </div>
        </div>

        {/* Where it goes */}
        <div className="card space-y-3 p-4">
          <div className="text-[12px] font-semibold uppercase tracking-wide text-subtle">3 · Where the result goes · model</div>
          <div className="grid gap-3 sm:grid-cols-2">
            {targetType ? (
              <label className="block">
                <span className="mb-1 block text-[12px] font-medium text-ink-2">{needsTarget ? 'Presentation with the picture' : 'Write into'}</span>
                <select value={targetId} onChange={(e) => setTargetId(e.target.value)} className={field} aria-label="Target file" data-testid="ws-target">
                  {!needsTarget && <option value="">A new file in My Files</option>}
                  {needsTarget && <option value="">{p.output === 'layers' ? 'Choose… (or bring in a picture: it makes a new design)' : 'Choose…'}</option>}
                  {fileList.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <div className="text-[12.5px] text-muted">{p.output === 'markdown' || p.output === 'text' ? 'The answer is shown here (copy it, or use the top-bar AI inside a document to insert it).' : 'A new file in My Files.'}</div>
            )}
            <label className="block">
              <span className="mb-1 block text-[12px] font-medium text-ink-2">Model</span>
              <select value={model} onChange={(e) => setModel(e.target.value)} className={field} aria-label="Model">
                <option value="">Automatic ({status?.perApp?.[p.app] || '—'})</option>
                {status?.models.map((m) => (
                  <option key={m.name} value={m.name}>
                    {m.name} ({m.parameters ?? '?'}
                    {m.vision ? ', vision' : ''})
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary" icon={<Play size={14} />} onClick={start} loading={a.start.isPending} disabled={!!running || !status?.reachable || (usesRequest && !request.trim() && !vars.selection?.trim()) || (needsTarget && !targetId)} data-testid="ws-run">
              {p.output === 'layers' ? 'Make the text editable' : 'Run'}
            </Button>
            {p.output === 'layers' && (
              <>
                <Button variant="secondary" icon={<Upload size={14} />} disabled={!!running} onClick={() => fileInput.current?.click()} data-testid="ws-import" title={targetId ? 'Added as a new slide of the chosen presentation' : 'A new design in the picture’s own shape'}>
                  Bring in a picture (ChatGPT, Gemini…)
                </Button>
                <input ref={fileInput} type="file" accept="image/*" hidden onChange={(e) => (e.target.files?.[0] && void importPicture(e.target.files[0]), (e.target.value = ''))} />
              </>
            )}
            <span className="text-[11.5px] text-muted">{OUTPUT_LABEL[p.output]} · temperature {p.temperature}</span>
          </div>
        </div>
      </div>

      {/* Live run + history */}
      <div className="space-y-4">
        <div className="card p-4" data-testid="ws-live">
          <div className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-subtle">Run</div>
          {!job ? (
            <p className="text-[12.5px] text-muted">Nothing running. Local models on a CPU: a workflow ~30–60 s, a design ~15 s, a workbook 3–4 min, reading a picture 3–5 min.</p>
          ) : (
            <JobView job={job} onOpen={(u) => router.push(u)} onCancel={() => a.cancel.mutate(job.id)} />
          )}
        </div>
        <div className="card p-4">
          <div className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide text-subtle">
            <Clock size={13} /> History
          </div>
          <ul className="divide-y divide-line" data-testid="ws-history">
            {(jobs ?? []).map((j) => (
              <li key={j.id} className="flex items-center gap-2 py-2 text-[12.5px]">
                <StatusDot s={j.status} />
                <button onClick={() => setViewing(j)} className="min-w-0 flex-1 text-left">
                  <div className="truncate text-ink">{String(j.result?.title ?? '') || j.request || j.promptKey}</div>
                  <div className="truncate text-[11px] text-muted">
                    {tasks.find((t) => t.key === j.promptKey)?.name ?? j.promptKey} · {j.model ?? '—'} · {secs(j.elapsedMs)} · {j.tokens} tok · {formatDateTime(j.createdAt)}
                  </div>
                </button>
                {j.result?.url && (
                  <button onClick={() => router.push(String(j.result!.url))} className="grid size-7 place-items-center rounded text-muted hover:bg-hover hover:text-ink" aria-label="Open the result">
                    <ExternalLink size={14} />
                  </button>
                )}
                <button
                  onClick={() => (setKey(j.promptKey), setRequest(j.request), window.scrollTo({ top: 0, behavior: 'smooth' }))}
                  className="grid size-7 place-items-center rounded text-muted hover:bg-hover hover:text-ink"
                  aria-label="Run again"
                  title="Run again with the same request"
                >
                  <RotateCcw size={14} />
                </button>
              </li>
            ))}
            {!jobs?.length && <li className="py-2 text-[12.5px] text-muted">No runs yet.</li>}
          </ul>
        </div>
        {viewing && (
          <div className="card p-4" data-testid="ws-detail">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-[12px] font-semibold uppercase tracking-wide text-subtle">Run details</div>
              <button onClick={() => setViewing(null)} className="text-[12px] text-muted hover:text-ink">
                Close
              </button>
            </div>
            <JobView job={viewing} onOpen={(u) => router.push(u)} />
            <div className="mt-2 text-[11.5px] text-muted">Request: {viewing.request || '—'}</div>
          </div>
        )}
      </div>
    </section>
  );
}

function StatusDot({ s }: { s: AiJob['status'] }) {
  return <span className={cn('size-2 shrink-0 rounded-full', s === 'done' ? 'bg-emerald-500' : s === 'failed' ? 'bg-red-500' : s === 'cancelled' ? 'bg-line-strong' : 'bg-amber-500')} />;
}

function JobView({ job, onOpen, onCancel }: { job: AiJob; onOpen: (url: string) => void; onCancel?: () => void }) {
  const running = ['queued', 'running'].includes(job.status);
  const notes = [...((job.result?.fixes as string[] | undefined) ?? []), ...((job.result?.warnings as string[] | undefined) ?? [])];
  const text = String(job.result?.text ?? '');
  return (
    <div className="space-y-2" data-status={job.status} data-testid="ws-job">
      <div className="flex items-center gap-2 text-[13px]">
        {running ? <Loader2 size={15} className="animate-spin text-brand-600" /> : job.status === 'done' ? <CheckCircle2 size={15} className="text-emerald-600" /> : <CircleAlert size={15} className="text-red-600" />}
        <span className="font-medium text-ink">{job.status === 'queued' ? `Waiting (${job.queuePosition} in line)` : job.status === 'running' ? 'Running…' : job.status === 'done' ? 'Done' : job.status === 'cancelled' ? 'Stopped' : 'Failed'}</span>
        <span className="ml-auto tabular-nums text-[12px] text-muted">
          {secs(job.elapsedMs)} · {job.tokens} tokens{job.elapsedMs > 3000 && job.tokens ? ` · ${(job.tokens / (job.elapsedMs / 1000)).toFixed(1)}/s` : ''}
        </span>
      </div>
      {job.model && <div className="text-[11.5px] text-muted">Model: {job.model}</div>}
      {job.error && <p className="text-[12.5px] text-red-700">{job.error}</p>}
      {job.status === 'done' && job.result?.url && (
        <div className="flex flex-wrap items-center gap-2">
          <b className="text-[13px] text-ink">{String(job.result.title ?? 'Result')}</b>
          <Button size="sm" variant="primary" icon={job.output === 'layers' ? <Layers size={13} /> : job.output === 'image' ? <ImageIcon size={13} /> : <ExternalLink size={13} />} onClick={() => onOpen(String(job.result!.url))} data-testid="ws-open">
            Open
          </Button>
          {job.result.removedBy ? <span className="text-[11.5px] text-muted">text removed by {String(job.result.removedBy)}</span> : null}
        </div>
      )}
      {job.status === 'done' && Array.isArray(job.result?.changes) && (
        <ul className="space-y-0.5 text-[12px]" data-testid="ws-changes">
          {(job.result.changes as { from: string; to: string }[]).map((c, i) => (
            <li key={i}>
              <s className="text-muted">{c.from}</s> → <b className="text-ink">{c.to}</b>
            </li>
          ))}
        </ul>
      )}
      {notes.length > 0 && (
        <ul className="list-disc pl-4 text-[11.5px] text-muted">
          {notes.slice(0, 8).map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
      {text && <div className="max-h-80 overflow-y-auto rounded-lg border border-line bg-canvas p-3 text-[13px] leading-relaxed text-ink [&_li]:ml-4 [&_li]:list-disc" dangerouslySetInnerHTML={{ __html: markdownToHtml(text) }} />}
      {(job.partial || running) && !text && <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded bg-canvas p-2 font-mono text-[10.5px] text-ink-2">{job.partial || '…'}</pre>}
      {running && onCancel && (
        <Button size="sm" variant="ghost" icon={<Square size={12} />} onClick={onCancel} data-testid="ws-cancel">
          Stop
        </Button>
      )}
    </div>
  );
}
