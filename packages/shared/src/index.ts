// Shared contract between apps/web and apps/api.
// See docs/ARCHITECTURE.md §5 (Unified Resource Model) and §6 (Permissions).

export const RESOURCE_TYPES = [
  'folder',
  'document',
  'spreadsheet',
  'presentation',
  'pdf',
  'image',
  'video',
  'file',
  'base',
  'wiki',
  'form',
  'shortcut',
  'note',
] as const;
export type ResourceType = (typeof RESOURCE_TYPES)[number];

/** Types whose content lives in a collaborative Yjs document rather than a blob. */
export const NATIVE_TYPES: ResourceType[] = ['document', 'spreadsheet', 'presentation', 'wiki', 'base', 'form', 'note'];

export const ROLES = ['viewer', 'commenter', 'editor', 'admin', 'owner'] as const;
export type Role = (typeof ROLES)[number];

export function roleRank(role: Role | null | undefined): number {
  return role ? ROLES.indexOf(role) : -1;
}
export function maxRole(...roles: (Role | null | undefined)[]): Role | null {
  let best: Role | null = null;
  for (const r of roles) if (r && roleRank(r) > roleRank(best)) best = r;
  return best;
}
export function can(role: Role | null | undefined, needed: Role): boolean {
  return roleRank(role) >= roleRank(needed);
}

export type GeneralAccess = 'restricted' | 'workspace' | 'anyone_with_link';

export interface UserSummary {
  id: string;
  name: string;
  email: string;
  avatarColor: string;
  title?: string | null;
  department?: string | null;
}

export interface Workspace {
  id: string;
  name: string;
  slug: string;
}

export interface Space {
  id: string;
  workspaceId: string;
  parentId: string | null;
  name: string;
  description: string | null;
  icon: string | null;
  color: string | null;
  visibility: 'public' | 'private';
  createdAt: string;
  myRole: Role | null;
  memberCount?: number;
}

export interface SpaceMember {
  user: UserSummary;
  role: Role;
}

export interface Resource {
  id: string;
  workspaceId: string;
  spaceId: string | null;
  parentId: string | null;
  name: string;
  type: ResourceType;
  ownerId: string;
  owner?: UserSummary;
  createdAt: string;
  updatedAt: string;
  updatedBy: string | null;
  version: number;
  sizeBytes: number;
  mimeType: string | null;
  description: string | null;
  tags: string[];
  generalAccess: GeneralAccess;
  generalRole: Role | null;
  metadata: Record<string, unknown>;
  trashedAt: string | null;
  path: string[];
  /** Computed per viewer */
  myRole?: Role | null;
  starred?: boolean;
}

export interface Breadcrumb {
  id: string;
  name: string;
  kind: 'space' | 'folder' | 'root';
}

export interface ResourceDetail extends Resource {
  breadcrumb: Breadcrumb[];
  space?: Pick<Space, 'id' | 'name' | 'color' | 'icon'> | null;
}

export interface AclEntry {
  principal: UserSummary;
  role: Role;
  source: 'owner' | 'direct' | 'inherited' | 'space';
  sourceName?: string;
}

export interface ActivityEvent {
  id: string;
  actor: UserSummary | null;
  action: string;
  resourceId: string | null;
  data: Record<string, unknown>;
  createdAt: string;
}

export type DriveView = 'home' | 'my' | 'shared' | 'recent' | 'starred' | 'trash';

export interface ListResourcesQuery {
  view?: DriveView;
  parentId?: string;
  spaceId?: string;
  type?: ResourceType;
  sort?: 'name' | 'updatedAt' | 'size' | 'type';
  order?: 'asc' | 'desc';
  /** With spaceId: include items in sub-folders, not just the space root. */
  deep?: boolean;
}

export interface CreateResourceInput {
  name: string;
  type: ResourceType;
  parentId?: string | null;
  spaceId?: string | null;
  /** Documents, spreadsheets, presentations: template id (doc-model / sheet-model / slide-model templates). */
  template?: string;
}

export interface UpdateResourceInput {
  name?: string;
  description?: string | null;
  tags?: string[];
  parentId?: string | null;
  spaceId?: string | null;
  generalAccess?: GeneralAccess;
  generalRole?: Role | null;
  /** Notes: notebook path, e.g. "Inbox", "Projects/Q4 Strategy". */
  notebook?: string | null;
  /** Notes: user-defined page properties. */
  properties?: NoteProperty[];
}

export interface NoteProperty {
  key: string;
  value: string;
}

export interface ResourceLinks {
  linked: Resource[];
  backlinks: Resource[];
}

export interface SearchHit {
  kind: 'resource' | 'person' | 'space';
  id: string;
  title: string;
  subtitle?: string;
  type?: ResourceType;
}

/** Map an uploaded file to a resource type. */
export function resourceTypeFromFile(name: string, mime?: string | null): ResourceType {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  if (['docx', 'doc', 'odt', 'rtf'].includes(ext)) return 'document';
  if (['xlsx', 'xlsm', 'xls', 'csv', 'ods'].includes(ext)) return 'spreadsheet';
  if (['pptx', 'ppt', 'odp'].includes(ext)) return 'presentation';
  if (ext === 'pdf' || mime === 'application/pdf') return 'pdf';
  if (mime?.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)) return 'image';
  if (mime?.startsWith('video/') || ['mp4', 'webm', 'mov'].includes(ext)) return 'video';
  return 'file';
}

/** Office files are stored as their original blob until the converter (Phase 2–4) imports them. */
export function isOfficeFile(name: string): boolean {
  return /\.(docx?|xlsx?|xlsm|pptx?|csv|od[tsp]|rtf)$/i.test(name);
}

export interface WorkspaceStats {
  members: number;
  spaces: number;
  filesCreated7d: number;
  filesCreatedPrev7d: number;
  storageBytes: number;
}

export interface ResourceVersion {
  id: string;
  version: number;
  label: string | null;
  sizeBytes: number;
  createdAt: string;
  createdBy: UserSummary | null;
}

export interface Me {
  user: UserSummary;
  workspace: Workspace;
  workspaces: Workspace[];
}

// ── Phase 2: documents ───────────────────────────────────────────────────────

export interface CommentAnchor {
  /** Yjs RelativePosition JSON — survives concurrent edits. */
  from: unknown;
  to: unknown;
  /** Documents: the tab the comment was made in (absent = first tab). */
  tab?: string;
}

export interface CommentReply {
  id: string;
  author: UserSummary;
  body: string;
  createdAt: string;
  editedAt: string | null;
}

