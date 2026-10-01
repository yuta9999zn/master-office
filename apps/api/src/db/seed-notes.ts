import { TiptapTransformer } from '@hocuspocus/transformer';
import { COLLAB_FIELD, docExtensions, linksOf, MINDMAP_MAP, notesToMindMap, toPlainText, type JSONContent, type MindNode } from '@workos/doc-model';
import * as Y from 'yjs';

// Seed notes mirroring the "Notes & Mind Map" reference screen.

const t = (text: string, ...marks: string[]): JSONContent => ({ type: 'text', text, ...(marks.length ? { marks: marks.map((type) => ({ type })) } : {}) });
const p = (...content: (JSONContent | string)[]): JSONContent => ({ type: 'paragraph', content: content.map((c) => (typeof c === 'string' ? t(c) : c)) });
const h = (level: number, text: string): JSONContent => ({ type: 'heading', attrs: { level }, content: [t(text)] });
const ul = (...items: string[]): JSONContent => ({ type: 'bulletList', content: items.map((i) => ({ type: 'listItem', content: [p(i)] })) });
const status = (label: string, color: string): JSONContent => ({ type: 'status', attrs: { label, color } });
const link = (r: { id: string; name: string; type: string }): JSONContent => ({ type: 'resourceLink', attrs: r });

export interface SeedRef {
  id: string;
  name: string;
  type: string;
}

export function q4StrategyNote(refs: { brandPdf: SeedRef; marketingPlan: SeedRef; roadmap: SeedRef }, people: Record<'hana' | 'fujita' | 'mika' | 'ken', string>): JSONContent {
  const task = (text: string, checked: boolean, assignee: string, due: string): JSONContent => ({
    type: 'taskItem',
    attrs: { checked, assignee, due },
    content: [p(text)],
  });
  const row = (cells: (JSONContent | string)[], header = false): JSONContent => ({
    type: 'tableRow',
    content: cells.map((c) => ({ type: header ? 'tableHeader' : 'tableCell', content: [typeof c === 'string' ? p(c) : p(c)] })),
  });
  return {
    type: 'doc',
    content: [
      { type: 'callout', attrs: { tone: 'info' }, content: [p(t('Q4 Focus', 'bold')), p('Build a sustainable growth engine through product innovation, brand awareness, and operational excellence.')] },
      h(2, '1. Objectives'),
      ul('Increase revenue by 30% in Q4', 'Launch 2 major product updates', 'Strengthen brand presence in key markets', 'Improve operational efficiency'),
      h(2, '2. Key Initiatives'),
      {
        type: 'taskList',
        content: [
          task('Launch new marketing campaign', true, people.hana, '2026-10-15'),
          task('Release product v2.0', false, people.fujita, '2026-10-30'),
          task('Expand to Southeast Asia market', false, people.mika, '2026-11-15'),
          task('Optimize internal processes', false, people.ken, '2026-12-01'),
        ],
      },
      h(2, '3. Market Analysis'),
      p('The market shows strong demand for collaborative productivity tools. Our main opportunities lie in SMB and enterprise segments, especially in Southeast Asia.'),
      { type: 'resourceEmbed', attrs: refs.brandPdf },
      h(2, '4. Key Metrics'),
      {
        type: 'table',
        content: [
          row(['Metric', 'Q3 2026', 'Target (Q4)', 'Status'], true),
          row(['Revenue', '$1.2M', '$1.6M (+30%)', status('On track', 'green')]),
          row(['New Users', '120K', '200K (+67%)', status('On track', 'green')]),
          row(['Conversion Rate', '2.8%', '4.0% (+43%)', status('At risk', 'amber')]),
          row(['Customer Satisfaction', '4.2/5', '4.5/5', status('On track', 'green')]),
        ],
      },
      h(2, '5. Related'),
      p('See ', link(refs.marketingPlan), ' and ', link(refs.roadmap), ' for details.'),
    ],
  };
}

export function simpleNote(title: string, lines: string[], links: SeedRef[] = []): JSONContent {
  return {
    type: 'doc',
    content: [
      h(2, title),
      ul(...lines),
      ...(links.length ? [p('Related: ', ...links.flatMap((l, i) => (i ? [t(', '), link(l)] : [link(l)])))] : []),
    ],
  };
}

/** Note state = body + mind map, in one Yjs document (one realtime session for both views). */
export function seedNoteState(title: string, json: JSONContent, stickies: { text: string; color: string; x: number; y: number }[] = []) {
  const doc = TiptapTransformer.toYdoc(json, COLLAB_FIELD, docExtensions());
  let n = 0;
  const nodes: MindNode[] = notesToMindMap(title, json, () => `n${++n}`);
  stickies.forEach((s, i) => nodes.push({ id: `s${i + 1}`, parentId: null, kind: 'sticky', text: s.text, color: s.color, order: i, x: s.x, y: s.y }));
  const nodeMap = doc.getMap(MINDMAP_MAP);
  for (const node of nodes) nodeMap.set(node.id, node);
  return { state: Buffer.from(Y.encodeStateAsUpdate(doc)), text: toPlainText(json), links: linksOf(json) };
}
