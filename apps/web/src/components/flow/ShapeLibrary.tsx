'use client';

import { SHAPE_CATEGORIES, SHAPES, searchShapes, styleFor, type ShapeDef } from '@workos/flow-model';
import { ChevronDown, ChevronRight, Info, Search } from 'lucide-react';
import { useState } from 'react';
import { ICON_COMPONENTS, NodeShape } from './render';

/** Categories folded by default: the everyday ones stay open. */
const FOLDED = ['BPMN Events', 'BPMN Activities', 'BPMN Gateways', 'BPMN Data & Artifacts', 'Swimlanes', 'Entity Relationship', 'UML', 'Arrows & Callouts', 'Icons'];

/** What each group of shapes is for — shown as the first line of the open group. */
const CATEGORY_NOTE: Record<string, string> = {
  Flowchart: 'The classic symbols: process, decision, start / end, data, documents, connectors.',
  'BPMN Events': 'BPMN 2.0 events: circles that start (thin), interrupt (double) or end (thick) a process; the symbol inside says what happens — message, timer, signal, error…',
  'BPMN Activities': 'BPMN 2.0 activities: tasks typed by who or what performs them, sub-processes, call activities and transactions.',
  'BPMN Gateways': 'BPMN 2.0 gateways: diamonds that split or join paths — exclusive (one), parallel (all), inclusive (some), event-based (first event), complex.',
  'BPMN Data & Artifacts': 'Data objects, inputs / outputs, data stores, annotations and groups: information and notes that do not change the flow.',
  Swimlanes: 'Pools (participants) and lanes (roles) that say who does each step; phases mark stages in time.',
  'Entity Relationship': 'Database design: tables with keys and attributes, joined by ER connectors (| one, < many, o optional) — plus Chen diamonds and attribute ellipses.',
  UML: 'Class, use-case, component, deployment, state, activity and sequence elements. Connectors: hollow triangle = inherits, filled diamond = owns, hollow diamond = has, dashed = depends / realizes.',
  'Basic Shapes': 'General-purpose geometry for anything the notations do not cover.',
  'Arrows & Callouts': 'Block arrows, chevrons and speech bubbles for emphasis and stage strips.',
  Text: 'Text without a frame, and sticky notes.',
};

