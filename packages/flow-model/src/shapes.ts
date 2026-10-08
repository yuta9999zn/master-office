// Shape library (§77): what each shape is called, where it lives in the panel, what it means (so people — and the
// AI that will draft workflows — pick the right one), its default size and colours, and its outline as SVG path data
// in local coordinates (0,0)–(w,h). The BPMN 2.0 sets follow the standard notation (events, activities, gateways,
// data, swimlanes, artifacts), modelled on draw.io's libraries.
import { DEFAULT_NODE_STYLE, type NodeStyle } from './types';

export type ShapeCategory = 'Flowchart' | 'BPMN Events' | 'BPMN Activities' | 'BPMN Gateways' | 'BPMN Data & Artifacts' | 'Swimlanes' | 'Entity Relationship' | 'UML' | 'Basic Shapes' | 'Arrows & Callouts' | 'Text';

export interface BpmnMeta {
  kind: 'event' | 'activity' | 'gateway' | 'data' | 'swimlane' | 'artifact';
  /** Events: when in the process they sit. */
  position?: 'start' | 'intermediate' | 'end' | 'boundary';
  /** Events: what they react to / throw. */
  eventType?: 'none' | 'message' | 'timer' | 'signal' | 'conditional' | 'link' | 'error' | 'escalation' | 'terminate' | 'cancel' | 'compensation';
  /** Catching (waits for) or throwing (produces) — intermediate events. */
  direction?: 'catch' | 'throw';
  /** Activities: the task type (who / what performs it). */
  taskType?: 'abstract' | 'user' | 'service' | 'script' | 'manual' | 'send' | 'receive' | 'businessRule' | 'subprocess' | 'callActivity' | 'eventSubprocess' | 'transaction';
  /** Gateways: how the branches split / join. */
  gatewayType?: 'exclusive' | 'parallel' | 'inclusive' | 'eventBased' | 'complex';
}

export interface ShapeDef {
  id: string;
  label: string;
  category: ShapeCategory;
  /** One or two sentences: what the shape means and when to use it. */
  description: string;
  /** Extra words search (and the AI) may use to find it. */
  keywords?: string[];
  bpmn?: BpmnMeta;
  w: number;
  h: number;
  style?: Partial<NodeStyle>;
  /** Default text when dropped. */
  text?: string;
  icon?: string;
  /** Text is laid out inside this inset box (fractions of w / h; may lie outside for labels under events). */
  textBox?: { x: number; y: number; w: number; h: number };
  /** Multi-line text drawn as compartments: 'table' = name + one attribute per line; 'class' = name / attributes / operations separated by a "--" line. */
  compartments?: 'table' | 'class';
}

const blue = { fill: '#eff6ff', stroke: '#3b82f6' };
const violet = { fill: '#f3f0ff', stroke: '#8b5cf6' };
const green = { fill: '#ecfdf3', stroke: '#22c55e' };
const amber = { fill: '#fff7e0', stroke: '#f59e0b' };
const red = { fill: '#fef2f2', stroke: '#ef4444' };
const slate = { fill: '#f8fafc', stroke: '#64748b' };
const sky = { fill: '#f0f9ff', stroke: '#0ea5e9' };
const white = { fill: '#ffffff', stroke: '#334155' };

/** Labels of BPMN events and gateways sit under the symbol. */
const below = { x: -0.9, y: 1.08, w: 2.8, h: 0.9 };
const centre = { x: 0.14, y: 0.2, w: 0.72, h: 0.6 };
const gw = { fill: '#fff7e0', stroke: '#d97706', strokeWidth: 1.5, fontSize: 12 };
const ev = (stroke: string, sw = 1.5, fill = '#ffffff') => ({ fill, stroke, strokeWidth: sw, fontSize: 12 });

const fc = (id: string, label: string, description: string, w: number, h: number, extra: Partial<ShapeDef> = {}): ShapeDef => ({ id, label, category: 'Flowchart', description, w, h, style: blue, text: label, ...extra });
const bpEvent = (id: string, label: string, description: string, meta: BpmnMeta, style: Partial<NodeStyle>, keywords: string[] = []): ShapeDef => ({ id, label, category: 'BPMN Events', description, bpmn: meta, w: 44, h: 44, style, text: '', textBox: below, keywords });
const bpTask = (id: string, label: string, description: string, taskType: BpmnMeta['taskType'], extra: Partial<ShapeDef> = {}): ShapeDef => ({ id, label, category: 'BPMN Activities', description, bpmn: { kind: 'activity', taskType }, w: 160, h: 72, style: white, text: label, ...extra });
const bpGw = (id: string, label: string, description: string, gatewayType: BpmnMeta['gatewayType'], keywords: string[] = []): ShapeDef => ({ id, label, category: 'BPMN Gateways', description, bpmn: { kind: 'gateway', gatewayType }, w: 56, h: 56, style: gw, text: '', textBox: below, keywords });

