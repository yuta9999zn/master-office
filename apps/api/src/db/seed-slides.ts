import { blankDeck, deckText, newId, textDoc, THEMES, writeDeck, type ElementStyle, type PlainDeck, type PlainElement, type PlainSlide, type TextNode } from '@workos/slide-model';
import * as Y from 'yjs';

// Seed presentations, stored exactly as the editor would. The Q4 deck mirrors the reference screen
// ("giao diện slice pptx.png"); its product illustration is drawn with native shapes so it stays editable
// and exports to PowerPoint as real shapes.

const NB = THEMES.find((t) => t.id === 'natural-beauty')!;
const PINK = '#F28B9B';
const PINK_SOFT = '#FDECEF';
const BLUE_SOFT = '#EEF4FF';
const GREEN_SOFT = '#ECFBF2';
const INK = '#111827';
const GREY = '#64748B';

let z = 0;
const el = (e: Omit<PlainElement, 'id' | 'z'>): PlainElement => ({ id: newId(), z: ++z, ...e });
const text = (t: string | string[], x: number, y: number, w: number, h: number, style: ElementStyle = {}, opts: Parameters<typeof textDoc>[1] = {}) =>
  el({ type: 'text', x, y, w, h, style: { pad: 4, ...style }, text: textDoc(t, opts) });
const shape = (geom: PlainElement['geom'], x: number, y: number, w: number, h: number, style: ElementStyle, extra: Partial<PlainElement> = {}) => el({ type: 'shape', geom, x, y, w, h, style, ...extra });
const rich = (...paras: TextNode[][]): TextNode => ({ type: 'doc', content: paras.map((c) => ({ type: 'paragraph', content: c })) });
const run = (t: string, marks: TextNode['marks'] = []): TextNode => ({ type: 'text', text: t, ...(marks.length ? { marks } : {}) });

/** Lotus mark: three petals. */
function lotus(x: number, y: number, s = 1): PlainElement[] {
  return [
    shape('ellipse', x + 2 * s, y + 10 * s, 18 * s, 34 * s, { fill: '#F7A8B5' }, { rot: -38 }),
    shape('ellipse', x + 30 * s, y + 10 * s, 18 * s, 34 * s, { fill: '#F7A8B5' }, { rot: 38 }),
    shape('ellipse', x + 16 * s, y, 18 * s, 40 * s, { fill: PINK }),
  ];
}

/** Cosmetic jar + bottle on a stone, with leaves (all shapes). */
function products(x: number, y: number): PlainElement[] {
  return [
    shape('ellipse', x + 10, y + 300, 420, 70, { fill: '#E7DED6' }),
    // leaves
    shape('ellipse', x + 250, y + 40, 60, 150, { fill: '#7FB77E' }, { rot: 35 }),
    shape('ellipse', x + 300, y + 70, 54, 140, { fill: '#5E9F63' }, { rot: 62 }),
    shape('ellipse', x + 60, y + 90, 50, 130, { fill: '#8CC08A' }, { rot: -40 }),
    // bottle
    shape('roundRect', x + 120, y + 70, 130, 250, { fill: '#FFFDF9', stroke: '#EADFD6', strokeWidth: 1.5, radius: 26, shadow: true }),
    shape('roundRect', x + 150, y + 22, 70, 58, { fill: '#C9A27C', radius: 10 }),
    ...lotus(x + 162, y + 150, 0.9),
    text('NATURAL\nBEAUTY', x + 120, y + 205, 130, 50, { fontSize: 8, color: '#9A8478', align: 'center', lineHeight: 1.3 }),
    // jar
    shape('roundRect', x + 255, y + 210, 150, 115, { fill: '#FFFDF9', stroke: '#EADFD6', strokeWidth: 1.5, radius: 22, shadow: true }),
    shape('roundRect', x + 250, y + 178, 160, 44, { fill: '#C9A27C', radius: 10 }),
    ...lotus(x + 312, y + 236, 0.7),
    text('NATURAL\nBEAUTY', x + 255, y + 276, 150, 40, { fontSize: 7, color: '#9A8478', align: 'center' }),
    // flower
    shape('ellipse', x + 70, y + 250, 34, 34, { fill: '#FFFFFF', stroke: '#F1E9E2', strokeWidth: 1 }),
    shape('ellipse', x + 80, y + 260, 14, 14, { fill: '#F6D365' }),
  ];
}

