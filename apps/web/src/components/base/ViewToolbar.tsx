'use client';

import { FILTER_OP_LABEL, filterOps, UNARY_OPS, type BaseField, type BaseTable, type BaseView, type FilterCondition, type FilterOp, type ViewConfig } from '@workos/base-model';
import { ArrowDownUp, Eye, EyeOff, Filter, Group, Plus, Rows3, Search, Trash2, X } from 'lucide-react';
import { Popover } from 'radix-ui';
import { useState, type ReactNode } from 'react';
import { cn } from '../ui/primitives';
import { FieldIcon } from './field-meta';

const sel = 'h-8 rounded-md border border-line-strong bg-surface px-2 text-[12.5px] outline-none focus:border-brand-500';

function Pop({ trigger, children, active, label, testid }: { trigger: ReactNode; children: ReactNode; active?: boolean; label: string; testid: string }) {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button className={cn('flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[13px]', active ? 'bg-brand-50 text-brand-700' : 'text-ink-2 hover:bg-hover')} aria-label={label} data-testid={testid}>
          {trigger}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="start" sideOffset={6} className="z-50 rounded-xl border border-line bg-surface p-3 shadow-xl" data-testid={`${testid}-panel`}>
          {children}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

let seq = 0;
const newId = () => `f${Date.now().toString(36)}${(seq++).toString(36)}`;

/** Fields / Filter / Group / Sort / row height / search for a view. */
export function ViewToolbar({ table, view, config, setConfig, search, setSearch, extra }: { table: BaseTable; view: BaseView; config: ViewConfig; setConfig: (c: Partial<ViewConfig>) => void; search: string; setSearch: (s: string) => void; extra?: ReactNode }) {
  const fields = table.fields;
  const hidden = new Set(config.hidden);
  const conds = config.filters.conditions;
  const byId = (id: string) => fields.find((f) => f.id === id);
  const setConds = (c: FilterCondition[]) => setConfig({ filters: { ...config.filters, conditions: c } });
  return (
    <div className="flex shrink-0 items-center gap-1 border-b border-line bg-surface px-3 py-1.5" data-testid="view-toolbar">
      {extra}
      {view.type !== 'form' && (
        <>
          <Pop label="Fields" testid="tb-fields" active={hidden.size > 0} trigger={<><EyeOff size={15} /> {hidden.size ? `${hidden.size} hidden` : 'Fields'}</>}>
            <ul className="max-h-80 w-64 space-y-0.5 overflow-y-auto">
              {fields.map((f) => {
                const primary = f.id === table.primaryFieldId;
                const on = primary || !hidden.has(f.id);
                return (
                  <li key={f.id}>
                    <button
                      disabled={primary}
                      onClick={() => setConfig({ hidden: on ? [...config.hidden, f.id] : config.hidden.filter((x) => x !== f.id) })}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-hover disabled:opacity-60"
                      data-testid="tb-field-toggle"
                      data-field={f.name}
                    >
                      <FieldIcon type={f.type} />
                      <span className="min-w-0 flex-1 truncate">{f.name}</span>
                      {on ? <Eye size={14} className="text-brand-600" /> : <EyeOff size={14} className="text-subtle" />}
                    </button>
                  </li>
                );
              })}
            </ul>
            <div className="mt-2 flex gap-2 text-[12px]">
              <button className="text-brand-700 hover:underline" onClick={() => setConfig({ hidden: [] })}>
                Show all
              </button>
              <button className="text-brand-700 hover:underline" onClick={() => setConfig({ hidden: fields.filter((f) => f.id !== table.primaryFieldId).map((f) => f.id) })}>
                Hide all
              </button>
            </div>
          </Pop>

          <Pop label="Filter" testid="tb-filter" active={conds.length > 0} trigger={<><Filter size={15} /> {conds.length ? `Filtered by ${conds.length}` : 'Filter'}</>}>
            <div className="w-[560px] space-y-2">
              {conds.length === 0 && <p className="text-[12.5px] text-muted">No filters — every record shows.</p>}
              {conds.map((c, i) => {
                const f = byId(c.fieldId);
                if (!f) return null;
                const ops = filterOps(f.type);
                return (
                  <div key={c.id} className="flex items-center gap-1.5" data-testid="filter-row">
                    <span className="w-14 shrink-0 text-[12px] text-muted">
                      {i === 0 ? (
                        'Where'
                      ) : i === 1 ? (
                        <select value={config.filters.conjunction} onChange={(e) => setConfig({ filters: { ...config.filters, conjunction: e.target.value as 'and' | 'or' } })} className={cn(sel, 'w-14 px-1')} aria-label="And / or">
                          <option value="and">and</option>
                          <option value="or">or</option>
                        </select>
                      ) : (
                        config.filters.conjunction
                      )}
                    </span>
                    <select value={c.fieldId} onChange={(e) => setConds(conds.map((x) => (x.id === c.id ? { ...x, fieldId: e.target.value, op: filterOps(byId(e.target.value)!.type)[0], value: byId(e.target.value)!.type === 'checkbox' ? true : undefined } : x)))} className={cn(sel, 'w-40')} aria-label="Filter field">
                      {fields.map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.name}
                        </option>
                      ))}
                    </select>
                    <select value={c.op} onChange={(e) => setConds(conds.map((x) => (x.id === c.id ? { ...x, op: e.target.value as FilterOp } : x)))} className={cn(sel, 'w-36')} aria-label="Filter operator">
                      {ops.map((op) => (
                        <option key={op} value={op}>
                          {FILTER_OP_LABEL[op]}
                        </option>
                      ))}
                    </select>
                    <div className="min-w-0 flex-1">{!UNARY_OPS.includes(c.op) && <FilterValue field={f} c={c} onChange={(value) => setConds(conds.map((x) => (x.id === c.id ? { ...x, value } : x)))} />}</div>
                    <button onClick={() => setConds(conds.filter((x) => x.id !== c.id))} className="rounded p-1 text-muted hover:bg-hover" aria-label="Remove condition">
                      <Trash2 size={14} />
                    </button>
                  </div>
                );
              })}
              <button onClick={() => setConds([...conds, { id: newId(), fieldId: fields[0].id, op: filterOps(fields[0].type)[0], ...(fields[0].type === 'checkbox' ? { value: true } : {}) }])} className="flex items-center gap-1 text-[12.5px] text-brand-700 hover:underline" data-testid="filter-add">
                <Plus size={13} /> Add condition
              </button>
            </div>
          </Pop>

          {view.type === 'grid' && (
            <Pop label="Group" testid="tb-group" active={!!config.groupBy} trigger={<><Group size={15} /> {config.groupBy ? `Grouped by ${byId(config.groupBy.fieldId)?.name ?? ''}` : 'Group'}</>}>
              <div className="flex w-72 items-center gap-1.5">
                <select value={config.groupBy?.fieldId ?? ''} onChange={(e) => setConfig({ groupBy: e.target.value ? { fieldId: e.target.value, dir: config.groupBy?.dir ?? 'asc' } : null })} className={cn(sel, 'flex-1')} aria-label="Group by">
                  <option value="">No grouping</option>
                  {fields
                    .filter((f) => !['longText', 'attachment'].includes(f.type))
                    .map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                </select>
                {config.groupBy && (
                  <select value={config.groupBy.dir} onChange={(e) => setConfig({ groupBy: { ...config.groupBy!, dir: e.target.value as 'asc' | 'desc' } })} className={sel} aria-label="Group order">
                    <option value="asc">A → Z</option>
                    <option value="desc">Z → A</option>
                  </select>
                )}
              </div>
            </Pop>
          )}

          <Pop label="Sort" testid="tb-sort" active={config.sorts.length > 0} trigger={<><ArrowDownUp size={15} /> {config.sorts.length ? `Sorted by ${config.sorts.length}` : 'Sort'}</>}>
            <div className="w-80 space-y-1.5">
              {config.sorts.map((s, i) => (
                <div key={`${s.fieldId}${i}`} className="flex items-center gap-1.5" data-testid="sort-row">
                  <select value={s.fieldId} onChange={(e) => setConfig({ sorts: config.sorts.map((x, j) => (j === i ? { ...x, fieldId: e.target.value } : x)) })} className={cn(sel, 'flex-1')} aria-label="Sort field">
                    {fields.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                  </select>
                  <select value={s.dir} onChange={(e) => setConfig({ sorts: config.sorts.map((x, j) => (j === i ? { ...x, dir: e.target.value as 'asc' | 'desc' } : x)) })} className={sel} aria-label="Sort direction">
                    <option value="asc">A → Z / 1 → 9</option>
                    <option value="desc">Z → A / 9 → 1</option>
                  </select>
                  <button onClick={() => setConfig({ sorts: config.sorts.filter((_, j) => j !== i) })} className="rounded p-1 text-muted hover:bg-hover" aria-label="Remove sort">
                    <X size={14} />
                  </button>
                </div>
              ))}
              <button onClick={() => setConfig({ sorts: [...config.sorts, { fieldId: fields.find((f) => !config.sorts.some((s) => s.fieldId === f.id))?.id ?? fields[0].id, dir: 'asc' }] })} className="flex items-center gap-1 text-[12.5px] text-brand-700 hover:underline" data-testid="sort-add">
                <Plus size={13} /> Add sort
              </button>
            </div>
          </Pop>

          {view.type === 'grid' && (
            <Pop label="Row height" testid="tb-height" trigger={<Rows3 size={15} />}>
              <div className="w-36 space-y-0.5">
                {(['short', 'medium', 'tall'] as const).map((h) => (
                  <button key={h} onClick={() => setConfig({ rowHeight: h })} className={cn('w-full rounded-md px-2 py-1.5 text-left text-[13px] capitalize hover:bg-hover', config.rowHeight === h && 'bg-selected text-brand-700')}>
                    {h}
                  </button>
                ))}
              </div>
            </Pop>
          )}
          <span className="flex-1" />
          <label className="flex h-8 items-center gap-1.5 rounded-md px-2 text-muted focus-within:ring-1 focus-within:ring-brand-400">
            <Search size={14} />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search" aria-label="Search records" className="w-36 bg-transparent text-[13px] text-ink outline-none" />
          </label>
        </>
      )}
    </div>
  );
}

