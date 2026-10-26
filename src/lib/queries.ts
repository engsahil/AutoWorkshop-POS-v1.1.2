/** Read-side queries. Date-ranged reads use IndexedDB indexes, never full scans where possible. */
import { dbAll, dbBy, dbGet, withTx } from './db';
import type {
  AppNotification, AuditEvent, CashShift, Customer, Expense, Invoice, JobCard, Labor, Part,
  Payment, Purchase, ReturnDoc, Service, StockMove, Supplier, User, Vehicle, Warranty
} from './types';
import { summarise, buildSeries, serviceDistribution, type Granularity, type RangeSummary } from './analytics';
import { endOfDay, startOfDay } from './money';

export function range(from: number, to: number) {
  return IDBKeyRange.bound(from, to);
}

export async function invoicesBetween(from: number, to: number): Promise<Invoice[]> {
  const list = await dbBy<Invoice>('invoices', 'date', range(from, to));
  return list.sort((a, b) => b.date - a.date);
}

export async function returnsBetween(from: number, to: number): Promise<ReturnDoc[]> {
  return dbBy<ReturnDoc>('returns', 'date', range(from, to));
}

export async function paymentsBetween(from: number, to: number): Promise<Payment[]> {
  return dbBy<Payment>('payments', 'date', range(from, to));
}

export async function expensesBetween(from: number, to: number): Promise<Expense[]> {
  return dbBy<Expense>('expenses', 'date', range(from, to));
}

export async function purchasesBetween(from: number, to: number): Promise<Purchase[]> {
  return dbBy<Purchase>('purchases', 'date', range(from, to));
}

export async function rangeSummary(from: number, to: number): Promise<RangeSummary> {
  const [invoices, returns, payments] = await Promise.all([
    invoicesBetween(from, to),
    returnsBetween(from, to),
    paymentsBetween(from, to)
  ]);
  return summarise(invoices, returns, payments);
}

export async function salesSeries(from: number, to: number, gran: Granularity) {
  const [invoices, returns] = await Promise.all([invoicesBetween(from, to), returnsBetween(from, to)]);
  return buildSeries(from, to, gran, invoices, returns);
}

export async function distribution(from: number, to: number, measure: 'revenue' | 'count' = 'revenue') {
  const [invoices, services] = await Promise.all([
    invoicesBetween(from, to),
    dbAll<Service>('services')
  ]);
  return serviceDistribution(invoices, services, measure);
}

