import { BadRequestException, ForbiddenException, Injectable, NotFoundException, type OnModuleInit } from '@nestjs/common';
import {
  applyView,
  cellText,
  cellValue,
  CHOICE_COLORS,
  coerceValue,
  COMPUTED_TYPES,
  emptyViewConfig,
  FIELD_TYPES,
  formulaProblem,
  guessFieldType,
  newChoice,
  parseCsv,
  recordTitle,
  renameFormulaRef,
  toCsv,
  visibleFields,
  type Attachment,
  type BaseField,
  type BaseRecord,
  type BaseSchema,
  type BaseTable,
  type BaseView,
  type CellContext,
  type Choice,
  type FieldOptions,
  type FieldType,
  type FormConfig,
  type RecordComment,
  type ViewConfig,
  type ViewType,
} from '@workos/base-model';
import { between, can, type Role } from '@workos/shared';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Actor } from '../common/current-user';
import { loadUsers } from '../common/users';
import type { Db, Tx } from '../db/client';
import { InjectDb } from '../db/db.module';
import { baseComments, baseFields, baseRecords, baseTables, baseViews, blobs, resourceAssets, resources, users, workspaceMembers } from '../db/schema';
import { PermissionsService } from '../permissions/permissions.service';
import { RealtimeService } from '../realtime/realtime.service';
import { StorageService } from '../storage/storage.service';
import { flowHooks } from '../flow/flow-hooks';
import { QuotaService } from '../storage/quota.service';

type TableRow = typeof baseTables.$inferSelect;
type FieldRow = typeof baseFields.$inferSelect;
type ViewRow = typeof baseViews.$inferSelect;
type RecordRow = typeof baseRecords.$inferSelect;

const LIMITS = { tables: 50, fields: 200, views: 50, records: 20_000, batch: 1000 };
/** Types the primary field may not have: it names the record. */
const NOT_PRIMARY: FieldType[] = ['link', 'attachment', 'checkbox'];
const VIEW_TYPES: ViewType[] = ['grid', 'kanban', 'calendar', 'gallery', 'form'];
const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface FieldInput {
  name?: string;
  type?: FieldType;
  options?: FieldOptions;
  description?: string | null;
  afterFieldId?: string | null;
}

/**
 * Base (docs/ARCHITECTURE.md §75): an Airtable / Lark Base style database inside a `base` resource. Access is the
 * resource's role — viewer reads, commenter comments, editor changes records, fields, views and tables. Values are
 * coerced with the shared base-model rules (the same ones the grid uses for paste), computed fields (formula, auto
 * number, created / modified) are never stored. People with the base open get `base.changed` live.
 */
@Injectable()
export class BaseService implements OnModuleInit {
  /** baseId → userId → last heartbeat (ms). */
  private readonly watchers = new Map<string, Map<string, number>>();

  constructor(
    @InjectDb() private readonly db: Db,
    private readonly perms: PermissionsService,
    private readonly realtime: RealtimeService,
    private readonly storage: StorageService,
    private readonly quota: QuotaService,
  ) {}

  onModuleInit() {
    this.realtime.onClientMessage(async (actor, msg) => {
      const m = msg as { type?: string; baseId?: string };
      if (!m.baseId || !uuidRe.test(m.baseId)) return;
      if (m.type === 'base.unwatch') return void this.watchers.get(m.baseId)?.delete(actor.id);
      if (m.type !== 'base.watch') return;
      await this.perms.require(actor, m.baseId, 'viewer');
      let w = this.watchers.get(m.baseId);
      if (!w) this.watchers.set(m.baseId, (w = new Map()));
      w.set(actor.id, Date.now());
    });
  }

  /** Live update to everyone who has the base open (heartbeat within 90 s). */
  private push(baseId: string, change: Extract<import('@workos/shared').RealtimeEvent, { type: 'base.changed' }>['change']) {
    const w = this.watchers.get(baseId);
    if (!w) return;
    const now = Date.now();
    for (const [u, at] of w) if (now - at > 90_000) w.delete(u);
    if (w.size) this.realtime.publish(w.keys(), { type: 'base.changed', baseId, change });
  }

  // ── Access ────────────────────────────────────────────────────────────────

  private async base(actor: Actor, baseId: string, need: Role, tx: Tx = this.db) {
    const { row, role } = await this.perms.require(actor, baseId, need, tx);
    if (row.type !== 'base' || row.trashedAt) throw new NotFoundException('Base not found');
    return { row, role };
  }

  private async table(actor: Actor, tableId: string, need: Role, tx: Tx = this.db) {
    const [t] = await tx.select().from(baseTables).where(eq(baseTables.id, tableId));
    if (!t) throw new NotFoundException('Table not found');
    const { row, role } = await this.base(actor, t.baseId, need, tx);
    return { t, row, role };
  }

  // ── Serialization ─────────────────────────────────────────────────────────

  private fieldDto = (f: FieldRow): BaseField => ({ id: f.id, tableId: f.tableId, name: f.name, type: f.type as FieldType, options: f.options as FieldOptions, description: f.description, position: f.position });
  private viewDto = (v: ViewRow): BaseView => ({ id: v.id, tableId: v.tableId, name: v.name, type: v.type as ViewType, config: { ...emptyViewConfig(), ...(v.config as Partial<ViewConfig>) }, position: v.position });
  private recordDto = (r: RecordRow, comments = 0): BaseRecord => ({
    id: r.id,
    tableId: r.tableId,
    values: r.values,
    position: r.position,
    autoNumber: r.autoNumber,
    createdBy: r.createdBy,
    createdAt: r.createdAt,
    updatedBy: r.updatedBy,
    updatedAt: r.updatedAt,
    commentCount: comments,
  });

  private async fieldsOf(tableId: string, tx: Tx = this.db) {
    return (await tx.select().from(baseFields).where(eq(baseFields.tableId, tableId)).orderBy(asc(baseFields.position))).map(this.fieldDto);
  }

  /** What turning ids into words needs for a table: workspace people and the titles of linked tables. */
  private async context(workspaceId: string, fields: BaseField[], tx: Tx = this.db): Promise<CellContext> {
    const people = await tx.select({ id: users.id, name: users.name, email: users.email }).from(workspaceMembers).innerJoin(users, eq(users.id, workspaceMembers.userId)).where(eq(workspaceMembers.workspaceId, workspaceId));
    const titles = new Map<string, Map<string, string>>();
    const peopleMap = new Map(people.map((p) => [p.id, { name: p.name, email: p.email }]));
    for (const tid of [...new Set(fields.filter((f) => f.type === 'link' && f.options.tableId).map((f) => f.options.tableId!))]) {
      const [lt] = await tx.select().from(baseTables).where(eq(baseTables.id, tid));
      if (!lt) continue;
      const lf = await this.fieldsOf(tid, tx);
      const primary = lf.find((f) => f.id === lt.primaryFieldId);
      const recs = await tx.select().from(baseRecords).where(eq(baseRecords.tableId, tid));
      const lctx: CellContext = { fields: lf, people: peopleMap };
      titles.set(tid, new Map(recs.map((r) => [r.id, recordTitle(primary, this.recordDto(r), lctx) || 'Untitled'])));
    }
    return {
      fields,
      people: peopleMap,
      linkTitle: (tid, rid) => titles.get(tid)?.get(rid),
      findLinked: (tid, title) => {
        const want = title.trim().toLowerCase();
        for (const [id, t] of titles.get(tid) ?? []) if (t.toLowerCase() === want) return id;
        return undefined;
      },
      timeZone: 'Asia/Tokyo',
    };
  }

