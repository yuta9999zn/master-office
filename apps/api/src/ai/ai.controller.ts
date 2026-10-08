import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { OrgService } from '../admin/org.service';
import { type Actor, CurrentUser } from '../common/current-user';
import { parse } from '../common/validation';
import { AiService } from './ai.service';

const apps = z.enum(['flow', 'sheets', 'slides', 'docs', 'general']);
const promptBody = z.object({
  name: z.string().trim().min(1).max(120),
  app: apps,
  output: z.enum(['flow', 'sheet', 'deck', 'design', 'template', 'markdown', 'text']),
  description: z.string().max(2000).default(''),
  system: z.string().trim().min(1).max(20_000),
  template: z.string().trim().min(1).max(20_000),
  temperature: z.number().min(0).max(2).default(0.3),
  variables: z.array(z.object({ name: z.string().regex(/^\w+$/).max(40), label: z.string().max(80), example: z.string().max(2000).default('') })).max(20).default([]),
});
const jobBody = z.object({
  promptKey: z.string().max(80),
  request: z.string().max(20_000).default(''),
  variables: z.record(z.string(), z.string().max(30_000)).optional(),
  targetId: z.string().uuid().nullish(),
  spaceId: z.string().uuid().nullish(),
  parentId: z.string().uuid().nullish(),
  format: z.string().max(40).nullish(),
  model: z.string().max(120).nullish(),
  notation: z.enum(['flowchart', 'bpmn']).nullish(),
});
const settingsBody = z.object({
  enabled: z.boolean().optional(),
  url: z.string().max(300).optional(),
  model: z.string().max(120).optional(),
  models: z.record(apps, z.string().max(120)).optional(),
  numCtx: z.number().int().optional(),
});

/** The AI layer (docs/ARCHITECTURE.md §80): status, prompt library, jobs, settings. */
@Controller('ai')
export class AiController {
  constructor(
    private readonly ai: AiService,
    private readonly org: OrgService,
  ) {}

  @Get('status')
  status(@CurrentUser() a: Actor) {
    return this.ai.status(a);
  }

  @Get('settings')
  async settings(@CurrentUser() a: Actor) {
    await this.org.requireAdmin(a);
    return this.ai.settings(a.workspaceId);
  }

  @Put('settings')
  async setSettings(@CurrentUser() a: Actor, @Body() b: unknown) {
    await this.org.requireAdmin(a);
    return this.ai.setSettings(a, parse(settingsBody, b));
  }

  @Get('prompts')
  prompts(@CurrentUser() a: Actor) {
    return this.ai.prompts(a);
  }

  @Get('prompts/:key')
  prompt(@CurrentUser() a: Actor, @Param('key') key: string) {
    return this.ai.prompt(a, key);
  }

  /** A new prompt of one's own. */
  @Post('prompts')
  create(@CurrentUser() a: Actor, @Body() b: unknown) {
    return this.ai.savePrompt(a, null, parse(promptBody, b));
  }

  @Put('prompts/:key')
  save(@CurrentUser() a: Actor, @Param('key') key: string, @Body() b: unknown) {
    return this.ai.savePrompt(a, key, parse(promptBody, b));
  }

  /** Deletes one's own prompt, or returns a built-in one to its shipped text. */
  @Delete('prompts/:key')
  @HttpCode(204)
  remove(@CurrentUser() a: Actor, @Param('key') key: string) {
    return this.ai.deletePrompt(a, key);
  }

  @Post('jobs')
  start(@CurrentUser() a: Actor, @Body() b: unknown) {
    return this.ai.start(a, parse(jobBody, b));
  }

  @Get('jobs')
  jobs(@CurrentUser() a: Actor, @Query('limit') limit?: string) {
    return this.ai.jobs(a, limit ? Number(limit) : undefined);
  }

  @Get('jobs/:id')
  job(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.ai.job(a, id);
  }

  @Post('jobs/:id/cancel')
  @HttpCode(200)
  cancel(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.ai.cancel(a, id);
  }
}
