// AI → Flow (docs/ARCHITECTURE.md §80): the model answers with a compact "flow spec" (steps + links), which is cheap
// to generate on a local CPU model; this file repairs it (start / end, Yes / No branches, dangling links), lays it out
// and turns it into a real diagram — flowchart or BPMN 2.0 notation, optional swimlanes, optional automation roles.
import { DEFAULT_EDGE_STYLE, shapeDef, styleFor, type FlowEdge, type FlowNode, type NodeAutomation, type PlainFlow } from '@workos/flow-model';

export type StepType = 'start' | 'end' | 'task' | 'user' | 'service' | 'send' | 'receive' | 'manual' | 'decision' | 'parallel' | 'wait' | 'document' | 'data' | 'subprocess';
const STEP_TYPES: StepType[] = ['start', 'end', 'task', 'user', 'service', 'send', 'receive', 'manual', 'decision', 'parallel', 'wait', 'document', 'data', 'subprocess'];
const TRIGGERS = ['manual', 'form', 'record', 'approval', 'task', 'schedule', 'email'] as const;
const ACTIONS = ['email', 'notify', 'task', 'record', 'approval', 'chat', 'wait', 'webhook'] as const;

export interface FlowSpecStep {
  id: string;
  label: string;
  type: StepType;
  lane?: string;
  /** Start steps: what starts the flow. */
  trigger?: (typeof TRIGGERS)[number];
  /** Work steps: what the step does when the flow runs. */
  action?: (typeof ACTIONS)[number];
  /** Optional details of the action: e-mail recipient / subject, task title, minutes to wait. */
  to?: string;
  subject?: string;
  minutes?: number;
}
export interface FlowSpec {
  title: string;
  notation?: 'flowchart' | 'bpmn';
  lanes?: string[];
  steps: FlowSpecStep[];
  links: { from: string; to: string; label?: string }[];
}

/** JSON schema handed to the model (Ollama structured output). Kept small: every key costs tokens on a CPU. */
export const FLOW_SPEC_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    notation: { type: 'string', enum: ['flowchart', 'bpmn'] },
    lanes: { type: 'array', items: { type: 'string' } },
    steps: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          label: { type: 'string' },
          type: { type: 'string', enum: STEP_TYPES },
          lane: { type: 'string' },
          trigger: { type: 'string', enum: [...TRIGGERS] },
          action: { type: 'string', enum: [...ACTIONS] },
          to: { type: 'string' },
          subject: { type: 'string' },
          minutes: { type: 'number' },
        },
        required: ['id', 'label', 'type'],
      },
    },
    links: {
      type: 'array',
      items: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' }, label: { type: 'string' } }, required: ['from', 'to'] },
    },
  },
  required: ['title', 'steps', 'links'],
};

const YES = /^(yes|y|có|co|đúng|ok|true|approved|đồng ý|duyệt|はい)$/i;
const NO = /^(no|n|không|khong|sai|false|rejected|từ chối|いいえ)$/i;

