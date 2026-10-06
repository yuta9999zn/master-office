'use client';

import { APPROVAL_FIELD_TYPES, type ApprovalField, type ApprovalFieldType, type ApprovalStep, type ApprovalTemplate, type ApproverSource } from '@workos/shared';
import { ArrowDown, ArrowLeft, ArrowUp, Bell, GitBranch, Plus, Trash2, UserCheck, Users } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { useApprovalActions } from '@/lib/approvals';
import { useUsers } from '@/lib/queries';
import { PeoplePicker } from '../chat/NewChatDialogs';
import { Avatar, Button, cn, Dialog, Menu, MenuContent, MenuItem, MenuTrigger } from '../ui/primitives';
import { OPS, TEMPLATE_COLORS, TEMPLATE_ICONS, TemplateIcon } from './bits';

const FIELD_LABEL: Record<ApprovalFieldType, string> = {
  text: 'Short text',
  textarea: 'Paragraph',
  number: 'Number',
  money: 'Amount (money)',
  date: 'Date',
  daterange: 'Date range',
  select: 'Single choice',
  multiselect: 'Multiple choice',
  person: 'Person',
  files: 'Attachments',
};
const newId = (p: string) => `${p}${Math.random().toString(36).slice(2, 8)}`;
type Tab = 'basics' | 'form' | 'process';
type Draft = Omit<ApprovalTemplate, 'id' | 'admins' | 'canManage' | 'updatedAt'> & { admins: string[] };

const blank = (): Draft => ({
  name: '',
  description: '',
  category: 'General',
  icon: 'file-check',
  color: '#2563eb',
  fields: [{ id: newId('f'), type: 'textarea', label: 'Details', required: true }],
  steps: [{ id: newId('s'), name: 'Manager', type: 'approve', approvers: { kind: 'manager', level: 1 }, mode: 'or', condition: null }],
  onApproved: null,
  enabled: true,
  admins: [],
});

const box = 'h-9 rounded-lg border border-line-strong bg-surface px-3 text-[13.5px] outline-none focus:border-brand-600 focus:ring-3 focus:ring-brand-100';
const input = `${box} w-full`;

/** Designing a template: basics, the form, the process (docs/ARCHITECTURE.md §74). */
export function TemplateEditor({ template, canDelete, onClose }: { template: ApprovalTemplate | null; canDelete: boolean; onClose: (savedId?: string) => void }) {
  const { saveTemplate, deleteTemplate } = useApprovalActions();
  const [tab, setTab] = useState<Tab>('basics');
  const [d, setD] = useState<Draft>(() => (template ? { ...template, admins: template.admins.map((a) => a.id) } : blank()));
  const patch = (p: Partial<Draft>) => setD((x) => ({ ...x, ...p }));

  const save = async () => {
    if (!d.name.trim()) return toast.error('Give the template a name');
    const r = await saveTemplate.mutateAsync({ id: template?.id, ...d }).catch(() => null);
    if (r) {
      toast.success('Template saved');
      onClose(r.id);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="template-editor">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line px-5">
        <button onClick={() => onClose()} className="rounded-md p-1 text-muted hover:bg-hover" aria-label="Back">
          <ArrowLeft size={18} />
        </button>
        <TemplateIcon icon={d.icon} color={d.color} size={30} />
        <h2 className="text-[16px] font-semibold text-ink">{d.name || 'New template'}</h2>
        <nav className="ml-4 flex gap-1" role="tablist">
          {(['basics', 'form', 'process'] as Tab[]).map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={cn('rounded-md px-3 py-1.5 text-[13px] capitalize', tab === t ? 'bg-selected font-semibold text-brand-700' : 'text-muted hover:bg-hover')}>
              {t}
            </button>
          ))}
        </nav>
        <div className="ml-auto flex gap-2">
          {template && canDelete && (
            <Button variant="ghost" icon={<Trash2 size={15} />} onClick={() => deleteTemplate.mutate(template.id, { onSuccess: () => onClose() })}>
              Delete
            </Button>
          )}
          <Button variant="primary" loading={saveTemplate.isPending} onClick={() => void save()} data-testid="save-template">
            Save
          </Button>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-auto bg-canvas">
        <div className="mx-auto max-w-[820px] p-6">
          {tab === 'basics' && <Basics d={d} patch={patch} />}
          {tab === 'form' && <FormTab fields={d.fields} onChange={(fields) => patch({ fields })} />}
          {tab === 'process' && <ProcessTab d={d} onChange={(steps) => patch({ steps })} />}
        </div>
      </div>
    </div>
  );
}

