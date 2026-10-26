/**
 * Pure aggregation math. Kept free of database access so it can be unit-tested.
 *
 * FINANCIAL DEFINITIONS (also documented in Help & Guide)
 *  grossSales      Σ (qty × rate − line discount) across completed invoices (pre-tax)
 *  invoiceDiscount Σ invoice-level discounts
 *  netSales        grossSales − invoiceDiscount          (pre-tax revenue before returns)
 *  taxCollected    Σ line tax
 *  invoiceTotal    netSales + taxCollected               (= Σ invoice.totalPaisa)
 *  returnsNet      Σ return subtotal (pre-tax credit notes issued in the period)
 *  netRevenue      netSales − returnsNet
 *  cogs            Σ cost price of parts sold − cost of parts returned
 *  grossProfit     netRevenue − cogs      (gross only: overheads are not allocated)
 */
import type { Invoice, ReturnDoc, Service } from './types';

export interface RangeSummary {
  invoiceCount: number;
  grossSalesPaisa: number;
  invoiceDiscountPaisa: number;
  netSalesPaisa: number;
  taxPaisa: number;
  invoiceTotalPaisa: number;
  returnsNetPaisa: number;
  netRevenuePaisa: number;
  cogsPaisa: number;
  grossProfitPaisa: number;
  paidPaisa: number;
  duePaisa: number;
  collectedPaisa: number;
  byMethod: Record<'cash' | 'card' | 'bank' | 'online', number>;
  refundsPaisa: number;
}

const emptyMethods = { cash: 0, card: 0, bank: 0, online: 0 };

export function summarise(
  invoices: Invoice[],
  returns: ReturnDoc[],
  payments: { method: 'cash' | 'card' | 'bank' | 'online'; amountPaisa: number; kind: string; voided?: boolean }[] = []
): RangeSummary {
  const active = invoices.filter((i) => i.status === 'completed');
  let grossSalesPaisa = 0;
  let invoiceDiscountPaisa = 0;
  let taxPaisa = 0;
  let invoiceTotalPaisa = 0;
  let cogsPaisa = 0;
  let paidPaisa = 0;
  let duePaisa = 0;
  const byMethod = { ...emptyMethods };

  for (const inv of active) {
    grossSalesPaisa += inv.subtotalPaisa;
    invoiceDiscountPaisa += inv.discountPaisa;
    taxPaisa += inv.taxPaisa;
    invoiceTotalPaisa += inv.totalPaisa;
    paidPaisa += inv.paidPaisa;
    duePaisa += inv.duePaisa;
    for (const l of inv.lines) {
      if (l.kind === 'part') cogsPaisa += l.costPaisa * l.qty;
    }
  }

  const invoiceById = new Map(active.map((i) => [i.id, i]));
  let returnsNetPaisa = 0;
  for (const ret of returns) {
    returnsNetPaisa += ret.subtotalPaisa;
    const original = invoiceById.get(ret.invoiceId);
    for (const line of ret.lines) {
      if (line.kind !== 'part') continue;
      const invLine = original?.lines.find((l) => l.id === line.lineId);
      if (invLine) cogsPaisa -= invLine.costPaisa * line.qty;
    }
  }

  let collectedPaisa = 0;
  let refundsPaisa = 0;
  for (const p of payments) {
    if (p.voided) continue;
    if (p.kind === 'sale') {
      byMethod[p.method] += p.amountPaisa;
      collectedPaisa += p.amountPaisa;
    } else if (p.kind === 'refund') {
      refundsPaisa += p.amountPaisa;
    }
  }

  const netSalesPaisa = grossSalesPaisa - invoiceDiscountPaisa;
  const netRevenuePaisa = netSalesPaisa - returnsNetPaisa;
  return {
    invoiceCount: active.length,
    grossSalesPaisa,
    invoiceDiscountPaisa,
    netSalesPaisa,
    taxPaisa,
    invoiceTotalPaisa,
    returnsNetPaisa,
    netRevenuePaisa,
    cogsPaisa,
    grossProfitPaisa: netRevenuePaisa - cogsPaisa,
    paidPaisa,
    duePaisa,
    collectedPaisa,
    byMethod,
    refundsPaisa
  };
}

export type Granularity = 'day' | 'week' | 'month';

export interface Bucket {
  key: string;
  label: string;
  from: number;
  to: number;
  salesPaisa: number;
  returnsPaisa: number;
  netPaisa: number;
  count: number;
}

