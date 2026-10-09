import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { randomBytes } from 'node:crypto';

/**
 * One place that turns any thrown value into an HTTP answer and a log line (docs/ARCHITECTURE.md §85).
 *
 * - HttpException keeps its status and body (chat's 409 "needs access" details, validation messages…).
 * - Known infrastructure errors get an honest status: Postgres unique/foreign-key violations → 409, invalid values →
 *   400, a missing S3 object → 404, an over-sized upload → 413, an unreachable database → 503.
 * - Everything else is a 500 with a short reference; the stack goes to the log under that reference so the person
 *   can quote it ("ref a1b2c3") and the operator can find it.
 */
export interface Described {
  status: number;
  body: Record<string, unknown>;
  /** The log line (stack when it is a real bug). */
  detail: string;
  level: 'error' | 'warn' | 'debug';
}

const PG: Record<string, [number, string]> = {
  '23505': [HttpStatus.CONFLICT, 'This already exists'],
  '23503': [HttpStatus.CONFLICT, 'It is still used somewhere else'],
  '23502': [HttpStatus.BAD_REQUEST, 'A required value is missing'],
  '23514': [HttpStatus.BAD_REQUEST, 'Invalid value'],
  '22P02': [HttpStatus.BAD_REQUEST, 'Invalid value'],
  '22001': [HttpStatus.BAD_REQUEST, 'The value is too long'],
  '40P01': [HttpStatus.SERVICE_UNAVAILABLE, 'The database is busy, please try again'],
  '40001': [HttpStatus.SERVICE_UNAVAILABLE, 'The database is busy, please try again'],
  '57014': [HttpStatus.SERVICE_UNAVAILABLE, 'The request took too long'],
  '53300': [HttpStatus.SERVICE_UNAVAILABLE, 'The database has too many connections'],
};

export function describeError(e: unknown): Described {
  if (e instanceof HttpException) {
    const status = e.getStatus();
    const res = e.getResponse();
    const body = typeof res === 'string' ? { statusCode: status, message: res } : { statusCode: status, ...(res as Record<string, unknown>) };
    return { status, body, detail: String(body.message ?? e.message), level: status >= 500 ? 'error' : 'debug' };
  }
  const err = (e ?? {}) as { name?: string; message?: string; code?: string | number; stack?: string; type?: string; issues?: unknown[]; $metadata?: { httpStatusCode?: number } };
  const ref = randomBytes(3).toString('hex');
  const bug = (status: number, message: string, level: Described['level'] = 'error'): Described => ({ status, body: { statusCode: status, message, ref }, detail: `[${ref}] ${err.stack ?? err.message ?? String(e)}`, level });

  if (err.name === 'ZodError') return bug(HttpStatus.BAD_REQUEST, 'Invalid input', 'debug');
  if (typeof err.code === 'string' && PG[err.code]) {
    const [status, message] = PG[err.code];
    return { status, body: { statusCode: status, message, ref }, detail: `[${ref}] postgres ${err.code}: ${err.message}`, level: status >= 500 ? 'error' : 'warn' };
  }
  if (err.name === 'NoSuchKey' || err.name === 'NotFound' || (err.$metadata?.httpStatusCode === 404 && err.name !== 'NotFoundException')) return bug(HttpStatus.NOT_FOUND, 'The stored content is missing', 'warn');
  if (err.code === 'LIMIT_FILE_SIZE' || err.type === 'entity.too.large') return bug(HttpStatus.PAYLOAD_TOO_LARGE, 'The upload is too large', 'debug');
  if (err.type === 'entity.parse.failed') return bug(HttpStatus.BAD_REQUEST, 'The request body is not valid JSON', 'debug');
  if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND' || err.code === 'ETIMEDOUT' || err.code === 'ECONNRESET')
    return bug(HttpStatus.SERVICE_UNAVAILABLE, 'A backing service (database, storage or network) is not reachable, please try again');
  if (err.name === 'AbortError' || err.name === 'TimeoutError') return bug(HttpStatus.GATEWAY_TIMEOUT, 'The operation took too long');
  return bug(HttpStatus.INTERNAL_SERVER_ERROR, `Something went wrong on the server (ref ${ref})`);
}

@Catch()
export class HttpErrorFilter implements ExceptionFilter {
  private readonly log = new Logger('Http');

  catch(e: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request>();
    const res = ctx.getResponse<Response>();
    const d = describeError(e);
    const line = `${req.method} ${req.originalUrl ?? req.url} → ${d.status}${req.actor ? ` (${req.actor.id.slice(0, 8)})` : ''}: ${d.detail}`;
    if (d.level === 'error') this.log.error(line);
    else if (d.level === 'warn') this.log.warn(line);
    else this.log.debug(line);
    if (res.headersSent) return res.end();
    res.status(d.status).json(d.body);
  }
}

/** Access log: one line per request. Problems (4xx/5xx, slow requests) at warn, the rest at debug. */
export function requestLog(req: Request, res: Response, next: NextFunction) {
  const log = new Logger('Http');
  const started = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    const status = res.statusCode;
    const line = `${req.method} ${req.originalUrl ?? req.url} ${status} ${ms.toFixed(0)}ms${req.actor ? ` (${req.actor.id.slice(0, 8)})` : ''}`;
    if (status >= 500) return; // the filter already logged it with its reference
    if (ms > 3000) log.warn(`slow ${line}`);
    else if (status >= 400 && status !== 401 && status !== 404 && status !== 304) log.warn(line);
    else log.debug(line);
  });
  next();
}

/** For fire-and-forget side effects: never silent, never fatal. `promise.catch(swallow(log, 'notify'))`. */
export const swallow =
  (log: Logger, what: string) =>
  (e: unknown): undefined => {
    log.warn(`${what}: ${(e as Error)?.message ?? String(e)}`);
    return undefined;
  };

/** Hooks the process-level last resort: nothing should get here, so every hit is logged loudly. */
export function installProcessHandlers() {
  const log = new Logger('Process');
  process.on('unhandledRejection', (reason) => {
    const r = reason as { stack?: string; message?: string };
    log.error(`unhandled rejection: ${r?.stack ?? r?.message ?? String(reason)}`);
  });
  process.on('uncaughtException', (e) => {
    log.error(`uncaught exception, exiting: ${e.stack ?? e.message}`);
    // The process state may be broken; the supervisor (docker restart / pnpm dev) brings it back.
    setTimeout(() => process.exit(1), 100).unref();
  });
}
