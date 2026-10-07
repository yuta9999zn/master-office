'use client';

import {
  cellText,
  cellValue,
  COMPUTED_TYPES,
  defaultsForView,
  parseCsv,
  summarize,
  visibleFields,
  type BaseField,
  type BaseRecord,
  type BaseTable,
  type BaseView,
  type CellContext,
  type Summary,
  type ViewConfig,
  type ViewGroup,
} from '@workos/base-model';
import type { UserSummary } from '@workos/shared';
import { ArrowDownAZ, ArrowUpAZ, ChevronDown, ChevronRight, Copy, EyeOff, Filter, GripVertical, Group, Maximize2, MessageSquare, Pencil, Plus, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useBaseActions } from '@/lib/base';
import { cn, Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '../ui/primitives';
import { CellEditor, type Move } from './CellEditor';
import { CellView, ChoicePill } from './CellView';
import { FieldIcon, isNumeric } from './field-meta';

const ROW_H = { short: 32, medium: 56, tall: 88 } as const;
const HEAD_H = 34;
const FOOT_H = 32;
const GROUP_H = 38;
const ADD_H = 32;
const NUM_W = 68;
const DEF_W = 180;
const PRIMARY_W = 230;
/** Fields edited through a picker that opens below the cell. */
const PICKERS = ['singleSelect', 'multiSelect', 'person', 'link', 'attachment', 'longText'];

type DRow = { kind: 'group'; g: ViewGroup; top: number; h: number } | { kind: 'rec'; r: BaseRecord; i: number; top: number; h: number } | { kind: 'add'; group: ViewGroup | null; top: number; h: number };
type Pos = { row: number; col: number };

export function GridView({
  baseId,
  table,
  view,
  config,
  setConfig,
  records,
  groups,
  ctx,
  editable,
  manualOrder,
  onExpand,
  onEditField,
  onAddField,
  me,
}: {
  baseId: string;
  table: BaseTable;
  view: BaseView;
  config: ViewConfig;
  setConfig: (c: Partial<ViewConfig>) => void;
  records: BaseRecord[];
  groups: ViewGroup[] | null;
  ctx: CellContext & { users: UserSummary[] };
  editable: boolean;
  /** No sort or group: rows can be dragged into order. */
  manualOrder: boolean;
  onExpand: (id: string) => void;
  onEditField: (f: BaseField) => void;
  onAddField: (afterFieldId: string | null) => void;
  me?: string;
}) {
  const a = useBaseActions(baseId);
  const fields = useMemo(() => visibleFields(table, view && { config }), [table, config]); // eslint-disable-line react-hooks/exhaustive-deps
  const rowH = ROW_H[config.rowHeight] ?? 32;
  const [widthDrag, setWidthDrag] = useState<{ id: string; w: number } | null>(null);
  const widthOf = (f: BaseField) => (widthDrag?.id === f.id ? widthDrag.w : (config.widths[f.id] ?? (f.id === table.primaryFieldId ? PRIMARY_W : DEF_W)));
  const xs = useMemo(() => {
    let x = NUM_W;
    return fields.map((f) => {
      const at = x;
      x += widthOf(f);
      return at;
    });
  }, [fields, config.widths, widthDrag]); // eslint-disable-line react-hooks/exhaustive-deps
  const totalW = (xs[xs.length - 1] ?? NUM_W) + (fields.length ? widthOf(fields[fields.length - 1]) : 0) + 120;

  const [folded, setFolded] = useState<Set<string>>(new Set());
  const rows = useMemo(() => {
    const out: DRow[] = [];
    let top = 0;
    let i = 0;
    const push = (r: DRow) => (out.push(r), (top += r.h));
    if (groups) {
      // Record indexes follow the order the groups show them.
      for (const g of groups) {
        push({ kind: 'group', g, top, h: GROUP_H });
        if (folded.has(g.key)) {
          i += g.records.length;
          continue;
        }
        for (const r of g.records) push({ kind: 'rec', r, i: i++, top, h: rowH });
        if (editable) push({ kind: 'add', group: g, top, h: ADD_H });
      }
    } else {
      for (const r of records) push({ kind: 'rec', r, i: i++, top, h: rowH });
      if (editable) push({ kind: 'add', group: null, top, h: ADD_H });
    }
    return { list: out, height: top };
  }, [records, groups, folded, rowH, editable]);
  const flat = useMemo(() => (groups ? groups.flatMap((g) => g.records) : records), [groups, records]);

  const scroller = useRef<HTMLDivElement>(null);
  const [scroll, setScroll] = useState({ top: 0, left: 0, h: 600 });
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setScroll((s) => ({ ...s, h: el.clientHeight })));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const visible = rows.list.filter((r) => r.top + r.h >= scroll.top - 200 && r.top <= scroll.top + scroll.h + 200);

  const [active, setActive] = useState<Pos | null>(null);
  const [anchor, setAnchor] = useState<Pos | null>(null);
  const [editing, setEditing] = useState<{ recordId: string; fieldId: string; seed?: string } | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<{ x: number; y: number; recordId: string } | null>(null);
  const [dragRow, setDragRow] = useState<string | null>(null);
  const [dropAt, setDropAt] = useState<{ id: string; after: boolean } | null>(null);
  const range = active && anchor ? { r0: Math.min(active.row, anchor.row), r1: Math.max(active.row, anchor.row), c0: Math.min(active.col, anchor.col), c1: Math.max(active.col, anchor.col) } : active ? { r0: active.row, r1: active.row, c0: active.col, c1: active.col } : null;
  const inRange = (row: number, col: number) => !!range && row >= range.r0 && row <= range.r1 && col >= range.c0 && col <= range.c1;

  const rowTop = (i: number) => rows.list.find((r) => r.kind === 'rec' && r.i === i)?.top ?? 0;
  /** Keeps the active cell on screen. */
  const reveal = useCallback(
    (p: Pos) => {
      const el = scroller.current;
      if (!el) return;
      const top = rowTop(p.row);
      if (top < el.scrollTop) el.scrollTop = top;
      else if (top + rowH > el.scrollTop + el.clientHeight - HEAD_H - FOOT_H) el.scrollTop = top + rowH - el.clientHeight + HEAD_H + FOOT_H;
      const f = fields[p.col];
      if (f && f.id !== table.primaryFieldId) {
        const x = xs[p.col];
        const w = widthOf(f);
        const stick = NUM_W + (fields[0] ? widthOf(fields[0]) : 0);
        if (x - stick < el.scrollLeft) el.scrollLeft = x - stick;
        else if (x + w > el.scrollLeft + el.clientWidth) el.scrollLeft = x + w - el.clientWidth;
      }
    },
    [rows, fields, xs, rowH], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const go = (p: Pos, extend = false) => {
    const q = { row: Math.max(0, Math.min(flat.length - 1, p.row)), col: Math.max(0, Math.min(fields.length - 1, p.col)) };
    setActive(q);
    if (!extend) setAnchor(null);
    else if (!anchor) setAnchor(active);
    reveal(q);
  };

  const write = (patches: { id: string; values: Record<string, unknown> }[]) => {
    if (!editable || !patches.length) return;
    a.updateRecords.mutate({ tableId: table.id, records: patches, ctx });
  };
  const commit = (rec: BaseRecord, f: BaseField, raw: unknown, move: Move = 'down') => {
    write([{ id: rec.id, values: { [f.id]: raw } }]);
    if (move !== 'none') setEditing(null);
    if (move === 'down' && active) go({ row: active.row + 1, col: active.col });
    if (move === 'right' && active) go({ row: active.row, col: active.col + 1 });
    if (move === 'left' && active) go({ row: active.row, col: active.col - 1 });
    if (move !== 'none') scroller.current?.focus();
  };
  const startEdit = (p: Pos, seed?: string) => {
    const r = flat[p.row];
    const f = fields[p.col];
    if (!editable || !r || !f || COMPUTED_TYPES.includes(f.type)) return;
    if (f.type === 'checkbox') return write([{ id: r.id, values: { [f.id]: !r.values[f.id] } }]);
    if (f.type === 'rating') return;
    setEditing({ recordId: r.id, fieldId: f.id, seed });
  };

  const addRecord = async (group: ViewGroup | null, afterId?: string | null) => {
    const values: Record<string, unknown> = { ...defaultsForView(table, { config }, me) };
    if (group && config.groupBy && group.key) {
      const gf = table.fields.find((f) => f.id === config.groupBy!.fieldId);
      if (gf && !COMPUTED_TYPES.includes(gf.type)) values[gf.id] = gf.type === 'multiSelect' || gf.type === 'person' || gf.type === 'link' ? group.key.split(',') : gf.type === 'checkbox' ? group.key === 'true' : group.key;
    }
    const [r] = await a.createRecords.mutateAsync({ tableId: table.id, records: [{ values, afterId: afterId ?? null }] });
    // Focus the new row's first cell (it shows once the list updates).
    setTimeout(() => {
      const i = flatRef.current.findIndex((x) => x.id === r.id);
      if (i >= 0) {
        go({ row: i, col: 0 });
        setEditing({ recordId: r.id, fieldId: fields[0].id });
      }
    }, 60);
  };
  const flatRef = useRef(flat);
  flatRef.current = flat;

  const copy = () => {
    if (!range) return;
    const lines: string[] = [];
    for (let r = range.r0; r <= range.r1; r++) {
      const rec = flat[r];
      if (!rec) continue;
      const cells: string[] = [];
      for (let c = range.c0; c <= range.c1; c++) {
        const t = cellText(fields[c], cellValue(fields[c], rec, ctx), ctx);
        cells.push(/[\t\n"]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t);
      }
      lines.push(cells.join('\t'));
    }
    void navigator.clipboard?.writeText(lines.join('\n'));
    toast.success(`Copied ${(range.r1 - range.r0 + 1) * (range.c1 - range.c0 + 1)} cell${range.r1 === range.r0 && range.c1 === range.c0 ? '' : 's'}`);
  };
  /** Pastes a block of cells (from the grid, Sheets or Excel) at the active cell; extra rows become new records. */
  const paste = async (text: string) => {
    if (!editable || !active) return;
    const block = parseCsv(text.replace(/\r?\n$/, ''), '\t');
    if (!block.length) return;
    const updates: { id: string; values: Record<string, unknown> }[] = [];
    const creates: { values: Record<string, unknown> }[] = [];
    block.forEach((line, dr) => {
      const values: Record<string, unknown> = {};
      line.forEach((cell, dc) => {
        const f = fields[active.col + dc];
        if (f && !COMPUTED_TYPES.includes(f.type) && f.type !== 'attachment') values[f.id] = cell;
      });
      const rec = flat[active.row + dr];
      if (rec) updates.push({ id: rec.id, values });
      else creates.push({ values });
    });
    write(updates);
    if (creates.length) await a.createRecords.mutateAsync({ tableId: table.id, records: creates });
    setAnchor({ row: active.row + block.length - 1, col: Math.min(fields.length - 1, active.col + Math.max(...block.map((l) => l.length)) - 1) });
  };
  const clear = () => {
    if (!editable || !range) return;
    const patches: { id: string; values: Record<string, unknown> }[] = [];
    for (let r = range.r0; r <= range.r1; r++) {
      const values: Record<string, unknown> = {};
      for (let c = range.c0; c <= range.c1; c++) if (!COMPUTED_TYPES.includes(fields[c].type)) values[fields[c].id] = null;
      if (flat[r] && Object.keys(values).length) patches.push({ id: flat[r].id, values });
    }
    write(patches);
  };
  const remove = (ids: string[]) => {
    if (!ids.length) return;
    a.deleteRecords.mutate({ tableId: table.id, ids });
    setChecked(new Set());
    setActive(null);
    toast.success(`Deleted ${ids.length} record${ids.length === 1 ? '' : 's'}`);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (editing) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'c') return void (e.preventDefault(), copy());
    if (mod && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      setActive({ row: 0, col: 0 });
      setAnchor({ row: flat.length - 1, col: fields.length - 1 });
      return;
    }
    if (!active) return;
    const step: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    if (step[e.key]) {
      e.preventDefault();
      const [dr, dc] = step[e.key];
      return go({ row: active.row + dr, col: active.col + dc }, e.shiftKey);
    }
    if (e.key === 'Tab') return void (e.preventDefault(), go({ row: active.row, col: active.col + (e.shiftKey ? -1 : 1) }));
    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) return onExpand(flat[active.row].id);
      return startEdit(active);
    }
    if (e.key === 'Escape') return setAnchor(null);
    if (e.key === 'Delete' || e.key === 'Backspace') return void (e.preventDefault(), clear());
    if (e.key === ' ' && e.shiftKey) return void (e.preventDefault(), onExpand(flat[active.row].id));
    const f = fields[active.col];
    if (e.key.length === 1 && !mod && !e.altKey && f && !COMPUTED_TYPES.includes(f.type) && !['checkbox', 'rating', 'attachment'].includes(f.type)) {
      e.preventDefault();
      startEdit(active, e.key);
    }
  };

  // Column resize.
  const resize = (f: BaseField, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const x0 = e.clientX;
    const w0 = widthOf(f);
    let w = w0;
    const move = (ev: MouseEvent) => setWidthDrag({ id: f.id, w: (w = Math.max(60, Math.min(800, w0 + ev.clientX - x0))) });
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      setWidthDrag(null);
      if (w !== w0) setConfig({ widths: { ...config.widths, [f.id]: w } });
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  const editRec = editing ? flat.find((r) => r.id === editing.recordId) : null;
  const editField = editing ? fields.find((f) => f.id === editing.fieldId) : null;
  const editRow = editRec ? rows.list.find((r) => r.kind === 'rec' && r.r.id === editRec.id) : null;
  const colIndex = editField ? fields.indexOf(editField) : -1;
  const sticky = (c: number) => c === 0;
  const left = (c: number) => (sticky(c) ? NUM_W : xs[c]);
  const summaryOf = (f: BaseField): Summary => config.summaries?.[f.id] ?? 'none';

  return (
    <div
      ref={scroller}
      tabIndex={0}
      onKeyDown={onKey}
      onPaste={(e) => {
        if (editing) return;
        e.preventDefault();
        void paste(e.clipboardData.getData('text/plain'));
      }}
      onScroll={(e) => setScroll({ top: e.currentTarget.scrollTop, left: e.currentTarget.scrollLeft, h: e.currentTarget.clientHeight })}
      className="relative min-h-0 flex-1 overflow-auto bg-surface outline-none"
      data-testid="grid"
    >
      <div className="relative flex flex-col" style={{ width: totalW, minHeight: '100%' }}>
        {/* Header */}
        <div className="sticky top-0 z-20 flex border-b border-line bg-canvas" style={{ height: HEAD_H, width: totalW }}>
          <div className="sticky left-0 z-10 flex shrink-0 items-center border-r border-line bg-canvas pl-2" style={{ width: NUM_W }}>
            {editable && (
              <input
                type="checkbox"
                checked={!!flat.length && checked.size === flat.length}
                onChange={(e) => setChecked(e.target.checked ? new Set(flat.map((r) => r.id)) : new Set())}
                className="accent-brand-600"
                aria-label="Select all records"
              />
            )}
          </div>
          {fields.map((f, c) => (
            <div key={f.id} className={cn('group relative flex shrink-0 items-center border-r border-line bg-canvas', sticky(c) && 'sticky z-10')} style={{ width: widthOf(f), ...(sticky(c) ? { left: NUM_W } : {}) }} data-testid="grid-header" data-field={f.name}>
              <Menu>
                <MenuTrigger asChild>
                  <button className="flex h-full min-w-0 flex-1 items-center gap-1.5 px-2 text-left text-[12.5px] font-medium text-ink-2 hover:bg-hover" title={f.description ?? undefined}>
                    <FieldIcon type={f.type} />
                    <span className="truncate">{f.name}</span>
                    <ChevronDown size={12} className="ml-auto shrink-0 text-subtle opacity-0 group-hover:opacity-100" />
                  </button>
                </MenuTrigger>
                <MenuContent>
                  {editable && (
                    <MenuItem icon={<Pencil size={15} />} onSelect={() => onEditField(f)}>
                      Edit field
                    </MenuItem>
                  )}
                  {editable && (
                    <MenuItem icon={<Plus size={15} />} onSelect={() => onAddField(f.id)}>
                      Insert field right
                    </MenuItem>
                  )}
                  {editable && <MenuSeparator />}
                  <MenuItem icon={<ArrowDownAZ size={15} />} onSelect={() => setConfig({ sorts: [{ fieldId: f.id, dir: 'asc' }] })}>
                    Sort A → Z
                  </MenuItem>
                  <MenuItem icon={<ArrowUpAZ size={15} />} onSelect={() => setConfig({ sorts: [{ fieldId: f.id, dir: 'desc' }] })}>
                    Sort Z → A
                  </MenuItem>
                  <MenuItem icon={<Filter size={15} />} onSelect={() => setConfig({ filters: { ...config.filters, conditions: [...config.filters.conditions, { id: `f${Date.now().toString(36)}`, fieldId: f.id, op: 'isNotEmpty' }] } })}>
                    Filter by this field
                  </MenuItem>
                  <MenuItem icon={<Group size={15} />} onSelect={() => setConfig({ groupBy: { fieldId: f.id, dir: 'asc' } })}>
                    Group by this field
                  </MenuItem>
                  {f.id !== table.primaryFieldId && (
                    <MenuItem icon={<EyeOff size={15} />} onSelect={() => setConfig({ hidden: [...config.hidden, f.id] })}>
                      Hide field
                    </MenuItem>
                  )}
                  {editable && f.id !== table.primaryFieldId && (
                    <>
                      <MenuSeparator />
                      <MenuItem
                        icon={<Trash2 size={15} />}
                        danger
                        onSelect={() => {
                          if (window.confirm(`Delete the field "${f.name}" and its values?`)) a.deleteField.mutate(f.id);
                        }}
                      >
                        Delete field
                      </MenuItem>
                    </>
                  )}
                </MenuContent>
              </Menu>
              <span onMouseDown={(e) => resize(f, e)} className="absolute inset-y-0 -right-1 z-10 w-2 cursor-col-resize hover:bg-brand-400/40" data-testid="col-resize" />
            </div>
          ))}
          {editable && (
            <button onClick={() => onAddField(fields[fields.length - 1]?.id ?? null)} className="flex w-12 shrink-0 items-center justify-center text-muted hover:bg-hover" aria-label="Add field" data-testid="add-field">
              <Plus size={16} />
            </button>
          )}
        </div>

        {/* Rows (only those near the screen) */}
        <div className="relative" style={{ height: rows.height, flex: '1 0 auto' }}>
          {visible.map((d) => {
            if (d.kind === 'group') {
              const gf = table.fields.find((f) => f.id === config.groupBy?.fieldId);
              return (
                <div key={`g${d.g.key}`} className="absolute left-0 flex items-end border-b border-line bg-canvas/70" style={{ top: d.top, height: d.h, width: totalW }} data-testid="group-row">
                  <button
                    onClick={() =>
                      setFolded((v) => {
                        const n = new Set(v);
                        if (!n.delete(d.g.key)) n.add(d.g.key);
                        return n;
                      })
                    }
                    className="sticky left-0 flex items-center gap-2 px-3 pb-2 text-[13px]"
                  >
                    {folded.has(d.g.key) ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                    <span className="text-[11.5px] text-muted">{gf?.name}</span>
                    {d.g.color ? <ChoicePill name={d.g.label} color={d.g.color} /> : <b className="font-medium text-ink">{d.g.label}</b>}
                    <span className="text-[12px] text-muted">{d.g.records.length}</span>
                  </button>
                </div>
              );
            }
            if (d.kind === 'add')
              return (
                <button key={`add${d.group?.key ?? ''}`} onClick={() => void addRecord(d.group)} className="absolute left-0 flex items-center gap-1.5 border-b border-line px-3 text-[13px] text-muted hover:bg-hover hover:text-ink" style={{ top: d.top, height: d.h, width: totalW }} data-testid="add-record">
                  <Plus size={14} /> {d.group ? `Add to ${d.group.label}` : 'Add record'}
                </button>
              );
            const r = d.r;
            const isChecked = checked.has(r.id);
            return (
              <div
                key={r.id}
                className={cn('group/row absolute left-0 flex border-b border-line', isChecked ? 'bg-brand-50/60' : 'bg-surface hover:bg-hover/50', dropAt?.id === r.id && (dropAt.after ? 'shadow-[inset_0_-2px_0_#3b82f6]' : 'shadow-[inset_0_2px_0_#3b82f6]'))}
                style={{ top: d.top, height: d.h, width: totalW }}
                onContextMenu={(e) => (e.preventDefault(), setMenu({ x: e.clientX, y: e.clientY, recordId: r.id }))}
                onDragOver={(e) => {
                  if (!dragRow) return;
                  e.preventDefault();
                  const box = e.currentTarget.getBoundingClientRect();
                  setDropAt({ id: r.id, after: e.clientY > box.top + box.height / 2 });
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragRow && dropAt && dragRow !== r.id) {
                    const others = flat.filter((x) => x.id !== dragRow);
                    const j = others.findIndex((x) => x.id === r.id);
                    a.moveRecord.mutate({ tableId: table.id, id: dragRow, afterId: dropAt.after ? r.id : (others[j - 1]?.id ?? null), beforeId: dropAt.after ? (others[j + 1]?.id ?? null) : r.id });
                  }
                  setDragRow(null);
                  setDropAt(null);
                }}
                data-testid="grid-row"
                data-record={r.id}
              >
                <div className={cn('sticky left-0 z-[5] flex shrink-0 items-center gap-1 border-r border-line pl-1.5 text-[11.5px] text-muted', isChecked ? 'bg-brand-50' : 'bg-surface group-hover/row:bg-hover')} style={{ width: NUM_W }}>
                  {manualOrder && editable ? (
                    <span draggable onDragStart={(e) => (setDragRow(r.id), e.dataTransfer.setData('text/plain', r.id))} onDragEnd={() => (setDragRow(null), setDropAt(null))} className="cursor-grab opacity-0 group-hover/row:opacity-100" aria-label="Drag to reorder">
                      <GripVertical size={13} />
                    </span>
                  ) : (
                    <span className="w-[13px]" />
                  )}
                  {editable ? (
                    <>
                      <span className={cn('w-5 text-center tabular-nums', 'group-hover/row:hidden', isChecked && 'hidden')}>{d.i + 1}</span>
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() =>
                          setChecked((v) => {
                            const n = new Set(v);
                            if (!n.delete(r.id)) n.add(r.id);
                            return n;
                          })
                        }
                        className={cn('accent-brand-600', !isChecked && 'hidden group-hover/row:block')}
                        aria-label="Select record"
                      />
                    </>
                  ) : (
                    <span className="w-5 text-center tabular-nums">{d.i + 1}</span>
                  )}
                  <button onClick={() => onExpand(r.id)} className="ml-auto mr-1 rounded p-0.5 text-brand-600 opacity-0 hover:bg-brand-50 group-hover/row:opacity-100" aria-label="Expand record" data-testid="expand-record">
                    <Maximize2 size={13} />
                  </button>
                  {r.commentCount > 0 && (
                    <span className="absolute right-0.5 top-0.5 flex items-center gap-0.5 text-[10px] text-brand-600 group-hover/row:hidden" title={`${r.commentCount} comments`}>
                      <MessageSquare size={10} />
                      {r.commentCount}
                    </span>
                  )}
                </div>
                {fields.map((f, c) => {
                  const v = cellValue(f, r, ctx);
                  const isActive = active?.row === d.i && active.col === c;
                  const sel = inRange(d.i, c);
                  return (
                    <div
                      key={f.id}
                      className={cn(
                        'relative flex shrink-0 border-r border-line px-2 text-[13px] text-ink',
                        rowH > 32 ? 'items-start py-1.5' : 'items-center',
                        isNumeric(f.type) || (f.type === 'formula' && typeof v === 'number') ? 'justify-end' : '',
                        f.type === 'checkbox' && 'justify-center',
                        sticky(c) && cn('sticky z-[4]', isChecked ? 'bg-brand-50' : 'bg-surface group-hover/row:bg-hover'),
                        sel && !isActive && 'bg-brand-50',
                        isActive && 'z-[6] outline outline-2 -outline-offset-2 outline-brand-500',
                        COMPUTED_TYPES.includes(f.type) && 'text-ink-2',
                      )}
                      style={{ width: widthOf(f), ...(sticky(c) ? { left: NUM_W } : {}) }}
                      onMouseDown={(e) => {
                        if (e.button !== 0) return;
                        scroller.current?.focus({ preventScroll: true });
                        if (e.shiftKey && active) {
                          setAnchor(anchor ?? active);
                          setActive({ row: d.i, col: c });
                        } else {
                          if (isActive && PICKERS.includes(f.type)) startEdit({ row: d.i, col: c });
                          setActive({ row: d.i, col: c });
                          setAnchor(null);
                        }
                      }}
                      onDoubleClick={() => startEdit({ row: d.i, col: c })}
                      data-testid="grid-cell"
                      data-field={f.name}
                    >
                      <div className={cn('min-w-0 overflow-hidden', rowH > 32 ? 'max-h-full' : '', f.type === 'longText' && rowH > 32 && 'line-clamp-3 whitespace-pre-wrap')}>
                        <CellView
                          field={f}
                          value={v}
                          ctx={ctx}
                          baseId={baseId}
                          wrap={rowH > 56}
                          onToggle={editable && f.type === 'checkbox' ? () => write([{ id: r.id, values: { [f.id]: !r.values[f.id] } }]) : undefined}
                          onRate={editable && f.type === 'rating' ? (n) => write([{ id: r.id, values: { [f.id]: n || null } }]) : undefined}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}

          {/* The cell being edited */}
          {editRec && editField && editRow && colIndex >= 0 && (
            <div
              className={cn('absolute z-30', !PICKERS.includes(editField.type) && 'outline outline-2 outline-brand-500')}
              style={
                PICKERS.includes(editField.type)
                  ? { top: editRow.top + rowH, left: sticky(colIndex) ? scroll.left + NUM_W : left(colIndex) }
                  : { top: editRow.top, left: sticky(colIndex) ? scroll.left + NUM_W : left(colIndex), width: widthOf(editField), height: rowH }
              }
            >
              <CellEditor
                key={`${editRec.id}${editField.id}`}
                field={editField}
                value={editRec.values[editField.id]}
                ctx={ctx}
                baseId={baseId}
                seed={editing?.seed}
                onCommit={(raw, move) => commit(editRec, editField, raw, move)}
                onCancel={() => (setEditing(null), scroller.current?.focus())}
              />
            </div>
          )}
        </div>

        {/* Summaries */}
        <div className="sticky bottom-0 z-20 flex border-t border-line bg-canvas" style={{ height: FOOT_H, width: totalW }} data-testid="grid-footer">
          <div className="sticky left-0 z-10 flex shrink-0 items-center border-r border-line bg-canvas pl-2 text-[11.5px] text-muted" style={{ width: NUM_W }} data-testid="record-count">
            {flat.length} {flat.length === 1 ? 'record' : 'records'}
          </div>
          {fields.map((f, c) => {
            const s = summaryOf(f);
            const numeric = ['number', 'currency', 'percent', 'rating', 'formula', 'autoNumber'].includes(f.type);
            const opts: Summary[] = ['none', 'count', 'filled', 'empty', ...(numeric ? (['sum', 'avg', 'min', 'max'] as Summary[]) : []), ...(f.type === 'checkbox' ? (['checked'] as Summary[]) : [])];
            return (
              <Menu key={f.id}>
                <MenuTrigger asChild>
                  <button className={cn('flex shrink-0 items-center justify-end gap-1 border-r border-line bg-canvas px-2 text-[12px] hover:bg-hover', sticky(c) && 'sticky z-10')} style={{ width: widthOf(f), ...(sticky(c) ? { left: NUM_W } : {}) }} data-testid="summary" data-field={f.name}>
                    {s === 'none' ? (
                      <span className="text-subtle opacity-0 hover:opacity-100">Summarize</span>
                    ) : (
                      <>
                        <span className="text-muted">{s === 'avg' ? 'Average' : s === 'filled' ? 'Filled' : s === 'empty' ? 'Empty' : s === 'checked' ? 'Checked' : s[0].toUpperCase() + s.slice(1)}</span>
                        <b className="font-medium tabular-nums text-ink">{summarize(f, flat, ctx, s)}</b>
                      </>
                    )}
                  </button>
                </MenuTrigger>
                <MenuContent>
                  {opts.map((o) => (
                    <MenuItem key={o} onSelect={() => setConfig({ summaries: { ...(config.summaries ?? {}), [f.id]: o } })}>
                      {o === 'none' ? 'None' : o === 'avg' ? 'Average' : o[0].toUpperCase() + o.slice(1)}
                    </MenuItem>
                  ))}
                </MenuContent>
              </Menu>
            );
          })}
        </div>
      </div>

      {/* Selection bar */}
      {editable && checked.size > 0 && (
        <div className="sticky bottom-10 left-1/2 z-30 mx-auto flex w-fit -translate-x-0 items-center gap-3 rounded-full bg-ink px-4 py-2 text-[13px] text-white shadow-lg" data-testid="selection-bar">
          {checked.size} selected
          <button onClick={() => remove([...checked])} className="flex items-center gap-1 rounded-full bg-red-500 px-3 py-1 hover:bg-red-600" data-testid="delete-selected">
            <Trash2 size={13} /> Delete
          </button>
          <button onClick={() => setChecked(new Set())} className="text-white/70 hover:text-white">
            Clear
          </button>
        </div>
      )}

      {/* Row menu */}
      {menu && (
        <RowMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            { label: 'Expand record', icon: <Maximize2 size={14} />, run: () => onExpand(menu.recordId) },
            ...(editable
              ? [
                  {
                    label: 'Insert record above',
                    icon: <Plus size={14} />,
                    run: () => {
                      const i = flat.findIndex((x) => x.id === menu.recordId);
                      void addRecord(null, flat[i - 1]?.id ?? null);
                    },
                  },
                  { label: 'Insert record below', icon: <Plus size={14} />, run: () => void addRecord(null, menu.recordId) },
                  {
                    label: 'Duplicate record',
                    icon: <Copy size={14} />,
                    run: () => {
                      const r = flat.find((x) => x.id === menu.recordId)!;
                      const values = Object.fromEntries(Object.entries(r.values).filter(([k]) => !COMPUTED_TYPES.includes(table.fields.find((f) => f.id === k)?.type ?? 'text')));
                      a.createRecords.mutate({ tableId: table.id, records: [{ values, afterId: r.id }] });
                    },
                  },
                  { label: checked.has(menu.recordId) && checked.size > 1 ? `Delete ${checked.size} records` : 'Delete record', icon: <Trash2 size={14} />, danger: true, run: () => remove(checked.has(menu.recordId) ? [...checked] : [menu.recordId]) },
                ]
              : []),
          ]}
        />
      )}
    </div>
  );
}

function RowMenu({ x, y, items, onClose }: { x: number; y: number; items: { label: string; icon: React.ReactNode; run: () => void; danger?: boolean }[]; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const away = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && onClose();
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => (document.removeEventListener('mousedown', away), document.removeEventListener('keydown', esc));
  }, [onClose]);
  return (
    <div ref={box} className="fixed z-50 w-52 rounded-lg border border-line bg-surface p-1 shadow-xl" style={{ left: x, top: y }} role="menu" data-testid="row-menu">
      {items.map((i) => (
        <button key={i.label} role="menuitem" onClick={() => (i.run(), onClose())} className={cn('flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] hover:bg-hover', i.danger && 'text-red-600')}>
          {i.icon} {i.label}
        </button>
      ))}
    </div>
  );
}
