import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  date,
  integer,
  real,
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
  // Profile (Contacts, §67).
  phone: text('phone'),
  location: text('location'),
  /** Short status line under the name ("よろしくお願いします。"). */
  status: text('status'),
  skills: text('skills').array().notNull().default(sql`'{}'::text[]`),
  managerId: uuid('manager_id').references((): AnyPgColumn => users.id, { onDelete: 'set null' }),
  /** Who sees phone and location (§79): 'leads' (admins + leads of the person's teams) or 'everyone'. */
  phoneVisibility: text('phone_visibility').notNull().default('leads'),
  createdAt: ts('created_at').notNull().default(sql`now()`),
});

export const workspaces = pgTable('workspaces', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  /** Domain of the workspace's mail addresses (§69), e.g. hanami.example. */
  mailDomain: text('mail_domain'),
  createdAt: ts('created_at').notNull().default(sql`now()`),
});

export const workspaceMembers = pgTable(
  'workspace_members',
  {
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    role: role('role').notNull().default('editor'),
    /** active | suspended (§79: a suspended member cannot sign in; their sessions are revoked). */
    status: text('status').notNull().default('active'),
    joinedAt: ts('joined_at').notNull().default(sql`now()`),
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
  /** department | team | project | general (§79): how the organisation chart shows it. */
  kind: text('kind').notNull().default('team'),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: ts('created_at').notNull().default(sql`now()`),
});

export const spaceMembers = pgTable(
  'space_members',
  {
    spaceId: uuid('space_id').notNull().references(() => spaces.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    role: role('role').notNull(),
    /** The person's position in this team (§79), e.g. "Team lead", "Designer" — one person, many teams, many positions. */
    title: text('title'),
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
}, (t) => [index('resource_versions_resource_idx').on(t.resourceId)]);

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
    // Manual grading (§63): per-question points/feedback, and when the score was released to the respondent.
    grades: jsonb('grades').$type<Record<string, { points?: number | null; feedback?: string }>>().notNull().default({}),
    releasedAt: ts('released_at'),
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

/** Audience Q&A while presenting (Google Slides "Audience tools"). docs/ARCHITECTURE.md §55. */
export const qaSessions = pgTable(
  'qa_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    resourceId: uuid('resource_id')
      .notNull()
      .references(() => resources.id, { onDelete: 'cascade' }),
    token: text('token').notNull().unique(),
    startedBy: uuid('started_by')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    startedAt: ts('started_at').notNull().default(sql`now()`),
    endedAt: ts('ended_at'),
    presenting: uuid('presenting'),
  },
  (t) => [index('qa_sessions_resource_idx').on(t.resourceId)],
);

export const qaQuestions = pgTable(
  'qa_questions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => qaSessions.id, { onDelete: 'cascade' }),
    text: text('text').notNull(),
    authorName: text('author_name'),
    authorId: uuid('author_id').references(() => users.id, { onDelete: 'set null' }),
    voter: text('voter').notNull(),
    votes: integer('votes').notNull().default(0),
    hidden: boolean('hidden').notNull().default(false),
    createdAt: ts('created_at').notNull().default(sql`now()`),
  },
  (t) => [index('qa_questions_session_idx').on(t.sessionId)],
);

export const qaVotes = pgTable(
  'qa_votes',
  {
    questionId: uuid('question_id')
      .notNull()
      .references(() => qaQuestions.id, { onDelete: 'cascade' }),
    voter: text('voter').notNull(),
  },
  (t) => [primaryKey({ columns: [t.questionId, t.voter] })],
);

/** Editors who get an e-mail for every new response to a form (Google: "Get email notifications for new responses"). */
export const formSubscriptions = pgTable(
  'form_subscriptions',
  {
    formId: uuid('form_id')
      .notNull()
      .references(() => resources.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: ts('created_at').notNull().default(sql`now()`),
  },
  (t) => [primaryKey({ columns: [t.formId, t.userId] })],
);

/**
 * Every e-mail the system sends (§62). Delivered over SMTP when SMTP_URL is set, otherwise only recorded
 * (status 'logged') — the outbox is also what the future Mail module shows as system mail.
 */
export const mailOutbox = pgTable(
  'mail_outbox',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: text('kind').notNull(),
    to: text('to').notNull(),
    subject: text('subject').notNull(),
    text: text('text').notNull(),
    html: text('html'),
    resourceId: uuid('resource_id').references(() => resources.id, { onDelete: 'set null' }),
    status: text('status').notNull().default('queued'),
    error: text('error'),
    createdAt: ts('created_at').notNull().default(sql`now()`),
    sentAt: ts('sent_at'),
  },
  (t) => [index('mail_outbox_resource_idx').on(t.resourceId, t.createdAt)],
);

// ── Chat (Phase 5, docs/ARCHITECTURE.md §64, Discord model §68) ─────────────

/** Channel groups inside a space (Discord categories). */
export const channelCategories = pgTable(
  'channel_categories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    spaceId: uuid('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    position: integer('position').notNull().default(0),
    createdAt: ts('created_at').notNull().default(sql`now()`),
  },
  (t) => [index('channel_categories_space_idx').on(t.spaceId)],
);


