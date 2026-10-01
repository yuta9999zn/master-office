import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Role } from '@workos/shared';
import { config } from '../config';

/** Short-lived grant for one user on one collaborative resource, minted by the API and checked by the collab server. */
export interface CollabGrant {
  uid: string;
  name: string;
  color: string;
  rid: string;
  ws: string;
  role: Role;
  exp: number;
}

const b64 = (b: Buffer | string) => Buffer.from(b).toString('base64url');
const sign = (body: string) => createHmac('sha256', config.collab.secret).update(body).digest();

export function signCollabToken(grant: Omit<CollabGrant, 'exp'>): string {
  const body = b64(JSON.stringify({ ...grant, exp: Math.floor(Date.now() / 1000) + config.collab.tokenTtlSeconds }));
  return `${body}.${b64(sign(body))}`;
}

export function verifyCollabToken(token: string): CollabGrant | null {
  const [body, mac] = token.split('.');
  if (!body || !mac) return null;
  const expected = sign(body);
  const given = Buffer.from(mac, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  const grant = JSON.parse(Buffer.from(body, 'base64url').toString()) as CollabGrant;
  return grant.exp > Date.now() / 1000 ? grant : null;
}
