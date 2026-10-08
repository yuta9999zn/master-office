'use client';

import {
  asPlain,
  DEFAULT_EDGE_STYLE,
  EDGES_MAP,
  field,
  INFO_MAP,
  NODES_MAP,
  newId,
  PAGE_ORDER,
  PAGES_MAP,
  readFlow,
  shapeDef,
  styleFor,
  type EdgeStyle,
  type FlowEdge,
  type FlowInfo,
  type FlowNode,
  type NodeStyle,
  type PlainFlow,
  type Side,
  type Stored,
  CONTAINER_SHAPES,
} from '@workos/flow-model';
import { useSyncExternalStore } from 'react';
import * as Y from 'yjs';

const LOCAL = { local: true };
type Items = Y.Map<Stored>;

/**
 * Reactive view of a flow's Y.Doc and every designer operation (docs/ARCHITECTURE.md §77). Each node / edge is one
 * plain value, replaced whole on change (see flow-model ydoc.ts), so undo brings deleted shapes back exactly.
 */
export class FlowStore {
  readonly info: Y.Map<unknown>;
  readonly order: Y.Array<string>;
  readonly pages: Items;
  readonly nodes: Items;
  readonly edges: Items;
  readonly undo: Y.UndoManager;
  private snap: PlainFlow & { ready: boolean };
  private listeners = new Set<() => void>();

  constructor(readonly doc: Y.Doc) {
    this.info = doc.getMap(INFO_MAP);
    this.order = doc.getArray<string>(PAGE_ORDER);
    this.pages = doc.getMap<Stored>(PAGES_MAP);
    this.nodes = doc.getMap<Stored>(NODES_MAP);
    this.edges = doc.getMap<Stored>(EDGES_MAP);
    this.undo = new Y.UndoManager([this.info, this.order, this.pages, this.nodes, this.edges], { trackedOrigins: new Set([LOCAL]), captureTimeout: 400 });
    this.snap = this.read();
    doc.on('update', this.onUpdate);
  }

  destroy() {
    this.doc.off('update', this.onUpdate);
    this.undo.destroy();
  }

  private onUpdate = () => {
    this.snap = this.read();
    this.listeners.forEach((l) => l());
  };
  private read() {
    return { ...readFlow(this.doc), ready: this.order.length > 0 };
  }
  subscribe = (l: () => void) => (this.listeners.add(l), () => void this.listeners.delete(l));
  get = () => this.snap;
  private tx(fn: () => void) {
    this.doc.transact(fn, LOCAL);
  }
  /** Replaces one stored item with a patched copy. */
  private patch(map: Items, id: string, fn: (cur: Record<string, unknown>) => Record<string, unknown>) {
    const m = map.get(id);
    if (m) map.set(id, fn(asPlain(m)));
  }

  // ── Info & pages ──────────────────────────────────────────────────────────
  setInfo(patch: Partial<FlowInfo>) {
    this.tx(() => Object.entries(patch).forEach(([k, v]) => this.info.set(k, v)));
  }
  addPage(name: string) {
    const id = newId('p');
    this.tx(() => {
      this.pages.set(id, { name });
      this.order.push([id]);
    });
    return id;
  }
  renamePage(id: string, name: string) {
    this.tx(() => this.patch(this.pages, id, (p) => ({ ...p, name })));
  }
  deletePage(id: string) {
    this.undo.stopCapturing();
    this.tx(() => {
      for (const [nid, m] of [...this.nodes.entries()]) if (field(m, 'page') === id) this.nodes.delete(nid);
      for (const [eid, m] of [...this.edges.entries()]) if (field(m, 'page') === id) this.edges.delete(eid);
      this.pages.delete(id);
      const i = this.order.toArray().indexOf(id);
      if (i >= 0) this.order.delete(i, 1);
    });
  }