/** A direct message (two people), a group (several people, no name needed) or a channel (named, public or private). */
export const conversations = pgTable(
  'conversations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<'dm' | 'group' | 'channel'>().notNull(),
    name: text('name'),
    description: text('description'),
    visibility: text('visibility').$type<'public' | 'private'>().notNull().default('private'),
    /** The space (Discord server) a channel belongs to; null for direct and group messages. */
    spaceId: uuid('space_id').references(() => spaces.id, { onDelete: 'cascade' }),
    categoryId: uuid('category_id').references(() => channelCategories.id, { onDelete: 'set null' }),
    position: integer('position').notNull().default(0),
    /** 'admins' = announcement channel: only space / channel admins post. */
    postPolicy: text('post_policy').$type<'all' | 'admins'>().notNull().default('all'),
    /** Both user ids, sorted — one DM per pair. */
    dmKey: text('dm_key').unique(),
    color: text('color'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: ts('created_at').notNull().default(sql`now()`),
    /** Highest message seq; bumped in the sending transaction (row lock keeps seqs gap-free per conversation). */
    lastSeq: bigint('last_seq', { mode: 'number' }).notNull().default(0),
    lastMessageAt: ts('last_message_at'),
  },
  (t) => [index('conversations_ws_idx').on(t.workspaceId, t.kind)],
);

export const conversationMembers = pgTable(
  'conversation_members',
  {
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').$type<'owner' | 'admin' | 'member'>().notNull().default('member'),
    joinedAt: ts('joined_at').notNull().default(sql`now()`),
    lastReadSeq: bigint('last_read_seq', { mode: 'number' }).notNull().default(0),
    pinned: boolean('pinned').notNull().default(false),
    muted: boolean('muted').notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.conversationId, t.userId] }), index('conversation_members_user_idx').on(t.userId)],
);

export const messages = pgTable(
  'messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    seq: bigint('seq', { mode: 'number' }).notNull(),
    senderId: uuid('sender_id').references(() => users.id, { onDelete: 'set null' }),
    /** 'text' from a person; 'system' for joins, renames… (body is the sentence). */
    kind: text('kind').$type<'text' | 'system'>().notNull().default('text'),
    /** Plain text with light Markdown; mentions are written as <@user-uuid>. */
    body: text('body').notNull(),
    mentions: uuid('mentions').array().notNull().default(sql`'{}'::uuid[]`),
    threadRootId: uuid('thread_root_id').references((): AnyPgColumn => messages.id, { onDelete: 'cascade' }),
    replyCount: integer('reply_count').notNull().default(0),
    lastReplyAt: ts('last_reply_at'),
    createdAt: ts('created_at').notNull().default(sql`now()`),
    editedAt: ts('edited_at'),
    deletedAt: ts('deleted_at'),
    pinnedAt: ts('pinned_at'),
    pinnedBy: uuid('pinned_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [uniqueIndex('messages_conversation_seq_idx').on(t.conversationId, t.seq), index('messages_thread_idx').on(t.threadRootId, t.createdAt)],
);

export const messageReactions = pgTable(
  'message_reactions',
  {
    messageId: uuid('message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    emoji: text('emoji').notNull(),
    createdAt: ts('created_at').notNull().default(sql`now()`),
  },
  (t) => [primaryKey({ columns: [t.messageId, t.userId, t.emoji] })],
);

/** Files a message points at (§65): attachments and internal links. Never a copy — the resource itself. */
export const messageRefs = pgTable(
  'message_refs',
  {
    messageId: uuid('message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    resourceId: uuid('resource_id')
      .notNull()
      .references(() => resources.id, { onDelete: 'cascade' }),
    position: integer('position').notNull().default(0),
    /** 'attachment' (picked or uploaded) or 'link' (a pasted link to a file). */
    source: text('source').$type<'attachment' | 'link'>().notNull().default('attachment'),
  },
  (t) => [primaryKey({ columns: [t.messageId, t.resourceId] }), index('message_refs_resource_idx').on(t.resourceId)],
);

/** The bell (§66): one row per person per event — mentions, thread replies, shares, comments. */
export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    resourceId: uuid('resource_id').references(() => resources.id, { onDelete: 'cascade' }),
    conversationId: uuid('conversation_id').references(() => conversations.id, { onDelete: 'cascade' }),
    messageId: uuid('message_id').references(() => messages.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    body: text('body'),
    url: text('url').notNull(),
    readAt: ts('read_at'),
    createdAt: ts('created_at').notNull().default(sql`now()`),
  },
  (t) => [index('notifications_user_idx').on(t.userId, t.createdAt)],
);

// ── Mail (Phase 7 module, docs/ARCHITECTURE.md §69) ─────────────────────────

/** A mailbox: one per person (their address on the workspace domain) and optionally one per space (shared). */
export const mailboxes = pgTable(
  'mailboxes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<'user' | 'space'>().notNull(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    spaceId: uuid('space_id').references(() => spaces.id, { onDelete: 'cascade' }),
    /** Lower-case address, unique across the system. */
    address: text('address').notNull().unique(),
    name: text('name').notNull(),
    signature: text('signature'),
    createdAt: ts('created_at').notNull().default(sql`now()`),
  },
  (t) => [uniqueIndex('mailboxes_user_idx').on(t.userId), uniqueIndex('mailboxes_space_idx').on(t.spaceId)],
);

export type MailAddress = { address: string; name: string | null };

/** A message, stored once whatever the number of mailboxes it sits in. Drafts are messages with status 'draft'. */
export const mailMessages = pgTable(
  'mail_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    status: text('status').$type<'draft' | 'sent'>().notNull().default('sent'),
    /** RFC 5322 Message-ID (without angle brackets); threading uses it with In-Reply-To / References. */
    messageId: text('message_id').notNull().unique(),
    inReplyTo: text('in_reply_to'),
    references: text('references').array().notNull().default(sql`'{}'::text[]`),
    fromAddress: text('from_address').notNull(),
    fromName: text('from_name'),
    to: jsonb('to').$type<MailAddress[]>().notNull().default([]),
    cc: jsonb('cc').$type<MailAddress[]>().notNull().default([]),
    /** Only ever shown to the sender's mailbox. */
    bcc: jsonb('bcc').$type<MailAddress[]>().notNull().default([]),
    subject: text('subject').notNull().default(''),
    text: text('text').notNull().default(''),
    html: text('html'),
    /** The person who wrote it (null for mail from outside). */
    authorId: uuid('author_id').references(() => users.id, { onDelete: 'set null' }),
    external: boolean('external').notNull().default(false),
    sentAt: ts('sent_at'),
    createdAt: ts('created_at').notNull().default(sql`now()`),
    updatedAt: ts('updated_at').notNull().default(sql`now()`),
  },
  (t) => [index('mail_messages_ws_idx').on(t.workspaceId)],
);

