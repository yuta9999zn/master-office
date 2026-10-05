'use client';

import { answerText, isCorrect, isQuestion, nextPage, pagesOf, validateAnswer, type Answer, type Answers, type FileAnswer, type FormItem, type PlainForm } from '@workos/form-model';
import { CheckCircle2, Clock, Loader2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, api, API_ORIGIN } from '@/lib/api';
import { cn } from '../ui/primitives';
import { AnswerInput, embedUrl } from './AnswerInput';

interface PublicView {
  form: PlainForm;
  closed: string | null;
  respondent: { name: string; email: string } | null;
  existing: { id: string; answers: Answers; email: string | null } | null;
  alreadyResponded: boolean;
}
interface Receipt {
  id: string;
  confirmation: string;
  editToken: string | null;
  score: { points: number; max: number } | null;
  resultToken: string | null;
  showSummary: boolean;
}

const draftKey = (id: string) => `mo-form-draft-${id}`;

/** Respondent page (/f/:id): sections with branching, validation, file uploads, quiz score, edit link. */
export function FormRespond({ formId, editToken, prefill, summary }: { formId: string; editToken: string | null; prefill: Record<string, string>; summary: boolean }) {
  const [view, setView] = useState<PublicView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Answers>({});
  const [email, setEmail] = useState('');
  const [page, setPage] = useState(0);
  const [history, setHistory] = useState<number[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [sendCopy, setSendCopy] = useState(false);
  const seed = useRef(Math.random().toString(36)).current;

  useEffect(() => {
    api<PublicView>(`/forms/${formId}/public${editToken ? `?edit=${encodeURIComponent(editToken)}` : ''}`)
      .then((v) => {
        setView(v);
        let initial: Answers = {};
        try {
          initial = JSON.parse(localStorage.getItem(draftKey(formId)) ?? '{}');
        } catch {
          /* storage unavailable */
        }
        if (v.existing) initial = v.existing.answers;
        // Pre-filled link: ?entry.<itemId>=value (repeat the key for checkboxes).
        for (const [k, val] of Object.entries(prefill)) {
          const it = v.form.items.find((i) => i.id === k);
          if (!it) continue;
          initial[k] = it.type === 'checkbox' ? val.split('\u0000') : it.type === 'scale' || it.type === 'rating' ? Number(val) : val;
        }
        setAnswers(initial);
        if (v.existing?.email) setEmail(v.existing.email);
      })
      .catch((e) => setError((e as Error).message));
  }, [formId, editToken]); // eslint-disable-line react-hooks/exhaustive-deps

  // Draft autosave on this device (not for edits of a submitted response).
  useEffect(() => {
    if (!view || editToken || receipt) return;
    try {
      localStorage.setItem(draftKey(formId), JSON.stringify(answers));
    } catch {
      /* storage unavailable */
    }
  }, [answers, view, formId, editToken, receipt]);

  const form = view?.form;
  const pages = useMemo(() => (form ? pagesOf(form) : []), [form]);
  const items = useMemo(() => {
    const list = pages[page]?.items ?? [];
    if (!form?.settings.shuffle) return list;
    // Shuffle questions within the page, keep titles/images/videos in place relative order.
    const qs = list.filter((i) => isQuestion(i.type));
    let h = 0;
    for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) | 0;
    const shuffled = [...qs].sort((a, b) => ((h ^ hash(a.id)) % 97) - ((h ^ hash(b.id)) % 97));
    let k = 0;
    return list.map((i) => (isQuestion(i.type) ? shuffled[k++] : i));
  }, [pages, page, form, seed]);

  if (error) return <Shell color="#4F46E5" background="#EEF2FF"><Card><p className="text-[14px] text-slate-700">{error}</p></Card></Shell>;
  if (!view || !form) {
    return (
      <Shell color="#4F46E5" background="#EEF2FF">
        <Card>
          <Loader2 className="mx-auto animate-spin text-slate-400" />
        </Card>
      </Shell>
    );
  }
  const theme = form.theme;
  const s = form.settings;
  if (summary) return <SummaryView formId={formId} form={form} />;

  const header = (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      {theme.header && <img src={theme.header} alt="" className="h-40 w-full object-cover" />}
      <div className="h-2.5" style={{ background: theme.color }} />
      <div className="px-6 py-5">
        <h1 className="text-[30px] leading-tight text-slate-900" style={{ fontFamily: theme.font }} data-testid="respond-title">
          {form.title}
        </h1>
        {form.description && page === 0 && !receipt && <p className="mt-3 whitespace-pre-wrap text-[14px] text-slate-700">{form.description}</p>}
        {!receipt && (
          <div className="mt-4 border-t border-slate-200 pt-3 text-[13px] text-slate-600">
            {s.collectEmail === 'verified' && view.respondent && (
              <div>
                <b>{view.respondent.email}</b> — your email is recorded with your response
              </div>
            )}
            <div className="mt-1 text-red-600">* Indicates required question</div>
          </div>
        )}
      </div>
    </div>
  );

  if (view.closed && !view.existing) {
    return (
      <Shell color={theme.color} background={theme.background}>
        {header}
        <Card>
          <p className="text-[14px] text-slate-700" data-testid="form-closed">
            {view.closed}
          </p>
        </Card>
      </Shell>
    );
  }
  if (view.alreadyResponded && s.limitOne && !view.existing && !receipt) {
    return (
      <Shell color={theme.color} background={theme.background}>
        {header}
        <Card>
          <p className="text-[14px] text-slate-700" data-testid="already-responded">
            You’ve already responded. You can fill out this form only once.
          </p>
        </Card>
      </Shell>
    );
  }

  if (receipt) {
    return (
      <Shell color={theme.color} background={theme.background}>
        {header}
        <Card>
          <div className="flex items-start gap-3" data-testid="form-confirmation">
            <CheckCircle2 className="mt-0.5 shrink-0" style={{ color: theme.color }} />
            <div className="space-y-3 text-[14px] text-slate-800">
              <p>{receipt.confirmation}</p>
              {receipt.score && (
                <p className="text-[18px] font-medium" data-testid="form-score">
                  Score: {receipt.score.points} / {receipt.score.max}
                </p>
              )}
              {receipt.score && s.showCorrect && (
                <div className="space-y-2 border-t border-slate-200 pt-3">
                  {form.items
                    .filter((i) => isQuestion(i.type) && i.quiz?.points)
                    .map((i) => {
                      const ok = isCorrect(i, answers[i.id]);
                      const fb = ok ? i.quiz?.feedbackCorrect : i.quiz?.feedbackWrong;
                      return (
                        <div key={i.id} className={cn('rounded px-3 py-2 text-[13px]', ok ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-800')}>
                          {ok ? '✓' : '✗'} {i.title}
                          {fb && <div className="mt-0.5 text-slate-700">{fb}</div>}
                        </div>
                      );
                    })}
                </div>
              )}
              <div className="flex flex-wrap gap-4 pt-1 text-[14px]">
                {receipt.resultToken && !receipt.score && (
                  <a href={`/f/${formId}?result=${receipt.resultToken}`} className="underline" style={{ color: theme.color }} data-testid="view-score-link">
                    View score
                  </a>
                )}
                {receipt.editToken && (
                  <a href={`/f/${formId}?edit=${receipt.editToken}`} className="underline" style={{ color: theme.color }} data-testid="edit-link">
                    Edit your response
                  </a>
                )}
                {receipt.showSummary && (
                  <a href={`/f/${formId}?view=summary`} className="underline" style={{ color: theme.color }}>
                    See previous responses
                  </a>
                )}
                {!s.limitOne && (
                  <button onClick={() => (setReceipt(null), setAnswers({}), setPage(0), setHistory([]))} className="underline" style={{ color: theme.color }}>
                    Submit another response
                  </button>
                )}
              </div>
            </div>
          </div>
        </Card>
      </Shell>
    );
  }

  const check = () => {
    const errs: Record<string, string> = {};
    for (const it of items) {
      const e = validateAnswer(it, answers[it.id]);
      if (e) errs[it.id] = e;
    }
    if (s.collectEmail === 'input' && page === 0 && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errs.__email = 'Enter a valid email address';
    setErrors(errs);
    const first = Object.keys(errs)[0];
    if (first) document.querySelector(`[data-question="${first}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    return !first;
  };
  const next = nextPage(form, pages, page, answers);
  const submit = async () => {
    if (!check()) return;
    setSubmitting(true);
    try {
      const res = await api<Receipt>(`/forms/${formId}/responses`, { method: 'POST', json: { answers, email: s.collectEmail === 'input' ? email : null, editToken, sendCopy } });
      setReceipt(res);
      try {
        localStorage.removeItem(draftKey(formId));
      } catch {
        /* ignore */
      }
      window.scrollTo({ top: 0 });
    } catch (e) {
      const body = e instanceof ApiError ? e.message : (e as Error).message;
      setErrors((x) => ({ ...x, __form: body }));
    } finally {
      setSubmitting(false);
    }
  };
  const upload = async (file: File): Promise<FileAnswer> => {
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch(`${API_ORIGIN}/forms/${formId}/uploads`, { method: 'POST', body: fd, credentials: 'include' });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? 'Upload failed');
    return res.json();
  };
  const progress = pages.length > 1 ? Math.round(((page + (next === -1 ? 1 : 0)) / pages.length) * 100) : 0;

  return (
    <Shell color={theme.color} background={theme.background}>
      {page === 0 && header}
      {page > 0 && pages[page].section && (
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="px-6 py-3 text-[13px] font-medium text-white" style={{ background: theme.color }}>
            {form.title}
          </div>
          <div className="px-6 py-4">
            <h2 className="text-[20px] text-slate-900">{pages[page].section!.title}</h2>
            {pages[page].section!.description && <p className="mt-2 whitespace-pre-wrap text-[14px] text-slate-700">{pages[page].section!.description}</p>}
          </div>
        </div>
      )}
      {s.collectEmail === 'input' && page === 0 && (
        <Card error={errors.__email} id="__email">
          <label className="block text-[15px] text-slate-900">
            Email <span className="text-red-600">*</span>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Your email" className="mt-3 block w-full max-w-md border-0 border-b border-slate-300 py-1.5 text-[14px] outline-none focus:border-b-2" aria-label="Email" />
          </label>
        </Card>
      )}
      {items.map((it) => (
        <ItemBlock key={it.id} it={it} value={answers[it.id]} error={errors[it.id]} color={theme.color} seed={seed} onUpload={upload} onChange={(v) => (setAnswers((a) => ({ ...a, [it.id]: v })), errors[it.id] && setErrors((x) => ({ ...x, [it.id]: '' })))} />
      ))}
      {next === -1 && s.collectEmail !== 'off' && s.sendCopy !== 'off' && (
        <div className="px-1 text-[13px] text-slate-700">
          {s.sendCopy === 'requested' ? (
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={sendCopy} onChange={(e) => setSendCopy(e.target.checked)} style={{ accentColor: theme.color }} data-testid="send-copy" />
              Send me a copy of my responses
            </label>
          ) : (
            <span>A copy of your responses will be emailed to {s.collectEmail === 'verified' ? view.respondent?.email ?? 'your address' : 'the address you provided'}.</span>
          )}
        </div>
      )}
      {errors.__form && <div className="rounded-lg bg-red-50 px-4 py-3 text-[14px] text-red-700">{errors.__form}</div>}
      <div className="flex items-center gap-3 pb-10">
        {history.length > 0 && (
          <button onClick={() => (setPage(history[history.length - 1]), setHistory(history.slice(0, -1)), window.scrollTo({ top: 0 }))} className="h-9 rounded-md border border-slate-300 bg-white px-5 text-[14px] font-medium" style={{ color: theme.color }}>
            Back
          </button>
        )}
        {next === -1 ? (
          <button disabled={submitting} onClick={submit} className="flex h-9 items-center gap-2 rounded-md px-6 text-[14px] font-medium text-white disabled:opacity-60" style={{ background: theme.color }} data-testid="form-submit">
            {submitting && <Loader2 size={14} className="animate-spin" />}
            {editToken ? 'Save changes' : 'Submit'}
          </button>
        ) : (
          <button onClick={() => check() && (setHistory([...history, page]), setPage(next), window.scrollTo({ top: 0 }))} className="h-9 rounded-md px-6 text-[14px] font-medium text-white" style={{ background: theme.color }} data-testid="form-next">
            Next
          </button>
        )}
        {s.progressBar && pages.length > 1 && (
          <div className="ml-auto flex items-center gap-2 text-[12px] text-slate-600">
            <div className="h-2.5 w-40 overflow-hidden rounded-full bg-slate-200">
              <div className="h-full rounded-full" style={{ width: `${progress}%`, background: theme.color }} />
            </div>
            Page {page + 1} of {pages.length}
          </div>
        )}
        <button
          onClick={() => {
            setAnswers({});
            setErrors({});
          }}
          className="text-[13px] font-medium"
          style={{ color: theme.color, marginLeft: s.progressBar && pages.length > 1 ? 0 : 'auto' }}
        >
          Clear form
        </button>
      </div>
    </Shell>
  );
}

const hash = (s: string) => {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return Math.abs(h);
};

function ItemBlock({ it, value, error, color, seed, onChange, onUpload }: { it: FormItem; value: Answer | undefined; error?: string; color: string; seed: string; onChange: (v: Answer) => void; onUpload: (f: File) => Promise<FileAnswer> }) {
  if (it.type === 'text') {
    return (
      <Card>
        <div className="text-[20px] text-slate-900">{it.title}</div>
        {it.description && <p className="mt-2 whitespace-pre-wrap text-[14px] text-slate-700">{it.description}</p>}
      </Card>
    );
  }
  if (it.type === 'image') {
    return (
      <Card>
        {it.title && <div className="mb-3 text-[15px] text-slate-900">{it.title}</div>}
        {it.image?.src && <img src={it.image.src} alt={it.image.alt ?? ''} className="max-w-full rounded" />}
      </Card>
    );
  }
  if (it.type === 'video') {
    const src = it.video?.url ? embedUrl(it.video.url) : null;
    return <Card>{src && <iframe src={src} className="aspect-video w-full rounded" allowFullScreen title={it.title || 'Video'} />}</Card>;
  }
  return (
    <Card error={error} id={it.id}>
      <div className="mb-1 text-[15px] text-slate-900">
        {it.title}
        {it.required && <span className="ml-1 text-red-600">*</span>}
        {it.quiz?.points ? <span className="ml-2 text-[12px] text-slate-500">{it.quiz.points} point{it.quiz.points === 1 ? '' : 's'}</span> : null}
      </div>
      {it.description && <p className="mb-2 whitespace-pre-wrap text-[13px] text-slate-600">{it.description}</p>}
      <div className="mt-3">
        <AnswerInput item={it} value={value} onChange={onChange} color={color} seed={seed} onUpload={onUpload} />
      </div>
    </Card>
  );
}

function Card({ children, error, id }: { children: React.ReactNode; error?: string; id?: string }) {
  return (
    <div className={cn('rounded-lg border bg-white px-6 py-5 shadow-sm', error ? 'border-red-400' : 'border-slate-200')} data-question={id} data-testid={id && id !== '__email' ? 'respond-question' : undefined}>
      {children}
      {error && <div className="mt-3 text-[13px] text-red-600">ⓘ {error}</div>}
    </div>
  );
}

function Shell({ color, background, children }: { color: string; background: string; children: React.ReactNode }) {
  return (
    <div className="min-h-screen py-6" style={{ background }}>
      <main className="mx-auto max-w-[680px] space-y-3 px-3" style={{ ['--form-color' as string]: color }}>
        {children}
        <p className="pb-6 text-center text-[12px] text-slate-500">This content is created by the owner of the form. Never submit passwords through Master Office Forms.</p>
      </main>
    </div>
  );
}

function SummaryView({ formId, form }: { formId: string; form: PlainForm }) {
  const [data, setData] = useState<{ total: number; counts: Record<string, Record<string, number>> } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    api<{ total: number; counts: Record<string, Record<string, number>> }>(`/forms/${formId}/public/summary`).then(setData, (e) => setErr((e as Error).message));
  }, [formId]);
  return (
    <Shell color={form.theme.color} background={form.theme.background}>
      <Card>
        <h1 className="text-[26px]">{form.title}</h1>
        <p className="mt-1 text-[14px] text-slate-600">{err ?? (data ? `${data.total} responses` : 'Loading…')}</p>
      </Card>
      {data &&
        form.items
          .filter((i) => data.counts[i.id])
          .map((i) => {
            const c = data.counts[i.id];
            const max = Math.max(1, ...Object.values(c));
            return (
              <Card key={i.id}>
                <div className="mb-3 text-[15px]">{i.title}</div>
                {Object.entries(c)
                  .sort((a, b) => b[1] - a[1])
                  .map(([k, n]) => (
                    <div key={k} className="mb-1.5 grid grid-cols-[160px_1fr_40px] items-center gap-3 text-[13px]">
                      <span className="truncate">{k}</span>
                      <div className="h-5 rounded bg-slate-100">
                        <div className="h-5 rounded" style={{ width: `${(n / max) * 100}%`, background: form.theme.color }} />
                      </div>
                      <span className="text-right tabular-nums">{n}</span>
                    </div>
                  ))}
              </Card>
            );
          })}
    </Shell>
  );
}

interface QuizResult {
  form: PlainForm;
  released: boolean;
  score: { points: number; max: number } | null;
  questions: { id: string; answer: Answer; points: number | null; max: number; correct: boolean | null; feedback: string | null; correctAnswers: string[] | null }[];
}

/** "View score" (§63): the respondent's graded answers, opened from the receipt or the score e-mail (?result=token). */
export function FormResult({ formId, token }: { formId: string; token: string }) {
  const [data, setData] = useState<QuizResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    api<QuizResult>(`/forms/${formId}/public/result?token=${encodeURIComponent(token)}`).then(setData, (e) => setErr((e as Error).message));
  }, [formId, token]);
  if (err) return <Shell color="#4F46E5" background="#EEF2FF"><Card><p className="text-[14px] text-slate-700">{err}</p></Card></Shell>;
  if (!data) return <Shell color="#4F46E5" background="#EEF2FF"><Card><Loader2 className="mx-auto animate-spin text-slate-400" /></Card></Shell>;
  const { form } = data;
  const theme = form.theme;
  const byId = new Map(form.items.map((i) => [i.id, i]));
  return (
    <Shell color={theme.color} background={theme.background}>
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        {theme.header && <img src={theme.header} alt="" className="h-40 w-full object-cover" />}
        <div className="h-2.5" style={{ background: theme.color }} />
        <div className="px-6 py-5">
          <h1 className="text-[30px] leading-tight text-slate-900" style={{ fontFamily: theme.font }}>{form.title}</h1>
          {data.released && data.score ? (
            <p className="mt-3 text-[22px] font-medium" data-testid="result-score">
              Total points: {data.score.points} / {data.score.max}
            </p>
          ) : (
            <p className="mt-3 flex items-center gap-2 text-[14px] text-slate-700" data-testid="result-pending">
              <Clock size={16} /> Your score hasn’t been released yet. You’ll get an e-mail when it is.
            </p>
          )}
        </div>
      </div>
      {data.questions.map((q) => {
        const it = byId.get(q.id);
        if (!it) return null;
        return (
          <div key={q.id} className={cn('rounded-lg border bg-white px-6 py-5 shadow-sm', q.correct === true ? 'border-emerald-300' : q.correct === false ? 'border-red-300' : 'border-slate-200')} data-testid="result-question">
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1 text-[15px] text-slate-900">{it.title}</div>
              {q.points !== null && (
                <span className={cn('shrink-0 text-[13px] font-medium', q.correct ? 'text-emerald-700' : 'text-red-700')}>
                  {q.points} / {q.max}
                </span>
              )}
            </div>
            <div className="mt-2 text-[14px] text-slate-700">{answerText(it, q.answer) || <span className="text-slate-400">(no answer)</span>}</div>
            {q.correctAnswers && q.correct !== true && <div className="mt-2 rounded bg-emerald-50 px-3 py-1.5 text-[13px] text-emerald-800">Correct answer: {q.correctAnswers.join(', ')}</div>}
            {q.feedback && <div className="mt-2 rounded bg-slate-50 px-3 py-1.5 text-[13px] text-slate-700" data-testid="result-feedback">Feedback: {q.feedback}</div>}
          </div>
        );
      })}
    </Shell>
  );
}
