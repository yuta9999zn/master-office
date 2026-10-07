import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { z } from 'zod';
import { type Actor, CurrentUser } from '../common/current-user';
import { parse } from '../common/validation';
import { SprintsService } from './sprints.service';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const sprintBody = z.object({ name: z.string().max(80).optional(), goal: z.string().max(1000).nullish(), startDate: day.optional(), days: z.number().int().min(1).max(60).optional(), epicId: z.string().uuid().nullish() });
const startBody = z.object({
  startDate: day.optional(),
  days: z.number().int().min(1).max(60).optional(),
  goal: z.string().max(1000).nullish(),
  ceremonies: z
    .object({ schedule: z.boolean(), dailyTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(), guests: z.array(z.string().uuid()).max(50).optional() })
    .optional(),
});

/** Sprints, reports and retrospectives (docs/ARCHITECTURE.md §76). */
@Controller('tasks')
export class SprintsController {
  constructor(private readonly svc: SprintsService) {}

  @Get('projects/:id/sprints')
  list(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.list(a, id);
  }

  @Post('projects/:id/sprints')
  create(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) {
    return this.svc.create(a, id, parse(sprintBody, b ?? {}));
  }

  @Get('projects/:id/velocity')
  velocity(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.velocity(a, id);
  }

  @Patch('sprints/:id')
  update(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) {
    return this.svc.update(a, id, parse(sprintBody.extend({ endDate: day.optional() }), b));
  }

  @Delete('sprints/:id')
  @HttpCode(204)
  remove(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.remove(a, id);
  }

  @Post('sprints/:id/start')
  @HttpCode(200)
  start(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) {
    return this.svc.start(a, id, parse(startBody, b ?? {}));
  }

  @Post('sprints/:id/complete')
  @HttpCode(200)
  complete(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) {
    return this.svc.complete(a, id, parse(z.object({ moveTo: z.string().uuid().nullish() }), b ?? {}));
  }

  @Get('sprints/:id/report')
  report(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.report(a, id);
  }

  @Get('sprints/:id/retro')
  retro(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.retro(a, id);
  }

  @Post('sprints/:id/retro')
  addRetro(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) {
    return this.svc.addRetro(a, id, parse(z.object({ kind: z.enum(['good', 'improve', 'action']), body: z.string().max(2000) }), b));
  }

  @Post('retro/:id/vote')
  @HttpCode(200)
  vote(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.vote(a, id);
  }

  @Delete('retro/:id')
  @HttpCode(204)
  removeRetro(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.removeRetro(a, id);
  }

  @Post('retro/:id/task')
  actionToTask(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) {
    return this.svc.actionToTask(a, id, parse(z.object({ assigneeId: z.string().uuid().nullish(), sprintId: z.string().uuid().nullish() }), b ?? {}));
  }
}
