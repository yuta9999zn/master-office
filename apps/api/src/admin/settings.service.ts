import { BadRequestException, Injectable } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import type { Actor } from '../common/current-user';
import { config } from '../config';
import type { Db } from '../db/client';
import { InjectDb } from '../db/db.module';
import { systemSettings } from '../db/schema';
import { decryptSecret, encryptSecret } from '../auth/secrets';

export type SmtpProvider = 'gmail' | 'outlook' | 'custom';
export interface SmtpStored {
  provider: SmtpProvider;
  host: string;
  port: number;
  /** true = TLS from the start (465); false = STARTTLS (587). */
  secure: boolean;
  user: string;
  fromName: string;
  /** Encrypted (secrets.ts); never leaves the server. */
  password?: string;
  verifiedAt?: string | null;
}
/** What the admin page sees: everything but the password. */
export type SmtpView = Omit<SmtpStored, 'password'> & { hasPassword: boolean; updatedAt: string | null };

export const SMTP_PRESETS: Record<Exclude<SmtpProvider, 'custom'>, { host: string; port: number; secure: boolean }> = {
  gmail: { host: 'smtp.gmail.com', port: 465, secure: true },
  outlook: { host: 'smtp.office365.com', port: 587, secure: false },
};

export interface GeneralSettings {
  /** The address people open the system at; links in e-mails (invitations, resets) point here. */
  appUrl: string | null;
}

/** Workspace settings (§79): the system mailbox (SMTP) and general settings. Secrets are encrypted at rest. */
@Injectable()
export class SettingsService {
  private version = 0;
  constructor(@InjectDb() private readonly db: Db) {}

  /** Bumped on every save — the mail transport is rebuilt when it changes. */
  get revision() {
    return this.version;
  }

  private async get<T>(workspaceId: string, key: string): Promise<{ value: T; updatedAt: string } | null> {
    const [row] = await this.db.select().from(systemSettings).where(and(eq(systemSettings.workspaceId, workspaceId), eq(systemSettings.key, key)));
    return row ? { value: row.value as T, updatedAt: row.updatedAt } : null;
  }

  private async put(actor: Actor | null, workspaceId: string, key: string, value: object) {
    await this.db
      .insert(systemSettings)
      .values({ workspaceId, key, value: value as Record<string, unknown>, updatedBy: actor?.id ?? null })
      .onConflictDoUpdate({ target: [systemSettings.workspaceId, systemSettings.key], set: { value: value as Record<string, unknown>, updatedBy: actor?.id ?? null, updatedAt: new Date().toISOString() } });
    this.version++;
  }

  /** Any setting by key (e.g. 'storage'), for services that own their own key. */
  async getValue<T>(workspaceId: string, key: string): Promise<T | null> {
    return (await this.get<T>(workspaceId, key))?.value ?? null;
  }

  async putValue(actor: Actor | null, workspaceId: string, key: string, value: object) {
    await this.put(actor, workspaceId, key, value);
  }

  async general(workspaceId: string): Promise<GeneralSettings> {
    return { appUrl: null, ...(await this.get<GeneralSettings>(workspaceId, 'general'))?.value };
  }

  async setGeneral(actor: Actor | null, workspaceId: string, input: Partial<GeneralSettings>) {
    const cur = await this.general(workspaceId);
    if (input.appUrl !== undefined) {
      const u = input.appUrl?.trim().replace(/\/+$/, '') || null;
      if (u && !/^https?:\/\/[^\s/]+(\/[^\s]*)?$/i.test(u)) throw new BadRequestException('The system address must start with http:// or https://');
      cur.appUrl = u;
    }
    await this.put(actor, workspaceId, 'general', cur);
    return cur;
  }

  /** Base URL for links in e-mails: the saved address, else WEB_ORIGIN. */
  async appUrl(workspaceId: string) {
    return ((await this.general(workspaceId)).appUrl ?? config.webOrigin).replace(/\/+$/, '');
  }

  async smtp(workspaceId: string): Promise<SmtpView | null> {
    const row = await this.get<SmtpStored>(workspaceId, 'smtp');
    if (!row) return null;
    const { password, ...rest } = row.value;
    return { ...rest, hasPassword: !!password, updatedAt: row.updatedAt };
  }

  async setSmtp(actor: Actor, input: { provider: SmtpProvider; user: string; password?: string | null; fromName?: string; host?: string; port?: number; secure?: boolean }) {
    const cur = (await this.get<SmtpStored>(actor.workspaceId, 'smtp'))?.value;
    const user = input.user.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(user) && input.provider !== 'custom') throw new BadRequestException('Enter the e-mail address of the sending account');
    if (!user) throw new BadRequestException('Enter the user name of the SMTP account');
    const preset = input.provider === 'custom' ? null : SMTP_PRESETS[input.provider];
    const host = preset?.host ?? input.host?.trim();
    const port = preset?.port ?? Number(input.port);
    if (!host || !/^[a-z0-9.-]+$/i.test(host)) throw new BadRequestException('Enter the SMTP server (host)');
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new BadRequestException('Enter a valid port (465 or 587 usually)');
    // Gmail shows app passwords in groups of four ("abcd efgh ijkl mnop"); the spaces are not part of it.
    const pw = input.password?.replace(input.provider === 'gmail' ? /\s+/g : /^$/, '');
    if (!pw && !cur?.password) throw new BadRequestException('Enter the app password');
    const value: SmtpStored = {
      provider: input.provider,
      host,
      port,
      secure: preset?.secure ?? (input.secure ?? port === 465),
      user,
      fromName: input.fromName?.trim() || 'Master Office',
      password: pw ? encryptSecret(pw) : cur!.password,
      verifiedAt: null,
    };
    await this.put(actor, actor.workspaceId, 'smtp', value);
    return this.smtp(actor.workspaceId);
  }

  async clearSmtp(actor: Actor) {
    await this.db.delete(systemSettings).where(and(eq(systemSettings.workspaceId, actor.workspaceId), eq(systemSettings.key, 'smtp')));
    this.version++;
  }

  async markVerified(workspaceId: string) {
    const row = await this.get<SmtpStored>(workspaceId, 'smtp');
    if (row) await this.db.update(systemSettings).set({ value: { ...row.value, verifiedAt: new Date().toISOString() } as unknown as Record<string, unknown> }).where(and(eq(systemSettings.workspaceId, workspaceId), eq(systemSettings.key, 'smtp')));
  }

  /** The system mailbox with its password decrypted — for the mail transport only. Single organisation: the latest saved. */
  async smtpForSending(): Promise<(Omit<SmtpStored, 'password'> & { password: string }) | null> {
    const [row] = await this.db.select().from(systemSettings).where(eq(systemSettings.key, 'smtp')).orderBy(desc(systemSettings.updatedAt)).limit(1);
    const v = row?.value as unknown as SmtpStored | undefined;
    if (!v?.password) return null;
    try {
      return { ...v, password: decryptSecret(v.password) };
    } catch {
      return null; // the key changed: the admin has to enter the password again
    }
  }
}