export interface CommentThread extends CommentReply {
  anchor: CommentAnchor | null;
  quote: string | null;
  resolvedAt: string | null;
  resolvedBy: UserSummary | null;
  replies: CommentReply[];
}

export interface CollabTokenResponse {
  token: string;
  url: string;
  role: Role;
  document: string;
}

export interface ImportReport {
  status: 'done' | 'failed' | 'unsupported' | 'pending';
  source?: string;
  at?: string;
  message?: string;
  preserved?: string[];
  degraded?: string[];
  dropped?: string[];
  warnings?: string[];
}

// ── Phase 5: chat (docs/ARCHITECTURE.md §64) ────────────────────────────────

export type ConversationKind = 'dm' | 'group' | 'channel';
export type ConversationRole = 'owner' | 'admin' | 'member';

export interface ChatReaction {
  emoji: string;
  count: number;
  /** Up to a few names for the tooltip; `mine` says whether the viewer reacted. */
  users: string[];
  userIds: string[];
  /** Computed for the viewer — recompute from `userIds` for messages pushed over the socket. */
  mine: boolean;
}

/**
 * A file a message points at (§65), with live metadata. Shown only to people who can open it — for everyone
 * else it is a locked card (`accessible: false`, no name).
 */
export interface ChatAttachment {
  id: string;
  accessible: boolean;
  source: 'attachment' | 'link';
  name: string | null;
  type: ResourceType | null;
  mimeType: string | null;
  sizeBytes: number | null;
  metadata: Record<string, unknown> | null;
  owner: string | null;
  updatedAt: string | null;
  trashed: boolean;
}

export interface ChatMessage {
  id: string;
  conversationId: string;
  seq: number;
  kind: 'text' | 'system';
  sender: UserSummary | null;
  /** Light Markdown; mentions are <@user-uuid> and rendered with the names in `people`. */
  body: string;
  mentions: string[];
  threadRootId: string | null;
  replyCount: number;
  lastReplyAt: string | null;
  /** Up to three people who replied in the thread (for the avatar row under the message). */
  repliers: UserSummary[];
  reactions: ChatReaction[];
  attachments: ChatAttachment[];
  pinnedAt: string | null;
  pinnedBy: UserSummary | null;
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
}

/** 409 from sending: some members cannot open a file — the sender chooses to share it, or send anyway. */
export interface ChatAccessProblem {
  code: 'needs_access';
  message: string;
  missing: { resourceId: string; name: string; users: Pick<UserSummary, 'id' | 'name'>[] }[];
}

/** A file shared in a conversation (Files tab). */
export interface ChatFile {
  messageId: string;
  sender: UserSummary | null;
  sentAt: string;
  file: ChatAttachment;
}

/**
 * What the viewer may do in a conversation (§68). In channels it follows the role in the space, like Discord roles:
 * viewer reads, commenter writes and reacts, editor also attaches files, admin / owner moderate and manage.
 */
export interface ChatPerms {
  post: boolean;
  attach: boolean;
  react: boolean;
  /** Delete others' messages. */
  moderate: boolean;
  /** Rename, change settings and members. */
  manage: boolean;
}

export interface ChannelCategory {
  id: string;
  spaceId: string;
  name: string;
  position: number;
}

export interface ConversationSummary {
  id: string;
  kind: ConversationKind;
  /** Channel / group name; for a DM, the other person's name. */
  title: string;
  description: string | null;
  visibility: 'public' | 'private';
  color: string | null;
  /** The space (server) of a channel; null for direct and group messages. */
  spaceId: string | null;
  categoryId: string | null;
  position: number;
  /** 'admins' = announcement channel. */
  postPolicy: 'all' | 'admins';
  perms: ChatPerms;
  /** The other person of a DM. */
  peer: UserSummary | null;
  /** A few members for the avatar of groups. */
  faces: UserSummary[];
  memberCount: number;
  lastMessage: { body: string; sender: string | null; senderId: string | null; kind: 'text' | 'system'; createdAt: string; files: number } | null;
  lastMessageAt: string | null;
  lastSeq: number;
  lastReadSeq: number;
  unread: number;
  mentions: number;
  pinned: boolean;
  muted: boolean;
  role: ConversationRole;
}

export interface ConversationMember extends UserSummary {
  role: ConversationRole;
  lastReadSeq: number;
  joinedAt: string;
}

export interface ConversationDetail extends ConversationSummary {
  members: ConversationMember[];
  createdAt: string;
  createdBy: UserSummary | null;
  /** False while previewing a public channel. */
  joined: boolean;
}

/** A public channel the viewer can join (Browse channels). */
export interface ChannelListing {
  id: string;
  title: string;
  description: string | null;
  color: string | null;
  memberCount: number;
  joined: boolean;
}

/** Events pushed over the realtime socket (/realtime). */
export type RealtimeEvent =
  | { type: 'chat.message'; conversationId: string; message: ChatMessage }
  | { type: 'chat.message.updated'; conversationId: string; message: ChatMessage }
  | { type: 'chat.read'; conversationId: string; userId: string; seq: number }
  | { type: 'chat.typing'; conversationId: string; user: Pick<UserSummary, 'id' | 'name'>; threadRootId: string | null }
  | { type: 'chat.conversation'; conversationId: string; removed?: boolean }
  | { type: 'chat.categories'; spaceId: string }
  | { type: 'presence'; online: string[] }
  | { type: 'notification'; notification: AppNotification }
  | { type: 'notification.read'; ids: string[] | 'all' }
  | { type: 'mail.changed'; mailboxId: string }
  | { type: 'mail.received'; mailboxId: string; threadId: string; subject: string; from: string }
  | { type: 'calendar.changed' }
  | { type: 'tasks.changed'; projectId: string | null }
  | { type: 'approvals.changed'; requestId: string | null }
  /** Base (§75): records / schema / comments changed — sent to people who have the base open. */
  | { type: 'base.changed'; baseId: string; change: { kind: 'records' | 'schema' | 'comments'; tableId?: string; upserted?: unknown[]; deleted?: string[]; recordId?: string } }
  | MeetingEvent;

// ── Notifications (§66) ─────────────────────────────────────────────────────

export type NotificationKind = 'chat.mention' | 'chat.reply' | 'resource.shared' | 'comment.created' | 'comment.reply' | 'calendar.invite' | 'calendar.response' | 'task.assigned' | 'task.comment' | 'task.request' | 'task.gate' | 'meeting.call' | 'approval.pending' | 'approval.result' | 'approval.cc' | 'approval.comment';

