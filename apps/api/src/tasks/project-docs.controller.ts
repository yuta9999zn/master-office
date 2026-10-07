import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ISSUE_TYPES } from '@workos/shared';
import { z } from 'zod';
import { type Actor, CurrentUser } from '../common/current-user';
import { parse } from '../common/validation';
import { ProjectDocsService } from './project-docs.service';

/** Project documentation spaces and requirements traceability (docs/ARCHITECTURE.md §76, batch 3). */
@Controller('tasks')
export class ProjectDocsController {
  constructor(private readonly svc: ProjectDocsService) {}

  @Get('projects/:id/docs')
  tree(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.tree(a, id);
  }

  @Post('projects/:id/docs/setup')
  setup(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) {
    return this.svc.setup(a, id, parse(z.object({ set: z.enum(['scrum', 'kanban', 'waterfall', 'hybrid', 'ai-dlc']).optional() }), b ?? {}).set);
  }

  @Post('projects/:id/docs')
  create(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) {
    return this.svc.createPage(a, id, parse(z.object({ template: z.string().max(40).nullish(), name: z.string().max(200).optional(), folderId: z.string().uuid().nullish() }), b ?? {}));
  }

  @Get('projects/:id/traceability')
  traceability(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.traceability(a, id);
  }

  @Get('docs/:docId/items')
  items(@CurrentUser() a: Actor, @Param('docId', ParseUUIDPipe) docId: string) {
    return this.svc.items(a, docId);
  }

  @Post('projects/:id/docs/:docId/issues')
  issues(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Param('docId', ParseUUIDPipe) docId: string, @Body() b: unknown) {
    return this.svc.issuesFromDoc(a, id, docId, parse(z.object({ items: z.array(z.string().max(500)).max(50), type: z.enum(ISSUE_TYPES).optional(), parentId: z.string().uuid().nullish(), sprintId: z.string().uuid().nullish() }), b));
  }

  @Post(':id/docs')
  link(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) {
    return this.svc.link(a, id, parse(z.object({ resourceId: z.string().uuid() }), b).resourceId);
  }

  @Delete(':id/docs/:resourceId')
  unlink(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Param('resourceId', ParseUUIDPipe) resourceId: string) {
    return this.svc.unlink(a, id, resourceId);
  }
}
