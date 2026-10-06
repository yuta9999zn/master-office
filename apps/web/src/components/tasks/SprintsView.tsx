'use client';

import { meetingCodeFromUrl, type CeremonyKind, type Project, type RetroItemView, type SprintView, type TaskView } from '@workos/shared';
import { CalendarClock, CheckCircle2, ListPlus, ThumbsUp, Trash2, Video } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { useEvent } from '@/lib/calendar';
import { meetingPath } from '@/lib/meetings';
import { useMe } from '@/lib/queries';
import { useRetro, useSprintActions, useSprintReport, useSprints, useVelocity } from '@/lib/tasks';
import { Avatar, cn, EmptyState, Skeleton } from '../ui/primitives';
import { IssueIcon, Points } from './issue-bits';
import { Burndown, Velocity } from './SprintCharts';

const range = (a: string, b: string) => {
  const f = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  return `${f.format(new Date(`${a}T00:00:00Z`))} – ${f.format(new Date(`${b}T00:00:00Z`))}`;
};
const STATE: Record<SprintView['state'], string> = { planned: 'bg-slate-100 text-slate-600', active: 'bg-emerald-50 text-emerald-700', closed: 'bg-indigo-50 text-indigo-700' };

/** /tasks?view=sprints&sprint=&tab= — velocity, every sprint with its report, ceremonies and retrospective (§76). */
export function SprintsView({ project, open }: { project: Project; open: (id: string) => void }) {
  const { data: sprints, isLoading } = useSprints(project.id);
  const { data: velocity } = useVelocity(project.id);
  const params = useSearchParams();
  const router = useRouter();
  const list = [...(sprints ?? [])].sort((a, b) => b.startDate.localeCompare(a.startDate));
  const chosen = list.find((s) => s.id === params.get('sprint')) ?? list.find((s) => s.state === 'active') ?? list.find((s) => s.state === 'closed') ?? list[0];
  const tab = params.get('tab') === 'retro' ? 'retro' : 'report';
  const go = (sprint: string, t: string) => {
    const n = new URLSearchParams(window.location.search);
    n.set('sprint', sprint);
    n.set('tab', t);
    router.push(`/tasks?${n}`);
  };
  if (isLoading) return <Skeleton className="m-6 h-80" />;
  if (!list.length) return <EmptyState title="No sprints yet">Create one in the Backlog.</EmptyState>;
  return (
    <div className="flex h-full min-h-0" data-testid="sprints-view">
      <aside className="w-[260px] shrink-0 overflow-y-auto border-r border-line bg-surface p-3">
        <ul className="space-y-1">
          {list.map((s) => (
            <li key={s.id}>
              <button onClick={() => go(s.id, tab)} className={cn('w-full rounded-lg px-3 py-2 text-left', chosen?.id === s.id ? 'bg-selected' : 'hover:bg-hover')} data-testid="sprint-item" data-name={s.name}>
                <span className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium text-ink">{s.name}</span>
                  <span className={cn('rounded-full px-1.5 py-px text-[10.5px] font-medium capitalize', STATE[s.state])}>{s.state}</span>
                </span>
                <span className="block text-[12px] text-muted">
                  {range(s.startDate, s.endDate)} · {s.state === 'closed' ? `${s.completedPoints ?? 0}/${s.committedPoints ?? 0} pts` : `${s.counts.donePoints}/${s.counts.points} pts`}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </aside>
      <div className="min-w-0 flex-1 overflow-y-auto p-6">
        <section className="mb-6 rounded-xl bg-surface p-5 ring-1 ring-line">
          <h3 className="mb-2 text-[14px] font-semibold text-ink">Velocity</h3>
          <Velocity rows={velocity ?? []} />
        </section>
        {chosen && (
          <section className="rounded-xl bg-surface ring-1 ring-line">
            <header className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3">
              <h2 className="text-[16px] font-semibold text-ink" data-testid="sprint-title">
                {chosen.name}
              </h2>
              <span className="text-[12.5px] text-muted">{range(chosen.startDate, chosen.endDate)}</span>
              {chosen.goal && <span className="text-[12.5px] italic text-ink-2">“{chosen.goal}”</span>}
              <nav className="ml-auto flex gap-1" role="tablist">
                {(['report', 'retro'] as const).map((t) => (
                  <button key={t} role="tab" aria-selected={tab === t} onClick={() => go(chosen.id, t)} className={cn('rounded-md px-3 py-1.5 text-[13px]', tab === t ? 'bg-selected font-semibold text-brand-700' : 'text-muted hover:bg-hover')}>
                    {t === 'report' ? 'Report' : 'Retrospective'}
                  </button>
                ))}
              </nav>
            </header>
            {tab === 'report' ? <Report sprint={chosen} open={open} /> : <Retro project={project} sprint={chosen} />}
          </section>
        )}
      </div>
    </div>
  );
}

function Report({ sprint, open }: { sprint: SprintView; open: (id: string) => void }) {
  const { data } = useSprintReport(sprint.id);
  const kinds: CeremonyKind[] = ['planning', 'daily', 'review', 'retro'];
  return (
    <div className="space-y-5 p-5">
      <div className="grid grid-cols-4 gap-3">
        <Tile label="Issues done" value={`${sprint.counts.done}/${sprint.counts.total}`} />
        <Tile label="Points done" value={`${sprint.counts.donePoints}/${sprint.counts.points}`} />
        <Tile label="Committed" value={sprint.committedPoints === null ? '—' : `${sprint.committedPoints} pts`} />
        <Tile label={sprint.state === 'closed' ? 'Completed' : 'State'} value={sprint.state === 'closed' ? `${sprint.completedPoints ?? 0} pts` : sprint.state} />
      </div>
      {data ? <Burndown report={data} /> : <Skeleton className="h-52" />}
      {Object.keys(sprint.ceremonies).length > 0 && (
        <div data-testid="ceremonies">
          <h4 className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold text-ink">
            <CalendarClock size={15} /> Ceremonies
          </h4>
          <ul className="grid gap-2 md:grid-cols-2">
            {kinds.map((k) => (sprint.ceremonies[k] ? <Ceremony key={k} id={sprint.ceremonies[k]!} /> : null))}
          </ul>
        </div>
      )}
      {data && (
        <div className="grid gap-4 md:grid-cols-2">
          <IssueList title={`Done (${data.done.length})`} items={data.done} open={open} />
          <IssueList title={`Not done (${data.notDone.length})`} items={data.notDone} open={open} />
        </div>
      )}
    </div>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-canvas px-3 py-2.5 ring-1 ring-line">
      <p className="text-[11.5px] text-muted">{label}</p>
      <p className={cn('text-[18px] font-semibold text-ink', /^[a-z]/.test(value) && 'capitalize')}>{value}</p>
    </div>
  );
}

function Ceremony({ id }: { id: string }) {
  const { data: e } = useEvent(id);
  if (!e) return <li className="h-14 animate-pulse rounded-lg bg-hover" />;
  const room = meetingCodeFromUrl(e.meetingUrl);
  const t = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(e.start));
  return (
    <li className="flex items-center gap-3 rounded-lg px-3 py-2 ring-1 ring-line" data-testid="ceremony">
      <Video size={16} className="shrink-0 text-brand-600" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium text-ink">{e.title.split(' · ').pop()}</p>
        <p className="text-[12px] text-muted">
          {t}
          {e.recurrence ? ' · every weekday' : ''}
        </p>
      </div>
      <Link href={`/calendar?event=${e.id}`} className="text-[12px] text-muted hover:underline">
        Calendar
      </Link>
      {room && (
        <Link href={meetingPath(room)} className="rounded-lg bg-brand-600 px-2.5 py-1 text-[12px] font-medium text-white hover:bg-brand-700">
          Join
        </Link>
      )}
    </li>
  );
}

function IssueList({ title, items, open }: { title: string; items: TaskView[]; open: (id: string) => void }) {
  return (
    <div>
      <h4 className="mb-1.5 text-[13px] font-semibold text-ink">{title}</h4>
      <ul className="rounded-lg ring-1 ring-line">
        {items.map((t) => (
          <li key={t.id}>
            <button onClick={() => open(t.id)} className="flex w-full items-center gap-2 border-b border-line px-3 py-1.5 text-left text-[13px] last:border-0 hover:bg-hover">
              <IssueIcon type={t.type} size={14} />
              <span className="font-mono text-[11px] text-subtle">{t.ref}</span>
              <span className="min-w-0 flex-1 truncate">{t.title}</span>
              <Points n={t.storyPoints} />
            </button>
          </li>
        ))}
        {!items.length && <li className="px-3 py-2 text-[12.5px] text-subtle">None</li>}
      </ul>
    </div>
  );
}

const COLUMNS: { kind: RetroItemView['kind']; title: string; tint: string; hint: string }[] = [
  { kind: 'good', title: 'Went well', tint: '#dcfce7', hint: 'What helped us?' },
  { kind: 'improve', title: 'To improve', tint: '#fef3c7', hint: 'What slowed us down?' },
  { kind: 'action', title: 'Action items', tint: '#dbeafe', hint: 'What will we change next sprint?' },
];

function Retro({ project, sprint }: { project: Project; sprint: SprintView }) {
  const { data: items } = useRetro(sprint.id);
  const { data: me } = useMe();
  const a = useSprintActions();
  const [draft, setDraft] = useState<Record<string, string>>({});
  const canWrite = project.perms.comment;
  if (sprint.state === 'planned') return <EmptyState title="The retrospective opens when the sprint starts" />;
  return (
    <div className="grid gap-4 p-5 md:grid-cols-3" data-testid="retro-board">
      {COLUMNS.map((c) => {
        const list = (items ?? []).filter((x) => x.kind === c.kind).sort((x, y) => y.votes - x.votes);
        return (
          <section key={c.kind} className="flex flex-col rounded-xl p-3" style={{ background: c.tint }} data-testid="retro-column" data-kind={c.kind}>
            <h4 className="mb-2 text-[13.5px] font-semibold text-ink">
              {c.title} <span className="font-normal text-muted">{list.length}</span>
            </h4>
            <ul className="space-y-2">
              {list.map((x) => (
                <li key={x.id} className="rounded-lg bg-surface p-2.5 text-[13px] shadow-sm" data-testid="retro-card">
                  <p className="whitespace-pre-wrap text-ink">{x.body}</p>
                  <div className="mt-2 flex items-center gap-2">
                    {x.author && <Avatar user={x.author} size={18} />}
                    <button onClick={() => canWrite && a.vote.mutate(x.id)} disabled={!canWrite} className={cn('flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11.5px]', x.voted ? 'bg-brand-50 text-brand-700' : 'text-muted hover:bg-hover')} aria-pressed={x.voted} aria-label="Vote" data-testid="retro-vote">
                      <ThumbsUp size={12} /> {x.votes}
                    </button>
                    <span className="flex-1" />
                    {c.kind === 'action' &&
                      (x.task ? (
                        <Link href={`/tasks?project=${project.id}&task=${x.task.id}`} className="flex items-center gap-1 text-[11.5px] font-medium text-brand-700 hover:underline" data-testid="retro-task">
                          {x.task.done && <CheckCircle2 size={12} />} {x.task.ref}
                        </Link>
                      ) : (
                        project.perms.write && (
                          <button onClick={() => a.retroToTask.mutate({ id: x.id })} className="flex items-center gap-1 text-[11.5px] font-medium text-brand-700 hover:underline" data-testid="retro-make-task">
                            <ListPlus size={12} /> Create task
                          </button>
                        )
                      ))}
                    {(x.author?.id === me?.user.id || project.perms.manage) && (
                      <button onClick={() => a.removeRetro.mutate(x.id)} className="rounded p-0.5 text-subtle hover:bg-hover" aria-label="Remove card">
                        <Trash2 size={12} />
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
            {canWrite && (
              <textarea
                value={draft[c.kind] ?? ''}
                onChange={(e) => setDraft((d) => ({ ...d, [c.kind]: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && (draft[c.kind] ?? '').trim()) {
                    e.preventDefault();
                    a.addRetro.mutate({ sprintId: sprint.id, kind: c.kind, body: draft[c.kind] });
                    setDraft((d) => ({ ...d, [c.kind]: '' }));
                  }
                }}
                rows={2}
                placeholder={`${c.hint} (Enter to add)`}
                aria-label={`Add to ${c.title}`}
                className="mt-2 w-full resize-none rounded-lg border border-white/60 bg-white/70 px-2.5 py-1.5 text-[13px] outline-none focus:bg-white"
              />
            )}
          </section>
        );
      })}
    </div>
  );
}
