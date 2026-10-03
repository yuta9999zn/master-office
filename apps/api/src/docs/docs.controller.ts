import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Req, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { type Actor, CurrentUser } from '../common/current-user';
import { contentDisposition } from '../common/http';
import { parse } from '../common/validation';
import { ResourcesService } from '../resources/resources.service';
import { DocsService } from './docs.service';

const exportQuery = z.object({
  format: z.enum(['docx', 'pdf', 'html', 'txt', 'xlsx', 'csv', 'pptx', 'png']),
  sheet: z.string().max(64).optional(),
  slide: z.coerce.number().int().min(1).max(10_000).optional(),
  inline: z.enum(['1', 'true']).optional(),
});
const versionBody = z.object({ label: z.string().trim().max(120).nullish() });
const rangeQuery = z.object({ range: z.string().regex(/^\$?[A-Za-z]{1,3}\$?\d{1,7}(:\$?[A-Za-z]{1,3}\$?\d{1,7})?$/), sheet: z.string().max(120).optional() });

@Controller('resources')
export class DocsController {
  constructor(
    private readonly docs: DocsService,
    private readonly resources: ResourcesService,
  ) {}

  @Post(':id/compare')
  compare(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) {
    const { otherId } = parse(z.object({ otherId: z.string().uuid() }), b);
    return this.docs.compare(a, id, otherId, (name, parentId, spaceId) => this.resources.create(a, { name, type: 'document', parentId, spaceId }));
  }

  @Get(':id/collab-token')
  token(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.docs.collabToken(a, id);
  }

  @Get(':id/export')
  async export(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Query() q: unknown, @Res() res: Response) {
    const { format, inline, sheet, slide } = parse(exportQuery, q);
    // ?slide is 1-based like PowerPoint's slide numbers.
    const f = await this.docs.export(a, id, format, sheet, slide !== undefined ? slide - 1 : undefined);
    res.setHeader('Content-Type', f.mime);
    // inline=1 powers Print preview (the PDF opens in the browser viewer).
    res.setHeader('Content-Disposition', contentDisposition(f.name, inline ? 'inline' : 'attachment'));
    res.send(f.body);
  }

  /** Values of a range in a spreadsheet (charts in Slides link to it). */
  @Get(':id/sheet-range')
  sheetRange(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Query() q: unknown) {
    const { range, sheet } = parse(rangeQuery, q);
    return this.docs.sheetRange(a, id, range, sheet);
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
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 100 * 1024 * 1024 } }))
  asset(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string, @UploadedFile() file: Express.Multer.File) {
    return this.docs.saveAsset(a, id, file.buffer, file.mimetype);
  }

  @Get(':id/assets/:blobId')
  async getAsset(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Param('blobId', ParseUUIDPipe) blobId: string, @Req() req: Request, @Res() res: Response) {
    // Byte ranges let <video> / <audio> seek without downloading the whole file.
    const m = /^bytes=(\d+)-(\d*)$/.exec(String(req.headers.range ?? ''));
    const f = await this.docs.asset(a, id, blobId, m ? { start: Number(m[1]), end: m[2] ? Number(m[2]) : undefined } : undefined);
    res.setHeader('Content-Type', f.mime);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'private, max-age=86400, immutable');
    if (f.range) {
      res.status(206);
      res.setHeader('Content-Range', `bytes ${f.range.start}-${f.range.end}/${f.size}`);
      res.setHeader('Content-Length', String(f.range.end - f.range.start + 1));
    } else res.setHeader('Content-Length', String(f.size));
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
