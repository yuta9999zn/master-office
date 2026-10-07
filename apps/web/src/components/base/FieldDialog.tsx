'use client';

import { cellText, cellValue, CHOICE_COLORS, COMPUTED_TYPES, FORMULA_FUNCTIONS, formulaProblem, type BaseField, type BaseRecord, type BaseTable, type CellContext, type Choice, type FieldOptions, type FieldType } from '@workos/base-model';
import { AlertTriangle, GripVertical, Plus, X } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { useBaseActions } from '@/lib/base';
import { Button, cn, Dialog } from '../ui/primitives';
import { FIELD_GROUPS, FIELD_META, FieldIcon } from './field-meta';

const CURRENCIES = ['JPY', 'USD', 'EUR', 'VND', 'GBP', 'CNY', 'KRW', 'SGD', 'THB'];
const input = 'h-9 w-full rounded-lg border border-line-strong bg-surface px-3 text-[13px] outline-none focus:border-brand-500';

/** Create or edit a field: name, type and the options of that type (§75). */
export function FieldDialog({
  baseId,
  table,
  tables,
  field,
  afterFieldId,
  sample,
  ctx,
  onClose,
}: {
  baseId: string;
  table: BaseTable;
  tables: BaseTable[];
  field: BaseField | null;
  afterFieldId?: string | null;
  sample?: BaseRecord;
  ctx: CellContext;
  onClose: () => void;
}) {
  const a = useBaseActions(baseId);
  const [name, setName] = useState(field?.name ?? '');
  const [type, setType] = useState<FieldType>(field?.type ?? 'text');
  const [o, setO] = useState<FieldOptions>(field?.options ?? {});
  const [description, setDescription] = useState(field?.description ?? '');
  const [newChoice, setNewChoice] = useState('');
  const expr = useRef<HTMLTextAreaElement>(null);
  const primary = field?.id === table.primaryFieldId;
  const others = table.fields.filter((f) => f.id !== field?.id);
  const typeChanged = !!field && field.type !== type;

  const problem = type === 'formula' ? (o.expression?.trim() ? formulaProblem(o.expression, others.concat(field ? [{ ...field, name }] : []), field?.id) : 'Write a formula') : null;
  const preview = useMemo(() => {
    if (type !== 'formula' || problem || !sample) return null;
    const f: BaseField = { id: field?.id ?? '__new', tableId: table.id, name: name || 'Formula', type: 'formula', options: o, description: null, position: 0 };
    return cellText(f, cellValue(f, sample, { ...ctx, fields: [...others, f] }), ctx);
  }, [type, problem, sample, o, name]); // eslint-disable-line react-hooks/exhaustive-deps

  const choices = o.choices ?? [];
  const setChoices = (c: Choice[]) => setO({ ...o, choices: c });
  const insert = (text: string) => {
    const el = expr.current;
    const cur = o.expression ?? '';
    const at = el ? el.selectionStart : cur.length;
    const next = cur.slice(0, at) + text + cur.slice(el ? el.selectionEnd : at);
    setO({ ...o, expression: next });
    setTimeout(() => {
      el?.focus();
      el?.setSelectionRange(at + text.length, at + text.length);
    }, 0);
  };

  const save = async () => {
    const options: FieldOptions = { ...o, choices: o.choices?.map((c) => ({ ...c, name: c.name.trim() })).filter((c) => c.name) };
    if (field) await a.updateField.mutateAsync({ id: field.id, name: name.trim() || field.name, type, options, description: description || null });
    else await a.createField.mutateAsync({ tableId: table.id, name: name.trim() || undefined, type, options, description: description || null, afterFieldId: afterFieldId ?? null });
    onClose();
  };

  return (
    <Dialog
      open
      onOpenChange={(v) => !v && onClose()}
      title={field ? `Edit field` : 'Add a field'}
      width={560}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!!problem && type === 'formula'} loading={a.createField.isPending || a.updateField.isPending} onClick={() => void save()} data-testid="field-save">
            {field ? 'Save' : 'Create field'}
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-[13px]" data-testid="field-dialog">
        <input autoFocus value={name} onChange={(e) => setName(e.target.value.replace(/[{}]/g, ''))} placeholder="Field name" aria-label="Field name" className={input} />
        <div>
          <p className="mb-1 text-[12px] text-muted">Type</p>
          <div className="max-h-[220px] space-y-2 overflow-y-auto rounded-lg p-1 ring-1 ring-line" role="radiogroup" aria-label="Field type">
            {FIELD_GROUPS.map((g) => (
              <div key={g.label}>
                <p className="px-1 pb-1 text-[10.5px] font-semibold uppercase tracking-wide text-subtle">{g.label}</p>
                <div className="grid grid-cols-3 gap-1">
                  {g.types.map((t) => {
                    const disabled = primary && ['link', 'attachment', 'checkbox'].includes(t);
                    return (
                      <button
                        key={t}
                        type="button"
                        role="radio"
                        aria-checked={type === t}
                        disabled={disabled}
                        onClick={() => setType(t)}
                        title={FIELD_META[t].note}
                        className={cn('flex items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-[12.5px]', type === t ? 'bg-selected font-medium text-brand-700' : 'hover:bg-hover', disabled && 'cursor-not-allowed opacity-40')}
                      >
                        <FieldIcon type={t} className={type === t ? 'text-brand-600' : 'text-muted'} /> {FIELD_META[t].label}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>

        {typeChanged && !COMPUTED_TYPES.includes(type) && (
          <p className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-[12.5px] text-amber-800">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" /> Values will be converted to {FIELD_META[type].label.toLowerCase()}. Values that cannot be converted are cleared.
          </p>
        )}
        {typeChanged && COMPUTED_TYPES.includes(type) && (
          <p className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-[12.5px] text-amber-800">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" /> The values typed in this field will be replaced by computed ones.
          </p>
        )}

        {(type === 'number' || type === 'currency' || type === 'percent') && (
          <div className="grid grid-cols-2 gap-2">
            <label>
              <span className="mb-1 block text-[12px] text-muted">Decimals</span>
              <select value={o.precision ?? 0} onChange={(e) => setO({ ...o, precision: Number(e.target.value) })} className={input} aria-label="Decimals">
                {[0, 1, 2, 3, 4].map((n) => (
                  <option key={n} value={n}>
                    {n === 0 ? '1' : `1.${'0'.repeat(n)}`}
                  </option>
                ))}
              </select>
            </label>
            {type === 'currency' && (
              <label>
                <span className="mb-1 block text-[12px] text-muted">Currency</span>
                <select value={o.currency ?? 'JPY'} onChange={(e) => setO({ ...o, currency: e.target.value })} className={input} aria-label="Currency">
                  {CURRENCIES.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </label>
            )}
          </div>
        )}

        {(type === 'singleSelect' || type === 'multiSelect') && (
          <div data-testid="choices">
            <p className="mb-1 text-[12px] text-muted">Options</p>
            <ul className="space-y-1">
              {choices.map((c, i) => (
                <li key={c.id || i} className="flex items-center gap-1.5">
                  <GripVertical size={13} className="text-subtle" />
                  <button
                    type="button"
                    onClick={() => setChoices(choices.map((x, j) => (j === i ? { ...x, color: CHOICE_COLORS[(CHOICE_COLORS.indexOf(x.color) + 1) % CHOICE_COLORS.length] } : x)))}
                    className="size-5 shrink-0 rounded-full ring-1 ring-line"
                    style={{ background: c.color }}
                    aria-label={`Color of ${c.name}`}
                  />
                  <input value={c.name} onChange={(e) => setChoices(choices.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} className={cn(input, 'h-8')} aria-label={`Option ${i + 1}`} />
                  <button type="button" onClick={() => setChoices(choices.filter((_, j) => j !== i))} className="rounded p-1 text-muted hover:bg-hover" aria-label={`Remove ${c.name}`}>
                    <X size={14} />
                  </button>
                </li>
              ))}
            </ul>
            <form
              className="mt-1 flex gap-1.5"
              onSubmit={(e) => {
                e.preventDefault();
                if (!newChoice.trim() || choices.some((c) => c.name.toLowerCase() === newChoice.trim().toLowerCase())) return;
                setChoices([...choices, { id: '', name: newChoice.trim(), color: CHOICE_COLORS[choices.length % CHOICE_COLORS.length] }]);
                setNewChoice('');
              }}
            >
              <input value={newChoice} onChange={(e) => setNewChoice(e.target.value)} placeholder="Add an option" aria-label="New option" className={cn(input, 'h-8')} />
              <Button size="sm" type="submit" icon={<Plus size={13} />}>
                Add
              </Button>
            </form>
          </div>
        )}

        {type === 'date' && (
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={!!o.includeTime} onChange={(e) => setO({ ...o, includeTime: e.target.checked })} className="accent-brand-600" /> Include a time
          </label>
        )}
        {type === 'person' && (
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={!!o.multiple} onChange={(e) => setO({ ...o, multiple: e.target.checked })} className="accent-brand-600" /> Allow several people
          </label>
        )}
        {type === 'rating' && (
          <label>
            <span className="mb-1 block text-[12px] text-muted">Stars</span>
            <select value={o.max ?? 5} onChange={(e) => setO({ ...o, max: Number(e.target.value) })} className={input} aria-label="Stars">
              {[3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>
          </label>
        )}
        {type === 'link' && (
          <label>
            <span className="mb-1 block text-[12px] text-muted">Link to records of</span>
            <select value={o.tableId ?? ''} onChange={(e) => setO({ ...o, tableId: e.target.value })} className={input} aria-label="Linked table">
              <option value="">Choose a table…</option>
              {tables.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                  {t.id === table.id ? ' (this table)' : ''}
                </option>
              ))}
            </select>
          </label>
        )}
        {type === 'formula' && (
          <div className="space-y-1.5">
            <textarea
              ref={expr}
              value={o.expression ?? ''}
              onChange={(e) => setO({ ...o, expression: e.target.value })}
              rows={3}
              spellCheck={false}
              placeholder={'{Price} * {Qty}'}
              aria-label="Formula"
              className="w-full rounded-lg border border-line-strong bg-surface p-2 font-mono text-[12.5px] outline-none focus:border-brand-500"
            />
            <p className={cn('text-[12px]', problem ? 'text-red-600' : 'text-emerald-700')} data-testid="formula-status">
              {problem ?? (preview !== null ? `✓ First record: ${preview || '(empty)'}` : '✓ Looks good')}
            </p>
            <div className="flex flex-wrap gap-1">
              {others.map((f) => (
                <button key={f.id} type="button" onClick={() => insert(`{${f.name}}`)} className="flex items-center gap-1 rounded bg-hover px-1.5 py-0.5 text-[11.5px] hover:bg-selected">
                  <FieldIcon type={f.type} size={11} /> {f.name}
                </button>
              ))}
            </div>
            <details className="text-[12px] text-muted">
              <summary className="cursor-pointer">Functions</summary>
              <div className="mt-1 flex flex-wrap gap-1">
                {FORMULA_FUNCTIONS.map((fn) => (
                  <button key={fn} type="button" onClick={() => insert(`${fn}(`)} className="rounded px-1.5 py-0.5 font-mono text-[11px] ring-1 ring-line hover:bg-hover">
                    {fn}
                  </button>
                ))}
              </div>
            </details>
          </div>
        )}
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="Description (optional)" aria-label="Field description" className="w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-[13px] outline-none focus:border-brand-500" />
      </div>
    </Dialog>
  );
}