export const SHAPES: ShapeDef[] = [
  // ── Flowchart ────────────────────────────────────────────────────────────
  fc('process', 'Process', 'A step of work: an action somebody or a system performs. The everyday building block of a flowchart.', 180, 56, { keywords: ['step', 'action', 'task', 'activity'] }),
  fc('decision', 'Decision', 'A question with two or more outcomes; label the outgoing connectors (Yes / No). When the flow runs, a Condition role picks the branch.', 130, 96, { style: { ...amber, fontSize: 13 }, text: 'Decision?', textBox: centre, keywords: ['if', 'branch', 'condition', 'question', 'yes no'] }),
  fc('terminal', 'Start / End', 'Where the process begins or finishes. Give the Start shape the Trigger role to make the flow run.', 140, 44, { style: { ...green, fontSize: 14, bold: true }, text: 'Start', keywords: ['begin', 'finish', 'terminator', 'stop'] }),
  fc('subprocess', 'Predefined process', 'A step that is itself a process defined elsewhere (another flow, a standard procedure). The double side lines mean “see details elsewhere”.', 180, 56, { style: violet, text: 'Subprocess', textBox: { x: 0.1, y: 0, w: 0.8, h: 1 }, keywords: ['subroutine', 'sub-process', 'call'] }),
  fc('document', 'Document', 'A document or report produced or used by the step (a contract, an invoice, a form).', 170, 64, { textBox: { x: 0.04, y: 0, w: 0.92, h: 0.82 }, keywords: ['paper', 'report', 'file'] }),
  fc('multiDocument', 'Multiple documents', 'A set of documents handled together (a pack of forms, a batch of invoices).', 170, 70, { textBox: { x: 0.06, y: 0.14, w: 0.88, h: 0.7 }, keywords: ['documents', 'batch', 'pack'] }),
  fc('database', 'Database', 'Data stored in a database or system of record that the step reads or writes.', 130, 80, { textBox: { x: 0.05, y: 0.25, w: 0.9, h: 0.7 }, keywords: ['storage', 'data', 'crm', 'erp', 'table'] }),
  fc('storedData', 'Stored data', 'Data kept in any medium (a file, a folder, a drive) — less specific than Database.', 150, 64, { textBox: { x: 0.12, y: 0, w: 0.76, h: 1 }, keywords: ['data', 'storage', 'file'] }),
  fc('internalStorage', 'Internal storage', 'Data held inside the system memory during the process (a cache, a working variable).', 130, 70, { textBox: { x: 0.14, y: 0.14, w: 0.84, h: 0.84 }, keywords: ['memory', 'cache', 'variable'] }),
  fc('directData', 'Direct data', 'Direct-access storage such as a disk; in business flows, a database table read directly.', 150, 64, { textBox: { x: 0.1, y: 0, w: 0.76, h: 1 }, keywords: ['disk', 'storage'] }),
  fc('sequentialData', 'Sequential data', 'Data read in order, like a log, a queue or a tape.', 80, 80, { textBox: { x: 0.12, y: 0.15, w: 0.76, h: 0.7 }, keywords: ['tape', 'log', 'queue', 'stream'] }),
  fc('io', 'Input / Output', 'Data entering or leaving the process (a request received, a report sent out).', 170, 56, { text: 'Input / output', textBox: { x: 0.14, y: 0, w: 0.72, h: 1 }, keywords: ['data', 'input', 'output'] }),
  fc('manualInput', 'Manual input', 'Information typed in by a person (a form filled by hand, keyboard entry).', 160, 60, { style: slate, textBox: { x: 0.04, y: 0.25, w: 0.92, h: 0.75 }, keywords: ['keyboard', 'typing', 'enter data'] }),
  fc('manual', 'Manual operation', 'A step done by hand, without a system (a signature, a physical check).', 170, 56, { style: slate, text: 'Manual step', textBox: { x: 0.12, y: 0, w: 0.76, h: 1 }, keywords: ['human', 'by hand', 'offline'] }),
  fc('preparation', 'Preparation', 'Setting things up before the real work: initialising, configuring, gathering what is needed.', 170, 56, { style: slate, text: 'Prepare', textBox: { x: 0.14, y: 0, w: 0.72, h: 1 }, keywords: ['setup', 'initialise', 'configure'] }),
  fc('delay', 'Delay', 'Waiting — for a time, a reply or an event. With the Wait action the run pauses for real.', 140, 56, { style: amber, text: 'Wait', textBox: { x: 0.04, y: 0, w: 0.76, h: 1 }, keywords: ['wait', 'pause', 'timer', 'sleep'] }),
  fc('display', 'Display', 'Information shown to a person on a screen (a dashboard, a confirmation page).', 160, 64, { style: sky, textBox: { x: 0.16, y: 0, w: 0.7, h: 1 }, keywords: ['screen', 'show', 'monitor'] }),
  fc('merge', 'Merge', 'Several paths join into one (the opposite of a decision). Also used for “combine”.', 90, 70, { style: slate, text: '', textBox: { x: 0.2, y: 0, w: 0.6, h: 0.6 }, keywords: ['join', 'combine', 'funnel'] }),
  fc('extract', 'Extract', 'Pull one part out of a whole (take the relevant items from a list).', 90, 70, { style: slate, text: '', textBox: { x: 0.2, y: 0.4, w: 0.6, h: 0.6 }, keywords: ['split', 'pick', 'filter'] }),
  fc('collate', 'Collate', 'Arrange items into a standard order or format (sorting pages, matching records).', 80, 80, { style: slate, text: '', keywords: ['arrange', 'format', 'organise'] }),
  fc('sort', 'Sort', 'Order items by a criterion (date, priority, amount).', 80, 90, { style: slate, text: '', textBox: { x: 0.2, y: 0.5, w: 0.6, h: 0.45 }, keywords: ['order', 'rank'] }),
  fc('summingJunction', 'Summing junction', 'Several inputs are combined (AND): all must arrive before the flow goes on.', 56, 56, { style: slate, text: '', textBox: below, keywords: ['and', 'join', 'sum'] }),
  fc('or', 'Or', 'Any one of several inputs lets the flow go on (OR).', 56, 56, { style: slate, text: '', textBox: below, keywords: ['either', 'any'] }),
  fc('loopLimit', 'Loop limit', 'The start of a repeated section with its end condition (“for each order”, “until approved”).', 170, 56, { style: slate, text: 'For each…', keywords: ['repeat', 'loop', 'iterate', 'for each', 'while'] }),
  fc('card', 'Card', 'A record or ticket, one per item (a punch card historically; a ticket today).', 150, 64, { style: slate, textBox: { x: 0.08, y: 0.1, w: 0.9, h: 0.9 }, keywords: ['ticket', 'record', 'punched card'] }),
  fc('connector', 'Connector', 'A small circle that joins lines on the same page without drawing across the diagram; give both ends the same letter.', 40, 40, { style: slate, text: 'A', keywords: ['on-page', 'junction', 'reference'] }),
  fc('offPage', 'Off-page connector', 'Continues on another page: put the same label on the matching shape there.', 110, 70, { style: slate, text: 'Page 2', textBox: { x: 0.05, y: 0, w: 0.9, h: 0.7 }, keywords: ['page', 'continue', 'reference'] }),
  fc('annotation', 'Annotation', 'A side note about a step: clarification, a rule, a who-does-what remark. Attach it with a dashed connector.', 180, 56, { style: { fill: 'transparent', stroke: '#64748b', align: 'left', fontSize: 12, textColor: '#475569' }, text: 'Note…', textBox: { x: 0.08, y: 0, w: 0.9, h: 1 }, keywords: ['comment', 'note', 'remark'] }),

  // ── BPMN Events ──────────────────────────────────────────────────────────
  bpEvent('bpmnStart', 'Start event', 'The process starts here, for any reason (“none” start). Every process has one or more start events.', { kind: 'event', position: 'start', eventType: 'none' }, ev('#16a34a', 2), ['begin', 'none start']),
  bpEvent('bpmnStartMessage', 'Message start', 'The process starts when a message arrives: an e-mail, a form submission, a request from another system.', { kind: 'event', position: 'start', eventType: 'message' }, ev('#16a34a', 2), ['email', 'request', 'form', 'received']),
  bpEvent('bpmnStartTimer', 'Timer start', 'The process starts on a schedule or at a date/time (every Monday 9:00, end of month).', { kind: 'event', position: 'start', eventType: 'timer' }, ev('#16a34a', 2), ['schedule', 'cron', 'clock', 'periodic']),
  bpEvent('bpmnStartSignal', 'Signal start', 'The process starts when a broadcast signal is raised anywhere (a company-wide event, a season opening).', { kind: 'event', position: 'start', eventType: 'signal' }, ev('#16a34a', 2), ['broadcast', 'publish']),
  bpEvent('bpmnStartConditional', 'Conditional start', 'The process starts when a business condition becomes true (stock below minimum, budget exceeded).', { kind: 'event', position: 'start', eventType: 'conditional' }, ev('#16a34a', 2), ['rule', 'condition', 'threshold']),
  bpEvent('bpmnIntermediate', 'Intermediate event', 'Something happens in the middle of the process (“none” intermediate) — a milestone or state change worth marking.', { kind: 'event', position: 'intermediate', eventType: 'none' }, ev('#d97706'), ['milestone']),
  bpEvent('bpmnIntermediateMessageCatch', 'Message (catch)', 'The process waits here until a message arrives (customer reply, payment confirmation).', { kind: 'event', position: 'intermediate', eventType: 'message', direction: 'catch' }, ev('#d97706'), ['wait for reply', 'receive']),
  bpEvent('bpmnIntermediateMessageThrow', 'Message (throw)', 'The process sends a message at this point and continues (notify the customer, ping another system).', { kind: 'event', position: 'intermediate', eventType: 'message', direction: 'throw' }, ev('#d97706'), ['send', 'notify']),
  bpEvent('bpmnIntermediateTimer', 'Timer (catch)', 'The process waits for a duration or until a date (3 days for a reply, until the 1st of the month).', { kind: 'event', position: 'intermediate', eventType: 'timer', direction: 'catch' }, ev('#d97706'), ['wait', 'delay', 'deadline', 'sla']),
  bpEvent('bpmnIntermediateSignalCatch', 'Signal (catch)', 'The process waits for a broadcast signal raised elsewhere.', { kind: 'event', position: 'intermediate', eventType: 'signal', direction: 'catch' }, ev('#d97706'), ['broadcast']),
  bpEvent('bpmnIntermediateSignalThrow', 'Signal (throw)', 'The process raises a broadcast signal that other processes may react to.', { kind: 'event', position: 'intermediate', eventType: 'signal', direction: 'throw' }, ev('#d97706'), ['broadcast', 'publish']),
  bpEvent('bpmnIntermediateConditional', 'Conditional (catch)', 'The process waits until a business condition holds.', { kind: 'event', position: 'intermediate', eventType: 'conditional', direction: 'catch' }, ev('#d97706'), ['rule', 'condition']),
  bpEvent('bpmnIntermediateLink', 'Link', 'A pair of link events connect two points of the same process without a long line (like an off-page connector).', { kind: 'event', position: 'intermediate', eventType: 'link' }, ev('#d97706'), ['goto', 'connector', 'off-page']),
  bpEvent('bpmnBoundaryError', 'Error (boundary)', 'Attached to the border of an activity: when that activity fails, the flow leaves through this event (exception handling).', { kind: 'event', position: 'boundary', eventType: 'error', direction: 'catch' }, ev('#dc2626'), ['exception', 'fail', 'catch error', 'boundary']),
  bpEvent('bpmnBoundaryTimer', 'Timer (boundary)', 'Attached to an activity: if it takes longer than the time, the flow leaves through this event (escalation after a deadline).', { kind: 'event', position: 'boundary', eventType: 'timer', direction: 'catch' }, ev('#d97706'), ['deadline', 'timeout', 'sla', 'boundary']),
  bpEvent('bpmnBoundaryEscalation', 'Escalation (boundary)', 'Attached to an activity: a non-critical problem is escalated to someone (a manager) while the activity may continue.', { kind: 'event', position: 'boundary', eventType: 'escalation', direction: 'catch' }, ev('#d97706'), ['manager', 'escalate', 'boundary']),
  bpEvent('bpmnEnd', 'End event', 'This path of the process ends here (“none” end). Other parallel paths keep running.', { kind: 'event', position: 'end', eventType: 'none' }, ev('#dc2626', 4), ['finish', 'stop']),
  bpEvent('bpmnEndMessage', 'Message end', 'The process ends by sending a message (confirmation to the customer, result to another system).', { kind: 'event', position: 'end', eventType: 'message' }, ev('#dc2626', 4), ['send', 'notify', 'finish']),
  bpEvent('bpmnEndError', 'Error end', 'The process ends with an error that a surrounding process may catch (validation failed, payment declined).', { kind: 'event', position: 'end', eventType: 'error' }, ev('#dc2626', 4), ['exception', 'fail']),
  bpEvent('bpmnEndEscalation', 'Escalation end', 'The process ends by escalating to a higher level.', { kind: 'event', position: 'end', eventType: 'escalation' }, ev('#dc2626', 4), ['manager']),
  bpEvent('bpmnEndSignal', 'Signal end', 'The process ends by raising a broadcast signal.', { kind: 'event', position: 'end', eventType: 'signal' }, ev('#dc2626', 4), ['broadcast']),
  bpEvent('bpmnEndTerminate', 'Terminate end', 'Stops the whole process at once, including every other parallel path still running.', { kind: 'event', position: 'end', eventType: 'terminate' }, ev('#dc2626', 4), ['abort', 'kill', 'stop all']),
  bpEvent('bpmnEndCancel', 'Cancel end', 'Ends a transaction sub-process by cancelling it (its compensations run).', { kind: 'event', position: 'end', eventType: 'cancel' }, ev('#dc2626', 4), ['rollback', 'transaction']),
  bpEvent('bpmnEndCompensation', 'Compensation end', 'Ends by triggering compensation: undoing work already done (refund, release the booked slot).', { kind: 'event', position: 'end', eventType: 'compensation' }, ev('#dc2626', 4), ['undo', 'refund', 'rollback']),

  // ── BPMN Activities ──────────────────────────────────────────────────────
  bpTask('bpmnTask', 'Task', 'A unit of work with no stated performer type. Use a typed task when you know who or what does it.', 'abstract', { keywords: ['activity', 'step', 'work'] }),
  bpTask('bpmnUserTask', 'User task', 'Work a person does through the system — fills a form, reviews, approves. In Master Office: a Task assigned to someone, or an approval step.', 'user', { keywords: ['person', 'human', 'approve', 'review', 'form'] }),
  bpTask('bpmnServiceTask', 'Service task', 'Work done automatically by a system or service — call an API, update a record, send to a payment provider. In a flow: an action such as Create record or Call webhook.', 'service', { keywords: ['automatic', 'system', 'api', 'integration', 'webhook'] }),
  bpTask('bpmnScriptTask', 'Script task', 'A small piece of logic executed by the engine (calculate a total, format text, pick a value).', 'script', { keywords: ['code', 'calculate', 'logic', 'formula'] }),
  bpTask('bpmnManualTask', 'Manual task', 'Work done by hand outside any system (pack a parcel, phone a customer, sign on paper). The engine only waits for it.', 'manual', { keywords: ['offline', 'physical', 'by hand'] }),
  bpTask('bpmnSendTask', 'Send task', 'Sends a message to a participant outside the process (an e-mail, a chat post, a notification) and goes on.', 'send', { keywords: ['email', 'notify', 'message', 'chat'] }),
  bpTask('bpmnReceiveTask', 'Receive task', 'Waits for a message to arrive before the process continues (the customer’s reply, a signed document).', 'receive', { keywords: ['wait', 'inbox', 'reply', 'incoming'] }),
  bpTask('bpmnBusinessRuleTask', 'Business rule task', 'Applies a decision table or rules to get an answer (discount level, risk class, who approves).', 'businessRule', { keywords: ['decision table', 'rules', 'policy', 'dmn'] }),
  bpTask('bpmnSubprocess', 'Sub-process (collapsed)', 'A group of steps shown as one box with a [+] marker; its detail lives on another page or diagram.', 'subprocess', { w: 180, h: 80, keywords: ['subprocess', 'expand', 'detail', 'nested'] }),
  bpTask('bpmnCallActivity', 'Call activity', 'Calls a process defined elsewhere and reusable across diagrams (the thick border means “shared, global”).', 'callActivity', { w: 180, h: 80, style: { ...white, strokeWidth: 3.5 }, keywords: ['reuse', 'global', 'invoke', 'shared process'] }),
  bpTask('bpmnEventSubprocess', 'Event sub-process', 'A sub-process started by an event inside the parent (handle a cancellation request at any time). Drawn dashed.', 'eventSubprocess', { w: 200, h: 90, style: { ...white, dash: 'dashed' }, keywords: ['handler', 'interrupt', 'any time'] }),
  bpTask('bpmnTransaction', 'Transaction', 'A sub-process whose steps all succeed or are all compensated (book flight + hotel + car, or undo everything).', 'transaction', { w: 200, h: 90, keywords: ['atomic', 'compensate', 'rollback', 'all or nothing'] }),

  // ── BPMN Gateways ────────────────────────────────────────────────────────
  bpGw('bpmnGateway', 'Exclusive gateway (XOR)', 'Exactly one outgoing path is taken, chosen by conditions on the connectors (approved? yes / no). Also joins alternative paths back together.', 'exclusive', ['xor', 'decision', 'either or', 'if']),
  bpGw('bpmnParallel', 'Parallel gateway (AND)', 'All outgoing paths run at the same time; as a join it waits until every incoming path has arrived.', 'parallel', ['and', 'fork', 'join', 'simultaneous', 'synchronise']),
  bpGw('bpmnInclusive', 'Inclusive gateway (OR)', 'One or more paths are taken — every connector whose condition holds; the join waits for those that were started.', 'inclusive', ['or', 'some', 'multiple choice']),
  bpGw('bpmnEventBased', 'Event-based gateway', 'The path is chosen by whichever event happens first after it (a reply arrives, or 3 days pass).', 'eventBased', ['race', 'first event', 'wait for either']),
  bpGw('bpmnComplex', 'Complex gateway', 'A split or join with a rule that other gateways cannot express (“continue when 2 of 3 reviewers answered”).', 'complex', ['n of m', 'custom rule']),

  // ── BPMN Data & Artifacts ────────────────────────────────────────────────
  { id: 'bpmnData', label: 'Data object', category: 'BPMN Data & Artifacts', description: 'Information an activity needs or produces (an order, a report). Connect it to the activity with a dotted association.', bpmn: { kind: 'data' }, w: 56, h: 72, style: white, text: '', textBox: below, keywords: ['document', 'information', 'object'] },
  { id: 'bpmnDataInput', label: 'Data input', category: 'BPMN Data & Artifacts', description: 'Data that comes into the process from outside (the request that started it).', bpmn: { kind: 'data' }, w: 56, h: 72, style: white, text: '', textBox: below, keywords: ['input', 'parameter'] },
  { id: 'bpmnDataOutput', label: 'Data output', category: 'BPMN Data & Artifacts', description: 'Data the process delivers to the outside (the signed contract, the final report).', bpmn: { kind: 'data' }, w: 56, h: 72, style: white, text: '', textBox: below, keywords: ['output', 'result', 'deliverable'] },
  { id: 'bpmnDataStore', label: 'Data store', category: 'BPMN Data & Artifacts', description: 'A place where data persists beyond the process: a database, a Base table, a document library.', bpmn: { kind: 'data' }, w: 90, h: 70, style: white, text: '', textBox: below, keywords: ['database', 'repository', 'base', 'table'] },
  { id: 'bpmnAnnotation', label: 'Text annotation', category: 'BPMN Data & Artifacts', description: 'Explanatory text attached to any element with a dotted association; it does not change the process.', bpmn: { kind: 'artifact' }, w: 180, h: 56, style: { fill: 'transparent', stroke: '#64748b', align: 'left', fontSize: 12, textColor: '#475569' }, text: 'Annotation', textBox: { x: 0.08, y: 0, w: 0.9, h: 1 }, keywords: ['note', 'comment', 'remark'] },
  { id: 'bpmnGroup', label: 'Group', category: 'BPMN Data & Artifacts', description: 'A dashed frame that visually groups elements (a phase, a department’s part) without affecting the flow.', bpmn: { kind: 'artifact' }, w: 420, h: 280, style: { fill: 'transparent', stroke: '#94a3b8', dash: 'dashed', align: 'left', bold: true, fontSize: 13 }, text: 'Group', textBox: { x: 0.03, y: 0.02, w: 0.94, h: 0.12 }, keywords: ['frame', 'phase', 'section'] },

  // ── Swimlanes ────────────────────────────────────────────────────────────
  { id: 'pool', label: 'Pool', category: 'Swimlanes', description: 'A participant in the collaboration — an organisation, a customer, a system. Processes in different pools talk through message flows (dashed connectors).', bpmn: { kind: 'swimlane' }, w: 760, h: 240, style: { fill: '#ffffff', stroke: '#64748b', bold: true, fontSize: 13 }, text: 'Pool', textBox: { x: 0, y: 0, w: 0.05, h: 1 }, keywords: ['participant', 'organisation', 'company', 'customer', 'system'] },
  { id: 'lane', label: 'Lane', category: 'Swimlanes', description: 'A role or department inside a pool; place each step in the lane of whoever performs it.', bpmn: { kind: 'swimlane' }, w: 720, h: 200, style: { fill: '#ffffff', stroke: '#94a3b8', bold: true, fontSize: 13 }, text: 'Lane', textBox: { x: 0, y: 0, w: 0.06, h: 1 }, keywords: ['swimlane', 'role', 'department', 'responsibility'] },
  { id: 'verticalLane', label: 'Vertical lane', category: 'Swimlanes', description: 'A lane that runs top to bottom, with the role named in its header.', bpmn: { kind: 'swimlane' }, w: 220, h: 640, style: { fill: '#ffffff', stroke: '#94a3b8', bold: true, fontSize: 13 }, text: 'Lane', textBox: { x: 0, y: 0, w: 1, h: 0.07 }, keywords: ['swimlane', 'column', 'role'] },
  { id: 'phase', label: 'Phase', category: 'Swimlanes', description: 'A column marking a stage in time (Intake → Review → Delivery) across all lanes.', w: 240, h: 640, style: { fill: '#f8fafc', stroke: '#cbd5e1', dash: 'dashed', bold: true, fontSize: 13, fillOpacity: 0.6 }, text: 'Phase', textBox: { x: 0, y: 0, w: 1, h: 0.07 }, keywords: ['stage', 'milestone', 'column', 'timeline'] },
  { id: 'container', label: 'Group box', category: 'Swimlanes', description: 'A labelled frame to group related shapes; always drawn behind them.', w: 420, h: 280, style: { fill: '#f8fafc', stroke: '#94a3b8', dash: 'dashed', align: 'left', bold: true, fontSize: 13 }, text: 'Group', textBox: { x: 0.03, y: 0.02, w: 0.94, h: 0.12 }, keywords: ['frame', 'container', 'section'] },

  // ── Entity Relationship (database design) ────────────────────────────────
  { id: 'erEntity', label: 'Entity / Table', category: 'Entity Relationship', description: 'A table: the first line is its name, each further line an attribute (mark keys with PK / FK). Connect tables with ER connectors (1 — n, n — n) to show the relationships.', keywords: ['table', 'entity', 'database', 'schema', 'crow', 'relation', 'pk', 'fk', 'sql'], compartments: 'table', w: 180, h: 120, style: { ...sky, align: 'left', fontSize: 12.5 }, text: 'Customer\nPK id: int\nname: text\nemail: text' },
  { id: 'erWeakEntity', label: 'Weak entity', category: 'Entity Relationship', description: 'A table that cannot exist without its owner (order lines of an order): drawn with a double border, keyed by the owner’s key.', keywords: ['dependent', 'child table', 'double border'], compartments: 'table', w: 180, h: 110, style: { ...sky, align: 'left', fontSize: 12.5 }, text: 'OrderItem\nPK FK order_id\nPK line_no\nqty: int' },
  { id: 'erRelationship', label: 'Relationship', category: 'Entity Relationship', description: 'Chen notation: a diamond naming how two entities relate (places, contains); write the cardinalities (1, n) on the connectors.', keywords: ['chen', 'diamond', 'relation', 'verb'], w: 140, h: 80, style: { ...amber, fontSize: 12.5 }, text: 'places', textBox: { x: 0.15, y: 0.2, w: 0.7, h: 0.6 } },
  { id: 'erAttribute', label: 'Attribute', category: 'Entity Relationship', description: 'Chen notation: one attribute of an entity, drawn as an ellipse attached to it.', keywords: ['chen', 'field', 'column', 'property'], w: 120, h: 50, style: { ...slate, fontSize: 12 }, text: 'name', textBox: { x: 0.12, y: 0.1, w: 0.76, h: 0.8 } },
  { id: 'erKeyAttribute', label: 'Key attribute', category: 'Entity Relationship', description: 'Chen notation: the primary key, drawn underlined.', keywords: ['chen', 'primary key', 'identifier'], w: 120, h: 50, style: { ...slate, fontSize: 12, underline: true }, text: 'id', textBox: { x: 0.12, y: 0.1, w: 0.76, h: 0.8 } },
  { id: 'erMultiAttribute', label: 'Multivalued attribute', category: 'Entity Relationship', description: 'Chen notation: an attribute with several values (phone numbers), drawn with a double ellipse.', keywords: ['chen', 'list', 'array'], w: 130, h: 54, style: { ...slate, fontSize: 12 }, text: 'phones', textBox: { x: 0.15, y: 0.15, w: 0.7, h: 0.7 } },
  { id: 'erDerivedAttribute', label: 'Derived attribute', category: 'Entity Relationship', description: 'Chen notation: a value computed from others (age from birth date), drawn dashed.', keywords: ['chen', 'computed', 'formula'], w: 120, h: 50, style: { ...slate, fontSize: 12, dash: 'dashed' }, text: 'age', textBox: { x: 0.12, y: 0.1, w: 0.76, h: 0.8 } },

  // ── UML ──────────────────────────────────────────────────────────────────
  { id: 'umlClass', label: 'Class', category: 'UML', description: 'A class: name on top, then attributes, then operations — separate the compartments with a line containing only "--". Prefix + public, − private, # protected.', keywords: ['class diagram', 'object', 'attributes', 'methods', 'oop'], compartments: 'class', w: 200, h: 150, style: { ...white, fontSize: 12.5 }, text: 'Order\n--\n+ id: int\n+ total: money\n+ status: text\n--\n+ pay()\n+ cancel()' },
  { id: 'umlAbstract', label: 'Abstract class', category: 'UML', description: 'A class that cannot be instantiated (name in italics); concrete classes inherit from it (hollow-triangle connector).', keywords: ['class diagram', 'abstract', 'base class'], compartments: 'class', w: 200, h: 120, style: { ...white, fontSize: 12.5 }, text: 'Shape\n--\n# origin: Point\n--\n+ area(): number' },
  { id: 'umlInterface', label: 'Interface', category: 'UML', description: 'A contract of operations («interface»); classes realize it with a dashed hollow-triangle connector.', keywords: ['class diagram', 'contract', 'implements', 'protocol'], compartments: 'class', w: 200, h: 110, style: { ...violet, fontSize: 12.5 }, text: '«interface» Payable\n--\n+ pay(amount)\n+ refund()' },
  { id: 'umlEnum', label: 'Enumeration', category: 'UML', description: 'A fixed set of values («enumeration»): one literal per line.', keywords: ['class diagram', 'enum', 'values', 'constants'], compartments: 'class', w: 180, h: 120, style: { ...white, fontSize: 12.5 }, text: '«enumeration» OrderStatus\n--\nDRAFT\nPAID\nSHIPPED' },
  { id: 'umlObject', label: 'Object', category: 'UML', description: 'An instance (object diagram): "name : Class" underlined, then attribute values.', keywords: ['instance', 'object diagram'], compartments: 'class', w: 180, h: 100, style: { ...white, fontSize: 12.5 }, text: 'order42 : Order\n--\ntotal = 120\nstatus = PAID' },
  { id: 'umlPackage', label: 'Package', category: 'UML', description: 'A namespace or module grouping classes (the folder tab holds the name).', keywords: ['namespace', 'module', 'folder', 'component'], w: 220, h: 140, style: { ...slate, align: 'left', bold: true, fontSize: 13 }, text: 'billing', textBox: { x: 0.02, y: 0, w: 0.5, h: 0.17 } },
  { id: 'umlActor', label: 'Actor', category: 'UML', description: 'Use-case diagram: a person or external system that interacts with the system (stick figure; name below).', keywords: ['use case', 'user', 'role', 'stick figure', 'persona'], w: 44, h: 80, style: { fill: 'transparent', stroke: '#334155', strokeWidth: 1.8, fontSize: 12 }, text: 'Customer', textBox: { x: -1, y: 1.05, w: 3, h: 0.5 } },
  { id: 'umlUseCase', label: 'Use case', category: 'UML', description: 'Use-case diagram: a goal the actor achieves with the system, as a verb phrase in an ellipse.', keywords: ['use case', 'goal', 'scenario', 'feature'], w: 170, h: 70, style: { ...sky, fontSize: 12.5 }, text: 'Place order', textBox: { x: 0.12, y: 0.12, w: 0.76, h: 0.76 } },
  { id: 'umlSystemBoundary', label: 'System boundary', category: 'UML', description: 'Use-case diagram: the frame around the use cases of one system; actors stand outside.', keywords: ['use case', 'system', 'scope', 'frame'], w: 420, h: 320, style: { fill: '#ffffff', stroke: '#64748b', align: 'left', bold: true, fontSize: 13 }, text: 'Shop system', textBox: { x: 0.03, y: 0.01, w: 0.94, h: 0.1 } },
  { id: 'umlComponent', label: 'Component', category: 'UML', description: 'Component diagram: a replaceable part of the system with defined interfaces (the two small tabs).', keywords: ['component', 'module', 'service', 'library'], w: 180, h: 80, style: { ...white, fontSize: 12.5 }, text: 'Payment service', textBox: { x: 0.12, y: 0, w: 0.84, h: 1 } },
  { id: 'umlNode', label: 'Node', category: 'UML', description: 'Deployment diagram: hardware or an execution environment (server, device, container) drawn as a 3-D box.', keywords: ['deployment', 'server', 'device', 'host', 'docker'], w: 160, h: 110, style: { ...slate, fontSize: 12.5 }, text: '«device» App server', textBox: { x: 0.02, y: 0.22, w: 0.78, h: 0.76 } },
  { id: 'umlArtifact', label: 'Artifact', category: 'UML', description: 'Deployment diagram: a physical file produced or deployed (a .jar, an image, a database dump).', keywords: ['deployment', 'file', 'binary', 'artifact'], w: 140, h: 70, style: { ...white, fontSize: 12.5 }, text: 'api.jar', textBox: { x: 0.08, y: 0, w: 0.76, h: 1 } },
  { id: 'umlNote', label: 'Note', category: 'UML', description: 'A comment with a folded corner, attached to any element with a dashed line.', keywords: ['comment', 'remark', 'constraint'], w: 170, h: 70, style: { fill: '#fef9c3', stroke: '#ca8a04', align: 'left', fontSize: 12 }, text: 'Note', textBox: { x: 0.06, y: 0.05, w: 0.82, h: 0.9 } },
  { id: 'umlState', label: 'State', category: 'UML', description: 'State machine: a condition the object is in (Draft, Paid); transitions are the connectors, labelled with the event.', keywords: ['state machine', 'status', 'lifecycle', 'transition'], w: 160, h: 64, style: { ...green, fontSize: 12.5 }, text: 'Paid' },
  { id: 'umlInitial', label: 'Initial state', category: 'UML', description: 'State machine / activity: where it starts (filled circle).', keywords: ['start', 'begin', 'state machine', 'activity'], w: 28, h: 28, style: { fill: '#334155', stroke: '#334155', fontSize: 12 }, text: '', textBox: below },
  { id: 'umlFinal', label: 'Final state', category: 'UML', description: 'State machine / activity: where it ends (bull’s eye).', keywords: ['end', 'finish', 'state machine', 'activity'], w: 32, h: 32, style: { fill: '#ffffff', stroke: '#334155', strokeWidth: 1.8, fontSize: 12 }, text: '', textBox: below },
  { id: 'umlActivity', label: 'Activity / Action', category: 'UML', description: 'Activity diagram: one action (rounded box); use Decision for branches and Fork / Join for parallel paths.', keywords: ['activity diagram', 'action', 'step'], w: 170, h: 56, style: { ...blue, fontSize: 12.5 }, text: 'Check stock' },
  { id: 'umlForkJoin', label: 'Fork / Join', category: 'UML', description: 'Activity diagram: a thick bar that splits the flow into parallel paths (fork) or waits for them (join).', keywords: ['parallel', 'synchronisation', 'bar', 'activity diagram'], w: 160, h: 8, style: { fill: '#334155', stroke: '#334155', fontSize: 12 }, text: '', textBox: { x: 0, y: 1.3, w: 1, h: 3 } },
  { id: 'umlLifeline', label: 'Lifeline', category: 'UML', description: 'Sequence diagram: a participant (box) with its dashed lifeline below; messages are horizontal connectors between lifelines.', keywords: ['sequence diagram', 'participant', 'message', 'timeline'], w: 120, h: 320, style: { ...white, fontSize: 12.5 }, text: ':OrderService', textBox: { x: 0, y: 0, w: 1, h: 0.14 } },
  { id: 'umlActivation', label: 'Activation', category: 'UML', description: 'Sequence diagram: the thin bar on a lifeline showing when the participant is busy.', keywords: ['sequence diagram', 'execution', 'focus of control'], w: 14, h: 90, style: { fill: '#e2e8f0', stroke: '#334155', fontSize: 11 }, text: '' },

  // ── Basic Shapes ─────────────────────────────────────────────────────────
  { id: 'rect', label: 'Rectangle', category: 'Basic Shapes', description: 'A plain box for anything that is not a standard flowchart symbol.', w: 160, h: 80, style: blue, text: '' },
  { id: 'rounded', label: 'Rounded Rect', category: 'Basic Shapes', description: 'A box with soft corners — often used for steps in modern diagrams.', w: 160, h: 80, style: blue, text: '' },
  { id: 'ellipse', label: 'Ellipse', category: 'Basic Shapes', description: 'An oval; used for states, events or start / end in some notations.', w: 140, h: 90, style: blue, text: '', textBox: { x: 0.15, y: 0.15, w: 0.7, h: 0.7 } },
  { id: 'circle', label: 'Circle', category: 'Basic Shapes', description: 'A circle; a state, a node, a marker.', w: 90, h: 90, style: blue, text: '', textBox: { x: 0.15, y: 0.15, w: 0.7, h: 0.7 } },
  { id: 'semicircle', label: 'Semicircle', category: 'Basic Shapes', description: 'Half a circle, flat at the bottom.', w: 140, h: 70, style: blue, text: '', textBox: { x: 0.15, y: 0.3, w: 0.7, h: 0.7 } },
  { id: 'parallelogram', label: 'Parallelogram', category: 'Basic Shapes', description: 'A slanted box; the flowchart symbol for input / output.', w: 170, h: 70, style: blue, text: '', textBox: { x: 0.14, y: 0, w: 0.72, h: 1 } },
  { id: 'trapezoid', label: 'Trapezoid', category: 'Basic Shapes', description: 'A box narrower at the top; the flowchart symbol for a manual operation.', w: 170, h: 70, style: blue, text: '', textBox: { x: 0.14, y: 0, w: 0.72, h: 1 } },
  { id: 'diamond', label: 'Diamond', category: 'Basic Shapes', description: 'A rhombus; the classic decision / gateway shape.', w: 110, h: 110, style: amber, text: '', textBox: { x: 0.22, y: 0.22, w: 0.56, h: 0.56 } },
  { id: 'triangle', label: 'Triangle', category: 'Basic Shapes', description: 'A triangle pointing up.', w: 110, h: 96, style: blue, text: '', textBox: { x: 0.25, y: 0.45, w: 0.5, h: 0.5 } },
  { id: 'rightTriangle', label: 'Right triangle', category: 'Basic Shapes', description: 'A triangle with a right angle at the bottom left.', w: 110, h: 96, style: blue, text: '', textBox: { x: 0.05, y: 0.45, w: 0.55, h: 0.5 } },
  { id: 'pentagon', label: 'Pentagon', category: 'Basic Shapes', description: 'Five sides; also used as a direction / home-plate marker.', w: 110, h: 104, style: violet, text: '', textBox: { x: 0.15, y: 0.25, w: 0.7, h: 0.6 } },
  { id: 'hexagon', label: 'Hexagon', category: 'Basic Shapes', description: 'Six sides; the flowchart symbol for preparation.', w: 150, h: 80, style: violet, text: '', textBox: { x: 0.15, y: 0, w: 0.7, h: 1 } },
  { id: 'octagon', label: 'Octagon', category: 'Basic Shapes', description: 'Eight sides — a stop or block marker.', w: 110, h: 110, style: red, text: '', textBox: { x: 0.15, y: 0.15, w: 0.7, h: 0.7 } },
  { id: 'cylinder', label: 'Cylinder', category: 'Basic Shapes', description: 'A drum shape — storage, a database, a disk.', w: 110, h: 110, style: blue, text: '', textBox: { x: 0.05, y: 0.25, w: 0.9, h: 0.7 } },
  { id: 'cube', label: 'Cube', category: 'Basic Shapes', description: 'A box in 3-D; a component, a package, a server.', w: 120, h: 110, style: slate, text: '', textBox: { x: 0.02, y: 0.25, w: 0.78, h: 0.75 } },
  { id: 'star', label: 'Star', category: 'Basic Shapes', description: 'A five-point star for highlights and ratings.', w: 110, h: 110, style: amber, text: '', textBox: { x: 0.3, y: 0.35, w: 0.4, h: 0.4 } },
  { id: 'cloud', label: 'Cloud', category: 'Basic Shapes', description: 'A cloud — the internet, an external service, something out of your control.', w: 170, h: 100, style: slate, text: '', textBox: { x: 0.15, y: 0.2, w: 0.7, h: 0.65 } },
  { id: 'plus', label: 'Plus', category: 'Basic Shapes', description: 'A plus / cross sign — add, medical, an intersection.', w: 90, h: 90, style: green, text: '', textBox: { x: 0.3, y: 0.3, w: 0.4, h: 0.4 } },
  { id: 'heart', label: 'Heart', category: 'Basic Shapes', description: 'A heart — for favourites, satisfaction, care.', w: 110, h: 100, style: red, text: '', textBox: { x: 0.25, y: 0.2, w: 0.5, h: 0.5 } },

  // ── Arrows & Callouts ────────────────────────────────────────────────────
  { id: 'arrowRight', label: 'Arrow right', category: 'Arrows & Callouts', description: 'A block arrow pointing right — direction, progression, a hand-over.', w: 160, h: 70, style: sky, text: '', textBox: { x: 0.05, y: 0.2, w: 0.65, h: 0.6 } },
  { id: 'arrowLeft', label: 'Arrow left', category: 'Arrows & Callouts', description: 'A block arrow pointing left.', w: 160, h: 70, style: sky, text: '', textBox: { x: 0.3, y: 0.2, w: 0.65, h: 0.6 } },
  { id: 'arrowDouble', label: 'Double arrow', category: 'Arrows & Callouts', description: 'A block arrow pointing both ways — exchange, two-way communication.', w: 180, h: 70, style: sky, text: '', textBox: { x: 0.25, y: 0.2, w: 0.5, h: 0.6 } },
  { id: 'arrowUp', label: 'Arrow up', category: 'Arrows & Callouts', description: 'A block arrow pointing up — increase, escalation.', w: 70, h: 140, style: sky, text: '', textBox: { x: 0.2, y: 0.4, w: 0.6, h: 0.55 } },
  { id: 'arrowDown', label: 'Arrow down', category: 'Arrows & Callouts', description: 'A block arrow pointing down — decrease, drill-down.', w: 70, h: 140, style: sky, text: '', textBox: { x: 0.2, y: 0.05, w: 0.6, h: 0.55 } },
  { id: 'chevron', label: 'Chevron', category: 'Arrows & Callouts', description: 'A chevron — one stage of a process strip; place several in a row (Plan › Build › Test).', w: 160, h: 64, style: violet, text: 'Stage', textBox: { x: 0.15, y: 0, w: 0.7, h: 1 }, keywords: ['stage', 'step strip', 'timeline'] },
  { id: 'calloutRect', label: 'Callout', category: 'Arrows & Callouts', description: 'A speech bubble with a pointer — a remark tied to a spot of the diagram.', w: 180, h: 80, style: { fill: '#fef9c3', stroke: '#eab308', align: 'left', fontSize: 13 }, text: 'Callout', textBox: { x: 0.06, y: 0.04, w: 0.88, h: 0.72 } },
  { id: 'calloutRound', label: 'Rounded callout', category: 'Arrows & Callouts', description: 'A rounded speech bubble.', w: 180, h: 80, style: { fill: '#fef9c3', stroke: '#eab308', align: 'left', fontSize: 13 }, text: 'Callout', textBox: { x: 0.08, y: 0.06, w: 0.84, h: 0.68 } },

  // ── Text ─────────────────────────────────────────────────────────────────
  { id: 'text', label: 'Text', category: 'Text', description: 'Free text without a frame — titles, legends, labels.', w: 160, h: 40, style: { fill: 'transparent', stroke: 'transparent', strokeWidth: 0 }, text: 'Text' },
  { id: 'note', label: 'Sticky note', category: 'Text', description: 'A yellow note for comments and open questions while designing the process.', w: 160, h: 120, style: { fill: '#fef9c3', stroke: '#eab308', align: 'left', shadow: true, fontSize: 13 }, text: 'Note', textBox: { x: 0.07, y: 0.08, w: 0.86, h: 0.84 } },
];

