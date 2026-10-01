'use client';

import { useEditorState, type Editor } from '@tiptap/react';
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  AtSign,
  Bold,
  ChevronDown,
  Code2,
  Eraser,
  Highlighter,
  ImagePlus,
  IndentDecrease,
  IndentIncrease,
  Italic,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  Minus,
  MessageSquarePlus,
  Paperclip,
  Quote,
  Redo2,
  Strikethrough,
  Table,
  Type,
  Underline,
  Undo2,
  Info,
  GitPullRequestArrow,
  PencilLine,
  Rows3,
  Subscript as SubscriptIcon,
  Superscript as SuperscriptIcon,
} from 'lucide-react';
import { LINE_HEIGHTS } from '@workos/doc-model';
import { DropdownMenu as DM } from 'radix-ui';
import type { ReactNode } from 'react';
import { cn, Tip } from '../ui/primitives';

export const FONTS = ['Inter', 'Arial', 'Georgia', 'Times New Roman', 'Courier New', 'Noto Serif'];
export const SIZES = ['12px', '14px', '15px', '16px', '18px', '20px', '24px', '28px', '32px', '40px'];
export const COLORS = ['#0f172a', '#475569', '#dc2626', '#ea580c', '#ca8a04', '#16a34a', '#0d9488', '#2563eb', '#7c3aed', '#db2777'];
export const HIGHLIGHTS = ['#fef08a', '#fed7aa', '#fecaca', '#bbf7d0', '#bae6fd', '#ddd6fe', '#fbcfe8', '#e2e8f0'];

export interface ToolbarActions {
  suggesting: boolean;
  setSuggesting: (on: boolean) => void;
  link: () => void;
  image: () => void;
  embed: () => void;
  comment: () => void;
  canComment: boolean;
}

function Btn({ label, icon, active, disabled, onClick, shortcut }: { label: string; icon: ReactNode; active?: boolean; disabled?: boolean; onClick: () => void; shortcut?: string }) {
  return (
    <Tip label={shortcut ? `${label} (${shortcut})` : label}>
      <button
        type="button"
        aria-label={label}
        aria-pressed={active}
        disabled={disabled}
        onMouseDown={(e) => e.preventDefault()}
        onClick={onClick}
        className={cn('flex size-8 shrink-0 items-center justify-center rounded-md text-ink-2 hover:bg-hover disabled:opacity-35 disabled:hover:bg-transparent', active && 'bg-selected text-brand-600 hover:bg-selected')}
      >
        {icon}
      </button>
    </Tip>
  );
}
const Sep = () => <span className="mx-1 h-5 w-px shrink-0 bg-line" />;

function Drop({ trigger, width, children, label }: { trigger: ReactNode; width?: number; children: ReactNode; label: string }) {
  return (
    <DM.Root>
      <Tip label={label}>
        <DM.Trigger asChild>
          <button type="button" aria-label={label} onMouseDown={(e) => e.preventDefault()} className="flex h-8 shrink-0 items-center gap-1 rounded-md px-2 text-[13px] text-ink-2 hover:bg-hover data-[state=open]:bg-hover" style={{ width }}>
            {trigger}
            <ChevronDown size={13} className="ml-auto text-subtle" />
          </button>
        </DM.Trigger>
      </Tip>
      <DM.Portal>
        <DM.Content sideOffset={4} align="start" className="pop z-50 animate-pop" onCloseAutoFocus={(e) => e.preventDefault()}>
          {children}
        </DM.Content>
      </DM.Portal>
    </DM.Root>
  );
}
const Item = ({ onSelect, children, active }: { onSelect: () => void; children: ReactNode; active?: boolean }) => (
  <DM.Item onSelect={onSelect} className={cn('menu-item', active && 'font-semibold text-brand-600')}>
    {children}
  </DM.Item>
);

function Swatches({ colors, onPick, onClear, clearLabel }: { colors: string[]; onPick: (c: string) => void; onClear: () => void; clearLabel: string }) {
  return (
    <div className="w-[196px] p-1.5">
      <div className="grid grid-cols-5 gap-1.5">
        {colors.map((c) => (
          <DM.Item key={c} onSelect={() => onPick(c)} className="size-8 cursor-pointer rounded-md border border-black/5 outline-none data-[highlighted]:ring-2 data-[highlighted]:ring-brand-600" style={{ background: c }} aria-label={c} />
        ))}
      </div>
      <DM.Item onSelect={onClear} className="menu-item mt-1.5">
        <Eraser size={14} /> {clearLabel}
      </DM.Item>
    </div>
  );
}

