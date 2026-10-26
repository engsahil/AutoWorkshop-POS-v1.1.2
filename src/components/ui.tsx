import {
  useCallback, useEffect, useId, useRef, useState,
  type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes
} from 'react';
import { createPortal } from 'react-dom';
import {
  AlertTriangle, Calendar, CheckCircle2, ChevronLeft, ChevronRight, Inbox, Loader2, Search, X
} from 'lucide-react';
import { formatMoney, formatMoneyCompact, todayISO } from '../lib/money';
import { useApp } from '../state/AppContext';

/* --------------------------------- Button --------------------------------- */
type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success' | 'outline';
interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  loading?: boolean;
  icon?: ReactNode;
  block?: boolean;
}
export function Button({ variant = 'secondary', size = 'md', loading, icon, block, children, className = '', disabled, ...rest }: ButtonProps) {
  const cls = [
    'btn', `btn-${variant}`,
    size === 'sm' ? 'btn-sm' : size === 'xs' ? 'btn-xs' : size === 'lg' ? 'btn-lg' : '',
    block ? 'btn-block' : '', className
  ].filter(Boolean).join(' ');
  return (
    <button className={cls} disabled={disabled || loading} {...rest}>
      {loading ? <Loader2 size={15} className="spin" style={{ animation: 'spin .8s linear infinite' }} /> : icon}
      {children}
    </button>
  );
}

export function IconButton({ label, children, className = '', ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button className={`icon-btn ${className}`} aria-label={label} title={label} {...rest}>
      {children}
    </button>
  );
}

/* ---------------------------------- Card ---------------------------------- */
export function Card({ children, className = '', ...rest }: { children: ReactNode; className?: string } & React.HTMLAttributes<HTMLDivElement>) {
  return <div className={`card ${className}`} {...rest}>{children}</div>;
}

export function CardHeader({ title, sub, right, icon }: { title: ReactNode; sub?: ReactNode; right?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="card-header">
      <div className="flex items-center gap-8">
        {icon}
        <div>
          <h3>{title}</h3>
          {sub && <div className="sub">{sub}</div>}
        </div>
      </div>
      {right}
    </div>
  );
}

/* --------------------------------- Fields --------------------------------- */
export function Field({ label, required, error, hint, children, className = '', htmlFor }: {
  label?: ReactNode; required?: boolean; error?: string | null; hint?: ReactNode; children: ReactNode; className?: string; htmlFor?: string;
}) {
  return (
    <div className={`field ${className}`}>
      {label && (
        <label htmlFor={htmlFor}>
          {label} {required && <span className="req">*</span>}
        </label>
      )}
      {children}
      {error ? <span className="error-text"><AlertTriangle size={11} /> {error}</span> : hint ? <span className="hint">{hint}</span> : null}
    </div>
  );
}

export function Input({ invalid, className = '', ...rest }: InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  return <input className={`input ${invalid ? 'invalid' : ''} ${className}`} {...rest} />;
}

export function Textarea({ invalid, className = '', ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }) {
  return <textarea className={`textarea ${invalid ? 'invalid' : ''} ${className}`} {...rest} />;
}

export function Select({ invalid, className = '', children, ...rest }: SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }) {
  return <select className={`select ${invalid ? 'invalid' : ''} ${className}`} {...rest}>{children}</select>;
}

export function SearchInput({ value, onChange, placeholder = 'Search…', autoFocus, onKeyDown, inputRef }: {
  value: string; onChange: (v: string) => void; placeholder?: string; autoFocus?: boolean;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void; inputRef?: React.Ref<HTMLInputElement>;
}) {
  return (
    <div className="input-icon grow" style={{ minWidth: 180 }}>
      <Search size={14} />
      <input
        ref={inputRef}
        className="input"
        value={value}
        autoFocus={autoFocus}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        aria-label={placeholder}
      />
      {value && (
        <button className="icon-btn sm clear-btn" onClick={() => onChange('')} aria-label="Clear search" type="button">
          <X size={13} />
        </button>
      )}
    </div>
  );
}