export interface AppNotification {
  id: string;
  kind: NotificationKind;
  actor: UserSummary | null;
  title: string;
  body: string | null;
  url: string;
  resourceId: string | null;
  conversationId: string | null;
  readAt: string | null;
  createdAt: string;
}

// ── Contacts & profiles (§67) ───────────────────────────────────────────────

/** A person in the directory: the summary plus what the Contacts list shows and searches. */
export interface Contact extends UserSummary {
  phone: string | null;
  location: string | null;
  status: string | null;
  skills: string[];
  managerId: string | null;
  /** Spaces the person belongs to that the viewer can see ("Projects"). */
  projects: { id: string; name: string; color: string | null }[];
  joinedAt: string | null;
}

export interface UserProfile extends Contact {
  manager: UserSummary | null;
  /** The chain above the manager, nearest first (Organization tab). */
  chain: UserSummary[];
  reports: UserSummary[];
  /** Files the person owns that the viewer can open, most recently updated first. */
  files: Resource[];
  activity: ActivityEvent[];
  isMe: boolean;
  /** The viewer may edit this profile (themselves, or a workspace owner). */
  canEdit: boolean;
  /** Only workspace owners change title, department and manager of other people. */
  canEditOrg: boolean;
}

export interface UpdateProfileInput {
  phone?: string | null;
  location?: string | null;
  status?: string | null;
  skills?: string[];
  title?: string | null;
  department?: string | null;
  managerId?: string | null;
}

// ── Mail (§69) ──────────────────────────────────────────────────────────────

export type MailFolder = 'inbox' | 'starred' | 'sent' | 'drafts' | 'archive' | 'trash' | 'all';

export interface MailAddr {
  address: string;
  name: string | null;
}

/** What the viewer may do with a mailbox: a person's own one fully; a space one by their role in the space. */
export interface MailboxPerms {
  read: boolean;
  /** Send, reply, file and mark messages. */
  write: boolean;
  /** Settings of a shared mailbox (space admins). */
  manage: boolean;
}

export interface Mailbox {
  id: string;
  kind: 'user' | 'space';
  address: string;
  name: string;
  spaceId: string | null;
  signature: string | null;
  perms: MailboxPerms;
  unread: number;
  drafts: number;
}

export interface MailAttachmentInfo {
  id: string;
  name: string;
  mimeType: string | null;
  sizeBytes: number;
}

export interface MailThreadSummary {
  id: string;
  mailboxId: string;
  subject: string;
  /** Senders of the thread (names), newest last. */
  participants: string[];
  snippet: string;
  lastAt: string;
  count: number;
  unread: boolean;
  starred: boolean;
  hasAttachments: boolean;
  hasDraft: boolean;
  folders: string[];
  assignee: UserSummary | null;
}

export interface MailMessageView {
  id: string;
  status: 'draft' | 'sent';
  direction: 'in' | 'out';
  from: MailAddr;
  to: MailAddr[];
  cc: MailAddr[];
  /** Only for the sender's own copy. */
  bcc: MailAddr[];
  subject: string;
  text: string;
  html: string | null;
  sentAt: string | null;
  read: boolean;
  starred: boolean;
  external: boolean;
  author: UserSummary | null;
  attachments: MailAttachmentInfo[];
  messageId: string;
}

export interface MailThreadView extends MailThreadSummary {
  messages: MailMessageView[];
  mailbox: Mailbox;
}

export interface SendMailInput {
  mailboxId: string;
  to: MailAddr[];
  cc?: MailAddr[];
  bcc?: MailAddr[];
  subject: string;
  text: string;
  /** Uploaded attachments (POST /mail/attachments) and Drive files to attach. */
  attachmentIds?: string[];
  resourceIds?: string[];
  /** The message this replies to / forwards (its id in our system). */
  replyTo?: string | null;
  draftId?: string | null;
}

// ── Calendar (§71) ──────────────────────────────────────────────────────────

export type EventResponse = 'pending' | 'accepted' | 'tentative' | 'declined';
export interface Recurrence {
  freq: 'daily' | 'weekly' | 'monthly' | 'yearly';
  interval: number;
  until?: string | null;
  count?: number | null;
  /** Weekly: days of the week (0 = Sunday). */
  byDay?: number[];
}

export interface CalendarInfo {
  id: string;
  kind: 'user' | 'space';
  name: string;
  color: string;
  timezone: string;
  spaceId: string | null;
  owner: UserSummary | null;
  /** read = see details; write = add / change events; manage = settings. */
  perms: { read: boolean; write: boolean; manage: boolean };
}

export interface EventAttendee {
  id: string;
  email: string;
  name: string | null;
  user: UserSummary | null;
  response: EventResponse;
  optional: boolean;
}

/** One occurrence of an event in a requested range (a series yields one per occurrence). */
export interface CalendarEventView {
  id: string;
  /** Original start of this occurrence (identifies it inside a series). */
  occurrence: string;
  calendarId: string;
  kind: 'event' | 'focus' | 'ooo';
  title: string;
  description: string | null;
  location: string | null;
  start: string;
  end: string;
  allDay: boolean;
  timezone: string;
  recurrence: Recurrence | null;
  meetingUrl: string | null;
  meetingProvider: 'kaori' | 'google' | 'zoom' | 'teams' | 'custom' | null;
  color: string | null;
  organizer: UserSummary | null;
  attendees: EventAttendee[];
  /** The viewer's answer when invited. */
  myResponse: EventResponse | null;
  attachments: { id: string; name: string | null; type: ResourceType | null; accessible: boolean }[];
  canEdit: boolean;
  /** Someone else's time seen as busy only (no title, place or guests). */
  busyOnly: boolean;
}

export interface EventInput {
  calendarId: string;
  kind?: 'event' | 'focus' | 'ooo';
  title: string;
  description?: string | null;
  location?: string | null;
  start: string;
  end: string;
  allDay?: boolean;
  timezone?: string;
  recurrence?: Recurrence | null;
  meeting?: { provider: 'kaori' | 'google' | 'zoom' | 'teams' | 'custom'; url?: string | null } | null;
  color?: string | null;
  guests?: { email: string; name?: string | null; optional?: boolean }[];
  attachments?: string[];
  /** Send invitations (bell + mail with an .ics); the note goes at the top of the mail. */
  notify?: boolean;
  message?: string | null;
}

