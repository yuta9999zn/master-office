'use client';

import { ACTION_TYPES, CONDITION_OPS, NO_AUTOMATION, TRIGGER_TYPES, type AutomationRole, type FlowNode, type NodeAutomation, type PlainFlow, type TypeDef } from '@workos/flow-model';
import { Bolt, GitFork, Info, Play, X } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { useApprovalTemplates } from '@/lib/approvals';
import { useBaseSchema } from '@/lib/base';
import { useConversations } from '@/lib/chat';
import { useMailboxes } from '@/lib/mail';
import { useResources, useUsers } from '@/lib/queries';
import { useProjects } from '@/lib/tasks';
import { Avatar, cn } from '../ui/primitives';
import type { FlowStore } from './flow-store';

const field = 'h-8 w-full rounded-md border border-line-strong bg-surface px-2 text-[12.5px] text-ink outline-none focus:border-brand-500 disabled:bg-canvas';
const area = 'w-full rounded-md border border-line-strong bg-surface px-2 py-1.5 text-[12.5px] text-ink outline-none focus:border-brand-500 disabled:bg-canvas';

const ROLES: { id: AutomationRole; label: string; note: string; icon: typeof Bolt }[] = [
  { id: 'none', label: 'Just a step', note: 'Documents the process; the run passes through it.', icon: Info },
  { id: 'trigger', label: 'Trigger', note: 'Starts a run when something happens.', icon: Bolt },
  { id: 'action', label: 'Action', note: 'Does something: e-mail, task, record, notification…', icon: Play },
  { id: 'condition', label: 'Condition', note: 'Tests a value and follows the Yes or No connector.', icon: GitFork },
];

/** Inspector → Automation (§77 batch 2): what one shape does when the flow runs, with an explanation of each choice. */
export function AutomationPanel({ store, flow, n, ro }: { store: FlowStore; flow: PlainFlow; n: FlowNode; ro: boolean }) {
  const a = n.automation ?? NO_AUTOMATION;
  const set = (patch: Partial<NodeAutomation>) => store.updateNode(n.id, { automation: { ...a, ...patch } });
  const setConfig = (patch: Record<string, unknown>) => set({ config: { ...a.config, ...patch } });
  const types = a.role === 'trigger' ? TRIGGER_TYPES : a.role === 'action' ? ACTION_TYPES : [];
  const def = (types as TypeDef<string>[]).find((t) => t.id === a.type);
  return (
    <div className="space-y-3" data-testid="automation-panel">
      <div>
        <label className="mb-1 block text-[12px] font-medium text-ink-2">Role of “{n.text.trim() || n.shape}”</label>
        <select disabled={ro} value={a.role} onChange={(e) => set({ role: e.target.value as AutomationRole, type: '', config: {} })} className={field} aria-label="Automation role" data-testid="automation-role">
          {ROLES.map((r) => (
            <option key={r.id} value={r.id}>
              {r.label}
            </option>
          ))}
        </select>
        <p className="mt-1 text-[11.5px] text-muted">{ROLES.find((r) => r.id === a.role)?.note}</p>
      </div>

      {(a.role === 'trigger' || a.role === 'action') && (
        <div>
          <label className="mb-1 block text-[12px] font-medium text-ink-2">{a.role === 'trigger' ? 'When' : 'What it does'}</label>
          <select disabled={ro} value={a.type} onChange={(e) => set({ type: e.target.value, config: defaultsFor(e.target.value) })} className={field} aria-label={a.role === 'trigger' ? 'Trigger type' : 'Action type'} data-testid="automation-type">
            <option value="">Choose…</option>
            {types.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
          {def && (
            <div className="mt-2 rounded-md bg-canvas px-2.5 py-2 text-[11.5px] leading-relaxed text-ink-2" data-testid="automation-explain">
              <p>{def.description ?? def.note}</p>
              {def.outputs?.length ? (
                <p className="mt-1 text-muted">
                  Gives: {def.outputs.map((o) => (
                    <code key={o} className="mr-1 rounded bg-surface px-1">{`{{${a.role === 'trigger' ? 'trigger' : `steps.${n.id}`}.${o}}}`}</code>
                  ))}
                </p>
              ) : null}
            </div>
          )}
        </div>
      )}

      {a.role === 'trigger' && a.type && <TriggerConfig type={a.type} cfg={a.config} set={setConfig} ro={ro} />}
      {a.role === 'action' && a.type && <ActionConfig type={a.type} cfg={a.config} set={setConfig} ro={ro} />}
      {a.role === 'condition' && <ConditionConfig cfg={a.config} set={setConfig} ro={ro} />}

      {a.role !== 'none' && <Placeholders flow={flow} n={n} />}
    </div>
  );
}

function defaultsFor(type: string): Record<string, unknown> {
  switch (type) {
    case 'schedule':
      return { schedule: { every: 'day', hour: 9 } };
    case 'delay':
      return { minutes: 60 };
    case 'notify':
      return { toTrigger: true, userIds: [] };
    case 'webhook':
      return { method: 'POST' };
    case 'base.updateRecord':
      return { recordId: '{{trigger.recordId}}' };
    default:
      return {};
  }
}

function Field({ label, help, children }: { label: string; help?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[12px] font-medium text-ink-2">{label}</span>
      {children}
      {help && <span className="mt-0.5 block text-[11px] text-muted">{help}</span>}
    </label>
  );
}

const Text = ({ value, onChange, ro, placeholder, label, multiline, testId }: { value: unknown; onChange: (v: string) => void; ro: boolean; placeholder?: string; label: string; multiline?: boolean; testId?: string }) =>
  multiline ? (
    <textarea disabled={ro} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} rows={3} className={area} aria-label={label} data-testid={testId} />
  ) : (
    <input disabled={ro} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className={field} aria-label={label} data-testid={testId} />
  );