/** A conversation inside one mailbox (each mailbox threads its own copy). */
export const mailThreads = pgTable(
  'mail_threads',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    mailboxId: uuid('mailbox_id')
      .notNull()
      .references(() => mailboxes.id, { onDelete: 'cascade' }),
    subject: text('subject').notNull().default(''),
    lastAt: ts('last_at').notNull().default(sql`now()`),
    /** Shared mailboxes: who is handling it (§69). */
    assigneeId: uuid('assignee_id').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [index('mail_threads_mailbox_idx').on(t.mailboxId, t.lastAt)],
);

/** A message in a mailbox: where it is filed and its read / starred state there. */
export const mailItems = pgTable(
  'mail_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    mailboxId: uuid('mailbox_id')
      .notNull()
      .references(() => mailboxes.id, { onDelete: 'cascade' }),
    threadId: uuid('thread_id')
      .notNull()
      .references(() => mailThreads.id, { onDelete: 'cascade' }),
    messageId: uuid('message_id')
      .notNull()
      .references(() => mailMessages.id, { onDelete: 'cascade' }),
    /** 'in' = received, 'out' = sent or draft from this mailbox. */
    direction: text('direction').$type<'in' | 'out'>().notNull(),
    folder: text('folder').$type<'inbox' | 'sent' | 'drafts' | 'archive' | 'trash'>().notNull(),
    readAt: ts('read_at'),
    starred: boolean('starred').notNull().default(false),
    labels: text('labels').array().notNull().default(sql`'{}'::text[]`),
    createdAt: ts('created_at').notNull().default(sql`now()`),
  },
  (t) => [
    uniqueIndex('mail_items_unique_idx').on(t.mailboxId, t.messageId, t.direction),
    index('mail_items_folder_idx').on(t.mailboxId, t.folder),
    index('mail_items_thread_idx').on(t.threadId),
  ],
);

/** Attachments are copies, as in any e-mail: a blob with its name, kept with the message. */
export const mailAttachments = pgTable(
  'mail_attachments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    /** Null while attached to a message being written (uploaded, not sent yet). */
    messageId: uuid('message_id').references(() => mailMessages.id, { onDelete: 'cascade' }),
    blobId: uuid('blob_id')
      .notNull()
      .references(() => blobs.id),
    name: text('name').notNull(),
    mimeType: text('mime_type'),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull().default(0),
    uploadedBy: uuid('uploaded_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: ts('created_at').notNull().default(sql`now()`),
  },
  (t) => [index('mail_attachments_message_idx').on(t.messageId), index('mail_attachments_uploader_idx').on(t.uploadedBy)],
);

// ── Calendar (Phase 7, docs/ARCHITECTURE.md §71) ────────────────────────────

/** A calendar: one per person ("My Calendar") and optionally one per space (team calendar). */
export const calendars = pgTable(
  'calendars',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<'user' | 'space'>().notNull(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    spaceId: uuid('space_id').references(() => spaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    color: text('color').notNull().default('#2563eb'),
    timezone: text('timezone').notNull().default('Asia/Tokyo'),
    createdAt: ts('created_at').notNull().default(sql`now()`),
  },
  (t) => [uniqueIndex('calendars_user_idx').on(t.userId), uniqueIndex('calendars_space_idx').on(t.spaceId)],
);

export const calendarEvents = pgTable(
  'calendar_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    calendarId: uuid('calendar_id')
      .notNull()
      .references(() => calendars.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<'event' | 'focus' | 'ooo'>().notNull().default('event'),
    title: text('title').notNull(),
    description: text('description'),
    location: text('location'),
    /** Start / end instants; all-day events run from local midnight to midnight in `timezone` (end exclusive). */
    startAt: ts('start_at').notNull(),
    endAt: ts('end_at').notNull(),
    allDay: boolean('all_day').notNull().default(false),
    timezone: text('timezone').notNull().default('Asia/Tokyo'),
    /** Repeats: none, or {freq, interval, until?, count?, byDay?} in the event's time zone. */
    recurrence: jsonb('recurrence').$type<{ freq: 'daily' | 'weekly' | 'monthly' | 'yearly'; interval: number; until?: string | null; count?: number | null; byDay?: number[] } | null>(),
    /** Occurrences removed from a series (their original start instants). */
    exdates: text('exdates').array().notNull().default(sql`'{}'::text[]`),
    meetingUrl: text('meeting_url'),
    meetingProvider: text('meeting_provider').$type<'office' | 'google' | 'zoom' | 'teams' | 'custom'>(),
    color: text('color'),
    visibility: text('visibility').$type<'default' | 'private'>().notNull().default('default'),
    organizerId: uuid('organizer_id').references(() => users.id, { onDelete: 'set null' }),
    attachments: uuid('attachments').array().notNull().default(sql`'{}'::uuid[]`),
    /** Bumped on every change (iCalendar SEQUENCE for updates sent to outside guests). */
    sequence: integer('sequence').notNull().default(0),
    createdAt: ts('created_at').notNull().default(sql`now()`),
    updatedAt: ts('updated_at').notNull().default(sql`now()`),
  },
  (t) => [index('calendar_events_range_idx').on(t.calendarId, t.startAt, t.endAt)],
);

/** Guests: people of the workspace (userId) or outside addresses (email). */
export const eventAttendees = pgTable(
  'event_attendees',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => calendarEvents.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    name: text('name'),
    response: text('response').$type<'pending' | 'accepted' | 'tentative' | 'declined'>().notNull().default('pending'),
    optional: boolean('optional').notNull().default(false),
    respondedAt: ts('responded_at'),
  },
  (t) => [uniqueIndex('event_attendees_unique_idx').on(t.eventId, t.email), index('event_attendees_user_idx').on(t.userId)],
);