// Time zones without a library: wall-clock time in an IANA zone ⇄ instants.
export function tzOffsetMinutes(date: Date, tz: string) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(date)
      .map((x) => [x.type, x.value]),
  );
  return (Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second) - Math.floor(date.getTime() / 1000) * 1000) / 60000;
}

/** The instant of a wall-clock time (month 1–12) in a time zone. */
export function zonedToUtc(y: number, m: number, d: number, h: number, mi: number, tz: string): Date {
  const guess = Date.UTC(y, m - 1, d, h, mi);
  const off = tzOffsetMinutes(new Date(guess), tz);
  let t = guess - off * 60000;
  const off2 = tzOffsetMinutes(new Date(t), tz);
  if (off2 !== off) t = guess - off2 * 60000;
  return new Date(t);
}

/** Wall-clock parts of an instant in a time zone (month 1–12, weekday 0 = Sunday). */
export function zonedParts(date: Date, tz: string) {
  const shifted = new Date(date.getTime() + tzOffsetMinutes(date, tz) * 60000);
  return { y: shifted.getUTCFullYear(), m: shifted.getUTCMonth() + 1, d: shifted.getUTCDate(), h: shifted.getUTCHours(), mi: shifted.getUTCMinutes(), weekday: shifted.getUTCDay() };
}

// ── Tasks (§72) ─────────────────────────────────────────────────────────────

export type TaskPriority = 'none' | 'low' | 'medium' | 'high' | 'urgent';
export interface TaskStatus {
  id: string;
  name: string;
  color: string;
  category: 'todo' | 'doing' | 'done';
  /** Statuses an issue may move to from here (workflow transitions); none listed = anywhere. */
  next?: string[];
  /** Done statuses only: the resolution it records (cancelled, wontfix…); default "done". */
  resolution?: string;
}

export type WorkflowId = 'software' | 'scrum' | 'basic' | 'bug' | 'waterfall' | 'custom';

/**
 * Professional workflows (§76): the status sets and transitions of common systems (Jira Software's development
 * workflow with QA, the classic bug lifecycle, a stage-gate waterfall). Ids are shared where the meaning is the same
 * (todo, doing, review, done…) so switching workflows keeps issues where they are.
 */
export const WORKFLOWS: { id: Exclude<WorkflowId, 'custom'>; name: string; note: string; statuses: TaskStatus[] }[] = [
  {
    id: 'software',
    name: 'Software development',
    note: 'Jira-style SDLC: code review, QA testing, fixing and retest, UAT, release',
    statuses: [
      { id: 'todo', name: 'To Do', color: '#64748b', category: 'todo', next: ['doing', 'cancelled'] },
      { id: 'doing', name: 'In Progress', color: '#2563eb', category: 'doing', next: ['review', 'todo', 'cancelled'] },
      { id: 'review', name: 'Code Review', color: '#8b5cf6', category: 'doing', next: ['ready_qa', 'doing'] },
      { id: 'ready_qa', name: 'Ready for QA', color: '#0ea5e9', category: 'doing', next: ['testing', 'doing'] },
      { id: 'testing', name: 'In Testing', color: '#0891b2', category: 'doing', next: ['fixing', 'uat', 'ready_release'] },
      { id: 'fixing', name: 'Fixing', color: '#ef4444', category: 'doing', next: ['retest'] },
      { id: 'retest', name: 'Retest', color: '#f97316', category: 'doing', next: ['fixing', 'uat', 'ready_release'] },
      { id: 'uat', name: 'UAT', color: '#a855f7', category: 'doing', next: ['fixing', 'ready_release'] },
      { id: 'ready_release', name: 'Ready for Release', color: '#14b8a6', category: 'doing', next: ['done', 'fixing'] },
      { id: 'done', name: 'Done', color: '#10b981', category: 'done', next: ['fixing', 'todo'] },
      { id: 'cancelled', name: 'Cancelled', color: '#94a3b8', category: 'done', resolution: 'cancelled', next: ['todo'] },
    ],
  },
  {
    id: 'scrum',
    name: 'Scrum (simple)',
    note: 'To Do, In Progress, Review, Done — any move allowed',
    statuses: [
      { id: 'todo', name: 'To Do', color: '#64748b', category: 'todo' },
      { id: 'doing', name: 'In Progress', color: '#2563eb', category: 'doing' },
      { id: 'review', name: 'Review', color: '#8b5cf6', category: 'doing' },
      { id: 'done', name: 'Done', color: '#10b981', category: 'done' },
    ],
  },
  {
    id: 'basic',
    name: 'Basic',
    note: 'To Do, In Progress, Done',
    statuses: [
      { id: 'todo', name: 'To Do', color: '#64748b', category: 'todo' },
      { id: 'doing', name: 'In Progress', color: '#2563eb', category: 'doing' },
      { id: 'done', name: 'Done', color: '#10b981', category: 'done' },
    ],
  },
  {
    id: 'bug',
    name: 'Bug tracking',
    note: 'Classic defect lifecycle: confirm, fix, retest, verify, close or reopen',
    statuses: [
      { id: 'todo', name: 'New', color: '#64748b', category: 'todo', next: ['confirmed', 'wontfix'] },
      { id: 'confirmed', name: 'Confirmed', color: '#6366f1', category: 'todo', next: ['doing', 'wontfix'] },
      { id: 'doing', name: 'In Progress', color: '#2563eb', category: 'doing', next: ['fixed'] },
      { id: 'fixed', name: 'Fixed', color: '#0ea5e9', category: 'doing', next: ['retest'] },
      { id: 'retest', name: 'Retest', color: '#f97316', category: 'doing', next: ['verified', 'reopened'] },
      { id: 'reopened', name: 'Reopened', color: '#ef4444', category: 'doing', next: ['doing'] },
      { id: 'verified', name: 'Verified', color: '#14b8a6', category: 'doing', next: ['done', 'reopened'] },
      { id: 'done', name: 'Closed', color: '#10b981', category: 'done', next: ['reopened'] },
      { id: 'wontfix', name: "Won't Fix", color: '#94a3b8', category: 'done', resolution: 'wontfix', next: ['reopened'] },
    ],
  },
  {
    id: 'waterfall',
    name: 'Waterfall (stage gate)',
    note: 'Not started, in progress, review, approval at the gate, completed; on hold and cancelled',
    statuses: [
      { id: 'todo', name: 'Not Started', color: '#64748b', category: 'todo', next: ['doing', 'hold', 'cancelled'] },
      { id: 'doing', name: 'In Progress', color: '#2563eb', category: 'doing', next: ['review', 'hold', 'cancelled'] },
      { id: 'review', name: 'In Review', color: '#8b5cf6', category: 'doing', next: ['approved', 'doing'] },
      { id: 'approved', name: 'Approved', color: '#14b8a6', category: 'doing', next: ['done', 'doing'] },
      { id: 'hold', name: 'On Hold', color: '#f59e0b', category: 'doing', next: ['doing', 'cancelled'] },
      { id: 'done', name: 'Completed', color: '#10b981', category: 'done', next: ['doing'] },
      { id: 'cancelled', name: 'Cancelled', color: '#94a3b8', category: 'done', resolution: 'cancelled', next: ['todo'] },
    ],
  },
];

