import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Db } from './db/client';
import { InjectDb } from './db/db.module';

/** Liveness for Docker / load balancers: 200 when the database answers, 503 otherwise. */
@Controller('health')
export class HealthController {
  constructor(@InjectDb() private readonly db: Db) {}


  @Get()
  async health() {
    try {
      await this.db.execute(sql`select 1`);
      return { ok: true, version: process.env.npm_package_version ?? '0.1.0' };
    } catch (e) {
      throw new ServiceUnavailableException({ ok: false, error: (e as Error).message });
    }
  }
}
