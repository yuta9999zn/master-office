import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { z } from 'zod';
import { type Actor, CurrentUser } from '../common/current-user';
import { contentDisposition } from '../common/http';
import { parse } from '../common/validation';
import { config } from '../config';
import { ResourcesService } from '../resources/resources.service';
import { MailboxService } from './mailbox.service';

const addr = z.object({ address: z.string().max(320), name: z.string().max(200).nullish().transform((v) => v ?? null) });
const addrs = z.array(addr).max(100).optional();
const sendBody = z.object({
  mailboxId: z.string().uuid(),
  to: z.array(addr).max(100).default([]),
  cc: addrs,
  bcc: addrs,
  subject: z.string().max(500).default(''),
  text: z.string().max(200_000).default(''),
  attachmentIds: z.array(z.string().uuid()).max(30).optional(),
  resourceIds: z.array(z.string().uuid()).max(30).optional(),
  replyTo: z.string().uuid().nullish(),
  draftId: z.string().uuid().nullish(),
});
const draftBody = z.object({
  mailboxId: z.string().uuid(),
  draftId: z.string().uuid().nullish(),
  to: addrs,
  cc: addrs,
  bcc: addrs,
  subject: z.string().max(500).optional(),
  text: z.string().max(200_000).optional(),
  replyTo: z.string().uuid().nullish(),
  attachmentIds: z.array(z.string().uuid()).max(30).optional(),
});
const threadBody = z.object({
  read: z.boolean().optional(),
  starred: z.boolean().optional(),
  folder: z.enum(['inbox', 'archive', 'trash']).optional(),
  assigneeId: z.string().uuid().nullable().optional(),
});
const folders = z.enum(['inbox', 'starred', 'sent', 'drafts', 'archive', 'trash', 'all']);
const mailboxBody = z.object({ name: z.string().max(120).optional(), signature: z.string().max(2000).nullish() });
const spaceMailboxBody = z.object({ localPart: z.string().min(1).max(41), name: z.string().max(120).optional() });
const saveBody = z.object({ parentId: z.string().uuid().optional(), spaceId: z.string().uuid().optional() });

@Controller('mail')
export class MailController {
  constructor(
    private readonly mail: MailboxService,
    private readonly resources: ResourcesService,
  ) {}

  @Get('mailboxes')
  mailboxes(@CurrentUser() a: Actor) {
    return this.mail.list(a);
  }

  @Patch('mailboxes/:id')
  @HttpCode(204)
  updateMailbox(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) {
    return this.mail.updateMailbox(a, id, parse(mailboxBody, b));
  }

  @Post('spaces/:spaceId/mailbox')
  enable(@CurrentUser() a: Actor, @Param('spaceId', ParseUUIDPipe) spaceId: string, @Body() b: unknown) {
    return this.mail.enableSpaceMailbox(a, spaceId, parse(spaceMailboxBody, b));
  }

  @Get('mailboxes/:id/threads')
  threads(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Query('folder') folder = 'inbox', @Query('q') q?: string, @Query('before') before?: string) {
    const f = folders.safeParse(folder);
    if (!f.success) throw new BadRequestException('Unknown folder');
    return this.mail.threads(a, id, { folder: f.data, q, before });
  }

  @Get('threads/:id')
  thread(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.mail.thread(a, id);
  }

  @Patch('threads/:id')
  @HttpCode(204)
  updateThread(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) {
    return this.mail.updateThread(a, id, parse(threadBody, b));
  }

  @Delete('threads/:id')
  @HttpCode(204)
  deleteThread(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.mail.deleteThread(a, id);
  }

  @Post('send')
  send(@CurrentUser() a: Actor, @Body() b: unknown) {
    return this.mail.send(a, parse(sendBody, b));
  }

  @Post('drafts')
  saveDraft(@CurrentUser() a: Actor, @Body() b: unknown) {
    return this.mail.saveDraft(a, parse(draftBody, b));
  }

  @Delete('drafts/:id')
  @HttpCode(204)
  deleteDraft(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.mail.deleteDraft(a, id);
  }

  @Post('attachments')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: config.maxUploadBytes } }))
  upload(@CurrentUser() a: Actor, @UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('No file');
    return this.mail.upload(a, file);
  }

  @Get('attachments/:id')
  async download(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Query('inline') inline: string | undefined, @Res() res: Response) {
    const f = await this.mail.download(a, id);
    res.setHeader('Content-Type', f.mimeType);
    res.setHeader('Content-Length', String(f.size));
    res.setHeader('Content-Disposition', contentDisposition(f.name, inline ? 'inline' : 'attachment'));
    f.stream.pipe(res);
  }

  /** "Save to Drive": a copy of the attachment as a file in My Files, a folder or a space. */
  @Post('attachments/:id/save')
  async save(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) {
    const { att, buffer } = await this.mail.buffer(a, id);
    const file = { originalname: Buffer.from(att.name, 'utf8').toString('latin1'), buffer, mimetype: att.mimeType ?? 'application/octet-stream', size: buffer.length } as Express.Multer.File;
    return this.resources.upload(a, file, parse(saveBody, b ?? {}));
  }

  @Get('addresses')
  addresses(@CurrentUser() a: Actor, @Query('q') q = '') {
    return this.mail.addresses(a, q);
  }
}
