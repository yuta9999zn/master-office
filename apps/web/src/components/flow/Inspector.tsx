'use client';

import { FONTS, PALETTE, SHAPES, STATUS_LABEL, TRIGGERS, type ArrowHead, type FlowEdge, type FlowNode, type FlowStatus, type NodeStyle, type PlainFlow } from '@workos/flow-model';
import type { UserSummary } from '@workos/shared';
import { AlignCenter, AlignHorizontalJustifyCenter, AlignHorizontalJustifyEnd, AlignHorizontalJustifyStart, AlignLeft, AlignRight, AlignVerticalJustifyCenter, AlignVerticalJustifyEnd, AlignVerticalJustifyStart, ArrowDownToLine, ArrowUpToLine, Bold, Italic, Plus, Strikethrough, Underline, X } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Avatar, cn } from '../ui/primitives';
import type { FlowStore } from './flow-store';
import type { Selection } from './FlowCanvas';
import { ICON_COMPONENTS } from './render';

const field = 'h-8 w-full rounded-md border border-line-strong bg-surface px-2 text-[12.5px] text-ink outline-none focus:border-brand-500 disabled:bg-canvas';
const Row = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="space-y-1">
    <p className="text-[12px] font-medium text-ink-2">{label}</p>
    {children}
  </div>
);
const Toggle = ({ on, onClick, label, children, disabled }: { on: boolean; onClick: () => void; label: string; children: ReactNode; disabled?: boolean }) => (
  <button disabled={disabled} onClick={onClick} aria-label={label} aria-pressed={on} title={label} className={cn('grid h-8 flex-1 place-items-center rounded-md ring-1 ring-line', on ? 'bg-selected text-brand-700 ring-brand-300' : 'text-ink-2 hover:bg-hover')}>
    {children}
  </button>
);