function FilterValue({ field, c, onChange }: { field: BaseField; c: FilterCondition; onChange: (v: unknown) => void }) {
  const [text, setText] = useState(c.value === undefined || c.value === null ? '' : String(c.value));
  if (field.type === 'checkbox')
    return (
      <select value={c.value === true || c.value === 'true' ? 'true' : 'false'} onChange={(e) => onChange(e.target.value === 'true')} className={cn(sel, 'w-full')} aria-label="Filter value">
        <option value="true">checked</option>
        <option value="false">not checked</option>
      </select>
    );
  if (field.type === 'singleSelect' || field.type === 'multiSelect') {
    const multi = ['isAnyOf', 'hasAnyOf', 'hasAllOf'].includes(c.op);
    const cur = Array.isArray(c.value) ? (c.value as string[]) : c.value ? [String(c.value)] : [];
    if (!multi)
      return (
        <select value={cur[0] ?? ''} onChange={(e) => onChange(e.target.value || undefined)} className={cn(sel, 'w-full')} aria-label="Filter value">
          <option value="">Choose…</option>
          {(field.options.choices ?? []).map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      );
    return (
      <div className="flex flex-wrap gap-1">
        {(field.options.choices ?? []).map((o) => (
          <button key={o.id} onClick={() => onChange(cur.includes(o.id) ? cur.filter((x) => x !== o.id) : [...cur, o.id])} className={cn('rounded-full px-2 py-px text-[11.5px] ring-1', cur.includes(o.id) ? 'ring-brand-500' : 'ring-transparent opacity-60')} style={{ background: o.color }}>
            {o.name}
          </button>
        ))}
      </div>
    );
  }
  if (['date', 'createdTime', 'modifiedTime'].includes(field.type))
    return (
      <div className="flex gap-1">
        <input type="date" value={text === 'today' ? '' : text} onChange={(e) => (setText(e.target.value), onChange(e.target.value || undefined))} className={cn(sel, 'flex-1')} aria-label="Filter date" />
        <button onClick={() => (setText('today'), onChange('today'))} className={cn('rounded-md px-2 text-[12px] ring-1 ring-line', text === 'today' && 'bg-selected text-brand-700')}>
          today
        </button>
      </div>
    );
  const numeric = ['number', 'currency', 'percent', 'rating', 'autoNumber'].includes(field.type);
  return (
    <input
      value={text}
      type={numeric ? 'number' : 'text'}
      onChange={(e) => {
        setText(e.target.value);
        onChange(e.target.value === '' ? undefined : numeric ? Number(e.target.value) : e.target.value);
      }}
      placeholder="Value"
      aria-label="Filter value"
      className={cn(sel, 'w-full')}
    />
  );
}

