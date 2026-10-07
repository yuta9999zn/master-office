// Project documentation templates (docs/ARCHITECTURE.md §76, batch 3): the documents of a project's documentation
// space, modelled on the usual business-analysis set (BRD, FRD, SRS, PRD, business case, cost-benefit analysis,
// vision, scope, use cases, RACI, requirements management, RTM, RAID, change requests, test plans…) plus the
// AI-Driven Development Lifecycle (AI-DLC: intent → inception → units of work → design → bolts → operations).
// Section structures follow those standard documents; the wording is our own guidance text.
import type { JSONContent } from '@tiptap/core';

export type ProjectDocCategory = 'Business' | 'Requirements' | 'Design' | 'Delivery & Quality' | 'Agile' | 'AI-DLC';

export interface ProjectDocTemplate {
  id: string;
  name: string;
  /** Short code shown in page titles (BRD, FRD…). */
  code: string;
  description: string;
  category: ProjectDocCategory;
  build: (title: string) => JSONContent;
}

const t = (text: string, ...marks: string[]): JSONContent => ({ type: 'text', text, ...(marks.length ? { marks: marks.map((type) => ({ type })) } : {}) });
// Empty strings are dropped: ProseMirror has no empty text nodes.
const p = (...content: (JSONContent | string)[]): JSONContent => {
  const nodes = content.filter((c) => (typeof c === 'string' ? c !== '' : c.type !== 'text' || !!c.text)).map((c) => (typeof c === 'string' ? t(c) : c));
  return nodes.length ? { type: 'paragraph', content: nodes } : { type: 'paragraph' };
};
const hint = (text: string): JSONContent => p(t(text, 'italic'));
const h = (level: number, text: string): JSONContent => ({ type: 'heading', attrs: { level }, content: [t(text)] });
const ul = (...items: string[]): JSONContent => ({ type: 'bulletList', content: items.map((i) => ({ type: 'listItem', content: [p(i)] })) });
const ol = (...items: string[]): JSONContent => ({ type: 'orderedList', attrs: { start: 1 }, content: items.map((i) => ({ type: 'listItem', content: [p(i)] })) });
const tasks = (...items: string[]): JSONContent => ({ type: 'taskList', content: items.map((i) => ({ type: 'taskItem', attrs: { checked: false }, content: [p(i)] })) });
const callout = (tone: string, ...content: JSONContent[]): JSONContent => ({ type: 'callout', attrs: { tone }, content });
const table = (head: string[], rows: string[][]): JSONContent => ({
  type: 'table',
  content: [
    { type: 'tableRow', content: head.map((c) => ({ type: 'tableHeader', content: [p(c)] })) },
    ...rows.map((r) => ({ type: 'tableRow', content: r.map((c) => ({ type: 'tableCell', content: [c ? p(c) : { type: 'paragraph' }] })) })),
  ],
});
const doc = (...content: JSONContent[]): JSONContent => ({ type: 'doc', content });

/** Title, owner line and the revision / approval table every controlled document starts with. */
const head = (title: string, kind: string): JSONContent[] => [
  h(1, title),
  p(t(kind, 'bold'), ' · Version 0.1 · Status: Draft'),
  h(3, 'Document control'),
  table(['Date', 'Version', 'Change', 'Author', 'Approved by'], [['', '0.1', 'First draft', '', '']]),
];
const intro = (purpose: string): JSONContent[] => [
  h(2, '1. Introduction'),
  h(3, '1.1 Purpose'),
  hint(purpose),
  h(3, '1.2 Scope'),
  hint('What this document covers — and what it does not.'),
  h(3, '1.3 Stakeholders'),
  table(['Name', 'Role', 'Responsibility', 'Contact'], [['', '', '', ''], ['', '', '', '']]),
  h(3, '1.4 Definitions and acronyms'),
  table(['Term', 'Meaning'], [['', ''], ['', '']]),
  h(3, '1.5 References'),
  ul('Related documents, standards, links'),
];

