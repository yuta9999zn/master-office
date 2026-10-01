import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import type { Pool } from 'pg';
import { createDb } from './client';

export const DB = Symbol('DB');
export const PG_POOL = Symbol('PG_POOL');
export const InjectDb = () => Inject(DB);

const conn = createDb();

@Global()
@Module({
  providers: [
    { provide: DB, useValue: conn.db },
    { provide: PG_POOL, useValue: conn.pool },
  ],
  exports: [DB, PG_POOL],
})
export class DbModule implements OnApplicationShutdown {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}
  async onApplicationShutdown() {
    await this.pool.end();
  }
}
