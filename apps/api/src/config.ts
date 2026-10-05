import { config as load } from 'dotenv';
import { resolve } from 'node:path';

load({ path: resolve(__dirname, '../../../.env') });
load({ path: resolve(__dirname, '../../../../../.env') }); // when running from dist/apps/api/src

export const config = {
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
  },
  maxUploadBytes: 200 * 1024 * 1024,
  collab: {
    port: Number(process.env.COLLAB_PORT ?? 4001),
    secret: process.env.COLLAB_SECRET ?? 'dev-collab-secret-change-me',
    tokenTtlSeconds: 10 * 60,
  },
};
