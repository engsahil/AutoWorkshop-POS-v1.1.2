/**
 * Transactional business operations.
 *
 * Rules enforced here (single source of truth):
 *  • A sale deducts stock immediately and writes one stock movement per part line.
 *  • Job-card parts do NOT touch stock while the job is open. Converting the job
 *    to an invoice deducts stock exactly once (guarded by job.invoiceId).
 *  • Purchases add stock only when a draft is received; receiving twice is blocked.
 *  • Returns validate against previously returned quantities and only restock
 *    physically returned part lines.
 *  • Every mutating call carries an opId; repeats return the original document.
 *  • Customer balances are always recomputed from documents, never typed by hand.
 */
import { mutate, nextNumber, audit, notify, recomputeCustomerBalance, type Actor } from './repo';
import { uid } from './ids';
import { ValidationError, PermissionError, ConflictError } from './repo';
import type {
  AppSettings, CashShift, Customer, Expense, Invoice, JobCard, JobStatus, LineItem, Part, Payment,
  Purchase, ReturnDoc, Service, StockMove, Supplier, Vehicle
} from './types';
import { getSettings, type Tx } from './db';

export type PayMethod = 'cash' | 'card' | 'bank' | 'online';

export interface PaymentInput {
  method: PayMethod;
  amountPaisa: number;
  reference?: string;
}

export interface SaleLineInput {
  kind: 'part' | 'service' | 'labor';
  refId?: string;
  name?: string;
  qty: number;
  ratePaisa: number;
  discountPaisa?: number;
  taxRate?: number;
}

export interface SaleInput {
  customerId: string | null;
  vehicleId: string | null;
  lines: SaleLineInput[];
  invoiceDiscountPaisa?: number;
  payments: PaymentInput[];
  notes?: string;
  shiftId?: string | null;
  date?: number;
  type?: 'pos' | 'manual';
  jobCardId?: string | null;
  actor: Actor;
  opId: string;
}

export interface ComputedInvoice {
  lines: LineItem[];
  subtotalPaisa: number;
  discountPaisa: number;
  taxPaisa: number;
  totalPaisa: number;
}

/** Pure calculation used by both POS preview and persistence. */
export function computeInvoice(lines: SaleLineInput[], invoiceDiscountPaisa = 0): ComputedInvoice {
  if (!lines.length) throw new ValidationError('Add at least one item to the invoice.');
  let subtotal = 0;
  let tax = 0;
  const items: LineItem[] = lines.map((l) => {
    const qty = Number(l.qty);
    const rate = Math.round(l.ratePaisa);
    if (!isFinite(qty) || qty <= 0) throw new ValidationError('Quantity must be greater than zero.');
    if (!isFinite(rate) || rate < 0) throw new ValidationError('Rate cannot be negative.');
    const gross = Math.round(qty * rate);
    const discount = Math.min(Math.round(l.discountPaisa ?? 0), gross);
    if (discount < 0) throw new ValidationError('Line discount cannot be negative.');
    const base = gross - discount;
    const taxRate = Math.max(0, Number(l.taxRate ?? 0));
    const taxPaisa = Math.round((base * taxRate) / 100);
    subtotal += base;
    tax += taxPaisa;
    return {
      id: uid('lin'),
      kind: l.kind,
      refId: l.refId,
      name: (l.name ?? '').trim() || 'Item',
      sku: undefined,
      qty,
      ratePaisa: rate,
      discountPaisa: discount,
      taxRate,
      taxPaisa,
      totalPaisa: base + taxPaisa,
      costPaisa: 0
    };
  });
  const invoiceDiscount = Math.min(Math.max(0, Math.round(invoiceDiscountPaisa)), subtotal);
  // Allocate invoice-level discount proportionally so tax reflects the true taxable value.
  const ratio = subtotal > 0 ? (subtotal - invoiceDiscount) / subtotal : 1;
  let adjustedTax = 0;
  for (const item of items) {
    item.taxPaisa = Math.round(item.taxPaisa * ratio);
    item.totalPaisa = item.ratePaisa * item.qty - item.discountPaisa + item.taxPaisa;
    adjustedTax += item.taxPaisa;
  }
  const total = subtotal - invoiceDiscount + adjustedTax;
  return { lines: items, subtotalPaisa: subtotal, discountPaisa: invoiceDiscount, taxPaisa: adjustedTax, totalPaisa: total };
}

export function paymentStatusFor(totalPaisa: number, paidPaisa: number): Invoice['paymentStatus'] {
  if (paidPaisa >= totalPaisa - 1) return 'paid';
  if (paidPaisa > 0) return 'partial';
  return 'unpaid';
}

async function findOpenShift(tx: Tx, userId: string): Promise<CashShift | undefined> {
  const shifts = await tx.by<CashShift>('cashShifts', 'userId', userId);
  return shifts.filter((s) => s.status === 'open').sort((a, b) => b.openedAt - a.openedAt)[0];
}

async function savePayments(
  tx: Tx,
  opts: {
    payments: PaymentInput[];
    kind: Payment['kind'];
    actor: Actor;
    shiftId?: string | null;
    invoiceId?: string | null;
    purchaseId?: string | null;
    customerId?: string | null;
    supplierId?: string | null;
    date: number;
    settings: AppSettings;
  }
): Promise<Payment[]> {
  const { settings } = opts;
  const out: Payment[] = [];
  for (const p of opts.payments) {
    if (!p || !p.amountPaisa) continue;
    const amount = Math.round(p.amountPaisa);
    if (amount < 0) throw new ValidationError('Payment amount cannot be negative.');
    if (!settings.documents.paymentMethods.includes(p.method)) {
      throw new ValidationError(`${p.method} is not an enabled payment method.`);
    }
    const number = await nextNumber(tx, 'payment');
    const now = Date.now();
    const payment: Payment = {
      id: uid('pay'), createdAt: now, updatedAt: now, number, kind: opts.kind,
      invoiceId: opts.invoiceId ?? null, purchaseId: opts.purchaseId ?? null,
      customerId: opts.customerId ?? null, supplierId: opts.supplierId ?? null,
      method: p.method, amountPaisa: amount, date: opts.date, shiftId: opts.shiftId ?? null,
      reference: p.reference?.trim(), createdBy: opts.actor.name
    };
    await tx.put('payments', payment);
    out.push(payment);
  }
  return out;
}

