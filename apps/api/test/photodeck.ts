// Picture-led decks (§82) without a model: the slide count of a request, plan repairs, and the slides code lays out —
// picture slots with their prompts, captions on shades, charts for figures, bullets for words.
//   npx tsx apps/api/test/photodeck.ts
import { themeById } from '../src/ai/gen-slides';
import { cleanPhotoPlan, ensureData, isSlot, partBudget, partsOfRequest, picturePrompt, plausibleFigures, slideCountOf, slidesFromPhotoPlan, type PhotoDetail, type PhotoPlan } from '../src/ai/gen-photodeck';

let failures = 0;
const check = (name: string, cond: boolean, extra?: unknown) => {
  console.log(`${cond ? '✓' : '✗'} ${name}${cond ? '' : ' ' + JSON.stringify(extra ?? '').slice(0, 400)}`);
  if (!cond) failures++;
};

check('slide count from the request', slideCountOf('Làm bộ slide 30 trang về Hạ Long') === 30 && slideCountOf('12 slides about tea') === 12 && slideCountOf('giới thiệu Hạ Long') === null && slideCountOf('2 trang') === null);

const { plan, fixes } = cleanPhotoPlan(
  { t: 'Hạ Long', s: [{ k: 'photo', h: 'Vịnh Hạ Long' }, { k: 'photo', h: 'Vịnh Hạ Long' }, { k: 'oops' as never, h: 'Cách đi' }, { k: 'data', h: 'Hạ Long qua những con số' }, { k: 'caption', h: 'Chả mực' }, { k: 'cover', h: 'Ẩm thực' }] },
  null,
);
check('plan: first slide becomes the cover, repeats dropped, unknown kinds are text, a second cover is a section', plan.s[0].k === 'cover' && plan.s.length === 6 && plan.s[1].k === 'text' && plan.s[4].k === 'section' && fixes.length >= 1, plan);
check('… and the deck ends with an end slide', plan.s[plan.s.length - 1].k === 'end');
const trimmed = cleanPhotoPlan({ t: 'x', s: Array.from({ length: 12 }, (_, i) => ({ k: i === 11 ? 'end' : 'photo', h: `S${i}` })) as never }, 8).plan;
check('a plan longer than asked is trimmed, keeping the end slide', trimmed.s.length === 8 && trimmed.s[7].k === 'end', trimmed.s.length);

const details = new Map<number, PhotoDetail>([
  [1, { i: 1, img: 'Aerial view of Ha Long Bay at sunrise, emerald water and limestone islands', c: 'Kỳ quan thiên nhiên thế giới' }],
  [2, { i: 2, b: ['Bay từ Hà Nội 2,5 giờ cao tốc', 'Xe khách từ Mỹ Đình'] }],
  [3, { i: 3, d: [{ l: '2019', v: 14 }, { l: '2023', v: 15.5 }], u: 'triệu lượt' }],
  [4, { i: 4, img: 'Grilled squid cakes on a plate, food photography', c: 'Chả mực giã tay' }],
]);
const { slides, prompts } = slidesFromPhotoPlan(plan, details, { w: 1280, h: 720 }, themeById('master'));
check('one slide per planned slide', slides.length === plan.s.length);
const cover = slides[0];
check('cover: a full-bleed picture slot holding its prompt, a shade, the title and the line', cover.elements.some((e) => isSlot(e) && e.w === 1280 && e.alt?.startsWith('Hạ Long, Vietnam. Aerial view')) && cover.elements.some((e) => e.name === 'shade') && cover.elements.filter((e) => e.type === 'text').length === 2);
check('… prompts always ask for no text and a wide frame', prompts.every((p) => /no text/i.test(p.prompt) && /16:9/.test(p.prompt)), prompts);
check('… and the prompt is in the speaker notes', cover.notes.includes('Aerial view of Ha Long Bay'));
check('text slide: title and the bullets, no picture', !slides[1].elements.some(isSlot) && JSON.stringify(slides[1].elements).includes('Xe khách từ Mỹ Đình'));
const data = slides[2];
check('data slide: a column chart of the figures and a “check the figures” note', data.elements.some((e) => e.type === 'chart' && e.chart?.series[0].values.join() === '14,15.5') && JSON.stringify(data.elements).includes('cần kiểm tra'));
check('caption slide: picture, shade and the caption', slides[3].elements.some(isSlot) && JSON.stringify(slides[3].elements).includes('Chả mực giã tay'));
check('a picture slide without a written prompt still gets one, from the heading and the deck title', prompts.some((p) => p.slide === 5 && p.prompt.includes('Hạ Long')), prompts);
const photo = slidesFromPhotoPlan({ t: 'T', s: [{ k: 'cover', h: 'T' }, { k: 'photo', h: 'Hang Sửng Sốt' }] }, new Map(), { w: 1280, h: 720 }, themeById('master')).slides[1];
check('photo slide: the picture alone — no words, left for people to finish', photo.elements.length === 1 && isSlot(photo.elements[0]) && photo.notes.includes('Trang ảnh'));