export const SHAPE_CATEGORIES: ShapeCategory[] = ['Flowchart', 'BPMN Events', 'BPMN Activities', 'BPMN Gateways', 'BPMN Data & Artifacts', 'Swimlanes', 'Entity Relationship', 'UML', 'Basic Shapes', 'Arrows & Callouts', 'Text'];

/** Containers are drawn behind everything else and are never auto-selected with their content. */
export const CONTAINER_SHAPES = new Set(['container', 'lane', 'pool', 'verticalLane', 'phase', 'bpmnGroup', 'umlSystemBoundary', 'umlPackage']);

export const shapeDef = (id: string): ShapeDef => SHAPES.find((s) => s.id === id) ?? SHAPES[0];

export const styleFor = (id: string): NodeStyle => ({ ...DEFAULT_NODE_STYLE, ...(shapeDef(id).style ?? {}) });

/** Search over label, description, keywords and BPMN meaning. */
export function searchShapes(q: string): ShapeDef[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return SHAPES;
  return SHAPES.filter((s) => [s.label, s.description, s.category, ...(s.keywords ?? []), ...Object.values(s.bpmn ?? {})].join(' ').toLowerCase().includes(needle));
}

/** Icons a node may carry beside its text (names of the web app's icon set). */
export const ICONS = ['file-text', 'settings', 'calendar', 'check-circle', 'clock', 'mail', 'user', 'users', 'database', 'credit-card', 'shopping-cart', 'message-square', 'bell', 'shield-check', 'truck', 'phone', 'globe', 'alert-triangle', 'x-circle', 'star'];

