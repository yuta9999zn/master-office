import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { type Actor, CurrentUser } from '../common/current-user';
import { parse } from '../common/validation';
import { QaService } from './qa.service';

const token = z.string().regex(/^[\w-]{6,32}$/);
// Phase 1 gives every request a user (the default one without a cookie): on the public audience page only a
// request that names its user counts as signed in; everyone else is anonymous, with a random id per browser
// (kept by the page) so each person votes once per question.
const signedIn = (req: Request) => (req.header('x-user-id') || /(?:^|;\s*)(?:mo_uid|mo_session)=/.test(req.header('cookie') ?? '') ? req.actor : undefined);
const voterOf = (req: Request, given: unknown) => signedIn(req)?.id ?? parse(z.string().uuid(), given);

/** Audience Q&A (docs/ARCHITECTURE.md §55). */
@Controller()
export class QaController {
  constructor(private readonly qa: QaService) {}

  // Presenter (needs access to the presentation).
  @Get('resources/:id/qa')
  state(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.qa.state(a, id);
  }

  @Post('resources/:id/qa')
  start(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.qa.start(a, id);
  }

  @Delete('resources/:id/qa')
  @HttpCode(204)
  end(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.qa.end(a, id);
  }

  @Patch('qa-questions/:qid')
  @HttpCode(204)
  moderate(@CurrentUser() a: Actor, @Param('qid', ParseUUIDPipe) qid: string, @Body() b: unknown) {
    return this.qa.moderate(a, qid, parse(z.object({ presenting: z.boolean().optional(), hidden: z.boolean().optional() }), b));
  }

  // Audience (the link is enough).
  @Get('qa/:token')
  audience(@Req() req: Request, @Param('token') t: string, @Query('voter') voter?: string) {
    return this.qa.audience(parse(token, t), signedIn(req)?.id ?? (voter && z.string().uuid().safeParse(voter).success ? voter : null));
  }

  @Post('qa/:token/questions')
  @HttpCode(204)
  ask(@Req() req: Request, @Param('token') t: string, @Body() b: unknown) {
    const body = parse(z.object({ text: z.string().min(1).max(1000), anonymous: z.boolean().default(false), voter: z.string().optional() }), b);
    return this.qa.ask(parse(token, t), signedIn(req), voterOf(req, body.voter), body);
  }

  @Post('qa/:token/questions/:qid/vote')
  @HttpCode(204)
  vote(@Req() req: Request, @Param('token') t: string, @Param('qid', ParseUUIDPipe) qid: string, @Body() b: unknown) {
    return this.qa.vote(parse(token, t), qid, voterOf(req, parse(z.object({ voter: z.string().optional() }), b ?? {}).voter));
  }
}