const split = partsOfRequest('Làm bộ slide 30 trang giới thiệu về Hạ Long và đặc sản Hạ Long: vịnh và các hang động, đảo, các hoạt động (du thuyền, chèo kayak, Sun World), ẩm thực và đặc sản (chả mực, sá sùng, ngán), mua sắm, cách đi. Trang nào cần số liệu thì có số liệu.');
check('parts from the request: title without “làm bộ slide 30 trang”, parts in order, items from the parentheses', split?.title === 'Giới thiệu về Hạ Long và đặc sản Hạ Long' && split.parts.length === 6 && split.parts[2].name === 'Các hoạt động' && split.parts[3].items.join('|') === 'chả mực|sá sùng|ngán', split);
check('… a request without a list has no parts (the model splits it)', partsOfRequest('Giới thiệu Đà Lạt, 20 trang') === null);
const budget = partBudget(split!.parts, 30);
check('slides shared out: 28 inner slides, at least 2 per part, more where more is listed', budget.reduce((a, b) => a + b, 0) === 28 && budget.every((n) => n >= 2) && budget[3] > budget[1], budget);
check('… even when the deck is too small for every part', partBudget(split!.parts, 8).every((n) => n >= 2));
const cjk = cleanPhotoPlan({ t: 'x', s: [{ k: 'cover', h: 'Hạ Long' }, { k: 'caption', h: 'Cảm谢大家 Hạ Long' }] }, null, true).plan;
check('Chinese characters leaking into a Vietnamese heading are dropped', cjk.s[1].h === 'Cảm Hạ Long', cjk.s);

const hl = { t: 'Giới thiệu về Hạ Long', s: [], place: 'Hạ Long' } as PhotoPlan;
const dish = picturePrompt(hl, { k: 'caption', h: 'Sá sùng', p: 'Ẩm thực và đặc sản' }, 'aerial drone shot of sashimi slices laid out in a traditional Japanese style dishware set');
check('picture prompt: a dish is asked for by its own name, never the model’s guess (“sashimi”)', dish.startsWith('Sá sùng — Hạ Long, Vietnam.') && /food photography/.test(dish) && !/sashimi/.test(dish), dish);
const spot = picturePrompt(hl, { k: 'photo', h: 'Hòn Đầu Ngựa', p: 'Đảo' }, 'Aerial drone shot of the Horse Head Island in Ha Long Bay, bright sunny day.');
check('… a place keeps a description that names it', spot.startsWith('Hòn Đầu Ngựa — Hạ Long, Vietnam. Aerial drone shot'), spot);
check('… the cover is a travel picture even when the title says “đặc sản”', /travel photography/.test(picturePrompt({ t: 'Giới thiệu về Hạ Long và đặc sản Hạ Long', s: [], place: 'Hạ Long' }, { k: 'cover', h: 'Giới thiệu về Hạ Long và đặc sản Hạ Long' })));
check('… junk is replaced', !/màn hình/.test(picturePrompt(hl, { k: 'end', h: 'Cảm ơn' }, 'Ảnh chụp màn hình với tiêu đề của presentation')));
const withText = { t: 'x', s: [{ k: 'cover' as const, h: 'x' }, { k: 'text' as const, h: 'Mẹo mua quà', p: 'Mua sắm' }, { k: 'text' as const, h: 'Đi bằng xe khách', p: 'Cách đi' }, { k: 'end' as const, h: 'Cảm ơn' }] };
check('figures asked and none planned: likely text slides become data slides', ensureData(withText, 'có số liệu') !== null && withText.s[2].k === 'data');
check('… not when figures are not asked for', ensureData({ t: 'x', s: [{ k: 'text', h: 'Đi' }] }, 'giới thiệu') === null);

check('figures that look made up (c1, c2 / 1, 2) are not charted', !plausibleFigures([{ l: 'c1', v: 1 }, { l: 'c2', v: 2 }]) && !plausibleFigures([{ l: 'Đi bộ', v: 1 }, { l: 'Câu cá', v: 3 }]) && plausibleFigures([{ l: '2019', v: 14 }, { l: '2023', v: 15.5 }]));
const junk = slidesFromPhotoPlan({ t: 'T', s: [{ k: 'cover', h: 'T' }, { k: 'data', h: 'Cách đi từ Hà Nội' }] }, new Map([[2, { i: 2, d: [{ l: 'Xe khách', v: 1 }, { l: 'Tàu hỏa', v: 2 }], u: 'giờ' }]]), { w: 1280, h: 720 }, themeById('master')).slides[1];
const table = junk.elements.find((e) => e.type === 'table');
check('… they become a table to fill in: the labels, empty figures and sources', !!table && table.table?.rows[0].join('|') === 'Hạng mục|Số liệu (giờ)|Nguồn' && table.table?.rows[1].join('|') === 'Xe khách||' && junk.notes.includes('Xe khách: 1'), table?.table);

console.log(failures ? `\n${failures} check(s) failed` : '\nall picture-deck checks passed');
process.exit(failures ? 1 : 0);
