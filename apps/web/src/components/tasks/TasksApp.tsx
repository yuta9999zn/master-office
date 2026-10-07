'use client';

import { can, canTransition, ISSUE_RANK, WORKFLOWS, WORK_TYPES, type IssueType, type Methodology, type Project, type TaskStatus, type TaskView, type WorkflowId } from '@workos/shared';
import { Ban, Check, CheckSquare, ChevronDown, ChevronLeft, ChevronRight, Inbox, ListChecks, MessageSquare, Plus, Search, Settings2, SquareCheckBig, X } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { formatShort } from '@/lib/format';
import { useSpaces, useUsers } from '@/lib/queries';
import { METHODOLOGY, PRIORITY, shortDate, todayStr, useProjects, useSprints, useTaskActions, useTasks } from '@/lib/tasks';
import { useMounted } from '@/lib/use-mounted';
import { Avatar, Button, cn, Dialog, EmptyState, Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger, Skeleton } from '../ui/primitives';
import { BacklogView } from './BacklogView';
import { DocsView } from './DocsView';
import { IssueIcon, ISSUE_META, Points } from './issue-bits';
import { SprintsView } from './SprintsView';
import { WorkflowSettings } from './WorkflowSettings';
import { TaskDashboard } from './TaskDashboard';
import { TaskDrawer } from './TaskDrawer';

type View = 'backlog' | 'board' | 'list' | 'sprints' | 'gantt' | 'calendar' | 'dashboard' | 'docs' | 'intake';
const PERSONAL: TaskStatus[] = [
  { id: 'todo', name: 'To Do', color: '#64748b', category: 'todo' },
  { id: 'doing', name: 'In Progress', color: '#2563eb', category: 'doing' },
  { id: 'done', name: 'Done', color: '#10b981', category: 'done' },
];
const isWork = (t: TaskView) => WORK_TYPES.includes(t.type) && !t.triage;

/** /tasks?project=&view=&task= — projects of your spaces and My tasks (docs/ARCHITECTURE.md §72, §76, over view.png). */
export function TasksApp() {
  const mounted = useMounted();
  const params = useSearchParams();
  const router = useRouter();
  const { data: projects } = useProjects();
  const projectId = params.get('project');
  const view = (params.get('view') as View) ?? 'board';
  const taskId = params.get('task');
  const project = projects?.find((p) => p.id === projectId) ?? null;
  const { data: tasks, isLoading } = useTasks(projectId);
  const [q, setQ] = useState('');
  const [who, setWho] = useState<string>('');
  const [creating, setCreating] = useState<{ status?: string } | null>(null);
  const [requesting, setRequesting] = useState(false);
  const [settings, setSettings] = useState(false);
  const [newProject, setNewProject] = useState(false);
  const statuses = project?.statuses ?? PERSONAL;
  const canEdit = project ? project.perms.write : true;

  const go = (p: { project?: string | null; view?: View; task?: string | null }) => {
    const cur = new URLSearchParams(window.location.search);
    const n = new URLSearchParams();
    const proj = p.project === undefined ? cur.get('project') : p.project;
    if (proj) n.set('project', proj);
    n.set('view', p.view ?? (cur.get('view') as View | null) ?? view);
    const t = p.task === undefined ? cur.get('task') : p.task;
    if (t) n.set('task', t);
    router.push(`/tasks?${n.toString()}`);
  };

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (tasks ?? []).filter((t) => (!needle || t.title.toLowerCase().includes(needle) || t.ref?.toLowerCase().includes(needle) || t.tags.some((x) => x.toLowerCase().includes(needle))) && (!who || t.assignee?.id === who));
  }, [tasks, q, who]);
  const triage = (tasks ?? []).filter((t) => t.triage);
  // Scrum and Hybrid plan in sprints: Backlog and Sprints tabs, and the board shows the active sprint.
  const agile = project?.methodology === 'scrum' || project?.methodology === 'hybrid';
  const { data: sprints } = useSprints(agile ? project?.id : null);
  const activeSprint = agile ? sprints?.find((x) => x.state === 'active') ?? null : null;
  const views: View[] = project
    ? [...(agile ? (['backlog'] as View[]) : []), 'board', 'list', ...(agile ? (['sprints'] as View[]) : []), 'gantt', 'calendar', 'dashboard', 'docs', ...(project.perms.write || triage.length ? (['intake'] as View[]) : [])]
    : ['board', 'list', 'calendar'];

  if (!mounted) return <div className="h-full bg-canvas" />;
  return (
    <div className="flex h-full flex-col bg-surface">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line px-5">
        <SquareCheckBig size={20} className="text-brand-600" />
        <h1 className="text-[17px] font-semibold text-ink">Tasks</h1>
        <ProjectPicker projects={projects ?? []} current={project} onPick={(id) => go({ project: id, task: null, view: id ? (['backlog', 'sprints'].includes(view) ? 'board' : view) : view === 'gantt' || view === 'dashboard' || view === 'intake' || view === 'backlog' || view === 'sprints' || view === 'docs' ? 'board' : view })} onNew={() => setNewProject(true)} />
        {project && (
          <span className="rounded-full bg-hover px-2 py-0.5 text-[11.5px] font-medium text-ink-2" title={METHODOLOGY[project.methodology].note} data-testid="methodology">
            {METHODOLOGY[project.methodology].label}
          </span>
        )}
        <nav className="ml-2 flex min-w-0 gap-0.5 overflow-x-auto" role="tablist">
          {views.map((v) => (
            <button key={v} role="tab" aria-selected={view === v} onClick={() => go({ view: v })} className={cn('flex shrink-0 items-center gap-1 rounded-md px-2.5 py-1.5 text-[13px] capitalize', view === v ? 'bg-selected font-semibold text-brand-700' : 'text-muted hover:bg-hover hover:text-ink')}>
              {v}
              {v === 'intake' && triage.length > 0 && <span className="rounded-full bg-amber-500 px-1.5 text-[10.5px] font-semibold text-white" data-testid="intake-count">{triage.length}</span>}
            </button>
          ))}
        </nav>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <label className="flex h-8 items-center gap-2 rounded-lg bg-canvas px-2.5 text-[13px] ring-1 ring-line focus-within:ring-brand-500">
            <Search size={14} className="text-subtle" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search tasks" className="w-24 bg-transparent outline-none xl:w-36" aria-label="Search tasks" />
          </label>
          <AssigneeFilter value={who} onChange={setWho} />
          {project?.perms.manage && (
            <button onClick={() => setSettings(true)} className="grid size-8 place-items-center rounded-lg text-muted ring-1 ring-line hover:bg-hover" aria-label="Project settings" data-testid="project-settings">
              <Settings2 size={16} />
            </button>
          )}
          {project && !canEdit && project.intakeOpen && (
            <Button icon={<Inbox size={15} />} onClick={() => setRequesting(true)} data-testid="file-request">
              Request
            </Button>
          )}
          {canEdit && (
            <Button variant="primary" icon={<Plus size={16} />} onClick={() => setCreating({})} data-testid="create-task">
              Create task
            </Button>
          )}
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        <main className="min-w-0 flex-1 overflow-hidden bg-canvas">
          {isLoading && !tasks ? (
            <Skeleton className="m-6 h-80" />
          ) : view === 'dashboard' && project ? (
            <TaskDashboard projectId={project.id} />
          ) : view === 'backlog' && project && agile ? (
            <BacklogView project={project} tasks={shown} open={(id) => go({ task: id })} />
          ) : view === 'sprints' && project && agile ? (
            <SprintsView project={project} open={(id) => go({ task: id })} />
          ) : view === 'docs' && project ? (
            <DocsView project={project} tasks={tasks ?? []} open={(id) => go({ task: id })} />
          ) : view === 'intake' && project ? (
            <IntakeView tasks={triage} canEdit={canEdit} open={(id) => go({ task: id })} />
          ) : view === 'list' ? (
            <ListView tasks={shown.filter((t) => !t.triage)} all={tasks ?? []} statuses={statuses} hierarchy={!!project} open={(id) => go({ task: id })} />
          ) : view === 'gantt' && project ? (
            <GanttView tasks={shown.filter((t) => !t.triage)} statuses={statuses} open={(id) => go({ task: id })} />
          ) : view === 'calendar' ? (
            <DueCalendar tasks={shown.filter((t) => !t.triage)} statuses={statuses} open={(id) => go({ task: id })} />
          ) : (
            <div className="flex h-full flex-col">
              {agile && (
                <div className="flex shrink-0 items-center gap-2 border-b border-line bg-surface px-5 py-2 text-[12.5px]" data-testid="sprint-bar">
                  {activeSprint ? (
                    <>
                      <b className="text-ink">{activeSprint.name}</b>
                      <span className="text-muted">{shortDate(activeSprint.startDate)} – {shortDate(activeSprint.endDate)} · {Math.max(0, Math.round((Date.parse(activeSprint.endDate) - Date.parse(todayStr())) / 86_400_000))} days left · {activeSprint.counts.donePoints}/{activeSprint.counts.points} pts</span>
                      {activeSprint.goal && <span className="truncate italic text-ink-2">“{activeSprint.goal}”</span>}
                      <button onClick={() => go({ view: 'sprints' })} className="ml-auto text-brand-700 hover:underline">Sprint report</button>
                    </>
                  ) : (
                    <>
                      <span className="text-muted">No active sprint — showing every issue.</span>
                      <button onClick={() => go({ view: 'backlog' })} className="text-brand-700 hover:underline">Plan a sprint in the Backlog</button>
                    </>
                  )}
                </div>
              )}
              <div className="min-h-0 flex-1">
                <BoardView tasks={activeSprint ? shown.filter((t) => t.sprintId === activeSprint.id) : shown} all={tasks ?? []} statuses={statuses} strict={!!project?.strictWorkflow} wip={project?.wipLimits ?? {}} canEdit={canEdit} projectId={projectId} open={(id) => go({ task: id })} onAdd={(status) => setCreating({ status })} />
              </div>
            </div>
          )}
        </main>
        {taskId && <TaskDrawer key={taskId} id={taskId} onClose={() => go({ task: null })} onOpen={(id) => go({ task: id })} />}
      </div>
      <NewTaskDialog open={!!creating} onClose={() => setCreating(null)} project={project} tasks={tasks ?? []} status={creating?.status} sprintId={view === 'board' ? activeSprint?.id ?? null : null} onCreated={(id) => go({ task: id })} />
      {project && <RequestDialog open={requesting} onClose={() => setRequesting(false)} project={project} />}
      {project && <ProjectSettingsDialog key={project.id + String(settings)} open={settings} onClose={() => setSettings(false)} project={project} />}
      <NewProjectDialog open={newProject} onClose={() => setNewProject(false)} onCreated={(id) => go({ project: id, view: 'board', task: null })} />
    </div>
  );
}

