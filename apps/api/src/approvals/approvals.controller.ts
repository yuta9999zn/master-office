import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { APPROVAL_FIELD_TYPES, type ApprovalBox } from '@workos/shared';
import { z } from 'zod';
import { type Actor, CurrentUser } from '../common/current-user';
import { parse } from '../common/validation';
import { config } from '../config';
import { ApprovalsService } from './approvals.service';

const id = z.string().min(1).max(40);
const field = z.object({
  id,
  type: z.enum(APPROVAL_FIELD_TYPES),
  label: z.string().max(120),
  required: z.boolean().default(false),
  placeholder: z.string().max(200).nullish(),
  options: z.array(z.string().max(80)).max(50).optional(),
  currency: z.string().length(3).optional(),
  unit: z.string().max(20).nullish(),
});
const approvers = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('users'), userIds: z.array(z.string().uuid()).max(20) }),
  z.object({ kind: z.literal('manager'), level: z.union([z.literal(1), z.literal(2)]) }),
  z.object({ kind: z.literal('pick') }),
  z.object({ kind: z.literal('field'), fieldId: id }),
]);
const step = z.object({
  id,
  name: z.string().max(80),
  type: z.enum(['approve', 'cc']),
  approvers,
  mode: z.enum(['and', 'or']).default('or'),
  condition: z
    .object({ fieldId: id, op: z.enum(['gt', 'gte', 'lt', 'lte', 'eq', 'neq', 'in']), value: z.union([z.number(), z.string().max(200), z.array(z.string().max(80)).max(50)]) })
    .nullable()
    .default(null),
});
const templateBody = z.object({
  name: z.string().max(120),
  description: z.string().max(1000).nullish(),
  category: z.string().max(40).optional(),
  icon: z.string().max(40).optional(),
  color: z.string().max(20).optional(),
  fields: z.array(field).max(40),
  steps: z.array(step).min(1).max(15),
  admins: z.array(z.string().uuid()).max(20).optional(),
  onApproved: z.object({ calendarOoo: z.object({ fieldId: id }).optional() }).nullish(),
  enabled: z.boolean().optional(),
});
const values = z.record(z.string(), z.unknown());
const picks = z.record(z.string(), z.array(z.string().uuid()).max(20));
const submitBody = z.object({ templateId: z.string().uuid(), values, picks: picks.optional() });
const comment = z.object({ comment: z.string().max(4000).nullish() });

/** Approvals (docs/ARCHITECTURE.md §74). */
@Controller('approvals')
export class ApprovalsController {
  constructor(private readonly svc: ApprovalsService) {}

  @Get('templates')
  templates(@CurrentUser() a: Actor) {
    return this.svc.templates(a);
  }

  @Post('templates')
  createTemplate(@CurrentUser() a: Actor, @Body() b: unknown) {
    return this.svc.createTemplate(a, parse(templateBody, b));
  }

  @Get('templates/:id')
  template(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.template(a, id);
  }

  @Patch('templates/:id')
  updateTemplate(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) {
    return this.svc.updateTemplate(a, id, parse(templateBody.partial(), b));
  }

  @Delete('templates/:id')
  @HttpCode(204)
  deleteTemplate(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.deleteTemplate(a, id);
  }

  /** Who would be asked for these answers (while filling the form). */
  @Post('templates/:id/preview')
  @HttpCode(200)
  preview(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) {
    const p = parse(z.object({ values: values.default({}), picks: picks.default({}) }), b ?? {});
    return this.svc.preview(a, id, p.values, p.picks);
  }

  @Post('files')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: config.maxUploadBytes } }))
  upload(@CurrentUser() a: Actor, @UploadedFile() file: Express.Multer.File | undefined) {
    return this.svc.upload(a, file);
  }

  @Get('counts')
  counts(@CurrentUser() a: Actor) {
    return this.svc.counts(a);
  }

  /** ?box=pending|processed|submitted|cc|all &template= &status= &q= */
  @Get('requests')
  list(@CurrentUser() a: Actor, @Query('box') box = 'pending', @Query('template') template?: string, @Query('status') status?: string, @Query('q') q?: string) {
    const b = (['pending', 'processed', 'submitted', 'cc', 'all'].includes(box) ? box : 'pending') as ApprovalBox;
    return this.svc.list(a, b, { templateId: template && /^[0-9a-f-]{36}$/i.test(template) ? template : undefined, status, search: q });
  }

  @Post('requests')
  submit(@CurrentUser() a: Actor, @Body() b: unknown) {
    return this.svc.submit(a, parse(submitBody, b));
  }

  @Get('requests/:id')
  get(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.get(a, id);
  }

  @Post('requests/:id/approve')
  @HttpCode(200)
  approve(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) {
    return this.svc.approve(a, id, parse(comment, b ?? {}).comment);
  }

  @Post('requests/:id/reject')
  @HttpCode(200)
  reject(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) {
    return this.svc.reject(a, id, parse(comment, b ?? {}).comment ?? '');
  }

  @Post('requests/:id/transfer')
  @HttpCode(200)
  transfer(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) {
    const p = parse(comment.extend({ userId: z.string().uuid() }), b);
    return this.svc.transfer(a, id, p.userId, p.comment);
  }

  @Post('requests/:id/withdraw')
  @HttpCode(200)
  withdraw(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.withdraw(a, id);
  }

  @Post('requests/:id/remind')
  @HttpCode(200)
  remind(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.remind(a, id);
  }

  @Post('requests/:id/comments')
  comment(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) {
    return this.svc.comment(a, id, parse(z.object({ body: z.string().max(4000) }), b).body);
  }
}