/** Shapes to drag onto the canvas (or click to add in the middle), by category, with search over names, meanings and BPMN terms (§77). */
export function ShapeLibrary({ onAdd, onAddIcon, editable }: { onAdd: (shape: string) => void; onAddIcon: (icon: string) => void; editable: boolean }) {
  const [q, setQ] = useState('');
  const [closed, setClosed] = useState<Set<string>>(new Set(FOLDED));
  const [info, setInfo] = useState<ShapeDef | null>(null);
  const needle = q.trim().toLowerCase();
  const matches = needle ? new Set(searchShapes(needle).map((s) => s.id)) : null;
  const toggle = (c: string) =>
    setClosed((v) => {
      const n = new Set(v);
      if (!n.delete(c)) n.add(c);
      return n;
    });
  const icons = Object.keys(ICON_COMPONENTS).filter((k) => !needle || k.includes(needle));
  return (
    <aside className="relative flex w-60 shrink-0 flex-col border-r border-line bg-surface" data-testid="shape-library">
      <label className="m-3 flex h-9 items-center gap-2 rounded-lg border border-line-strong px-2.5 text-muted focus-within:border-brand-500">
        <Search size={14} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search shapes (e.g. timer, approve)…" aria-label="Search shapes" className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none" />
      </label>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        {SHAPE_CATEGORIES.map((c) => {
          const list = SHAPES.filter((s) => s.category === c && (!matches || matches.has(s.id)));
          if (!list.length) return null;
          const open = needle || !closed.has(c);
          return (
            <section key={c} className="mb-2" data-testid="shape-category" data-category={c}>
              <button onClick={() => toggle(c)} className="flex w-full items-center gap-1.5 rounded-md px-1 py-1.5 text-left text-[13px] font-semibold text-ink hover:bg-hover" aria-expanded={!!open}>
                {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />} {c}
                <span className="ml-auto text-[11px] font-normal text-muted">{list.length}</span>
              </button>
              {open && (
                <>
                  {!needle && CATEGORY_NOTE[c] && <p className="px-1 pb-1.5 text-[11px] leading-snug text-muted">{CATEGORY_NOTE[c]}</p>}
                  <div className="grid grid-cols-2 gap-2 pt-1">
                    {list.map((s) => (
                      <Tile key={s.id} s={s} editable={editable} onAdd={() => onAdd(s.id)} onInfo={() => setInfo(info?.id === s.id ? null : s)} />
                    ))}
                  </div>
                </>
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
      {info && (
        <div className="absolute inset-x-2 bottom-2 rounded-lg border border-line bg-surface p-3 shadow-lg" data-testid="shape-info">
          <div className="mb-1 flex items-start justify-between gap-2">
            <div className="text-[13px] font-semibold text-ink">{info.label}</div>
            <button onClick={() => setInfo(null)} className="text-[11.5px] text-muted hover:text-ink" aria-label="Close">
              ✕
            </button>
          </div>
          <p className="text-[12px] leading-relaxed text-ink-2">{info.description}</p>
          {info.bpmn && (
            <p className="mt-1.5 text-[11px] text-muted">
              BPMN {info.bpmn.kind}
              {info.bpmn.position ? ` · ${info.bpmn.position}` : ''}
              {info.bpmn.eventType && info.bpmn.eventType !== 'none' ? ` · ${info.bpmn.eventType}` : ''}
              {info.bpmn.direction ? ` · ${info.bpmn.direction}ing` : ''}
              {info.bpmn.taskType ? ` · ${info.bpmn.taskType}` : ''}
              {info.bpmn.gatewayType ? ` · ${info.bpmn.gatewayType}` : ''}
            </p>
          )}
          {info.keywords?.length ? <p className="mt-1 text-[11px] text-muted">Also: {info.keywords.join(', ')}</p> : null}
        </div>
      )}
    </aside>
  );
}

function Tile({ s, onAdd, onInfo, editable }: { s: ShapeDef; onAdd: () => void; onInfo: () => void; editable: boolean }) {
  // Thumbnails keep the shape's proportions inside a 64 × 40 box.
  const k = Math.min(56 / s.w, 34 / s.h);
  const w = s.w * k;
  const h = s.h * k;
  const style = styleFor(s.id);
  return (
    <div className="group relative">
      <button
        draggable={editable}
        onDragStart={(e) => {
          e.dataTransfer.setData('application/x-flow-shape', s.id);
          e.dataTransfer.effectAllowed = 'copy';
        }}
        disabled={!editable}
        onClick={onAdd}
        className="flex w-full flex-col items-center gap-1 rounded-lg px-1 py-2 ring-1 ring-line hover:bg-hover hover:ring-brand-300 disabled:cursor-default"
        title={`${s.label} — ${s.description}`}
        data-testid="shape-tile"
        data-shape={s.id}
      >
        <svg width={64} height={40} viewBox={`${-(64 - w) / 2 / k} ${-(40 - h) / 2 / k} ${64 / k} ${40 / k}`}>
          <NodeShape n={{ shape: s.id, w: s.w, h: s.h, text: '', icon: null, style: { ...style, strokeWidth: Math.max(1, style.strokeWidth) / k / 1.4, fill: s.id === 'text' || style.fill === 'transparent' ? '#f1f5f9' : style.fill } }} hideText />
        </svg>
        <span className="line-clamp-1 text-[11px] text-ink-2">{s.label}</span>
      </button>
      <button onClick={onInfo} className="absolute right-1 top-1 hidden rounded-full bg-surface/90 p-0.5 text-muted ring-1 ring-line hover:text-brand-600 group-hover:block" aria-label={`About ${s.label}`} data-testid="shape-about">
        <Info size={12} />
      </button>
    </div>
  );
}
