import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { resolve } from 'node:path';
import { createDb } from './client';

async function main() {
  const { db, pool } = createDb();
  await migrate(db, { migrationsFolder: resolve(__dirname, '../../drizzle') });
  await pool.end();
  console.log('✓ migrations applied');
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
