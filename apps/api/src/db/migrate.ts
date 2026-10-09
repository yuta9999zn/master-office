import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createDb } from './client';

async function main() {
  const { db, pool } = createDb();
  // apps/api/drizzle — two levels up when run with tsx (src/db), five when run from dist/apps/api/src/db.
  const folder = [resolve(__dirname, '../../drizzle'), resolve(__dirname, '../../../../../drizzle')].find((p) => existsSync(p));
  if (!folder) throw new Error('migrations folder not found');
  await migrate(db, { migrationsFolder: folder });
  await pool.end();
  console.log('✓ migrations applied');
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
