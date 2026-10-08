// Automation (docs/ARCHITECTURE.md §77, batch 2): a diagram runs when its shapes carry roles — one or more
// *triggers* start a run, *actions* do something, *conditions* pick the Yes / No connector. Shapes without a role
// are passed through (documentation steps), so a published diagram stays readable and runnable at once.

import type { FlowEdge, FlowNode, PlainFlow } from './types';

export type AutomationRole = 'none' | 'trigger' | 'action' | 'condition';

export type TriggerType = 'manual' | 'form.submitted' | 'base.recordCreated' | 'base.recordUpdated' | 'approval.finished' | 'task.statusChanged' | 'schedule' | 'mail.received';
export type ActionType = 'mail.send' | 'notify' | 'task.create' | 'base.createRecord' | 'base.updateRecord' | 'approval.submit' | 'chat.send' | 'delay' | 'webhook';
export type ConditionOp = 'eq' | 'neq' | 'contains' | 'gt' | 'gte' | 'lt' | 'lte' | 'empty' | 'notEmpty' | 'truthy';

export type Schedule = { every: 'minutes' | 'hours' | 'day' | 'week'; n?: number; hour?: number; weekday?: number };

/** What a shape does when the flow runs. `config` depends on `type` (see TRIGGER_TYPES / ACTION_TYPES). */
export interface NodeAutomation {
  role: AutomationRole;
  type: string;
  config: Record<string, unknown>;
}

export const NO_AUTOMATION: NodeAutomation = { role: 'none', type: '', config: {} };

export interface TypeDef<T extends string> {
  id: T;
  label: string;
  /** One line under the label in the picker. */
  note: string;
  /** The full explanation shown in the Automation tab (what happens, as whom, what to watch for). */
  description: string;
  /** Config keys that must be filled before the flow can run. */
  required: string[];
  /** Keys of what it makes available to later steps: `{{trigger.<key>}}` for triggers, `{{steps.<shape id>.<key>}}` for actions. */
  outputs: string[];
}

export const TRIGGER_TYPES: TypeDef<TriggerType>[] = [
  {
    id: 'manual',
    label: 'Manual (Run now)',
    note: 'Started from the Runs tab, with optional input.',
    description: 'Somebody presses Run now in the Runs tab. Whatever they type as input (a JSON object) travels with the run as trigger.input, which makes this the easiest way to test a flow before giving it a real trigger.',
    required: [],
    outputs: ['input.<key>', 'by.name', 'by.id', 'at'],
  },
  {
    id: 'form.submitted',
    label: 'Form submitted',
    note: 'A response arrives in a Form. {{trigger.answers.Question}}',
    description: 'Every new response to the chosen Form starts one run. Answers are reachable by the question title (trigger.answers.Full name), together with the respondent (when signed in) and the collected e-mail — the usual way to turn a request form into e-mails, tasks or records.',
    required: ['formId'],
    outputs: ['answers.<Question title>', 'email', 'respondent.name', 'respondent.id', 'formName', 'responseId', 'score'],
  },
  {
    id: 'base.recordCreated',
    label: 'Base record created',
    note: 'A record is added to a table. {{trigger.record.Field}}',
    description: 'A record is added to the chosen table of a Base — by hand, by paste, by CSV import, by a Base form or by another flow. The record’s values are reachable by field name (trigger.record.Status). Records created by this very flow do not start it again.',
    required: ['tableId'],
    outputs: ['record.<Field name>', 'recordId', 'tableName', 'tableId', 'baseId', 'autoNumber'],
  },
  {
    id: 'base.recordUpdated',
    label: 'Base record updated',
    note: 'A record of a table changes. {{trigger.record.Field}}',
    description: 'A record of the chosen table changes (any field). The new values are reachable by field name and trigger.changed lists the fields that changed, so a condition can check e.g. that Status became Done. Changes written by this flow itself never re-trigger it.',
    required: ['tableId'],
    outputs: ['record.<Field name>', 'changed', 'recordId', 'tableName', 'tableId', 'baseId'],
  },
  {
    id: 'approval.finished',
    label: 'Approval decided',
    note: 'A request is approved or rejected. {{trigger.status}}, {{trigger.values.Field}}',
    description: 'An approval request reaches its final decision. Narrow it to one template and to approved or rejected only, or react to all. The request’s form values are reachable by field label, together with the submitter and who decided — typical for “when leave is approved, post in the team channel”.',
    required: [],
    outputs: ['status', 'values.<Field label>', 'submitter.name', 'submitter.email', 'submitter.id', 'decidedBy.name', 'templateName', 'serial', 'requestId'],
  },
  {
    id: 'task.statusChanged',
    label: 'Task status changed',
    note: 'An issue moves to another status. {{trigger.to}}',
    description: 'An issue in Tasks moves from one status to another. Choose a project and the target status (e.g. Done) to react only to that move. trigger.from / trigger.to carry status ids, trigger.title the issue, trigger.assigneeId who owns it.',
    required: [],
    outputs: ['title', 'from', 'to', 'taskId', 'projectId', 'assigneeId', 'by.name'],
  },
  {
    id: 'schedule',
    label: 'Schedule',
    note: 'Every N minutes / hours, daily or weekly at an hour.',
    description: 'Runs on a timer: every N minutes or hours, every day at an hour, or every week on a weekday at an hour (server time). Good for reminders, digests and periodic checks. The next planned run is shown in the Runs tab.',
    required: ['schedule'],
    outputs: ['at'],
  },
  {
    id: 'mail.received',
    label: 'E-mail received',
    note: 'A message arrives in a mailbox. {{trigger.subject}}, {{trigger.from}}',
    description: 'An external e-mail arrives in a workspace or team mailbox (via the inbound SMTP listener or the inbound webhook). Sender, subject and the text body are available — e.g. to open a task from a support request.',
    required: [],
    outputs: ['from', 'fromName', 'subject', 'text', 'address', 'mailboxId', 'messageId', 'attachments'],
  },
];

