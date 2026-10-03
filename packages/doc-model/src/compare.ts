// Compare documents (Google Docs: Tools → Compare documents). The result is the compared document written as
// suggestions against the base: text only in the base is a suggested deletion, text only in the compared document a
// suggested insertion — so the differences can be reviewed, accepted or rejected. docs/ARCHITECTURE.md §41.
import type { JSONContent } from '@tiptap/core';

export interface CompareAuthor {
  authorId: string;
  authorName: string;
  color?: string;
}

const blockText = (n: JSONContent): string => {
  if (n.type === 'text') return n.text ?? '';
  if (n.type === 'hardBreak') return '\n';
  return (n.content ?? []).map(blockText).join(n.type === 'paragraph' || n.type === 'heading' ? '' : '\n');
};
const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
const isTextblock = (n: JSONContent) => n.type === 'paragraph' || n.type === 'heading';

/** Longest common subsequence alignment of two lists (equal by key); returns matched index pairs. */
function lcs<T>(a: T[], b: T[], key: (x: T) => string): [number, number][] {
  const n = a.length;
  const m = b.length;
  if (n * m > 4_000_000) return []; // too big to align: treated as all changed
  const ka = a.map(key);
  const kb = b.map(key);
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = ka[i] === kb[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: [number, number][] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (ka[i] === kb[j]) out.push([i++, j++]);
    else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  return out;
}

export function compareDocuments(base: JSONContent, other: JSONContent, author: CompareAuthor, at = new Date().toISOString()): JSONContent {
  let seq = 0;
  const attrs = () => ({ id: `cmp-${Date.now().toString(36)}-${seq++}`, authorId: author.authorId, authorName: author.authorName, color: author.color ?? '#7c3aed', at });
  const mark = (kind: 'insertion' | 'deletion', n: JSONContent): JSONContent => {
    if (n.type === 'text') return { ...n, marks: [...(n.marks ?? []).filter((m) => m.type !== 'insertion' && m.type !== 'deletion'), { type: kind, attrs: attrs() }] };
    return n.content ? { ...n, content: n.content.map((c) => mark(kind, c)) } : n;
  };
  const tokens = (s: string) => s.match(/\s+|[^\s]+/g) ?? [];
  /** Word-level diff of two text blocks; keeps the compared block's type and attributes. */
  const diffBlock = (a: JSONContent, b: JSONContent): JSONContent => {
    const ta = tokens(blockText(a));
    const tb = tokens(blockText(b));
    const pairs = lcs(ta, tb, (x) => x);
    const out: JSONContent[] = [];
    const push = (text: string, kind?: 'insertion' | 'deletion') => {
      if (!text) return;
      const last = out[out.length - 1];
      const lastKind = last?.marks?.find((m) => m.type === 'insertion' || m.type === 'deletion')?.type;
      if (last && lastKind === kind) last.text += text;
      else out.push({ type: 'text', text, ...(kind ? { marks: [{ type: kind, attrs: attrs() }] } : {}) });
    };
    let i = 0;
    let j = 0;
    for (const [pi, pj] of [...pairs, [ta.length, tb.length] as [number, number]]) {
      push(ta.slice(i, pi).join(''), 'deletion');
      push(tb.slice(j, pj).join(''), 'insertion');
      if (pi < ta.length) push(ta[pi]);
      i = pi + 1;
      j = pj + 1;
    }
    return { type: b.type, ...(b.attrs ? { attrs: b.attrs } : {}), ...(out.length ? { content: out } : {}) };
  };

  /** Edited rather than replaced: at least 40 % of the words are shared (else word-by-word output is noise). */
  const similar = (a: JSONContent, b: JSONContent) => {
    const wa = blockText(a).split(/\s+/).filter(Boolean);
    const wb = blockText(b).split(/\s+/).filter(Boolean);
    if (!wa.length || !wb.length) return false;
    return lcs(wa, wb, (x) => x).length / Math.max(wa.length, wb.length) >= 0.4;
  };

  /** Blocks that hold other blocks (lists, list items, quotes, callouts, columns…): compared child by child. */
  const isContainer = (n: JSONContent) => !!n.content?.length && n.content.every((c) => c.type !== 'text' && c.type !== 'hardBreak') && !isTextblock(n) && n.type !== 'table';
  const key = (n: JSONContent) => `${n.type}|${norm(blockText(n))}|${n.type === 'heading' ? n.attrs?.level : ''}`;

  const compareBlocks = (A: JSONContent[], B: JSONContent[]): JSONContent[] => {
    const out: JSONContent[] = [];
    const matches = lcs(A, B, key);
    let i = 0;
    let j = 0;
    for (const [mi, mj] of [...matches, [A.length, B.length] as [number, number]]) {
      // Unmatched runs between two matches: pair blocks of the same kind (edited), the rest is deleted / added.
      const da = A.slice(i, mi);
      const db = B.slice(j, mj);
      const k = Math.min(da.length, db.length);
      for (let x = 0; x < k; x++) {
        const a = da[x];
        const b = db[x];
        if (isTextblock(a) && isTextblock(b) && similar(a, b)) out.push(diffBlock(a, b));
        else if (a.type === b.type && isContainer(a) && isContainer(b)) out.push({ ...b, content: compareBlocks(a.content ?? [], b.content ?? []) });
        else out.push(mark('deletion', a), mark('insertion', b));
      }
      for (const n of da.slice(k)) out.push(mark('deletion', n));
      for (const n of db.slice(k)) out.push(mark('insertion', n));
      if (mi < A.length) out.push(B[mj]);
      i = mi + 1;
      j = mj + 1;
    }
    return out;
  };

  const content = compareBlocks(base.content ?? [], other.content ?? []);
  return { type: 'doc', content };
}

/** Counts of suggested insertions / deletions (for the result summary). */
export function changeCount(doc: JSONContent): { insertions: number; deletions: number } {
  const ids = { insertion: new Set<string>(), deletion: new Set<string>() };
  const walk = (n: JSONContent) => {
    for (const m of n.marks ?? []) if (m.type === 'insertion' || m.type === 'deletion') ids[m.type].add(String(m.attrs?.id));
    n.content?.forEach(walk);
  };
  walk(doc);
  return { insertions: ids.insertion.size, deletions: ids.deletion.size };
}
