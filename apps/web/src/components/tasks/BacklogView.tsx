'use client';

import { sprintWord, WORK_TYPES, type Project, type SprintView, type TaskView } from '@workos/shared';
import { CalendarClock, ChevronDown, ChevronRight, Ellipsis, GripVertical, Pencil, Play, Plus, Trash2, Video } from 'lucide-react';
import { useMemo, useState, type DragEvent } from 'react';
import { toast } from 'sonner';
import { useSprintActions, useSprints, useTaskActions } from '@/lib/tasks';
import { Avatar, Button, cn, Dialog, EmptyState, Menu, MenuContent, MenuItem, MenuTrigger, Skeleton } from '../ui/primitives';
import { IssueIcon, Points } from './issue-bits';

const DAY = 86_400_000;
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const lengthOf = (sp: SprintView) => Math.round((Date.parse(sp.endDate) - Date.parse(sp.startDate)) / DAY) + 1;
const range = (a: string, b: string) => {
  const f = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  return `${f.format(new Date(`${a}T00:00:00Z`))} – ${f.format(new Date(`${b}T00:00:00Z`))}`;
};
const todayStr = () => new Date().toISOString().slice(0, 10);

/**
 * Backlog (§76): the active sprint, the planned ones and the backlog, each a list ordered by rank. Drag issues
 * between them or up and down; plan, start (with the Scrum ceremonies) and complete sprints.
 */
