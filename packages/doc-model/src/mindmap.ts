// Mind map model (Phase 2b). Lives in the same Yjs document as the note body, in two top-level maps:
//   Y.Map('mindmap')      id → MindNode
//   Y.Map('mindmapEdges') id → MindEdge
// Top-level maps (not maps nested under a key) so two clients can never race to create the container
// and silently replace each other's map.
import type { JSONContent } from '@tiptap/core';

export const MINDMAP_MAP = 'mindmap';
export const MINDMAP_EDGES = 'mindmapEdges';
export const ROOT_ID = 'root';

export type MindKind = 'root' | 'topic' | 'sticky' | 'link';

export interface MindNode {
  id: string;
  parentId: string | null;
  kind: MindKind;
  text: string;
  /** Sibling order under the parent. */
  order: number;
  color?: string;
  subtitle?: string;
  /** Bullet lines shown in the card attached to a topic ("notes" in the reference screen). */
  notes?: string[];
  /** For link cards: the resource shown (no copy — rendered live from Drive). */
  resourceId?: string;
  resourceType?: string;
  /** Top-level branches choose a side; children inherit it. */
  side?: 'left' | 'right';
  collapsed?: boolean;
  /** Manual position (canvas px). Topics are auto-laid-out unless moved; stickies are always free. */
  x?: number;
  y?: number;
  author?: string;
}

export interface MindEdge {
  id: string;
  from: string;
  to: string;
  label?: string;
}

export const BRANCH_COLORS = ['#16a34a', '#2563eb', '#f59e0b', '#ef4444', '#8b5cf6', '#0ea5e9', '#ec4899', '#14b8a6'];

const textOf = (n: JSONContent): string =>
  n.type === 'text'
    ? n.marks?.some((m) => m.type === 'deletion')
      ? ''
      : n.text ?? ''
    : n.type === 'resourceLink'
      ? String(n.attrs?.name ?? '')
      : n.type === 'mention'
        ? `@${n.attrs?.label ?? ''}`
        : n.type === 'status'
          ? `● ${n.attrs?.label ?? ''}`
          : (n.content ?? []).map(textOf).join('');

/**
 * "Convert notes to mind map": headings become branches (nested by level), paragraphs / bullets / tasks become the
 * branch's note card, embedded or linked resources become link cards.
 */
export function notesToMindMap(title: string, doc: JSONContent | null | undefined, idGen: () => string): MindNode[] {
  const root: MindNode = { id: ROOT_ID, parentId: null, kind: 'root', text: title, order: 0 };
  const nodes: MindNode[] = [root];
  const stack: { level: number; node: MindNode }[] = [];
  const childCount = new Map<string, number>();
  let branch = 0;

  const current = () => stack[stack.length - 1]?.node ?? root;
  const addChild = (parent: MindNode, n: Omit<MindNode, 'order' | 'parentId'>) => {
    const order = childCount.get(parent.id) ?? 0;
    childCount.set(parent.id, order + 1);
    const node: MindNode = { ...n, parentId: parent.id, order };
    if (parent.kind === 'root') {
      node.color = n.color ?? BRANCH_COLORS[branch % BRANCH_COLORS.length];
      node.side = branch % 2 === 0 ? 'right' : 'left';
      branch++;
    } else {
      node.color = n.color ?? parent.color;
      node.side = parent.side;
    }
    nodes.push(node);
    return node;
  };
  const note = (line: string) => {
    const t = line.trim();
    if (!t) return;
    const target = current();
    if (target.kind === 'root') root.subtitle = root.subtitle ? root.subtitle : t.slice(0, 80);
    else (target.notes ??= []).push(t);
  };
  const walk = (n: JSONContent) => {
    switch (n.type) {
      case 'heading': {
        const level = n.attrs?.level ?? 1;
        while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
        const text = textOf(n).replace(/^\s*\d+(\.\d+)*[.)]?\s+/, '').trim() || 'Untitled';
        stack.push({ level, node: addChild(current(), { id: idGen(), kind: 'topic', text }) });
        return;
      }
      case 'resourceEmbed':
        if (n.attrs?.id) addChild(current(), { id: idGen(), kind: 'link', text: String(n.attrs.name ?? 'Linked file'), resourceId: n.attrs.id, resourceType: n.attrs.type });
        return;
      case 'paragraph': {
        for (const c of n.content ?? []) {
          if (c.type === 'resourceLink' && c.attrs?.id) addChild(current(), { id: idGen(), kind: 'link', text: String(c.attrs.name ?? ''), resourceId: c.attrs.id, resourceType: c.attrs.type });
        }
        note(textOf(n));
        return;
      }
      case 'bulletList':
      case 'orderedList':
        for (const li of n.content ?? []) note(textOf(li.content?.[0] ?? {}));
        return;
      case 'taskList':
        for (const ti of n.content ?? []) note(`${ti.attrs?.checked ? '☑' : '☐'} ${textOf(ti.content?.[0] ?? {})}`);
        return;
      case 'table':
      case 'tableOfContents':
      case 'pageBreak':
      case 'horizontalRule':
      case 'codeBlock':
        return;
      default:
        n.content?.forEach(walk);
    }
  };
  doc?.content?.forEach(walk);
  return nodes;
}

/** Children of a node in display order. */
export function childrenOf(nodes: MindNode[], id: string) {
  return nodes.filter((n) => n.parentId === id).sort((a, b) => a.order - b.order);
}

/** Mind map → outline JSON (for export and "Both" view search). */
export function mindMapToOutline(nodes: MindNode[]): JSONContent {
  const root = nodes.find((n) => n.kind === 'root');
  const items = (id: string): JSONContent[] =>
    childrenOf(nodes, id)
      .filter((n) => n.kind !== 'sticky')
      .map((n) => ({
        type: 'listItem',
        content: [
          { type: 'paragraph', content: n.text ? [{ type: 'text', text: n.text }] : [] },
          ...((n.notes?.length || childrenOf(nodes, n.id).length)
            ? [{ type: 'bulletList', content: [...(n.notes ?? []).map((t) => ({ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] })), ...items(n.id)] }]
            : []),
        ],
      }));
  return { type: 'doc', content: root ? [{ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: root.text }] }, { type: 'bulletList', content: items(root.id) }] : [] };
}
