import type { ApprovalField, ApprovalRouteStep, ApprovalStep } from '@workos/shared';
import type { Db } from './client';
import * as s from './schema';

type User = typeof s.users.$inferSelect;

/**
 * Approvals demo data (§74): the usual templates of a company — leave, expenses, purchases, business trips and a
 * general request — and a few requests in every state.
 */
export async function seedApprovals(db: Db, workspaceId: string, u: Record<string, User>) {
  const tpl = async (position: number, t: { name: string; description: string; category: string; icon: string; color: string; fields: ApprovalField[]; steps: ApprovalStep[]; admins?: string[]; onApproved?: { calendarOoo: { fieldId: string } } }) => {
    const [row] = await db
      .insert(s.approvalTemplates)
      .values({ workspaceId, position, createdBy: u.claudia.id, ...t, admins: t.admins ?? [], onApproved: t.onApproved ?? null })
      .returning();
    return row;
  };
  const manager = (id: string, name = 'Manager'): ApprovalStep => ({ id, name, type: 'approve', approvers: { kind: 'manager', level: 1 }, mode: 'or', condition: null });

  const leave = await tpl(0, {
    name: 'Leave request',
    description: 'Annual, sick or unpaid leave. Approved leave goes into your calendar as Out of office.',
    category: 'HR',
    icon: 'calendar-off',
    color: '#10b981',
    admins: [u.rina.id],
    fields: [
      { id: 'type', type: 'select', label: 'Leave type', required: true, options: ['Annual leave', 'Sick leave', 'Unpaid leave', 'Other'] },
      { id: 'dates', type: 'daterange', label: 'Dates', required: true },
      { id: 'reason', type: 'textarea', label: 'Reason', required: false },
      { id: 'cover', type: 'person', label: 'Who covers for you', required: false },
      { id: 'files', type: 'files', label: 'Attachments', required: false },
    ],
    steps: [
      manager('s1'),
      { id: 's2', name: 'HR review', type: 'approve', approvers: { kind: 'users', userIds: [u.rina.id] }, mode: 'or', condition: { fieldId: 'dates', op: 'gt', value: 3 } },
      { id: 's3', name: 'Notify HR', type: 'cc', approvers: { kind: 'users', userIds: [u.rina.id] }, mode: 'or', condition: null },
    ],
    onApproved: { calendarOoo: { fieldId: 'dates' } },
  });
  const expense = await tpl(1, {
    name: 'Expense reimbursement',
    description: 'Get paid back for business expenses. Attach the receipts.',
    category: 'Finance',
    icon: 'receipt',
    color: '#f59e0b',
    admins: [u.huong.id],
    fields: [
      { id: 'type', type: 'select', label: 'Expense type', required: true, options: ['Travel', 'Meals', 'Supplies', 'Software', 'Other'] },
      { id: 'amount', type: 'money', label: 'Amount', required: true, currency: 'JPY' },
      { id: 'date', type: 'date', label: 'Date of expense', required: true },
      { id: 'description', type: 'textarea', label: 'Description', required: true },
      { id: 'receipts', type: 'files', label: 'Receipts', required: false },
    ],
    steps: [manager('s1'), { id: 's2', name: 'Finance', type: 'approve', approvers: { kind: 'users', userIds: [u.huong.id] }, mode: 'or', condition: { fieldId: 'amount', op: 'gte', value: 50000 } }],
  });
  const purchase = await tpl(2, {
    name: 'Purchase request',
    description: 'Equipment, supplies and services. Large purchases also need the director and finance.',
    category: 'Operations',
    icon: 'shopping-cart',
    color: '#8b5cf6',
    fields: [
      { id: 'item', type: 'text', label: 'Item', required: true },
      { id: 'qty', type: 'number', label: 'Quantity', required: true, unit: 'pcs' },
      { id: 'cost', type: 'money', label: 'Estimated cost', required: true, currency: 'JPY' },
      { id: 'vendor', type: 'text', label: 'Vendor', required: false },
      { id: 'needed', type: 'date', label: 'Needed by', required: false },
      { id: 'reason', type: 'textarea', label: 'Why', required: true },
    ],
    steps: [
      manager('s1'),
      { id: 's2', name: 'Director and Finance', type: 'approve', approvers: { kind: 'users', userIds: [u.claudia.id, u.huong.id] }, mode: 'and', condition: { fieldId: 'cost', op: 'gte', value: 200000 } },
    ],
  });
  const trip = await tpl(3, {
    name: 'Business trip',
    description: 'Travel for work: where, when, why and the budget.',
    category: 'General',
    icon: 'plane',
    color: '#0ea5e9',
    fields: [
      { id: 'destination', type: 'text', label: 'Destination', required: true },
      { id: 'dates', type: 'daterange', label: 'Dates', required: true },
      { id: 'purpose', type: 'textarea', label: 'Purpose', required: true },
      { id: 'budget', type: 'money', label: 'Budget', required: true, currency: 'JPY' },
    ],
    steps: [manager('s1'), { id: 's2', name: 'Second-level manager', type: 'approve', approvers: { kind: 'manager', level: 2 }, mode: 'or', condition: { fieldId: 'budget', op: 'gte', value: 100000 } }],
  });
  const general = await tpl(4, {
    name: 'General request',
    description: 'Anything else — choose who approves it.',
    category: 'General',
    icon: 'file-check',
    color: '#2563eb',
    fields: [
      { id: 'subject', type: 'text', label: 'Subject', required: true },
      { id: 'details', type: 'textarea', label: 'Details', required: true },
      { id: 'files', type: 'files', label: 'Attachments', required: false },
    ],
    steps: [{ id: 's1', name: 'Approvers', type: 'approve', approvers: { kind: 'pick' }, mode: 'or', condition: null }],
  });

  // ── Requests ──────────────────────────────────────────────────────────────
  const day = 86400_000;
  const iso = (daysAgo: number, h = 0) => new Date(Date.now() - daysAgo * day + h * 3600_000).toISOString();
  const ymd = (daysFromNow: number) => new Date(Date.now() + daysFromNow * day).toISOString().slice(0, 10);
  let serial = 0;
  type T = { step: number; user: string; kind?: 'approve' | 'cc'; status: (typeof s.approvalTasks.$inferInsert)['status']; comment?: string; at?: string };
  const request = async (
    t: typeof leave,
    who: string,
    values: Record<string, unknown>,
    route: Omit<ApprovalRouteStep, 'type' | 'mode'>[],
    tasks: T[],
    status: 'pending' | 'approved' | 'rejected',
    submitted: string,
    currentStep: number,
    events: { actor?: string; kind: string; step?: number; body?: string; at: string; data?: Record<string, unknown> }[],
  ) => {
    const steps = t.steps as ApprovalStep[];
    const [req] = await db
      .insert(s.approvalRequests)
      .values({
        workspaceId,
        templateId: t.id,
        serial: ++serial,
        title: `${t.name} — ${u[who].name}`,
        fields: t.fields,
        values,
        route: route.map((r, i) => ({ ...r, type: steps[i].type, mode: steps[i].mode })),
        status,
        currentStep,
        submittedBy: u[who].id,
        submittedAt: submitted,
        finishedAt: status === 'pending' ? null : events.at(-1)?.at,
      })
      .returning();
    await db.insert(s.approvalTasks).values(
      tasks.map((x) => ({
        requestId: req.id,
        stepIndex: x.step,
        userId: u[x.user].id,
        kind: x.kind ?? ('approve' as const),
        status: x.status,
        comment: x.comment ?? null,
        activatedAt: x.status === 'waiting' ? null : submitted,
        actedAt: x.at ?? null,
      })),
    );
    await db.insert(s.approvalEvents).values([
      { requestId: req.id, actorId: u[who].id, kind: 'submitted', createdAt: submitted },
      ...events.map((e) => ({ requestId: req.id, actorId: e.actor ? u[e.actor].id : null, kind: e.kind, stepIndex: e.step ?? null, body: e.body ?? null, data: e.data ?? {}, createdAt: e.at })),
    ]);
  };
  const step = (stepId: string, name: string, users: string[], skipped: string | null = null) => ({ stepId, name, userIds: users.map((x) => u[x].id), skipped });

  await request(
    leave,
    'yuki',
    { type: 'Annual leave', dates: { start: ymd(8), end: ymd(11) }, reason: 'Family trip to Hokkaido.', cover: u.sora.id },
    [step('s1', 'Manager', ['mika']), step('s2', 'HR review', ['rina']), step('s3', 'Notify HR', ['rina'])],
    [
      { step: 0, user: 'mika', status: 'pending' },
      { step: 1, user: 'rina', status: 'waiting' },
      { step: 2, user: 'rina', kind: 'cc', status: 'waiting' },
    ],
    'pending',
    iso(1, -3),
    0,
    [],
  );
  await request(
    expense,
    'sora',
    { type: 'Travel', amount: 32400, date: ymd(-6), description: 'Shinkansen Tokyo ⇄ Osaka for the supplier visit.' },
    [step('s1', 'Manager', ['mika']), step('s2', 'Finance', [], 'Condition not met')],
    [{ step: 0, user: 'mika', status: 'approved', comment: 'OK, thanks for the receipts.', at: iso(4) }],
    'approved',
    iso(5),
    2,
    [
      { actor: 'mika', kind: 'approved', step: 0, body: 'OK, thanks for the receipts.', at: iso(4) },
      { kind: 'finished', at: iso(4), data: { status: 'approved' } },
    ],
  );
  await request(
    purchase,
    'ken',
    { item: 'Barcode scanners for Branch 625', qty: 4, cost: 240000, vendor: 'Denso Wave', needed: ymd(14), reason: 'The old scanners fail during stock counts.' },
    [step('s1', 'Manager', ['mika']), step('s2', 'Director and Finance', ['claudia', 'huong'])],
    [
      { step: 0, user: 'mika', status: 'approved', at: iso(2) },
      { step: 1, user: 'claudia', status: 'pending' },
      { step: 1, user: 'huong', status: 'approved', comment: 'Within the Q4 equipment budget.', at: iso(1) },
    ],
    'pending',
    iso(3),
    1,
    [
      { actor: 'mika', kind: 'approved', step: 0, at: iso(2) },
      { actor: 'huong', kind: 'approved', step: 1, body: 'Within the Q4 equipment budget.', at: iso(1) },
    ],
  );
  await request(
    trip,
    'hana',
    { destination: 'Osaka', dates: { start: ymd(12), end: ymd(13) }, purpose: 'Autumn campaign shoot at the Umeda store.', budget: 85000 },
    [step('s1', 'Manager', ['claudia']), step('s2', 'Second-level manager', [], 'Condition not met')],
    [{ step: 0, user: 'claudia', status: 'pending' }],
    'pending',
    iso(0, -5),
    0,
    [],
  );
  await request(
    general,
    'minh',
    { subject: 'New display font license', details: 'A one-year license for "Noto Serif Display Pro" for the new brand book.' },
    [step('s1', 'Approvers', ['hana'])],
    [{ step: 0, user: 'hana', status: 'rejected', comment: 'Please use the brand fonts we already have.', at: iso(6) }],
    'rejected',
    iso(7),
    0,
    [
      { actor: 'hana', kind: 'rejected', step: 0, body: 'Please use the brand fonts we already have.', at: iso(6) },
      { kind: 'finished', at: iso(6), data: { status: 'rejected' } },
    ],
  );
  await request(
    expense,
    'ken',
    { type: 'Supplies', amount: 8600, date: ymd(-2), description: 'Labels and tape for the stock room.' },
    [step('s1', 'Manager', ['mika']), step('s2', 'Finance', [], 'Condition not met')],
    [{ step: 0, user: 'mika', status: 'pending' }],
    'pending',
    iso(0, -2),
    0,
    [],
  );
}
