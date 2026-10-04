import { macroWorker, type MacroRequest, type MacroResult } from '@workos/sheet-model';
import { getQuickJS, shouldInterruptAfterDeadline, type QuickJSWASMModule } from 'quickjs-emscripten';

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