  // ── Schema ────────────────────────────────────────────────────────────────

  /** Tables, fields and views of a base (a new base gets its first table). */
  async schema(actor: Actor, baseId: string): Promise<BaseSchema> {
    const { row, role } = await this.base(actor, baseId, 'viewer');
    let tables = await this.db.select().from(baseTables).where(eq(baseTables.baseId, baseId)).orderBy(asc(baseTables.position), asc(baseTables.createdAt));
    if (!tables.length) {
      // Two tabs opening a new base at once must not both create its first table.
      await this.db.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${baseId}))`);
        const [some] = await tx.select({ id: baseTables.id }).from(baseTables).where(eq(baseTables.baseId, baseId)).limit(1);
        if (!some) await this.makeTable(tx, baseId, 'Table 1', 0, actor.id);
      });
      tables = await this.db.select().from(baseTables).where(eq(baseTables.baseId, baseId));
    }
    const ids = tables.map((t) => t.id);
    const [fields, views] = await Promise.all([
      this.db.select().from(baseFields).where(inArray(baseFields.tableId, ids)).orderBy(asc(baseFields.position)),
      this.db.select().from(baseViews).where(inArray(baseViews.tableId, ids)).orderBy(asc(baseViews.position)),
    ]);
    return {
      id: row.id,
      name: row.name,
      role: role as BaseSchema['role'],
      tables: tables.map(
        (t): BaseTable => ({
          id: t.id,
          baseId: t.baseId,
          name: t.name,
          position: t.position,
          primaryFieldId: t.primaryFieldId!,
          fields: fields.filter((f) => f.tableId === t.id).map(this.fieldDto),
          views: views.filter((v) => v.tableId === t.id).map(this.viewDto),
        }),
      ),
    };
  }

  /** A table with its default fields (Name, Notes, Status) and a grid view — or the given fields. */
  private async makeTable(tx: Tx, baseId: string, name: string, position: number, userId: string, spec?: { name: string; type: FieldType; options?: FieldOptions }[]) {
    const [t] = await tx.insert(baseTables).values({ baseId, name, position }).returning();
    const defs = spec ?? [
      { name: 'Name', type: 'text' as FieldType },
      { name: 'Notes', type: 'longText' as FieldType },
      { name: 'Status', type: 'singleSelect' as FieldType, options: { choices: this.choices(['Todo', 'In progress', 'Done']) } },
    ];
    const fields = await tx
      .insert(baseFields)
      .values(defs.map((d, i) => ({ tableId: t.id, name: d.name, type: d.type, options: (d.options ?? {}) as Record<string, unknown>, position: i })))
      .returning();
    await tx.update(baseTables).set({ primaryFieldId: fields[0].id }).where(eq(baseTables.id, t.id));
    await tx.insert(baseViews).values({ tableId: t.id, name: 'Grid view', type: 'grid', config: emptyViewConfig() as unknown as Record<string, unknown>, position: 0, createdBy: userId });
    return { table: { ...t, primaryFieldId: fields[0].id }, fields: fields.map(this.fieldDto) };
  }

  private choices(names: string[]): Choice[] {
    return names.map((name, i) => ({ id: `c${i}${Math.random().toString(36).slice(2, 7)}`, name, color: CHOICE_COLORS[i % CHOICE_COLORS.length] }));
  }

  async createTable(actor: Actor, baseId: string, input: { name?: string }) {
    await this.base(actor, baseId, 'editor');
    const all = await this.db.select({ name: baseTables.name, position: baseTables.position }).from(baseTables).where(eq(baseTables.baseId, baseId));
    if (all.length >= LIMITS.tables) throw new BadRequestException(`A base holds up to ${LIMITS.tables} tables`);
    const name = this.uniqueName(input.name?.trim() || `Table ${all.length + 1}`, all.map((t) => t.name));
    const { table } = await this.db.transaction((tx) => this.makeTable(tx, baseId, name, Math.max(-1, ...all.map((t) => t.position)) + 1, actor.id));
    this.push(baseId, { kind: 'schema' });
    return table.id;
  }

  async updateTable(actor: Actor, tableId: string, input: { name?: string; position?: number }) {
    const { t } = await this.table(actor, tableId, 'editor');
    const set: Partial<TableRow> = {};
    if (input.name?.trim()) {
      const others = await this.db.select({ name: baseTables.name }).from(baseTables).where(and(eq(baseTables.baseId, t.baseId), sql`${baseTables.id} <> ${tableId}`));
      if (others.some((o) => o.name.toLowerCase() === input.name!.trim().toLowerCase())) throw new BadRequestException('Another table has that name');
      set.name = input.name.trim().slice(0, 100);
    }
    if (input.position !== undefined) set.position = input.position;
    if (Object.keys(set).length) await this.db.update(baseTables).set(set).where(eq(baseTables.id, tableId));
    this.push(t.baseId, { kind: 'schema' });
  }

  /** Deletes a table; link fields elsewhere that pointed at it become text holding the linked titles. */
  async deleteTable(actor: Actor, tableId: string) {
    const { t, row } = await this.table(actor, tableId, 'editor');
    const count = await this.db.select({ id: baseTables.id }).from(baseTables).where(eq(baseTables.baseId, t.baseId));
    if (count.length <= 1) throw new BadRequestException('A base keeps at least one table');
    await this.db.transaction(async (tx) => {
      const others = await tx.select().from(baseTables).where(and(eq(baseTables.baseId, t.baseId), sql`${baseTables.id} <> ${tableId}`));
      for (const o of others) {
        const fields = await this.fieldsOf(o.id, tx);
        const links = fields.filter((f) => f.type === 'link' && f.options.tableId === tableId);
        if (!links.length) continue;
        const ctx = await this.context(row.workspaceId, fields, tx);
        for (const f of links) {
          await this.convertField(tx, o.id, f, { ...f, type: 'text', options: {} }, ctx);
          await tx.update(baseFields).set({ type: 'text', options: {} }).where(eq(baseFields.id, f.id));
        }
      }
      await tx.delete(baseTables).where(eq(baseTables.id, tableId));
    });
    this.push(t.baseId, { kind: 'schema' });
  }

  private uniqueName(name: string, taken: string[]) {
    const lower = new Set(taken.map((x) => x.toLowerCase()));
    if (!lower.has(name.toLowerCase())) return name;
    for (let i = 2; ; i++) if (!lower.has(`${name} ${i}`.toLowerCase())) return `${name} ${i}`;
  }

  // ── Fields ────────────────────────────────────────────────────────────────

  /** Checks and normalises a field's options for its type. */
  private async cleanOptions(baseId: string, type: FieldType, o: FieldOptions = {}, fields: BaseField[], selfId?: string): Promise<FieldOptions> {
    const out: FieldOptions = {};
    if (['number', 'currency', 'percent'].includes(type)) out.precision = Math.max(0, Math.min(8, Math.round(o.precision ?? (type === 'number' ? 0 : type === 'percent' ? 0 : 0))));
    if (type === 'currency') out.currency = /^[A-Z]{3}$/.test(o.currency ?? '') ? o.currency : 'JPY';
    if (type === 'singleSelect' || type === 'multiSelect') {
      const seen = new Set<string>();
      out.choices = (o.choices ?? [])
        .map((c, i) => ({ id: c.id && /^[\w-]{1,40}$/.test(c.id) ? c.id : `c${Date.now().toString(36)}${i}`, name: String(c.name ?? '').trim().slice(0, 100), color: /^#[0-9a-f]{6}$/i.test(c.color ?? '') ? c.color : CHOICE_COLORS[i % CHOICE_COLORS.length] }))
        .filter((c) => c.name && !seen.has(c.name.toLowerCase()) && seen.add(c.name.toLowerCase()))
        .slice(0, 200);
    }
    if (type === 'date') out.includeTime = !!o.includeTime;
    if (type === 'person') out.multiple = !!o.multiple;
    if (type === 'rating') out.max = Math.max(1, Math.min(10, Math.round(o.max ?? 5)));
    if (type === 'link') {
      const [lt] = o.tableId && uuidRe.test(o.tableId) ? await this.db.select().from(baseTables).where(eq(baseTables.id, o.tableId)) : [];
      if (!lt || lt.baseId !== baseId) throw new BadRequestException('Link to a table of this base');
      out.tableId = lt.id;
    }
    if (type === 'formula') {
      const expr = (o.expression ?? '').trim();
      const problem = expr ? formulaProblem(expr, fields, selfId) : 'Write a formula';
      if (problem) throw new BadRequestException(`Formula: ${problem}`);
      out.expression = expr.slice(0, 2000);
    }
    return out;
  }

  async createField(actor: Actor, tableId: string, input: FieldInput) {
    const { t } = await this.table(actor, tableId, 'editor');
    const fields = await this.fieldsOf(tableId);
    if (fields.length >= LIMITS.fields) throw new BadRequestException(`A table holds up to ${LIMITS.fields} fields`);
    const type = input.type ?? 'text';
    if (!FIELD_TYPES.includes(type)) throw new BadRequestException('Unknown field type');
    const name = (input.name?.trim() || this.uniqueName(type === 'formula' ? 'Formula' : 'Field', fields.map((f) => f.name))).slice(0, 100);
    if (fields.some((f) => f.name.toLowerCase() === name.toLowerCase())) throw new BadRequestException(`There is already a field named "${name}"`);
    if (/[{}]/.test(name)) throw new BadRequestException('Field names cannot contain { or }');
    const options = await this.cleanOptions(t.baseId, type, input.options, fields);
    const after = input.afterFieldId ? fields.find((f) => f.id === input.afterFieldId) : null;
    const position = after ? after.position + 1 : Math.max(-1, ...fields.map((f) => f.position)) + 1;
    const created = await this.db.transaction(async (tx) => {
      if (after) await tx.update(baseFields).set({ position: sql`${baseFields.position} + 1` }).where(and(eq(baseFields.tableId, tableId), sql`${baseFields.position} >= ${position}`));
      const [f] = await tx.insert(baseFields).values({ tableId, name, type, options: options as Record<string, unknown>, description: input.description?.trim() || null, position }).returning();
      return f;
    });
    this.push(t.baseId, { kind: 'schema' });
    return this.fieldDto(created);
  }

  async updateField(actor: Actor, fieldId: string, input: FieldInput) {
    const [fr] = await this.db.select().from(baseFields).where(eq(baseFields.id, fieldId));
    if (!fr) throw new NotFoundException('Field not found');
    const { t, row } = await this.table(actor, fr.tableId, 'editor');
    const fields = await this.fieldsOf(t.id);
    const before = this.fieldDto(fr);
    const type = input.type ?? before.type;
    if (!FIELD_TYPES.includes(type)) throw new BadRequestException('Unknown field type');
    if (t.primaryFieldId === fieldId && NOT_PRIMARY.includes(type)) throw new BadRequestException(`The primary field cannot be a ${type} field`);
    const name = input.name !== undefined ? input.name.trim().slice(0, 100) : before.name;
    if (!name) throw new BadRequestException('A field needs a name');
    if (/[{}]/.test(name)) throw new BadRequestException('Field names cannot contain { or }');
    if (fields.some((f) => f.id !== fieldId && f.name.toLowerCase() === name.toLowerCase())) throw new BadRequestException(`There is already a field named "${name}"`);
    const renamed = fields.map((f) => (f.id === fieldId ? { ...f, name } : f));
    const options = await this.cleanOptions(t.baseId, type, input.options ?? (type === before.type ? before.options : {}), renamed, fieldId);
    const after: BaseField = { ...before, name, type, options, description: input.description !== undefined ? input.description?.trim() || null : before.description };
    await this.db.transaction(async (tx) => {
      // Renaming keeps the formulas that use it working.
      if (name !== before.name)
        for (const f of fields.filter((x) => x.type === 'formula' && x.id !== fieldId && x.options.expression?.includes(`{${before.name}}`)))
          await tx.update(baseFields).set({ options: { ...f.options, expression: renameFormulaRef(f.options.expression!, before.name, name) } }).where(eq(baseFields.id, f.id));
      await tx.update(baseFields).set({ name, type, options: options as Record<string, unknown>, description: after.description }).where(eq(baseFields.id, fieldId));
      if (type !== before.type || JSON.stringify(before.options) !== JSON.stringify(options)) {
        const ctx = await this.context(row.workspaceId, fields, tx);
        await this.convertField(tx, t.id, before, after, ctx);
      }
    });
    this.push(t.baseId, { kind: 'schema' });
    this.push(t.baseId, { kind: 'records', tableId: t.id });
    return after;
  }

  /**
   * Rewrites a field's stored values after its type or options changed: the old value as text (or the computed
   * value of a formula) coerced into the new type; options that disappeared are cleared.
   */
  private async convertField(tx: Tx, tableId: string, before: BaseField, after: BaseField, ctx: CellContext) {
    const recs = await tx.select().from(baseRecords).where(eq(baseRecords.tableId, tableId));
    const toComputed = COMPUTED_TYPES.includes(after.type);
    const added: Choice[] = [];
    const addChoice = (f: BaseField, n: string) => {
      const c = added.find((x) => x.name.toLowerCase() === n.toLowerCase()) ?? newChoice({ ...f, options: { choices: [...(f.options.choices ?? []), ...added] } }, n);
      if (!added.includes(c)) added.push(c);
      return c;
    };
    const target = () => ({ ...after, options: { ...after.options, choices: [...(after.options.choices ?? []), ...added] } });
    const sameFamily = (a: FieldType, b: FieldType) => {
      const fam = [['number', 'currency', 'percent', 'rating'], ['text', 'longText', 'url', 'email', 'phone'], ['singleSelect', 'multiSelect'], ['person'], ['link'], ['attachment'], ['date'], ['checkbox']];
      return fam.some((g) => g.includes(a) && g.includes(b));
    };
    for (const r of recs) {
      const rec = this.recordDto(r);
      const old = cellValue(before, rec, ctx);
      let next: unknown;
      if (toComputed) next = undefined;
      else if (old === undefined || old === null || old === '' || old instanceof Error) next = null;
      else if (sameFamily(before.type, after.type) && !['singleSelect', 'multiSelect'].includes(before.type)) next = coerceValue(target(), Array.isArray(old) && after.type === 'person' && !after.options.multiple ? old.slice(0, 1) : old, ctx, { addChoice });
      else if (before.type === 'singleSelect' || before.type === 'multiSelect') {
        const ids = (Array.isArray(old) ? old : [old]).map(String).filter((id) => after.options.choices?.some((c) => c.id === id));
        next = after.type === 'multiSelect' ? (ids.length ? ids : null) : after.type === 'singleSelect' ? (ids[0] ?? null) : coerceValue(target(), cellText(before, old, ctx), ctx, { addChoice });
      } else next = coerceValue(target(), typeof old === 'number' && ['number', 'currency', 'percent', 'rating'].includes(after.type) ? old : cellText(before, old, ctx), ctx, { addChoice });
      const values = { ...r.values };
      if (next === null || next === undefined) delete values[after.id];
      else values[after.id] = next;
      if (JSON.stringify(values) !== JSON.stringify(r.values)) await tx.update(baseRecords).set({ values }).where(eq(baseRecords.id, r.id));
    }
    if (added.length) await tx.update(baseFields).set({ options: target().options as Record<string, unknown> }).where(eq(baseFields.id, after.id));
  }

  async deleteField(actor: Actor, fieldId: string) {
    const [fr] = await this.db.select().from(baseFields).where(eq(baseFields.id, fieldId));
    if (!fr) throw new NotFoundException('Field not found');
    const { t } = await this.table(actor, fr.tableId, 'editor');
    if (t.primaryFieldId === fieldId) throw new BadRequestException('The primary field cannot be deleted');
    await this.db.transaction(async (tx) => {
      await tx.delete(baseFields).where(eq(baseFields.id, fieldId));
      await tx.update(baseRecords).set({ values: sql`${baseRecords.values} - ${fieldId}::text` }).where(eq(baseRecords.tableId, t.id));
      // Views forget it.
      for (const v of await tx.select().from(baseViews).where(eq(baseViews.tableId, t.id))) {
        const c = { ...emptyViewConfig(), ...(v.config as Partial<ViewConfig>) };
        const next: ViewConfig = {
          ...c,
          filters: { ...c.filters, conditions: c.filters.conditions.filter((x) => x.fieldId !== fieldId) },
          sorts: c.sorts.filter((s) => s.fieldId !== fieldId),
          groupBy: c.groupBy?.fieldId === fieldId ? null : c.groupBy,
          hidden: c.hidden.filter((x) => x !== fieldId),
          order: c.order.filter((x) => x !== fieldId),
          stackField: c.stackField === fieldId ? null : c.stackField,
          dateField: c.dateField === fieldId ? null : c.dateField,
          coverField: c.coverField === fieldId ? null : c.coverField,
          ...(c.form ? { form: { ...c.form, fields: c.form.fields.filter((x) => x !== fieldId), required: c.form.required.filter((x) => x !== fieldId) } } : {}),
        };
        await tx.update(baseViews).set({ config: next as unknown as Record<string, unknown> }).where(eq(baseViews.id, v.id));
      }
    });
    this.push(t.baseId, { kind: 'schema' });
  }

  // ── Views ─────────────────────────────────────────────────────────────────

  private defaultConfig(type: ViewType, fields: BaseField[], tableName: string): ViewConfig {
    const c = emptyViewConfig();
    if (type === 'kanban') c.stackField = fields.find((f) => f.type === 'singleSelect')?.id ?? null;
    if (type === 'calendar') c.dateField = fields.find((f) => f.type === 'date')?.id ?? null;
    if (type === 'gallery') c.coverField = fields.find((f) => f.type === 'attachment')?.id ?? null;
    if (type === 'form')
      c.form = { title: tableName, description: '', fields: fields.filter((f) => !COMPUTED_TYPES.includes(f.type)).map((f) => f.id), required: [], open: false, submitText: 'Submit', thanks: 'Thanks — your answer was recorded.' };
    return c;
  }

  /** Keeps only what a view config may hold, with field ids of this table. */
  private cleanConfig(c: Partial<ViewConfig>, base: ViewConfig, fields: BaseField[]): ViewConfig {
    const ids = new Set(fields.map((f) => f.id));
    const okId = (x: unknown): x is string => typeof x === 'string' && ids.has(x);
    const out: ViewConfig = { ...base };
    if (c.filters) out.filters = { conjunction: c.filters.conjunction === 'or' ? 'or' : 'and', conditions: (c.filters.conditions ?? []).filter((x) => okId(x.fieldId)).slice(0, 30).map((x) => ({ id: String(x.id || Math.random().toString(36).slice(2, 9)), fieldId: x.fieldId, op: x.op, value: x.value })) };
    if (c.sorts) out.sorts = c.sorts.filter((s) => okId(s.fieldId)).slice(0, 10).map((s) => ({ fieldId: s.fieldId, dir: s.dir === 'desc' ? 'desc' : 'asc' }));
    if (c.groupBy !== undefined) out.groupBy = c.groupBy && okId(c.groupBy.fieldId) ? { fieldId: c.groupBy.fieldId, dir: c.groupBy.dir === 'desc' ? 'desc' : 'asc' } : null;
    if (c.hidden) out.hidden = c.hidden.filter(okId);
    if (c.order) out.order = c.order.filter(okId);
    if (c.widths) out.widths = Object.fromEntries(Object.entries(c.widths).filter(([k, v]) => ids.has(k) && typeof v === 'number').map(([k, v]) => [k, Math.max(60, Math.min(800, Math.round(v)))]));
    if (c.summaries) out.summaries = Object.fromEntries(Object.entries(c.summaries).filter(([k, v]) => ids.has(k) && ['none', 'count', 'filled', 'empty', 'sum', 'avg', 'min', 'max', 'checked'].includes(v)));
    if (c.rowHeight) out.rowHeight = ['short', 'medium', 'tall'].includes(c.rowHeight) ? c.rowHeight : 'short';
    for (const k of ['stackField', 'dateField', 'coverField'] as const) if (c[k] !== undefined) out[k] = c[k] && okId(c[k]) ? c[k] : null;
    if (c.form) {
      const f: Partial<FormConfig> = c.form;
      const prev = base.form ?? this.defaultConfig('form', fields, '').form!;
      const asked = (f.fields ?? prev.fields).filter((x) => okId(x) && !COMPUTED_TYPES.includes(fields.find((y) => y.id === x)!.type));
      out.form = {
        title: String(f.title ?? prev.title).slice(0, 200),
        description: String(f.description ?? prev.description).slice(0, 5000),
        fields: [...new Set(asked)],
        required: (f.required ?? prev.required).filter((x) => asked.includes(x)),
        open: f.open ?? prev.open,
        submitText: String(f.submitText ?? prev.submitText).slice(0, 40) || 'Submit',
        thanks: String(f.thanks ?? prev.thanks).slice(0, 1000),
      };
    }
    return out;
  }

  async createView(actor: Actor, tableId: string, input: { name?: string; type: ViewType; config?: Partial<ViewConfig> }) {
    const { t } = await this.table(actor, tableId, 'editor');
    if (!VIEW_TYPES.includes(input.type)) throw new BadRequestException('Unknown view type');
    const views = await this.db.select().from(baseViews).where(eq(baseViews.tableId, tableId));
    if (views.length >= LIMITS.views) throw new BadRequestException(`A table holds up to ${LIMITS.views} views`);
    const fields = await this.fieldsOf(tableId);
    const label = { grid: 'Grid view', kanban: 'Kanban', calendar: 'Calendar', gallery: 'Gallery', form: 'Form' }[input.type];
    const name = this.uniqueName(input.name?.trim().slice(0, 100) || label, views.map((v) => v.name));
    const config = this.cleanConfig(input.config ?? {}, this.defaultConfig(input.type, fields, t.name), fields);
    const [v] = await this.db
      .insert(baseViews)
      .values({ tableId, name, type: input.type, config: config as unknown as Record<string, unknown>, position: Math.max(-1, ...views.map((x) => x.position)) + 1, createdBy: actor.id })
      .returning();
    this.push(t.baseId, { kind: 'schema' });
    return this.viewDto(v);
  }

  async updateView(actor: Actor, viewId: string, input: { name?: string; config?: Partial<ViewConfig>; position?: number }) {
    const [v] = await this.db.select().from(baseViews).where(eq(baseViews.id, viewId));
    if (!v) throw new NotFoundException('View not found');
    const { t } = await this.table(actor, v.tableId, 'editor');
    const fields = await this.fieldsOf(t.id);
    const set: Partial<ViewRow> = {};
    if (input.name?.trim()) set.name = input.name.trim().slice(0, 100);
    if (input.position !== undefined) set.position = input.position;
    if (input.config) set.config = this.cleanConfig(input.config, this.viewDto(v).config, fields) as unknown as Record<string, unknown>;
    const [row] = Object.keys(set).length ? await this.db.update(baseViews).set(set).where(eq(baseViews.id, viewId)).returning() : [v];
    this.push(t.baseId, { kind: 'schema' });
    return this.viewDto(row);
  }

  async deleteView(actor: Actor, viewId: string) {
    const [v] = await this.db.select().from(baseViews).where(eq(baseViews.id, viewId));
    if (!v) throw new NotFoundException('View not found');
    const { t } = await this.table(actor, v.tableId, 'editor');
    const n = await this.db.select({ id: baseViews.id }).from(baseViews).where(eq(baseViews.tableId, t.id));
    if (n.length <= 1) throw new BadRequestException('A table keeps at least one view');
    await this.db.delete(baseViews).where(eq(baseViews.id, viewId));
    this.push(t.baseId, { kind: 'schema' });
  }

  // ── Records ───────────────────────────────────────────────────────────────

  async records(actor: Actor, tableId: string): Promise<BaseRecord[]> {
    await this.table(actor, tableId, 'viewer');
    const rows = await this.db.select().from(baseRecords).where(eq(baseRecords.tableId, tableId)).orderBy(asc(baseRecords.position));
    const counts = rows.length
      ? await this.db
          .select({ id: baseComments.recordId, n: sql<number>`count(*)::int` })
          .from(baseComments)
          .innerJoin(baseRecords, eq(baseRecords.id, baseComments.recordId))
          .where(eq(baseRecords.tableId, tableId))
          .groupBy(baseComments.recordId)
      : [];
    const by = new Map(counts.map((c) => [c.id, c.n]));
    return rows.map((r) => this.recordDto(r, by.get(r.id) ?? 0));
  }

  /** Coerces input values for a table: unknown fields are ignored, computed ones refused, new choices added. */
  private coerceAll(fields: BaseField[], ctx: CellContext, input: Record<string, unknown>, added: Map<string, Choice[]>) {
    const out: Record<string, unknown> = {};
    for (const [key, raw] of Object.entries(input)) {
      const f = fields.find((x) => x.id === key) ?? fields.find((x) => x.name === key);
      if (!f) continue;
      if (COMPUTED_TYPES.includes(f.type)) throw new BadRequestException(`"${f.name}" is computed`);
      const extra = added.get(f.id) ?? [];
      const live = { ...f, options: { ...f.options, choices: [...(f.options.choices ?? []), ...extra] } };
      out[f.id] = coerceValue(live, raw, ctx, {
        addChoice: (fl, name) => {
          const c = newChoice(fl, name);
          added.set(f.id, [...extra, c]);
          extra.push(c);
          return c;
        },
      });
    }
    return out;
  }

  /** Saves choices that typing / pasting / importing added to select fields. */
  private async saveChoices(tx: Tx, fields: BaseField[], added: Map<string, Choice[]>) {
    for (const [id, extra] of added) {
      const f = fields.find((x) => x.id === id)!;
      if (extra.length) await tx.update(baseFields).set({ options: { ...f.options, choices: [...(f.options.choices ?? []), ...extra] } }).where(eq(baseFields.id, id));
    }
  }

  /** Link values must point at records of the linked table. */
  private async checkLinks(tx: Tx, fields: BaseField[], values: Record<string, unknown>[]) {
    for (const f of fields.filter((x) => x.type === 'link')) {
      const ids = [...new Set(values.flatMap((v) => (Array.isArray(v[f.id]) ? (v[f.id] as string[]) : [])))];
      if (!ids.length) continue;
      const ok = new Set((await tx.select({ id: baseRecords.id }).from(baseRecords).where(and(eq(baseRecords.tableId, f.options.tableId!), inArray(baseRecords.id, ids)))).map((r) => r.id));
      for (const v of values) if (Array.isArray(v[f.id])) v[f.id] = (v[f.id] as string[]).filter((x) => ok.has(x));
    }
  }

  private strip(values: Record<string, unknown>) {
    for (const k of Object.keys(values)) if (values[k] === null || values[k] === undefined || (Array.isArray(values[k]) && !(values[k] as unknown[]).length)) delete values[k];
    return values;
  }

  async createRecords(actor: Actor, tableId: string, input: { values?: Record<string, unknown>; afterId?: string | null }[], opts: { skipAccess?: boolean } = {}) {
    if (!input.length) return [];
    if (input.length > LIMITS.batch) throw new BadRequestException(`Up to ${LIMITS.batch} records at a time`);
    const { t, row } = opts.skipAccess ? await this.tableRow(tableId) : await this.table(actor, tableId, 'editor');
    const fields = await this.fieldsOf(tableId);
    const ctx = await this.context(row.workspaceId, fields);
    const added = new Map<string, Choice[]>();
    const values = input.map((i) => this.coerceAll(fields, ctx, i.values ?? {}, added));
    const created = await this.db.transaction(async (tx) => {
      const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(baseRecords).where(eq(baseRecords.tableId, tableId));
      if (n + input.length > LIMITS.records) throw new BadRequestException(`A table holds up to ${LIMITS.records.toLocaleString('en-US')} records`);
      await this.checkLinks(tx, fields, values);
      await this.saveChoices(tx, fields, added);
      const [seq] = await tx.update(baseTables).set({ autoSeq: sql`${baseTables.autoSeq} + ${input.length}` }).where(eq(baseTables.id, tableId)).returning({ autoSeq: baseTables.autoSeq });
      const first = seq.autoSeq - input.length + 1;
      const positions = await this.positionsFor(tx, tableId, input.length, input[0].afterId ?? null);
      return tx
        .insert(baseRecords)
        .values(values.map((v, i) => ({ tableId, values: this.strip(v), position: positions[i], autoNumber: first + i, createdBy: actor.id, updatedBy: actor.id })))
        .returning();
    });
    const dtos = created.map((r) => this.recordDto(r));
    if (added.size) this.push(t.baseId, { kind: 'schema' });
    this.push(t.baseId, { kind: 'records', tableId, upserted: dtos });
    for (const d of dtos) flowHooks.fire('base.recordCreated', row.workspaceId, this.hookPayload(t, fields, d));
    return dtos;
  }

  private async tableRow(tableId: string) {
    const [t] = await this.db.select().from(baseTables).where(eq(baseTables.id, tableId));
    if (!t) throw new NotFoundException('Table not found');
    const [r] = await this.db.execute<{ workspace_id: string }>(sql`SELECT workspace_id FROM resources WHERE id = ${t.baseId}`).then((x) => x.rows);
    return { t, row: { workspaceId: r.workspace_id } };
  }

  /** Positions for n new records: after a given record (before the next one) or at the end. */
  private async positionsFor(tx: Tx, tableId: string, n: number, afterId: string | null) {
    let lo: string | null = null;
    let hi: string | null = null;
    if (afterId) {
      const [a] = await tx.select({ p: baseRecords.position }).from(baseRecords).where(and(eq(baseRecords.id, afterId), eq(baseRecords.tableId, tableId)));
      if (a) {
        lo = a.p;
        const [b] = await tx.select({ p: baseRecords.position }).from(baseRecords).where(and(eq(baseRecords.tableId, tableId), sql`${baseRecords.position} > ${a.p}`)).orderBy(asc(baseRecords.position)).limit(1);
        hi = b?.p ?? null;
      }
    }
    if (!lo) {
      const [last] = await tx.select({ p: baseRecords.position }).from(baseRecords).where(eq(baseRecords.tableId, tableId)).orderBy(desc(baseRecords.position)).limit(1);
      lo = last?.p ?? null;
    }
    const out: string[] = [];
    for (let i = 0; i < n; i++) out.push((lo = between(lo, hi)));
    return out;
  }

  /** Changes cells of several records of one table (typing, paste, fill). */
  async updateRecords(actor: Actor, items: { id: string; values: Record<string, unknown> }[]) {
    if (!items.length) return [];
    if (items.length > LIMITS.batch) throw new BadRequestException(`Up to ${LIMITS.batch} records at a time`);
    const rows = await this.db.select().from(baseRecords).where(inArray(baseRecords.id, items.map((i) => i.id)));
    if (rows.length !== new Set(items.map((i) => i.id)).size) throw new NotFoundException('Record not found');
    const tableId = rows[0].tableId;
    if (rows.some((r) => r.tableId !== tableId)) throw new BadRequestException('Records of one table at a time');
    const { t, row } = await this.table(actor, tableId, 'editor');
    const fields = await this.fieldsOf(tableId);
    const ctx = await this.context(row.workspaceId, fields);
    const added = new Map<string, Choice[]>();
    const patches = items.map((i) => this.coerceAll(fields, ctx, i.values, added));
    const updated = await this.db.transaction(async (tx) => {
      await this.checkLinks(tx, fields, patches);
      await this.saveChoices(tx, fields, added);
      const out: RecordRow[] = [];
      for (let i = 0; i < items.length; i++) {
        const r = rows.find((x) => x.id === items[i].id)!;
        const values = this.strip({ ...r.values, ...patches[i] });
        const [u] = await tx.update(baseRecords).set({ values, updatedBy: actor.id, updatedAt: new Date().toISOString() }).where(eq(baseRecords.id, r.id)).returning();
        out.push(u);
      }
      return out;
    });
    const dtos = updated.map((r) => this.recordDto(r));
    if (added.size) this.push(t.baseId, { kind: 'schema' });
    this.push(t.baseId, { kind: 'records', tableId, upserted: dtos });
    dtos.forEach((d, i) => flowHooks.fire('base.recordUpdated', row.workspaceId, { ...this.hookPayload(t, fields, d), changed: Object.keys(patches[i]).map((fid) => fields.find((f) => f.id === fid)?.name ?? fid) }));
    return dtos;
  }

  /** What a flow sees of a record (§77 batch 2): values by field name, plus ids. */
  private hookPayload(t: { id: string; baseId: string; name: string }, fields: { id: string; name: string }[], r: BaseRecord) {
    return {
      baseId: t.baseId,
      tableId: t.id,
      tableName: t.name,
      recordId: r.id,
      autoNumber: r.autoNumber,
      record: Object.fromEntries(fields.map((f) => [f.name, r.values[f.id]])),
      values: r.values,
    };
  }

  /** Manual order: drops a record between two others. */
  async moveRecord(actor: Actor, id: string, input: { afterId?: string | null; beforeId?: string | null }) {
    const [r] = await this.db.select().from(baseRecords).where(eq(baseRecords.id, id));
    if (!r) throw new NotFoundException('Record not found');
    const { t } = await this.table(actor, r.tableId, 'editor');
    const pos = async (x?: string | null) => (x ? ((await this.db.select({ p: baseRecords.position }).from(baseRecords).where(and(eq(baseRecords.id, x), eq(baseRecords.tableId, r.tableId))))[0]?.p ?? null) : null);
    const [u] = await this.db.update(baseRecords).set({ position: between(await pos(input.afterId), await pos(input.beforeId)) }).where(eq(baseRecords.id, id)).returning();
    const dto = this.recordDto(u);
    this.push(t.baseId, { kind: 'records', tableId: r.tableId, upserted: [dto] });
    return dto;
  }

  async deleteRecords(actor: Actor, ids: string[]) {
    if (!ids.length) return;
    const rows = await this.db.select({ id: baseRecords.id, tableId: baseRecords.tableId }).from(baseRecords).where(inArray(baseRecords.id, ids));
    if (!rows.length) return;
    const tableId = rows[0].tableId;
    if (rows.some((r) => r.tableId !== tableId)) throw new BadRequestException('Records of one table at a time');
    const { t } = await this.table(actor, tableId, 'editor');
    await this.db.transaction(async (tx) => {
      await tx.delete(baseRecords).where(inArray(baseRecords.id, rows.map((r) => r.id)));
      // Links to them elsewhere in the base are dropped.
      const tables = await tx.select({ id: baseTables.id }).from(baseTables).where(eq(baseTables.baseId, t.baseId));
      const linkFields = (await tx.select().from(baseFields).where(and(inArray(baseFields.tableId, tables.map((x) => x.id)), eq(baseFields.type, 'link')))).filter((f) => (f.options as FieldOptions).tableId === tableId);
      const gone = new Set(rows.map((r) => r.id));
      for (const f of linkFields)
        for (const r of await tx.select().from(baseRecords).where(and(eq(baseRecords.tableId, f.tableId), sql`jsonb_exists(${baseRecords.values}, ${f.id})`))) {
          const list = (r.values[f.id] as string[]).filter((x) => !gone.has(x));
          if (list.length === (r.values[f.id] as string[]).length) continue;
          const values = { ...r.values };
          if (list.length) values[f.id] = list;
          else delete values[f.id];
          await tx.update(baseRecords).set({ values }).where(eq(baseRecords.id, r.id));
        }
    });
    this.push(t.baseId, { kind: 'records', tableId, deleted: rows.map((r) => r.id) });
  }

  /** Titles of a table's records (link pickers). */
  async titles(actor: Actor, tableId: string) {
    const { t } = await this.table(actor, tableId, 'viewer');
    const fields = await this.fieldsOf(tableId);
    const [row] = await this.db.execute<{ workspace_id: string }>(sql`SELECT workspace_id FROM resources WHERE id = ${t.baseId}`).then((x) => x.rows);
    const ctx = await this.context(row.workspace_id, fields);
    const primary = fields.find((f) => f.id === t.primaryFieldId);
    const recs = await this.db.select().from(baseRecords).where(eq(baseRecords.tableId, tableId)).orderBy(asc(baseRecords.position));
    return recs.map((r) => ({ id: r.id, title: recordTitle(primary, this.recordDto(r), ctx) || 'Untitled' }));
  }

  // ── Comments ──────────────────────────────────────────────────────────────

  private async recordAccess(actor: Actor, recordId: string, need: Role) {
    const [r] = await this.db.select().from(baseRecords).where(eq(baseRecords.id, recordId));
    if (!r) throw new NotFoundException('Record not found');
    return { r, ...(await this.table(actor, r.tableId, need)) };
  }

  async comments(actor: Actor, recordId: string): Promise<RecordComment[]> {
    await this.recordAccess(actor, recordId, 'viewer');
    const rows = await this.db.select().from(baseComments).where(eq(baseComments.recordId, recordId)).orderBy(asc(baseComments.createdAt));
    const people = await loadUsers(this.db, rows.map((c) => c.userId));
    return rows.map((c) => {
      const u = c.userId ? people.get(c.userId) : undefined;
      return { id: c.id, recordId, user: u ? { id: u.id, name: u.name, avatarColor: u.avatarColor } : null, body: c.body, createdAt: c.createdAt };
    });
  }

  async addComment(actor: Actor, recordId: string, body: string) {
    const { t } = await this.recordAccess(actor, recordId, 'commenter');
    const text = body.trim();
    if (!text) throw new BadRequestException('Write a comment');
    await this.db.insert(baseComments).values({ recordId, userId: actor.id, body: text.slice(0, 5000) });
    this.push(t.baseId, { kind: 'comments', recordId, tableId: t.id });
    return this.comments(actor, recordId);
  }

  async deleteComment(actor: Actor, commentId: string) {
    const [c] = await this.db.select().from(baseComments).where(eq(baseComments.id, commentId));
    if (!c) throw new NotFoundException('Comment not found');
    const { t, role } = await this.recordAccess(actor, c.recordId, 'viewer');
    if (c.userId !== actor.id && !can(role, 'admin')) throw new ForbiddenException('Only who wrote it (or an admin) removes a comment');
    await this.db.delete(baseComments).where(eq(baseComments.id, commentId));
    this.push(t.baseId, { kind: 'comments', recordId: c.recordId, tableId: t.id });
  }

  // ── CSV ───────────────────────────────────────────────────────────────────

  /** The table (as a view shows it: its filters, sorts and fields) as CSV. */
  async exportCsv(actor: Actor, tableId: string, viewId?: string) {
    const { t, row } = await this.table(actor, tableId, 'viewer');
    const fields = await this.fieldsOf(tableId);
    const [v] = viewId ? await this.db.select().from(baseViews).where(and(eq(baseViews.id, viewId), eq(baseViews.tableId, tableId))) : [];
    const view = v ? this.viewDto(v) : null;
    const ctx = await this.context(row.workspaceId, fields);
    const recs = (await this.db.select().from(baseRecords).where(eq(baseRecords.tableId, tableId)).orderBy(asc(baseRecords.position))).map((r) => this.recordDto(r));
    const shown = visibleFields({ fields, primaryFieldId: t.primaryFieldId ?? undefined }, view);
    const out = applyView({ fields }, recs, view, ctx, { me: actor.id }).records;
    const csv = toCsv([shown.map((f) => f.name), ...out.map((r) => shown.map((f) => cellText(f, cellValue(f, r, ctx), ctx)))]);
    return { name: `${row.name} - ${t.name}${view ? ` - ${view.name}` : ''}.csv`, csv };
  }

  /** A new table from CSV: the first row names the fields, each column's type is guessed. */
  async importCsv(actor: Actor, baseId: string, input: { name?: string; csv: string }) {
    const { row } = await this.base(actor, baseId, 'editor');
    const rows = parseCsv(input.csv);
    if (rows.length < 1) throw new BadRequestException('The file is empty');
    if (rows.length - 1 > LIMITS.records) throw new BadRequestException(`Up to ${LIMITS.records.toLocaleString('en-US')} rows`);
    const width = Math.min(LIMITS.fields, Math.max(...rows.map((r) => r.length)));
    const taken: string[] = [];
    const spec = Array.from({ length: width }, (_, i) => {
      const name = this.uniqueName((rows[0][i] ?? '').trim().replace(/[{}]/g, '').slice(0, 100) || `Field ${i + 1}`, taken);
      taken.push(name);
      const col = rows.slice(1).map((r) => r[i] ?? '');
      let g = guessFieldType(col);
      if (i === 0 && NOT_PRIMARY.includes(g.type)) g = { type: 'text' };
      const options: FieldOptions = g.type === 'singleSelect' ? { choices: this.choices([...new Set(col.map((x) => x.trim()).filter(Boolean))].slice(0, 200)) } : g.type === 'date' ? { includeTime: !!g.includeTime } : g.type === 'currency' ? { currency: col.some((x) => x.includes('$')) ? 'USD' : col.some((x) => x.includes('€')) ? 'EUR' : 'JPY' } : {};
      return { name, type: g.type, options };
    });
    const all = await this.db.select({ name: baseTables.name, position: baseTables.position }).from(baseTables).where(eq(baseTables.baseId, baseId));
    if (all.length >= LIMITS.tables) throw new BadRequestException(`A base holds up to ${LIMITS.tables} tables`);
    const name = this.uniqueName(input.name?.trim().replace(/\.csv$/i, '').slice(0, 100) || 'Imported table', all.map((t) => t.name));
    const tableId = await this.db.transaction(async (tx) => {
      const { table, fields } = await this.makeTable(tx, baseId, name, Math.max(-1, ...all.map((t) => t.position)) + 1, actor.id, spec);
      const ctx = await this.context(row.workspaceId, fields, tx);
      const added = new Map<string, Choice[]>();
      const data = rows.slice(1);
      for (let start = 0; start < data.length; start += 500) {
        const chunk = data.slice(start, start + 500);
        await tx.insert(baseRecords).values(
          chunk.map((cells, j) => ({
            tableId: table.id,
            values: this.strip(this.coerceAll(fields, ctx, Object.fromEntries(fields.map((f, i) => [f.id, cells[i] ?? ''])), added)),
            position: `a${String(start + j).padStart(7, '0')}`,
            autoNumber: start + j + 1,
            createdBy: actor.id,
            updatedBy: actor.id,
          })),
        );
      }
      await this.saveChoices(tx, fields, added);
      await tx.update(baseTables).set({ autoSeq: data.length }).where(eq(baseTables.id, table.id));
      return table.id;
    });
    this.push(baseId, { kind: 'schema' });
    return { tableId, records: rows.length - 1 };
  }

  /** Appends CSV rows to a table, matching columns to fields by name. */
  async appendCsv(actor: Actor, tableId: string, csv: string) {
    const { row } = await this.table(actor, tableId, 'editor');
    const rows = parseCsv(csv);
    if (rows.length < 2) throw new BadRequestException('No rows under the header');
    const fields = await this.fieldsOf(tableId);
    const cols = rows[0].map((h) => fields.find((f) => f.name.toLowerCase() === h.trim().toLowerCase() && !COMPUTED_TYPES.includes(f.type)) ?? null);
    if (!cols.some(Boolean)) throw new BadRequestException('No column matches a field name');
    let added = 0;
    for (let start = 1; start < rows.length; start += LIMITS.batch) {
      const chunk = rows.slice(start, start + LIMITS.batch);
      added += (await this.createRecords(actor, tableId, chunk.map((cells) => ({ values: Object.fromEntries(cols.flatMap((f, i) => (f ? [[f.id, cells[i] ?? '']] : []))) })))).length;
    }
    void row;
    return { added, skipped: rows[0].filter((_, i) => !cols[i]) };
  }

  // ── Attachments ───────────────────────────────────────────────────────────

  async attach(actor: Actor, baseId: string, file: { buffer: Buffer; mimetype: string; originalname: string; size: number }): Promise<Attachment> {
    await this.base(actor, baseId, 'editor');
    return this.storeAttachment(actor, baseId, file);
  }

  /** A file for a form answer (whoever may answer the form may attach). */
  async formAttach(actor: Actor, viewId: string, file: { buffer: Buffer; mimetype: string; originalname: string; size: number }): Promise<Attachment> {
    const { t, v } = await this.formAccess(actor, viewId);
    const fields = await this.fieldsOf(t.id);
    if (!v.config.form!.fields.some((id) => fields.find((f) => f.id === id)?.type === 'attachment')) throw new BadRequestException('This form takes no files');
    return this.storeAttachment(actor, t.baseId, file);
  }

  private async storeAttachment(actor: Actor, baseId: string, file: { buffer: Buffer; mimetype: string; originalname: string; size: number }): Promise<Attachment> {
    if (!file?.buffer?.length) throw new BadRequestException('Choose a file');
    if (file.size > 50 * 1024 * 1024) throw new BadRequestException('Files can be up to 50 MB');
    const [owner] = await this.db.select({ workspaceId: resources.workspaceId, spaceId: resources.spaceId, ownerId: resources.ownerId }).from(resources).where(eq(resources.id, baseId));
    if (owner) await this.quota.assertRoom(owner.workspaceId, { spaceId: owner.spaceId, ownerId: owner.ownerId }, file.size);
    const sha = StorageService.sha256(file.buffer);
    const key = await this.storage.putBlob(file.buffer, sha, file.mimetype);
    const [blob] = await this.db
      .insert(blobs)
      .values({ sha256: sha, sizeBytes: file.size, mimeType: file.mimetype, storageKey: key })
      .onConflictDoUpdate({ target: blobs.sha256, set: { sha256: sha } })
      .returning();
    await this.db.insert(resourceAssets).values({ resourceId: baseId, blobId: blob.id, createdBy: actor.id }).onConflictDoNothing();
    // Multer reads names as latin1; browsers send UTF-8.
    const name = Buffer.from(file.originalname, 'latin1').toString('utf8');
    return { id: blob.id, name: name.slice(0, 255), mime: file.mimetype || 'application/octet-stream', size: file.size };
  }

  // ── Forms ─────────────────────────────────────────────────────────────────

  /** A form view: open forms take answers from anyone in the workspace, others from editors of the base. */
  private async formAccess(actor: Actor, viewId: string) {
    const [v] = await this.db.select().from(baseViews).where(eq(baseViews.id, viewId));
    if (!v || v.type !== 'form') throw new NotFoundException('Form not found');
    const view = this.viewDto(v);
    const { t, row } = await this.tableRow(v.tableId);
    const [res] = await this.db.execute<{ name: string; workspace_id: string; type: string; trashed_at: string | null }>(sql`SELECT name, workspace_id, type, trashed_at FROM resources WHERE id = ${t.baseId}`).then((x) => x.rows);
    if (!res || res.trashed_at || row.workspaceId !== actor.workspaceId) throw new NotFoundException('Form not found');
    if (!view.config.form?.open) {
      const role = await this.perms.require(actor, t.baseId, 'viewer').catch(() => null);
      if (!role) throw new NotFoundException('Form not found');
      if (!can(role.role, 'editor')) throw new ForbiddenException('This form takes answers from editors of the base only');
    }
    return { v: view, t, baseName: res.name };
  }

  async form(actor: Actor, viewId: string) {
    const { v, t, baseName } = await this.formAccess(actor, viewId);
    const fields = await this.fieldsOf(t.id);
    const form = v.config.form!;
    const asked = form.fields.map((id) => fields.find((f) => f.id === id)).filter((f): f is BaseField => !!f);
    const linkOptions: Record<string, { id: string; title: string }[]> = {};
    for (const f of asked.filter((x) => x.type === 'link')) {
      const [lt] = await this.db.select().from(baseTables).where(eq(baseTables.id, f.options.tableId!));
      if (!lt) continue;
      const lf = await this.fieldsOf(lt.id);
      const ctx = await this.context(actor.workspaceId, lf);
      const primary = lf.find((x) => x.id === lt.primaryFieldId);
      const recs = await this.db.select().from(baseRecords).where(eq(baseRecords.tableId, lt.id)).orderBy(asc(baseRecords.position)).limit(500);
      linkOptions[f.id] = recs.map((r) => ({ id: r.id, title: recordTitle(primary, this.recordDto(r), ctx) || 'Untitled' }));
    }
    return { viewId, baseId: t.baseId, baseName, tableName: t.name, ...form, fields: asked, linkOptions };
  }

  async submitForm(actor: Actor, viewId: string, values: Record<string, unknown>) {
    const { v, t } = await this.formAccess(actor, viewId);
    const form = v.config.form!;
    const fields = await this.fieldsOf(t.id);
    const ctx = await this.context(actor.workspaceId, fields);
    const asked = Object.fromEntries(Object.entries(values).filter(([k]) => form.fields.includes(k)));
    const missing = form.required.filter((id) => {
      const f = fields.find((x) => x.id === id);
      if (!f) return false;
      const c = coerceValue(f, asked[id], ctx);
      return c === null || c === undefined || c === false || (Array.isArray(c) && !c.length);
    });
    if (missing.length) throw new BadRequestException(`Please answer: ${missing.map((id) => fields.find((f) => f.id === id)!.name).join(', ')}`);
    const [rec] = await this.createRecords(actor, t.id, [{ values: asked }], { skipAccess: true });
    return { id: rec.id, thanks: form.thanks };
  }
}