export async function dashboardData(now = Date.now()) {
  const todayStart = startOfDay(now);
  const todayEnd = endOfDay(now);
  const monthStart = new Date(new Date(now).getFullYear(), new Date(now).getMonth(), 1).getTime();
  const prevMonthStart = new Date(new Date(now).getFullYear(), new Date(now).getMonth() - 1, 1).getTime();
  const prevMonthEnd = monthStart - 1;

  const [
    todayInvoices, monthInvoices, prevMonthInvoices, monthReturns, prevMonthReturns,
    jobs, customers, payments, invoicesForSeries, returnsForSeries, services, activity, parts, invoicesAll,
    vehicles
  ] = await Promise.all([
    invoicesBetween(todayStart, todayEnd),
    invoicesBetween(monthStart, todayEnd),
    invoicesBetween(prevMonthStart, prevMonthEnd),
    returnsBetween(monthStart, todayEnd),
    returnsBetween(prevMonthStart, prevMonthEnd),
    dbAll<JobCard>('jobcards'),
    dbAll<Customer>('customers'),
    paymentsBetween(monthStart, todayEnd),
    invoicesBetween(new Date(now).getFullYear() === new Date(monthStart).getFullYear() ? new Date(new Date(now).getFullYear(), 0, 1).getTime() : monthStart, todayEnd),
    returnsBetween(new Date(new Date(now).getFullYear(), 0, 1).getTime(), todayEnd),
    dbAll<Service>('services'),
    dbAll<AuditEvent>('audit'),
    dbAll<Part>('parts'),
    dbAll<Invoice>('invoices'),
    dbAll<Vehicle>('vehicles')
  ]);

  const month = summarise(monthInvoices, monthReturns, payments);
  const prevMonth = summarise(prevMonthInvoices, prevMonthReturns);
  const today = summarise(todayInvoices, []);
  const pendingJobs = jobs.filter((j) => ['draft', 'awaiting_approval', 'approved', 'in_progress', 'on_hold', 'ready'].includes(j.status));

  const series = buildSeries(
    new Date(new Date(now).getFullYear(), new Date(now).getMonth() - 5, 1).getTime(),
    todayEnd,
    'month',
    invoicesAll,
    await returnsBetween(new Date(new Date(now).getFullYear(), new Date(now).getMonth() - 5, 1).getTime(), todayEnd)
  );
  const daySeries = buildSeries(todayStart - 6 * 86400000, todayEnd, 'day', invoicesForSeries, returnsForSeries);
  const distributionSlices = serviceDistribution(monthInvoices, services, 'revenue');
  const distributionCount = serviceDistribution(monthInvoices, services, 'count');
  const customerMap = new Map(customers.map((c) => [c.id, c.name]));
  const vehicleMap = new Map(vehicles.map((v) => [v.id, v]));
  const decorateInvoice = (inv: Invoice) => ({
    ...inv,
    customerName: inv.customerId ? customerMap.get(inv.customerId) ?? 'Walk-in' : 'Walk-in',
    vehicleLabel: inv.vehicleId ? vehicleMap.get(inv.vehicleId)?.regNo ?? '—' : '—'
  });
  const decorateJob = (job: JobCard) => ({
    ...job,
    customerName: customerMap.get(job.customerId) ?? '—',
    vehicleLabel: vehicleMap.get(job.vehicleId)?.regNo ?? '—'
  });

  return {
    today,
    month,
    prevMonth,
    pendingJobs,
    totalCustomers: customers.filter((c) => !c.archived).length,
    lowStock: parts.filter((p) => !p.archived && p.qty <= p.reorderLevel),
    monthSeries: series,
    daySeries,
    distribution: distributionSlices,
    distributionCount,
    recentInvoices: [...invoicesAll].sort((a, b) => b.date - a.date).slice(0, 5).map(decorateInvoice),
    recentJobs: [...jobs].sort((a, b) => b.createdAt - a.createdAt).slice(0, 5).map(decorateJob),
    activity: [...activity].sort((a, b) => b.createdAt - a.createdAt).slice(0, 6)
  };
}

export async function listInvoices(opts: { search?: string; status?: string; payment?: string; from?: number; to?: number; page?: number; size?: number } = {}) {
  let list: Invoice[];
  if (opts.from != null && opts.to != null) list = await invoicesBetween(opts.from, opts.to);
  else list = (await dbAll<Invoice>('invoices')).sort((a, b) => b.date - a.date);
  const term = (opts.search ?? '').trim().toLowerCase();
  if (opts.status && opts.status !== 'all') list = list.filter((i) => i.status === opts.status);
  if (opts.payment && opts.payment !== 'all') list = list.filter((i) => i.paymentStatus === opts.payment);
  if (term) {
    const [customers, vehicles] = await Promise.all([dbAll<Customer>('customers'), dbAll<Vehicle>('vehicles')]);
    const custMap = new Map(customers.map((c) => [c.id, c.name.toLowerCase()]));
    const vehMap = new Map(vehicles.map((v) => [v.id, `${v.regNo} ${v.make} ${v.model}`.toLowerCase()]));
    list = list.filter((i) =>
      i.number.toLowerCase().includes(term) ||
      (i.customerId && custMap.get(i.customerId)?.includes(term)) ||
      (i.vehicleId && vehMap.get(i.vehicleId)?.includes(term))
    );
  }
  const page = opts.page ?? 1;
  const size = opts.size ?? 20;
  const [customers, vehicles] = await Promise.all([dbAll<Customer>('customers'), dbAll<Vehicle>('vehicles')]);
  const custMap = new Map(customers.map((c) => [c.id, c.name]));
  const vehMap = new Map(vehicles.map((v) => [v.id, v.regNo]));
  return {
    items: list.slice((page - 1) * size, page * size).map((i) => ({
      ...i,
      customerName: i.customerId ? custMap.get(i.customerId) ?? 'Walk-in' : 'Walk-in',
      vehicleLabel: i.vehicleId ? vehMap.get(i.vehicleId) ?? '—' : '—'
    })),
    total: list.length, page, size
  };
}