function card(x: number, y: number, w: number, h: number, fill: string, icon: PlainElement[], title: string): PlainElement[] {
  const bg = shape('roundRect', x, y, w, h, { fill, radius: 18 });
  // Icons are built before the card (argument order): lift them above it.
  return [bg, ...icon.map((e) => ({ ...e, z: ++z })), text(title, x + 70, y + 20, w - 90, 40, { fontSize: 18, bold: true, color: INK, vAlign: 'middle' })];
}

function q4Deck(): PlainDeck {
  z = 0;
  const s1: PlainSlide = {
    id: newId(),
    meta: { layout: 'title' },
    notes: 'Welcome everyone. Q4 is our biggest quarter: three objectives, three KPI targets, and a revenue forecast of 1.7M in December.',
    elements: [
      // hero panel + products
      shape('roundRect', 790, 30, 460, 440, { fill: '#FBE3E7', radius: 28 }),
      shape('ellipse', 960, -60, 380, 300, { fill: '#F8D0D8', opacity: 0.6 }),
      ...products(800, 90),
      // brand + title block
      ...lotus(40, 40, 0.9),
      text('N A T U R A L   B E A U T Y', 100, 48, 400, 34, { fontSize: 13, color: '#4B5563', vAlign: 'middle' }),
      { ...text('Q4 Campaign\nStrategy', 34, 110, 700, 190, { fontSize: 60, bold: true, color: INK, lineHeight: 1.05, vAlign: 'top' }), ph: 'title' },
      { ...text('Driving brand growth through meaningful\nbeauty experiences', 36, 300, 620, 80, { fontSize: 20, color: GREY, lineHeight: 1.35 }), ph: 'subtitle' },
      shape('line', 42, 398, 70, 0, { stroke: PINK, strokeWidth: 3 }),
      text('October 2026   |   Marketing Department', 36, 412, 520, 34, { fontSize: 14, color: '#94A3B8' }),
      // bottom cards
      ...card(30, 480, 380, 222, PINK_SOFT, [shape('ellipse', 50, 498, 34, 34, { stroke: PINK, strokeWidth: 3 }), shape('ellipse', 61, 509, 12, 12, { fill: PINK })], 'Our Objectives'),
      ...[
        ['1', 'Increase brand awareness in key markets'],
        ['2', 'Drive customer acquisition and repeat purchases'],
        ['3', 'Strengthen brand community and engagement'],
      ].flatMap(([n, t], i) => [
        shape('ellipse', 52, 552 + i * 50, 34, 34, { fill: '#FFFFFF', color: PINK, align: 'center', vAlign: 'middle', fontSize: 14, bold: true, pad: 0 }, { text: textDoc(n, { align: 'center' }) }),
        text(t, 100, 548 + i * 50, 290, 44, { fontSize: 13, color: '#334155', vAlign: 'middle', lineHeight: 1.25 }),
      ]),
      ...card(430, 480, 400, 222, BLUE_SOFT, [shape('rect', 450, 512, 8, 20, { fill: '#2563EB' }), shape('rect', 462, 504, 8, 28, { fill: '#2563EB' }), shape('rect', 474, 496, 8, 36, { fill: '#2563EB' })], 'Key KPI Targets'),
      ...[
        ['+30%', 'Revenue growth\nvs Q3 2026'],
        ['70%', 'Customer repeat\npurchase rate'],
        ['500K', 'New customers\nacross all channels'],
      ].flatMap(([k, d], i) => [
        text(k, 450, 548 + i * 50, 130, 46, { fontSize: 26, bold: true, color: '#2563EB', vAlign: 'middle' }),
        text(d, 600, 548 + i * 50, 210, 46, { fontSize: 11, color: '#475569', vAlign: 'middle', lineHeight: 1.25 }),
        ...(i < 2 ? [shape('line', 450, 596 + i * 50, 360, 0, { stroke: '#D9E3F5', strokeWidth: 1 })] : []),
      ]),
      ...card(850, 480, 400, 222, GREEN_SOFT, [shape('ellipse', 870, 498, 34, 34, { fill: '#22C55E' }), shape('rtTriangle', 887, 498, 17, 17, { fill: GREEN_SOFT }, { flipH: true })], 'Revenue Forecast'),
      el({
        type: 'chart',
        x: 862,
        y: 540,
        w: 376,
        h: 156,
        chart: { kind: 'column', categories: ['Oct', 'Nov', 'Dec'], series: [{ name: 'Revenue', values: [1000000, 1200000, 1700000], color: '#3B82F6' }], legend: false },
      }),
      shape('roundRect', 1150, 520, 64, 26, { fill: '#DCFCE7', color: '#15803D', fontSize: 11, bold: true, align: 'center', vAlign: 'middle', pad: 0, radius: 13 }, { text: textDoc('+32%', { align: 'center' }) }),
    ],
  };

  const s2: PlainSlide = {
    id: newId(),
    meta: { layout: 'titleContent' },
    notes: 'The skincare market keeps growing about 9% a year; our share moved from 3.1% to 3.8% this year.',
    elements: [
      { ...text('Market Overview', 60, 40, 800, 70, { fontSize: 36, bold: true, color: INK, vAlign: 'bottom' }), ph: 'title' },
      shape('line', 64, 118, 70, 0, { stroke: PINK, strokeWidth: 3 }),
      el({
        type: 'chart',
        x: 60,
        y: 150,
        w: 700,
        h: 470,
        chart: { kind: 'column', title: 'Market size (¥ billion)', categories: ['2022', '2023', '2024', '2025', '2026'], series: [{ name: 'Market', values: [410, 446, 488, 531, 579], color: '#93C5FD' }, { name: 'Natural Beauty', values: [12, 14, 16.5, 19, 22], color: PINK }], legend: true },
      }),
      { ...el({ type: 'text', x: 800, y: 160, w: 420, h: 300, style: { fontSize: 18, color: '#334155', lineHeight: 1.4 }, text: textDoc(['Clean beauty is the fastest-growing segment (+14%)', 'Gen Z discovers brands on TikTok and Instagram', 'Repeat purchase drives 62% of revenue', 'Competitors are cutting prices — we compete on experience'], { bullets: true }) }), ph: 'body' },
      ...products(860, 450).map((e) => ({ ...e, x: (e.x - 860) * 0.55 + 920, y: (e.y - 450) * 0.55 + 470, w: e.w * 0.55, h: e.h * 0.55, style: { ...e.style, ...(e.style?.fontSize ? { fontSize: Math.max(5, Math.round(e.style.fontSize * 0.55)) } : {}) } })),
    ],
  };

  const pill = (label: string, x: number, color: string, soft: string, lines: string[]) => [
    shape('roundRect', x, 170, 360, 430, { fill: soft, radius: 20 }),
    shape('ellipse', x + 140, 200, 80, 80, { fill: '#FFFFFF', shadow: true }),
    shape('ellipse', x + 162, 222, 36, 36, { fill: color }),
    text(label, x + 20, 300, 320, 46, { fontSize: 22, bold: true, color: INK, align: 'center', vAlign: 'middle' }),
    el({ type: 'text', x: x + 30, y: 360, w: 300, h: 220, style: { fontSize: 15, color: '#475569', lineHeight: 1.4 }, text: textDoc(lines, { bullets: true }) }),
  ];
  const s3: PlainSlide = {
    id: newId(),
    meta: { layout: 'titleOnly' },
    notes: 'Three phases, each with its own owner: Hana (awareness), Yuki (engagement), Mika (conversion).',
    elements: [
      { ...text('Campaign Plan', 60, 40, 800, 70, { fontSize: 36, bold: true, color: INK, vAlign: 'bottom' }), ph: 'title' },
      shape('line', 64, 118, 70, 0, { stroke: PINK, strokeWidth: 3 }),
      ...pill('Awareness', 60, PINK, PINK_SOFT, ['Autumn launch film', 'Influencer seeding (40 creators)', 'Store window refresh']),
      ...pill('Engagement', 460, '#3B82F6', BLUE_SOFT, ['Skin-care quiz & samples', 'Weekly live sessions', 'Community challenges']),
      ...pill('Conversion', 860, '#22C55E', GREEN_SOFT, ['Holiday gift sets', 'Loyalty double points', 'Bundle offers in stores']),
      shape('rightArrow', 424, 360, 32, 40, { fill: '#CBD5E1' }),
      shape('rightArrow', 824, 360, 32, 40, { fill: '#CBD5E1' }),
    ],
  };

  const s4: PlainSlide = {
    id: newId(),
    meta: { layout: 'titleOnly' },
    notes: 'TikTok gets the biggest increase; stores remain the conversion channel.',
    elements: [
      { ...text('Channel Strategy', 60, 40, 800, 70, { fontSize: 36, bold: true, color: INK, vAlign: 'bottom' }), ph: 'title' },
      shape('line', 64, 118, 70, 0, { stroke: PINK, strokeWidth: 3 }),
      el({
        type: 'table',
        x: 60,
        y: 160,
        w: 1160,
        h: 330,
        table: {
          rows: [
            ['Channel', 'Role', 'Content', 'Budget', 'KPI'],
            ['Instagram', 'Inspire', 'Reels, carousels, creator posts', '30%', '+25% followers'],
            ['TikTok', 'Discover', 'Short tutorials, challenges', '35%', '5M views'],
            ['X (Twitter)', 'Converse', 'Launch news, Q&A', '10%', '2% engagement'],
            ['Stores', 'Convert', 'Testers, consultations, gift sets', '25%', '70% repeat rate'],
          ],
          colW: [2, 2, 4, 1.4, 2.4],
          headerFill: PINK,
          fontSize: 15,
        },
      }),
      ...['Instagram', 'TikTok', 'X', 'Stores'].flatMap((n, i) => [
        shape('roundRect', 60 + i * 295, 540, 270, 110, { fill: [PINK_SOFT, BLUE_SOFT, '#F1F5F9', GREEN_SOFT][i], radius: 16 }),
        text(n, 80 + i * 295, 556, 230, 34, { fontSize: 18, bold: true, color: INK }),
        text(['Weekly reels + 40 creators', '3 posts / day, live on Fridays', 'Launch threads', 'Gift-set displays in 12 stores'][i], 80 + i * 295, 594, 230, 44, { fontSize: 13, color: GREY }),
      ]),
    ],
  };

  const s5: PlainSlide = {
    id: newId(),
    meta: { layout: 'twoContent' },
    notes: 'Total Q4 budget is ¥48M. Media is the largest line; we keep 8% as reserve.',
    elements: [
      { ...text('Budget Allocation', 60, 40, 800, 70, { fontSize: 36, bold: true, color: INK, vAlign: 'bottom' }), ph: 'title' },
      shape('line', 64, 118, 70, 0, { stroke: PINK, strokeWidth: 3 }),
      el({ type: 'chart', x: 60, y: 150, w: 560, h: 500, chart: { kind: 'doughnut', categories: ['Media', 'Creators', 'Stores', 'Content', 'Reserve'], series: [{ name: 'Budget', values: [40, 22, 18, 12, 8] }], legend: true, labels: true } }),
      text('¥48M', 250, 360, 180, 60, { fontSize: 30, bold: true, color: INK, align: 'center', vAlign: 'middle' }),
      ...[
        ['Media', '40%', '¥19.2M — paid social and video'],
        ['Creators', '22%', '¥10.6M — 40 creators, 3 waves'],
        ['Stores', '18%', '¥8.6M — displays and testers'],
        ['Content', '12%', '¥5.8M — film, photo, live'],
        ['Reserve', '8%', '¥3.8M — opportunities'],
      ].flatMap(([n, p, d], i) => [
        shape('roundRect', 680, 170 + i * 92, 18, 18, { fill: NB.colors.accents[i], radius: 4 }),
        text(`${n}  ${p}`, 710, 160 + i * 92, 500, 36, { fontSize: 18, bold: true, color: INK, vAlign: 'middle' }),
        text(d, 710, 194 + i * 92, 500, 30, { fontSize: 14, color: GREY }),
      ]),
    ],
  };

  const steps = [
    ['Oct 5', 'Launch film & creator wave 1'],
    ['Oct 20', 'Skin quiz + sampling'],
    ['Nov 11', 'Loyalty double points'],
    ['Dec 1', 'Holiday gift sets'],
    ['Jan 10', 'Results review'],
  ];
  const s6: PlainSlide = {
    id: newId(),
    meta: { layout: 'titleOnly' },
    notes: 'Owners confirm their dates by Friday. Results review on January 10.',
    elements: [
      { ...text('Next Steps', 60, 40, 800, 70, { fontSize: 36, bold: true, color: INK, vAlign: 'bottom' }), ph: 'title' },
      shape('line', 64, 118, 70, 0, { stroke: PINK, strokeWidth: 3 }),
      shape('line', 120, 330, 1040, 0, { stroke: '#CBD5E1', strokeWidth: 4 }),
      ...steps.flatMap(([d, t], i) => [
        shape('ellipse', 100 + i * 255, 306, 48, 48, { fill: i === 0 ? PINK : '#FFFFFF', stroke: PINK, strokeWidth: 3, color: i === 0 ? '#FFFFFF' : PINK, bold: true, align: 'center', vAlign: 'middle', fontSize: 14, pad: 0 }, { text: textDoc(String(i + 1), { align: 'center' }) }),
        text(d, 40 + i * 255, 230, 170, 40, { fontSize: 18, bold: true, color: INK, align: 'center', vAlign: 'bottom' }),
        text(t, 40 + i * 255, 372, 170, 70, { fontSize: 14, color: GREY, align: 'center', lineHeight: 1.3 }),
      ]),
      shape('roundRect', 60, 500, 1160, 150, { fill: PINK_SOFT, radius: 18 }),
      el({
        type: 'text',
        x: 90,
        y: 520,
        w: 1100,
        h: 110,
        style: { fontSize: 18, color: '#334155', lineHeight: 1.4, vAlign: 'middle' },
        text: rich([run('Decisions needed today: ', [{ type: 'bold' }]), run('approve the creator shortlist, the gift-set price points and the store display budget.')], [run('Owner: Hana Lee · Questions: ', [{ type: 'italic' }]), run('#q4-campaign', [{ type: 'textStyle', attrs: { color: PINK } }])]),
      }),
    ],
  };
  return { name: 'Q4 Marketing Strategy - October 2026', size: { w: 1280, h: 720 }, theme: NB, slides: [s1, s2, s3, s4, s5, s6] };
}

