import { createCipheriv, createDecipheriv, createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Secrets at rest (§79): password hashes (scrypt) and encrypted settings (AES-256-GCM).

/** apps/api, from src (tsx) or dist (nest build). */
const apiRoot = resolve(__dirname, existsSync(resolve(__dirname, '../../package.json')) ? '../..' : '../../../../..');

let key: Buffer | null = null;
/** SETTINGS_KEY (any string, hashed to 32 bytes) or a random key kept in apps/api/.secrets/settings.key. */
function settingsKey() {
  if (key) return key;
  if (process.env.SETTINGS_KEY) return (key = createHash('sha256').update(process.env.SETTINGS_KEY).digest());
  const dir = resolve(apiRoot, '.secrets');
  const file = resolve(dir, 'settings.key');
  if (!existsSync(file)) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, randomBytes(32).toString('base64'), { mode: 0o600 });
  }
  return (key = Buffer.from(readFileSync(file, 'utf8').trim(), 'base64'));
}

export function encryptSecret(plain: string) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', settingsKey(), iv);
  const data = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), data.toString('base64')].join(':');
}

export function decryptSecret(stored: string) {
  const [v, iv, tag, data] = stored.split(':');
  if (v !== 'v1') throw new Error('Unknown secret format');
  const d = createDecipheriv('aes-256-gcm', settingsKey(), Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(data, 'base64')), d.final()]).toString('utf8');
}

const N = 16384;
const derive = (password: string, salt: Buffer) =>
  new Promise<Buffer>((ok, fail) => scrypt(password.normalize('NFKC'), salt, 64, { N, r: 8, p: 1 }, (e, k) => (e ? fail(e) : ok(k))));

export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  return `scrypt$${N}$${salt.toString('base64')}$${(await derive(password, salt)).toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string) {
  const [alg, , salt, hash] = stored.split('$');
  if (alg !== 'scrypt') return false;
  const want = Buffer.from(hash, 'base64');
  const got = await derive(password, Buffer.from(salt, 'base64'));
  return got.length === want.length && timingSafeEqual(got, want);
}

/** A random URL-safe token and the sha256 we store instead of it. */
export function newToken() {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: tokenHash(token) };
}
export const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');
