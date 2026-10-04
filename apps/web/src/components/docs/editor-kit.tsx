'use client';

import { Extension, type Editor, type Range } from '@tiptap/core';
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from '@tiptap/react';
import Suggestion from '@tiptap/suggestion';
import { docExtensions, DROPDOWN_PRESETS, isoDay, ResourceLink, StatusPill, STATUS_COLORS, TaskItemWithMeta, type JSONContent } from '@workos/doc-model';
import type { ResourceType, SearchHit, UserSummary } from '@workos/shared';
import {
  BookOpen,
  Bookmark,
  ChartColumnBig,
  Columns2,
  Columns3,
  Footprints,
  Sigma,
  CalendarDays,
  ChevronDownCircle,
  Link as LinkIcon,
  Mail,
  MapPin,
  Milestone,
  NotebookPen,
  Scale,
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
  TextCursorInput,
  CalendarClock,
} from 'lucide-react';
import Link from 'next/link';
import { DropdownMenu as DM, Popover } from 'radix-ui';
import type { ReactNode } from 'react';
import { api } from '@/lib/api';
import { useResource, useUsers } from '@/lib/queries';
import { hrefFor } from '@/lib/resources';
import { Avatar, cn, FileIcon } from '../ui/primitives';
import { BookmarkWithView, DateChipWithView, DropdownChipWithView, EventChipWithView, PlaceChipWithView, PlaceholderChipWithView } from './chips';
import { BibliographyWithView, CitationWithView } from './citations';
import { SectionBreakWithView } from './section-break';
import { DrawingWithView } from './drawing';
import { EquationWithView, FootnoteShortcut, FootnoteWithView, insertFootnote } from './notes-math';
import { setColumns } from './columns';
import { DocChartWithView } from './doc-chart';
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
  /** Opens the "link to a heading or bookmark" picker. */
  linkTo: () => void;
  /** Opens Insert → Chart. */
  chart: () => void;
}

// ── Building blocks (Google Docs: Insert → Building blocks) ──────────────────

const t = (text: string, marks?: JSONContent['marks']): JSONContent => ({ type: 'text', text, ...(marks ? { marks } : {}) });
const p = (...content: JSONContent[]): JSONContent => ({ type: 'paragraph', ...(content.length ? { content } : {}) });
const h = (level: number, text: string): JSONContent => ({ type: 'heading', attrs: { level }, content: [t(text)] });
const date = (offset = 0): JSONContent => ({ type: 'dateChip', attrs: { date: isoDay(offset), format: 'short' } });
const drop = (preset: number, value: string | null = null): JSONContent => ({ type: 'dropdownChip', attrs: { options: DROPDOWN_PRESETS[preset].options, value } });
const bold = [{ type: 'bold' }];
const cell = (content: JSONContent[], header = false): JSONContent => ({ type: header ? 'tableHeader' : 'tableCell', content: [p(...content)] });
const table = (head: string[], rows: JSONContent[][][]): JSONContent => ({
  type: 'table',
  content: [{ type: 'tableRow', content: head.map((x) => cell([t(x)], true)) }, ...rows.map((r) => ({ type: 'tableRow', content: r.map((c) => cell(c)) }))],
});