/** A colour swatch + hex field. */
function Color({ value, onChange, label, disabled }: { value: string; onChange: (v: string) => void; label: string; disabled?: boolean }) {
  const [hex, setHex] = useState(value);
  useEffect(() => setHex(value), [value]);
  return (
    <div className="flex gap-1.5">
      <label className="relative size-8 shrink-0 cursor-pointer overflow-hidden rounded-md ring-1 ring-line-strong" style={{ background: value === 'transparent' ? 'repeating-conic-gradient(#e2e8f0 0 25%, #fff 0 50%) 0 0/8px 8px' : value }}>
        <input type="color" disabled={disabled} value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#ffffff'} onChange={(e) => onChange(e.target.value)} className="absolute inset-0 opacity-0" aria-label={label} />
      </label>
      <input disabled={disabled} value={hex} onChange={(e) => setHex(e.target.value)} onBlur={() => (/^#[0-9a-f]{6}$|^transparent$/i.test(hex) ? onChange(hex) : setHex(value))} className={cn(field, 'font-mono uppercase')} aria-label={`${label} hex`} />
    </div>
  );
}

export function Inspector({ store, flow, sel, owner, editable }: { store: FlowStore; flow: PlainFlow; sel: Selection; owner: UserSummary | null; editable: boolean }) {
  const [tab, setTab] = useState<'style' | 'text' | 'arrange' | 'data'>('style');
  const nodes = sel.nodes.map((id) => flow.nodes.find((n) => n.id === id)).filter((n): n is FlowNode => !!n);
  const edge = !nodes.length && sel.edges.length === 1 ? flow.edges.find((e) => e.id === sel.edges[0]) : undefined;
  const first = nodes[0];
  const styleAll = (s: Partial<NodeStyle>) => store.updateNodes(nodes.map((n) => ({ id: n.id, style: s })));
  const ro = !editable;
  return (
    <aside className="flex w-[300px] shrink-0 flex-col border-l border-line bg-surface" data-testid="inspector">
      <nav className="flex border-b border-line px-2" role="tablist">
        {(['style', 'text', 'arrange', 'data'] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={cn('-mb-px border-b-2 px-3 py-2.5 text-[13px] capitalize', tab === t ? 'border-brand-600 font-semibold text-brand-700' : 'border-transparent text-muted hover:text-ink')} data-testid={`inspector-${t}`}>
            {t}
          </button>
        ))}
      </nav>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        {!first && !edge && <p className="text-[12.5px] text-muted">Select a shape or a connector to change how it looks. Drag shapes from the left, or double-click the canvas to add a step.</p>}

        {first && tab === 'style' && (
          <>
            <Row label="Shape">
              <select disabled={ro} value={first.shape} onChange={(e) => nodes.forEach((n) => store.setShape(n.id, e.target.value))} className={field} aria-label="Shape">
                {SHAPES.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.category} · {s.label}
                  </option>
                ))}
              </select>
            </Row>
            <Row label="Colour">
              <div className="flex flex-wrap gap-1.5">
                {PALETTE.map((p) => (
                  <button key={p.name} disabled={ro} onClick={() => styleAll({ fill: p.fill, stroke: p.stroke })} className={cn('size-7 rounded-md ring-2', first.style.fill === p.fill && first.style.stroke === p.stroke ? 'ring-brand-500' : 'ring-transparent')} style={{ background: p.fill, boxShadow: `inset 0 0 0 1.5px ${p.stroke}` }} title={p.name} aria-label={`${p.name} colours`} data-testid="palette" />
                ))}
              </div>
            </Row>
            <Row label="Fill">
              <div className="flex gap-1.5">
                <div className="flex-1">
                  <Color disabled={ro} value={first.style.fill} onChange={(v) => styleAll({ fill: v })} label="Fill colour" />
                </div>
                <select disabled={ro} value={first.style.fillOpacity} onChange={(e) => styleAll({ fillOpacity: Number(e.target.value) })} className={cn(field, 'w-20')} aria-label="Fill opacity">
                  {[1, 0.75, 0.5, 0.25, 0].map((o) => (
                    <option key={o} value={o}>
                      {o * 100}%
                    </option>
                  ))}
                </select>
              </div>
            </Row>
            <Row label="Border">
              <div className="flex gap-1.5">
                <div className="flex-1">
                  <Color disabled={ro} value={first.style.stroke} onChange={(v) => styleAll({ stroke: v })} label="Border colour" />
                </div>
                <select disabled={ro} value={first.style.strokeWidth} onChange={(e) => styleAll({ strokeWidth: Number(e.target.value) })} className={cn(field, 'w-20')} aria-label="Border width">
                  {[0, 1, 1.5, 2, 3, 4].map((w) => (
                    <option key={w} value={w}>
                      {w} px
                    </option>
                  ))}
                </select>
              </div>
            </Row>
            <Row label="Line style">
              <select disabled={ro} value={first.style.dash} onChange={(e) => styleAll({ dash: e.target.value as NodeStyle['dash'] })} className={field} aria-label="Line style">
                <option value="solid">Solid ───</option>
                <option value="dashed">Dashed - - -</option>
                <option value="dotted">Dotted · · ·</option>
              </select>
            </Row>
            <label className="flex items-center gap-2 text-[12.5px]">
              <input type="checkbox" disabled={ro} checked={first.style.shadow} onChange={(e) => styleAll({ shadow: e.target.checked })} className="accent-brand-600" /> Shadow
            </label>
          </>
        )}

        {first && tab === 'text' && (
          <>
            {nodes.length === 1 && (
              <Row label="Text">
                <textarea disabled={ro} value={first.text} onChange={(e) => store.updateNode(first.id, { text: e.target.value })} rows={3} className="w-full rounded-md border border-line-strong p-2 text-[13px] outline-none focus:border-brand-500" aria-label="Text" />
              </Row>
            )}
            <Row label="Font">
              <div className="flex gap-1.5">
                <select disabled={ro} value={first.style.fontFamily} onChange={(e) => styleAll({ fontFamily: e.target.value })} className={field} aria-label="Font">
                  {FONTS.map((f) => (
                    <option key={f}>{f}</option>
                  ))}
                </select>
                <select disabled={ro} value={first.style.fontSize} onChange={(e) => styleAll({ fontSize: Number(e.target.value) })} className={cn(field, 'w-20')} aria-label="Font size">
                  {[10, 11, 12, 13, 14, 16, 18, 20, 24, 28, 32].map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </div>
            </Row>
            <div className="flex gap-1.5">
              <Toggle disabled={ro} on={first.style.bold} onClick={() => styleAll({ bold: !first.style.bold })} label="Bold">
                <Bold size={15} />
              </Toggle>
              <Toggle disabled={ro} on={first.style.italic} onClick={() => styleAll({ italic: !first.style.italic })} label="Italic">
                <Italic size={15} />
              </Toggle>
              <Toggle disabled={ro} on={first.style.underline} onClick={() => styleAll({ underline: !first.style.underline })} label="Underline">
                <Underline size={15} />
              </Toggle>
              <Toggle disabled={ro} on={first.style.strike} onClick={() => styleAll({ strike: !first.style.strike })} label="Strikethrough">
                <Strikethrough size={15} />
              </Toggle>
            </div>
            <Row label="Text colour">
              <Color disabled={ro} value={first.style.textColor} onChange={(v) => styleAll({ textColor: v })} label="Text colour" />
            </Row>
            <Row label="Alignment">
              <div className="flex gap-1.5">
                {(['left', 'center', 'right'] as const).map((a) => (
                  <Toggle key={a} disabled={ro} on={first.style.align === a} onClick={() => styleAll({ align: a })} label={`Align ${a}`}>
                    {a === 'left' ? <AlignLeft size={15} /> : a === 'center' ? <AlignCenter size={15} /> : <AlignRight size={15} />}
                  </Toggle>
                ))}
              </div>
            </Row>
            <Row label="Icon">
              <div className="flex flex-wrap gap-1">
                <button disabled={ro} onClick={() => store.updateNodes(nodes.map((n) => ({ id: n.id, icon: null })))} className={cn('grid size-7 place-items-center rounded-md text-[11px] ring-1', !first.icon ? 'ring-brand-500' : 'ring-line')} aria-label="No icon">
                  <X size={13} />
                </button>
                {Object.entries(ICON_COMPONENTS).map(([k, Icon]) => (
                  <button key={k} disabled={ro} onClick={() => store.updateNodes(nodes.map((n) => ({ id: n.id, icon: k })))} className={cn('grid size-7 place-items-center rounded-md ring-1', first.icon === k ? 'bg-selected ring-brand-500' : 'ring-line hover:bg-hover')} aria-label={`Icon ${k}`}>
                    <Icon size={14} />
                  </button>
                ))}
              </div>
            </Row>
          </>
        )}

        {first && tab === 'arrange' && <Arrange store={store} nodes={nodes} ro={ro} />}
        {first && tab === 'data' && nodes.length === 1 && <DataTab store={store} n={first} ro={ro} />}
        {first && tab === 'data' && nodes.length > 1 && <p className="text-[12.5px] text-muted">Select one shape to edit its data.</p>}

        {edge && <EdgeStyleEditor store={store} e={edge} ro={ro} />}

        <WorkflowInfo store={store} flow={flow} owner={owner} ro={ro} />
      </div>
    </aside>
  );
}