/** May an issue go from one status to another under this workflow? */
export function canTransition(statuses: TaskStatus[], from: string, to: string) {
  if (from === to) return true;
  const f = statuses.find((s) => s.id === from);
  return !f?.next?.length || f.next.includes(to);
}

/** Issue types (§76), from the top of the hierarchy down: phase › epic › story / task / bug / milestone › subtask. */
export const ISSUE_TYPES = ['phase', 'epic', 'story', 'task', 'bug', 'milestone', 'subtask'] as const;
export type IssueType = (typeof ISSUE_TYPES)[number];
/** Level in the hierarchy: a parent's rank is always lower than its children's. */
export const ISSUE_RANK: Record<IssueType, number> = { phase: 0, epic: 1, story: 2, task: 2, bug: 2, milestone: 2, subtask: 3 };
/** The work items of a board / sprint (not containers, not subtasks). */
export const WORK_TYPES: IssueType[] = ['story', 'task', 'bug'];
export type Methodology = 'scrum' | 'kanban' | 'waterfall' | 'hybrid' | 'ai-dlc';
export type IssueLinkKind = 'blocks' | 'relates' | 'duplicates';
/** Methodologies that plan in sprints (AI-DLC calls them bolts). */
export const isAgile = (m?: Methodology | null) => m === 'scrum' || m === 'hybrid' || m === 'ai-dlc';
/** Methodologies whose phases close only through an approved stage gate. */
export const needsGate = (m?: Methodology | null) => m === 'waterfall' || m === 'hybrid' || m === 'ai-dlc';
/** AI-DLC (AI-Driven Development Lifecycle) words: a sprint is a bolt (hours to days), an epic a unit of work. */
export const sprintWord = (m?: Methodology | null) => (m === 'ai-dlc' ? 'Bolt' : 'Sprint');
/**
 * AI-DLC phases: AI proposes and executes, people decide at every gate. Inception turns the intent into units of
 * work (mob elaboration), Construction designs, generates and tests each unit in bolts (mob construction),
 * Operations deploys and watches it. Exit criteria become the phase gate.
 */
export const AIDLC_PHASES: { title: string; weeks: number; description: string; criteria: string[] }[] = [
  {
    title: 'Inception',
    weeks: 1,
    description: 'Mob elaboration: AI drafts requirements, stories and units of work from the intent; the team questions, corrects and approves them.',
    criteria: ['Intent and business context captured', 'User stories with acceptance criteria approved', 'Units of work defined and approved', 'NFRs, risks and constraints reviewed'],
  },
  {
    title: 'Construction',
    weeks: 3,
    description: 'Mob construction in bolts: per unit, AI proposes the domain model, logical design, code and tests; people validate each step.',
    criteria: ['Domain and logical design approved for every unit', 'Generated code reviewed by a person', 'Automated tests pass', 'Security and quality checks pass'],
  },
  {
    title: 'Operations',
    weeks: 1,
    description: 'AI prepares infrastructure as code, deployment and observability; people approve the release and the runbook.',
    criteria: ['Infrastructure as code reviewed', 'Deployed to production', 'Monitoring and alerts in place', 'Runbook handed over'],
  },
];

/** Default child type when breaking an item down. */
export function childTypeOf(parent: IssueType): IssueType {
  return parent === 'phase' ? 'task' : parent === 'epic' ? 'story' : 'subtask';
}

export interface Project {
  id: string;
  key: string;
  name: string;
  description: string | null;
  color: string;
  spaceId: string;
  statuses: TaskStatus[];
  methodology: Methodology;
  lead: UserSummary | null;
  intakeOpen: boolean;
  /** Default sprint length (days) and the daily standup time (HH:MM). */
  sprintDays: number;
  dailyTime: string;
  /** Status id → most cards allowed in that column. */
  wipLimits: Record<string, number>;
  /** The workflow the statuses came from, and whether its transitions are enforced. */
  workflow: WorkflowId;
  strictWorkflow: boolean;
  /** Definition of Done, and whether a work item must meet it (and its acceptance criteria) to be Done. */
  dod: string[];
  enforceDod: boolean;
  /** read = see; write = create / change tasks; comment = discuss; manage = statuses, settings. */
  perms: { read: boolean; comment: boolean; write: boolean; manage: boolean };
  /** Work items (stories, tasks, bugs) — not containers, subtasks or requests in triage. */
  counts: { total: number; done: number; overdue: number; triage: number };
}

export interface TaskView {
  id: string;
  projectId: string | null;
  /** "WEB-12" (or null for personal tasks). */
  ref: string | null;
  parentId: string | null;
  type: IssueType;
  title: string;
  description: string | null;
  status: string;
  priority: TaskPriority;
  assignee: UserSummary | null;
  reporter: UserSummary | null;
  storyPoints: number | null;
  estimateMinutes: number | null;
  /** Waiting in the intake queue. */
  triage: boolean;
  resolution: string | null;
  source: { kind: 'chat'; conversationId: string; messageId: string } | null;
  /** Unfinished issues that block this one. */
  blockedBy: number;
  sprintId: string | null;
  /** Order in the backlog / inside a sprint. */
  rank: string;
  /** Acceptance criteria, each ticked when met. */
  criteria: AcceptanceCriterion[];
  /** Definition of Done items ticked on this issue. */
  dodDone: string[];
  /** Time logged on it. */
  spentMinutes: number;
  /** Phases: the exit gate (approval needed before the phase is Done in waterfall / hybrid projects). */
  gate: PhaseGate | null;
  tags: string[];
  startDate: string | null;
  dueDate: string | null;
  progress: number;
  position: string;
  completedAt: string | null;
  createdBy: UserSummary | null;
  createdAt: string;
  updatedAt: string;
  subtasks: { total: number; done: number };
  comments: number;
  canEdit: boolean;
}

