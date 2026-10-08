import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import {
  answerText,
  blankForm,
  FORM_MAP,
  isCorrect,
  isQuestion,
  pointsFor,
  pagesOf,
  publicForm,
  readForm,
  responseColumns,
  scoreOf,
  validateAnswer,
  visitedPages,
  writeForm,
  type Answers,
  type FormSettings,
  type Grades,
  type PlainForm,
} from '@workos/form-model';
import { can } from '@workos/shared';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import * as Y from 'yjs';
import type { Actor } from '../common/current-user';
import { CollabService } from '../collab/collab.service';
import type { Db } from '../db/client';
import { InjectDb } from '../db/db.module';
import { config } from '../config';
import { blobs, formResponses, formSubscriptions, resourceAssets, resources, users, workspaceMembers } from '../db/schema';
import { DocStore } from '../docs/doc-store';
import { EventsService } from '../events/events.service';
import { MailService, mailHtml } from '../mail/mail.service';
import { PermissionsService } from '../permissions/permissions.service';
import { ResourcesService } from '../resources/resources.service';
import { SheetsService } from '../sheets/sheets.service';
import { MacroTriggersService } from '../sheets/macro-triggers.service';
import { StorageService } from '../storage/storage.service';
import { flowHooks } from '../flow/flow-hooks';
import { QuotaService } from '../storage/quota.service';

