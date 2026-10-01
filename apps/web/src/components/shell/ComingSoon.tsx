'use client';

import { ArrowRight, CircleCheck } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AppIcon } from '../ui/primitives';
import { appById } from '@/lib/apps';

const PLANS: Record<string, string[]> = {
  chat: ['1:1, group and project channels', 'Share any file as a live resource card — no copies', 'Threads, mentions, reactions, pinned messages', 'Realtime over WebSocket + Redis fan-out'],
  mail: ['Outlook / IMAP via Microsoft Graph connector', 'Attachments saved to Drive as resources', 'Shared inboxes per space'],
  calendar: ['Day / week / month / agenda views', 'Team calendars per space, room booking', 'Auto meeting links and email invitations', 'Sync with Google / Outlook'],
  meetings: ['Video meetings with screen share and recording', 'AI notes and summaries saved as documents'],
  tasks: ['Board (Kanban), List, Timeline, Gantt and Dashboard views', 'Task analytics: completion rate, cycle time, workload', 'Tasks linkable from chat, docs and meetings'],
  flow: ['Flowchart / BPMN / UI-block shapes with connectors', 'Workflow info: owner, version, status, trigger', 'AI Suggest to draft diagrams'],
  base: ['Tables, fields and records with views (grid, kanban, gallery, form)', 'Forms that write into bases', 'Query from AI and Sheets'],
  approvals: ['Approval flow designer', 'Request forms, multi-step approvers, audit trail'],
  contacts: ['Directory by department, skills and project', 'Profiles with organisation chart', 'External guests with scoped access'],
  admin: ['Members, departments and roles', 'Security policies, SSO, audit log', 'Storage and license management'],
  analytics: ['Workspace and task analytics dashboards'],
  ai: ['Search company knowledge (permission-aware RAG)', 'Summarize chats, docs and meetings', 'Analyze sheets, generate formulas, charts, documents and slides'],
  wiki: ['Knowledge tree per space', 'Rich pages powered by the Docs editor'],
};

/** Placeholder for apps whose module lands in a later phase (docs/ARCHITECTURE.md §16). */
export function ComingSoon({ id }: { id: string }) {
  const app = appById(id);
  if (!app) notFound();
  return (
    <div className="h-full overflow-auto bg-canvas p-8">
      <div className="card mx-auto max-w-2xl overflow-hidden">
        <div className="flex items-center gap-4 border-b border-line bg-gradient-to-r from-brand-50 to-violet-50 px-8 py-7">
          <AppIcon app={app} size={56} />
          <div>
            <h1 className="text-[22px] font-bold text-ink">{app.label}</h1>
            <p className="text-[14px] text-muted">{app.tagline}</p>
          </div>
          <span className="ml-auto rounded-full bg-white px-3 py-1 text-[12px] font-semibold text-brand-600 shadow-sm">Phase {app.phase}</span>
        </div>
        <div className="px-8 py-6">
          <p className="text-[14px] text-ink-2">
            This module is on the roadmap. The shell, permissions and the unified resource model it builds on are already live — so {app.label} will open,
            share and search the same resources as Drive.
          </p>
          <ul className="mt-5 space-y-2.5">
            {(PLANS[app.id] ?? []).map((p) => (
              <li key={p} className="flex items-start gap-2.5 text-[14px] text-ink-2">
                <CircleCheck size={17} className="mt-0.5 shrink-0 text-brand-600" />
                {p}
              </li>
            ))}
          </ul>
          <Link href="/drive" className="mt-7 inline-flex items-center gap-1.5 text-[14px] font-medium text-brand-600 hover:underline">
            Go to Drive <ArrowRight size={15} />
          </Link>
        </div>
      </div>
    </div>
  );
}