export interface ShapeMarker {
  d: string;
  /** Filled with the stroke colour (throwing events, data output) instead of outlined. */
  filled?: boolean;
  strokeWidth?: number;
}

/** The outline, optional inner lines, and optional symbol markers (BPMN event / task type icons) of a shape. */
export function shapePath(shape: string, w: number, h: number): { d: string; inner?: string; markers?: ShapeMarker[] } {
  const r = Math.min(10, w / 6, h / 6);
  const def = shapeDef(shape);
  switch (shape) {
    case 'terminal':
      return { d: roundRect(w, h, h / 2) };
    case 'process':
    case 'subprocess':
    case 'rounded':
    case 'note':
    case 'loopLimit':
      if (shape === 'loopLimit') {
        const k = Math.min(h * 0.3, 16);
        return { d: `M${k},0 H${w - k} L${w},${k} V${h} H0 V${k} Z` };
      }
      return { d: roundRect(w, h, shape === 'note' ? 2 : r), inner: shape === 'subprocess' ? `M${w * 0.07},0 V${h} M${w * 0.93},0 V${h}` : undefined };
    case 'rect':
    case 'text':
    case 'container':
    case 'bpmnGroup':
      return { d: roundRect(w, h, shape === 'container' || shape === 'bpmnGroup' ? 8 : 0) };
    case 'lane':
      return { d: roundRect(w, h, 0), inner: `M${w * 0.06},0 V${h}` };
    case 'pool':
      return { d: roundRect(w, h, 0), inner: `M${w * 0.05},0 V${h}` };
    case 'verticalLane':
    case 'phase':
      return { d: roundRect(w, h, 0), inner: `M0,${h * 0.07} H${w}` };
    case 'decision':
    case 'diamond':
      return { d: diamond(w, h) };
    case 'ellipse':
    case 'connector':
    case 'circle':
      return { d: ellipse(w / 2, h / 2, w / 2, h / 2) };
    case 'semicircle':
      return { d: `M0,${h} A${w / 2},${h} 0 0 1 ${w},${h} Z` };
    case 'document': {
      const y = h * 0.86;
      return { d: `M0,0 H${w} V${y} C${w * 0.75},${h * 1.1} ${w * 0.25},${h * 0.62} 0,${y} Z` };
    }
    case 'multiDocument': {
      const o = Math.min(w * 0.06, 10);
      const y = h * 0.84;
      return {
        d: `M0,${2 * o} H${w - 2 * o} V${y} C${(w - 2 * o) * 0.75},${h * 1.08} ${(w - 2 * o) * 0.25},${h * 0.66} 0,${y} Z`,
        inner: `M${o},${2 * o} V${o} H${w - o} V${y - o} M${2 * o},${o} V0 H${w} V${y - 2 * o}`,
      };
    }
    case 'database':
    case 'cylinder':
    case 'bpmnDataStore': {
      const ry = Math.min(h * 0.14, 14);
      return {
        d: `M0,${ry} A${w / 2},${ry} 0 0 1 ${w},${ry} V${h - ry} A${w / 2},${ry} 0 0 1 0,${h - ry} Z`,
        inner: shape === 'bpmnDataStore' ? `M0,${ry} A${w / 2},${ry} 0 0 0 ${w},${ry} M0,${ry * 1.8} A${w / 2},${ry} 0 0 0 ${w},${ry * 1.8} M0,${ry * 2.6} A${w / 2},${ry} 0 0 0 ${w},${ry * 2.6}` : `M0,${ry} A${w / 2},${ry} 0 0 0 ${w},${ry}`,
      };
    }
    case 'directData': {
      const rx = Math.min(w * 0.12, 14);
      return { d: `M${rx},0 H${w - rx} A${rx},${h / 2} 0 0 1 ${w - rx},${h} H${rx} A${rx},${h / 2} 0 0 1 ${rx},0 Z`, inner: `M${w - rx},0 A${rx},${h / 2} 0 0 0 ${w - rx},${h}` };
    }
    case 'storedData': {
      const rx = Math.min(w * 0.12, 14);
      return { d: `M${rx},0 H${w} A${rx},${h / 2} 0 0 0 ${w},${h} H${rx} A${rx},${h / 2} 0 0 1 ${rx},0 Z` };
    }
    case 'internalStorage': {
      const k = Math.min(w * 0.14, 16);
      return { d: roundRect(w, h, 0), inner: `M${k},0 V${h} M0,${k} H${w}` };
    }
    case 'sequentialData': {
      const rr = Math.min(w, h) / 2;
      return { d: ellipse(w / 2, h / 2, rr, rr), inner: `M${w / 2},${h} H${w}` };
    }
    case 'io':
    case 'parallelogram': {
      const k = Math.min(w * 0.14, 26);
      return { d: `M${k},0 H${w} L${w - k},${h} H0 Z` };
    }
    case 'manual': {
      const k = Math.min(w * 0.12, 22);
      return { d: `M0,0 H${w} L${w - k},${h} H${k} Z` };
    }
    case 'trapezoid': {
      const k = Math.min(w * 0.12, 22);
      return { d: `M${k},0 H${w - k} L${w},${h} H0 Z` };
    }
    case 'manualInput': {
      const k = Math.min(h * 0.3, 18);
      return { d: `M0,${k} L${w},0 V${h} H0 Z` };
    }
    case 'delay':
      return { d: `M0,0 H${w - h / 2} A${h / 2},${h / 2} 0 0 1 ${w - h / 2},${h} H0 Z` };
    case 'display': {
      const k = Math.min(w * 0.15, 24);
      return { d: `M0,${h / 2} L${k},0 H${w - k} A${k},${h / 2} 0 0 1 ${w - k},${h} H${k} Z` };
    }
    case 'preparation':
    case 'hexagon': {
      const k = Math.min(w * 0.15, 26);
      return { d: `M${k},0 H${w - k} L${w},${h / 2} L${w - k},${h} H${k} L0,${h / 2} Z` };
    }
    case 'triangle':
    case 'extract':
      return { d: `M${w / 2},0 L${w},${h} H0 Z` };
    case 'merge':
      return { d: `M0,0 H${w} L${w / 2},${h} Z` };
    case 'rightTriangle':
      return { d: `M0,0 L${w},${h} H0 Z` };
    case 'collate':
      return { d: `M0,0 H${w} L0,${h} H${w} Z` };
    case 'sort':
      return { d: diamond(w, h), inner: `M0,${h / 2} H${w}` };
    case 'summingJunction': {
      const k = (1 - Math.SQRT1_2) / 2;
      return { d: ellipse(w / 2, h / 2, w / 2, h / 2), inner: `M${w * k},${h * k} L${w * (1 - k)},${h * (1 - k)} M${w * (1 - k)},${h * k} L${w * k},${h * (1 - k)}` };
    }
    case 'or':
      return { d: ellipse(w / 2, h / 2, w / 2, h / 2), inner: `M${w / 2},0 V${h} M0,${h / 2} H${w}` };
    case 'card': {
      const k = Math.min(w * 0.15, h * 0.3, 18);
      return { d: `M${k},0 H${w} V${h} H0 V${k} Z` };
    }
    case 'offPage':
      return { d: `M0,0 H${w} V${h * 0.65} L${w / 2},${h} L0,${h * 0.65} Z` };
    case 'pentagon':
      return { d: `M${w / 2},0 L${w},${h * 0.38} L${w * 0.81},${h} H${w * 0.19} L0,${h * 0.38} Z` };
    case 'octagon': {
      const k = 0.29;
      return { d: `M${w * k},0 H${w * (1 - k)} L${w},${h * k} V${h * (1 - k)} L${w * (1 - k)},${h} H${w * k} L0,${h * (1 - k)} V${h * k} Z` };
    }
    case 'cube': {
      const o = Math.min(w * 0.2, h * 0.2, 22);
      return { d: `M0,${o} L${o},0 H${w} V${h - o} L${w - o},${h} H0 Z`, inner: `M0,${o} H${w - o} V${h} M${w - o},${o} L${w},0` };
    }
    case 'star': {
      const pts: string[] = [];
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const rr = i % 2 ? 0.4 : 1;
        pts.push(`${w / 2 + (Math.cos(a) * w * rr) / 2},${h / 2 + (Math.sin(a) * h * rr) / 2}`);
      }
      return { d: `M${pts.join(' L')} Z` };
    }
    case 'plus': {
      const a = w * 0.33;
      const b = h * 0.33;
      return { d: `M${a},0 H${w - a} V${b} H${w} V${h - b} H${w - a} V${h} H${a} V${h - b} H0 V${b} H${a} Z` };
    }
    case 'heart':
      return { d: `M${w / 2},${h} C${w * 0.1},${h * 0.7} 0,${h * 0.5} 0,${h * 0.3} C0,${h * 0.1} ${w * 0.15},0 ${w * 0.3},0 C${w * 0.4},0 ${w / 2},${h * 0.12} ${w / 2},${h * 0.2} C${w / 2},${h * 0.12} ${w * 0.6},0 ${w * 0.7},0 C${w * 0.85},0 ${w},${h * 0.1} ${w},${h * 0.3} C${w},${h * 0.5} ${w * 0.9},${h * 0.7} ${w / 2},${h} Z` };
    case 'bpmnData':
    case 'bpmnDataInput':
    case 'bpmnDataOutput': {
      const k = Math.min(w * 0.3, 16);
      const arrow = `M${w * 0.15},${h * 0.2} H${w * 0.45} V${h * 0.1} L${w * 0.7},${h * 0.27} L${w * 0.45},${h * 0.44} V${h * 0.34} H${w * 0.15} Z`;
      return { d: `M0,0 H${w - k} L${w},${k} V${h} H0 Z`, inner: `M${w - k},0 V${k} H${w}`, markers: shape === 'bpmnData' ? undefined : [{ d: arrow, filled: shape === 'bpmnDataOutput', strokeWidth: 1.2 }] };
    }
    case 'annotation':
    case 'bpmnAnnotation': {
      const k = Math.min(w * 0.08, 14);
      return { d: `M${k},0 H0 V${h} H${k}` };
    }
    case 'cloud':
      return {
        d: `M${w * 0.25},${h * 0.85} C${w * 0.02},${h * 0.85} ${w * 0.02},${h * 0.45} ${w * 0.22},${h * 0.45} C${w * 0.2},${h * 0.12} ${w * 0.55},${h * 0.05} ${w * 0.6},${h * 0.3} C${w * 0.7},${h * 0.15} ${w * 0.95},${h * 0.25} ${w * 0.85},${h * 0.5} C${w * 1.02},${h * 0.55} ${w},${h * 0.88} ${w * 0.78},${h * 0.85} Z`,
      };
    case 'arrowRight': {
      const k = Math.min(w * 0.3, h * 0.7);
      const b = h * 0.25;
      return { d: `M0,${b} H${w - k} V0 L${w},${h / 2} L${w - k},${h} V${h - b} H0 Z` };
    }
    case 'arrowLeft': {
      const k = Math.min(w * 0.3, h * 0.7);
      const b = h * 0.25;
      return { d: `M${w},${b} H${k} V0 L0,${h / 2} L${k},${h} V${h - b} H${w} Z` };
    }
    case 'arrowDouble': {
      const k = Math.min(w * 0.25, h * 0.7);
      const b = h * 0.25;
      return { d: `M0,${h / 2} L${k},0 V${b} H${w - k} V0 L${w},${h / 2} L${w - k},${h} V${h - b} H${k} V${h} Z` };
    }
    case 'arrowUp': {
      const k = Math.min(h * 0.3, w * 0.7);
      const b = w * 0.25;
      return { d: `M${b},${h} V${k} H0 L${w / 2},0 L${w},${k} H${w - b} V${h} Z` };
    }
    case 'arrowDown': {
      const k = Math.min(h * 0.3, w * 0.7);
      const b = w * 0.25;
      return { d: `M${b},0 V${h - k} H0 L${w / 2},${h} L${w},${h - k} H${w - b} V0 Z` };
    }
    case 'chevron': {
      const k = Math.min(w * 0.18, h / 2);
      return { d: `M0,0 H${w - k} L${w},${h / 2} L${w - k},${h} H0 L${k},${h / 2} Z` };
    }
    case 'calloutRect':
    case 'calloutRound': {
      const by = h * 0.78;
      const rr = shape === 'calloutRound' ? Math.min(14, by / 3) : 0;
      const tail = `L${w * 0.3},${by} L${w * 0.2},${h} L${w * 0.15},${by}`;
      if (!rr) return { d: `M0,0 H${w} V${by} H${w * 0.3} ${tail} H0 Z` };
      return { d: `M${rr},0 H${w - rr} A${rr},${rr} 0 0 1 ${w},${rr} V${by - rr} A${rr},${rr} 0 0 1 ${w - rr},${by} H${w * 0.3} ${tail} H${rr} A${rr},${rr} 0 0 1 0,${by - rr} V${rr} A${rr},${rr} 0 0 1 ${rr},0 Z` };
    }
    case 'erEntity':
    case 'umlClass':
    case 'umlAbstract':
    case 'umlInterface':
    case 'umlEnum':
    case 'umlObject':
    case 'umlSystemBoundary':
      return { d: roundRect(w, h, 0) };
    case 'erWeakEntity':
      return { d: roundRect(w, h, 0), inner: `M4,4 H${w - 4} V${h - 4} H4 Z` };
    case 'erRelationship':
      return { d: diamond(w, h) };
    case 'erAttribute':
    case 'erKeyAttribute':
    case 'erDerivedAttribute':
    case 'umlUseCase':
      return { d: ellipse(w / 2, h / 2, w / 2, h / 2) };
    case 'erMultiAttribute':
      return { d: ellipse(w / 2, h / 2, w / 2, h / 2), inner: ellipse(w / 2, h / 2, w / 2 - 4, h / 2 - 4) };
    case 'umlPackage': {
      const tw = Math.min(w * 0.45, 110);
      const th = Math.min(h * 0.17, 24);
      return { d: `M0,${th} V0 H${tw} L${tw + 8},${th} H${w} V${h} H0 Z`, inner: `M0,${th} H${tw + 8}` };
    }
    case 'umlActor': {
      const cx = w / 2;
      const r0 = Math.min(w, h * 0.3) * 0.28;
      return {
        d: ellipse(cx, r0, r0, r0),
        inner: `M${cx},${2 * r0} V${h * 0.62} M${w * 0.05},${h * 0.36} H${w * 0.95} M${cx},${h * 0.62} L${w * 0.08},${h} M${cx},${h * 0.62} L${w * 0.92},${h}`,
      };
    }
    case 'umlComponent': {
      const tw = Math.min(w * 0.12, 18);
      const th = Math.min(h * 0.14, 10);
      return { d: roundRect(w, h, 2), markers: [{ d: `M${-tw / 2},${h * 0.25} H${tw / 2} V${h * 0.25 + th} H${-tw / 2} Z M${-tw / 2},${h * 0.55} H${tw / 2} V${h * 0.55 + th} H${-tw / 2} Z`, strokeWidth: 1.2 }] };
    }
    case 'umlNode': {
      const o = Math.min(w * 0.2, h * 0.2, 22);
      return { d: `M0,${o} L${o},0 H${w} V${h - o} L${w - o},${h} H0 Z`, inner: `M0,${o} H${w - o} V${h} M${w - o},${o} L${w},0` };
    }
    case 'umlArtifact': {
      const k = Math.min(w * 0.18, 16);
      return { d: `M0,0 H${w - k} L${w},${k} V${h} H0 Z`, inner: `M${w - k},0 V${k} H${w}` };
    }
    case 'umlNote': {
      const k = Math.min(w * 0.14, 16);
      return { d: `M0,0 H${w - k} L${w},${k} V${h} H0 Z`, inner: `M${w - k},0 V${k} H${w}` };
    }
    case 'umlState':
    case 'umlActivity':
      return { d: roundRect(w, h, Math.min(14, h / 3)) };
    case 'umlInitial':
      return { d: ellipse(w / 2, h / 2, w / 2, h / 2) };
    case 'umlFinal':
      return { d: ellipse(w / 2, h / 2, w / 2, h / 2), markers: [{ d: ellipse(w / 2, h / 2, w / 2 - 5, h / 2 - 5), filled: true }] };
    case 'umlForkJoin':
    case 'umlActivation':
      return { d: roundRect(w, h, 2) };
    case 'umlLifeline': {
      const bh = Math.min(h * 0.14, 44);
      return { d: roundRect(w, bh, 2), inner: `M${w / 2},${bh} V${h}` };
    }
    default:
      break;
  }
  // BPMN events, gateways and activities share outlines; their meaning is drawn as a marker.
  if (def.bpmn?.kind === 'event') {
    const inner = def.bpmn.position === 'intermediate' || def.bpmn.position === 'boundary' ? ellipse(w / 2, h / 2, w / 2 - 4, h / 2 - 4) : undefined;
    const filled = def.bpmn.position === 'end' || def.bpmn.direction === 'throw';
    return { d: ellipse(w / 2, h / 2, w / 2, h / 2), inner, markers: eventMarker(def.bpmn.eventType ?? 'none', w, h, filled) };
  }
  if (def.bpmn?.kind === 'gateway') {
    return { d: diamond(w, h), inner: def.bpmn.gatewayType === 'eventBased' ? ellipse(w / 2, h / 2, w * 0.3, h * 0.3) + ' ' + ellipse(w / 2, h / 2, w * 0.24, h * 0.24) : undefined, markers: gatewayMarker(def.bpmn.gatewayType ?? 'exclusive', w, h) };
  }
  if (def.bpmn?.kind === 'activity') {
    const t = def.bpmn.taskType ?? 'abstract';
    return { d: roundRect(w, h, r), inner: t === 'transaction' ? innerRoundRect(w, h, r) : undefined, markers: taskMarker(t, w, h) };
  }
  return { d: roundRect(w, h, r) };
}

