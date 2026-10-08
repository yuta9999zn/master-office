'use client';

import type { Resource } from '@workos/shared';
import { AlertTriangle, Database, HardDrive, PieChart, Trash2, Users } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { formatBytes, timeAgo } from '@/lib/format';
import { hrefFor } from '@/lib/resources';
import { GB, MB, meterTone, useStorageActions, useStorageReport, type StorageReport } from '@/lib/storage';
import { SpaceBadge } from '../shell/Sidebar';
import { Avatar, Button, cn, Skeleton } from '../ui/primitives';

const field = 'h-9 rounded-lg border border-line-strong bg-surface px-3 text-[13px] outline-none focus:border-brand-500';
const TB = GB * 1024;
type Unit = 'MB' | 'GB' | 'TB';
const UNITS: Record<Unit, number> = { MB, GB, TB };

/** Bytes → the largest unit that keeps a short number ("1.5 GB", "512 MB"). */
function split(bytes: number): { value: string; unit: Unit } {
  if (bytes >= TB && bytes % (TB / 100) === 0) return { value: String(+(bytes / TB).toFixed(2)), unit: 'TB' };
  if (bytes >= GB) return { value: String(+(bytes / GB).toFixed(2)), unit: 'GB' };
  return { value: String(+(bytes / MB).toFixed(2)), unit: 'MB' };
}
const toBytes = (value: string, unit: Unit) => Math.round(Number(value) * UNITS[unit]);

