import { ForbiddenException, Injectable, NotFoundException, PayloadTooLargeException } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import type { Actor } from '../common/current-user';
import type { Db, Tx } from '../db/client';
import { InjectDb } from '../db/db.module';
import { resources, spaceMembers, spaces, users, workspaceMembers } from '../db/schema';
import { SettingsService } from '../admin/settings.service';

export const GiB = 1024 ** 3;

/** Storage policy of the organisation (docs/ARCHITECTURE.md §79 batch C, docs/ORG-POLICY.md §6). `null` = unlimited. */
export interface StorageSettings {
  /** The organisation's pool. Open-source default: unlimited (the server disk is the limit). */
  orgBytes: number | null;
  /** Default quota of a person's My Files (plus their mail attachments). */
  userDefaultBytes: number | null;
  /** Default quota of a team's files. */
  spaceDefaultBytes: number | null;
  /** Per-person overrides by user id (`null` = unlimited). */
  users: Record<string, number | null>;
  /** Per-team overrides by space id. */
  spaces: Record<string, number | null>;
}

export const DEFAULT_STORAGE: StorageSettings = { orgBytes: null, userDefaultBytes: 10 * GiB, spaceDefaultBytes: 50 * GiB, users: {}, spaces: {} };

/** Who a file is charged to: a team (space) when it lives in one, otherwise its owner. */
export type Charge = { spaceId: string | null; ownerId: string };

export interface StorageStatus {
  kind: 'user' | 'space';
  id: string;
  used: number;
  /** null = unlimited */
  limit: number | null;
  /** 0–100 (or null when unlimited) */
  percent: number | null;
  /** ≥ 80 % of the limit */
  warning: boolean;
  full: boolean;
  org: { used: number; limit: number | null; full: boolean };
}

const WARN_AT = 0.8;

/**
 * Storage accounting and quotas (§79 batch C). Usage is *logical*, as in Google Drive: the current size of every file
 * (including trash), its old versions (not the one that is the current blob), the pictures / media / attachments
 * embedded in documents and bases, and e-mail attachments. Content de-duplication (blobs by sha256) is an internal
 * saving and is charged to everyone who holds the content.
 *
 * Everything is computed with indexed SUM queries (resources_owner_idx / resources_space_idx) — milliseconds for an
 * organisation of ≈ 20 people. The enterprise edition keeps running counters instead.
 */