/* ---------------------------------- SALES ---------------------------------- */

export async function sell(input: SaleInput): Promise<Invoice> {
  // Read settings BEFORE opening the write transaction: awaiting a second
  // IndexedDB transaction inside a readwrite callback can outlive the tx.
  const settings = await getSettings();
  return mutate(
    ['invoices', 'payments', 'returns', 'parts', 'stockMoves', 'customers', 'vehicles', 'sequences', 'cashShifts'],
    async (tx) => {
      const prior = await tx.get<{ key: string; value: string }>('meta', `op:${input.opId}`);
      if (prior) {
        const existing = await tx.get<Invoice>('invoices', prior.value);
        if (existing) return existing;
      }
      const computed = computeInvoice(input.lines, input.invoiceDiscountPaisa);

      const paid = input.payments.reduce((a, p) => a + Math.round(p.amountPaisa), 0);
      if (paid > computed.totalPaisa + 1) throw new ValidationError('Payments exceed the invoice total.');
      if (paid < 0) throw new ValidationError('Payment amount cannot be negative.');

      if (computed.discountPaisa > 0) {
        const pct = computed.subtotalPaisa ? (computed.discountPaisa / computed.subtotalPaisa) * 100 : 0;
        if (!settings.documents.allowDiscounts) throw new PermissionError('Discounts are disabled in Settings.');
        if (pct > settings.documents.maxDiscountPercent) {
          throw new PermissionError(`Discount exceeds the ${settings.documents.maxDiscountPercent}% limit configured in Settings.`);
        }
      }

      if (input.customerId) {
        const customer = await tx.get<Customer>('customers', input.customerId);
        if (!customer) throw new ValidationError('Customer not found.');
      }
      if (input.vehicleId) {
        const vehicle = await tx.get<Vehicle>('vehicles', input.vehicleId);
        if (!vehicle) throw new ValidationError('Vehicle not found.');
      }

      const now = input.date ?? Date.now();
      const invoiceId = uid('inv');
      // Validate and deduct stock before writing financial documents in this same tx.
      for (const line of computed.lines) {
        if (line.kind !== 'part') continue;
        if (!line.refId) throw new ValidationError(`Missing part reference for "${line.name}".`);
        const part = await tx.get<Part>('parts', line.refId);
        if (!part) throw new ValidationError(`Part "${line.name}" no longer exists.`);
        if (!settings.documents.negativeStock && part.qty < line.qty) {
          throw new ValidationError(`Insufficient stock for ${part.name} (${part.sku}): ${part.qty} ${part.unit} available.`);
        }
        const newQty = part.qty - line.qty;
        await tx.put('parts', { ...part, qty: newQty, updatedAt: now });
        const move: StockMove = {
          id: uid('stm'), createdAt: now, updatedAt: now, partId: part.id, type: 'sale', qty: -line.qty,
          unitCostPaisa: part.costPaisa, refType: 'invoice', refId: invoiceId, note: 'POS sale',
          date: now, createdBy: input.actor.name
        };
        await tx.put('stockMoves', move);
        line.costPaisa = part.costPaisa;
        line.sku = part.sku;
        if (newQty <= part.reorderLevel) {
          await notify(tx, 'low_stock', 'Low stock alert',
            `${part.name} (${part.sku}) dropped to ${newQty} ${part.unit}.`, '/inventory');
        }
      }

      const shift = input.shiftId ? null : await findOpenShift(tx, input.actor.id);
      const shiftId = input.shiftId ?? shift?.id ?? null;
      const number = await nextNumber(tx, 'invoice');
      const inv: Invoice = {
        id: invoiceId, createdAt: now, updatedAt: now, number, type: input.type ?? 'pos',
        customerId: input.customerId, vehicleId: input.vehicleId, jobCardId: input.jobCardId ?? null,
        date: now, lines: computed.lines, subtotalPaisa: computed.subtotalPaisa,
        discountPaisa: computed.discountPaisa, taxPaisa: computed.taxPaisa, totalPaisa: computed.totalPaisa,
        paidPaisa: paid, duePaisa: computed.totalPaisa - paid,
        paymentStatus: paymentStatusFor(computed.totalPaisa, paid), status: 'completed',
        shiftId, notes: input.notes?.trim(), createdBy: input.actor.name, opId: input.opId
      };
      await tx.put('invoices', inv);

      if (paid > 0) {
        await savePayments(tx, {
          payments: input.payments, kind: 'sale', actor: input.actor, shiftId,
          invoiceId: inv.id, customerId: inv.customerId, date: now, settings
        });
      }
      if (inv.customerId) await recomputeCustomerBalance(tx, inv.customerId);

      await audit(tx, 'sale.create', 'invoice', inv.id,
        `Invoice ${inv.number} completed for ${inv.totalPaisa / 100} ${settings.profile.currency}`, input.actor);
      await notify(tx, 'sale', 'Sale completed',
        `Invoice ${inv.number} for ${settings.profile.currency} ${(inv.totalPaisa / 100).toLocaleString()} was recorded.`,
        `/invoices?open=${inv.id}`);
      await tx.put('meta', { key: `op:${input.opId}`, value: inv.id });
      return inv;
    }
  );
}

