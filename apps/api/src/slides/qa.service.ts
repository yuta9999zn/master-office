import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import type { Actor } from '../common/current-user';
import type { Db } from '../db/client';
import { InjectDb } from '../db/db.module';
import { qaQuestions, qaSessions, qaVotes, resources } from '../db/schema';
import { PermissionsService } from '../permissions/permissions.service';

// Audience Q&A (Google Slides: Presenter view ▸ Audience tools). docs/ARCHITECTURE.md §55.
// The presenter starts a session for a presentation; anyone with the short link can ask and upvote while it is
// open; the presenter sees the questions by votes and puts one on the big screen. One open session per deck.

const MAX_QUESTION = 300;

@Injectable()
export class QaService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly perms: PermissionsService,
  ) {}

  private async requireDeck(actor: Actor, id: string, role: 'viewer' | 'editor') {
    const { row } = await this.perms.require(actor, id, role);
    if (row.type !== 'presentation') throw new BadRequestException('Q&A belongs to presentations');
    return row;
  }

  private open(resourceId: string) {
    return this.db
      .select()
      .from(qaSessions)
      .where(and(eq(qaSessions.resourceId, resourceId), isNull(qaSessions.endedAt)))
      .orderBy(desc(qaSessions.startedAt))
      .limit(1)
      .then((r) => r[0] ?? null);
  }

  private questions(sessionId: string, opts: { all: boolean; voter?: string | null }) {
    return this.db
      .select({
        id: qaQuestions.id,
        text: qaQuestions.text,
        authorName: qaQuestions.authorName,
        votes: qaQuestions.votes,
        hidden: qaQuestions.hidden,
        createdAt: qaQuestions.createdAt,
        voted: opts.voter ? sql<boolean>`exists (select 1 from ${qaVotes} v where v.question_id = ${qaQuestions.id} and v.voter = ${opts.voter})` : sql<boolean>`false`,
      })
      .from(qaQuestions)
      .where(and(eq(qaQuestions.sessionId, sessionId), opts.all ? undefined : eq(qaQuestions.hidden, false)))
      .orderBy(desc(qaQuestions.votes), qaQuestions.createdAt);
  }

  /** Presenter: start (or keep) the open session of a presentation. */
  async start(actor: Actor, resourceId: string) {
    await this.requireDeck(actor, resourceId, 'editor');
    // A new session replaces an open one (Google: "Start new").
    await this.db.update(qaSessions).set({ endedAt: sql`now()` }).where(and(eq(qaSessions.resourceId, resourceId), isNull(qaSessions.endedAt)));
    const [s] = await this.db
      .insert(qaSessions)
      .values({ resourceId, token: randomBytes(6).toString('base64url'), startedBy: actor.id })
      .returning();
    return this.state(actor, resourceId, s);
  }

  async end(actor: Actor, resourceId: string) {
    await this.requireDeck(actor, resourceId, 'editor');
    await this.db.update(qaSessions).set({ endedAt: sql`now()`, presenting: null }).where(and(eq(qaSessions.resourceId, resourceId), isNull(qaSessions.endedAt)));
  }

  /** The open session with every question (presenter view, slide show banner). */
  async state(actor: Actor, resourceId: string, known?: typeof qaSessions.$inferSelect) {
    await this.requireDeck(actor, resourceId, 'viewer');
    const s = known ?? (await this.open(resourceId));
    if (!s) return { session: null, questions: [] };
    const questions = await this.questions(s.id, { all: true });
    return { session: { id: s.id, token: s.token, startedAt: s.startedAt, presenting: s.presenting }, questions };
  }

  async moderate(actor: Actor, questionId: string, patch: { presenting?: boolean; hidden?: boolean }) {
    const [q] = await this.db.select({ q: qaQuestions, s: qaSessions }).from(qaQuestions).innerJoin(qaSessions, eq(qaSessions.id, qaQuestions.sessionId)).where(eq(qaQuestions.id, questionId));
    if (!q) throw new NotFoundException('Question not found');
    await this.requireDeck(actor, q.s.resourceId, 'editor');
    if (patch.hidden !== undefined) await this.db.update(qaQuestions).set({ hidden: patch.hidden }).where(eq(qaQuestions.id, questionId));
    if (patch.presenting !== undefined || patch.hidden)
      await this.db
        .update(qaSessions)
        .set({ presenting: patch.presenting && !patch.hidden ? questionId : null })
        .where(and(eq(qaSessions.id, q.s.id), patch.presenting ? sql`true` : eq(qaSessions.presenting, questionId)));
  }

  // ── Audience (link only, no share needed) ───────────────────────────────

  private async byToken(token: string) {
    const [s] = await this.db.select({ s: qaSessions, title: resources.name }).from(qaSessions).innerJoin(resources, eq(resources.id, qaSessions.resourceId)).where(eq(qaSessions.token, token));
    if (!s) throw new NotFoundException('This Q&A link does not exist');
    return s;
  }

  async audience(token: string, voter: string | null) {
    const { s, title } = await this.byToken(token);
    const open = !s.endedAt;
    return { title, open, questions: open ? await this.questions(s.id, { all: false, voter }) : [] };
  }

  async ask(token: string, actor: Actor | undefined, voter: string, input: { text: string; anonymous: boolean }) {
    const { s } = await this.byToken(token);
    if (s.endedAt) throw new ForbiddenException('This Q&A session has ended');
    const text = input.text.trim().slice(0, MAX_QUESTION);
    if (!text) throw new BadRequestException('Type a question');
    const [{ n }] = await this.db.select({ n: sql<number>`count(*)::int` }).from(qaQuestions).where(and(eq(qaQuestions.sessionId, s.id), eq(qaQuestions.voter, voter)));
    if (n >= 20) throw new ForbiddenException('You have asked 20 questions in this session');
    await this.db.insert(qaQuestions).values({ sessionId: s.id, text, voter, authorId: input.anonymous ? null : actor?.id ?? null, authorName: input.anonymous || !actor ? null : actor.name });
  }

  /** Toggles this person's vote. */
  async vote(token: string, questionId: string, voter: string) {
    const { s } = await this.byToken(token);
    if (s.endedAt) throw new ForbiddenException('This Q&A session has ended');
    const [q] = await this.db.select({ id: qaQuestions.id }).from(qaQuestions).where(and(eq(qaQuestions.id, questionId), eq(qaQuestions.sessionId, s.id)));
    if (!q) throw new NotFoundException('Question not found');
    await this.db.transaction(async (tx) => {
      const removed = await tx.delete(qaVotes).where(and(eq(qaVotes.questionId, questionId), eq(qaVotes.voter, voter))).returning();
      if (!removed.length) await tx.insert(qaVotes).values({ questionId, voter });
      await tx.update(qaQuestions).set({ votes: sql`${qaQuestions.votes} + ${removed.length ? -1 : 1}` }).where(eq(qaQuestions.id, questionId));
    });
  }
}
