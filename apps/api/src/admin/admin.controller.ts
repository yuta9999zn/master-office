import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import { z } from 'zod';
import { type Actor, CurrentUser } from '../common/current-user';
import { parse } from '../common/validation';
import { MailService } from '../mail/mail.service';
import { OrgService } from './org.service';
import { SettingsService, SMTP_PRESETS } from './settings.service';

const uuid = z.string().uuid();
const memberRole = z.enum(['admin', 'editor', 'viewer']);

/** Admin console (docs/ARCHITECTURE.md §79): members, invitations, system e-mail, general settings. */
@Controller('admin')
export class AdminController {
  constructor(
    private readonly org: OrgService,
    private readonly settings: SettingsService,
    private readonly mail: MailService,
  ) {}

  @Get('me')
  async me(@CurrentUser() a: Actor) {
    return { role: await this.org.myRole(a) };
  }

  @Get('members')
  members(@CurrentUser() a: Actor) {
    return this.org.members(a);
  }

  @Patch('members/:id')
  updateMember(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) {
    return this.org.updateMember(a, id, parse(z.object({ role: memberRole.optional(), status: z.enum(['active', 'suspended']).optional() }), b));
  }

  @Post('members/:id/password-link')
  @HttpCode(200)
  passwordLink(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.org.sendPasswordLink(a, id);
  }

  @Post('owner')
  @HttpCode(200)
  transfer(@CurrentUser() a: Actor, @Body() b: unknown) {
    return this.org.transferOwnership(a, parse(z.object({ userId: uuid }), b).userId);
  }

  @Get('invitations')
  invitations(@CurrentUser() a: Actor) {
    return this.org.invitations(a);
  }

  @Post('invitations')
  invite(@CurrentUser() a: Actor, @Body() b: unknown) {
    return this.org.invite(
      a,
      parse(
        z.object({
          emails: z.array(z.string().max(200)).min(1).max(50),
          role: memberRole.default('editor'),
          teams: z.array(z.object({ spaceId: uuid, role: memberRole.default('editor'), title: z.string().max(80).nullish() })).max(20).default([]),
          message: z.string().max(1000).nullish(),
        }),
        b,
      ),
    );
  }

  @Post('invitations/:id/resend')
  @HttpCode(200)
  resend(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.org.resendInvitation(a, id);
  }

  @Delete('invitations/:id')
  @HttpCode(204)
  revoke(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.org.revokeInvitation(a, id);
  }

  // ── System e-mail ────────────────────────────────────────────────────────

  @Get('settings/smtp')
  async smtp(@CurrentUser() a: Actor) {
    await this.org.requireAdmin(a);
    return { smtp: await this.settings.smtp(a.workspaceId), presets: SMTP_PRESETS };
  }

  @Put('settings/smtp')
  async setSmtp(@CurrentUser() a: Actor, @Body() b: unknown) {
    await this.org.requireAdmin(a);
    const input = parse(
      z.object({
        provider: z.enum(['gmail', 'outlook', 'custom']),
        user: z.string().max(200),
        password: z.string().max(300).nullish(),
        fromName: z.string().max(80).optional(),
        host: z.string().max(200).optional(),
        port: z.coerce.number().int().optional(),
        secure: z.boolean().optional(),
      }),
      b,
    );
    return { smtp: await this.settings.setSmtp(a, input) };
  }

  @Delete('settings/smtp')
  @HttpCode(204)
  async clearSmtp(@CurrentUser() a: Actor) {
    await this.org.requireAdmin(a);
    await this.settings.clearSmtp(a);
  }

  /** Sends a test e-mail now and reports the server's answer (e.g. "535 Username and Password not accepted"). */
  @Post('settings/smtp/test')
  @HttpCode(200)
  async testSmtp(@CurrentUser() a: Actor, @Body() b: unknown) {
    await this.org.requireAdmin(a);
    const { to } = parse(z.object({ to: z.string().email().max(200) }), b);
    try {
      await this.mail.test(to);
    } catch (e) {
      throw new BadRequestException(`The e-mail could not be sent: ${(e as Error).message.slice(0, 300)}`);
    }
    await this.settings.markVerified(a.workspaceId);
    return { ok: true, smtp: await this.settings.smtp(a.workspaceId) };
  }

  @Get('settings/general')
  async general(@CurrentUser() a: Actor) {
    await this.org.requireAdmin(a);
    return this.settings.general(a.workspaceId);
  }

  @Patch('settings/general')
  async setGeneral(@CurrentUser() a: Actor, @Body() b: unknown) {
    await this.org.requireAdmin(a);
    return this.settings.setGeneral(a, a.workspaceId, parse(z.object({ appUrl: z.string().max(300).nullish() }), b));
  }
}