export async function payInvoice(invoiceId: string, payments: PaymentInput[], actor: Actor, opId: string): Promise<Invoice> {
  const settings = await getSettings();
  return mutate(['invoices', 'payments', 'returns', 'sequences', 'customers', 'cashShifts'], async (tx) => {
    const prior = await tx.get<{ key: string; value: string }>('meta', `op:${opId}`);
    if (prior) {
      const existing = await tx.get<Invoice>('invoices', prior.value);
      if (existing) return existing;
    }
    const inv = await tx.get<Invoice>('invoices', invoiceId);
    if (!inv) throw new ValidationError('Invoice not found.');
    if (inv.status === 'void') throw new ValidationError('Voided invoices cannot receive payments.');
    const amount = payments.reduce((a, p) => a + Math.round(p.amountPaisa), 0);
    if (amount <= 0) throw new ValidationError('Enter a payment amount.');
    if (amount > inv.duePaisa + 1) throw new ValidationError('Payment exceeds the outstanding balance.');
    const shift = await findOpenShift(tx, actor.id);
    await savePayments(tx, {
      payments, kind: 'sale', actor, shiftId: shift?.id ?? null,
      invoiceId: inv.id, customerId: inv.customerId, date: Date.now(), settings
    });
    const next: Invoice = {
      ...inv, paidPaisa: inv.paidPaisa + amount, duePaisa: Math.max(0, inv.duePaisa - amount),
      paymentStatus: paymentStatusFor(inv.totalPaisa, inv.paidPaisa + amount), updatedAt: Date.now()
    };
    await tx.put('invoices', next);
    if (next.customerId) await recomputeCustomerBalance(tx, next.customerId);
    await audit(tx, 'invoice.pay', 'invoice', inv.id, `Payment received on ${inv.number}`, actor);
    await notify(tx, 'payment', 'Payment received', `Payment recorded against ${inv.number}.`, `/invoices?open=${inv.id}`);
    await tx.put('meta', { key: `op:${opId}`, value: inv.id });
    return next;
  });
}

export async function voidInvoice(invoiceId: string, reason: string, actor: Actor): Promise<Invoice> {
  if (!reason.trim()) throw new ValidationError('A reason is required to void an invoice.');
  return mutate(['invoices', 'payments', 'returns', 'parts', 'stockMoves', 'customers'], async (tx) => {
    const inv = await tx.get<Invoice>('invoices', invoiceId);
    if (!inv) throw new ValidationError('Invoice not found.');
    if (inv.status === 'void') throw new ValidationError('This invoice is already void.');
    const now = Date.now();
    for (const line of inv.lines) {
      if (line.kind !== 'part' || !line.refId) continue;
      const part = await tx.get<Part>('parts', line.refId);
      if (!part) continue;
      await tx.put('parts', { ...part, qty: part.qty + line.qty, updatedAt: now });
      await tx.put('stockMoves', {
        id: uid('stm'), createdAt: now, updatedAt: now, partId: part.id, type: 'void', qty: line.qty,
        unitCostPaisa: part.costPaisa, refType: 'invoice', refId: inv.id, note: `Void ${inv.number}: ${reason}`,
        date: now, createdBy: actor.name
      });
    }
    const payments = await tx.by<Payment>('payments', 'invoiceId', inv.id);
    for (const p of payments) await tx.put('payments', { ...p, voided: true, updatedAt: now });
    await tx.put('invoices', { ...inv, status: 'void', duePaisa: 0, paymentStatus: 'unpaid', updatedAt: now, notes: `${inv.notes ?? ''}\nVoid: ${reason}`.trim() });
    if (inv.customerId) await recomputeCustomerBalance(tx, inv.customerId);
    if (inv.jobCardId) {
      const job = await tx.get<JobCard>('jobcards', inv.jobCardId);
      if (job) await tx.put('jobcards', { ...job, invoiceId: undefined, updatedAt: now });
    }
    await audit(tx, 'invoice.void', 'invoice', inv.id, `Invoice ${inv.number} voided — ${reason}`, actor);
    return { ...inv, status: 'void' as const };
  });
}

/* -------------------------------- JOB CARDS -------------------------------- */

const TRANSITIONS: Record<JobStatus, JobStatus[]> = {
  draft: ['awaiting_approval', 'approved', 'cancelled'],
  awaiting_approval: ['approved', 'cancelled'],
  approved: ['in_progress', 'on_hold', 'cancelled'],
  in_progress: ['on_hold', 'ready', 'cancelled'],
  on_hold: ['in_progress', 'cancelled'],
  ready: ['completed', 'cancelled'],
  completed: [],
  cancelled: []
};

export interface JobInput {
  customerId: string;
  vehicleId: string;
  odometer?: number;
  complaint: string;
  findings?: string;
  recommendation?: string;
  priority: JobCard['priority'];
  mechanicId?: string | null;
  estimatePaisa?: number;
  dueDate?: string;
  lines?: JobCard['lines'];
  notes?: string;
}

