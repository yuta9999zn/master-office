import { Database } from '@hocuspocus/extension-database';
import { Server } from '@hocuspocus/server';
import { Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { can } from '@workos/shared';
import { COLLAB_FIELD, type JSONContent } from '@workos/doc-model';
import { RESOURCES_MAP, SHEETS_MAP, WB_MAP, writeWorkbook, type PlainWorkbook } from '@workos/sheet-model';
import { DECK_MAP, ORDER_ARRAY, SLIDES_MAP, writeDeck, type PlainDeck } from '@workos/slide-model';
import * as Y from 'yjs';
import { config } from '../config';
import { DocStore, docName, jsonToYdoc, resourceIdFromDocName } from '../docs/doc-store';
import { verifyCollabToken, type CollabGrant } from './collab-token';

export interface CollabContext {
  user?: { id: string; name: string };
  grant?: CollabGrant;
}

/**
 * Yjs sync server (Hocuspocus) embedded in the API process on its own port.
 * Split into apps/collab when it needs to scale independently (docs/ARCHITECTURE.md §9).
 */
@Injectable()
export class CollabService implements OnModuleInit, OnApplicationShutdown {
  private readonly log = new Logger('Collab');
  private server!: Server<CollabContext>;

  constructor(private readonly store: DocStore) {}

  async onModuleInit() {
    this.server = new Server<CollabContext>({
      port: config.collab.port,
      quiet: true,
      debounce: 2000,
      maxDebounce: 10_000,
      stopOnSignals: false,
      onAuthenticate: async ({ token, documentName, connectionConfig }) => {
        const grant = verifyCollabToken(token);
        if (!grant || docName(grant.rid) !== documentName) throw new Error('Invalid collaboration token');
        // Viewers and commenters sync read-only; comments live outside the Yjs doc.
        if (!can(grant.role, 'editor')) connectionConfig.readOnly = true;
        return { user: { id: grant.uid, name: grant.name }, grant };
      },
      onStateless: async ({ document, payload }) => {
        // Relay lightweight signals (e.g. "comments changed") to every client of the document.
        document.broadcastStateless(payload);
      },
      extensions: [
        new Database({
          fetch: async ({ documentName }) => {
            const rid = resourceIdFromDocName(documentName);
            return rid ? this.store.load(rid) : null;
          },
          store: async ({ documentName, state, document, lastContext }) => {
            const rid = resourceIdFromDocName(documentName);
            if (rid) await this.store.save(rid, state, document, lastContext?.user ?? null);
          },
        }),
      ],
    });
    await this.server.listen();
    this.log.log(`Hocuspocus on ws://localhost:${config.collab.port}`);
  }

  async onApplicationShutdown() {
    await this.server?.destroy();
  }

  /** Current state including edits not yet flushed to the database. */
  async currentState(resourceId: string): Promise<Uint8Array | null> {
    const live = this.server.hocuspocus.documents.get(docName(resourceId));
    if (live) return Y.encodeStateAsUpdate(live);
    return this.store.load(resourceId);
  }

  /**
   * Replaces the body of a document for everyone connected (import, version restore).
   * Runs as a normal Yjs transaction, so live editors receive it like any remote edit.
   */
  async replaceContent(resourceId: string, json: JSONContent, editor: { id: string; name: string }) {
    const source = jsonToYdoc(json).getXmlFragment(COLLAB_FIELD);
    const conn = await this.server.hocuspocus.openDirectConnection(docName(resourceId), { user: editor });
    try {
      await conn.transact((doc) => {
        const target = doc.getXmlFragment(COLLAB_FIELD);
        target.delete(0, target.length);
        target.insert(0, source.toArray().map((n) => (n as Y.XmlElement | Y.XmlText).clone()));
      });
    } finally {
      await conn.disconnect();
    }
  }

  /** Replaces a whole spreadsheet for everyone connected (import, version restore); clients reload the workbook. */
  async replaceWorkbook(resourceId: string, wb: PlainWorkbook, editor: { id: string; name: string }) {
    const conn = await this.server.hocuspocus.openDirectConnection(docName(resourceId), { user: editor });
    try {
      await conn.transact((doc) => {
        for (const name of [WB_MAP, SHEETS_MAP, RESOURCES_MAP]) {
          const m = doc.getMap(name);
          for (const k of [...m.keys()]) m.delete(k);
        }
        writeWorkbook(doc, wb);
      });
    } finally {
      await conn.disconnect();
    }
  }

  /** Replaces the entries of a top-level Y.Map (e.g. the VBA source of an imported .xlsm). */
  async replaceMap(resourceId: string, name: string, entries: Record<string, unknown>, editor: { id: string; name: string }) {
    const conn = await this.server.hocuspocus.openDirectConnection(docName(resourceId), { user: editor });
    try {
      await conn.transact((doc) => {
        const m = doc.getMap(name);
        for (const k of [...m.keys()]) m.delete(k);
        for (const [k, v] of Object.entries(entries)) m.set(k, v);
      });
    } finally {
      await conn.disconnect();
    }
  }

  /** Replaces a whole presentation for everyone connected (import, version restore). */
  async replaceDeck(resourceId: string, deck: PlainDeck, editor: { id: string; name: string }) {
    const conn = await this.server.hocuspocus.openDirectConnection(docName(resourceId), { user: editor });
    try {
      await conn.transact((doc) => {
        for (const name of [DECK_MAP, SLIDES_MAP]) {
          const m = doc.getMap(name);
          for (const k of [...m.keys()]) m.delete(k);
        }
        const order = doc.getArray(ORDER_ARRAY);
        order.delete(0, order.length);
        writeDeck(doc, deck);
      });
    } finally {
      await conn.disconnect();
    }
  }

  /** Tells open clients that non-Yjs data (comments) changed. */
  notify(resourceId: string, payload: Record<string, unknown>) {
    this.server.hocuspocus.documents.get(docName(resourceId))?.broadcastStateless(JSON.stringify(payload));
  }
}