export const PROJECT_DOC_TEMPLATES: ProjectDocTemplate[] = [
  // ── Business ──────────────────────────────────────────────────────────────
  {
    id: 'pd-business-case',
    code: 'BC',
    name: 'Business Case',
    description: 'Why the project should be done: problem, options, recommendation',
    category: 'Business',
    build: (title) =>
      doc(
        ...head(title, 'Business Case'),
        h(2, '1. Executive summary'),
        hint('One page: the problem, the recommended option, its cost, benefits and the decision asked for.'),
        h(2, '2. Problem statement'),
        hint('The business need or opportunity, who it affects and what happens if nothing is done.'),
        h(2, '3. Analysis'),
        ul('Current situation (as-is)', 'Root causes', 'Strategic alignment', 'Constraints and assumptions'),
        h(2, '4. Solution options'),
        table(['Option', 'Description', 'Cost', 'Benefits', 'Risks', 'Time'], [['Do nothing', '', '', '', '', ''], ['Option A', '', '', '', '', ''], ['Option B', '', '', '', '', '']]),
        h(2, '5. Recommendation'),
        hint('The preferred option and why; the investment and the expected return.'),
        h(2, '6. Implementation approach'),
        ul('Phases and milestones', 'Governance and roles', 'Key risks and mitigation'),
        h(2, '7. Approval'),
        table(['Name', 'Role', 'Decision', 'Date'], [['', 'Sponsor', '', '']]),
      ),
  },
  {
    id: 'pd-cba',
    code: 'CBA',
    name: 'Cost-Benefit Analysis',
    description: 'Costs, tangible and intangible benefits, ROI, sensitivity',
    category: 'Business',
    build: (title) =>
      doc(
        ...head(title, 'Cost-Benefit Analysis'),
        h(2, '1. Introduction'),
        ul('Purpose', 'Background', 'Analysis scope', 'Process', 'Criteria for evaluation'),
        h(2, '2. Assumptions, constraints and conditions'),
        ul('Assumptions', 'Constraints', 'Conditions', 'Recommended solution'),
        h(2, '3. Alternatives'),
        table(['Alternative', 'Description', 'Pros', 'Cons'], [['Current system', '', '', ''], ['Proposed system', '', '', ''], ['Alternative A', '', '', '']]),
        h(2, '4. Cost analysis'),
        table(['Cost item', 'Type', 'Year 0', 'Year 1', 'Year 2', 'Total'], [['Development', 'One-off', '', '', '', ''], ['Licences', 'Recurring', '', '', '', ''], ['Operations', 'Recurring', '', '', '', '']]),
        h(2, '5. Benefit analysis'),
        h(3, '5.1 Tangible benefits'),
        table(['Benefit', 'Measure', 'Year 1', 'Year 2', 'Total'], [['', '', '', '', '']]),
        h(3, '5.2 Intangible benefits'),
        ul('Customer satisfaction', 'Staff time freed', 'Risk reduced'),
        h(2, '6. Cost and benefit comparison'),
        ul('Net present value', 'Return on investment', 'Payback period', 'Conclusion'),
        h(2, '7. Sensitivity analysis'),
        ul('Sources of uncertainty', 'Results under best / worst case'),
        h(2, '8. Results and recommendation'),
      ),
  },
  {
    id: 'pd-vision',
    code: 'VIS',
    name: 'Project Vision',
    description: 'Opportunity, stakeholders and users, features and benefits, constraints',
    category: 'Business',
    build: (title) =>
      doc(
        ...head(title, 'Project Vision Document'),
        ...intro('Why this vision document exists and who should read it.'),
        h(2, '2. Business case'),
        h(3, '2.1 Business opportunity / need'),
        h(3, '2.2 Problem statement'),
        table(['The problem of', 'Affects', 'The impact is', 'A successful solution would'], [['', '', '', '']]),
        h(2, '3. Stakeholders and users'),
        h(3, '3.1 Stakeholders'),
        table(['Name', 'Type', 'Responsibilities', 'Involvement'], [['', '', '', '']]),
        h(3, '3.2 User types and environment'),
        table(['User type', 'Goals', 'Environment', 'Needs'], [['', '', '', '']]),
        h(2, '4. Product overview'),
        h(3, '4.1 Features'),
        h(3, '4.2 Benefits'),
        h(3, '4.3 Modules'),
        h(2, '5. Constraints'),
        h(2, '6. Assumptions and dependencies'),
        h(2, '7. Cost and pricing'),
        h(2, '8. Quality expectations'),
      ),
  },
  {
    id: 'pd-scope',
    code: 'SOW',
    name: 'Project Scope Statement',
    description: 'Objectives, in and out of scope, deliverables, milestones, acceptance',
    category: 'Business',
    build: (title) =>
      doc(
        ...head(title, 'Project Scope Statement'),
        h(2, '1. Project objectives'),
        hint('Specific, measurable objectives (SMART).'),
        h(2, '2. In scope'),
        ul('Item'),
        h(2, '3. Out of scope'),
        ul('Item'),
        h(2, '4. Deliverables'),
        table(['Deliverable', 'Description', 'Owner', 'Due'], [['', '', '', '']]),
        h(2, '5. Milestones'),
        table(['Milestone', 'Date', 'Exit criteria'], [['Requirements signed off', '', ''], ['Go-live', '', '']]),
        h(2, '6. Acceptance criteria'),
        h(2, '7. Constraints and assumptions'),
        h(2, '8. Sign-off'),
      ),
  },
  {
    id: 'pd-stakeholders',
    code: 'STK',
    name: 'Stakeholder Analysis',
    description: 'Interest / influence grid and engagement strategy',
    category: 'Business',
    build: (title) =>
      doc(
        ...head(title, 'Stakeholder Analysis'),
        h(2, 'Stakeholder register'),
        table(['Stakeholder', 'Role', 'Interest (H/M/L)', 'Influence (H/M/L)', 'Expectations', 'Engagement strategy'], [['', '', '', '', '', ''], ['', '', '', '', '', '']]),
        h(2, 'Power / interest grid'),
        table(['', 'Low interest', 'High interest'], [['High influence', 'Keep satisfied', 'Manage closely'], ['Low influence', 'Monitor', 'Keep informed']]),
      ),
  },
  {
    id: 'pd-raci',
    code: 'RACI',
    name: 'RACI Matrix',
    description: 'Responsible, Accountable, Consulted, Informed per activity',
    category: 'Business',
    build: (title) =>
      doc(
        ...head(title, 'RACI Matrix'),
        callout('info', p('R = Responsible (does the work) · A = Accountable (one per row) · C = Consulted · I = Informed')),
        table(['Activity / deliverable', 'Sponsor', 'Product owner', 'Project manager', 'BA', 'Dev lead', 'QA'], [['Business case', 'A', 'C', 'R', 'C', 'I', 'I'], ['Requirements', 'I', 'A', 'C', 'R', 'C', 'C'], ['Design', 'I', 'C', 'I', 'C', 'A', 'C'], ['Testing', 'I', 'C', 'I', 'C', 'C', 'A'], ['Release', 'A', 'C', 'R', 'I', 'C', 'C']]),
      ),
  },
  {
    id: 'pd-comms',
    code: 'COM',
    name: 'Communication Plan',
    description: 'Who hears what, how often, through which channel',
    category: 'Business',
    build: (title) =>
      doc(
        ...head(title, 'Communication Plan'),
        table(['Communication', 'Audience', 'Purpose', 'Channel', 'Frequency', 'Owner'], [['Status report', 'Sponsor', 'Progress, risks', 'Mail', 'Weekly', ''], ['Sprint review', 'Stakeholders', 'Demo, feedback', 'Meeting', 'Every sprint', ''], ['Daily scrum', 'Team', 'Plan the day', 'Meeting', 'Daily', '']]),
      ),
  },
  // ── Requirements ──────────────────────────────────────────────────────────
  {
    id: 'pd-brd',
    code: 'BRD',
    name: 'Business Requirements Document',
    description: 'Business needs, objectives, stakeholders, business requirements, rules',
    category: 'Requirements',
    build: (title) =>
      doc(
        ...head(title, 'Business Requirements Document'),
        ...intro('The business needs this project answers, agreed by the business owners.'),
        h(2, '2. Project overview and background'),
        h(2, '3. Goals, objectives and outcome measures'),
        table(['Objective', 'Measure', 'Target'], [['', '', '']]),
        h(2, '4. Scope'),
        ul('In scope', 'Out of scope'),
        h(2, '5. Assumptions, constraints and dependencies'),
        h(2, '6. Business requirements'),
        callout('info', p('Give every requirement an ID (BR-001…) so issues and tests can trace back to it.')),
        table(['ID', 'Requirement', 'Priority (MoSCoW)', 'Source', 'Acceptance'], [['BR-001', '', 'Must', '', ''], ['BR-002', '', 'Should', '', '']]),
        h(2, '7. Business process'),
        ul('As-is process', 'To-be process'),
        h(2, '8. Business rules'),
        table(['ID', 'Rule', 'Applies to'], [['RULE-001', '', '']]),
        h(2, '9. Non-functional needs'),
        ul('Security', 'Reporting', 'Usability', 'Audit', 'Availability and performance'),
        h(2, '10. Risks and mitigation'),
        h(2, 'Appendices'),
        ul('Process flows', 'Business rules catalog', 'Models', 'Glossary'),
      ),
  },
  {
    id: 'pd-frd',
    code: 'FRD',
    name: 'Functional Requirements Document',
    description: 'How the solution behaves: functions, workflows, forms, rules',
    category: 'Requirements',
    build: (title) =>
      doc(
        ...head(title, 'Functional Requirements Document'),
        ...intro('Describes what the solution does, function by function, for builders and testers.'),
        h(2, '2. Overall description'),
        ul('Purpose and features', 'Solution boundaries', 'Roles and responsibilities', 'Open items', 'Assumptions and dependencies'),
        h(2, '3. Functional requirements'),
        h(3, '3.1 Module / feature name'),
        ul('Overview', 'Business rules', 'Process flow', 'Screens and data forms'),
        table(['ID', 'Function', 'Description', 'Priority', 'Traces to (BR)'], [['FR-001', '', '', 'Must', 'BR-001'], ['FR-002', '', '', 'Should', '']]),
        h(2, '4. Data requirements'),
        table(['Entity', 'Field', 'Type', 'Required', 'Validation'], [['', '', '', '', '']]),
        h(2, '5. Interfaces and integrations'),
        h(2, '6. Reports'),
        h(2, '7. Non-functional requirements'),
      ),
  },
  {
    id: 'pd-srs',
    code: 'SRS',
    name: 'Software Requirements Specification',
    description: 'IEEE-style SRS: overall description, specific and non-functional requirements',
    category: 'Requirements',
    build: (title) =>
      doc(
        ...head(title, 'Software Requirements Specification'),
        ...intro('The complete software requirements for the system, in the IEEE 830 / 29148 structure.'),
        h(2, '2. Overall description'),
        ul('Product perspective', 'Product functions', 'User classes and characteristics', 'Operating environment', 'Design and implementation constraints', 'Assumptions and dependencies'),
        h(2, '3. External interface requirements'),
        ul('User interfaces', 'Hardware interfaces', 'Software interfaces', 'Communication interfaces'),
        h(2, '4. System features'),
        h(3, '4.1 Feature'),
        ul('Description and priority', 'Stimulus / response sequences'),
        table(['ID', 'Functional requirement', 'Priority'], [['REQ-001', '', 'High']]),
        h(2, '5. Non-functional requirements'),
        table(['ID', 'Category', 'Requirement', 'Measure'], [['NFR-001', 'Performance', '', 'p95 < 300 ms'], ['NFR-002', 'Security', '', ''], ['NFR-003', 'Reliability', '', ''], ['NFR-004', 'Usability', '', '']]),
        h(2, 'Appendix'),
        ul('Analysis models', 'To-be-determined list'),
      ),
  },
  {
    id: 'pd-prd',
    code: 'PRD',
    name: 'Product Requirements Document',
    description: 'Objectives, feature list with priority, user flows, analytics, future work',
    category: 'Requirements',
    build: (title) =>
      doc(
        ...head(title, 'Product Requirements Document'),
        h(2, '1. Context'),
        hint('Company / product context and the problem we solve.'),
        h(2, '2. Definitions and objectives'),
        table(['Term', 'Definition'], [['', '']]),
        ul('Objective 1 (measurable)', 'Objective 2'),
        h(2, '3. Feature list and priority'),
        table(['Feature', 'User story', 'Priority', 'Release'], [['', 'As a … I want … so that …', 'P0', 'MVP'], ['', '', 'P1', '']]),
        h(2, '4. User flows and wireframes'),
        h(2, '5. Insights and analytics'),
        ul('Events to track', 'Success metrics / KPIs'),
        h(2, '6. Future work'),
      ),
  },
  {
    id: 'pd-use-case',
    code: 'UC',
    name: 'Use Case Specification',
    description: 'Actors, pre/post-conditions, main, alternative and exception flows',
    category: 'Requirements',
    build: (title) =>
      doc(
        ...head(title, 'Use Case Specification'),
        table(['Use case ID', 'UC-001'], [['Name', ''], ['Primary actor', ''], ['Secondary actors', ''], ['Priority', '']]),
        h(2, 'Description'),
        h(2, 'Pre-conditions'),
        h(2, 'Post-conditions'),
        h(2, 'Main flow'),
        ol('The actor …', 'The system …', 'The actor …'),
        h(2, 'Alternative flows'),
        ul('A1 — at step 2, if …'),
        h(2, 'Exception flows'),
        ul('E1 — if the system cannot …'),
        h(2, 'Business rules'),
        h(2, 'UI notes'),
        h(2, 'Related use cases'),
      ),
  },
  {
    id: 'pd-user-stories',
    code: 'US',
    name: 'User Stories & Acceptance Criteria',
    description: 'Stories in the As a / I want / so that form with Given–When–Then criteria',
    category: 'Requirements',
    build: (title) =>
      doc(
        h(1, title),
        callout('info', p('Each bullet under "Stories" can become a Story in the backlog (Docs → Create issues from this page).')),
        h(2, 'Personas'),
        ul('Persona — goal, context'),
        h(2, 'Stories'),
        ul('As a customer, I want to … so that …', 'As a branch manager, I want to … so that …', 'As an admin, I want to … so that …'),
        h(2, 'Acceptance criteria'),
        h(3, 'Story 1'),
        ul('Given … when … then …', 'Given … when … then …'),
        h(2, 'Out of scope'),
      ),
  },
  // ── Design ────────────────────────────────────────────────────────────────
  {
    id: 'pd-solution-design',
    code: 'SDD',
    name: 'Solution Design',
    description: 'Architecture, components, data, integrations, security',
    category: 'Design',
    build: (title) =>
      doc(
        ...head(title, 'Solution Design Document'),
        h(2, '1. Context and goals'),
        h(2, '2. Architecture overview'),
        ul('Context diagram', 'Container / component view', 'Deployment view'),
        h(2, '3. Components'),
        table(['Component', 'Responsibility', 'Technology', 'Owner'], [['', '', '', '']]),
        h(2, '4. Data model'),
        h(2, '5. Integrations and APIs'),
        table(['Interface', 'Direction', 'Protocol', 'Data', 'SLA'], [['', '', '', '', '']]),
        h(2, '6. Security'),
        h(2, '7. Non-functional design'),
        h(2, '8. Decisions (ADR)'),
        table(['ADR', 'Decision', 'Status', 'Date'], [['ADR-001', '', 'Accepted', '']]),
      ),
  },
  // ── Delivery & Quality ────────────────────────────────────────────────────
  {
    id: 'pd-rmp',
    code: 'RMP',
    name: 'Requirements Management Plan',
    description: 'How requirements are gathered, traced, reviewed, changed and measured',
    category: 'Delivery & Quality',
    build: (title) =>
      doc(
        ...head(title, 'Requirements Management Plan'),
        ...intro('How requirements are handled on this project from elicitation to change control.'),
        h(2, '2. Requirements management'),
        ul('2.1 Requirements gathering', '2.2 Requirements traceability', '2.3 Requirements analysis', '2.4 Requirements modelling', '2.5 Requirements documentation', '2.6 Requirements review', '2.7 Quality standards'),
        table(['Document', 'Purpose', 'Template', 'Location'], [['BRD', '', 'Business Requirements Document', 'Project docs'], ['RTM', '', 'Requirements Traceability Matrix', 'Project docs']]),
        h(2, '3. Requirement categories'),
        h(2, '4. Configuration management'),
        h(2, '5. Tools'),
        h(2, '6. Requirement metrics'),
        h(2, '7. Reporting structure'),
        h(2, '8. Change management'),
      ),
  },
  {
    id: 'pd-rtm',
    code: 'RTM',
    name: 'Requirements Traceability Matrix',
    description: 'Requirement → design → issue → test case → status',
    category: 'Delivery & Quality',
    build: (title) =>
      doc(
        h(1, title),
        callout('info', p('The Docs tab of the project also shows live traceability: which issues each page is linked to and how far they are.')),
        table(['Req ID', 'Requirement', 'Source', 'Design ref', 'Issue', 'Test case', 'Status'], [['BR-001', '', 'BRD', '', 'WEB-', 'TC-001', ''], ['FR-001', '', 'FRD', '', '', '', '']]),
      ),
  },
  {
    id: 'pd-raid',
    code: 'RAID',
    name: 'RAID Log',
    description: 'Risks, assumptions, issues and dependencies',
    category: 'Delivery & Quality',
    build: (title) =>
      doc(
        h(1, title),
        h(2, 'Risks'),
        table(['ID', 'Risk', 'Probability', 'Impact', 'Owner', 'Mitigation', 'Status'], [['R-001', '', 'M', 'H', '', '', 'Open']]),
        h(2, 'Assumptions'),
        table(['ID', 'Assumption', 'Owner', 'Validated by'], [['A-001', '', '', '']]),
        h(2, 'Issues'),
        table(['ID', 'Issue', 'Priority', 'Owner', 'Action', 'Status'], [['I-001', '', 'High', '', '', 'Open']]),
        h(2, 'Dependencies'),
        table(['ID', 'Dependency', 'On', 'Needed by', 'Status'], [['D-001', '', '', '', '']]),
      ),
  },
  {
    id: 'pd-change-request',
    code: 'CR',
    name: 'Change Request',
    description: 'Requested change, impact on scope / time / cost, decision',
    category: 'Delivery & Quality',
    build: (title) =>
      doc(
        ...head(title, 'Change Request'),
        table(['Field', 'Value'], [['CR number', 'CR-001'], ['Requested by', ''], ['Date', ''], ['Priority', '']]),
        h(2, 'Description of the change'),
        h(2, 'Reason / business justification'),
        h(2, 'Impact analysis'),
        table(['Area', 'Impact'], [['Scope', ''], ['Schedule', ''], ['Cost', ''], ['Quality / risk', ''], ['Requirements affected', '']]),
        h(2, 'Decision'),
        tasks('Approved', 'Rejected', 'Deferred'),
        table(['Approver', 'Decision', 'Date'], [['', '', '']]),
      ),
  },
  {
    id: 'pd-test-plan',
    code: 'TP',
    name: 'Test Plan',
    description: 'Scope, approach, environments, entry / exit criteria, defect management',
    category: 'Delivery & Quality',
    build: (title) =>
      doc(
        ...head(title, 'Test Plan'),
        h(2, '1. Scope'),
        ul('Features to be tested', 'Features not to be tested'),
        h(2, '2. Approach'),
        ul('Unit, integration, system, UAT, regression', 'Manual / automated', 'Test data'),
        h(2, '3. Environments'),
        h(2, '4. Entry and exit criteria'),
        table(['Phase', 'Entry criteria', 'Exit criteria'], [['System test', 'Build deployed, smoke passed', 'No open critical defects'], ['UAT', 'System test passed', 'Business sign-off']]),
        h(2, '5. Defect management'),
        table(['Severity', 'Definition', 'Fix within'], [['Critical', 'Blocks a key flow, no workaround', '1 day'], ['Major', 'Wrong behaviour, workaround exists', '1 sprint'], ['Minor', 'Cosmetic', 'Backlog']]),
        hint('Defects are logged as Bugs (Log bug on the issue) and follow the Fixing → Retest workflow.'),
        h(2, '6. Schedule and responsibilities'),
        h(2, '7. Risks'),
      ),
  },
  {
    id: 'pd-test-cases',
    code: 'TC',
    name: 'Test Cases',
    description: 'Scenarios with steps, expected and actual results',
    category: 'Delivery & Quality',
    build: (title) =>
      doc(
        h(1, title),
        table(['TC ID', 'Requirement', 'Scenario', 'Steps', 'Expected result', 'Actual result', 'Status'], [['TC-001', 'BR-001', '', '1. …\n2. …', '', '', 'Not run'], ['TC-002', '', '', '', '', '', 'Not run']]),
      ),
  },
  {
    id: 'pd-dod',
    code: 'DoD',
    name: 'Definition of Done',
    description: 'The checklist every story meets before it is Done',
    category: 'Delivery & Quality',
    build: (title) =>
      doc(
        h(1, title),
        h(2, 'Story'),
        tasks('Acceptance criteria met', 'Code reviewed and merged', 'Unit and integration tests pass', 'QA tested; no open critical / major bugs', 'Documentation updated', 'Product owner accepted'),
        h(2, 'Sprint'),
        tasks('All stories meet the story DoD', 'Regression tests pass', 'Release notes written'),
        h(2, 'Release'),
        tasks('UAT signed off', 'Deployment runbook rehearsed', 'Monitoring and alerts in place'),
      ),
  },
  {
    id: 'pd-release-notes',
    code: 'RN',
    name: 'Release Notes',
    description: 'What changed, fixes, known issues, upgrade steps',
    category: 'Delivery & Quality',
    build: (title) =>
      doc(h(1, title), p(t('Version ', 'bold'), '1.0 · ', t('Date ', 'bold'), ''), h(2, 'New'), ul(''), h(2, 'Improved'), ul(''), h(2, 'Fixed'), ul(''), h(2, 'Known issues'), ul(''), h(2, 'Upgrade notes')),
  },
  // ── Agile ─────────────────────────────────────────────────────────────────
  {
    id: 'pd-sprint-planning',
    code: 'SP',
    name: 'Sprint Planning Notes',
    description: 'Sprint goal, capacity, committed items, risks',
    category: 'Agile',
    build: (title) =>
      doc(h(1, title), h(2, 'Sprint goal'), h(2, 'Capacity'), table(['Member', 'Days available', 'Notes'], [['', '', '']]), h(2, 'Committed items'), ul(''), h(2, 'Risks and dependencies'), h(2, 'Decisions')),
  },
  {
    id: 'pd-sprint-review',
    code: 'SR',
    name: 'Sprint Review Report',
    description: 'What was done, demo feedback, metrics, backlog changes',
    category: 'Agile',
    build: (title) =>
      doc(h(1, title), h(2, 'Sprint goal — met?'), h(2, 'Completed'), ul(''), h(2, 'Not completed (carried over)'), ul(''), h(2, 'Demo feedback'), h(2, 'Metrics'), ul('Committed / completed points', 'Bugs found / fixed'), h(2, 'Backlog changes')),
  },
  {
    id: 'pd-retro',
    code: 'RET',
    name: 'Retrospective Notes',
    description: 'Start / stop / continue and action items',
    category: 'Agile',
    build: (title) => doc(h(1, title), h(2, 'What went well'), ul(''), h(2, 'What to improve'), ul(''), h(2, 'Start · Stop · Continue'), table(['Start', 'Stop', 'Continue'], [['', '', '']]), h(2, 'Action items'), tasks('Owner — action — by when')),
  },
  // ── AI-DLC (AI-Driven Development Lifecycle) ──────────────────────────────
  {
    id: 'pd-aidlc-intent',
    code: 'INT',
    name: 'AI-DLC · Intent',
    description: 'The business intent AI and humans elaborate from: outcome, constraints, success',
    category: 'AI-DLC',
    build: (title) =>
      doc(
        h(1, title),
        callout('info', p('AI-DLC starts from an intent. In Inception, AI proposes requirements, stories and units of work from it; the team validates them together (mob elaboration).')),
        h(2, 'Intent'),
        hint('One paragraph: the business outcome we want and for whom.'),
        h(2, 'Desired outcomes and measures'),
        table(['Outcome', 'Measure', 'Target'], [['', '', '']]),
        h(2, 'Constraints and guardrails'),
        ul('Regulatory / security', 'Technology', 'Budget / time'),
        h(2, 'Context the AI needs'),
        ul('Existing systems', 'Domain glossary', 'Links to BRD / PRD'),
        h(2, 'Human decision points'),
        tasks('Intent approved by product owner', 'Inception outputs validated', 'Units of work agreed'),
      ),
  },
  {
    id: 'pd-aidlc-inception',
    code: 'INC',
    name: 'AI-DLC · Inception: Requirements & Stories',
    description: 'Requirements and user stories elaborated from the intent, validated by the team',
    category: 'AI-DLC',
    build: (title) =>
      doc(
        h(1, title),
        h(2, 'Functional requirements'),
        table(['ID', 'Requirement', 'From intent', 'Validated by'], [['REQ-001', '', '', '']]),
        h(2, 'Non-functional requirements'),
        ul('Performance', 'Security', 'Availability'),
        h(2, 'User stories'),
        ul('As a … I want … so that …', 'As a … I want … so that …'),
        h(2, 'Open questions for the team'),
        ul(''),
        h(2, 'Mob elaboration record'),
        table(['Date', 'Participants', 'Changes made', 'Decision'], [['', '', '', '']]),
      ),
  },
  {
    id: 'pd-aidlc-units',
    code: 'UOW',
    name: 'AI-DLC · Units of Work',
    description: 'Independent units the work is split into, with dependencies and owners',
    category: 'AI-DLC',
    build: (title) =>
      doc(
        h(1, title),
        hint('Each unit is a cohesive, independently deliverable piece (≈ an epic). Each bullet under "Units" can become an Epic.'),
        h(2, 'Units'),
        ul('Unit 1 — name: responsibility', 'Unit 2 — name: responsibility'),
        h(2, 'Unit details'),
        table(['Unit', 'Stories', 'Depends on', 'Owner (human)', 'AI agents / tools'], [['', '', '', '', '']]),
        h(2, 'Delivery order'),
        ol('Unit with no dependencies first', '…'),
      ),
  },
  {
    id: 'pd-aidlc-domain',
    code: 'DOM',
    name: 'AI-DLC · Domain Design',
    description: 'Bounded contexts, entities, aggregates, events per unit',
    category: 'AI-DLC',
    build: (title) =>
      doc(
        h(1, title),
        h(2, 'Bounded contexts'),
        table(['Context', 'Responsibility', 'Units'], [['', '', '']]),
        h(2, 'Entities and aggregates'),
        table(['Aggregate', 'Entities / value objects', 'Invariants'], [['', '', '']]),
        h(2, 'Domain events'),
        table(['Event', 'Raised when', 'Consumed by'], [['', '', '']]),
        h(2, 'Ubiquitous language'),
        table(['Term', 'Meaning'], [['', '']]),
      ),
  },
  {
    id: 'pd-aidlc-logical',
    code: 'LD',
    name: 'AI-DLC · Logical Design & ADRs',
    description: 'Architecture per unit and the decisions taken, with alternatives',
    category: 'AI-DLC',
    build: (title) =>
      doc(
        h(1, title),
        h(2, 'Logical architecture'),
        ul('Components', 'APIs and contracts', 'Data stores', 'Non-functional tactics'),
        h(2, 'Architecture decision records'),
        h(3, 'ADR-001 — title'),
        table(['Field', 'Value'], [['Status', 'Proposed'], ['Context', ''], ['Decision', ''], ['Alternatives considered', ''], ['Consequences', '']]),
      ),
  },
  {
    id: 'pd-aidlc-bolt',
    code: 'BOLT',
    name: 'AI-DLC · Bolt Plan',
    description: 'A bolt: a short, intense cycle (hours to days) that delivers part of a unit',
    category: 'AI-DLC',
    build: (title) =>
      doc(
        h(1, title),
        callout('info', p('Bolts replace long sprints: the AI generates the plan, code and tests; humans review and decide at each checkpoint.')),
        table(['Field', 'Value'], [['Unit of work', ''], ['Bolt goal', ''], ['Duration', 'e.g. 1–2 days'], ['Human owner', ''], ['AI agents', '']]),
        h(2, 'Plan (AI-proposed, human-approved)'),
        tasks('Domain model updated', 'Code generated', 'Tests generated and passing', 'Human review', 'Deployed to test'),
        h(2, 'Validation'),
        table(['Check', 'Result', 'Reviewer'], [['Acceptance criteria', '', ''], ['Security review', '', ''], ['Performance', '', '']]),
        h(2, 'Learnings'),
      ),
  },
  {
    id: 'pd-aidlc-ops',
    code: 'OPS',
    name: 'AI-DLC · Operations Runbook',
    description: 'Deployment, monitoring, alerts, incident response',
    category: 'AI-DLC',
    build: (title) =>
      doc(
        h(1, title),
        h(2, 'Deployment'),
        ol('Build and checks', 'Deploy to staging', 'Smoke tests', 'Deploy to production', 'Verify'),
        h(2, 'Monitoring and alerts'),
        table(['Signal', 'Threshold', 'Alert to', 'Runbook step'], [['Error rate', '> 1% for 5 min', 'On-call', '']]),
        h(2, 'Incident response'),
        ol('Acknowledge', 'Mitigate / roll back', 'Communicate', 'Post-incident review'),
        h(2, 'Rollback'),
        h(2, 'Contacts'),
      ),
  },
];

