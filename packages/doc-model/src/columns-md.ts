// Columns and Markdown (Google Docs: Format → Columns, "Copy as Markdown", Markdown paste).
// docs/ARCHITECTURE.md §40.
import { mergeAttributes, Node, type JSONContent } from '@tiptap/core';

/** A block laid out in 2 or 3 columns; each column holds ordinary blocks. */
export const Columns = Node.create({
  name: 'columns',
  group: 'block',
  content: 'column{2,3}',
  isolating: true,
  defining: true,
  parseHTML() {
    return [{ tag: 'div[data-columns]' }];
  },
  renderHTML({ HTMLAttributes, node }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-columns': node.childCount, class: 'mo-columns', style: `grid-template-columns:repeat(${node.childCount},minmax(0,1fr))` }), 0];
  },
});

export const Column = Node.create({
  name: 'column',
  content: 'block+',
  isolating: true,
  parseHTML() {
    return [{ tag: 'div[data-column]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-column': '', class: 'mo-column' }), 0];
  },
});

/** A columns block with `count` columns, the first holding `first` (or an empty paragraph). */
export const columnsBlock = (count: 2 | 3, first?: JSONContent[]): JSONContent => ({
  type: 'columns',
  content: Array.from({ length: count }, (_, i) => ({ type: 'column', content: i === 0 && first?.length ? first : [{ type: 'paragraph' }] })),
});

// ── Markdown out ────────────────────────────────────────────────────────────

const mdEsc = (s: string) => s.replace(/([\\`*_[\]])/g, '\\$1');

function inlineMd(nodes: JSONContent[] | undefined): string {
  return (nodes ?? [])
    .map((n) => {
      if (n.type === 'hardBreak') return '  \n';
      if (n.type === 'mention') return `@${n.attrs?.label ?? ''}`;
      if (n.type === 'image') return `![${n.attrs?.alt ?? ''}](${n.attrs?.src ?? ''})`;
      if (n.type === 'equation') return `$${n.attrs?.latex ?? ''}$`;
      if (n.type === 'dateChip' || n.type === 'dropdownChip' || n.type === 'placeChip' || n.type === 'status' || n.type === 'resourceLink') return String(n.attrs?.value ?? n.attrs?.name ?? n.attrs?.label ?? n.attrs?.date ?? '');
      if (n.type !== 'text') return '';
      if (n.marks?.some((m) => m.type === 'deletion')) return '';
      let t = n.marks?.some((m) => m.type === 'code') ? `\`${n.text ?? ''}\`` : mdEsc(n.text ?? '');
      for (const m of n.marks ?? []) {
        if (m.type === 'bold') t = `**${t}**`;
        else if (m.type === 'italic') t = `*${t}*`;
        else if (m.type === 'strike') t = `~~${t}~~`;
        else if (m.type === 'link') t = `[${t}](${m.attrs?.href ?? ''})`;
      }
      return t;
    })
    .join('');
}

/** Document (or a slice of it) → GitHub-flavoured Markdown. */
export function toMarkdown(doc: JSONContent | null | undefined): string {
  const out: string[] = [];
  const block = (n: JSONContent, indent = ''): string => {
    switch (n.type) {
      case 'paragraph':
        return indent + inlineMd(n.content);
      case 'heading':
        return `${'#'.repeat(Math.min(6, Number(n.attrs?.level ?? 1)))} ${inlineMd(n.content)}`;
      case 'bulletList':
      case 'orderedList':
      case 'taskList':
        return (n.content ?? [])
          .map((li, i) => {
            const marker = n.type === 'orderedList' ? `${Number(n.attrs?.start ?? 1) + i}.` : n.type === 'taskList' ? `- [${li.attrs?.checked ? 'x' : ' '}]` : '-';
            const [first, ...rest] = li.content ?? [];
            const head = `${indent}${marker} ${first ? block(first).trim() : ''}`;
            const tail = rest.map((c) => block(c, `${indent}  `)).join('\n');
            return tail ? `${head}\n${tail}` : head;
          })
          .join('\n');
      case 'blockquote':
      case 'callout':
        return (n.content ?? []).map((c) => `> ${block(c)}`).join('\n>\n');
      case 'codeBlock':
        return `\`\`\`${n.attrs?.language ?? ''}\n${(n.content ?? []).map((c) => c.text ?? '').join('')}\n\`\`\``;
      case 'horizontalRule':
      case 'pageBreak':
        return '---';
      case 'image':
        return inlineMd([n]);
      case 'table': {
        const rows = (n.content ?? []).map((r) => (r.content ?? []).map((c) => (c.content ?? []).map((p) => inlineMd(p.content)).join(' ').replace(/\|/g, '\\|')));
        if (!rows.length) return '';
        const head = `| ${rows[0].join(' | ')} |`;
        const sep = `| ${rows[0].map(() => '---').join(' | ')} |`;
        return [head, sep, ...rows.slice(1).map((r) => `| ${r.join(' | ')} |`)].join('\n');
      }
      case 'columns':
        return (n.content ?? []).map((col) => (col.content ?? []).map((c) => block(c)).join('\n\n')).join('\n\n');
      default:
        return (n.content ?? []).map((c) => block(c, indent)).join('\n\n');
    }
  };
  for (const n of doc?.content ?? []) {
    const md = block(n);
    if (md.trim()) out.push(md);
  }
  return out.join('\n\n') + '\n';
}