// ── Tasks (Phase 7, docs/ARCHITECTURE.md §72) ───────────────────────────────

export type TaskStatusDef = { id: string; name: string; color: string; category: 'todo' | 'doing' | 'done'; next?: string[]; resolution?: string };

/** A project of a space: its board columns (statuses) and the key of its task numbers (WEB-12). */
export const projects = pgTable(
  'projects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    spaceId: uuid('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    color: text('color').notNull().default('#2563eb'),
    statuses: jsonb('statuses').$type<TaskStatusDef[]>().notNull(),
    /** Next task number. */
    counter: integer('counter').notNull().default(0),
    /** How the project is run (§76): which views lead (board + sprints, flow board, Gantt with phases, or both). */
    methodology: text('methodology').$type<'scrum' | 'kanban' | 'waterfall' | 'hybrid' | 'ai-dlc'>().notNull().default('kanban'),
    /** Project lead: gets new requests from the intake queue. */
    leadId: uuid('lead_id').references(() => users.id, { onDelete: 'set null' }),
    /** Anyone who can see the project may file requests (they wait in Triage). */
    intakeOpen: boolean('intake_open').notNull().default(true),
    /** Scrum (§76): default sprint length in days, and when the 15-minute daily takes place (local time). */
    sprintDays: integer('sprint_days').notNull().default(14),
    dailyTime: text('daily_time').notNull().default('09:30'),
    /** Work-in-progress limit per status column (status id → max cards). */
    wipLimits: jsonb('wip_limits').$type<Record<string, number>>().notNull().default({}),
    /** Which professional workflow the statuses came from (§76), and whether its transitions are enforced. */
    workflow: text('workflow').$type<'software' | 'scrum' | 'basic' | 'bug' | 'waterfall' | 'custom'>().notNull().default('scrum'),
    strictWorkflow: boolean('strict_workflow').notNull().default(false),
    /** The project's documentation space (a folder in its Space, §76 batch 3). */
    /** Definition of Done (§76 quality): the checklist every work item meets; enforced when `enforce_dod`. */
    dod: jsonb('dod').$type<string[]>().notNull().default([]),
    enforceDod: boolean('enforce_dod').notNull().default(false),
    docsFolderId: uuid('docs_folder_id').references((): AnyPgColumn => resources.id, { onDelete: 'set null' }),
    archivedAt: ts('archived_at'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: ts('created_at').notNull().default(sql`now()`),
  },
  (t) => [uniqueIndex('projects_key_idx').on(t.workspaceId, t.key), index('projects_space_idx').on(t.spaceId)],
);

export const tasks = pgTable(
  'tasks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    /** Null for personal tasks (My tasks). */
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }),
    number: integer('number'),
    parentId: uuid('parent_id').references((): AnyPgColumn => tasks.id, { onDelete: 'cascade' }),
    /** Issue type (§76): phase › epic › story / task / bug / milestone › subtask. */
    type: text('type').$type<'phase' | 'epic' | 'story' | 'task' | 'bug' | 'subtask' | 'milestone'>().notNull().default('task'),
    title: text('title').notNull(),
    description: text('description'),
    status: text('status').notNull(),
    priority: text('priority').$type<'none' | 'low' | 'medium' | 'high' | 'urgent'>().notNull().default('none'),
    assigneeId: uuid('assignee_id').references(() => users.id, { onDelete: 'set null' }),
    /** Who asked for it (the requester of an intake request). */
    reporterId: uuid('reporter_id').references(() => users.id, { onDelete: 'set null' }),
    storyPoints: integer('story_points'),
    estimateMinutes: integer('estimate_minutes'),
    /** A request waiting in the intake queue (not on the board until accepted). */
    triage: boolean('triage').notNull().default(false),
    /** Why it is closed: done, declined, duplicate, won't do. */
    resolution: text('resolution'),
    /** Acceptance criteria (Given / When / Then…), each ticked when met. */
    criteria: jsonb('criteria').$type<{ id: string; text: string; done: boolean }[]>().notNull().default([]),
    /** Phase gate (§76 waterfall): exit approval of a phase — none / requested / approved / rejected. */
    gateStatus: text('gate_status').$type<'none' | 'requested' | 'approved' | 'rejected'>().notNull().default('none'),
    gateApprovers: uuid('gate_approvers').array().notNull().default(sql`'{}'::uuid[]`),
    gateDecisions: jsonb('gate_decisions').$type<{ userId: string; decision: 'approve' | 'reject'; comment: string | null; at: string }[]>().notNull().default([]),
    /** Definition of Done items of the project ticked on this issue (by text). */
    dodDone: jsonb('dod_done').$type<string[]>().notNull().default([]),
    /** The sprint it is planned in (Scrum, §76). */
    sprintId: uuid('sprint_id').references((): AnyPgColumn => sprints.id, { onDelete: 'set null' }),
    /** Order in the backlog and inside a sprint (fractional, like `position` on the board). */
    rank: text('rank').notNull().default('m'),
    /** Where it came from, e.g. { kind: 'chat', conversationId, messageId }. */
    source: jsonb('source').$type<Record<string, unknown> | null>(),
    tags: text('tags').array().notNull().default(sql`'{}'::text[]`),
    startDate: date('start_date'),
    dueDate: date('due_date'),
    /** 0–100, set by hand (Gantt); a task with subtasks shows its subtasks' share done instead. */
    progress: integer('progress').notNull().default(0),
    /** Order inside its column (fractional, so moving a card touches one row). */
    position: text('position').notNull().default('m'),
    completedAt: ts('completed_at'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: ts('created_at').notNull().default(sql`now()`),
    updatedAt: ts('updated_at').notNull().default(sql`now()`),
  },
  (t) => [index('tasks_project_idx').on(t.projectId, t.status), index('tasks_assignee_idx').on(t.assigneeId), index('tasks_parent_idx').on(t.parentId)],
);

