/** Money helpers. All persisted amounts are integer paisa. */

export const CURRENCY_FALLBACK = 'Rs.';

export function toPaisa(value: string | number): number {
  const n = typeof value === 'number' ? value : parseFloat(String(value).replace(/[^0-9.-]/g, ''));
  if (!isFinite(n)) return 0;
  return Math.round(n * 100);
}

export function fromPaisa(paisa: number): number {
  return Math.round(paisa) / 100;
}

export function roundPaisa(n: number): number {
  return Math.round(n);
}

export function formatMoney(paisa: number, opts: { currency?: string; decimals?: boolean } = {}): string {
  const cur = opts.currency ?? CURRENCY_FALLBACK;
  const negative = paisa < 0;
  const rounded = Math.abs(Math.round(paisa)) / 100;
  // decimals:false means "whole currency units" (headline figures), not just
  // "do not force two decimals" — otherwise 1234.56 still renders its paisa.
  const abs = opts.decimals === false ? Math.round(rounded) : rounded;
  const str = abs.toLocaleString('en-PK', {
    minimumFractionDigits: opts.decimals === false ? 0 : 2,
    maximumFractionDigits: opts.decimals === false ? 0 : 2
  });
  return `${negative ? '-' : ''}${cur} ${str}`;
}

/** Compact money used in dense metric cards: Rs 48,750 */
export function formatMoneyCompact(paisa: number, currency = CURRENCY_FALLBACK): string {
  const abs = Math.abs(paisa) / 100;
  const sign = paisa < 0 ? '-' : '';
  if (abs >= 10_000_000) return `${sign}${currency} ${(abs / 10_000_000).toFixed(2)}Cr`;
  if (abs >= 100_000) return `${sign}${currency} ${(abs / 100_000).toFixed(2)}L`;
  // Whole rupees read better in compact headline figures; sub-rupee detail
  // stays available anywhere the exact value is needed.
  const digits = abs >= 1000 || abs % 1 === 0 ? 0 : 2;
  return `${sign}${currency} ${abs.toLocaleString('en-PK', { maximumFractionDigits: digits })}`;
}

export function formatQty(qty: number): string {
  return Number.isInteger(qty) ? String(qty) : qty.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
}

export function sumPaisa(values: number[]): number {
  return values.reduce((a, b) => a + Math.round(b), 0);
}

/** Tax on a line, computed on the discounted base and rounded once per line. */
export function lineTax(basePaisa: number, ratePercent: number): number {
  return Math.round((basePaisa * ratePercent) / 100);
}

export function todayISO(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function parseISODate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function endOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}

export function daysAgo(n: number, from = Date.now()): number {
  const d = new Date(from);
  d.setDate(d.getDate() - n);
  return d.getTime();
}

export function fmtDate(ts: number, timezone?: string): string {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      day: '2-digit', month: 'short', year: 'numeric',
      ...(timezone ? { timeZone: timezone } : {})
    }).format(new Date(ts));
  } catch {
    return new Date(ts).toLocaleDateString();
  }
}

export function fmtDateTime(ts: number, timezone?: string): string {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true,
      ...(timezone ? { timeZone: timezone } : {})
    }).format(new Date(ts));
  } catch {
    return new Date(ts).toLocaleString();
  }
}

export function fmtTime(ts: number): string {
  return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: true }).format(new Date(ts));
}

export function relTime(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} day${days > 1 ? 's' : ''} ago`;
  return fmtDate(ts);
}

/** Human-readable byte size for storage estimates. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(value >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}
