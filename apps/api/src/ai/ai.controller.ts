import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, UploadedFile, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { SlidesService } from '../slides/slides.service';
import { ImageStudioService } from './image-studio';
import { z } from 'zod';
import { OrgService } from '../admin/org.service';
import { type Actor, CurrentUser } from '../common/current-user';
import { parse } from '../common/validation';
import { AiService } from './ai.service';

const apps = z.enum(['flow', 'sheets', 'slides', 'docs', 'general']);
const promptBody = z.object({
  name: z.string().trim().min(1).max(120),
  app: apps,
  output: z.enum(['flow', 'sheet', 'deck', 'design', 'template', 'image', 'layers', 'markdown', 'text']),
  description: z.string().max(2000).default(''),
  system: z.string().trim().min(1).max(20_000),
  template: z.string().trim().min(1).max(20_000),
  temperature: z.number().min(0).max(2).default(0.3),
  variables: z.array(z.object({ name: z.string().regex(/^\w+$/).max(40), label: z.string().max(80), example: z.string().max(2000).default('') })).max(20).default([]),
});
const jobBody = z.object({
  promptKey: z.string().max(80),
  request: z.string().max(20_000).default(''),
  variables: z.record(z.string(), z.string().max(30_000)).optional(),
  targetId: z.string().uuid().nullish(),
  spaceId: z.string().uuid().nullish(),
  parentId: z.string().uuid().nullish(),
  format: z.string().max(40).nullish(),
  model: z.string().max(120).nullish(),
  notation: z.enum(['flowchart', 'bpmn']).nullish(),
  /** Pictures (§81): the slide (and image element) to work on, how a new picture is placed, AI background for designs. */
  slideId: z.string().max(64).nullish(),
  elementId: z.string().max(64).nullish(),
  as: z.enum(['background', 'element']).nullish(),
  background: z.enum(['template', 'ai']).nullish(),
});
const settingsBody = z.object({
  enabled: z.boolean().optional(),
  url: z.string().max(300).optional(),
  model: z.string().max(120).optional(),
  models: z.record(apps, z.string().max(120)).optional(),
  numCtx: z.number().int().optional(),
  images: z
    .object({
      provider: z.enum(['none', 'openai', 'gemini', 'demo']).optional(),
      openaiKey: z.string().max(400).optional(),
      openaiModel: z.string().max(80).optional(),
      openaiBaseUrl: z.string().max(300).optional(),
      geminiKey: z.string().max(400).optional(),
      geminiModel: z.string().max(80).optional(),
      vision: z.enum(['local', 'gemini']).optional(),
      visionModel: z.string().max(120).optional(),
    })
    .optional(),
});

/** The AI layer (docs/ARCHITECTURE.md §80): status, prompt library, jobs, settings. */
@Controller('ai')
export class AiController {
  constructor(
    private readonly ai: AiService,
    private readonly org: OrgService,
    private readonly studio: ImageStudioService,
    private readonly slides: SlidesService,
  ) {}

  @Get('status')
  status(@CurrentUser() a: Actor) {
    return this.ai.status(a);
  }

  @Get('settings')
  async settings(@CurrentUser() a: Actor) {
    await this.org.requireAdmin(a);
    return this.ai.view(await this.ai.settings(a.workspaceId));
  }

  /** Makes one picture with the connected image AI (checks the key and the model). */
  @Post('settings/test-images')
  @HttpCode(200)
  async testImages(@CurrentUser() a: Actor) {
    await this.org.requireAdmin(a);
    return this.ai.testImages(a);
  }

  @Put('settings')
  async setSettings(@CurrentUser() a: Actor, @Body() b: unknown) {
    await this.org.requireAdmin(a);
    return this.ai.setSettings(a, parse(settingsBody, b));
  }

  @Get('prompts')
  prompts(@CurrentUser() a: Actor) {
    return this.ai.prompts(a);
  }

  @Get('prompts/:key')
  prompt(@CurrentUser() a: Actor, @Param('key') key: string) {
    return this.ai.prompt(a, key);
  }

  /** A new prompt of one's own. */
  @Post('prompts')
  create(@CurrentUser() a: Actor, @Body() b: unknown) {
    return this.ai.savePrompt(a, null, parse(promptBody, b));
  }

  @Put('prompts/:key')
  save(@CurrentUser() a: Actor, @Param('key') key: string, @Body() b: unknown) {
    return this.ai.savePrompt(a, key, parse(promptBody, b));
  }

  /** Deletes one's own prompt, or returns a built-in one to its shipped text. */
  @Delete('prompts/:key')
  @HttpCode(204)
  remove(@CurrentUser() a: Actor, @Param('key') key: string) {
    return this.ai.deletePrompt(a, key);
  }

  @Post('jobs')
  start(@CurrentUser() a: Actor, @Body() b: unknown) {
    return this.ai.start(a, parse(jobBody, b));
  }

  @Get('jobs')
  jobs(@CurrentUser() a: Actor, @Query('limit') limit?: string) {
    return this.ai.jobs(a, limit ? Number(limit) : undefined);
  }

  @Get('jobs/:id')
  job(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.ai.job(a, id);
  }

  /** A picture made elsewhere as a new design in its own shape. */
  @Post('pictures/import')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 25 * 1024 * 1024 } }))
  importAsDesign(@CurrentUser() a: Actor, @UploadedFile() file: Express.Multer.File, @Body() b: unknown) {
    if (!file) throw new BadRequestException('Choose a picture');
    const body = parse(z.object({ spaceId: z.string().uuid().optional(), parentId: z.string().uuid().optional() }), b ?? {});
    return this.ai.importAsDesign(a, file, body);
  }

  /** A picture made elsewhere (ChatGPT, Gemini…) becomes the background of a new slide (or of the given one). */
  @Post('pictures/:id/import')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 25 * 1024 * 1024 } }))
  async importPicture(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string, @UploadedFile() file: Express.Multer.File, @Body() b: unknown) {
    if (!file) throw new BadRequestException('Choose a picture');
    const body = parse(z.object({ slideId: z.string().max(64).optional(), newSlide: z.enum(['0', '1']).optional() }), b ?? {});
    const deck = await this.slides.deck(id);
    return this.studio.importPicture(a, id, file, { slideId: body.slideId ?? null, newSlide: body.newSlide !== '0' }, deck.size);
  }

  /** Picture slots of a deck: the prompt of each (to paste into ChatGPT / Gemini) and whether a picture is in. */
  @Get('pictures/:id/slots')
  async slots(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string) {
    await this.studio.requireEditor(a, id);
    return this.studio.slotsOf(id);
  }

  /** Pictures into the slots: by slide number in the file name, else in order. */
  @Post('pictures/:id/slots')
  @UseInterceptors(FilesInterceptor('files', 40, { limits: { fileSize: 25 * 1024 * 1024 } }))
  fillSlots(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string, @UploadedFiles() files: Express.Multer.File[]) {
    if (!files?.length) throw new BadRequestException('Choose the pictures');
    return this.studio.fillSlots(a, id, files);
  }

  /** Magic resize: the slide as a new design in another format (no model involved). */
  @Post('pictures/:id/resize')
  resize(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) {
    return this.ai.resize(a, id, parse(z.object({ slideId: z.string().max(64).nullish(), format: z.string().max(40), mode: z.enum(['fit', 'fill']).nullish() }), b));
  }

  @Post('jobs/:id/cancel')
  @HttpCode(200)
  cancel(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.ai.cancel(a, id);
  }
}
