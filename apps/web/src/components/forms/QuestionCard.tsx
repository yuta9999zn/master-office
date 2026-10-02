'use client';

import { isQuestion, newId, QUESTION_TYPES, TYPE_LABEL, type FormItem, type FormOption, type GoTo, type ItemType, type PlainForm, type Validation } from '@workos/form-model';
import {
  AlignLeft,
  ArrowDown,
  ArrowUp,
  Calendar,
  CheckSquare,
  ChevronDown,
  CircleDot,
  Clock,
  Copy,
  GripVertical,
  Image as ImageIcon,
  KeyRound,
  LayoutGrid,
  ListOrdered,
  MoreVertical,
  SlidersHorizontal,
  Star,
  Text,
  Trash2,
  Upload,
  X,
  Grid3x3,
} from 'lucide-react';
import { DropdownMenu as DM } from 'radix-ui';
import type { ReactNode } from 'react';
import { cn, Tip } from '../ui/primitives';
import { AnswerInput, embedUrl } from './AnswerInput';
import type { FormStore } from './form-store';

export const TYPE_ICON: Record<ItemType, ReactNode> = {
  short: <Text size={16} />,
  paragraph: <AlignLeft size={16} />,
  choice: <CircleDot size={16} />,
  checkbox: <CheckSquare size={16} />,
  dropdown: <ChevronDown size={16} />,
  file: <Upload size={16} />,
  scale: <SlidersHorizontal size={16} />,
  rating: <Star size={16} />,
  choiceGrid: <LayoutGrid size={16} />,
  checkboxGrid: <Grid3x3 size={16} />,
  date: <Calendar size={16} />,
  time: <Clock size={16} />,
  section: <ListOrdered size={16} />,
  text: <Text size={16} />,
  image: <ImageIcon size={16} />,
  video: <ImageIcon size={16} />,
};

const VALIDATION_OPS: Record<Validation['kind'], { op: string; label: string; two?: boolean; noValue?: boolean }[]> = {
  number: [
    { op: 'gt', label: 'Greater than' },
    { op: 'gte', label: 'Greater than or equal to' },
    { op: 'lt', label: 'Less than' },
    { op: 'lte', label: 'Less than or equal to' },
    { op: 'eq', label: 'Equal to' },
    { op: 'neq', label: 'Not equal to' },
    { op: 'between', label: 'Between', two: true },
    { op: 'notBetween', label: 'Not between', two: true },
    { op: 'isNumber', label: 'Is number', noValue: true },
    { op: 'whole', label: 'Whole number', noValue: true },
  ],
  text: [
    { op: 'contains', label: 'Contains' },
    { op: 'notContains', label: 'Doesn’t contain' },
    { op: 'email', label: 'Email', noValue: true },
    { op: 'url', label: 'URL', noValue: true },
  ],
  length: [
    { op: 'max', label: 'Maximum character count' },
    { op: 'min', label: 'Minimum character count' },
  ],
  regex: [
    { op: 'matches', label: 'Matches' },
    { op: 'notMatches', label: 'Doesn’t match' },
  ],
  count: [
    { op: 'atLeast', label: 'Select at least' },
    { op: 'atMost', label: 'Select at most' },
    { op: 'exactly', label: 'Select exactly' },
  ],
};

const field = 'w-full rounded-none border-0 border-b border-transparent bg-transparent px-0 py-1 outline-none hover:border-slate-200 focus:border-b-2';

function TypeSelect({ value, onChange }: { value: ItemType; onChange: (t: ItemType) => void }) {
  return (
    <DM.Root>
      <DM.Trigger asChild>
        <button className="flex h-11 w-60 shrink-0 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-[14px]" aria-label="Question type" data-testid="question-type">
          {TYPE_ICON[value]}
          <span className="flex-1 text-left">{TYPE_LABEL[value]}</span>
          <ChevronDown size={15} className="text-slate-500" />
        </button>
      </DM.Trigger>
      <DM.Portal>
        <DM.Content sideOffset={4} align="end" className="pop z-50 w-60 animate-pop">
          {QUESTION_TYPES.map((t, i) => (
            <div key={t}>
              {[2, 5, 6, 8, 10].includes(i) && <DM.Separator className="my-1 h-px bg-line" />}
              <DM.Item className={cn('menu-item', t === value && 'bg-selected')} onSelect={() => onChange(t)}>
                {TYPE_ICON[t]} {TYPE_LABEL[t]}
              </DM.Item>
            </div>
          ))}
        </DM.Content>
      </DM.Portal>
    </DM.Root>
  );
}