export const ACTION_TYPES: TypeDef<ActionType>[] = [
  {
    id: 'mail.send',
    label: 'Send e-mail',
    note: 'From the system mailbox. To / subject / body accept {{…}}.',
    description: 'Sends a plain-text e-mail from the organisation’s system mailbox (Admin → System e-mail). “To” may hold several addresses separated by commas and may come from the trigger ({{trigger.email}}). Without a configured system mailbox the message is only recorded in the outbox.',
    required: ['to', 'subject'],
    outputs: ['to', 'subject', 'delivered'],
  },
  {
    id: 'notify',
    label: 'Send notification',
    note: 'A bell notification to chosen people (or the person who triggered).',
    description: 'Shows a notification in the bell of the chosen people and, when ticked, of the person behind the trigger (the form respondent, the approval submitter, the task assignee, whoever pressed Run now). Clicking it opens this flow’s Runs tab unless another URL is given.',
    required: ['title'],
    outputs: ['userIds', 'title'],
  },
  {
    id: 'task.create',
    label: 'Create task',
    note: 'A new issue in a project, optionally assigned.',
    description: 'Creates an issue in the chosen Tasks project, as the flow’s owner (who must be able to edit the project). Title and description accept templates; assignee, priority and a due date in N days are optional. The new task’s id is available to later steps.',
    required: ['projectId', 'title'],
    outputs: ['taskId', 'number', 'title', 'url'],
  },
  {
    id: 'base.createRecord',
    label: 'Create Base record',
    note: 'A new record with field values.',
    description: 'Adds a record to a table of a Base with the given field values (templates allowed; choice fields accept the option label, people fields a user id or name, dates ISO text). Runs as the flow’s owner.',
    required: ['tableId'],
    outputs: ['recordId', 'autoNumber'],
  },
  {
    id: 'base.updateRecord',
    label: 'Update Base record',
    note: 'Changes fields of a record (by id, e.g. {{trigger.recordId}}).',
    description: 'Changes fields of one record, identified by id — usually the record that started the flow ({{trigger.recordId}}) or one created earlier ({{steps.<shape id>.recordId}}). Only the listed fields change. The update never re-triggers the same flow.',
    required: ['tableId', 'recordId'],
    outputs: ['recordId'],
  },
  {
    id: 'approval.submit',
    label: 'Start approval',
    note: 'Submits a request from a template, as the flow’s owner.',
    description: 'Submits an approval request from the chosen template, filled with the given values, in the name of the flow’s owner. Approvers are resolved like a hand-made request (managers, chosen people, conditions). Pair it with an “Approval decided” trigger in another flow to continue after the decision.',
    required: ['templateId'],
    outputs: ['requestId', 'serial', 'url'],
  },
  {
    id: 'chat.send',
    label: 'Post in chat',
    note: 'A message in a channel or conversation.',
    description: 'Posts a message, as the flow’s owner, into a channel or conversation the owner belongs to. Use it to announce new requests, approved items or finished tasks to a team.',
    required: ['conversationId', 'body'],
    outputs: ['messageId', 'conversationId'],
  },
  {
    id: 'delay',
    label: 'Wait',
    note: 'Pauses the run for some minutes, then continues.',
    description: 'Parks the run for the given number of minutes (up to 30 days) and continues with the next connector when the time comes — even after the server restarts. The Runs tab shows waiting runs with their resume time and lets you continue them now or cancel them.',
    required: ['minutes'],
    outputs: ['until'],
  },
  {
    id: 'webhook',
    label: 'Call webhook',
    note: 'POSTs JSON to a URL. {{…}} in the body.',
    description: 'Calls an external URL with a JSON body (yours, with templates filled in, or by default the trigger payload and step outputs). The step fails when the server answers an error or does not answer within 10 seconds. Local addresses are refused unless the server sets FLOW_WEBHOOK_ALLOW_LOCAL=1.',
    required: ['url'],
    outputs: ['status', 'response'],
  },
];

