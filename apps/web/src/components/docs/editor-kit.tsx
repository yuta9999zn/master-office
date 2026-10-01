'use client';

import { Extension, type Editor, type Range } from '@tiptap/core';
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from '@tiptap/react';
import Suggestion from '@tiptap/suggestion';
import { docExtensions, ResourceLink, StatusPill, STATUS_COLORS, TaskItemWithMeta } from '@workos/doc-model';
import type { ResourceType, SearchHit, UserSummary } from '@workos/shared';
import {
  BookOpen,
  CalendarDays,
  CheckSquare,
  CircleDot,
  Code2,
  FileText,
  Heading1,
  Heading2,
  Heading3,
  ImagePlus,
  Info,
  Link2,
  List,
  ListOrdered,
  ListTree,
  Minus,
  Paperclip,
  Quote,
  Scissors,
  Table,
  Type,
  UserRound,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { DropdownMenu as DM, Popover } from 'radix-ui';
import { api } from '@/lib/api';
import { useResource, useUsers } from '@/lib/queries';
import { hrefFor } from '@/lib/resources';
import { Avatar, cn, FileIcon } from '../ui/primitives';
import { ResourceEmbedWithView } from './EmbedView';
import { PageBreakWithView, TableOfContentsWithView } from './NodeViews';
import { popupRender, type PopupItem } from './suggest-popup';

// ── Task items with assignee + due date chips ────────────────────────────────

function dueState(due: string, checked: boolean) {
  if (checked) return 'done';
  const days = (new Date(due + 'T23:59:59').getTime() - Date.now()) / 86_400_000;
  return days < 0 ? 'overdue' : days <= 3 ? 'soon' : 'later';
}

function TaskItemView({ node, updateAttributes, editor }: ReactNodeViewProps) {
  const { data: users } = useUsers();
  const editable = editor.isEditable;
  const assignee = users?.find((u) => u.id === node.attrs.assignee);
  const due = node.attrs.due as string | null;
  const checked = !!node.attrs.checked;
  const ds = due ? dueState(due, checked) : null;
  return (
    <NodeViewWrapper as="li" data-checked={checked} data-type="taskItem" className="group/task">
      <label contentEditable={false}>
        <input type="checkbox" checked={checked} disabled={!editable} onChange={(e) => updateAttributes({ checked: e.target.checked })} aria-label="Done" />
      </label>
      <NodeViewContent as="div" />
      <span contentEditable={false} className="mo-task-meta flex shrink-0 items-center gap-1.5 pt-[3px]">
        <DM.Root>
          <DM.Trigger asChild disabled={!editable}>
            {assignee ? (
              <button className="flex items-center gap-1 rounded-full bg-brand-50 py-0.5 pl-0.5 pr-2 text-[12px] font-medium text-brand-700" data-testid="task-assignee">
                <Avatar user={assignee} size={18} />@{assignee.name.split(' ')[0]}
              </button>
            ) : (
              <button className={cn('flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[12px] text-subtle hover:bg-hover', !editable ? 'hidden' : 'opacity-0 group-hover/task:opacity-100')} aria-label="Assign">
                <UserRound size={13} /> Assign
              </button>
            )}
          </DM.Trigger>
          <DM.Portal>
            <DM.Content align="end" className="pop z-50 max-h-72 w-56 overflow-y-auto animate-pop" onCloseAutoFocus={(e) => e.preventDefault()}>
              {users?.map((u: UserSummary) => (
                <DM.Item key={u.id} className="menu-item" onSelect={() => updateAttributes({ assignee: u.id })}>
                  <Avatar user={u} size={20} /> {u.name}
                </DM.Item>
              ))}
              {assignee && (
                <DM.Item className="menu-item text-muted" onSelect={() => updateAttributes({ assignee: null })}>
                  <X size={14} /> Unassign
                </DM.Item>
              )}
            </DM.Content>
          </DM.Portal>
        </DM.Root>
        <Popover.Root>
          <Popover.Trigger asChild disabled={!editable}>
            {due ? (
              <button
                data-testid="task-due"
                className={cn(
                  'flex items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-medium',
                  ds === 'overdue' && 'bg-red-50 text-red-600',
                  ds === 'soon' && 'bg-amber-50 text-amber-700',
                  (ds === 'later' || ds === 'done') && 'bg-hover text-muted',
                )}
              >
                <CalendarDays size={12} /> {new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(due + 'T12:00:00'))}
              </button>
            ) : (
              <button className={cn('flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[12px] text-subtle hover:bg-hover', !editable ? 'hidden' : 'opacity-0 group-hover/task:opacity-100')} aria-label="Set due date">
                <CalendarDays size={13} /> Date
              </button>
            )}
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content align="end" sideOffset={4} className="pop z-50 p-2 animate-pop" onCloseAutoFocus={(e) => e.preventDefault()}>
              <input type="date" aria-label="Due date" defaultValue={due ?? ''} onChange={(e) => updateAttributes({ due: e.target.value || null })} className="input h-8" />
              {due && (
                <button onClick={() => updateAttributes({ due: null })} className="mt-1.5 w-full rounded-md py-1 text-[12px] text-muted hover:bg-hover">
                  Remove date
                </button>
              )}
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      </span>
    </NodeViewWrapper>
  );
}