function diamond(w: number, h: number) {
  return `M${w / 2},0 L${w},${h / 2} L${w / 2},${h} L0,${h / 2} Z`;
}
function roundRect(w: number, h: number, r: number) {
  const k = Math.max(0, Math.min(r, w / 2, h / 2));
  if (!k) return `M0,0 H${w} V${h} H0 Z`;
  return `M${k},0 H${w - k} A${k},${k} 0 0 1 ${w},${k} V${h - k} A${k},${k} 0 0 1 ${w - k},${h} H${k} A${k},${k} 0 0 1 0,${h - k} V${k} A${k},${k} 0 0 1 ${k},0 Z`;
}
function innerRoundRect(w: number, h: number, r: number) {
  const o = 3;
  const k = Math.max(2, Math.min(r - 2, (w - 2 * o) / 2, (h - 2 * o) / 2));
  const W = w - 2 * o;
  const H = h - 2 * o;
  return `M${o + k},${o} H${o + W - k} A${k},${k} 0 0 1 ${o + W},${o + k} V${o + H - k} A${k},${k} 0 0 1 ${o + W - k},${o + H} H${o + k} A${k},${k} 0 0 1 ${o},${o + H - k} V${o + k} A${k},${k} 0 0 1 ${o + k},${o} Z`;
}
function ellipse(cx: number, cy: number, rx: number, ry: number) {
  return `M${cx - rx},${cy} A${rx},${ry} 0 1 0 ${cx + rx},${cy} A${rx},${ry} 0 1 0 ${cx - rx},${cy} Z`;
}

