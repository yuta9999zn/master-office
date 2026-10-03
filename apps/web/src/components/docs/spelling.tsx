'use client';

import { Extension } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { useEditorState, type Editor } from '@tiptap/react';
import { grammarIssues, isCheckableText, spellingCandidates, type TextIssue } from '@workos/doc-model';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronDown, ChevronUp, Loader2, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { Button, cn, Dialog } from '../ui/primitives';

// Spelling & grammar (Google Docs: Tools → Spelling and grammar). docs/ARCHITECTURE.md §45.
// The editor flattens each paragraph, doc-model finds grammar issues and candidate words, the server's Hunspell
// dictionary says which words are misspelled; issues become underlines (a plugin) and the suggestion card.

/** An issue at document positions. */
export type Issue = TextIssue;

interface SpellState {
  issues: Issue[];
  current: number;
  show: boolean;
  decorations: DecorationSet;
}
type SpellMeta = Partial<Pick<SpellState, 'issues' | 'current' | 'show'>>;

export const spellKey = new PluginKey<SpellState>('mo-spell');
export const spellState = (s: EditorState) => spellKey.getState(s);

const FLAT_ATOM = '￼';
/** A paragraph's text with inline atoms as one char each, so offsets map 1:1 to positions inside the block. */
function flatten(node: PMNode) {
  let text = '';
  node.forEach((child) => {
    if (!child.isText) text += FLAT_ATOM;
    else if (child.marks.some((m) => m.type.name === 'deletion' || m.type.name === 'code')) text += '�'.repeat(child.text!.length);
    else text += child.text;
  });
  return text;
}

function decorate(doc: PMNode, s: Omit<SpellState, 'decorations'>) {
  if (!s.show) return DecorationSet.empty;
  return DecorationSet.create(
    doc,
    s.issues.map((i, k) => Decoration.inline(i.from, i.to, { class: cn(i.kind === 'spelling' ? 'mo-spell' : 'mo-grammar', k === s.current && 'current'), 'data-issue': String(k) })),
  );
}

export const Spellcheck = Extension.create<{ onOpen: () => void }>({
  name: 'spellcheck',
  addOptions: () => ({ onOpen: () => undefined }),
  addProseMirrorPlugins() {
    const ext = this;
    return [
      new Plugin<SpellState>({
        key: spellKey,
        state: {
          init: () => ({ issues: [], current: 0, show: false, decorations: DecorationSet.empty }),
          apply(tr, prev, _old, next) {
            const meta = tr.getMeta(spellKey) as SpellMeta | undefined;
            if (!meta && !tr.docChanged) return prev;
            let issues = meta?.issues ?? prev.issues;
            // Edits move issues along; an issue whose text was touched is dropped until the next scan.
            if (tr.docChanged && !meta?.issues)
              issues = issues.flatMap((i) => {
                const a = tr.mapping.mapResult(i.from, 1);
                const b = tr.mapping.mapResult(i.to, -1);
                if (a.deleted || b.deleted || b.pos <= a.pos || next.doc.textBetween(a.pos, b.pos, undefined, FLAT_ATOM) !== i.text) return [];
                return [{ ...i, from: a.pos, to: b.pos }];
              });
            const s = { issues, show: meta?.show ?? prev.show, current: Math.max(0, Math.min(meta?.current ?? prev.current, issues.length - 1)) };
            return { ...s, decorations: decorate(next.doc, s) };
          },
        },
        props: {
          decorations: (state) => spellKey.getState(state)?.decorations,
          // Our underlines replace the browser's, so a word is never underlined twice.
          attributes: (state): Record<string, string> => ({ spellcheck: spellKey.getState(state)?.show ? 'false' : 'true' }),
          // Clicking an underlined word opens the card on it (the caret still moves there).
          handleClick: (view, pos) => {
            const s = spellKey.getState(view.state);
            if (!s?.show) return false;
            const k = s.issues.findIndex((i) => i.from <= pos && pos <= i.to);
            if (k < 0) return false;
            view.dispatch(view.state.tr.setMeta(spellKey, { current: k }));
            ext.options.onOpen();
            return false;
          },
        },
      }),
    ];
  },
});

