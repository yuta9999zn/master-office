// Starting points for a new flow (§77): blank, or a worked example like the reference design.
import { styleFor } from './shapes';
import type { NodeAutomation } from './automation';
import { DEFAULT_EDGE_STYLE, type EdgeStyle, type FlowEdge, type FlowNode, type NodeStyle, type PlainFlow, type Side } from './types';

const PAGE = 'p1';

export function blankFlow(): PlainFlow {
  return {
    info: { version: '1.0.0', status: 'draft', trigger: 'Manual', tags: [], description: '', automation: false },
    pages: [{ id: PAGE, name: 'Page 1' }],
    nodes: [node('n1', 'terminal', 400, 120, 'Start', { automation: { role: 'trigger', type: 'manual', config: {} } }), node('n2', 'process', 380, 220, 'First step'), node('n3', 'terminal', 400, 340, 'End')],
    edges: [edge('e1', 'n1', 'n2'), edge('e2', 'n2', 'n3')],
  };
}

function node(id: string, shape: string, x: number, y: number, text: string, o: { w?: number; h?: number; icon?: string; style?: Partial<NodeStyle>; automation?: NodeAutomation } = {}): FlowNode {
  const sizes: Record<string, [number, number]> = { terminal: [140, 44], process: [180, 56], decision: [130, 96], database: [130, 80] };
  const [w, h] = sizes[shape] ?? [180, 56];
  return { id, page: PAGE, shape, x, y, w: o.w ?? w, h: o.h ?? h, text, icon: o.icon ?? null, style: { ...styleFor(shape), ...(o.style ?? {}) }, z: 0, data: {}, automation: o.automation ?? null };
}
function edge(id: string, from: string, to: string, o: { label?: string; fromSide?: Side; toSide?: Side; style?: Partial<EdgeStyle> } = {}): FlowEdge {
  return { id, page: PAGE, from, to, fromSide: o.fromSide ?? null, toSide: o.toSide ?? null, label: o.label ?? '', style: { ...DEFAULT_EDGE_STYLE, ...(o.style ?? {}) } };
}
const er = (start: EdgeStyle['startArrow'], end: EdgeStyle['endArrow']): Partial<EdgeStyle> => ({ startArrow: start, endArrow: end, route: 'orthogonal' });

/** "Order database (ER)" — tables with keys and crow's-foot relationships. */
export function erOrdersFlow(): PlainFlow {
  return {
    info: { version: '1.0.0', status: 'draft', trigger: 'Manual', tags: ['Database', 'ER'], description: 'Customers place orders; an order holds lines, each line one product.', automation: false },
    pages: [{ id: PAGE, name: 'Schema' }],
    nodes: [
      node('customer', 'erEntity', 80, 80, 'Customer\nPK id: int\nname: text\nemail: text\nphone: text', { w: 190, h: 128 }),
      node('order', 'erEntity', 420, 80, 'Order\nPK id: int\nFK customer_id: int\nordered_at: datetime\nstatus: text\ntotal: money', { w: 210, h: 146 }),
      node('item', 'erWeakEntity', 420, 330, 'OrderItem\nPK FK order_id: int\nPK line_no: int\nFK product_id: int\nqty: int\nprice: money', { w: 210, h: 146 }),
      node('product', 'erEntity', 800, 330, 'Product\nPK id: int\nsku: text\nname: text\nunit_price: money\nactive: bool', { w: 190, h: 146 }),
      node('note', 'umlNote', 800, 80, 'One customer places many orders;\nan order has at least one line;\na product may appear in many lines.', { w: 230, h: 76 }),
    ],
    edges: [
      edge('r1', 'customer', 'order', { label: 'places', fromSide: 'right', toSide: 'left', style: er('crowOne', 'crowZeroMany') }),
      edge('r2', 'order', 'item', { label: 'contains', fromSide: 'bottom', toSide: 'top', style: er('crowOne', 'crowOneMany') }),
      edge('r3', 'item', 'product', { label: 'refers to', fromSide: 'right', toSide: 'left', style: er('crowZeroMany', 'crowOne') }),
    ],
  };
}