export const CONDITION_OPS: { id: ConditionOp; label: string; unary?: boolean }[] = [
  { id: 'eq', label: 'equals' },
  { id: 'neq', label: 'does not equal' },
  { id: 'contains', label: 'contains' },
  { id: 'gt', label: 'is greater than' },
  { id: 'gte', label: 'is at least' },
  { id: 'lt', label: 'is less than' },
  { id: 'lte', label: 'is at most' },
  { id: 'empty', label: 'is empty', unary: true },
  { id: 'notEmpty', label: 'is not empty', unary: true },
  { id: 'truthy', label: 'is yes / true', unary: true },
];

export const automationOf = (n: Pick<FlowNode, 'automation'>): NodeAutomation => n.automation ?? NO_AUTOMATION;

// ── Templates: {{ trigger.answers.Name }} ────────────────────────────────────

/** Looks a dotted path up in `ctx`; segments may contain spaces ("trigger.answers.Full name"). */
export function lookup(ctx: unknown, path: string): unknown {
  let cur: unknown = ctx;
  for (const raw of path.split('.')) {
    const seg = raw.trim();
    if (cur === null || cur === undefined) return undefined;
    if (Array.isArray(cur) && /^\d+$/.test(seg)) cur = cur[Number(seg)];
    else if (typeof cur === 'object') {
      const o = cur as Record<string, unknown>;
      // Exact key first, then case-insensitive (people type "name" for "Name").
      cur = seg in o ? o[seg] : o[Object.keys(o).find((k) => k.toLowerCase() === seg.toLowerCase()) ?? seg];
    } else return undefined;
  }
  return cur;
}

export const asText = (v: unknown): string => {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v) && v.every((x) => typeof x !== 'object' || x === null)) return v.map(asText).join(', ');
  if (typeof v === 'object' && 'name' in (v as object) && typeof (v as { name: unknown }).name === 'string') return (v as { name: string }).name;
  return JSON.stringify(v);
};

/** Fills every {{ path }} in `s` from `ctx`; unknown paths become empty text. */
export function render(s: unknown, ctx: unknown): string {
  return String(s ?? '').replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_m, p: string) => asText(lookup(ctx, p)));
}

/** A whole {{ path }} keeps its value (a number stays a number, a list a list); mixed text is rendered. */
export function renderValue(s: unknown, ctx: unknown): unknown {
  if (typeof s !== 'string') return s;
  const whole = /^\s*\{\{\s*([^}]+?)\s*\}\}\s*$/.exec(s);
  if (whole) {
    const v = lookup(ctx, whole[1]);
    return v === undefined ? '' : v;
  }
  return render(s, ctx);
}

export function renderObject(o: Record<string, unknown> | undefined, ctx: unknown): Record<string, unknown> {
  return Object.fromEntries(Object.entries(o ?? {}).map(([k, v]) => [k, renderValue(v, ctx)]));
}

// ── Conditions ──────────────────────────────────────────────────────────────

export interface ConditionConfig {
  left: string;
  op: ConditionOp;
  right?: string;
}

const num = (v: unknown) => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : null;
};

