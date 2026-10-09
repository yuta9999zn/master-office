// Document templates (Google Docs' template gallery): a filled-in starting point per kind of document.
// docs/ARCHITECTURE.md §44.
import type { JSONContent } from '@tiptap/core';
import { PROJECT_DOC_TEMPLATES } from './project-templates';

export interface DocTemplate {
  id: string;
  name: string;
  description: string;
  category: 'Work' | 'Personal' | 'Project management';
  build: (title: string) => JSONContent;
}

const t = (text: string, ...marks: string[]): JSONContent => ({ type: 'text', text, ...(marks.length ? { marks: marks.map((type) => ({ type })) } : {}) });
const p = (...content: (JSONContent | string)[]): JSONContent => (content.length ? { type: 'paragraph', content: content.map((c) => (typeof c === 'string' ? t(c) : c)) } : { type: 'paragraph' });
const center = (...content: (JSONContent | string)[]): JSONContent => ({ ...p(...content), attrs: { textAlign: 'center' } });
const h = (level: number, text: string): JSONContent => ({ type: 'heading', attrs: { level }, content: [t(text)] });
const ul = (...items: string[]): JSONContent => ({ type: 'bulletList', content: items.map((i) => ({ type: 'listItem', content: [p(i)] })) });
const ol = (...items: string[]): JSONContent => ({ type: 'orderedList', attrs: { start: 1 }, content: items.map((i) => ({ type: 'listItem', content: [p(i)] })) });
const tasks = (...items: string[]): JSONContent => ({ type: 'taskList', content: items.map((i) => ({ type: 'taskItem', attrs: { checked: false }, content: [p(i)] })) });
const callout = (tone: string, ...content: JSONContent[]): JSONContent => ({ type: 'callout', attrs: { tone }, content });
const hr: JSONContent = { type: 'horizontalRule' };
const table = (head: string[], rows: string[][]): JSONContent => ({
  type: 'table',
  content: [
    { type: 'tableRow', content: head.map((c) => ({ type: 'tableHeader', content: [p(c)] })) },
    ...rows.map((r) => ({ type: 'tableRow', content: r.map((c) => ({ type: 'tableCell', content: [c ? p(c) : { type: 'paragraph' }] })) })),
  ],
});
const doc = (...content: JSONContent[]): JSONContent => ({ type: 'doc', content });

