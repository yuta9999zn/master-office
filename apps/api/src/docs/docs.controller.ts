import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { z } from 'zod';
import { type Actor, CurrentUser } from '../common/current-user';
import { contentDisposition } from '../common/http';
import { parse } from '../common/validation';
import { ResourcesService } from '../resources/resources.service';
import { DocsService } from './docs.service';

const exportQuery = z.object({ format: z.enum(['docx', 'pdf', 'html', 'txt', 'xlsx', 'csv']), sheet: z.string().max(64).optional(), inline: z.enum(['1', 'true']).optional() });
const versionBody = z.object({ label: z.string().trim().max(120).nullish() });

@Controller('resources')
export class DocsController {
  constructor(
    private readonly docs: DocsService,
    private readonly resources: ResourcesService,
  ) {}

  @Get(':id/collab-token')
  token(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.docs.collabToken(a, id);
  }

  @Get(':id/export')
  async export(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Query() q: unknown, @Res() res: Response) {
    const { format, inline, sheet } = parse(exportQuery, q);
    const f = await this.docs.export(a, id, format, sheet);
    res.setHeader('Content-Type', f.mime);
    // inline=1 powers Print preview (the PDF opens in the browser viewer).
    res.setHeader('Content-Disposition', contentDisposition(f.name, inline ? 'inline' : 'attachment'));
    res.send(f.body);
  }

  @Get(':id/links')
  async links(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string) {
    const { linked, backlinks } = await this.docs.links(a, id);
    return { linked: await this.resources.byIds(a, linked), backlinks: await this.resources.byIds(a, backlinks) };
  }

  @Post(':id/import')
  import(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.docs.importOriginal(a, id);
  }

  @Post(':id/assets')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 20 * 1024 * 1024 } }))
  asset(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string, @UploadedFile() file: Express.Multer.File) {
    return this.docs.saveAsset(a, id, file.buffer, file.mimetype);
  }

  @Get(':id/assets/:blobId')
  async getAsset(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Param('blobId', ParseUUIDPipe) blobId: string, @Res() res: Response) {
    const f = await this.docs.asset(a, id, blobId);
    res.setHeader('Content-Type', f.mime);
    res.setHeader('Content-Length', String(f.size));
    res.setHeader('Cache-Control', 'private, max-age=86400, immutable');
    f.stream.pipe(res);
  }

  @Post(':id/versions')
  createVersion(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) {
    return this.docs.createVersion(a, id, parse(versionBody, b ?? {}).label ?? null);
  }

  @Get(':id/versions/:vid/content')
  versionContent(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Param('vid', ParseUUIDPipe) vid: string) {
    return this.docs.versionContent(a, id, vid);
  }

  @Post(':id/versions/:vid/restore')
  @HttpCode(204)
  restore(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Param('vid', ParseUUIDPipe) vid: string) {
    return this.docs.restoreVersion(a, id, vid);
  }
}
