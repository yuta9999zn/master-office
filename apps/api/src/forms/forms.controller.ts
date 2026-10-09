import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query, Req, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { RateLimit } from '../common/ratelimit';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { type Actor, CurrentUser } from '../common/current-user';
import { contentDisposition } from '../common/http';
import { parse } from '../common/validation';
import { FormsService } from './forms.service';

const submitBody = z.object({
  answers: z.record(z.string().max(64), z.unknown()),
  email: z.string().max(320).nullish(),
  editToken: z.string().max(64).nullish(),
  sendCopy: z.boolean().optional(),
});
const gradesBody = z.object({
  grades: z.record(z.string().max(64), z.object({ points: z.number().finite().nullish(), feedback: z.string().max(5000).optional() })),
});
const releaseBody = z.object({ ids: z.union([z.literal('all'), z.array(z.string().uuid()).max(5000)]) });
const notifyBody = z.object({ on: z.boolean() });
const deleteBody = z.object({ ids: z.union([z.literal('all'), z.array(z.string().uuid()).max(5000)]) });

@Controller('forms')
export class FormsController {
  constructor(private readonly forms: FormsService) {}

  // Respondent endpoints: need the link, not a share (the form's own access setting decides).
  @Get(':id/public')
  view(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string, @Query('edit') edit?: string) {
    return this.forms.publicView(req.actor, id, edit?.slice(0, 64));
  }

  @Get(':id/public/summary')
  summary(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string) {
    return this.forms.publicSummary(req.actor, id);
  }

  @RateLimit(30, 60)
  @Post(':id/responses')
  submit(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) {
    const input = parse(submitBody, b);
    return this.forms.submit(req.actor, id, { answers: input.answers as never, email: input.email, editToken: input.editToken, sendCopy: input.sendCopy });
  }

  /** "View score" — the respondent's own response token is the credential. */
  @Get(':id/public/result')
  result(@Param('id', ParseUUIDPipe) id: string, @Query('token') token = '') {
    return this.forms.result(id, token.slice(0, 64));
  }

  @RateLimit(20, 60)
  @Post(':id/uploads')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 100 * 1024 * 1024 } }))
  upload(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string, @UploadedFile() file: Express.Multer.File) {
    return this.forms.upload(req.actor, id, file);
  }

  // Owner endpoints (editors of the form).
  @Get(':id/responses')
  list(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.forms.responses(a, id);
  }

  @Post(':id/responses/delete')
  @HttpCode(204)
  remove(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) {
    return this.forms.deleteResponses(a, id, parse(deleteBody, b).ids);
  }

  @Delete(':id/responses')
  @HttpCode(204)
  removeAll(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.forms.deleteResponses(a, id, 'all');
  }

  @Get(':id/responses.csv')
  async csv(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const f = await this.forms.csv(a, id);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', contentDisposition(f.name, 'attachment'));
    res.send(f.body);
  }

  @Patch(':id/responses/:rid/grades')
  grade(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Param('rid', ParseUUIDPipe) rid: string, @Body() b: unknown) {
    return this.forms.grade(a, id, rid, parse(gradesBody, b).grades as never);
  }

  @Post(':id/release')
  release(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) {
    return this.forms.release(a, id, parse(releaseBody, b).ids);
  }

  @Get(':id/notifications')
  notifications(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.forms.subscription(a, id);
  }

  @Put(':id/notifications')
  setNotifications(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) {
    return this.forms.setSubscription(a, id, parse(notifyBody, b).on);
  }

  @Get(':id/outbox')
  outbox(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.forms.outbox(a, id);
  }

  @Get(':id/definition')
  definition(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.forms.definition(a, id);
  }

  @Post(':id/sheet')
  linkSheet(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.forms.linkSheet(a, id);
  }
}
