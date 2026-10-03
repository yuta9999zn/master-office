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
  /** Presentations: template id. */
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