export async function createJobCard(input: JobInput, actor: Actor): Promise<JobCard> {
  if (!input.customerId) throw new ValidationError('Select a customer.');
  if (!input.vehicleId) throw new ValidationError('Select a vehicle.');
  if (!input.complaint.trim()) throw new ValidationError('Describe the reported problem.');
  return mutate(['jobcards', 'vehicles', 'customers', 'sequences'], async (tx) => {
    const customer = await tx.get<Customer>('customers', input.customerId);
    if (!customer) throw new ValidationError('Customer not found.');
    const vehicle = await tx.get<Vehicle>('vehicles', input.vehicleId);
    if (!vehicle) throw new ValidationError('Vehicle not found.');
    if (vehicle.customerId !== input.customerId) throw new ValidationError('The selected vehicle does not belong to this customer.');
    const number = await nextNumber(tx, 'job');
    const now = Date.now();
    const job: JobCard = {
      id: uid('job'), createdAt: now, updatedAt: now, number,
      customerId: input.customerId, vehicleId: input.vehicleId, odometer: input.odometer,
      complaint: input.complaint.trim(), findings: input.findings?.trim(), recommendation: input.recommendation?.trim(),
      priority: input.priority ?? 'normal', mechanicId: input.mechanicId ?? null,
      estimatePaisa: Math.round(input.estimatePaisa ?? 0), dueDate: input.dueDate,
      status: 'draft', lines: (input.lines ?? []).map((l) => ({ ...l, id: l.id || uid('jl') })),
      customerApproved: false, notes: input.notes?.trim(),
      history: [{ at: now, by: actor.name, status: 'draft', action: 'Job card created' }],
      createdBy: actor.name
    };
    await tx.put('jobcards', job);
    if (input.odometer && input.odometer > (vehicle.odometer ?? 0)) {
      await tx.put('vehicles', { ...vehicle, odometer: input.odometer, updatedAt: now });
    }
    await audit(tx, 'job.create', 'jobcard', job.id, `Job card ${job.number} created for ${vehicle.regNo}`, actor);
    if (job.mechanicId) {
      await notify(tx, 'job_assigned', 'New job assigned', `${job.number} — ${vehicle.make} ${vehicle.model} (${vehicle.regNo}) assigned to you.`, `/jobcards?open=${job.id}`);
    }
    return job;
  });
}

export async function updateJobCard(id: string, patch: Partial<JobInput>, actor: Actor): Promise<JobCard> {
  return mutate(['jobcards', 'vehicles'], async (tx) => {
    const job = await tx.get<JobCard>('jobcards', id);
    if (!job) throw new ValidationError('Job card not found.');
    if (job.status === 'completed' || job.status === 'cancelled') {
      throw new ValidationError('Completed or cancelled job cards cannot be edited.');
    }
    const now = Date.now();
    const next: JobCard = {
      ...job,
      ...patch,
      id: job.id, number: job.number, status: job.status,
      complaint: patch.complaint?.trim() ?? job.complaint,
      lines: patch.lines ? patch.lines.map((l) => ({ ...l, id: l.id || uid('jl') })) : job.lines,
      history: [...job.history, { at: now, by: actor.name, action: 'Job details updated' }],
      updatedAt: now
    };
    await tx.put('jobcards', next);
    if (patch.mechanicId && patch.mechanicId !== job.mechanicId) {
      await notify(tx, 'job_assigned', 'Job assigned', `${job.number} assigned to a mechanic.`, `/jobcards?open=${job.id}`);
    }
    return next;
  });
}

export async function changeJobStatus(id: string, status: JobStatus, note: string, actor: Actor): Promise<JobCard> {
  return mutate(['jobcards'], async (tx) => {
    const job = await tx.get<JobCard>('jobcards', id);
    if (!job) throw new ValidationError('Job card not found.');
    if (job.status === status) return job;
    if (!TRANSITIONS[job.status].includes(status)) {
      throw new ValidationError(`Cannot move a job from ${job.status.replace('_', ' ')} to ${status.replace('_', ' ')}.`);
    }
    const now = Date.now();
    const next: JobCard = {
      ...job, status, updatedAt: now,
      customerApproved: status === 'approved' || status === 'in_progress' ? true : job.customerApproved,
      completedAt: status === 'completed' ? now : job.completedAt,
      history: [...job.history, { at: now, by: actor.name, status, action: `Status changed to ${status.replace('_', ' ')}`, note: note.trim() || undefined }]
    };
    await tx.put('jobcards', next);
    await audit(tx, 'job.status', 'jobcard', id, `${job.number} → ${status}`, actor);
    if (status === 'ready') {
      await notify(tx, 'job_ready', 'Vehicle ready for delivery', `${job.number} is ready for collection.`, `/jobcards?open=${job.id}`);
    }
    return next;
  });
}

