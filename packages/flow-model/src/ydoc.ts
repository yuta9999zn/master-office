// Yjs layout of a flow (created by the server; clients never create the top-level containers):
//   Y.Map   'flowInfo'   version, status, trigger, tags, description
//   Y.Array 'pageOrder'  pageId[]
//   Y.Map   'pages'      pageId → { name }
//   Y.Map   'nodes'      nodeId → { page, shape, x, y, w, h, text, icon, style, z, data }
//   Y.Map   'edges'      edgeId → { page, from, fromSide, to, toSide, label, style }
// Each node / edge is one plain value: changes replace it whole, so undoing a delete brings it back exactly
// (deleted nested Y.Maps do not always come back with their content). Readers also accept the older Y.Map form.
import * as Y from 'yjs';
import type { NodeAutomation } from './automation';
import { DEFAULT_EDGE_STYLE, DEFAULT_NODE_STYLE, type FlowEdge, type FlowInfo, type FlowNode, type FlowPage, type PlainFlow } from './types';

export const INFO_MAP = 'flowInfo';
export const PAGE_ORDER = 'pageOrder';
export const PAGES_MAP = 'pages';
export const NODES_MAP = 'nodes';
export const EDGES_MAP = 'edges';

const plain = (o: { id?: string } & Record<string, unknown>) => {
  const { id: _id, ...rest } = o;
  void _id;
  return rest;
};
/** A stored node / edge / page: a plain object (or a Y.Map in older documents). */
export type Stored = Record<string, unknown> | Y.Map<unknown>;
export const field = (m: Stored, k: string) => (m instanceof Y.Map ? m.get(k) : m[k]);
export const asPlain = (m: Stored): Record<string, unknown> => (m instanceof Y.Map ? (m.toJSON() as Record<string, unknown>) : { ...m });

export function writeFlow(doc: Y.Doc, f: PlainFlow) {
  doc.transact(() => {
    const info = doc.getMap(INFO_MAP);
    for (const [k, v] of Object.entries(f.info)) info.set(k, v);
    const order = doc.getArray<string>(PAGE_ORDER);
    order.push(f.pages.map((p) => p.id));
    const pages = doc.getMap(PAGES_MAP);
    for (const p of f.pages) pages.set(p.id, { name: p.name });
    const nodes = doc.getMap(NODES_MAP);
    for (const n of f.nodes) nodes.set(n.id, plain({ ...n }));
    const edges = doc.getMap(EDGES_MAP);
    for (const e of f.edges) edges.set(e.id, plain({ ...e }));
  });
}

export function readInfo(doc: Y.Doc): FlowInfo {
  const m = doc.getMap(INFO_MAP);
  return {
    version: String(m.get('version') ?? '1.0.0'),
    status: (m.get('status') as FlowInfo['status']) ?? 'draft',
    trigger: String(m.get('trigger') ?? 'Manual'),
    tags: (m.get('tags') as string[]) ?? [],
    description: String(m.get('description') ?? ''),
    automation: m.get('automation') === true,
  };
}

/** Is this Y.Doc a flow (and not a document / workbook / deck / form)? */
export const hasFlow = (doc: Y.Doc) => doc.getMap(INFO_MAP).has('status');

export function readPages(doc: Y.Doc): FlowPage[] {
  const pages = doc.getMap<Stored>(PAGES_MAP);
  const seen = new Set<string>();
  return doc
    .getArray<string>(PAGE_ORDER)
    .toArray()
    .filter((id) => pages.has(id) && !seen.has(id) && seen.add(id))
    .map((id) => ({ id, name: String(field(pages.get(id)!, 'name') ?? 'Page') }));
}

export function readNode(id: string, s: Stored): FlowNode {
  const m = { get: (k: string) => field(s, k) };
  return {
    id,
    page: String(m.get('page') ?? ''),
    shape: String(m.get('shape') ?? 'process'),
    x: Number(m.get('x') ?? 0),
    y: Number(m.get('y') ?? 0),
    w: Number(m.get('w') ?? 160),
    h: Number(m.get('h') ?? 60),
    text: String(m.get('text') ?? ''),
    icon: (m.get('icon') as string | null) ?? null,
    style: { ...DEFAULT_NODE_STYLE, ...((m.get('style') as object) ?? {}) },
    z: Number(m.get('z') ?? 0),
    data: (m.get('data') as Record<string, string>) ?? {},
    automation: (m.get('automation') as NodeAutomation | null | undefined) ?? null,
  };
}

export function readEdge(id: string, s: Stored): FlowEdge {
  const m = { get: (k: string) => field(s, k) };
  return {
    id,
    page: String(m.get('page') ?? ''),
    from: String(m.get('from') ?? ''),
    fromSide: (m.get('fromSide') as FlowEdge['fromSide']) ?? null,
    to: String(m.get('to') ?? ''),
    toSide: (m.get('toSide') as FlowEdge['toSide']) ?? null,
    label: String(m.get('label') ?? ''),
    style: { ...DEFAULT_EDGE_STYLE, ...((m.get('style') as object) ?? {}) },
  };
}

export function readFlow(doc: Y.Doc): PlainFlow {
  const nodes: FlowNode[] = [];
  doc.getMap<Stored>(NODES_MAP).forEach((m, id) => nodes.push(readNode(id, m)));
  const edges: FlowEdge[] = [];
  doc.getMap<Stored>(EDGES_MAP).forEach((m, id) => edges.push(readEdge(id, m)));
  return { info: readInfo(doc), pages: readPages(doc), nodes: nodes.sort((a, b) => a.z - b.z), edges };
}