function Arrange({ store, nodes, ro }: { store: FlowStore; nodes: FlowNode[]; ro: boolean }) {
  const n = nodes[0];
  const num = (k: 'x' | 'y' | 'w' | 'h', label: string) => (
    <label className="block">
      <span className="text-[11px] text-muted">{label}</span>
      <input type="number" disabled={ro || nodes.length > 1} value={Math.round(n[k])} onChange={(e) => store.updateNode(n.id, { [k]: Math.max(k === 'w' || k === 'h' ? 20 : -100000, Number(e.target.value) || 0) })} className={field} aria-label={label} />
    </label>
  );
  const align = (how: string) => {
    const x0 = Math.min(...nodes.map((m) => m.x));
    const x1 = Math.max(...nodes.map((m) => m.x + m.w));
    const y0 = Math.min(...nodes.map((m) => m.y));
    const y1 = Math.max(...nodes.map((m) => m.y + m.h));
    store.updateNodes(
      nodes.map((m) => ({
        id: m.id,
        ...(how === 'left' ? { x: x0 } : how === 'center' ? { x: Math.round((x0 + x1) / 2 - m.w / 2) } : how === 'right' ? { x: x1 - m.w } : {}),
        ...(how === 'top' ? { y: y0 } : how === 'middle' ? { y: Math.round((y0 + y1) / 2 - m.h / 2) } : how === 'bottom' ? { y: y1 - m.h } : {}),
      })),
    );
  };
  const distribute = (axis: 'x' | 'y') => {
    const list = [...nodes].sort((a, b) => a[axis] - b[axis]);
    const size = axis === 'x' ? 'w' : 'h';
    const total = list.reduce((s, m) => s + m[size], 0);
    const span = list[list.length - 1][axis] + list[list.length - 1][size] - list[0][axis];
    const gap = (span - total) / (list.length - 1);
    let at = list[0][axis];
    store.updateNodes(list.map((m) => {
      const p = { id: m.id, [axis]: Math.round(at) };
      at += m[size] + gap;
      return p;
    }));
  };
  return (
    <>
      <Row label="Position and size">
        <div className="grid grid-cols-2 gap-1.5">
          {num('x', 'X')}
          {num('y', 'Y')}
          {num('w', 'Width')}
          {num('h', 'Height')}
        </div>
      </Row>
      <Row label="Order">
        <div className="flex gap-1.5">
          <Toggle disabled={ro} on={false} onClick={() => store.reorder(nodes.map((m) => m.id), 'front')} label="Bring to front">
            <ArrowUpToLine size={15} />
          </Toggle>
          <Toggle disabled={ro} on={false} onClick={() => store.reorder(nodes.map((m) => m.id), 'back')} label="Send to back">
            <ArrowDownToLine size={15} />
          </Toggle>
        </div>
      </Row>
      {nodes.length > 1 && (
        <>
          <Row label="Align">
            <div className="grid grid-cols-6 gap-1">
              {[
                ['left', <AlignHorizontalJustifyStart key="l" size={15} />],
                ['center', <AlignHorizontalJustifyCenter key="c" size={15} />],
                ['right', <AlignHorizontalJustifyEnd key="r" size={15} />],
                ['top', <AlignVerticalJustifyStart key="t" size={15} />],
                ['middle', <AlignVerticalJustifyCenter key="m" size={15} />],
                ['bottom', <AlignVerticalJustifyEnd key="b" size={15} />],
              ].map(([how, icon]) => (
                <Toggle key={how as string} disabled={ro} on={false} onClick={() => align(how as string)} label={`Align ${how}`}>
                  {icon}
                </Toggle>
              ))}
            </div>
          </Row>
          {nodes.length > 2 && (
            <div className="flex gap-1.5 text-[12px]">
              <button disabled={ro} onClick={() => distribute('x')} className="flex-1 rounded-md py-1.5 ring-1 ring-line hover:bg-hover">
                Distribute horizontally
              </button>
              <button disabled={ro} onClick={() => distribute('y')} className="flex-1 rounded-md py-1.5 ring-1 ring-line hover:bg-hover">
                Distribute vertically
              </button>
            </div>
          )}
        </>
      )}
    </>
  );
}