/** Comments and the activity trail of a task (kind 'comment' or 'change'). */
export const taskEvents = pgTable(
  'task_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    kind: text('kind').$type<'comment' | 'change'>().notNull(),
    body: text('body'),
    data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: ts('created_at').notNull().default(sql`now()`),
  },
  (t) => [index('task_events_task_idx').on(t.taskId, t.createdAt)],
);

// ── Meetings (Phase 7, §73) ────────────────────────────────────────────────

/**
 * A video room (WebRTC mesh). Opened on its own (instant / for later), from a conversation (call button) or from a
 * calendar event's Office Meet link. Who is in the room right now lives in memory (MeetingsService); this row keeps
 * the room's settings and history.
 */
export const meetings = pgTable(
  'meetings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    /** abc-defg-hij — the part after /meetings?room= */
    code: text('code').notNull().unique(),
    title: text('title').notNull(),
    hostId: uuid('host_id').references(() => users.id, { onDelete: 'set null' }),
    conversationId: uuid('conversation_id').references(() => conversations.id, { onDelete: 'set null' }),
    eventId: uuid('event_id').references(() => calendarEvents.id, { onDelete: 'set null' }),
    /** 'open': anyone in the workspace joins directly; 'trusted': invited people join, others ask to join. */
    access: text('access').$type<'open' | 'trusted'>().notNull().default('open'),
    notesId: uuid('notes_id').references(() => resources.id, { onDelete: 'set null' }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: ts('created_at').notNull().default(sql`now()`),
    /** The current (or last) session: first join → last leave. */
    startedAt: ts('started_at'),
    endedAt: ts('ended_at'),
  },
  (t) => [index('meetings_ws_idx').on(t.workspaceId, t.createdAt), index('meetings_conversation_idx').on(t.conversationId)],
);

/** Everyone who took part (or was let in / removed): history, the "admitted" list and who gets recordings. */
export const meetingParticipants = pgTable(
  'meeting_participants',
  {
    meetingId: uuid('meeting_id')
      .notNull()
      .references(() => meetings.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').$type<'host' | 'cohost' | 'guest'>().notNull().default('guest'),
    /** admitted: let in from the lobby (joins directly from now on); removed: must ask again. */
    status: text('status').$type<'joined' | 'admitted' | 'removed'>().notNull().default('joined'),
    firstJoinedAt: ts('first_joined_at'),
    lastJoinedAt: ts('last_joined_at'),
    lastLeftAt: ts('last_left_at'),
    /** Seconds spent in the room over all visits. */
    seconds: integer('seconds').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.meetingId, t.userId] }), index('meeting_participants_user_idx').on(t.userId)],
);

/** In-call chat. */
export const meetingMessages = pgTable(
  'meeting_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    meetingId: uuid('meeting_id')
      .notNull()
      .references(() => meetings.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    body: text('body').notNull(),
    createdAt: ts('created_at').notNull().default(sql`now()`),
  },
  (t) => [index('meeting_messages_meeting_idx').on(t.meetingId, t.createdAt)],
);

/** Recordings are ordinary Drive videos; this links them to the meeting. */
export const meetingRecordings = pgTable(
  'meeting_recordings',
  {
    meetingId: uuid('meeting_id')
      .notNull()
      .references(() => meetings.id, { onDelete: 'cascade' }),
    resourceId: uuid('resource_id')
      .notNull()
      .references(() => resources.id, { onDelete: 'cascade' }),
    durationMs: integer('duration_ms').notNull().default(0),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: ts('created_at').notNull().default(sql`now()`),
  },
  (t) => [primaryKey({ columns: [t.meetingId, t.resourceId] })],
);

// ── Approvals (Phase 7, §74) ───────────────────────────────────────────────

/** An approval form + process (Leave request, Expense reimbursement…). Fields and steps are JSON (shared types). */
export const approvalTemplates = pgTable(
  'approval_templates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    category: text('category').notNull().default('General'),
    icon: text('icon').notNull().default('file-check'),
    color: text('color').notNull().default('#2563eb'),
    fields: jsonb('fields').$type<unknown[]>().notNull().default([]),
    steps: jsonb('steps').$type<unknown[]>().notNull().default([]),
    /** Extra template managers (besides workspace owners / admins): edit it, see all its requests. */
    admins: uuid('admins').array().notNull().default(sql`'{}'::uuid[]`),
    /** What happens once approved, e.g. { calendarOoo: { fieldId } } puts the dates in the submitter's calendar. */
    onApproved: jsonb('on_approved').$type<Record<string, unknown> | null>(),
    enabled: boolean('enabled').notNull().default(true),
    position: integer('position').notNull().default(0),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: ts('created_at').notNull().default(sql`now()`),
    updatedAt: ts('updated_at').notNull().default(sql`now()`),
  },
  (t) => [index('approval_templates_ws_idx').on(t.workspaceId)],
);

