import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { and, asc, desc, eq, lt, or, sql } from 'drizzle-orm';
import { createTransport, type Transporter } from 'nodemailer';
import { config } from '../config';
import type { Db } from '../db/client';
import { InjectDb } from '../db/db.module';
import { mailOutbox } from '../db/schema';
import { SettingsService } from '../admin/settings.service';

/** SMTP that never answers must not hold a request (or the retry loop) for minutes. */
const SMTP_TIMEOUTS = { connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 30_000 } as const;
const RETRY_EVERY_MS = 60_000;
const STUCK_AFTER_MS = 2 * 60_000;
const MAX_ATTEMPTS = 3;

export interface MailMessage {
  kind: string; // e.g. form.response, form.copy, form.score
  to: string;
  subject: string;
  text: string;
  html?: string;
  resourceId?: string | null;
  /** Mail module (§69): the sender's own address instead of the system one, copies, threading headers, files. */
  from?: string;
  cc?: string;
  bcc?: string;
  replyTo?: string;
  messageId?: string;
  inReplyTo?: string;
  references?: string[];
  attachments?: { filename: string; content: Buffer; contentType?: string }[];
  /** SMTP recipients when they differ from the headers (internal addresses are delivered by the Mail module). */
  envelopeTo?: string[];
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** A small HTML wrapper in the Master Office style; `rows` become label/value lines. */
export function mailHtml(o: { title: string; intro?: string; rows?: [string, string][]; button?: { label: string; url: string }; footer?: string; color?: string }) {
  const c = o.color ?? '#2563EB';
  const rows = (o.rows ?? [])
    .map(([k, v]) => `<tr><td style="padding:8px 0;border-top:1px solid #E2E8F0"><div style="color:#64748B;font-size:12px">${esc(k)}</div><div style="color:#0F172A;font-size:14px;white-space:pre-wrap">${esc(v) || '<span style="color:#94A3B8">(no answer)</span>'}</div></td></tr>`)
    .join('');
  return `<!doctype html><html><body style="margin:0;background:#F8FAFC;font-family:Inter,Segoe UI,Arial,sans-serif">
<div style="max-width:600px;margin:24px auto;background:#fff;border:1px solid #E2E8F0;border-radius:10px;overflow:hidden">
<div style="height:8px;background:${c}"></div><div style="padding:24px">
<h1 style="margin:0 0 8px;font-size:20px;color:#0F172A">${esc(o.title)}</h1>
${o.intro ? `<p style="margin:0 0 16px;color:#334155;font-size:14px">${esc(o.intro)}</p>` : ''}
${rows ? `<table style="width:100%;border-collapse:collapse">${rows}</table>` : ''}
${o.button ? `<p style="margin:20px 0 0"><a href="${esc(o.button.url)}" style="display:inline-block;background:${c};color:#fff;text-decoration:none;padding:10px 18px;border-radius:6px;font-size:14px">${esc(o.button.label)}</a></p>` : ''}
</div><div style="padding:12px 24px;background:#F8FAFC;color:#94A3B8;font-size:12px">${esc(o.footer ?? 'Sent by Master Office')}</div></div></body></html>`;
}

/**
 * Outgoing e-mail (docs/ARCHITECTURE.md §62). Every message is written to `mail_outbox` first, then delivered over
 * SMTP when SMTP_URL is configured (dev: `docker compose --profile mail up -d` → Mailpit on :8025); without it the
 * message is only recorded. Sending never throws into the caller — a failed delivery is a row with status 'failed'.
 */
@Injectable()
export class MailService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Mail');
  private readonly envTransport: Transporter | null = config.mail.smtpUrl ? createTransport({ url: config.mail.smtpUrl, ...SMTP_TIMEOUTS }) : null;
  private saved: { rev: number; transport: Transporter | null; from: string | null } | null = null;
  private retryTimer: ReturnType<typeof setInterval> | null = null;
  private retrying = false;

  constructor(
    @InjectDb() private readonly db: Db,
    private readonly settings: SettingsService,
  ) {}

  onModuleInit() {
    this.retryTimer = setInterval(() => void this.retryPending().catch((e: Error) => this.log.warn(`retry: ${e.message}`)), RETRY_EVERY_MS);
  }

  onModuleDestroy() {
    if (this.retryTimer) clearInterval(this.retryTimer);
  }