function DataTab({ store, n, ro }: { store: FlowStore; n: FlowNode; ro: boolean }) {
  const [k, setK] = useState('');
  const [v, setV] = useState('');
  const entries = Object.entries(n.data);
  return (
    <Row label="Properties">
      <ul className="space-y-1">
        {entries.map(([key, val]) => (
          <li key={key} className="flex items-center gap-1.5" data-testid="data-row">
            <span className="w-24 shrink-0 truncate text-[12px] text-muted">{key}</span>
            <input disabled={ro} value={val} onChange={(e) => store.updateNode(n.id, { data: { ...n.data, [key]: e.target.value } })} className={field} aria-label={key} />
            <button
              disabled={ro}
              onClick={() => {
                const next = { ...n.data };
                delete next[key];
                store.updateNode(n.id, { data: next });
              }}
              className="rounded p-1 text-muted hover:bg-hover"
              aria-label={`Remove ${key}`}
            >
              <X size={13} />
            </button>
          </li>
        ))}
      </ul>
      {!ro && (
        <form
          className="flex gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            if (!k.trim()) return;
            store.updateNode(n.id, { data: { ...n.data, [k.trim()]: v } });
            setK('');
            setV('');
          }}
        >
          <input value={k} onChange={(e) => setK(e.target.value)} placeholder="Key (e.g. Owner)" className={field} aria-label="New property" />
          <input value={v} onChange={(e) => setV(e.target.value)} placeholder="Value" className={field} aria-label="New value" />
          <button type="submit" className="grid size-8 shrink-0 place-items-center rounded-md ring-1 ring-line hover:bg-hover" aria-label="Add property">
            <Plus size={14} />
          </button>
        </form>
      )}
      {!entries.length && ro && <p className="text-[12px] text-subtle">No properties</p>}
    </Row>
  );
}

