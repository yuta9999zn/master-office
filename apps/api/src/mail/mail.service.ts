import { Injectable, Logger } from '@nestjs/common';
import { desc, eq, sql } from 'drizzle-orm';
import { createTransport, type Transporter } from 'nodemailer';
import { config } from '../config';
import type { Db } from '../db/client';
import { InjectDb } from '../db/db.module';
import { mailOutbox } from '../db/schema';

export interface MailMessage {
  kind: string; // e.g. form.response, form.copy, form.score
  to: string;
  subject: string;
  text: string;
  html?: string;
  resourceId?: string | null;
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
export class MailService {
  private readonly log = new Logger('Mail');
  private transport: Transporter | null = config.mail.smtpUrl ? createTransport(config.mail.smtpUrl) : null;

  constructor(@InjectDb() private readonly db: Db) {}

  get delivering() {
    return !!this.transport;
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
        .values({ kind: m.kind, to: m.to, subject: m.subject, text: m.text, html: m.html ?? null, resourceId: m.resourceId ?? null, status: this.transport ? 'queued' : 'logged' })
        .returning({ id: mailOutbox.id });
      if (this.transport) {
        try {
          await this.transport.sendMail({ from: config.mail.from, to: m.to, subject: m.subject, text: m.text, html: m.html });
          await this.db.update(mailOutbox).set({ status: 'sent', sentAt: sql`now()` }).where(eq(mailOutbox.id, row.id));
        } catch (e) {
          this.log.warn(`delivery to ${m.to} failed: ${(e as Error).message}`);
          await this.db.update(mailOutbox).set({ status: 'failed', error: (e as Error).message.slice(0, 500) }).where(eq(mailOutbox.id, row.id));
        }
      } else this.log.log(`(not delivered, SMTP_URL unset) ${m.kind} → ${m.to}: ${m.subject}`);
      return row.id;
    } catch (e) {
      this.log.warn(`could not record mail ${m.kind} → ${m.to}: ${(e as Error).message}`);
      return null;
    }
  }
}