// ── Pickers ─────────────────────────────────────────────────────────────────

function ResourcePick({ type, value, onChange, ro, label, any }: { type: 'form' | 'base'; value: unknown; onChange: (v: string) => void; ro: boolean; label: string; any?: string }) {
  const { data } = useResources({ type });
  const list = (Array.isArray(data) ? data : ((data as unknown as { items?: { id: string; name: string }[] })?.items ?? [])) as { id: string; name: string }[];
  return (
    <select disabled={ro} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} className={field} aria-label={label}>
      <option value="">{any ?? 'Choose…'}</option>
      {list.map((r) => (
        <option key={r.id} value={r.id}>
          {r.name}
        </option>
      ))}
    </select>
  );
}

function TablePick({ cfg, set, ro }: { cfg: Record<string, unknown>; set: (p: Record<string, unknown>) => void; ro: boolean }) {
  const { data: schema } = useBaseSchema(String(cfg.baseId ?? ''));
  return (
    <>
      <Field label="Base">
        <ResourcePick type="base" value={cfg.baseId} onChange={(v) => set({ baseId: v, tableId: '' })} ro={ro} label="Base" />
      </Field>
      <Field label="Table">
        <select disabled={ro || !cfg.baseId} value={String(cfg.tableId ?? '')} onChange={(e) => set({ tableId: e.target.value })} className={field} aria-label="Table">
          <option value="">Choose…</option>
          {schema?.tables.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </Field>
    </>
  );
}

/** One text input per field of the chosen table (values keyed by field id, templates allowed). */
function FieldValues({ cfg, set, ro }: { cfg: Record<string, unknown>; set: (p: Record<string, unknown>) => void; ro: boolean }) {
  const { data: schema } = useBaseSchema(String(cfg.baseId ?? ''));
  const table = schema?.tables.find((t) => t.id === cfg.tableId);
  const values = (cfg.values as Record<string, unknown>) ?? {};
  if (!table) return null;
  const editable = table.fields.filter((f) => !['formula', 'createdTime', 'lastModifiedTime', 'autoNumber', 'createdBy', 'lastModifiedBy', 'lookup', 'rollup', 'count'].includes(f.type));
  return (
    <div className="space-y-1.5">
      <span className="block text-[12px] font-medium text-ink-2">Field values</span>
      {editable.map((f) => (
        <div key={f.id} className="grid grid-cols-[88px_1fr] items-center gap-1.5">
          <span className="truncate text-[11.5px] text-muted" title={f.name}>
            {f.name}
          </span>
          <input disabled={ro} value={String(values[f.id] ?? '')} onChange={(e) => set({ values: { ...values, [f.id]: e.target.value } })} placeholder={`{{trigger.…}}`} className={field} aria-label={`Value for ${f.name}`} />
        </div>
      ))}
    </div>
  );
}

function PeoplePick({ ids, onChange, ro }: { ids: string[]; onChange: (ids: string[]) => void; ro: boolean }) {
  const { data: users } = useUsers();
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap gap-1">
        {ids.map((id) => {
          const u = users?.find((x) => x.id === id);
          return (
            <span key={id} className="flex items-center gap-1 rounded-md bg-brand-50 px-1.5 py-0.5 text-[11.5px] text-brand-700" data-testid="notify-person">
              {u && <Avatar user={u} size={14} />} {u?.name ?? '…'}
              {!ro && (
                <button onClick={() => onChange(ids.filter((x) => x !== id))} aria-label={`Remove ${u?.name ?? 'person'}`}>
                  <X size={11} />
                </button>
              )}
            </span>
          );
        })}
      </div>
      <select disabled={ro} value="" onChange={(e) => e.target.value && !ids.includes(e.target.value) && onChange([...ids, e.target.value])} className={cn(field, 'text-muted')} aria-label="Add a person">
        <option value="">Add a person…</option>
        {users?.filter((u) => !ids.includes(u.id)).map((u) => (
          <option key={u.id} value={u.id}>
            {u.name}
          </option>
        ))}
      </select>
    </div>
  );
}

