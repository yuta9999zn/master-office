import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { type Actor, CurrentUser } from '../common/current-user';
import { parse } from '../common/validation';
import { WikiService } from './wiki.service';

const uuid = z.string().uuid();
const sets = z.enum(['blank', 'ba', 'scrum', 'kanban', 'waterfall', 'hybrid', 'ai-dlc']);
const status = z.enum(['', 'draft', 'in_progress', 'review', 'approved', 'deprecated']);

/** Wiki spaces and their page trees (docs/ARCHITECTURE.md §78). Page content is edited through the Docs APIs. */
@Controller('wiki')
export class WikiController {
  constructor(private readonly svc: WikiService) {}

  @Get('spaces')
  spaces(@CurrentUser() a: Actor) {
    return this.svc.spaces(a);
  }

  @Post('spaces')
  createSpace(@CurrentUser() a: Actor, @Body() b: unknown) {
    return this.svc.createSpace(
      a,
      parse(z.object({ name: z.string().max(120), key: z.string().max(10).optional(), description: z.string().max(1000).nullish(), color: z.string().max(20).optional(), spaceId: uuid.nullish(), set: sets.optional() }), b),
    );
  }

  @Get('spaces/:id')
  space(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.detail(a, id);
  }

  @Patch('spaces/:id')
  updateSpace(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) {
    return this.svc.updateSpace(a, id, parse(z.object({ name: z.string().max(120).optional(), description: z.string().max(1000).nullish(), color: z.string().max(20).optional(), homePageId: uuid.nullish() }), b));
  }

  @Post('spaces/:id/pages')
  createPage(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) {
    return this.svc.createPage(a, id, parse(z.object({ title: z.string().max(200).optional(), parentId: uuid.nullish(), template: z.string().max(60).nullish() }), b));
  }

  @Post('spaces/:id/starter')
  @HttpCode(200)
  starter(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) {
    return this.svc.addStarter(a, id, parse(z.object({ set: sets.exclude(['blank']) }), b).set);
  }

  @Get('recent')
  recent(@CurrentUser() a: Actor, @Query('limit') limit?: string) {
    return this.svc.recent(a, Math.min(50, Number(limit) || 20));
  }

  @Get('pages/:id/space')
  pageSpace(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.pageSpace(a, id);
  }

  @Patch('pages/:id')
  updatePage(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) {
    return this.svc.updatePage(
      a,
      id,
      parse(
        z.object({ parentId: uuid.nullish(), afterId: uuid.nullish(), beforeId: uuid.nullish(), status: status.optional(), labels: z.array(z.string().max(40)).max(20).optional(), ownerId: uuid.nullish() }),
        b,
      ),
    );
  }

  @Post('pages/:id/copy')
  copy(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) {
    return this.svc.copyPage(a, id, parse(z.object({ withChildren: z.boolean().optional() }), b ?? {}));
  }

  @Delete('pages/:id')
  remove(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.deletePage(a, id);
  }
}
