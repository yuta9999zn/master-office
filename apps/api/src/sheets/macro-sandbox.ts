import { macroWorker, type MacroRequest, type MacroResult } from '@workos/sheet-model';
import { getQuickJS, shouldInterruptAfterDeadline, type QuickJSWASMModule } from 'quickjs-emscripten';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';

// Runs a macro on the server (docs/ARCHITECTURE.md §48) with the same runtime the browser runs in a Web Worker
// (sheet-model/macro-runtime.ts), inside QuickJS compiled to WebAssembly: a separate JS engine with its own heap
// (capped at 64 MB), no `require`, no network, no file system, no timers — only what the runtime defines — and an
// interrupt that stops it at the deadline. Node's `vm` is not a security boundary; a separate engine is.
// (isolated-vm would need a native build toolchain on every server; QuickJS-wasm needs none.)
// A fresh runtime per run, thrown away afterwards.

const MEMORY_BYTES = 64 * 1024 * 1024;
export const SANDBOX_TIMEOUT_MS = 30_000;
const SOURCE = `
globalThis.self = globalThis;
// esbuild-based tooling (tsx) adds __name(fn, "name") calls inside serialised functions.
var __name = (f) => f;
let __out = null;
self.postMessage = (r) => { __out = r; };
(${macroWorker.toString()})();
globalThis.__done = false;
globalThis.__result = null;
globalThis.__run = (json) => {
  Promise.resolve(self.onmessage({ data: JSON.parse(json) })).then(
    () => { __result = JSON.stringify(__out); __done = true; },
    (e) => { __result = JSON.stringify({ ok: false, ops: [], logs: [], error: String(e && e.message || e), ms: 0 }); __done = true; },
  );
};`;

let engine: Promise<QuickJSWASMModule> | null = null;

/** How many macros may run at once; the rest wait (one API process, each run holds a QuickJS heap of up to 64 MB). */
const MAX_PARALLEL = 2;
let running = 0;
const waiting: (() => void)[] = [];
const acquire = () => new Promise<void>((resolve) => (running < MAX_PARALLEL ? (running++, resolve()) : waiting.push(() => (running++, resolve()))));
const release = () => {
  running--;
  waiting.shift()?.();
};

/**
 * The entry point for server-side runs (§85 C): in a built API the macro runs in a worker thread, so an endless
 * loop costs one thread for `timeoutMs` and never the event loop; under tsx (dev) it runs inline as before.
 */
export async function runIsolated(req: MacroRequest, timeoutMs = SANDBOX_TIMEOUT_MS): Promise<MacroResult> {
  const workerFile = join(__dirname, 'macro-sandbox-worker.js');
  await acquire();
  try {
    if (!existsSync(workerFile)) return await runSandboxed(req, timeoutMs);
    return await new Promise<MacroResult>((resolve) => {
      const started = Date.now();
      const w = new Worker(workerFile, { workerData: { req, timeoutMs }, resourceLimits: { maxOldGenerationSizeMb: 256 } });
      const fail = (error: string) => resolve({ ok: false, ops: [], logs: [], error, ms: Date.now() - started });
      // The interrupt inside QuickJS normally stops it at the deadline; this is the backstop if it does not.
      const killer = setTimeout(() => void w.terminate().then(() => fail(`Exceeded maximum execution time (${timeoutMs / 1000} s) — the macro was stopped and nothing was changed`)), timeoutMs + 2000);
      w.once('message', (m: { ok: true; result: MacroResult } | { ok: false; error: string }) => {
        clearTimeout(killer);
        resolve(m.ok ? m.result : { ok: false, ops: [], logs: [], error: m.error, ms: Date.now() - started });
      });
      w.once('error', (e) => (clearTimeout(killer), fail(e.message)));
      w.once('exit', (code) => code !== 0 && (clearTimeout(killer), fail(`The macro runner stopped (code ${code})`)));
    });
  } finally {
    release();
  }
}

export async function runSandboxed(req: MacroRequest, timeoutMs = SANDBOX_TIMEOUT_MS): Promise<MacroResult> {
  const started = Date.now();
  const QuickJS = await (engine ??= getQuickJS());
  const runtime = QuickJS.newRuntime();
  runtime.setMemoryLimit(MEMORY_BYTES);
  runtime.setMaxStackSize(1024 * 1024);
  runtime.setInterruptHandler(shouldInterruptAfterDeadline(started + timeoutMs));
  const vm = runtime.newContext();
  const fail = (error: string): MacroResult => ({ ok: false, ops: [], logs: [], error, ms: Date.now() - started });
  const explain = (e: unknown) => {
    const m = typeof e === 'object' && e && 'message' in e ? String((e as { message: unknown }).message) : String(e);
    if (/interrupted/i.test(m) || Date.now() - started >= timeoutMs) return `Exceeded maximum execution time (${timeoutMs / 1000} s) — the macro was stopped and nothing was changed`;
    if (/out of memory/i.test(m)) return 'The macro used more than 64 MB of memory and was stopped';
    return m;
  };
  try {
    const boot = vm.evalCode(SOURCE, 'macro-runtime.js');
    if (boot.error) {
      const e = vm.dump(boot.error);
      boot.error.dispose();
      return fail(explain(e));
    }
    boot.value.dispose();
    const call = vm.evalCode(`__run(${JSON.stringify(JSON.stringify(req))})`);
    if (call.error) {
      const e = vm.dump(call.error);
      call.error.dispose();
      return fail(explain(e));
    }
    call.value.dispose();
    // The runtime is async (it awaits the macro): drain the job queue until it reports back.
    for (;;) {
      const jobs = runtime.executePendingJobs(-1);
      if (jobs.error) {
        const e = vm.dump(jobs.error);
        jobs.error.dispose();
        return fail(explain(e));
      }
      const done = vm.getProp(vm.global, '__done');
      const finished = vm.dump(done) === true;
      done.dispose();
      if (finished) break;
      if (!runtime.hasPendingJob()) return fail('The macro did not finish (it may be waiting on something that never happens)');
    }
    const out = vm.getProp(vm.global, '__result');
    const json = vm.getString(out);
    out.dispose();
    const result = JSON.parse(json) as MacroResult;
    // The runtime catches the interrupt / out-of-memory like any error: report them plainly, and apply nothing
    // from a macro that was cut off.
    if (result.error && /interrupted|out of memory/i.test(result.error)) return fail(explain({ message: result.error }));
    return { ...result, ms: Date.now() - started };
  } catch (e) {
    return fail(explain(e));
  } finally {
    vm.dispose();
    runtime.dispose();
  }
}