export const BUILDING_BLOCKS: { id: string; title: string; icon: ReactNode; content: () => JSONContent[] }[] = [
  {
    id: 'meeting',
    title: 'Meeting notes',
    icon: <NotebookPen />,
    content: () => [
      p(date(), t(' | '), t('Meeting title', bold)),
      p(t('Attendees: ', bold), t('@ to mention people')),
      h(3, 'Notes'),
      { type: 'bulletList', content: [{ type: 'listItem', content: [p()] }] },
      h(3, 'Action items'),
      { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: false }, content: [p()] }] },
    ],
  },
  {
    id: 'email',
    title: 'Email draft',
    icon: <Mail />,
    content: () => [table(['To', 'Cc', 'Subject'], [[[], [], []]]), p(t('Hi,')), p(), p(t('Thanks,'))],
  },
  {
    id: 'roadmap',
    title: 'Project roadmap',
    icon: <Milestone />,
    content: () => [
      table(
        ['Milestone', 'Owner', 'Due', 'Status'],
        [
          [[t('Kick-off')], [], [date(7)], [drop(0, 'Not started')]],
          [[t('First release')], [], [date(30)], [drop(0, 'Not started')]],
          [[t('Launch')], [], [date(60)], [drop(0, 'Not started')]],
        ],
      ),
    ],
  },
  {
    id: 'decisions',
    title: 'Decision log',
    icon: <Scale />,
    content: () => [
      table(
        ['Decision', 'Date', 'Owner', 'Status'],
        [
          [[t('What was decided')], [date()], [], [drop(1, 'Draft')]],
          [[], [], [], [drop(1)]],
        ],
      ),
    ],
  },
];

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
    { id: 'sectionbreak', group: 'Insert', title: 'Section break (landscape)', subtitle: 'Next pages in landscape', icon: <Scissors />, run: (e, r) => c(e, r).insertContent({ type: 'sectionBreak', attrs: { orientation: 'landscape' } }).run() },
    { id: 'wiki', group: 'Insert', title: 'Knowledge callout', icon: <BookOpen />, run: (e, r) => c(e, r).wrapIn('callout').insertContent('Knowledge: ').run() },
    { id: 'doc', group: 'Insert', title: 'Embed a document', icon: <FileText />, run: (e, r) => (c(e, r).run(), h.embed()) },
    { id: 'date', group: 'Smart chips', title: 'Date', subtitle: 'Or type @date', icon: <CalendarDays />, run: (e, r) => c(e, r).insertContent([{ type: 'dateChip', attrs: { date: isoDay(), format: 'short' } }, { type: 'text', text: ' ' }]).run() },
    { id: 'dropdown', group: 'Smart chips', title: 'Dropdown', subtitle: 'Status, priority…', icon: <ChevronDownCircle />, run: (e, r) => c(e, r).insertContent([{ type: 'dropdownChip', attrs: { options: DROPDOWN_PRESETS[0].options, value: null } }, { type: 'text', text: ' ' }]).run() },
    { id: 'place', group: 'Smart chips', title: 'Place', subtitle: 'Opens in Maps', icon: <MapPin />, run: (e, r) => c(e, r).insertContent([{ type: 'placeChip', attrs: { name: 'Place' } }, { type: 'text', text: ' ' }]).run() },
    { id: 'placeholder', group: 'Smart chips', title: 'Placeholder', subtitle: 'Fill in later, e.g. [Client name]', icon: <TextCursorInput />, run: (e, r) => c(e, r).insertContent([{ type: 'placeholderChip', attrs: { label: 'Placeholder' } }, { type: 'text', text: ' ' }]).run() },
    { id: 'event', group: 'Smart chips', title: 'Calendar event', subtitle: 'Meeting with date, time and place', icon: <CalendarClock />, run: (e, r) => c(e, r).insertContent([{ type: 'eventChip', attrs: { title: 'Meeting', date: isoDay(1), start: '10:00', end: '10:30', location: '' } }, { type: 'text', text: ' ' }]).run() },
    { id: 'columns2', group: 'Basic', title: '2 columns', icon: <Columns2 />, run: (e, r) => (c(e, r).run(), setColumns(e, 2)) },
    { id: 'columns3', group: 'Basic', title: '3 columns', icon: <Columns3 />, run: (e, r) => (c(e, r).run(), setColumns(e, 3)) },
    { id: 'chart', group: 'Insert', title: 'Chart', subtitle: 'From Sheets or sample data', icon: <ChartColumnBig />, run: (e, r) => (c(e, r).run(), h.chart()) },
    { id: 'footnote', group: 'Insert', title: 'Footnote', subtitle: 'Ctrl+Alt+F', icon: <Footprints />, run: (e, r) => (c(e, r).run(), insertFootnote(e)) },
    { id: 'equation', group: 'Insert', title: 'Equation', subtitle: 'LaTeX', icon: <Sigma />, run: (e, r) => c(e, r).insertContent({ type: 'equation', attrs: { latex: '' } }).run() },
    { id: 'bookmark', group: 'Insert', title: 'Bookmark', subtitle: 'A place links can jump to', icon: <Bookmark />, run: (e, r) => c(e, r).insertContent({ type: 'bookmark', attrs: { id: Math.random().toString(36).slice(2, 10) } }).run() },
    { id: 'linkto', group: 'Insert', title: 'Link to heading or bookmark', icon: <LinkIcon />, run: (e, r) => (c(e, r).run(), h.linkTo()) },
    ...BUILDING_BLOCKS.map((b) => ({ id: `bb-${b.id}`, group: 'Building blocks', title: b.title, icon: b.icon, run: (e: Editor, r: Range) => c(e, r).insertContent(b.content()).run() })),
  ];
}

const slashKey = new PluginKey('mo-slash');

export const SlashCommands = Extension.create<{ handlers: SlashHandlers }>({
  name: 'slashCommands',
  addOptions() {
    return { handlers: { image: () => undefined, embed: () => undefined, linkTo: () => undefined, chart: () => undefined } };
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

const VIEW_NODES = ['resourceEmbed', 'pageBreak', 'sectionBreak', 'drawing', 'tableOfContents', 'taskItem', 'status', 'resourceLink', 'dateChip', 'dropdownChip', 'placeChip', 'placeholderChip', 'eventChip', 'citation', 'bibliography', 'bookmark', 'footnote', 'equation', 'docChart'];

// ── Internal links ("#bm-<id>") ──────────────────────────────────────────────

/** Position of a bookmark in the document. */
export function bookmarkPos(state: EditorState, id: string): number | null {
  let found: number | null = null;
  state.doc.descendants((n, pos) => {
    if (found !== null) return false;
    if (n.type.name === 'bookmark' && n.attrs.id === id) found = pos;
    return true;
  });
  return found;
}

/** Following a link to a bookmark scrolls to it (Ctrl/⌘-click while editing, plain click when reading). */
export const InternalLinks = Extension.create({
  name: 'internalLinks',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          handleClick: (view, _pos, event) => {
            const a = (event.target as HTMLElement).closest('a');
            const href = a?.getAttribute('href') ?? '';
            if (!href.startsWith('#bm-') || (view.editable && !(event.ctrlKey || event.metaKey))) return false;
            const at = bookmarkPos(view.state, href.slice(4));
            if (at === null) return false;
            const dom = view.nodeDOM(at) as HTMLElement | null;
            dom?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            event.preventDefault();
            return true;
          },
        },
      }),
    ];
  },
});

/** Schema extensions with React node views swapped in for the interactive nodes. */
export function browserSchema(opts: Parameters<typeof docExtensions>[0]) {
  return [
    ...docExtensions(opts).filter((e) => !VIEW_NODES.includes(e.name)),
    ResourceEmbedWithView,
    PageBreakWithView,
    SectionBreakWithView,
    DrawingWithView,
    TableOfContentsWithView,
    TaskItemWithView.configure({ nested: true }),
    StatusWithView,
    ResourceLinkWithView,
    DateChipWithView,
    DropdownChipWithView,
    PlaceChipWithView,
    PlaceholderChipWithView,
    EventChipWithView,
    CitationWithView,
    BibliographyWithView,
    BookmarkWithView,
    FootnoteWithView,
    EquationWithView,
    DocChartWithView,
    FootnoteShortcut,
    InternalLinks,
  ];
}