export const projectDocTemplate = (id: string) => PROJECT_DOC_TEMPLATES.find((x) => x.id === id);

/** Folders of a project documentation space, Confluence-like. */
export const PROJECT_DOC_FOLDERS: Record<ProjectDocCategory, string> = {
  Business: '01 Business',
  Requirements: '02 Requirements',
  Design: '03 Design',
  'Delivery & Quality': '04 Delivery & Quality',
  Agile: '05 Agile ceremonies',
  'AI-DLC': '06 AI-DLC',
};

/** Starter sets by way of working. */
export const PROJECT_DOC_SETS: Record<'scrum' | 'kanban' | 'waterfall' | 'hybrid' | 'ai-dlc', { name: string; templates: string[] }> = {
  scrum: { name: 'Agile (Scrum)', templates: ['pd-vision', 'pd-prd', 'pd-user-stories', 'pd-solution-design', 'pd-dod', 'pd-raid', 'pd-test-plan', 'pd-release-notes'] },
  kanban: { name: 'Agile (Kanban)', templates: ['pd-vision', 'pd-prd', 'pd-user-stories', 'pd-dod', 'pd-raid'] },
  waterfall: { name: 'Waterfall', templates: ['pd-business-case', 'pd-cba', 'pd-scope', 'pd-stakeholders', 'pd-raci', 'pd-brd', 'pd-frd', 'pd-srs', 'pd-solution-design', 'pd-rmp', 'pd-rtm', 'pd-test-plan', 'pd-test-cases', 'pd-change-request', 'pd-raid'] },
  hybrid: { name: 'Hybrid', templates: ['pd-business-case', 'pd-vision', 'pd-scope', 'pd-brd', 'pd-prd', 'pd-user-stories', 'pd-solution-design', 'pd-rtm', 'pd-test-plan', 'pd-dod', 'pd-change-request', 'pd-raid'] },
  'ai-dlc': { name: 'AI-DLC', templates: ['pd-aidlc-intent', 'pd-aidlc-inception', 'pd-aidlc-units', 'pd-aidlc-domain', 'pd-aidlc-logical', 'pd-aidlc-bolt', 'pd-aidlc-ops', 'pd-dod'] },
};