/** One submitted request. The template's fields and the resolved route are copied in at submit time. */
export const approvalRequests = pgTable(
  'approval_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    templateId: uuid('template_id')
      .notNull()
      .references(() => approvalTemplates.id, { onDelete: 'cascade' }),
    /** Number inside the workspace (AP-00012). */
    serial: integer('serial').notNull(),
    title: text('title').notNull(),
    fields: jsonb('fields').$type<unknown[]>().notNull(),
    values: jsonb('values').$type<Record<string, unknown>>().notNull(),
    /** Steps as resolved for this request: who, mode, skipped (and why). */
    route: jsonb('route').$type<unknown[]>().notNull(),
    status: text('status').$type<'pending' | 'approved' | 'rejected' | 'withdrawn'>().notNull().default('pending'),
    currentStep: integer('current_step').notNull().default(0),
    submittedBy: uuid('submitted_by')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    submittedAt: ts('submitted_at').notNull().default(sql`now()`),
    finishedAt: ts('finished_at'),
    remindedAt: ts('reminded_at'),
  },
  (t) => [
    uniqueIndex('approval_requests_serial_idx').on(t.workspaceId, t.serial),
    index('approval_requests_submitter_idx').on(t.submittedBy, t.submittedAt),
    index('approval_requests_template_idx').on(t.templateId),
  ],
);

/** A person's part in one step: approve (waiting → pending → approved / rejected / transferred / skipped) or CC. */
export const approvalTasks = pgTable(
  'approval_tasks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    requestId: uuid('request_id')
      .notNull()
      .references(() => approvalRequests.id, { onDelete: 'cascade' }),
    stepIndex: integer('step_index').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<'approve' | 'cc'>().notNull(),
    status: text('status').$type<'waiting' | 'pending' | 'approved' | 'rejected' | 'transferred' | 'skipped' | 'cc'>().notNull().default('waiting'),
    comment: text('comment'),
    transferredTo: uuid('transferred_to').references(() => users.id, { onDelete: 'set null' }),
    /** Approved automatically (the submitter was an approver). */
    auto: boolean('auto').notNull().default(false),
    activatedAt: ts('activated_at'),
    actedAt: ts('acted_at'),
  },
  (t) => [index('approval_tasks_request_idx').on(t.requestId, t.stepIndex), index('approval_tasks_user_idx').on(t.userId, t.status)],
);

/** The timeline of a request: submitted, approved, rejected, transferred, comments, withdrawn, reminders. */
export const approvalEvents = pgTable(
  'approval_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    requestId: uuid('request_id')
      .notNull()
      .references(() => approvalRequests.id, { onDelete: 'cascade' }),
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    kind: text('kind').notNull(),
    stepIndex: integer('step_index'),
    body: text('body'),
    data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: ts('created_at').notNull().default(sql`now()`),
  },
  (t) => [index('approval_events_request_idx').on(t.requestId, t.createdAt)],
);

/** Issue links (§76): A blocks B (dependency, also finish-to-start on the Gantt), relates to, duplicates. */
export const taskLinks = pgTable(
  'task_links',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    fromId: uuid('from_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    toId: uuid('to_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<'blocks' | 'relates' | 'duplicates'>().notNull(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: ts('created_at').notNull().default(sql`now()`),
  },
  (t) => [uniqueIndex('task_links_pair_idx').on(t.fromId, t.toId, t.kind), index('task_links_to_idx').on(t.toId)],
);

/** People following an issue: told about comments and changes. */
export const taskWatchers = pgTable(
  'task_watchers',
  {
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.taskId, t.userId] }), index('task_watchers_user_idx').on(t.userId)],
);

