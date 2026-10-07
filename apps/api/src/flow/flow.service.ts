import { Injectable } from '@nestjs/common';
import { blankFlow, FLOW_TEMPLATES, readFlow, writeFlow, type PlainFlow } from '@workos/flow-model';
import * as Y from 'yjs';
import { DocStore } from '../docs/doc-store';

/**
 * Flow (docs/ARCHITECTURE.md §77): a collaborative diagram stored like every native file — a Yjs document synced
 * by the collab server and versioned by DocStore. The server only writes its first state (blank or a template).
 */
@Injectable()
export class FlowService {
  constructor(private readonly store: DocStore) {}

  static stateOf(f: PlainFlow) {
    const doc = new Y.Doc();
    writeFlow(doc, f);
    return { doc, state: Y.encodeStateAsUpdate(doc) };
  }

  static preview(state: Uint8Array): PlainFlow {
    const doc = new Y.Doc();
    Y.applyUpdate(doc, state);
    return readFlow(doc);
  }

  async init(id: string, template?: string | null) {
    const f = FLOW_TEMPLATES.find((t) => t.id === template)?.make() ?? blankFlow();
    const { doc, state } = FlowService.stateOf(f);
    await this.store.save(id, state, doc, null);
  }

  /** Writes the first state of a flow opened before it had one (seeded or created elsewhere). */
  async ensure(id: string) {
    if (!(await this.store.load(id))) await this.init(id);
  }
}
