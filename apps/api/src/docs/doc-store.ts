import { TiptapTransformer } from '@hocuspocus/transformer';
import { Injectable, Logger } from '@nestjs/common';
import { COLLAB_FIELD, docExtensions, linksOf, toPlainText, type JSONContent } from '@workos/doc-model';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { hasWorkbook, readWorkbook, workbookText } from '@workos/sheet-model';
import { deckText, hasDeck, readDeck } from '@workos/slide-model';
import { formText, hasForm, readForm } from '@workos/form-model';
import * as Y from 'yjs';
import type { Actor } from '../common/current-user';
import type { Db } from '../db/client';
import { InjectDb } from '../db/db.module';
import { resourceLinks, resources, resourceVersions, ydocStates } from '../db/schema';
import { EventsService } from '../events/events.service';
import { StorageService } from '../storage/storage.service';

const EDIT_ACTIVITY_WINDOW_MS = 10 * 60_000;
const AUTO_SNAPSHOT_INTERVAL_MS = 15 * 60_000;

export const docName = (resourceId: string) => `res:${resourceId}`;
export const resourceIdFromDocName = (name: string) => (name.startsWith('res:') ? name.slice(4) : null);

export function ydocToJSON(doc: Y.Doc): JSONContent {
  return TiptapTransformer.fromYdoc(doc, COLLAB_FIELD) as JSONContent;
}

export function jsonToYdoc(json: JSONContent): Y.Doc {
  return TiptapTransformer.toYdoc(json, COLLAB_FIELD, docExtensions());
}

export function stateToJSON(state: Uint8Array): JSONContent {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, state);
  return ydocToJSON(doc);
}

/**
 * Persistence for collaborative documents (docs/ARCHITECTURE.md §9):
 * merged Yjs state in Postgres, snapshots (version history) in object storage.
 */
@Injectable()
export class DocStore {
  private readonly log = new Logger('DocStore');
  private lastEditActivity = new Map<string, number>();
  private lastSnapshot = new Map<string, number>();

  constructor(
    @InjectDb() private readonly db: Db,
    private readonly storage: StorageService,
    private readonly events: EventsService,
  ) {}

  async load(resourceId: string): Promise<Uint8Array | null> {
    const [row] = await this.db.select({ state: ydocStates.state }).from(ydocStates).where(eq(ydocStates.resourceId, resourceId));
    return row ? new Uint8Array(row.state) : null;
  }

  /** Called by the collab server after edits (debounced) and after direct writes (import, restore). */
  async save(resourceId: string, state: Uint8Array, doc: Y.Doc, editor: { id: string; name: string } | null) {
    const buf = Buffer.from(state);
    let text: string;
    let stats: Record<string, number>;
    if (hasWorkbook(doc)) {
      const wb = readWorkbook(doc);
      text = workbookText(wb);
      stats = { sheetCount: wb.sheets.length };
    } else if (hasForm(doc)) {
      const form = readForm(doc);
      text = formText(form);
      stats = { questionCount: form.items.filter((i) => i.type !== 'section').length };
    } else if (hasDeck(doc)) {
      const deck = readDeck(doc);
      text = deckText(deck);
      stats = { slideCount: deck.slides.length };
    } else {
      const json = ydocToJSON(doc);
      text = toPlainText(json);
      stats = { wordCount: text.split(/\s+/).filter(Boolean).length };
      await this.syncLinks(resourceId, json);
    }
    await this.db
      .insert(ydocStates)
      .values({ resourceId, state: buf })
      .onConflictDoUpdate({ target: ydocStates.resourceId, set: { state: buf, updatedAt: sql`now()` } });
    const [row] = await this.db
      .update(resources)
      .set({
        updatedAt: sql`now()`,
        // Only real users are recorded as the last editor (system writes must never fail the save).
        ...(editor && /^[0-9a-f-]{36}$/i.test(editor.id) ? { updatedBy: editor.id } : {}),
        sizeBytes: buf.length,
        contentText: text.slice(0, 200_000),
        metadata: sql`${resources.metadata} || ${JSON.stringify(stats)}::jsonb`,
      })
      .where(eq(resources.id, resourceId))
      .returning({ workspaceId: resources.workspaceId, spaceId: resources.spaceId, name: resources.name, type: resources.type });
    if (!row || !editor || !/^[0-9a-f-]{36}$/i.test(editor.id)) return;

    // One "edited" activity per person per document per window, not one per keystroke batch.
    const key = `${resourceId}:${editor.id}`;
    const now = Date.now();
    if (now - (this.lastEditActivity.get(key) ?? 0) > EDIT_ACTIVITY_WINDOW_MS) {
      this.lastEditActivity.set(key, now);
      const actor: Actor = { id: editor.id, name: editor.name, workspaceId: row.workspaceId };
      await this.events.emit(this.db, actor, 'resource.content_changed', { resourceId, spaceId: row.spaceId }, { name: row.name, type: row.type });
    }
    await this.maybeAutoSnapshot(resourceId, state, editor.id);
  }

