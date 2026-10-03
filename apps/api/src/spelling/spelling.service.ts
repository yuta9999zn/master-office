import { Injectable, Logger } from '@nestjs/common';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import nspell from 'nspell';
import type { Actor } from '../common/current-user';
import type { Db } from '../db/client';
import { InjectDb } from '../db/db.module';
import { userDictionary } from '../db/schema';

type Speller = { correct(word: string): boolean; suggest(word: string): string[] };

/** Spelling: Hunspell en_US (dictionary-en) through nspell, plus each person's dictionary. docs/ARCHITECTURE.md §45. */
@Injectable()
export class SpellingService {
  private readonly log = new Logger(SpellingService.name);
  private speller: Speller | null = null;
  private readonly suggestions = new Map<string, string[]>();

  constructor(@InjectDb() private readonly db: Db) {}

  /** Loaded on first use (~1 s): dictionary-en is ESM-only, so its two files are read directly. */
  private get spell(): Speller {
    if (!this.speller) {
      const dir = dirname(require.resolve('dictionary-en'));
      const started = Date.now();
      this.speller = nspell({ aff: readFileSync(join(dir, 'index.aff')), dic: readFileSync(join(dir, 'index.dic')) }) as Speller;
      this.log.log(`en_US dictionary loaded in ${Date.now() - started} ms`);
    }
    return this.speller;
  }

  /** Misspelled words among `words`, each with up to 5 suggestions (suggestions only for the first 60 — they are slow). */
  async check(actor: Actor, words: string[]) {
    const unique = [...new Set(words)];
    const personal = new Set((await this.dictionary(actor)).map((w) => w.toLowerCase()));
    const misspelled: Record<string, string[]> = {};
    let suggested = 0;
    for (const w of unique) {
      if (personal.has(w.toLowerCase()) || this.spell.correct(w)) continue;
      let s = this.suggestions.get(w);
      if (!s && suggested < 60) {
        suggested++;
        s = this.suggest(w);
        if (this.suggestions.size > 5000) this.suggestions.clear();
        this.suggestions.set(w, s);
      }
      misspelled[w] = s ?? [];
    }
    return { misspelled };
  }

  /**
   * nspell misses the commonest typo — two letters swapped ("teh" → "the") — and does not rank by closeness.
   * Swapped-letter words come first, then everything by edit distance (Damerau), keeping nspell's order on ties.
   */
  private suggest(word: string): string[] {
    const swaps: string[] = [];
    for (let i = 0; i < word.length - 1; i++) {
      const c = word.slice(0, i) + word[i + 1] + word[i] + word.slice(i + 2);
      if (c !== word && this.spell.correct(c)) swaps.push(c);
    }
    const all = [...new Set([...swaps, ...this.spell.suggest(word)])];
    const lower = word.toLowerCase();
    return all
      .map((s, i) => ({ s, i, d: distance(lower, s.toLowerCase()) }))
      .sort((a, b) => a.d - b.d || a.i - b.i)
      .slice(0, 5)
      .map((x) => x.s);
  }

  async dictionary(actor: Actor) {
    const rows = await this.db.select({ word: userDictionary.word }).from(userDictionary).where(eq(userDictionary.userId, actor.id)).orderBy(asc(userDictionary.word));
    return rows.map((r) => r.word);
  }

  async add(actor: Actor, word: string) {
    await this.db.insert(userDictionary).values({ userId: actor.id, word }).onConflictDoNothing();
    return this.dictionary(actor);
  }

  async remove(actor: Actor, words: string[]) {
    await this.db.delete(userDictionary).where(and(eq(userDictionary.userId, actor.id), inArray(userDictionary.word, words)));
    return this.dictionary(actor);
  }
}

/** Optimal string alignment distance (Levenshtein + adjacent transposition). */
function distance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  return d[a.length][b.length];
}
