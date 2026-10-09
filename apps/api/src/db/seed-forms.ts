import { blankForm, DEFAULT_SETTINGS, DEFAULT_THEME, formText, newId, writeForm, type FormItem, type PlainForm } from '@workos/form-model';
import * as Y from 'yjs';

// Seed forms, stored exactly as the builder would. "Customer Satisfaction Survey" exercises most question
// types, a section with branching and a few responses; "Event Registration" is a simple sign-up form.

const opt = (...labels: string[]) => labels.map((label) => ({ id: newId(), label }));

function survey(): PlainForm {
  const visit: FormItem = { id: newId(), type: 'choice', title: 'Which branch did you visit?', required: true, options: opt('Branch 575', 'Branch 625', 'Branch S2'), other: true };
  const service: FormItem = { id: newId(), type: 'checkbox', title: 'Which services did you use?', required: true, options: opt('Facial', 'Wax (VIO)', 'Body Care', 'Underarm', 'Legs', 'Arms'), validation: { kind: 'count', op: 'atLeast', value: 1 } };
  const rating: FormItem = { id: newId(), type: 'rating', title: 'How would you rate your visit overall?', required: true, rating: { max: 5, icon: 'star' } };
  const recommend: FormItem = { id: newId(), type: 'scale', title: 'How likely are you to recommend us to a friend?', required: true, scale: { min: 0, max: 10, minLabel: 'Not likely', maxLabel: 'Extremely likely' } };
  const unhappy: FormItem = { id: newId(), type: 'section', title: 'Help us do better', description: 'Sorry it was not perfect — tell us what went wrong.' };
  const back: FormItem = { id: newId(), type: 'choice', title: 'Would you come back?', required: true, options: opt('Yes', 'Maybe', 'No'), branching: true };
  back.options![2].goTo = unhappy.id;
  back.options![0].goTo = 'submit';
  const grid: FormItem = { id: newId(), type: 'choiceGrid', title: 'Rate each part of your visit', grid: { rows: ['Booking', 'Reception', 'Treatment', 'Price'], cols: ['Poor', 'Fair', 'Good', 'Excellent'] } };
  const what: FormItem = { id: newId(), type: 'paragraph', title: 'What should we improve?', required: true, validation: { kind: 'length', op: 'min', value: 5, message: 'Please write at least a few words' } };
  const contact: FormItem = { id: newId(), type: 'short', title: 'Phone number (optional — we may call you back)', validation: { kind: 'regex', op: 'matches', value: '^[0-9+\\- ]{6,20}$', message: 'Enter a phone number' } };
  return {
    title: 'Customer Satisfaction Survey',
    description: 'Thank you for visiting Sakura Beauty! This takes about 2 minutes.',
    theme: { ...DEFAULT_THEME, color: '#F28B9B', background: '#FDECEF' },
    settings: { ...DEFAULT_SETTINGS, collectEmail: 'off', access: 'public', showSummary: true },
    items: [visit, service, rating, recommend, grid, back, unhappy, what, contact],
  };
}

function registration(): PlainForm {
  const f = blankForm('Event Registration');
  return {
    ...f,
    description: 'Autumn Beauty Workshop — October 24, 2026, Branch 575.',
    settings: { ...DEFAULT_SETTINGS, limitOne: true, allowEdit: true },
    items: [
      { id: newId(), type: 'short', title: 'Full name', required: true },
      { id: newId(), type: 'dropdown', title: 'Session', required: true, options: opt('10:00 – 12:00', '14:00 – 16:00', '18:00 – 20:00') },
      { id: newId(), type: 'date', title: 'Date of birth (for a birthday gift)' },
      { id: newId(), type: 'checkbox', title: 'Topics you are interested in', options: opt('Skin care', 'Make-up', 'Hair removal', 'Nutrition') },
    ],
  };
}

export const SEED_FORMS: Record<string, () => PlainForm> = {
  'Customer Satisfaction Survey': survey,
  'Event Registration': registration,
};

export function seedFormState(form: PlainForm) {
  const doc = new Y.Doc();
  writeForm(doc, form);
  return { state: Buffer.from(Y.encodeStateAsUpdate(doc)), text: formText(form), questionCount: form.items.filter((i) => i.type !== 'section').length };
}

/** A handful of answers for the survey (so the Responses tab and charts have data). */
export function surveyResponses(form: PlainForm) {
  const [visit, service, rating, recommend, grid, back, , what] = form.items;
  const rows: Record<string, unknown>[] = [
    { [visit.id]: 'Branch 575', [service.id]: ['Facial', 'Body Care'], [rating.id]: 5, [recommend.id]: 9, [grid.id]: { Booking: 'Excellent', Reception: 'Excellent', Treatment: 'Good', Price: 'Good' }, [back.id]: 'Yes' },
    { [visit.id]: 'Branch 625', [service.id]: ['Wax (VIO)'], [rating.id]: 4, [recommend.id]: 8, [back.id]: 'Yes' },
    { [visit.id]: 'Branch S2', [service.id]: ['Legs', 'Arms'], [rating.id]: 2, [recommend.id]: 3, [grid.id]: { Booking: 'Fair', Reception: 'Poor', Treatment: 'Fair', Price: 'Poor' }, [back.id]: 'No', [what.id]: 'The waiting time was too long and the staff seemed rushed.' },
    { [visit.id]: { other: 'Online consultation' }, [service.id]: ['Facial'], [rating.id]: 4, [recommend.id]: 7, [back.id]: 'Maybe' },
    { [visit.id]: 'Branch 575', [service.id]: ['Underarm', 'Facial'], [rating.id]: 5, [recommend.id]: 10, [back.id]: 'Yes' },
  ];
  return rows;
}