/** "Order classes (UML)" — inheritance, composition, aggregation and an interface. */
export function umlOrdersFlow(): PlainFlow {
  return {
    info: { version: '1.0.0', status: 'draft', trigger: 'Manual', tags: ['UML', 'Class diagram'], description: 'The order domain as classes: composition of lines, aggregation of a customer, payment behind an interface.', automation: false },
    pages: [{ id: PAGE, name: 'Classes' }],
    nodes: [
      node('customer', 'umlClass', 60, 60, 'Customer\n--\n+ name: text\n+ email: text\n--\n+ orders(): Order[]', { w: 210, h: 130 }),
      node('status', 'umlEnum', 60, 330, '«enumeration» OrderStatus\n--\nDRAFT\nPAID\nSHIPPED\nCANCELLED', { w: 210, h: 130 }),
      node('order', 'umlClass', 400, 60, 'Order\n--\n+ id: int\n+ status: OrderStatus\n+ total(): money\n--\n+ addLine(p, qty)\n+ pay(method)', { w: 220, h: 170 }),
      node('line', 'umlClass', 400, 330, 'OrderLine\n--\n+ qty: int\n+ price: money\n--\n+ subtotal(): money', { w: 220, h: 130 }),
      node('product', 'umlClass', 400, 560, 'Product\n--\n+ sku: text\n+ unitPrice: money', { w: 220, h: 100 }),
      node('payable', 'umlInterface', 760, 60, '«interface» PaymentMethod\n--\n+ charge(amount)\n+ refund(amount)', { w: 230, h: 110 }),
      node('card', 'umlClass', 700, 330, 'CardPayment\n--\n+ last4: text', { w: 170, h: 80 }),
      node('cash', 'umlClass', 920, 330, 'CashPayment', { w: 150, h: 60 }),
    ],
    edges: [
      edge('c1', 'order', 'line', { label: '1  ◆  *', fromSide: 'bottom', toSide: 'top', style: { startArrow: 'diamond', endArrow: 'none' } }),
      edge('c2', 'customer', 'order', { label: '1 — *', fromSide: 'right', toSide: 'left', style: { startArrow: 'diamondOpen', endArrow: 'none' } }),
      edge('c3', 'line', 'product', { label: '* — 1', fromSide: 'bottom', toSide: 'top', style: { startArrow: 'none', endArrow: 'open' } }),
      edge('c4', 'order', 'payable', { label: 'uses', fromSide: 'right', toSide: 'left', style: { startArrow: 'none', endArrow: 'open', dash: 'dashed' } }),
      edge('c5', 'card', 'payable', { fromSide: 'top', toSide: 'bottom', style: { startArrow: 'none', endArrow: 'triangle', dash: 'dashed' } }),
      edge('c6', 'cash', 'payable', { fromSide: 'top', toSide: 'bottom', style: { startArrow: 'none', endArrow: 'triangle', dash: 'dashed' } }),
      edge('c7', 'order', 'status', { fromSide: 'left', toSide: 'right', style: { startArrow: 'none', endArrow: 'open', dash: 'dashed' } }),
    ],
  };
}

const violet: Partial<NodeStyle> = { fill: '#f3f0ff', stroke: '#8b5cf6' };
const green: Partial<NodeStyle> = { fill: '#ecfdf3', stroke: '#22c55e' };
const red: Partial<NodeStyle> = { fill: '#fef2f2', stroke: '#ef4444' };

/** "Customer Booking Approval Workflow" — the reference design. */
export function bookingFlow(): PlainFlow {
  const cx = 520;
  const at = (w: number) => cx - w / 2;
  return {
    info: { version: '1.0.0', status: 'draft', trigger: 'Form submission', tags: ['Booking', 'Meeting', 'Customer'], description: 'From a booking request to a confirmed appointment, a staff task and the CRM record.', automation: false },
    pages: [{ id: PAGE, name: 'Page 1' }],
    nodes: [
      node('start', 'terminal', at(140), 40, 'Start'),
      node('form', 'process', at(190), 120, 'Booking Form Submitted', { w: 190, icon: 'file-text', automation: { role: 'trigger', type: 'form.submitted', config: {} } }),
      node('validate', 'process', at(190), 210, 'Validate Request', { w: 190, icon: 'settings', style: violet }),
      node('slot', 'decision', at(130), 296, 'Available slot?', { w: 130, h: 104, icon: 'calendar', automation: { role: 'condition', type: '', config: { left: '{{trigger.answers.Available slot}}', op: 'truthy' } } }),
      node('confirm', 'process', 220, 430, 'Confirm booking', { w: 186, icon: 'check-circle', style: green }),
      node('suggest', 'process', 634, 430, 'Suggest alternative time', { w: 186, icon: 'clock', style: red }),
      node('email', 'process', at(198), 530, 'Send email + meeting link', { w: 198, icon: 'mail', automation: { role: 'action', type: 'mail.send', config: { to: '{{trigger.email}}', subject: 'Your booking: {{trigger.answers.Service}}', body: 'Hello {{trigger.answers.Name}},\n\nThank you for your request. We will confirm the time shortly.\n\nMeeting link: {{trigger.answers.Meeting link}}' } } }),
      node('task', 'process', at(198), 620, 'Create task for staff', { w: 198, icon: 'user', style: violet, automation: { role: 'action', type: 'task.create', config: { title: 'Booking: {{trigger.answers.Name}} — {{trigger.answers.Service}}', description: 'From the booking form. E-mail: {{trigger.email}}' } } }),
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
  { id: 'erOrders', name: 'Order database (ER)', description: 'Customer, Order, OrderItem, Product with 1 — n and n — 1 relationships', make: erOrdersFlow },
  { id: 'umlOrders', name: 'Order classes (UML)', description: 'Classes with composition, aggregation, an interface and an enumeration', make: umlOrdersFlow },
];