/** Fixes what small models get wrong; returns the repaired spec and what was changed. */
export function repairFlowSpec(raw: Partial<FlowSpec>): { spec: FlowSpec; fixes: string[] } {
  const fixes: string[] = [];
  const seen = new Set<string>();
  const steps: FlowSpecStep[] = [];
  for (const s of raw.steps ?? []) {
    if (!s || typeof s !== 'object') continue;
    let id = String(s.id ?? '').trim() || `s${steps.length + 1}`;
    while (seen.has(id)) id = `${id}_`;
    seen.add(id);
    const type = (STEP_TYPES as string[]).includes(s.type as string) ? (s.type as StepType) : 'task';
    steps.push({ ...s, id, type, label: String(s.label ?? '').trim().slice(0, 80) || (type === 'start' ? 'Start' : type === 'end' ? 'End' : 'Step') });
  }
  const ids = new Set(steps.map((s) => s.id));
  const linkKey = new Set<string>();
  let links = (raw.links ?? []).filter((l) => {
    if (!l || !ids.has(String(l.from)) || !ids.has(String(l.to)) || l.from === l.to) return false;
    const k = `${l.from}>${l.to}`;
    if (linkKey.has(k)) return false;
    linkKey.add(k);
    return true;
  }).map((l) => ({ from: String(l.from), to: String(l.to), label: String(l.label ?? '').trim().slice(0, 30) }));
  if ((raw.links?.length ?? 0) !== links.length) fixes.push('removed links to missing steps');

  // No links at all: the steps are a sequence.
  if (!links.length && steps.length > 1) {
    links = steps.slice(1).map((s, i) => ({ from: steps[i].id, to: s.id, label: '' }));
    fixes.push('connected the steps in order');
  }
  const incoming = (id: string) => links.filter((l) => l.to === id);
  const outgoing = (id: string) => links.filter((l) => l.from === id);

  // A start: the declared one, or a new one in front of every step nothing leads to.
  if (!steps.some((s) => s.type === 'start')) {
    const roots = steps.filter((s) => !incoming(s.id).length);
    const start: FlowSpecStep = { id: 'start', label: 'Start', type: 'start' };
    while (ids.has(start.id)) start.id += '_';
    steps.unshift(start);
    ids.add(start.id);
    for (const r of roots.length ? roots : steps.slice(1, 2)) links.push({ from: start.id, to: r.id, label: '' });
    fixes.push('added a start');
  }
  // An end after every step that leads nowhere.
  const sinks = steps.filter((s) => s.type !== 'end' && !outgoing(s.id).length);
  if (sinks.length || !steps.some((s) => s.type === 'end')) {
    let end = steps.find((s) => s.type === 'end');
    if (!end) {
      end = { id: 'end', label: 'End', type: 'end' };
      while (ids.has(end.id)) end.id += '_';
      steps.push(end);
      ids.add(end.id);
      fixes.push('added an end');
    }
    for (const s of sinks) if (s.id !== end.id) links.push({ from: s.id, to: end.id, label: '' });
  }
  // A step that branches with labelled links is a decision, whatever type the model gave it.
  for (const s of steps) {
    const outs = outgoing(s.id);
    if (s.type !== 'decision' && s.type !== 'parallel' && s.type !== 'start' && outs.length >= 2 && outs.filter((l) => l.label).length >= 2) {
      s.type = 'decision';
      fixes.push(`made “${s.label}” a decision`);
    }
  }
  // Decisions: two labelled ways out.
  for (const d of steps.filter((s) => s.type === 'decision')) {
    const outs = outgoing(d.id);
    if (outs.length === 1) {
      const end = steps.find((s) => s.type === 'end')!;
      links.push({ from: d.id, to: end.id, label: 'No' });
      if (!outs[0].label) outs[0].label = 'Yes';
      fixes.push(`gave “${d.label}” a No branch`);
    } else if (outs.length >= 2) {
      const yes = outs.some((l) => YES.test(l.label));
      const no = outs.some((l) => NO.test(l.label));
      if (!yes && !no) {
        outs[0].label ||= 'Yes';
        outs[1].label ||= 'No';
      } else if (yes && !no) outs.find((l) => !YES.test(l.label))!.label ||= 'No';
      else if (no && !yes) outs.find((l) => !NO.test(l.label))!.label ||= 'Yes';
    }
  }
  let lanes = (raw.lanes ?? []).map((l) => String(l).trim()).filter(Boolean).slice(0, 8);
  // Small models often give every step a lane but forget the list: derive it, in order of appearance.
  if (!lanes.length) {
    const named = steps.map((s) => String(s.lane ?? '').trim()).filter(Boolean);
    lanes = [...new Set(named)].slice(0, 8);
    if (lanes.length > 1) fixes.push('derived the swimlanes from the steps');
    else lanes = [];
  }
  // Start / end without a lane follow their neighbour.
  for (const s of steps) if (lanes.length && !s.lane) s.lane = steps[steps.indexOf(s) + 1]?.lane ?? steps[steps.indexOf(s) - 1]?.lane;
  for (const s of steps) if (s.lane && !lanes.includes(s.lane)) s.lane = lanes.find((l) => l.toLowerCase() === s.lane!.toLowerCase());
  return { spec: { title: String(raw.title ?? 'Workflow').slice(0, 120), notation: raw.notation === 'bpmn' || lanes.length > 1 ? 'bpmn' : 'flowchart', lanes: lanes.length ? lanes : undefined, steps, links }, fixes };
}

const FLOWCHART: Record<StepType, string> = {
  start: 'terminal',
  end: 'terminal',
  task: 'process',
  user: 'process',
  service: 'process',
  send: 'process',
  receive: 'process',
  manual: 'manual',
  decision: 'decision',
  parallel: 'bpmnParallel',
  wait: 'delay',
  document: 'document',
  data: 'database',
  subprocess: 'subprocess',
};
const BPMN: Record<StepType, string> = {
  start: 'bpmnStart',
  end: 'bpmnEnd',
  task: 'bpmnTask',
  user: 'bpmnUserTask',
  service: 'bpmnServiceTask',
  send: 'bpmnSendTask',
  receive: 'bpmnReceiveTask',
  manual: 'bpmnManualTask',
  decision: 'bpmnGateway',
  parallel: 'bpmnParallel',
  wait: 'bpmnIntermediateTimer',
  document: 'bpmnData',
  data: 'bpmnDataStore',
  subprocess: 'bpmnSubprocess',
};
const ICON: Partial<Record<StepType, string>> = { user: 'user', service: 'settings', send: 'mail', receive: 'message-square', manual: 'user' };

