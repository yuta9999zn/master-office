import { sql } from 'drizzle-orm';
import type { ResourceType, Role } from '@workos/shared';
import { StorageService } from '../storage/storage.service';
import { createDb } from './client';
import * as s from './schema';
import { SEED_DOCS, seedDocState } from './seed-docs';
import { blankWorkbook, SEED_SHEETS, seedSheetState } from './seed-sheets';
import { blankDeck, SEED_DECKS, seedDeckState } from './seed-slides';
import { blankForm } from '@workos/form-model';
import { blankFlow, bookingFlow, writeFlow } from '@workos/flow-model';
import * as Y from 'yjs';
import { SEED_FORMS, seedFormState, surveyResponses } from './seed-forms';
import { q4StrategyNote, seedNoteState, simpleNote } from './seed-notes';
import { seedChat } from './seed-chat';
import { seedMail } from './seed-mail';
import { seedCalendar } from './seed-calendar';
import { seedTasks } from './seed-tasks';
import { seedMeetings } from './seed-meetings';
import { seedApprovals } from './seed-approvals';
import { seedBase } from './seed-base';
import { config } from '../config';

/**
 * Demo data mirroring the UI reference screens: the KAORI organisation with the
 * Natural Beauty space tree (Marketing, Operations, HR, Finance, Branch 575/625/S2),
 * ITM Japan and KAORI Brand. Idempotent: wipes app tables first.
 */