const UNDERLINE_KEY = 'mo:spell-underline';
export function underlinePref() {
  try {
    return localStorage.getItem(UNDERLINE_KEY) !== '0';
  } catch {
    return true;
  }
}
export function setUnderlinePref(on: boolean) {
  try {
    localStorage.setItem(UNDERLINE_KEY, on ? '1' : '0');
  } catch {
    /* private mode */
  }
}

export function usePersonalDictionary(enabled = true) {
  return useQuery({ queryKey: ['spelling-dictionary'], queryFn: () => api<string[]>('/spelling/dictionary'), enabled, staleTime: 60_000 });
}

/**
 * Scans the document (on open and 600 ms after each edit) while `enabled`; returns the issues and their actions.
 * Word lookups are cached for the session, so a rescan only asks the server about new words.
 */
export function useSpellcheck(editor: Editor | null, { enabled, show }: { enabled: boolean; show: boolean }) {
  const qc = useQueryClient();
  const { data: personal } = usePersonalDictionary(enabled);
  const cache = useRef(new Map<string, string[] | null>());
  const ignored = useRef(new Set<string>());
  const personalRef = useRef(new Set<string>());
  personalRef.current = new Set((personal ?? []).map((w) => w.toLowerCase()));
  const [checking, setChecking] = useState(false);
  const run = useRef(0);

  const scan = useCallback(async () => {
    if (!editor || editor.isDestroyed) return;
    const id = ++run.current;
    const doc = editor.state.doc;
    const found: Issue[] = [];
    const words: { from: number; to: number; word: string; text: string }[] = [];
    doc.descendants((node, pos) => {
      if (!node.isTextblock) return true;
      if (node.type.name === 'codeBlock') return false;
      const text = flatten(node);
      if (!isCheckableText(text)) return false;
      for (const g of grammarIssues(text)) if (!ignored.current.has(`${g.rule}:${g.text}`)) found.push({ ...g, from: pos + 1 + g.from, to: pos + 1 + g.to });
      for (const w of spellingCandidates(text)) words.push({ from: pos + 1 + w.from, to: pos + 1 + w.to, word: w.word, text: text.slice(w.from, w.to) });
      return false;
    });
    const unknown = [...new Set(words.map((w) => w.word).filter((w) => !cache.current.has(w)))];
    if (unknown.length) {
      setChecking(true);
      try {
        for (let i = 0; i < unknown.length; i += 2000) {
          const batch = unknown.slice(i, i + 2000);
          const { misspelled } = await api<{ misspelled: Record<string, string[]> }>('/spelling/check', { method: 'POST', json: { words: batch } });
          for (const w of batch) cache.current.set(w, misspelled[w] ?? null);
        }
      } catch {
        return; // offline: keep the previous underlines
      } finally {
        if (id === run.current) setChecking(false);
      }
    }
    if (id !== run.current || editor.isDestroyed || editor.state.doc !== doc) return; // a newer scan or an edit won
    for (const w of words) {
      const s = cache.current.get(w.word);
      if (!s || ignored.current.has(w.word.toLowerCase()) || personalRef.current.has(w.word.toLowerCase())) continue;
      found.push({ kind: 'spelling', rule: 'spelling', from: w.from, to: w.to, text: w.text, message: 'Spelling', suggestions: s });
    }
    found.sort((a, b) => a.from - b.from);
    editor.view.dispatch(editor.state.tr.setMeta(spellKey, { issues: found }).setMeta('addToHistory', false));
  }, [editor]);

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    editor.view.dispatch(editor.state.tr.setMeta(spellKey, enabled ? { show } : { show: false, issues: [] }));
    if (!enabled) return;
    void scan();
    let t: ReturnType<typeof setTimeout> | undefined;
    const onUpdate = () => {
      clearTimeout(t);
      t = setTimeout(() => void scan(), 600);
    };
    editor.on('update', onUpdate);
    return () => {
      clearTimeout(t);
      editor.off('update', onUpdate);
    };
  }, [editor, enabled, show, scan, personal]);

  const s = useEditorState({ editor, selector: ({ editor: e }) => (e && !e.isDestroyed ? spellState(e.state) : null) });
  const issues = s?.issues ?? [];
  const current = s?.current ?? 0;

  const setCurrent = (k: number) => {
    if (!editor || !issues.length) return;
    const i = (k + issues.length) % issues.length;
    const issue = issues[i];
    editor.chain().setMeta(spellKey, { current: i }).setTextSelection({ from: issue.from, to: issue.to }).scrollIntoView().run();
  };
  const drop = (keep: (i: Issue) => boolean) => editor?.view.dispatch(editor.state.tr.setMeta(spellKey, { issues: issues.filter(keep) }));
  return {
    issues,
    current,
    checking,
    setCurrent,
    accept: (issue: Issue, replacement: string) => {
      editor
        ?.chain()
        .command(({ tr }) => {
          if (replacement) tr.insertText(replacement, issue.from, issue.to);
          else tr.delete(issue.from, issue.to);
          return true;
        })
        .run();
    },
    ignore: (issue: Issue) => {
      if (issue.kind === 'spelling') ignored.current.add(issue.text.replace(/’/g, "'").toLowerCase());
      else ignored.current.add(`${issue.rule}:${issue.text}`);
      drop((i) => (issue.kind === 'spelling' ? i.kind !== 'spelling' || i.text.toLowerCase() !== issue.text.toLowerCase() : i !== issue));
    },
    addToDictionary: async (word: string) => {
      try {
        const words = await api<string[]>('/spelling/dictionary', { method: 'POST', json: { word: word.replace(/’/g, "'") } });
        qc.setQueryData(['spelling-dictionary'], words);
        drop((i) => i.kind !== 'spelling' || i.text.toLowerCase() !== word.toLowerCase());
        toast.success(`“${word}” added to your dictionary`);
      } catch (e) {
        toast.error((e as Error).message);
      }
    },
  };
}

