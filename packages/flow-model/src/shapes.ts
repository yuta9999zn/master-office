// Shape library (§77): what each shape is called, where it lives in the panel, its default size and colours,
// and its outline as SVG path data in local coordinates (0,0)–(w,h).
import { DEFAULT_NODE_STYLE, type NodeStyle } from './types';

export interface ShapeDef {
  id: string;
  label: string;
  category: 'Flowchart' | 'BPMN' | 'Basic Shapes' | 'Containers' | 'Text';
  w: number;
  h: number;
  style?: Partial<NodeStyle>;
  /** Default text when dropped. */
  text?: string;
  icon?: string;
  /** Text is laid out inside this inset box (fractions of w / h). */
  textBox?: { x: number; y: number; w: number; h: number };
}

const blue = { fill: '#eff6ff', stroke: '#3b82f6' };
const violet = { fill: '#f3f0ff', stroke: '#8b5cf6' };
const green = { fill: '#ecfdf3', stroke: '#22c55e' };
const amber = { fill: '#fff7e0', stroke: '#f59e0b' };
const red = { fill: '#fef2f2', stroke: '#ef4444' };
const slate = { fill: '#f8fafc', stroke: '#64748b' };

export const SHAPES: ShapeDef[] = [
  // Flowchart
  { id: 'process', label: 'Process', category: 'Flowchart', w: 180, h: 56, style: blue, text: 'Process' },
  { id: 'decision', label: 'Decision', category: 'Flowchart', w: 130, h: 96, style: { ...amber, fontSize: 13 }, text: 'Decision?', textBox: { x: 0.14, y: 0.2, w: 0.72, h: 0.6 } },
  { id: 'terminal', label: 'Start / End', category: 'Flowchart', w: 140, h: 44, style: { ...green, fontSize: 14, bold: true }, text: 'Start' },
  { id: 'document', label: 'Document', category: 'Flowchart', w: 170, h: 64, style: blue, text: 'Document', textBox: { x: 0.04, y: 0, w: 0.92, h: 0.82 } },
  { id: 'database', label: 'Database', category: 'Flowchart', w: 130, h: 80, style: blue, text: 'Database', textBox: { x: 0.05, y: 0.25, w: 0.9, h: 0.7 } },
  { id: 'subprocess', label: 'Subprocess', category: 'Flowchart', w: 180, h: 56, style: violet, text: 'Subprocess', textBox: { x: 0.1, y: 0, w: 0.8, h: 1 } },
  { id: 'io', label: 'Input / Output', category: 'Flowchart', w: 170, h: 56, style: blue, text: 'Input / output', textBox: { x: 0.14, y: 0, w: 0.72, h: 1 } },
  { id: 'manual', label: 'Manual step', category: 'Flowchart', w: 170, h: 56, style: slate, text: 'Manual step', textBox: { x: 0.12, y: 0, w: 0.76, h: 1 } },
  { id: 'delay', label: 'Delay', category: 'Flowchart', w: 140, h: 56, style: amber, text: 'Wait', textBox: { x: 0.04, y: 0, w: 0.76, h: 1 } },
  { id: 'preparation', label: 'Preparation', category: 'Flowchart', w: 170, h: 56, style: slate, text: 'Prepare', textBox: { x: 0.14, y: 0, w: 0.72, h: 1 } },
  { id: 'connector', label: 'Connector', category: 'Flowchart', w: 40, h: 40, style: slate, text: 'A' },
  // BPMN
  { id: 'bpmnTask', label: 'Task', category: 'BPMN', w: 160, h: 72, style: { fill: '#ffffff', stroke: '#334155' }, text: 'Task' },
  { id: 'bpmnStart', label: 'Start event', category: 'BPMN', w: 44, h: 44, style: { fill: '#ecfdf3', stroke: '#16a34a', strokeWidth: 2 }, text: '' },
  { id: 'bpmnIntermediate', label: 'Intermediate event', category: 'BPMN', w: 44, h: 44, style: { fill: '#fff7e0', stroke: '#d97706', strokeWidth: 1.5 }, text: '' },
  { id: 'bpmnEnd', label: 'End event', category: 'BPMN', w: 44, h: 44, style: { fill: '#fef2f2', stroke: '#dc2626', strokeWidth: 4 }, text: '' },
  { id: 'bpmnGateway', label: 'Exclusive gateway', category: 'BPMN', w: 56, h: 56, style: { fill: '#fff7e0', stroke: '#d97706', strokeWidth: 1.5 }, text: '×', textBox: { x: 0.2, y: 0.2, w: 0.6, h: 0.6 } },
  { id: 'bpmnParallel', label: 'Parallel gateway', category: 'BPMN', w: 56, h: 56, style: { fill: '#fff7e0', stroke: '#d97706', strokeWidth: 1.5 }, text: '+', textBox: { x: 0.2, y: 0.2, w: 0.6, h: 0.6 } },
  { id: 'bpmnData', label: 'Data object', category: 'BPMN', w: 56, h: 72, style: { fill: '#ffffff', stroke: '#334155' }, text: '' },
  // Basic
  { id: 'rect', label: 'Rectangle', category: 'Basic Shapes', w: 160, h: 80, style: blue, text: '' },
  { id: 'rounded', label: 'Rounded Rect', category: 'Basic Shapes', w: 160, h: 80, style: blue, text: '' },
  { id: 'ellipse', label: 'Ellipse', category: 'Basic Shapes', w: 140, h: 90, style: blue, text: '', textBox: { x: 0.15, y: 0.15, w: 0.7, h: 0.7 } },
  { id: 'parallelogram', label: 'Parallelogram', category: 'Basic Shapes', w: 170, h: 70, style: blue, text: '', textBox: { x: 0.14, y: 0, w: 0.72, h: 1 } },
  { id: 'diamond', label: 'Diamond', category: 'Basic Shapes', w: 110, h: 110, style: amber, text: '', textBox: { x: 0.22, y: 0.22, w: 0.56, h: 0.56 } },
  { id: 'triangle', label: 'Triangle', category: 'Basic Shapes', w: 110, h: 96, style: blue, text: '', textBox: { x: 0.25, y: 0.45, w: 0.5, h: 0.5 } },
  { id: 'hexagon', label: 'Hexagon', category: 'Basic Shapes', w: 150, h: 80, style: violet, text: '', textBox: { x: 0.15, y: 0, w: 0.7, h: 1 } },
  { id: 'cylinder', label: 'Cylinder', category: 'Basic Shapes', w: 110, h: 110, style: blue, text: '', textBox: { x: 0.05, y: 0.25, w: 0.9, h: 0.7 } },
  { id: 'star', label: 'Star', category: 'Basic Shapes', w: 110, h: 110, style: amber, text: '', textBox: { x: 0.3, y: 0.35, w: 0.4, h: 0.4 } },
  { id: 'cloud', label: 'Cloud', category: 'Basic Shapes', w: 170, h: 100, style: slate, text: '', textBox: { x: 0.15, y: 0.2, w: 0.7, h: 0.65 } },
  // Containers
  { id: 'container', label: 'Group', category: 'Containers', w: 420, h: 280, style: { fill: '#f8fafc', stroke: '#94a3b8', dash: 'dashed', align: 'left', bold: true, fontSize: 13 }, text: 'Group', textBox: { x: 0.03, y: 0.02, w: 0.94, h: 0.12 } },
  { id: 'lane', label: 'Swimlane', category: 'Containers', w: 720, h: 200, style: { fill: '#ffffff', stroke: '#94a3b8', bold: true, fontSize: 13 }, text: 'Lane', textBox: { x: 0, y: 0, w: 0.06, h: 1 } },
  // Text
  { id: 'text', label: 'Text', category: 'Text', w: 160, h: 40, style: { fill: 'transparent', stroke: 'transparent', strokeWidth: 0 }, text: 'Text' },
  { id: 'note', label: 'Sticky note', category: 'Text', w: 160, h: 120, style: { fill: '#fef9c3', stroke: '#eab308', align: 'left', shadow: true, fontSize: 13 }, text: 'Note', textBox: { x: 0.07, y: 0.08, w: 0.86, h: 0.84 } },
];