function ProjectPicker({ projects, current, onPick, onNew }: { projects: Project[]; current: Project | null; onPick: (id: string | null) => void; onNew: () => void }) {
  const { data: spaces } = useSpaces();
  const bySpace = new Map<string, Project[]>();
  for (const p of projects) bySpace.set(p.spaceId, [...(bySpace.get(p.spaceId) ?? []), p]);
  const canCreate = (spaces ?? []).some((s) => can(s.myRole, 'editor'));
  return (
    <Menu>
      <MenuTrigger asChild>
        <button className="flex h-8 items-center gap-2 whitespace-nowrap rounded-lg px-2.5 text-[13.5px] font-medium text-ink ring-1 ring-line hover:bg-hover" data-testid="project-picker">
          {current ? <span className="size-2.5 rounded-sm" style={{ background: current.color }} /> : <CheckSquare size={14} className="text-muted" />}
          {current ? current.name : 'My tasks'}
          <ChevronDown size={14} className="text-muted" />
        </button>
      </MenuTrigger>
      <MenuContent className="max-h-96 w-64 overflow-y-auto">
        <MenuItem icon={<CheckSquare />} onSelect={() => onPick(null)}>
          My tasks
        </MenuItem>
        {[...bySpace].map(([spaceId, list]) => (
          <div key={spaceId}>
            <MenuSeparator />
            <MenuLabel>{spaces?.find((s) => s.id === spaceId)?.name ?? 'Space'}</MenuLabel>
            {list.map((p) => (
              <MenuItem key={p.id} icon={<span className="size-2.5 rounded-sm" style={{ background: p.color }} />} onSelect={() => onPick(p.id)}>
                <span className="flex justify-between gap-2">
                  {p.name}
                  <span className="text-[11px] text-subtle">
                    {p.counts.done}/{p.counts.total}
                  </span>
                </span>
              </MenuItem>
            ))}
          </div>
        ))}
        {canCreate && (
          <>
            <MenuSeparator />
            <MenuItem icon={<Plus />} onSelect={onNew}>
              New project
            </MenuItem>
          </>
        )}
      </MenuContent>
    </Menu>
  );
}

function AssigneeFilter({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { data: users } = useUsers();
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className="h-8 rounded-lg bg-canvas px-2 text-[13px] text-ink-2 ring-1 ring-line" aria-label="Assignee filter">
      <option value="">Everyone</option>
      {(users ?? []).map((u) => (
        <option key={u.id} value={u.id}>
          {u.name}
        </option>
      ))}
    </select>
  );
}

/** My tasks mixes projects with their own columns into three; a card the board doesn't know goes by its state. */
const columnOf = (t: TaskView, statuses: TaskStatus[]) =>
  statuses.some((s) => s.id === t.status) ? t.status : t.completedAt ? (statuses.find((s) => s.category === 'done') ?? statuses[statuses.length - 1]).id : (statuses.find((s) => s.category === 'doing') ?? statuses[0]).id;