export interface TaskEventView {
  id: string;
  kind: 'comment' | 'change';
  actor: UserSummary | null;
  body: string | null;
  data: Record<string, unknown>;
  createdAt: string;
}

export interface TaskInput {
  projectId?: string | null;
  parentId?: string | null;
  type?: IssueType;
  reporterId?: string | null;
  storyPoints?: number | null;
  estimateMinutes?: number | null;
  /** Accept a request from the intake queue (false). */
  triage?: boolean;
  /** Made from a chat message. */
  source?: { kind: 'chat'; conversationId: string; messageId: string } | null;
  /** Plan into a sprint (null = backlog). */
  sprintId?: string | null;
  criteria?: AcceptanceCriterion[];
  dodDone?: string[];
  /** Backlog / sprint order: drop between these two issues. */
  rankAfter?: string | null;
  rankBefore?: string | null;
  title: string;
  description?: string | null;
  status?: string;
  priority?: TaskPriority;
  assigneeId?: string | null;
  tags?: string[];
  startDate?: string | null;
  dueDate?: string | null;
  progress?: number;
  /** Place the card between these two neighbours of its column (board drag and drop). */
  before?: string | null;
  after?: string | null;
}

export type SprintState = 'planned' | 'active' | 'closed';
export type CeremonyKind = 'planning' | 'daily' | 'review' | 'retro';

export interface SprintView {
  id: string;
  projectId: string;
  name: string;
  goal: string | null;
  startDate: string;
  endDate: string;
  state: SprintState;
  /** Ceremony → calendar event id. */
  ceremonies: Partial<Record<CeremonyKind, string>>;
  /** Issues in the sprint now. */
  counts: { total: number; done: number; points: number; donePoints: number };
  committedPoints: number | null;
  completedPoints: number | null;
  committedCount: number | null;
  completedCount: number | null;
  startedAt: string | null;
  completedAt: string | null;
}

export interface SprintReport {
  sprint: SprintView;
  /** Story points when issues have them, else issue counts. */
  unit: 'points' | 'issues';
  burndown: { day: string; remaining: number | null; ideal: number }[];
  done: TaskView[];
  notDone: TaskView[];
}

export interface VelocityRow {
  sprintId: string;
  name: string;
  committed: number;
  completed: number;
}

export interface RetroItemView {
  id: string;
  kind: 'good' | 'improve' | 'action';
  body: string;
  author: UserSummary | null;
  votes: number;
  voted: boolean;
  task: { id: string; ref: string | null; done: boolean } | null;
  createdAt: string;
}

/** Ceremony invitations when a sprint starts (times are local to the calendar's zone). */
export interface CeremonyPlan {
  schedule: boolean;
  /** HH:MM of the daily standup (15 minutes, Monday–Friday). */
  dailyTime?: string;
  /** People invited besides the organizer (default: the lead and everyone with an issue in the sprint). */
  guests?: string[];
}

export interface TaskLinkView {
  id: string;
  kind: IssueLinkKind;
  /** out: this issue → other ("blocks", "relates to", "duplicates"); in: other → this ("is blocked by"…). */
  direction: 'out' | 'in';
  task: { id: string; ref: string | null; title: string; type: IssueType; status: string; done: boolean; projectId: string | null };
}

/** One issue with everything the side panel shows. */
export interface TaskDetail extends TaskView {
  events: TaskEventView[];
  children: TaskView[];
  statuses: TaskStatus[];
  /** Parents from the top (phase › epic › …). */
  ancestors: { id: string; ref: string | null; title: string; type: IssueType }[];
  links: TaskLinkView[];
  watchers: UserSummary[];
  watching: boolean;
  /** Documents it traces to (requirements, specs, use cases…). */
  docs: { id: string; name: string; type: ResourceType; accessible: boolean }[];
  worklogs: WorklogView[];
}

export interface PhaseGate {
  status: 'none' | 'requested' | 'approved' | 'rejected';
  approvers: UserSummary[];
  decisions: { user: UserSummary | null; decision: 'approve' | 'reject'; comment: string | null; at: string }[];
}

export interface AcceptanceCriterion {
  id: string;
  text: string;
  done: boolean;
}

export interface WorklogView {
  id: string;
  user: UserSummary | null;
  minutes: number;
  day: string;
  note: string | null;
  createdAt: string;
}

/** The usual Definition of Done of a software team (new projects start with it). */
export const DEFAULT_DOD = ['Acceptance criteria met', 'Code reviewed', 'Tests pass', 'QA tested, no open critical bugs', 'Documentation updated', 'Product owner accepted'];

/** Quality of the process (§76): defects, rework, flow, compliance, time. */
export interface QualityStats {
  bugs: { open: number; closed: number; critical: number; perTenPoints: number | null };
  /** Bugs opened vs closed per week, last 8 weeks. */
  bugTrend: { week: string; opened: number; closed: number }[];
  /** Done work items reopened at least once / sent back from QA to Fixing. */
  reopened: number;
  reopenRate: number;
  qaRejections: number;
  /** Days: created → done, and first in progress → done (work items done in the last 90 days). */
  leadDays: number | null;
  cycleDays: number | null;
  blocked: number;
  overdue: number;
  /** Share of done work items that ticked the whole Definition of Done / have acceptance criteria. */
  dodCompliance: number | null;
  criteriaCoverage: number | null;
  time: { estimateMinutes: number; spentMinutes: number };
}

/** A page or folder of a project's documentation space (§76). */
export interface ProjectDocNode {
  id: string;
  name: string;
  type: ResourceType;
  parentId: string | null;
  updatedAt: string;
  updatedBy: UserSummary | null;
  /** Issues linked to this page. */
  linked: number;
}

export interface ProjectDocs {
  folderId: string | null;
  nodes: ProjectDocNode[];
}

/** Requirements traceability: a document and the issues that implement it. */
export interface TraceRow {
  doc: { id: string; name: string; inProjectDocs: boolean };
  issues: { id: string; ref: string | null; title: string; type: IssueType; status: string; done: boolean }[];
}

/** A line of a document that can become an issue (a bullet, a checklist item, a table row's first cell). */
export interface DocItem {
  text: string;
  section: string | null;
}

export interface ProjectStats {
  total: number;
  done: number;
  completionRate: number;
  onTimeRate: number;
  avgCycleDays: number | null;
  overdue: number;
  byStatus: { status: string; name: string; color: string; count: number }[];
  /** Created vs completed per day over the last 30 days. */
  trend: { day: string; created: number; completed: number }[];
  people: { user: UserSummary; assigned: number; done: number; onTime: number }[];
}

