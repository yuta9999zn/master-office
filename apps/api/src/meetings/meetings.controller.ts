import { Body, Controller, Get, HttpCode, Param, Patch, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { z } from 'zod';
import { type Actor, CurrentUser } from '../common/current-user';
import { parse } from '../common/validation';
import { config } from '../config';
import { MeetingsService } from './meetings.service';

const createBody = z.object({
  title: z.string().max(200).nullish(),
  conversationId: z.string().uuid().nullish(),
  access: z.enum(['open', 'trusted']).optional(),
  ring: z.boolean().optional(),
});
const updateBody = z.object({ title: z.string().max(200).optional(), access: z.enum(['open', 'trusted']).optional() });
const joinBody = z.object({ peerId: z.string().min(8).max(64), mic: z.boolean().default(true), cam: z.boolean().default(true) });
const user = z.object({ userId: z.string().uuid() });

/** Video meetings (docs/ARCHITECTURE.md §73). Rooms are addressed by their code (abc-defg-hij). */
@Controller('meetings')
export class MeetingsController {
  constructor(private readonly svc: MeetingsService) {}

  /** STUN / TURN servers for the browsers. */
  @Get('config')
  config(@CurrentUser() _a: Actor) {
    return { iceServers: config.meetings.iceServers };
  }

  @Get()
  list(@CurrentUser() a: Actor) {
    return this.svc.list(a);
  }

  @Post()
  create(@CurrentUser() a: Actor, @Body() b: unknown) {
    return this.svc.create(a, parse(createBody, b));
  }

  @Get(':code')
  get(@CurrentUser() a: Actor, @Param('code') code: string) {
    return this.svc.get(a, code);
  }

  @Patch(':code')
  @HttpCode(204)
  update(@CurrentUser() a: Actor, @Param('code') code: string, @Body() b: unknown) {
    return this.svc.update(a, code, parse(updateBody, b));
  }

  @Post(':code/join')
  @HttpCode(200)
  join(@CurrentUser() a: Actor, @Param('code') code: string, @Body() b: unknown) {
    return this.svc.join(a, code, parse(joinBody, b));
  }

  /** Also called with navigator.sendBeacon when the page closes. */
  @Post(':code/leave')
  @HttpCode(204)
  leave(@CurrentUser() a: Actor, @Param('code') code: string, @Body() b: unknown) {
    return this.svc.leave(a, code, parse(z.object({ peerId: z.string().max(64).optional() }), b ?? {}).peerId);
  }

  @Post(':code/alive')
  @HttpCode(200)
  alive(@CurrentUser() a: Actor, @Param('code') code: string, @Body() b: unknown) {
    return this.svc.alive(a, code, parse(z.object({ peerId: z.string().max(64) }), b).peerId);
  }

  @Post(':code/decline')
  @HttpCode(204)
  decline(@CurrentUser() a: Actor, @Param('code') code: string) {
    return this.svc.decline(a, code);
  }

  @Post(':code/admit')
  @HttpCode(204)
  admit(@CurrentUser() a: Actor, @Param('code') code: string, @Body() b: unknown) {
    const { userId, allow } = parse(user.extend({ allow: z.boolean() }), b);
    return this.svc.admit(a, code, userId, allow);
  }

  @Post(':code/mute')
  @HttpCode(204)
  mute(@CurrentUser() a: Actor, @Param('code') code: string, @Body() b: unknown) {
    return this.svc.mute(a, code, parse(z.object({ peerId: z.string().max(64) }), b).peerId);
  }

  @Post(':code/remove')
  @HttpCode(204)
  remove(@CurrentUser() a: Actor, @Param('code') code: string, @Body() b: unknown) {
    return this.svc.remove(a, code, parse(user, b).userId);
  }

  @Post(':code/cohost')
  @HttpCode(204)
  cohost(@CurrentUser() a: Actor, @Param('code') code: string, @Body() b: unknown) {
    const { userId, on } = parse(user.extend({ on: z.boolean() }), b);
    return this.svc.setCohost(a, code, userId, on);
  }

  @Post(':code/end')
  @HttpCode(204)
  end(@CurrentUser() a: Actor, @Param('code') code: string) {
    return this.svc.end(a, code);
  }

  @Get(':code/messages')
  messages(@CurrentUser() a: Actor, @Param('code') code: string) {
    return this.svc.messages(a, code);
  }

  @Post(':code/messages')
  post(@CurrentUser() a: Actor, @Param('code') code: string, @Body() b: unknown) {
    return this.svc.post(a, code, parse(z.object({ body: z.string().max(4000) }), b).body);
  }

  @Post(':code/recording')
  @HttpCode(200)
  recording(@CurrentUser() a: Actor, @Param('code') code: string, @Body() b: unknown) {
    return this.svc.setRecording(a, code, parse(z.object({ on: z.boolean() }), b).on);
  }

  @Post(':code/recordings')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: config.maxUploadBytes } }))
  saveRecording(@CurrentUser() a: Actor, @Param('code') code: string, @UploadedFile() file: Express.Multer.File | undefined, @Body() b: unknown) {
    return this.svc.saveRecording(a, code, file, Number(parse(z.object({ durationMs: z.coerce.number().min(0).max(24 * 3600_000).optional() }), b ?? {}).durationMs ?? 0));
  }

  @Post(':code/notes')
  @HttpCode(200)
  notes(@CurrentUser() a: Actor, @Param('code') code: string) {
    return this.svc.notes(a, code);
  }
}