function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('rounded-xl bg-surface p-5 ring-1 ring-line', className)}>{children}</div>;
}
function Label({ children, htmlFor }: { children: React.ReactNode; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 block text-[12.5px] font-medium text-ink-2">
      {children}
    </label>
  );
}

function Basics({ d, patch }: { d: Draft; patch: (p: Partial<Draft>) => void }) {
  const ranges = d.fields.filter((f) => f.type === 'daterange');
  return (
    <div className="space-y-4">
      <Card className="space-y-4">
        <div>
          <Label htmlFor="t-name">Name</Label>
          <input id="t-name" value={d.name} onChange={(e) => patch({ name: e.target.value })} className={input} placeholder="e.g. Equipment loan" data-testid="template-name" />
        </div>
        <div>
          <Label htmlFor="t-desc">Description</Label>
          <textarea id="t-desc" value={d.description ?? ''} onChange={(e) => patch({ description: e.target.value })} rows={2} className={cn(input, 'h-auto py-2')} />
        </div>
        <div>
          <Label htmlFor="t-cat">Category</Label>
          <input id="t-cat" list="t-cats" value={d.category} onChange={(e) => patch({ category: e.target.value })} className={cn(box, 'w-[260px]')} />
          <datalist id="t-cats">
            {['HR', 'Finance', 'Operations', 'General'].map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </div>
        <div className="flex flex-wrap gap-8">
          <div>
            <Label>Icon</Label>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(TEMPLATE_ICONS).map(([k, Icon]) => (
                <button key={k} onClick={() => patch({ icon: k })} className={cn('grid size-9 place-items-center rounded-lg ring-1', d.icon === k ? 'bg-brand-50 text-brand-700 ring-brand-300' : 'text-muted ring-line hover:bg-hover')} aria-label={k} aria-pressed={d.icon === k}>
                  <Icon size={17} />
                </button>
              ))}
            </div>
          </div>
          <div>
            <Label>Color</Label>
            <div className="flex gap-1.5">
              {TEMPLATE_COLORS.map((c) => (
                <button key={c} onClick={() => patch({ color: c })} className={cn('size-7 rounded-full ring-offset-2', d.color === c && 'ring-2 ring-ink')} style={{ background: c }} aria-label={`Color ${c}`} />
              ))}
            </div>
          </div>
        </div>
        <label className="flex items-center gap-2 text-[13.5px]">
          <input type="checkbox" checked={d.enabled} onChange={(e) => patch({ enabled: e.target.checked })} className="accent-brand-600" data-testid="template-enabled" />
          People can submit this approval
        </label>
      </Card>
      <Card>
        <Label>Template admins</Label>
        <p className="mb-2 text-[12.5px] text-muted">Besides workspace admins, they can edit this template and see all of its requests.</p>
        <PeoplePicker selected={d.admins} onChange={(admins) => patch({ admins })} includeMe />
      </Card>
      <Card>
        <Label htmlFor="t-ooo">When approved</Label>
        <select
          id="t-ooo"
          value={d.onApproved?.calendarOoo?.fieldId ?? ''}
          onChange={(e) => patch({ onApproved: e.target.value ? { calendarOoo: { fieldId: e.target.value } } : null })}
          className={cn(input, 'max-w-[420px]')}
          disabled={!ranges.length}
        >
          <option value="">Nothing else</option>
          {ranges.map((f) => (
            <option key={f.id} value={f.id}>
              Add “{f.label}” to the submitter’s calendar as Out of office
            </option>
          ))}
        </select>
        {!ranges.length && <p className="mt-1.5 text-[12px] text-subtle">Needs a date range field in the form.</p>}
      </Card>
    </div>
  );
}