function Due({ t }: { t: TaskView }) {
  if (!t.dueDate) return null;
  const late = !t.completedAt && t.dueDate < todayStr();
  return <span className={cn('whitespace-nowrap text-[11.5px]', late ? 'font-medium text-red-600' : 'text-muted')}>{late ? '⚠ ' : ''}{shortDate(t.dueDate)}</span>;
}

function PriorityChip({ p }: { p: string }) {
  if (p === 'none') return null;
  const m = PRIORITY[p];
  return (
    <span className="inline-flex h-5 items-center gap-1 rounded-full px-1.5 text-[11px] font-medium" style={{ background: `${m.color}18`, color: m.color }}>
      ● {m.label}
    </span>
  );
}

/** The epic an issue belongs to (directly, or through its parent). */
function epicOf(t: TaskView, all: TaskView[]) {
  let cur = all.find((x) => x.id === t.parentId);
  for (let i = 0; cur && i < 3; i++) {
    if (cur.type === 'epic') return cur;
    cur = all.find((x) => x.id === cur!.parentId);
  }
  return null;
}

// ── Board ───────────────────────────────────────────────────────────────────

function BoardView({ tasks, all, statuses, strict = false, wip, canEdit, projectId, open, onAdd }: { tasks: TaskView[]; all: TaskView[]; statuses: TaskStatus[]; strict?: boolean; wip: Record<string, number>; canEdit: boolean; projectId: string | null; open: (id: string) => void; onAdd: (status: string) => void }) {
  const { update } = useTaskActions();
  const [drag, setDrag] = useState<string | null>(null);
  const [over, setOver] = useState<{ status: string; index: number } | null>(null);
  // A project board shows the work items (stories, tasks, bugs); My tasks shows top-level tasks.
  const top = tasks.filter((t) => (projectId ? isWork(t) : !t.parentId || !projectId));
  const column = (s: string) => top.filter((t) => columnOf(t, statuses) === s).sort((a, b) => (a.position < b.position ? -1 : 1));
  // A strict workflow: only columns the dragged card may move to take it.
  const dragFrom = drag ? tasks.find((t) => t.id === drag)?.status ?? null : null;
  const allowed = (status: string) => !strict || !dragFrom || canTransition(statuses, dragFrom, status);
  const drop = (status: string, index: number) => {
    if (!drag || !allowed(status)) return;
    const list = column(status).filter((t) => t.id !== drag);
    const after = list[index - 1]?.id ?? null;
    const before = list[index]?.id ?? null;
    update.mutate({ id: drag, status, after, before });
    setDrag(null);
    setOver(null);
  };
  const indexAt = (e: DragEvent<HTMLElement>, status: string) => {
    const cards = [...(e.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('[data-testid="task-card"]')].filter((c) => c.dataset.id !== drag);
    const i = cards.findIndex((c) => e.clientY < c.getBoundingClientRect().top + c.offsetHeight / 2);
    return { status, index: i < 0 ? cards.length : i };
  };
  return (
    <div className="flex h-full gap-4 overflow-x-auto p-5" data-testid="board">
      {statuses.map((s) => {
        const list = column(s.id);
        const points = list.reduce((n, t) => n + (t.storyPoints ?? 0), 0);
        return (
          <section
            key={s.id}
            className={cn('flex shrink-0 flex-col rounded-xl bg-[#eef1f6] p-2 transition-opacity', statuses.length > 6 ? 'w-[250px]' : 'w-[290px]', over?.status === s.id && 'ring-2 ring-brand-200', drag && !allowed(s.id) && 'opacity-40')}
            onDragOver={(e) => {
              if (!drag || !allowed(s.id)) return;
              e.preventDefault();
              setOver(indexAt(e, s.id));
            }}
            onDrop={(e) => (e.preventDefault(), drop(s.id, indexAt(e, s.id).index))}
            data-testid="board-column"
            data-status={s.id}
            data-allowed={drag ? (allowed(s.id) ? '1' : '0') : undefined}
          >
            <div className="flex items-center gap-2 px-1.5 pb-2 pt-1">
              <span className="size-2.5 rounded-full" style={{ background: s.color }} />
              <span className="text-[13px] font-semibold text-ink">{s.name}</span>
              {wip[s.id] ? (
                <span className={cn('rounded px-1 text-[12px]', list.length > wip[s.id] ? 'bg-red-100 font-semibold text-red-700' : 'text-muted')} title={`Work-in-progress limit ${wip[s.id]}`} data-testid="wip" data-over={list.length > wip[s.id] ? '1' : undefined}>
                  {list.length}/{wip[s.id]}
                </span>
              ) : (
                <span className="text-[12px] text-muted">{list.length}</span>
              )}
              {points > 0 && <span className="ml-auto text-[11px] text-muted" title="Story points">{points} pts</span>}
            </div>
            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
              {list.map((t, i) => {
                const epic = epicOf(t, all);
                return (
                  <div key={t.id}>
                    {over?.status === s.id && over.index === i && drag && <div className="mb-2 h-1 rounded bg-brand-500" />}
                    <button
                      draggable={canEdit && t.canEdit}
                      onDragStart={(e) => (setDrag(t.id), e.dataTransfer.setData('text/plain', t.id), (e.dataTransfer.effectAllowed = 'move'))}
                      onDragEnd={() => (setDrag(null), setOver(null))}
                      onClick={() => open(t.id)}
                      className={cn('block w-full rounded-lg border border-line bg-surface p-3 text-left shadow-[var(--shadow-card)] hover:border-brand-200', drag === t.id && 'opacity-40')}
                      data-testid="task-card"
                      data-id={t.id}
                      data-title={t.title}
                    >
                      <div className="text-[13.5px] font-medium leading-snug text-ink">{t.title}</div>
                      <div className="mt-2 flex flex-wrap gap-1">
                        {epic && (
                          <span className="inline-flex h-5 max-w-[150px] items-center truncate rounded px-1.5 text-[11px] font-medium" style={{ background: '#ede9fe', color: '#6d28d9' }} data-testid="card-epic">
                            {epic.title}
                          </span>
                        )}
                        {t.tags.map((x) => (
                          <span key={x} className="inline-flex h-5 items-center rounded-full bg-brand-50 px-1.5 text-[11px] text-brand-700">
                            {x}
                          </span>
                        ))}
                        <PriorityChip p={t.priority} />
                      </div>
                      <div className="mt-2 flex items-center gap-2.5">
                        {projectId && <IssueIcon type={t.type} size={15} />}
                        {t.blockedBy > 0 && (
                          <span className="flex items-center gap-0.5 text-[11.5px] font-medium text-red-600" title="Waiting on other issues" data-testid="card-blocked">
                            <Ban size={12} /> {t.blockedBy}
                          </span>
                        )}
                        <Due t={t} />
                        {t.subtasks.total > 0 && (
                          <span className="flex items-center gap-0.5 text-[11.5px] text-muted">
                            <ListChecks size={12} /> {t.subtasks.done}/{t.subtasks.total}
                          </span>
                        )}
                        {t.comments > 0 && (
                          <span className="flex items-center gap-0.5 text-[11.5px] text-muted">
                            <MessageSquare size={12} /> {t.comments}
                          </span>
                        )}
                        <span className="flex-1" />
                        <Points n={t.storyPoints} />
                        {t.ref && <span className="font-mono text-[10.5px] text-subtle">{t.ref}</span>}
                        {t.assignee && <Avatar user={t.assignee} size={22} />}
                      </div>
                    </button>
                  </div>
                );
              })}
              {over?.status === s.id && over.index === list.length && drag && <div className="h-1 rounded bg-brand-500" />}
            </div>
            {canEdit && (
              <button onClick={() => onAdd(s.id)} className="mt-2 flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[13px] text-muted hover:bg-white/60 hover:text-ink" aria-label={`Add task to ${s.name}`}>
                <Plus size={14} /> Add task
              </button>
            )}
          </section>
        );
      })}
    </div>
  );
}

// ── List ────────────────────────────────────────────────────────────────────

function ListView({ tasks, all, statuses, hierarchy, open }: { tasks: TaskView[]; all: TaskView[]; statuses: TaskStatus[]; hierarchy: boolean; open: (id: string) => void }) {
  const { update } = useTaskActions();
  const [group, setGroup] = useState<'status' | 'hierarchy'>('status');
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const top = tasks.filter((t) => !t.parentId || WORK_TYPES.includes(t.type));
  const row = (t: TaskView, depth = 0, hasKids = false) => (
    <tr key={t.id} className="cursor-pointer border-b border-line/60 last:border-0 hover:bg-hover" onClick={() => open(t.id)} data-testid="task-row" data-title={t.title} data-type={t.type}>
      <td className="w-24 px-4 py-2 font-mono text-[11.5px] text-subtle">{t.ref ?? '—'}</td>
      <td className="py-2 font-medium text-ink">
        <span className="flex items-center gap-1.5" style={{ paddingLeft: depth * 18 }}>
          {group === 'hierarchy' &&
            (hasKids ? (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setClosed((v) => {
                    const n = new Set(v);
                    if (!n.delete(t.id)) n.add(t.id);
                    return n;
                  });
                }}
                className="text-muted"
                aria-label={closed.has(t.id) ? `Expand ${t.title}` : `Collapse ${t.title}`}
              >
                {closed.has(t.id) ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
              </button>
            ) : (
              <span className="w-[13px]" />
            ))}
          {hierarchy && <IssueIcon type={t.type} size={15} />}
          <span className={cn(ISSUE_RANK[t.type] < 2 && 'font-semibold')}>{t.title}</span>
          {t.blockedBy > 0 && <Ban size={12} className="text-red-500" />}
        </span>
      </td>
      <td className="w-40 py-2">{t.assignee ? <span className="flex items-center gap-1.5"><Avatar user={t.assignee} size={20} />{t.assignee.name.split(' ')[0]}</span> : <span className="text-subtle">—</span>}</td>
      <td className="w-12 py-2"><Points n={t.storyPoints} /></td>
      <td className="w-28 py-2"><PriorityChip p={t.priority} /></td>
      <td className="w-24 py-2"><Due t={t} /></td>
      <td className="w-36 py-2 pr-4" onClick={(e) => e.stopPropagation()}>
        <select value={t.status} disabled={!t.canEdit} onChange={(e) => update.mutate({ id: t.id, status: e.target.value })} className="h-7 w-full rounded-md border border-line bg-surface px-1.5 text-[12px]" aria-label={`Status of ${t.title}`}>
          {statuses.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </select>
      </td>
    </tr>
  );
  // Hierarchy: phases › epics › work items › subtasks (an item whose parent is filtered out starts its own branch).
  const tree = () => {
    const ids = new Set(tasks.map((t) => t.id));
    const roots = tasks.filter((t) => !t.parentId || !ids.has(t.parentId)).sort((a, b) => ISSUE_RANK[a.type] - ISSUE_RANK[b.type] || (a.position < b.position ? -1 : 1));
    const out: React.ReactNode[] = [];
    const walk = (t: TaskView, depth: number) => {
      const kids = tasks.filter((x) => x.parentId === t.id).sort((a, b) => ISSUE_RANK[a.type] - ISSUE_RANK[b.type] || (a.position < b.position ? -1 : 1));
      out.push(row(t, depth, kids.length > 0));
      if (!closed.has(t.id)) for (const k of kids) walk(k, depth + 1);
    };
    for (const r of roots) walk(r, 0);
    return out;
  };
  void all;
  return (
    <div className="h-full overflow-y-auto p-5" data-testid="task-list">
      {hierarchy && (
        <div className="mb-3 flex items-center gap-2 text-[12.5px]">
          <span className="text-muted">Group by</span>
          {(['status', 'hierarchy'] as const).map((g) => (
            <button key={g} onClick={() => setGroup(g)} className={cn('rounded-md px-2.5 py-1 capitalize', group === g ? 'bg-selected font-semibold text-brand-700' : 'text-ink-2 hover:bg-hover')} data-testid={`group-${g}`}>
              {g}
            </button>
          ))}
        </div>
      )}
      {group === 'hierarchy' ? (
        <section className="card overflow-hidden" data-testid="hierarchy">
          <table className="w-full text-[13px]">
            <tbody>{tree()}</tbody>
          </table>
        </section>
      ) : (
        statuses.map((s) => {
          const list = top.filter((t) => columnOf(t, statuses) === s.id);
          if (!list.length) return null;
          return (
            <section key={s.id} className="card mb-4 overflow-hidden">
              <div className="flex items-center gap-2 border-b border-line px-4 py-2">
                <span className="size-2.5 rounded-full" style={{ background: s.color }} />
                <span className="text-[13px] font-semibold text-ink">{s.name}</span>
                <span className="text-[12px] text-muted">{list.length}</span>
              </div>
              <table className="w-full text-[13px]">
                <tbody>{list.map((t) => row(t))}</tbody>
              </table>
            </section>
          );
        })
      )}
      {!top.length && <EmptyState icon={<CheckSquare size={32} />} title="No tasks" />}
    </div>
  );
}

// ── Intake ──────────────────────────────────────────────────────────────────

function IntakeView({ tasks, canEdit, open }: { tasks: TaskView[]; canEdit: boolean; open: (id: string) => void }) {
  const { update, decline } = useTaskActions();
  const [declining, setDeclining] = useState<TaskView | null>(null);
  const [reason, setReason] = useState('');
  return (
    <div className="h-full overflow-y-auto p-5" data-testid="intake">
      <div className="mx-auto max-w-[920px]">
        <p className="mb-3 text-[13px] text-muted">Requests filed by people who can see the project. Accept to put them on the backlog, or decline with a reason.</p>
        {tasks.length ? (
          <ul className="space-y-2">
            {tasks.map((t) => (
              <li key={t.id} className="flex items-start gap-3 rounded-xl bg-surface p-4 ring-1 ring-line" data-testid="request-item" data-title={t.title}>
                <IssueIcon type={t.type} size={18} className="mt-0.5" />
                <button onClick={() => open(t.id)} className="min-w-0 flex-1 text-left">
                  <p className="text-[14px] font-medium text-ink">{t.title}</p>
                  <p className="mt-0.5 text-[12px] text-muted">
                    {t.ref} · {t.reporter?.name ?? 'Someone'} · {formatShort(t.createdAt)}
                    {t.priority !== 'none' && ` · ${PRIORITY[t.priority].label}`}
                  </p>
                  {t.description && <p className="mt-1 line-clamp-2 text-[13px] text-ink-2">{t.description}</p>}
                </button>
                {canEdit && (
                  <div className="flex shrink-0 gap-2">
                    <Button size="sm" variant="ghost" icon={<X size={14} />} onClick={() => (setDeclining(t), setReason(''))} data-testid="decline-request">
                      Decline
                    </Button>
                    <Button size="sm" variant="primary" icon={<Check size={14} />} onClick={() => update.mutate({ id: t.id, triage: false })} data-testid="accept-request">
                      Accept
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState icon={<Inbox size={30} />} title="No requests waiting" />
        )}
      </div>
      <Dialog
        open={!!declining}
        onOpenChange={(o) => !o && setDeclining(null)}
        title="Decline this request"
        description={declining ? `${declining.reporter?.name ?? 'The requester'} will see your reason.` : ''}
        footer={
          <Button variant="danger" loading={decline.isPending} onClick={() => declining && decline.mutate({ id: declining.id, reason }, { onSuccess: () => setDeclining(null) })} data-testid="confirm-decline">
            Decline
          </Button>
        }
      >
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="Why not?" aria-label="Reason" className="w-full rounded-lg border border-line-strong px-3 py-2 text-[13.5px] outline-none focus:border-brand-500" />
      </Dialog>
    </div>
  );
}

// ── Gantt ───────────────────────────────────────────────────────────────────

const DAY = 86_400_000;
const dayOf = (s: string) => new Date(`${s}T00:00:00`).getTime();

function GanttView({ tasks, statuses, open }: { tasks: TaskView[]; statuses: TaskStatus[]; open: (id: string) => void }) {
  const dated = tasks.filter((t) => t.startDate || t.dueDate);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const scroller = useRef<HTMLDivElement>(null);
  const px = 26;
  const LEFT = 440;
  const starts = dated.map((t) => dayOf(t.startDate ?? t.dueDate!));
  const ends = dated.map((t) => dayOf(t.dueDate ?? t.startDate!));
  const from = Math.min(...starts, Date.now()) - 3 * DAY;
  const to = Math.max(...ends, Date.now()) + 7 * DAY;
  const days = Math.round((to - from) / DAY);
  const todayX = ((new Date(new Date().toDateString()).getTime() - from) / DAY) * px;
  // Open on today rather than on the first phase.
  useEffect(() => {
    if (scroller.current) scroller.current.scrollLeft = Math.max(0, todayX - 7 * px);
  }, [dated.length > 0]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!dated.length) return <EmptyState icon={<CheckSquare size={32} />} title="Add start and due dates to see the plan" />;
  // Any depth: phase › epic › work item › subtask; an item whose parent has no dates starts a branch.
  const ids = new Set(dated.map((t) => t.id));
  const byStart = (a: TaskView, b: TaskView) => (a.startDate ?? a.dueDate!).localeCompare(b.startDate ?? b.dueDate!);
  const rows: { t: TaskView; depth: number }[] = [];
  const walk = (t: TaskView, depth: number) => {
    rows.push({ t, depth });
    if (!collapsed.has(t.id)) for (const c of dated.filter((x) => x.parentId === t.id).sort(byStart)) walk(c, depth + 1);
  };
  for (const r of dated.filter((t) => !t.parentId || !ids.has(t.parentId)).sort(byStart)) walk(r, 0);
  // A phase is as far along as its steps on average (the board counts finished subtasks instead).
  const progressOf = (t: TaskView) => {
    const kids = tasks.filter((x) => x.parentId === t.id);
    return kids.length ? Math.round(kids.reduce((n, k) => n + k.progress, 0) / kids.length) : t.progress;
  };
  const colorOf = (t: TaskView) => statuses.find((s) => s.id === t.status)?.color ?? '#2563eb';
  const months: { label: string; x: number }[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(from + i * DAY);
    if (d.getDate() === 1 || i === 0) months.push({ label: new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric' }).format(d), x: i * px });
  }
  const cols = 'grid-cols-[1fr_64px_64px_56px]';
  return (
    <div ref={scroller} className="h-full overflow-auto bg-surface" data-testid="gantt">
      <div className="relative" style={{ width: LEFT + days * px }}>
        <div className="sticky top-0 z-20 flex h-12 border-b border-line bg-surface">
          <div className={cn('sticky left-0 z-30 grid shrink-0 items-end border-r border-line bg-surface px-3 pb-1.5 text-[11.5px] font-medium text-muted', cols)} style={{ width: LEFT }}>
            <span>Task</span>
            <span>Start</span>
            <span>Due</span>
            <span className="text-right">Progress</span>
          </div>
          <div className="relative" style={{ width: days * px }}>
            {months.map((m) => (
              <span key={m.x} className="absolute top-1 whitespace-nowrap text-[11.5px] font-medium text-ink-2" style={{ left: m.x + 4 }}>
                {m.label}
              </span>
            ))}
            {Array.from({ length: days }, (_, i) => {
              const d = new Date(from + i * DAY);
              return (
                <span key={i} className={cn('absolute bottom-1 w-[26px] text-center text-[10px]', d.getDay() === 0 || d.getDay() === 6 ? 'text-subtle' : 'text-muted')} style={{ left: i * px }}>
                  {d.getDate()}
                </span>
              );
            })}
          </div>
        </div>
        <div className="relative">
          <div className="pointer-events-none absolute inset-y-0" style={{ left: LEFT, width: days * px }}>
            {Array.from({ length: days }, (_, i) => {
              const d = new Date(from + i * DAY);
              return d.getDay() === 0 || d.getDay() === 6 ? <span key={i} className="absolute inset-y-0 bg-canvas" style={{ left: i * px, width: px }} /> : null;
            })}
            <span className="absolute inset-y-0 z-[5] w-0.5 bg-red-500" style={{ left: todayX }} data-testid="gantt-today">
              <span className="absolute left-1 top-0 rounded bg-red-500 px-1 text-[10px] text-white">Today</span>
            </span>
          </div>
          {rows.map(({ t, depth }) => {
            const kids = dated.some((x) => x.parentId === t.id);
            const progress = progressOf(t);
            const s = dayOf(t.startDate ?? t.dueDate!);
            const e = dayOf(t.dueDate ?? t.startDate!) + DAY;
            const left = ((s - from) / DAY) * px;
            const width = Math.max(px * 0.6, ((e - s) / DAY) * px - 4);
            const c = t.type === 'phase' ? '#4f46e5' : t.type === 'epic' ? '#7c3aed' : colorOf(t);
            const container = ISSUE_RANK[t.type] < 2;
            return (
              <div key={t.id} className="flex h-9 border-b border-line/60 hover:bg-hover/40" data-testid="gantt-row" data-title={t.title} data-type={t.type}>
                <div className={cn('sticky left-0 z-10 grid shrink-0 items-center border-r border-line bg-surface px-3 text-[12.5px]', cols)} style={{ width: LEFT }}>
                  <span className="flex min-w-0 items-center gap-1" style={{ paddingLeft: depth * 16 }}>
                    {kids ? (
                      <button
                        onClick={() =>
                          setCollapsed((v) => {
                            const n = new Set(v);
                            if (!n.delete(t.id)) n.add(t.id);
                            return n;
                          })
                        }
                        aria-label={collapsed.has(t.id) ? `Expand ${t.title}` : `Collapse ${t.title}`}
                        className="text-muted"
                      >
                        {collapsed.has(t.id) ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                      </button>
                    ) : (
                      <span className="w-[13px]" />
                    )}
                    <IssueIcon type={t.type} size={14} />
                    <button onClick={() => open(t.id)} className={cn('truncate text-left hover:underline', depth === 0 || container ? 'font-semibold text-ink' : 'text-ink-2')}>
                      {t.title}
                    </button>
                  </span>
                  <span className="text-muted">{t.startDate ? shortDate(t.startDate) : '—'}</span>
                  <span className="text-muted">{t.dueDate ? shortDate(t.dueDate) : '—'}</span>
                  <span className="text-right tabular-nums text-ink-2" data-testid="gantt-progress">
                    {t.type === 'milestone' ? (t.completedAt ? '✓' : '—') : `${progress}%`}
                  </span>
                </div>
                <div className="relative" style={{ width: days * px }}>
                  {t.type === 'milestone' ? (
                    <button onClick={() => open(t.id)} className="absolute top-2.5 z-[6] size-4 rotate-45 rounded-[2px]" style={{ left: ((dayOf(t.dueDate ?? t.startDate!) - from) / DAY) * px + px / 2 - 8, background: t.completedAt ? '#10b981' : '#d97706' }} title={`${t.title} (milestone)`} data-testid="gantt-milestone" />
                  ) : (
                    <button
                      onClick={() => open(t.id)}
                      className={cn('absolute z-[6] overflow-hidden rounded-[4px] text-left', container ? 'top-2 h-5' : 'top-2.5 h-4')}
                      style={{ left: left + 2, width, background: `${c}33`, borderLeft: `3px solid ${c}` }}
                      title={`${t.title}: ${progress}%`}
                      data-testid="gantt-bar"
                    >
                      <span className="block h-full" style={{ width: `${progress}%`, background: c, opacity: 0.85 }} />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Calendar by due date ────────────────────────────────────────────────────

function DueCalendar({ tasks, statuses, open }: { tasks: TaskView[]; statuses: TaskStatus[]; open: (id: string) => void }) {
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const first = new Date(month.getFullYear(), month.getMonth(), 1 - month.getDay());
  const key = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const today = todayStr();
  return (
    <div className="flex h-full flex-col p-5" data-testid="due-calendar">
      <div className="mb-2 flex items-center gap-2">
        <button onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} className="rounded p-1 hover:bg-hover" aria-label="Previous month">
          <ChevronLeft size={16} />
        </button>
        <span className="text-[15px] font-semibold text-ink">{new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(month)}</span>
        <button onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} className="rounded p-1 hover:bg-hover" aria-label="Next month">
          <ChevronRight size={16} />
        </button>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-7 grid-rows-[auto_repeat(6,1fr)] overflow-hidden rounded-xl border border-line bg-surface">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
          <div key={d} className="border-b border-line py-1 text-center text-[12px] text-muted">
            {d}
          </div>
        ))}
        {Array.from({ length: 42 }, (_, i) => new Date(first.getFullYear(), first.getMonth(), first.getDate() + i)).map((d) => {
          const list = tasks.filter((t) => t.dueDate === key(d));
          return (
            <div key={key(d)} className={cn('min-h-0 overflow-hidden border-b border-l border-line p-1', d.getMonth() !== month.getMonth() && 'bg-canvas/60')}>
              <div className={cn('mb-0.5 flex size-6 items-center justify-center rounded-full text-[12px]', key(d) === today ? 'bg-brand-600 font-semibold text-white' : 'text-ink-2')}>{d.getDate()}</div>
              {list.slice(0, 3).map((t) => (
                <button key={t.id} onClick={() => open(t.id)} className={cn('flex w-full items-center gap-1 truncate rounded px-1 text-left text-[11.5px] hover:bg-hover', t.completedAt && 'text-muted line-through')} data-testid="due-task" data-title={t.title}>
                  <span className="size-2 shrink-0 rounded-full" style={{ background: statuses.find((s) => s.id === t.status)?.color ?? '#64748b' }} />
                  <span className="truncate">{t.title}</span>
                </button>
              ))}
              {list.length > 3 && <span className="px-1 text-[11px] text-muted">+{list.length - 3} more</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Dialogs ─────────────────────────────────────────────────────────────────

const CREATE_TYPES: IssueType[] = ['story', 'task', 'bug', 'epic', 'phase', 'milestone'];

function NewTaskDialog({ open, onClose, project, tasks, status, sprintId, onCreated }: { open: boolean; onClose: () => void; project: Project | null; tasks: TaskView[]; status?: string; sprintId?: string | null; onCreated: (id: string) => void }) {
  const [title, setTitle] = useState('');
  const [assignee, setAssignee] = useState('');
  const [due, setDue] = useState('');
  const [priority, setPriority] = useState('none');
  const [type, setType] = useState<IssueType>('task');
  const [parent, setParent] = useState('');
  const [points, setPoints] = useState('');
  const { data: users } = useUsers();
  const { create } = useTaskActions();
  const close = () => (onClose(), setTitle(''), setAssignee(''), setDue(''), setPriority('none'), setType('task'), setParent(''), setPoints(''));
  // Possible parents: anything one level up (phases for epics, epics or phases for work items and milestones).
  const parents = project ? tasks.filter((t) => !t.triage && ISSUE_RANK[t.type] < ISSUE_RANK[type] && ISSUE_RANK[t.type] < 2) : [];
  const save = async () => {
    const t = await create.mutateAsync({
      projectId: project?.id ?? null,
      title,
      status,
      assigneeId: assignee || null,
      dueDate: due || null,
      priority: priority as never,
      ...(project ? { type, parentId: parent || null, storyPoints: points ? Number(points) : null, sprintId: WORK_TYPES.includes(type) ? sprintId ?? null : null } : {}),
    });
    close();
    onCreated(t.id);
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => !v && close()}
      title={project ? `New issue in ${project.name}` : 'New personal task'}
      width={500}
      footer={
        <Button variant="primary" disabled={!title.trim()} loading={create.isPending} onClick={save} data-testid="task-save">
          Create
        </Button>
      }
    >
      <div className="space-y-3">
        {project && (
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Issue type">
            {CREATE_TYPES.map((t) => (
              <button key={t} role="radio" aria-checked={type === t} onClick={() => (setType(t), setParent(''))} className={cn('flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12.5px] ring-1', type === t ? 'bg-selected font-semibold text-brand-700 ring-brand-200' : 'text-ink-2 ring-line hover:bg-hover')} data-testid={`type-${t}`}>
                <IssueIcon type={t} size={14} /> {ISSUE_META[t].label}
              </button>
            ))}
          </div>
        )}
        <input value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && title.trim() && save()} placeholder="Task title" aria-label="Task title" className="h-10 w-full rounded-lg border border-line-strong px-3 text-[14px] outline-none focus:border-brand-500" />
        <div className="grid grid-cols-3 gap-2">
          <select value={assignee} onChange={(e) => setAssignee(e.target.value)} className="h-9 rounded-lg border border-line-strong bg-surface px-2 text-[13px]" aria-label="Assignee">
            <option value="">Unassigned</option>
            {(users ?? []).map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
          <select value={priority} onChange={(e) => setPriority(e.target.value)} className="h-9 rounded-lg border border-line-strong bg-surface px-2 text-[13px]" aria-label="Priority">
            {Object.entries(PRIORITY).map(([k, p]) => (
              <option key={k} value={k}>
                {p.label}
              </option>
            ))}
          </select>
          <input type="date" value={due} onChange={(e) => setDue(e.target.value)} className="h-9 rounded-lg border border-line-strong px-2 text-[13px]" aria-label="Due date" />
        </div>
        {project && (
          <div className="grid grid-cols-[1fr_110px] gap-2">
            <select value={parent} onChange={(e) => setParent(e.target.value)} disabled={!parents.length} className="h-9 rounded-lg border border-line-strong bg-surface px-2 text-[13px]" aria-label="Parent">
              <option value="">{parents.length ? 'No parent' : type === 'phase' ? 'Phases are at the top' : 'No epic or phase yet'}</option>
              {parents.map((p) => (
                <option key={p.id} value={p.id}>
                  {ISSUE_META[p.type].label}: {p.title}
                </option>
              ))}
            </select>
            <input type="number" min={0} value={points} onChange={(e) => setPoints(e.target.value)} placeholder="Points" aria-label="Story points" disabled={!WORK_TYPES.includes(type)} className="h-9 rounded-lg border border-line-strong px-2 text-[13px] disabled:bg-canvas" />
          </div>
        )}
      </div>
    </Dialog>
  );
}

function RequestDialog({ open, onClose, project }: { open: boolean; onClose: () => void; project: Project }) {
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [type, setType] = useState<'story' | 'task' | 'bug'>('task');
  const { request } = useTaskActions();
  const close = () => (onClose(), setTitle(''), setDesc(''), setType('task'));
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => !v && close()}
      title={`Request in ${project.name}`}
      description="Your request goes to the project's intake queue; you will hear when it is accepted or declined."
      width={480}
      footer={
        <Button variant="primary" disabled={!title.trim()} loading={request.isPending} onClick={() => request.mutate({ projectId: project.id, title, description: desc || null, type }, { onSuccess: close })} data-testid="request-save">
          Send request
        </Button>
      }
    >
      <div className="space-y-3">
        <div className="flex gap-1.5" role="radiogroup" aria-label="Request type">
          {(['task', 'story', 'bug'] as const).map((t) => (
            <button key={t} role="radio" aria-checked={type === t} onClick={() => setType(t)} className={cn('flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12.5px] ring-1', type === t ? 'bg-selected font-semibold text-brand-700 ring-brand-200' : 'text-ink-2 ring-line hover:bg-hover')}>
              <IssueIcon type={t} size={14} /> {t === 'bug' ? 'Report a bug' : t === 'story' ? 'Feature' : 'Task'}
            </button>
          ))}
        </div>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What do you need?" aria-label="Request title" className="h-10 w-full rounded-lg border border-line-strong px-3 text-[14px] outline-none focus:border-brand-500" />
        <textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={4} placeholder="Details, steps to reproduce, why it matters…" aria-label="Request details" className="w-full rounded-lg border border-line-strong px-3 py-2 text-[13.5px] outline-none focus:border-brand-500" />
      </div>
    </Dialog>
  );
}

function ProjectSettingsDialog({ open, onClose, project }: { open: boolean; onClose: () => void; project: Project }) {
  const { data: users } = useUsers();
  const { updateProject } = useTaskActions();
  const [tab, setTab] = useState<'general' | 'workflow' | 'board'>('general');
  const [methodology, setMethodology] = useState<Methodology>(project.methodology);
  const [lead, setLead] = useState(project.lead?.id ?? '');
  const [intake, setIntake] = useState(project.intakeOpen);
  const [sprintDays, setSprintDays] = useState(project.sprintDays);
  const [dailyTime, setDailyTime] = useState(project.dailyTime);
  const [wip, setWip] = useState<Record<string, number>>(project.wipLimits);
  const [workflow, setWorkflow] = useState<WorkflowId>(project.workflow);
  const [statuses, setStatuses] = useState<TaskStatus[]>(project.statuses);
  const [strict, setStrict] = useState(project.strictWorkflow);
  const save = () => {
    const changedStatuses = JSON.stringify(statuses) !== JSON.stringify(project.statuses);
    updateProject.mutate(
      {
        id: project.id,
        methodology,
        leadId: lead || null,
        intakeOpen: intake,
        sprintDays,
        dailyTime,
        wipLimits: Object.fromEntries(Object.entries(wip).filter(([k, v]) => v > 0 && statuses.some((x) => x.id === k))),
        strictWorkflow: strict,
        ...(workflow === 'custom' ? (changedStatuses ? { statuses } : {}) : workflow !== project.workflow ? { workflow } : {}),
      },
      { onSuccess: onClose },
    );
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => !v && onClose()}
      title={`${project.name} settings`}
      width={640}
      footer={
        <Button variant="primary" loading={updateProject.isPending} onClick={save} data-testid="settings-save">
          Save
        </Button>
      }
    >
      <nav className="mb-4 flex gap-1 border-b border-line" role="tablist">
        {(['general', 'workflow', 'board'] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={cn('-mb-px border-b-2 px-3 py-1.5 text-[13px] capitalize', tab === t ? 'border-brand-600 font-semibold text-brand-700' : 'border-transparent text-muted hover:text-ink')} data-testid={`settings-tab-${t}`}>
            {t}
          </button>
        ))}
      </nav>
      {tab === 'general' && (
        <div className="space-y-4 text-[13px]">
          <div>
            <p className="mb-1.5 font-medium text-ink-2">How the project is run</p>
            <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Methodology">
              {(Object.keys(METHODOLOGY) as Methodology[]).map((m) => (
                <button key={m} role="radio" aria-checked={methodology === m} onClick={() => setMethodology(m)} className={cn('rounded-lg p-2.5 text-left ring-1', methodology === m ? 'bg-selected ring-brand-300' : 'ring-line hover:bg-hover')} data-testid={`methodology-${m}`}>
                  <span className="block font-semibold text-ink">{METHODOLOGY[m].label}</span>
                  <span className="text-[12px] text-muted">{METHODOLOGY[m].note}</span>
                </button>
              ))}
            </div>
          </div>
          <label className="block">
            <span className="mb-1.5 block font-medium text-ink-2">Project lead (receives requests)</span>
            <select value={lead} onChange={(e) => setLead(e.target.value)} className="h-9 w-full rounded-lg border border-line-strong bg-surface px-2" aria-label="Project lead">
              <option value="">No lead</option>
              {(users ?? []).map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={intake} onChange={(e) => setIntake(e.target.checked)} className="accent-brand-600" data-testid="intake-open" />
            People who can see the project may file requests
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label>
              <span className="mb-1.5 block font-medium text-ink-2">Sprint length</span>
              <select value={sprintDays} onChange={(e) => setSprintDays(Number(e.target.value))} className="h-9 w-full rounded-lg border border-line-strong bg-surface px-2" aria-label="Sprint length">
                {[7, 14, 21, 28].map((d) => (
                  <option key={d} value={d}>
                    {d / 7} week{d === 7 ? '' : 's'}
                  </option>
                ))}
                {![7, 14, 21, 28].includes(sprintDays) && <option value={sprintDays}>{sprintDays} days</option>}
              </select>
            </label>
            <label>
              <span className="mb-1.5 block font-medium text-ink-2">Daily Scrum at</span>
              <input type="time" value={dailyTime} onChange={(e) => setDailyTime(e.target.value)} className="h-9 w-full rounded-lg border border-line-strong bg-surface px-2" aria-label="Daily Scrum time" />
            </label>
          </div>
        </div>
      )}
      {tab === 'workflow' && <WorkflowSettings workflow={workflow} setWorkflow={setWorkflow} statuses={statuses} setStatuses={setStatuses} strict={strict} setStrict={setStrict} />}
      {tab === 'board' && (
        <div className="text-[13px]">
          <p className="mb-1.5 font-medium text-ink-2">Work-in-progress limits (empty = none)</p>
          <div className="grid grid-cols-2 gap-2">
            {statuses.map((st) => (
              <label key={st.id} className="flex items-center gap-2">
                <span className="size-2.5 rounded-full" style={{ background: st.color }} />
                <span className="flex-1">{st.name}</span>
                <input type="number" min={0} value={wip[st.id] || ''} onChange={(e) => setWip((w) => ({ ...w, [st.id]: Number(e.target.value) || 0 }))} className="h-8 w-20 rounded-lg border border-line-strong px-2" aria-label={`WIP limit ${st.name}`} />
              </label>
            ))}
          </div>
        </div>
      )}
    </Dialog>
  );
}

function NewProjectDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const { data: spaces } = useSpaces();
  const editable = (spaces ?? []).filter((s) => can(s.myRole, 'editor'));
  const [spaceId, setSpaceId] = useState('');
  const [name, setName] = useState('');
  const [key, setKey] = useState('');
  const [methodology, setMethodology] = useState<Methodology>('kanban');
  const [workflow, setWorkflow] = useState<Exclude<WorkflowId, 'custom'> | ''>('');
  const { createProject } = useTaskActions();
  const close = () => (onClose(), setName(''), setKey(''), setMethodology('kanban'), setWorkflow(''));
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => !v && close()}
      title="New project"
      description="A project lives in a space: its people see it, editors work on it."
      footer={
        <Button
          variant="primary"
          disabled={!name.trim() || !(spaceId || editable[0])}
          loading={createProject.isPending}
          onClick={async () => {
            const p = await createProject.mutateAsync({ spaceId: spaceId || editable[0].id, name, key: key || undefined, methodology, ...(workflow ? { workflow } : {}) });
            close();
            onCreated(p.id);
          }}
          data-testid="project-save"
        >
          Create project
        </Button>
      }
    >
      <div className="space-y-3">
        <select value={spaceId || editable[0]?.id || ''} onChange={(e) => setSpaceId(e.target.value)} className="h-9 w-full rounded-lg border border-line-strong bg-surface px-2 text-[13px]" aria-label="Space">
          {editable.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Project name" aria-label="Project name" className="h-9 w-full rounded-lg border border-line-strong px-3 text-[13px] outline-none focus:border-brand-500" />
        <input value={key} onChange={(e) => setKey(e.target.value.toUpperCase())} placeholder="Key (e.g. WEB) — optional" aria-label="Project key" maxLength={10} className="h-9 w-full rounded-lg border border-line-strong px-3 text-[13px] outline-none focus:border-brand-500" />
        <select value={methodology} onChange={(e) => setMethodology(e.target.value as Methodology)} className="h-9 w-full rounded-lg border border-line-strong bg-surface px-2 text-[13px]" aria-label="Methodology">
          {(Object.keys(METHODOLOGY) as Methodology[]).map((m) => (
            <option key={m} value={m}>
              {METHODOLOGY[m].label} — {METHODOLOGY[m].note}
            </option>
          ))}
        </select>
        <select value={workflow} onChange={(e) => setWorkflow(e.target.value as typeof workflow)} className="h-9 w-full rounded-lg border border-line-strong bg-surface px-2 text-[13px]" aria-label="Workflow">
          <option value="">Workflow: {methodology === 'waterfall' ? 'Waterfall (stage gate)' : 'Software development'} (recommended)</option>
          {WORKFLOWS.map((w) => (
            <option key={w.id} value={w.id}>
              Workflow: {w.name}
            </option>
          ))}
        </select>
      </div>
    </Dialog>
  );
}
