import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { EDGES_MAP, NODES_MAP, PAGE_ORDER, PAGES_MAP } from '@workos/flow-model';
import { createYSheet, RESOURCES_MAP, SHEETS_MAP, WB_MAP } from '@workos/sheet-model';
import { createYSlide, DECK_MAP, newId, ORDER_ARRAY, readDeck, SLIDES_MAP, type DeckSize, type PlainElement, type PlainSlide, type Theme } from '@workos/slide-model';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import sharp from 'sharp';
import * as Y from 'yjs';
import { SettingsService } from '../admin/settings.service';
import { CollabService } from '../collab/collab.service';
import type { Actor } from '../common/current-user';
import type { Db } from '../db/client';
import { InjectDb } from '../db/db.module';
import { aiPrompts, aiRuns, resources, workspaceMembers } from '../db/schema';
import { PermissionsService } from '../permissions/permissions.service';
import { ResourcesService } from '../resources/resources.service';
import { SheetsService } from '../sheets/sheets.service';
import { SlidesService } from '../slides/slides.service';
import { FlowRunnerService } from '../flow/flow-runner.service';
import { FLOW_SPEC_SCHEMA, flowFromSpec, repairFlowSpec, type FlowSpec } from './gen-flow';
import { alignColumns, catalogText, cleanPlan, planFromRequest, planText, SHEET_PLAN_SCHEMA, SHEET_SPEC_SCHEMA, SHEET_SUMMARY_SCHEMA, SHEET_TABLE_SCHEMA, workbookFromSpec, type SheetPlan, type SheetSpec, type SheetSpecTable } from './gen-sheet';
import { DECK_OUTLINE_SCHEMA, DESIGN_FORMATS, DESIGN_SCHEMA, deckOf, slidesFromDesign, slidesFromOutline, themeById, type DeckOutline, type DesignSpec } from './gen-slides';
import { OllamaClient, parseJsonLoose, type LlmModel } from './llm';
import { DocsService } from '../docs/docs.service';
import { capitalize, cleanPhotoPlan, ensureData, PARTS_SCHEMA, partBudget, partSchema, partsOfRequest, PHOTO_DETAIL_SCHEMA, photoPlanText, PICTURE_KINDS, slideCountOf, slidesFromPhotoPlan, type PhotoDetail, type PhotoPlan } from './gen-photodeck';
import { acceptChange, planRetext } from './retext';
import { adaptForPicture, fitSlide, resizeSlide, BANNER_COPY_SCHEMA, bannerSlides, CARD_COPY_SCHEMA, cardSlides, type BannerCopy, type CardCopy } from './gen-design';
import { DEFAULT_IMAGE_SETTINGS, ImageStudioService, type ImageSettings } from './image-studio';
import { fitTo } from './images';
import { encryptSecret } from '../auth/secrets';
import { BUILTIN_PROMPTS, builtinPrompt, fillTemplate, guessLanguage, type PromptApp, type PromptDef, type PromptOutput } from './prompts';

/** Workspace AI settings (system_settings key `ai`). */
export interface AiSettings {
  enabled: boolean;
  provider: 'ollama';
  url: string;
  /** Default model; empty = the first one the server has. */
  model: string;
  /** Per-app model, e.g. a small fast one for docs and a larger one for sheets. */
  models: Partial<Record<PromptApp, string>>;
  /** Context window (tokens): larger reads more but is slower on a CPU. */
  numCtx: number;
  /** Image AI connection (§81): OpenAI / Gemini keys (encrypted), models, who reads text in pictures. */
  images: ImageSettings;
}
const DEFAULT_SETTINGS: AiSettings = { enabled: true, provider: 'ollama', url: process.env.OLLAMA_URL ?? 'http://127.0.0.1:11434', model: process.env.OLLAMA_MODEL ?? '', models: {}, numCtx: 8192, images: DEFAULT_IMAGE_SETTINGS };

export interface PromptView extends PromptDef {
  builtIn: boolean;
  /** A built-in prompt changed in this workspace. */
  overridden: boolean;
  canEdit: boolean;
  updatedAt: string | null;
}

export interface JobInput {
  promptKey: string;
  request: string;
  /** Extra template variables (selection, context, …). */
  variables?: Record<string, string>;
  /** Write into this open file (flow → new page, sheet → new tabs, deck → slides) instead of creating a new one. */
  targetId?: string | null;
  /** Where a new file goes. */
  spaceId?: string | null;
  parentId?: string | null;
  format?: string | null;
  model?: string | null;
  notation?: 'flowchart' | 'bpmn' | null;
  slideId?: string | null;
  elementId?: string | null;
  as?: 'background' | 'element' | null;
  background?: 'template' | 'ai' | null;
}

type RunRow = typeof aiRuns.$inferSelect;
/** One model call of a job: a step name for the progress view, the prompt, its schema, a token cap, extra variables. */
type Gen = (step: string, prompt: PromptDef, schema: object | undefined, maxTokens: number, extra?: Record<string, string>) => Promise<string>;
interface Live {
  text: string;
  tokens: number;
  started: number;
  abort: AbortController;
}

const OUTPUT_SCHEMA: Partial<Record<PromptOutput, object>> = { flow: FLOW_SPEC_SCHEMA, sheet: SHEET_SPEC_SCHEMA, deck: DECK_OUTLINE_SCHEMA, design: DESIGN_SCHEMA };
/** Generous caps: a CPU writes ~5–15 tokens / s, so these bound a job to a few minutes. */
const MAX_TOKENS: Record<PromptOutput, number> = { flow: 1500, sheet: 3500, deck: 2500, design: 1800, template: 500, image: 400, layers: 1500, retext: 600, photodeck: 1600, markdown: 1800, text: 900 };
const RETEXT_SCHEMA = {
  type: 'object',
  properties: { c: { type: 'array', maxItems: 40, items: { type: 'object', properties: { i: { type: 'integer' }, t: { type: 'string', maxLength: 240 } }, required: ['i', 't'] } } },
  required: ['c'],
};

/** Template designs: a business card or a banner, by the chosen format. */
const isCard = (key: string, format?: string | null) => (format ? format.startsWith('business-card') : /card/i.test(key));

/**
 * The AI layer (docs/ARCHITECTURE.md §80): one assistant for every app. Runs prompts from the library against the
 * workspace's model (a local Ollama by default), one job at a time — a CPU cannot run two — and turns answers into
 * flows, workbooks, decks, designs or text. Everything it creates is marked `metadata.aiGenerated` and logged in
 * ai_runs; it acts with the person's own permissions.
 */
@Injectable()
export class AiService {
  private readonly log = new Logger(AiService.name);
  private readonly live = new Map<string, Live>();
  private queue: string[] = [];
  private working = false;
  private lastModels: { url: string; models: LlmModel[]; at: number } | null = null;

  constructor(
    @InjectDb() private readonly db: Db,
    private readonly settingsSvc: SettingsService,
    private readonly perms: PermissionsService,
    private readonly collab: CollabService,
    private readonly moduleRef: ModuleRef,
  ) {}

  // ── Settings & status ─────────────────────────────────────────────────────

  async settings(workspaceId: string): Promise<AiSettings> {
    const v = await this.settingsSvc.getValue<Partial<AiSettings>>(workspaceId, 'ai');
    return { ...DEFAULT_SETTINGS, ...(v ?? {}), models: { ...(v?.models ?? {}) }, images: { ...DEFAULT_IMAGE_SETTINGS, ...(v?.images ?? {}) } };
  }

