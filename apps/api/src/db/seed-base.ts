import { CHOICE_COLORS, emptyViewConfig, type FieldOptions, type FieldType, type ViewConfig, type ViewType } from '@workos/base-model';
import { eq as sqlEq } from 'drizzle-orm';
import type { Db } from './client';
import * as s from './schema';

type User = typeof s.users.$inferSelect;
type Spec = { key: string; name: string; type: FieldType; options?: FieldOptions };

const choices = (names: string[]) => names.map((name, i) => ({ id: name.toLowerCase().replace(/\W+/g, '-'), name, color: CHOICE_COLORS[i % CHOICE_COLORS.length] }));
const c = (name: string) => name.toLowerCase().replace(/\W+/g, '-');

/** Base demo data (§75): the marketing Lead Tracker (leads + campaigns) and the operations Vendor List. */
export async function seedBase(db: Db, u: Record<string, User>, ref: (name: string) => Promise<{ id: string }>) {
  const table = async (baseId: string, name: string, position: number, specs: Spec[]) => {
    const [t] = await db.insert(s.baseTables).values({ baseId, name, position }).returning();
    const rows = await db
      .insert(s.baseFields)
      .values(specs.map((f, i) => ({ tableId: t.id, name: f.name, type: f.type, options: (f.options ?? {}) as Record<string, unknown>, position: i })))
      .returning();
    await db.update(s.baseTables).set({ primaryFieldId: rows[0].id }).where(sqlEq(s.baseTables.id, t.id));
    const id = Object.fromEntries(specs.map((f, i) => [f.key, rows[i].id]));
    return { t, id };
  };
  const records = async (tableId: string, id: Record<string, string>, by: User, list: Record<string, unknown>[]) => {
    const rows = await db
      .insert(s.baseRecords)
      .values(list.map((v, i) => ({ tableId, values: Object.fromEntries(Object.entries(v).filter(([, x]) => x !== null && x !== undefined).map(([k, x]) => [id[k], x])), position: `a${String(i).padStart(7, '0')}`, autoNumber: i + 1, createdBy: by.id, updatedBy: by.id })))
      .returning();
    await db.update(s.baseTables).set({ autoSeq: list.length }).where(sqlEq(s.baseTables.id, tableId));
    return rows;
  };
  const view = (tableId: string, name: string, type: ViewType, position: number, by: User, patch: Partial<ViewConfig> = {}) =>
    db.insert(s.baseViews).values({ tableId, name, type, position, createdBy: by.id, config: { ...emptyViewConfig(), ...patch } as unknown as Record<string, unknown> });

  // ── Lead Tracker ──────────────────────────────────────────────────────────
  const leadsBase = await ref('Lead Tracker');
  const stages = ['New', 'Contacted', 'Qualified', 'Proposal', 'Won', 'Lost'];
  const { t: leads, id: L } = await table(leadsBase.id, 'Leads', 0, [
    { key: 'name', name: 'Lead', type: 'text' },
    { key: 'company', name: 'Company', type: 'text' },
    { key: 'email', name: 'Email', type: 'email' },
    { key: 'stage', name: 'Stage', type: 'singleSelect', options: { choices: choices(stages) } },
    { key: 'source', name: 'Source', type: 'singleSelect', options: { choices: choices(['Website', 'Instagram', 'Referral', 'Event', 'Ads']) } },
    { key: 'value', name: 'Deal value', type: 'currency', options: { currency: 'JPY', precision: 0 } },
    { key: 'owner', name: 'Owner', type: 'person', options: { multiple: false } },
    { key: 'next', name: 'Next follow-up', type: 'date', options: { includeTime: false } },
    { key: 'hot', name: 'Hot', type: 'checkbox' },
    { key: 'score', name: 'Fit', type: 'rating', options: { max: 5 } },
    { key: 'notes', name: 'Notes', type: 'longText' },
    { key: 'due', name: 'Days to follow-up', type: 'formula', options: { expression: "IF({Next follow-up}, DATETIME_DIFF({Next follow-up}, TODAY(), 'days'), BLANK())" } },
    { key: 'tags', name: 'Products', type: 'multiSelect', options: { choices: choices(['Serum', 'Cream', 'Cleanser', 'Gift set', 'Salon pack']) } },
  ]);
  const lead = (name: string, company: string, email: string, stage: string, source: string, value: number | null, owner: User, next: string | null, hot: boolean, score: number, tags: string[], notes?: string) => ({
    name,
    company,
    email,
    stage: c(stage),
    source: c(source),
    value,
    owner: [owner.id],
    next,
    hot: hot || null,
    score,
    tags: tags.map(c),
    notes,
  });
  const leadRows = await records(leads.id, L, u.hana, [
    lead('Hotel Sakura spa amenities', 'Hotel Sakura', 'purchasing@hotel-sakura.jp', 'Proposal', 'Referral', 2_400_000, u.hana, '2026-10-09', true, 5, ['Cream', 'Salon pack'], 'Wants 120 rooms stocked from December. Sent the proposal on 1 Oct.'),
    lead('Mori Pharmacy chain', 'Mori Pharmacy', 'buyer@mori-ph.jp', 'Qualified', 'Event', 1_800_000, u.rina, '2026-10-14', true, 4, ['Serum', 'Cleanser'], 'Met at Beauty World Japan. 14 stores in Kansai.'),
    lead('Lumi Salon Shibuya', 'Lumi Salon', 'hello@lumi-salon.jp', 'Contacted', 'Instagram', 350_000, u.hana, '2026-10-08', false, 3, ['Salon pack']),
    lead('Aoba gift catalogue', 'Aoba Gifts', 'catalog@aoba.co.jp', 'New', 'Website', 900_000, u.minh, '2026-10-20', false, 3, ['Gift set']),
    lead('Kyoto Ryokan group', 'Kyoto Ryokan Group', 'info@kyoto-ryokan.jp', 'Won', 'Referral', 3_200_000, u.hana, null, false, 5, ['Cream', 'Cleanser'], 'Signed for 2027. Kick-off in November.'),
    lead('Nail bar franchise', 'Polish & Co', 'ops@polishco.jp', 'Lost', 'Ads', 600_000, u.rina, null, false, 2, ['Salon pack'], 'Went with a cheaper supplier.'),
    lead('Department store pop-up', 'Hankyu Umeda', 'popup@hankyu.example', 'Proposal', 'Event', 1_500_000, u.minh, '2026-10-12', true, 4, ['Gift set', 'Serum']),
    lead('Yoga studio retail shelf', 'Flow Yoga', 'studio@flowyoga.jp', 'Contacted', 'Instagram', 180_000, u.hana, '2026-10-07', false, 2, ['Cleanser']),
    lead('Corporate year-end gifts', 'Tanaka Trading', 'soumu@tanaka-trading.jp', 'Qualified', 'Website', 1_100_000, u.rina, '2026-10-16', false, 4, ['Gift set']),
    lead('Online select shop', 'Hinata Store', 'buy@hinata.store', 'New', 'Instagram', 250_000, u.minh, '2026-10-21', false, 3, ['Serum']),
    lead('Clinic aftercare kit', 'Ginza Skin Clinic', 'office@ginza-skin.jp', 'Won', 'Referral', 1_400_000, u.rina, null, false, 5, ['Cream']),
    lead('Airport duty free', 'Kansai Duty Free', 'category@kix-df.example', 'New', 'Event', 4_000_000, u.hana, '2026-10-28', true, 4, ['Gift set', 'Serum', 'Cream']),
  ]);
  await view(leads.id, 'All leads', 'grid', 0, u.hana, { widths: { [L.name]: 240, [L.notes]: 280 }, sorts: [] });
  await view(leads.id, 'Pipeline', 'kanban', 1, u.hana, { stackField: L.stage, hidden: [L.email, L.notes, L.due] });
  await view(leads.id, 'Follow-ups', 'calendar', 2, u.hana, { dateField: L.next });
  await view(leads.id, 'My hot leads', 'grid', 3, u.hana, {
    filters: { conjunction: 'and', conditions: [{ id: 'f1', fieldId: L.owner, op: 'isMe' }, { id: 'f2', fieldId: L.hot, op: 'is', value: true }] },
    sorts: [{ fieldId: L.next, dir: 'asc' }],
  });
  await view(leads.id, 'By source', 'grid', 4, u.hana, { groupBy: { fieldId: L.source, dir: 'asc' }, sorts: [{ fieldId: L.value, dir: 'desc' }] });
  await view(leads.id, 'Lead capture', 'form', 5, u.hana, {
    form: {
      title: 'Tell us about a lead',
      description: 'Met someone interested in Natural Beauty products? Add them here — Marketing follows up within two working days.',
      fields: [L.name, L.company, L.email, L.source, L.tags, L.value, L.notes],
      required: [L.name, L.company],
      open: true,
      submitText: 'Add lead',
      thanks: 'Thanks! The lead is in the tracker.',
    },
  });
  const { t: camps, id: C } = await table(leadsBase.id, 'Campaigns', 1, [
    { key: 'name', name: 'Campaign', type: 'text' },
    { key: 'channel', name: 'Channel', type: 'singleSelect', options: { choices: choices(['Instagram', 'Event', 'Email', 'Ads']) } },
    { key: 'budget', name: 'Budget', type: 'currency', options: { currency: 'JPY', precision: 0 } },
    { key: 'start', name: 'Start', type: 'date' },
    { key: 'end', name: 'End', type: 'date' },
    { key: 'leads', name: 'Leads', type: 'link', options: { tableId: leads.id } },
    { key: 'cost', name: 'Cost per lead', type: 'formula', options: { expression: 'IF(COUNTA({Leads}), ROUND({Budget} / COUNTA({Leads}), 0), BLANK())' } },
  ]);
  const byName = (n: string) => leadRows.find((r) => r.values[L.name] === n)!.id;
  await records(camps.id, C, u.hana, [
    { name: 'Autumn serum launch', channel: c('Instagram'), budget: 800_000, start: '2026-09-15', end: '2026-10-31', leads: [byName('Lumi Salon Shibuya'), byName('Yoga studio retail shelf'), byName('Online select shop')] },
    { name: 'Beauty World Japan', channel: c('Event'), budget: 1_500_000, start: '2026-09-24', end: '2026-09-26', leads: [byName('Mori Pharmacy chain'), byName('Department store pop-up'), byName('Airport duty free')] },
    { name: 'Year-end gift newsletter', channel: c('Email'), budget: 120_000, start: '2026-10-15', end: '2026-11-30', leads: [byName('Corporate year-end gifts'), byName('Aoba gift catalogue')] },
  ]);
  await view(camps.id, 'Grid view', 'grid', 0, u.hana);

  // ── Vendor List ───────────────────────────────────────────────────────────
  const vendorsBase = await ref('Vendor List');
  const { t: vendors, id: V } = await table(vendorsBase.id, 'Vendors', 0, [
    { key: 'name', name: 'Vendor', type: 'text' },
    { key: 'category', name: 'Category', type: 'singleSelect', options: { choices: choices(['Packaging', 'Ingredients', 'Logistics', 'Cleaning', 'IT']) } },
    { key: 'contact', name: 'Contact', type: 'text' },
    { key: 'email', name: 'Email', type: 'email' },
    { key: 'phone', name: 'Phone', type: 'phone' },
    { key: 'spend', name: 'Annual spend', type: 'currency', options: { currency: 'JPY', precision: 0 } },
    { key: 'end', name: 'Contract ends', type: 'date' },
    { key: 'rating', name: 'Rating', type: 'rating', options: { max: 5 } },
    { key: 'preferred', name: 'Preferred', type: 'checkbox' },
    { key: 'site', name: 'Website', type: 'url' },
    { key: 'renew', name: 'Renew in (days)', type: 'formula', options: { expression: "DATETIME_DIFF({Contract ends}, TODAY(), 'days')" } },
  ]);
  await records(vendors.id, V, u.mika, [
    { name: 'Kaori Print', category: c('Packaging'), contact: 'Sato Kenji', email: 'sato@kaori-print.jp', phone: '06-6123-4567', spend: 4_800_000, end: '2027-03-31', rating: 5, preferred: true, site: 'https://kaori-print.example' },
    { name: 'Nishi Botanicals', category: c('Ingredients'), contact: 'Nishi Aya', email: 'aya@nishi-bot.jp', phone: '075-222-1100', spend: 12_500_000, end: '2026-12-31', rating: 4, preferred: true, site: 'https://nishi-botanicals.example' },
    { name: 'Swift Logistics', category: c('Logistics'), contact: 'Ito Daisuke', email: 'ito@swiftlog.jp', phone: '06-6987-0001', spend: 3_200_000, end: '2026-11-15', rating: 3, site: 'https://swiftlog.example' },
    { name: 'Sora Cleaning', category: c('Cleaning'), contact: 'Mori Yui', email: 'ops@sora-clean.jp', phone: '06-6555-7788', spend: 960_000, end: '2027-06-30', rating: 4, preferred: true },
    { name: 'Ume Tech', category: c('IT'), contact: 'Ume Takashi', email: 'support@ume.tech', phone: '03-5555-0101', spend: 1_440_000, end: '2026-10-31', rating: 3, site: 'https://ume.tech' },
    { name: 'Glass & Jar Co', category: c('Packaging'), contact: 'Hayashi Rin', email: 'rin@glassjar.jp', phone: '072-333-4444', spend: 2_100_000, end: '2027-01-31', rating: 4 },
    { name: 'Okinawa Sea Minerals', category: c('Ingredients'), contact: 'Higa Ren', email: 'ren@sea-minerals.jp', phone: '098-111-2222', spend: 5_600_000, end: '2027-09-30', rating: 5, preferred: true },
  ]);
  await view(vendors.id, 'All vendors', 'grid', 0, u.mika, { sorts: [{ fieldId: V.spend, dir: 'desc' }] });
  await view(vendors.id, 'By category', 'kanban', 1, u.mika, { stackField: V.category });
  await view(vendors.id, 'Renewals', 'calendar', 2, u.mika, { dateField: V.end });
}

