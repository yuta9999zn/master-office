'use client';

import type { Contact, ContactTeam } from '@workos/shared';
import { Crown } from 'lucide-react';
import Link from 'next/link';
import { cn, Tip } from '../ui/primitives';

/** Teams first that matter here: the current one, then the ones the viewer shares, then leads (§79). */
export function orderTeams(teams: ContactTeam[], prefer?: (string | null | undefined)[]) {
  const rank = (t: ContactTeam) => {
    const i = (prefer ?? []).indexOf(t.id);
    return i >= 0 ? i : 100 + (t.lead ? 0 : 1);
  };
  return [...teams].sort((a, b) => rank(a) - rank(b));
}

export const teamLabel = (t: ContactTeam) => `${t.name}${t.title ? ` · ${t.title}` : ''}`;

/** "Operations · Head of Operations" chips, with a crown for teams the person leads; "+n" for the rest. */
export function TeamTags({ teams, prefer, max = 3, links, className }: { teams: ContactTeam[]; prefer?: (string | null | undefined)[]; max?: number; links?: boolean; className?: string }) {
  if (!teams.length) return null;
  const list = orderTeams(teams, prefer);
  const shown = list.slice(0, max);
  const rest = list.slice(max);
  const chip = (t: ContactTeam) => (
    <span key={t.id} className="inline-flex max-w-full items-center gap-1 rounded-md bg-canvas px-1.5 py-0.5 text-[11.5px] text-ink-2 ring-1 ring-line" title={t.lead ? `Leads ${t.name}` : undefined} data-testid="team-tag">
      <span className="size-2 shrink-0 rounded-full" style={{ background: t.color ?? '#94a3b8' }} />
      {t.lead && <Crown size={11} className="shrink-0 text-amber-500" aria-label="Lead" />}
      <span className="truncate">{teamLabel(t)}</span>
    </span>
  );
  return (
    <span className={cn('flex flex-wrap items-center gap-1', className)}>
      {shown.map((t) =>
        links ? (
          <Link key={t.id} href={`/spaces/${t.id}`} className="max-w-full hover:opacity-80">
            {chip(t)}
          </Link>
        ) : (
          chip(t)
        ),
      )}
      {rest.length > 0 && (
        <Tip label={rest.map(teamLabel).join(', ')}>
          <span className="rounded-md px-1 text-[11.5px] text-muted">+{rest.length}</span>
        </Tip>
      )}
    </span>
  );
}

/** A small card for a person in chat: title, teams and positions (§79). */
export function PersonSummary({ c, prefer }: { c: Contact; prefer?: (string | null | undefined)[] }) {
  return (
    <span className="block max-w-[320px] text-left" data-testid="person-summary">
      <span className="block text-[13px] font-semibold">{c.name}</span>
      {(c.title || c.department) && <span className="block text-[12px] opacity-80">{[c.title, c.department].filter(Boolean).join(' · ')}</span>}
      {c.projects.length > 0 && (
        <span className="mt-1 block space-y-0.5">
          {orderTeams(c.projects, prefer)
            .slice(0, 6)
            .map((t) => (
              <span key={t.id} className="flex items-center gap-1 text-[12px]">
                {t.lead ? <Crown size={11} className="text-amber-400" /> : <span className="size-[11px]" />}
                {teamLabel(t)}
              </span>
            ))}
          {c.projects.length > 6 && <span className="block text-[11px] opacity-70">+{c.projects.length - 6} more teams</span>}
        </span>
      )}
    </span>
  );
}
