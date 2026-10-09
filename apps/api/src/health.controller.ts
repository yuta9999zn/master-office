import { Controller, Get, Logger, ServiceUnavailableException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Db } from './db/client';
import { InjectDb } from './db/db.module';

/** Liveness for Docker / load balancers: 200 when the database answers, 503 otherwise. */
@Controller('health')
export class HealthController {
  private readonly log = new Logger('Health');
  constructor(@InjectDb() private readonly db: Db) {}


  @Get()
  async health() {
    try {
      await this.db.execute(sql`select 1`);
      return { ok: true, version: process.env.npm_package_version ?? '0.1.0' };
    } catch (e) {
      this.log.error(`health: ${(e as Error).message}`);
      throw new ServiceUnavailableException({ ok: false, message: 'The database does not answer' });
    }
  }
}