  /**
   * Nothing stays 'queued' forever: a row still queued after a couple of minutes (the process died mid-send, the
   * status update failed) and a 'failed' row with attempts left are sent again, up to MAX_ATTEMPTS.
   */
  async retryPending() {
    if (this.retrying) return;
    this.retrying = true;
    try {
      const { transport, from } = await this.current();
      if (!transport) return;
      const stale = new Date(Date.now() - STUCK_AFTER_MS).toISOString();
      const rows = await this.db
        .select()
        .from(mailOutbox)
        .where(and(lt(mailOutbox.attempts, MAX_ATTEMPTS), or(and(eq(mailOutbox.status, 'queued'), lt(mailOutbox.createdAt, stale)), and(eq(mailOutbox.status, 'failed'), lt(mailOutbox.updatedAt, stale)))))
        .orderBy(asc(mailOutbox.createdAt))
        .limit(20);
      for (const row of rows) {
        const attempts = row.attempts + 1;
        try {
          await transport.sendMail({ from, to: row.to, subject: row.subject, text: row.text, html: row.html ?? undefined });
          await this.db.update(mailOutbox).set({ status: 'sent', sentAt: sql`now()`, attempts, error: null, updatedAt: sql`now()` }).where(eq(mailOutbox.id, row.id));
          this.log.log(`retry ${attempts}: ${row.kind} → ${row.to} sent`);
        } catch (e) {
          const final = attempts >= MAX_ATTEMPTS;
          this.log.warn(`retry ${attempts}: ${row.kind} → ${row.to} failed${final ? ' (giving up)' : ''}: ${(e as Error).message}`);
          await this.db.update(mailOutbox).set({ status: 'failed', attempts, error: (e as Error).message.slice(0, 500), updatedAt: sql`now()` }).where(eq(mailOutbox.id, row.id));
        }
      }
    } finally {
      this.retrying = false;
    }
  }

  /** The system mailbox saved in Admin → System email (§79) wins over SMTP_URL. Rebuilt when the settings change. */
  private async current(): Promise<{ transport: Transporter | null; from: string }> {
    if (this.saved?.rev !== this.settings.revision) {
      const rev = this.settings.revision;
      const s = await this.settings.smtpForSending().catch(() => null);
      this.saved = {
        rev,
        transport: s ? createTransport({ host: s.host, port: s.port, secure: s.secure, auth: { user: s.user, pass: s.password }, ...SMTP_TIMEOUTS }) : null,
        from: s ? `"${s.fromName.replace(/"/g, '')}" <${s.user}>` : null,
      };
    }
    return this.saved.transport ? { transport: this.saved.transport, from: this.saved.from! } : { transport: this.envTransport, from: config.mail.from };
  }

  get delivering() {
    return !!(this.saved?.transport ?? this.envTransport);
  }

  /** Admin → System email → Send test: delivers right away and reports the SMTP error, if any. */
  async test(to: string) {
    const { transport, from } = await this.current();
    if (!transport) throw new Error('The system e-mail is not set up');
    await transport.verify();
    await transport.sendMail({ from, to, subject: 'Master Office — test e-mail', text: 'The system e-mail of Master Office works. Invitations and password resets will be sent from this address.', html: mailHtml({ title: 'It works', intro: 'The system e-mail of Master Office works. Invitations and password resets will be sent from this address.' }) });
  }

  forResource(resourceId: string, limit = 50) {
    return this.db
      .select({ id: mailOutbox.id, kind: mailOutbox.kind, to: mailOutbox.to, subject: mailOutbox.subject, status: mailOutbox.status, createdAt: mailOutbox.createdAt })
      .from(mailOutbox)
      .where(eq(mailOutbox.resourceId, resourceId))
      .orderBy(desc(mailOutbox.createdAt))
      .limit(limit);
  }

  async send(m: MailMessage): Promise<string | null> {
    try {
      const [row] = await this.db
        .insert(mailOutbox)
        .values({ kind: m.kind, to: m.to, subject: m.subject, text: m.text, html: m.html ?? null, resourceId: m.resourceId ?? null, status: (await this.current()).transport ? 'queued' : 'logged' })
        .returning({ id: mailOutbox.id });
      const { transport, from } = await this.current();
      if (transport) {
        try {
          await transport.sendMail({
            from: m.from ?? from,
            to: m.to,
            cc: m.cc,
            bcc: m.bcc,
            replyTo: m.replyTo,
            subject: m.subject,
            text: m.text,
            html: m.html,
            messageId: m.messageId ? `<${m.messageId}>` : undefined,
            inReplyTo: m.inReplyTo ? `<${m.inReplyTo}>` : undefined,
            references: m.references?.length ? m.references.map((r) => `<${r}>`) : undefined,
            attachments: m.attachments,
            envelope: m.envelopeTo ? { from: (m.from ?? from).replace(/^.*<([^>]+)>.*$/, '$1'), to: m.envelopeTo } : undefined,
          });
          await this.db.update(mailOutbox).set({ status: 'sent', sentAt: sql`now()`, attempts: 1, updatedAt: sql`now()` }).where(eq(mailOutbox.id, row.id));
        } catch (e) {
          this.log.warn(`delivery to ${m.to} failed (will retry): ${(e as Error).message}`);
          await this.db.update(mailOutbox).set({ status: 'failed', attempts: 1, error: (e as Error).message.slice(0, 500), updatedAt: sql`now()` }).where(eq(mailOutbox.id, row.id));
        }
      } else this.log.log(`(not delivered, no system e-mail / SMTP_URL) ${m.kind} → ${m.to}: ${m.subject}`);
      return row.id;
    } catch (e) {
      this.log.warn(`could not record mail ${m.kind} → ${m.to}: ${(e as Error).message}`);
      return null;
    }
  }
}
