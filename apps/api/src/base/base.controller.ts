import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { FIELD_TYPES } from '@workos/base-model';
import type { Response } from 'express';
import { z } from 'zod';
import { type Actor, CurrentUser } from '../common/current-user';
import { parse } from '../common/validation';
import { BaseService } from './base.service';

const uuid = z.string().uuid();
const options = z
  .object({
    precision: z.number().int().min(0).max(8).optional(),
    currency: z.string().max(3).optional(),
    choices: z.array(z.object({ id: z.string().max(40).default(''), name: z.string().max(100), color: z.string().max(20).default('') })).max(200).optional(),
    includeTime: z.boolean().optional(),
    multiple: z.boolean().optional(),
    tableId: uuid.optional(),
    max: z.number().int().min(1).max(10).optional(),
    expression: z.string().max(2000).optional(),
  })
  .strict();
const fieldBody = z.object({
  name: z.string().max(100).optional(),
  type: z.enum(FIELD_TYPES).optional(),
  options: options.optional(),
  description: z.string().max(1000).nullish(),
  afterFieldId: uuid.nullish(),
});
const values = z.record(z.string().max(100), z.unknown());
const viewType = z.enum(['grid', 'kanban', 'calendar', 'gallery', 'form']);
const config = z.record(z.string(), z.any());

@Controller('base')
export class BaseController {
  constructor(private readonly svc: BaseService) {}

  @Get('forms/:viewId')
  form(@CurrentUser() a: Actor, @Param('viewId', ParseUUIDPipe) id: string) {
    return this.svc.form(a, id);
  }

  @Post('forms/:viewId')
  @HttpCode(200)
  submit(@CurrentUser() a: Actor, @Param('viewId', ParseUUIDPipe) id: string, @Body() b: unknown) {
    return this.svc.submitForm(a, id, parse(z.object({ values }), b).values);
  }