export const DOC_TEMPLATES: DocTemplate[] = [
  {
    id: 'meeting-notes',
    name: 'Meeting notes',
    description: 'Attendees, agenda, decisions and action items',
    category: 'Work',
    build: (title) =>
      doc(
        h(1, title),
        p(t('Date: ', 'bold'), 'Oct 3, 2026 · ', t('Time: ', 'bold'), '10:00–10:45'),
        p(t('Attendees: ', 'bold'), '@name, @name, @name'),
        h(2, 'Agenda'),
        ol('Review last week’s action items', 'Status updates', 'Open questions'),
        h(2, 'Notes'),
        ul('Key point discussed', 'Another point worth recording'),
        h(2, 'Decisions'),
        callout('info', p('What the group agreed on, and why.')),
        h(2, 'Action items'),
        tasks('Owner — task — due date', 'Owner — task — due date'),
      ),
  },
  {
    id: 'project-proposal',
    name: 'Project proposal',
    description: 'Problem, goals, scope, timeline and budget',
    category: 'Project management',
    build: (title) =>
      doc(
        h(1, title),
        p(t('Prepared by ', 'italic'), t('Your name', 'italic', 'bold'), t(' · October 2026', 'italic')),
        callout('info', p(t('Summary. ', 'bold'), 'In two or three sentences: what you propose, for whom, and the outcome you expect.')),
        h(2, '1. Problem'),
        p('Describe the situation today and why it needs to change. Use numbers where you can.'),
        h(2, '2. Goals'),
        ul('Goal one — measurable', 'Goal two — measurable', 'Non-goal: what this project will not do'),
        h(2, '3. Scope'),
        p('What is in and out of scope for the first release.'),
        h(2, '4. Timeline'),
        table(
          ['Phase', 'Deliverable', 'Start', 'End'],
          [
            ['Discovery', 'Research summary', 'Oct 6', 'Oct 17'],
            ['Build', 'First version', 'Oct 20', 'Nov 21'],
            ['Launch', 'Rollout to all branches', 'Nov 24', 'Dec 5'],
          ],
        ),
        h(2, '5. Budget'),
        table(
          ['Item', 'Cost (¥)'],
          [
            ['People', ''],
            ['Tools', ''],
            ['Total', ''],
          ],
        ),
        h(2, '6. Risks'),
        ul('Risk — likelihood — mitigation'),
      ),
  },
  {
    id: 'weekly-report',
    name: 'Weekly report',
    description: 'Highlights, metrics, blockers and next week',
    category: 'Work',
    build: (title) =>
      doc(
        h(1, title),
        p(t('Week of Sep 28 – Oct 2, 2026', 'italic')),
        h(2, 'Highlights'),
        ul('Biggest win of the week', 'Something shipped or decided'),
        h(2, 'Metrics'),
        table(
          ['Metric', 'This week', 'Last week', 'Change'],
          [
            ['Revenue (¥)', '', '', ''],
            ['New customers', '', '', ''],
            ['Return rate', '', '', ''],
          ],
        ),
        h(2, 'Blockers'),
        callout('info', p('What is stuck, and what help you need.')),
        h(2, 'Next week'),
        tasks('Priority one', 'Priority two', 'Priority three'),
      ),
  },
  {
    id: 'product-spec',
    name: 'Product spec',
    description: 'Background, requirements, design and launch plan',
    category: 'Project management',
    build: (title) =>
      doc(
        h(1, title),
        table(
          ['Owner', 'Status', 'Last updated'],
          [['Your name', 'Draft', 'Oct 3, 2026']],
        ),
        h(2, 'Background'),
        p('Why we are building this now. Link to research and prior decisions.'),
        h(2, 'Users and problems'),
        ul('As a … I want … so that …', 'As a … I want … so that …'),
        h(2, 'Requirements'),
        table(
          ['#', 'Requirement', 'Priority', 'Notes'],
          [
            ['1', '', 'Must', ''],
            ['2', '', 'Should', ''],
            ['3', '', 'Could', ''],
          ],
        ),
        h(2, 'Design'),
        p('Screens, flows and open design questions.'),
        h(2, 'Launch plan'),
        tasks('Internal review', 'Pilot with one branch', 'Rollout'),
        h(2, 'Open questions'),
        ul('Question — owner'),
      ),
  },
  {
    id: 'business-letter',
    name: 'Business letter',
    description: 'A formal letter with sender, recipient and signature',
    category: 'Work',
    build: () =>
      doc(
        p(t('Sakura Beauty Co., Ltd.', 'bold')),
        p('1-2-3 Shibuya, Shibuya-ku, Tokyo 150-0002'),
        p('+81 3-1234-5678 · hello@example.com'),
        hr,
        p('October 3, 2026'),
        p('Recipient name'),
        p('Company'),
        p('Address'),
        p(),
        p('Dear Recipient,'),
        p('Open with the purpose of the letter in one sentence. Then give the details the reader needs, in the order they need them.'),
        p('Close with the next step you would like the reader to take, and how to reach you.'),
        p('Sincerely,'),
        p(),
        p(t('Your name', 'bold')),
        p('Title'),
      ),
  },
  {
    id: 'resume',
    name: 'Resume',
    description: 'Experience, education and skills on one page',
    category: 'Personal',
    build: () =>
      doc(
        { type: 'heading', attrs: { level: 1, textAlign: 'center' }, content: [t('Your Name')] },
        center('Tokyo, Japan · you@example.com · +81 90-0000-0000'),
        hr,
        h(2, 'Summary'),
        p('Two lines about what you do best and what you are looking for.'),
        h(2, 'Experience'),
        p(t('Job title', 'bold'), ' — Company · 2023 – present'),
        ul('Achievement with a number in it', 'Another achievement'),
        p(t('Job title', 'bold'), ' — Company · 2020 – 2023'),
        ul('Achievement with a number in it'),
        h(2, 'Education'),
        p(t('Degree', 'bold'), ' — University · 2020'),
        h(2, 'Skills'),
        p('Skill · Skill · Skill · Language (level)'),
      ),
  },
];

/** The template's document, or null for a blank document / an unknown id. */
export function templateDocument(id: string | null | undefined, title: string): JSONContent | null {
  // Project documentation templates (pd-…) are made the same way (§76).
  const tpl = DOC_TEMPLATES.find((x) => x.id === id) ?? PROJECT_DOC_TEMPLATES.find((x) => x.id === id);
  return tpl ? tpl.build(title) : null;
}
