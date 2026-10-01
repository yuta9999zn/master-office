'use client';

import type { UserSummary } from '@workos/shared';
import { clsx, type ClassValue } from 'clsx';
import { Loader2, X } from 'lucide-react';
import { Dialog as D, DropdownMenu as DM, Tooltip as T } from 'radix-ui';
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import type { AppDef } from '@/lib/apps';
import { initials } from '@/lib/format';
import { typeMeta } from '@/lib/resources';

export const cn = (...c: ClassValue[]) => clsx(c);

// ── Brand ────────────────────────────────────────────────────────────────────

/** The Master Office "M" ribbon mark (vector redraw of logo.png). */
export function LogoMark({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={className} aria-hidden>
      <defs>
        <linearGradient id="mo-a" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#3b82f6" />
          <stop offset="1" stopColor="#2563eb" />
        </linearGradient>
        <linearGradient id="mo-b" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#60a5fa" />
          <stop offset="1" stopColor="#8b5cf6" />
        </linearGradient>
        <linearGradient id="mo-c" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#6366f1" />
          <stop offset="1" stopColor="#8b5cf6" />
        </linearGradient>
      </defs>
      <path d="M6 50V22c0-8 6-13 12.5-13 4.6 0 8.2 2.3 10.3 6.2L40 36l-8 14L20 27v23a7 7 0 0 1-14 0Z" fill="url(#mo-a)" />
      <path d="M32 50 45.2 15.2C47.2 11.4 50.8 9 55 9c1 0 2 .1 3 .4V22L44 50a7 7 0 0 1-12 0Z" fill="url(#mo-b)" opacity=".95" />
      <path d="M44 22c0-7 5-13 12-13a8 8 0 0 1 2 .3V50a7 7 0 0 1-14 0V22Z" fill="url(#mo-c)" />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn('flex items-center gap-2', className)}>
      <LogoMark size={28} />
      <span className="text-[17px] font-bold tracking-tight text-ink">
        Master <span className="font-medium">Office</span>
      </span>
    </span>
  );
}

// ── Icons ────────────────────────────────────────────────────────────────────

export function AppIcon({ app, size = 32, className }: { app: Pick<AppDef, 'icon' | 'from' | 'to' | 'id'>; size?: number; className?: string }) {
  const Icon = app.icon;
  const light = app.id === 'more';
  return (
    <span
      className={cn('inline-flex shrink-0 items-center justify-center shadow-[inset_0_-1px_0_rgb(0_0_0/0.08)]', className)}
      style={{ width: size, height: size, borderRadius: size * 0.3, background: `linear-gradient(145deg, ${app.from}, ${app.to})` }}
    >
      <Icon size={size * 0.56} strokeWidth={2.2} color={light ? '#2563eb' : '#fff'} />
    </span>
  );
}

export function FileIcon({ r, size = 20, className }: { r: Parameters<typeof typeMeta>[0]; size?: number; className?: string }) {
  const m = typeMeta(r);
  const Icon = m.icon;
  if (r.type === 'folder') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" className={cn('shrink-0', className)} aria-hidden>
        <path d="M2 6.5A2.5 2.5 0 0 1 4.5 4h4.3c.7 0 1.3.3 1.8.8L12 6.2h7.5A2.5 2.5 0 0 1 22 8.7v8.8a2.5 2.5 0 0 1-2.5 2.5h-15A2.5 2.5 0 0 1 2 17.5v-11Z" fill="#f5b83d" />
        <path d="M2 9.5A1.5 1.5 0 0 1 3.5 8h17A1.5 1.5 0 0 1 22 9.5v8a2.5 2.5 0 0 1-2.5 2.5h-15A2.5 2.5 0 0 1 2 17.5v-8Z" fill="#fcc94f" />
      </svg>
    );
  }
  return (
    <span className={cn('inline-flex shrink-0 items-center justify-center rounded-[5px]', className)} style={{ width: size, height: size, background: m.color }}>
      <Icon size={size * 0.62} color="#fff" strokeWidth={2.4} />
    </span>
  );
}