/** Converts a job card into an invoice. Deducts parts stock exactly once. */
export async function invoiceJobCard(jobId: string, payments: PaymentInput[], invoiceDiscountPaisa: number, actor: Actor, opId: string): Promise<Invoice> {
  const settings = await getSettings();
  return mutate(
    ['jobcards', 'invoices', 'payments', 'returns', 'parts', 'stockMoves', 'customers', 'vehicles', 'sequences', 'cashShifts'],
    async (tx) => {
      const prior = await tx.get<{ key: string; value: string }>('meta', `op:${opId}`);
      if (prior) {
        const existing = await tx.get<Invoice>('invoices', prior.value);
        if (existing) return existing;
      }
      const job = await tx.get<JobCard>('jobcards', jobId);
      if (!job) throw new ValidationError('Job card not found.');
      if (job.invoiceId) throw new ConflictError('This job has already been invoiced.');
      if (job.status === 'cancelled') throw new ValidationError('Cancelled jobs cannot be invoiced.');
      if (!job.lines.length) throw new ValidationError('Add parts, services or labor to the job before invoicing.');
      const now = Date.now();

      const lines: LineItem[] = [];
      for (const l of job.lines) {
        const gross = Math.round(l.qty * l.ratePaisa);
        if (l.kind === 'part' && l.refId) {
          const part = await tx.get<Part>('parts', l.refId);
          if (!part) throw new ValidationError(`Part "${l.name}" no longer exists.`);
          if (!settings.documents.negativeStock && part.qty < l.qty) {
            throw new ValidationError(`Insufficient stock for ${part.name}: ${part.qty} available.`);
          }
          await tx.put('parts', { ...part, qty: part.qty - l.qty, updatedAt: now });
          await tx.put('stockMoves', {
            id: uid('stm'), createdAt: now, updatedAt: now, partId: part.id, type: 'job', qty: -l.qty,
            unitCostPaisa: part.costPaisa, refType: 'jobcard', refId: job.id, note: `Job ${job.number} invoiced`,
            date: now, createdBy: actor.name
          });
          lines.push({
            id: uid('lin'), kind: 'part', refId: part.id, name: part.name, sku: part.sku, qty: l.qty,
            ratePaisa: l.ratePaisa, discountPaisa: 0, taxRate: l.taxRate, taxPaisa: Math.round((gross * l.taxRate) / 100),
            totalPaisa: gross + Math.round((gross * l.taxRate) / 100), costPaisa: part.costPaisa
          });
        } else if (l.kind === 'service' && l.refId) {
          const svc = await tx.get<Service>('services', l.refId);
          lines.push({
            id: uid('lin'), kind: 'service', refId: l.refId, name: svc?.name ?? l.name, qty: l.qty,
            ratePaisa: l.ratePaisa, discountPaisa: 0, taxRate: l.taxRate, taxPaisa: Math.round((gross * l.taxRate) / 100),
            totalPaisa: gross + Math.round((gross * l.taxRate) / 100), costPaisa: 0
          });
        } else {
          lines.push({
            id: uid('lin'), kind: 'labor', refId: l.refId, name: l.name, qty: l.qty,
            ratePaisa: l.ratePaisa, discountPaisa: 0, taxRate: l.taxRate, taxPaisa: Math.round((gross * l.taxRate) / 100),
            totalPaisa: gross + Math.round((gross * l.taxRate) / 100), costPaisa: 0
          });
        }
      }

      const subtotal = lines.reduce((a, l) => a + (l.ratePaisa * l.qty - l.discountPaisa), 0);
      const discount = Math.min(Math.max(0, Math.round(invoiceDiscountPaisa)), subtotal);
      const ratio = subtotal > 0 ? (subtotal - discount) / subtotal : 1;
      for (const l of lines) {
        l.taxPaisa = Math.round(l.taxPaisa * ratio);
        l.totalPaisa = l.ratePaisa * l.qty - l.discountPaisa + l.taxPaisa;
      }
      const taxPaisa = lines.reduce((a, l) => a + l.taxPaisa, 0);
      const total = subtotal - discount + taxPaisa;
      const paid = payments.reduce((a, p) => a + Math.round(p.amountPaisa), 0);
      if (paid > total + 1) throw new ValidationError('Payments exceed the invoice total.');

      const shift = await findOpenShift(tx, actor.id);
      const number = await nextNumber(tx, 'invoice');
      const invoice: Invoice = {
        id: uid('inv'), createdAt: now, updatedAt: now, number, type: 'job',
        customerId: job.customerId, vehicleId: job.vehicleId, jobCardId: job.id, date: now,
        lines, subtotalPaisa: subtotal, discountPaisa: discount, taxPaisa, totalPaisa: total,
        paidPaisa: paid, duePaisa: total - paid, paymentStatus: paymentStatusFor(total, paid),
        status: 'completed', shiftId: shift?.id ?? null, createdBy: actor.name, opId
      };
      await tx.put('invoices', invoice);
      if (paid > 0) {
        await savePayments(tx, {
          payments, kind: 'sale', actor, shiftId: invoice.shiftId, invoiceId: invoice.id,
          customerId: job.customerId, date: now, settings
        });
      }
      await recomputeCustomerBalance(tx, job.customerId);
      await tx.put('jobcards', {
        ...job, invoiceId: invoice.id, status: 'completed', completedAt: now, updatedAt: now,
        customerApproved: true,
        history: [...job.history, { at: now, by: actor.name, status: 'completed', action: `Invoiced as ${invoice.number}` }]
      });
      await audit(tx, 'job.invoice', 'jobcard', job.id, `Job ${job.number} invoiced as ${invoice.number}`, actor);
      await notify(tx, 'sale', 'Job invoiced', `${job.number} was completed and invoiced as ${invoice.number}.`, `/invoices?open=${invoice.id}`);
      await tx.put('meta', { key: `op:${opId}`, value: invoice.id });
      return invoice;
    }
  );
}

/* -------------------------------- PURCHASES -------------------------------- */

export interface PurchaseLineInput {
  partId?: string;
  name?: string;
  sku?: string;
  qty: number;
  costPaisa: number;
  taxRate?: number;
}

export async function createPurchase(input: { supplierId: string; lines: PurchaseLineInput[]; discountPaisa?: number; notes?: string; date?: number }, actor: Actor): Promise<Purchase> {
  if (!input.supplierId) throw new ValidationError('Select a supplier.');
  if (!input.lines.length) throw new ValidationError('Add at least one purchase line.');
  return mutate(['purchases', 'suppliers', 'sequences'], async (tx) => {
    const supplier = await tx.get<Supplier>('suppliers', input.supplierId);
    if (!supplier) throw new ValidationError('Supplier not found.');
    const lines = input.lines.map((l) => {
      if (!l.qty || l.qty <= 0) throw new ValidationError('Purchase quantities must be greater than zero.');
      if (l.costPaisa < 0) throw new ValidationError('Cost cannot be negative.');
      const total = Math.round(l.qty * l.costPaisa * (1 + (l.taxRate ?? 0) / 100));
      return {
        id: uid('pl'), partId: l.partId, name: (l.name ?? '').trim() || 'Item', sku: l.sku,
        qty: l.qty, costPaisa: l.costPaisa, taxRate: l.taxRate ?? 0, totalPaisa: total
      };
    });
    const subtotal = lines.reduce((a, l) => a + Math.round(l.qty * l.costPaisa), 0);
    const tax = lines.reduce((a, l) => a + (l.totalPaisa - Math.round(l.qty * l.costPaisa)), 0);
    const discount = Math.max(0, Math.round(input.discountPaisa ?? 0));
    const number = await nextNumber(tx, 'purchase');
    const now = input.date ?? Date.now();
    const purchase: Purchase = {
      id: uid('pur'), createdAt: now, updatedAt: now, number, supplierId: input.supplierId,
      date: now, status: 'draft', lines, subtotalPaisa: subtotal, taxPaisa: tax, discountPaisa: discount,
      totalPaisa: subtotal + tax - discount, paidPaisa: 0, notes: input.notes?.trim(), createdBy: actor.name
    };
    await tx.put('purchases', purchase);
    await audit(tx, 'purchase.create', 'purchase', purchase.id, `Purchase ${number} created (draft)`, actor);
    return purchase;
  });
}

