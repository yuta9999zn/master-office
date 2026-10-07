// Starting points for a new flow (§77): blank, or a worked example like the reference design.
import { styleFor } from './shapes';
import { DEFAULT_EDGE_STYLE, type FlowEdge, type FlowNode, type NodeStyle, type PlainFlow, type Side } from './types';

const PAGE = 'p1';

export function blankFlow(): PlainFlow {
  return {
    info: { version: '1.0.0', status: 'draft', trigger: 'Manual', tags: [], description: '' },
    pages: [{ id: PAGE, name: 'Page 1' }],
    nodes: [node('n1', 'terminal', 400, 120, 'Start'), node('n2', 'process', 380, 220, 'First step'), node('n3', 'terminal', 400, 340, 'End')],
    edges: [edge('e1', 'n1', 'n2'), edge('e2', 'n2', 'n3')],
  };
}

function node(id: string, shape: string, x: number, y: number, text: string, o: { w?: number; h?: number; icon?: string; style?: Partial<NodeStyle> } = {}): FlowNode {
  const sizes: Record<string, [number, number]> = { terminal: [140, 44], process: [180, 56], decision: [130, 96], database: [130, 80] };
  const [w, h] = sizes[shape] ?? [180, 56];
  return { id, page: PAGE, shape, x, y, w: o.w ?? w, h: o.h ?? h, text, icon: o.icon ?? null, style: { ...styleFor(shape), ...(o.style ?? {}) }, z: 0, data: {} };
}
function edge(id: string, from: string, to: string, o: { label?: string; fromSide?: Side; toSide?: Side } = {}): FlowEdge {
  return { id, page: PAGE, from, to, fromSide: o.fromSide ?? null, toSide: o.toSide ?? null, label: o.label ?? '', style: { ...DEFAULT_EDGE_STYLE } };
}

const violet: Partial<NodeStyle> = { fill: '#f3f0ff', stroke: '#8b5cf6' };
const green: Partial<NodeStyle> = { fill: '#ecfdf3', stroke: '#22c55e' };
const red: Partial<NodeStyle> = { fill: '#fef2f2', stroke: '#ef4444' };

/** "Customer Booking Approval Workflow" — the reference design. */
export function bookingFlow(): PlainFlow {
  const cx = 520;
  const at = (w: number) => cx - w / 2;
  return {
    info: { version: '1.0.0', status: 'draft', trigger: 'Form submission', tags: ['Booking', 'Meeting', 'Customer'], description: 'From a booking request to a confirmed appointment, a staff task and the CRM record.' },
    pages: [{ id: PAGE, name: 'Page 1' }],
    nodes: [
      node('start', 'terminal', at(140), 40, 'Start'),
      node('form', 'process', at(190), 120, 'Booking Form Submitted', { w: 190, icon: 'file-text' }),
      node('validate', 'process', at(190), 210, 'Validate Request', { w: 190, icon: 'settings', style: violet }),
      node('slot', 'decision', at(130), 296, 'Available slot?', { w: 130, h: 104, icon: 'calendar' }),
      node('confirm', 'process', 220, 430, 'Confirm booking', { w: 186, icon: 'check-circle', style: green }),
      node('suggest', 'process', 634, 430, 'Suggest alternative time', { w: 186, icon: 'clock', style: red }),
      node('email', 'process', at(198), 530, 'Send email + meeting link', { w: 198, icon: 'mail' }),
      node('task', 'process', at(198), 620, 'Create task for staff', { w: 198, icon: 'user', style: violet }),
      node('crm', 'process', at(218), 710, 'Update CRM / Database', { w: 218, icon: 'database' }),
      node('end', 'terminal', at(140), 800, 'End'),
    ],
    edges: [
      edge('e1', 'start', 'form'),
      edge('e2', 'form', 'validate'),
      edge('e3', 'validate', 'slot'),
      edge('e4', 'slot', 'confirm', { label: 'Yes', fromSide: 'left', toSide: 'top' }),
      edge('e5', 'slot', 'suggest', { label: 'No', fromSide: 'right', toSide: 'top' }),
      edge('e6', 'confirm', 'email', { fromSide: 'bottom', toSide: 'left' }),
      edge('e7', 'suggest', 'email', { fromSide: 'bottom', toSide: 'right' }),
      edge('e8', 'email', 'task'),
      edge('e9', 'task', 'crm'),
      edge('e10', 'crm', 'end'),
    ],
  };
}

export const FLOW_TEMPLATES: { id: string; name: string; description: string; make: () => PlainFlow }[] = [
  { id: 'blank', name: 'Blank flow', description: 'Start, one step, end', make: blankFlow },
  { id: 'booking', name: 'Customer booking approval', description: 'Form → validation → decision → email, task and CRM', make: bookingFlow },
];