export const SHAPE_CATEGORIES: ShapeDef['category'][] = ['Flowchart', 'BPMN', 'Basic Shapes', 'Containers', 'Text'];

export const shapeDef = (id: string): ShapeDef => SHAPES.find((s) => s.id === id) ?? SHAPES[0];

export const styleFor = (id: string): NodeStyle => ({ ...DEFAULT_NODE_STYLE, ...(shapeDef(id).style ?? {}) });

/** Icons a node may carry beside its text (names of the web app's icon set). */
export const ICONS = ['file-text', 'settings', 'calendar', 'check-circle', 'clock', 'mail', 'user', 'users', 'database', 'credit-card', 'shopping-cart', 'message-square', 'bell', 'shield-check', 'truck', 'phone', 'globe', 'alert-triangle', 'x-circle', 'star'];

/** The outline of a shape (and inner lines), as SVG path data in local coordinates. */
export function shapePath(shape: string, w: number, h: number): { d: string; inner?: string } {
  const r = Math.min(10, w / 6, h / 6);
  switch (shape) {
    case 'terminal':
      return { d: roundRect(w, h, h / 2) };
    case 'process':
    case 'subprocess':
    case 'rounded':
    case 'bpmnTask':
    case 'note':
      return { d: roundRect(w, h, shape === 'note' ? 2 : r), inner: shape === 'subprocess' ? `M${w * 0.07},0 V${h} M${w * 0.93},0 V${h}` : undefined };
    case 'rect':
    case 'text':
    case 'container':
      return { d: roundRect(w, h, shape === 'container' ? 8 : 0) };
    case 'lane':
      return { d: roundRect(w, h, 0), inner: `M${w * 0.06},0 V${h}` };
    case 'decision':
    case 'diamond':
    case 'bpmnGateway':
    case 'bpmnParallel':
      return { d: `M${w / 2},0 L${w},${h / 2} L${w / 2},${h} L0,${h / 2} Z` };
    case 'ellipse':
    case 'connector':
    case 'bpmnStart':
    case 'bpmnEnd':
      return { d: ellipse(w / 2, h / 2, w / 2, h / 2) };
    case 'bpmnIntermediate':
      return { d: ellipse(w / 2, h / 2, w / 2, h / 2), inner: ellipse(w / 2, h / 2, w / 2 - 4, h / 2 - 4) };
    case 'document': {
      const y = h * 0.86;
      return { d: `M0,0 H${w} V${y} C${w * 0.75},${h * 1.1} ${w * 0.25},${h * 0.62} 0,${y} Z` };
    }
    case 'database':
    case 'cylinder': {
      const ry = Math.min(h * 0.14, 14);
      return {
        d: `M0,${ry} A${w / 2},${ry} 0 0 1 ${w},${ry} V${h - ry} A${w / 2},${ry} 0 0 1 0,${h - ry} Z`,
        inner: `M0,${ry} A${w / 2},${ry} 0 0 0 ${w},${ry}`,
      };
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
    case 'delay':
      return { d: `M0,0 H${w - h / 2} A${h / 2},${h / 2} 0 0 1 ${w - h / 2},${h} H0 Z` };
    case 'preparation':
    case 'hexagon': {
      const k = Math.min(w * 0.15, 26);
      return { d: `M${k},0 H${w - k} L${w},${h / 2} L${w - k},${h} H${k} L0,${h / 2} Z` };
    }
    case 'triangle':
      return { d: `M${w / 2},0 L${w},${h} H0 Z` };
    case 'star': {
      const pts: string[] = [];
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const rr = i % 2 ? 0.4 : 1;
        pts.push(`${w / 2 + (Math.cos(a) * w * rr) / 2},${h / 2 + (Math.sin(a) * h * rr) / 2}`);
      }
      return { d: `M${pts.join(' L')} Z` };
    }
    case 'bpmnData': {
      const k = Math.min(w * 0.3, 16);
      return { d: `M0,0 H${w - k} L${w},${k} V${h} H0 Z`, inner: `M${w - k},0 V${k} H${w}` };
    }
    case 'cloud':
      return {
        d: `M${w * 0.25},${h * 0.85} C${w * 0.02},${h * 0.85} ${w * 0.02},${h * 0.45} ${w * 0.22},${h * 0.45} C${w * 0.2},${h * 0.12} ${w * 0.55},${h * 0.05} ${w * 0.6},${h * 0.3} C${w * 0.7},${h * 0.15} ${w * 0.95},${h * 0.25} ${w * 0.85},${h * 0.5} C${w * 1.02},${h * 0.55} ${w},${h * 0.88} ${w * 0.78},${h * 0.85} Z`,
      };
    default:
      return { d: roundRect(w, h, r) };
  }
}

function roundRect(w: number, h: number, r: number) {
  const k = Math.max(0, Math.min(r, w / 2, h / 2));
  if (!k) return `M0,0 H${w} V${h} H0 Z`;
  return `M${k},0 H${w - k} A${k},${k} 0 0 1 ${w},${k} V${h - k} A${k},${k} 0 0 1 ${w - k},${h} H${k} A${k},${k} 0 0 1 0,${h - k} V${k} A${k},${k} 0 0 1 ${k},0 Z`;
}
function ellipse(cx: number, cy: number, rx: number, ry: number) {
  return `M${cx - rx},${cy} A${rx},${ry} 0 1 0 ${cx + rx},${cy} A${rx},${ry} 0 1 0 ${cx - rx},${cy} Z`;
}
