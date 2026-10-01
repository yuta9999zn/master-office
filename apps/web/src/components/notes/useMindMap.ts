'use client';

import { BRANCH_COLORS, MINDMAP_EDGES, MINDMAP_MAP, notesToMindMap, ROOT_ID, type JSONContent, type MindEdge, type MindNode } from '@workos/doc-model';
import { useEffect, useMemo, useState } from 'react';
import * as Y from 'yjs';

const uid = () => crypto.randomUUID().slice(0, 12);

/**
 * Collaborative mind map state (Y.Map 'mindmap' in the note's Yjs document).
 * Every mutation is one Yjs transaction, so edits sync live and undo per user.
 */
export function useMindMap(doc: Y.Doc, title: string, editable: boolean) {
  const nodeMap = doc.getMap<MindNode>(MINDMAP_MAP);
  const edgeMap = doc.getMap<MindEdge>(MINDMAP_EDGES);
  const [nodes, setNodes] = useState<MindNode[]>([]);
  const [edges, setEdges] = useState<MindEdge[]>([]);

  useEffect(() => {
    const read = () => {
      setNodes([...nodeMap.values()]);
      setEdges([...edgeMap.values()]);
    };
    nodeMap.observe(read);
    edgeMap.observe(read);
    read();
    return () => {
      nodeMap.unobserve(read);
      edgeMap.unobserve(read);
    };
  }, [nodeMap, edgeMap]);

  const maps = () => ({ n: nodeMap, e: edgeMap });

  // Per-user undo of local mind map edits (remote edits are never undone).
  const [undo, setUndo] = useState<Y.UndoManager | null>(null);
  useEffect(() => {
    if (!editable) return;
    // captureTimeout 0: every mind-map action is its own undo step. With time-based merging, "add + delete" done in
    // quick succession became one step whose undo is a no-op — and Yjs then popped the step before it (e.g. a whole
    // "Convert notes to mind map"), wiping the map.
    const um = new Y.UndoManager([nodeMap, edgeMap], { captureTimeout: 0 });
    setUndo(um);
    return () => um.destroy();
  }, [nodeMap, edgeMap, editable]);

  // A note without a map still shows its title as the central topic.
  const all = useMemo<MindNode[]>(() => (nodes.some((x) => x.kind === 'root') ? nodes : [{ id: ROOT_ID, parentId: null, kind: 'root', text: title, order: 0 }, ...nodes]), [nodes, title]);

  const put = (list: MindNode[]) => {
    const { n } = maps();
    doc.transact(() => list.forEach((x) => n.set(x.id, x)));
  };
  const get = (id: string) => all.find((x) => x.id === id);
  const children = (id: string) => all.filter((x) => x.parentId === id).sort((a, b) => a.order - b.order);
  const ensureRoot = () => (nodes.some((x) => x.kind === 'root') ? [] : [all.find((x) => x.id === ROOT_ID)!]);

  const actions = {
    addChild(parentId: string, patch: Partial<MindNode> = {}) {
      const parent = get(parentId);
      if (!parent) return null;
      const siblings = children(parentId);
      const isBranch = parent.kind === 'root';
      const rights = siblings.filter((s) => s.side === 'right').length;
      const node: MindNode = {
        id: uid(),
        parentId,
        kind: 'topic',
        text: 'New topic',
        order: siblings.length ? Math.max(...siblings.map((s) => s.order)) + 1 : 0,
        color: isBranch ? BRANCH_COLORS[siblings.length % BRANCH_COLORS.length] : parent.color,
        side: isBranch ? (rights <= siblings.length - rights ? 'right' : 'left') : parent.side,
        ...patch,
      };
      put([...ensureRoot(), node]);
      return node.id;
    },
    addSibling(id: string) {
      const node = get(id);
      if (!node?.parentId) return this.addChild(ROOT_ID);
      const { n } = maps();
      const later = children(node.parentId).filter((s) => s.order > node.order);
      const created: MindNode = { id: uid(), parentId: node.parentId, kind: 'topic', text: 'New topic', order: node.order + 1, color: node.color, side: node.side };
      doc.transact(() => {
        later.forEach((s) => n.set(s.id, { ...s, order: s.order + 1 }));
        n.set(created.id, created);
      });
      return created.id;
    },
    update(id: string, patch: Partial<MindNode>) {
      const node = get(id);
      if (!node) return;
      const next = { ...node, ...patch };
      // Recolouring a branch recolours its subtree.
      if (patch.color && node.kind !== 'root') {
        const sub: MindNode[] = [];
        const walk = (pid: string) => children(pid).forEach((c) => (sub.push({ ...c, color: patch.color }), walk(c.id)));
        walk(id);
        put([...ensureRoot(), next, ...sub]);
      } else put([...ensureRoot(), next]);
    },
    remove(id: string) {
      if (id === ROOT_ID) return;
      const { n, e } = maps();
      const doomed = new Set<string>();
      const walk = (x: string) => {
        doomed.add(x);
        all.filter((c) => c.parentId === x).forEach((c) => walk(c.id));
      };
      walk(id);
      doc.transact(() => {
        doomed.forEach((x) => n.delete(x));
        [...e.values()].filter((ed) => doomed.has(ed.from) || doomed.has(ed.to)).forEach((ed) => e.delete(ed.id));
      });
    },
    addSticky(x: number, y: number, text = 'New note') {
      const id = uid();
      put([...ensureRoot(), { id, parentId: null, kind: 'sticky', text, color: '#fef08a', order: 0, x, y }]);
      return id;
    },
    addEdge(from: string, to: string) {
      if (from === to) return;
      const { e } = maps();
      if ([...e.values()].some((x) => x.from === from && x.to === to)) return;
      const id = uid();
      doc.transact(() => e.set(id, { id, from, to }));
    },
    removeEdge(id: string) {
      const { e } = maps();
      doc.transact(() => e.delete(id));
    },
    /** "Convert notes to mind map": rebuild the tree from the note, keeping sticky notes and free arrows. */
    convertFrom(noteTitle: string, json: JSONContent) {
      const { n, e } = maps();
      const fresh = notesToMindMap(noteTitle, json, uid);
      const keep = new Set([...n.values()].filter((x) => x.kind === 'sticky').map((x) => x.id));
      doc.transact(() => {
        [...n.keys()].filter((k) => !keep.has(k)).forEach((k) => n.delete(k));
        [...e.values()].filter((x) => !keep.has(x.from) || !keep.has(x.to)).forEach((x) => e.delete(x.id));
        fresh.forEach((x) => n.set(x.id, x));
      });
    },
    undo: () => undo?.undo(),
    redo: () => undo?.redo(),
  };

  return { nodes: all, edges, hasMap: nodes.length > 0, actions, canUndo: !!undo };
}

export type MindMapActions = ReturnType<typeof useMindMap>['actions'];
