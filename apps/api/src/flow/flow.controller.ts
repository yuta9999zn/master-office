import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ACTION_TYPES, CONDITION_OPS, shapeCatalog, TRIGGER_TYPES, type PlainFlow } from '@workos/flow-model';
import { z } from 'zod';
import { type Actor, CurrentUser } from '../common/current-user';
import { parse } from '../common/validation';
import { FlowRunnerService } from './flow-runner.service';

const runBody = z.object({ nodeId: z.string().max(64).nullish(), input: z.record(z.string(), z.unknown()).optional() });
const enabledBody = z.object({ enabled: z.boolean() });

/** Flow automation (docs/ARCHITECTURE.md §77 batch 2): status, runs, run now, continue / cancel, import. */
@Controller('flows')
export class FlowController {
  constructor(private readonly runner: FlowRunnerService) {}

  /** The whole vocabulary as data — shapes (with BPMN meaning), triggers, actions, condition tests — for docs and for an AI that drafts flows. */
  @Get('catalog')
  catalog() {
    return { shapes: shapeCatalog(), triggers: TRIGGER_TYPES, actions: ACTION_TYPES, conditions: CONDITION_OPS };
  }

  @Get(':id/automation')
  automation(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.runner.automation(a, id);
  }

  @Put(':id/automation')
  setEnabled(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) {
    return this.runner.setEnabled(a, id, parse(enabledBody, b).enabled);
  }

  @Get(':id/runs')
  runs(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Query('limit') limit?: string) {
    return this.runner.runs(a, id, limit ? Number(limit) : undefined);
  }

  @Get(':id/runs/:rid')
  run(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Param('rid', ParseUUIDPipe) rid: string) {
    return this.runner.run(a, id, rid);
  }

  @Post(':id/run')
  @HttpCode(200)
  runNow(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) {
    return this.runner.runNow(a, id, parse(runBody, b ?? {}));
  }

  @Post(':id/runs/:rid/resume')
  @HttpCode(200)
  resume(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Param('rid', ParseUUIDPipe) rid: string) {
    return this.runner.resumeNow(a, id, rid);
  }

  @Post(':id/runs/:rid/cancel')
  @HttpCode(200)
  cancel(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Param('rid', ParseUUIDPipe) rid: string) {
    return this.runner.cancel(a, id, rid);
  }

  /** Replaces the diagram with a .json export (Import in the designer; tests write diagrams this way). */
  @Post(':id/import')
  @HttpCode(200)
  importFlow(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) {
    return this.runner.importFlow(a, id, b as PlainFlow);
  }
}