  /** What the browser may see: everything but the API keys. */
  view(s: AiSettings) {
    const { openaiKey, geminiKey, ...images } = s.images;
    return { ...s, images: { ...images, hasOpenaiKey: !!openaiKey, hasGeminiKey: !!geminiKey } };
  }

  /** Keys arrive in plain text once and are stored encrypted; "" removes a key, undefined keeps it. */
  async setSettings(actor: Actor, patch: Partial<Omit<AiSettings, 'images'>> & { images?: Partial<ImageSettings> }) {
    const cur = await this.settings(actor.workspaceId);
    const imgPatch = { ...(patch.images ?? {}) };
    const keys: Partial<ImageSettings> = {};
    for (const k of ['openaiKey', 'geminiKey'] as const) {
      if (imgPatch[k] === undefined) continue;
      const plain = String(imgPatch[k]).trim();
      keys[k] = plain ? encryptSecret(plain) : undefined;
      delete imgPatch[k];
    }
    const images: ImageSettings = { ...cur.images, ...imgPatch, ...keys };
    for (const k of ['openaiKey', 'geminiKey'] as const) if (k in keys && !keys[k]) delete images[k];
    const next: AiSettings = { ...cur, ...patch, models: { ...cur.models, ...(patch.models ?? {}) }, images };
    if (!/^https?:\/\/[^\s]+$/i.test(next.url)) throw new BadRequestException('The model server address must start with http:// or https://');
    if (images.openaiBaseUrl && !/^https:\/\/[^\s]+$/i.test(images.openaiBaseUrl)) throw new BadRequestException('The OpenAI-compatible address must start with https://');
    if (images.provider === 'openai' && !images.openaiKey) throw new BadRequestException('Enter the OpenAI API key first');
    if (images.provider === 'gemini' && !images.geminiKey) throw new BadRequestException('Enter the Gemini API key first');
    if (images.vision === 'gemini' && !images.geminiKey) throw new BadRequestException('Reading text with Gemini needs the Gemini API key');
    next.numCtx = Math.min(131072, Math.max(2048, Math.round(next.numCtx)));
    for (const k of Object.keys(next.models) as PromptApp[]) if (!next.models[k]) delete next.models[k];
    await this.settingsSvc.putValue(actor, actor.workspaceId, 'ai', next);
    return this.view(next);
  }

  /** Makes one small picture with the configured image AI, to check the key and the model. */
  async testImages(actor: Actor) {
    const s = await this.settings(actor.workspaceId);
    const provider = this.moduleRef.get(ImageStudioService, { strict: false }).provider(s.images);
    if (!provider) throw new BadRequestException('Choose an image AI and enter its key first');
    const started = Date.now();
    const out = await provider.generate('A soft pastel gradient background with a few round bokeh lights, no text.', { w: 1024, h: 1024 });
    return { ok: true, provider: out.provider, model: out.model, bytes: out.data.length, ms: Date.now() - started };
  }

  async status(actor: Actor) {
    const s = await this.settings(actor.workspaceId);
    let models: LlmModel[] = [];
    let error: string | null = null;
    try {
      models = await new OllamaClient(s.url).models(15_000);
      this.lastModels = { url: s.url, models, at: Date.now() };
    } catch (e) {
      // A CPU busy writing an answer can be slow to list its models: keep the last list for a few minutes.
      if (this.lastModels?.url === s.url && Date.now() - this.lastModels.at < 300_000) models = this.lastModels.models;
      else error = `The model server at ${s.url} does not answer (${(e as Error).message}). Start Ollama, or set its address in Admin → AI.`;
    }
    const pick = (app?: PromptApp) => this.pickModel(s, models, app);
    return {
      enabled: s.enabled,
      provider: s.provider,
      url: s.url,
      reachable: !error,
      error,
      models,
      model: pick(),
      perApp: Object.fromEntries((['flow', 'sheets', 'slides', 'docs', 'general'] as PromptApp[]).map((a) => [a, pick(a)])),
      numCtx: s.numCtx,
      queue: this.queue.length + (this.working ? 1 : 0),
      formats: Object.entries(DESIGN_FORMATS).map(([id, f]) => ({ id, ...f })),
      // Image AI connection (no keys): which provider makes pictures, who reads the text in them.
      images: {
        provider: s.images.provider,
        ready: !!this.moduleRef.get(ImageStudioService, { strict: false }).provider(s.images),
        model: s.images.provider === 'openai' ? s.images.openaiModel : s.images.provider === 'gemini' ? s.images.geminiModel : s.images.provider === 'demo' ? 'demo' : null,
        vision: s.images.vision,
        visionModel: s.images.vision === 'gemini' ? 'gemini-2.5-flash' : s.images.visionModel || models.find((m) => m.vision)?.name || null,
      },
    };
  }

  private pickModel(s: AiSettings, models: LlmModel[], app?: PromptApp) {
    const want = (app && s.models[app]) || s.model;
    if (want && (!models.length || models.some((m) => m.name === want))) return want;
    // Prefer a text model over a vision one, then the larger.
    const text = models.filter((m) => !m.vision);
    const byParams = (xs: LlmModel[]) => [...xs].sort((a, b) => parseFloat(b.parameters ?? '0') - parseFloat(a.parameters ?? '0'));
    return byParams(text)[0]?.name ?? byParams(models)[0]?.name ?? want ?? '';
  }

  // ── Prompt library ───────────────────────────────────────────────────────

  private async isAdmin(actor: Actor) {
    const [m] = await this.db.select({ role: workspaceMembers.role }).from(workspaceMembers).where(and(eq(workspaceMembers.workspaceId, actor.workspaceId), eq(workspaceMembers.userId, actor.id)));
    return m?.role === 'owner' || m?.role === 'admin';
  }

  async prompts(actor: Actor): Promise<PromptView[]> {
    const rows = await this.db.select().from(aiPrompts).where(eq(aiPrompts.workspaceId, actor.workspaceId));
    const admin = await this.isAdmin(actor);
    const byKey = new Map(rows.map((r) => [r.key, r]));
    const out: PromptView[] = BUILTIN_PROMPTS.map((b) => {
      const o = byKey.get(b.key);
      return o ? { ...this.rowDef(o), partOf: b.partOf, builtIn: true, overridden: true, canEdit: admin, updatedAt: o.updatedAt } : { ...b, builtIn: true, overridden: false, canEdit: admin, updatedAt: null };
    });
    for (const r of rows) if (!builtinPrompt(r.key)) out.push({ ...this.rowDef(r), builtIn: false, overridden: false, canEdit: admin || r.createdBy === actor.id, updatedAt: r.updatedAt });
    return out;
  }

  private rowDef(r: typeof aiPrompts.$inferSelect): PromptDef {
    return { key: r.key, name: r.name, app: r.app as PromptApp, output: r.output as PromptOutput, description: r.description, system: r.system, template: r.template, temperature: r.temperature, variables: r.variables };
  }

  async prompt(actor: Actor, key: string): Promise<PromptView> {
    const p = (await this.prompts(actor)).find((x) => x.key === key);
    if (!p) throw new NotFoundException('Prompt not found');
    return p;
  }