const csvCell = (v: string | number) => {
  const s = String(v ?? '');
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/**
 * Forms (docs/ARCHITECTURE.md §25): the definition is a collaborative Yjs document like every file; respondents
 * submit through a separate endpoint that only needs the link (not a share), answers are validated with the same
 * rules the respondent page uses, scored when the form is a quiz, and optionally appended to a linked spreadsheet.
 */
@Injectable()
export class FormsService {
  private readonly log = new Logger('Forms');

  constructor(
    @InjectDb() private readonly db: Db,
    private readonly perms: PermissionsService,
    private readonly store: DocStore,
    private readonly collab: CollabService,
    private readonly storage: StorageService,
    private readonly events: EventsService,
    private readonly sheets: SheetsService,
    private readonly mail: MailService,
    private readonly moduleRef: ModuleRef,
    private readonly quota: QuotaService,
  ) {}

  static stateOf(f: PlainForm) {
    const doc = new Y.Doc();
    writeForm(doc, f);
    return { doc, state: Y.encodeStateAsUpdate(doc) };
  }

  static preview(state: Uint8Array): PlainForm {
    const doc = new Y.Doc();
    Y.applyUpdate(doc, state);
    return readForm(doc);
  }

  async init(id: string, name: string, form: PlainForm = blankForm(name)) {
    const { doc, state } = FormsService.stateOf(form);
    await this.store.save(id, state, doc, null);
  }

  private async load(id: string) {
    const [row] = await this.db.select().from(resources).where(eq(resources.id, id));
    if (!row || row.type !== 'form' || row.trashedAt) throw new NotFoundException('Form not found');
    const state = await this.collab.currentState(id);
    if (!state?.length) {
      await this.init(id, row.name);
      return { row, form: blankForm(row.name) };
    }
    return { row, form: FormsService.preview(state) };
  }

  /** Who may respond: anyone with the link (public forms) or people in the form's workspace. */
  private async canRespond(actor: Actor | undefined, row: typeof resources.$inferSelect, s: FormSettings) {
    if (s.access === 'public') return true;
    if (!actor) return false;
    const [m] = await this.db
      .select({ id: workspaceMembers.userId })
      .from(workspaceMembers)
      .where(and(eq(workspaceMembers.userId, actor.id), eq(workspaceMembers.workspaceId, row.workspaceId)));
    return !!m;
  }

  private closedReason(s: FormSettings) {
    if (!s.accepting) return s.closedMessage;
    if (s.closesAt && Date.parse(s.closesAt) < Date.now()) return s.closedMessage;
    return null;
  }

  // ── Respondent side ───────────────────────────────────────────────────────

  async publicView(actor: Actor | undefined, id: string, editToken?: string) {
    const { row, form } = await this.load(id);
    if (!(await this.canRespond(actor, row, form.settings))) throw new ForbiddenException('This form is only open to people in the organisation');
    const [me] = actor ? await this.db.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, actor.id)) : [];
    let existing: { id: string; answers: Answers; email: string | null } | null = null;
    if (editToken) {
      const [r] = await this.db.select().from(formResponses).where(and(eq(formResponses.formId, id), eq(formResponses.editToken, editToken)));
      if (r) existing = { id: r.id, answers: r.answers as Answers, email: r.email };
    }
    let alreadyResponded = false;
    if (form.settings.limitOne && actor) {
      const [r] = await this.db.select({ id: formResponses.id }).from(formResponses).where(and(eq(formResponses.formId, id), eq(formResponses.respondentId, actor.id))).limit(1);
      alreadyResponded = !!r;
    }
    return {
      form: publicForm(form),
      closed: this.closedReason(form.settings),
      respondent: me ? { name: me.name, email: me.email } : null,
      existing,
      alreadyResponded,
    };
  }

  async submit(actor: Actor | undefined, id: string, input: { answers: Answers; email?: string | null; editToken?: string | null; sendCopy?: boolean }) {
    const { row, form } = await this.load(id);
    const s = form.settings;
    if (!(await this.canRespond(actor, row, s))) throw new ForbiddenException('This form is only open to people in the organisation');
    const closed = this.closedReason(s);
    if (closed) throw new ForbiddenException(closed);

    // Keep only answers to questions on pages the respondent actually reached (branching), then validate them.
    const visited = new Set(visitedPages(form, input.answers));
    const pages = pagesOf(form);
    const answers: Answers = {};
    const errors: Record<string, string> = {};
    pages.forEach((p, i) => {
      if (!visited.has(i)) return;
      for (const it of p.items) {
        if (!isQuestion(it.type)) continue;
        const a = input.answers[it.id];
        const err = validateAnswer(it, a);
        if (err) errors[it.id] = err;
        else if (a !== undefined && a !== null && a !== '') answers[it.id] = a;
      }
    });
    if (Object.keys(errors).length) throw new BadRequestException({ message: 'Some answers need attention', errors });

    let email: string | null = null;
    if (s.collectEmail === 'verified') {
      if (!actor) throw new BadRequestException('Sign in to respond');
      const [u] = await this.db.select({ email: users.email }).from(users).where(eq(users.id, actor.id));
      email = u?.email ?? null;
    } else if (s.collectEmail === 'input') {
      if (!input.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email)) throw new BadRequestException({ message: 'Some answers need attention', errors: { __email: 'Enter a valid email address' } });
      email = input.email.trim();
    }
    const wantsCopy = !!email && (s.sendCopy === 'always' || (s.sendCopy === 'requested' && !!input.sendCopy));

    // Editing an earlier response (allowEdit) or a new one.
    if (input.editToken) {
      if (!s.allowEdit) throw new ForbiddenException('Responses to this form cannot be edited');
      const [prev] = await this.db.select().from(formResponses).where(and(eq(formResponses.formId, id), eq(formResponses.editToken, input.editToken)));
      if (!prev) throw new NotFoundException('Response not found');
      // Manual grades stay only for answers the respondent did not change.
      const prevAnswers = prev.answers as Answers;
      const grades = Object.fromEntries(Object.entries(prev.grades ?? {}).filter(([q]) => JSON.stringify(prevAnswers[q]) === JSON.stringify(answers[q])));
      const score = s.quiz ? scoreOf(form, answers, grades) : null;
      await this.db.update(formResponses).set({ answers, score, grades, email: email ?? prev.email, updatedAt: sql`now()` }).where(eq(formResponses.id, prev.id));
      if (wantsCopy) void this.sendCopy(id, form, { email: email!, answers, score, editToken: input.editToken, released: !!prev.releasedAt });
      this.collab.notify(id, { type: 'responses' });
      return this.receipt(form, prev.id, input.editToken, score, !!prev.releasedAt);
    }
    const score = s.quiz ? scoreOf(form, answers) : null;
    if (s.limitOne) {
      if (!actor) throw new BadRequestException('Sign in to respond');
      const [dup] = await this.db.select({ id: formResponses.id }).from(formResponses).where(and(eq(formResponses.formId, id), eq(formResponses.respondentId, actor.id))).limit(1);
      if (dup) throw new ConflictException('You have already responded');
    }
    const editToken = crypto.randomUUID().replace(/-/g, '');
    const [created] = await this.db
      .insert(formResponses)
      .values({ formId: id, respondentId: s.access === 'public' && s.collectEmail === 'off' ? null : actor?.id ?? null, email, answers, score, editToken })
      .returning();
    if (actor) {
      await this.events.emit(this.db, actor, 'form.response_submitted', { resourceId: id, spaceId: row.spaceId }, { name: row.name, type: 'form' });
    }
    if (s.sheetId) {
      const cols = responseColumns(form);
      // Written as the respondent (or the form's owner for anonymous answers); a failure must not lose the response.
      const line = cols.cells({ submittedAt: created.submittedAt, email, score, answers });
      const at = await this.sheets
        .appendRows(s.sheetId, [line], actor ?? { id: row.ownerId, name: 'Form response' })
        .catch((e) => (this.log.warn(`append to linked sheet ${s.sheetId} failed: ${(e as Error).message}`), null));
      // "On form submit" triggers of the linked spreadsheet (§48) — after the response is safe, never blocking it.
      if (at) {
        const namedValues = Object.fromEntries(cols.header.map((h, i) => [String(h), [String(line[i] ?? '')]]));
        const range = { sheet: at.sheet, r: at.row, c: 0, nr: 1, nc: line.length };
        void this.moduleRef
          .get(MacroTriggersService, { strict: false })
          .formSubmitted(s.sheetId, { range, values: line, namedValues })
          .catch((e: Error) => this.log.warn(`form submit triggers: ${e.message}`));
      }
    }
    this.collab.notify(id, { type: 'responses' });
    void this.notifySubscribers(row, form, { respondent: actor?.name ?? null, email, answers, score });
    // Flows that start on this form (§77 batch 2): answers by question title for {{trigger.answers.Question}}.
    flowHooks.fire('form.submitted', row.workspaceId, {
      formId: id,
      formName: row.name,
      spaceId: row.spaceId,
      responseId: created.id,
      email,
      respondent: actor ? { id: actor.id, name: actor.name } : null,
      answers: Object.fromEntries(form.items.filter((it) => answers[it.id] !== undefined).map((it) => [it.title || it.id, answers[it.id]])),
      answersById: answers,
      score,
    });
    if (wantsCopy) void this.sendCopy(id, form, { email: email!, answers, score, editToken, released: false });
    return this.receipt(form, created.id, editToken, score);
  }

  // ── E-mail (§62) ──────────────────────────────────────────────────────────

  private webUrl(path: string) {
    return `${config.webOrigin.replace(/\/$/, '')}${path}`;
  }

  /** Answer lines (question → answer text) for e-mails. */
  private answerRows(form: PlainForm, answers: Answers): [string, string][] {
    return form.items.filter((i) => isQuestion(i.type)).map((i) => [i.title, answerText(i, answers[i.id])]);
  }

  /** "Get email notifications for new responses": one mail per subscribed person who can still edit the form. */
  private async notifySubscribers(row: typeof resources.$inferSelect, form: PlainForm, r: { respondent: string | null; email: string | null; answers: Answers; score: { points: number; max: number } | null }) {
    try {
      const subs = await this.db
        .select({ id: users.id, name: users.name, email: users.email })
        .from(formSubscriptions)
        .innerJoin(users, eq(users.id, formSubscriptions.userId))
        .where(eq(formSubscriptions.formId, row.id));
      if (!subs.length) return;
      const [{ n }] = await this.db.select({ n: sql<number>`count(*)::int` }).from(formResponses).where(eq(formResponses.formId, row.id));
      const who = r.respondent ?? r.email ?? 'Someone';
      const url = this.webUrl(`/forms/${row.id}?tab=responses`);
      const rows: [string, string][] = [...(r.score ? [['Score', `${r.score.points} / ${r.score.max}`] as [string, string]] : []), ...this.answerRows(form, r.answers)];
      for (const u of subs) {
        const role = await this.perms.roleFor({ id: u.id, name: u.name, workspaceId: row.workspaceId }, row);
        if (!can(role, 'editor')) continue;
        await this.mail.send({
          kind: 'form.response',
          to: u.email,
          resourceId: row.id,
          subject: `New response to "${form.title}"`,
          text: `${who} responded to "${form.title}" (${n} response${n === 1 ? '' : 's'} so far).\n\n${rows.map(([k, v]) => `${k}: ${v}`).join('\n')}\n\nView responses: ${url}\n\nTurn these e-mails off in the Responses tab.`,
          html: mailHtml({ title: `New response to "${form.title}"`, intro: `${who} responded — ${n} response${n === 1 ? '' : 's'} so far.`, rows, button: { label: 'View responses', url }, footer: 'You get this because you turned on e-mail notifications for this form in Master Forms.', color: form.theme.color }),
        });
      }
    } catch (e) {
      this.log.warn(`response notifications for ${row.id}: ${(e as Error).message}`);
    }
  }

  /** "Send responders a copy of their response". The score is included only when respondents may already see it. */
  private async sendCopy(id: string, form: PlainForm, r: { email: string; answers: Answers; score: { points: number; max: number } | null; editToken: string; released: boolean }) {
    const s = form.settings;
    const showScore = s.quiz && r.score && (s.releaseScore === 'immediately' || r.released);
    const rows: [string, string][] = [...(showScore ? [['Score', `${r.score!.points} / ${r.score!.max}`] as [string, string]] : []), ...this.answerRows(form, r.answers)];
    const edit = s.allowEdit ? this.webUrl(`/f/${id}?edit=${r.editToken}`) : null;
    await this.mail.send({
      kind: 'form.copy',
      to: r.email,
      resourceId: id,
      subject: `Your response to "${form.title}"`,
      text: `Thanks for filling out "${form.title}". Here is what was received:\n\n${rows.map(([k, v]) => `${k}: ${v}`).join('\n')}${edit ? `\n\nEdit your response: ${edit}` : ''}`,
      html: mailHtml({ title: `Thanks for filling out "${form.title}"`, intro: 'Here is what was received.', rows, button: edit ? { label: 'Edit response', url: edit } : undefined, color: form.theme.color }),
    });
  }

  async subscription(actor: Actor, id: string) {
    await this.perms.require(actor, id, 'editor');
    const [row] = await this.db.select().from(formSubscriptions).where(and(eq(formSubscriptions.formId, id), eq(formSubscriptions.userId, actor.id)));
    return { on: !!row, delivering: this.mail.delivering };
  }

  async setSubscription(actor: Actor, id: string, on: boolean) {
    await this.perms.require(actor, id, 'editor');
    if (on) await this.db.insert(formSubscriptions).values({ formId: id, userId: actor.id }).onConflictDoNothing();
    else await this.db.delete(formSubscriptions).where(and(eq(formSubscriptions.formId, id), eq(formSubscriptions.userId, actor.id)));
    return this.subscription(actor, id);
  }

  /** E-mails recorded for a form (newest first) — what was sent to whom; the Mail module will show the same rows. */
  async outbox(actor: Actor, id: string) {
    await this.perms.require(actor, id, 'editor');
    return this.mail.forResource(id);
  }

  // ── Import questions (§61) ────────────────────────────────────────────────

  /** The full definition (answer keys included) for people who can open the form — like syncing its document. */
  async definition(actor: Actor, id: string) {
    await this.perms.require(actor, id, 'viewer');
    const { form } = await this.load(id);
    return { title: form.title, items: form.items };
  }

  // ── Manual grading & releasing scores (§63) ───────────────────────────────

  async grade(actor: Actor, id: string, responseId: string, grades: Grades) {
    await this.perms.require(actor, id, 'editor');
    const { form } = await this.load(id);
    if (!form.settings.quiz) throw new BadRequestException('This form is not a quiz');
    const [r] = await this.db.select().from(formResponses).where(and(eq(formResponses.formId, id), eq(formResponses.id, responseId)));
    if (!r) throw new NotFoundException('Response not found');
    const next: Grades = { ...((r.grades ?? {}) as Grades) };
    for (const [q, g] of Object.entries(grades)) {
      const it = form.items.find((i) => i.id === q);
      const max = it?.quiz?.points ?? 0;
      if (!it || !max) throw new BadRequestException('That question has no points');
      if (typeof g.points === 'number' && !(g.points >= 0 && g.points <= max)) throw new BadRequestException(`Points must be between 0 and ${max}`);
      const merged = { ...next[q], ...g };
      if (merged.points === null || merged.points === undefined) delete merged.points;
      if (!merged.feedback?.trim()) delete merged.feedback;
      if (Object.keys(merged).length) next[q] = merged;
      else delete next[q];
    }
    const score = scoreOf(form, r.answers as Answers, next);
    await this.db.update(formResponses).set({ grades: next, score }).where(eq(formResponses.id, r.id));
    this.collab.notify(id, { type: 'responses' });
    return { grades: next, score };
  }

  /** Releases scores ("Release score" in Google Forms) and e-mails each respondent whose address is known. */
  async release(actor: Actor, id: string, ids: string[] | 'all') {
    const { row } = await this.perms.require(actor, id, 'editor');
    const { form } = await this.load(id);
    if (!form.settings.quiz) throw new BadRequestException('This form is not a quiz');
    if (ids !== 'all' && !ids.length) return { released: 0, mailed: 0 };
    const where = and(eq(formResponses.formId, id), isNull(formResponses.releasedAt), ...(ids === 'all' ? [] : [inArray(formResponses.id, ids)]));
    const released = await this.db.update(formResponses).set({ releasedAt: sql`now()` }).where(where).returning();
    let mailed = 0;
    for (const r of released) {
      if (!r.email || !r.score) continue;
      const url = this.webUrl(`/f/${id}?result=${r.editToken}`);
      mailed++;
      await this.mail.send({
        kind: 'form.score',
        to: r.email,
        resourceId: id,
        subject: `Your score for "${form.title}"`,
        text: `Your score for "${form.title}" is ${r.score.points} / ${r.score.max}.\n\nView your score${form.settings.showCorrect ? ' and the correct answers' : ''}: ${url}`,
        html: mailHtml({ title: `Your score for "${form.title}"`, intro: `${r.score.points} / ${r.score.max} points`, button: { label: 'View score', url }, color: form.theme.color }),
      });
    }
    if (released.length) await this.events.emit(this.db, actor, 'form.scores_released', { resourceId: id, spaceId: row.spaceId }, { name: row.name, count: released.length });
    this.collab.notify(id, { type: 'responses' });
    return { released: released.length, mailed };
  }

  /** "View score": what a respondent may see of their graded response (the token is their response's own token). */
  async result(id: string, token: string) {
    const { form } = await this.load(id);
    const [r] = await this.db.select().from(formResponses).where(and(eq(formResponses.formId, id), eq(formResponses.editToken, token)));
    if (!r || !form.settings.quiz) throw new NotFoundException('Response not found');
    const s = form.settings;
    const pub = publicForm(form);
    if (s.releaseScore === 'later' && !r.releasedAt) return { form: pub, released: false as const, score: null, questions: [] };
    const answers = r.answers as Answers;
    const grades = (r.grades ?? {}) as Grades;
    const questions = form.items
      .filter((i) => isQuestion(i.type))
      .map((i) => {
        const max = i.quiz?.points ?? 0;
        const g = grades[i.id];
        const auto = isCorrect(i, answers[i.id]);
        const graded = typeof g?.points === 'number';
        return {
          id: i.id,
          answer: answers[i.id] ?? null,
          points: max ? pointsFor(i, answers[i.id], g) : null,
          max,
          correct: !max ? null : graded ? g!.points! >= max : auto,
          feedback: g?.feedback || (auto === true ? i.quiz?.feedbackCorrect : auto === false ? i.quiz?.feedbackWrong : undefined) || null,
          correctAnswers: s.showCorrect && i.quiz?.answers?.length ? i.quiz.answers : null,
        };
      });
    return { form: pub, released: true as const, score: r.score, questions };
  }


  private receipt(form: PlainForm, id: string, editToken: string, score: { points: number; max: number } | null, released = false) {
    const s = form.settings;
    return {
      id,
      confirmation: s.confirmation,
      editToken: s.allowEdit ? editToken : null,
      score: s.quiz && (s.releaseScore === 'immediately' || released) ? score : null,
      // "View score" link: the response's own token, shown for quizzes (scores released later show once released).
      resultToken: s.quiz ? editToken : null,
      showSummary: s.showSummary,
    };
  }

  async upload(actor: Actor | undefined, id: string, file: Express.Multer.File) {
    const { row, form } = await this.load(id);
    if (!(await this.canRespond(actor, row, form.settings))) throw new ForbiddenException();
    if (this.closedReason(form.settings)) throw new ForbiddenException(this.closedReason(form.settings)!);
    if (!file) throw new BadRequestException('No file');
    const limit = Math.max(...form.items.filter((i) => i.type === 'file').map((i) => i.file?.maxSizeMb ?? 10), 10);
    if (file.size > limit * 1024 * 1024) throw new BadRequestException(`File is larger than ${limit} MB`);
    await this.quota.assertRoom(row.workspaceId, { spaceId: row.spaceId, ownerId: row.ownerId }, file.size);
    const sha = StorageService.sha256(file.buffer);
    const key = await this.storage.putBlob(file.buffer, sha, file.mimetype);
    const [blob] = await this.db
      .insert(blobs)
      .values({ sha256: sha, sizeBytes: file.size, mimeType: file.mimetype, storageKey: key })
      .onConflictDoUpdate({ target: blobs.sha256, set: { sha256: sha } })
      .returning();
    // Registered to the form: its editors download it through /resources/:id/assets/:blobId.
    await this.db.insert(resourceAssets).values({ resourceId: id, blobId: blob.id, createdBy: actor?.id ?? row.ownerId }).onConflictDoNothing();
    return { blobId: blob.id, name: Buffer.from(file.originalname, 'latin1').toString('utf8'), size: file.size, mime: file.mimetype };
  }

  /** Aggregate-only summary respondents may see when "show summary" is on. */
  async publicSummary(actor: Actor | undefined, id: string) {
    const { row, form } = await this.load(id);
    if (!form.settings.showSummary || !(await this.canRespond(actor, row, form.settings))) throw new ForbiddenException('The summary of this form is not shared');
    const rows = await this.db.select({ answers: formResponses.answers }).from(formResponses).where(eq(formResponses.formId, id));
    const counts: Record<string, Record<string, number>> = {};
    for (const it of form.items) {
      if (!['choice', 'checkbox', 'dropdown', 'scale', 'rating'].includes(it.type)) continue;
      const c: Record<string, number> = {};
      for (const r of rows) {
        const a = (r.answers as Answers)[it.id];
        for (const v of Array.isArray(a) ? a : a === undefined || a === null ? [] : [a]) {
          const k = typeof v === 'object' && v && 'other' in v ? 'Other' : String(v);
          c[k] = (c[k] ?? 0) + 1;
        }
      }
      counts[it.id] = c;
    }
    return { total: rows.length, counts };
  }

  // ── Owner side ────────────────────────────────────────────────────────────

  async responses(actor: Actor, id: string) {
    await this.perms.require(actor, id, 'editor');
    const rows = await this.db
      .select({ r: formResponses, name: users.name })
      .from(formResponses)
      .leftJoin(users, eq(users.id, formResponses.respondentId))
      .where(eq(formResponses.formId, id))
      .orderBy(asc(formResponses.submittedAt));
    return rows.map(({ r, name }) => ({ id: r.id, respondent: name ?? null, email: r.email, answers: r.answers, score: r.score, grades: r.grades ?? {}, releasedAt: r.releasedAt, submittedAt: r.submittedAt, updatedAt: r.updatedAt }));
  }

  async deleteResponses(actor: Actor, id: string, ids: string[] | 'all') {
    const { row } = await this.perms.require(actor, id, 'editor');
    if (ids === 'all') await this.db.delete(formResponses).where(eq(formResponses.formId, id));
    else if (ids.length) await this.db.delete(formResponses).where(and(eq(formResponses.formId, id), inArray(formResponses.id, ids)));
    await this.events.emit(this.db, actor, 'form.responses_deleted', { resourceId: id, spaceId: row.spaceId }, { name: row.name, count: ids === 'all' ? 'all' : ids.length });
    this.collab.notify(id, { type: 'responses' });
  }

  async csv(actor: Actor, id: string) {
    const { row } = await this.perms.require(actor, id, 'editor');
    const { form } = await this.load(id);
    const cols = responseColumns(form);
    const rows = await this.db.select().from(formResponses).where(eq(formResponses.formId, id)).orderBy(asc(formResponses.submittedAt));
    const lines = [cols.header, ...rows.map((r) => cols.cells({ submittedAt: r.submittedAt, email: r.email, score: r.score, answers: r.answers as Answers }))].map((l) => l.map(csvCell).join(','));
    return { name: `${row.name} (Responses).csv`, body: Buffer.from(`﻿${lines.join('\r\n')}\r\n`, 'utf8') };
  }

  /** Creates the linked response spreadsheet (next to the form) and fills it with every response so far. */
  async linkSheet(actor: Actor, id: string) {
    const { row } = await this.perms.require(actor, id, 'editor');
    const { form } = await this.load(id);
    const resourcesService = this.moduleRef.get(ResourcesService, { strict: false });
    const sheet = await resourcesService.create(actor, { name: `${row.name} (Responses)`, type: 'spreadsheet', parentId: row.parentId ?? undefined, spaceId: row.parentId ? undefined : row.spaceId ?? undefined });
    const cols = responseColumns(form);
    const rows = await this.db.select().from(formResponses).where(eq(formResponses.formId, id)).orderBy(asc(formResponses.submittedAt));
    await this.sheets.appendRows(sheet.id, [cols.header, ...rows.map((r) => cols.cells({ submittedAt: r.submittedAt, email: r.email, score: r.score, answers: r.answers as Answers }))], { id: actor.id, name: actor.name }, { headerBold: true });
    await this.collab.transact(id, { id: actor.id, name: actor.name }, (doc) => {
      const meta = doc.getMap(FORM_MAP);
      meta.set('settings', { ...(meta.get('settings') as FormSettings), sheetId: sheet.id });
    });
    return sheet;
  }
}
