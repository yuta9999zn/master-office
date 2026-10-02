'use client';

import { answerText, isCorrect, isQuestion, type Answer, type Answers, type FileAnswer, type FormItem, type PlainForm } from '@workos/form-model';
import { ChevronLeft, ChevronRight, Download, ExternalLink, Paperclip, Table2, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { formatDateTime } from '@/lib/format';
import { Button, cn, EmptyState } from '../ui/primitives';
import type { FormStore } from './form-store';

export interface FormResponseRow {
  id: string;
  respondent: string | null;
  email: string | null;
  answers: Answers;
  score: { points: number; max: number } | null;
  submittedAt: string;
}

const isOther = (x: unknown): x is { other: string } => !!x && typeof x === 'object' && 'other' in (x as object);

function Bars({ counts, total, color, order }: { counts: Record<string, number>; total: number; color: string; order?: string[] }) {
  const keys = order ? [...order, ...Object.keys(counts).filter((k) => !order.includes(k))] : Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
  const max = Math.max(1, ...Object.values(counts));
  return (
    <div className="space-y-2">
      {keys.map((k) => {
        const n = counts[k] ?? 0;
        return (
          <div key={k} className="grid grid-cols-[minmax(80px,200px)_1fr_auto] items-center gap-3 text-[13px]">
            <span className="truncate text-slate-700" title={k}>
              {k}
            </span>
            <div className="h-6 rounded bg-slate-100">
              <div className="h-6 rounded transition-all" style={{ width: `${(n / max) * 100}%`, background: color }} />
            </div>
            <span className="w-20 text-right tabular-nums text-slate-600">
              {n} ({total ? Math.round((n / total) * 100) : 0}%)
            </span>
          </div>
        );
      })}
    </div>
  );
}

function Columns({ counts, labels, color }: { counts: Record<string, number>; labels: string[]; color: string }) {
  const max = Math.max(1, ...Object.values(counts));
  return (
    <div className="flex h-40 items-end gap-2">
      {labels.map((l) => (
        <div key={l} className="flex flex-1 flex-col items-center gap-1 text-[12px]">
          <span className="tabular-nums text-slate-600">{counts[l] ?? 0}</span>
          <div className="w-full max-w-12 rounded-t" style={{ height: `${((counts[l] ?? 0) / max) * 110 + 2}px`, background: color }} />
          <span className="text-slate-600">{l}</span>
        </div>
      ))}
    </div>
  );
}

function countValues(rows: FormResponseRow[], it: FormItem) {
  const c: Record<string, number> = {};
  let answered = 0;
  for (const r of rows) {
    const a = r.answers[it.id];
    if (a === undefined || a === null || a === '' || (Array.isArray(a) && !a.length)) continue;
    answered++;
    for (const v of Array.isArray(a) ? a : [a]) {
      const k = isOther(v) ? 'Other' : String(v);
      c[k] = (c[k] ?? 0) + 1;
    }
  }
  return { c, answered };
}

function QuestionSummary({ it, rows, color, resourceId }: { it: FormItem; rows: FormResponseRow[]; color: string; resourceId: string }) {
  const { c, answered } = countValues(rows, it);
  const others = rows.flatMap((r) => { const a: unknown = r.answers[it.id]; return Array.isArray(a) ? (a as unknown[]) : [a]; }).filter(isOther).map((o) => o.other);
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5" data-testid="question-summary">
      <div className="text-[15px] text-slate-900">{it.title}</div>
      <div className="mb-4 text-[12px] text-slate-500">
        {answered} response{answered === 1 ? '' : 's'}
      </div>
      {['choice', 'checkbox', 'dropdown'].includes(it.type) ? (
        <>
          <Bars counts={c} total={it.type === 'checkbox' ? answered : answered} color={color} order={[...(it.options ?? []).map((o) => o.label), ...(it.other ? ['Other'] : [])]} />
          {others.length > 0 && <div className="mt-3 text-[12px] text-slate-500">Other: {others.join(' · ')}</div>}
        </>
      ) : it.type === 'scale' ? (
        <Columns counts={c} labels={Array.from({ length: (it.scale?.max ?? 5) - (it.scale?.min ?? 1) + 1 }, (_, i) => String((it.scale?.min ?? 1) + i))} color={color} />
      ) : it.type === 'rating' ? (
        <>
          <Columns counts={c} labels={Array.from({ length: it.rating?.max ?? 5 }, (_, i) => String(i + 1))} color={color} />
          <div className="mt-2 text-[13px] text-slate-700">
            Average: {answered ? (rows.reduce((s, r) => s + (typeof r.answers[it.id] === 'number' ? (r.answers[it.id] as number) : 0), 0) / answered).toFixed(2) : '–'} / {it.rating?.max ?? 5}
          </div>
        </>
      ) : it.type === 'choiceGrid' || it.type === 'checkboxGrid' ? (
        <table className="w-full text-[13px]">
          <thead>
            <tr>
              <th />
              {it.grid?.cols.map((col) => (
                <th key={col} className="px-2 pb-1 font-normal text-slate-600">
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {it.grid?.rows.map((row) => (
              <tr key={row} className="border-t border-slate-100">
                <td className="py-1.5 text-slate-700">{row}</td>
                {it.grid!.cols.map((col) => {
                  const n = rows.filter((r) => {
                    const v = (r.answers[it.id] as Record<string, string | string[]> | undefined)?.[row];
                    return Array.isArray(v) ? v.includes(col) : v === col;
                  }).length;
                  return (
                    <td key={col} className="text-center tabular-nums">
                      <span className="inline-block min-w-7 rounded px-1" style={{ background: n ? `${color}${Math.min(99, 20 + n * 15).toString().padStart(2, '0')}` : undefined }}>
                        {n}
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      ) : it.type === 'file' ? (
        <div className="space-y-1.5">
          {rows.flatMap((r) => ((r.answers[it.id] as FileAnswer[] | undefined) ?? []).map((f) => (
            <a key={f.blobId} href={`/api/resources/${resourceId}/assets/${f.blobId}`} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-[13px] text-blue-700 hover:underline">
              <Paperclip size={13} /> {f.name} <span className="text-slate-500">— {r.respondent ?? r.email ?? 'Anonymous'}</span>
            </a>
          )))}
        </div>
      ) : (
        <div className="max-h-60 space-y-1.5 overflow-y-auto">
          {rows
            .map((r) => answerText(it, r.answers[it.id]))
            .filter(Boolean)
            .map((t, i) => (
              <div key={i} className="rounded bg-slate-50 px-3 py-1.5 text-[13px] text-slate-800">
                {t}
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

export function ResponsesTab({
  form,
  store,
  rows,
  resourceId,
  editable,
  onDelete,
  onLinkSheet,
  linking,
}: {
  form: PlainForm;
  store: FormStore;
  rows: FormResponseRow[];
  resourceId: string;
  editable: boolean;
  onDelete: (ids: string[] | 'all') => void;
  onLinkSheet: () => void;
  linking: boolean;
}) {
  const [view, setView] = useState<'summary' | 'question' | 'individual'>('summary');
  const [qIndex, setQIndex] = useState(0);
  const [rIndex, setRIndex] = useState(0);
  const questions = useMemo(() => form.items.filter((i) => isQuestion(i.type)), [form.items]);
  const color = form.theme.color;
  const s = form.settings;
  const r = rows[Math.min(rIndex, rows.length - 1)];
  const q = questions[Math.min(qIndex, questions.length - 1)];
  const avg = s.quiz && rows.length ? rows.reduce((t, x) => t + (x.score?.points ?? 0), 0) / rows.length : null;
  const maxScore = rows.find((x) => x.score)?.score?.max ?? 0;

  return (
    <div className="space-y-3" data-testid="responses-tab">
      <div className="rounded-lg border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-center gap-3">
          <div className="text-[28px] font-normal text-slate-900" data-testid="response-count">
            {rows.length} response{rows.length === 1 ? '' : 's'}
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {s.sheetId ? (
              <Link href={`/sheets/${s.sheetId}`} className="flex h-8 items-center gap-1.5 rounded-md border border-emerald-600 px-3 text-[13px] font-medium text-emerald-700 hover:bg-emerald-50">
                <Table2 size={15} /> View in Sheets <ExternalLink size={12} />
              </Link>
            ) : (
              <Button size="sm" variant="soft" icon={<Table2 size={14} />} disabled={!editable} loading={linking} onClick={onLinkSheet} data-testid="link-sheet">
                Link to Sheets
              </Button>
            )}
            <a href={`/api/forms/${resourceId}/responses.csv`} className="flex h-8 items-center gap-1.5 rounded-md px-3 text-[13px] text-slate-700 hover:bg-slate-100">
              <Download size={14} /> CSV
            </a>
            {editable && rows.length > 0 && (
              <Button size="sm" variant="ghost" icon={<Trash2 size={14} />} className="text-red-600" onClick={() => onDelete('all')}>
                Delete all
              </Button>
            )}
          </div>
        </div>
        <label className="mt-3 flex items-center justify-end gap-2 text-[13px] text-slate-700">
          Accepting responses
          <button
            role="switch"
            aria-checked={s.accepting}
            disabled={!editable}
            onClick={() => store.setSettings({ accepting: !s.accepting })}
            className={cn('relative h-5 w-9 rounded-full transition', s.accepting ? '' : 'bg-slate-300')}
            style={s.accepting ? { background: color } : undefined}
            data-testid="accepting-toggle"
          >
            <span className={cn('absolute top-0.5 size-4 rounded-full bg-white shadow transition', s.accepting ? 'left-[18px]' : 'left-0.5')} />
          </button>
        </label>
        {!s.accepting && <div className="mt-2 rounded bg-slate-100 px-3 py-2 text-[13px] text-slate-600">{s.closedMessage}</div>}
        <div className="mt-4 flex justify-center gap-8 border-t border-slate-200 pt-1">
          {(['summary', 'question', 'individual'] as const).map((v) => (
            <button key={v} onClick={() => setView(v)} className={cn('border-b-[3px] px-2 py-2 text-[14px] capitalize', view === v ? 'font-medium' : 'border-transparent text-slate-600')} style={view === v ? { borderColor: color, color } : undefined}>
              {v}
            </button>
          ))}
        </div>
      </div>

      {!rows.length ? (
        <div className="rounded-lg border border-slate-200 bg-white p-10">
          <EmptyState title="Waiting for responses">Share the form with Send to start collecting answers. They appear here live.</EmptyState>
        </div>
      ) : view === 'summary' ? (
        <>
          {avg !== null && (
            <div className="rounded-lg border border-slate-200 bg-white p-5 text-[14px]">
              <div className="font-medium">Insights</div>
              <div className="mt-1 text-slate-700">
                Average {avg.toFixed(1)} / {maxScore} points
              </div>
            </div>
          )}
          {questions.map((it) => (
            <QuestionSummary key={it.id} it={it} rows={rows} color={color} resourceId={resourceId} />
          ))}
        </>
      ) : view === 'question' && q ? (
        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <div className="mb-4 flex items-center gap-2">
            <select value={qIndex} onChange={(e) => setQIndex(Number(e.target.value))} className="h-9 min-w-0 flex-1 rounded-md border border-slate-300 px-2 text-[14px]" aria-label="Question">
              {questions.map((it, i) => (
                <option key={it.id} value={i}>
                  {it.title}
                </option>
              ))}
            </select>
            <span className="text-[13px] text-slate-500">
              {qIndex + 1} of {questions.length}
            </span>
          </div>
          <div className="space-y-1.5">
            {rows.map((row) => (
              <div key={row.id} className="flex gap-3 rounded bg-slate-50 px-3 py-2 text-[13px]">
                <span className="min-w-0 flex-1">{answerText(q, row.answers[q.id]) || <span className="text-slate-400">(no answer)</span>}</span>
                <span className="text-slate-500">{row.respondent ?? row.email ?? 'Anonymous'}</span>
              </div>
            ))}
          </div>
        </div>
      ) : r ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-5 py-3 text-[13px]">
            <button disabled={rIndex === 0} onClick={() => setRIndex(rIndex - 1)} className="rounded p-1 hover:bg-slate-100 disabled:opacity-30" aria-label="Previous response">
              <ChevronLeft size={18} />
            </button>
            <span className="tabular-nums">
              {Math.min(rIndex, rows.length - 1) + 1} of {rows.length}
            </span>
            <button disabled={rIndex >= rows.length - 1} onClick={() => setRIndex(rIndex + 1)} className="rounded p-1 hover:bg-slate-100 disabled:opacity-30" aria-label="Next response">
              <ChevronRight size={18} />
            </button>
            <span className="ml-3 text-slate-700">{r.respondent ?? r.email ?? 'Anonymous'}</span>
            <span className="text-slate-500">· {formatDateTime(r.submittedAt)}</span>
            {r.score && (
              <span className="rounded bg-emerald-50 px-2 py-0.5 font-medium text-emerald-700">
                {r.score.points} / {r.score.max}
              </span>
            )}
            {editable && (
              <button onClick={() => (onDelete([r.id]), setRIndex(Math.max(0, rIndex - 1)))} className="ml-auto rounded p-1.5 text-slate-500 hover:bg-red-50 hover:text-red-600" aria-label="Delete this response">
                <Trash2 size={16} />
              </button>
            )}
          </div>
          {questions.map((it) => {
            const a: Answer | undefined = r.answers[it.id];
            const ok = s.quiz && it.quiz?.answers?.length ? isCorrect(it, a) : null;
            return (
              <div key={it.id} className={cn('rounded-lg border bg-white p-5', ok === true ? 'border-emerald-300' : ok === false ? 'border-red-300' : 'border-slate-200')}>
                <div className="text-[14px] text-slate-900">{it.title}</div>
                <div className="mt-2 text-[14px] text-slate-700">{answerText(it, a) || <span className="text-slate-400">(no answer)</span>}</div>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