export async function receivePurchase(id: string, actor: Actor): Promise<Purchase> {
  return mutate(['purchases', 'parts', 'stockMoves', 'suppliers', 'notifications'], async (tx) => {
    const purchase = await tx.get<Purchase>('purchases', id);
    if (!purchase) throw new ValidationError('Purchase not found.');
    if (purchase.status === 'received') throw new ConflictError('This purchase has already been received. Stock was not changed twice.');
    if (purchase.status === 'cancelled') throw new ValidationError('Cancelled purchases cannot be received.');
    const now = Date.now();
    for (const line of purchase.lines) {
      if (!line.partId) continue;
      const part = await tx.get<Part>('parts', line.partId);
      if (!part) throw new ValidationError(`Part "${line.name}" no longer exists.`);
      await tx.put('parts', {
        ...part, qty: part.qty + line.qty,
        costPaisa: line.costPaisa > 0 ? line.costPaisa : part.costPaisa,
        updatedAt: now
      });
      await tx.put('stockMoves', {
        id: uid('stm'), createdAt: now, updatedAt: now, partId: part.id, type: 'purchase', qty: line.qty,
        unitCostPaisa: line.costPaisa, refType: 'purchase', refId: purchase.id,
        note: `Received ${purchase.number}`, date: now, createdBy: actor.name
      });
    }
    const supplier = await tx.get<Supplier>('suppliers', purchase.supplierId);
    if (supplier) {
      await tx.put('suppliers', { ...supplier, balancePaisa: supplier.balancePaisa + (purchase.totalPaisa - purchase.paidPaisa), updatedAt: now });
    }
    const next: Purchase = { ...purchase, status: 'received', receivedAt: now, updatedAt: now };
    await tx.put('purchases', next);
    await audit(tx, 'purchase.receive', 'purchase', id, `Purchase ${purchase.number} received`, actor);
    await notify(tx, 'purchase_received', 'Purchase received', `${purchase.number} received — stock updated for ${purchase.lines.filter((l) => l.partId).length} item(s).`, '/inventory');
    return next;
  });
}

export async function payPurchase(id: string, payments: PaymentInput[], actor: Actor, opId: string): Promise<Purchase> {
  const settings = await getSettings();
  return mutate(['purchases', 'payments', 'sequences', 'suppliers', 'cashShifts'], async (tx) => {
    const purchase = await tx.get<Purchase>('purchases', id);
    if (!purchase) throw new ValidationError('Purchase not found.');
    if (purchase.status === 'cancelled') throw new ValidationError('Cancelled purchases cannot be paid.');
    const amount = payments.reduce((a, p) => a + Math.round(p.amountPaisa), 0);
    if (amount <= 0) throw new ValidationError('Enter a payment amount.');
    const outstanding = purchase.totalPaisa - purchase.paidPaisa;
    if (amount > outstanding + 1) throw new ValidationError('Payment exceeds the outstanding supplier balance.');
    await savePayments(tx, {
      payments, kind: 'purchase', actor, purchaseId: purchase.id,
      supplierId: purchase.supplierId, date: Date.now(), settings
    });
    const supplier = await tx.get<Supplier>('suppliers', purchase.supplierId);
    if (supplier) await tx.put('suppliers', { ...supplier, balancePaisa: Math.max(0, supplier.balancePaisa - amount), updatedAt: Date.now() });
    const next: Purchase = { ...purchase, paidPaisa: purchase.paidPaisa + amount, updatedAt: Date.now() };
    await tx.put('purchases', next);
    await audit(tx, 'purchase.pay', 'purchase', id, `Supplier payment on ${purchase.number}`, actor);
    await tx.put('meta', { key: `op:${opId}`, value: purchase.id });
    return next;
  });
}

export async function cancelPurchase(id: string, reason: string, actor: Actor): Promise<Purchase> {
  return mutate(['purchases'], async (tx) => {
    const purchase = await tx.get<Purchase>('purchases', id);
    if (!purchase) throw new ValidationError('Purchase not found.');
    if (purchase.status === 'received') throw new ValidationError('Received purchases cannot be cancelled — raise a purchase return instead.');
    if (purchase.status === 'cancelled') throw new ValidationError('Purchase already cancelled.');
    const next: Purchase = { ...purchase, status: 'cancelled', updatedAt: Date.now(), notes: `${purchase.notes ?? ''}\nCancelled: ${reason}`.trim() };
    await tx.put('purchases', next);
    await audit(tx, 'purchase.create', 'purchase', id, `Purchase ${purchase.number} cancelled — ${reason}`, actor);
    return next;
  });
}

/* --------------------------------- RETURNS --------------------------------- */

export async function returnedQuantities(invoiceId: string): Promise<Record<string, number>> {
  const { withTx } = await import('./db');
  const docs = await withTx(['returns'], 'readonly', (tx) => tx.by<ReturnDoc>('returns', 'invoiceId', invoiceId));
  const map: Record<string, number> = {};
  for (const doc of docs) for (const l of doc.lines) if (l.lineId) map[l.lineId] = (map[l.lineId] ?? 0) + l.qty;
  return map;
}

export interface ReturnInput {
  invoiceId: string;
  lines: { lineId: string; qty: number; restock: boolean }[];
  refundMethod: 'cash' | 'card' | 'bank' | 'credit';
  reason: string;
  actor: Actor;
  opId: string;
}