export const TaskItemWithView = TaskItemWithMeta.extend({
  addNodeView() {
    return ReactNodeViewRenderer(TaskItemView);
  },
});

// ── Status pills ─────────────────────────────────────────────────────────────

const STATUS_PRESETS: { label: string; color: keyof typeof STATUS_COLORS }[] = [
  { label: 'On track', color: 'green' },
  { label: 'At risk', color: 'amber' },
  { label: 'Off track', color: 'red' },
  { label: 'Done', color: 'blue' },
  { label: 'Not started', color: 'gray' },
];

function StatusView({ node, updateAttributes, editor }: ReactNodeViewProps) {
  const color = STATUS_COLORS[node.attrs.color as string] ?? STATUS_COLORS.green;
  const pill = (
    <span className="inline-flex items-center gap-1 rounded-full px-2 py-px text-[0.85em] font-medium" style={{ color, background: `${color}14` }}>
      <span className="size-1.5 rounded-full" style={{ background: color }} />
      {node.attrs.label}
    </span>
  );
  return (
    <NodeViewWrapper as="span" className="mo-status-wrap" data-status-label={node.attrs.label}>
      {editor.isEditable ? (
        <DM.Root>
          <DM.Trigger asChild>
            <button contentEditable={false}>{pill}</button>
          </DM.Trigger>
          <DM.Portal>
            <DM.Content className="pop z-50 animate-pop" onCloseAutoFocus={(e) => e.preventDefault()}>
              {STATUS_PRESETS.map((s) => (
                <DM.Item key={s.label} className="menu-item" onSelect={() => updateAttributes({ label: s.label, color: s.color })}>
                  <span className="size-2 rounded-full" style={{ background: STATUS_COLORS[s.color] }} /> {s.label}
                </DM.Item>
              ))}
            </DM.Content>
          </DM.Portal>
        </DM.Root>
      ) : (
        pill
      )}
    </NodeViewWrapper>
  );
}

export const StatusWithView = StatusPill.extend({
  addNodeView() {
    return ReactNodeViewRenderer(StatusView);
  },
});

// ── [[Page links]] ───────────────────────────────────────────────────────────

function PageLinkView({ node }: ReactNodeViewProps) {
  const { data: r } = useResource(node.attrs.id as string);
  const type = (r?.type ?? node.attrs.type) as ResourceType;
  return (
    <NodeViewWrapper as="span" className="mo-page-link-wrap">
      <Link
        href={r ? hrefFor(r) : '#'}
        contentEditable={false}
        className="inline-flex items-center gap-1 rounded-md bg-brand-50 px-1.5 py-px align-baseline text-[0.95em] font-medium text-brand-700 no-underline hover:bg-brand-100"
        data-testid="page-link"
      >
        <FileIcon r={{ type, mimeType: null, metadata: {} }} size={14} />
        {r?.name ?? node.attrs.name}
      </Link>
    </NodeViewWrapper>
  );
}

export const ResourceLinkWithView = ResourceLink.extend({
  addNodeView() {
    return ReactNodeViewRenderer(PageLinkView);
  },
});

const pageLinkKey = new PluginKey('mo-page-links');

