'use client';

import { edgeGeometry, shapeDef, shapePath, type ArrowHead, type FlowEdge, type FlowNode } from '@workos/flow-model';
import { AlertTriangle, Bell, Calendar, CheckCircle2, Clock, CreditCard, Database, FileText, Globe, Mail, MessageSquare, Phone, Settings, ShieldCheck, ShoppingCart, Star, Truck, User, Users, XCircle, type LucideIcon } from 'lucide-react';

export const ICON_COMPONENTS: Record<string, LucideIcon> = {
  'file-text': FileText,
  settings: Settings,
  calendar: Calendar,
  'check-circle': CheckCircle2,
  clock: Clock,
  mail: Mail,
  user: User,
  users: Users,
  database: Database,
  'credit-card': CreditCard,
  'shopping-cart': ShoppingCart,
  'message-square': MessageSquare,
  bell: Bell,
  'shield-check': ShieldCheck,
  truck: Truck,
  phone: Phone,
  globe: Globe,
  'alert-triangle': AlertTriangle,
  'x-circle': XCircle,
  star: Star,
};

const dashArray = (d: string, w: number) => (d === 'dashed' ? `${w * 5} ${w * 3}` : d === 'dotted' ? `${w} ${w * 2.5}` : undefined);

/** A node: outline, inner lines, icon and wrapped text, in its own coordinates (the caller translates it). */
export function NodeShape({ n, hideText }: { n: Pick<FlowNode, 'shape' | 'w' | 'h' | 'text' | 'icon' | 'style'>; hideText?: boolean }) {
  const { d, inner } = shapePath(n.shape, n.w, n.h);
  const s = n.style;
  const def = shapeDef(n.shape);
  const tb = def.textBox ?? { x: 0.04, y: 0, w: 0.92, h: 1 };
  const Icon = n.icon ? ICON_COMPONENTS[n.icon] : null;
  const sw = s.strokeWidth;
  return (
    <>
      <path d={d} fill={s.fill} fillOpacity={s.fillOpacity} stroke={s.stroke} strokeWidth={sw} strokeDasharray={dashArray(s.dash, sw || 1)} style={s.shadow ? { filter: 'drop-shadow(0 2px 4px rgba(15,23,42,0.18))' } : undefined} />
      {inner && <path d={inner} fill="none" stroke={s.stroke} strokeWidth={sw} />}
      {!hideText && (n.text || Icon) && (
        <foreignObject x={n.w * tb.x} y={n.h * tb.y} width={n.w * tb.w} height={n.h * tb.h} style={{ pointerEvents: 'none' }}>
          <div
            style={{
              width: '100%',
              height: '100%',
              display: 'flex',
              flexDirection: n.shape === 'decision' ? 'column' : 'row',
              alignItems: 'center',
              justifyContent: s.align === 'left' ? 'flex-start' : s.align === 'right' ? 'flex-end' : 'center',
              gap: n.shape === 'decision' ? 2 : 8,
              padding: n.shape === 'decision' ? '0 2px' : '2px 6px',
              boxSizing: 'border-box',
              color: s.textColor,
              fontFamily: s.fontFamily,
              fontSize: s.fontSize,
              fontWeight: s.bold ? 600 : 500,
              fontStyle: s.italic ? 'italic' : 'normal',
              textDecoration: [s.underline && 'underline', s.strike && 'line-through'].filter(Boolean).join(' ') || 'none',
              textAlign: s.align,
              lineHeight: 1.25,
              overflow: 'hidden',
              overflowWrap: 'break-word',
            }}
          >
            {Icon && <Icon size={Math.round(s.fontSize * 1.45)} color={s.stroke === 'transparent' ? s.textColor : s.stroke} strokeWidth={1.8} style={{ flexShrink: 0 }} />}
            {n.text && <span style={{ whiteSpace: 'pre-wrap' }}>{n.text}</span>}
          </div>
        </foreignObject>
      )}
    </>
  );
}

/** Arrow heads of one edge, in its colour. */
function Heads({ id, color, start, end }: { id: string; color: string; start: ArrowHead; end: ArrowHead }) {
  const head = (k: ArrowHead, which: string) =>
    k === 'none' ? null : (
      <marker key={which} id={`fa-${id}-${which}`} viewBox="0 0 10 10" refX={k === 'circle' ? 5 : 9} refY="5" markerWidth="9" markerHeight="9" orient="auto-start-reverse" markerUnits="userSpaceOnUse">
        {k === 'arrow' && <path d="M0,1 L10,5 L0,9 Z" fill={color} />}
        {k === 'open' && <path d="M1,1 L9,5 L1,9" fill="none" stroke={color} strokeWidth="1.5" />}
        {k === 'diamond' && <path d="M0,5 L5,1 L10,5 L5,9 Z" fill={color} />}
        {k === 'circle' && <circle cx="5" cy="5" r="3.5" fill={color} />}
      </marker>
    );
  return (
    <defs>
      {head(start, 's')}
      {head(end, 'e')}
    </defs>
  );
}

/** An edge between two nodes with its label. */
export function EdgeShape({ e, a, b, selected, labelEditing }: { e: FlowEdge; a: FlowNode; b: FlowNode; selected?: boolean; labelEditing?: boolean }) {
  const g = edgeGeometry(e, a, b);
  const s = e.style;
  const color = selected ? '#2563eb' : s.stroke;
  const mid = `${e.id}${selected ? 'x' : ''}`;
  return (
    <g data-testid="flow-edge" data-edge={e.id}>
      <Heads id={mid} color={color} start={s.startArrow} end={s.endArrow} />
      <path d={g.d} fill="none" stroke={color} strokeWidth={selected ? s.strokeWidth + 1 : s.strokeWidth} strokeDasharray={dashArray(s.dash, s.strokeWidth)} markerEnd={s.endArrow === 'none' ? undefined : `url(#fa-${mid}-e)`} markerStart={s.startArrow === 'none' ? undefined : `url(#fa-${mid}-s)`} />
      {e.label && !labelEditing && (
        <g transform={`translate(${g.label.x},${g.label.y})`} data-testid="edge-label">
          <rect x={-(e.label.length * 3.6 + 10)} y={-11} width={e.label.length * 7.2 + 20} height={22} rx={11} fill={/^(yes|ok|true)$/i.test(e.label) ? '#dcfce7' : /^(no|false)$/i.test(e.label) ? '#fee2e2' : '#f1f5f9'} stroke="#e2e8f0" />
          <text textAnchor="middle" dominantBaseline="central" fontSize={12} fill="#1f2937" fontFamily="Inter, sans-serif">
            {e.label}
          </text>
        </g>
      )}
    </g>
  );
}
