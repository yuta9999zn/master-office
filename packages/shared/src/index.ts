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
  | { type: 'notification.read'; ids: string[] | 'all' };

// ── Notifications (§66) ─────────────────────────────────────────────────────

export type NotificationKind = 'chat.mention' | 'chat.reply' | 'resource.shared' | 'comment.created' | 'comment.reply';

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