type Spell = ReturnType<typeof useSpellcheck>;

/** The floating suggestion card (Google Docs' "Spelling and grammar" box): one issue at a time. */
export function SpellingCard({ spell, onClose }: { spell: Spell; onClose: () => void }) {
  const { issues, current, checking } = spell;
  const issue = issues[current];
  const [pick, setPick] = useState(0);
  useEffect(() => setPick(0), [issue?.from, issue?.text]);
  // Opening the card selects the first issue.
  const opened = useRef(false);
  useEffect(() => {
    if (!opened.current && issues.length) {
      opened.current = true;
      spell.setCurrent(current);
    }
  }, [issues.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const replacement = issue?.suggestions[pick] ?? '';
  return (
    <div className="absolute right-4 top-2 z-20 w-[340px] rounded-xl border border-line bg-surface p-3 shadow-[var(--shadow-pop)]" role="dialog" aria-label="Spelling and grammar" data-testid="spelling-card">
      <div className="flex items-center gap-1">
        <span className="text-[13px] font-semibold text-ink">Spelling and grammar</span>
        {checking && <Loader2 size={13} className="ml-1 animate-spin text-muted" aria-label="Checking" />}
        <span className="ml-auto text-[12px] text-muted" data-testid="spelling-count">
          {issues.length ? `${current + 1} of ${issues.length}` : ''}
        </span>
        <button onClick={() => spell.setCurrent(current - 1)} disabled={issues.length < 2} className="rounded p-1 text-muted hover:bg-hover disabled:opacity-30" aria-label="Previous suggestion">
          <ChevronUp size={16} />
        </button>
        <button onClick={() => spell.setCurrent(current + 1)} disabled={issues.length < 2} className="rounded p-1 text-muted hover:bg-hover disabled:opacity-30" aria-label="Next suggestion">
          <ChevronDown size={16} />
        </button>
        <button onClick={onClose} className="rounded p-1 text-muted hover:bg-hover" aria-label="Close spelling and grammar">
          <X size={16} />
        </button>
      </div>
      {!issue ? (
        <p className="mt-3 flex items-center gap-2 text-[13px] text-ink-2">
          {checking ? (
            'Checking…'
          ) : (
            <>
              <Check size={16} className="text-emerald-600" /> No spelling or grammar suggestions
            </>
          )}
        </p>
      ) : (
        <div className="mt-2 text-[13px]">
          <div className="text-[12px] text-muted">{issue.kind === 'spelling' ? 'Spelling' : issue.message}</div>
          <div className="mt-1 text-ink">
            {issue.kind === 'spelling' ? (
              issue.suggestions.length ? (
                <>
                  Change <s className="text-red-600">{issue.text}</s> to
                </>
              ) : (
                <>
                  <s className="text-red-600">{issue.text}</s> — no suggestions
                </>
              )
            ) : replacement === '' ? (
              <>
                Remove <s className="whitespace-pre text-red-600">“{issue.text}”</s>
              </>
            ) : (
              <>
                Change <s className="whitespace-pre text-red-600">“{issue.text}”</s> to <b className="whitespace-pre">“{replacement}”</b>
              </>
            )}
          </div>
          {issue.kind === 'spelling' && issue.suggestions.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5" data-testid="spelling-suggestions">
              {issue.suggestions.map((s, k) => (
                <button key={s} onClick={() => setPick(k)} className={cn('rounded-full border px-2.5 py-0.5 text-[13px]', k === pick ? 'border-brand-500 bg-brand-50 font-medium text-brand-700' : 'border-line text-ink-2 hover:bg-hover')}>
                  {s}
                </button>
              ))}
            </div>
          )}
          <div className="mt-3 flex items-center gap-2">
            {(issue.kind === 'grammar' || issue.suggestions.length > 0) && (
              <Button size="sm" variant="primary" onClick={() => spell.accept(issue, replacement)}>
                Accept
              </Button>
            )}
            <Button size="sm" onClick={() => spell.ignore(issue)}>
              Ignore
            </Button>
            {issue.kind === 'spelling' && (
              <button onClick={() => void spell.addToDictionary(issue.text)} className="ml-auto text-[12px] font-medium text-brand-600 hover:underline">
                Add to dictionary
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** Tools → Spelling and grammar → Personal dictionary. */
export function PersonalDictionaryDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: words } = usePersonalDictionary(open);
  const [word, setWord] = useState('');
  const save = async (p: Promise<string[]>) => {
    try {
      qc.setQueryData(['spelling-dictionary'], await p);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()} title="Personal dictionary" description="Words you add are never marked as misspelled, in any document." width={420}>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!word.trim()) return;
          void save(api<string[]>('/spelling/dictionary', { method: 'POST', json: { word: word.trim() } }));
          setWord('');
        }}
      >
        <input value={word} onChange={(e) => setWord(e.target.value)} placeholder="Add a word" aria-label="New word" className="input h-9 flex-1" />
        <Button type="submit" disabled={!word.trim()}>
          Add
        </Button>
      </form>
      <ul className="mt-3 max-h-64 overflow-y-auto" data-testid="dictionary-words">
        {(words ?? []).map((w) => (
          <li key={w} className="group flex items-center rounded-md px-2 py-1 text-[13px] hover:bg-hover">
            <span className="flex-1 text-ink">{w}</span>
            <button onClick={() => void save(api<string[]>('/spelling/dictionary', { method: 'DELETE', json: { words: [w] } }))} className="rounded p-0.5 text-muted opacity-0 hover:text-red-600 group-hover:opacity-100" aria-label={`Remove ${w}`}>
              <X size={14} />
            </button>
          </li>
        ))}
        {words && !words.length && <li className="px-2 py-1 text-[13px] text-muted">No words yet.</li>}
      </ul>
    </Dialog>
  );
}
