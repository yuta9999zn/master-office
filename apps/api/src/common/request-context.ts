import { AsyncLocalStorage } from 'node:async_hooks';
import type { NextFunction, Request, Response } from 'express';

/**
 * A per-request memo (§85 D): values that are expensive and stable for the length of one request — a person's
 * space roles, the workspace membership — are computed once and reused by every service the request touches.
 * Outside a request (background jobs, the collab server) there is no store, and callers compute as before.
 */
interface RequestStore {
  cache: Map<string, Promise<unknown>>;
}

const als = new AsyncLocalStorage<RequestStore>();

export function requestContext(_req: Request, _res: Response, next: NextFunction) {
  als.run({ cache: new Map() }, next);
}

/** Runs `fn` once per request for `key`; later calls in the same request get the same promise. */
export function memoPerRequest<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const store = als.getStore();
  if (!store) return fn();
  let p = store.cache.get(key) as Promise<T> | undefined;
  if (!p) {
    p = fn();
    store.cache.set(key, p);
    // A failure is not remembered: the next caller tries again.
    p.catch(() => store.cache.delete(key));
  }
  return p;
}

/** Forgets memoised values whose key starts with `prefix` (after a change inside the same request, e.g. a role update). */
export function forgetPerRequest(prefix: string) {
  const store = als.getStore();
  if (!store) return;
  for (const k of store.cache.keys()) if (k.startsWith(prefix)) store.cache.delete(k);
}