// Tasks board order (§72). Fractional positions: a key strictly between two others, so a moved card is the only row that changes.
const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
export function between(a: string | null, b: string | null): string {
  let lo = a ?? '';
  let hi = b ?? '';
  let out = '';
  for (let i = 0; i < 64; i++) {
    const ca = i < lo.length ? DIGITS.indexOf(lo[i]) : 0;
    const cb = i < hi.length ? DIGITS.indexOf(hi[i]) : DIGITS.length;
    if (ca === cb) {
      out += DIGITS[ca];
      continue;
    }
    const mid = Math.floor((ca + cb) / 2);
    if (mid > ca) return out + DIGITS[mid];
    out += DIGITS[ca];
    hi = '';
  }
  return out + 'V';
}

// ── Meetings (§73) ──────────────────────────────────────────────────────────

export const MEETING_CODE = /^[a-z0-9]{3}-[a-z0-9]{4}-[a-z0-9]{3}$/;
/** At most this many people in one room: every browser sends its video to every other (mesh). */
export const MEETING_MAX_PEERS = 8;
export const MEETING_REACTIONS = ['👍', '👏', '😂', '❤️', '🎉', '😮'] as const;

/** abc-defg-hij from 10 random bytes (letters only, like Google Meet). */
export function meetingCode(bytes: ArrayLike<number>): string {
  const a = 'abcdefghijkmnopqrstuvwxyz';
  const c = Array.from({ length: 10 }, (_, i) => a[(bytes[i] ?? 0) % a.length]).join('');
  return `${c.slice(0, 3)}-${c.slice(3, 7)}-${c.slice(7)}`;
}

