import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  date,
  integer,
  customType,
  bigserial,
  index,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { RESOURCE_TYPES, ROLES } from '@workos/shared';

export const resourceType = pgEnum('resource_type', RESOURCE_TYPES);
export const role = pgEnum('role', ROLES);
export const generalAccess = pgEnum('general_access', ['restricted', 'workspace', 'anyone_with_link']);
export const spaceVisibility = pgEnum('space_visibility', ['public', 'private']);

/** timestamptz exposed to the app as ISO-8601 strings (Postgres' own text format is not portable to browsers). */
const isoTimestamp = customType<{ data: string; driverData: string }>({
  dataType: () => 'timestamp with time zone',
  fromDriver: (v) => new Date(v).toISOString(),
  toDriver: (v) => v,
});
const ts = (name: string) => isoTimestamp(name);

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  avatarColor: text('avatar_color').notNull().default('#3370ff'),
  title: text('title'),
  department: text('department'),
  createdAt: ts('created_at').notNull().default(sql`now()`),
});

export const workspaces = pgTable('workspaces', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  createdAt: ts('created_at').notNull().default(sql`now()`),
});

export const workspaceMembers = pgTable(
  'workspace_members',
  {
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    role: role('role').notNull().default('editor'),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.userId] })],
);

export const spaces = pgTable('spaces', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  parentId: uuid('parent_id').references((): AnyPgColumn => spaces.id),
  name: text('name').notNull(),
  description: text('description'),
  icon: text('icon'),
  color: text('color'),
  visibility: spaceVisibility('visibility').notNull().default('public'),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: ts('created_at').notNull().default(sql`now()`),
});

export const spaceMembers = pgTable(
  'space_members',
  {
    spaceId: uuid('space_id').notNull().references(() => spaces.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    role: role('role').notNull(),
    addedAt: ts('added_at').notNull().default(sql`now()`),
  },
  (t) => [primaryKey({ columns: [t.spaceId, t.userId] })],
);

/** Content-addressed binary storage. One blob may back many resources/versions. */
export const blobs = pgTable('blobs', {
  id: uuid('id').primaryKey().defaultRandom(),
  sha256: text('sha256').notNull().unique(),
  sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
  mimeType: text('mime_type'),
  storageKey: text('storage_key').notNull(),
  createdAt: ts('created_at').notNull().default(sql`now()`),
});

/** Unified Resource — docs/ARCHITECTURE.md §5. */
export const resources = pgTable(
  'resources',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
    spaceId: uuid('space_id').references(() => spaces.id),
    parentId: uuid('parent_id').references((): AnyPgColumn => resources.id),
    name: text('name').notNull(),
    type: resourceType('type').notNull(),
    ownerId: uuid('owner_id').notNull().references(() => users.id),
    createdAt: ts('created_at').notNull().default(sql`now()`),
    updatedAt: ts('updated_at').notNull().default(sql`now()`),
    updatedBy: uuid('updated_by').references(() => users.id),
    version: bigint('version', { mode: 'number' }).notNull().default(1),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull().default(0),
    mimeType: text('mime_type'),
    blobId: uuid('blob_id').references(() => blobs.id),
    contentRef: text('content_ref'),
    linkTargetId: uuid('link_target_id').references((): AnyPgColumn => resources.id),
    generalAccess: generalAccess('general_access').notNull().default('restricted'),
    generalRole: role('general_role'),
    description: text('description'),
    tags: text('tags').array().notNull().default(sql`'{}'::text[]`),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    trashedAt: ts('trashed_at'),
    trashedBy: uuid('trashed_by').references(() => users.id),
    path: uuid('path').array().notNull().default(sql`'{}'::uuid[]`),
    /** Plain text of collaborative content, for search until OpenSearch lands (Phase 6). */
    contentText: text('content_text'),
  },
  (t) => [
    index('resources_parent_idx').on(t.workspaceId, t.parentId),
    index('resources_space_idx').on(t.spaceId),
    index('resources_owner_idx').on(t.ownerId),
    index('resources_path_gin').using('gin', t.path),
  ],
);

