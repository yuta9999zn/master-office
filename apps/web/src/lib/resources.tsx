import type { Resource, ResourceType } from '@workos/shared';
import {
  BookOpen,
  Database,
  File,
  FileText,
  Folder,
  FolderInput,
  Image,
  type LucideIcon,
  ClipboardList,
  Play,
  Table2,
  Video,
  FileType2,
  Workflow,
  NotebookPen,
} from 'lucide-react';

export interface TypeMeta {
  label: string;
  icon: LucideIcon;
  /** Solid colour used for the small square file icon, like the reference file tables. */
  color: string;
  tint: string;
}

export const TYPE_META: Record<ResourceType, TypeMeta> = {
  folder: { label: 'Folder', icon: Folder, color: '#f5b83d', tint: '#fff6e0' },
  document: { label: 'Document', icon: FileText, color: '#2563eb', tint: '#e8f0fe' },
  spreadsheet: { label: 'Spreadsheet', icon: Table2, color: '#10b981', tint: '#e3f8ef' },
  presentation: { label: 'Presentation', icon: Play, color: '#f97316', tint: '#fff0e5' },
  pdf: { label: 'PDF', icon: FileType2, color: '#ef4444', tint: '#fdeaea' },
  image: { label: 'Image', icon: Image, color: '#0ea5e9', tint: '#e2f4fd' },
  video: { label: 'Video', icon: Video, color: '#8b5cf6', tint: '#f0eafe' },
  file: { label: 'File', icon: File, color: '#64748b', tint: '#eef1f5' },
  base: { label: 'Base', icon: Database, color: '#7c3aed', tint: '#f0eafe' },
  wiki: { label: 'Wiki page', icon: BookOpen, color: '#0d9488', tint: '#e0f5f3' },
  form: { label: 'Form', icon: ClipboardList, color: '#4f46e5', tint: '#eceafe' },
  shortcut: { label: 'Shortcut', icon: FolderInput, color: '#64748b', tint: '#eef1f5' },
  note: { label: 'Note', icon: NotebookPen, color: '#4f46e5', tint: '#eceafe' },
};

export function typeMeta(r: Pick<Resource, 'type' | 'mimeType' | 'metadata'>): TypeMeta {
  if (r.metadata?.app === 'flow') return { label: 'Flow', icon: Workflow, color: '#6366f1', tint: '#eceafe' };
  return TYPE_META[r.type];
}

/** Label used in the "Type" column: extension-aware for uploaded files. */
export function typeLabel(r: Pick<Resource, 'type' | 'name' | 'mimeType' | 'metadata'>): string {
  const ext = r.name.includes('.') ? r.name.split('.').pop()!.toUpperCase() : '';
  if (r.type === 'folder') return 'Folder';
  if (r.metadata?.app === 'flow') return 'Flow';
  if (r.mimeType && ext && ext.length <= 4) return ext;
  if (r.type === 'note') return 'Note';
  return { document: 'DOCX', spreadsheet: 'XLSX', presentation: 'PPTX' }[r.type as string] ?? TYPE_META[r.type].label;
}

/**
 * "Open with the right editor" — a resource_id always resolves to one route.
 * Chat, Search and Home all go through this (docs/ARCHITECTURE.md §3.1, §10).
 */
export function hrefFor(r: Pick<Resource, 'id' | 'type' | 'metadata'>): string {
  if (r.metadata?.app === 'flow') return `/flow`;
  switch (r.type) {
    case 'folder':
      return `/drive/folder/${r.id}`;
    case 'document':
      return `/docs/${r.id}`;
    case 'spreadsheet':
      return `/sheets/${r.id}`;
    case 'presentation':
      return `/slides/${r.id}`;
    case 'wiki':
      return `/wiki/${r.id}`;
    case 'note':
      return `/notes/${r.id}`;
    case 'form':
      return `/forms/${r.id}`;
    case 'base':
      return `/base/${r.id}`;
    default:
      return `/preview/${r.id}`;
  }
}

export const TYPE_TABS: { id: string; label: string; types?: ResourceType[] }[] = [
  { id: 'all', label: 'All' },
  { id: 'documents', label: 'Documents', types: ['document'] },
  { id: 'spreadsheets', label: 'Spreadsheets', types: ['spreadsheet'] },
  { id: 'presentations', label: 'Presentations', types: ['presentation'] },
  { id: 'images', label: 'Images', types: ['image'] },
  { id: 'pdfs', label: 'PDFs', types: ['pdf'] },
  { id: 'videos', label: 'Videos', types: ['video'] },
  { id: 'folders', label: 'Folders', types: ['folder'] },
  { id: 'knowledge', label: 'Wiki, Notes & Base', types: ['wiki', 'note', 'base', 'form'] },
];

export const ROLE_LABEL: Record<string, string> = {
  owner: 'Owner',
  admin: 'Full access',
  editor: 'Can edit',
  commenter: 'Can comment',
  viewer: 'Can view',
};