  @Post('forms/:viewId/attachments')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 50 * 1024 * 1024 } }))
  formAttach(@CurrentUser() a: Actor, @Param('viewId', ParseUUIDPipe) id: string, @UploadedFile() file: Express.Multer.File) {
    return this.svc.formAttach(a, id, file);
  }

  // ── Tables ────────────────────────────────────────────────────────────────

  @Get(':id')
  schema(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.schema(a, id);
  }

  @Post(':id/tables')
  async createTable(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) {
    return { id: await this.svc.createTable(a, id, parse(z.object({ name: z.string().max(100).optional() }), b ?? {})) };
  }

  @Post(':id/import')
  importCsv(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) {
    return this.svc.importCsv(a, id, parse(z.object({ name: z.string().max(200).optional(), csv: z.string().max(20_000_000) }), b));
  }

  @Post(':id/attachments')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 50 * 1024 * 1024 } }))
  attach(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string, @UploadedFile() file: Express.Multer.File) {
    return this.svc.attach(a, id, file);
  }

  @Patch('tables/:tid')
  @HttpCode(204)
  updateTable(@CurrentUser() a: Actor, @Param('tid', ParseUUIDPipe) tid: string, @Body() b: unknown) {
    return this.svc.updateTable(a, tid, parse(z.object({ name: z.string().max(100).optional(), position: z.number().int().optional() }), b));
  }

  @Delete('tables/:tid')
  @HttpCode(204)
  deleteTable(@CurrentUser() a: Actor, @Param('tid', ParseUUIDPipe) tid: string) {
    return this.svc.deleteTable(a, tid);
  }

  @Get('tables/:tid/records')
  records(@CurrentUser() a: Actor, @Param('tid', ParseUUIDPipe) tid: string) {
    return this.svc.records(a, tid);
  }

  @Get('tables/:tid/titles')
  titles(@CurrentUser() a: Actor, @Param('tid', ParseUUIDPipe) tid: string) {
    return this.svc.titles(a, tid);
  }

  @Post('tables/:tid/records')
  createRecords(@CurrentUser() a: Actor, @Param('tid', ParseUUIDPipe) tid: string, @Body() b: unknown) {
    const body = parse(z.object({ records: z.array(z.object({ values: values.optional(), afterId: uuid.nullish() })).min(1).max(1000) }), b);
    return this.svc.createRecords(a, tid, body.records);
  }

  @Get('tables/:tid/csv')
  async csv(@CurrentUser() a: Actor, @Param('tid', ParseUUIDPipe) tid: string, @Query('view') view: string | undefined, @Res() res: Response) {
    const out = await this.svc.exportCsv(a, tid, view && /^[0-9a-f-]{36}$/i.test(view) ? view : undefined);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(out.name)}`);
    res.send(out.csv);
  }

  @Post('tables/:tid/csv')
  appendCsv(@CurrentUser() a: Actor, @Param('tid', ParseUUIDPipe) tid: string, @Body() b: unknown) {
    return this.svc.appendCsv(a, tid, parse(z.object({ csv: z.string().max(20_000_000) }), b).csv);
  }

  // ── Fields ────────────────────────────────────────────────────────────────

  @Post('tables/:tid/fields')
  createField(@CurrentUser() a: Actor, @Param('tid', ParseUUIDPipe) tid: string, @Body() b: unknown) {
    return this.svc.createField(a, tid, parse(fieldBody, b));
  }

  @Patch('fields/:fid')
  updateField(@CurrentUser() a: Actor, @Param('fid', ParseUUIDPipe) fid: string, @Body() b: unknown) {
    return this.svc.updateField(a, fid, parse(fieldBody, b));
  }

  @Delete('fields/:fid')
  @HttpCode(204)
  deleteField(@CurrentUser() a: Actor, @Param('fid', ParseUUIDPipe) fid: string) {
    return this.svc.deleteField(a, fid);
  }

  // ── Views ─────────────────────────────────────────────────────────────────

  @Post('tables/:tid/views')
  createView(@CurrentUser() a: Actor, @Param('tid', ParseUUIDPipe) tid: string, @Body() b: unknown) {
    return this.svc.createView(a, tid, parse(z.object({ name: z.string().max(100).optional(), type: viewType, config: config.optional() }), b));
  }

  @Patch('views/:vid')
  updateView(@CurrentUser() a: Actor, @Param('vid', ParseUUIDPipe) vid: string, @Body() b: unknown) {
    return this.svc.updateView(a, vid, parse(z.object({ name: z.string().max(100).optional(), config: config.optional(), position: z.number().int().optional() }), b));
  }

  @Delete('views/:vid')
  @HttpCode(204)
  deleteView(@CurrentUser() a: Actor, @Param('vid', ParseUUIDPipe) vid: string) {
    return this.svc.deleteView(a, vid);
  }

  // ── Records ───────────────────────────────────────────────────────────────

  @Patch('records')
  updateRecords(@CurrentUser() a: Actor, @Body() b: unknown) {
    return this.svc.updateRecords(a, parse(z.object({ records: z.array(z.object({ id: uuid, values })).min(1).max(1000) }), b).records);
  }

  @Post('records/delete')
  @HttpCode(204)
  deleteRecords(@CurrentUser() a: Actor, @Body() b: unknown) {
    return this.svc.deleteRecords(a, parse(z.object({ ids: z.array(uuid).min(1).max(1000) }), b).ids);
  }

  @Post('records/:rid/move')
  @HttpCode(200)
  move(@CurrentUser() a: Actor, @Param('rid', ParseUUIDPipe) rid: string, @Body() b: unknown) {
    return this.svc.moveRecord(a, rid, parse(z.object({ afterId: uuid.nullish(), beforeId: uuid.nullish() }), b));
  }

  @Get('records/:rid/comments')
  comments(@CurrentUser() a: Actor, @Param('rid', ParseUUIDPipe) rid: string) {
    return this.svc.comments(a, rid);
  }

  @Post('records/:rid/comments')
  comment(@CurrentUser() a: Actor, @Param('rid', ParseUUIDPipe) rid: string, @Body() b: unknown) {
    return this.svc.addComment(a, rid, parse(z.object({ body: z.string().max(5000) }), b).body);
  }

  @Delete('comments/:cid')
  @HttpCode(204)
  deleteComment(@CurrentUser() a: Actor, @Param('cid', ParseUUIDPipe) cid: string) {
    return this.svc.deleteComment(a, cid);
  }
}