function shapeFor(s: FlowSpecStep, notation: 'flowchart' | 'bpmn') {
  if (notation === 'bpmn' && s.type === 'start') {
    if (s.trigger === 'schedule') return 'bpmnStartTimer';
    if (s.trigger === 'form' || s.trigger === 'email') return 'bpmnStartMessage';
  }
  return (notation === 'bpmn' ? BPMN : FLOWCHART)[s.type];
}

function automationFor(s: FlowSpecStep): NodeAutomation | null {
  if (s.type === 'start') {
    const t = { manual: 'manual', form: 'form.submitted', record: 'base.recordCreated', approval: 'approval.finished', task: 'task.statusChanged', schedule: 'schedule', email: 'mail.received' }[s.trigger ?? 'manual'] ?? 'manual';
    return { role: 'trigger', type: t, config: t === 'schedule' ? { schedule: { every: 'day', hour: 9 } } : {} };
  }
  if (!s.action) return null;
  switch (s.action) {
    case 'email':
      return { role: 'action', type: 'mail.send', config: { to: s.to ?? '', subject: s.subject ?? s.label, body: '' } };
    case 'notify':
      return { role: 'action', type: 'notify', config: { title: s.subject ?? s.label, toTrigger: true, userIds: [] } };
    case 'task':
      return { role: 'action', type: 'task.create', config: { title: s.subject ?? s.label } };
    case 'record':
      return { role: 'action', type: 'base.createRecord', config: {} };
    case 'approval':
      return { role: 'action', type: 'approval.submit', config: {} };
    case 'chat':
      return { role: 'action', type: 'chat.send', config: { body: s.subject ?? s.label } };
    case 'wait':
      return { role: 'action', type: 'delay', config: { minutes: Math.max(1, Math.round(s.minutes ?? 60)) } };
    case 'webhook':
      return { role: 'action', type: 'webhook', config: { url: s.to ?? '' } };
  }
}

/** Ranks by longest path from the starts, ignoring the edges that close a loop. */
function ranks(spec: FlowSpec) {
  const out = new Map<string, string[]>();
  for (const l of spec.links) out.set(l.from, [...(out.get(l.from) ?? []), l.to]);
  const state = new Map<string, 0 | 1 | 2>();
  const back = new Set<string>();
  const visit = (id: string) => {
    state.set(id, 1);
    for (const to of out.get(id) ?? []) {
      if (state.get(to) === 1) back.add(`${id}>${to}`);
      else if (!state.get(to)) visit(to);
    }
    state.set(id, 2);
  };
  for (const s of spec.steps.filter((x) => x.type === 'start')) if (!state.get(s.id)) visit(s.id);
  for (const s of spec.steps) if (!state.get(s.id)) visit(s.id);
  const rank = new Map<string, number>(spec.steps.map((s) => [s.id, 0]));
  // Longest path by relaxation over the acyclic edges (n ≤ ~60 steps).
  for (let i = 0; i < spec.steps.length; i++) {
    let changed = false;
    for (const l of spec.links) {
      if (back.has(`${l.from}>${l.to}`)) continue;
      const r = rank.get(l.from)! + 1;
      if (r > rank.get(l.to)!) {
        rank.set(l.to, r);
        changed = true;
      }
    }
    if (!changed) break;
  }
  // Ends sit on the last row.
  const max = Math.max(0, ...rank.values());
  for (const s of spec.steps) if (s.type === 'end' && !(out.get(s.id)?.length)) rank.set(s.id, Math.max(rank.get(s.id)!, max));
  return rank;
}

