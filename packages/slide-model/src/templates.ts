// Presentation templates (Google Slides' template gallery): a theme plus a set of filled-in slides.
// docs/ARCHITECTURE.md §35.
import { diagramElements } from './diagrams';
import { blankDeck, layoutElements, newId, textDoc, THEMES, type DeckSize, type LayoutId, type PlainDeck, type PlainElement, type PlainSlide, type Placeholder, type TextNode, type Theme } from './index';

export interface DeckTemplate {
  id: string;
  name: string;
  description: string;
  theme: string; // theme id
  slides: (size: DeckSize, theme: Theme, title: string) => PlainSlide[];
}

type Fill = Partial<Record<Placeholder, string | string[] | TextNode>>;

/** A slide of the given layout with its placeholders filled in (arrays = bullet lists). */
function slide(layout: LayoutId, size: DeckSize, theme: Theme, fill: Fill = {}, extra: PlainElement[] = [], notes = ''): PlainSlide {
  const els = layoutElements(layout, size, theme).map((e) => {
    const v = e.ph ? fill[e.ph] : undefined;
    if (v === undefined) return e;
    const text = typeof v === 'string' ? textDoc(v, { align: e.style?.align }) : Array.isArray(v) ? textDoc(v, { bullets: true }) : v;
    return { ...e, text };
  });
  let z = Math.max(0, ...els.map((e) => e.z));
  return { id: newId(), meta: { layout }, notes, elements: [...els, ...extra.map((e) => ({ ...e, z: ++z }))] };
}

const chart = (size: DeckSize, x: number, y: number, w: number, h: number, spec: NonNullable<PlainElement['chart']>): PlainElement => ({ id: newId(), type: 'chart', x: size.w * x, y: size.h * y, w: size.w * w, h: size.h * h, z: 0, chart: spec });
const table = (size: DeckSize, x: number, y: number, w: number, h: number, rows: string[][]): PlainElement => ({ id: newId(), type: 'table', x: size.w * x, y: size.h * y, w: size.w * w, h: size.h * h, z: 0, table: { rows, header: true, banded: true, fontSize: 14 } });