export const resourceVersions = pgTable('resource_versions', {
  id: uuid('id').primaryKey().defaultRandom(),
  resourceId: uuid('resource_id').notNull().references(() => resources.id, { onDelete: 'cascade' }),
  version: bigint('version', { mode: 'number' }).notNull(),
  blobId: uuid('blob_id').references(() => blobs.id),
  snapshotKey: text('snapshot_key'),
  label: text('label'),
  sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull().default(0),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: ts('created_at').notNull().default(sql`now()`),
});

export const aclEntries = pgTable(
  'acl_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    resourceId: uuid('resource_id').notNull().references(() => resources.id, { onDelete: 'cascade' }),
    principalType: text('principal_type').notNull().$type<'user' | 'group' | 'department' | 'workspace'>(),
    principalId: uuid('principal_id').notNull(),
    role: role('role').notNull(),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: ts('created_at').notNull().default(sql`now()`),
  },
  (t) => [
    uniqueIndex('acl_unique').on(t.resourceId, t.principalType, t.principalId),
    index('acl_principal_idx').on(t.principalType, t.principalId),
  ],
);

export const stars = pgTable(
  'stars',
  {
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    resourceId: uuid('resource_id').notNull().references(() => resources.id, { onDelete: 'cascade' }),
    createdAt: ts('created_at').notNull().default(sql`now()`),
  },
  (t) => [primaryKey({ columns: [t.userId, t.resourceId] })],
);

export const resourceAccess = pgTable(
  'resource_access',
  {
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    resourceId: uuid('resource_id').notNull().references(() => resources.id, { onDelete: 'cascade' }),
    accessedAt: ts('accessed_at').notNull().default(sql`now()`),
  },
  (t) => [primaryKey({ columns: [t.userId, t.resourceId] })],
);

export const auditEvents = pgTable(
  'audit_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    workspaceId: uuid('workspace_id').notNull(),
    actorId: uuid('actor_id').references(() => users.id),
    action: text('action').notNull(),
    resourceId: uuid('resource_id'),
    spaceId: uuid('space_id'),
    data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: ts('created_at').notNull().default(sql`now()`),
  },
  (t) => [index('audit_resource_idx').on(t.resourceId), index('audit_space_idx').on(t.spaceId)],
);

/** Transactional outbox — docs/ARCHITECTURE.md §13. Publisher to Redis Streams lands in Phase 6. */
export const outbox = pgTable('outbox', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  topic: text('topic').notNull(),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
  createdAt: ts('created_at').notNull().default(sql`now()`),
  publishedAt: ts('published_at'),
});

// ── Phase 2: collaborative documents ─────────────────────────────────────────

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => 'bytea' });

/** Latest merged Yjs state per collaborative resource (docs/ARCHITECTURE.md §9). */
export const ydocStates = pgTable('ydoc_states', {
  resourceId: uuid('resource_id')
    .primaryKey()
    .references(() => resources.id, { onDelete: 'cascade' }),
  state: bytea('state').notNull(),
  updatedAt: ts('updated_at').notNull().default(sql`now()`),
});

/** Comment threads. Anchors are Yjs relative positions, so they survive concurrent edits and need no write access to the doc. */
export const comments = pgTable(
  'comments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    resourceId: uuid('resource_id')
      .notNull()
      .references(() => resources.id, { onDelete: 'cascade' }),
    threadId: uuid('thread_id').references((): AnyPgColumn => comments.id, { onDelete: 'cascade' }),
    authorId: uuid('author_id')
      .notNull()
      .references(() => users.id),
    body: text('body').notNull(),
    anchor: jsonb('anchor').$type<{ from: unknown; to: unknown } | null>(),
    quote: text('quote'),
    resolvedAt: ts('resolved_at'),
    resolvedBy: uuid('resolved_by').references(() => users.id),
    createdAt: ts('created_at').notNull().default(sql`now()`),
    editedAt: ts('edited_at'),
  },
  (t) => [index('comments_resource_idx').on(t.resourceId)],
);

