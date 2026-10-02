import type { ResourceType } from '@workos/shared';
import {
  ClipboardList,
  Box,
  CalendarDays,
  ChartColumn,
  Cloud,
  Contact,
  Database,
  Ellipsis,
  FileText,
  House,
  LayoutGrid,
  type LucideIcon,
  Mail,
  MessageCircle,
  Play,
  Settings,
  Sparkles,
  SquareCheckBig,
  Stamp,
  Table2,
  Video,
  Workflow,
  BookOpen,
  NotebookPen,
  Network,
} from 'lucide-react';

/**
 * App Registry (docs/ARCHITECTURE.md §3.1). One entry per app in the left sidebar.
 * `from`/`to` are the gradient stops of the app icon from the brand sheet's "App icon set".
 */
export interface AppDef {
  id: string;
  label: string;
  tagline: string;
  href: string;
  icon: LucideIcon;
  from: string;
  to: string;
  /** Resource types this app opens — used by openResource(). */
  opens?: ResourceType[];
  /** Roadmap phase in which the app becomes functional (docs/ARCHITECTURE.md §16). */
  phase: number;
  primary?: boolean;
}

export const APPS: AppDef[] = [
  { id: 'home', label: 'Home', tagline: 'Your day at a glance', href: '/home', icon: House, from: '#3b82f6', to: '#2563eb', phase: 1, primary: true },
  { id: 'chat', label: 'Chat', tagline: 'Connect with your team', href: '/chat', icon: MessageCircle, from: '#60a5fa', to: '#2563eb', phase: 5, primary: true },
  { id: 'mail', label: 'Mail', tagline: 'Focus on what matters', href: '/mail', icon: Mail, from: '#38bdf8', to: '#2563eb', phase: 7, primary: true },
  { id: 'calendar', label: 'Calendar', tagline: 'Plan your time', href: '/calendar', icon: CalendarDays, from: '#fb7185', to: '#e11d48', phase: 7, primary: true },
  { id: 'docs', label: 'Docs', tagline: 'Create together', href: '/docs', icon: FileText, from: '#60a5fa', to: '#2563eb', opens: ['document'], phase: 2, primary: true },
  { id: 'sheets', label: 'Sheets', tagline: 'Work with data', href: '/sheets', icon: Table2, from: '#34d399', to: '#059669', opens: ['spreadsheet'], phase: 3, primary: true },
  { id: 'slides', label: 'Slides', tagline: 'Turn ideas into stories', href: '/slides', icon: Play, from: '#fb923c', to: '#ea580c', opens: ['presentation'], phase: 4, primary: true },
  { id: 'forms', label: 'Forms', tagline: 'Surveys, quizzes & sign-ups', href: '/forms', icon: ClipboardList, from: '#818cf8', to: '#4f46e5', opens: ['form'], phase: 8, primary: true },
  { id: 'drive', label: 'Drive', tagline: 'Store and share files', href: '/drive', icon: Cloud, from: '#38bdf8', to: '#0284c7', opens: ['folder', 'pdf', 'image', 'video', 'file'], phase: 1, primary: true },
  { id: 'spaces', label: 'Spaces', tagline: 'Team workspaces', href: '/spaces', icon: Box, from: '#a78bfa', to: '#7c3aed', phase: 1, primary: true },
  { id: 'base', label: 'Base', tagline: 'Manage your data', href: '/base', icon: Database, from: '#a78bfa', to: '#6d28d9', opens: ['base'], phase: 7, primary: true },
  { id: 'meetings', label: 'Meetings', tagline: 'Video meetings', href: '/meetings', icon: Video, from: '#60a5fa', to: '#1d4ed8', phase: 7, primary: true },
  { id: 'tasks', label: 'Tasks', tagline: 'Track and get things done', href: '/tasks', icon: SquareCheckBig, from: '#818cf8', to: '#4f46e5', phase: 7, primary: true },
  { id: 'flow', label: 'Flow', tagline: 'Design workflows & diagrams', href: '/flow', icon: Workflow, from: '#818cf8', to: '#7c3aed', phase: 7, primary: true },
  { id: 'notes', label: 'Notes', tagline: 'Capture ideas & meeting notes', href: '/notes', icon: NotebookPen, from: '#818cf8', to: '#4f46e5', opens: ['note'], phase: 2, primary: true },
  { id: 'mindmap', label: 'Mind Map', tagline: 'Turn notes into mind maps', href: '/notes?view=mindmaps', icon: Network, from: '#a78bfa', to: '#7c3aed', phase: 2, primary: true },
  { id: 'wiki', label: 'Wiki', tagline: 'Build knowledge', href: '/wiki', icon: BookOpen, from: '#2dd4bf', to: '#0d9488', opens: ['wiki'], phase: 2, primary: true },
  { id: 'approvals', label: 'Approvals', tagline: 'Streamline requests', href: '/approvals', icon: Stamp, from: '#fb923c', to: '#ea580c', phase: 7, primary: true },
  { id: 'contacts', label: 'Contacts', tagline: 'People & departments', href: '/contacts', icon: Contact, from: '#2dd4bf', to: '#0f766e', phase: 5, primary: true },
  { id: 'analytics', label: 'Analytics', tagline: 'Insights & performance', href: '/analytics', icon: ChartColumn, from: '#fbbf24', to: '#f59e0b', phase: 7 },
  { id: 'ai', label: 'AI', tagline: 'Your assistant for everything', href: '/ai', icon: Sparkles, from: '#818cf8', to: '#6366f1', phase: 6 },
  { id: 'admin', label: 'Admin', tagline: 'Manage workspace', href: '/admin', icon: Settings, from: '#94a3b8', to: '#475569', phase: 7, primary: true },
];

export const MORE_APP: AppDef = { id: 'more', label: 'More', tagline: 'All apps', href: '/apps', icon: Ellipsis, from: '#f8fafc', to: '#e2e8f0', phase: 1 };
export const ALL_APPS_ICON = LayoutGrid;

export const appById = (id: string) => APPS.find((a) => a.id === id);