  /** Built-in: saves this workspace's version (admins). Custom: creates or updates (its author or admins). */
  async savePrompt(actor: Actor, key: string | null, input: Omit<PromptDef, 'key'>) {
    const admin = await this.isAdmin(actor);
    const k = key ?? `custom.${crypto.randomUUID().slice(0, 8)}`;
    const builtIn = !!builtinPrompt(k);
    if (builtIn && !admin) throw new ForbiddenException('Only administrators change the built-in prompts');
    if (!builtIn && !k.startsWith('custom.')) throw new BadRequestException('Unknown prompt');
    const [existing] = await this.db.select().from(aiPrompts).where(and(eq(aiPrompts.workspaceId, actor.workspaceId), eq(aiPrompts.key, k)));
    if (existing && !builtIn && !admin && existing.createdBy !== actor.id) throw new ForbiddenException('Only its author or an administrator can change this prompt');
    if (!existing && key && !builtIn) throw new NotFoundException('Prompt not found');
    const values = { name: input.name, app: input.app, output: input.output, description: input.description, system: input.system, template: input.template, temperature: input.temperature, variables: input.variables, updatedBy: actor.id, updatedAt: new Date().toISOString() };
    if (existing) await this.db.update(aiPrompts).set(values).where(eq(aiPrompts.id, existing.id));
    else await this.db.insert(aiPrompts).values({ ...values, workspaceId: actor.workspaceId, key: k, createdBy: actor.id });
    return this.prompt(actor, k);
  }

  /** Custom: deletes it. Built-in: back to the shipped version. */
  async deletePrompt(actor: Actor, key: string) {
    const [row] = await this.db.select().from(aiPrompts).where(and(eq(aiPrompts.workspaceId, actor.workspaceId), eq(aiPrompts.key, key)));
    if (!row) throw new NotFoundException(builtinPrompt(key) ? 'This built-in prompt has not been changed' : 'Prompt not found');
    if (!(await this.isAdmin(actor)) && (builtinPrompt(key) || row.createdBy !== actor.id)) throw new ForbiddenException();
    await this.db.delete(aiPrompts).where(eq(aiPrompts.id, row.id));
  }