export async function createReturn(input: ReturnInput): Promise<ReturnDoc> {
  if (!input.reason.trim()) throw new ValidationError('Enter a return reason.');
  if (!input.lines.length) throw new ValidationError('Select at least one line to return.');
  const settings = await getSettings();
  return mutate(['returns', 'invoices', 'payments', 'parts', 'stockMoves', 'customers', 'sequences', 'cashShifts'], async (tx) => {
    const prior = await tx.get<{ key: string; value: string }>('meta', `op:${input.opId}`);
    if (prior) {
      const existing = await tx.get<ReturnDoc>('returns', prior.value);
      if (existing) return existing;
    }
    const invoice = await tx.get<Invoice>('invoices', input.invoiceId);
    if (!invoice) throw new ValidationError('Original invoice not found.');
    if (invoice.status === 'void') throw new ValidationError('Voided invoices cannot be returned.');

    const priorReturns = await tx.by<ReturnDoc>('returns', 'invoiceId', input.invoiceId);
    const previous: Record<string, number> = {};
    for (const doc of priorReturns) for (const l of doc.lines) if (l.lineId) previous[l.lineId] = (previous[l.lineId] ?? 0) + l.qty;
    const returnLines: ReturnDoc['lines'] = [];
    let subtotal = 0;
    let taxTotal = 0;

    for (const req of input.lines) {
      const line = invoice.lines.find((l) => l.id === req.lineId);
      if (!line) throw new ValidationError('Invoice line not found.');
      const remaining = line.qty - (previous[line.id] ?? 0);
      if (req.qty <= 0) continue;
      if (req.qty > remaining + 1e-9) {
        throw new ValidationError(`Only ${remaining} of "${line.name}" remain returnable.`);
      }
      const netUnit = (line.ratePaisa * line.qty - line.discountPaisa) / line.qty;
      const invRatio = invoice.subtotalPaisa > 0 ? (invoice.subtotalPaisa - invoice.discountPaisa) / invoice.subtotalPaisa : 1;
      const base = Math.round(netUnit * req.qty * invRatio);
      const tax = Math.round((base * line.taxRate) / 100);
      subtotal += base;
      taxTotal += tax;
      returnLines.push({
        id: uid('rl'), lineId: line.id, partId: line.refId, kind: line.kind, name: line.name,
        qty: req.qty, ratePaisa: Math.round(netUnit), totalPaisa: base + tax,
        restock: line.kind === 'part' ? req.restock : false
      });
    }
    if (!returnLines.length) throw new ValidationError('Select at least one line to return.');
    const total = subtotal + taxTotal;
    const now = Date.now();
    const returnId = uid('ret');

    for (const l of returnLines) {
      if (l.kind !== 'part' || !l.restock || !l.partId) continue;
      const part = await tx.get<Part>('parts', l.partId);
      if (!part) continue;
      await tx.put('parts', { ...part, qty: part.qty + l.qty, updatedAt: now });
      await tx.put('stockMoves', {
        id: uid('stm'), createdAt: now, updatedAt: now, partId: part.id, type: 'return', qty: l.qty,
        unitCostPaisa: part.costPaisa, refType: 'return', refId: returnId,
        note: `Return against ${invoice.number}`,
        date: now, createdBy: input.actor.name
      });
    }

    // Apply the credit against any outstanding due first, then settle the remainder.
    const dueBefore = invoice.duePaisa;
    const appliedToDue = Math.min(dueBefore, total);
    if (appliedToDue > 0) {
      const newDue = Math.max(0, invoice.duePaisa - appliedToDue);
      const newPaid = invoice.totalPaisa - newDue;
      await tx.put('invoices', {
        ...invoice, duePaisa: newDue,
        paymentStatus: paymentStatusFor(invoice.totalPaisa, newPaid), updatedAt: now
      });
    }
    const refundAmount = total - appliedToDue;
    let shift: CashShift | undefined;
    if (refundAmount > 0 && input.refundMethod !== 'credit') {
      shift = await findOpenShift(tx, input.actor.id);
      await savePayments(tx, {
        payments: [{ method: input.refundMethod, amountPaisa: refundAmount, reference: `Refund ${invoice.number}` }],
        kind: 'refund', actor: input.actor, shiftId: shift?.id ?? null,
        invoiceId: invoice.id, customerId: invoice.customerId, date: now, settings
      });
    }
    const number = await nextNumber(tx, 'return');
    const doc: ReturnDoc = {
      id: returnId, createdAt: now, updatedAt: now, number, invoiceId: invoice.id,
      customerId: invoice.customerId, date: now, lines: returnLines, subtotalPaisa: subtotal,
      taxPaisa: taxTotal, totalPaisa: total, refundMethod: input.refundMethod,
      refundPaisa: refundAmount, reason: input.reason.trim(), shiftId: shift?.id ?? null,
      createdBy: input.actor.name, opId: input.opId
    };
    await tx.put('returns', doc);
    if (invoice.customerId) await recomputeCustomerBalance(tx, invoice.customerId);
    await audit(tx, 'return.create', 'return', doc.id,
      `Return ${number} against ${invoice.number} (${refundAmount / 100} refunded via ${input.refundMethod})`, input.actor);
    await tx.put('meta', { key: `op:${input.opId}`, value: doc.id });
    return doc;
  });
}

/* --------------------------------- SHIFTS ---------------------------------- */

export async function openShift(openingPaisa: number, notes: string, actor: Actor): Promise<CashShift> {
  if (openingPaisa < 0) throw new ValidationError('Opening balance cannot be negative.');
  return mutate(['cashShifts', 'sequences'], async (tx) => {
    const existing = (await tx.by<CashShift>('cashShifts', 'userId', actor.id)).filter((s) => s.status === 'open');
    if (existing.length) throw new ConflictError('You already have an open shift. Close it before opening another.');
    const number = await nextNumber(tx, 'shift');
    const now = Date.now();
    const shift: CashShift = {
      id: uid('shf'), createdAt: now, updatedAt: now, number, userId: actor.id,
      openedAt: now, openingPaisa: Math.round(openingPaisa), status: 'open', notes: notes.trim() || undefined
    };
    await tx.put('cashShifts', shift);
    await audit(tx, 'shift.open', 'shift', shift.id, `Shift ${number} opened with opening cash ${openingPaisa / 100}`, actor);
    return shift;
  });
}

