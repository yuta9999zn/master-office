'use client';

import {
  DEFAULT_SIZE,
  DEFAULT_THEME,
  FONTS,
  isLine,
  isOpenStroke,
  layoutElements,
  LAYOUTS,
  SHAPES,
  EXTRA_SHAPES,
  SLIDE_SIZES,
  THEME_TOKENS,
  themeColor,
  THEMES,
  type Background,
  type ChartSpec,
  type DeckSize,
  type ElementStyle,
  type Geometry,
  type LayoutId,
  type PlainElement,
  type PlainSlide,
  type Theme,
  type Transition,
} from '@workos/slide-model';
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalDistributeCenter,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalDistributeCenter,
  ArrowDownToLine,
  ArrowUpToLine,
  BringToFront,
  ChartColumn,
  ChartBar,
  ChartLine,
  ChartArea,
  ChartPie,
  Check,
  CircleDot,
  FlipHorizontal2,
  FlipVertical2,
  ImagePlus,
  Link2,
  Minus,
  Plus,
  RefreshCw,
  SendToBack,
  Trash2,
  Unlink,
} from 'lucide-react';
import { Popover } from 'radix-ui';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useSearch } from '@/lib/queries';
import { Button, cn, Tip } from '../ui/primitives';
import type { DeckSnapshot, DeckStore } from './deck-store';
import { SlideView } from './SlideView';

// ── Small form controls ──────────────────────────────────────────────────────

export const PALETTE = ['#000000', '#FFFFFF', '#0F172A', '#334155', '#64748B', '#94A3B8', '#E2E8F0', '#DC2626', '#EA580C', '#F59E0B', '#16A34A', '#0D9488', '#2563EB', '#7C3AED', '#DB2777', '#F28B9B', '#FDE68A', '#BBF7D0', '#BFDBFE', '#FBCFE8'];

export function Section({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="border-b border-line px-4 py-3.5 last:border-b-0">
      <div className="mb-2.5 flex items-center justify-between">
        <h3 className="text-[13px] font-semibold text-ink">{title}</h3>
        {action}
      </div>
      <div className="space-y-2.5">{children}</div>
    </section>
  );
}

export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex items-center gap-2 text-[12px] text-muted">
      <span className="w-20 shrink-0">{label}</span>
      <div className="flex min-w-0 flex-1 items-center gap-1.5">{children}</div>
    </label>
  );
}

export function Select<T extends string>({ value, options, onChange, className, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; className?: string; label?: string }) {
  return (
    <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value as T)} className={cn('h-8 min-w-0 flex-1 rounded-lg border border-line bg-surface px-2 text-[13px] text-ink outline-none focus:border-brand-600', className)}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function NumberField({ value, onCommit, min, max, step = 1, suffix, label, w = 64 }: { value: number | undefined; onCommit: (v: number) => void; min?: number; max?: number; step?: number; suffix?: string; label: string; w?: number }) {
  const [v, setV] = useState(value === undefined ? '' : String(Math.round(value * 100) / 100));
  useEffect(() => setV(value === undefined ? '' : String(Math.round(value * 100) / 100)), [value]);
  const commit = () => {
    const n = Number(v);
    if (v === '' || !Number.isFinite(n)) return;
    onCommit(Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n)));
  };
  return (
    <span className="relative inline-flex">
      <input
        aria-label={label}
        type="number"
        value={v}
        step={step}
        min={min}
        max={max}
        onChange={(e) => setV(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && (commit(), (e.target as HTMLInputElement).blur())}
        className="h-8 rounded-lg border border-line bg-surface pl-2 pr-5 text-[13px] text-ink outline-none focus:border-brand-600"
        style={{ width: w }}
      />
      {suffix && <span className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-[11px] text-subtle">{suffix}</span>}
    </span>
  );
}

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-[13px] text-ink-2">
      <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} className="size-4 rounded border-line accent-brand-600" />
      {label}
    </label>
  );
}