// ── People ───────────────────────────────────────────────────────────────────

export function Avatar({ user, size = 28, ring, className }: { user: Pick<UserSummary, 'name' | 'avatarColor'>; size?: number; ring?: boolean; className?: string }) {
  return (
    <span
      title={user.name}
      className={cn('inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold text-white', ring && 'ring-2 ring-white', className)}
      style={{ width: size, height: size, fontSize: size * 0.38, background: `linear-gradient(145deg, ${user.avatarColor}cc, ${user.avatarColor})` }}
    >
      {initials(user.name)}
    </span>
  );
}

export function AvatarStack({ users, max = 3, size = 28, total }: { users: Pick<UserSummary, 'id' | 'name' | 'avatarColor'>[]; max?: number; size?: number; total?: number }) {
  const extra = (total ?? users.length) - Math.min(users.length, max);
  return (
    <span className="flex items-center">
      {users.slice(0, max).map((u, i) => (
        <Avatar key={u.id} user={u} size={size} ring className={i ? '-ml-2' : ''} />
      ))}
      {extra > 0 && (
        <span className="-ml-2 inline-flex items-center justify-center rounded-full bg-hover text-[11px] font-semibold text-muted ring-2 ring-white" style={{ width: size, height: size }}>
          +{extra}
        </span>
      )}
    </span>
  );
}

// ── Controls ─────────────────────────────────────────────────────────────────

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'soft';
export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md'; loading?: boolean; icon?: ReactNode }>(
  function Button({ variant = 'secondary', size = 'md', loading, icon, className, children, disabled, ...rest }, ref) {
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={cn(
          'inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-brand-100 disabled:pointer-events-none disabled:opacity-50',
          size === 'sm' ? 'h-8 px-2.5 text-[13px]' : 'h-9 px-3.5 text-[13px]',
          variant === 'primary' && 'bg-brand-600 text-white shadow-sm hover:bg-brand-700',
          variant === 'secondary' && 'border border-line-strong bg-surface text-ink-2 hover:bg-hover',
          variant === 'ghost' && 'text-ink-2 hover:bg-hover',
          variant === 'soft' && 'bg-brand-50 text-brand-600 hover:bg-brand-100',
          variant === 'danger' && 'bg-red-600 text-white hover:bg-red-700',
          className,
        )}
        {...rest}
      >
        {loading ? <Loader2 size={15} className="animate-spin" /> : icon}
        {children}
      </button>
    );
  },
);

export const IconButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean; size?: number }>(
  function IconButton({ label, active, className, size = 32, children, ...rest }, ref) {
    return (
      <Tip label={label}>
        <button
          ref={ref}
          aria-label={label}
          className={cn(
            'inline-flex shrink-0 items-center justify-center rounded-lg text-muted transition-colors outline-none hover:bg-hover hover:text-ink focus-visible:ring-3 focus-visible:ring-brand-100 disabled:opacity-40',
            active && 'bg-selected text-brand-600 hover:bg-selected hover:text-brand-600',
            className,
          )}
          style={{ width: size, height: size }}
          {...rest}
        >
          {children}
        </button>
      </Tip>
    );
  },
);

export function Tip({ label, children, side = 'bottom' }: { label: ReactNode; children: ReactNode; side?: 'top' | 'bottom' | 'left' | 'right' }) {
  return (
    <T.Root delayDuration={400}>
      <T.Trigger asChild>{children}</T.Trigger>
      <T.Portal>
        <T.Content side={side} sideOffset={6} className="z-50 rounded-md bg-ink px-2 py-1 text-[12px] text-white shadow-lg animate-pop">
          {label}
        </T.Content>
      </T.Portal>
    </T.Root>
  );
}

// ── Menus ────────────────────────────────────────────────────────────────────

