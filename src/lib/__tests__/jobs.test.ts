import { describe, it, expect, beforeEach } from 'vitest';
import { resetWorkspace, owner } from '../../test/workspace';
import { createCustomer, createPart, createVehicle } from '../repo';
import { createJobCard, changeJobStatus, invoiceJobCard } from '../transactions';
import { dbGet, dbAll } from '../db';
import type { Customer, Invoice, JobCard, Part, Vehicle } from '../types';

let customer: Customer;
let vehicle: Vehicle;
let part: Part;

beforeEach(async () => {
  await resetWorkspace();
  customer = await createCustomer({ name: 'Bilal Khan', phone: '0321 445 6677' }, owner);
  vehicle = await createVehicle({ customerId: customer.id, regNo: 'LEC-7788', make: 'Honda', model: 'Civic' }, owner);
  part = await createPart({ name: 'Air Filter', sku: 'FLT-001', costPaisa: 100_000, pricePaisa: 200_000, qty: 8 }, owner);
});

async function draftJob() {
  return createJobCard(
    {
      customerId: customer.id,
      vehicleId: vehicle.id,
      complaint: 'AC not cooling on low fan speed.',
      priority: 'normal',
      lines: [{ id: 'jl-1', kind: 'part', refId: part.id, name: part.name, qty: 2, ratePaisa: 200_000, taxRate: 0 }]
    },
    owner
  );
}

describe('job card lifecycle', () => {
  it('numbers jobs separately from invoices', async () => {
    const job = await draftJob();
    expect(job.number).toBe('JC-0001');
    expect(job.status).toBe('draft');
  });

  it('walks the allowed path draft → awaiting → approved → in progress → ready', async () => {
    const job = await draftJob();
    await changeJobStatus(job.id, 'awaiting_approval', '', owner);
    await changeJobStatus(job.id, 'approved', 'Customer approved by phone', owner);
    await changeJobStatus(job.id, 'in_progress', '', owner);
    const ready = await changeJobStatus(job.id, 'ready', '', owner);

    expect(ready.status).toBe('ready');
    expect(ready.history.length).toBeGreaterThanOrEqual(5);
    expect(ready.history.at(-1)?.status).toBe('ready');
  });

  it('rejects an illegal jump and leaves the record untouched', async () => {
    const job = await draftJob();
    await expect(changeJobStatus(job.id, 'ready', '', owner)).rejects.toThrow(/Cannot move/i);
    const fresh = await dbGet<JobCard>('jobcards', job.id);
    expect(fresh?.status).toBe('draft');
  });

  it('supports on-hold and resuming', async () => {
    const job = await draftJob();
    await changeJobStatus(job.id, 'approved', '', owner);
    await changeJobStatus(job.id, 'in_progress', '', owner);
    const held = await changeJobStatus(job.id, 'on_hold', 'Waiting for a part', owner);
    expect(held.status).toBe('on_hold');
    const resumed = await changeJobStatus(job.id, 'in_progress', '', owner);
    expect(resumed.status).toBe('in_progress');
  });

  it('does not deduct stock while the job is open', async () => {
    await draftJob();
    const stock = await dbGet<Part>('parts', part.id);
    expect(stock?.qty).toBe(8);
  });
});

describe('job → invoice conversion', () => {
  it('deducts stock exactly once and links the invoice', async () => {
    const job = await draftJob();
    await changeJobStatus(job.id, 'approved', '', owner);
    await changeJobStatus(job.id, 'in_progress', '', owner);
    await changeJobStatus(job.id, 'ready', '', owner);

    const invoice = await invoiceJobCard(job.id, [{ method: 'cash', amountPaisa: 400_000 }], 0, owner, 'op-job-inv');

    expect(invoice.number).toBe('INV-000001');
    expect(invoice.type).toBe('job');
    expect(invoice.totalPaisa).toBe(400_000);
    expect(invoice.jobCardId).toBe(job.id);

    const stock = await dbGet<Part>('parts', part.id);
    expect(stock?.qty).toBe(6);

    const moves = (await dbAll('stockMoves' as never)) as Array<{ refId?: string; qty: number }>;
    expect(moves.filter((m) => m.refId === job.id)).toHaveLength(1);

    const closed = await dbGet<JobCard>('jobcards', job.id);
    expect(closed?.status).toBe('completed');
    expect(closed?.invoiceId).toBe(invoice.id);
  });

  it('blocks a second invoice for the same job', async () => {
    const job = await draftJob();
    await invoiceJobCard(job.id, [], 0, owner, 'op-once');
    await expect(invoiceJobCard(job.id, [], 0, owner, 'op-twice')).rejects.toThrow(/already invoiced|already/i);

    const stock = await dbGet<Part>('parts', part.id);
    expect(stock?.qty).toBe(6); // never deducted twice
  });

  it('rejects invoicing a cancelled job', async () => {
    const job = await draftJob();
    await changeJobStatus(job.id, 'cancelled', 'Customer withdrew', owner);
    await expect(invoiceJobCard(job.id, [], 0, owner, 'op-cancelled')).rejects.toThrow(/cancelled/i);
  });

  it('refuses to invoice a job with no priced lines', async () => {
    const empty = await createJobCard(
      { customerId: customer.id, vehicleId: vehicle.id, complaint: 'Rattle from dashboard', priority: 'low', lines: [] },
      owner
    );
    await expect(invoiceJobCard(empty.id, [], 0, owner, 'op-empty')).rejects.toThrow(/before invoicing/i);
  });

  it('applies an invoice-level discount proportionally to tax', async () => {
    const job = await createJobCard(
      {
        customerId: customer.id,
        vehicleId: vehicle.id,
        complaint: 'Brake service',
        priority: 'normal',
        lines: [{ id: 'jl-2', kind: 'part', refId: part.id, name: part.name, qty: 1, ratePaisa: 1_000_000, taxRate: 10 }]
      },
      owner
    );
    const invoice = await invoiceJobCard(job.id, [], 100_000, owner, 'op-disc');
    // 1,000,000 − 100,000 discount = 900,000 base; 10% tax on the discounted base.
    expect(invoice.subtotalPaisa).toBe(1_000_000);
    expect(invoice.discountPaisa).toBe(100_000);
    expect(invoice.taxPaisa).toBe(90_000);
    expect(invoice.totalPaisa).toBe(990_000);
  });
});
