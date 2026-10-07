'use client';

import { SHAPE_CATEGORIES, SHAPES, styleFor, type ShapeDef } from '@workos/flow-model';
import { ChevronDown, ChevronRight, Search } from 'lucide-react';
import { useState } from 'react';
import { ICON_COMPONENTS, NodeShape } from './render';

/** Shapes to drag onto the canvas (or click to add in the middle), by category, with search (§77). */
export function ShapeLibrary({ onAdd, onAddIcon, editable }: { onAdd: (shape: string) => void; onAddIcon: (icon: string) => void; editable: boolean }) {
  const [q, setQ] = useState('');
  const [closed, setClosed] = useState<Set<string>>(new Set(['BPMN', 'Containers', 'Icons']));
  const needle = q.trim().toLowerCase();
  const toggle = (c: string) =>
    setClosed((v) => {
      const n = new Set(v);
      if (!n.delete(c)) n.add(c);
      return n;
    });
  const icons = Object.keys(ICON_COMPONENTS).filter((k) => !needle || k.includes(needle));
  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-line bg-surface" data-testid="shape-library">
      <label className="m-3 flex h-9 items-center gap-2 rounded-lg border border-line-strong px-2.5 text-muted focus-within:border-brand-500">
        <Search size={14} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search shapes…" aria-label="Search shapes" className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none" />
      </label>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        {SHAPE_CATEGORIES.map((c) => {
          const list = SHAPES.filter((s) => s.category === c && (!needle || s.label.toLowerCase().includes(needle)));
          if (!list.length) return null;
          const open = needle || !closed.has(c);
          return (
            <section key={c} className="mb-2">
              <button onClick={() => toggle(c)} className="flex w-full items-center gap-1.5 rounded-md px-1 py-1.5 text-left text-[13px] font-semibold text-ink hover:bg-hover">
                {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />} {c}
              </button>
              {open && (
                <div className="grid grid-cols-2 gap-2 pt-1">
                  {list.map((s) => (
                    <Tile key={s.id} s={s} editable={editable} onAdd={() => onAdd(s.id)} />
                  ))}
                </div>
              )}
            </section>
          );
        })}
        {icons.length > 0 && (
          <section className="mb-2">
            <button onClick={() => toggle('Icons')} className="flex w-full items-center gap-1.5 rounded-md px-1 py-1.5 text-left text-[13px] font-semibold text-ink hover:bg-hover">
              {needle || !closed.has('Icons') ? <ChevronDown size={14} /> : <ChevronRight size={14} />} Icons
            </button>
            {(needle || !closed.has('Icons')) && (
              <div className="grid grid-cols-4 gap-1.5 pt-1">
                {icons.map((k) => {
                  const Icon = ICON_COMPONENTS[k];
                  return (
                    <button key={k} disabled={!editable} onClick={() => onAddIcon(k)} title={`Step with a ${k.replace('-', ' ')} icon`} className="grid h-11 place-items-center rounded-lg ring-1 ring-line hover:bg-hover hover:ring-brand-300" data-testid="icon-tile">
                      <Icon size={18} className="text-ink-2" />
                    </button>
                  );
                })}
              </div>
            )}
          </section>
        )}
      </div>
    </aside>
  );
}

function Tile({ s, onAdd, editable }: { s: ShapeDef; onAdd: () => void; editable: boolean }) {
  // Thumbnails keep the shape's proportions inside a 64 × 40 box.
  const k = Math.min(56 / s.w, 34 / s.h);
  const w = s.w * k;
  const h = s.h * k;
  return (
    <button
      draggable={editable}
      onDragStart={(e) => {
        e.dataTransfer.setData('application/x-flow-shape', s.id);
        e.dataTransfer.effectAllowed = 'copy';
      }}
      disabled={!editable}
      onClick={onAdd}
      className="flex flex-col items-center gap-1 rounded-lg px-1 py-2 ring-1 ring-line hover:bg-hover hover:ring-brand-300 disabled:cursor-default"
      title={`${s.label} — drag onto the canvas or click to add`}
      data-testid="shape-tile"
      data-shape={s.id}
    >
      <svg width={64} height={40} viewBox={`${-(64 - w) / 2 / k} ${-(40 - h) / 2 / k} ${64 / k} ${40 / k}`}>
        <NodeShape n={{ shape: s.id, w: s.w, h: s.h, text: '', icon: null, style: { ...styleFor(s.id), strokeWidth: Math.max(1, styleFor(s.id).strokeWidth) / k / 1.4, fill: s.id === 'text' ? '#f1f5f9' : styleFor(s.id).fill } }} hideText />
      </svg>
      <span className="text-[11.5px] text-ink-2">{s.label}</span>
    </button>
  );
}