/** Colour picker: theme colours (follow theme changes), a standard palette, custom colour and optional "none". */
export function ColorPicker({ value, theme, onChange, allowNone, label, children }: { value: string | null | undefined; theme: Theme; onChange: (c: string | null) => void; allowNone?: boolean; label: string; children?: ReactNode }) {
  const shown = themeColor(value, theme);
  return (
    <Popover.Root>
      <Tip label={label}>
        <Popover.Trigger asChild>
          {children ?? (
            <button type="button" aria-label={label} onMouseDown={(e) => e.preventDefault()} className="flex h-8 items-center gap-1.5 rounded-lg border border-line bg-surface px-1.5 text-[12px] text-ink-2 hover:bg-hover">
              <span className="size-5 rounded border border-black/10" style={{ background: shown ?? 'repeating-conic-gradient(#e2e8f0 0 25%, #fff 0 50%) 0 0/8px 8px' }} />
              <span className="w-14 truncate text-left">{value ? (value.startsWith('@') ? value.slice(1) : value.toUpperCase()) : 'None'}</span>
            </button>
          )}
        </Popover.Trigger>
      </Tip>
      <Popover.Portal>
        <Popover.Content sideOffset={4} align="start" className="pop z-50 w-[232px] animate-pop p-2.5" onOpenAutoFocus={(e) => e.preventDefault()} onCloseAutoFocus={(e) => e.preventDefault()}>
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-subtle">Theme colours</div>
          <div className="mb-2.5 grid grid-cols-10 gap-1">
            {THEME_TOKENS.map((t) => (
              <Popover.Close key={t} asChild>
                <button
                  aria-label={t.slice(1)}
                  title={t.slice(1)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => onChange(t)}
                  className={cn('size-[18px] rounded border border-black/10 hover:scale-110', value === t && 'ring-2 ring-brand-600 ring-offset-1')}
                  style={{ background: themeColor(t, theme)! }}
                />
              </Popover.Close>
            ))}
          </div>
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-subtle">Standard</div>
          <div className="grid grid-cols-10 gap-1">
            {PALETTE.map((c) => (
              <Popover.Close key={c} asChild>
                <button aria-label={c} onMouseDown={(e) => e.preventDefault()} onClick={() => onChange(c)} className={cn('size-[18px] rounded border border-black/10 hover:scale-110', value?.toUpperCase() === c && 'ring-2 ring-brand-600 ring-offset-1')} style={{ background: c }} />
              </Popover.Close>
            ))}
          </div>
          <div className="mt-2.5 flex items-center gap-2">
            <label className="flex flex-1 cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-[12px] text-ink-2 hover:bg-hover">
              <input type="color" value={shown && /^#[0-9a-f]{6}$/i.test(shown) ? shown : '#2563eb'} onChange={(e) => onChange(e.target.value.toUpperCase())} className="size-5 cursor-pointer rounded border-0 bg-transparent p-0" />
              Custom…
            </label>
            {allowNone && (
              <Popover.Close asChild>
                <button onClick={() => onChange(null)} className="rounded-md px-2 py-1 text-[12px] text-ink-2 hover:bg-hover">
                  None
                </button>
              </Popover.Close>
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function IconBtn({ label, onClick, children, active, disabled }: { label: string; onClick: () => void; children: ReactNode; active?: boolean; disabled?: boolean }) {
  return (
    <Tip label={label}>
      <button type="button" aria-label={label} disabled={disabled} onClick={onClick} className={cn('flex size-8 items-center justify-center rounded-lg border border-line text-ink-2 hover:bg-hover disabled:opacity-40', active && 'border-brand-600 bg-brand-50 text-brand-600')}>
        {children}
      </button>
    </Tip>
  );
}

// ── Design tab ───────────────────────────────────────────────────────────────

export function DesignTab({ store, deck, slide, editable, onUploadImage }: { store: DeckStore; deck: DeckSnapshot; slide: PlainSlide; editable: boolean; onUploadImage: (file: File) => Promise<string | null> }) {
  const bg = slide.meta.background ?? null;
  const kind = bg?.type ?? 'theme';
  const set = (b: Background | null) => store.setSlideMeta([slide.id], { background: b });
  const sizeId = SLIDE_SIZES.find((s) => (s.size.w === deck.size.w && s.size.h === deck.size.h) || (s.size.w === deck.size.h && s.size.h === deck.size.w))?.id ?? 'custom';
  const portrait = deck.size.h > deck.size.w;
  return (
    <fieldset disabled={!editable} className="min-w-0">
      <Section title="Background">
        <Row label="Fill">
          <Select
            label="Background fill"
            value={kind}
            options={[
              { value: 'theme', label: 'Theme background' },
              { value: 'solid', label: 'Solid fill' },
              { value: 'gradient', label: 'Gradient fill' },
              { value: 'image', label: 'Picture fill' },
            ]}
            onChange={(v) => {
              if (v === 'theme') set(null);
              else if (v === 'solid') set({ type: 'solid', color: '@bg' });
              else if (v === 'gradient') set({ type: 'gradient', from: '@bg', to: '@accent2', angle: 135 });
              else document.getElementById('mo-bg-file')?.click();
            }}
          />
        </Row>
        {bg?.type === 'solid' && (
          <Row label="Colour">
            <ColorPicker label="Background colour" value={bg.color} theme={deck.theme} onChange={(c) => set({ type: 'solid', color: c ?? '#FFFFFF' })} />
          </Row>
        )}
        {bg?.type === 'gradient' && (
          <>
            <Row label="From / to">
              <ColorPicker label="Gradient start" value={bg.from} theme={deck.theme} onChange={(c) => set({ ...bg, from: c ?? '#FFFFFF' })} />
              <ColorPicker label="Gradient end" value={bg.to} theme={deck.theme} onChange={(c) => set({ ...bg, to: c ?? '#FFFFFF' })} />
            </Row>
            <Row label="Angle">
              <NumberField label="Gradient angle" value={bg.angle} min={0} max={360} suffix="°" onCommit={(a) => set({ ...bg, angle: a })} />
            </Row>
          </>
        )}
        {bg?.type === 'image' && (
          <Row label="Picture">
            <Button size="sm" icon={<ImagePlus size={14} />} onClick={() => document.getElementById('mo-bg-file')?.click()}>
              Change picture
            </Button>
          </Row>
        )}
        <input
          id="mo-bg-file"
          type="file"
          accept="image/*"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            const url = await onUploadImage(f);
            if (url) set({ type: 'image', src: url });
          }}
        />
        <div className="flex gap-2">
          <Button size="sm" variant="soft" onClick={() => (store.setSlideMeta(deck.slides.map((s) => s.id), { background: bg }), toast.success('Background applied to all slides'))}>
            Apply to all slides
          </Button>
          {bg && (
            <Button size="sm" variant="ghost" onClick={() => set(null)}>
              Reset
            </Button>
          )}
        </div>
      </Section>

      <Section title="Color scheme">
        <div className="grid grid-cols-1 gap-1.5">
          {THEMES.map((t) => {
            const active = t.colors.accents.join() === deck.theme.colors.accents.join() && t.colors.bg === deck.theme.colors.bg;
            return (
              <button
                key={t.id}
                onClick={() => store.setTheme({ ...deck.theme, id: deck.theme.id === t.id ? t.id : `${deck.theme.id}`, colors: t.colors })}
                className={cn('flex items-center gap-2 rounded-lg border px-2 py-1.5 text-left hover:bg-hover', active ? 'border-brand-600 ring-1 ring-brand-600' : 'border-line')}
              >
                <span className="w-6 rounded text-center text-[13px] font-semibold" style={{ color: t.colors.title, background: t.colors.bg, fontFamily: deck.theme.fonts.heading }}>
                  Aa
                </span>
                <span className="flex flex-1 overflow-hidden rounded">
                  {[t.colors.bg, ...t.colors.accents].map((c, i) => (
                    <span key={i} className="h-4 flex-1" style={{ background: c }} />
                  ))}
                </span>
                <span className="w-24 truncate text-[12px] text-muted">{t.name}</span>
              </button>
            );
          })}
        </div>
      </Section>

      <Section title="Font">
        <Row label="Headings">
          <Select label="Heading font" value={deck.theme.fonts.heading} options={FONTS.map((f) => ({ value: f, label: f }))} onChange={(f) => store.setTheme({ ...deck.theme, fonts: { ...deck.theme.fonts, heading: f } })} />
        </Row>
        <Row label="Body">
          <Select label="Body font" value={deck.theme.fonts.body} options={FONTS.map((f) => ({ value: f, label: f }))} onChange={(f) => store.setTheme({ ...deck.theme, fonts: { ...deck.theme.fonts, body: f } })} />
        </Row>
      </Section>

      <Section title="Slide size">
        <Select
          label="Slide size"
          value={sizeId}
          options={[...SLIDE_SIZES.map((s) => ({ value: s.id, label: s.label })), ...(sizeId === 'custom' ? [{ value: 'custom', label: `Custom (${deck.size.w} × ${deck.size.h})` }] : [])]}
          onChange={(id) => {
            const s = SLIDE_SIZES.find((x) => x.id === id);
            if (s) store.setSize(portrait ? { w: s.size.h, h: s.size.w } : s.size);
          }}
        />
        <div className="text-[12px] font-medium text-ink">Orientation</div>
        <div className="grid grid-cols-2 gap-2">
          {(['landscape', 'portrait'] as const).map((o) => (
            <button
              key={o}
              onClick={() => (o === 'portrait') !== portrait && store.setSize({ w: deck.size.h, h: deck.size.w })}
              className={cn('flex h-9 items-center justify-center gap-2 rounded-lg border text-[13px] capitalize', (o === 'portrait') === portrait ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-line text-ink-2 hover:bg-hover')}
            >
              <span className={cn('rounded-[2px] border-[1.5px] border-current', o === 'landscape' ? 'h-3 w-4' : 'h-4 w-3')} />
              {o}
            </button>
          ))}
        </div>
      </Section>

      <Section title="Slide numbers">
        <Toggle on={!!deck.numbers?.show} onChange={(v) => store.setNumbers(v ? { show: true, skipTitle: deck.numbers?.skipTitle ?? true } : null)} label="Show slide numbers" />
        {deck.numbers?.show && <Toggle on={deck.numbers.skipTitle !== false} onChange={(v) => store.setNumbers({ show: true, skipTitle: v })} label="Skip title slides" />}
      </Section>

      <Section title="Transition">
        <Row label="Effect">
          <Select<Transition>
            label="Transition"
            value={slide.meta.transition ?? 'none'}
            options={[
              { value: 'none', label: 'None' },
              { value: 'fade', label: 'Fade' },
              { value: 'push', label: 'Push' },
              { value: 'wipe', label: 'Wipe' },
            ]}
            onChange={(t) => store.setSlideMeta([slide.id], { transition: t })}
          />
        </Row>
        <div className="flex items-center justify-between">
          <Toggle on={!!slide.meta.hidden} onChange={(v) => store.setSlideMeta([slide.id], { hidden: v })} label="Hide slide when presenting" />
        </div>
        <Button size="sm" variant="soft" onClick={() => store.setSlideMeta(deck.slides.map((s) => s.id), { transition: slide.meta.transition ?? 'none' })}>
          Apply transition to all
        </Button>
      </Section>
    </fieldset>
  );
}

// ── Layout tab ───────────────────────────────────────────────────────────────

/** Thumbnail of a layout: its placeholders drawn with the deck's theme, prompts included. */
export function LayoutWire({ layout, deck }: { layout: LayoutId; deck?: { size: DeckSize; theme: Theme } }) {
  const d = deck ?? { size: DEFAULT_SIZE, theme: DEFAULT_THEME };
  const slide = useMemo(() => ({ id: `layout-${layout}`, meta: { layout }, notes: '', elements: layoutElements(layout, d.size, d.theme) }), [layout, d.size, d.theme]);
  return (
    <div className="overflow-hidden rounded-md border border-line bg-white">
      <SlideView slide={slide} deck={d} width={136} opts={LAYOUT_OPTS} />
    </div>
  );
}
const LAYOUT_OPTS = { prompts: true };

export function LayoutTab({ store, slide, editable, onNewSlide }: { store: DeckStore; slide: PlainSlide; editable: boolean; onNewSlide: (l: LayoutId) => void }) {
  return (
    <Section title="Slide layout">
      <p className="text-[12px] text-muted">Click a layout to apply it to the current slide. Text you typed is kept.</p>
      <div className="grid grid-cols-2 gap-2.5">
        {LAYOUTS.map((l) => (
          <div key={l.id} className="group">
            <button
              disabled={!editable}
              onClick={() => store.applyLayout(slide.id, l.id)}
              className={cn('w-full rounded-lg p-1 text-left hover:bg-hover disabled:opacity-50', slide.meta.layout === l.id && 'bg-brand-50 ring-2 ring-brand-600')}
              data-testid={`layout-${l.id}`}
            >
              <LayoutWire layout={l.id} />
              <div className="mt-1 flex items-center gap-1 text-[12px] text-ink-2">
                {slide.meta.layout === l.id && <Check size={12} className="text-brand-600" />}
                {l.label}
              </div>
            </button>
            {editable && (
              <button onClick={() => onNewSlide(l.id)} className="ml-1 text-[11px] text-brand-600 opacity-0 hover:underline group-hover:opacity-100">
                + New slide
              </button>
            )}
          </div>
        ))}
      </div>
    </Section>
  );
}

// ── Theme tab ────────────────────────────────────────────────────────────────

export function ThemeTab({ store, deck, editable }: { store: DeckStore; deck: DeckSnapshot; editable: boolean }) {
  const sample = deck.slides[0];
  return (
    <>
    <Section title="Themes">
      <p className="text-[12px] text-muted">A theme sets the colours and fonts of the whole presentation. Shapes using theme colours follow it.</p>
      <div className="grid grid-cols-2 gap-2.5">
        {(deck.theme.id === 'imported' || deck.theme.id === 'custom' ? [deck.theme, ...THEMES] : THEMES).map((t) => (
          <button
            key={t.id}
            disabled={!editable}
            onClick={() => store.setTheme(t)}
            className={cn('rounded-lg p-1 text-left hover:bg-hover disabled:opacity-60', deck.theme.id === t.id && 'bg-brand-50 ring-2 ring-brand-600')}
            data-testid={`theme-${t.id}`}
          >
            {sample ? (
              <SlideView slide={sample} deck={{ size: deck.size, theme: t }} width={128} className="rounded-md border border-line" />
            ) : (
              <div className="aspect-video rounded-md border border-line" style={{ background: t.colors.bg }} />
            )}
            <div className="mt-1 flex items-center gap-1">
              {t.colors.accents.slice(0, 4).map((c) => (
                <span key={c} className="size-2.5 rounded-full" style={{ background: c }} />
              ))}
              <span className="ml-1 truncate text-[12px] text-ink-2">{t.name}</span>
            </div>
          </button>
        ))}
      </div>
    </Section>
    <ThemeBuilder store={store} deck={deck} editable={editable} />
    </>
  );
}

/** Edit theme (Google Slides' theme builder, simplified): the deck's own colours and fonts. */
function ThemeBuilder({ store, deck, editable }: { store: DeckStore; deck: DeckSnapshot; editable: boolean }) {
  const t = deck.theme;
  const set = (patch: Partial<Theme['colors']> | { fonts: Theme['fonts'] }) =>
    store.setTheme({ ...t, id: 'custom', name: t.id === 'custom' ? t.name : `${t.name} (custom)`, ...('fonts' in patch ? { fonts: patch.fonts as Theme['fonts'] } : { colors: { ...t.colors, ...patch } }) });
  const swatch = (label: string, value: string, onChange: (v: string) => void) => (
    <label key={label} className="flex flex-col items-center gap-1 text-[11px] text-muted">
      <input type="color" value={value} disabled={!editable} onChange={(e) => onChange(e.target.value.toUpperCase())} className="size-8 cursor-pointer rounded-md border border-line bg-surface p-0.5" aria-label={label} />
      {label}
    </label>
  );
  return (
    <fieldset disabled={!editable}>
      <Section title="Customize theme">
        <p className="text-[12px] text-muted">Changes apply to every slide; shapes and text that use theme colours update too.</p>
        <div className="flex flex-wrap gap-2.5" data-testid="theme-colors">
          {swatch('Background', t.colors.bg, (v) => set({ bg: v }))}
          {swatch('Title', t.colors.title, (v) => set({ title: v }))}
          {swatch('Text', t.colors.text, (v) => set({ text: v }))}
          {swatch('Muted', t.colors.muted, (v) => set({ muted: v }))}
        </div>
        <div className="flex flex-wrap gap-2.5">
          {t.colors.accents.map((c, i) => swatch(`Accent ${i + 1}`, c, (v) => set({ accents: t.colors.accents.map((x, j) => (j === i ? v : x)) })))}
        </div>
        <Row label="Headings">
          <Select<string> label="Heading font" value={t.fonts.heading} options={FONTS.map((f) => ({ value: f, label: f }))} onChange={(f) => set({ fonts: { ...t.fonts, heading: f } })} />
        </Row>
        <Row label="Body">
          <Select<string> label="Body font" value={t.fonts.body} options={FONTS.map((f) => ({ value: f, label: f }))} onChange={(f) => set({ fonts: { ...t.fonts, body: f } })} />
        </Row>
      </Section>
    </fieldset>
  );
}

// ── Format tab (selected elements) ───────────────────────────────────────────

const CHART_KINDS: { kind: ChartSpec['kind']; label: string; icon: ReactNode }[] = [
  { kind: 'column', label: 'Column', icon: <ChartColumn size={16} /> },
  { kind: 'bar', label: 'Bar', icon: <ChartBar size={16} /> },
  { kind: 'line', label: 'Line', icon: <ChartLine size={16} /> },
  { kind: 'area', label: 'Area', icon: <ChartArea size={16} /> },
  { kind: 'pie', label: 'Pie', icon: <ChartPie size={16} /> },
  { kind: 'doughnut', label: 'Doughnut', icon: <CircleDot size={16} /> },
];

export function FormatTab({
  store,
  deck,
  slide,
  selected,
  editable,
  tableCell,
  onReplaceImage,
}: {
  store: DeckStore;
  deck: DeckSnapshot;
  slide: PlainSlide;
  selected: PlainElement[];
  editable: boolean;
  tableCell: { r: number; c: number } | null;
  onReplaceImage: (id: string) => void;
}) {
  if (!selected.length) {
    return <p className="p-4 text-[13px] text-muted">Select a text box, shape, picture, table or chart on the slide to format it.</p>;
  }
  const el = selected[0];
  const one = selected.length === 1;
  const upd = (patch: Parameters<DeckStore['updateElements']>[1][number]['patch']) => store.updateElements(slide.id, selected.map((s) => ({ id: s.id, patch })));
  const style = (patch: Partial<ElementStyle>) => upd({ style: patch });
  const ids = selected.map((s) => s.id);
  const S = el.style ?? {};
  const alignTo = (how: 'l' | 'c' | 'r' | 't' | 'm' | 'b') => {
    // One element: align to the slide. Several: align to their common bounds.
    const bx = one ? { x: 0, y: 0, w: deck.size.w, h: deck.size.h } : (() => {
      const x = Math.min(...selected.map((e) => e.x));
      const y = Math.min(...selected.map((e) => e.y));
      return { x, y, w: Math.max(...selected.map((e) => e.x + e.w)) - x, h: Math.max(...selected.map((e) => e.y + e.h)) - y };
    })();
    store.updateElements(
      slide.id,
      selected.map((e) => ({
        id: e.id,
        patch: how === 'l' ? { x: bx.x } : how === 'c' ? { x: bx.x + (bx.w - e.w) / 2 } : how === 'r' ? { x: bx.x + bx.w - e.w } : how === 't' ? { y: bx.y } : how === 'm' ? { y: bx.y + (bx.h - e.h) / 2 } : { y: bx.y + bx.h - e.h },
      })),
    );
  };
  const distribute = (axis: 'x' | 'y') => {
    if (selected.length < 3) return;
    const sorted = [...selected].sort((a, b) => a[axis] - b[axis]);
    const size = axis === 'x' ? 'w' : 'h';
    const first = sorted[0][axis];
    const last = sorted[sorted.length - 1][axis] + sorted[sorted.length - 1][size];
    const gap = (last - first - sorted.reduce((a, e) => a + e[size], 0)) / (sorted.length - 1);
    let pos = first;
    store.updateElements(
      slide.id,
      sorted.map((e) => {
        const patch = { [axis]: pos };
        pos += e[size] + gap;
        return { id: e.id, patch };
      }),
    );
  };
  const textual = selected.every((e) => e.type === 'text' || (e.type === 'shape' && !isOpenStroke(e)));
  const shapes = selected.every((e) => e.type === 'shape' || e.type === 'text');

  return (
    <fieldset disabled={!editable} className="min-w-0">
      {one && (
        <Section title="Position & size">
          <div className="grid grid-cols-2 gap-2">
            {(['x', 'y', 'w', 'h'] as const).map((k) => (
              <Row key={k} label={k === 'w' ? 'Width' : k === 'h' ? 'Height' : k.toUpperCase()}>
                <NumberField label={k} value={el[k]} min={k === 'w' || k === 'h' ? 1 : undefined} suffix="px" w={72} onCommit={(v) => upd({ [k]: v })} />
              </Row>
            ))}
          </div>
          <Row label="Rotation">
            <NumberField label="Rotation" value={el.rot ?? 0} min={-360} max={360} suffix="°" onCommit={(v) => upd({ rot: ((v % 360) + 360) % 360 || undefined })} />
            <IconBtn label="Flip horizontal" onClick={() => upd({ flipH: !el.flipH || undefined })} active={el.flipH}>
              <FlipHorizontal2 size={15} />
            </IconBtn>
            <IconBtn label="Flip vertical" onClick={() => upd({ flipV: !el.flipV || undefined })} active={el.flipV}>
              <FlipVertical2 size={15} />
            </IconBtn>
          </Row>
        </Section>
      )}

      <Section title={one ? 'Arrange' : `Arrange ${selected.length} objects`}>
        <div className="flex flex-wrap gap-1.5">
          <IconBtn label="Bring to front" onClick={() => store.arrange(slide.id, ids, 'front')}>
            <BringToFront size={15} />
          </IconBtn>
          <IconBtn label="Bring forward" onClick={() => store.arrange(slide.id, ids, 'forward')}>
            <ArrowUpToLine size={15} />
          </IconBtn>
          <IconBtn label="Send backward" onClick={() => store.arrange(slide.id, ids, 'backward')}>
            <ArrowDownToLine size={15} />
          </IconBtn>
          <IconBtn label="Send to back" onClick={() => store.arrange(slide.id, ids, 'back')}>
            <SendToBack size={15} />
          </IconBtn>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <IconBtn label={one ? 'Align left (slide)' : 'Align left'} onClick={() => alignTo('l')}>
            <AlignStartVertical size={15} />
          </IconBtn>
          <IconBtn label="Align centre" onClick={() => alignTo('c')}>
            <AlignCenterVertical size={15} />
          </IconBtn>
          <IconBtn label="Align right" onClick={() => alignTo('r')}>
            <AlignEndVertical size={15} />
          </IconBtn>
          <IconBtn label="Align top" onClick={() => alignTo('t')}>
            <AlignStartHorizontal size={15} />
          </IconBtn>
          <IconBtn label="Align middle" onClick={() => alignTo('m')}>
            <AlignCenterHorizontal size={15} />
          </IconBtn>
          <IconBtn label="Align bottom" onClick={() => alignTo('b')}>
            <AlignEndHorizontal size={15} />
          </IconBtn>
          <IconBtn label="Distribute horizontally" disabled={selected.length < 3} onClick={() => distribute('x')}>
            <AlignHorizontalDistributeCenter size={15} />
          </IconBtn>
          <IconBtn label="Distribute vertically" disabled={selected.length < 3} onClick={() => distribute('y')}>
            <AlignVerticalDistributeCenter size={15} />
          </IconBtn>
        </div>
      </Section>

      {shapes && (
        <Section title={el.type === 'text' && one ? 'Text box' : 'Shape'}>
          {one && el.type === 'shape' && el.geom !== 'freeform' && (
            <Row label="Shape">
              <Select<Geometry> label="Shape type" value={el.geom ?? 'rect'} options={[...SHAPES, ...EXTRA_SHAPES].map((s) => ({ value: s.geom, label: s.label }))} onChange={(g) => upd({ geom: g })} />
            </Row>
          )}
          {!(one && isOpenStroke(el)) && (
            <Row label="Fill">
              <ColorPicker label="Fill colour" allowNone value={S.fill} theme={deck.theme} onChange={(c) => (el.type === 'text' && c ? upd({ type: 'shape', geom: 'rect', style: { fill: c } }) : style({ fill: c ?? undefined }))} />
            </Row>
          )}
          {one && isLine(el.geom) && (
            <>
              <Row label="Connector">
                <Select<'straight' | 'elbow' | 'curved'>
                  label="Connector type"
                  value={el.conn?.kind ?? 'straight'}
                  options={[
                    { value: 'straight', label: 'Straight' },
                    { value: 'elbow', label: 'Elbow' },
                    { value: 'curved', label: 'Curved' },
                  ]}
                  onChange={(kind) => upd({ conn: { ...el.conn, kind } })}
                />
              </Row>
              <Toggle on={el.geom === 'arrow'} onChange={(v) => upd({ geom: v ? 'arrow' : 'line' })} label="Arrowhead at the end" />
              {(el.conn?.from || el.conn?.to) && <p className="text-[12px] text-muted">Attached to {[el.conn?.from, el.conn?.to].filter(Boolean).length === 2 ? 'two shapes' : 'a shape'}: it follows them when they move. Drag an end away to detach it.</p>}
            </>
          )}
          {textual && !(one && isOpenStroke(el)) && (
            <Row label="Text outline">
              <ColorPicker label="Text outline colour" allowNone value={S.outline} theme={deck.theme} onChange={(c) => style({ outline: c ?? undefined, outlineWidth: c ? S.outlineWidth ?? 2 : undefined })} />
              {S.outline && <NumberField label="Text outline width" value={S.outlineWidth ?? 2} min={0.5} max={12} step={0.5} suffix="px" w={60} onCommit={(v) => style({ outlineWidth: v })} />}
            </Row>
          )}
          <Row label={one && isOpenStroke(el) ? 'Line' : 'Border'}>
            <ColorPicker label="Border colour" allowNone value={S.stroke} theme={deck.theme} onChange={(c) => (el.type === 'text' && c ? upd({ type: 'shape', geom: 'rect', style: { stroke: c, strokeWidth: S.strokeWidth || 2 } }) : style({ stroke: c ?? undefined, strokeWidth: c ? S.strokeWidth || 2 : undefined }))} />
            <NumberField label="Border width" value={S.strokeWidth ?? (one && isOpenStroke(el) ? 3 : 0)} min={0} max={40} suffix="px" w={60} onCommit={(v) => style({ strokeWidth: v })} />
          </Row>
          <Row label="Dash">
            <Select<'solid' | 'dash' | 'dot'>
              label="Dash"
              value={S.dash ?? 'solid'}
              options={[
                { value: 'solid', label: 'Solid' },
                { value: 'dash', label: 'Dashed' },
                { value: 'dot', label: 'Dotted' },
              ]}
              onChange={(d) => style({ dash: d === 'solid' ? undefined : d })}
            />
          </Row>
          {one && el.geom === 'roundRect' && (
            <Row label="Corners">
              <NumberField label="Corner radius" value={S.radius ?? 16} min={0} max={400} suffix="px" onCommit={(v) => style({ radius: v })} />
            </Row>
          )}
          <Row label="Opacity">
            <input type="range" min={10} max={100} value={Math.round((S.opacity ?? 1) * 100)} onChange={(e) => style({ opacity: Number(e.target.value) >= 100 ? undefined : Number(e.target.value) / 100 })} className="flex-1 accent-brand-600" aria-label="Opacity" />
            <span className="w-9 text-right">{Math.round((S.opacity ?? 1) * 100)}%</span>
          </Row>
          <Toggle on={!!S.shadow} onChange={(v) => style({ shadow: v || undefined })} label="Shadow" />
        </Section>
      )}
      {one && (el.type === 'video' || el.type === 'audio') && (
        <Section title={el.type === 'video' ? 'Video playback' : 'Audio playback'}>
          <p className="truncate text-[12px] text-muted" title={el.src}>
            {el.alt || el.src}
          </p>
          <p className="text-[12px] text-muted">Double-click the {el.type} on the slide to play it here; it plays in the slide show too.</p>
          <div className="flex items-center gap-2 text-[12px] text-muted" data-testid="media-options">
            Start at
            <NumberField label="Start at (seconds)" value={el.media?.start ?? 0} min={0} step={1} suffix="s" w={72} onCommit={(v) => upd({ media: { ...el.media, start: v || undefined } })} />
            End at
            <NumberField label="End at (seconds)" value={el.media?.end} min={0} step={1} suffix="s" w={72} onCommit={(v) => upd({ media: { ...el.media, end: v || undefined } })} />
          </div>
          <Toggle on={!!el.media?.autoplay} onChange={(v) => upd({ media: { ...el.media, autoplay: v || undefined } })} label="Play automatically when presenting" />
          {el.type === 'video' && <Toggle on={!!el.media?.muted} onChange={(v) => upd({ media: { ...el.media, muted: v || undefined } })} label="Mute" />}
          <Toggle on={!!el.media?.loop} onChange={(v) => upd({ media: { ...el.media, loop: v || undefined } })} label="Loop" />
        </Section>
      )}
      {one && el.type === 'image' && (
        <Section
          title="Crop"
          action={
            el.crop ? (
              <button className="text-[12px] text-brand-700 hover:underline" onClick={() => store.setCrop(slide.id, el.id, null)}>
                Reset crop
              </button>
            ) : undefined
          }
        >
          <div className="grid grid-cols-2 gap-2" data-testid="crop-fields">
            {(
              [
                ['l', 'Left'],
                ['r', 'Right'],
                ['t', 'Top'],
                ['b', 'Bottom'],
              ] as const
            ).map(([k, label]) => (
              <label key={k} className="flex items-center gap-1.5 text-[12px] text-muted">
                <span className="w-12">{label}</span>
                <NumberField
                  label={`Crop ${label.toLowerCase()}`}
                  value={Math.round((el.crop?.[k] ?? 0) * 1000) / 10}
                  min={0}
                  max={90}
                  step={1}
                  suffix="%"
                  onCommit={(v) => store.setCrop(slide.id, el.id, { l: 0, t: 0, r: 0, b: 0, ...el.crop, [k]: v / 100 })}
                />
              </label>
            ))}
          </div>
        </Section>
      )}
      {one && el.type === 'image' && (
        <Section
          title="Adjustments"
          action={
            S.brightness || S.contrast || S.recolor ? (
              <button className="text-[12px] text-brand-700 hover:underline" onClick={() => style({ brightness: undefined, contrast: undefined, recolor: undefined })}>
                Reset
              </button>
            ) : undefined
          }
        >
          <Row label="Brightness">
            <input type="range" min={-100} max={100} value={S.brightness ?? 0} onChange={(e) => style({ brightness: Number(e.target.value) || undefined })} className="flex-1 accent-brand-600" aria-label="Picture brightness" />
          </Row>
          <Row label="Contrast">
            <input type="range" min={-100} max={100} value={S.contrast ?? 0} onChange={(e) => style({ contrast: Number(e.target.value) || undefined })} className="flex-1 accent-brand-600" aria-label="Picture contrast" />
          </Row>
          <Row label="Recolor">
            <Select<'none' | 'grayscale' | 'sepia' | 'washout'>
              label="Recolor"
              value={S.recolor ?? 'none'}
              options={[
                { value: 'none', label: 'No recolor' },
                { value: 'grayscale', label: 'Grayscale' },
                { value: 'sepia', label: 'Sepia' },
                { value: 'washout', label: 'Washout' },
              ]}
              onChange={(v) => style({ recolor: v === 'none' ? undefined : v })}
            />
          </Row>
        </Section>
      )}

      {textual && (
        <Section title="Text options">
          <Row label="Vertical">
            <Select<'top' | 'middle' | 'bottom'>
              label="Vertical alignment"
              value={S.vAlign ?? 'top'}
              options={[
                { value: 'top', label: 'Top' },
                { value: 'middle', label: 'Middle' },
                { value: 'bottom', label: 'Bottom' },
              ]}
              onChange={(v) => style({ vAlign: v })}
            />
          </Row>
          <Row label="Line spacing">
            <Select
              label="Line spacing"
              value={String(S.lineHeight ?? 1.2)}
              options={['1', '1.15', '1.2', '1.3', '1.5', '2'].map((v) => ({ value: v, label: v }))}
              onChange={(v) => style({ lineHeight: Number(v) })}
            />
          </Row>
          <Row label="Padding">
            <NumberField label="Padding" value={S.pad ?? 10} min={0} max={120} suffix="px" onCommit={(v) => style({ pad: v })} />
          </Row>
        </Section>
      )}

      {one && el.type === 'image' && (
        <Section title="Picture">
          <div className="flex flex-wrap gap-2">
            <Button size="sm" icon={<ImagePlus size={14} />} onClick={() => onReplaceImage(el.id)}>
              Replace picture
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                const img = new Image();
                img.onload = () => upd({ h: Math.round((el.w * img.naturalHeight) / img.naturalWidth) });
                img.src = el.src!;
              }}
            >
              Reset aspect ratio
            </Button>
          </div>
          <Row label="Alt text">
            <input defaultValue={el.alt ?? ''} onBlur={(e) => upd({ alt: e.target.value || undefined })} className="input h-8 text-[13px]" placeholder="Describe the picture" aria-label="Alt text" />
          </Row>
          <Row label="Corners">
            <NumberField label="Picture corner radius" value={S.radius ?? 0} min={0} max={400} suffix="px" onCommit={(v) => style({ radius: v || undefined })} />
          </Row>
          <Row label="Opacity">
            <input type="range" min={10} max={100} value={Math.round((S.opacity ?? 1) * 100)} onChange={(e) => style({ opacity: Number(e.target.value) >= 100 ? undefined : Number(e.target.value) / 100 })} className="flex-1 accent-brand-600" aria-label="Picture opacity" />
          </Row>
          <Toggle on={!!S.shadow} onChange={(v) => style({ shadow: v || undefined })} label="Shadow" />
        </Section>
      )}

      {one && el.type === 'table' && el.table && <TableSection store={store} slideId={slide.id} el={el} theme={deck.theme} cell={tableCell} />}
      {one && el.type === 'chart' && el.chart && <ChartSection chart={el.chart} theme={deck.theme} onChange={(chart) => upd({ chart })} />}

      <Section title="">
        <Button size="sm" variant="ghost" icon={<Trash2 size={14} />} className="text-red-600" onClick={() => store.deleteElements(slide.id, ids)}>
          Delete {one ? 'object' : `${selected.length} objects`}
        </Button>
      </Section>
    </fieldset>
  );
}

function TableSection({ store, slideId, el, theme, cell }: { store: DeckStore; slideId: string; el: PlainElement; theme: Theme; cell: { r: number; c: number } | null }) {
  const t = el.table!;
  const r = cell?.r ?? t.rows.length - 1;
  const c = cell?.c ?? (t.rows[0]?.length ?? 1) - 1;
  const op = (o: Parameters<DeckStore['tableStructure']>[2]) => store.tableStructure(slideId, el.id, o, r, c);
  return (
    <Section title="Table">
      <p className="text-[12px] text-muted">Double-click the table to type in its cells. {cell ? `Cell: row ${r + 1}, column ${c + 1}.` : 'Rows / columns are added at the end.'}</p>
      <div className="grid grid-cols-2 gap-1.5">
        <Button size="sm" variant="soft" icon={<Plus size={13} />} onClick={() => op('rowAbove')}>
          Row above
        </Button>
        <Button size="sm" variant="soft" icon={<Plus size={13} />} onClick={() => op('rowBelow')}>
          Row below
        </Button>
        <Button size="sm" variant="soft" icon={<Plus size={13} />} onClick={() => op('colLeft')}>
          Column left
        </Button>
        <Button size="sm" variant="soft" icon={<Plus size={13} />} onClick={() => op('colRight')}>
          Column right
        </Button>
        <Button size="sm" variant="ghost" icon={<Minus size={13} />} disabled={t.rows.length < 2} onClick={() => op('delRow')}>
          Delete row
        </Button>
        <Button size="sm" variant="ghost" icon={<Minus size={13} />} disabled={(t.rows[0]?.length ?? 0) < 2} onClick={() => op('delCol')}>
          Delete column
        </Button>
      </div>
      <Toggle on={t.header !== false} onChange={(v) => store.setTableSpec(slideId, el.id, { header: v })} label="Header row" />
      <Toggle on={t.banded !== false} onChange={(v) => store.setTableSpec(slideId, el.id, { banded: v })} label="Banded rows" />
      <Row label="Header colour">
        <ColorPicker label="Header colour" value={t.headerFill ?? '@accent1'} theme={theme} onChange={(col) => store.setTableSpec(slideId, el.id, { headerFill: col ?? undefined })} />
      </Row>
      <Row label="Font size">
        <NumberField label="Table font size" value={t.fontSize ?? 14} min={6} max={72} suffix="pt" onCommit={(v) => store.setTableSpec(slideId, el.id, { fontSize: v })} />
      </Row>
    </Section>
  );
}

/** Chart editor: type, labels, data grid, and an optional live link to a range in a Master Office spreadsheet. */
function ChartSection({ chart, theme, onChange }: { chart: ChartSpec; theme: Theme; onChange: (c: ChartSpec) => void }) {
  const pie = chart.kind === 'pie' || chart.kind === 'doughnut';
  const setCell = (r: number, s: number, v: string) => {
    const series = chart.series.map((x, i) => (i === s ? { ...x, values: chart.categories.map((_, j) => (j === r ? Number(v) || 0 : Number(x.values[j]) || 0)) } : x));
    onChange({ ...chart, series });
  };
  const [linking, setLinking] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const refresh = async (src: NonNullable<ChartSpec['source']>) => {
    setRefreshing(true);
    try {
      const data = await api<{ name: string; sheet: string; values: (string | number | boolean | null)[][] }>(`/resources/${src.resourceId}/sheet-range?range=${encodeURIComponent(src.range)}${src.sheet ? `&sheet=${encodeURIComponent(src.sheet)}` : ''}`);
      const next = chartFromRange(data.values);
      if (!next) throw new Error('The range needs a header row and at least one numeric column');
      onChange({ ...chart, ...next, source: { ...src, name: data.name, sheet: data.sheet } });
      toast.success('Chart data updated from Sheets');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setRefreshing(false);
    }
  };
  return (
    <Section title="Chart">
      <div className="grid grid-cols-3 gap-1.5">
        {CHART_KINDS.map((k) => (
          <button key={k.kind} onClick={() => onChange({ ...chart, kind: k.kind })} className={cn('flex h-9 items-center justify-center gap-1.5 rounded-lg border text-[12px]', chart.kind === k.kind ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-line text-ink-2 hover:bg-hover')}>
            {k.icon}
            {k.label}
          </button>
        ))}
      </div>
      <Row label="Title">
        <input defaultValue={chart.title ?? ''} key={chart.title} onBlur={(e) => onChange({ ...chart, title: e.target.value || undefined })} className="input h-8 text-[13px]" placeholder="Chart title" aria-label="Chart title" />
      </Row>
      <div className="flex gap-4">
        <Toggle on={chart.legend ?? (pie || chart.series.length > 1)} onChange={(v) => onChange({ ...chart, legend: v })} label="Legend" />
        <Toggle on={chart.labels ?? pie} onChange={(v) => onChange({ ...chart, labels: v })} label="Data labels" />
      </div>

      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="w-full text-[12px]" data-testid="chart-data">
          <thead>
            <tr className="bg-canvas">
              <th className="w-24 border-b border-r border-line px-1.5 py-1 text-left font-medium text-muted">Category</th>
              {(pie ? chart.series.slice(0, 1) : chart.series).map((s, i) => (
                <th key={i} className="border-b border-r border-line p-0">
                  <div className="flex items-center gap-1 px-1">
                    {!pie && (
                      <ColorPicker label={`Colour of ${s.name}`} value={s.color ?? `@accent${(i % 6) + 1}`} theme={theme} onChange={(c) => onChange({ ...chart, series: chart.series.map((x, j) => (j === i ? { ...x, color: c ?? undefined } : x)) })}>
                        <button className="size-3.5 shrink-0 rounded-sm border border-black/10" style={{ background: themeColor(s.color ?? `@accent${(i % 6) + 1}`, theme)! }} aria-label={`Colour of ${s.name}`} />
                      </ColorPicker>
                    )}
                    <input defaultValue={s.name} key={s.name} onBlur={(e) => onChange({ ...chart, series: chart.series.map((x, j) => (j === i ? { ...x, name: e.target.value || x.name } : x)) })} className="h-6 w-full min-w-12 bg-transparent font-medium outline-none" aria-label={`Series ${i + 1} name`} />
                    {chart.series.length > 1 && !pie && (
                      <button onClick={() => onChange({ ...chart, series: chart.series.filter((_, j) => j !== i) })} className="text-subtle hover:text-red-600" aria-label={`Remove series ${s.name}`}>
                        <Minus size={12} />
                      </button>
                    )}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {chart.categories.map((c, r) => (
              <tr key={r}>
                <td className="border-b border-r border-line p-0">
                  <div className="flex items-center">
                    <input defaultValue={c} key={`${r}-${c}`} onBlur={(e) => onChange({ ...chart, categories: chart.categories.map((x, j) => (j === r ? e.target.value : x)) })} className="h-7 w-full bg-transparent px-1.5 outline-none" aria-label={`Category ${r + 1}`} />
                    {chart.categories.length > 1 && (
                      <button onClick={() => onChange({ ...chart, categories: chart.categories.filter((_, j) => j !== r), series: chart.series.map((s) => ({ ...s, values: s.values.filter((_, j) => j !== r) })) })} className="px-1 text-subtle hover:text-red-600" aria-label={`Remove ${c}`}>
                        <Minus size={12} />
                      </button>
                    )}
                  </div>
                </td>
                {(pie ? chart.series.slice(0, 1) : chart.series).map((s, i) => (
                  <td key={i} className="border-b border-r border-line p-0">
                    <input type="number" defaultValue={s.values[r] ?? 0} key={`${r}-${i}-${s.values[r]}`} onBlur={(e) => setCell(r, i, e.target.value)} className="h-7 w-full bg-transparent px-1.5 text-right outline-none" aria-label={`${s.name} ${c}`} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex gap-1.5">
        <Button size="sm" variant="soft" icon={<Plus size={13} />} onClick={() => onChange({ ...chart, categories: [...chart.categories, `Item ${chart.categories.length + 1}`], series: chart.series.map((s) => ({ ...s, values: [...s.values, 0] })) })}>
          Category
        </Button>
        {!pie && (
          <Button size="sm" variant="soft" icon={<Plus size={13} />} onClick={() => onChange({ ...chart, series: [...chart.series, { name: `Series ${chart.series.length + 1}`, values: chart.categories.map(() => 0) }] })}>
            Series
          </Button>
        )}
      </div>

      <div className="rounded-lg bg-canvas p-2.5 text-[12px]">
        {chart.source ? (
          <>
            <div className="mb-2 flex items-center gap-1.5 text-ink-2">
              <Link2 size={13} className="text-emerald-600" /> Linked to <b className="truncate">{chart.source.name ?? 'spreadsheet'}</b> · {chart.source.sheet ? `${chart.source.sheet}!` : ''}
              {chart.source.range}
            </div>
            <div className="flex gap-1.5">
              <Button size="sm" variant="soft" icon={<RefreshCw size={13} />} loading={refreshing} onClick={() => refresh(chart.source!)}>
                Refresh from Sheets
              </Button>
              <Button size="sm" variant="ghost" icon={<Unlink size={13} />} onClick={() => onChange({ ...chart, source: null })}>
                Unlink
              </Button>
            </div>
          </>
        ) : linking ? (
          <LinkSheet onCancel={() => setLinking(false)} onLink={(src) => (setLinking(false), refresh(src))} />
        ) : (
          <Button size="sm" variant="soft" icon={<Link2 size={13} />} onClick={() => setLinking(true)}>
            Use data from Sheets…
          </Button>
        )}
      </div>
    </Section>
  );
}

/** First row = series names, first column = categories, the rest numbers. */
export function chartFromRange(values: (string | number | boolean | null)[][]): Pick<ChartSpec, 'categories' | 'series'> | null {
  if (values.length < 2 || (values[0]?.length ?? 0) < 2) return null;
  const head = values[0];
  const rows = values.slice(1).filter((r) => r.some((v) => v !== null && v !== ''));
  const series = head.slice(1).map((name, i) => ({ name: String(name ?? `Series ${i + 1}`), values: rows.map((r) => Number(r[i + 1]) || 0) }));
  return { categories: rows.map((r) => String(r[0] ?? '')), series };
}

export function LinkSheet({ onLink, onCancel }: { onLink: (s: NonNullable<ChartSpec['source']>) => void; onCancel: () => void }) {
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<{ id: string; name: string } | null>(null);
  const [range, setRange] = useState('A1:D5');
  const [sheet, setSheet] = useState('');
  const { data } = useSearch(q.length >= 1 ? q : '');
  const sheets = (data ?? []).filter((h) => h.kind === 'resource' && h.type === 'spreadsheet').slice(0, 6);
  return (
    <div className="space-y-2">
      {picked ? (
        <div className="flex items-center gap-1.5 text-ink-2">
          <ChartColumn size={13} className="text-emerald-600" /> <b className="truncate">{picked.name}</b>
          <button onClick={() => setPicked(null)} className="ml-auto text-brand-600 hover:underline">
            change
          </button>
        </div>
      ) : (
        <>
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} className="input h-8 text-[13px]" placeholder="Search spreadsheets…" aria-label="Search spreadsheets" />
          <div className="space-y-0.5">
            {sheets.map((h) => (
              <button key={h.id} onClick={() => setPicked({ id: h.id, name: h.title })} className="block w-full truncate rounded px-1.5 py-1 text-left hover:bg-hover">
                {h.title}
              </button>
            ))}
          </div>
        </>
      )}
      <div className="flex gap-1.5">
        <input value={sheet} onChange={(e) => setSheet(e.target.value)} className="input h-8 w-24 text-[13px]" placeholder="Sheet (opt.)" aria-label="Sheet name" />
        <input value={range} onChange={(e) => setRange(e.target.value.toUpperCase())} className="input h-8 flex-1 text-[13px]" placeholder="A1:D5" aria-label="Range" />
      </div>
      <div className="flex gap-1.5">
        <Button size="sm" variant="primary" disabled={!picked || !/^[A-Z]+\d+:[A-Z]+\d+$/.test(range)} onClick={() => picked && onLink({ resourceId: picked.id, name: picked.name, range, sheet: sheet || undefined })}>
          Link
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
