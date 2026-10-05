import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { type Actor, CurrentUser } from '../common/current-user';
import { parse } from '../common/validation';
import { RealtimeService } from '../realtime/realtime.service';
import { ChatService } from './chat.service';

const createBody = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('dm'), userId: z.string().uuid() }),
  z.object({ kind: z.literal('group'), name: z.string().max(80).nullish(), memberIds: z.array(z.string().uuid()).min(1).max(20) }),
  z.object({
    kind: z.literal('channel'),
    name: z.string().trim().min(1).max(80),
    description: z.string().max(500).nullish(),
    visibility: z.enum(['public', 'private']).default('public'),
    memberIds: z.array(z.string().uuid()).max(1000).default([]),
    spaceId: z.string().uuid(),
    categoryId: z.string().uuid().nullish(),
    postPolicy: z.enum(['all', 'admins']).default('all'),
  }),
]);
const updateBody = z.object({
  name: z.string().max(80).nullish(),
  description: z.string().max(500).nullish(),
  visibility: z.enum(['public', 'private']).optional(),
  postPolicy: z.enum(['all', 'admins']).optional(),
  categoryId: z.string().uuid().nullable().optional(),
  position: z.number().int().min(0).max(10_000).optional(),
});
const categoryBody = z.object({ name: z.string().trim().min(1).max(60) });
const categoryUpdate = z.object({ name: z.string().trim().min(1).max(60).optional(), position: z.number().int().min(0).max(10_000).optional() });
const membersBody = z.object({ userIds: z.array(z.string().uuid()).min(1).max(1000) });
const roleBody = z.object({ role: z.enum(['admin', 'member']) });
const prefsBody = z.object({ pinned: z.boolean().optional(), muted: z.boolean().optional() });
const sendBody = z.object({
  body: z.string().max(20_000),
  threadRootId: z.string().uuid().nullish(),
  resourceIds: z.array(z.string().uuid()).max(10).optional(),
  grant: z.enum(['viewer', 'commenter', 'editor', 'none']).optional(),
});
const pinBody = z.object({ pinned: z.boolean() });
const editBody = z.object({ body: z.string().max(20_000) });
const reactBody = z.object({ emoji: z.string().min(1).max(16) });
const readBody = z.object({ seq: z.number().int().min(0) });

@Controller()
export class ChatController {
  constructor(
    private readonly chat: ChatService,
    private readonly realtime: RealtimeService,
  ) {}

  @Get('realtime/token')
  token(@CurrentUser() a: Actor) {
    return { token: this.realtime.token(a) };
  }

  @Get('chat/conversations')
  list(@CurrentUser() a: Actor) {
    return this.chat.list(a);
  }

  @Post('chat/conversations')
  create(@CurrentUser() a: Actor, @Body() b: unknown) {
    return this.chat.create(a, parse(createBody, b));
  }

  @Get('chat/spaces/:spaceId/categories')
  categories(@CurrentUser() a: Actor, @Param('spaceId', ParseUUIDPipe) spaceId: string) {
    return this.chat.categories(a, spaceId);
  }

  @Post('chat/spaces/:spaceId/categories')
  createCategory(@CurrentUser() a: Actor, @Param('spaceId', ParseUUIDPipe) spaceId: string, @Body() b: unknown) {
    return this.chat.createCategory(a, spaceId, parse(categoryBody, b).name);
  }

  @Patch('chat/categories/:cid')
  @HttpCode(204)
  updateCategory(@CurrentUser() a: Actor, @Param('cid', ParseUUIDPipe) cid: string, @Body() b: unknown) {
    return this.chat.updateCategory(a, cid, parse(categoryUpdate, b));
  }

  @Delete('chat/categories/:cid')
  @HttpCode(204)
  deleteCategory(@CurrentUser() a: Actor, @Param('cid', ParseUUIDPipe) cid: string) {
    return this.chat.deleteCategory(a, cid);
  }

  @Get('chat/conversations/:id')
  get(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.chat.get(a, id);
  }

  @Patch('chat/conversations/:id')
  @HttpCode(204)
  update(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) {
    return this.chat.update(a, id, parse(updateBody, b));
  }

  @Post('chat/conversations/:id/members')
  addMembers(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) {
    return this.chat.addMembers(a, id, parse(membersBody, b).userIds);
  }

  @Delete('chat/conversations/:id/members/:userId')
  @HttpCode(204)
  removeMember(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Param('userId', ParseUUIDPipe) userId: string) {
    return this.chat.removeMember(a, id, userId);
  }

  @Put('chat/conversations/:id/members/:userId/role')
  @HttpCode(204)
  setRole(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Param('userId', ParseUUIDPipe) userId: string, @Body() b: unknown) {
    return this.chat.setRole(a, id, userId, parse(roleBody, b).role);
  }

  @Post('chat/conversations/:id/join')
  @HttpCode(204)
  join(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.chat.join(a, id);
  }

  @Put('chat/conversations/:id/prefs')
  @HttpCode(204)
  prefs(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) {
    return this.chat.setPrefs(a, id, parse(prefsBody, b));
  }

  @Post('chat/conversations/:id/read')
  read(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) {
    return this.chat.read(a, id, parse(readBody, b).seq);
  }

  @Get('chat/conversations/:id/messages')
  history(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Query('before') before?: string, @Query('limit') limit?: string) {
    const n = Math.min(Math.max(Number(limit) || 50, 1), 200);
    return this.chat.history(a, id, before ? Number(before) : undefined, n);
  }

  @Get('chat/conversations/:id/search')
  search(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Query('q') q = '') {
    return this.chat.search(a, id, q);
  }

  @Post('chat/conversations/:id/messages')
  send(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) {
    return this.chat.send(a, id, parse(sendBody, b));
  }

  @Get('chat/conversations/:id/files')
  files(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.chat.files(a, id);
  }

  @Get('chat/conversations/:id/pins')
  pins(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.chat.pins(a, id);
  }

  /** Where files sent in this conversation are uploaded (§68). */
  @Post('chat/conversations/:id/upload-folder')
  uploadFolder(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.chat.uploadFolder(a, id);
  }

  @Put('chat/messages/:mid/pin')
  pin(@CurrentUser() a: Actor, @Param('mid', ParseUUIDPipe) mid: string, @Body() b: unknown) {
    return this.chat.pin(a, mid, parse(pinBody, b).pinned);
  }

  @Get('chat/messages/:mid/thread')
  thread(@CurrentUser() a: Actor, @Param('mid', ParseUUIDPipe) mid: string) {
    return this.chat.thread(a, mid);
  }

  @Patch('chat/messages/:mid')
  edit(@CurrentUser() a: Actor, @Param('mid', ParseUUIDPipe) mid: string, @Body() b: unknown) {
    return this.chat.edit(a, mid, parse(editBody, b).body);
  }

  @Delete('chat/messages/:mid')
  @HttpCode(204)
  remove(@CurrentUser() a: Actor, @Param('mid', ParseUUIDPipe) mid: string) {
    return this.chat.remove(a, mid);
  }

  @Post('chat/messages/:mid/reactions')
  react(@CurrentUser() a: Actor, @Param('mid', ParseUUIDPipe) mid: string, @Body() b: unknown) {
    return this.chat.react(a, mid, parse(reactBody, b).emoji);
  }
}
