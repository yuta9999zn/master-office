import { config as load } from 'dotenv';
import { resolve } from 'node:path';

load({ path: resolve(__dirname, '../../../.env') });
load({ path: resolve(__dirname, '../../../../../.env') }); // when running from dist/apps/api/src

const PRODUCTION = process.env.NODE_ENV === 'production';
const SAMPLE_SECRETS = new Set(['', 'change-me', 'dev-collab-secret-change-me', 'dev-inbound-secret-change-me']);

/**
 * Refuses to start a production deployment with the sample secrets or with the dev user switcher on (§85 B): the
 * collab secret signs every collaboration and realtime token, so a known value lets anyone act as anyone.
 */
export function assertProductionConfig() {
  if (!PRODUCTION) return;
  const problems: string[] = [];
  if (SAMPLE_SECRETS.has(process.env.COLLAB_SECRET ?? '')) problems.push('COLLAB_SECRET must be set to a long random value (openssl rand -base64 32)');
  if (process.env.AUTH_DEV === '1') problems.push('AUTH_DEV=1 (the dev user switcher) cannot be enabled in production');
  if (process.env.MAIL_INBOUND_SECRET !== undefined && SAMPLE_SECRETS.has(process.env.MAIL_INBOUND_SECRET)) problems.push('MAIL_INBOUND_SECRET must be a random value or unset');
  if (problems.length) throw new Error(['Refusing to start in production:', ...problems.map((x) => ` - ${x}`)].join('\n'));
}

export const config = {
  production: PRODUCTION,
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://workos:workos@localhost:5440/workos',
  port: Number(process.env.API_PORT ?? 4000),
  webOrigin: process.env.WEB_ORIGIN ?? 'http://localhost:3000',
  s3: {
    endpoint: process.env.S3_ENDPOINT ?? 'http://localhost:9000',
    region: process.env.S3_REGION ?? 'us-east-1',
    accessKeyId: process.env.S3_ACCESS_KEY ?? 'workos',
    secretAccessKey: process.env.S3_SECRET_KEY ?? 'workos-secret',
    bucket: process.env.S3_BUCKET ?? 'workos',
  },
  // Outgoing e-mail (§62): e.g. smtp://localhost:1025 for Mailpit. Unset → mail is only recorded in mail_outbox.
  mail: {
    smtpUrl: process.env.SMTP_URL || null,
    from: process.env.MAIL_FROM ?? 'Master Office <no-reply@master-office.local>',
    // Mail from outside (§70): SMTP listener port (0 = off) and the secret of the raw-MIME webhook (unset = off).
    inboundPort: Number(process.env.MAIL_INBOUND_PORT ?? 2525),
    inboundSecret: process.env.MAIL_INBOUND_SECRET ?? (process.env.NODE_ENV === 'production' ? null : 'dev-inbound-secret-change-me'),
  },
  // Video meetings (§73): STUN / TURN servers handed to browsers, as JSON, e.g.
  // [{"urls":"stun:stun.l.google.com:19302"},{"urls":"turn:turn.example.com:3478","username":"u","credential":"p"}].
  // Empty = direct connections only (same machine / LAN); calls across the internet need a TURN server.
  meetings: {
    iceServers: JSON.parse(process.env.MEETING_ICE_SERVERS || '[]') as { urls: string | string[]; username?: string; credential?: string }[],
  },
  // Sign-in (§79). Dev mode keeps the user switcher (mo_uid cookie / x-user-id header) next to real sessions.
  auth: {
    // Never on in production, whatever the environment says (assertProductionConfig refuses AUTH_DEV=1 there).
    dev: PRODUCTION ? false : process.env.AUTH_DEV ? process.env.AUTH_DEV === '1' : true,
  },
  maxUploadBytes: 200 * 1024 * 1024,
  collab: {
    port: Number(process.env.COLLAB_PORT ?? 4001),
    secret: process.env.COLLAB_SECRET ?? 'dev-collab-secret-change-me',
    tokenTtlSeconds: 10 * 60,
  },
};