export function BacklogView({ project, tasks, open }: { project: Project; tasks: TaskView[]; open: (id: string) => void }) {
  const { data: sprints, isLoading } = useSprints(project.id);
  const a = useSprintActions();
  const canEdit = project.perms.write;
  const [drag, setDrag] = useState<string | null>(null);
  const [over, setOver] = useState<{ list: string; index: number } | null>(null);
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<SprintView | 'new' | null>(null);
  const [starting, setStarting] = useState<SprintView | null>(null);
  const [completing, setCompleting] = useState<SprintView | null>(null);
  // AI-DLC plans in bolts.
  const word = sprintWord(project.methodology);
  const w = word.toLowerCase();

  const work = useMemo(() => tasks.filter((t) => WORK_TYPES.includes(t.type) && !t.triage).sort((x, y) => (x.rank < y.rank ? -1 : x.rank > y.rank ? 1 : 0)), [tasks]);
  const open_ = (sprints ?? []).filter((s) => s.state !== 'closed').sort((x, y) => (x.state === 'active' ? -1 : y.state === 'active' ? 1 : x.startDate.localeCompare(y.startDate)));
  const active = open_.find((s) => s.state === 'active');
  const lists: { id: string; sprint: SprintView | null; items: TaskView[] }[] = [
    ...open_.map((s) => ({ id: s.id, sprint: s, items: work.filter((t) => t.sprintId === s.id) })),
    // The backlog: what is not planned and not finished (or sits in a closed sprint by mistake).
    { id: 'backlog', sprint: null, items: work.filter((t) => (!t.sprintId || !open_.some((s) => s.id === t.sprintId)) && !t.completedAt && !(t.sprintId && (sprints ?? []).some((s) => s.id === t.sprintId && s.state === 'closed'))) },
  ];

  const indexAt = (e: DragEvent<HTMLElement>, list: string) => {
    const rows = [...(e.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('[data-testid="backlog-row"]')].filter((r) => r.dataset.id !== drag);
    const i = rows.findIndex((r) => e.clientY < r.getBoundingClientRect().top + r.offsetHeight / 2);
    return { list, index: i < 0 ? rows.length : i };
  };
  const drop = (list: string, index: number) => {
    if (!drag) return;
    const target = lists.find((l) => l.id === list)!;
    const items = target.items.filter((t) => t.id !== drag);
    const sprintId = target.sprint?.id ?? null;
    if (target.sprint?.state === 'closed') return;
    a.plan.mutate({ id: drag, sprintId, rankAfter: items[index - 1]?.id ?? null, rankBefore: items[index]?.id ?? null });
    setDrag(null);
    setOver(null);
  };

  if (isLoading) return <Skeleton className="m-6 h-80" />;
  return (
    <div className="h-full overflow-y-auto p-5" data-testid="backlog">
      <div className="mx-auto max-w-[1100px] space-y-4">
        {canEdit && (
          <div className="flex justify-end">
            <Button icon={<Plus size={15} />} onClick={() => setEditing('new')} data-testid="create-sprint">
              Create {w}
            </Button>
          </div>
        )}
        {lists.map((l) => {
          const sp = l.sprint;
          const pts = l.items.reduce((n, t) => n + (t.storyPoints ?? 0), 0);
          const folded = closed.has(l.id);
          return (
            <section
              key={l.id}
              className={cn('rounded-xl bg-surface ring-1 ring-line', over?.list === l.id && 'ring-2 ring-brand-300')}
              onDragOver={(e) => {
                if (!drag) return;
                e.preventDefault();
                setOver(indexAt(e, l.id));
              }}
              onDrop={(e) => (e.preventDefault(), drop(l.id, indexAt(e, l.id).index))}
              data-testid="backlog-section"
              data-sprint={sp?.id ?? 'backlog'}
              data-name={sp?.name ?? 'Backlog'}
            >
              <header className="flex items-center gap-2 border-b border-line px-4 py-2.5">
                <button
                  onClick={() =>
                    setClosed((v) => {
                      const n = new Set(v);
                      if (!n.delete(l.id)) n.add(l.id);
                      return n;
                    })
                  }
                  className="text-muted"
                  aria-label={folded ? 'Expand' : 'Collapse'}
                >
                  {folded ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
                </button>
                <h3 className="text-[14px] font-semibold text-ink">{sp ? sp.name : 'Backlog'}</h3>
                {sp && <span className="text-[12px] text-muted">{range(sp.startDate, sp.endDate)}</span>}
                {sp?.state === 'active' && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 ring-1 ring-emerald-200">Active · {Math.max(0, Math.round((Date.parse(sp.endDate) - Date.parse(todayStr())) / DAY))} days left</span>}
                <span className="text-[12px] text-muted">
                  {l.items.length} issue{l.items.length === 1 ? '' : 's'}
                  {pts ? ` · ${pts} pts` : ''}
                </span>
                {sp?.goal && <span className="min-w-0 truncate text-[12px] italic text-ink-2">“{sp.goal}”</span>}
                <span className="flex-1" />
                {sp && canEdit && sp.state === 'planned' && (
                  <Button size="sm" variant={active ? 'ghost' : 'primary'} disabled={!!active || !l.items.length} icon={<Play size={13} />} onClick={() => setStarting(sp)} data-testid="start-sprint" title={active ? `Complete ${active.name} first` : !l.items.length ? 'Plan some issues first' : undefined}>
                    Start {w}
                  </Button>
                )}
                {sp && canEdit && sp.state === 'active' && (
                  <Button size="sm" onClick={() => setCompleting(sp)} data-testid="complete-sprint">
                    Complete {w}
                  </Button>
                )}
                {sp && canEdit && (
                  <Menu>
                    <MenuTrigger asChild>
                      <button className="rounded-md p-1 text-muted hover:bg-hover" aria-label={`${sp.name} options`}>
                        <Ellipsis size={16} />
                      </button>
                    </MenuTrigger>
                    <MenuContent align="end">
                      <MenuItem icon={<Pencil size={15} />} onSelect={() => setEditing(sp)}>
                        Edit {w}
                      </MenuItem>
                      {sp.state === 'planned' && (
                        <MenuItem icon={<Trash2 size={15} />} danger onSelect={() => a.remove.mutate(sp.id)}>
                          Delete {w}
                        </MenuItem>
                      )}
                    </MenuContent>
                  </Menu>
                )}
              </header>
              {!folded && (
                <ul className="min-h-[44px] py-1">
                  {l.items.map((t, i) => (
                    <li key={t.id}>
                      {over?.list === l.id && over.index === i && drag && <div className="mx-4 h-0.5 rounded bg-brand-500" />}
                      <div
                        draggable={canEdit}
                        onDragStart={(e) => (setDrag(t.id), e.dataTransfer.setData('text/plain', t.id), (e.dataTransfer.effectAllowed = 'move'))}
                        onDragEnd={() => (setDrag(null), setOver(null))}
                        onClick={() => open(t.id)}
                        className={cn('group flex cursor-pointer items-center gap-2.5 px-3 py-1.5 text-[13px] hover:bg-hover', drag === t.id && 'opacity-40')}
                        data-testid="backlog-row"
                        data-id={t.id}
                        data-title={t.title}
                      >
                        <GripVertical size={14} className={cn('shrink-0 text-subtle', canEdit ? 'cursor-grab opacity-0 group-hover:opacity-100' : 'opacity-0')} />
                        <IssueIcon type={t.type} size={15} />
                        <span className="w-[72px] shrink-0 font-mono text-[11.5px] text-subtle">{t.ref}</span>
                        <span className={cn('min-w-0 flex-1 truncate text-ink', t.completedAt && 'text-muted line-through')}>{t.title}</span>
                        <EpicChip t={t} all={tasks} />
                        <StatusPill t={t} project={project} />
                        <Points n={t.storyPoints} />
                        {t.assignee ? <Avatar user={t.assignee} size={22} /> : <span className="size-[22px] rounded-full border border-dashed border-line-strong" />}
                      </div>
                    </li>
                  ))}
                  {over?.list === l.id && over.index === l.items.length && drag && <div className="mx-4 h-0.5 rounded bg-brand-500" />}
                  {!l.items.length && <li className="px-4 py-3 text-[12.5px] text-subtle">{sp ? `Drag issues here to plan them into this ${w}.` : 'Nothing waiting in the backlog.'}</li>}
                </ul>
              )}
              {!folded && canEdit && <QuickAdd project={project} sprintId={sp?.id ?? null} />}
            </section>
          );
        })}
        {!lists.some((l) => l.items.length) && !open_.length && <EmptyState title="No issues yet" />}
      </div>
      <SprintDialog key={editing === 'new' ? 'new' : editing?.id ?? 'none'} project={project} sprint={editing} onClose={() => setEditing(null)} />
      {starting && <StartDialog project={project} sprint={starting} items={work.filter((t) => t.sprintId === starting.id)} onClose={() => setStarting(null)} />}
      {completing && <CompleteDialog word={word} sprint={completing} next={open_.filter((s) => s.state === 'planned')} items={work.filter((t) => t.sprintId === completing.id)} onClose={() => setCompleting(null)} />}
    </div>
  );
}

function EpicChip({ t, all }: { t: TaskView; all: TaskView[] }) {
  let cur = all.find((x) => x.id === t.parentId);
  for (let i = 0; cur && cur.type !== 'epic' && i < 3; i++) cur = all.find((x) => x.id === cur!.parentId);
  if (!cur || cur.type !== 'epic') return null;
  return <span className="hidden max-w-[150px] truncate rounded px-1.5 text-[11px] font-medium sm:inline" style={{ background: '#ede9fe', color: '#6d28d9' }}>{cur.title}</span>;
}

function StatusPill({ t, project }: { t: TaskView; project: Project }) {
  const s = project.statuses.find((x) => x.id === t.status);
  if (!s) return null;
  return (
    <span className="w-[86px] shrink-0 truncate rounded px-1.5 py-0.5 text-center text-[11px] font-medium" style={{ background: `${s.color}1f`, color: s.color }}>
      {s.name}
    </span>
  );
}

function QuickAdd({ project, sprintId }: { project: Project; sprintId: string | null }) {
  const { create } = useTaskActions();
  const [title, setTitle] = useState('');
  return (
    <input
      value={title}
      onChange={(e) => setTitle(e.target.value)}
      onKeyDown={async (e) => {
        if (e.key === 'Enter' && title.trim()) {
          await create.mutateAsync({ projectId: project.id, title: title.trim(), type: 'story', sprintId });
          setTitle('');
        }
      }}
      placeholder="+ Create issue"
      aria-label={`Create issue in ${sprintId ? 'sprint' : 'backlog'}`}
      className="h-9 w-full rounded-b-xl border-t border-line px-4 text-[13px] outline-none hover:bg-hover focus:bg-hover"
    />
  );
}

const DURATIONS = [7, 14, 21, 28];
// AI-DLC bolts last hours to days.
const BOLT_DAYS = [1, 2, 3, 5];
const durationsOf = (p: Project) => (p.methodology === 'ai-dlc' ? BOLT_DAYS : DURATIONS);
const input = 'h-9 w-full rounded-lg border border-line-strong bg-surface px-3 text-[13px] outline-none focus:border-brand-500';

export function SprintDialog({ project, sprint, onClose }: { project: Project; sprint: SprintView | 'new' | null; onClose: () => void }) {
  const a = useSprintActions();
  const word = sprintWord(project.methodology);
  const existing = sprint && sprint !== 'new' ? sprint : null;
  const [name, setName] = useState(existing?.name ?? '');
  const [goal, setGoal] = useState(existing?.goal ?? '');
  const { data: all } = useSprints(project.id);
  const last = [...(all ?? [])].sort((x, y) => y.endDate.localeCompare(x.endDate))[0];
  const [start, setStart] = useState(existing?.startDate ?? (last ? addDays(last.endDate, 1) : todayStr()));
  const [days, setDays] = useState(existing ? lengthOf(existing) : project.sprintDays);
  const save = async () => {
    if (existing) await a.update.mutateAsync({ id: existing.id, name: name || undefined, goal: goal || null, startDate: start || undefined, days });
    else await a.create.mutateAsync({ projectId: project.id, name: name || undefined, goal: goal || null, startDate: start || undefined, days });
    onClose();
  };
  return (
    <Dialog
      open={!!sprint}
      onOpenChange={(o) => !o && onClose()}
      title={existing ? `Edit ${existing.name}` : `Create ${word.toLowerCase()}`}
      description={existing ? undefined : `Starts the day after the last ${word.toLowerCase()} — change the dates as you need.`}
      footer={
        <Button variant="primary" loading={a.create.isPending || a.update.isPending} onClick={() => void save()} data-testid="save-sprint">
          {existing ? 'Save' : 'Create'}
        </Button>
      }
    >
      <div className="space-y-3 text-[13px]">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder={existing ? '' : `${project.key} ${word} …`} aria-label="Sprint name" className={input} />
        <textarea value={goal} onChange={(e) => setGoal(e.target.value)} rows={2} placeholder={`${word} goal`} aria-label="Sprint goal" className={cn(input, 'h-auto py-2')} />
        <SprintDates start={start} setStart={setStart} days={days} setDays={setDays} choices={durationsOf(project)} />
      </div>
    </Dialog>
  );
}

/** Start and end of a sprint: pick either date, or a usual length (the end follows). */
function SprintDates({ start, setStart, days, setDays, choices }: { start: string; setStart: (s: string) => void; days: number; setDays: (n: number) => void; choices: number[] }) {
  const end = start ? addDays(start, days - 1) : '';
  return (
    <div className="space-y-2" data-testid="sprint-dates">
      <div className="grid grid-cols-2 gap-2">
        <label>
          <span className="mb-1 block text-[12px] text-muted">Start date</span>
          <input type="date" value={start} onChange={(e) => e.target.value && setStart(e.target.value)} aria-label="Start date" className={input} />
        </label>
        <label>
          <span className="mb-1 block text-[12px] text-muted">End date</span>
          <input
            type="date"
            value={end}
            min={start || undefined}
            onChange={(e) => {
              if (!e.target.value || !start) return;
              const n = Math.round((Date.parse(`${e.target.value}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / DAY) + 1;
              setDays(Math.max(1, Math.min(60, n)));
            }}
            aria-label="End date"
            className={input}
          />
        </label>
      </div>
      <label className="flex items-center gap-2">
        <span className="text-[12px] text-muted">Length</span>
        <select value={choices.includes(days) ? String(days) : 'custom'} onChange={(e) => e.target.value !== 'custom' && setDays(Number(e.target.value))} aria-label="Duration" className={cn(input, 'h-8 w-auto')}>
          {choices.map((d) => (
            <option key={d} value={d}>
              {d % 7 ? `${d} day${d === 1 ? '' : 's'}` : `${d / 7} week${d === 7 ? '' : 's'}`}
            </option>
          ))}
          <option value="custom">Custom ({days} days)</option>
        </select>
        <span className="text-[12px] text-muted">{days} days · ends {end ? new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${end}T00:00:00Z`)) : '—'}</span>
      </label>
    </div>
  );
}

export function StartDialog({ project, sprint, items, onClose }: { project: Project; sprint: SprintView; items: TaskView[]; onClose: () => void }) {
  const a = useSprintActions();
  const [goal, setGoal] = useState(sprint.goal ?? '');
  const [start, setStart] = useState(sprint.startDate < todayStr() ? todayStr() : sprint.startDate);
  const [days, setDays] = useState(lengthOf(sprint));
  const [schedule, setSchedule] = useState(true);
  const [daily, setDaily] = useState(project.dailyTime);
  const end = addDays(start, days - 1);
  const weeks = Math.max(1, Math.round(days / 7));
  const people = [...new Map([...(project.lead ? [project.lead] : []), ...items.map((t) => t.assignee).filter((x): x is NonNullable<typeof x> => !!x)].map((u) => [u.id, u])).values()];
  const bolt = project.methodology === 'ai-dlc';
  const word = sprintWord(project.methodology);
  const go = async () => {
    await a.start.mutateAsync({ id: sprint.id, startDate: start, days, goal: goal || null, ceremonies: { schedule, dailyTime: daily } });
    toast.success(`${sprint.name} started${schedule ? (bolt ? ' — the bolt rituals are in Calendar' : ' — ceremonies are in Calendar') : ''}`);
    onClose();
  };
  const f = (d: string) => new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${d}T00:00:00Z`));
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Start ${sprint.name}`}
      description={`${items.length} issues · ${items.reduce((n, t) => n + (t.storyPoints ?? 0), 0)} story points`}
      width={560}
      footer={
        <Button variant="primary" icon={<Play size={14} />} loading={a.start.isPending} onClick={() => void go()} data-testid="confirm-start">
          Start {bolt ? 'bolt' : 'sprint'}
        </Button>
      }
    >
      <div className="space-y-3 text-[13px]">
        <textarea value={goal} onChange={(e) => setGoal(e.target.value)} rows={2} placeholder={`${word} goal`} aria-label="Sprint goal" className={cn(input, 'h-auto py-2')} />
        <SprintDates start={start} setStart={setStart} days={days} setDays={setDays} choices={durationsOf(project)} />
        <p className="text-[12px] text-muted">Ends {f(end)}</p>
        <label className="flex items-center gap-2 font-medium text-ink-2">
          <input type="checkbox" checked={schedule} onChange={(e) => setSchedule(e.target.checked)} className="accent-brand-600" data-testid="schedule-ceremonies" />
          <CalendarClock size={15} /> {bolt ? 'Put the bolt rituals in Calendar (with Kaori Meet rooms)' : 'Put the Scrum ceremonies in Calendar (with Kaori Meet rooms)'}
        </label>
        {schedule && (
          <div className="rounded-lg bg-canvas p-3 ring-1 ring-line" data-testid="ceremony-plan">
            {bolt ? (
              <ul className="space-y-1.5 text-[12.5px] text-ink-2">
                <li className="flex items-center gap-2">
                  <Video size={13} className="text-brand-600" /> <b>Bolt Kickoff</b> — {f(start)}, 10:00 · 30 min · approve the plan the AI proposes
                </li>
                <li className="flex items-center gap-2">
                  <Video size={13} className="text-brand-600" /> <b>Bolt Review</b> — {f(end)}, 15:00 · 30 min · validate what was generated
                </li>
                <li className="flex items-center gap-2">
                  <Video size={13} className="text-brand-600" /> <b>Bolt Retrospective</b> — {f(end)}, 15:30 · 15 min · prompts, context, reviews
                </li>
              </ul>
            ) : (
            <ul className="space-y-1.5 text-[12.5px] text-ink-2">
              <li className="flex items-center gap-2">
                <Video size={13} className="text-brand-600" /> <b>Sprint Planning</b> — {f(start)}, 10:00 · {weeks * 60} min · define and split the tasks
              </li>
              <li className="flex items-center gap-2">
                <Video size={13} className="text-brand-600" /> <b>Daily Scrum</b> — Mon–Fri at
                <input type="time" value={daily} onChange={(e) => setDaily(e.target.value)} aria-label="Daily time" className="h-7 rounded border border-line-strong bg-surface px-1.5 text-[12px]" /> · 15 min
              </li>
              <li className="flex items-center gap-2">
                <Video size={13} className="text-brand-600" /> <b>Sprint Review</b> — {f(end)}, 13:30 · {weeks * 60} min · report what was done
              </li>
              <li className="flex items-center gap-2">
                <Video size={13} className="text-brand-600" /> <b>Retrospective</b> — {f(end)}, 16:00 · {weeks * 45} min · lessons learned
              </li>
            </ul>
            )}
            {people.length > 0 && <p className="mt-2 text-[12px] text-muted">Invites: {people.map((p) => p.name).join(', ')}</p>}
          </div>
        )}
      </div>
    </Dialog>
  );
}

export function CompleteDialog({ word, sprint, next, items, onClose }: { word: string; sprint: SprintView; next: SprintView[]; items: TaskView[]; onClose: () => void }) {
  const a = useSprintActions();
  const done = items.filter((t) => t.completedAt);
  const open = items.length - done.length;
  const [moveTo, setMoveTo] = useState<string>(next[0]?.id ?? '');
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Complete ${sprint.name}`}
      footer={
        <Button
          variant="primary"
          loading={a.complete.isPending}
          onClick={() =>
            a.complete.mutate(
              { id: sprint.id, moveTo: moveTo || null },
              {
                onSuccess: () => {
                  toast.success(`${sprint.name} completed`);
                  onClose();
                },
              },
            )
          }
          data-testid="confirm-complete"
        >
          Complete {word.toLowerCase()}
        </Button>
      }
    >
      <div className="space-y-3 text-[13px]">
        <p className="text-ink-2">
          <b>{done.length}</b> done ({done.reduce((n, t) => n + (t.storyPoints ?? 0), 0)} pts), <b>{open}</b> not finished.
        </p>
        {open > 0 && (
          <label className="block">
            <span className="mb-1 block text-[12px] text-muted">Move the unfinished issues to</span>
            <select value={moveTo} onChange={(e) => setMoveTo(e.target.value)} className={input} aria-label="Move unfinished to">
              {next.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
              <option value="">Backlog</option>
            </select>
          </label>
        )}
      </div>
    </Dialog>
  );
}