export const TEMPLATES: DeckTemplate[] = [
  {
    id: 'pitch',
    name: 'Pitch deck',
    description: 'Problem, solution, market, model, team and the ask',
    theme: 'midnight',
    slides: (s, t, title) => [
      slide('title', s, t, { title, subtitle: 'Seed round · 2026' }),
      slide('mainPoint', s, t, { title: 'Busy salons lose 1 in 5 bookings to no-shows.' }, [], 'Open with the pain your customers feel.'),
      slide('twoContent', s, t, { title: 'Our solution', body: ['Smart reminders', 'Deposits at booking', 'Waitlist that fills gaps'], body2: ['Live in 40 salons', '−62% no-shows', '4.8★ from owners'] }),
      slide('bigNumber', s, t, { title: '$4.2B', body: 'Beauty-services booking market in Japan & SEA' }),
      slide('titleContent', s, t, { title: 'Business model', body: ['Subscription: ¥4,800 / salon / month', '1.5% on deposits', 'Payback in under 3 months'] }),
      slide('titleOnly', s, t, { title: 'Team' }, diagramElements('hierarchy', { count: 4, color: 'multi' }, s)),
      slide('mainPoint', s, t, { title: 'We are raising ¥150M to reach 1,000 salons.' }),
    ],
  },
  {
    id: 'project',
    name: 'Project status',
    description: 'Summary, timeline, risks and next steps',
    theme: 'master',
    slides: (s, t, title) => [
      slide('title', s, t, { title, subtitle: 'Status update · week 40' }),
      slide('titleContent', s, t, { title: 'Summary', body: ['On track for the November launch', 'Design complete, build 70% done', 'Two risks need a decision this week'] }),
      slide('titleOnly', s, t, { title: 'Timeline' }, diagramElements('timeline', { count: 4, color: 'multi' }, s)),
      slide('titleOnly', s, t, { title: 'Risks' }, [
        table(s, 0.07, 0.26, 0.86, 0.5, [
          ['Risk', 'Impact', 'Owner', 'Mitigation'],
          ['Vendor API delay', 'High', 'Ken', 'Mock service for testing'],
          ['Holiday staffing', 'Medium', 'Aya', 'Freeze scope by Oct 20'],
          ['Budget overrun', 'Low', 'Mina', 'Weekly cost review'],
        ]),
      ]),
      slide('titleContent', s, t, { title: 'Next steps', body: ['Approve the vendor fallback', 'Start user testing on Oct 15', 'Prepare launch communications'] }),
    ],
  },
  {
    id: 'marketing',
    name: 'Marketing plan',
    description: 'Goals, channels, budget and calendar',
    theme: 'natural-beauty',
    slides: (s, t, title) => [
      slide('title', s, t, { title, subtitle: 'Q4 2026' }),
      slide('bigNumber', s, t, { title: '+30%', body: 'Goal: new customers versus Q3' }),
      slide('titleOnly', s, t, { title: 'Channels' }, diagramElements('grid', { count: 4, color: 'multi' }, s)),
      slide('titleOnly', s, t, { title: 'Budget' }, [
        chart(s, 0.2, 0.24, 0.6, 0.68, { kind: 'doughnut', categories: ['Social', 'Search', 'Events', 'Print'], series: [{ name: 'Budget', values: [45, 25, 20, 10] }], legend: true, labels: true }),
      ]),
      slide('titleOnly', s, t, { title: 'Calendar' }, diagramElements('process', { count: 4, color: 1 }, s)),
      slide('mainPoint', s, t, { title: 'Questions & ideas' }),
    ],
  },
  {
    id: 'workshop',
    name: 'Workshop',
    description: 'Agenda, sections, exercises and wrap-up',
    theme: 'forest',
    slides: (s, t, title) => [
      slide('title', s, t, { title, subtitle: 'Hands-on session' }),
      slide('oneColumn', s, t, { title: 'Agenda', body: ['Welcome (10 min)', 'Concepts (30 min)', 'Exercise (40 min)', 'Share back (20 min)'] }),
      slide('section', s, t, { title: 'Part 1 · Concepts', subtitle: 'What we will learn' }),
      slide('titleContent', s, t, { title: 'Key ideas', body: ['Start from the customer', 'Small experiments, fast feedback', 'Measure what matters'] }),
      slide('sectionDesc', s, t, { title: 'Exercise', subtitle: '40 minutes · groups of 4', body: ['Pick a real problem', 'Sketch three solutions', 'Choose one to test'] }),
      slide('mainPoint', s, t, { title: 'Thank you — what will you try first?' }),
    ],
  },
  {
    id: 'meeting',
    name: 'Team meeting',
    description: 'Agenda, updates, decisions and action items',
    theme: 'minimal',
    slides: (s, t, title) => [
      slide('title', s, t, { title, subtitle: new Date().toISOString().slice(0, 10) }),
      slide('titleContent', s, t, { title: 'Agenda', body: ['Updates', 'Decisions', 'Action items'] }),
      slide('twoContent', s, t, { title: 'Updates', body: ['Sales: +12% month on month', 'New branch opens Nov 3'], body2: ['Hiring: 2 stylists joined', 'App release next week'] }),
      slide('titleContent', s, t, { title: 'Decisions', body: ['Move the team offsite to December', 'Adopt the new booking flow'] }),
      slide('titleOnly', s, t, { title: 'Action items' }, [
        table(s, 0.07, 0.26, 0.86, 0.45, [
          ['Action', 'Owner', 'Due'],
          ['Book the offsite venue', 'Aya', 'Oct 15'],
          ['Train staff on the new flow', 'Ken', 'Oct 22'],
          ['Share the meeting notes', 'Mina', 'Today'],
        ]),
      ]),
    ],
  },
];

/** A new presentation from a template (or blank when the id is unknown). */
export function templateDeck(templateId: string | null | undefined, name: string): PlainDeck {
  const tpl = TEMPLATES.find((t) => t.id === templateId);
  if (!tpl) return blankDeck(name);
  const base = blankDeck(name);
  const theme = THEMES.find((t) => t.id === tpl.theme) ?? base.theme;
  const title = name.replace(/\.(pptx?|odp|key)$/i, '');
  return { ...base, theme, slides: tpl.slides(base.size, theme, title) };
}