export async function listJobs(opts: { search?: string; status?: string; mechanicId?: string; page?: number; size?: number } = {}) {
  const jobs = await dbAll<JobCard>('jobcards');
  const [customers, vehicles, users] = await Promise.all([
    dbAll<Customer>('customers'), dbAll<Vehicle>('vehicles'), dbAll<User>('users')
  ]);
  const custMap = new Map(customers.map((c) => [c.id, c]));
  const vehMap = new Map(vehicles.map((v) => [v.id, v]));
  const userMap = new Map(users.map((u) => [u.id, u.name]));
  const term = (opts.search ?? '').trim().toLowerCase();
  let list = jobs.sort((a, b) => b.createdAt - a.createdAt);
  if (opts.status && opts.status !== 'all') list = list.filter((j) => j.status === opts.status);
  if (opts.mechanicId) list = list.filter((j) => j.mechanicId === opts.mechanicId);
  if (term) {
    list = list.filter((j) =>
      j.number.toLowerCase().includes(term) ||
      custMap.get(j.customerId)?.name.toLowerCase().includes(term) ||
      vehMap.get(j.vehicleId)?.regNo.toLowerCase().includes(term) ||
      j.complaint.toLowerCase().includes(term)
    );
  }
  const OPEN: JobCard['status'][] = ['draft', 'awaiting_approval', 'approved', 'in_progress', 'on_hold', 'ready'];
  const counts = {
    open: jobs.filter((j) => OPEN.includes(j.status)).length,
    awaiting: jobs.filter((j) => j.status === 'awaiting_approval').length,
    ready: jobs.filter((j) => j.status === 'ready').length,
    inProgress: jobs.filter((j) => j.status === 'in_progress').length
  };
  const page = opts.page ?? 1;
  const size = opts.size ?? 20;
  return {
    items: list.slice((page - 1) * size, page * size).map((j) => ({
      ...j,
      customerName: custMap.get(j.customerId)?.name ?? '—',
      vehicle: vehMap.get(j.vehicleId),
      mechanicName: j.mechanicId ? userMap.get(j.mechanicId) ?? null : null
    })),
    total: list.length, page, size, counts
  };
}

export async function getJob(id: string) {
  const job = await dbGet<JobCard>('jobcards', id);
  if (!job) return null;
  const [customer, vehicle, invoice] = await Promise.all([
    dbGet<Customer>('customers', job.customerId),
    dbGet<Vehicle>('vehicles', job.vehicleId),
    job.invoiceId ? dbGet<Invoice>('invoices', job.invoiceId) : Promise.resolve(undefined)
  ]);
  return { job, customer, vehicle, invoice };
}

export async function getInvoiceDetail(id: string) {
  const invoice = await dbGet<Invoice>('invoices', id);
  if (!invoice) return null;
  const [customer, vehicle, payments, returns, job] = await Promise.all([
    invoice.customerId ? dbGet<Customer>('customers', invoice.customerId) : Promise.resolve(undefined),
    invoice.vehicleId ? dbGet<Vehicle>('vehicles', invoice.vehicleId) : Promise.resolve(undefined),
    dbBy<Payment>('payments', 'invoiceId', id),
    dbBy<ReturnDoc>('returns', 'invoiceId', id),
    invoice.jobCardId ? dbGet<JobCard>('jobcards', invoice.jobCardId) : Promise.resolve(undefined)
  ]);
  return { invoice, customer, vehicle, payments: payments.filter((p) => !p.voided), returns, job };
}

