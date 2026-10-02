// Form model shared by the form builder, the respondent page and the server (validation, scoring, reports).
// docs/ARCHITECTURE.md §25 — the form definition is a Yjs document (built together in realtime, versioned like
// every file); responses are rows in Postgres.
//
// Yjs layout (created by the server; clients never create the top-level containers):
//   Y.Map   'form'       title, description, theme, settings
//   Y.Array 'itemOrder'  itemId[]  (readers dedupe)
//   Y.Map   'items'      itemId → Y.Map { type, title, description, required, options, … }  (one key per property)
import * as Y from 'yjs';

export const FORM_MAP = 'form';
export const ORDER_ARRAY = 'itemOrder';
export const ITEMS_MAP = 'items';

export const QUESTION_TYPES = ['short', 'paragraph', 'choice', 'checkbox', 'dropdown', 'file', 'scale', 'rating', 'choiceGrid', 'checkboxGrid', 'date', 'time'] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];
export type ItemType = QuestionType | 'section' | 'text' | 'image' | 'video';

export const TYPE_LABEL: Record<ItemType, string> = {
  short: 'Short answer',
  paragraph: 'Paragraph',
  choice: 'Multiple choice',
  checkbox: 'Checkboxes',
  dropdown: 'Dropdown',
  file: 'File upload',
  scale: 'Linear scale',
  rating: 'Rating',
  choiceGrid: 'Multiple choice grid',
  checkboxGrid: 'Checkbox grid',
  date: 'Date',
  time: 'Time',
  section: 'Section',
  text: 'Title and description',
  image: 'Image',
  video: 'Video',
};

/** Where to go next: a section id, 'submit', or null (= the next section). */
export type GoTo = string | null;

export interface FormOption {
  id: string;
  label: string;
  goTo?: GoTo;
}

export interface Validation {
  kind: 'number' | 'text' | 'length' | 'regex' | 'count';
  op: string; // number: gt gte lt lte eq neq between notBetween isNumber whole · text: contains notContains email url · length: max min · regex: matches notMatches · count: atLeast atMost exactly
  value?: string | number;
  value2?: string | number;
  message?: string;
}

export interface FormItem {
  id: string;
  type: ItemType;
  title: string;
  description?: string;
  required?: boolean;
  options?: FormOption[];
  other?: boolean;
  shuffle?: boolean;
  branching?: boolean; // choice / dropdown: "Go to section based on answer"
  validation?: Validation | null;
  scale?: { min: number; max: number; minLabel?: string; maxLabel?: string };
  rating?: { max: number; icon: 'star' | 'heart' | 'thumb' };
  grid?: { rows: string[]; cols: string[]; oneAnswerPerColumn?: boolean };
  file?: { maxFiles: number; maxSizeMb: number; types?: string[] };
  date?: { includeTime?: boolean };
  after?: GoTo; // section: where to go after this section
  image?: { src: string; alt?: string } | null;
  video?: { url: string } | null;
  quiz?: { points: number; answers?: string[]; feedbackCorrect?: string; feedbackWrong?: string } | null;
}

export interface FormTheme {
  color: string;
  background: string;
  font: string;
  header?: string | null;
}

export interface FormSettings {
  access: 'org' | 'public'; // who can respond: people in the workspace, or anyone with the link
  collectEmail: 'off' | 'verified' | 'input';
  limitOne: boolean;
  allowEdit: boolean;
  showSummary: boolean;
  progressBar: boolean;
  shuffle: boolean;
  confirmation: string;
  accepting: boolean;
  closedMessage: string;
  closesAt: string | null;
  quiz: boolean;
  releaseScore: 'immediately' | 'later';
  showCorrect: boolean;
  notify: boolean;
  sheetId: string | null; // linked response spreadsheet
}

export interface PlainForm {
  title: string;
  description: string;
  theme: FormTheme;
  settings: FormSettings;
  items: FormItem[];
}