/** Builds the diagram on one page. `idPrefix` keeps ids unique when it is added to an existing flow. */
export function flowFromSpec(spec: FlowSpec, opts: { page: string; idPrefix?: string; automation?: boolean } = { page: 'p1' }): PlainFlow {
  const notation = spec.notation ?? 'flowchart';
  const pre = opts.idPrefix ?? '';
  const rank = ranks(spec);
  const byRank = new Map<number, FlowSpecStep[]>();
  for (const s of spec.steps) byRank.set(rank.get(s.id)!, [...(byRank.get(rank.get(s.id)!) ?? []), s]);
  const rankCount = Math.max(...byRank.keys()) + 1;
  const nodes: FlowNode[] = [];
  const pos = new Map<string, { x: number; y: number; w: number; h: number }>();
  const size = (s: FlowSpecStep) => {
    const def = shapeDef(shapeFor(s, notation));
    const wide = ['process', 'manual', 'subprocess', 'document', 'delay'].includes(def.id) || def.bpmn?.kind === 'activity';
    return { w: wide ? Math.max(def.w, Math.min(240, 60 + s.label.length * 7)) : def.w, h: def.h };
  };

  if (spec.lanes?.length) {
    // Swimlanes: time runs left → right, each lane is a band.
    const COL = 230;
    const laneOf = (s: FlowSpecStep) => (s.lane && spec.lanes!.includes(s.lane) ? s.lane : spec.lanes![0]);
    const perCell = new Map<string, FlowSpecStep[]>();
    for (const s of spec.steps) {
      const k = `${laneOf(s)}|${rank.get(s.id)}`;
      perCell.set(k, [...(perCell.get(k) ?? []), s]);
    }
    let top = 40;
    const laneTops: { name: string; y: number; h: number }[] = [];
    for (const lane of spec.lanes) {
      const stack = Math.max(1, ...[...perCell.entries()].filter(([k]) => k.startsWith(`${lane}|`)).map(([, v]) => v.length));
      const h = Math.max(150, stack * 110 + 40);
      laneTops.push({ name: lane, y: top, h });
      for (let r = 0; r < rankCount; r++) {
        const cell = perCell.get(`${lane}|${r}`) ?? [];
        cell.forEach((s, i) => {
          const { w, h: nh } = size(s);
          const cy = top + ((i + 1) * h) / (cell.length + 1);
          pos.set(s.id, { x: 160 + r * COL + (COL - w) / 2, y: cy - nh / 2, w, h: nh });
        });
      }
      top += h;
    }
    const width = 160 + rankCount * COL + 40;
    laneTops.forEach((l, i) =>
      nodes.push({ id: `${pre}lane${i}`, page: opts.page, shape: 'lane', x: 40, y: l.y, w: width - 40, h: l.h, text: l.name, icon: null, style: styleFor('lane'), z: -1, data: {}, automation: null }),
    );
  } else {
    // Top → bottom; within a row, follow the parents' order to limit crossings.
    const ROW = 130;
    const order = new Map<string, number>();
    for (let r = 0; r < rankCount; r++) {
      const row = byRank.get(r) ?? [];
      row.sort((a, b) => {
        const pa = spec.links.filter((l) => l.to === a.id && order.has(l.from)).map((l) => order.get(l.from)!);
        const pb = spec.links.filter((l) => l.to === b.id && order.has(l.from)).map((l) => order.get(l.from)!);
        const avg = (xs: number[]) => (xs.length ? xs.reduce((p, x) => p + x, 0) / xs.length : 0);
        return avg(pa) - avg(pb);
      });
      row.forEach((s, i) => {
        const { w, h } = size(s);
        const cx = 520 + (i - (row.length - 1) / 2) * 260;
        order.set(s.id, cx);
        pos.set(s.id, { x: cx - w / 2, y: 60 + r * ROW + (70 - h) / 2, w, h });
      });
    }
  }

  spec.steps.forEach((s, i) => {
    const p = pos.get(s.id)!;
    const shape = shapeFor(s, notation);
    const def = shapeDef(shape);
    // BPMN events and gateways carry their name under the symbol; flowchart ends read "End".
    const text = s.label;
    nodes.push({
      id: pre + s.id,
      page: opts.page,
      shape,
      x: Math.round(p.x),
      y: Math.round(p.y),
      w: p.w,
      h: p.h,
      text,
      icon: notation === 'flowchart' ? (ICON[s.type] ?? null) : null,
      style: styleFor(shape),
      z: i + 1,
      data: def.bpmn ? { bpmn: def.bpmn.kind } : {},
      automation: opts.automation === false ? null : automationFor(s),
    });
  });
  const edges: FlowEdge[] = spec.links.map((l, i) => ({
    id: `${pre}e${i + 1}`,
    page: opts.page,
    from: pre + l.from,
    to: pre + l.to,
    fromSide: null,
    toSide: null,
    label: l.label ?? '',
    style: { ...DEFAULT_EDGE_STYLE },
  }));
  const start = spec.steps.find((s) => s.type === 'start');
  const triggerLabel = { manual: 'Manual', form: 'Form submission', record: 'Base record created', approval: 'Approval approved', task: 'Task status changed', schedule: 'Schedule', email: 'Incoming email' }[start?.trigger ?? 'manual'] ?? 'Manual';
  return {
    info: { version: '1.0.0', status: 'draft', trigger: triggerLabel, tags: ['AI'], description: spec.title, automation: false },
    pages: [{ id: opts.page, name: spec.title.slice(0, 60) || 'Page 1' }],
    nodes,
    edges,
  };
}