function proposalDeck(): PlainDeck {
  z = 0;
  const d = blankDeck('Campaign Proposal');
  d.slides[0].elements[1].text = textDoc('Autumn campaign · draft for review', { align: 'center' });
  d.slides.push({
    id: newId(),
    meta: { layout: 'titleContent' },
    notes: '',
    elements: [
      { ...text('Goals', 90, 43, 1100, 108, { fontSize: 36, bold: true, vAlign: 'bottom' }), ph: 'title' },
      { ...el({ type: 'text', x: 90, y: 180, w: 1100, h: 475, style: { fontSize: 20, lineHeight: 1.3 }, text: textDoc(['Grow new customers by 20%', 'Launch two hero products', 'Keep cost per acquisition under ¥2,000'], { bullets: true }) }), ph: 'body' },
    ],
  });
  return d;
}

export const SEED_DECKS: Record<string, () => PlainDeck> = {
  'Q4 Marketing Strategy - October 2026': q4Deck,
  'Campaign Proposal': proposalDeck,
};

export function seedDeckState(deck: PlainDeck) {
  const doc = new Y.Doc();
  writeDeck(doc, deck);
  return { state: Buffer.from(Y.encodeStateAsUpdate(doc)), text: deckText(deck), slideCount: deck.slides.length };
}

export { blankDeck };