function GoToSelect({ value, sections, onChange, label }: { value: GoTo | undefined; sections: FormItem[]; onChange: (g: GoTo) => void; label: string }) {
  return (
    <select aria-label={label} value={value ?? ''} onChange={(e) => onChange(e.target.value || null)} className="h-8 max-w-60 rounded-md border border-slate-300 bg-white px-2 text-[13px]">
      <option value="">Continue to next section</option>
      {sections.map((s, i) => (
        <option key={s.id} value={s.id}>
          Go to section {i + 2} ({s.title || 'Untitled section'})
        </option>
      ))}
      <option value="submit">Submit form</option>
    </select>
  );
}

function ListEditor({ values, onChange, label, color }: { values: string[]; onChange: (v: string[]) => void; label: string; color: string }) {
  return (
    <div className="space-y-1.5">
      {values.map((v, i) => (
        <div key={i} className="group flex items-center gap-2">
          <span className="w-5 text-right text-[13px] text-slate-500">{i + 1}.</span>
          <input value={v} onChange={(e) => onChange(values.map((x, j) => (j === i ? e.target.value : x)))} className={cn(field, 'text-[14px]')} style={{ borderBottomColor: undefined }} aria-label={`${label} ${i + 1}`} />
          {values.length > 1 && (
            <button onClick={() => onChange(values.filter((_, j) => j !== i))} className="text-slate-400 hover:text-slate-700" aria-label={`Remove ${label} ${i + 1}`}>
              <X size={16} />
            </button>
          )}
        </div>
      ))}
      <button onClick={() => onChange([...values, `${label} ${values.length + 1}`])} className="ml-7 text-[13px] font-medium" style={{ color }}>
        Add {label.toLowerCase()}
      </button>
    </div>
  );
}