export function Checkbox({ label, checked, onChange, disabled }: { label: ReactNode; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className="checkbox">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

export function Switch({ label, checked, onChange, disabled }: { label?: ReactNode; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className="switch">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="track" />
      {label && <span>{label}</span>}
    </label>
  );
}

/* --------------------------------- Badges --------------------------------- */
type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'bronze';
export function Badge({ tone = 'neutral', children, dot }: { tone?: Tone; children: ReactNode; dot?: boolean }) {
  return <span className={`badge badge-${tone}`}>{dot && <span className="dot" />}{children}</span>;
}

const STATUS_MAP: Record<string, { label: string; tone: Tone }> = {
  draft: { label: 'Draft', tone: 'neutral' },
  awaiting_approval: { label: 'Awaiting approval', tone: 'warning' },
  approved: { label: 'Approved', tone: 'info' },
  in_progress: { label: 'In progress', tone: 'bronze' },
  on_hold: { label: 'On hold', tone: 'warning' },
  ready: { label: 'Ready', tone: 'info' },
  completed: { label: 'Completed', tone: 'success' },
  cancelled: { label: 'Cancelled', tone: 'danger' },
  paid: { label: 'Paid', tone: 'success' },
  partial: { label: 'Partial', tone: 'warning' },
  unpaid: { label: 'Unpaid', tone: 'danger' },
  void: { label: 'Void', tone: 'neutral' },
  received: { label: 'Received', tone: 'success' },
  open: { label: 'Open', tone: 'success' },
  closed: { label: 'Closed', tone: 'neutral' },
  active: { label: 'Active', tone: 'success' },
  expired: { label: 'Expired', tone: 'neutral' },
  claimed: { label: 'Claimed', tone: 'info' },
  pending: { label: 'Pending', tone: 'warning' },
  low: { label: 'Low', tone: 'neutral' },
  normal: { label: 'Normal', tone: 'info' },
  high: { label: 'High', tone: 'warning' },
  urgent: { label: 'Urgent', tone: 'danger' }
};

export function StatusPill({ status, label }: { status: string; label?: string }) {
  const entry = STATUS_MAP[status] ?? { label: status, tone: 'neutral' as Tone };
  return <Badge tone={entry.tone} dot>{label ?? entry.label}</Badge>;
}

export function PriorityPill({ priority }: { priority: string }) {
  return <StatusPill status={priority} />;
}

export function StockPill({ qty, reorder }: { qty: number; reorder: number }) {
  if (qty <= 0) return <Badge tone="danger" dot>Out of stock</Badge>;
  if (qty <= reorder) return <Badge tone="warning" dot>Low stock</Badge>;
  return <Badge tone="success" dot>In stock</Badge>;
}

/* --------------------------------- Money ---------------------------------- */
export function Money({ value, compact, decimals = true, className = '' }: { value: number; compact?: boolean; decimals?: boolean; className?: string }) {
  const { settings } = useApp();
  const currency = settings.profile.currency;
  return <span className={`mono ${className}`}>{compact ? formatMoneyCompact(value, currency) : formatMoney(value, { currency, decimals })}</span>;
}

/* ------------------------------- Feedback --------------------------------- */
/** Inline contextual message. Tones mirror the CSS alert classes. */
export function Alert({ tone = 'info', title, children }: {
  tone?: 'info' | 'success' | 'warning' | 'danger';
  title?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={`alert alert-${tone}`} role={tone === 'danger' ? 'alert' : 'status'}>
      <div className="grow">
        {title && <div style={{ fontWeight: 750, marginBottom: 3 }}>{title}</div>}
        <div>{children}</div>
      </div>
    </div>
  );
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return <div className="loading-row"><span className="spinner" /> {label}</div>;
}

export function EmptyState({ icon, title, message, action }: { icon?: ReactNode; title: string; message?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="icon-wrap">{icon ?? <Inbox size={20} />}</div>
      <h4>{title}</h4>
      {message && <p>{message}</p>}
      {action && <div style={{ marginTop: 6 }}>{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="empty">
      <div className="icon-wrap" style={{ color: 'var(--danger)', background: 'var(--danger-bg)' }}><AlertTriangle size={20} /></div>
      <h4>Something went wrong</h4>
      <p>{message}</p>
      {onRetry && <Button size="sm" onClick={onRetry}>Try again</Button>}
    </div>
  );
}

/* -------------------------------- Overlays -------------------------------- */
function useLockBody(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [active]);
}

/**
 * Stack of open dialogs. Escape and the focus trap must act on the top-most
 * surface only — otherwise closing a picker that sits on top of a form closes
 * the form as well, silently discarding the user's work.
 */
const dialogStack: string[] = [];

function useDismiss(active: boolean, onClose: () => void, panelRef: React.RefObject<HTMLElement>) {
  const idRef = useRef(`dlg_${Math.random().toString(36).slice(2)}`);
  useEffect(() => {
    if (!active) return;
    const id = idRef.current;
    dialogStack.push(id);
    return () => {
      const at = dialogStack.lastIndexOf(id);
      if (at >= 0) dialogStack.splice(at, 1);
    };
  }, [active]);

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (dialogStack[dialogStack.length - 1] !== idRef.current) return;
      if (e.key === 'Escape') { e.stopPropagation(); e.stopImmediatePropagation(); onClose(); }
      if (e.key === 'Tab' && panelRef.current) {
        const focusable = panelRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])'
        );
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [active, onClose, panelRef]);
}