/** The symbol inside a BPMN event circle, in the standard notation. */
function eventMarker(type: NonNullable<BpmnMeta['eventType']>, w: number, h: number, filled: boolean): ShapeMarker[] | undefined {
  const cx = w / 2;
  const cy = h / 2;
  const s = Math.min(w, h) * 0.22; // half-size of the symbol
  switch (type) {
    case 'message':
      return [{ d: `M${cx - s * 1.1},${cy - s * 0.75} H${cx + s * 1.1} V${cy + s * 0.75} H${cx - s * 1.1} Z M${cx - s * 1.1},${cy - s * 0.75} L${cx},${cy + s * 0.05} L${cx + s * 1.1},${cy - s * 0.75}`, filled }];
    case 'timer':
      return [
        { d: ellipse(cx, cy, s * 1.05, s * 1.05), strokeWidth: 1.2 },
        { d: `M${cx},${cy} L${cx},${cy - s * 0.75} M${cx},${cy} L${cx + s * 0.55},${cy + s * 0.2}` + [0, 1, 2, 3, 4, 5, 6, 7].map((i) => `M${cx + Math.cos((i * Math.PI) / 4) * s * 0.85},${cy + Math.sin((i * Math.PI) / 4) * s * 0.85} L${cx + Math.cos((i * Math.PI) / 4) * s * 1.05},${cy + Math.sin((i * Math.PI) / 4) * s * 1.05}`).join(' '), strokeWidth: 1.2 },
      ];
    case 'signal':
      return [{ d: `M${cx},${cy - s} L${cx + s * 1.05},${cy + s * 0.75} H${cx - s * 1.05} Z`, filled }];
    case 'conditional':
      return [{ d: `M${cx - s * 0.8},${cy - s} H${cx + s * 0.8} V${cy + s} H${cx - s * 0.8} Z M${cx - s * 0.5},${cy - s * 0.5} H${cx + s * 0.5} M${cx - s * 0.5},${cy - s * 0.1} H${cx + s * 0.5} M${cx - s * 0.5},${cy + s * 0.3} H${cx + s * 0.5} M${cx - s * 0.5},${cy + s * 0.7} H${cx + s * 0.5}`, strokeWidth: 1.2 }];
    case 'link':
      return [{ d: `M${cx - s},${cy - s * 0.45} H${cx + s * 0.2} V${cy - s} L${cx + s * 1.05},${cy} L${cx + s * 0.2},${cy + s} V${cy + s * 0.45} H${cx - s} Z`, filled }];
    case 'error':
      return [{ d: `M${cx - s * 0.95},${cy + s} L${cx - s * 0.35},${cy - s} L${cx + s * 0.25},${cy + s * 0.25} L${cx + s * 0.95},${cy - s} L${cx + s * 0.35},${cy + s} L${cx - s * 0.25},${cy - s * 0.25} Z`, filled }];
    case 'escalation':
      return [{ d: `M${cx},${cy - s} L${cx + s * 0.8},${cy + s} L${cx},${cy + s * 0.2} L${cx - s * 0.8},${cy + s} Z`, filled }];
    case 'terminate':
      return [{ d: ellipse(cx, cy, s * 0.85, s * 0.85), filled: true }];
    case 'cancel':
      return [{ d: `M${cx - s},${cy - s * 0.6} L${cx - s * 0.6},${cy - s} L${cx},${cy - s * 0.4} L${cx + s * 0.6},${cy - s} L${cx + s},${cy - s * 0.6} L${cx + s * 0.4},${cy} L${cx + s},${cy + s * 0.6} L${cx + s * 0.6},${cy + s} L${cx},${cy + s * 0.4} L${cx - s * 0.6},${cy + s} L${cx - s},${cy + s * 0.6} L${cx - s * 0.4},${cy} Z`, filled }];
    case 'compensation':
      return [{ d: `M${cx - s * 1.05},${cy} L${cx - s * 0.05},${cy - s * 0.8} V${cy + s * 0.8} Z M${cx - s * 0.05},${cy} L${cx + s * 0.95},${cy - s * 0.8} V${cy + s * 0.8} Z`, filled }];
    default:
      return undefined;
  }
}