export const DEFAULT_THEME: FormTheme = { color: '#4F46E5', background: '#EEF2FF', font: 'Inter', header: null };
export const DEFAULT_SETTINGS: FormSettings = {
  access: 'org',
  collectEmail: 'verified',
  limitOne: false,
  allowEdit: false,
  showSummary: false,
  progressBar: true,
  shuffle: false,
  confirmation: 'Your response has been recorded.',
  accepting: true,
  closedMessage: 'This form is no longer accepting responses.',
  closesAt: null,
  quiz: false,
  releaseScore: 'immediately',
  showCorrect: true,
  notify: false,
  sheetId: null,
};
export const THEME_COLORS = ['#4F46E5', '#2563EB', '#0891B2', '#059669', '#65A30D', '#CA8A04', '#EA580C', '#DC2626', '#DB2777', '#7C3AED', '#475569', '#F28B9B'];

let counter = 0;
const prefix = Math.random().toString(36).slice(2, 7);
export const newId = () => `${prefix}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;

export const isQuestion = (t: ItemType): t is QuestionType => (QUESTION_TYPES as readonly string[]).includes(t);

/** A fresh question of a type, with sensible defaults (like Google Forms). */
export function newItem(type: ItemType, title = ''): FormItem {
  const base: FormItem = { id: newId(), type, title: title || (type === 'section' ? 'Untitled section' : type === 'text' || type === 'image' || type === 'video' ? '' : 'Untitled question') };
  if (type === 'choice' || type === 'checkbox' || type === 'dropdown') base.options = [{ id: newId(), label: 'Option 1' }];
  if (type === 'scale') base.scale = { min: 1, max: 5 };
  if (type === 'rating') base.rating = { max: 5, icon: 'star' };
  if (type === 'choiceGrid' || type === 'checkboxGrid') base.grid = { rows: ['Row 1'], cols: ['Column 1'] };
  if (type === 'file') base.file = { maxFiles: 1, maxSizeMb: 10 };
  return base;
}

// ── Yjs ⇄ plain ──────────────────────────────────────────────────────────────

const ITEM_KEYS = ['type', 'title', 'description', 'required', 'options', 'other', 'shuffle', 'branching', 'validation', 'scale', 'rating', 'grid', 'file', 'date', 'after', 'image', 'video', 'quiz'] as const;

export function createYItem(item: FormItem): Y.Map<unknown> {
  const m = new Y.Map<unknown>();
  for (const k of ITEM_KEYS) if (item[k] !== undefined && item[k] !== null) m.set(k, item[k]);
  return m;
}

export function readItem(id: string, m: Y.Map<unknown>): FormItem {
  const it = { id, type: 'short', title: '' } as FormItem;
  for (const k of ITEM_KEYS) {
    const v = m.get(k);
    if (v !== undefined) (it as unknown as Record<string, unknown>)[k] = v;
  }
  return it;
}

export function itemIds(doc: Y.Doc): string[] {
  const items = doc.getMap(ITEMS_MAP);
  const seen = new Set<string>();
  return doc
    .getArray<string>(ORDER_ARRAY)
    .toArray()
    .filter((id) => items.has(id) && !seen.has(id) && seen.add(id));
}

export function writeForm(doc: Y.Doc, f: PlainForm) {
  doc.transact(() => {
    const meta = doc.getMap(FORM_MAP);
    meta.set('title', f.title);
    meta.set('description', f.description);
    meta.set('theme', f.theme);
    meta.set('settings', f.settings);
    const items = doc.getMap<Y.Map<unknown>>(ITEMS_MAP);
    for (const it of f.items) items.set(it.id, createYItem(it));
    doc.getArray<string>(ORDER_ARRAY).push(f.items.map((i) => i.id));
  });
}

export const hasForm = (doc: Y.Doc) => doc.getMap(FORM_MAP).has('settings');

export function readForm(doc: Y.Doc): PlainForm {
  const meta = doc.getMap(FORM_MAP);
  const items = doc.getMap<Y.Map<unknown>>(ITEMS_MAP);
  return {
    title: (meta.get('title') as string) ?? 'Untitled form',
    description: (meta.get('description') as string) ?? '',
    theme: { ...DEFAULT_THEME, ...((meta.get('theme') as FormTheme) ?? {}) },
    settings: { ...DEFAULT_SETTINGS, ...((meta.get('settings') as FormSettings) ?? {}) },
    items: itemIds(doc).map((id) => readItem(id, items.get(id)!)),
  };
}

export function blankForm(name: string): PlainForm {
  const q = newItem('choice', 'Untitled question');
  return { title: name.replace(/\.(form)$/i, ''), description: '', theme: DEFAULT_THEME, settings: DEFAULT_SETTINGS, items: [q] };
}

export function formText(f: PlainForm): string {
  return [f.title, f.description, ...f.items.flatMap((i) => [i.title, i.description ?? '', ...(i.options ?? []).map((o) => o.label)])].filter(Boolean).join('\n');
}

// ── Pages (sections) & branching ─────────────────────────────────────────────

export interface FormPage {
  id: string | null; // section item id (null = the first page before any section)
  section: FormItem | null;
  items: FormItem[];
}

/** Splits the items into pages at each section item. */
export function pagesOf(f: PlainForm): FormPage[] {
  const pages: FormPage[] = [{ id: null, section: null, items: [] }];
  for (const it of f.items) {
    if (it.type === 'section') pages.push({ id: it.id, section: it, items: [] });
    else pages[pages.length - 1].items.push(it);
  }
  // A form that starts with a section has no empty first page.
  return pages[0].items.length || pages.length === 1 ? pages : pages.slice(1);
}

export type Answer = string | number | string[] | { other: string } | (string | { other: string })[] | Record<string, string | string[]> | FileAnswer[] | null;
export interface FileAnswer {
  blobId: string;
  name: string;
  size: number;
  mime: string;
}
export type Answers = Record<string, Answer>;

/** Index of the page that follows `index` given the answers (branching), or -1 to submit. */
export function nextPage(f: PlainForm, pages: FormPage[], index: number, answers: Answers): number {
  const page = pages[index];
  let goTo: GoTo | undefined;
  // The last branching question answered on the page decides (like Google Forms).
  for (const it of page.items) {
    if (!it.branching || (it.type !== 'choice' && it.type !== 'dropdown')) continue;
    const a = answers[it.id];
    if (typeof a !== 'string') continue;
    const opt = it.options?.find((o) => o.label === a);
    if (opt?.goTo !== undefined && opt.goTo !== null) goTo = opt.goTo;
  }
  if (goTo === undefined && page.section?.after) goTo = page.section.after;
  if (goTo === 'submit') return -1;
  if (goTo) {
    const target = pages.findIndex((p) => p.id === goTo);
    if (target >= 0) return target;
  }
  return index + 1 < pages.length ? index + 1 : -1;
}

/** Pages a respondent actually visited for these answers (used to ignore answers on skipped pages). */
export function visitedPages(f: PlainForm, answers: Answers): number[] {
  const pages = pagesOf(f);
  const seen: number[] = [];
  for (let i = 0; i >= 0 && seen.length <= pages.length; i = nextPage(f, pages, i, answers)) {
    if (seen.includes(i)) break;
    seen.push(i);
  }
  return seen;
}

// ── Validation ───────────────────────────────────────────────────────────────

const isEmpty = (a: Answer | undefined) =>
  a === null || a === undefined || a === '' || (Array.isArray(a) && a.length === 0) || (typeof a === 'object' && !Array.isArray(a) && !('other' in (a as object)) && Object.keys(a as object).length === 0);

/** Error message for an answer, or null when it is acceptable. */
export function validateAnswer(it: FormItem, a: Answer | undefined): string | null {
  if (!isQuestion(it.type)) return null;
  if (isEmpty(a)) return it.required ? 'This is a required question' : null;
  const labels = new Set((it.options ?? []).map((o) => o.label));
  switch (it.type) {
    case 'short':
    case 'paragraph': {
      if (typeof a !== 'string') return 'Invalid answer';
      return checkText(it.validation, a);
    }
    case 'choice':
    case 'dropdown':
      if (typeof a === 'string') return labels.has(a) ? null : 'Choose one of the options';
      if (it.type === 'choice' && it.other && a && typeof a === 'object' && 'other' in a) return (a as { other: string }).other.trim() ? null : 'Please fill in "Other"';
      return 'Choose one of the options';
    case 'checkbox': {
      if (!Array.isArray(a)) return 'Invalid answer';
      for (const x of a as (string | { other: string })[]) {
        if (typeof x === 'string' ? !labels.has(x) : !(it.other && x?.other?.trim())) return 'Choose from the options';
      }
      const v = it.validation;
      if (v?.kind === 'count') {
        const n = a.length;
        const k = Number(v.value);
        if ((v.op === 'atLeast' && n < k) || (v.op === 'atMost' && n > k) || (v.op === 'exactly' && n !== k)) return v.message || `Select ${v.op === 'atLeast' ? 'at least' : v.op === 'atMost' ? 'at most' : 'exactly'} ${k}`;
      }
      return null;
    }
    case 'scale': {
      const s = it.scale ?? { min: 1, max: 5 };
      return typeof a === 'number' && Number.isInteger(a) && a >= s.min && a <= s.max ? null : 'Choose a value on the scale';
    }
    case 'rating':
      return typeof a === 'number' && Number.isInteger(a) && a >= 1 && a <= (it.rating?.max ?? 5) ? null : 'Choose a rating';
    case 'choiceGrid':
    case 'checkboxGrid': {
      if (typeof a !== 'object' || Array.isArray(a) || a === null) return 'Invalid answer';
      const g = it.grid ?? { rows: [], cols: [] };
      const ans = a as Record<string, string | string[]>;
      for (const [row, v] of Object.entries(ans)) {
        if (!g.rows.includes(row)) return 'Invalid row';
        const vals = Array.isArray(v) ? v : [v];
        if (vals.some((c) => !g.cols.includes(c))) return 'Invalid column';
      }
      if (it.required && g.rows.some((r) => isEmpty(ans[r] as Answer))) return 'This question requires one response per row';
      if (g.oneAnswerPerColumn) {
        const used = Object.values(ans).flat();
        if (new Set(used).size !== used.length) return 'Please don’t select more than one response per column';
      }
      return null;
    }
    case 'date':
      return typeof a === 'string' && /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/.test(a) ? null : 'Enter a valid date';
    case 'time':
      return typeof a === 'string' && /^\d{2}:\d{2}$/.test(a) ? null : 'Enter a valid time';
    case 'file': {
      if (!Array.isArray(a)) return 'Invalid answer';
      if (a.length > (it.file?.maxFiles ?? 1)) return `Upload at most ${it.file?.maxFiles ?? 1} file(s)`;
      return (a as FileAnswer[]).every((x) => x && typeof x.blobId === 'string') ? null : 'Invalid file';
    }
  }
  return null;
}

function checkText(v: Validation | null | undefined, s: string): string | null {
  if (!v) return null;
  const msg = (fallback: string) => v.message || fallback;
  if (v.kind === 'number') {
    const n = Number(s.trim());
    if (!s.trim() || !Number.isFinite(n)) return msg('Must be a number');
    const a = Number(v.value);
    const b = Number(v.value2);
    const ok =
      v.op === 'isNumber' ||
      (v.op === 'whole' && Number.isInteger(n)) ||
      (v.op === 'gt' && n > a) ||
      (v.op === 'gte' && n >= a) ||
      (v.op === 'lt' && n < a) ||
      (v.op === 'lte' && n <= a) ||
      (v.op === 'eq' && n === a) ||
      (v.op === 'neq' && n !== a) ||
      (v.op === 'between' && n >= a && n <= b) ||
      (v.op === 'notBetween' && (n < a || n > b));
    return ok ? null : msg(`Must be a number ${v.op === 'between' ? `between ${a} and ${b}` : v.op} ${v.op === 'between' ? '' : a}`.trim());
  }
  if (v.kind === 'text') {
    if (v.op === 'contains') return s.includes(String(v.value ?? '')) ? null : msg(`Must contain "${v.value}"`);
    if (v.op === 'notContains') return !s.includes(String(v.value ?? '')) ? null : msg(`Must not contain "${v.value}"`);
    if (v.op === 'email') return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim()) ? null : msg('Must be an email address');
    if (v.op === 'url') return /^https?:\/\/\S+$/i.test(s.trim()) ? null : msg('Must be a URL');
  }
  if (v.kind === 'length') {
    const n = Number(v.value);
    if (v.op === 'max' && s.length > n) return msg(`Must be at most ${n} characters`);
    if (v.op === 'min' && s.length < n) return msg(`Must be at least ${n} characters`);
  }
  if (v.kind === 'regex') {
    let re: RegExp;
    try {
      re = new RegExp(String(v.value ?? ''));
    } catch {
      return null;
    }
    const m = re.test(s);
    if ((v.op === 'matches' && !m) || (v.op === 'notMatches' && m)) return msg('Invalid format');
  }
  return null;
}

// ── Quiz ─────────────────────────────────────────────────────────────────────

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

/** Whether an answer matches the answer key (choices: exact set; text: any accepted answer, case-insensitive). */
export function isCorrect(it: FormItem, a: Answer | undefined): boolean | null {
  const key = it.quiz?.answers;
  if (!key?.length || isEmpty(a)) return key?.length ? false : null;
  if (it.type === 'checkbox' && Array.isArray(a)) {
    const got = (a as (string | { other: string })[]).filter((x): x is string => typeof x === 'string');
    return got.length === a.length && got.length === key.length && key.every((k) => got.includes(k));
  }
  if (typeof a === 'string') return key.some((k) => norm(k) === norm(a));
  if (typeof a === 'number') return key.some((k) => Number(k) === a);
  return false;
}

export function scoreOf(f: PlainForm, answers: Answers): { points: number; max: number } {
  let points = 0;
  let max = 0;
  for (const it of f.items) {
    const p = it.quiz?.points ?? 0;
    if (!isQuestion(it.type) || !p) continue;
    max += p;
    if (isCorrect(it, answers[it.id])) points += p;
  }
  return { points, max };
}

/** What respondents may see: no answer keys. */
export function publicForm(f: PlainForm): PlainForm {
  return { ...f, settings: { ...f.settings, sheetId: null }, items: f.items.map((it) => (it.quiz ? { ...it, quiz: { points: it.quiz.points } } : it)) };
}

/** Text of an answer for CSV / Sheets / lists. */
export function answerText(it: FormItem, a: Answer | undefined): string {
  if (isEmpty(a)) return '';
  if (typeof a === 'string' || typeof a === 'number') return String(a);
  if (Array.isArray(a)) {
    return (a as unknown[])
      .map((x) => (typeof x === 'string' ? x : x && typeof x === 'object' && 'other' in x ? `Other: ${(x as { other: string }).other}` : x && typeof x === 'object' && 'name' in x ? (x as FileAnswer).name : ''))
      .filter(Boolean)
      .join(', ');
  }
  if (a && typeof a === 'object' && 'other' in a) return `Other: ${(a as { other: string }).other}`;
  if (a && typeof a === 'object') {
    return Object.entries(a as Record<string, string | string[]>)
      .map(([r, v]) => `${r}: ${Array.isArray(v) ? v.join(', ') : v}`)
      .join('; ');
  }
  return '';
}

/** Spreadsheet header + one row per response (Timestamp, Email, Score, then one column per question / grid row). */
export function responseColumns(f: PlainForm): { header: string[]; cells: (r: { submittedAt: string; email: string | null; score: { points: number; max: number } | null; answers: Answers }) => (string | number)[] } {
  const qs = f.items.filter((i) => isQuestion(i.type));
  const header = ['Timestamp', ...(f.settings.collectEmail !== 'off' ? ['Email address'] : []), ...(f.settings.quiz ? ['Score'] : [])];
  for (const q of qs) {
    if ((q.type === 'choiceGrid' || q.type === 'checkboxGrid') && q.grid) for (const row of q.grid.rows) header.push(`${q.title} [${row}]`);
    else header.push(q.title);
  }
  return {
    header,
    cells: (r) => {
      const out: (string | number)[] = [r.submittedAt.replace('T', ' ').slice(0, 19)];
      if (f.settings.collectEmail !== 'off') out.push(r.email ?? '');
      if (f.settings.quiz) out.push(r.score ? `${r.score.points} / ${r.score.max}` : '');
      for (const q of qs) {
        const a = r.answers[q.id];
        if ((q.type === 'choiceGrid' || q.type === 'checkboxGrid') && q.grid) {
          for (const row of q.grid.rows) {
            const v = (a as Record<string, string | string[]> | undefined)?.[row];
            out.push(Array.isArray(v) ? v.join(', ') : v ?? '');
          }
        } else out.push(typeof a === 'number' ? a : answerText(q, a));
      }
      return out;
    },
  };
}