/** A sprint (§76): a timebox of a project with a goal; one active at a time. */
export const sprints = pgTable(
  'sprints',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    /** The epic this sprint delivers (§76: a project has epics, an epic has sprints). */
    epicId: uuid('epic_id').references((): AnyPgColumn => tasks.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    goal: text('goal'),
    startDate: date('start_date').notNull(),
    endDate: date('end_date').notNull(),
    state: text('state').$type<'planned' | 'active' | 'closed'>().notNull().default('planned'),
    /** Calendar events of the ceremonies: { planning, daily, review, retro } → event id. */
    ceremonies: jsonb('ceremonies').$type<Record<string, string>>().notNull().default({}),
    /** At start: what the team took on. At the end: what got done. */
    committedPoints: integer('committed_points'),
    committedCount: integer('committed_count'),
    completedPoints: integer('completed_points'),
    completedCount: integer('completed_count'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: ts('created_at').notNull().default(sql`now()`),
    startedAt: ts('started_at'),
    completedAt: ts('completed_at'),
  },
  (t) => [index('sprints_project_idx').on(t.projectId, t.startDate)],
);

/** Retrospective board cards: what went well, what to improve, action items (which can become issues). */
export const retroItems = pgTable(
  'retro_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sprintId: uuid('sprint_id')
      .notNull()
      .references(() => sprints.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<'good' | 'improve' | 'action'>().notNull(),
    body: text('body').notNull(),
    authorId: uuid('author_id').references(() => users.id, { onDelete: 'set null' }),
    votes: uuid('votes').array().notNull().default(sql`'{}'::uuid[]`),
    taskId: uuid('task_id').references(() => tasks.id, { onDelete: 'set null' }),
    createdAt: ts('created_at').notNull().default(sql`now()`),
  },
  (t) => [index('retro_items_sprint_idx').on(t.sprintId)],
);

/** Traceability (§76): an issue implements / is described by a document (BRD, PRD, use case…). */
export const taskDocs = pgTable(
  'task_docs',
  {
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    resourceId: uuid('resource_id')
      .notNull()
      .references(() => resources.id, { onDelete: 'cascade' }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: ts('created_at').notNull().default(sql`now()`),
  },
  (t) => [primaryKey({ columns: [t.taskId, t.resourceId] }), index('task_docs_resource_idx').on(t.resourceId)],
);

/** Time logged on an issue (worklog). */
export const taskWorklogs = pgTable(
  'task_worklogs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    minutes: integer('minutes').notNull(),
    day: date('day').notNull(),
    note: text('note'),
    createdAt: ts('created_at').notNull().default(sql`now()`),
  },
  (t) => [index('task_worklogs_task_idx').on(t.taskId, t.day)],
);

// ── Base (§75): tables, fields, views and records of a `base` resource ──────

export const baseTables = pgTable(
  'base_tables',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    baseId: uuid('base_id')
      .notNull()
      .references(() => resources.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    position: integer('position').notNull().default(0),
    /** The field that names a record (cannot be deleted or hidden). */
    primaryFieldId: uuid('primary_field_id'),
    /** Last auto number handed out. */
    autoSeq: integer('auto_seq').notNull().default(0),
    createdAt: ts('created_at').notNull().default(sql`now()`),
  },
  (t) => [index('base_tables_base_idx').on(t.baseId, t.position)],
);

export const baseFields = pgTable(
  'base_fields',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tableId: uuid('table_id')
      .notNull()
      .references(() => baseTables.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    type: text('type').notNull(),
    options: jsonb('options').$type<Record<string, unknown>>().notNull().default({}),
    description: text('description'),
    position: integer('position').notNull().default(0),
  },
  (t) => [index('base_fields_table_idx').on(t.tableId, t.position)],
);

export const baseViews = pgTable(
  'base_views',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tableId: uuid('table_id')
      .notNull()
      .references(() => baseTables.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    type: text('type').notNull(),
    config: jsonb('config').$type<Record<string, unknown>>().notNull().default({}),
    position: integer('position').notNull().default(0),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [index('base_views_table_idx').on(t.tableId, t.position)],
);

export const baseRecords = pgTable(
  'base_records',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tableId: uuid('table_id')
      .notNull()
      .references(() => baseTables.id, { onDelete: 'cascade' }),
    /** Values by field id. */
    values: jsonb('values').$type<Record<string, unknown>>().notNull().default({}),
    /** Fractional key: manual order. */
    position: text('position').notNull(),
    autoNumber: integer('auto_number').notNull(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: ts('created_at').notNull().default(sql`now()`),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
    updatedAt: ts('updated_at').notNull().default(sql`now()`),
  },
  (t) => [index('base_records_table_idx').on(t.tableId, t.position)],
);

export const baseComments = pgTable(
  'base_comments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    recordId: uuid('record_id')
      .notNull()
      .references(() => baseRecords.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    body: text('body').notNull(),
    createdAt: ts('created_at').notNull().default(sql`now()`),
  },
  (t) => [index('base_comments_record_idx').on(t.recordId, t.createdAt)],
);

// ── Wiki (§78): Confluence-style spaces with a page tree ───────────────────

/** A wiki space: its pages live (flat) in a Drive folder whose roles are the space's permissions. */
export const wikiSpaces = pgTable(
  'wiki_spaces',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    color: text('color').notNull().default('#2563eb'),
    folderId: uuid('folder_id')
      .notNull()
      .references(() => resources.id, { onDelete: 'cascade' }),
    homePageId: uuid('home_page_id'),
    /** The Tasks project whose documentation this is (§76: one space per project). */
    projectId: uuid('project_id').references((): AnyPgColumn => projects.id, { onDelete: 'set null' }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: ts('created_at').notNull().default(sql`now()`),
  },
  (t) => [uniqueIndex('wiki_spaces_key_idx').on(t.workspaceId, t.key)],
);

/** A page of a space: the content is a `wiki` resource; here is its place in the tree and its status. */
export const wikiPages = pgTable(
  'wiki_pages',
  {
    resourceId: uuid('resource_id')
      .primaryKey()
      .references(() => resources.id, { onDelete: 'cascade' }),
    spaceId: uuid('space_id')
      .notNull()
      .references(() => wikiSpaces.id, { onDelete: 'cascade' }),
    parentId: uuid('parent_id'),
    position: text('position').notNull(),
    /** '' (none), draft, in_progress, review, approved, deprecated */
    status: text('status').notNull().default(''),
    labels: text('labels').array().notNull().default(sql`'{}'::text[]`),
    template: text('template'),
    ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: ts('created_at').notNull().default(sql`now()`),
  },
  (t) => [index('wiki_pages_space_idx').on(t.spaceId, t.parentId, t.position)],
);

// ── Organisation & admin (§79): sign-in, system settings, invitations ──────

/** A password sign-in (scrypt). Users without a row can only be picked in dev mode. */
export const authCredentials = pgTable('auth_credentials', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  hash: text('hash').notNull(),
  changedAt: ts('changed_at').notNull().default(sql`now()`),
});

/** A signed-in browser: the cookie holds a random token, the row its sha256. */
export const authSessions = pgTable(
  'auth_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tokenHash: text('token_hash').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userAgent: text('user_agent'),
    ip: text('ip'),
    createdAt: ts('created_at').notNull().default(sql`now()`),
    lastSeenAt: ts('last_seen_at').notNull().default(sql`now()`),
    expiresAt: ts('expires_at').notNull(),
  },
  (t) => [uniqueIndex('auth_sessions_token_idx').on(t.tokenHash), index('auth_sessions_user_idx').on(t.userId)],
);

/** One-time links: password resets (1 hour). */
export const authTokens = pgTable(
  'auth_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tokenHash: text('token_hash').notNull(),
    kind: text('kind').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: ts('expires_at').notNull(),
    usedAt: ts('used_at'),
    createdAt: ts('created_at').notNull().default(sql`now()`),
  },
  (t) => [uniqueIndex('auth_tokens_token_idx').on(t.tokenHash)],
);