/** The symbol inside a BPMN gateway diamond. */
function gatewayMarker(type: NonNullable<BpmnMeta['gatewayType']>, w: number, h: number): ShapeMarker[] | undefined {
  const cx = w / 2;
  const cy = h / 2;
  const s = Math.min(w, h) * 0.2;
  switch (type) {
    case 'exclusive':
      return [{ d: `M${cx - s},${cy - s} L${cx + s},${cy + s} M${cx + s},${cy - s} L${cx - s},${cy + s}`, strokeWidth: 2.5 }];
    case 'parallel':
      return [{ d: `M${cx},${cy - s * 1.2} V${cy + s * 1.2} M${cx - s * 1.2},${cy} H${cx + s * 1.2}`, strokeWidth: 2.5 }];
    case 'inclusive':
      return [{ d: ellipse(cx, cy, s * 1.05, s * 1.05), strokeWidth: 2.5 }];
    case 'eventBased':
      return [{ d: `M${cx},${cy - s * 0.75} L${cx + s * 0.72},${cy - s * 0.22} L${cx + s * 0.45},${cy + s * 0.65} H${cx - s * 0.45} L${cx - s * 0.72},${cy - s * 0.22} Z`, strokeWidth: 1.3 }];
    case 'complex':
      return [{ d: `M${cx},${cy - s * 1.2} V${cy + s * 1.2} M${cx - s * 1.2},${cy} H${cx + s * 1.2} M${cx - s * 0.85},${cy - s * 0.85} L${cx + s * 0.85},${cy + s * 0.85} M${cx + s * 0.85},${cy - s * 0.85} L${cx - s * 0.85},${cy + s * 0.85}`, strokeWidth: 2.2 }];
  }
}