/** Images embedded in a document; served with the document's permissions. */
export const resourceAssets = pgTable(
  'resource_assets',
  {
    resourceId: uuid('resource_id')
      .notNull()
      .references(() => resources.id, { onDelete: 'cascade' }),
    blobId: uuid('blob_id')
      .notNull()
      .references(() => blobs.id),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: ts('created_at').notNull().default(sql`now()`),
  },
  (t) => [primaryKey({ columns: [t.resourceId, t.blobId] })],
);

// ── Phase 2b: links between resources (Linked pages, Related files, Backlinks) ─
export const resourceLinks = pgTable(
  'resource_links',
  {
    sourceId: uuid('source_id')
      .notNull()
      .references(() => resources.id, { onDelete: 'cascade' }),
    targetId: uuid('target_id')
      .notNull()
      .references(() => resources.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull().$type<'link' | 'embed' | 'mention-page'>(),
  },
  (t) => [primaryKey({ columns: [t.sourceId, t.targetId] }), index('resource_links_target_idx').on(t.targetId)],
);

/** Answers to a form (Phase 8). The form itself lives in its Yjs document; responses are rows (reporting, CSV, Sheets). */
export const formResponses = pgTable(
  'form_responses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    formId: uuid('form_id')
      .notNull()
      .references(() => resources.id, { onDelete: 'cascade' }),
    respondentId: uuid('respondent_id').references(() => users.id, { onDelete: 'set null' }),
    email: text('email'),
    answers: jsonb('answers').$type<Record<string, unknown>>().notNull(),
    score: jsonb('score').$type<{ points: number; max: number } | null>(),
    editToken: text('edit_token').notNull(),
    submittedAt: ts('submitted_at').notNull().default(sql`now()`),
    updatedAt: ts('updated_at').notNull().default(sql`now()`),
  },
  (t) => [index('form_responses_form_idx').on(t.formId, t.submittedAt)],
);


/** Who viewed what, one row per person and day (Activity dashboard: viewers, last view, viewer trend). */
export const resourceViews = pgTable(
  'resource_views',
  {
    resourceId: uuid('resource_id')
      .notNull()
      .references(() => resources.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    day: date('day').notNull(),
    count: integer('count').notNull().default(1),
    lastAt: ts('last_at').notNull().default(sql`now()`),
  },
  (t) => [primaryKey({ columns: [t.resourceId, t.userId, t.day] }), index('resource_views_day_idx').on(t.resourceId, t.day)],
);

/** Personal dictionary (Tools → Spelling and grammar → Add to dictionary). docs/ARCHITECTURE.md §45. */
export const userDictionary = pgTable(
  'user_dictionary',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    word: text('word').notNull(),
    createdAt: ts('created_at').notNull().default(sql`now()`),
  },
  (t) => [primaryKey({ columns: [t.userId, t.word] })],
);

/**
 * Installable macro triggers that run on the server (docs/ARCHITECTURE.md §48): time-driven and on form submit.
 * They run as the person who created them, while that person can still edit the spreadsheet.
 */
export const macroTriggers = pgTable(
  'macro_triggers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    resourceId: uuid('resource_id')
      .notNull()
      .references(() => resources.id, { onDelete: 'cascade' }),
    macroId: text('macro_id').notNull(),
    fn: text('fn').notNull(),
    kind: text('kind').notNull(), // 'time' | 'formSubmit'
    schedule: jsonb('schedule').$type<{ every: 'minutes' | 'hours' | 'day' | 'week'; n?: number; hour?: number; weekday?: number } | null>(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    enabled: boolean('enabled').notNull().default(true),
    nextRunAt: ts('next_run_at'),
    lastRunAt: ts('last_run_at'),
    lastStatus: text('last_status'),
    lastError: text('last_error'),
    lastLogs: jsonb('last_logs').$type<string[]>(),
    lastMs: integer('last_ms'),
    failures: integer('failures').notNull().default(0),
    createdAt: ts('created_at').notNull().default(sql`now()`),
  },
  (t) => [index('macro_triggers_due_idx').on(t.enabled, t.nextRunAt), index('macro_triggers_resource_idx').on(t.resourceId)],
);
