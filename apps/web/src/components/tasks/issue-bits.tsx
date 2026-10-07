'use client';

import type { IssueType, Methodology } from '@workos/shared';
import { Bookmark, Bug, Check, CornerDownRight, Diamond, Layers, Zap, type LucideIcon } from 'lucide-react';
import { cn } from '../ui/primitives';

/** Issue types (§76): icon and color, Jira style. */
export const ISSUE_META: Record<IssueType, { label: string; icon: LucideIcon; color: string }> = {
  phase: { label: 'Phase', icon: Layers, color: '#4f46e5' },
  epic: { label: 'Epic', icon: Zap, color: '#7c3aed' },
  story: { label: 'Story', icon: Bookmark, color: '#16a34a' },
  task: { label: 'Task', icon: Check, color: '#2563eb' },
  bug: { label: 'Bug', icon: Bug, color: '#dc2626' },
  milestone: { label: 'Milestone', icon: Diamond, color: '#d97706' },
  subtask: { label: 'Subtask', icon: CornerDownRight, color: '#0ea5e9' },
};

/** The type's name in this project: AI-DLC calls an epic a unit of work. */
export const issueLabel = (type: IssueType, m?: Methodology | null) => (type === 'epic' && m === 'ai-dlc' ? 'Unit of work' : ISSUE_META[type].label);

export function IssueIcon({ type, size = 16, className }: { type: IssueType; size?: number; className?: string }) {
  const m = ISSUE_META[type];
  const Icon = m.icon;
  return (
    <span className={cn('inline-grid shrink-0 place-items-center rounded-[4px] text-white', className)} style={{ width: size, height: size, background: m.color }} title={m.label} data-testid="issue-icon" data-type={type}>
      <Icon size={Math.round(size * 0.7)} strokeWidth={2.6} />
    </span>
  );
}

export function Points({ n }: { n: number | null }) {
  if (n === null || n === undefined) return null;
  return (
    <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-slate-200 px-1.5 text-[11px] font-semibold text-slate-700" title="Story points" data-testid="story-points">
      {n}
    </span>
  );
}