// ── Markdown in ─────────────────────────────────────────────────────────────

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function inlineHtml(s: string): string {
  // Code spans first, so their content is not formatted.
  const codes: string[] = [];
  let t = s.replace(/`([^`]+)`/g, (_m, c: string) => `\u0000${codes.push(c) - 1}\u0000`);
  t = esc(t)
    .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, '<img alt="$1" src="$2">')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>')
    .replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, (_m, a, b) => `<strong>${a ?? b}</strong>`)
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
    .replace(/(^|[^_\w])_([^_\s][^_]*)_/g, '$1<em>$2</em>')
    .replace(/~~([^~]+)~~/g, '<s>$1</s>')
    .replace(/\\([\\`*_[\]])/g, '$1');
  return t.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => `<code>${esc(codes[Number(i)])}</code>`);
}

/** Markdown → HTML the editor's schema understands (headings, lists, tasks, quotes, code, tables, rules). */
export function markdownToHtml(md: string): string {
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  let i = 0;
  const isTableSep = (l: string) => /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(l);
  const cells = (l: string) => l.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map((c) => inlineHtml(c.trim().replace(/\\\|/g, '|')));
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    const fence = /^```(\w*)/.exec(line);
    if (fence) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) body.push(lines[i++]);
      i++;
      out.push(`<pre><code${fence[1] ? ` class="language-${fence[1]}"` : ''}>${esc(body.join('\n'))}</code></pre>`);
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      out.push(`<h${Math.min(4, h[1].length)}>${inlineHtml(h[2].replace(/\s+#+\s*$/, ''))}</h${Math.min(4, h[1].length)}>`);
      i++;
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      out.push('<hr>');
      i++;
      continue;
    }
    if (line.includes('|') && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const head = cells(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) rows.push(cells(lines[i++]));
      out.push(`<table><tbody><tr>${head.map((c) => `<th><p>${c}</p></th>`).join('')}</tr>${rows.map((r) => `<tr>${head.map((_, j) => `<td><p>${r[j] ?? ''}</p></td>`).join('')}</tr>`).join('')}</tbody></table>`);
      continue;
    }
    if (/^>\s?/.test(line)) {
      const body: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) body.push(lines[i++].replace(/^>\s?/, ''));
      out.push(`<blockquote>${markdownToHtml(body.join('\n'))}</blockquote>`);
      continue;
    }
    const li = /^(\s*)([-*+]|\d+[.)])\s+(\[[ xX]\]\s+)?(.*)$/;
    if (li.test(line)) {
      const first = li.exec(line)!;
      const ordered = /\d/.test(first[2]);
      const task = !!first[3];
      const items: string[] = [];
      while (i < lines.length && li.test(lines[i])) {
        const m = li.exec(lines[i])!;
        i++;
        if (task) items.push(`<li data-type="taskItem" data-checked="${/x/i.test(m[3] ?? '')}"><p>${inlineHtml(m[4])}</p></li>`);
        else items.push(`<li><p>${inlineHtml(m[4])}</p></li>`);
      }
      out.push(task ? `<ul data-type="taskList">${items.join('')}</ul>` : ordered ? `<ol${Number.parseInt(first[2], 10) !== 1 ? ` start="${Number.parseInt(first[2], 10)}"` : ''}>${items.join('')}</ol>` : `<ul>${items.join('')}</ul>`);
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|```|>\s?|\s*([-*+]|\d+[.)])\s+)/.test(lines[i]) && !(lines[i].includes('|') && i + 1 < lines.length && isTableSep(lines[i + 1]))) para.push(lines[i++]);
    out.push(`<p>${para.map((l) => inlineHtml(l.replace(/\s{2,}$/, ''))).join('<br>')}</p>`);
  }
  return out.join('');
}

/** Does plain text look like Markdown (so pasting it should be converted)? */
export function looksLikeMarkdown(text: string): boolean {
  const lines = text.split(/\r?\n/);
  if (lines.length < 2 && !/^#{1,6}\s/.test(text)) return false;
  let hits = 0;
  for (const l of lines) if (/^(#{1,6}\s|\s*[-*+]\s+\S|\s*\d+[.)]\s+\S|>\s|```|\|.*\|)/.test(l) || /\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\)/.test(l)) hits++;
  return hits >= 2 || /^#{1,6}\s/m.test(text);
}
