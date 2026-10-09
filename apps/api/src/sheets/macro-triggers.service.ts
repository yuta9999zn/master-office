import { BadRequestException, Injectable, Logger, NotFoundException, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { readWorkbook, type MacroEvent, type MacroSnapshot } from '@workos/sheet-model';
import { and, asc, eq, isNotNull, lte } from 'drizzle-orm';
import * as Y from 'yjs';
import { CollabService } from '../collab/collab.service';
import type { Actor } from '../common/current-user';
import type { Db } from '../db/client';
import { InjectDb } from '../db/db.module';
import { macroTriggers, resources, users } from '../db/schema';
import { PermissionsService } from '../permissions/permissions.service';
import { applyMacroOps } from './macro-apply';
import { runIsolated } from './macro-sandbox';

// Installable triggers that run on the server (docs/ARCHITECTURE.md §48): time-driven ("every hour", "every day
// at 9") and on form submit. The macro runs in an isolated V8 (isolated-vm: own heap, no Node APIs, 64 MB,
// 30 s), as the person who created the trigger; its changes go into the live Y.Doc like any remote edit.

export type Schedule = { every: 'minutes' | 'hours' | 'day' | 'week'; n?: number; hour?: number; weekday?: number };
type Row = typeof macroTriggers.$inferSelect;

const MINUTES = [1, 5, 10, 15, 30];
const HOURS = [1, 2, 4, 6, 8, 12];
const TICK_MS = 30_000;
/** A trigger that keeps failing is switched off (Apps Script e-mails a failure summary; we show it in the panel). */
const MAX_FAILURES = 5;

export function validSchedule(s: Schedule): boolean {
  if (s.every === 'minutes') return MINUTES.includes(s.n ?? 0);
  if (s.every === 'hours') return HOURS.includes(s.n ?? 0);
  const hourOk = Number.isInteger(s.hour) && s.hour! >= 0 && s.hour! <= 23;
  if (s.every === 'day') return hourOk;
  return hourOk && Number.isInteger(s.weekday) && s.weekday! >= 0 && s.weekday! <= 6;
}

/** Next run after `from` (server local time for "day at H" / "week on D at H"). */
export function nextRun(s: Schedule, from = new Date()): Date {
  if (s.every === 'minutes') return new Date(from.getTime() + (s.n ?? 1) * 60_000);
  if (s.every === 'hours') return new Date(from.getTime() + (s.n ?? 1) * 3_600_000);
  const d = new Date(from);
  d.setHours(s.hour ?? 0, 0, 0, 0);
  if (s.every === 'day') {
    if (d <= from) d.setDate(d.getDate() + 1);
    return d;
  }
  d.setDate(d.getDate() + (((s.weekday ?? 1) - d.getDay() + 7) % 7));
  if (d <= from) d.setDate(d.getDate() + 7);
  return d;
}

/** The workbook as a macro sees it (same shape the browser snapshot has); the first visible sheet is active. */
export function snapshotOfDoc(doc: Y.Doc): MacroSnapshot {
  const wb = readWorkbook(doc);
  const sheets = wb.sheets.map((s) => {
    const cells: MacroSnapshot['sheets'][number]['cells'] = {};
    for (const [r, row] of Object.entries(s.cells))
      for (const [c, cell] of Object.entries(row)) {
        const out: { v?: string | number | boolean | null; f?: string; s?: Record<string, unknown> } = {};
        const v = cell.t === 3 ? cell.v === 1 || cell.v === true : cell.v;
        if (v !== undefined && v !== null && v !== '') out.v = v as string | number | boolean;
        if (cell.f) out.f = cell.f;
        if (cell.s && Object.keys(cell.s).length) out.s = cell.s as Record<string, unknown>;
        if (Object.keys(out).length) cells[`${r}:${c}`] = out;
      }
    return { name: s.meta.name, maxRows: s.rowCount, maxCols: s.colCount, frozenRows: s.meta.freeze?.row ?? 0, frozenCols: s.meta.freeze?.col ?? 0, cells, hidden: !!s.meta.hidden };
  });
  const active = sheets.find((s) => !s.hidden) ?? sheets[0];
  return { name: wb.name, active: active?.name ?? 'Sheet1', selection: null, sheets: sheets.map(({ hidden: _h, ...s }) => s) };
}

@Injectable()
export class MacroTriggersService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(MacroTriggersService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private ticking = false;

  constructor(
    @InjectDb() private readonly db: Db,
    private readonly perms: PermissionsService,
    private readonly collab: CollabService,
  ) {}

  onModuleInit() {
    if (process.env.MACRO_SCHEDULER === 'off') return;
    this.timer = setInterval(() => void this.tick(), TICK_MS);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async requireSheet(actor: Actor, resourceId: string, role: 'viewer' | 'editor') {
    const { row } = await this.perms.require(actor, resourceId, role);
    if (row.type !== 'spreadsheet') throw new BadRequestException('Triggers belong to spreadsheets');
    return row;
  }

  async list(actor: Actor, resourceId: string) {
    await this.requireSheet(actor, resourceId, 'viewer');
    return this.db
      .select({ t: macroTriggers, creator: users.name })
      .from(macroTriggers)
      .innerJoin(users, eq(users.id, macroTriggers.createdBy))
      .where(eq(macroTriggers.resourceId, resourceId))
      .orderBy(asc(macroTriggers.createdAt))
      .then((rows) => rows.map(({ t, creator }) => ({ ...t, creator })));
  }

  async create(actor: Actor, resourceId: string, input: { macroId: string; fn: string; kind: 'time' | 'formSubmit'; schedule?: Schedule | null }) {
    await this.requireSheet(actor, resourceId, 'editor');
    if (input.kind === 'time' && (!input.schedule || !validSchedule(input.schedule))) throw new BadRequestException('Choose how often the trigger runs');
    const [row] = await this.db
      .insert(macroTriggers)
      .values({
        resourceId,
        macroId: input.macroId,
        fn: input.fn,
        kind: input.kind,
        schedule: input.kind === 'time' ? input.schedule! : null,
        createdBy: actor.id,
        nextRunAt: input.kind === 'time' ? nextRun(input.schedule!).toISOString() : null,
      })
      .returning();
    return row;
  }

  private async own(actor: Actor, id: string) {
    const [t] = await this.db.select().from(macroTriggers).where(eq(macroTriggers.id, id));
    if (!t) throw new NotFoundException('Trigger not found');
    await this.requireSheet(actor, t.resourceId, 'editor');
    return t;
  }

  async remove(actor: Actor, id: string) {
    await this.own(actor, id);
    await this.db.delete(macroTriggers).where(eq(macroTriggers.id, id));
  }

  async setEnabled(actor: Actor, id: string, enabled: boolean) {
    const t = await this.own(actor, id);
    const [row] = await this.db
      .update(macroTriggers)
      .set({ enabled, failures: 0, nextRunAt: enabled && t.kind === 'time' ? nextRun(t.schedule as Schedule).toISOString() : t.nextRunAt })
      .where(eq(macroTriggers.id, id))
      .returning();
    return row;
  }

  /** "Run now" from the panel: the same server execution, without waiting for the schedule. */
  async runNow(actor: Actor, id: string) {
    const t = await this.own(actor, id);
    return this.execute(t, { trigger: t.kind === 'time' ? 'time' : 'formSubmit', range: null, user: { email: '', name: actor.name } });
  }

  /** Called by Forms after a response row was appended to the linked spreadsheet. */
  async formSubmitted(resourceId: string, event: Pick<MacroEvent, 'range' | 'values' | 'namedValues'>) {
    const list = await this.db
      .select()
      .from(macroTriggers)
      .where(and(eq(macroTriggers.resourceId, resourceId), eq(macroTriggers.kind, 'formSubmit'), eq(macroTriggers.enabled, true)));
    for (const t of list) await this.execute(t, { trigger: 'formSubmit', user: { email: '', name: 'Form response' }, ...event }).catch((e) => this.log.warn(`formSubmit ${t.id}: ${(e as Error).message}`));
  }

  async tick() {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const due = await this.db
        .select()
        .from(macroTriggers)
        .where(and(eq(macroTriggers.enabled, true), eq(macroTriggers.kind, 'time'), isNotNull(macroTriggers.nextRunAt), lte(macroTriggers.nextRunAt, new Date().toISOString())))
        .orderBy(asc(macroTriggers.nextRunAt))
        .limit(10);
      for (const t of due) {
        // Claim it by moving the next run first: a slow or failing run never runs twice for the same slot.
        const claimed = await this.db
          .update(macroTriggers)
          .set({ nextRunAt: nextRun(t.schedule as Schedule).toISOString() })
          .where(and(eq(macroTriggers.id, t.id), eq(macroTriggers.nextRunAt, t.nextRunAt!)))
          .returning({ id: macroTriggers.id });
        if (!claimed.length) continue;
        await this.execute(t, { trigger: 'time', range: null, user: { email: '', name: 'Time-driven trigger' } }).catch((e) => this.log.warn(`trigger ${t.id}: ${(e as Error).message}`));
      }
    } catch (e) {
      this.log.error(`trigger tick: ${(e as Error).message}`);
    } finally {
      this.ticking = false;
    }
  }

  private async execute(t: Row, event: MacroEvent) {
    const started = Date.now();
    const [creator] = await this.db.select({ id: users.id, name: users.name, email: users.email }).from(users).where(eq(users.id, t.createdBy));
    const [res] = await this.db.select({ workspaceId: resources.workspaceId }).from(resources).where(eq(resources.id, t.resourceId));
    const record = async (status: 'ok' | 'error', error: string | null, logs: string[]) => {
      const failures = status === 'ok' ? 0 : t.failures + 1;
      await this.db
        .update(macroTriggers)
        .set({ lastRunAt: new Date().toISOString(), lastStatus: status, lastError: error, lastLogs: logs.slice(-50), lastMs: Date.now() - started, failures, ...(failures >= MAX_FAILURES ? { enabled: false } : {}) })
        .where(eq(macroTriggers.id, t.id));
      return { status, error, logs, ms: Date.now() - started };
    };
    if (!creator || !res) return record('error', 'The trigger owner or the spreadsheet no longer exists', []);
    const actor: Actor = { id: creator.id, name: creator.name, workspaceId: res.workspaceId };
    try {
      await this.perms.require(actor, t.resourceId, 'editor');
    } catch {
      return record('error', `${creator.name} can no longer edit this spreadsheet, so the trigger cannot run as them`, []);
    }
    const state = await this.collab.currentState(t.resourceId);
    const doc = new Y.Doc();
    if (state) Y.applyUpdate(doc, state);
    const macro = doc.getMap<{ code: string; name: string }>('macros').get(t.macroId);
    if (!macro) return record('error', 'The macro of this trigger was deleted', []);
    const snapshot = snapshotOfDoc(doc);
    const result = await runIsolated({ code: macro.code, fn: t.fn, snapshot, event: { ...event, user: { email: creator.email, name: creator.name } } });
    let applyError: string | null = null;
    if (result.ops.length) {
      try {
        let skipped: string[] = [];
        await this.collab.transact(t.resourceId, { id: creator.id, name: creator.name }, (live) => {
          skipped = applyMacroOps(live, result.ops, snapshot.active).skipped;
        });
        if (skipped.length) result.logs.push(`Not applied on the server: ${[...new Set(skipped)].join(', ')}`);
      } catch (e) {
        applyError = (e as Error).message;
      }
    }
    const error = result.error ?? applyError;
    return record(error ? 'error' : 'ok', error, result.logs);
  }
}