export function QuestionCard({
  item,
  form,
  store,
  selected,
  onSelect,
  color,
  editable,
  index,
  sectionNumber,
  remote,
  onUploadImage,
  dragHandle,
}: {
  item: FormItem;
  form: PlainForm;
  store: FormStore;
  selected: boolean;
  onSelect: () => void;
  color: string;
  editable: boolean;
  index: number;
  sectionNumber: number;
  remote: { name: string; color: string }[];
  onUploadImage: (file: File) => Promise<string | null>;
  dragHandle: ReactNode;
}) {
  const up = (patch: Partial<FormItem>) => store.updateItem(item.id, patch);
  const sections = form.items.filter((i) => i.type === 'section' && i.id !== item.id);
  const quiz = form.settings.quiz && isQuestion(item.type) && !['file', 'choiceGrid', 'checkboxGrid', 'rating', 'scale'].includes(item.type);
  const setOption = (o: FormOption, patch: Partial<FormOption>) => up({ options: item.options?.map((x) => (x.id === o.id ? { ...x, ...patch } : x)) });
  const answers = item.quiz?.answers ?? [];
  const toggleAnswer = (label: string) => up({ quiz: { points: item.quiz?.points ?? 1, ...item.quiz, answers: item.type === 'checkbox' ? (answers.includes(label) ? answers.filter((a) => a !== label) : [...answers, label]) : [label] } });

  // ── Section header card ──
  if (item.type === 'section') {
    return (
      <div onClick={onSelect} className="relative" data-item={item.id}>
        <div className="mb-[-6px] ml-0 inline-block rounded-t-lg px-4 py-1.5 text-[13px] font-medium text-white" style={{ background: color }}>
          Section {sectionNumber}
        </div>
        <div className={cn('rounded-lg border bg-white p-6 shadow-sm', selected ? 'border-l-[6px] border-l-blue-500' : 'border-slate-200')} style={{ borderTop: `8px solid ${color}` }}>
          {dragHandle}
          <input disabled={!editable} value={item.title} onChange={(e) => up({ title: e.target.value })} className={cn(field, 'text-[22px]')} aria-label="Section title" placeholder="Section title" />
          <textarea disabled={!editable} value={item.description ?? ''} onChange={(e) => up({ description: e.target.value || undefined })} rows={1} className={cn(field, 'mt-2 resize-none text-[14px]')} placeholder="Description (optional)" aria-label="Section description" />
          {selected && editable && (
            <div className="mt-4 flex items-center justify-between gap-2 border-t border-slate-200 pt-3 text-[13px] text-slate-600">
              <span className="flex items-center gap-2">
                After section {sectionNumber}
                <GoToSelect label="After this section" value={item.after} sections={sections} onChange={(g) => up({ after: g })} />
              </span>
              <span className="flex gap-1">
                <IconBtn label="Delete section" onClick={() => store.deleteItem(item.id)}>
                  <Trash2 size={18} />
                </IconBtn>
              </span>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      onClick={onSelect}
      className={cn('relative rounded-lg border bg-white shadow-sm transition', selected ? 'border-l-[6px] border-l-blue-500 border-slate-200' : 'border-slate-200 hover:shadow')}
      data-item={item.id}
      data-testid="form-item"
    >
      {remote.length > 0 && (
        <div className="absolute -top-2.5 right-3 flex gap-1">
          {remote.map((r) => (
            <span key={r.name} className="rounded px-1.5 text-[10px] font-medium text-white" style={{ background: r.color }}>
              {r.name}
            </span>
          ))}
        </div>
      )}
      {dragHandle}
      <div className="px-6 pb-5 pt-3">
        {selected && editable ? (
          <>
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1 rounded-t-md bg-slate-50 px-3 pt-2">
                <input autoFocus={!item.title || item.title === 'Untitled question'} value={item.title} onChange={(e) => up({ title: e.target.value })} className={cn(field, 'border-b-slate-300 py-2 text-[16px]')} placeholder={item.type === 'text' || item.type === 'image' || item.type === 'video' ? 'Title' : 'Question'} aria-label="Question" onFocus={(e) => item.title === 'Untitled question' && e.target.select()} />
              </div>
              {isQuestion(item.type) && <TypeSelect value={item.type} onChange={(t) => store.changeType(item.id, t)} />}
            </div>
            {(item.description !== undefined || item.type === 'text') && (
              <input value={item.description ?? ''} onChange={(e) => up({ description: e.target.value })} className={cn(field, 'mt-2 text-[13px]')} placeholder="Description" aria-label="Description" />
            )}
          </>
        ) : (
          <div className="pt-2">
            <div className="text-[16px] text-slate-900">
              {item.title || <span className="text-slate-400">{item.type === 'image' ? 'Image' : item.type === 'video' ? 'Video' : 'Untitled'}</span>}
              {item.required && <span className="ml-1 text-red-600">*</span>}
              {form.settings.quiz && item.quiz?.points ? <span className="ml-2 text-[12px] text-slate-500">({item.quiz.points} pt)</span> : null}
            </div>
            {item.description && <div className="mt-1 whitespace-pre-wrap text-[13px] text-slate-600">{item.description}</div>}
          </div>
        )}

        {/* Body by type */}
        <div className="mt-4">
          {item.type === 'image' &&
            (item.image?.src ? (
              <img src={item.image.src} alt={item.image.alt ?? ''} className="max-h-80 max-w-full rounded" />
            ) : (
              editable && (
                <label className="flex h-28 cursor-pointer items-center justify-center rounded-md border border-dashed border-slate-300 text-[13px] text-slate-500 hover:bg-slate-50">
                  <ImageIcon size={18} className="mr-2" /> Upload an image
                  <input
                    type="file"
                    accept="image/*"
                    hidden
                    onChange={async (e) => {
                      const f = e.target.files?.[0];
                      e.target.value = '';
                      const url = f ? await onUploadImage(f) : null;
                      if (url) up({ image: { src: url, alt: f!.name } });
                    }}
                  />
                </label>
              )
            ))}
          {item.type === 'video' &&
            (selected && editable ? (
              <input value={item.video?.url ?? ''} onChange={(e) => up({ video: { url: e.target.value } })} placeholder="YouTube or Vimeo URL" className="h-9 w-full rounded-md border border-slate-300 px-2 text-[13px]" aria-label="Video URL" />
            ) : item.video?.url && embedUrl(item.video.url) ? (
              <iframe src={embedUrl(item.video.url)!} className="aspect-video w-full max-w-xl rounded" allowFullScreen title={item.title || 'Video'} />
            ) : (
              <div className="text-[13px] text-slate-400">No video yet</div>
            ))}

          {selected && editable && (item.type === 'choice' || item.type === 'checkbox' || item.type === 'dropdown') ? (
            <div className="space-y-1.5">
              {item.options?.map((o, i) => (
                <div key={o.id} className="group flex items-center gap-3">
                  {item.type === 'choice' ? <CircleDot size={18} className="text-slate-300" /> : item.type === 'checkbox' ? <CheckSquare size={18} className="text-slate-300" /> : <span className="w-[18px] text-right text-[13px] text-slate-500">{i + 1}.</span>}
                  <input value={o.label} onChange={(e) => setOption(o, { label: e.target.value })} className={cn(field, 'flex-1 text-[14px]')} aria-label={`Option ${i + 1}`} onFocus={(e) => /^Option \d+$/.test(o.label) && e.target.select()} />
                  {quiz && (
                    <button onClick={() => toggleAnswer(o.label)} className={cn('rounded px-1.5 py-0.5 text-[11px]', answers.includes(o.label) ? 'bg-emerald-100 text-emerald-700' : 'text-slate-400 hover:bg-slate-100')} aria-label={`Mark ${o.label} correct`}>
                      {answers.includes(o.label) ? '✓ correct' : 'mark correct'}
                    </button>
                  )}
                  {item.branching && item.type !== 'checkbox' && <GoToSelect label={`After ${o.label}`} value={o.goTo} sections={sections} onChange={(g) => setOption(o, { goTo: g })} />}
                  {(item.options?.length ?? 0) > 1 && (
                    <button onClick={() => up({ options: item.options!.filter((x) => x.id !== o.id) })} className="text-slate-400 opacity-0 hover:text-slate-700 group-hover:opacity-100" aria-label={`Remove option ${i + 1}`}>
                      <X size={18} />
                    </button>
                  )}
                </div>
              ))}
              {item.other && item.type !== 'dropdown' && (
                <div className="flex items-center gap-3 text-[14px] text-slate-500">
                  {item.type === 'choice' ? <CircleDot size={18} className="text-slate-300" /> : <CheckSquare size={18} className="text-slate-300" />}
                  <span className="flex-1 border-b border-dotted border-slate-300 py-1">Other…</span>
                  <button onClick={() => up({ other: false })} className="text-slate-400 hover:text-slate-700" aria-label="Remove Other">
                    <X size={18} />
                  </button>
                </div>
              )}
              <div className="flex items-center gap-2 pl-8 text-[14px]">
                <button onClick={() => up({ options: [...(item.options ?? []), { id: newId(), label: `Option ${(item.options?.length ?? 0) + 1}` }] })} className="text-slate-500 hover:underline" data-testid="add-option">
                  Add option
                </button>
                {item.type !== 'dropdown' && !item.other && (
                  <>
                    <span className="text-slate-400">or</span>
                    <button onClick={() => up({ other: true })} className="font-medium" style={{ color }}>
                      add &quot;Other&quot;
                    </button>
                  </>
                )}
              </div>
            </div>
          ) : selected && editable && item.type === 'scale' ? (
            <div className="space-y-3 text-[14px]">
              <div className="flex items-center gap-3">
                <select aria-label="Scale minimum" value={item.scale?.min ?? 1} onChange={(e) => up({ scale: { ...item.scale!, min: Number(e.target.value) } })} className="h-9 rounded-md border border-slate-300 px-2">
                  {[0, 1].map((n) => (
                    <option key={n}>{n}</option>
                  ))}
                </select>
                to
                <select aria-label="Scale maximum" value={item.scale?.max ?? 5} onChange={(e) => up({ scale: { ...item.scale!, max: Number(e.target.value) } })} className="h-9 rounded-md border border-slate-300 px-2">
                  {[2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                    <option key={n}>{n}</option>
                  ))}
                </select>
              </div>
              {(['minLabel', 'maxLabel'] as const).map((k) => (
                <div key={k} className="flex items-center gap-3">
                  <span className="w-5 text-slate-500">{k === 'minLabel' ? item.scale?.min : item.scale?.max}</span>
                  <input value={item.scale?.[k] ?? ''} onChange={(e) => up({ scale: { ...item.scale!, [k]: e.target.value || undefined } })} placeholder="Label (optional)" className={cn(field, 'max-w-xs')} aria-label={k} />
                </div>
              ))}
            </div>
          ) : selected && editable && item.type === 'rating' ? (
            <div className="flex items-center gap-3 text-[14px]">
              <select aria-label="Rating levels" value={item.rating?.max ?? 5} onChange={(e) => up({ rating: { ...item.rating!, max: Number(e.target.value) } })} className="h-9 rounded-md border border-slate-300 px-2">
                {[3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </select>
              <select aria-label="Rating icon" value={item.rating?.icon ?? 'star'} onChange={(e) => up({ rating: { ...item.rating!, icon: e.target.value as 'star' } })} className="h-9 rounded-md border border-slate-300 px-2">
                <option value="star">Star</option>
                <option value="heart">Heart</option>
                <option value="thumb">Thumb up</option>
              </select>
            </div>
          ) : selected && editable && (item.type === 'choiceGrid' || item.type === 'checkboxGrid') ? (
            <div className="grid grid-cols-2 gap-6">
              <div>
                <div className="mb-1 text-[13px] font-medium text-slate-600">Rows</div>
                <ListEditor label="Row" values={item.grid?.rows ?? []} onChange={(rows) => up({ grid: { ...item.grid!, rows } })} color={color} />
              </div>
              <div>
                <div className="mb-1 text-[13px] font-medium text-slate-600">Columns</div>
                <ListEditor label="Column" values={item.grid?.cols ?? []} onChange={(cols) => up({ grid: { ...item.grid!, cols } })} color={color} />
              </div>
            </div>
          ) : selected && editable && item.type === 'file' ? (
            <div className="flex flex-wrap items-center gap-4 text-[14px]">
              <label className="flex items-center gap-2">
                Maximum number of files
                <select value={item.file?.maxFiles ?? 1} onChange={(e) => up({ file: { ...item.file!, maxFiles: Number(e.target.value) } })} className="h-9 rounded-md border border-slate-300 px-2">
                  {[1, 5, 10].map((n) => (
                    <option key={n}>{n}</option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-2">
                Maximum file size
                <select value={item.file?.maxSizeMb ?? 10} onChange={(e) => up({ file: { ...item.file!, maxSizeMb: Number(e.target.value) } })} className="h-9 rounded-md border border-slate-300 px-2">
                  {[1, 10, 100].map((n) => (
                    <option key={n} value={n}>
                      {n} MB
                    </option>
                  ))}
                </select>
              </label>
            </div>
          ) : selected && editable && item.type === 'date' ? (
            <label className="flex items-center gap-2 text-[14px]">
              <input type="checkbox" checked={!!item.date?.includeTime} onChange={(e) => up({ date: { includeTime: e.target.checked } })} /> Include time
            </label>
          ) : isQuestion(item.type) ? (
            <AnswerInput item={item} value={undefined} onChange={() => undefined} color={color} disabled />
          ) : null}

          {/* Validation editor */}
          {selected && editable && item.validation && (
            <ValidationEditor item={item} onChange={(v) => up({ validation: v })} />
          )}

          {/* Quiz answer key for text answers */}
          {selected && quiz && (item.type === 'short' || item.type === 'paragraph') && (
            <div className="mt-4 rounded-md bg-emerald-50 p-3 text-[13px]">
              <div className="mb-1 flex items-center gap-1.5 font-medium text-emerald-800">
                <KeyRound size={14} /> Correct answers (any of them; not case sensitive)
              </div>
              <ListEditor label="Answer" values={answers.length ? answers : ['']} onChange={(a) => up({ quiz: { points: item.quiz?.points ?? 1, ...item.quiz, answers: a.filter((x) => x.trim()) } })} color="#047857" />
            </div>
          )}
          {selected && quiz && (
            <div className="mt-3 flex flex-wrap items-center gap-3 text-[13px] text-slate-600">
              <label className="flex items-center gap-2">
                Points
                <input type="number" min={0} max={1000} value={item.quiz?.points ?? 0} onChange={(e) => up({ quiz: { ...item.quiz, points: Math.max(0, Number(e.target.value) || 0) } })} className="h-8 w-20 rounded-md border border-slate-300 px-2" aria-label="Points" />
              </label>
              <input value={item.quiz?.feedbackCorrect ?? ''} onChange={(e) => up({ quiz: { points: item.quiz?.points ?? 1, ...item.quiz, feedbackCorrect: e.target.value || undefined } })} placeholder="Feedback for correct answers" className="h-8 min-w-48 flex-1 rounded-md border border-slate-300 px-2" />
              <input value={item.quiz?.feedbackWrong ?? ''} onChange={(e) => up({ quiz: { points: item.quiz?.points ?? 1, ...item.quiz, feedbackWrong: e.target.value || undefined } })} placeholder="Feedback for incorrect answers" className="h-8 min-w-48 flex-1 rounded-md border border-slate-300 px-2" />
            </div>
          )}
        </div>

        {/* Footer */}
        {selected && editable && (
          <div className="mt-5 flex items-center justify-end gap-1 border-t border-slate-200 pt-3" onClick={(e) => e.stopPropagation()}>
            <IconBtn label="Move up" disabled={index === 0} onClick={() => store.moveItem(item.id, index - 1)}>
              <ArrowUp size={18} />
            </IconBtn>
            <IconBtn label="Move down" disabled={index === form.items.length - 1} onClick={() => store.moveItem(item.id, index + 1)}>
              <ArrowDown size={18} />
            </IconBtn>
            <IconBtn label="Duplicate" onClick={() => store.duplicateItem(item.id)}>
              <Copy size={18} />
            </IconBtn>
            <IconBtn label="Delete" onClick={() => store.deleteItem(item.id)}>
              <Trash2 size={18} />
            </IconBtn>
            {isQuestion(item.type) && (
              <>
                <span className="mx-2 h-7 w-px bg-slate-200" />
                <label className="flex cursor-pointer items-center gap-2 text-[14px]">
                  Required
                  <button
                    role="switch"
                    aria-checked={!!item.required}
                    onClick={() => up({ required: !item.required || undefined })}
                    className={cn('relative h-5 w-9 rounded-full transition', item.required ? '' : 'bg-slate-300')}
                    style={item.required ? { background: color } : undefined}
                    data-testid="required-toggle"
                  >
                    <span className={cn('absolute top-0.5 size-4 rounded-full bg-white shadow transition', item.required ? 'left-[18px]' : 'left-0.5')} />
                  </button>
                </label>
                <DM.Root>
                  <DM.Trigger asChild>
                    <button className="rounded-full p-2 text-slate-600 hover:bg-slate-100" aria-label="More options">
                      <MoreVertical size={18} />
                    </button>
                  </DM.Trigger>
                  <DM.Portal>
                    <DM.Content sideOffset={4} align="end" className="pop z-50 w-64 animate-pop">
                      <DM.Label className="px-2.5 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-subtle">Show</DM.Label>
                      <DM.CheckboxItem className="menu-item" checked={item.description !== undefined} onCheckedChange={(on) => up({ description: on ? '' : undefined })}>
                        {item.description !== undefined ? '✓ ' : ''}Description
                      </DM.CheckboxItem>
                      {['short', 'paragraph', 'checkbox'].includes(item.type) && (
                        <DM.CheckboxItem
                          className="menu-item"
                          checked={!!item.validation}
                          onCheckedChange={(on) => up({ validation: on ? (item.type === 'checkbox' ? { kind: 'count', op: 'atLeast', value: 1 } : { kind: 'number', op: 'gt', value: 0 }) : null })}
                        >
                          {item.validation ? '✓ ' : ''}Response validation
                        </DM.CheckboxItem>
                      )}
                      {(item.type === 'choice' || item.type === 'dropdown') && (
                        <DM.CheckboxItem className="menu-item" checked={!!item.branching} onCheckedChange={(on) => up({ branching: on || undefined })}>
                          {item.branching ? '✓ ' : ''}Go to section based on answer
                        </DM.CheckboxItem>
                      )}
                      {(item.type === 'choice' || item.type === 'checkbox' || item.type === 'dropdown') && (
                        <DM.CheckboxItem className="menu-item" checked={!!item.shuffle} onCheckedChange={(on) => up({ shuffle: on || undefined })}>
                          {item.shuffle ? '✓ ' : ''}Shuffle option order
                        </DM.CheckboxItem>
                      )}
                      {item.type === 'choiceGrid' && (
                        <DM.CheckboxItem className="menu-item" checked={!!item.grid?.oneAnswerPerColumn} onCheckedChange={(on) => up({ grid: { ...item.grid!, oneAnswerPerColumn: on || undefined } })}>
                          {item.grid?.oneAnswerPerColumn ? '✓ ' : ''}Limit to one response per column
                        </DM.CheckboxItem>
                      )}
                    </DM.Content>
                  </DM.Portal>
                </DM.Root>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ValidationEditor({ item, onChange }: { item: FormItem; onChange: (v: Validation | null) => void }) {
  const v = item.validation!;
  const kinds: Validation['kind'][] = item.type === 'checkbox' ? ['count'] : ['number', 'text', 'length', 'regex'];
  const ops = VALIDATION_OPS[v.kind];
  const op = ops.find((o) => o.op === v.op) ?? ops[0];
  return (
    <div className="mt-4 flex flex-wrap items-center gap-2 text-[13px]" data-testid="validation">
      {kinds.length > 1 && (
        <select aria-label="Validation type" value={v.kind} onChange={(e) => onChange({ kind: e.target.value as Validation['kind'], op: VALIDATION_OPS[e.target.value as Validation['kind']][0].op })} className="h-8 rounded-md border border-slate-300 px-2">
          <option value="number">Number</option>
          <option value="text">Text</option>
          <option value="length">Length</option>
          <option value="regex">Regular expression</option>
        </select>
      )}
      <select aria-label="Validation rule" value={op.op} onChange={(e) => onChange({ ...v, op: e.target.value })} className="h-8 rounded-md border border-slate-300 px-2">
        {ops.map((o) => (
          <option key={o.op} value={o.op}>
            {o.label}
          </option>
        ))}
      </select>
      {!op.noValue && <input value={v.value ?? ''} onChange={(e) => onChange({ ...v, value: e.target.value })} placeholder={v.kind === 'regex' ? 'Pattern' : 'Number' + (v.kind === 'text' ? ' / text' : '')} className="h-8 w-32 rounded-md border border-slate-300 px-2" aria-label="Validation value" />}
      {op.two && <input value={v.value2 ?? ''} onChange={(e) => onChange({ ...v, value2: e.target.value })} placeholder="and" className="h-8 w-24 rounded-md border border-slate-300 px-2" aria-label="Validation second value" />}
      <input value={v.message ?? ''} onChange={(e) => onChange({ ...v, message: e.target.value || undefined })} placeholder="Custom error text" className="h-8 min-w-40 flex-1 rounded-md border border-slate-300 px-2" aria-label="Validation message" />
      <button onClick={() => onChange(null)} className="text-slate-400 hover:text-slate-700" aria-label="Remove validation">
        <X size={16} />
      </button>
    </div>
  );
}

function IconBtn({ label, onClick, children, disabled }: { label: string; onClick: () => void; children: ReactNode; disabled?: boolean }) {
  return (
    <Tip label={label}>
      <button disabled={disabled} onClick={onClick} className="rounded-full p-2 text-slate-600 hover:bg-slate-100 disabled:opacity-30" aria-label={label}>
        {children}
      </button>
    </Tip>
  );
}

export const DragHandle = GripVertical;
