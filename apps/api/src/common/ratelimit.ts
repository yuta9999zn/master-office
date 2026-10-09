import { type CanActivate, type ExecutionContext, HttpException, HttpStatus, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

/**
 * A small in-memory rate limit for the endpoints anyone on the internet can call (§85 B): sign-in, first-run setup,
 * password reset, invitations, public forms, Q&A. Counted per client address (Caddy's X-Forwarded-For is trusted via
 * `trust proxy`), per route. One API process, so memory is the right place; the table is pruned as it is used.
 */
export interface RateLimitRule {
  /** Requests allowed per window. */
  max: number;
  /** Window length in seconds. */
  window: number;
}

export const RATE_LIMIT = 'rateLimit';
export const RateLimit = (max: number, window: number) => SetMetadata(RATE_LIMIT, { max, window } satisfies RateLimitRule);

const hits = new Map<string, { n: number; resetAt: number }>();
let lastPrune = 0;

export function takeHit(key: string, rule: RateLimitRule, now = Date.now()): { ok: boolean; retryAfter: number } {
  if (now - lastPrune > 60_000) {
    lastPrune = now;
    for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
  }
  const h = hits.get(key);
  if (!h || h.resetAt <= now) {
    hits.set(key, { n: 1, resetAt: now + rule.window * 1000 });
    return { ok: true, retryAfter: 0 };
  }
  h.n += 1;
  return h.n <= rule.max ? { ok: true, retryAfter: 0 } : { ok: false, retryAfter: Math.ceil((h.resetAt - now) / 1000) };
}

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext) {
    const rule = this.reflector.get<RateLimitRule | undefined>(RATE_LIMIT, ctx.getHandler());
    if (!rule) return true;
    const req = ctx.switchToHttp().getRequest<Request>();
    const route = `${req.method} ${req.route?.path ?? req.path}`;
    const { ok, retryAfter } = takeHit(`${req.ip ?? 'unknown'}|${route}`, rule);
    if (!ok) throw new HttpException({ statusCode: HttpStatus.TOO_MANY_REQUESTS, message: `Too many requests — try again in ${retryAfter} s`, retryAfter }, HttpStatus.TOO_MANY_REQUESTS);
    return true;
  }
}
