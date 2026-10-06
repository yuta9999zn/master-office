import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { type Actor, CurrentUser } from '../common/current-user';
import { parse } from '../common/validation';
import { TasksService } from './tasks.service';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish();
const taskBody = z.object({
  projectId: z.string().uuid().nullish(),
  parentId: z.string().uuid().nullish(),
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
const projectBody = z.object({ spaceId: z.string().uuid(), name: z.string().max(120), key: z.string().max(10).optional(), color: z.string().max(20).optional(), description: z.string().max(2000).nullish() });
const projectUpdate = z.object({ name: z.string().max(120).optional(), color: z.string().max(20).optional(), description: z.string().max(2000).nullish(), statuses: z.array(status).min(1).max(12).optional(), archived: z.boolean().optional() });

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
}
