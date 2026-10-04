'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Eye, EyeOff, MessageCircleQuestion, MonitorUp, ThumbsUp } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { cn } from '../ui/primitives';

// Audience Q&A (Google Slides: Presenter view ▸ Audience tools). docs/ARCHITECTURE.md §55.
// Presenter view starts / stops a session and moderates; the slide show shows the link and the question being
// presented; the audience page (/qa/<token>) asks and upvotes. Everyone polls every 3 s.

interface Question {
  id: string;
  text: string;
  authorName: string | null;
  votes: number;
  hidden: boolean;
  createdAt: string;
  voted: boolean;
}
interface QaState {
  session: { id: string; token: string; startedAt: string; presenting: string | null } | null;
  questions: Question[];
}

const POLL = 3000;
export const qaLink = (token: string) => `${typeof window !== 'undefined' ? window.location.origin : ''}/qa/${token}`;

export function useQaState(resourceId: string, enabled = true) {
  return useQuery({ queryKey: ['qa', resourceId], queryFn: () => api<QaState>(`/resources/${resourceId}/qa`), refetchInterval: POLL, enabled });
}

/** Presenter view panel: start / stop, the link, questions by votes with Present and Hide. */
export function QaPresenterPanel({ resourceId }: { resourceId: string }) {
  const qc = useQueryClient();
  const { data } = useQaState(resourceId);
  const refresh = () => qc.invalidateQueries({ queryKey: ['qa', resourceId] });
  const start = useMutation({ mutationFn: () => api(`/resources/${resourceId}/qa`, { method: 'POST' }), onSuccess: refresh, onError: (e) => toast.error((e as Error).message) });
  const stop = useMutation({ mutationFn: () => api(`/resources/${resourceId}/qa`, { method: 'DELETE' }), onSuccess: refresh });
  const moderate = (id: string, patch: { presenting?: boolean; hidden?: boolean }) => void api(`/qa-questions/${id}`, { method: 'PATCH', json: patch }).then(refresh, (e: Error) => toast.error(e.message));
  const s = data?.session;
  if (!s)
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-lg bg-white/5 p-6 text-center" data-testid="qa-panel">
        <MessageCircleQuestion size={28} className="text-sky-400" />
        <p className="text-[14px] text-slate-300">Let the audience ask and upvote questions from their phones while you present.</p>
        <button onClick={() => start.mutate()} className="rounded-lg bg-sky-600 px-4 py-2 text-[13px] hover:bg-sky-500" data-testid="qa-start">
          Start new Q&A
        </button>
      </div>
    );
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 rounded-lg bg-white/5 p-3" data-testid="qa-panel">
      <div className="flex items-center gap-2">
        <span className="text-[12px] text-slate-400">Audience link</span>
        <code className="min-w-0 flex-1 truncate rounded bg-black/30 px-2 py-1 text-[13px] text-sky-300" data-testid="qa-link">
          {qaLink(s.token)}
        </code>
        <button onClick={() => stop.mutate()} className="rounded-md bg-white/10 px-2.5 py-1 text-[12px] hover:bg-white/20" data-testid="qa-stop">
          Stop
        </button>
      </div>
      <div className="text-[12px] text-slate-400">{data.questions.length} question{data.questions.length === 1 ? '' : 's'}</div>
      <ul className="min-h-0 flex-1 space-y-1.5 overflow-y-auto">
        {data.questions.map((q) => {
          const on = s.presenting === q.id;
          return (
            <li key={q.id} className={cn('rounded-lg p-2.5', on ? 'bg-sky-600/30 ring-1 ring-sky-400' : 'bg-white/5', q.hidden && 'opacity-50')} data-testid="qa-question">
              <div className="text-[15px] leading-snug">{q.text}</div>
              <div className="mt-1.5 flex items-center gap-2 text-[12px] text-slate-400">
                <ThumbsUp size={12} /> {q.votes} · {q.authorName ?? 'Anonymous'}
                <button onClick={() => moderate(q.id, { presenting: !on })} disabled={q.hidden} className={cn('ml-auto flex items-center gap-1 rounded-md px-2 py-0.5 disabled:opacity-40', on ? 'bg-sky-500 text-white' : 'bg-white/10 hover:bg-white/20')} aria-label={on ? 'Stop presenting this question' : 'Present this question'}>
                  <MonitorUp size={12} /> {on ? 'Presenting' : 'Present'}
                </button>
                <button onClick={() => moderate(q.id, { hidden: !q.hidden })} className="rounded-md bg-white/10 p-1 hover:bg-white/20" aria-label={q.hidden ? 'Show question' : 'Hide question'}>
                  {q.hidden ? <Eye size={12} /> : <EyeOff size={12} />}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** On the slide show: the link while a session is open, and the question being presented. */
export function QaOverlay({ resourceId }: { resourceId: string }) {
  const { data } = useQaState(resourceId);
  const s = data?.session;
  if (!s) return null;
  const q = data.questions.find((x) => x.id === s.presenting);
  return (
    <>
      <div className="pointer-events-none fixed left-1/2 top-3 z-20 -translate-x-1/2 rounded-full bg-black/70 px-4 py-1.5 text-[15px] text-white" data-testid="qa-banner">
        Ask a question at <b className="font-semibold text-sky-300">{qaLink(s.token).replace(/^https?:\/\//, '')}</b>
      </div>
      {q && (
        <div className="pointer-events-none fixed inset-0 z-10 flex items-center justify-center bg-black/55 p-[8vw]" data-testid="qa-presented">
          <div className="max-w-[1100px] rounded-2xl bg-white p-[3vw] text-slate-900 shadow-2xl">
            <div className="mb-3 flex items-center gap-2 text-[1.6vw] text-slate-500">
              <MessageCircleQuestion className="size-[2vw] text-sky-600" /> {q.authorName ?? 'Anonymous'} asked · <ThumbsUp className="size-[1.6vw]" /> {q.votes}
            </div>
            <div className="text-[3.2vw] font-semibold leading-tight">{q.text}</div>
          </div>
        </div>
      )}
    </>
  );
}

const VOTER_KEY = 'mo:qa-voter';
function voterId() {
  try {
    let v = localStorage.getItem(VOTER_KEY);
    if (!v) localStorage.setItem(VOTER_KEY, (v = crypto.randomUUID()));
    return v;
  } catch {
    return crypto.randomUUID();
  }
}

/** The audience page: ask (with your name or anonymously), upvote, see what others asked. */
export function QaAudience({ token }: { token: string }) {
  const [voter, setVoter] = useState<string | null>(null);
  useEffect(() => setVoter(voterId()), []);
  const qc = useQueryClient();
  const key = ['qa-audience', token, voter];
  const { data, error } = useQuery({ queryKey: key, queryFn: () => api<{ title: string; open: boolean; questions: Question[] }>(`/qa/${token}?voter=${voter}`), refetchInterval: POLL, enabled: !!voter });
  const [text, setText] = useState('');
  const [anonymous, setAnonymous] = useState(true);
  const ask = useMutation({
    mutationFn: () => api(`/qa/${token}/questions`, { method: 'POST', json: { text, anonymous, voter } }),
    onSuccess: () => (setText(''), qc.invalidateQueries({ queryKey: key }), toast.success('Question sent')),
    onError: (e) => toast.error((e as Error).message),
  });
  const vote = (id: string) => void api(`/qa/${token}/questions/${id}/vote`, { method: 'POST', json: { voter } }).then(() => qc.invalidateQueries({ queryKey: key }), (e: Error) => toast.error(e.message));
  if (error) return <div className="flex min-h-screen items-center justify-center p-6 text-slate-600">{(error as Error).message}</div>;
  return (
    <div className="min-h-screen bg-slate-50" data-testid="qa-audience">
      <div className="mx-auto max-w-xl p-4">
        <div className="mb-4 flex items-center gap-2 pt-4">
          <MessageCircleQuestion className="text-sky-600" />
          <div>
            <div className="text-[12px] text-slate-500">Audience Q&A</div>
            <h1 className="text-[18px] font-semibold text-slate-900">{data?.title ?? '…'}</h1>
          </div>
        </div>
        {data && !data.open ? (
          <div className="rounded-xl border border-slate-200 bg-white p-6 text-center text-slate-600" data-testid="qa-closed">
            This Q&A session has ended.
          </div>
        ) : (
          <>
            <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
              <textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={300} rows={3} placeholder="Ask a question" className="w-full resize-none bg-transparent text-[15px] outline-none" aria-label="Your question" />
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-1.5 text-[13px] text-slate-600">
                  <input type="checkbox" checked={anonymous} onChange={(e) => setAnonymous(e.target.checked)} /> Ask anonymously
                </label>
                <span className="ml-auto text-[12px] text-slate-400">{300 - text.length}</span>
                <button disabled={!text.trim() || ask.isPending} onClick={() => ask.mutate()} className="rounded-lg bg-sky-600 px-4 py-1.5 text-[14px] font-medium text-white disabled:opacity-40" data-testid="qa-submit">
                  Submit
                </button>
              </div>
            </div>
            <ul className="mt-4 space-y-2" data-testid="qa-list">
              {(data?.questions ?? []).map((q) => (
                <li key={q.id} className="flex gap-3 rounded-xl border border-slate-200 bg-white p-3">
                  <button onClick={() => vote(q.id)} className={cn('flex w-12 shrink-0 flex-col items-center rounded-lg py-1 text-[13px]', q.voted ? 'bg-sky-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200')} aria-label={`${q.voted ? 'Remove vote' : 'Upvote'}: ${q.text}`} aria-pressed={q.voted}>
                    <ThumbsUp size={15} />
                    {q.votes}
                  </button>
                  <div className="min-w-0">
                    <div className="text-[15px] text-slate-900">{q.text}</div>
                    <div className="mt-0.5 text-[12px] text-slate-500">{q.authorName ?? 'Anonymous'}</div>
                  </div>
                </li>
              ))}
              {data && !data.questions.length && <li className="p-4 text-center text-[13px] text-slate-500">No questions yet — be the first.</li>}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}


