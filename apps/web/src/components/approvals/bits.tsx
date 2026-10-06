'use client';

import type { ApprovalStatus } from '@workos/shared';
import { Briefcase, CalendarOff, ClipboardList, FileCheck, Laptop, Plane, Receipt, ShoppingCart, Users, Wallet, type LucideIcon } from 'lucide-react';
import { cn } from '../ui/primitives';

export const TEMPLATE_ICONS: Record<string, LucideIcon> = {
  'file-check': FileCheck,
  'calendar-off': CalendarOff,
  receipt: Receipt,
  'shopping-cart': ShoppingCart,
  plane: Plane,
  briefcase: Briefcase,
  laptop: Laptop,
  wallet: Wallet,
  users: Users,
  clipboard: ClipboardList,
};
export const TEMPLATE_COLORS = ['#2563eb', '#8b5cf6', '#10b981', '#f59e0b', '#0ea5e9', '#ef4444', '#ec4899', '#14b8a6'];

export function TemplateIcon({ icon, color, size = 36 }: { icon: string; color: string; size?: number }) {
  const Icon = TEMPLATE_ICONS[icon] ?? FileCheck;
  return (
    <span className="grid shrink-0 place-items-center rounded-xl text-white" style={{ width: size, height: size, background: `linear-gradient(135deg, ${color}, ${color}cc)` }}>
      <Icon size={Math.round(size * 0.5)} />
    </span>
  );
}

const STATUS: Record<ApprovalStatus, { label: string; cls: string }> = {
  pending: { label: 'In review', cls: 'bg-amber-50 text-amber-700 ring-amber-200' },
  approved: { label: 'Approved', cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  rejected: { label: 'Rejected', cls: 'bg-red-50 text-red-700 ring-red-200' },
  withdrawn: { label: 'Withdrawn', cls: 'bg-slate-100 text-slate-600 ring-slate-200' },
};

export function StatusPill({ status, className }: { status: ApprovalStatus; className?: string }) {
  const s = STATUS[status];
  return (
    <span className={cn('inline-flex h-6 shrink-0 items-center rounded-full px-2.5 text-[12px] font-medium ring-1', s.cls, className)} data-testid="status-pill" data-status={status}>
      {s.label}
    </span>
  );
}

export const OPS: Record<string, string> = { gt: 'is more than', gte: 'is at least', lt: 'is less than', lte: 'is at most', eq: 'is', neq: 'is not', in: 'is one of' };