// ── Trigger config ──────────────────────────────────────────────────────────

function TriggerConfig({ type, cfg, set, ro }: { type: string; cfg: Record<string, unknown>; set: (p: Record<string, unknown>) => void; ro: boolean }) {
  const { data: templates } = useApprovalTemplates();
  const { data: projects } = useProjects();
  const { data: boxes } = useMailboxes();
  const project = projects?.find((p) => p.id === cfg.projectId);
  const s = (cfg.schedule as { every?: string; n?: number; hour?: number; weekday?: number } | undefined) ?? { every: 'day', hour: 9 };
  switch (type) {
    case 'form.submitted':
      return (
        <Field label="Form" help="Each response starts one run; answers are available as {{trigger.answers.Question title}}.">
          <ResourcePick type="form" value={cfg.formId} onChange={(v) => set({ formId: v })} ro={ro} label="Form" />
        </Field>
      );
    case 'base.recordCreated':
    case 'base.recordUpdated':
      return (
        <div className="space-y-2">
          <TablePick cfg={cfg} set={set} ro={ro} />
          <p className="text-[11px] text-muted">The record is available as {'{{trigger.record.Field name}}'}; its id as {'{{trigger.recordId}}'}.{type === 'base.recordUpdated' ? ' Changes made by this flow itself never start it again.' : ''}</p>
        </div>
      );
    case 'approval.finished':
      return (
        <div className="space-y-2">
          <Field label="Template" help="Leave “Any” to react to every approval in the organisation.">
            <select disabled={ro} value={String(cfg.templateId ?? '')} onChange={(e) => set({ templateId: e.target.value })} className={field} aria-label="Approval template">
              <option value="">Any template</option>
              {templates?.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Outcome">
            <select disabled={ro} value={String(cfg.status ?? '')} onChange={(e) => set({ status: e.target.value })} className={field} aria-label="Approval outcome">
              <option value="">Approved or rejected</option>
              <option value="approved">Approved only</option>
              <option value="rejected">Rejected only</option>
            </select>
          </Field>
        </div>
      );
    case 'task.statusChanged':
      return (
        <div className="space-y-2">
          <Field label="Project">
            <select disabled={ro} value={String(cfg.projectId ?? '')} onChange={(e) => set({ projectId: e.target.value, toStatus: '' })} className={field} aria-label="Project">
              <option value="">Any project</option>
              {projects?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Moves to" help="{{trigger.from}} and {{trigger.to}} carry the status ids; {{trigger.title}} the issue.">
            <select disabled={ro || !project} value={String(cfg.toStatus ?? '')} onChange={(e) => set({ toStatus: e.target.value })} className={field} aria-label="Target status">
              <option value="">Any status</option>
              {project?.statuses.map((st) => (
                <option key={st.id} value={st.id}>
                  {st.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
      );
    case 'schedule':
      return (
        <div className="space-y-2">
          <Field label="Repeat">
            <select disabled={ro} value={s.every} onChange={(e) => set({ schedule: { every: e.target.value, n: e.target.value === 'minutes' ? 15 : 1, hour: 9, weekday: 1 } })} className={field} aria-label="Repeat">
              <option value="minutes">Every N minutes</option>
              <option value="hours">Every N hours</option>
              <option value="day">Every day</option>
              <option value="week">Every week</option>
            </select>
          </Field>
          {(s.every === 'minutes' || s.every === 'hours') && (
            <Field label="N">
              <select disabled={ro} value={s.n ?? 1} onChange={(e) => set({ schedule: { ...s, n: Number(e.target.value) } })} className={field} aria-label="Interval">
                {(s.every === 'minutes' ? [1, 5, 10, 15, 30] : [1, 2, 4, 6, 8, 12]).map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {(s.every === 'day' || s.every === 'week') && (
            <Field label="At hour (server time)">
              <input type="number" min={0} max={23} disabled={ro} value={s.hour ?? 9} onChange={(e) => set({ schedule: { ...s, hour: Number(e.target.value) } })} className={field} aria-label="Hour" />
            </Field>
          )}
          {s.every === 'week' && (
            <Field label="Weekday">
              <select disabled={ro} value={s.weekday ?? 1} onChange={(e) => set({ schedule: { ...s, weekday: Number(e.target.value) } })} className={field} aria-label="Weekday">
                {['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((d, i) => (
                  <option key={d} value={i}>
                    {d}
                  </option>
                ))}
              </select>
            </Field>
          )}
        </div>
      );
    case 'mail.received':
      return (
        <Field label="Mailbox" help="{{trigger.from}}, {{trigger.subject}} and {{trigger.text}} describe the message.">
          <select disabled={ro} value={String(cfg.mailboxId ?? '')} onChange={(e) => set({ mailboxId: e.target.value })} className={field} aria-label="Mailbox">
            <option value="">Any mailbox</option>
            {boxes?.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name} ({b.address})
              </option>
            ))}
          </select>
        </Field>
      );
    default:
      return <p className="text-[11.5px] text-muted">Press <b>Run now</b> in the Runs tab. Anything typed as input is available as {'{{trigger.input.key}}'}.</p>;
  }
}

// ── Action config ───────────────────────────────────────────────────────────

function ActionConfig({ type, cfg, set, ro }: { type: string; cfg: Record<string, unknown>; set: (p: Record<string, unknown>) => void; ro: boolean }) {
  const { data: projects } = useProjects();
  const { data: templates } = useApprovalTemplates();
  const { data: convs } = useConversations();
  const { data: users } = useUsers();
  const [bodyText, setBodyText] = useState<string | null>(null);
  const template = templates?.find((t) => t.id === cfg.templateId);
  switch (type) {
    case 'mail.send':
      return (
        <div className="space-y-2">
          <Field label="To" help="Addresses separated by commas; templates allowed, e.g. {{trigger.email}}.">
            <Text ro={ro} value={cfg.to} onChange={(v) => set({ to: v })} label="To" placeholder="{{trigger.email}}" testId="action-to" />
          </Field>
          <Field label="Subject">
            <Text ro={ro} value={cfg.subject} onChange={(v) => set({ subject: v })} label="Subject" testId="action-subject" />
          </Field>
          <Field label="Message">
            <Text ro={ro} value={cfg.body} onChange={(v) => set({ body: v })} label="Message" multiline />
          </Field>
        </div>
      );
    case 'notify':
      return (
        <div className="space-y-2">
          <Field label="Title">
            <Text ro={ro} value={cfg.title} onChange={(v) => set({ title: v })} label="Notification title" testId="action-title" />
          </Field>
          <Field label="Text">
            <Text ro={ro} value={cfg.body} onChange={(v) => set({ body: v })} label="Notification text" multiline />
          </Field>
          <label className="flex items-center gap-2 text-[12px] text-ink-2">
            <input type="checkbox" disabled={ro} checked={cfg.toTrigger !== false} onChange={(e) => set({ toTrigger: e.target.checked })} className="accent-brand-600" /> Also the person behind the trigger (respondent, submitter, assignee)
          </label>
          <Field label="People">
            <PeoplePick ids={(cfg.userIds as string[]) ?? []} onChange={(ids) => set({ userIds: ids })} ro={ro} />
          </Field>
        </div>
      );
    case 'task.create':
      return (
        <div className="space-y-2">
          <Field label="Project">
            <select disabled={ro} value={String(cfg.projectId ?? '')} onChange={(e) => set({ projectId: e.target.value })} className={field} aria-label="Project">
              <option value="">Choose…</option>
              {projects?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Title">
            <Text ro={ro} value={cfg.title} onChange={(v) => set({ title: v })} label="Task title" placeholder="Follow up {{trigger.answers.Name}}" testId="action-title" />
          </Field>
          <Field label="Description">
            <Text ro={ro} value={cfg.description} onChange={(v) => set({ description: v })} label="Task description" multiline />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Assignee">
              <select disabled={ro} value={String(cfg.assigneeId ?? '')} onChange={(e) => set({ assigneeId: e.target.value })} className={field} aria-label="Assignee">
                <option value="">Nobody</option>
                {users?.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Priority">
              <select disabled={ro} value={String(cfg.priority ?? '')} onChange={(e) => set({ priority: e.target.value || undefined })} className={field} aria-label="Priority">
                <option value="">Default</option>
                {['low', 'medium', 'high', 'urgent'].map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="Due in (days)" help="Blank = no due date.">
            <input type="number" min={0} disabled={ro} value={String(cfg.dueInDays ?? '')} onChange={(e) => set({ dueInDays: e.target.value ? Number(e.target.value) : undefined })} className={field} aria-label="Due in days" />
          </Field>
        </div>
      );
    case 'base.createRecord':
      return (
        <div className="space-y-2">
          <TablePick cfg={cfg} set={set} ro={ro} />
          <FieldValues cfg={cfg} set={set} ro={ro} />
        </div>
      );
    case 'base.updateRecord':
      return (
        <div className="space-y-2">
          <TablePick cfg={cfg} set={set} ro={ro} />
          <Field label="Record id" help="Usually {{trigger.recordId}} (the record that started the flow) or {{steps.<shape id>.recordId}}.">
            <Text ro={ro} value={cfg.recordId} onChange={(v) => set({ recordId: v })} label="Record id" />
          </Field>
          <FieldValues cfg={cfg} set={set} ro={ro} />
        </div>
      );
    case 'approval.submit':
      return (
        <div className="space-y-2">
          <Field label="Template" help="Submitted as the flow’s owner; approvers see it like any request.">
            <select disabled={ro} value={String(cfg.templateId ?? '')} onChange={(e) => set({ templateId: e.target.value, values: {} })} className={field} aria-label="Approval template">
              <option value="">Choose…</option>
              {templates?.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </Field>
          {template && (
            <div className="space-y-1.5">
              <span className="block text-[12px] font-medium text-ink-2">Form values</span>
              {template.fields.map((f) => (
                <div key={f.id} className="grid grid-cols-[88px_1fr] items-center gap-1.5">
                  <span className="truncate text-[11.5px] text-muted" title={f.label}>
                    {f.label}
                  </span>
                  <input disabled={ro} value={String(((cfg.values as Record<string, unknown>) ?? {})[f.id] ?? '')} onChange={(e) => set({ values: { ...((cfg.values as Record<string, unknown>) ?? {}), [f.id]: e.target.value } })} className={field} aria-label={`Value for ${f.label}`} />
                </div>
              ))}
            </div>
          )}
        </div>
      );
    case 'chat.send':
      return (
        <div className="space-y-2">
          <Field label="Conversation" help="Posted by the flow’s owner.">
            <select disabled={ro} value={String(cfg.conversationId ?? '')} onChange={(e) => set({ conversationId: e.target.value })} className={field} aria-label="Conversation">
              <option value="">Choose…</option>
              {convs?.map((c) => (
                <option key={c.id} value={c.id}>
                  {(c as { name?: string }).name ?? c.id}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Message">
            <Text ro={ro} value={cfg.body} onChange={(v) => set({ body: v })} label="Chat message" multiline />
          </Field>
        </div>
      );
    case 'delay':
      return (
        <Field label="Minutes" help="The run is parked and continues by itself; the Runs tab can continue it earlier or cancel it.">
          <input type="number" min={0} disabled={ro} value={String(cfg.minutes ?? '')} onChange={(e) => set({ minutes: Number(e.target.value) })} className={field} aria-label="Minutes" />
        </Field>
      );
    case 'webhook':
      return (
        <div className="space-y-2">
          <Field label="URL">
            <Text ro={ro} value={cfg.url} onChange={(v) => set({ url: v })} label="Webhook URL" placeholder="https://…" />
          </Field>
          <Field label="Method">
            <select disabled={ro} value={String(cfg.method ?? 'POST')} onChange={(e) => set({ method: e.target.value })} className={field} aria-label="HTTP method">
              {['POST', 'PUT', 'PATCH'].map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
          </Field>
          <Field label="JSON body (optional)" help="A JSON object; {{…}} inside values is filled in. Empty = the trigger payload and step outputs.">
            <textarea
              disabled={ro}
              rows={4}
              value={bodyText ?? (cfg.body ? JSON.stringify(cfg.body, null, 2) : '')}
              onChange={(e) => setBodyText(e.target.value)}
              onBlur={() => {
                if (bodyText === null) return;
                try {
                  set({ body: bodyText.trim() ? JSON.parse(bodyText) : undefined });
                  setBodyText(null);
                } catch {
                  /* keep editing until it parses */
                }
              }}
              className={cn(area, 'font-mono text-[11.5px]')}
              aria-label="JSON body"
            />
          </Field>
        </div>
      );
    default:
      return null;
  }
}

function ConditionConfig({ cfg, set, ro }: { cfg: Record<string, unknown>; set: (p: Record<string, unknown>) => void; ro: boolean }) {
  const op = CONDITION_OPS.find((o) => o.id === cfg.op) ?? CONDITION_OPS[0];
  return (
    <div className="space-y-2" data-testid="condition-config">
      <Field label="Value to test">
        <Text ro={ro} value={cfg.left} onChange={(v) => set({ left: v })} label="Condition value" placeholder="{{trigger.answers.Seats}}" testId="condition-left" />
      </Field>
      <Field label="Test">
        <select disabled={ro} value={op.id} onChange={(e) => set({ op: e.target.value })} className={field} aria-label="Condition operator">
          {CONDITION_OPS.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </Field>
      {!op.unary && (
        <Field label="Compared with">
          <Text ro={ro} value={cfg.right} onChange={(v) => set({ right: v })} label="Comparison value" placeholder="0" testId="condition-right" />
        </Field>
      )}
      <p className="text-[11px] text-muted">The run follows the connector labelled <b>Yes</b> when the test holds, otherwise the one labelled <b>No</b>. Numbers compare as numbers; text ignores case.</p>
    </div>
  );
}

/** What this flow's triggers make available for {{…}} templates, from the trigger shapes on the diagram. */
function Placeholders({ flow, n }: { flow: PlainFlow; n: FlowNode }) {
  const [open, setOpen] = useState(false);
  const items = useMemo(() => {
    const out: string[] = [];
    for (const t of flow.nodes.filter((x) => x.automation?.role === 'trigger')) {
      const def = TRIGGER_TYPES.find((d) => d.id === t.automation?.type);
      for (const o of def?.outputs ?? []) out.push(`{{trigger.${o}}}`);
    }
    for (const s of flow.nodes.filter((x) => x.automation?.role === 'action' && x.id !== n.id)) {
      const def = ACTION_TYPES.find((d) => d.id === s.automation?.type);
      for (const o of def?.outputs ?? []) out.push(`{{steps.${s.id}.${o}}}`);
    }
    out.push('{{flow.name}}');
    return [...new Set(out)];
  }, [flow.nodes, n.id]);
  return (
    <div className="rounded-md border border-line">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center justify-between px-2.5 py-1.5 text-[12px] font-medium text-ink-2 hover:bg-hover" aria-expanded={open}>
        Placeholders you can use <span className="text-muted">{open ? '−' : '+'}</span>
      </button>
      {open && (
        <ul className="space-y-0.5 px-2.5 pb-2 text-[11.5px]">
          {items.map((p) => (
            <li key={p}>
              <code className="rounded bg-canvas px-1 text-ink-2">{p}</code>
            </li>
          ))}
          <li className="pt-1 text-muted">Anything the trigger carries can be reached by its key path, e.g. {'{{trigger.answers.Full name}}'}.</li>
        </ul>
      )}
    </div>
  );
}
