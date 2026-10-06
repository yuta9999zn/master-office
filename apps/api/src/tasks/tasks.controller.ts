import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ISSUE_TYPES } from '@workos/shared';
import { z } from 'zod';
import { type Actor, CurrentUser } from '../common/current-user';
import { parse } from '../common/validation';
import { TasksService } from './tasks.service';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish();
const taskBody = z.object({
  projectId: z.string().uuid().nullish(),
  parentId: z.string().uuid().nullish(),
  type: z.enum(ISSUE_TYPES).optional(),
  reporterId: z.string().uuid().nullish(),
  storyPoints: z.number().int().min(0).max(1000).nullish(),
  estimateMinutes: z.number().int().min(0).max(100_000).nullish(),
  triage: z.literal(false).optional(),
  source: z.object({ kind: z.literal('chat'), conversationId: z.string().uuid(), messageId: z.string().uuid() }).nullish(),
  sprintId: z.string().uuid().nullish(),
  rankAfter: z.string().uuid().nullish(),
  rankBefore: z.string().uuid().nullish(),
  title: z.string().max(500),
  description: z.string().max(50_000).nullish(),
  status: z.string().max(40).optional(),
  priority: z.enum(['none', 'low', 'medium', 'high', 'urgent']).optional(),
  assigneeId: z.string().uuid().nullish(),
  tags: z.array(z.string().max(40)).max(10).optional(),
  startDate: day,
  dueDate: day,
  progress: z.number().int().min(0).max(100).optional(),
  before: z.string().uuid().nullish(),
  after: z.string().uuid().nullish(),
});
const status = z.object({ id: z.string().min(1).max(40), name: z.string().max(60), color: z.string().max(20), category: z.enum(['todo', 'doing', 'done']) });
const methodology = z.enum(['scrum', 'kanban', 'waterfall', 'hybrid']);
const projectBody = z.object({ spaceId: z.string().uuid(), name: z.string().max(120), key: z.string().max(10).optional(), color: z.string().max(20).optional(), description: z.string().max(2000).nullish(), methodology: methodology.optional() });
const projectUpdate = z.object({
  name: z.string().max(120).optional(),
  color: z.string().max(20).optional(),
  description: z.string().max(2000).nullish(),
  statuses: z.array(status).min(1).max(12).optional(),
  archived: z.boolean().optional(),
  methodology: methodology.optional(),
  leadId: z.string().uuid().nullish(),
  intakeOpen: z.boolean().optional(),
  sprintDays: z.number().int().min(1).max(60).optional(),
  dailyTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
  wipLimits: z.record(z.string(), z.number().int().min(0).max(999)).optional(),
});
const requestBody = z.object({ title: z.string().max(500), description: z.string().max(50_000).nullish(), type: z.enum(['story', 'task', 'bug']).optional(), priority: z.enum(['none', 'low', 'medium', 'high', 'urgent']).optional() });

@Controller('tasks')
export class TasksController {
  constructor(private readonly svc: TasksService) {}

  @Get('projects')
  projects(@CurrentUser() a: Actor, @Query('space') space?: string) {
    return this.svc.projects(a, space);
  }

  @Post('projects')
  createProject(@CurrentUser() a: Actor, @Body() b: unknown) {
    return this.svc.createProject(a, parse(projectBody, b));
  }

  @Patch('projects/:id')
  @HttpCode(204)
  updateProject(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) {
    return this.svc.updateProject(a, id, parse(projectUpdate, b));
  }

  /** A request into the project's intake queue (anyone who can see the project). */
  @Post('projects/:id/requests')
  request(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) {
    return this.svc.request(a, id, parse(requestBody, b));
  }

  @Get('projects/:id/stats')
  stats(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.stats(a, id);
  }

  /** ?project=<id> for a project's tasks, ?mine=1 for mine (assigned to me + personal). */
  @Get()
  list(@CurrentUser() a: Actor, @Query('project') project?: string, @Query('mine') mine?: string) {
    return this.svc.list(a, { projectId: project, mine: mine === '1' || mine === 'true' });
  }

  @Get(':id')
  get(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.get(a, id);
  }

  @Post()
  create(@CurrentUser() a: Actor, @Body() b: unknown) {
    return this.svc.create(a, parse(taskBody, b));
  }

  @Patch(':id')
  update(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) {
    return this.svc.update(a, id, parse(taskBody.partial(), b));
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.remove(a, id);
  }

  @Post(':id/comments')
  comment(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) {
    return this.svc.comment(a, id, parse(z.object({ body: z.string().max(10_000) }), b).body);
  }

  @Post(':id/decline')
  @HttpCode(200)
  decline(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) {
    return this.svc.decline(a, id, parse(z.object({ reason: z.string().max(2000).default('') }), b ?? {}).reason);
  }

  /** One child per line. */
  @Post(':id/breakdown')
  breakdown(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) {
    return this.svc.breakdown(a, id, parse(z.object({ titles: z.array(z.string().max(500)).max(50), type: z.enum(ISSUE_TYPES).optional() }), b));
  }

  @Post(':id/links')
  link(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) {
    return this.svc.link(a, id, parse(z.object({ toId: z.string().uuid(), kind: z.enum(['blocks', 'relates', 'duplicates']) }), b));
  }

  @Delete(':id/links/:linkId')
  unlink(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Param('linkId', ParseUUIDPipe) linkId: string) {
    return this.svc.unlink(a, id, linkId);
  }

  @Post(':id/watch')
  @HttpCode(200)
  watch(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) {
    return this.svc.watch(a, id, parse(z.object({ on: z.boolean() }), b).on);
  }
}