function startOfDayTs(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function startOfWeekTs(ts: number): number {
  const d = new Date(startOfDayTs(ts));
  const day = d.getDay(); // 0 Sun
  const diff = (day + 6) % 7; // Monday start
  d.setDate(d.getDate() - diff);
  return d.getTime();
}

export function bucketKey(ts: number, gran: Granularity): number {
  if (gran === 'day') return startOfDayTs(ts);
  if (gran === 'week') return startOfWeekTs(ts);
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
}

export function bucketLabel(ts: number, gran: Granularity): string {
  const d = new Date(ts);
  if (gran === 'month') return d.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' });
  if (gran === 'week') return `W${isoWeek(d)}`;
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}

function isoWeek(date: Date): number {
  const tmp = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = tmp.getUTCDay() || 7;
  tmp.setUTCDate(tmp.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  return Math.ceil(((tmp.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

/** Builds a complete, gap-free series so charts never mislead with missing days. */
export function buildSeries(from: number, to: number, gran: Granularity, invoices: Invoice[], returns: ReturnDoc[]): Bucket[] {
  const buckets = new Map<number, Bucket>();
  const cursor = new Date(bucketKey(from, gran));
  const end = bucketKey(to, gran);
  let guard = 0;
  while (cursor.getTime() <= end && guard < 800) {
    const key = cursor.getTime();
    buckets.set(key, {
      key: String(key),
      label: bucketLabel(key, gran),
      from: key,
      to: key,
      salesPaisa: 0,
      returnsPaisa: 0,
      netPaisa: 0,
      count: 0
    });
    if (gran === 'day') cursor.setDate(cursor.getDate() + 1);
    else if (gran === 'week') cursor.setDate(cursor.getDate() + 7);
    else cursor.setMonth(cursor.getMonth() + 1);
    guard++;
  }
  for (const inv of invoices) {
    if (inv.status !== 'completed') continue;
    const b = buckets.get(bucketKey(inv.date, gran));
    if (!b) continue;
    b.salesPaisa += inv.totalPaisa;
    b.count += 1;
  }
  for (const ret of returns) {
    const b = buckets.get(bucketKey(ret.date, gran));
    if (!b) continue;
    b.returnsPaisa += ret.totalPaisa;
  }
  for (const b of buckets.values()) b.netPaisa = b.salesPaisa - b.returnsPaisa;
  return Array.from(buckets.values());
}

export interface CategorySlice {
  name: string;
  value: number;
  percent: number;
  color?: string;
}

/** Service revenue/count distribution. Parts are excluded by design (see Help). */
export function serviceDistribution(
  invoices: Invoice[],
  services: Service[],
  measure: 'revenue' | 'count' = 'revenue'
): CategorySlice[] {
  const byId = new Map(services.map((s) => [s.id, s]));
  const totals = new Map<string, number>();
  for (const inv of invoices) {
    if (inv.status !== 'completed') continue;
    for (const line of inv.lines) {
      if (line.kind === 'part') continue;
      const svc = line.refId ? byId.get(line.refId) : undefined;
      const key = svc?.category || (line.kind === 'labor' ? 'Labor' : 'Other Services');
      const value = measure === 'revenue' ? line.totalPaisa : line.qty;
      totals.set(key, (totals.get(key) ?? 0) + value);
    }
  }
  const total = Array.from(totals.values()).reduce((a, b) => a + b, 0);
  if (!total) return [];
  return Array.from(totals.entries())
    .map(([name, value]) => ({ name, value, percent: Math.round((value / total) * 1000) / 10 }))
    .sort((a, b) => b.value - a.value);
}

/** Top-selling items across completed invoices. */
export function topItems(invoices: Invoice[], kind: 'part' | 'service' | 'labor' | 'all', limit = 6) {
  const map = new Map<string, { name: string; qty: number; revenuePaisa: number }>();
  for (const inv of invoices) {
    if (inv.status !== 'completed') continue;
    for (const l of inv.lines) {
      if (kind !== 'all' && l.kind !== kind) continue;
      const key = `${l.kind}:${l.refId ?? l.name}`;
      const entry = map.get(key) ?? { name: l.name, qty: 0, revenuePaisa: 0 };
      entry.qty += l.qty;
      entry.revenuePaisa += l.totalPaisa;
      map.set(key, entry);
    }
  }
  return Array.from(map.values()).sort((a, b) => b.revenuePaisa - a.revenuePaisa).slice(0, limit);
}

/** Compares two adjacent periods. Returns null when the previous period has no data. */
export function trend(current: number, previous: number): number | null {
  if (!previous || previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

export function averageInvoice(invoices: Invoice[]): number {
  const active = invoices.filter((i) => i.status === 'completed');
  if (!active.length) return 0;
  return Math.round(active.reduce((a, i) => a + i.totalPaisa, 0) / active.length);
}

export function mechanicPerformance(
  jobs: import('./types').JobCard[],
  invoices: Invoice[],
  users: { id: string; name: string }[]
) {
  const invoiceById = new Map(invoices.map((i) => [i.id, i]));
  const byMechanic = new Map<string, { id: string; name: string; completed: number; billedPaisa: number; hours: number[] }>();
  for (const job of jobs) {
    if (!job.mechanicId) continue;
    const user = users.find((u) => u.id === job.mechanicId);
    const entry = byMechanic.get(job.mechanicId) ?? {
      id: job.mechanicId, name: user?.name ?? 'Unassigned', completed: 0, billedPaisa: 0, hours: []
    };
    if (job.status === 'completed') {
      entry.completed += 1;
      if (job.completedAt) entry.hours.push((job.completedAt - job.createdAt) / 3600_000);
      if (job.invoiceId) entry.billedPaisa += invoiceById.get(job.invoiceId)?.totalPaisa ?? 0;
    }
    byMechanic.set(job.mechanicId, entry);
  }
  return Array.from(byMechanic.values()).map((m) => ({
    ...m,
    avgTurnaroundHours: m.hours.length ? Math.round((m.hours.reduce((a, b) => a + b, 0) / m.hours.length) * 10) / 10 : 0
  })).sort((a, b) => b.billedPaisa - a.billedPaisa);
}

export function percent(part: number, total: number): number {
  if (!total) return 0;
  return Math.round((part / total) * 1000) / 10;
}