  /** Outgoing links (page links, embedded files, internal URLs) → resource_links, which powers backlinks. */
  private async syncLinks(resourceId: string, json: JSONContent) {
    const wanted = linksOf(json).filter((l) => l.id !== resourceId);
    const existing = wanted.length
      ? new Set((await this.db.select({ id: resources.id }).from(resources).where(inArray(resources.id, wanted.map((l) => l.id)))).map((r) => r.id))
      : new Set<string>();
    await this.db.transaction(async (tx) => {
      await tx.delete(resourceLinks).where(eq(resourceLinks.sourceId, resourceId));
      const rows = wanted.filter((l) => existing.has(l.id)).map((l) => ({ sourceId: resourceId, targetId: l.id, kind: l.kind }));
      if (rows.length) await tx.insert(resourceLinks).values(rows);
    });
  }

  private async maybeAutoSnapshot(resourceId: string, state: Uint8Array, userId: string) {
    if (!this.lastSnapshot.has(resourceId)) {
      const [last] = await this.db
        .select({ createdAt: resourceVersions.createdAt })
        .from(resourceVersions)
        .where(eq(resourceVersions.resourceId, resourceId))
        .orderBy(desc(resourceVersions.createdAt))
        .limit(1);
      this.lastSnapshot.set(resourceId, last ? new Date(last.createdAt).getTime() : 0);
    }
    if (Date.now() - this.lastSnapshot.get(resourceId)! > AUTO_SNAPSHOT_INTERVAL_MS) {
      await this.snapshot(resourceId, state, null, userId);
    }
  }

  /** Stores a version (label null = automatic). */
  async snapshot(resourceId: string, state: Uint8Array, label: string | null, userId: string | null) {
    const id = crypto.randomUUID();
    const key = `ydoc-snapshots/${resourceId}/${id}.bin`;
    await this.storage.putRaw(key, state);
    const [{ next }] = await this.db
      .select({ next: sql<number>`coalesce(max(${resourceVersions.version}), 0) + 1` })
      .from(resourceVersions)
      .where(eq(resourceVersions.resourceId, resourceId));
    await this.db.insert(resourceVersions).values({
      id,
      resourceId,
      version: Number(next),
      snapshotKey: key,
      label,
      sizeBytes: state.length,
      createdBy: userId,
    });
    this.lastSnapshot.set(resourceId, Date.now());
    return id;
  }

  async loadSnapshot(resourceId: string, versionId: string): Promise<Uint8Array | null> {
    const [v] = await this.db
      .select()
      .from(resourceVersions)
      .where(and(eq(resourceVersions.id, versionId), eq(resourceVersions.resourceId, resourceId)));
    if (!v?.snapshotKey) return null;
    try {
      return new Uint8Array(await this.storage.getBuffer(v.snapshotKey));
    } catch (e) {
      this.log.error(`snapshot ${v.snapshotKey} unreadable: ${(e as Error).message}`);
      return null;
    }
  }
}