export function Modal({ open, onClose, title, sub, children, footer, size = 'md', closeOnBackdrop = true, hideClose }: {
  open: boolean; onClose: () => void; title: ReactNode; sub?: ReactNode; children: ReactNode;
  footer?: ReactNode; size?: 'sm' | 'md' | 'lg' | 'xl'; closeOnBackdrop?: boolean; hideClose?: boolean;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  useLockBody(open);
  useDismiss(open, onClose, panelRef);
  useEffect(() => {
    if (open) {
      const t = setTimeout(() => {
        const el = panelRef.current?.querySelector<HTMLElement>('input:not([type=hidden]), select, textarea, button');
        el?.focus();
      }, 60);
      return () => clearTimeout(t);
    }
  }, [open]);
  if (!open) return null;
  return createPortal(
    <div className="overlay" onMouseDown={(e) => { if (closeOnBackdrop && e.target === e.currentTarget) onClose(); }}>
      <div className={`modal ${size}`} role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : 'Dialog'} ref={panelRef}>
        <div className="modal-header">
          <div>
            <h2>{title}</h2>
            {sub && <div className="sub">{sub}</div>}
          </div>
          {!hideClose && <IconButton label="Close dialog" onClick={onClose}><X size={17} /></IconButton>}
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>,
    document.body
  );
}

export function Drawer({ open, onClose, title, children, footer, width }: {
  open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; width?: number;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  useLockBody(open);
  useDismiss(open, onClose, panelRef);
  if (!open) return null;
  return createPortal(
    <>
      <div className="drawer-overlay" onMouseDown={onClose} />
      <aside className="drawer" style={width ? { width: `min(${width}px, 94vw)` } : undefined} role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : 'Panel'} ref={panelRef}>
        <div className="drawer-header">
          <div style={{ fontWeight: 700, fontSize: 13.5 }}>{title}</div>
          <IconButton label="Close panel" onClick={onClose}><X size={17} /></IconButton>
        </div>
        <div className="drawer-body">{children}</div>
        {footer && <div className="drawer-footer">{footer}</div>}
      </aside>
    </>,
    document.body
  );
}

export function ConfirmDialog({ open, title, message, confirmLabel = 'Confirm', tone = 'primary', requireText, onConfirm, onClose, busy }: {
  open: boolean; title: string; message: ReactNode; confirmLabel?: string; tone?: 'primary' | 'danger';
  requireText?: string; onConfirm: () => void | Promise<void>; onClose: () => void; busy?: boolean;
}) {
  const [text, setText] = useState('');
  useEffect(() => { if (open) setText(''); }, [open]);
  const ok = !requireText || text.trim() === requireText;
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title={title}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant={tone === 'danger' ? 'danger' : 'primary'} onClick={onConfirm} disabled={!ok || busy} loading={busy}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="flex-col gap-12">
        <div style={{ fontSize: 12.5, color: 'var(--text-soft)', lineHeight: 1.6 }}>{message}</div>
        {requireText && (
          <Field label={`Type "${requireText}" to confirm`}>
            <Input value={text} onChange={(e) => setText(e.target.value)} autoComplete="off" />
          </Field>
        )}
      </div>
    </Modal>
  );
}

/* ------------------------------- Navigation ------------------------------- */
export function Pager({ page, total, size, onPage }: { page: number; total: number; size: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / size));
  if (pages <= 1) return null;
  const nums: number[] = [];
  const start = Math.max(1, Math.min(page - 2, pages - 4));
  for (let i = start; i <= Math.min(pages, start + 4); i++) nums.push(i);
  return (
    <div className="pager">
      <button onClick={() => onPage(page - 1)} disabled={page <= 1} aria-label="Previous page"><ChevronLeft size={13} /></button>
      {nums.map((n) => (
        <button key={n} className={n === page ? 'active' : ''} onClick={() => onPage(n)} aria-current={n === page ? 'page' : undefined}>{n}</button>
      ))}
      <button onClick={() => onPage(page + 1)} disabled={page >= pages} aria-label="Next page"><ChevronRight size={13} /></button>
    </div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: string; count?: number }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={value === t.id} className={`tab ${value === t.id ? 'active' : ''}`} onClick={() => onChange(t.id)}>
          {t.label}
          {t.count != null && <span className="count">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

/* -------------------------------- Page bits ------------------------------- */
export function PageHeader({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children?: ReactNode }) {
  const { settings } = useApp();
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="page-head">
      <div className="title-block">
        <h1>{title}</h1>
        {subtitle && <div className="sub">{subtitle}</div>}
      </div>
      <div className="actions">
        {children}
        <div className="datetime" aria-label="Current date and time">
          <Calendar size={13} />
          <span className="mono">{new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: settings.profile.timezone || undefined }).format(now)}</span>
          <span className="sep" />
          <span className="mono">{new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: true }).format(now)}</span>
        </div>
      </div>
    </div>
  );
}

