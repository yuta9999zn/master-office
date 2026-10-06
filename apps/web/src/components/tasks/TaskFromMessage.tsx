'use client';

import type { ChatMessage, IssueType } from '@workos/shared';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { useProjects, useTaskActions } from '@/lib/tasks';
import { Button, cn, Dialog } from '../ui/primitives';
import { IssueIcon, ISSUE_META } from './issue-bits';

/** Chat → Tasks (§76): an issue made from a message; the message gets a thread reply with the link. */
export function TaskFromMessage({ m, text, open, onClose }: { m: ChatMessage; text: string; open: boolean; onClose: () => void }) {
  const { data: projects } = useProjects();
  const writable = (projects ?? []).filter((p) => p.perms.write);
  const { create } = useTaskActions();
  const router = useRouter();
  const [projectId, setProjectId] = useState('');
  const [type, setType] = useState<IssueType>('task');
  const [title, setTitle] = useState(() => text.split('\n')[0].slice(0, 120));
  const project = writable.find((p) => p.id === projectId) ?? writable[0];
  const save = async () => {
    if (!project) return;
    const t = await create.mutateAsync({ projectId: project.id, type, title, description: text, source: { kind: 'chat', conversationId: m.conversationId, messageId: m.id } });
    onClose();
    toast.success(`Created ${t.ref}`, { action: { label: 'Open', onClick: () => router.push(`/tasks?project=${project.id}&task=${t.id}`) } });
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title="Create a task from this message"
      description="The message keeps a link to the task in its thread."
      width={480}
      footer={
        <Button variant="primary" disabled={!project || !title.trim()} loading={create.isPending} onClick={() => void save()} data-testid="task-from-message-save">
          Create
        </Button>
      }
    >
      {writable.length ? (
        <div className="space-y-3">
          <select value={project?.id ?? ''} onChange={(e) => setProjectId(e.target.value)} className="h-9 w-full rounded-lg border border-line-strong bg-surface px-2 text-[13px]" aria-label="Project">
            {writable.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.key})
              </option>
            ))}
          </select>
          <div className="flex gap-1.5" role="radiogroup" aria-label="Issue type">
            {(['task', 'story', 'bug'] as IssueType[]).map((t) => (
              <button key={t} role="radio" aria-checked={type === t} onClick={() => setType(t)} className={cn('flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12.5px] ring-1', type === t ? 'bg-selected font-semibold text-brand-700 ring-brand-200' : 'text-ink-2 ring-line hover:bg-hover')}>
                <IssueIcon type={t} size={14} /> {ISSUE_META[t].label}
              </button>
            ))}
          </div>
          <input value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Task title" className="h-10 w-full rounded-lg border border-line-strong px-3 text-[14px] outline-none focus:border-brand-500" />
          <p className="max-h-28 overflow-auto whitespace-pre-wrap rounded-lg bg-canvas px-3 py-2 text-[12.5px] text-muted">{text}</p>
        </div>
      ) : (
        <p className="text-[13px] text-muted">You can create issues only in projects you edit.</p>
      )}
    </Dialog>
  );
}