  /** A picture made elsewhere (ChatGPT, Gemini…) as a new one-page design in its own shape; its text is made editable next. */
  async importAsDesign(actor: Actor, file: { buffer: Buffer; mimetype: string; originalname?: string }, where: { spaceId?: string | null; parentId?: string | null }) {
    if (!/^image\//i.test(file.mimetype)) throw new BadRequestException('Choose a picture (PNG, JPEG, WebP…)');
    const meta = await sharp(file.buffer)
      .metadata()
      .catch(() => ({ width: 0, height: 0, orientation: 1 }));
    if (!meta.width || !meta.height) throw new BadRequestException('Choose a picture (PNG, JPEG, WebP…)');
    const swap = (meta.orientation ?? 1) >= 5;
    const size = ImageStudioService.sizeFor(swap ? meta.height : meta.width, swap ? meta.width : meta.height, DESIGN_FORMATS);
    // Multer reads names as latin1; browsers send UTF-8.
    const original = file.originalname ? Buffer.from(file.originalname, 'latin1').toString('utf8') : '';
    const name = (original.replace(/\.[a-z0-9]+$/i, '') || 'Picture').slice(0, 120) + ' (editable)';
    const created = await this.moduleRef.get(ResourcesService, { strict: false }).create(actor, { name, type: 'presentation', spaceId: where.spaceId ?? null, parentId: where.parentId ?? null });
    await this.moduleRef.get(SlidesService, { strict: false }).init(created.id, name, deckOf(name, size, themeById('master'), []));
    const studio = this.moduleRef.get(ImageStudioService, { strict: false });
    const r = await studio.importPicture(actor, created.id, file, { newSlide: true }, size);
    return { ...r, resourceId: created.id, url: `/slides/${created.id}`, name, size };
  }

  // ── Magic resize ──────────────────────────────────────────────────────────

  /** A copy of a slide in another format (Canva's "Resize"): a new one-page design next to the original. */
  async resize(actor: Actor, id: string, body: { slideId?: string | null; format: string; mode?: 'fit' | 'fill' | null }) {
    const fmt = DESIGN_FORMATS[body.format];
    if (!fmt) throw new BadRequestException('Unknown format');
    const { row } = await this.perms.require(actor, id, 'viewer');
    if (row.type !== 'presentation') throw new BadRequestException('Resize works on slides and designs');
    const slidesSvc = this.moduleRef.get(SlidesService, { strict: false });
    const studio = this.moduleRef.get(ImageStudioService, { strict: false });
    const deck = await slidesSvc.deck(id);
    const slide = deck.slides.find((s) => s.id === body.slideId) ?? deck.slides[0];
    if (!slide) throw new BadRequestException('The presentation has no slide');
    const base = row.name.replace(/\.(pptx?|odp|key)$/i, '').replace(/ · [^·]+$/, '');
    const name = `${base} · ${fmt.label}`.slice(0, 200);
    const created = await this.moduleRef.get(ResourcesService, { strict: false }).create(actor, { name, type: 'presentation', spaceId: row.spaceId ?? null, parentId: row.parentId ?? null });
    const docsSvc = this.moduleRef.get(DocsService, { strict: false });
    const save = async (png: Buffer) => (await docsSvc.saveAsset(actor, created.id, png, 'image/png')).url;
    // The pictures move along: they are assets of the original file.
    const copied = new Map<string, string>();
    const copy = async (src: string | undefined) => {
      if (!src || !src.includes(`/resources/${id}/assets/`)) return src;
      if (!copied.has(src)) copied.set(src, await save(await studio.bytesOf(id, src)));
      return copied.get(src);
    };
    const bg = slide.meta.background?.type === 'image' ? slide.meta.background.src : null;
    // A design on a picture (its text sits on the picture's own decorations) is kept whole: scaled into the new shape,
    // the margins filled with a blurred copy of the picture. Other designs are laid out again ("fill").
    const mode = body.mode ?? (bg ? 'fit' : 'fill');
    let out: PlainSlide;
    if (mode === 'fit') {
      const fitted = fitSlide(slide, deck.size, fmt.size);
      out = fitted.slide;
      if (bg) {
        const pic = await studio.bytesOf(id, bg).catch(() => null);
        if (pic) {
          // The picture as the original slide showed it (centred "cover" crop), as the bottom layer of the frame…
          const shown = await sharp(pic).resize(deck.size.w * 2, deck.size.h * 2, { fit: 'cover' }).png().toBuffer();
          const frame: PlainElement = { id: newId(), type: 'image', ...fitted.frame, z: 0, src: await save(shown), name: 'picture' };
          // …and a soft, blurred copy behind it fills the new shape.
          const soft = await sharp(pic).resize(Math.round(fmt.size.w / 2), Math.round(fmt.size.h / 2), { fit: 'cover' }).blur(18).modulate({ brightness: 1.04 }).png().toBuffer();
          out = { ...out, meta: { ...out.meta, background: { type: 'image', src: await save(soft) } }, elements: [frame, ...out.elements] };
        }
      }
    } else {
      out = resizeSlide(slide, deck.size, fmt.size);
      if (bg) out.meta = { ...out.meta, background: { type: 'image', src: (await copy(bg))! } };
    }
    for (const e of out.elements) if (e.src) e.src = await copy(e.src);
    await slidesSvc.init(created.id, name, { ...deck, name, size: fmt.size, slides: [{ ...out, no: undefined }] });
    return { resourceId: created.id, url: `/slides/${created.id}`, name, size: fmt.size, mode };
  }

  // ── Jobs ──────────────────────────────────────────────────────────────────

  async start(actor: Actor, input: JobInput) {
    const s = await this.settings(actor.workspaceId);
    if (!s.enabled) throw new BadRequestException('AI is turned off for this organisation (Admin → AI)');
    const p = await this.prompt(actor, input.promptKey);
    if (!input.request.trim() && !input.variables?.selection?.trim() && !['docs.summarize'].includes(p.key) && p.output !== 'layers') throw new BadRequestException('Describe what you want');
    if ((p.output === 'layers' || p.output === 'retext') && !input.targetId) throw new BadRequestException('Open the presentation with the picture first');
    if ((p.output === 'image' || p.output === 'layers' || input.background === 'ai') && !(await this.moduleRef.get(ImageStudioService, { strict: false }).provider((await this.settings(actor.workspaceId)).images)) && p.output !== 'layers') {
      throw new BadRequestException('Connect an image AI first (AI → Model & settings → Image AI: OpenAI or Gemini — or Demo to try it)');
    }
    if (input.targetId) {
      const { row } = await this.perms.require(actor, input.targetId, p.output === 'markdown' || p.output === 'text' ? 'viewer' : 'editor');
      const want = { flow: 'flow', sheet: 'spreadsheet', deck: 'presentation', photodeck: 'presentation', image: 'presentation', layers: 'presentation', retext: 'presentation' }[p.output as 'flow' | 'sheet' | 'deck' | 'photodeck' | 'image' | 'layers' | 'retext'];
      if (want && row.type !== want) throw new BadRequestException(`This prompt writes into a ${want}, not a ${row.type}`);
    }
    if ((p.output === 'design' || p.output === 'template') && input.format && !DESIGN_FORMATS[input.format]) throw new BadRequestException('Unknown format');
    const [row] = await this.db
      .insert(aiRuns)
      .values({ workspaceId: actor.workspaceId, userId: actor.id, promptKey: p.key, output: p.output, request: input.request.slice(0, 20_000), input: { ...input, request: undefined, actorName: actor.name } as Record<string, unknown> })
      .returning();
    this.queue.push(row.id);
    void this.pump();
    return this.dto(row);
  }

  private async pump() {
    if (this.working) return;
    this.working = true;
    try {
      while (this.queue.length) {
        const id = this.queue.shift()!;
        await this.run(id).catch((e: Error) => this.log.warn(`job ${id}: ${e.message}`));
      }
    } finally {
      this.working = false;
    }
  }

  private async run(id: string) {
    const [job] = await this.db.select().from(aiRuns).where(eq(aiRuns.id, id));
    if (!job || job.status !== 'queued') return;
    const input = job.input as unknown as JobInput & { actorName: string };
    const actor: Actor = { id: job.userId, name: input.actorName ?? 'AI', workspaceId: job.workspaceId };
    const live: Live = { text: '', tokens: 0, started: Date.now(), abort: new AbortController() };
    this.live.set(id, live);
    try {
      const s = await this.settings(job.workspaceId);
      const client = new OllamaClient(s.url);
      const models = await client.models().catch(() => [] as LlmModel[]);
      const p = await this.prompt(actor, job.promptKey);
      const model = input.model || this.pickModel(s, models, p.app);
      if (!model) throw new Error('No model on the model server: pull one with “ollama pull qwen2.5:3b”');
      await this.db.update(aiRuns).set({ status: 'running', model }).where(eq(aiRuns.id, id));

      const format = p.output === 'design' || p.output === 'template' ? DESIGN_FORMATS[input.format ?? (isCard(p.key) ? 'business-card-eu' : 'banner-web')] ?? DESIGN_FORMATS['banner-web'] : null;
      const h = format?.size.h ?? 720;
      const vars: Record<string, string> = {
        request: job.request,
        language: input.variables?.language || guessLanguage(job.request || input.variables?.selection || ''),
        today: new Date().toISOString().slice(0, 10),
        context: input.variables?.context ?? '',
        selection: (input.variables?.selection ?? '').slice(0, 24_000),
        format: format?.label ?? '',
        canvas: format ? `${format.size.w} × ${format.size.h} px, ${format.size.w >= format.size.h * 1.3 ? 'wide' : format.size.h >= format.size.w * 1.3 ? 'tall' : 'square'}` : '',
        // Font sizes in pt that read well on this canvas.
        headline: String(Math.max(9, Math.round(h * (p.key.includes('Card') ? 0.075 : 0.085)))),
        subhead: String(Math.max(7, Math.round(h * (p.key.includes('Card') ? 0.05 : 0.04)))),
        small: String(Math.max(6, Math.round(h * (p.key.includes('Card') ? 0.04 : 0.026)))),
        ...(input.variables ?? {}),
      };
      // One model call; the progress view shows the steps done so far and the answer streaming in.
      let done = '';
      const totals = { promptTokens: 0, outputTokens: 0, steps: 0 };
      const gen: Gen = async (step, prompt, schema, maxTokens, extra = {}) => {
        const v = { ...vars, ...extra };
        const head = step ? `▸ ${step}\n` : '';
        const res = await client.chat({
          model,
          system: fillTemplate(prompt.system, v),
          prompt: fillTemplate(prompt.template, v),
          format: schema,
          temperature: prompt.temperature,
          numCtx: s.numCtx,
          maxTokens,
          signal: live.abort.signal,
          onText: (text, tokens) => {
            live.text = `${done}${head}${text}`;
            live.tokens = totals.outputTokens + tokens;
          },
        });
        totals.promptTokens += res.promptTokens;
        totals.outputTokens += res.outputTokens;
        totals.steps++;
        done += `${head}${res.text}\n`;
        return res.text;
      };
      // Small models build a workbook far better one sheet at a time (plan → sheets → report).
      const answer = p.output === 'image' || p.output === 'layers' || p.output === 'retext' ? '' : p.output === 'photodeck' ? await this.photoDeckSteps(actor, gen, p, job.request) : p.key === 'sheet.generate' && p.output === 'sheet' ? await this.sheetSteps(actor, gen, job.request) : await gen('', p, p.output === 'template' ? (isCard(p.key, input.format) ? CARD_COPY_SCHEMA : BANNER_COPY_SCHEMA) : OUTPUT_SCHEMA[p.output], MAX_TOKENS[p.output]);
      const result = await this.apply(actor, p, { ...input, request: job.request }, answer, format?.size ?? null, gen, live);
      await this.db
        .update(aiRuns)
        .set({ status: 'done', answer: (totals.steps > 1 ? `${done}\n▸ Result\n${answer}` : answer).slice(0, 200_000), result: { ...result, ...(totals.steps > 1 ? { steps: totals.steps } : {}) }, promptTokens: totals.promptTokens, outputTokens: totals.outputTokens, ms: Date.now() - live.started, finishedAt: new Date().toISOString() })
        .where(eq(aiRuns.id, id));
    } catch (e) {
      const cancelled = live.abort.signal.aborted;
      await this.db
        .update(aiRuns)
        .set({ status: cancelled ? 'cancelled' : 'failed', error: cancelled ? null : String((e as Error).message ?? e).slice(0, 1000), answer: live.text.slice(0, 200_000) || null, ms: Date.now() - live.started, finishedAt: new Date().toISOString() })
        .where(eq(aiRuns.id, id));
    } finally {
      this.live.delete(id);
    }
  }

  /**
   * "sheet.generate" in steps (each step is a prompt of the library, so it can be tuned): plan the sheets, detail the
   * master lists, then the data sheets — told which codes the master lists hold, so their lookups find real rows —
   * and last the report sheets, which pick figures from the finished columns. Returns one SheetSpec as JSON.
   */
  /**
   * "slides.photoDeck" in steps: the plan (kinds and headings of every slide), then the slides a few at a time (points,
   * figures, captions, picture prompts) — a 3B model keeps 6 slides straight, not 30.
   */
  private async photoDeckSteps(actor: Actor, gen: Gen, p: PromptDef, request: string): Promise<string> {
    const want = slideCountOf(request) ?? 16;
    const lang = guessLanguage(request);
    // The parts: named in the request, else asked for (a small step a 3B model does well).
    let split = partsOfRequest(request);
    if (!split) {
      const out = parseJsonLoose<{ t?: string; p?: { n?: string; i?: string[] }[] }>(await gen('Parts', await this.prompt(actor, 'slides.photoDeck.parts'), PARTS_SCHEMA, 500));
      const parts = (out.p ?? []).filter((x) => x?.n).map((x) => ({ name: String(x.n), items: (x.i ?? []).map(String).filter(Boolean) }));
      if (parts.length < 2) throw new Error('The model found no parts for this presentation');
      split = { title: String(out.t ?? parts[0].name), parts };
    }
    const place = /(?:về|about|of)\s+([A-ZĐÀ-Ỹ][\p{L}]*(?:\s+[A-ZĐÀ-Ỹ][\p{L}]*)*)/u.exec(split.title)?.[1] ?? split.title;
    const budget = partBudget(split.parts, want);
    const s: PhotoPlan['s'] = [{ k: 'cover', h: split.title }];
    for (const [pi, part] of split.parts.entries()) {
      // Code: the part opens with its name, and every thing the request lists gets a picture slide of its own (a 3B
      // model asked to "show every item" forgets half of them). The model adds the rest: practical text, figures,
      // other real spots.
      const own: PhotoPlan['s'] = [{ k: 'section', h: part.name }];
      part.items.slice(0, Math.max(0, budget[pi] - 1)).forEach((it, i) => own.push({ k: i % 2 ? 'photo' : 'caption', h: capitalize(it), p: part.name }));
      own[0].p = part.name;
      const extra = budget[pi] - own.length;
      if (extra > 0) {
        const out = parseJsonLoose<{ s?: PhotoPlan['s'] }>(
          await gen(`Part ${pi + 1}: ${part.name}`, p, partSchema(extra), 80 + extra * 40, { title: split.title, place, part: part.name, items: part.items.join(', ') || '—', done: own.map((x) => x.h).join('; '), count: String(extra) }),
        );
        own.push(...(out.s ?? []).filter((x) => x && typeof x === 'object').map((x) => ({ k: x.k === 'section' ? ('photo' as const) : x.k, h: String(x.h ?? '').split('\n')[0], p: part.name })));
      }
      s.push(...own);
    }
    s.push({ k: 'end', h: lang === 'Vietnamese' ? 'Cảm ơn' : lang === 'Japanese' ? 'ありがとうございました' : 'Thank you' });
    const { plan, fixes } = cleanPhotoPlan({ t: split.title, s, place }, want, !['Japanese', 'Chinese'].includes(lang));
    const data = ensureData(plan, request);
    if (data) fixes.push(data);
    const detailP = await this.prompt(actor, 'slides.photoDeck.detail');
    const details: PhotoDetail[] = [];
    const planned = photoPlanText(plan);
    const item = PHOTO_DETAIL_SCHEMA.properties.s.items;
    for (let a = 1; a <= plan.s.length; a += 5) {
      const nums = plan.s.map((_, i) => i + 1).filter((n) => n >= a && n < a + 5);
      // One entry per slide asked, numbered from the chunk (the grammar enforces it: small models skip slides).
      const chunk = { type: 'object', properties: { s: { type: 'array', minItems: nums.length, maxItems: nums.length, items: { ...item, properties: { ...item.properties, i: { type: 'integer', enum: nums } } } } }, required: ['s'] };
      const out = parseJsonLoose<{ s?: PhotoDetail[] }>(await gen(`Slides ${nums[0]}–${nums[nums.length - 1]}`, detailP, chunk, 1000, { title: plan.t, plan: planned, range: `${nums[0]}–${nums[nums.length - 1]}` }));
      for (const d of out.s ?? []) if (nums.includes(d?.i) && !details.some((x) => x.i === d.i)) details.push(d);
      // What a slide's kind needs and the model left out: asked again, for that slide alone, with the field required.
      for (const n of nums) {
        const k = plan.s[n - 1].k;
        const field = PICTURE_KINDS.includes(k) ? 'img' : k === 'text' ? 'b' : k === 'data' ? 'd' : null;
        const have = details.find((x) => x.i === n);
        const ok = (x?: PhotoDetail) => !field || (field === 'img' ? !!x?.img?.trim() : field === 'b' ? (x?.b ?? []).filter((t) => String(t).trim()).length >= 2 : (x?.d ?? []).length >= 2);
        if (ok(have)) continue;
        const one = { type: 'object', properties: { s: { type: 'array', minItems: 1, maxItems: 1, items: { ...item, properties: { ...item.properties, i: { type: 'integer', enum: [n] }, b: { ...item.properties.b, minItems: 3 }, d: { ...item.properties.d, minItems: 2 } }, required: ['i', field!, ...(field === 'd' ? ['u'] : [])] } } }, required: ['s'] };
        const again = parseJsonLoose<{ s?: PhotoDetail[] }>(await gen(`Slide ${n} again`, detailP, one, 400, { title: plan.t, plan: planned, range: String(n) })).s?.[0];
        if (!again || !ok(again)) continue;
        const merged = { ...have, ...again, i: n };
        if (have) details[details.indexOf(have)] = merged;
        else details.push(merged);
      }
    }
    return JSON.stringify({ plan, details, fixes });
  }

  private async sheetSteps(actor: Actor, gen: Gen, request: string): Promise<string> {
    const [planP, tableP, summaryP] = await Promise.all(['sheet.plan', 'sheet.table', 'sheet.summary'].map((k) => this.prompt(actor, k)));
    // A request that lists its sheets and columns is the plan itself: no model call, nothing forgotten.
    const read = planFromRequest(request);
    const plan = read && read.plan.sheets.filter((x) => x.kind !== 'summary').length >= 2 ? read.plan : cleanPlan(parseJsonLoose<Partial<SheetPlan>>(await gen('Plan', planP, SHEET_PLAN_SCHEMA, 900)));
    if (!plan.sheets.some((s) => s.kind !== 'summary')) throw new Error('The model planned no data sheet');
    const tables = new Map<string, SheetSpecTable>();
    const samples: string[] = [];
    const planned = planText(plan);
    for (const s of plan.sheets.filter((x) => x.kind !== 'summary')) {
      const out = parseJsonLoose<Partial<SheetSpecTable>>(
        await gen(s.name, tableP, SHEET_TABLE_SCHEMA, 1400, {
          plan: planned,
          sheet: s.name,
          columns: s.columns.join(', '),
          samples: samples.length ? `Codes and names already in the master sheets (use these):\n${samples.join('\n')}` : '',
        }),
      );
      const { columns, rows } = alignColumns(s.columns, Array.isArray(out.columns) ? out.columns : [], Array.isArray(out.rows) ? out.rows : []);
      tables.set(s.name, { name: s.name, columns, rows, totals: !!out.totals });
      if (s.kind === 'master') {
        // The key column, and any column another sheet repeats by name, are what data sheets refer to.
        const others = new Set(plan.sheets.filter((x) => x !== s).flatMap((x) => x.columns.map((c) => c.toLowerCase())));
        columns.forEach((c, ci) => {
          if (ci !== 0 && !others.has(c.name.toLowerCase())) return;
          const values = [...new Set(rows.map((r) => r[ci]).filter((v) => v !== null && v !== ''))].slice(0, 12);
          if (values.length) samples.push(`${s.name} › ${c.name}: ${values.join(', ')}`);
        });
      }
    }
    for (const s of plan.sheets.filter((x) => x.kind === 'summary')) {
      const out = parseJsonLoose<Partial<SheetSpecTable>>(await gen(s.name, summaryP, SHEET_SUMMARY_SCHEMA, 900, { catalog: catalogText([...tables.values()]), sheet: s.name, asked: read?.asked[s.name]?.length ? `Figures asked for: ${read.asked[s.name].join(', ')}` : '' }));
      tables.set(s.name, { name: s.name, metrics: out.metrics ?? [], breakdowns: out.breakdowns ?? [] });
    }
    return JSON.stringify({ title: plan.title, sheets: plan.sheets.map((s) => tables.get(s.name)).filter(Boolean), ...(read && plan === read.plan ? { hints: read.hints } : {}) });
  }

  /**
   * A picture from the image AI, stored in the presentation: the local model first writes the picture prompt from
   * the brief (in English, no text in the picture, calm space for the design's text), then the provider paints it.
   */
  private async makePicture(actor: Actor, resourceId: string, brief: string, space: string, size: { w: number; h: number }, gen: Gen, live: Live) {
    const s = await this.settings(actor.workspaceId);
    const studio = this.moduleRef.get(ImageStudioService, { strict: false });
    const provider = studio.provider(s.images);
    if (!provider) throw new Error('Connect an image AI first (AI → Model & settings → Image AI)');
    const promptP = await this.prompt(actor, 'image.prompt');
    const written = parseJsonLoose<{ prompt?: string }>(await gen('Picture prompt', promptP, { type: 'object', properties: { prompt: { type: 'string', maxLength: 900 } }, required: ['prompt'] }, 400, { request: brief, space }));
    // Whatever the model wrote, the picture must stay free of text: the design puts its own.
    const prompt = `${String(written.prompt ?? brief).trim()} No text, no letters, no numbers, no logos, no watermark.`;
    live.text += `\n▸ Painting the picture with ${provider.id} (${provider.model})…`;
    const out = await provider.generate(prompt, size, live.abort.signal);
    const png = await fitTo(out.data, size.w, size.h);
    const url = await studio.store(actor, resourceId, png);
    return { url, provider: out.provider, model: out.model, prompt };
  }

  /** Turns the answer into what the prompt promises. */
  private async apply(actor: Actor, p: PromptView, input: JobInput, text: string, size: DeckSize | null, gen: Gen, live: Live): Promise<Record<string, unknown>> {
    const resourcesSvc = this.moduleRef.get(ResourcesService, { strict: false });
    const editor = { id: actor.id, name: `${actor.name} (AI)` };
    const where = { spaceId: input.spaceId ?? null, parentId: input.parentId ?? null };
    const mark = (id: string) => this.db.update(resources).set({ metadata: sql`${resources.metadata} || ${JSON.stringify({ aiGenerated: true, aiPrompt: p.key })}::jsonb` }).where(eq(resources.id, id));

    if (p.output === 'markdown' || p.output === 'text') return { text: text.trim() };

    if (p.output === 'flow') {
      const { spec, fixes } = repairFlowSpec(parseJsonLoose<Partial<FlowSpec>>(text));
      if (input.notation) spec.notation = input.notation;
      if (input.targetId) {
        const page = `p${crypto.randomUUID().slice(0, 6)}`;
        const plain = flowFromSpec(spec, { page, idPrefix: `${page}_` });
        await this.collab.transact(input.targetId, editor, (doc) => {
          doc.getMap(PAGES_MAP).set(page, { name: `AI · ${spec.title}`.slice(0, 60) });
          doc.getArray<string>(PAGE_ORDER).push([page]);
          const nodes = doc.getMap(NODES_MAP);
          for (const { id, ...n } of plain.nodes) nodes.set(id, JSON.parse(JSON.stringify(n)));
          const edges = doc.getMap(EDGES_MAP);
          for (const { id, ...e } of plain.edges) edges.set(id, JSON.parse(JSON.stringify(e)));
        });
        return { resourceId: input.targetId, pageId: page, url: `/flow/${input.targetId}?page=${page}`, title: spec.title, steps: spec.steps.length, fixes };
      }
      const created = await resourcesSvc.create(actor, { name: spec.title || 'AI workflow', type: 'flow', ...where });
      await this.moduleRef.get(FlowRunnerService, { strict: false }).importFlow(actor, created.id, flowFromSpec(spec, { page: 'p1' }));
      await mark(created.id);
      return { resourceId: created.id, url: `/flow/${created.id}`, title: spec.title, steps: spec.steps.length, fixes };
    }

    if (p.output === 'sheet') {
      const spec = parseJsonLoose<Partial<SheetSpec>>(text);
      const lang = guessLanguage(input.request);
      const { workbook, warnings, fixes } = workbookFromSpec(spec, { locale: lang === 'Vietnamese' ? 'vi' : lang === 'Japanese' ? 'ja' : 'en', hints: spec.hints });
      if (input.targetId) {
        await this.collab.transact(input.targetId, editor, (doc) => {
          const sheets = doc.getMap(SHEETS_MAP);
          const meta = doc.getMap(WB_MAP);
          const taken = new Set<string>();
          sheets.forEach((m) => taken.add(String(((m as Y.Map<unknown>).get('meta') as { name?: string } | undefined)?.name ?? '').toLowerCase()));
          for (const s of workbook.sheets) {
            let name = s.meta.name;
            for (let i = 2; taken.has(name.toLowerCase()); i++) name = `${s.meta.name.slice(0, 27)} ${i}`;
            taken.add(name.toLowerCase());
            s.meta = { ...s.meta, name };
            sheets.set(s.id, createYSheet(s));
          }
          meta.set('sheetOrder', [...((meta.get('sheetOrder') as string[]) ?? []), ...workbook.sheets.map((s) => s.id)]);
          const res = doc.getMap<string>(RESOURCES_MAP);
          for (const [k, v] of Object.entries(workbook.resources ?? {})) {
            const merged = { ...(res.get(k) ? (JSON.parse(res.get(k)!) as object) : {}), ...(JSON.parse(v) as object) };
            res.set(k, JSON.stringify(merged));
          }
        });
        return { resourceId: input.targetId, url: `/sheets/${input.targetId}`, title: workbook.name, sheets: workbook.sheets.map((s) => s.meta.name), warnings, fixes };
      }
      const created = await resourcesSvc.create(actor, { name: workbook.name || 'AI workbook', type: 'spreadsheet', ...where });
      await this.moduleRef.get(SheetsService, { strict: false }).init(created.id, workbook, editor);
      await mark(created.id);
      return { resourceId: created.id, url: `/sheets/${created.id}`, title: workbook.name, sheets: workbook.sheets.map((s) => s.meta.name), warnings, fixes };
    }

    if (p.output === 'photodeck') {
      const { plan, details, fixes } = JSON.parse(text) as { plan: PhotoPlan; details: PhotoDetail[]; fixes: string[] };
      const slidesSvc = this.moduleRef.get(SlidesService, { strict: false });
      const theme = themeById(/spa|beauty|làm đẹp|thẩm mỹ/i.test(input.request) ? 'sakura-beauty' : /rừng|núi|nông|xanh lá|organic/i.test(input.request) ? 'forest' : 'master');
      const byNo = new Map(details.map((d) => [d.i, d]));
      if (input.targetId) {
        const deck = await slidesSvc.deck(input.targetId);
        const { slides, prompts } = slidesFromPhotoPlan(plan, byNo, deck.size, deck.theme);
        await this.collab.transact(input.targetId, editor, (doc) => {
          const map = doc.getMap<Y.Map<unknown>>(SLIDES_MAP);
          for (const s of slides) {
            const y = createYSlide(s);
            map.set(s.id, y.map);
            y.fill();
          }
          doc.getArray<string>(ORDER_ARRAY).push(slides.map((s) => s.id));
        });
        return { resourceId: input.targetId, url: `/slides/${input.targetId}`, title: plan.t, slides: slides.length, pictures: prompts.length, prompts, fixes };
      }
      const sz = DESIGN_FORMATS.deck.size;
      const { slides, prompts } = slidesFromPhotoPlan(plan, byNo, sz, theme);
      const name = plan.t.slice(0, 120) || 'AI presentation';
      const created = await resourcesSvc.create(actor, { name, type: 'presentation', ...where });
      await slidesSvc.init(created.id, name, deckOf(name, sz, theme, slides));
      await mark(created.id);
      const kinds = plan.s.reduce<Record<string, number>>((m, x) => ((m[x.k] = (m[x.k] ?? 0) + 1), m), {});
      return { resourceId: created.id, url: `/slides/${created.id}`, title: name, slides: slides.length, pictures: prompts.length, kinds, prompts, fixes };
    }

    if (p.output === 'deck') {
      const outline = parseJsonLoose<Partial<DeckOutline>>(text);
      if (input.targetId) {
        const slidesSvc = this.moduleRef.get(SlidesService, { strict: false });
        const deck = await slidesSvc.deck(input.targetId);
        const slides = slidesFromOutline(outline, deck.size, deck.theme);
        await this.collab.transact(input.targetId, editor, (doc) => {
          const map = doc.getMap<Y.Map<unknown>>(SLIDES_MAP);
          for (const s of slides) {
            const y = createYSlide(s);
            map.set(s.id, y.map);
            y.fill();
          }
          doc.getArray<string>(ORDER_ARRAY).push(slides.map((s) => s.id));
        });
        return { resourceId: input.targetId, url: `/slides/${input.targetId}`, title: outline.title ?? '', slides: slides.length };
      }
      const theme = themeById(outline.theme && outline.theme !== 'master' ? outline.theme : /spa|beauty|làm đẹp|thẩm mỹ|da|nail|salon|mỹ phẩm/i.test(input.request) ? 'sakura-beauty' : /xanh lá|thiên nhiên|organic|nông/i.test(input.request) ? 'forest' : outline.theme);
      const sz = DESIGN_FORMATS.deck.size;
      const slides = slidesFromOutline(outline, sz, theme);
      const name = String(outline.title ?? 'AI presentation').slice(0, 120);
      const created = await resourcesSvc.create(actor, { name, type: 'presentation', ...where });
      await this.moduleRef.get(SlidesService, { strict: false }).init(created.id, name, deckOf(name, sz, theme, slides));
      await mark(created.id);
      return { resourceId: created.id, url: `/slides/${created.id}`, title: name, slides: slides.length };
    }

    if (p.output === 'template') {
      const sz = size ?? DESIGN_FORMATS['banner-web'].size;
      const card = isCard(p.key, input.format);
      const copy = parseJsonLoose<Record<string, unknown>>(text);
      const slides = card ? cardSlides(copy as Partial<CardCopy>, sz, input.request) : bannerSlides(copy as Partial<BannerCopy>, sz, input.request);
      const name = String((card ? `${copy.name ?? 'Card'} · business card` : copy.headline) ?? 'AI design').slice(0, 120);
      const created = await resourcesSvc.create(actor, { name, type: 'presentation', ...where });
      let picture: Record<string, unknown> | null = null;
      if (input.background === 'ai') {
        // The picture goes behind the brand side (cards) or the whole banner; the template's own decoration steps aside.
        const space = card ? 'the centre' : sz.w >= sz.h * 1.3 ? 'the left half' : 'the upper and lower thirds';
        const made = await this.makePicture(actor, created.id, `${input.request}\n(Design: ${String(copy.headline ?? copy.company ?? copy.name ?? '')})`, space, card ? { w: sz.w * 4, h: sz.h * 4 } : { w: Math.max(1600, sz.w), h: Math.round((Math.max(1600, sz.w) * sz.h) / sz.w) }, gen, live);
        adaptForPicture(slides[0], sz, made.url, card);
        picture = { provider: made.provider, model: made.model, prompt: made.prompt };
      }
      await this.moduleRef.get(SlidesService, { strict: false }).init(created.id, name, deckOf(name, sz, themeById('master'), slides));
      await mark(created.id);
      return { resourceId: created.id, url: `/slides/${created.id}`, title: name, pages: slides.length, size: sz, template: copy.template ?? null, palette: copy.palette ?? null, ...(picture ? { picture } : {}) };
    }

    if (p.output === 'image') {
      // A picture from the image AI: on a slide of the open deck, or as a new one-page design.
      const slidesSvc = this.moduleRef.get(SlidesService, { strict: false });
      if (input.targetId) {
        const deck = await slidesSvc.deck(input.targetId);
        const slideId = input.slideId && deck.slides.some((s) => s.id === input.slideId) ? input.slideId : deck.slides[0]?.id;
        if (!slideId) throw new Error('The presentation has no slide');
        const made = await this.makePicture(actor, input.targetId, input.request, input.as === 'element' ? 'none' : 'some calm areas for text', { w: Math.max(1600, deck.size.w), h: Math.round((Math.max(1600, deck.size.w) * deck.size.h) / deck.size.w) }, gen, live);
        await this.moduleRef.get(ImageStudioService, { strict: false }).place(actor, input.targetId, slideId, made.url, input.as === 'element' ? 'element' : 'background', deck.size);
        return { resourceId: input.targetId, url: `/slides/${input.targetId}`, title: 'Picture added', slideId, provider: made.provider, model: made.model, prompt: made.prompt };
      }
      const sz = size ?? DESIGN_FORMATS['banner-web'].size;
      const name = input.request.split(/[.\n]/)[0].slice(0, 80) || 'AI picture';
      const created = await resourcesSvc.create(actor, { name, type: 'presentation', ...where });
      const made = await this.makePicture(actor, created.id, input.request, 'some calm areas for text', { w: Math.max(1600, sz.w), h: Math.round((Math.max(1600, sz.w) * sz.h) / sz.w) }, gen, live);
      const slide = { id: crypto.randomUUID().slice(0, 12), meta: { layout: 'blank' as const, background: { type: 'image' as const, src: made.url } }, notes: `Picture by ${made.provider} (${made.model}). Prompt: ${made.prompt}`, elements: [] };
      await slidesSvc.init(created.id, name, deckOf(name, sz, themeById('master'), [slide]));
      await mark(created.id);
      return { resourceId: created.id, url: `/slides/${created.id}`, title: name, size: sz, provider: made.provider, model: made.model, prompt: made.prompt };
    }

    if (p.output === 'layers') {
      // Photoshop-like: the text of a picture becomes editable text layers; the picture keeps everything else.
      const studio = this.moduleRef.get(ImageStudioService, { strict: false });
      const s = await this.settings(actor.workspaceId);
      await studio.requireEditor(actor, input.targetId!);
      const deck = await this.moduleRef.get(SlidesService, { strict: false }).deck(input.targetId!);
      const src = await studio.sourceOf(input.targetId!, input.slideId ?? null, input.elementId ?? null, deck.size);
      const original = await studio.bytesOf(input.targetId!, src.src);
      const models = await new OllamaClient(s.url).models(15_000).catch(() => [] as LlmModel[]);
      const readP = await this.prompt(actor, 'image.readText');
      const head = '▸ Reading the text of the picture\n';
      live.text = head;
      const lines = await studio.readText(original, s.images, { url: s.url, models }, readP, live.abort.signal, (t, n) => ((live.text = head + t), (live.tokens = n)));
      if (!lines.length) throw new Error('No text was found in the picture');
      live.text += '\n▸ Placing every line exactly (local OCR)';
      const exact = await studio.exactBoxes(original, lines);
      lines.splice(0, lines.length, ...exact.lines);
      live.text += ` — ${exact.snapped} of ${lines.length} lines placed to the pixel`;
      live.text += `\n▸ Taking the text off the picture (${lines.length} lines)`;
      const removeP = await this.prompt(actor, 'image.removeText');
      const cleaned = await studio.removeText(original, lines, studio.provider(s.images), removeP.system, live.abort.signal);
      const r = await studio.makeEditable(actor, input.targetId!, src, lines, original, cleaned.data, deck.size);
      return { resourceId: input.targetId, url: `/slides/${input.targetId}`, title: `${r.lines} text layers`, lines: lines.map((l) => l.text), placed: exact.snapped, removedBy: cleaned.by, slideId: src.slideId };
    }

    if (p.output === 'retext') {
      // New information into the text layers of the slide on screen: exact pairs and facts in code, the rest by the
      // model — whose changes must only add words of the request (retext.ts).
      const studio = this.moduleRef.get(ImageStudioService, { strict: false });
      await studio.requireEditor(actor, input.targetId!);
      const deck = await this.moduleRef.get(SlidesService, { strict: false }).deck(input.targetId!);
      const { slideId, items } = await studio.textsOf(input.targetId!, input.slideId ?? null);
      if (!items.length) throw new Error('This slide has no text to change — make the picture’s text editable first');
      const plan = planRetext(input.request, items);
      const by: string[] = plan.exact.length ? ['exact'] : [];
      const rejected: string[] = [];
      if (plan.rest) {
        const view = items.map((it) => ({ ...it, text: plan.texts.get(it.id) ?? it.text }));
        const lines = view.map((t, i) => `${i + 1}: ${t.text.replace(/\n/g, ' / ')}`).join('\n');
        const answer = await gen('', p, RETEXT_SCHEMA, MAX_TOKENS.retext, { lines, request: plan.rest });
        const spec = parseJsonLoose<{ c?: { i?: number; t?: string }[] }>(answer);
        for (const c of spec.c ?? []) {
          if (!Number.isInteger(c.i) || c.i! < 1 || c.i! > view.length || typeof c.t !== 'string' || !c.t.trim()) continue;
          const it = view[c.i! - 1];
          const to = c.t.replace(/\s+\/\s+/g, '\n').trim();
          if (to === it.text) continue;
          if (!acceptChange(it.text, to, plan.rest)) {
            rejected.push(`${it.text} → ${to}`);
            continue;
          }
          plan.texts.set(it.id, to);
        }
        by.push('AI');
      }
      const changes = [...plan.texts].map(([id, text]) => ({ id, text }));
      if (!changes.length) throw new Error('Nothing to change: no line of the slide matches the request');
      const n = await studio.retext(actor, input.targetId!, slideId, changes, deck.size);
      const was = new Map(items.map((x) => [x.id, x.text]));
      return { resourceId: input.targetId, url: `/slides/${input.targetId}`, title: `${n} text layers changed`, slideId, by: by.join(' + '), exact: plan.exact, changes: changes.map((c) => ({ from: was.get(c.id), to: c.text })), ...(rejected.length ? { warnings: rejected.map((r) => `Not applied (adds words the request does not have): ${r}`) } : {}) };
    }

    if (p.output === 'design') {
      const spec = parseJsonLoose<Partial<DesignSpec>>(text);
      const sz = size ?? DESIGN_FORMATS['banner-web'].size;
      const theme: Theme = themeById('master');
      const { slides, warnings } = slidesFromDesign(spec, sz, theme);
      const name = String(spec.title ?? 'AI design').slice(0, 120);
      const created = await resourcesSvc.create(actor, { name, type: 'presentation', ...where });
      await this.moduleRef.get(SlidesService, { strict: false }).init(created.id, name, deckOf(name, sz, theme, slides));
      await mark(created.id);
      return { resourceId: created.id, url: `/slides/${created.id}`, title: name, pages: slides.length, size: sz, warnings };
    }
    throw new Error(`Unknown output ${p.output}`);
  }

  async cancel(actor: Actor, id: string) {
    const [row] = await this.db.select().from(aiRuns).where(and(eq(aiRuns.id, id), eq(aiRuns.userId, actor.id)));
    if (!row) throw new NotFoundException('Job not found');
    if (row.status === 'queued') {
      this.queue = this.queue.filter((x) => x !== id);
      await this.db.update(aiRuns).set({ status: 'cancelled', finishedAt: new Date().toISOString() }).where(eq(aiRuns.id, id));
    } else if (row.status === 'running') this.live.get(id)?.abort.abort();
    else throw new BadRequestException('The job has already finished');
    return this.job(actor, id);
  }

  async job(actor: Actor, id: string) {
    const [row] = await this.db.select().from(aiRuns).where(and(eq(aiRuns.id, id), eq(aiRuns.workspaceId, actor.workspaceId)));
    if (!row || (row.userId !== actor.id && !(await this.isAdmin(actor)))) throw new NotFoundException('Job not found');
    return this.dto(row);
  }

  async jobs(actor: Actor, limit = 20) {
    const rows = await this.db
      .select()
      .from(aiRuns)
      .where(and(eq(aiRuns.workspaceId, actor.workspaceId), eq(aiRuns.userId, actor.id)))
      .orderBy(desc(aiRuns.createdAt))
      .limit(Math.min(100, limit));
    return rows.map((r) => this.dto(r));
  }

  private dto(r: RunRow) {
    const live = this.live.get(r.id);
    const position = this.queue.indexOf(r.id);
    return {
      id: r.id,
      promptKey: r.promptKey,
      output: r.output,
      model: r.model,
      status: r.status,
      request: r.request,
      result: r.result,
      error: r.error,
      // While it runs: the answer so far (for the progress view) and its size.
      partial: live ? live.text.slice(-4000) : r.status === 'done' || r.status === 'failed' ? (r.answer ?? '').slice(0, 20_000) : '',
      tokens: live ? live.tokens : (r.outputTokens ?? 0),
      elapsedMs: live ? Date.now() - live.started : (r.ms ?? 0),
      queuePosition: position >= 0 ? position + 1 + (this.working ? 1 : 0) : 0,
      createdAt: r.createdAt,
      finishedAt: r.finishedAt,
    };
  }

  /** For tests and the playground: jobs of these ids, newest first. */
  async jobsByIds(actor: Actor, ids: string[]) {
    if (!ids.length) return [];
    const rows = await this.db.select().from(aiRuns).where(and(eq(aiRuns.workspaceId, actor.workspaceId), inArray(aiRuns.id, ids)));
    return rows.map((r) => this.dto(r));
  }

  /** Reads a deck's slide titles, sheet names or flow pages so a prompt can mention what is already there. */
  async contextOf(actor: Actor, id: string): Promise<string> {
    const { row } = await this.perms.require(actor, id, 'viewer');
    if (row.type === 'presentation') {
      const state = await this.collab.currentState(id);
      if (!state) return '';
      const doc = new Y.Doc();
      Y.applyUpdate(doc, state);
      const deck = readDeck(doc);
      void DECK_MAP;
      return `The presentation "${row.name}" already has ${deck.slides.length} slides.`;
    }
    return `The file is "${row.name}".`;
  }
}