/** Typing "[[" opens a search of pages/files; picking one inserts a live page link. */
export const PageLinks = Extension.create({
  name: 'pageLinks',
  addProseMirrorPlugins() {
    return [
      Suggestion<PopupItem>({
        editor: this.editor,
        pluginKey: pageLinkKey,
        char: '[[',
        allowSpaces: true,
        items: async ({ query }) => {
          const hits = query.trim() ? await api<SearchHit[]>(`/search?q=${encodeURIComponent(query.trim())}`).catch(() => []) : [];
          return hits
            .filter((h) => h.kind === 'resource' && h.type !== 'folder')
            .slice(0, 8)
            .map((h) => ({ id: h.id, title: h.title, subtitle: h.type, icon: <FileIcon r={{ type: h.type!, mimeType: null, metadata: {} }} size={16} /> }));
        },
        command: ({ editor, range, props }) => {
          editor
            .chain()
            .focus()
            .deleteRange(range)
            .insertContent([{ type: 'resourceLink', attrs: { id: props.id, name: props.title, type: props.subtitle } }, { type: 'text', text: ' ' }])
            .run();
        },
        render: popupRender('Type to search pages and files'),
      }),
    ];
  },
});

// ── Slash commands ───────────────────────────────────────────────────────────

export interface SlashHandlers {
  image: () => void;
  embed: () => void;
}

interface SlashItem extends PopupItem {
  run: (editor: Editor, range: Range) => void;
}

