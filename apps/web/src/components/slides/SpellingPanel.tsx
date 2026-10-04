'use client';

import { useQueryClient } from '@tanstack/react-query';
import { grammarIssues, isCheckableText, spellingCandidates, type TextIssue } from '@workos/doc-model';
import { slideTitle, type PlainSlide, type TextNode } from '@workos/slide-model';
import { Check, Loader2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { usePersonalDictionary } from '../docs/spelling';
import { Button, cn } from '../ui/primitives';
import type { DeckStore } from './deck-store';

// Tools ▸ Spelling and grammar in Slides (Ctrl+Alt+X): the whole deck at once, like Google Slides. Same rules
// (doc-model) and dictionary (server, personal dictionary) as Docs. docs/ARCHITECTURE.md §54.

interface DeckIssue extends TextIssue {
  key: string;
  slideId: string;
  slideNo: number;
  elId: string;
  para: number; // paragraph index within the text box (document order)
}

/** Paragraph texts of a text box in document order (hard break = one character), as the store counts them. */
function paragraphs(doc: TextNode | null | undefined): string[] {
  const out: string[] = [];
  const walk = (n: TextNode) => {
    if (n.type === 'paragraph' || n.type === 'heading') {
      out.push((n.content ?? []).map((c) => (c.type === 'text' ? c.text ?? '' : c.type === 'hardBreak' ? '\n' : '￼')).join(''));
      return;
    }
    (n.content ?? []).forEach(walk);
  };
  if (doc) walk(doc);
  return out;
}

export function SpellingPanel({ store, slides, editable, onGo }: { store: DeckStore; slides: PlainSlide[]; editable: boolean; onGo: (slideId: string, elId: string) => void }) {
  const qc = useQueryClient();
  const { data: personal } = usePersonalDictionary(true);
  const cache = useRef(new Map<string, string[] | null>());
  const ignored = useRef(new Set<string>());
  const [issues, setIssues] = useState<DeckIssue[] | null>(null);
  const [checking, setChecking] = useState(false);
  const [picked, setPicked] = useState<Record<string, number>>({});

  useEffect(() => {
    let alive = true;
    const t = setTimeout(async () => {
      const found: DeckIssue[] = [];
      const words: { w: string; issue: Omit<DeckIssue, 'kind' | 'rule' | 'message' | 'suggestions'> }[] = [];
      slides.forEach((s, si) => {
        for (const el of s.elements) {
          if (!el.text) continue;
          paragraphs(el.text).forEach((text, p) => {
            if (!isCheckableText(text)) return;
            const base = { slideId: s.id, slideNo: si + 1, elId: el.id, para: p };
            for (const g of grammarIssues(text))
              if (!ignored.current.has(`${g.rule}:${g.text}`)) found.push({ ...g, ...base, key: `${s.id}:${el.id}:${p}:${g.from}:${g.rule}` });
            for (const c of spellingCandidates(text)) words.push({ w: c.word, issue: { ...base, from: c.from, to: c.to, text: text.slice(c.from, c.to), key: `${s.id}:${el.id}:${p}:${c.from}:sp` } });
          });
        }
      });
      const unknown = [...new Set(words.map((x) => x.w).filter((w) => !cache.current.has(w)))];
      if (unknown.length) {
        setChecking(true);
        try {
          const { misspelled } = await api<{ misspelled: Record<string, string[]> }>('/spelling/check', { method: 'POST', json: { words: unknown.slice(0, 5000) } });
          for (const w of unknown) cache.current.set(w, misspelled[w] ?? null);
        } catch {
          /* offline: keep what we had */
        } finally {
          if (alive) setChecking(false);
        }
      }
      const mine = new Set((personal ?? []).map((w) => w.toLowerCase()));
      for (const { w, issue } of words) {
        const s = cache.current.get(w);
        if (!s || mine.has(w.toLowerCase()) || ignored.current.has(w.toLowerCase())) continue;
        found.push({ ...issue, kind: 'spelling', rule: 'spelling', message: 'Spelling', suggestions: s });
      }
      found.sort((a, b) => a.slideNo - b.slideNo || a.elId.localeCompare(b.elId) || a.para - b.para || a.from - b.from);
      if (alive) setIssues(found);
    }, 400);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [slides, personal]);

  const drop = (keep: (i: DeckIssue) => boolean) => setIssues((list) => (list ?? []).filter(keep));
  const accept = (i: DeckIssue, replacement: string) => {
    store.checkpoint();
    if (!store.replaceInParagraph(i.slideId, i.elId, i.para, i.from, i.to, replacement)) toast.error('That text changed meanwhile — check again');
    store.checkpoint();
    drop((x) => x.key !== i.key);
  };
  const ignore = (i: DeckIssue) => {
    ignored.current.add(i.kind === 'spelling' ? i.text.toLowerCase() : `${i.rule}:${i.text}`);
    drop((x) => (i.kind === 'spelling' ? x.kind !== 'spelling' || x.text.toLowerCase() !== i.text.toLowerCase() : x.key !== i.key));
  };
  const addWord = async (word: string) => {
    try {
      qc.setQueryData(['spelling-dictionary'], await api<string[]>('/spelling/dictionary', { method: 'POST', json: { word } }));
      drop((x) => x.kind !== 'spelling' || x.text.toLowerCase() !== word.toLowerCase());
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const titleOf = (id: string) => slideTitle(slides.find((s) => s.id === id)!) || 'Untitled';

  return (
    <div className="p-3 text-[13px]" data-testid="slides-spelling">
      <div className="mb-2 flex items-center gap-2 text-[12px] text-muted">
        {checking || !issues ? <Loader2 size={13} className="animate-spin" /> : null}
        {issues ? `${issues.length} suggestion${issues.length === 1 ? '' : 's'} in this presentation` : 'Checking…'}
      </div>
      {issues && !issues.length && (
        <p className="flex items-center gap-2 text-ink-2">
          <Check size={16} className="text-emerald-600" /> No spelling or grammar suggestions
        </p>
      )}
      <ul className="space-y-2">
        {(issues ?? []).slice(0, 200).map((i) => {
          const pick = picked[i.key] ?? 0;
          const replacement = i.suggestions[pick] ?? '';
          return (
            <li key={i.key} className="rounded-lg border border-line p-2.5" data-testid="slides-spelling-issue">
              <button className="mb-1 block w-full truncate text-left text-[11.5px] text-muted hover:text-brand-600" onClick={() => onGo(i.slideId, i.elId)}>
                Slide {i.slideNo} · {titleOf(i.slideId)}
              </button>
              <div className="text-ink">
                {i.kind === 'spelling' ? (
                  <>
                    <s className="text-red-600">{i.text}</s>
                    {i.suggestions.length ? ' →' : ' — no suggestions'}
                  </>
                ) : (
                  <span>
                    {i.message}: <s className="whitespace-pre text-red-600">“{i.text}”</s>
                    {replacement ? <> → “{replacement}”</> : ' → remove'}
                  </span>
                )}
              </div>
              {i.kind === 'spelling' && i.suggestions.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {i.suggestions.map((s, k) => (
                    <button key={s} onClick={() => setPicked({ ...picked, [i.key]: k })} className={cn('rounded-full border px-2 py-0.5 text-[12px]', k === pick ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-line text-ink-2 hover:bg-hover')}>
                      {s}
                    </button>
                  ))}
                </div>
              )}
              <div className="mt-2 flex items-center gap-1.5">
                {(i.kind === 'grammar' || i.suggestions.length > 0) && (
                  <Button size="sm" variant="primary" disabled={!editable} onClick={() => accept(i, replacement)}>
                    Accept
                  </Button>
                )}
                <Button size="sm" onClick={() => ignore(i)}>
                  Ignore
                </Button>
                {i.kind === 'spelling' && (
                  <button onClick={() => void addWord(i.text)} className="ml-auto text-[12px] font-medium text-brand-600 hover:underline">
                    Add to dictionary
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
