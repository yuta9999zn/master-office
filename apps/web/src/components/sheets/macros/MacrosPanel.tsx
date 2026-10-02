'use client';

import { javascript } from '@codemirror/lang-javascript';
import { basicSetup, EditorView } from 'codemirror';
import { ArrowLeft, BookOpen, Circle, Code2, FileCode2, Keyboard, Loader2, Play, Plus, Save, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type * as Y from 'yjs';
import { Button, cn, EmptyState } from '../../ui/primitives';
import type { GridHandle } from '../UniverGrid';
import type { MacroResult } from './runtime';
import { functionNameOf } from './recorder';
import { deleteMacro, saveMacro, useMacros, useVba, type MacroDef, type VbaModule } from './store';

export const SHORTCUT_LABEL = (n: number) => `Ctrl+Alt+Shift+${n}`;

/** CodeMirror 6 editor for one macro's script. */
function CodeEditor({ value, onChange, readOnly }: { value: string; onChange: (v: string) => void; readOnly: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const change = useRef(onChange);
  change.current = onChange;
  useEffect(() => {
    if (!host.current) return;
    const v = new EditorView({
      doc: value,
      parent: host.current,
      extensions: [
        basicSetup,
        javascript(),
        EditorView.editable.of(!readOnly),
        EditorView.updateListener.of((u) => u.docChanged && change.current(u.state.doc.toString())),
        EditorView.theme({ '&': { height: '100%', fontSize: '12.5px' }, '.cm-scroller': { fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace' } }),
      ],
    });
    view.current = v;
    return () => v.destroy();
  }, [readOnly]); // eslint-disable-line react-hooks/exhaustive-deps
  // Remote edits (another person saved the macro) replace the text when it differs.
  useEffect(() => {
    const v = view.current;
    if (v && v.state.doc.toString() !== value) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } });
  }, [value]);
  return <div ref={host} className="h-full overflow-hidden" data-testid="macro-code" />;
}

const API_HELP = `SpreadsheetApp.getActive() / getActiveSheet() / getActiveRange()
spreadsheet.getSheetByName(n), getSheets(), insertSheet(n), deleteSheet(s), getRange('Sheet1!A1:B2'), toast(msg)
sheet.getRange('A1') | getRange(row, col, numRows, numCols), getDataRange(), getLastRow(), getLastColumn()
sheet.appendRow([...]), insertRowsBefore/After(r, n), deleteRows(r, n), insertColumns…, deleteColumns…
sheet.setName(n), setFrozenRows(n), setFrozenColumns(n), setColumnWidth(c, px), setRowHeight(r, px),
      hideRows/showRows, hideColumns/showColumns, setTabColor(c), sort(col, asc), clear()
range.getValue(s) / setValue(s), getFormula(s) / setFormula(s), clear(), clearContent(), clearFormat(),
      setBackground, setFontColor, setFontWeight('bold'), setFontStyle('italic'), setFontLine('underline'),
      setFontSize, setFontFamily, setHorizontalAlignment, setVerticalAlignment, setWrap, setNumberFormat('#,##0'),
      setBorder(top, left, bottom, right), merge(), breakApart(), offset(r, c), getCell(r, c), copyTo(range), sort(col)
Logger.log(...) · console.log(...) · Browser.msgBox(msg) · Utilities.formatDate(date, tz, 'yyyy-MM-dd')
Values written by a macro are visible to it right away; formula results update after the macro finishes.`;

export function MacrosPanel({
  doc,
  grid,
  editable,
  me,
  running,
  lastRun,
  editingId,
  setEditingId,
  onRun,
  onRecord,
}: {
  doc: Y.Doc;
  grid: GridHandle | null;
  editable: boolean;
  me: string;
  running: string | null;
  lastRun: (MacroResult & { macro: string }) | null;
  editingId: string | null;
  setEditingId: (id: string | null) => void;
  onRun: (m: MacroDef) => void;
  onRecord: () => void;
}) {
  const macros = useMacros(doc);
  const vba = useVba(doc);
  const [viewVba, setViewVba] = useState<VbaModule | null>(null);
  const editing = macros.find((m) => m.id === editingId) ?? null;
  const [draft, setDraft] = useState<string | null>(null);
  const [help, setHelp] = useState(false);
  useEffect(() => setDraft(null), [editingId]);

  const create = () => {
    const fn = functionNameOf('my function', macros.map((m) => m.fn));
    const m: MacroDef = {
      id: crypto.randomUUID(),
      name: `Macro ${macros.length + 1}`,
      fn,
      code: `function ${fn}() {\n  var sheet = SpreadsheetApp.getActiveSheet();\n  sheet.getRange('A1').setValue('Hello from a macro');\n  Logger.log('Last row: ' + sheet.getLastRow());\n}\n`,
      shortcut: null,
      updatedBy: me,
      updatedAt: new Date().toISOString(),
    };
    saveMacro(doc, m);
    setEditingId(m.id);
  };
  const update = (m: MacroDef, patch: Partial<MacroDef>) => saveMacro(doc, { ...m, ...patch, updatedBy: me, updatedAt: new Date().toISOString() });
  const takenShortcuts = (except: string) => macros.filter((m) => m.id !== except && m.shortcut).map((m) => m.shortcut);

  if (viewVba) {
    return (
      <div className="flex h-full flex-col" data-testid="vba-view">
        <div className="flex items-center gap-2 border-b border-line px-3 py-2">
          <button onClick={() => setViewVba(null)} className="rounded p-1 text-muted hover:bg-hover" aria-label="Back to macros">
            <ArrowLeft size={15} />
          </button>
          <FileCode2 size={15} className="text-violet-600" />
          <span className="flex-1 truncate text-[13px] font-semibold">{viewVba.name}</span>
          <span className="rounded bg-violet-50 px-1.5 py-0.5 text-[11px] text-violet-700">VBA · read-only</span>
        </div>
        <p className="border-b border-line bg-amber-50 px-3 py-2 text-[12px] text-amber-900">
          This code came from the Excel file. VBA does not run in Master Office: create a JavaScript macro (New script) that does the same — the SpreadsheetApp API covers ranges, values, formats, rows and sheets.
        </p>
        <div className="min-h-0 flex-1">
          <CodeEditor value={viewVba.code} onChange={() => undefined} readOnly />
        </div>
      </div>
    );
  }

  if (editing) {
    const code = draft ?? editing.code;
    const dirty = draft !== null && draft !== editing.code;
    const saveDraft = () => draft !== null && update(editing, { code: draft });
    return (
      <div className="flex h-full flex-col" data-testid="macro-editor">
        <div className="flex items-center gap-2 border-b border-line px-3 py-2">
          <button onClick={() => (saveDraft(), setEditingId(null))} className="rounded p-1 text-muted hover:bg-hover" aria-label="Back to macros">
            <ArrowLeft size={15} />
          </button>
          <input
            defaultValue={editing.name}
            key={editing.name}
            disabled={!editable}
            onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== editing.name && update(editing, { name: e.target.value.trim() })}
            className="h-7 min-w-0 flex-1 rounded-md border border-transparent px-1.5 text-[13px] font-semibold hover:border-line focus:border-brand-600 focus:outline-none"
            aria-label="Macro name"
          />
          <select
            aria-label="Keyboard shortcut"
            disabled={!editable}
            value={editing.shortcut ?? ''}
            onChange={(e) => update(editing, { shortcut: e.target.value ? Number(e.target.value) : null })}
            className="h-7 rounded-md border border-line bg-surface px-1 text-[12px]"
          >
            <option value="">No shortcut</option>
            {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
              <option key={n} value={n} disabled={takenShortcuts(editing.id).includes(n)}>
                {SHORTCUT_LABEL(n)}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2 border-b border-line px-3 py-1.5 text-[12px] text-muted">
          <Code2 size={13} />
          <span>
            Runs <code className="rounded bg-hover px-1 text-ink-2">{editing.fn}()</code>
          </span>
          <input
            defaultValue={editing.fn}
            key={editing.fn}
            disabled={!editable}
            onBlur={(e) => /^[A-Za-z_$][\w$]*$/.test(e.target.value) && update(editing, { fn: e.target.value })}
            className="ml-auto h-6 w-36 rounded border border-line px-1.5 font-mono text-[12px]"
            aria-label="Function to run"
          />
        </div>
        <div className="min-h-0 flex-1">
          <CodeEditor value={code} onChange={setDraft} readOnly={!editable} />
        </div>
        <div className="flex items-center gap-2 border-t border-line px-3 py-2">
          <Button size="sm" variant="primary" icon={running === editing.id ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />} disabled={!editable || !!running} onClick={() => (saveDraft(), onRun({ ...editing, code }))} data-testid="macro-run">
            Run
          </Button>
          <Button size="sm" variant="soft" icon={<Save size={13} />} disabled={!editable || !dirty} onClick={saveDraft}>
            {dirty ? 'Save' : 'Saved'}
          </Button>
          <button onClick={() => setHelp((h) => !h)} className={cn('ml-auto flex items-center gap-1 rounded-md px-2 py-1 text-[12px] text-muted hover:bg-hover', help && 'bg-hover text-ink')}>
            <BookOpen size={13} /> API
          </button>
        </div>
        {help && <pre className="max-h-48 overflow-auto whitespace-pre-wrap border-t border-line bg-canvas px-3 py-2 font-mono text-[11px] leading-relaxed text-ink-2">{API_HELP}</pre>}
        <Output lastRun={lastRun?.macro === editing.id ? lastRun : null} />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col" data-testid="macros-panel">
      {editable && (
        <div className="flex gap-2 border-b border-line px-3 py-2.5">
          <Button size="sm" variant="soft" icon={<Circle size={11} className="fill-red-500 text-red-500" />} onClick={onRecord} data-testid="macro-record">
            Record macro
          </Button>
          <Button size="sm" variant="ghost" icon={<Plus size={13} />} onClick={create}>
            New script
          </Button>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {!macros.length && (
          <EmptyState icon={<Code2 size={28} />} title="No macros yet">
            Record your actions (formatting, typing, inserting rows…) and replay them with one click or a shortcut — or write a script with the SpreadsheetApp API.
          </EmptyState>
        )}
        {macros.map((m) => (
          <div key={m.id} className="group flex items-center gap-2 rounded-lg px-2 py-2 hover:bg-hover" data-testid="macro-item">
            <Code2 size={15} className="shrink-0 text-emerald-600" />
            <button onClick={() => setEditingId(m.id)} className="min-w-0 flex-1 text-left">
              <div className="truncate text-[13px] font-medium text-ink">{m.name}</div>
              <div className="truncate text-[11px] text-muted">
                {m.fn}() · {m.updatedBy}
              </div>
            </button>
            {m.shortcut && (
              <span className="flex shrink-0 items-center gap-1 rounded bg-canvas px-1.5 py-0.5 text-[10px] text-muted" title={SHORTCUT_LABEL(m.shortcut)}>
                <Keyboard size={10} /> {m.shortcut}
              </span>
            )}
            <button disabled={!editable || !!running} onClick={() => onRun(m)} className="rounded-md p-1.5 text-brand-600 hover:bg-brand-50 disabled:opacity-40" aria-label={`Run ${m.name}`}>
              {running === m.id ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
            </button>
            {editable && (
              <button onClick={() => deleteMacro(doc, m.id)} className="rounded-md p-1.5 text-subtle opacity-0 hover:bg-red-50 hover:text-red-600 group-hover:opacity-100" aria-label={`Delete ${m.name}`}>
                <Trash2 size={14} />
              </button>
            )}
          </div>
        ))}
        {vba.length > 0 && (
          <div className="mt-3 border-t border-line pt-3" data-testid="vba-modules">
            <div className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-subtle">Excel VBA (read-only)</div>
            {vba.map((m) => (
              <button key={m.name} onClick={() => setViewVba(m)} className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left hover:bg-hover">
                <FileCode2 size={15} className="shrink-0 text-violet-600" />
                <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{m.name}</span>
                <span className="text-[11px] text-muted">{m.code ? `${m.code.split('\n').length} lines` : 'empty'}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <Output lastRun={lastRun} />
      {!grid && <p className="px-3 pb-2 text-[11px] text-muted">The grid is still loading.</p>}
    </div>
  );
}

function Output({ lastRun }: { lastRun: (MacroResult & { macro: string }) | null }) {
  if (!lastRun) return null;
  return (
    <div className="max-h-44 shrink-0 overflow-y-auto border-t border-line bg-slate-950 px-3 py-2 font-mono text-[11.5px] leading-relaxed text-slate-200" data-testid="macro-output">
      <div className={lastRun.error ? 'text-red-300' : 'text-emerald-300'}>
        {lastRun.error ? `✗ ${lastRun.error}` : `✓ Finished in ${Math.round(lastRun.ms)} ms · ${lastRun.ops.length} change${lastRun.ops.length === 1 ? '' : 's'}`}
      </div>
      {lastRun.logs.map((l, i) => (
        <div key={i} className="whitespace-pre-wrap text-slate-300">
          {l}
        </div>
      ))}
    </div>
  );
}