/** The small type icon in the top-left corner of a BPMN activity, or the [+] marker of a collapsed sub-process. */
function taskMarker(type: NonNullable<BpmnMeta['taskType']>, w: number, h: number): ShapeMarker[] | undefined {
  const x = 8;
  const y = 7;
  const s = 7; // half-size
  const sw = 1.3;
  switch (type) {
    case 'user':
      return [{ d: `M${x + s},${y + s * 0.2} A${s * 0.45},${s * 0.45} 0 1 1 ${x + s - 0.01},${y + s * 0.2} M${x + s * 0.15},${y + 2 * s} V${y + s * 1.5} A${s * 0.85},${s * 0.7} 0 0 1 ${x + 2 * s - s * 0.15},${y + s * 1.5} V${y + 2 * s}`, strokeWidth: sw }];
    case 'service': {
      const cx = x + s;
      const cy = y + s;
      const teeth = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => `M${cx + Math.cos((i * Math.PI) / 4) * s * 0.65},${cy + Math.sin((i * Math.PI) / 4) * s * 0.65} L${cx + Math.cos((i * Math.PI) / 4) * s},${cy + Math.sin((i * Math.PI) / 4) * s}`).join(' ');
      return [{ d: ellipse(cx, cy, s * 0.65, s * 0.65) + ' ' + ellipse(cx, cy, s * 0.25, s * 0.25) + ' ' + teeth, strokeWidth: sw }];
    }
    case 'script':
      return [{ d: `M${x + s * 1.6},${y} H${x + s * 0.5} C${x - s * 0.3},${y + s * 0.6} ${x + s * 1.3},${y + s * 1.4} ${x + s * 0.4},${y + 2 * s} H${x + s * 1.5} C${x + s * 2.3},${y + s * 1.4} ${x + s * 0.7},${y + s * 0.6} ${x + s * 1.6},${y} M${x + s * 0.7},${y + s * 0.6} H${x + s * 1.5} M${x + s * 0.6},${y + s * 1.4} H${x + s * 1.4}`, strokeWidth: sw }];
    case 'manual':
      return [{ d: `M${x},${y + s * 0.9} H${x + s * 0.6} V${y + s * 0.4} H${x + s * 1.9} V${y + s * 0.8} H${x + s * 1.3} M${x + s * 1.9},${y + s * 0.8} H${x + s * 1.3} V${y + s * 1.2} H${x + s * 1.9} V${y + s * 1.6} H${x + s * 1.1} V${y + 2 * s} H${x} Z`, strokeWidth: sw }];
    case 'send':
      return [{ d: `M${x},${y + s * 0.3} H${x + 2 * s} V${y + s * 1.7} H${x} Z M${x},${y + s * 0.3} L${x + s},${y + s * 1.05} L${x + 2 * s},${y + s * 0.3}`, filled: true, strokeWidth: sw }];
    case 'receive':
      return [{ d: `M${x},${y + s * 0.3} H${x + 2 * s} V${y + s * 1.7} H${x} Z M${x},${y + s * 0.3} L${x + s},${y + s * 1.05} L${x + 2 * s},${y + s * 0.3}`, strokeWidth: sw }];
    case 'businessRule':
      return [{ d: `M${x},${y + s * 0.2} H${x + 2 * s} V${y + s * 1.8} H${x} Z M${x},${y + s * 0.75} H${x + 2 * s} M${x},${y + s * 1.3} H${x + 2 * s} M${x + s * 0.7},${y + s * 0.75} V${y + s * 1.8}`, strokeWidth: sw }];
    case 'subprocess': {
      const b = 7;
      const cx = w / 2;
      const by = h - b - 3;
      return [{ d: `M${cx - b},${by - b} H${cx + b} V${by + b} H${cx - b} Z M${cx},${by - b * 0.6} V${by + b * 0.6} M${cx - b * 0.6},${by} H${cx + b * 0.6}`, strokeWidth: sw }];
    }
    default:
      return undefined;
  }
}

/** The whole library as data — for documentation and for an AI that drafts diagrams (§77 batch 2). */
export function shapeCatalog() {
  return SHAPES.map((s) => ({ id: s.id, label: s.label, category: s.category, description: s.description, keywords: s.keywords ?? [], bpmn: s.bpmn ?? null, defaultText: s.text ?? '', size: { w: s.w, h: s.h } }));
}