export function KPI({ label, value, sub, icon, onClick, href }: { label: string; value: ReactNode; sub?: ReactNode; icon?: ReactNode; onClick?: () => void; href?: string }) {
  const content = (
    <>
      <div className="m-top">
        <span className="m-label">{label}</span>
        {icon && <span className="m-icon">{icon}</span>}
      </div>
      <div className="m-value">{value}</div>
      {sub && <div className="m-sub">{sub}</div>}
    </>
  );
  if (href) return <a className="metric" href={href}>{content}</a>;
  return <button type="button" className="metric" style={{ textAlign: 'left' }} onClick={onClick}>{content}</button>;
}

/* ------------------------------ Date range -------------------------------- */
export type RangePreset = 'today' | '7d' | '30d' | 'month' | 'last-month' | 'year' | 'custom';
export interface DateRangeValue { from: string; to: string; preset: RangePreset }

export function defaultRange(preset: RangePreset = '30d'): DateRangeValue {
  const now = new Date();
  const iso = (d: Date) => todayISO(d);
  if (preset === 'today') return { preset, from: iso(now), to: iso(now) };
  if (preset === '7d') return { preset, from: iso(new Date(now.getTime() - 6 * 86400000)), to: iso(now) };
  if (preset === '30d') return { preset, from: iso(new Date(now.getTime() - 29 * 86400000)), to: iso(now) };
  if (preset === 'month') return { preset, from: iso(new Date(now.getFullYear(), now.getMonth(), 1)), to: iso(now) };
  if (preset === 'last-month') return { preset, from: iso(new Date(now.getFullYear(), now.getMonth() - 1, 1)), to: iso(new Date(now.getFullYear(), now.getMonth(), 0)) };
  if (preset === 'year') return { preset, from: iso(new Date(now.getFullYear(), 0, 1)), to: iso(now) };
  return { preset: 'custom', from: iso(new Date(now.getTime() - 29 * 86400000)), to: iso(now) };
}

const PRESETS: { id: RangePreset; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: '7d', label: '7 days' },
  { id: '30d', label: '30 days' },
  { id: 'month', label: 'This month' },
  { id: 'last-month', label: 'Last month' },
  { id: 'year', label: 'This year' }
];

export function DateRangeBar({ value, onChange, compact }: { value: DateRangeValue; onChange: (v: DateRangeValue) => void; compact?: boolean }) {
  return (
    <div className="flex items-center gap-8 wrap">
      <div className="pill-filters">
        {PRESETS.map((p) => (
          <button key={p.id} className={`pill ${value.preset === p.id ? 'active' : ''}`} onClick={() => onChange(defaultRange(p.id))}>
            {p.label}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-6">
        <Input
          type="date"
          value={value.from}
          aria-label="From date"
          style={{ width: compact ? 128 : 142, height: 30, fontSize: 11.5 }}
          onChange={(e) => onChange({ ...value, preset: 'custom', from: e.target.value })}
        />
        <span className="muted tiny">to</span>
        <Input
          type="date"
          value={value.to}
          aria-label="To date"
          style={{ width: compact ? 128 : 142, height: 30, fontSize: 11.5 }}
          onChange={(e) => onChange({ ...value, preset: 'custom', to: e.target.value })}
        />
      </div>
    </div>
  );
}

/* ------------------------------ misc helpers ------------------------------ */
export function useLocalState<T>(key: string, initial: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });
  const update = useCallback((v: T) => {
    setValue(v);
    try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* storage may be unavailable */ }
  }, [key]);
  return [value, update];
}

export function useDebounced<T>(value: T, delay = 250): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

export function PasswordField({ shown: controlled, invalid, ...props }: InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean; shown?: boolean }) {
  const [localShown, setLocalShown] = useState(false);
  const shared = typeof controlled === 'boolean';
  const shown = shared ? controlled : localShown;
  const id = useId();
  return (
    <div className={`pw-field${shared ? ' pw-field-shared' : ''}`}>
      <input id={id} className={`input ${invalid ? 'invalid' : ''}`} type={shown ? 'text' : 'password'} {...props} />
      {!shared && <button
        type="button"
        className="pw-toggle"
        aria-label={shown ? 'Hide password' : 'Show password'}
        aria-pressed={shown}
        title={shown ? 'Hide password' : 'Show password'}
        onClick={() => setLocalShown((s) => !s)}
      >
        {shown ? (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
            <line x1="1" y1="1" x2="23" y2="23" />
          </svg>
        ) : (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        )}
      </button>}
    </div>
  );
}
