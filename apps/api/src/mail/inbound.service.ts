import { Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { type AddressObject, simpleParser } from 'mailparser';
import { SMTPServer } from 'smtp-server';
import { inArray } from 'drizzle-orm';
import { config } from '../config';
import type { Db } from '../db/client';
import { InjectDb } from '../db/db.module';
import { mailboxes } from '../db/schema';
import { MailboxService } from './mailbox.service';

const MAX_BYTES = 25 * 1024 * 1024;

const addrs = (v: AddressObject | AddressObject[] | undefined) =>
  (Array.isArray(v) ? v : v ? [v] : []).flatMap((o) => o.value).filter((a) => !!a.address).map((a) => ({ address: a.address!.toLowerCase(), name: a.name || null }));

/**
 * Mail from outside (docs/ARCHITECTURE.md §70): an SMTP listener that accepts mail only for addresses that have a
 * mailbox here, and a webhook for raw MIME from mail providers. Parsed with mailparser and filed like any message.
 */
@Injectable()
export class InboundMailService implements OnModuleInit, OnApplicationShutdown {
  private readonly log = new Logger('InboundMail');
  private server?: SMTPServer;

  constructor(
    @InjectDb() private readonly db: Db,
    private readonly mailboxes: MailboxService,
  ) {}

  onModuleInit() {
    if (!config.mail.inboundPort) return;
    this.server = new SMTPServer({
      name: 'master-office',
      banner: 'Master Office mail',
      size: MAX_BYTES,
      authOptional: true,
      // Plain SMTP on the private port; in production an MTA (or a provider webhook) sits in front and handles TLS.
      disabledCommands: ['AUTH', 'STARTTLS'],
      onRcptTo: async (address, _session, cb) => {
        const ok = await this.db
          .select({ id: mailboxes.id })
          .from(mailboxes)
          .where(inArray(mailboxes.address, [address.address.toLowerCase()]))
          .then((r) => r.length > 0, () => false);
        cb(ok ? undefined : Object.assign(new Error(`No mailbox for ${address.address}`), { responseCode: 550 }));
      },
      onData: (stream, session, cb) => {
        const chunks: Buffer[] = [];
        let size = 0;
        stream.on('data', (c: Buffer) => {
          size += c.length;
          if (size <= MAX_BYTES) chunks.push(c);
        });
        stream.on('end', () => {
          if (size > MAX_BYTES) return cb(Object.assign(new Error('Message too large'), { responseCode: 552 }));
          this.receive(Buffer.concat(chunks), session.envelope.rcptTo.map((r) => r.address))
            .then(() => cb())
            .catch((e: Error) => {
              this.log.warn(`inbound failed: ${e.message}`);
              cb(Object.assign(new Error('Could not store the message'), { responseCode: 451 }));
            });
        });
      },
      logger: false,
    });
    this.server.on('error', (e) => this.log.warn(`SMTP server: ${e.message}`));
    this.server.listen(config.mail.inboundPort, () => this.log.log(`Inbound SMTP on port ${config.mail.inboundPort}`));
  }

  onApplicationShutdown() {
    this.server?.close();
  }

  /**
   * Files a raw message in the mailboxes it is for: the SMTP envelope recipients when known, else the To / Cc
   * addresses that have a mailbox here. Returns how many mailboxes received it.
   */
  async receive(raw: Buffer, envelopeTo?: string[]) {
    if (raw.length > MAX_BYTES) throw new Error('Message too large');
    const p = await simpleParser(raw);
    const from = addrs(p.from)[0] ?? { address: 'unknown@invalid', name: null };
    const to = addrs(p.to);
    const cc = addrs(p.cc);
    const targets = (envelopeTo?.length ? envelopeTo : [...to, ...cc].map((a) => a.address)).map((a) => a.toLowerCase());
    const refs = (Array.isArray(p.references) ? p.references : p.references ? [p.references] : []).map((r) => r.replace(/^<|>$/g, ''));
    return this.mailboxes.receiveExternal({
      messageId: (p.messageId ?? `${crypto.randomUUID()}@inbound.invalid`).replace(/^<|>$/g, ''),
      inReplyTo: p.inReplyTo ? p.inReplyTo.replace(/^<|>$/g, '') : null,
      references: refs,
      from,
      to,
      cc,
      subject: p.subject ?? '',
      text: p.text ?? (p.html ? String(p.html).replace(/<[^>]+>/g, ' ') : ''),
      // Scripts never survive; the web app also shows outside HTML in a sandboxed frame.
      html: p.html ? String(p.html).replace(/<script[\s\S]*?<\/script>/gi, '').replace(/\son\w+\s*=\s*(["']).*?\1/gi, '') : null,
      // Shown and ordered by when it arrived here (the Date header is the sender's clock, to the second).
      sentAt: new Date().toISOString(),
      attachments: p.attachments.filter((a) => a.contentDisposition !== 'inline' || !a.cid).map((a) => ({ name: a.filename ?? 'attachment', mimeType: a.contentType, content: a.content })),
      targets,
    });
  }
}