function EdgeStyleEditor({ store, e, ro }: { store: FlowStore; e: FlowEdge; ro: boolean }) {
  const arrows: ArrowHead[] = ['none', 'arrow', 'open', 'diamond', 'circle'];
  return (
    <div className="space-y-4" data-testid="edge-inspector">
      <Row label="Label">
        <input disabled={ro} value={e.label} onChange={(ev) => store.updateEdge(e.id, { label: ev.target.value })} placeholder="e.g. Yes" className={field} aria-label="Connector label" />
      </Row>
      <Row label="Line">
        <div className="flex gap-1.5">
          <div className="flex-1">
            <Color disabled={ro} value={e.style.stroke} onChange={(v) => store.updateEdge(e.id, { style: { stroke: v } })} label="Line colour" />
          </div>
          <select disabled={ro} value={e.style.strokeWidth} onChange={(ev) => store.updateEdge(e.id, { style: { strokeWidth: Number(ev.target.value) } })} className={cn(field, 'w-20')} aria-label="Line width">
            {[1, 1.5, 2, 3, 4].map((w) => (
              <option key={w} value={w}>
                {w} px
              </option>
            ))}
          </select>
        </div>
      </Row>
      <Row label="Line style">
        <div className="flex gap-1.5">
          <select disabled={ro} value={e.style.dash} onChange={(ev) => store.updateEdge(e.id, { style: { dash: ev.target.value as FlowEdge['style']['dash'] } })} className={field} aria-label="Connector line style">
            <option value="solid">Solid</option>
            <option value="dashed">Dashed</option>
            <option value="dotted">Dotted</option>
          </select>
          <select disabled={ro} value={e.style.route} onChange={(ev) => store.updateEdge(e.id, { style: { route: ev.target.value as FlowEdge['style']['route'] } })} className={field} aria-label="Routing">
            <option value="orthogonal">Elbow</option>
            <option value="straight">Straight</option>
            <option value="curved">Curved</option>
          </select>
        </div>
      </Row>
      <Row label="Arrow">
        <div className="grid grid-cols-2 gap-1.5">
          <label>
            <span className="text-[11px] text-muted">Start</span>
            <select disabled={ro} value={e.style.startArrow} onChange={(ev) => store.updateEdge(e.id, { style: { startArrow: ev.target.value as ArrowHead } })} className={field} aria-label="Start arrow">
              {arrows.map((a) => (
                <option key={a} value={a} className="capitalize">
                  {a}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="text-[11px] text-muted">End</span>
            <select disabled={ro} value={e.style.endArrow} onChange={(ev) => store.updateEdge(e.id, { style: { endArrow: ev.target.value as ArrowHead } })} className={field} aria-label="End arrow">
              {arrows.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </label>
        </div>
      </Row>
      <button disabled={ro} onClick={() => store.updateEdge(e.id, { from: e.to, to: e.from, fromSide: e.toSide, toSide: e.fromSide })} className="w-full rounded-md py-1.5 text-[12.5px] ring-1 ring-line hover:bg-hover">
        Reverse direction
      </button>
    </div>
  );
}

function WorkflowInfo({ store, flow, owner, ro }: { store: FlowStore; flow: PlainFlow; owner: UserSummary | null; ro: boolean }) {
  const [tag, setTag] = useState('');
  const [version, setVersion] = useState(flow.info.version);
  useEffect(() => setVersion(flow.info.version), [flow.info.version]);
  const i = flow.info;
  return (
    <section className="space-y-2.5 border-t border-line pt-4" data-testid="workflow-info">
      <h3 className="text-[13px] font-semibold text-ink">Workflow Info</h3>
      <div className="grid grid-cols-[70px_1fr] items-center gap-x-2 gap-y-2 text-[12.5px]">
        <span className="text-muted">Owner</span>
        <span className="flex items-center gap-1.5">{owner ? <><Avatar user={owner} size={20} /> {owner.name}</> : '—'}</span>
        <span className="text-muted">Version</span>
        <input disabled={ro} value={version} onChange={(e) => setVersion(e.target.value)} onBlur={() => version.trim() && version !== i.version && store.setInfo({ version: version.trim() })} className={field} aria-label="Version" />
        <span className="text-muted">Status</span>
        <select disabled={ro} value={i.status} onChange={(e) => store.setInfo({ status: e.target.value as FlowStatus })} className={field} aria-label="Status">
          {(Object.keys(STATUS_LABEL) as FlowStatus[]).map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
        <span className="text-muted">Trigger</span>
        <select disabled={ro} value={i.trigger} onChange={(e) => store.setInfo({ trigger: e.target.value })} className={field} aria-label="Trigger">
          {[...new Set([...TRIGGERS, i.trigger])].map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
        <span className="self-start pt-1 text-muted">Tags</span>
        <div className="flex flex-wrap gap-1">
          {i.tags.map((t) => (
            <span key={t} className="flex items-center gap-1 rounded-md bg-brand-50 px-1.5 py-0.5 text-[11.5px] text-brand-700" data-testid="flow-tag">
              {t}
              {!ro && (
                <button onClick={() => store.setInfo({ tags: i.tags.filter((x) => x !== t) })} aria-label={`Remove tag ${t}`}>
                  <X size={11} />
                </button>
              )}
            </span>
          ))}
          {!ro && (
            <input
              value={tag}
              onChange={(e) => setTag(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && tag.trim()) {
                  if (!i.tags.includes(tag.trim())) store.setInfo({ tags: [...i.tags, tag.trim()] });
                  setTag('');
                }
              }}
              placeholder="+ Add tag"
              aria-label="Add tag"
              className="h-6 w-24 rounded-md px-1 text-[11.5px] outline-none hover:bg-hover focus:bg-hover"
            />
          )}
        </div>
      </div>
    </section>
  );
}