function FormTab({ fields, onChange }: { fields: ApprovalField[]; onChange: (f: ApprovalField[]) => void }) {
  const set = (i: number, p: Partial<ApprovalField>) => onChange(fields.map((f, j) => (i === j ? { ...f, ...p } : f)));
  const move = (i: number, by: number) => {
    const next = [...fields];
    const [f] = next.splice(i, 1);
    next.splice(i + by, 0, f);
    onChange(next);
  };
  return (
    <div className="space-y-3" data-testid="form-tab">
      {fields.map((f, i) => (
        <Card key={f.id} className="space-y-3" >
          <div className="flex items-center gap-2" data-testid="field-card">
            <input value={f.label} onChange={(e) => set(i, { label: e.target.value })} placeholder="Question" className={cn(input, 'flex-1 font-medium')} aria-label="Field label" />
            <select value={f.type} onChange={(e) => set(i, { type: e.target.value as ApprovalFieldType, options: ['select', 'multiselect'].includes(e.target.value) ? f.options ?? ['Option 1'] : undefined })} className={cn(box, 'w-[180px]')} aria-label="Field type">
              {APPROVAL_FIELD_TYPES.map((t) => (
                <option key={t} value={t}>
                  {FIELD_LABEL[t]}
                </option>
              ))}
            </select>
            <button onClick={() => move(i, -1)} disabled={i === 0} className="rounded p-1 text-muted hover:bg-hover disabled:opacity-30" aria-label="Move up">
              <ArrowUp size={15} />
            </button>
            <button onClick={() => move(i, 1)} disabled={i === fields.length - 1} className="rounded p-1 text-muted hover:bg-hover disabled:opacity-30" aria-label="Move down">
              <ArrowDown size={15} />
            </button>
            <button onClick={() => onChange(fields.filter((_, j) => j !== i))} className="rounded p-1 text-muted hover:bg-hover" aria-label="Remove field">
              <Trash2 size={15} />
            </button>
          </div>
          {(f.type === 'select' || f.type === 'multiselect') && (
            <textarea value={(f.options ?? []).join('\n')} onChange={(e) => set(i, { options: e.target.value.split('\n') })} rows={3} className={cn(input, 'h-auto py-2')} placeholder="One option per line" aria-label="Options" />
          )}
          {f.type === 'number' && <input value={f.unit ?? ''} onChange={(e) => set(i, { unit: e.target.value })} placeholder="Unit (e.g. pcs, days)" className={cn(input, 'max-w-[220px]')} aria-label="Unit" />}
          {f.type === 'money' && (
            <select value={f.currency ?? 'JPY'} onChange={(e) => set(i, { currency: e.target.value })} className={cn(input, 'max-w-[140px]')} aria-label="Currency">
              {['JPY', 'USD', 'VND', 'EUR'].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          )}
          <label className="flex items-center gap-2 text-[13px] text-ink-2">
            <input type="checkbox" checked={f.required} onChange={(e) => set(i, { required: e.target.checked })} className="accent-brand-600" /> Required
          </label>
        </Card>
      ))}
      <Menu>
        <MenuTrigger asChild>
          <Button icon={<Plus size={15} />} data-testid="add-field">
            Add field
          </Button>
        </MenuTrigger>
        <MenuContent>
          {APPROVAL_FIELD_TYPES.map((t) => (
            <MenuItem key={t} onSelect={() => onChange([...fields, { id: newId('f'), type: t, label: FIELD_LABEL[t], required: false, ...(t === 'select' || t === 'multiselect' ? { options: ['Option 1', 'Option 2'] } : {}), ...(t === 'money' ? { currency: 'JPY' } : {}) }])}>
              {FIELD_LABEL[t]}
            </MenuItem>
          ))}
        </MenuContent>
      </Menu>
    </div>
  );
}

const SOURCE_LABEL: Record<string, string> = { users: 'Specific people', manager1: "Submitter's manager", manager2: "Manager's manager", pick: 'Chosen by the submitter', field: 'Person in a field' };
const sourceKey = (a: ApproverSource) => (a.kind === 'manager' ? `manager${a.level}` : a.kind);

function ProcessTab({ d, onChange }: { d: Draft; onChange: (s: ApprovalStep[]) => void }) {
  const steps = d.steps;
  const set = (i: number, p: Partial<ApprovalStep>) => onChange(steps.map((s, j) => (i === j ? { ...s, ...p } : s)));
  const add = (at: number, type: 'approve' | 'cc') => {
    const next = [...steps];
    next.splice(at, 0, { id: newId('s'), name: type === 'cc' ? 'CC' : 'Approval', type, approvers: type === 'cc' ? { kind: 'users', userIds: [] } : { kind: 'manager', level: 1 }, mode: 'or', condition: null });
    onChange(next);
  };
  return (
    <div className="flex flex-col items-center" data-testid="process-tab">
      <Node tone="start">Submitter</Node>
      <Adder onAdd={(t) => add(0, t)} />
      {steps.map((s, i) => (
        <div key={s.id} className="flex w-full flex-col items-center">
          <StepCard step={s} fields={d.fields} onChange={(p) => set(i, p)} onRemove={() => onChange(steps.filter((_, j) => j !== i))} />
          <Adder onAdd={(t) => add(i + 1, t)} />
        </div>
      ))}
      <Node tone="end">End</Node>
    </div>
  );
}

function Node({ tone, children }: { tone: 'start' | 'end'; children: React.ReactNode }) {
  return <div className={cn('rounded-full px-5 py-1.5 text-[13px] font-medium ring-1', tone === 'start' ? 'bg-emerald-50 text-emerald-700 ring-emerald-200' : 'bg-slate-100 text-slate-600 ring-slate-200')}>{children}</div>;
}

function Adder({ onAdd }: { onAdd: (t: 'approve' | 'cc') => void }) {
  return (
    <div className="flex flex-col items-center">
      <span className="h-4 w-px bg-line-strong" />
      <Menu>
        <MenuTrigger asChild>
          <button className="grid size-6 place-items-center rounded-full bg-brand-600 text-white shadow hover:bg-brand-700" aria-label="Add step" data-testid="add-step">
            <Plus size={14} />
          </button>
        </MenuTrigger>
        <MenuContent align="center">
          <MenuItem icon={<UserCheck size={15} />} onSelect={() => onAdd('approve')} data-testid="add-approve-step">
            Approval step
          </MenuItem>
          <MenuItem icon={<Bell size={15} />} onSelect={() => onAdd('cc')} data-testid="add-cc-step">
            CC (notify)
          </MenuItem>
        </MenuContent>
      </Menu>
      <span className="h-4 w-px bg-line-strong" />
    </div>
  );
}

function StepCard({ step: s, fields, onChange, onRemove }: { step: ApprovalStep; fields: ApprovalField[]; onChange: (p: Partial<ApprovalStep>) => void; onRemove: () => void }) {
  const { data: users } = useUsers();
  const [picking, setPicking] = useState(false);
  const [ids, setIds] = useState<string[]>(s.approvers.kind === 'users' ? s.approvers.userIds : []);
  const persons = fields.filter((f) => f.type === 'person');
  const cond = s.condition;
  const condField = fields.find((f) => f.id === cond?.fieldId);
  const chosen = s.approvers.kind === 'users' ? s.approvers.userIds.map((id) => users?.find((u) => u.id === id)).filter(Boolean) : [];
  const setSource = (k: string) => {
    const approvers: ApproverSource =
      k === 'manager1' ? { kind: 'manager', level: 1 } : k === 'manager2' ? { kind: 'manager', level: 2 } : k === 'pick' ? { kind: 'pick' } : k === 'field' ? { kind: 'field', fieldId: persons[0]?.id ?? '' } : { kind: 'users', userIds: [] };
    onChange({ approvers });
  };
  return (
    <div className={cn('w-full max-w-[560px] rounded-xl bg-surface ring-1', s.type === 'cc' ? 'ring-sky-200' : 'ring-brand-200')} data-testid="step-card">
      <div className={cn('flex items-center gap-2 rounded-t-xl px-4 py-2.5', s.type === 'cc' ? 'bg-sky-50' : 'bg-brand-50')}>
        {s.type === 'cc' ? <Bell size={15} className="text-sky-600" /> : <UserCheck size={15} className="text-brand-600" />}
        <input value={s.name} onChange={(e) => onChange({ name: e.target.value })} className="min-w-0 flex-1 bg-transparent text-[13.5px] font-semibold text-ink outline-none" aria-label="Step name" />
        <span className="text-[11.5px] text-muted">{s.type === 'cc' ? 'CC' : 'Approval'}</span>
        <button onClick={onRemove} className="rounded p-1 text-muted hover:bg-white" aria-label="Remove step">
          <Trash2 size={14} />
        </button>
      </div>
      <div className="space-y-3 p-4 text-[13px]">
        <div className="flex items-center gap-2">
          <Users size={14} className="text-muted" />
          <select value={sourceKey(s.approvers)} onChange={(e) => setSource(e.target.value)} className={cn(box, 'w-[260px]')} aria-label="Who">
            {Object.entries(SOURCE_LABEL)
              .filter(([k]) => s.type === 'approve' || k !== 'pick')
              .map(([k, v]) => (
                <option key={k} value={k} disabled={k === 'field' && !persons.length}>
                  {v}
                </option>
              ))}
          </select>
          {s.approvers.kind === 'field' && (
            <select value={s.approvers.fieldId} onChange={(e) => onChange({ approvers: { kind: 'field', fieldId: e.target.value } })} className={cn(box, 'w-[200px]')} aria-label="Person field">
              {persons.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>
          )}
        </div>
        {s.approvers.kind === 'users' && (
          <div className="flex flex-wrap items-center gap-1.5">
            {chosen.map((u) => (
              <span key={u!.id} className="inline-flex items-center gap-1.5 rounded-full bg-hover py-0.5 pl-0.5 pr-2.5 text-[12px]">
                <Avatar user={u!} size={20} /> {u!.name}
              </span>
            ))}
            <button onClick={() => (setIds(s.approvers.kind === 'users' ? s.approvers.userIds : []), setPicking(true))} className="rounded-full px-2.5 py-1 text-[12px] font-medium text-brand-700 hover:bg-brand-50" data-testid="choose-people">
              {chosen.length ? 'Change' : 'Choose people'}
            </button>
          </div>
        )}
        {s.type === 'approve' && (s.approvers.kind === 'users' || s.approvers.kind === 'pick') && (
          <div className="flex items-center gap-3">
            <span className="text-muted">With several people:</span>
            {(['or', 'and'] as const).map((m) => (
              <label key={m} className="flex items-center gap-1.5">
                <input type="radio" checked={s.mode === m} onChange={() => onChange({ mode: m })} className="accent-brand-600" /> {m === 'or' ? 'any one approves' : 'everyone approves'}
              </label>
            ))}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={!!cond} onChange={(e) => onChange({ condition: e.target.checked && fields[0] ? { fieldId: fields[0].id, op: 'gt', value: 0 } : null })} className="accent-brand-600" disabled={!fields.length} data-testid="step-condition" />
            <GitBranch size={14} className="text-muted" /> Only when
          </label>
          {cond && (
            <>
              <select value={cond.fieldId} onChange={(e) => onChange({ condition: { ...cond, fieldId: e.target.value } })} className={box} aria-label="Condition field">
                {fields
                  .filter((f) => f.type !== 'files' && f.type !== 'textarea')
                  .map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.label}
                      {f.type === 'daterange' ? ' (days)' : ''}
                    </option>
                  ))}
              </select>
              <select value={cond.op} onChange={(e) => onChange({ condition: { ...cond, op: e.target.value as typeof cond.op } })} className={box} aria-label="Condition">
                {Object.entries(OPS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
              {condField?.type === 'select' || condField?.type === 'multiselect' ? (
                <select value={String(cond.value)} onChange={(e) => onChange({ condition: { ...cond, value: e.target.value } })} className={box} aria-label="Value">
                  {condField.options?.map((o) => (
                    <option key={o}>{o}</option>
                  ))}
                </select>
              ) : (
                <input
                  value={String(cond.value)}
                  onChange={(e) => onChange({ condition: { ...cond, value: e.target.value !== '' && !Number.isNaN(Number(e.target.value)) ? Number(e.target.value) : e.target.value } })}
                  className={cn(box, 'w-28')}
                  aria-label="Value"
                />
              )}
            </>
          )}
        </div>
      </div>
      <Dialog
        open={picking}
        onOpenChange={setPicking}
        title={`Who for "${s.name}"?`}
        width={460}
        footer={
          <Button
            variant="primary"
            onClick={() => {
              onChange({ approvers: { kind: 'users', userIds: ids } });
              setPicking(false);
            }}
            data-testid="save-step-people"
          >
            Done
          </Button>
        }
      >
        <PeoplePicker selected={ids} onChange={setIds} includeMe />
      </Dialog>
    </div>
  );
}