export async function customersWithBalances(): Promise<(Customer & { vehicleCount: number })[]> {
  const [customers, vehicles] = await Promise.all([dbAll<Customer>('customers'), dbAll<Vehicle>('vehicles')]);
  const counts = new Map<string, number>();
  for (const v of vehicles) counts.set(v.customerId, (counts.get(v.customerId) ?? 0) + 1);
  return customers
    .map((c) => ({ ...c, vehicleCount: counts.get(c.id) ?? 0 }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function getCustomerDetail(id: string) {
  const customer = await dbGet<Customer>('customers', id);
  if (!customer) return null;
  const [vehicles, invoices, jobs, warranties, returns] = await Promise.all([
    dbBy<Vehicle>('vehicles', 'customerId', id),
    dbBy<Invoice>('invoices', 'customerId', id),
    dbBy<JobCard>('jobcards', 'customerId', id),
    dbBy<Warranty>('warranty', 'customerId', id),
    dbBy<ReturnDoc>('returns', 'customerId', id)
  ]);
  return {
    customer,
    vehicles: vehicles.sort((a, b) => b.createdAt - a.createdAt),
    invoices: invoices.sort((a, b) => b.date - a.date),
    jobs: jobs.sort((a, b) => b.createdAt - a.createdAt),
    warranties,
    returns
  };
}

export async function vehiclesWithOwner(): Promise<(Vehicle & { ownerName: string })[]> {
  const [vehicles, customers] = await Promise.all([dbAll<Vehicle>('vehicles'), dbAll<Customer>('customers')]);
  const owners = new Map(customers.map((c) => [c.id, c.name]));
  return vehicles
    .map((v) => ({ ...v, ownerName: owners.get(v.customerId) ?? '—' }))
    .sort((a, b) => b.createdAt - a.createdAt);
}

export async function getVehicleDetail(id: string) {
  const vehicle = await dbGet<Vehicle>('vehicles', id);
  if (!vehicle) return null;
  const [owner, invoices, jobs, warranties] = await Promise.all([
    dbGet<Customer>('customers', vehicle.customerId),
    dbBy<Invoice>('invoices', 'vehicleId', id),
    dbBy<JobCard>('jobcards', 'vehicleId', id),
    dbBy<Warranty>('warranty', 'vehicleId', id)
  ]);
  return { vehicle, owner, invoices, jobs, warranties };
}

export async function listParts(opts: { search?: string; category?: string; lowOnly?: boolean } = {}) {
  const [allParts, suppliers] = await Promise.all([dbAll<Part>('parts'), dbAll<Supplier>('suppliers')]);
  const supplierNames = new Map(suppliers.map((s) => [s.id, s.name]));
  let parts = allParts;
  parts = parts.filter((p) => !p.archived);
  if (opts.lowOnly) parts = parts.filter((p) => p.qty <= p.reorderLevel);
  if (opts.category && opts.category !== 'all') parts = parts.filter((p) => p.category === opts.category);
  const term = (opts.search ?? '').trim().toLowerCase();
  if (term) {
    parts = parts.filter((p) =>
      p.name.toLowerCase().includes(term) || p.sku.toLowerCase().includes(term) ||
      (p.barcode ?? '').toLowerCase().includes(term) || p.category.toLowerCase().includes(term) ||
      (p.brand ?? '').toLowerCase().includes(term)
    );
  }
  return parts
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((p) => ({ ...p, supplierName: p.supplierId ? supplierNames.get(p.supplierId) ?? null : null }));
}

export async function partCategories(): Promise<string[]> {
  const parts = await dbAll<Part>('parts');
  return Array.from(new Set(parts.map((p) => p.category).filter(Boolean))).sort();
}

export async function stockHistory(partId: string): Promise<StockMove[]> {
  const moves = await dbBy<StockMove>('stockMoves', 'partId', partId);
  return moves.sort((a, b) => b.date - a.date);
}

export async function listServices(): Promise<Service[]> {
  return (await dbAll<Service>('services')).sort((a, b) => a.name.localeCompare(b.name));
}

export async function listLabor(): Promise<Labor[]> {
  return (await dbAll<Labor>('labor')).sort((a, b) => a.name.localeCompare(b.name));
}

export async function listSuppliers(): Promise<Supplier[]> {
  return (await dbAll<Supplier>('suppliers')).sort((a, b) => a.name.localeCompare(b.name));
}

export async function listPurchases(opts: { status?: string; search?: string } = {}) {
  const [purchases, suppliers] = await Promise.all([dbAll<Purchase>('purchases'), dbAll<Supplier>('suppliers')]);
  const supMap = new Map(suppliers.map((s) => [s.id, s.name]));
  let list = purchases.sort((a, b) => b.date - a.date);
  if (opts.status && opts.status !== 'all') list = list.filter((p) => p.status === opts.status);
  const term = (opts.search ?? '').trim().toLowerCase();
  if (term) {
    list = list.filter((p) => p.number.toLowerCase().includes(term) || (supMap.get(p.supplierId) ?? '').toLowerCase().includes(term));
  }
  return list.map((p) => ({ ...p, supplierName: supMap.get(p.supplierId) ?? '—' }));
}

export async function listReturns(): Promise<(ReturnDoc & { customerName: string; invoiceNumber: string })[]> {
  const [returns, customers, invoices] = await Promise.all([
    dbAll<ReturnDoc>('returns'), dbAll<Customer>('customers'), dbAll<Invoice>('invoices')
  ]);
  const cust = new Map(customers.map((c) => [c.id, c.name]));
  const inv = new Map(invoices.map((i) => [i.id, i.number]));
  return returns
    .sort((a, b) => b.date - a.date)
    .map((r) => ({
      ...r,
      customerName: r.customerId ? cust.get(r.customerId) ?? 'Walk-in' : 'Walk-in',
      invoiceNumber: inv.get(r.invoiceId) ?? '—'
    }));
}

export async function listWarranties() {
  const [warranties, customers, vehicles] = await Promise.all([
    dbAll<Warranty>('warranty'), dbAll<Customer>('customers'), dbAll<Vehicle>('vehicles')
  ]);
  const cust = new Map(customers.map((c) => [c.id, c.name]));
  const veh = new Map(vehicles.map((v) => [v.id, `${v.regNo} · ${v.make} ${v.model}`]));
  return warranties
    .map((w) => ({ ...w, customerName: cust.get(w.customerId) ?? '—', vehicleLabel: w.vehicleId ? veh.get(w.vehicleId) ?? '—' : '—' }))
    .sort((a, b) => a.endDate.localeCompare(b.endDate));
}

export async function listExpenses(from?: number, to?: number) {
  const expenses = from != null && to != null ? await expensesBetween(from, to) : await dbAll<Expense>('expenses');
  return expenses.sort((a, b) => b.date - a.date);
}

export async function listShifts(): Promise<(CashShift & { userName: string })[]> {
  const [shifts, users] = await Promise.all([dbAll<CashShift>('cashShifts'), dbAll<User>('users')]);
  const names = new Map(users.map((u) => [u.id, u.name]));
  return shifts.sort((a, b) => b.openedAt - a.openedAt).map((s) => ({ ...s, userName: names.get(s.userId) ?? '—' }));
}

export async function currentShift(userId: string): Promise<CashShift | null> {
  const shifts = await dbBy<CashShift>('cashShifts', 'userId', userId);
  return shifts.filter((s) => s.status === 'open').sort((a, b) => b.openedAt - a.openedAt)[0] ?? null;
}

export async function getShiftDetail(id: string) {
  const shift = await dbGet<CashShift>('cashShifts', id);
  if (!shift) return null;
  const [payments, expenses, movements] = await Promise.all([
    dbBy<Payment>('payments', 'shiftId', id),
    dbBy<Expense>('expenses', 'shiftId', id),
    withTx(['cashMovements'], 'readonly', (tx) => tx.by<import('./types').CashMovement>('cashMovements', 'shiftId', id))
  ]);
  return { shift, payments: payments.filter((p) => !p.voided), expenses, movements };
}

export async function lowStockParts(): Promise<Part[]> {
  return (await dbAll<Part>('parts')).filter((p) => !p.archived && p.qty <= p.reorderLevel).sort((a, b) => a.qty - b.qty);
}

export async function inventoryValuation() {
  const parts = (await dbAll<Part>('parts')).filter((p) => !p.archived);
  const cost = parts.reduce((a, p) => a + p.qty * p.costPaisa, 0);
  const retail = parts.reduce((a, p) => a + p.qty * p.pricePaisa, 0);
  return { count: parts.length, units: parts.reduce((a, p) => a + p.qty, 0), costPaisa: cost, retailPaisa: retail, potentialProfitPaisa: retail - cost };
}

export async function searchEverything(term: string, limit = 8) {
  const t = term.trim().toLowerCase();
  if (t.length < 2) return { customers: [], vehicles: [], invoices: [], jobs: [], parts: [], services: [] };
  const [customers, vehicles, invoices, jobs, parts, services] = await Promise.all([
    dbAll<Customer>('customers'), dbAll<Vehicle>('vehicles'), dbAll<Invoice>('invoices'),
    dbAll<JobCard>('jobcards'), dbAll<Part>('parts'), dbAll<Service>('services')
  ]);
  return {
    customers: customers.filter((c) => c.name.toLowerCase().includes(t) || c.phone.includes(t) || c.code.toLowerCase().includes(t)).slice(0, limit),
    vehicles: vehicles.filter((v) => v.regNo.toLowerCase().includes(t) || `${v.make} ${v.model}`.toLowerCase().includes(t)).slice(0, limit),
    invoices: invoices.filter((i) => i.number.toLowerCase().includes(t)).slice(0, limit),
    jobs: jobs.filter((j) => j.number.toLowerCase().includes(t)).slice(0, limit),
    parts: parts.filter((p) => p.name.toLowerCase().includes(t) || p.sku.toLowerCase().includes(t) || (p.barcode ?? '').includes(t)).slice(0, limit),
    services: services.filter((s) => s.name.toLowerCase().includes(t)).slice(0, limit)
  };
}

export async function allDataCounts() {
  const stores = ['invoices', 'customers', 'vehicles', 'parts', 'jobcards', 'purchases', 'payments', 'returns', 'expenses', 'warranty', 'stockMoves', 'users', 'audit', 'notifications'] as const;
  const entries = await Promise.all(stores.map(async (s) => [s, (await dbAll(s)).length] as const));
  return Object.fromEntries(entries) as Record<(typeof stores)[number], number>;
}

export async function auditTrail(limit = 200): Promise<AuditEvent[]> {
  const all = await dbAll<AuditEvent>('audit');
  return all.sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
}

export async function unreadNotifications(): Promise<{ items: AppNotification[]; unread: number }> {
  const all = (await dbAll<AppNotification>('notifications')).sort((a, b) => b.createdAt - a.createdAt);
  return { items: all.slice(0, 40), unread: all.filter((n) => !n.read).length };
}

export async function recentAudit(limit = 6) {
  return (await dbAll<AuditEvent>('audit')).sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
}