  // ── Nodes ─────────────────────────────────────────────────────────────────
  private maxZ(page: string) {
    let z = 0;
    this.nodes.forEach((m) => field(m, 'page') === page && (z = Math.max(z, Number(field(m, 'z') ?? 0))));
    return z;
  }
  addNode(page: string, shape: string, x: number, y: number, extra: Partial<FlowNode> = {}) {
    const def = shapeDef(shape);
    const id = newId('n');
    const node: FlowNode = {
      id,
      page,
      shape,
      x: Math.round(x),
      y: Math.round(y),
      w: def.w,
      h: def.h,
      text: def.text ?? '',
      icon: def.icon ?? null,
      // Containers sit under everything else.
      z: CONTAINER_SHAPES.has(shape) ? -1 : this.maxZ(page) + 1,
      style: styleFor(shape),
      data: {},
      ...extra,
    };
    // Adding and removing are always their own undo steps: merged with a preceding edit of the same shape (within
    // captureTimeout) the old value could not be restored, since each shape is one flat map value.
    this.undo.stopCapturing();
    this.tx(() => this.nodes.set(id, toPlain(node)));
    return id;
  }
  updateNode(id: string, patch: Partial<Omit<FlowNode, 'style'>> & { style?: Partial<NodeStyle> }) {
    this.updateNodes([{ id, ...patch }]);
  }
  updateNodes(patches: (Partial<Omit<FlowNode, 'style'>> & { id: string; style?: Partial<NodeStyle> })[]) {
    this.tx(() => {
      for (const { id, style, ...rest } of patches) this.patch(this.nodes, id, (cur) => ({ ...cur, ...rest, ...(style ? { style: { ...((cur.style as object) ?? {}), ...style } } : {}) }));
    });
  }
  /** Changes a node's shape and takes the new shape's colours only if it still had the old shape's. */
  setShape(id: string, shape: string) {
    const def = shapeDef(shape);
    const small = ['bpmnStart', 'bpmnEnd', 'bpmnIntermediate', 'bpmnGateway', 'bpmnParallel', 'connector'].includes(shape);
    this.tx(() =>
      this.patch(this.nodes, id, (n) => {
        const old = styleFor(String(n.shape));
        const cur = (n.style as Partial<NodeStyle>) ?? {};
        const next = styleFor(shape);
        return { ...n, shape, ...(cur.fill === old.fill && cur.stroke === old.stroke ? { style: { ...cur, fill: next.fill, stroke: next.stroke } } : {}), ...(small ? { w: def.w, h: def.h } : {}) };
      }),
    );
  }
  reorder(ids: string[], to: 'front' | 'back') {
    const first = this.nodes.get(ids[0]);
    const page = first ? String(field(first, 'page')) : '';
    let lo = 0;
    let hi = 0;
    this.nodes.forEach((m) => {
      if (field(m, 'page') !== page) return;
      const z = Number(field(m, 'z') ?? 0);
      lo = Math.min(lo, z);
      hi = Math.max(hi, z);
    });
    this.tx(() => ids.forEach((id, i) => this.patch(this.nodes, id, (n) => ({ ...n, z: to === 'front' ? hi + 1 + i : lo - ids.length + i }))));
  }

  // ── Edges ─────────────────────────────────────────────────────────────────
  addEdge(page: string, from: string, to: string, fromSide: Side | null, toSide: Side | null, extra: Partial<FlowEdge> = {}) {
    const id = newId('e');
    const e: FlowEdge = { id, page, from, to, fromSide, toSide, label: '', style: { ...DEFAULT_EDGE_STYLE }, ...extra };
    this.undo.stopCapturing();
    this.tx(() => this.edges.set(id, toPlain(e)));
    return id;
  }
  updateEdge(id: string, patch: Partial<Omit<FlowEdge, 'style'>> & { style?: Partial<EdgeStyle> }) {
    const { style, ...rest } = patch;
    this.tx(() => this.patch(this.edges, id, (cur) => ({ ...cur, ...rest, ...(style ? { style: { ...((cur.style as object) ?? {}), ...style } } : {}) })));
  }

  /** Deletes nodes (and the edges touching them) and edges, in one undo step. */
  remove(nodeIds: string[], edgeIds: string[]) {
    const gone = new Set(nodeIds);
    this.undo.stopCapturing();
    this.tx(() => {
      for (const id of nodeIds) this.nodes.delete(id);
      for (const [id, m] of [...this.edges.entries()]) if (edgeIds.includes(id) || gone.has(String(field(m, 'from'))) || gone.has(String(field(m, 'to')))) this.edges.delete(id);
    });
  }

  /** Pastes copies of nodes (and the edges between them) shifted by an offset; returns the new node ids. */
  paste(page: string, nodes: FlowNode[], edges: FlowEdge[], dx: number, dy: number) {
    const ids = new Map(nodes.map((n) => [n.id, newId('n')]));
    const z = this.maxZ(page);
    this.tx(() => {
      nodes.forEach((n, i) => this.nodes.set(ids.get(n.id)!, toPlain({ ...n, page, x: n.x + dx, y: n.y + dy, z: z + 1 + i })));
      for (const e of edges)
        if (ids.has(e.from) && ids.has(e.to)) this.edges.set(newId('e'), toPlain({ ...e, page, from: ids.get(e.from)!, to: ids.get(e.to)! }));
    });
    return [...ids.values()];
  }
}

function toPlain(o: object): Record<string, unknown> {
  const { id: _id, ...rest } = o as { id?: string };
  void _id;
  return rest;
}

export function useFlow(store: FlowStore | null) {
  return useSyncExternalStore(
    (l) => (store ? store.subscribe(l) : () => undefined),
    () => store?.get() ?? null,
    () => null,
  );
}
