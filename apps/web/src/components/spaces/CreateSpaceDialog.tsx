'use client';

import { Globe, Lock } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useSpaceActions, useSpaces } from '@/lib/queries';
import { Button, cn, Dialog } from '../ui/primitives';

const COLORS = ['#2563eb', '#8b5cf6', '#f43f5e', '#f59e0b', '#10b981', '#0ea5e9', '#ec4899', '#0f172a'];

export function CreateSpaceDialog({ open, onOpenChange, parentId }: { open: boolean; onOpenChange: (v: boolean) => void; parentId?: string }) {
  const router = useRouter();
  const { create } = useSpaceActions();
  const { data: spaces } = useSpaces();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [color, setColor] = useState(COLORS[0]);
  const [visibility, setVisibility] = useState<'public' | 'private'>('public');
  const [parent, setParent] = useState<string>(parentId ?? '');

  const submit = async () => {
    const s = await create.mutateAsync({ name: name.trim(), description: description.trim() || undefined, color, visibility, parentId: parent || null });
    onOpenChange(false);
    setName('');
    setDescription('');
    router.push(`/spaces/${s.id}`);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Create space"
      description="A space groups the files, knowledge and people of one team or project."
      width={480}
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" disabled={!name.trim()} loading={create.isPending} onClick={submit}>
            Create space
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <label className="block">
          <span className="mb-1.5 block text-[12px] font-medium text-muted">Name</span>
          <input autoFocus className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Branch 700" />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-[12px] font-medium text-muted">Description</span>
          <textarea className="input h-20 resize-none py-2" value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
        <div className="flex gap-6">
          <div>
            <span className="mb-1.5 block text-[12px] font-medium text-muted">Color</span>
            <div className="flex gap-1.5">
              {COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => setColor(c)}
                  aria-label={c}
                  className={cn('size-6 rounded-md ring-offset-2 transition', color === c && 'ring-2 ring-brand-600')}
                  style={{ background: c }}
                />
              ))}
            </div>
          </div>
          <label className="flex-1">
            <span className="mb-1.5 block text-[12px] font-medium text-muted">Parent space</span>
            <select className="input" value={parent} onChange={(e) => setParent(e.target.value)}>
              <option value="">None (top level)</option>
              {spaces
                ?.filter((s) => s.myRole === 'admin' || s.myRole === 'owner')
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
            </select>
          </label>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {(
            [
              ['public', Globe, 'Public', 'Everyone in the workspace can view'],
              ['private', Lock, 'Private', 'Only members can find and view'],
            ] as const
          ).map(([v, Icon, label, hint]) => (
            <button
              key={v}
              onClick={() => setVisibility(v)}
              className={cn('rounded-xl border p-3 text-left transition', visibility === v ? 'border-brand-600 bg-brand-50' : 'border-line hover:bg-hover')}
            >
              <Icon size={16} className={visibility === v ? 'text-brand-600' : 'text-muted'} />
              <div className="mt-1.5 text-[13px] font-semibold">{label}</div>
              <div className="text-[12px] text-muted">{hint}</div>
            </button>
          ))}
        </div>
      </div>
    </Dialog>
  );
}