/** Admin → Storage (§79 C): the organisation's pool, default quotas, every person and team, the largest files. */
export function StorageAdmin() {
  const { data, isLoading } = useStorageReport();
  if (isLoading || !data) return <Skeleton className="h-96" />;
  const { org } = data;
  return (
    <section data-testid="storage-admin">
      <div className="mb-4">
        <h1 className="text-[20px] font-semibold text-ink">Storage</h1>
        <p className="mt-1 text-[13px] text-muted">
          Counted like Google Drive: files with their old versions, pictures in documents and e-mail attachments; the trash counts until it is emptied. Files in My Files count for their owner, files in a team for the team.
        </p>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat icon={<HardDrive size={18} />} label="Used by the organisation" value={formatBytes(org.used) === '—' ? '0 B' : formatBytes(org.used)} sub={org.limit === null ? 'No organisation limit' : `${org.percent}% of ${formatBytes(org.limit)}`} tone={org.warning ? 'amber' : 'brand'} testId="storage-org-used" />
        <Stat icon={<Database size={18} />} label="Organisation pool" value={org.limit === null ? 'Unlimited' : formatBytes(org.limit)} sub="Open source: the server disk is the limit" tone="violet" />
        <Stat icon={<PieChart size={18} />} label="Allocated" value={formatBytes(org.allocated) === '—' ? '0 B' : formatBytes(org.allocated)} sub={org.unlimitedParties ? `${org.unlimitedParties} with no limit` : 'Sum of every person and team quota'} tone="sky" />
        <Stat icon={<Users size={18} />} label="People · teams" value={`${data.users.length} · ${data.spaces.length}`} sub={`Defaults ${fmtLimit(data.settings.userDefaultBytes)} · ${fmtLimit(data.settings.spaceDefaultBytes)}`} tone="emerald" />
      </div>

      {org.limit !== null && org.used >= org.limit && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-[13px] text-red-700" data-testid="storage-org-full">
          <AlertTriangle size={16} /> The organisation's storage is full: nobody can upload until space is freed or the pool is raised.
        </div>
      )}

      <Defaults settings={data.settings} />

      <h2 className="mb-2 mt-6 text-[15px] font-semibold text-ink">People</h2>
      <div className="card overflow-hidden">
        <table className="w-full text-[13px]" data-testid="storage-people">
          <thead className="bg-canvas text-left text-[12px] text-muted">
            <tr>
              <th className="px-4 py-2 font-medium">Person</th>
              <th className="px-4 py-2 font-medium">Used</th>
              <th className="w-64 px-4 py-2 font-medium">Limit</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {data.users.map((r) => (
              <tr key={r.user.id} className={cn(r.status === 'suspended' && 'text-muted')} data-testid="storage-person" data-email={r.user.email} data-percent={r.percent ?? ''}>
                <td className="px-4 py-2">
                  <div className="flex items-center gap-2.5">
                    <Avatar user={r.user} size={28} />
                    <div className="min-w-0">
                      <div className="truncate font-medium text-ink">{r.user.name}</div>
                      <div className="truncate text-[11.5px] text-muted">{r.files} file{r.files === 1 ? '' : 's'}</div>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-2">
                  <Meter used={r.used} limit={r.limit} percent={r.percent} />
                </td>
                <td className="px-4 py-2">
                  <LimitCell kind="users" id={r.user.id} name={r.user.name} limit={r.limit} override={r.override} fallback={data.settings.userDefaultBytes} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="mb-2 mt-6 text-[15px] font-semibold text-ink">Teams</h2>
      <div className="card overflow-hidden">
        <table className="w-full text-[13px]" data-testid="storage-teams">
          <thead className="bg-canvas text-left text-[12px] text-muted">
            <tr>
              <th className="px-4 py-2 font-medium">Team</th>
              <th className="px-4 py-2 font-medium">Used</th>
              <th className="w-64 px-4 py-2 font-medium">Limit</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {data.spaces.map((r) => (
              <tr key={r.space.id} data-testid="storage-team" data-name={r.space.name} data-percent={r.percent ?? ''}>
                <td className="px-4 py-2">
                  <div className="flex items-center gap-2.5">
                    <SpaceBadge space={r.space} size={26} />
                    <div className="min-w-0">
                      <div className="truncate font-medium text-ink">{r.space.name}</div>
                      <div className="truncate text-[11.5px] capitalize text-muted">{r.space.kind} · {r.files} file{r.files === 1 ? '' : 's'}</div>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-2">
                  <Meter used={r.used} limit={r.limit} percent={r.percent} />
                </td>
                <td className="px-4 py-2">
                  <LimitCell kind="spaces" id={r.space.id} name={r.space.name} limit={r.limit} override={r.override} fallback={data.settings.spaceDefaultBytes} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="mb-2 mt-6 text-[15px] font-semibold text-ink">Largest files</h2>
      <ul className="card divide-y divide-line" data-testid="storage-largest">
        {data.largest.length === 0 && <li className="px-4 py-3 text-[13px] text-muted">No files yet.</li>}
        {data.largest.map((f) => (
          <li key={f.id} className="flex items-center gap-3 px-4 py-2 text-[13px]">
            <div className="min-w-0 flex-1">
              <Link href={hrefFor({ id: f.id, type: f.type as Resource['type'], metadata: {} })} className="truncate font-medium text-ink hover:text-brand-600">
                {f.name}
              </Link>
              <div className="truncate text-[11.5px] text-muted">
                {f.space ? `Team ${f.space.name}` : f.owner ? `My Files of ${f.owner.name}` : ''} · edited {timeAgo(f.updatedAt)}
                {f.trashed && (
                  <span className="ml-2 inline-flex items-center gap-1 text-amber-700">
                    <Trash2 size={11} /> in trash
                  </span>
                )}
              </div>
            </div>
            <span className="tabular-nums text-ink-2">{formatBytes(f.sizeBytes)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

const fmtLimit = (n: number | null) => (n === null ? 'unlimited' : formatBytes(n));

function Stat({ icon, label, value, sub, tone, testId }: { icon: React.ReactNode; label: string; value: string; sub?: string; tone: 'brand' | 'amber' | 'violet' | 'sky' | 'emerald'; testId?: string }) {
  const tones = { brand: 'bg-brand-50 text-brand-600', amber: 'bg-amber-50 text-amber-600', violet: 'bg-violet-50 text-violet-600', sky: 'bg-sky-50 text-sky-600', emerald: 'bg-emerald-50 text-emerald-600' };
  return (
    <div className="card flex items-start gap-3 p-4" data-testid={testId}>
      <span className={cn('grid size-9 shrink-0 place-items-center rounded-xl', tones[tone])}>{icon}</span>
      <div className="min-w-0">
        <div className="text-[12px] text-muted">{label}</div>
        <div className="truncate text-[18px] font-semibold text-ink">{value}</div>
        {sub && <div className="truncate text-[11.5px] text-muted">{sub}</div>}
      </div>
    </div>
  );
}

export function Meter({ used, limit, percent, compact }: { used: number; limit: number | null; percent: number | null; compact?: boolean }) {
  const full = limit !== null && used >= limit;
  return (
    <div className={cn('min-w-0', compact ? '' : 'max-w-xs')}>
      <div className="flex items-baseline justify-between gap-2 text-[12px]">
        <span className={cn('tabular-nums', full ? 'font-medium text-red-600' : 'text-ink-2')}>
          {used ? formatBytes(used) : '0 B'}
          {limit !== null && <span className="text-muted"> of {formatBytes(limit)}</span>}
        </span>
        {percent !== null && <span className={cn('tabular-nums', full ? 'text-red-600' : percent >= 80 ? 'text-amber-600' : 'text-muted')}>{percent}%</span>}
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-line">
        <div className={cn('h-full rounded-full transition-all', limit === null ? 'bg-brand-300' : meterTone({ percent, full }))} style={{ width: limit === null ? (used ? '12%' : '0%') : `${Math.max(used ? 2 : 0, Math.min(100, percent ?? 0))}%` }} />
      </div>
    </div>
  );
}

/** A number + unit pair with an "unlimited" switch; `value` null = unlimited. */
function BytesInput({ value, onChange, label, allowUnlimited = true }: { value: number | null; onChange: (v: number | null) => void; label: string; allowUnlimited?: boolean }) {
  const [draft, setDraft] = useState(() => (value === null ? { value: '', unit: 'GB' as Unit } : split(value)));
  useEffect(() => setDraft(value === null ? { value: '', unit: 'GB' } : split(value)), [value]);
  const unlimited = value === null;
  return (
    <div className="flex items-center gap-2">
      <input
        type="number"
        min={0}
        step="any"
        value={unlimited ? '' : draft.value}
        placeholder={unlimited ? '∞' : ''}
        disabled={unlimited}
        onChange={(e) => {
          setDraft({ ...draft, value: e.target.value });
          if (e.target.value !== '') onChange(toBytes(e.target.value, draft.unit));
        }}
        aria-label={label}
        className={cn(field, 'w-24 tabular-nums disabled:bg-canvas disabled:text-muted')}
      />
      <select
        value={draft.unit}
        disabled={unlimited}
        onChange={(e) => {
          const unit = e.target.value as Unit;
          setDraft({ ...draft, unit });
          if (draft.value !== '') onChange(toBytes(draft.value, unit));
        }}
        aria-label={`${label} unit`}
        className={cn(field, 'w-20 disabled:bg-canvas disabled:text-muted')}
      >
        {(Object.keys(UNITS) as Unit[]).map((u) => (
          <option key={u}>{u}</option>
        ))}
      </select>
      {allowUnlimited && (
        <label className="flex items-center gap-1.5 text-[12.5px] text-ink-2">
          <input type="checkbox" checked={unlimited} onChange={(e) => onChange(e.target.checked ? null : 10 * GB)} aria-label={`${label}: unlimited`} className="accent-brand-600" />
          Unlimited
        </label>
      )}
    </div>
  );
}

function Defaults({ settings }: { settings: StorageReport['settings'] }) {
  const a = useStorageActions();
  const [draft, setDraft] = useState(settings);
  useEffect(() => setDraft(settings), [settings]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(settings);
  return (
    <div className="card p-5" data-testid="storage-defaults">
      <div className="mb-3">
        <div className="text-[14px] font-semibold text-ink">Default limits</div>
        <p className="text-[12px] text-muted">Apply to everyone without their own limit. A good rule: the sum of all limits ≤ 80 % of the server disk, to leave room for versions and backups.</p>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <Labeled label="Each person">
          <BytesInput label="Default limit per person" value={draft.userDefaultBytes} onChange={(v) => setDraft({ ...draft, userDefaultBytes: v })} />
        </Labeled>
        <Labeled label="Each team">
          <BytesInput label="Default limit per team" value={draft.spaceDefaultBytes} onChange={(v) => setDraft({ ...draft, spaceDefaultBytes: v })} />
        </Labeled>
        <Labeled label="Organisation pool">
          <BytesInput label="Organisation pool" value={draft.orgBytes} onChange={(v) => setDraft({ ...draft, orgBytes: v })} />
        </Labeled>
      </div>
      <div className="mt-3 flex gap-2">
        <Button variant="primary" disabled={!dirty} loading={a.setDefaults.isPending} onClick={() => a.setDefaults.mutate(draft, { onSuccess: () => toast.success('Storage limits saved') })} data-testid="storage-defaults-save">
          Save
        </Button>
        {dirty && (
          <Button variant="ghost" onClick={() => setDraft(settings)}>
            Discard
          </Button>
        )}
      </div>
    </div>
  );
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[12.5px] font-medium text-ink-2">{label}</span>
      {children}
    </label>
  );
}

/** The limit of one person or team: Default · Unlimited · Custom (with the amount). */
function LimitCell({ kind, id, name, limit, override, fallback }: { kind: 'users' | 'spaces'; id: string; name: string; limit: number | null; override: boolean; fallback: number | null }) {
  const a = useStorageActions();
  const mode: 'default' | 'unlimited' | 'custom' = !override ? 'default' : limit === null ? 'unlimited' : 'custom';
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(() => split(limit ?? fallback ?? 10 * GB));
  const apply = (bytes: number | null | undefined) => a.setLimit.mutate({ kind, id, bytes }, { onSuccess: () => setEditing(false) });
  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        value={editing ? 'custom' : mode}
        onChange={(e) => {
          const v = e.target.value;
          if (v === 'default') apply(undefined);
          else if (v === 'unlimited') apply(null);
          else {
            setDraft(split(limit ?? fallback ?? 10 * GB));
            setEditing(true);
          }
        }}
        aria-label={`Limit for ${name}`}
        className={cn(field, 'w-[150px]')}
      >
        <option value="default">Default ({fmtLimit(fallback)})</option>
        <option value="unlimited">Unlimited</option>
        <option value="custom">{mode === 'custom' && !editing ? `Custom (${formatBytes(limit)})` : 'Custom…'}</option>
      </select>
      {editing && (
        <>
          <input type="number" min={0} step="any" value={draft.value} onChange={(e) => setDraft({ ...draft, value: e.target.value })} aria-label={`Custom limit for ${name}`} className={cn(field, 'w-20 tabular-nums')} autoFocus />
          <select value={draft.unit} onChange={(e) => setDraft({ ...draft, unit: e.target.value as Unit })} aria-label={`Custom limit unit for ${name}`} className={cn(field, 'w-[70px]')}>
            {(Object.keys(UNITS) as Unit[]).map((u) => (
              <option key={u}>{u}</option>
            ))}
          </select>
          <Button size="sm" variant="primary" loading={a.setLimit.isPending} disabled={draft.value === '' || Number(draft.value) < 0} onClick={() => apply(toBytes(draft.value, draft.unit))} aria-label={`Apply limit for ${name}`}>
            Apply
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        </>
      )}
    </div>
  );
}
