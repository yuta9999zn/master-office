import { Body, Controller, Delete, Get, Headers, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { RESOURCE_TYPES, ROLES } from '@workos/shared';
import type { Response } from 'express';
import { z } from 'zod';
import { config } from '../config';
import { type Actor, CurrentUser } from '../common/current-user';
import { contentDisposition, inlineAllowed, pipeStream, sandboxInline, sendCached } from '../common/http';
import { parse } from '../common/validation';
import { ResourcesService } from './resources.service';

const uuid = z.string().uuid();
const shareRole = z.enum(['viewer', 'commenter', 'editor', 'admin']);
const listQuery = z.object({
  view: z.enum(['home', 'my', 'shared', 'recent', 'starred', 'trash']).optional(),
  parentId: uuid.optional(),
  spaceId: uuid.optional(),
  type: z.enum(RESOURCE_TYPES).optional(),
  sort: z.enum(['name', 'updatedAt', 'size', 'type']).optional(),
  order: z.enum(['asc', 'desc']).optional(),
  deep: z.enum(['1', 'true']).transform(() => true).optional(),
});
const createBody = z.object({
  name: z.string().trim().min(1).max(255),
  type: z.enum(RESOURCE_TYPES),
  parentId: uuid.nullish(),
  spaceId: uuid.nullish(),
  /** Documents, spreadsheets, presentations: start from a template (DOC_TEMPLATES / SHEET_TEMPLATES / TEMPLATES). */
  template: z.string().max(40).optional(),
});
const updateBody = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  description: z.string().max(5000).nullable().optional(),
  tags: z.array(z.string().max(40)).max(30).optional(),
  parentId: uuid.nullable().optional(),
  spaceId: uuid.nullable().optional(),
  generalAccess: z.enum(['restricted', 'workspace', 'anyone_with_link']).optional(),
  generalRole: shareRole.nullable().optional(),
  notebook: z.string().trim().max(200).nullable().optional(),
  properties: z.array(z.object({ key: z.string().trim().min(1).max(60), value: z.string().max(500) })).max(30).optional(),
});
const copyBody = z.object({ parentId: uuid.nullish(), spaceId: uuid.nullish() });
const shareBody = z.object({ userId: uuid, role: shareRole.nullable() });
const uploadBody = z.object({ parentId: uuid.optional(), spaceId: uuid.optional() });


@Controller('resources')
export class ResourcesController {
  constructor(private readonly svc: ResourcesService) {}

  @Get()
  list(@CurrentUser() a: Actor, @Query() q: unknown) {
    return this.svc.list(a, parse(listQuery, q));
  }

  @Post()
  create(@CurrentUser() a: Actor, @Body() b: unknown) {
    return this.svc.create(a, parse(createBody, b));
  }

  @Post('upload')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: config.maxUploadBytes } }))
  upload(@CurrentUser() a: Actor, @UploadedFile() file: Express.Multer.File, @Body() b: unknown) {
    return this.svc.upload(a, file, parse(uploadBody, b));
  }

  @Get(':id')
  get(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.get(a, id);
  }

  @Patch(':id')
  update(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown, @Headers('if-match') ifMatch?: string) {
    return this.svc.update(a, id, parse(updateBody, b), ifMatch ? Number(ifMatch) : undefined);
  }

  @Post(':id/access')
  @HttpCode(204)
  access(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.recordAccess(a, id);
  }

  @Post(':id/copy')
  copy(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) {
    return this.svc.copy(a, id, parse(copyBody, b ?? {}));
  }

  @Post(':id/trash')
  @HttpCode(204)
  trash(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.trash(a, id);
  }

  @Post(':id/restore')
  @HttpCode(204)
  restore(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.restore(a, id);
  }

  @Delete(':id')
  @HttpCode(204)
  destroy(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.destroy(a, id);
  }

  @Put(':id/star')
  @HttpCode(204)
  star(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.setStar(a, id, true);
  }

  @Delete(':id/star')
  @HttpCode(204)
  unstar(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.setStar(a, id, false);
  }

  @Get(':id/download')
  async download(
    @CurrentUser() a: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('inline') inline: string | undefined,
    @Headers('if-none-match') ifNoneMatch: string | undefined,
    @Res() res: Response,
  ) {
    const f = await this.svc.download(a, id);
    if ('etag' in f && f.etag && sendCached(res, f.etag, ifNoneMatch)) return;
    res.setHeader('Content-Type', f.mime);
    res.setHeader('Content-Length', String(f.size));
    const showInline = !!inline && inlineAllowed(f.mime);
    if (showInline) sandboxInline(res);
    res.setHeader('Content-Disposition', contentDisposition(f.name, showInline ? 'inline' : 'attachment'));
    if ('body' in f) res.send(f.body);
    else pipeStream(res, await f.open(), `download ${id}`);
  }

  @Get(':id/activity')
  activity(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.activity(a, id);
  }

  @Get(':id/members')
  members(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.members(a, id);
  }

  @Post(':id/members')
  @HttpCode(204)
  share(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) {
    const { userId, role } = parse(shareBody, b);
    return this.svc.share(a, id, userId, role);
  }

  @Get(':id/versions')
  versions(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.versions(a, id);
  }
}
