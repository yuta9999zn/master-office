// Flow model (docs/ARCHITECTURE.md §77): a flow is a collaborative diagram — pages of nodes (shapes) joined by
// edges (connectors) — plus the workflow's info (version, status, trigger, tags). Shared by the designer (web),
// the server (blank / templates / SVG export) and, later, the automation runner.

import type { NodeAutomation } from './automation';

export type Side = 'top' | 'right' | 'bottom' | 'left';
export const SIDES: Side[] = ['top', 'right', 'bottom', 'left'];

export type Dash = 'solid' | 'dashed' | 'dotted';
export type ArrowHead = 'none' | 'arrow' | 'open' | 'triangle' | 'diamond' | 'diamondOpen' | 'circle' | 'crowOne' | 'crowMany' | 'crowOneMany' | 'crowZeroOne' | 'crowZeroMany';

/** Every arrow head with what it means (UML and entity-relationship notation included). */
export const ARROW_HEADS: { id: ArrowHead; label: string; note: string }[] = [
  { id: 'none', label: 'None', note: 'A plain line.' },
  { id: 'arrow', label: 'Arrow', note: 'Flow direction (filled).' },
  { id: 'open', label: 'Open arrow', note: 'Direction; UML dependency / message flow end.' },
  { id: 'triangle', label: 'Hollow triangle', note: 'UML generalization (inheritance) / realization — points at the parent.' },
  { id: 'diamond', label: 'Filled diamond', note: 'UML composition — the whole owns its parts (at the whole).' },
  { id: 'diamondOpen', label: 'Hollow diamond', note: 'UML aggregation — the whole references its parts (at the whole).' },
  { id: 'circle', label: 'Circle', note: 'BPMN message flow start; a plain end point.' },
  { id: 'crowOne', label: 'One (|)', note: 'ER: exactly one.' },
  { id: 'crowMany', label: 'Many (<)', note: 'ER: many (crow’s foot).' },
  { id: 'crowOneMany', label: 'One or many (|<)', note: 'ER: at least one.' },
  { id: 'crowZeroOne', label: 'Zero or one (o|)', note: 'ER: optional, at most one.' },
  { id: 'crowZeroMany', label: 'Zero or many (o<)', note: 'ER: optional, any number.' },
];

/** Ready-made connector styles for the common notations (the Preset menu of a connector). */
export const EDGE_PRESETS: { id: string; label: string; style: Partial<EdgeStyle>; note: string }[] = [
  { id: 'flow', label: 'Sequence flow', style: { dash: 'solid', startArrow: 'none', endArrow: 'arrow' }, note: 'What happens next.' },
  { id: 'message', label: 'Message flow (BPMN)', style: { dash: 'dashed', startArrow: 'circle', endArrow: 'open' }, note: 'A message between pools.' },
  { id: 'association', label: 'Association', style: { dash: 'dotted', startArrow: 'none', endArrow: 'none' }, note: 'Attaches data / notes; UML plain association when solid.' },
  { id: 'generalization', label: 'Generalization (UML)', style: { dash: 'solid', startArrow: 'none', endArrow: 'triangle' }, note: 'Child → parent (inherits).' },
  { id: 'realization', label: 'Realization (UML)', style: { dash: 'dashed', startArrow: 'none', endArrow: 'triangle' }, note: 'Class → interface it implements.' },
  { id: 'dependency', label: 'Dependency (UML)', style: { dash: 'dashed', startArrow: 'none', endArrow: 'open' }, note: 'Uses / depends on.' },
  { id: 'aggregation', label: 'Aggregation (UML)', style: { dash: 'solid', startArrow: 'diamondOpen', endArrow: 'none' }, note: 'Whole (diamond) has parts that can live alone.' },
  { id: 'composition', label: 'Composition (UML)', style: { dash: 'solid', startArrow: 'diamond', endArrow: 'none' }, note: 'Whole (diamond) owns parts that die with it.' },
  { id: 'er11', label: 'ER 1 — 1', style: { dash: 'solid', startArrow: 'crowOne', endArrow: 'crowOne' }, note: 'One to one.' },
  { id: 'er1n', label: 'ER 1 — n', style: { dash: 'solid', startArrow: 'crowOne', endArrow: 'crowMany' }, note: 'One to many (the foot at the many side).' },
  { id: 'ernn', label: 'ER n — n', style: { dash: 'solid', startArrow: 'crowMany', endArrow: 'crowMany' }, note: 'Many to many (usually resolved by a join table).' },
  { id: 'er01n', label: 'ER 0..1 — 0..n', style: { dash: 'solid', startArrow: 'crowZeroOne', endArrow: 'crowZeroMany' }, note: 'Optional one to optional many.' },
  { id: 'er1_1n', label: 'ER 1 — 1..n', style: { dash: 'solid', startArrow: 'crowOne', endArrow: 'crowOneMany' }, note: 'One to at least one.' },
];
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
  /** What the shape does when the flow runs (§77 batch 2); absent = a plain diagram step. */
  automation?: NodeAutomation | null;
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
  /** What starts the workflow, as people describe it (the runner reads the trigger shapes instead). */
  trigger: string;
  tags: string[];
  description: string;
  /** Automation on: trigger shapes start runs (§77 batch 2). */
  automation: boolean;
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