async function main() {
  const { db, pool } = createDb();
  const storage = new StorageService();
  await storage.ensureBucket();

  await db.execute(sql`TRUNCATE resource_links, comments, resource_assets, ydoc_states, outbox, audit_events, resource_access, stars, acl_entries, resource_versions,
    resources, blobs, space_members, spaces, workspace_members, workspaces, users CASCADE`);

  // Order matters: the first user is the default dev identity.
  const people = [
    ['claudia', 'Claudia Chen', '#2563eb', 'Operations Director', 'Operations'],
    ['hana', 'Hana Lee', '#ec4899', 'Marketing Lead', 'Marketing'],
    ['mika', 'Mika Tanaka', '#8b5cf6', 'Branch Operations', 'Operations'],
    ['yuki', 'Yuki Sato', '#14b8a6', 'Branch Manager 575', 'Branch 575'],
    ['sora', 'Sora Ito', '#f59e0b', 'Branch Manager 625', 'Branch 625'],
    ['rina', 'Rina Kato', '#ef4444', 'HR Partner', 'HR'],
    ['fujita', 'Fujita Sota', '#0ea5e9', 'Project Manager', 'ITM Japan'],
    ['ken', 'Ken Watanabe', '#10b981', 'Store Support', 'Operations'],
    ['huong', 'Nguyễn Thu Hương', '#6366f1', 'Finance Controller', 'Finance'],
    ['minh', 'Nguyễn Minh', '#f97316', 'Designer', 'KAORI Brand'],
  ] as const;
  type Who = (typeof people)[number][0];
  const inserted = await db
    .insert(s.users)
    .values(people.map(([key, name, avatarColor, title, department]) => ({ name, email: `${key}@kaori.jp`, avatarColor, title, department })))
    .returning();
  const u = Object.fromEntries(inserted.map((x) => [x.email.split('@')[0], x])) as Record<Who, (typeof inserted)[number]>;

  const [ws] = await db.insert(s.workspaces).values({ name: 'KAORI', slug: 'kaori' }).returning();
  await db
    .insert(s.workspaceMembers)
    .values(inserted.map((x) => ({ workspaceId: ws.id, userId: x.id, role: (x.id === u.claudia.id ? 'owner' : 'editor') as Role })));

  // Profiles for Contacts (§67), mirroring the "Hồ sơ người dùng" reference (Fujita, ITM Japan).
  const profiles: Record<Who, { phone: string; location: string; skills: string[]; manager?: Who; status?: string; joined: string }> = {
    claudia: { phone: '+81 90-1111-0001', location: 'Tokyo, Japan', skills: ['Leadership', 'Operations', 'Strategy'], status: 'Focus time until 11:00', joined: '2022-04-01' },
    hana: { phone: '+84 90-555-0102', location: 'Ho Chi Minh City, Vietnam', skills: ['Marketing', 'Design', 'SNS'], manager: 'claudia', joined: '2023-02-13' },
    mika: { phone: '+81 80-2222-0103', location: 'Osaka, Japan', skills: ['Operations', 'Management'], manager: 'claudia', joined: '2022-09-01' },
    yuki: { phone: '+81 80-3333-0104', location: 'Branch 575, Tokyo', skills: ['Customer Support', 'Sales'], manager: 'mika', joined: '2023-06-05' },
    sora: { phone: '+81 80-4444-0105', location: 'Branch 625, Tokyo', skills: ['Operations', 'Logistics'], manager: 'mika', joined: '2023-07-10' },
    rina: { phone: '+81 90-5555-0106', location: 'Tokyo, Japan', skills: ['HR', 'Recruitment'], manager: 'claudia', joined: '2022-11-21' },
    fujita: { phone: '+81 90-1234-5678', location: 'Tokyo, Japan', skills: ['Management', 'Project', 'Japanese'], manager: 'claudia', status: 'よろしくお願いします。', joined: '2024-01-15' },
    ken: { phone: '+81 70-6666-0108', location: 'Tokyo, Japan', skills: ['Engineering', 'System', 'Inventory'], manager: 'mika', joined: '2024-03-04' },
    huong: { phone: '+84 91-777-0109', location: 'Hanoi, Vietnam', skills: ['Finance', 'Accounting'], manager: 'claudia', joined: '2026-09-28' },
    minh: { phone: '+84 93-888-0110', location: 'Ho Chi Minh City, Vietnam', skills: ['Design', 'Branding'], manager: 'hana', joined: '2024-05-20' },
  };
  for (const [who, p] of Object.entries(profiles) as [Who, (typeof profiles)[Who]][]) {
    await db
      .update(s.users)
      .set({ phone: p.phone, location: p.location, skills: p.skills, status: p.status ?? null, managerId: p.manager ? u[p.manager].id : null })
      .where(sql`id = ${u[who].id}`);
    await db.update(s.workspaceMembers).set({ joinedAt: new Date(p.joined).toISOString() }).where(sql`user_id = ${u[who].id}`);
  }

  // ── Spaces ────────────────────────────────────────────────────────────────
  const sp: Record<string, typeof s.spaces.$inferSelect> = {};
  async function space(
    name: string,
    description: string,
    color: string,
    icon: string,
    owner: Who,
    opts: { parent?: string; visibility?: 'public' | 'private'; members?: [Who, Role][] } = {},
  ) {
    const [row] = await db
      .insert(s.spaces)
      .values({
        workspaceId: ws.id,
        parentId: opts.parent ? sp[opts.parent].id : null,
        name,
        description,
        icon,
        color,
        visibility: opts.visibility ?? 'public',
        createdBy: u[owner].id,
      })
      .returning();
    sp[name] = row;
    const members = new Map<Who, Role>([[owner, 'owner']]);
    if (owner !== 'claudia') members.set('claudia', 'admin');
    for (const [who, role] of opts.members ?? []) if (!members.has(who)) members.set(who, role);
    await db.insert(s.spaceMembers).values([...members].map(([who, role]) => ({ spaceId: row.id, userId: u[who].id, role })));
  }
  const everyone = people.map((p) => p[0]);
  await space('Natural Beauty', 'Shared knowledge, files, announcements, and team resources. Work together to build a better, more beautiful tomorrow.', '#f43f5e', 'flower', 'claudia', {
    members: everyone.map((w) => [w, ['hana', 'mika', 'ken'].includes(w) ? 'editor' : 'viewer'] as [Who, Role]),
  });
  await space('Marketing', 'Campaign materials, brand assets, and marketing plans', '#2563eb', 'megaphone', 'hana', {
    parent: 'Natural Beauty',
    members: [['mika', 'editor'], ['yuki', 'commenter'], ['sora', 'commenter'], ['minh', 'editor']],
  });
  await space('Operations', 'Store operations, SOPs and checklists', '#f59e0b', 'settings', 'mika', {
    parent: 'Natural Beauty',
    members: [['yuki', 'editor'], ['sora', 'editor'], ['ken', 'editor']],
  });
  await space('HR', 'Recruitment, onboarding and HR policies', '#ec4899', 'users', 'rina', { parent: 'Natural Beauty', visibility: 'private' });
  await space('Finance', 'Budgets and financial reports', '#8b5cf6', 'landmark', 'huong', {
    parent: 'Natural Beauty',
    visibility: 'private',
    members: [['hana', 'viewer']],
  });
  await space('Branch 575', 'Main branch', '#10b981', 'store', 'yuki', { parent: 'Natural Beauty', members: [['mika', 'editor']] });
  await space('Branch 625', 'Station branch', '#ef4444', 'store', 'sora', { parent: 'Natural Beauty', members: [['mika', 'editor'], ['rina', 'commenter']] });
  await space('Branch S2', 'New branch', '#0ea5e9', 'store', 'mika', { parent: 'Natural Beauty' });
  await space('ITM Japan', 'ITM Japan project workspace — booking system and website', '#7c3aed', 'building', 'fujita', {
    members: [['claudia', 'editor'], ['minh', 'editor'], ['mika', 'editor']],
  });
  await space('KAORI Brand', 'Brand identity, design system and assets', '#0f172a', 'sparkles', 'minh', { members: [['hana', 'editor']] });

  // The organisation chart (§79): what each space is, and people's positions — one person, several teams and positions.
  const kinds: Record<string, string> = { 'Natural Beauty': 'general', Marketing: 'department', Operations: 'department', HR: 'department', Finance: 'department', 'Branch 575': 'team', 'Branch 625': 'team', 'Branch S2': 'team', 'ITM Japan': 'project', 'KAORI Brand': 'team' };
  for (const [name, kind] of Object.entries(kinds)) await db.update(s.spaces).set({ kind }).where(sql`id = ${sp[name].id}`);
  const positions: [string, Who, string][] = [
    ['Natural Beauty', 'claudia', 'CEO'],
    ['Marketing', 'hana', 'Head of Marketing'],
    ['Marketing', 'minh', 'Designer'],
    ['Marketing', 'mika', 'Campaign support'],
    ['Operations', 'mika', 'Head of Operations'],
    ['Operations', 'yuki', 'Store lead'],
    ['Operations', 'ken', 'Systems & inventory'],
    ['HR', 'rina', 'HR Partner'],
    ['Finance', 'huong', 'Finance Controller'],
    ['Branch 575', 'yuki', 'Branch Manager'],
    ['Branch 575', 'mika', 'Area Manager'],
    ['Branch 625', 'sora', 'Branch Manager'],
    ['Branch 625', 'mika', 'Area Manager'],
    ['ITM Japan', 'fujita', 'Project Manager'],
    ['ITM Japan', 'minh', 'UI Designer'],
    ['ITM Japan', 'mika', 'Business Analyst'],
    ['ITM Japan', 'claudia', 'Sponsor'],
    ['KAORI Brand', 'minh', 'Brand Lead'],
    ['KAORI Brand', 'hana', 'Marketing liaison'],
  ];
  for (const [name, who, title] of positions) await db.update(s.spaceMembers).set({ title }).where(sql`space_id = ${sp[name].id} AND user_id = ${u[who].id}`);

  // ── Resources ─────────────────────────────────────────────────────────────
  let clock = Date.now() - 1000 * 60 * 60 * 24 * 13;
  const tick = () => new Date((clock += 1000 * 60 * 20 + Math.floor(Math.random() * 1000 * 60 * 250))).toISOString();

  type Node = { id: string; path: string[]; spaceId: string | null };
  async function add(
    name: string,
    type: ResourceType,
    owner: Who,
    at: Node | string | null,
    extra: Partial<typeof s.resources.$inferInsert> = {},
  ): Promise<Node> {
    const parent = at && typeof at === 'object' ? at : null;
    const spaceId = typeof at === 'string' ? sp[at].id : parent?.spaceId ?? null;
    const when = tick();
    const id = crypto.randomUUID();
    const [row] = await db
      .insert(s.resources)
      .values({
        id,
        workspaceId: ws.id,
        spaceId,
        parentId: parent?.id ?? null,
        name,
        type,
        ownerId: u[owner].id,
        updatedBy: u[owner].id,
        createdAt: when,
        updatedAt: when,
        path: parent ? [...parent.path, parent.id] : [],
        contentRef: ['document', 'spreadsheet', 'presentation', 'wiki', 'base', 'form', 'flow'].includes(type) ? `res:${id}` : null,
        ...extra,
      })
      .returning();
    await db.insert(s.auditEvents).values({
      workspaceId: ws.id,
      actorId: u[owner].id,
      action: 'resource.created',
      resourceId: row.id,
      spaceId: row.spaceId,
      data: { name, type },
      createdAt: when,
    });
    return { id: row.id, path: row.path, spaceId: row.spaceId };
  }

  async function addBlob(
    name: string,
    owner: Who,
    at: Node | string | null,
    content: string,
    mime: string,
    extra: Partial<typeof s.resources.$inferInsert> = {},
  ) {
    const buf = Buffer.from(content, 'utf8');
    const sha = StorageService.sha256(buf);
    const key = await storage.putBlob(buf, sha, mime);
    const [blob] = await db
      .insert(s.blobs)
      .values({ sha256: sha, sizeBytes: buf.length, mimeType: mime, storageKey: key })
      .onConflictDoUpdate({ target: s.blobs.sha256, set: { sha256: sha } })
      .returning();
    const type: ResourceType =
      mime === 'text/csv' ? 'spreadsheet' : mime === 'application/pdf' ? 'pdf' : mime.startsWith('image/') ? 'image' : 'file';
    return add(name, type, owner, at, { blobId: blob.id, sizeBytes: buf.length, mimeType: mime, ...extra });
  }

  const art = (a: string, b: string, label: string) =>
    `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="800" height="600" fill="url(#g)"/><circle cx="600" cy="170" r="120" fill="#fff" opacity=".25"/><circle cx="200" cy="470" r="170" fill="#fff" opacity=".15"/><text x="60" y="540" font-family="Inter,Arial" font-size="44" font-weight="700" fill="#fff">${label}</text></svg>`;
  const pdf = (title: string) => {
    const stream = `BT /F1 28 Tf 60 760 Td (${title}) Tj ET`;
    return `%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n4 0 obj<</Length ${stream.length}>>stream\n${stream}\nendstream endobj\n5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n`;
  };

  // Natural Beauty (root space)
  const manual = await add('Operations Manual', 'folder', 'mika', 'Natural Beauty', { description: 'Store opening/closing and daily operations' });
  await add('Store Opening Checklist', 'document', 'mika', manual);
  await add('Daily Closing Procedure', 'document', 'mika', manual);
  const templates = await add('Store Templates', 'folder', 'ken', 'Natural Beauty');
  await add('Weekly Report Template', 'document', 'ken', templates);
  await add('Inventory Template', 'spreadsheet', 'ken', templates);
  await add('Branch Operation Plan - October 2026', 'document', 'claudia', 'Natural Beauty', {
    description: 'Key operation plan, targets and action items for all branches',
    tags: ['Operations', 'Q4'],
  });
  await add('Store Performance Tracker', 'spreadsheet', 'mika', 'Natural Beauty', { tags: ['KPI'] });
  await add('Q4 Campaign Plan', 'document', 'claudia', 'Natural Beauty', { tags: ['Campaign'] });
  await add('Brand Guidelines.pptx', 'presentation', 'ken', 'Natural Beauty');
  for (const [name, desc] of [
    ['Branch Operation Guide', 'Store opening/closing, daily operations, and more'],
    ['FAQ for Store Operations', 'Common questions and answers'],
    ['New Store Launch Checklist', 'Step-by-step checklist for new stores'],
    ['Customer Service Guidelines', 'Service standards and best practices'],
    ['Company Introduction', 'Our mission, culture, and key information'],
    ['System User Guide', 'How to use internal systems and tools'],
  ] as const) {
    await add(name, 'wiki', 'claudia', 'Natural Beauty', { description: desc });
  }

  // Marketing
  await add('01_Brand Assets', 'folder', 'hana', 'Marketing');
  const campaign = await add('02_Campaign', 'folder', 'mika', 'Marketing');
  await add('03_SNS Materials', 'folder', 'yuki', 'Marketing');
  await add('04_Ads', 'folder', 'sora', 'Marketing');
  await add('05_Design Source', 'folder', 'rina', 'Marketing');
  const c2026 = await add('Campaign 2026', 'folder', 'hana', campaign);
  await add('01_Creative', 'folder', 'hana', c2026);
  await add('02_Content', 'folder', 'mika', c2026);
  await add('Campaign Plan', 'document', 'hana', c2026);
  await add('Social Media Calendar', 'spreadsheet', 'rina', c2026);
  await add('Video Script', 'document', 'hana', c2026);
  await add('Marketing Plan - Q4 2026', 'document', 'hana', 'Marketing', { tags: ['Marketing', 'Q4'], description: 'Q4 marketing plan for Natural Beauty' });
  await add('Sales Report - September 2026', 'spreadsheet', 'mika', 'Marketing', { tags: ['Sales'] });
  await add('Campaign Proposal', 'presentation', 'yuki', 'Marketing', { tags: ['Campaign'] });
  await add('Q4 Marketing Strategy - October 2026', 'presentation', 'hana', 'Marketing', { tags: ['Marketing', 'Strategy'] });
  await addBlob('Brand Guideline.pdf', 'sora', 'Marketing', pdf('Natural Beauty - Brand Guideline'), 'application/pdf', { tags: ['Brand'] });
  await add('SNS Content Calendar', 'spreadsheet', 'rina', 'Marketing');
  const images = await add('Product Images', 'folder', 'hana', 'Marketing');
  await addBlob('Serum Bottle.svg', 'hana', images, art('#fda4af', '#f472b6', 'Serum Bottle'), 'image/svg+xml');
  await addBlob('Cream Jar.svg', 'hana', images, art('#fcd34d', '#fb923c', 'Cream Jar'), 'image/svg+xml');
  await addBlob('Autumn Banner.svg', 'minh', images, art('#60a5fa', '#8b5cf6', 'Autumn Sale 2026'), 'image/svg+xml');
  await add('Lead Tracker', 'base', 'hana', 'Marketing');
  await add('Event Registration', 'form', 'hana', 'Marketing');
  await add('Customer Booking Approval Workflow', 'flow', 'claudia', 'Natural Beauty', { tags: ['Booking'] });
  await add('Lead Handling Flow', 'flow', 'hana', 'Marketing');
  await add('Customer Satisfaction Survey', 'form', 'mika', 'Natural Beauty', { tags: ['Customers'] });

  // Operations / Branches
  const sop = await add('SOP', 'folder', 'mika', 'Operations');
  await add('Branch SOP', 'document', 'mika', sop, { description: 'Standard operating procedures' });
  await add('Inventory Checklist', 'spreadsheet', 'ken', sop);
  await add('Vendor List', 'base', 'mika', 'Operations');
  await addBlob('Store Layout.svg', 'ken', 'Operations', art('#34d399', '#0ea5e9', 'Store Layout'), 'image/svg+xml');
  for (const [b, owner] of [['Branch 575', 'yuki'], ['Branch 625', 'sora'], ['Branch S2', 'mika']] as const) {
    const f = await add('Weekly Reports', 'folder', owner, b);
    await add(`${b} — Week 39 Report`, 'document', owner, f);
    await add(`Branch Plan ${b.replace('Branch ', '')}`, 'document', owner, b);
    await add(`${b} Staff Schedule`, 'spreadsheet', owner, b);
  }

  // HR / Finance
  await add('HR Manual', 'document', 'rina', 'HR', { description: 'Company policies and guidelines' });
  await add('Recruitment Plan Q4', 'spreadsheet', 'rina', 'HR');
  await add('New Employee Onboarding Guide', 'wiki', 'rina', 'HR');
  const reports = await add('Reports', 'folder', 'huong', 'Finance');
  await add('Sales Report - September', 'spreadsheet', 'huong', reports, { tags: ['Sales', 'Monthly'] });
  await addBlob(
    'Revenue September 2026.csv',
    'huong',
    reports,
    'Branch,Month,Revenue,Cost\nBranch 575,2026-09,1250000,830000\nBranch 625,2026-09,980000,640000\nBranch S2,2026-09,1410000,910000\n',
    'text/csv',
  );
  await add('Budget 2027', 'spreadsheet', 'huong', 'Finance');

  // ITM Japan / KAORI Brand
  await add('Project Plan Sep.pptx', 'presentation', 'fujita', 'ITM Japan');
  await add('Booking System Requirements', 'document', 'fujita', 'ITM Japan');
  await add('Website Revamp Timeline', 'spreadsheet', 'fujita', 'ITM Japan');
  await add('Product Roadmap', 'document', 'fujita', 'ITM Japan');
  await add('Brand Kit', 'presentation', 'minh', 'KAORI Brand');
  await addBlob('Logo Concepts.svg', 'minh', 'KAORI Brand', art('#2563eb', '#8b5cf6', 'Master Office'), 'image/svg+xml');

  // Claudia's My Files + direct shares
  const drafts = await add('Drafts', 'folder', 'claudia', null);
  await add('Team Meeting Notes', 'document', 'claudia', drafts);
  await add('Branch KPI', 'spreadsheet', 'claudia', null);
  await addBlob('readme.txt', 'claudia', null, 'Master Office — demo file stored in object storage.\n', 'text/plain');
  const proposal = await add('New Branch Proposal', 'document', 'mika', null);
  const compare = await add('Location Comparison', 'spreadsheet', 'mika', null);
  const hrTracking = await add('HR Tracking', 'spreadsheet', 'rina', null);
  await db.insert(s.aclEntries).values([
    { resourceId: proposal.id, principalType: 'user', principalId: u.claudia.id, role: 'editor', createdBy: u.mika.id },
    { resourceId: compare.id, principalType: 'user', principalId: u.claudia.id, role: 'commenter', createdBy: u.mika.id },
    { resourceId: hrTracking.id, principalType: 'user', principalId: u.claudia.id, role: 'viewer', createdBy: u.rina.id },
  ]);

  // Favourites & recents for the default user (Claudia), matching the reference sidebar.
  const byName = async (name: string) => (await db.execute<{ id: string }>(sql`SELECT id FROM resources WHERE name = ${name} LIMIT 1`)).rows[0].id;
  for (const name of ['Branch Operation Plan - October 2026', 'Sales Report - September', 'Q4 Marketing Strategy - October 2026', 'HR Manual', 'Product Roadmap', 'Team Meeting Notes']) {
    await db.insert(s.stars).values({ userId: u.claudia.id, resourceId: await byName(name) });
  }
  const recents = [
    'Branch Operation Plan - October 2026',
    'Sales Report - September 2026',
    'Q4 Marketing Strategy - October 2026',
    'Brand Guideline.pdf',
    'Store Performance Tracker',
    'Campaign Proposal',
    'Team Meeting Notes',
    'Branch KPI',
  ];
  for (const [i, name] of recents.entries()) {
    await db.insert(s.resourceAccess).values({ userId: u.claudia.id, resourceId: await byName(name), accessedAt: new Date(Date.now() - i * 2_700_000).toISOString() });
  }

  // Rich content for a few documents (the collaborative model, as the editor would have saved it).
  for (const [name, json] of Object.entries(SEED_DOCS)) {
    const id = await byName(name);
    const { state, text } = seedDocState(json);
    await db.insert(s.ydocStates).values({ resourceId: id, state });
    await db.update(s.resources).set({ sizeBytes: state.length, contentText: text }).where(sql`id = ${id}`);
  }

  // Spreadsheets (Phase 3): every native spreadsheet gets its workbook; a few carry real data and formulas.
  const sheetRows = (await db.execute<{ id: string; name: string }>(sql`SELECT id, name FROM resources WHERE type = 'spreadsheet' AND blob_id IS NULL`)).rows;
  for (const r of sheetRows) {
    const { state, text } = seedSheetState((SEED_SHEETS[r.name] ?? (() => blankWorkbook(r.name)))());
    await db.insert(s.ydocStates).values({ resourceId: r.id, state });
    await db.update(s.resources).set({ sizeBytes: state.length, contentText: text }).where(sql`id = ${r.id}`);
  }

  // Presentations (Phase 4): every native presentation gets its deck; the Q4 strategy deck matches the reference screen.
  const deckRows = (await db.execute<{ id: string; name: string }>(sql`SELECT id, name FROM resources WHERE type = 'presentation' AND blob_id IS NULL`)).rows;
  for (const r of deckRows) {
    const { state, text, slideCount } = seedDeckState((SEED_DECKS[r.name] ?? (() => blankDeck(r.name)))());
    await db.insert(s.ydocStates).values({ resourceId: r.id, state });
    await db
      .update(s.resources)
      .set({ sizeBytes: state.length, contentText: text, metadata: sql`${s.resources.metadata} || ${JSON.stringify({ slideCount })}::jsonb` })
      .where(sql`id = ${r.id}`);
  }

  // Flows (§77): the booking workflow from the reference design; others start blank.
  const flowRows = (await db.execute<{ id: string; name: string }>(sql`SELECT id, name FROM resources WHERE type = 'flow'`)).rows;
  for (const r of flowRows) {
    const doc = new Y.Doc();
    const flow = r.name === 'Customer Booking Approval Workflow' ? bookingFlow() : blankFlow();
    writeFlow(doc, flow);
    const state = Buffer.from(Y.encodeStateAsUpdate(doc));
    await db.insert(s.ydocStates).values({ resourceId: r.id, state });
    await db.update(s.resources).set({ sizeBytes: state.length, contentText: flow.nodes.map((n) => n.text).join(' · ') }).where(sql`id = ${r.id}`);
  }

  // Forms (Phase 8): every native form gets its definition; the survey also gets a few responses.
  const formRows = (await db.execute<{ id: string; name: string }>(sql`SELECT id, name FROM resources WHERE type = 'form' AND blob_id IS NULL`)).rows;
  for (const r of formRows) {
    const form = (SEED_FORMS[r.name] ?? (() => blankForm(r.name)))();
    const { state, text, questionCount } = seedFormState(form);
    await db.insert(s.ydocStates).values({ resourceId: r.id, state });
    await db
      .update(s.resources)
      .set({ sizeBytes: state.length, contentText: text, metadata: sql`${s.resources.metadata} || ${JSON.stringify({ questionCount })}::jsonb` })
      .where(sql`id = ${r.id}`);
    if (r.name === 'Customer Satisfaction Survey') {
      const who = [u.hana, u.yuki, u.sora, u.mika, u.rina];
      for (const [i, answers] of surveyResponses(form).entries()) {
        await db.insert(s.formResponses).values({ formId: r.id, respondentId: who[i].id, email: null, answers, score: null, editToken: crypto.randomUUID().replace(/-/g, ''), submittedAt: new Date(Date.now() - (5 - i) * 86_400_000).toISOString() });
      }
    }
  }

  // Notes & Mind Map (Phase 2b), matching the reference screen.
  const ref = async (name: string) => {
    const [r] = (await db.execute<{ id: string; name: string; type: string }>(sql`SELECT id, name, type FROM resources WHERE name = ${name} LIMIT 1`)).rows;
    return { id: r.id, name: r.name, type: r.type };
  };
  const addNote = async (name: string, owner: Who, notebook: string, tags: string[], json: ReturnType<typeof simpleNote>, stickies: Parameters<typeof seedNoteState>[2] = []) => {
    const node = await add(name, 'note', owner, 'Natural Beauty', { tags, metadata: { notebook } });
    const { state, text, links } = seedNoteState(name, json, stickies);
    await db.insert(s.ydocStates).values({ resourceId: node.id, state });
    await db.update(s.resources).set({ sizeBytes: state.length, contentText: text }).where(sql`id = ${node.id}`);
    if (links.length) await db.insert(s.resourceLinks).values(links.map((l) => ({ sourceId: node.id, targetId: l.id, kind: l.kind })));
    return { id: node.id, name, type: 'note' };
  };
  const q4 = await addNote(
    'Q4 Strategy Notes',
    'claudia',
    'Projects/Q4 Strategy',
    ['Strategy', 'Product', 'Marketing', 'Q4', 'Growth'],
    q4StrategyNote(
      { brandPdf: await ref('Brand Guideline.pdf'), marketingPlan: await ref('Marketing Plan - Q4 2026'), roadmap: await ref('Product Roadmap') },
      { hana: u.hana.id, fujita: u.fujita.id, mika: u.mika.id, ken: u.ken.id },
    ),
    [
      { text: 'Focus on user feedback and iteration!', color: '#fef08a', x: 250, y: 330 },
      { text: 'Explore partnership opportunities', color: '#fbcfe8', x: 470, y: 380 },
    ],
  );
  await addNote('2026 Annual Plan', 'claudia', 'Projects/Q4 Strategy', ['Strategy'], simpleNote('Annual priorities', ['Grow revenue 25% year over year', 'Open two new branches', 'Launch the loyalty programme'], [q4]));
  await addNote('Product Development Notes', 'mika', 'Projects/Product Development', ['Product'], simpleNote('Roadmap review', ['v2.0 scope frozen', 'Beta with Branch 575 in October'], [q4, await ref('Product Roadmap')]));
  await addNote('Marketing Sync — Sep 28', 'hana', 'Meeting Notes', ['Marketing', 'Team'], simpleNote('Agenda', ['Autumn campaign results', 'SNS content calendar', 'Budget for Q4 ads']));
  await addNote('Weekly Ops Standup — Sep 29', 'mika', 'Meeting Notes', ['Team'], simpleNote('Notes', ['Inventory check moved to Monday', 'New hires start Oct 5']));
  await addNote('Idea: loyalty app', 'claudia', 'Inbox', ['Product'], simpleNote('Idea', ['Points for repeat visits', 'Referral rewards']));
  await addNote('Supplier call follow-ups', 'claudia', 'Inbox', ['Finance'], simpleNote('Follow-ups', ['Ask for Q4 price list', 'Confirm delivery windows']));
  await addNote('How we run branch audits', 'mika', 'Knowledge Base', ['Team'], simpleNote('Audit steps', ['Checklist before opening', 'Cash reconciliation', 'Photo report to Operations']));
  await db.insert(s.stars).values({ userId: u.claudia.id, resourceId: q4.id }).onConflictDoNothing();
  await db.insert(s.resourceAccess).values({ userId: u.claudia.id, resourceId: q4.id }).onConflictDoNothing();

  await seedChat(db, ws.id, u, (name) => sp[name].id, async (name) => (await ref(name)).id);
  await seedMail(db, storage, ws.id, u, (name) => sp[name].id);
  await seedCalendar(db, ws.id, u, (name) => sp[name].id, async (name) => (await ref(name)).id, config.webOrigin);
  await seedTasks(db, ws.id, u, (name) => sp[name].id);
  await seedMeetings(db, ws.id, u);
  await seedApprovals(db, ws.id, u);
  await seedBase(db, u, ref);

  await pool.end();
  console.log(`✓ seeded ${inserted.length} users, ${Object.keys(sp).length} spaces`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