const BLOCKS = [
  { id: 'p', label: 'Normal text' },
  { id: 'title', label: 'Title' },
  { id: 'subtitle', label: 'Subtitle' },
  { id: 'h1', label: 'Heading 1' },
  { id: 'h2', label: 'Heading 2' },
  { id: 'h3', label: 'Heading 3' },
  { id: 'h4', label: 'Heading 4' },
];

export function DocToolbar({ editor, actions, readOnly }: { editor: Editor; actions: ToolbarActions; readOnly: boolean }) {
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      block: e.isActive('paragraph', { docStyle: 'title' }) ? 'title' : e.isActive('paragraph', { docStyle: 'subtitle' }) ? 'subtitle' : e.isActive('heading', { level: 1 }) ? 'h1' : e.isActive('heading', { level: 2 }) ? 'h2' : e.isActive('heading', { level: 3 }) ? 'h3' : e.isActive('heading', { level: 4 }) ? 'h4' : 'p',
      font: (e.getAttributes('textStyle').fontFamily as string | undefined)?.split(',')[0].replace(/['"]/g, '') ?? 'Inter',
      size: (e.getAttributes('textStyle').fontSize as string | undefined) ?? '15px',
      color: (e.getAttributes('textStyle').color as string | undefined) ?? '#0f172a',
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      underline: e.isActive('underline'),
      strike: e.isActive('strike'),
      sup: e.isActive('superscript'),
      sub: e.isActive('subscript'),
      lineHeight: (e.getAttributes('paragraph').lineHeight as string | undefined) ?? (e.getAttributes('heading').lineHeight as string | undefined) ?? '1.7',
      code: e.isActive('code'),
      highlight: e.isActive('highlight'),
      link: e.isActive('link'),
      align: (['center', 'right', 'justify'] as const).find((a) => e.isActive({ textAlign: a })) ?? 'left',
      bullet: e.isActive('bulletList'),
      ordered: e.isActive('orderedList'),
      task: e.isActive('taskList'),
      quote: e.isActive('blockquote'),
      codeBlock: e.isActive('codeBlock'),
      callout: e.isActive('callout'),
      table: e.isActive('table'),
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
      canSink: e.can().sinkListItem('listItem') || e.can().sinkListItem('taskItem'),
      canLift: e.can().liftListItem('listItem') || e.can().liftListItem('taskItem'),
      hasSelection: !e.state.selection.empty,
    }),
  });
  const c = () => editor.chain().focus();
  const ro = readOnly;

  return (
    <div className="flex h-11 items-center rounded-xl border border-line bg-surface px-2 shadow-[var(--shadow-card)]">
      <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
      <Btn label="Undo" shortcut="Ctrl+Z" icon={<Undo2 size={17} />} disabled={ro || !s.canUndo} onClick={() => c().undo().run()} />
      <Btn label="Redo" shortcut="Ctrl+Y" icon={<Redo2 size={17} />} disabled={ro || !s.canRedo} onClick={() => c().redo().run()} />
      <Sep />
      {!ro && (
        <>
          <Drop label="Text style" width={118} trigger={<span className="truncate">{BLOCKS.find((b) => b.id === s.block)!.label}</span>}>
            {BLOCKS.map((b) => (
              <Item
                key={b.id}
                active={s.block === b.id}
                onSelect={() =>
                  b.id === 'p'
                    ? c().setParagraph().updateAttributes('paragraph', { docStyle: null }).run()
                    : b.id === 'title' || b.id === 'subtitle'
                      ? c().setParagraph().updateAttributes('paragraph', { docStyle: b.id }).run()
                      : c().toggleHeading({ level: Number(b.id[1]) as 1 | 2 | 3 | 4 }).run()
                }
              >
                <span className={cn(b.id === 'title' && 'text-[22px] font-bold', b.id === 'subtitle' && 'text-[15px] text-muted', b.id === 'h1' && 'text-[20px] font-bold', b.id === 'h2' && 'text-[17px] font-bold', b.id === 'h3' && 'text-[15px] font-semibold', b.id === 'h4' && 'font-semibold')}>{b.label}</span>
              </Item>
            ))}
          </Drop>
          <Drop label="Font" width={116} trigger={<span className="truncate">{s.font}</span>}>
            {FONTS.map((f) => (
              <Item key={f} active={s.font === f} onSelect={() => (f === 'Inter' ? c().unsetFontFamily().run() : c().setFontFamily(f).run())}>
                <span style={{ fontFamily: f }}>{f}</span>
              </Item>
            ))}
          </Drop>
          <Drop label="Font size" width={64} trigger={<span>{parseInt(s.size)}</span>}>
            {SIZES.map((z) => (
              <Item key={z} active={s.size === z} onSelect={() => (z === '15px' ? c().unsetFontSize().run() : c().setFontSize(z).run())}>
                {parseInt(z)}
              </Item>
            ))}
          </Drop>
          <Sep />
          <Btn label="Bold" shortcut="Ctrl+B" icon={<Bold size={17} />} active={s.bold} onClick={() => c().toggleBold().run()} />
          <Btn label="Italic" shortcut="Ctrl+I" icon={<Italic size={17} />} active={s.italic} onClick={() => c().toggleItalic().run()} />
          <Btn label="Underline" shortcut="Ctrl+U" icon={<Underline size={17} />} active={s.underline} onClick={() => c().toggleUnderline().run()} />
          <Btn label="Strikethrough" icon={<Strikethrough size={17} />} active={s.strike} onClick={() => c().toggleStrike().run()} />
          <Btn label="Superscript" shortcut="Ctrl+." icon={<SuperscriptIcon size={17} />} active={s.sup} onClick={() => c().toggleSuperscript().run()} />
          <Btn label="Subscript" shortcut="Ctrl+," icon={<SubscriptIcon size={17} />} active={s.sub} onClick={() => c().toggleSubscript().run()} />
          <Drop label="Text color" trigger={<Type size={16} style={{ color: s.color }} />}>
            <Swatches colors={COLORS} onPick={(col) => c().setColor(col).run()} onClear={() => c().unsetColor().run()} clearLabel="Default color" />
          </Drop>
          <Drop label="Highlight" trigger={<Highlighter size={16} className={s.highlight ? 'text-amber-500' : ''} />}>
            <Swatches colors={HIGHLIGHTS} onPick={(col) => c().setHighlight({ color: col }).run()} onClear={() => c().unsetHighlight().run()} clearLabel="No highlight" />
          </Drop>
          <Sep />
          <Drop
            label="Align"
            trigger={s.align === 'center' ? <AlignCenter size={16} /> : s.align === 'right' ? <AlignRight size={16} /> : s.align === 'justify' ? <AlignJustify size={16} /> : <AlignLeft size={16} />}
          >
            {(
              [
                ['left', 'Left', <AlignLeft key="l" size={15} />],
                ['center', 'Center', <AlignCenter key="c" size={15} />],
                ['right', 'Right', <AlignRight key="r" size={15} />],
                ['justify', 'Justify', <AlignJustify key="j" size={15} />],
              ] as const
            ).map(([a, label, icon]) => (
              <Item key={a} active={s.align === a} onSelect={() => c().setTextAlign(a).run()}>
                {icon} {label}
              </Item>
            ))}
          </Drop>
          <Drop label="Line & paragraph spacing" trigger={<Rows3 size={16} />}>
            {LINE_HEIGHTS.map((lh) => (
              <Item key={lh} active={s.lineHeight === lh} onSelect={() => c().updateAttributes('paragraph', { lineHeight: lh }).updateAttributes('heading', { lineHeight: lh }).run()}>
                {lh === '1' ? 'Single' : lh === '2' ? 'Double' : lh}
              </Item>
            ))}
            <DM.Separator className="my-1 h-px bg-line" />
            <Item onSelect={() => c().updateAttributes('paragraph', { spaceBefore: 12 }).updateAttributes('heading', { spaceBefore: 12 }).run()}>Add space before paragraph</Item>
            <Item onSelect={() => c().updateAttributes('paragraph', { spaceAfter: 12 }).updateAttributes('heading', { spaceAfter: 12 }).run()}>Add space after paragraph</Item>
            <Item onSelect={() => c().updateAttributes('paragraph', { spaceBefore: null, spaceAfter: null, lineHeight: null }).updateAttributes('heading', { spaceBefore: null, spaceAfter: null, lineHeight: null }).run()}>Reset spacing</Item>
          </Drop>
          <Btn label="Bulleted list" icon={<List size={17} />} active={s.bullet} onClick={() => c().toggleBulletList().run()} />
          <Btn label="Numbered list" icon={<ListOrdered size={17} />} active={s.ordered} onClick={() => c().toggleOrderedList().run()} />
          <Btn label="Checklist" icon={<ListChecks size={17} />} active={s.task} onClick={() => c().toggleTaskList().run()} />
          <Btn label="Decrease indent" shortcut="Shift+Tab" icon={<IndentDecrease size={17} />} disabled={!s.canLift} onClick={() => (editor.can().liftListItem('taskItem') ? c().liftListItem('taskItem').run() : c().liftListItem('listItem').run())} />
          <Btn label="Increase indent" shortcut="Tab" icon={<IndentIncrease size={17} />} disabled={!s.canSink} onClick={() => (editor.can().sinkListItem('taskItem') ? c().sinkListItem('taskItem').run() : c().sinkListItem('listItem').run())} />
          <Sep />
          <Btn label="Link" shortcut="Ctrl+K" icon={<Link2 size={17} />} active={s.link} onClick={actions.link} />
          <Btn label="Image" icon={<ImagePlus size={17} />} onClick={actions.image} />
          <Drop label="Table" trigger={<Table size={16} className={s.table ? 'text-brand-600' : ''} />}>
            {!s.table ? (
              <Item onSelect={() => c().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}>Insert 3 × 3 table</Item>
            ) : (
              <>
                <Item onSelect={() => c().addRowBefore().run()}>Insert row above</Item>
                <Item onSelect={() => c().addRowAfter().run()}>Insert row below</Item>
                <Item onSelect={() => c().addColumnBefore().run()}>Insert column left</Item>
                <Item onSelect={() => c().addColumnAfter().run()}>Insert column right</Item>
                <DM.Separator className="my-1 h-px bg-line" />
                <Item onSelect={() => c().mergeOrSplit().run()}>Merge / split cells</Item>
                <Item onSelect={() => c().toggleHeaderRow().run()}>Toggle header row</Item>
                <DM.Separator className="my-1 h-px bg-line" />
                <Item onSelect={() => c().deleteRow().run()}>Delete row</Item>
                <Item onSelect={() => c().deleteColumn().run()}>Delete column</Item>
                <Item onSelect={() => c().deleteTable().run()}>Delete table</Item>
              </>
            )}
          </Drop>
          <Btn label="Code block" icon={<Code2 size={17} />} active={s.codeBlock} onClick={() => c().toggleCodeBlock().run()} />
          <Btn label="Quote" icon={<Quote size={17} />} active={s.quote} onClick={() => c().toggleBlockquote().run()} />
          <Btn label="Callout" icon={<Info size={17} />} active={s.callout} onClick={() => (s.callout ? c().lift('callout').run() : c().wrapIn('callout').run())} />
          <Btn label="Divider" icon={<Minus size={17} />} onClick={() => c().setHorizontalRule().run()} />
          <Btn label="Mention" icon={<AtSign size={17} />} onClick={() => c().insertContent('@').run()} />
          <Btn label="Attach file from Drive" icon={<Paperclip size={17} />} onClick={actions.embed} />
          <Btn label="Clear formatting" icon={<Eraser size={17} />} onClick={() => c().unsetAllMarks().clearNodes().run()} />
          <Sep />
        </>
      )}
      </div>
      <div className="flex shrink-0 items-center gap-0.5 border-l border-line pl-1.5">
      {!ro && (
        <Drop
          label="Editing mode"
          trigger={
            <span className={cn('flex items-center gap-1.5 font-medium', actions.suggesting ? 'text-emerald-700' : 'text-ink-2')} data-testid="mode-switch">
              {actions.suggesting ? <GitPullRequestArrow size={15} /> : <PencilLine size={15} />}
              {actions.suggesting ? 'Suggesting' : 'Editing'}
            </span>
          }
        >
          <Item active={!actions.suggesting} onSelect={() => actions.setSuggesting(false)}>
            <PencilLine size={15} /> Editing — change the document directly
          </Item>
          <Item active={actions.suggesting} onSelect={() => actions.setSuggesting(true)}>
            <GitPullRequestArrow size={15} /> Suggesting — edits become suggestions
          </Item>
        </Drop>
      )}
      {actions.canComment && <Btn label="Add comment" shortcut="Ctrl+Alt+M" icon={<MessageSquarePlus size={17} />} disabled={!s.hasSelection} onClick={actions.comment} />}
      {ro && <span className="ml-2 whitespace-nowrap text-[12px] text-muted">View only{actions.canComment ? ' · select text to comment' : ''}</span>}
      </div>
    </div>
  );
}
