import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { z } from 'zod';
import { type Actor, CurrentUser } from '../common/current-user';
import { parse } from '../common/validation';
import { CommentsService } from './comments.service';

const createBody = z.object({
  body: z.string().trim().min(1).max(10_000),
  threadId: z.string().uuid().nullish(),
  anchor: z.object({ from: z.unknown(), to: z.unknown() }).nullish(),
  quote: z.string().max(2000).nullish(),
});
const updateBody = z.object({ body: z.string().trim().min(1).max(10_000).optional(), resolved: z.boolean().optional() });

@Controller()
export class CommentsController {
  constructor(private readonly svc: CommentsService) {}

  @Get('resources/:id/comments')
  list(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.list(a, id);
  }

  @Post('resources/:id/comments')
  create(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) {
    const input = parse(createBody, b);
    return this.svc.create(a, id, { ...input, anchor: input.anchor ? { from: input.anchor.from, to: input.anchor.to } : null });
  }

  @Patch('comments/:cid')
  @HttpCode(204)
  update(@CurrentUser() a: Actor, @Param('cid', ParseUUIDPipe) cid: string, @Body() b: unknown) {
    return this.svc.update(a, cid, parse(updateBody, b));
  }

  @Delete('comments/:cid')
  @HttpCode(204)
  remove(@CurrentUser() a: Actor, @Param('cid', ParseUUIDPipe) cid: string) {
    return this.svc.remove(a, cid);
  }
}
