import { AsyncLocalStorage } from 'node:async_hooks';
import { EventEmitter } from 'node:events';

/**
 * Where the rest of the API tells the flow runner that something happened (§77 batch 2): a form response, a Base
 * record, an approval decision, a task status, an e-mail. A plain emitter — no module may depend on the runner.
 */
export interface FlowHookEvent {
  type: string;
  workspaceId: string;
  payload: Record<string, unknown>;
  /** Set when the event was caused by a flow's own action — that flow must not start itself again. */
  origin?: { flowId: string; runId: string };
}

class FlowHooks extends EventEmitter {
  /** The run whose action is executing right now (propagates through awaits). */
  readonly origin = new AsyncLocalStorage<{ flowId: string; runId: string }>();

  fire(type: string, workspaceId: string, payload: Record<string, unknown>) {
    const origin = this.origin.getStore();
    // Never let a listener's failure reach the caller's transaction.
    setImmediate(() => this.emit('fire', { type, workspaceId, payload, origin } satisfies FlowHookEvent));
  }
}

export const flowHooks = new FlowHooks();