// ── Flow automation (docs/ARCHITECTURE.md §77 batch 2) ──────────────────────

/** Trigger shapes of every flow, kept in sync from the Yjs document on save, so events find the flows to start. */
export const flowTriggers = pgTable(
  'flow_triggers',
  {
    flowId: uuid('flow_id')
      .notNull()
      .references(() => resources.id, { onDelete: 'cascade' }),
    nodeId: text('node_id').notNull(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    pageId: text('page_id').notNull(),
    type: text('type').notNull(),
    config: jsonb('config').$type<Record<string, unknown>>().notNull().default({}),
    /** The flow's automation switch (info.automation). */
    enabled: boolean('enabled').notNull().default(false),
    nextRunAt: ts('next_run_at'),
    updatedAt: ts('updated_at').notNull().default(sql`now()`),
  },
  (t) => [primaryKey({ columns: [t.flowId, t.nodeId] }), index('flow_triggers_type_idx').on(t.workspaceId, t.type, t.enabled), index('flow_triggers_due_idx').on(t.enabled, t.nextRunAt)],
);

/** One run of a flow: the trigger that started it, every step with its result, and where it waits. */
export const flowRuns = pgTable(
  'flow_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    flowId: uuid('flow_id')
      .notNull()
      .references(() => resources.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    pageId: text('page_id').notNull(),
    triggerNodeId: text('trigger_node_id').notNull(),
    triggerType: text('trigger_type').notNull(),
    trigger: jsonb('trigger').$type<Record<string, unknown>>().notNull().default({}),
    status: text('status').$type<'running' | 'waiting' | 'succeeded' | 'failed' | 'cancelled'>().notNull().default('running'),
    steps: jsonb('steps').$type<Record<string, unknown>[]>().notNull().default([]),
    /** Outputs by step (`steps.<nodeId>`) for later templates. */
    context: jsonb('context').$type<Record<string, unknown>>().notNull().default({}),
    /** Node ids still to visit when the run resumes after a wait. */
    pending: jsonb('pending').$type<string[]>().notNull().default([]),
    resumeAt: ts('resume_at'),
    error: text('error'),
    runBy: uuid('run_by').references(() => users.id, { onDelete: 'set null' }),
    startedAt: ts('started_at').notNull().default(sql`now()`),
    finishedAt: ts('finished_at'),
  },
  (t) => [index('flow_runs_flow_idx').on(t.flowId, t.startedAt), index('flow_runs_due_idx').on(t.status, t.resumeAt)],
);

// ── AI (docs/ARCHITECTURE.md §80) ───────────────────────────────────────────

/**
 * The prompt library of a workspace: overrides of built-in prompts (same key as the built-in) and people's own
 * prompts (key "custom.<id>"). Built-ins themselves live in code (apps/api/src/ai/prompts.ts).
 */
export const aiPrompts = pgTable(
  'ai_prompts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    name: text('name').notNull(),
    app: text('app').notNull(),
    output: text('output').notNull(),
    description: text('description').notNull().default(''),
    system: text('system').notNull(),
    template: text('template').notNull(),
    temperature: real('temperature').notNull().default(0.3),
    variables: jsonb('variables').$type<{ name: string; label: string; example: string }[]>().notNull().default([]),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: ts('created_at').notNull().default(sql`now()`),
    updatedAt: ts('updated_at').notNull().default(sql`now()`),
  },
  (t) => [uniqueIndex('ai_prompts_key_idx').on(t.workspaceId, t.key)],
);

/** One AI job: the prompt it ran, the model, the answer, what it produced (a file, a page) — history and audit. */
export const aiRuns = pgTable(
  'ai_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    promptKey: text('prompt_key').notNull(),
    output: text('output').notNull(),
    model: text('model'),
    status: text('status').$type<'queued' | 'running' | 'done' | 'failed' | 'cancelled'>().notNull().default('queued'),
    request: text('request').notNull().default(''),
    input: jsonb('input').$type<Record<string, unknown>>().notNull().default({}),
    answer: text('answer'),
    result: jsonb('result').$type<Record<string, unknown>>(),
    error: text('error'),
    promptTokens: integer('prompt_tokens'),
    outputTokens: integer('output_tokens'),
    ms: integer('ms'),
    createdAt: ts('created_at').notNull().default(sql`now()`),
    finishedAt: ts('finished_at'),
  },
  (t) => [index('ai_runs_user_idx').on(t.workspaceId, t.userId, t.createdAt)],
);

/** Workspace settings by key (e.g. `smtp`); secrets inside are encrypted (AES-256-GCM). */
export const systemSettings = pgTable(
  'system_settings',
  {
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    value: jsonb('value').$type<Record<string, unknown>>().notNull(),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
    updatedAt: ts('updated_at').notNull().default(sql`now()`),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.key] })],
);

/** An invitation to join a workspace (link valid 7 days), with the teams to join and the position in each. */
export const invitations = pgTable(
  'invitations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    role: role('role').notNull().default('editor'),
    teams: jsonb('teams').$type<{ spaceId: string; role: string; title?: string | null }[]>().notNull().default([]),
    message: text('message'),
    tokenHash: text('token_hash').notNull(),
    /** pending | accepted | revoked */
    status: text('status').notNull().default('pending'),
    invitedBy: uuid('invited_by').references(() => users.id, { onDelete: 'set null' }),
    acceptedBy: uuid('accepted_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: ts('created_at').notNull().default(sql`now()`),
    expiresAt: ts('expires_at').notNull(),
  },
  (t) => [uniqueIndex('invitations_token_idx').on(t.tokenHash), index('invitations_ws_idx').on(t.workspaceId, t.status)],
);