function slashItems(h: SlashHandlers): SlashItem[] {
  const c = (e: Editor, r: Range) => e.chain().focus().deleteRange(r);
  return [
    { id: 'text', group: 'Basic', title: 'Text', icon: <Type />, run: (e, r) => c(e, r).setParagraph().run() },
    { id: 'h1', group: 'Basic', title: 'Heading 1', icon: <Heading1 />, run: (e, r) => c(e, r).setHeading({ level: 1 }).run() },
    { id: 'h2', group: 'Basic', title: 'Heading 2', icon: <Heading2 />, run: (e, r) => c(e, r).setHeading({ level: 2 }).run() },
    { id: 'h3', group: 'Basic', title: 'Heading 3', icon: <Heading3 />, run: (e, r) => c(e, r).setHeading({ level: 3 }).run() },
    { id: 'bullet', group: 'Basic', title: 'Bulleted list', icon: <List />, run: (e, r) => c(e, r).toggleBulletList().run() },
    { id: 'numbered', group: 'Basic', title: 'Numbered list', icon: <ListOrdered />, run: (e, r) => c(e, r).toggleOrderedList().run() },
    { id: 'todo', group: 'Basic', title: 'To-do list', subtitle: 'Tasks with assignee and due date', icon: <CheckSquare />, run: (e, r) => c(e, r).toggleTaskList().run() },
    { id: 'quote', group: 'Basic', title: 'Quote', icon: <Quote />, run: (e, r) => c(e, r).toggleBlockquote().run() },
    { id: 'callout', group: 'Basic', title: 'Callout', icon: <Info />, run: (e, r) => c(e, r).wrapIn('callout').run() },
    { id: 'code', group: 'Basic', title: 'Code block', icon: <Code2 />, run: (e, r) => c(e, r).toggleCodeBlock().run() },
    { id: 'divider', group: 'Basic', title: 'Divider', icon: <Minus />, run: (e, r) => c(e, r).setHorizontalRule().run() },
    { id: 'table', group: 'Insert', title: 'Table', icon: <Table />, run: (e, r) => c(e, r).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
    { id: 'image', group: 'Insert', title: 'Image', icon: <ImagePlus />, run: (e, r) => (c(e, r).run(), h.image()) },
    { id: 'file', group: 'Insert', title: 'File from Drive', subtitle: 'Linked card, no copy', icon: <Paperclip />, run: (e, r) => (c(e, r).run(), h.embed()) },
    { id: 'page', group: 'Insert', title: 'Link to page', subtitle: 'Or type [[', icon: <Link2 />, run: (e, r) => c(e, r).insertContent('[[').run() },
    { id: 'status', group: 'Insert', title: 'Status', subtitle: 'On track / At risk…', icon: <CircleDot />, run: (e, r) => c(e, r).insertContent({ type: 'status', attrs: { label: 'On track', color: 'green' } }).run() },
    { id: 'mention', group: 'Insert', title: 'Mention a person', icon: <UserRound />, run: (e, r) => c(e, r).insertContent('@').run() },
    { id: 'toc', group: 'Insert', title: 'Table of contents', icon: <ListTree />, run: (e, r) => c(e, r).insertContent({ type: 'tableOfContents' }).run() },
    { id: 'pagebreak', group: 'Insert', title: 'Page break', icon: <Scissors />, run: (e, r) => c(e, r).insertContent({ type: 'pageBreak' }).run() },
    { id: 'wiki', group: 'Insert', title: 'Knowledge callout', icon: <BookOpen />, run: (e, r) => c(e, r).wrapIn('callout').insertContent('Knowledge: ').run() },
    { id: 'doc', group: 'Insert', title: 'Embed a document', icon: <FileText />, run: (e, r) => (c(e, r).run(), h.embed()) },
  ];
}

const slashKey = new PluginKey('mo-slash');

export const SlashCommands = Extension.create<{ handlers: SlashHandlers }>({
  name: 'slashCommands',
  addOptions() {
    return { handlers: { image: () => undefined, embed: () => undefined } };
  },
  addProseMirrorPlugins() {
    const all = slashItems(this.options.handlers);
    return [
      Suggestion<PopupItem>({
        editor: this.editor,
        pluginKey: slashKey,
        char: '/',
        startOfLine: false,
        allow: ({ state, range }) => {
          const $from = state.doc.resolve(range.from);
          return $from.parent.type.name === 'paragraph' && !$from.parent.textContent.startsWith('http');
        },
        items: ({ query }) => all.filter((i) => i.title.toLowerCase().includes(query.toLowerCase()) || i.id.includes(query.toLowerCase())).slice(0, 20),
        command: ({ editor, range, props }) => all.find((i) => i.id === props.id)?.run(editor, range),
        render: popupRender('No matching blocks'),
      }),
    ];
  },
});

// ── Collapsible headings ─────────────────────────────────────────────────────

const foldKey = new PluginKey<number[]>('mo-fold');

function foldDecorations(state: EditorState, folded: number[]) {
  const decos: Decoration[] = [];
  const set = new Set(folded);
  let hideUntilLevel: number | null = null;
  state.doc.forEach((node, pos) => {
    if (node.type.name === 'heading') {
      const level = node.attrs.level as number;
      if (hideUntilLevel !== null && level <= hideUntilLevel) hideUntilLevel = null;
      if (hideUntilLevel !== null) {
        decos.push(Decoration.node(pos, pos + node.nodeSize, { class: 'mo-folded' }));
        return;
      }
      const isFolded = set.has(pos);
      decos.push(
        Decoration.widget(
          pos + 1,
          (view) => {
            const b = document.createElement('button');
            b.className = `mo-fold-toggle${isFolded ? ' folded' : ''}`;
            b.contentEditable = 'false';
            b.setAttribute('aria-label', isFolded ? 'Expand section' : 'Collapse section');
            b.textContent = '▾';
            b.addEventListener('mousedown', (e) => {
              e.preventDefault();
              view.dispatch(view.state.tr.setMeta(foldKey, pos));
            });
            return b;
          },
          { side: -1, key: `fold-${pos}-${isFolded}`, ignoreSelection: true },
        ),
      );
      if (isFolded) hideUntilLevel = level;
    } else if (hideUntilLevel !== null) {
      decos.push(Decoration.node(pos, pos + node.nodeSize, { class: 'mo-folded' }));
    }
  });
  return DecorationSet.create(state.doc, decos);
}

/** Headings get a ▾ toggle that folds the section below (per viewer, not shared). */
export const CollapsibleHeadings = Extension.create({
  name: 'collapsibleHeadings',
  addProseMirrorPlugins() {
    return [
      new Plugin<number[]>({
        key: foldKey,
        state: {
          init: () => [],
          apply(tr, folded, _old, next) {
            let out = folded;
            if (tr.docChanged) out = out.map((p) => tr.mapping.map(p)).filter((p) => next.doc.nodeAt(p)?.type.name === 'heading');
            const toggle = tr.getMeta(foldKey) as number | undefined;
            if (toggle !== undefined) out = out.includes(toggle) ? out.filter((p) => p !== toggle) : [...out, toggle];
            return out;
          },
        },
        props: { decorations: (state) => foldDecorations(state, foldKey.getState(state) ?? []) },
      }),
    ];
  },
});

// ── Schema for the browser ───────────────────────────────────────────────────

const VIEW_NODES = ['resourceEmbed', 'pageBreak', 'tableOfContents', 'taskItem', 'status', 'resourceLink'];

/** Schema extensions with React node views swapped in for the interactive nodes. */
export function browserSchema(opts: Parameters<typeof docExtensions>[0]) {
  return [
    ...docExtensions(opts).filter((e) => !VIEW_NODES.includes(e.name)),
    ResourceEmbedWithView,
    PageBreakWithView,
    TableOfContentsWithView,
    TaskItemWithView.configure({ nested: true }),
    StatusWithView,
    ResourceLinkWithView,
  ];
}
