import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { config } from '../config';
import * as schema from './schema';

export type Db = NodePgDatabase<typeof schema>;
/** A db handle or an open transaction — services accept either. */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0] | Db;

export function createDb(url = config.databaseUrl) {
  const pool = new Pool({ connectionString: url, max: 10 });
  return { pool, db: drizzle(pool, { schema }) };
}

/**
 * Runs independent queries concurrently on the pool, but one at a time inside a transaction
 * (a transaction owns a single pg client, which must not receive overlapping queries).
 */
export async function runAll<T extends readonly (() => Promise<unknown>)[]>(
  sequential: boolean,
  fns: T,
): Promise<{ -readonly [K in keyof T]: Awaited<ReturnType<T[K]>> }> {
  if (!sequential) return Promise.all(fns.map((f) => f())) as never;
  const out: unknown[] = [];
  for (const f of fns) out.push(await f());
  return out as never;
}
