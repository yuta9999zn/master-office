import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { z } from 'zod';
import { type Actor, CurrentUser } from '../common/current-user';
import { parse } from '../common/validation';
import { SpacesService } from './spaces.service';

const createBody = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().max(1000).nullish(),
  parentId: z.string().uuid().nullish(),
  color: z.string().regex(/^#[0-9a-f]{6}$/i).nullish(),
  visibility: z.enum(['public', 'private']).default('public'),
  kind: z.enum(['department', 'team', 'project', 'general']).optional(),
});
const updateBody = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  description: z.string().max(1000).nullish(),
  parentId: z.string().uuid().nullish(),
  color: z.string().regex(/^#[0-9a-f]{6}$/i).nullish(),
  visibility: z.enum(['public', 'private']).optional(),
  kind: z.enum(['department', 'team', 'project', 'general']).optional(),
});
const memberBody = z.object({ userId: z.string().uuid(), role: z.enum(['viewer', 'commenter', 'editor', 'admin', 'owner']).nullable(), title: z.string().max(80).nullish() });

@Controller('spaces')
export class SpacesController {
  constructor(private readonly svc: SpacesService) {}

  @Get()
  list(@CurrentUser() a: Actor) {
    return this.svc.list(a);
  }

  @Post()
  create(@CurrentUser() a: Actor, @Body() b: unknown) {
    return this.svc.create(a, parse(createBody, b));
  }

  @Get(':id')
  get(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.get(a, id);
  }

  @Patch(':id')
  update(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) {
    return this.svc.update(a, id, parse(updateBody, b));
  }

  @Get(':id/members')
  members(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.members(a, id);
  }

  @Post(':id/members')
  @HttpCode(204)
  setMember(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) {
    const { userId, role, title } = parse(memberBody, b);
    return this.svc.setMember(a, id, userId, role, title);
  }

  @Get(':id/activity')
  activity(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.activity(a, id);
  }
}