/** The room code in a Kaori Meet link (…/meetings?room=abc-defg-hij), or null. */
export function meetingCodeFromUrl(url: string | null | undefined): string | null {
  const m = url?.match(/\/meetings\?(?:[^#\s]*&)?room=([a-z0-9]{3}-[a-z0-9]{4}-[a-z0-9]{3})\b/);
  return m ? m[1] : null;
}

export type MeetingRole = 'host' | 'cohost' | 'guest';

/** One browser tab in a room. A person joining from two tabs is two peers. */
export interface MeetingPeer {
  peerId: string;
  user: UserSummary;
  role: MeetingRole;
  mic: boolean;
  cam: boolean;
  /** Id of the MediaStream carrying the shared screen, or null. */
  screen: string | null;
  hand: boolean;
  joinedAt: string;
}

export interface MeetingRecordingInfo {
  by: UserSummary;
  since: string;
}

export interface MeetingSummary {
  id: string;
  code: string;
  title: string;
  host: UserSummary | null;
  conversationId: string | null;
  eventId: string | null;
  access: 'open' | 'trusted';
  /** Someone is in the room now. */
  live: boolean;
  startedAt: string | null;
  endedAt: string | null;
  createdAt: string;
  /** People in the room now (one entry per person). */
  inRoom: UserSummary[];
  /** Everyone who has joined at some point. */
  participants: UserSummary[];
  recordings: { id: string; name: string; durationMs: number }[];
  notesId: string | null;
}

export interface MeetingDetail extends MeetingSummary {
  me: {
    role: MeetingRole;
    /** 'join': straight in; 'knock': must be let in from the lobby. */
    entry: 'join' | 'knock';
    /** Host or co-host: admit, mute, remove, settings, record, end for everyone. */
    manage: boolean;
  };
  peers: MeetingPeer[];
  /** People waiting to be let in (only shown to those who may admit). */
  lobby: UserSummary[];
  recording: MeetingRecordingInfo | null;
  event: { id: string; title: string; startAt: string; endAt: string } | null;
  conversationTitle: string | null;
}

export interface MeetingMessage {
  id: string;
  user: UserSummary | null;
  body: string;
  createdAt: string;
}

export interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export type MeetingJoinResult = { state: 'joined'; peers: MeetingPeer[]; iceServers: IceServer[]; recording: MeetingRecordingInfo | null } | { state: 'waiting' };

export type MeetingEvent =
  | { type: 'meeting.peer.joined'; meetingId: string; peer: MeetingPeer }
  | { type: 'meeting.peer.updated'; meetingId: string; peer: MeetingPeer }
  | { type: 'meeting.peer.left'; meetingId: string; peerId: string }
  /** WebRTC offer / answer / ICE candidate from one peer to another. */
  | { type: 'meeting.signal'; meetingId: string; from: string; to: string; data: unknown }
  | { type: 'meeting.lobby'; meetingId: string; lobby: UserSummary[] }
  | { type: 'meeting.admitted'; meetingId: string }
  | { type: 'meeting.denied'; meetingId: string }
  | { type: 'meeting.removed'; meetingId: string }
  | { type: 'meeting.mute'; meetingId: string; peerId: string; by: string }
  | { type: 'meeting.ended'; meetingId: string }
  | { type: 'meeting.message'; meetingId: string; message: MeetingMessage }
  | { type: 'meeting.reaction'; meetingId: string; peerId: string; emoji: string }
  | { type: 'meeting.recording'; meetingId: string; recording: MeetingRecordingInfo | null }
  /** Incoming call (a call started in a DM or group you are in). */
  | { type: 'meeting.ring'; meetingId: string; code: string; title: string; from: UserSummary; conversationId: string | null }
  | { type: 'meeting.ring.stop'; meetingId: string }
  /** Settings, start / end or who is in the room changed — refetch cards and lists. */
  | { type: 'meeting.changed'; meetingId: string; code: string };

// ── Approvals (§74) ─────────────────────────────────────────────────────────

export const APPROVAL_FIELD_TYPES = ['text', 'textarea', 'number', 'money', 'date', 'daterange', 'select', 'multiselect', 'person', 'files'] as const;
export type ApprovalFieldType = (typeof APPROVAL_FIELD_TYPES)[number];

export interface ApprovalField {
  id: string;
  type: ApprovalFieldType;
  label: string;
  required: boolean;
  placeholder?: string | null;
  /** select / multiselect */
  options?: string[];
  /** money: ISO currency (JPY by default) */
  currency?: string;
  /** number: unit shown after the value ("days", "pcs") */
  unit?: string | null;
}

/** Who approves a step. */
export type ApproverSource =
  | { kind: 'users'; userIds: string[] }
  /** The submitter's manager (level 1) or their manager's manager (level 2), from the reporting line (§67). */
  | { kind: 'manager'; level: 1 | 2 }
  /** The submitter chooses when submitting. */
  | { kind: 'pick' }
  /** The person in a "person" field of the form. */
  | { kind: 'field'; fieldId: string };

export type ApprovalConditionOp = 'gt' | 'gte' | 'lt' | 'lte' | 'eq' | 'neq' | 'in';
/** A step only applies when this holds. On a date range the value is compared with its number of days. */
export interface ApprovalCondition {
  fieldId: string;
  op: ApprovalConditionOp;
  value: number | string | string[];
}

export interface ApprovalStep {
  id: string;
  name: string;
  type: 'approve' | 'cc';
  approvers: ApproverSource;
  /** and: everyone approves; or: the first approval is enough. */
  mode: 'and' | 'or';
  condition: ApprovalCondition | null;
}

export interface ApprovalTemplate {
  id: string;
  name: string;
  description: string | null;
  category: string;
  icon: string;
  color: string;
  fields: ApprovalField[];
  steps: ApprovalStep[];
  admins: UserSummary[];
  onApproved: { calendarOoo?: { fieldId: string } } | null;
  enabled: boolean;
  canManage: boolean;
  updatedAt: string;
}

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'withdrawn';
export type ApprovalTaskStatus = 'waiting' | 'pending' | 'approved' | 'rejected' | 'transferred' | 'skipped' | 'cc';

/** A step as resolved for one request (also the live preview while filling the form). */
export interface ApprovalRouteStep {
  stepId: string;
  name: string;
  type: 'approve' | 'cc';
  mode: 'and' | 'or';
  userIds: string[];
  /** Why the step does not apply: condition not met, nobody to ask. */
  skipped: string | null;
  /** The submitter must choose the approvers of this step. */
  needsPick?: boolean;
}

export interface ApprovalStepView {
  index: number;
  name: string;
  type: 'approve' | 'cc';
  mode: 'and' | 'or';
  state: 'done' | 'active' | 'upcoming' | 'skipped' | 'rejected';
  note: string | null;
  people: { user: UserSummary; status: ApprovalTaskStatus; comment: string | null; actedAt: string | null; auto: boolean; transferredTo: UserSummary | null }[];
}

export interface ApprovalEventView {
  id: string;
  actor: UserSummary | null;
  kind: 'submitted' | 'approved' | 'rejected' | 'transferred' | 'comment' | 'withdrawn' | 'cc' | 'reminded' | 'finished';
  stepIndex: number | null;
  body: string | null;
  data: Record<string, unknown>;
  createdAt: string;
}

export interface ApprovalRequestSummary {
  id: string;
  serial: string;
  title: string;
  template: { id: string; name: string; icon: string; color: string };
  submitter: UserSummary;
  status: ApprovalStatus;
  submittedAt: string;
  finishedAt: string | null;
  /** The first few answers, as text. */
  summary: { label: string; value: string }[];
  /** Who is being asked now. */
  waitingOn: UserSummary[];
  /** The viewer has to act on it. */
  mine: boolean;
}

export interface ApprovalRequestDetail extends ApprovalRequestSummary {
  fields: ApprovalField[];
  values: Record<string, unknown>;
  people: UserSummary[];
  files: { id: string; name: string; type: ResourceType; accessible: boolean }[];
  steps: ApprovalStepView[];
  events: ApprovalEventView[];
  perms: { approve: boolean; withdraw: boolean; remind: boolean; comment: boolean };
}

export type ApprovalBox = 'pending' | 'processed' | 'submitted' | 'cc' | 'all';

export interface ApprovalCounts {
  pending: number;
  cc: number;
  /** Workspace owner / admin: creates templates, sees every request. */
  admin: boolean;
  /** Manages at least one template (sees "All requests"). */
  manages: boolean;
}

/** Number of calendar days in a date range (both ends included). */
export function rangeDays(v: unknown): number | null {
  const r = v as { start?: string; end?: string } | null;
  if (!r?.start || !r.end) return null;
  return Math.round((Date.parse(r.end + 'T00:00:00Z') - Date.parse(r.start + 'T00:00:00Z')) / 86400_000) + 1;
}

/** Does a step's condition hold for these answers? (No condition = always.) */
export function approvalConditionHolds(c: ApprovalCondition | null, fields: ApprovalField[], values: Record<string, unknown>): boolean {
  if (!c) return true;
  const f = fields.find((x) => x.id === c.fieldId);
  if (!f) return true;
  const raw = values[c.fieldId];
  const actual: unknown = f.type === 'daterange' ? rangeDays(raw) : raw;
  if (actual === null || actual === undefined || actual === '') return false;
  if (c.op === 'in') {
    const set = Array.isArray(c.value) ? c.value.map(String) : [String(c.value)];
    return Array.isArray(actual) ? actual.some((a) => set.includes(String(a))) : set.includes(String(actual));
  }
  if (c.op === 'eq' || c.op === 'neq') {
    const eq = Array.isArray(actual) ? actual.map(String).includes(String(c.value)) : String(actual) === String(c.value);
    return c.op === 'eq' ? eq : !eq;
  }
  const a = typeof actual === 'number' ? actual : Number(actual);
  const b = Number(c.value);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return c.op === 'gt' ? a > b : c.op === 'gte' ? a >= b : c.op === 'lt' ? a < b : a <= b;
}

const shortDate = (d: string) => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(d + 'T00:00:00Z'));

/** An answer as text (lists, summaries, notifications). People are looked up in `people`. */
export function approvalValueText(f: ApprovalField, v: unknown, people?: Map<string, Pick<UserSummary, 'name'>>): string {
  if (v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length)) return '—';
  switch (f.type) {
    case 'money':
      return new Intl.NumberFormat('en-US', { style: 'currency', currency: f.currency || 'JPY' }).format(Number(v));
    case 'number':
      return new Intl.NumberFormat('en-US').format(Number(v)) + (f.unit ? ' ' + f.unit : '');
    case 'date':
      return shortDate(String(v));
    case 'daterange': {
      const r = v as { start: string; end: string };
      const n = rangeDays(r) ?? 0;
      return shortDate(r.start) + ' – ' + shortDate(r.end) + ' (' + n + (n === 1 ? ' day)' : ' days)');
    }
    case 'multiselect':
      return (v as string[]).join(', ');
    case 'person':
      return people?.get(String(v))?.name ?? 'Someone';
    case 'files': {
      const n = (v as string[]).length;
      return n + (n === 1 ? ' file' : ' files');
    }
    default:
      return String(v);
  }
}

export const approvalSerial = (n: number) => 'AP-' + String(n).padStart(5, '0');