export const Menu = DM.Root;
export const MenuTrigger = DM.Trigger;
export function MenuContent({ children, align = 'start', className, ...rest }: DM.DropdownMenuContentProps) {
  return (
    <DM.Portal>
      <DM.Content align={align} sideOffset={6} className={cn('pop z-50 min-w-[200px] animate-pop', className)} {...rest}>
        {children}
      </DM.Content>
    </DM.Portal>
  );
}
export function MenuItem({ icon, children, danger, shortcut, ...rest }: DM.DropdownMenuItemProps & { icon?: ReactNode; danger?: boolean; shortcut?: string }) {
  return (
    <DM.Item className={cn('menu-item', danger && 'text-red-600 data-[highlighted]:bg-red-50')} {...rest}>
      {icon && <span className="flex w-4 justify-center text-muted [&>svg]:size-4">{icon}</span>}
      <span className="flex-1">{children}</span>
      {shortcut && <span className="text-[11px] text-subtle">{shortcut}</span>}
    </DM.Item>
  );
}
export const MenuSeparator = () => <DM.Separator className="my-1 h-px bg-line" />;
export const MenuLabel = ({ children }: { children: ReactNode }) => <DM.Label className="px-2.5 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-subtle">{children}</DM.Label>;

// ── Dialog ───────────────────────────────────────────────────────────────────

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  width = 440,
  footer,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  width?: number;
  footer?: ReactNode;
}) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-40 bg-ink/25 backdrop-blur-[1px]" />
        <D.Content
          onOpenAutoFocus={(e) => {
            // Focus the first field (not the close button) so dialogs can be typed into immediately.
            const field = (e.target as HTMLElement | null)?.querySelector<HTMLElement>('input:not([type=hidden]), textarea, select');
            if (field) {
              e.preventDefault();
              field.focus();
            }
          }}
          className="fixed left-1/2 top-[14vh] z-50 max-h-[76vh] w-[calc(100vw-32px)] -translate-x-1/2 overflow-auto rounded-2xl border border-line bg-surface shadow-[var(--shadow-pop)] outline-none animate-pop"
          style={{ maxWidth: width }}
        >
          <div className="flex items-start justify-between gap-4 px-5 pb-3 pt-4">
            <div>
              <D.Title className="text-[15px] font-semibold text-ink">{title}</D.Title>
              {description ? <D.Description className="mt-0.5 text-[13px] text-muted">{description}</D.Description> : <D.Description className="sr-only">{String(title)}</D.Description>}
            </div>
            <D.Close className="rounded-md p-1 text-muted hover:bg-hover" aria-label="Close">
              <X size={16} />
            </D.Close>
          </div>
          {children && <div className="px-5 pb-4">{children}</div>}
          {footer && <div className="flex justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

// ── Misc ─────────────────────────────────────────────────────────────────────

export function EmptyState({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      {icon && <div className="mb-3 text-subtle">{icon}</div>}
      <div className="text-[14px] font-semibold text-ink">{title}</div>
      {children && <div className="mt-1 max-w-sm text-[13px] text-muted">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Chip({ children, color = '#2563eb', onRemove }: { children: ReactNode; color?: string; onRemove?: () => void }) {
  return (
    <span className="inline-flex h-6 items-center gap-1 rounded-full px-2.5 text-[12px] font-medium" style={{ background: `${color}14`, color }}>
      {children}
      {onRemove && (
        <button onClick={onRemove} className="-mr-1 rounded-full p-0.5 hover:bg-black/5" aria-label="Remove">
          <X size={11} />
        </button>
      )}
    </span>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-md bg-hover', className)} />;
}

export function CardHeader({ title, icon, action }: { title: ReactNode; icon?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex h-12 items-center justify-between gap-2 px-4">
      <div className="flex items-center gap-2 text-[15px] font-semibold text-ink">
        {icon}
        {title}
      </div>
      {action}
    </div>
  );
}
