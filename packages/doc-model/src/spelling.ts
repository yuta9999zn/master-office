// Spelling & grammar (Google Docs: Tools → Spelling and grammar). docs/ARCHITECTURE.md §45.
// Pure text helpers shared by the editor and tests: which words go to the dictionary (server, Hunspell en_US)
// and a few grammar rules that need no dictionary. Offsets are into the string passed in.

export interface TextIssue {
  kind: 'spelling' | 'grammar';
  /** 'spelling' or the grammar rule id. */
  rule: string;
  from: number;
  to: number;
  /** The text that would be replaced. */
  text: string;
  message: string;
  suggestions: string[];
}

/**
 * Only English-looking text is checked: a paragraph with Vietnamese letters, kana, CJK or Hangul is skipped
 * whole (an English dictionary would flag every word of it).
 */
export function isCheckableText(text: string): boolean {
  return !/[ĂăĐđƠơƯưẠ-ỹ぀-ヿ㐀-鿿가-힯]/.test(text);
}

const WORD = /[A-Za-z]+(?:['’][A-Za-z]+)*/g;

/** Words worth looking up: not acronyms, camelCase, parts of URLs / e-mails / file names, or glued to digits. */
export function spellingCandidates(text: string): { from: number; to: number; word: string }[] {
  const out: { from: number; to: number; word: string }[] = [];
  for (const m of text.matchAll(WORD)) {
    const from = m.index!;
    const to = from + m[0].length;
    const word = m[0].replace(/’/g, "'");
    const before = text[from - 1] ?? '';
    const after = text[to] ?? '';
    if (/[\w@/\\#$%&+=~^À-ÿ]/.test(before) || /[\w@À-ÿ]/.test(after)) continue;
    if ((before === '.' || before === ':') && /\w/.test(text[from - 2] ?? '')) continue; // example.com, http:x
    if (/[./:]/.test(after) && /\w/.test(text[to + 1] ?? '')) continue; // example.com, x/y
    if (word.length < 2 || word.length > 40) continue;
    if (word === word.toUpperCase()) continue; // SNS, KPI
    if (/[a-z][A-Z]/.test(word)) continue; // TikTok, iPhone
    out.push({ from, to, word });
  }
  return out;
}

const ABBREVIATIONS = new Set(['e.g', 'i.e', 'etc', 'vs', 'approx', 'mr', 'mrs', 'ms', 'dr', 'no', 'fig', 'inc', 'ltd', 'co', 'st', 'jr', 'sr']);
// "a" before these vowel-letter words ("a user", "a one-off"); "an" before these silent-h words ("an hour").
const A_BEFORE = /^(uni|use|usu|uti|ura|eu|ewe|one|once|ubi)/i;
const AN_BEFORE = /^(hour|honest|honou?r|heir)/i;

/** Rule-based grammar and punctuation checks (repeated word, a/an, capital after a full stop, spacing). */
export function grammarIssues(text: string): TextIssue[] {
  const out: TextIssue[] = [];
  const add = (rule: string, from: number, to: number, message: string, suggestion: string) => out.push({ kind: 'grammar', rule, from, to, text: text.slice(from, to), message, suggestions: [suggestion] });

  for (const m of text.matchAll(/(?<![\w'’])([A-Za-z]+)(\s+)(\1)(?![\w'’])/gi)) {
    if (m[1].toLowerCase() !== m[3].toLowerCase() || /^(had|that|bye|ha|no)$/i.test(m[1])) continue;
    const from = m.index! + m[1].length;
    add('repeated-word', from, from + m[2].length + m[3].length, `Repeated word “${m[3]}”`, '');
  }
  for (const m of text.matchAll(/(?<![\w'’])(a|an|A|An)(\s+)([A-Za-z][\w'’-]*)/g)) {
    const [, art, , next] = m;
    if (next === next.toUpperCase() && next.length > 1) continue; // acronyms: "an FAQ", "a URL" — sound-dependent
    const vowel = (/^[aeiou]/i.test(next) && !A_BEFORE.test(next)) || AN_BEFORE.test(next);
    const want = vowel ? 'an' : 'a';
    if (art.toLowerCase() === want) continue;
    const fixed = art[0] === 'A' ? want[0].toUpperCase() + want.slice(1) : want;
    add('a-an', m.index!, m.index! + art.length, `Use “${fixed}” before “${next}”`, fixed);
  }
  for (const m of text.matchAll(/([A-Za-z.]+)([.!?])(\s+)([a-z])/g)) {
    const word = m[1].replace(/\.$/, '').toLowerCase();
    if (m[2] === '.' && (ABBREVIATIONS.has(word) || word.length === 1 || m[1].includes('.'))) continue;
    const at = m.index! + m[1].length + m[2].length + m[3].length;
    add('capitalize', at, at + 1, 'Start a sentence with a capital letter', m[4].toUpperCase());
  }
  for (const m of text.matchAll(/(?<=\S)( {2,})(?=\S)/g)) add('extra-space', m.index!, m.index! + m[1].length, 'Extra space', ' ');
  for (const m of text.matchAll(/(?<=[A-Za-z)])( +)(?=[,.;:!?](?:\s|$))/g)) add('space-before-punctuation', m.index!, m.index! + m[1].length, 'No space before punctuation', '');
  return out.sort((a, b) => a.from - b.from);
}
