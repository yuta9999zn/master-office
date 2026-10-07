// Flow model (docs/ARCHITECTURE.md §77): a flow is a collaborative diagram — pages of nodes (shapes) joined by
// edges (connectors) — plus the workflow's info (version, status, trigger, tags). Shared by the designer (web),
// the server (blank / templates / SVG export) and, later, the automation runner.

export type Side = 'top' | 'right' | 'bottom' | 'left';
export const SIDES: Side[] = ['top', 'right', 'bottom', 'left'];

export type Dash = 'solid' | 'dashed' | 'dotted';
export type ArrowHead = 'none' | 'arrow' | 'open' | 'diamond' | 'circle';
export type Route = 'orthogonal' | 'straight' | 'curved';

export interface NodeStyle {
  fill: string;
  /** 0–1 */
  fillOpacity: number;
  stroke: string;
  strokeWidth: number;
  dash: Dash;
  textColor: string;
  fontFamily: string;
  fontSize: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  align: 'left' | 'center' | 'right';
  /** A soft shadow under the shape. */
  shadow: boolean;
}

export interface FlowNode {
  id: string;
  page: string;
  shape: string;
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
  /** An icon name drawn left of the text (see ICONS). */
  icon: string | null;
  style: NodeStyle;
  /** Stacking order (higher draws on top). */
  z: number;
  /** Free key / value properties (the Data tab). */
  data: Record<string, string>;
}

export interface EdgeStyle {
  stroke: string;
  strokeWidth: number;
  dash: Dash;
  startArrow: ArrowHead;
  endArrow: ArrowHead;
  route: Route;
}

export interface FlowEdge {
  id: string;
  page: string;
  from: string;
  /** null = picked from where the nodes sit. */
  fromSide: Side | null;
  to: string;
  toSide: Side | null;
  label: string;
  style: EdgeStyle;
}

export interface FlowPage {
  id: string;
  name: string;
}

export type FlowStatus = 'draft' | 'review' | 'published' | 'archived';

export interface FlowInfo {
  version: string;
  status: FlowStatus;
  /** What starts the workflow (shown in Workflow info; the runner uses it in §77 batch 2). */
  trigger: string;
  tags: string[];
  description: string;
}

export interface PlainFlow {
  info: FlowInfo;
  pages: FlowPage[];
  nodes: FlowNode[];
  edges: FlowEdge[];
}

export const STATUS_LABEL: Record<FlowStatus, string> = { draft: 'Draft', review: 'In review', published: 'Published', archived: 'Archived' };

export const TRIGGERS = ['Manual', 'Form submission', 'Base record created', 'Base record updated', 'Approval approved', 'Task status changed', 'Schedule', 'Incoming email'] as const;

export const DEFAULT_NODE_STYLE: NodeStyle = {
  fill: '#eff6ff',
  fillOpacity: 1,
  stroke: '#3b82f6',
  strokeWidth: 1,
  dash: 'solid',
  textColor: '#1f2937',
  fontFamily: 'Inter',
  fontSize: 14,
  bold: false,
  italic: false,
  underline: false,
  strike: false,
  align: 'center',
  shadow: false,
};

export const DEFAULT_EDGE_STYLE: EdgeStyle = { stroke: '#334155', strokeWidth: 1.5, dash: 'solid', startArrow: 'none', endArrow: 'arrow', route: 'orthogonal' };

/** Fill / border pairs offered in the Style tab (soft fills, the reference's palette). */
export const PALETTE: { fill: string; stroke: string; name: string }[] = [
  { name: 'Blue', fill: '#eff6ff', stroke: '#3b82f6' },
  { name: 'Violet', fill: '#f3f0ff', stroke: '#8b5cf6' },
  { name: 'Green', fill: '#ecfdf3', stroke: '#22c55e' },
  { name: 'Amber', fill: '#fff7e0', stroke: '#f59e0b' },
  { name: 'Red', fill: '#fef2f2', stroke: '#ef4444' },
  { name: 'Teal', fill: '#ecfeff', stroke: '#14b8a6' },
  { name: 'Pink', fill: '#fdf2f8', stroke: '#ec4899' },
  { name: 'Slate', fill: '#f8fafc', stroke: '#64748b' },
  { name: 'White', fill: '#ffffff', stroke: '#334155' },
];

export const FONTS = ['Inter', 'Georgia', 'Verdana', 'Courier New', 'Trebuchet MS'];

let seq = 0;
export const newId = (prefix: string) => `${prefix}${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;
