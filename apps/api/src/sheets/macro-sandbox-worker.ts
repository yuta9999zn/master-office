import { parentPort, workerData } from 'node:worker_threads';
import type { MacroRequest } from '@workos/sheet-model';
import { runSandboxed } from './macro-sandbox';

/**
 * Runs one macro in a worker thread (§85 C): QuickJS is synchronous, so a `while (true)` macro would otherwise hold
 * the API's event loop for the whole timeout. The parent terminates the thread if the deadline passes.
 */
const { req, timeoutMs } = workerData as { req: MacroRequest; timeoutMs: number };
runSandboxed(req, timeoutMs).then(
  (result) => parentPort!.postMessage({ ok: true, result }),
  (e: Error) => parentPort!.postMessage({ ok: false, error: e.message }),
);