export function evaluateCondition(c: Partial<ConditionConfig>, ctx: unknown): boolean {
  const l = renderValue(c.left ?? '', ctx);
  const r = renderValue(c.right ?? '', ctx);
  const ls = asText(l).trim();
  const rs = asText(r).trim();
  switch (c.op ?? 'truthy') {
    case 'eq':
      return ls.toLowerCase() === rs.toLowerCase() || (num(l) !== null && num(r) !== null && num(l) === num(r));
    case 'neq':
      return !(ls.toLowerCase() === rs.toLowerCase() || (num(l) !== null && num(r) !== null && num(l) === num(r)));
    case 'contains':
      return Array.isArray(l) ? l.some((x) => asText(x).toLowerCase() === rs.toLowerCase()) : ls.toLowerCase().includes(rs.toLowerCase());
    case 'gt':
      return num(l) !== null && num(r) !== null && num(l)! > num(r)!;
    case 'gte':
      return num(l) !== null && num(r) !== null && num(l)! >= num(r)!;
    case 'lt':
      return num(l) !== null && num(r) !== null && num(l)! < num(r)!;
    case 'lte':
      return num(l) !== null && num(r) !== null && num(l)! <= num(r)!;
    case 'empty':
      return ls === '' || (Array.isArray(l) && l.length === 0);
    case 'notEmpty':
      return !(ls === '' || (Array.isArray(l) && l.length === 0));
    case 'truthy':
      return l === true || /^(yes|true|y|1|có|đúng|ok|approved)$/i.test(ls);
  }
}

const YES = /^(yes|true|y|có|đúng|ok|approved|pass)$/i;
const NO = /^(no|false|n|không|sai|rejected|fail)$/i;

/** The connectors a condition follows: those labelled Yes (or unlabelled) when true, those labelled No when false. */
export function branchEdges(out: FlowEdge[], result: boolean): FlowEdge[] {
  const yes = out.filter((e) => YES.test(e.label.trim()));
  const no = out.filter((e) => NO.test(e.label.trim()));
  const other = out.filter((e) => !YES.test(e.label.trim()) && !NO.test(e.label.trim()));
  if (result) return yes.length ? yes : other;
  return no.length ? no : yes.length ? [] : other.slice(1);
}

// ── Validation (the Runs tab lists problems before anyone turns automation on) ──

export interface AutomationProblem {
  nodeId: string | null;
  text: string;
}

export function validateAutomation(f: PlainFlow): AutomationProblem[] {
  const out: AutomationProblem[] = [];
  const triggers = f.nodes.filter((n) => automationOf(n).role === 'trigger');
  if (!triggers.length) out.push({ nodeId: null, text: 'No trigger: give one shape the Trigger role (e.g. the Start shape).' });
  for (const n of f.nodes) {
    const a = automationOf(n);
    if (a.role === 'none') continue;
    const name = n.text.trim() || n.shape;
    if (a.role === 'trigger' || a.role === 'action') {
      const def = (a.role === 'trigger' ? TRIGGER_TYPES : ACTION_TYPES).find((t) => t.id === a.type);
      if (!def) out.push({ nodeId: n.id, text: `“${name}”: choose what this ${a.role} does.` });
      else for (const k of def.required) {
        const v = a.config[k];
        if (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)) out.push({ nodeId: n.id, text: `“${name}”: ${def.label} needs “${FIELD_LABEL[k] ?? k}”.` });
      }
      if (a.role === 'action' && !f.edges.some((e) => e.to === n.id)) out.push({ nodeId: n.id, text: `“${name}” is not connected from any step, so it never runs.` });
    }
    if (a.role === 'condition') {
      const c = a.config as Partial<ConditionConfig>;
      if (!c.left) out.push({ nodeId: n.id, text: `“${name}”: the condition needs a value to test (e.g. {{trigger.answers.Seats}}).` });
      const outs = f.edges.filter((e) => e.from === n.id);
      if (outs.length < 2) out.push({ nodeId: n.id, text: `“${name}”: a condition needs two outgoing connectors labelled Yes and No.` });
    }
  }
  return out;
}

const FIELD_LABEL: Record<string, string> = {
  formId: 'form',
  tableId: 'table',
  templateId: 'template',
  projectId: 'project',
  conversationId: 'conversation',
  recordId: 'record id',
  schedule: 'schedule',
  to: 'to',
  subject: 'subject',
  title: 'title',
  body: 'message',
  minutes: 'minutes',
  url: 'URL',
};

/** Outgoing connectors of a node in a stable order (top to bottom, left to right). */
export const outgoing = (f: PlainFlow, nodeId: string) => f.edges.filter((e) => e.from === nodeId);
