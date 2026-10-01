import { TiptapTransformer } from '@hocuspocus/transformer';
import { COLLAB_FIELD, docExtensions, toPlainText, type JSONContent } from '@workos/doc-model';
import * as Y from 'yjs';

// Small builders so seed documents read like documents.
const t = (text: string, ...marks: string[]): JSONContent => ({ type: 'text', text, ...(marks.length ? { marks: marks.map((type) => ({ type })) } : {}) });
const p = (...content: (JSONContent | string)[]): JSONContent => ({ type: 'paragraph', content: content.map((c) => (typeof c === 'string' ? t(c) : c)) });
const h = (level: number, text: string): JSONContent => ({ type: 'heading', attrs: { level }, content: [t(text)] });
const ul = (...items: string[]): JSONContent => ({ type: 'bulletList', content: items.map((i) => ({ type: 'listItem', content: [p(i)] })) });
const ol = (...items: string[]): JSONContent => ({ type: 'orderedList', attrs: { start: 1 }, content: items.map((i) => ({ type: 'listItem', content: [p(i)] })) });
const tasks = (...items: [string, boolean][]): JSONContent => ({
  type: 'taskList',
  content: items.map(([text, checked]) => ({ type: 'taskItem', attrs: { checked }, content: [p(text)] })),
});
const callout = (...content: JSONContent[]): JSONContent => ({ type: 'callout', attrs: { tone: 'info' }, content });
const table = (head: string[], rows: string[][]): JSONContent => ({
  type: 'table',
  content: [
    { type: 'tableRow', content: head.map((c) => ({ type: 'tableHeader', content: [p(c)] })) },
    ...rows.map((r) => ({ type: 'tableRow', content: r.map((c) => ({ type: 'tableCell', content: [p(c)] })) })),
  ],
});

export const SEED_DOCS: Record<string, JSONContent> = {
  'Branch Operation Plan - October 2026': {
    type: 'doc',
    content: [
      p('This document outlines the key operation plan, targets, and action items for all Natural Beauty branches in October 2026.'),
      h(2, '1. Overview'),
      p(
        'In October 2026, we will focus on improving customer experience, increasing repeat customers, and optimizing branch operations. Each branch will follow the unified guidelines while customizing activities based on local customer trends.',
      ),
      callout(
        p(t('Key Goals', 'bold')),
        ul(
          'Increase total revenue by 15% compared to September 2026',
          'Maintain customer return rate above 70%',
          'Improve operational efficiency and reduce waiting time',
          'Strengthen staff training and service quality',
        ),
      ),
      h(2, '2. Branch Targets'),
      table(
        ['Branch', 'Monthly Revenue Target (¥)', 'New Customers', 'Repeat Rate', 'Key Focus'],
        [
          ['575 (Main)', '2,000,000', '150', '70%', 'Wax / Facial'],
          ['625 (Station)', '1,500,000', '120', '68%', 'Body Care / Underarm'],
          ['S2 (New)', '1,000,000', '100', '65%', 'Legs / Arms'],
        ],
      ),
      h(2, '3. Action Plan'),
      h(3, '3.1 Marketing'),
      tasks(['Run SNS campaigns (Instagram, TikTok)', true], ['Introduce autumn promotional packages', false], ['Strengthen referral program for existing customers', false]),
      h(3, '3.2 Operations'),
      ol('Standardize opening and closing checklists across branches', 'Weekly inventory check every Monday', 'Reduce average waiting time to under 10 minutes'),
      h(3, '3.3 Staff'),
      p('Monthly training on service quality. New staff shadow a senior therapist for their first ', t('two weeks', 'bold'), '.'),
      { type: 'horizontalRule' },
      p(t('Owner: Claudia Chen · Review date: Oct 31, 2026', 'italic')),
    ],
  },
  'Marketing Plan - Q4 2026': {
    type: 'doc',
    content: [
      h(2, 'Objectives'),
      ul('Increase brand awareness in key markets', 'Drive customer acquisition and repeat purchases', 'Strengthen brand community and engagement'),
      h(2, 'Key KPI Targets'),
      table(['KPI', 'Target', 'Owner'], [['Revenue growth vs Q3', '+30%', 'Hana'], ['Customer repeat purchase rate', '70%', 'Mika'], ['New customers across all channels', '500K', 'Yuki']]),
      h(2, 'Channels'),
      p('Instagram and TikTok lead the autumn campaign; LINE is used for repeat-customer offers.'),
    ],
  },
  'HR Manual': {
    type: 'doc',
    content: [
      h(2, 'Working hours'),
      p('Standard working hours are 10:00–19:00 with a one-hour break. Branch schedules are published every Friday.'),
      h(2, 'Leave'),
      ul('Annual leave: 12 days in the first year', 'Sick leave requires a note after 2 consecutive days', 'Request leave in Approvals at least 7 days ahead'),
      h(2, 'Code of conduct'),
      { type: 'blockquote', content: [p('We treat every customer and colleague with care and respect.')] },
    ],
  },
  'Branch Operation Guide': {
    type: 'doc',
    content: [
      h(2, 'Opening'),
      tasks(['Unlock and disarm alarm', false], ['Check treatment rooms and supplies', false], ['Review today’s bookings', false]),
      h(2, 'Closing'),
      tasks(['Sanitize equipment', false], ['Count cash and record sales', false], ['Lock up and arm alarm', false]),
    ],
  },
  'Team Meeting Notes': {
    type: 'doc',
    content: [h(2, 'Weekly sync — Sep 28'), ul('Autumn campaign on track', 'Branch S2 staffing: 2 new hires start Oct 5', 'Next review: Oct 5'), h(2, 'Action items'), tasks(['Share campaign assets with all branches', false], ['Finalize October targets', true])],
  },
};

export function seedDocState(json: JSONContent) {
  const doc = TiptapTransformer.toYdoc(json, COLLAB_FIELD, docExtensions());
  return { state: Buffer.from(Y.encodeStateAsUpdate(doc)), text: toPlainText(json) };
}