export interface ShiftTotals {
  openingPaisa: number;
  cashSales: number;
  cashRefunds: number;
  cashExpenses: number;
  cashIn: number;
  cashOut: number;
  expectedPaisa: number;
  otherSales: number;
}

export async function computeShiftTotals(shift: CashShift): Promise<ShiftTotals> {
  const { withTx } = await import('./db');
  return withTx(['payments', 'expenses', 'cashMovements'], 'readonly', async (tx) => {
    const payments = (await tx.by<Payment>('payments', 'shiftId', shift.id)).filter((p) => !p.voided);
    const expenses = await tx.by<Expense>('expenses', 'shiftId', shift.id);
    const movements = await tx.by<import('./types').CashMovement>('cashMovements', 'shiftId', shift.id);
    const cashSales = payments.filter((p) => p.method === 'cash' && p.kind === 'sale').reduce((a, p) => a + p.amountPaisa, 0);
    const cashRefunds = payments.filter((p) => p.method === 'cash' && p.kind === 'refund').reduce((a, p) => a + p.amountPaisa, 0);
    const otherSales = payments.filter((p) => p.method !== 'cash' && p.kind === 'sale').reduce((a, p) => a + p.amountPaisa, 0);
    const cashExpenses = expenses.filter((e) => e.method === 'cash' && e.status === 'approved').reduce((a, e) => a + e.amountPaisa, 0);
    const cashIn = movements.filter((m) => m.type === 'in').reduce((a, m) => a + m.amountPaisa, 0);
    const cashOut = movements.filter((m) => m.type === 'out').reduce((a, m) => a + m.amountPaisa, 0);
    const expected = shift.openingPaisa + cashSales - cashRefunds - cashExpenses + cashIn - cashOut;
    return {
      openingPaisa: shift.openingPaisa, cashSales, cashRefunds, cashExpenses, cashIn, cashOut,
      expectedPaisa: expected, otherSales
    };
  });
}

export async function closeShift(shiftId: string, countedPaisa: number, closingNotes: string, actor: Actor): Promise<CashShift> {
  if (countedPaisa < 0) throw new ValidationError('Counted cash cannot be negative.');
  const shift = await (await import('./db')).dbGet<CashShift>('cashShifts', shiftId);
  if (!shift) throw new ValidationError('Shift not found.');
  if (shift.status === 'closed') throw new ValidationError('This shift is already closed.');
  const totals = await computeShiftTotals(shift);
  return mutate(['cashShifts'], async (tx) => {
    const fresh = await tx.get<CashShift>('cashShifts', shiftId);
    if (!fresh || fresh.status !== 'open') throw new ValidationError('Shift is no longer open.');
    const next: CashShift = {
      ...fresh, status: 'closed', closedAt: Date.now(), countedPaisa: Math.round(countedPaisa),
      expectedPaisa: totals.expectedPaisa, variancePaisa: Math.round(countedPaisa) - totals.expectedPaisa,
      closingNotes: closingNotes.trim() || undefined, updatedAt: Date.now()
    };
    await tx.put('cashShifts', next);
    await audit(tx, 'shift.close', 'shift', shiftId, `Shift ${fresh.number} closed — variance ${(next.variancePaisa ?? 0) / 100}`, actor);
    if (next.variancePaisa) {
      await notify(tx, 'shift_warning', 'Shift reconciliation variance',
        `Shift ${fresh.number} closed with a ${Math.abs(next.variancePaisa) / 100} ${next.variancePaisa < 0 ? 'shortfall' : 'overage'}.`, '/shifts');
    }
    return next;
  });
}

/* -------------------------------- EXPENSES --------------------------------- */

export async function createExpense(input: { category: string; amountPaisa: number; method: PayMethod; description: string; date?: number }, actor: Actor): Promise<Expense> {
  if (!input.description.trim()) throw new ValidationError('Enter an expense description.');
  if (!input.amountPaisa || input.amountPaisa <= 0) throw new ValidationError('Enter an amount greater than zero.');
  if (!input.category.trim()) throw new ValidationError('Select an expense category.');
  return mutate(['expenses', 'cashShifts'], async (tx) => {
    const shift = input.method === 'cash' ? await findOpenShift(tx, actor.id) : undefined;
    const now = Date.now();
    const isApprover = actor.role === 'Administrator' || actor.role === 'Manager';
    const expense: Expense = {
      id: uid('exp'), createdAt: now, updatedAt: now, category: input.category.trim(),
      date: input.date ?? now, amountPaisa: Math.round(input.amountPaisa), method: input.method,
      description: input.description.trim(), shiftId: shift?.id ?? null,
      status: isApprover ? 'approved' : 'pending', createdBy: actor.name,
      approvedBy: isApprover ? actor.name : undefined
    };
    await tx.put('expenses', expense);
    await audit(tx, 'expense.create', 'expense', expense.id, `Expense of ${expense.amountPaisa / 100} recorded (${expense.category})`, actor);
    return expense;
  });
}

export async function approveExpense(id: string, actor: Actor): Promise<Expense> {
  return mutate(['expenses'], async (tx) => {
    const expense = await tx.get<Expense>('expenses', id);
    if (!expense) throw new ValidationError('Expense not found.');
    if (expense.status === 'approved') return expense;
    const next: Expense = { ...expense, status: 'approved', approvedBy: actor.name, updatedAt: Date.now() };
    await tx.put('expenses', next);
    await audit(tx, 'expense.approve', 'expense', id, `Expense ${expense.id} approved`, actor);
    return next;
  });
}

export { PermissionError, ConflictError, ValidationError };