@Injectable()
export class QuotaService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly settings: SettingsService,
  ) {}

  // ── Settings ──────────────────────────────────────────────────────────────

  async storageSettings(workspaceId: string): Promise<StorageSettings> {
    const v = await this.settings.getValue<Partial<StorageSettings>>(workspaceId, 'storage');
    return { ...DEFAULT_STORAGE, ...(v ?? {}), users: v?.users ?? {}, spaces: v?.spaces ?? {} };
  }

  async setDefaults(actor: Actor, patch: Partial<Pick<StorageSettings, 'orgBytes' | 'userDefaultBytes' | 'spaceDefaultBytes'>>) {
    const cur = await this.storageSettings(actor.workspaceId);
    const next = { ...cur, ...patch };
    await this.settings.putValue(actor, actor.workspaceId, 'storage', next);
    return next;
  }

  /** `bytes` = a custom limit, `null` = unlimited, `undefined` = back to the default. */
  async setOverride(actor: Actor, kind: 'user' | 'space', id: string, bytes: number | null | undefined) {
    const cur = await this.storageSettings(actor.workspaceId);
    if (kind === 'user') {
      const [m] = await this.db.select({ userId: workspaceMembers.userId }).from(workspaceMembers).where(and(eq(workspaceMembers.workspaceId, actor.workspaceId), eq(workspaceMembers.userId, id)));
      if (!m) throw new NotFoundException('Member not found');
    } else {
      const [s] = await this.db.select({ id: spaces.id }).from(spaces).where(and(eq(spaces.workspaceId, actor.workspaceId), eq(spaces.id, id)));
      if (!s) throw new NotFoundException('Team not found');
    }
    const map = { ...cur[kind === 'user' ? 'users' : 'spaces'] };
    if (bytes === undefined) delete map[id];
    else map[id] = bytes;
    const next = { ...cur, [kind === 'user' ? 'users' : 'spaces']: map };
    await this.settings.putValue(actor, actor.workspaceId, 'storage', next);
    return next;
  }

  limitFor(s: StorageSettings, kind: 'user' | 'space', id: string): number | null {
    const map = kind === 'user' ? s.users : s.spaces;
    if (Object.prototype.hasOwnProperty.call(map, id)) return map[id];
    return kind === 'user' ? s.userDefaultBytes : s.spaceDefaultBytes;
  }

  // ── Usage ─────────────────────────────────────────────────────────────────

  /** Logical bytes per party: files (current + old versions + embedded assets) and mail attachments. */
  private usageSql(workspaceId: string, filter: { userId?: string; spaceId?: string } = {}) {
    // Each row of `resources` is charged with its current size, the versions that are not its current blob (the
    // "Original upload" version shares the current blob), and the blobs embedded in it (pictures, media, base files).
    // Folders and shortcuts hold no bytes.
    const resFilter = filter.spaceId
      ? sql`AND r.space_id = ${filter.spaceId}`
      : filter.userId
        ? sql`AND r.space_id IS NULL AND r.owner_id = ${filter.userId}`
        : sql``;
    const mailFilter = filter.spaceId
      ? sql`AND charge_kind = 'space' AND charge_id = ${filter.spaceId}`
      : filter.userId
        ? sql`AND charge_kind = 'user' AND charge_id = ${filter.userId}`
        : sql``;
    return sql`
      WITH files AS (
        SELECT CASE WHEN r.space_id IS NULL THEN 'user' ELSE 'space' END AS charge_kind,
               COALESCE(r.space_id, r.owner_id) AS charge_id,
               r.size_bytes
               + COALESCE((SELECT SUM(v.size_bytes) FROM resource_versions v WHERE v.resource_id = r.id AND (v.blob_id IS NULL OR v.blob_id IS DISTINCT FROM r.blob_id)), 0)
               + COALESCE((SELECT SUM(b.size_bytes) FROM resource_assets ra JOIN blobs b ON b.id = ra.blob_id WHERE ra.resource_id = r.id), 0) AS bytes,
               1 AS files
        FROM resources r
        WHERE r.workspace_id = ${workspaceId} AND r.type <> 'folder' AND r.link_target_id IS NULL ${resFilter}
      ), mail AS (
        -- Attachments people upload are theirs; received ones are charged to the mailbox that holds them.
        SELECT charge_kind, charge_id, bytes, 0 AS files FROM (
          SELECT 'user' AS charge_kind, a.uploaded_by AS charge_id, a.size_bytes AS bytes
          FROM mail_attachments a WHERE a.workspace_id = ${workspaceId} AND a.uploaded_by IS NOT NULL
          UNION ALL
          SELECT mb.kind, COALESCE(mb.user_id, mb.space_id), a.size_bytes
          FROM mail_attachments a
          JOIN mail_items mi ON mi.message_id = a.message_id AND mi.direction = 'in'
          JOIN mailboxes mb ON mb.id = mi.mailbox_id
          WHERE a.workspace_id = ${workspaceId} AND a.uploaded_by IS NULL
        ) m WHERE charge_id IS NOT NULL ${mailFilter}
      )
      SELECT charge_kind AS kind, charge_id AS id, SUM(bytes)::bigint AS bytes, SUM(files)::int AS files
      FROM (SELECT * FROM files UNION ALL SELECT * FROM mail) u
      GROUP BY charge_kind, charge_id`;
  }

  /** Bytes used by one person (their My Files + mail) or one team. */
  async used(workspaceId: string, kind: 'user' | 'space', id: string, tx: Tx = this.db): Promise<number> {
    const { rows } = await tx.execute(this.usageSql(workspaceId, kind === 'user' ? { userId: id } : { spaceId: id }));
    return rows.reduce((n, r) => n + Number((r as { bytes: string }).bytes), 0);
  }

  /** Everything the organisation holds. */
  async orgUsed(workspaceId: string, tx: Tx = this.db): Promise<number> {
    const { rows } = await tx.execute(this.usageSql(workspaceId));
    return rows.reduce((n, r) => n + Number((r as { bytes: string }).bytes), 0);
  }

  async status(actor: Actor, kind: 'user' | 'space', id: string): Promise<StorageStatus> {
    if (kind === 'space') {
      // Anyone who can see the space may see how full it is.
      const [m] = await this.db.select({ userId: spaceMembers.userId }).from(spaceMembers).where(and(eq(spaceMembers.spaceId, id), eq(spaceMembers.userId, actor.id)));
      const [s] = await this.db.select({ visibility: spaces.visibility, workspaceId: spaces.workspaceId }).from(spaces).where(eq(spaces.id, id));
      if (!s || s.workspaceId !== actor.workspaceId) throw new NotFoundException('Space not found');
      if (!m && s.visibility !== 'public') {
        const [wm] = await this.db.select({ role: workspaceMembers.role }).from(workspaceMembers).where(and(eq(workspaceMembers.workspaceId, actor.workspaceId), eq(workspaceMembers.userId, actor.id)));
        if (wm?.role !== 'owner' && wm?.role !== 'admin') throw new ForbiddenException();
      }
    } else if (id !== actor.id) {
      const [wm] = await this.db.select({ role: workspaceMembers.role }).from(workspaceMembers).where(and(eq(workspaceMembers.workspaceId, actor.workspaceId), eq(workspaceMembers.userId, actor.id)));
      if (wm?.role !== 'owner' && wm?.role !== 'admin') throw new ForbiddenException();
    }
    const s = await this.storageSettings(actor.workspaceId);
    const [used, orgUsed] = await Promise.all([this.used(actor.workspaceId, kind, id), this.orgUsed(actor.workspaceId)]);
    return this.toStatus(s, kind, id, used, orgUsed);
  }

  private toStatus(s: StorageSettings, kind: 'user' | 'space', id: string, used: number, orgUsed: number): StorageStatus {
    const limit = this.limitFor(s, kind, id);
    const percent = limit === null ? null : limit === 0 ? 100 : Math.min(100, Math.round((used / limit) * 1000) / 10);
    const orgFull = s.orgBytes !== null && orgUsed >= s.orgBytes;
    return {
      kind,
      id,
      used,
      limit,
      percent,
      warning: (limit !== null && used >= limit * WARN_AT) || (s.orgBytes !== null && orgUsed >= s.orgBytes * WARN_AT),
      full: (limit !== null && used >= limit) || orgFull,
      org: { used: orgUsed, limit: s.orgBytes, full: orgFull },
    };
  }

  /**
   * Refuses (413 "Storage full") when adding `bytes` would take the charged person / team or the organisation over
   * its limit. Call before storing anything new; documents being edited, restores and received mail are never blocked.
   */
  async assertRoom(workspaceId: string, charge: Charge, bytes: number, tx: Tx = this.db) {
    if (bytes <= 0) return;
    const s = await this.storageSettings(workspaceId);
    const kind = charge.spaceId ? 'space' : 'user';
    const id = charge.spaceId ?? charge.ownerId;
    const limit = this.limitFor(s, kind, id);
    if (limit === null && s.orgBytes === null) return;
    if (limit !== null) {
      const used = await this.used(workspaceId, kind, id, tx);
      if (used + bytes > limit) {
        throw new PayloadTooLargeException(
          kind === 'space'
            ? `Storage full: this team has ${fmt(Math.max(0, limit - used))} of its ${fmt(limit)} left. Free some space or ask an administrator for more.`
            : `Storage full: you have ${fmt(Math.max(0, limit - used))} of your ${fmt(limit)} left. Empty the trash, remove old versions, or ask an administrator for more.`,
        );
      }
    }
    if (s.orgBytes !== null) {
      const used = await this.orgUsed(workspaceId, tx);
      if (used + bytes > s.orgBytes) throw new PayloadTooLargeException(`Storage full: the organisation's ${fmt(s.orgBytes)} are used up. An administrator must free space or raise the pool.`);
    }
  }

  // ── Admin report ──────────────────────────────────────────────────────────

  async report(workspaceId: string) {
    const s = await this.storageSettings(workspaceId);
    const [{ rows }, members, teams, largest] = await Promise.all([
      this.db.execute(this.usageSql(workspaceId)),
      this.db
        .select({ id: users.id, name: users.name, email: users.email, avatarColor: users.avatarColor, role: workspaceMembers.role, status: workspaceMembers.status })
        .from(workspaceMembers)
        .innerJoin(users, eq(users.id, workspaceMembers.userId))
        .where(eq(workspaceMembers.workspaceId, workspaceId)),
      this.db.select({ id: spaces.id, name: spaces.name, kind: spaces.kind, color: spaces.color, icon: spaces.icon, parentId: spaces.parentId }).from(spaces).where(eq(spaces.workspaceId, workspaceId)),
      this.db
        .select({ id: resources.id, name: resources.name, type: resources.type, sizeBytes: resources.sizeBytes, ownerId: resources.ownerId, spaceId: resources.spaceId, trashedAt: resources.trashedAt, updatedAt: resources.updatedAt })
        .from(resources)
        .where(and(eq(resources.workspaceId, workspaceId), sql`${resources.type} <> 'folder' AND ${resources.linkTargetId} IS NULL`))
        .orderBy(sql`${resources.sizeBytes} DESC`)
        .limit(20),
    ]);
    const use = new Map<string, { bytes: number; files: number }>();
    for (const r of rows as { kind: string; id: string; bytes: string; files: number }[]) use.set(`${r.kind}:${r.id}`, { bytes: Number(r.bytes), files: Number(r.files) });
    const orgUsed = [...use.values()].reduce((n, u) => n + u.bytes, 0);
    const userRows = members
      .map((m) => {
        const u = use.get(`user:${m.id}`) ?? { bytes: 0, files: 0 };
        const limit = this.limitFor(s, 'user', m.id);
        return { user: { id: m.id, name: m.name, email: m.email, avatarColor: m.avatarColor }, role: m.role, status: m.status, used: u.bytes, files: u.files, limit, override: Object.prototype.hasOwnProperty.call(s.users, m.id), percent: pct(u.bytes, limit) };
      })
      .sort((a, b) => b.used - a.used);
    const spaceRows = teams
      .map((t) => {
        const u = use.get(`space:${t.id}`) ?? { bytes: 0, files: 0 };
        const limit = this.limitFor(s, 'space', t.id);
        return { space: { id: t.id, name: t.name, kind: t.kind, color: t.color, icon: t.icon, parentId: t.parentId }, used: u.bytes, files: u.files, limit, override: Object.prototype.hasOwnProperty.call(s.spaces, t.id), percent: pct(u.bytes, limit) };
      })
      .sort((a, b) => b.used - a.used);
    const allocated = [...userRows, ...spaceRows].reduce<{ bytes: number; unlimited: number }>((acc, r) => (r.limit === null ? { ...acc, unlimited: acc.unlimited + 1 } : { ...acc, bytes: acc.bytes + r.limit }), { bytes: 0, unlimited: 0 });
    const people = new Map(members.map((m) => [m.id, { id: m.id, name: m.name, avatarColor: m.avatarColor }]));
    const spaceNames = new Map(teams.map((t) => [t.id, t.name]));
    return {
      settings: { orgBytes: s.orgBytes, userDefaultBytes: s.userDefaultBytes, spaceDefaultBytes: s.spaceDefaultBytes },
      org: { used: orgUsed, limit: s.orgBytes, percent: pct(orgUsed, s.orgBytes), allocated: allocated.bytes, unlimitedParties: allocated.unlimited, warning: s.orgBytes !== null && orgUsed >= s.orgBytes * WARN_AT },
      users: userRows,
      spaces: spaceRows,
      largest: largest.map((r) => ({
        id: r.id,
        name: r.name,
        type: r.type,
        sizeBytes: r.sizeBytes,
        owner: people.get(r.ownerId) ?? null,
        space: r.spaceId ? { id: r.spaceId, name: spaceNames.get(r.spaceId) ?? '' } : null,
        trashed: !!r.trashedAt,
        updatedAt: r.updatedAt,
      })),
    };
  }
}

function pct(used: number, limit: number | null) {
  return limit === null ? null : limit === 0 ? 100 : Math.min(100, Math.round((used / limit) * 1000) / 10);
}

export function fmt(n: number) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 10 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}
