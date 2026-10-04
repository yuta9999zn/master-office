'use client';

import { NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from '@tiptap/react';
import { Bookmark, DateChip, DROPDOWN_PRESETS, DropdownChip, formatChipDate, PlaceChip, placeUrl, type DateFormat, type DropdownOption, PlaceholderChip, EventChip, eventIcs, eventLabel, type EventInfo } from '@workos/doc-model';
import { Bookmark as BookmarkIcon, CalendarDays, ChevronDown, ExternalLink, MapPin, Plus, Trash2, X, CalendarPlus } from 'lucide-react';
import { DropdownMenu as DM, Popover } from 'radix-ui';
import { useState, type ReactNode } from 'react';
import { cn } from '../ui/primitives';

const pill = 'inline-flex items-center gap-1 rounded-full px-2 py-px align-baseline text-[0.88em] font-medium leading-[1.5]';

function ChipPopover({ trigger, children, editable }: { trigger: ReactNode; children: ReactNode; editable: boolean }) {
  if (!editable) return <>{trigger}</>;
  return (
    <Popover.Root>
      <Popover.Trigger asChild>{trigger}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="start" sideOffset={6} className="pop z-50 w-64 space-y-2 p-3 animate-pop" onCloseAutoFocus={(e) => e.preventDefault()}>
          {children}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function DateChipView({ node, updateAttributes, deleteNode, editor }: ReactNodeViewProps) {
  const date = node.attrs.date as string | null;
  const format = (node.attrs.format as DateFormat) ?? 'short';
  return (
    <NodeViewWrapper as="span" className="mo-chip-wrap" data-testid="date-chip">
      <ChipPopover
        editable={editor.isEditable}
        trigger={
          <button contentEditable={false} className={cn(pill, 'bg-slate-100 text-slate-700 hover:bg-slate-200')}>
            <CalendarDays size={12} />
            {date ? formatChipDate(date, format) : 'Pick a date'}
          </button>
        }
      >
        <input type="date" defaultValue={date ?? ''} onChange={(e) => e.target.value && updateAttributes({ date: e.target.value })} className="input h-8 w-full" aria-label="Date" />
        <select value={format} onChange={(e) => updateAttributes({ format: e.target.value })} className="input h-8 w-full" aria-label="Date format">
          <option value="short">{formatChipDate(date ?? '2026-10-03', 'short')}</option>
          <option value="long">{formatChipDate(date ?? '2026-10-03', 'long')}</option>
          <option value="iso">{formatChipDate(date ?? '2026-10-03', 'iso')}</option>
        </select>
        <button onClick={deleteNode} className="flex w-full items-center justify-center gap-1 rounded-md py-1 text-[12px] text-muted hover:bg-hover">
          <Trash2 size={12} /> Remove chip
        </button>
      </ChipPopover>
    </NodeViewWrapper>
  );
}

function DropdownChipView({ node, updateAttributes, editor }: ReactNodeViewProps) {
  const options = (node.attrs.options as DropdownOption[]) ?? [];
  const value = node.attrs.value as string | null;
  const opt = options.find((o) => o.label === value);
  const [editing, setEditing] = useState(false);
  const color = opt?.color ?? '#64748b';
  const chip = (
    <button contentEditable={false} className={cn(pill, !opt && 'border border-dashed border-slate-300')} style={opt ? { color, background: `${color}1f` } : { color: '#64748b' }} data-testid="dropdown-chip">
      {value ?? 'Select'}
      <ChevronDown size={11} />
    </button>
  );
  if (!editor.isEditable) return <NodeViewWrapper as="span" className="mo-chip-wrap">{chip}</NodeViewWrapper>;
  return (
    <NodeViewWrapper as="span" className="mo-chip-wrap">
      {editing ? (
        <Popover.Root open onOpenChange={(o) => !o && setEditing(false)}>
          <Popover.Trigger asChild>{chip}</Popover.Trigger>
          <Popover.Portal>
            <Popover.Content align="start" sideOffset={6} className="pop z-50 w-72 space-y-2 p-3 animate-pop" onCloseAutoFocus={(e) => e.preventDefault()}>
              <div className="flex items-center justify-between text-[13px] font-semibold text-ink">
                Dropdown options
                <select className="h-7 rounded-md border border-line px-1 text-[12px] font-normal" value="" onChange={(e) => e.target.value && updateAttributes({ options: DROPDOWN_PRESETS[Number(e.target.value)].options, value: null })} aria-label="Preset">
                  <option value="">Presets…</option>
                  {DROPDOWN_PRESETS.map((p, i) => (
                    <option key={p.name} value={i}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
              {options.map((o, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <input type="color" value={o.color} onChange={(e) => updateAttributes({ options: options.map((x, j) => (j === i ? { ...x, color: e.target.value } : x)) })} className="size-7 rounded border border-line p-0.5" aria-label={`Option ${i + 1} colour`} />
                  <input
                    defaultValue={o.label}
                    onBlur={(e) => {
                      const label = e.target.value.trim() || o.label;
                      updateAttributes({ options: options.map((x, j) => (j === i ? { ...x, label } : x)), ...(value === o.label ? { value: label } : {}) });
                    }}
                    className="input h-7 flex-1 text-[13px]"
                    aria-label={`Option ${i + 1}`}
                  />
                  <button onClick={() => updateAttributes({ options: options.filter((_, j) => j !== i), ...(value === o.label ? { value: null } : {}) })} className="rounded p-1 text-muted hover:bg-hover" aria-label="Remove option">
                    <X size={13} />
                  </button>
                </div>
              ))}
              <button onClick={() => updateAttributes({ options: [...options, { label: `Option ${options.length + 1}`, color: '#2563eb' }] })} className="flex items-center gap-1 text-[12px] text-brand-700 hover:underline">
                <Plus size={12} /> Add option
              </button>
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      ) : (
        <DM.Root>
          <DM.Trigger asChild>{chip}</DM.Trigger>
          <DM.Portal>
            <DM.Content align="start" className="pop z-50 min-w-44 animate-pop" onCloseAutoFocus={(e) => e.preventDefault()}>
              {options.map((o) => (
                <DM.Item key={o.label} className="menu-item" onSelect={() => updateAttributes({ value: o.label })}>
                  <span className="size-2.5 rounded-full" style={{ background: o.color }} /> {o.label}
                </DM.Item>
              ))}
              <DM.Separator className="my-1 h-px bg-line" />
              <DM.Item className="menu-item text-muted" onSelect={() => setTimeout(() => setEditing(true), 0)}>
                Edit options…
              </DM.Item>
            </DM.Content>
          </DM.Portal>
        </DM.Root>
      )}
    </NodeViewWrapper>
  );
}

function PlaceChipView({ node, updateAttributes, deleteNode, editor }: ReactNodeViewProps) {
  const name = String(node.attrs.name ?? '');
  return (
    <NodeViewWrapper as="span" className="mo-chip-wrap" data-testid="place-chip">
      <ChipPopover
        editable={editor.isEditable}
        trigger={
          <button contentEditable={false} className={cn(pill, 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100')}>
            <MapPin size={12} />
            {name || 'Place'}
          </button>
        }
      >
        <input defaultValue={name} placeholder="Place or address" onBlur={(e) => updateAttributes({ name: e.target.value.trim() })} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} className="input h-8 w-full" aria-label="Place" />
        <div className="flex gap-2">
          <a href={placeUrl(name)} target="_blank" rel="noopener noreferrer" className="flex flex-1 items-center justify-center gap-1 rounded-md bg-brand-50 py-1 text-[12px] font-medium text-brand-700 hover:bg-brand-100">
            <ExternalLink size={12} /> Open in Maps
          </a>
          <button onClick={deleteNode} className="flex items-center gap-1 rounded-md px-2 py-1 text-[12px] text-muted hover:bg-hover">
            <Trash2 size={12} /> Remove
          </button>
        </div>
      </ChipPopover>
      {!editor.isEditable && (
        <a href={placeUrl(name)} target="_blank" rel="noopener noreferrer" className="sr-only">
          Open {name} in Maps
        </a>
      )}
    </NodeViewWrapper>
  );
}

function BookmarkView() {
  return (
    <NodeViewWrapper as="span" className="mo-bookmark-wrap" contentEditable={false} title="Bookmark" data-testid="bookmark">
      <BookmarkIcon size={13} className="inline -translate-y-px text-brand-600" />
    </NodeViewWrapper>
  );
}

export const DateChipWithView = DateChip.extend({ addNodeView: () => ReactNodeViewRenderer(DateChipView) });
export const DropdownChipWithView = DropdownChip.extend({ addNodeView: () => ReactNodeViewRenderer(DropdownChipView) });
export const PlaceChipWithView = PlaceChip.extend({
  addNodeView: () => ReactNodeViewRenderer(PlaceChipView),
});
export const BookmarkWithView = Bookmark.extend({ addNodeView: () => ReactNodeViewRenderer(BookmarkView) });

/** Placeholder chip: type the real value to replace it (Enter), rename the placeholder, or remove it. §57. */
function PlaceholderChipView({ node, updateAttributes, deleteNode, editor, getPos }: ReactNodeViewProps) {
  const label = String(node.attrs.label ?? '');
  const fill = (text: string) => {
    const pos = typeof getPos === 'function' ? getPos() : null;
    if (pos == null || !text.trim()) return;
    editor.chain().focus().insertContentAt({ from: pos, to: pos + node.nodeSize }, text).run();
  };
  return (
    <NodeViewWrapper as="span" className="mo-chip-wrap" data-testid="placeholder-chip">
      <ChipPopover
        editable={editor.isEditable}
        trigger={
          <button contentEditable={false} className={cn(pill, 'border border-dashed border-slate-400 bg-transparent text-slate-500 hover:bg-hover')}>
            [{label || 'Placeholder'}]
          </button>
        }
      >
        <input autoFocus placeholder={`Enter ${label || 'a value'}`} onKeyDown={(e) => e.key === 'Enter' && fill((e.target as HTMLInputElement).value)} className="input h-8 w-full" aria-label="Replace placeholder with" />
        <input defaultValue={label} onBlur={(e) => updateAttributes({ label: e.target.value.trim() || 'Placeholder' })} className="input h-8 w-full text-[12px]" aria-label="Placeholder name" />
        <button onClick={deleteNode} className="flex items-center gap-1 self-start rounded-md px-2 py-1 text-[12px] text-muted hover:bg-hover">
          <Trash2 size={12} /> Remove
        </button>
      </ChipPopover>
    </NodeViewWrapper>
  );
}

/** Calendar event chip: what / when / where, and "Add to calendar" as an .ics file. §57. */
function EventChipView({ node, updateAttributes, deleteNode, editor }: ReactNodeViewProps) {
  const a = node.attrs as EventInfo;
  const ics = `data:text/calendar;charset=utf-8,${encodeURIComponent(eventIcs(a, String(a.title).replace(/\W+/g, '-').toLowerCase() || 'event'))}`;
  const set = (k: keyof EventInfo) => (e: { target: { value: string } }) => updateAttributes({ [k]: e.target.value || (k === 'title' ? 'Event' : k === 'location' ? '' : null) });
  return (
    <NodeViewWrapper as="span" className="mo-chip-wrap" data-testid="event-chip">
      <ChipPopover
        editable={editor.isEditable}
        trigger={
          <button contentEditable={false} className={cn(pill, 'bg-violet-50 text-violet-700 hover:bg-violet-100')}>
            <CalendarDays size={12} />
            {eventLabel(a)}
          </button>
        }
      >
        <input defaultValue={a.title} onBlur={set('title')} placeholder="Event title" className="input h-8 w-full" aria-label="Event title" />
        <div className="flex gap-1.5">
          <input type="date" defaultValue={a.date ?? ''} onChange={set('date')} className="input h-8 min-w-0 flex-1" aria-label="Event date" />
          <input type="time" defaultValue={a.start ?? ''} onChange={set('start')} className="input h-8 w-[88px]" aria-label="Start time" />
          <input type="time" defaultValue={a.end ?? ''} onChange={set('end')} className="input h-8 w-[88px]" aria-label="End time" />
        </div>
        <input defaultValue={a.location} onBlur={set('location')} placeholder="Location or meeting link" className="input h-8 w-full" aria-label="Event location" />
        <div className="flex gap-2">
          <a href={ics} download={`${a.title || 'event'}.ics`} className="flex flex-1 items-center justify-center gap-1 rounded-md bg-brand-50 py-1 text-[12px] font-medium text-brand-700 hover:bg-brand-100" data-testid="event-ics">
            <CalendarPlus size={12} /> Add to calendar
          </a>
          <button onClick={deleteNode} className="flex items-center gap-1 rounded-md px-2 py-1 text-[12px] text-muted hover:bg-hover">
            <Trash2 size={12} /> Remove
          </button>
        </div>
      </ChipPopover>
    </NodeViewWrapper>
  );
}

export const PlaceholderChipWithView = PlaceholderChip.extend({ addNodeView: () => ReactNodeViewRenderer(PlaceholderChipView) });
export const EventChipWithView = EventChip.extend({ addNodeView: () => ReactNodeViewRenderer(EventChipView) });
