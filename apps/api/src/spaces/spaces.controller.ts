import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
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
});
const memberBody = z.object({ userId: z.string().uuid(), role: z.enum(['viewer', 'commenter', 'editor', 'admin']).nullable() });

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

  @Get(':id/members')
  members(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.members(a, id);
  }

  @Post(':id/members')
  @HttpCode(204)
  setMember(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) {
    const { userId, role } = parse(memberBody, b);
    return this.svc.setMember(a, id, userId, role);
  }

  @Get(':id/activity')
  activity(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.activity(a, id);
  }
}
