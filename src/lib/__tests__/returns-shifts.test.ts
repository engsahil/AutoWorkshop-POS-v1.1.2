import { describe, it, expect, beforeEach } from 'vitest';
import { resetWorkspace, owner } from '../../test/workspace';
import { createCustomer, createPart, createVehicle, createSupplier } from '../repo';
import { sell, createReturn, createPurchase, receivePurchase, payPurchase, openShift, closeShift, computeShiftTotals } from '../transactions';
import { dbGet, dbAll } from '../db';
import type { Customer, Invoice, Part, Purchase, Vehicle } from '../types';

let customer: Customer;
let vehicle: Vehicle;
let part: Part;
let invoice: Invoice;

beforeEach(async () => {
  await resetWorkspace();
  customer = await createCustomer({ name: 'Sara Malik', phone: '0333 998 4455' }, owner);
  vehicle = await createVehicle({ customerId: customer.id, regNo: 'LZA-4455', make: 'Suzuki', model: 'Alto' }, owner);
  part = await createPart({ name: 'Wiper Blade', sku: 'WPR-001', costPaisa: 50_000, pricePaisa: 95_000, qty: 10 }, owner);
  invoice = await sell({
    customerId: customer.id,
    vehicleId: vehicle.id,
    lines: [{ kind: 'part', refId: part.id, name: part.name, qty: 4, ratePaisa: 95_000, taxRate: 0 }],
    payments: [{ method: 'cash', amountPaisa: 380_000 }],
    actor: owner,
    opId: 'op-return-sale'
  });
});

describe('returns', () => {
  it('restocks only the lines marked for restock and refunds the value', async () => {
    const doc = await createReturn({
      invoiceId: invoice.id,
      lines: [{ lineId: invoice.lines[0].id, qty: 2, restock: true }],
      refundMethod: 'cash',
      reason: 'Wrong size fitted',
      actor: owner,
      opId: 'op-return-1'
    });

    expect(doc.number).toBe('RTN-0001');
    expect(doc.totalPaisa).toBe(190_000);

    const stock = await dbGet<Part>('parts', part.id);
    expect(stock?.qty).toBe(8); // 10 − 4 sold + 2 returned

    const moves = (await dbAll('stockMoves' as never)) as Array<{ refId?: string; qty: number }>;
    expect(moves.filter((m) => m.refId === doc.id)).toHaveLength(1);
  });

  it('records a refund payment that nets the customer balance to zero', async () => {
    await createReturn({
      invoiceId: invoice.id,
      lines: [{ lineId: invoice.lines[0].id, qty: 1, restock: true }],
      refundMethod: 'cash',
      reason: 'Customer changed mind',
      actor: owner,
      opId: 'op-return-2'
    });

    const updated = await dbGet<Customer>('customers', customer.id);
    // Invoice fully paid (380,000), one unit refunded (95,000) → nothing owed
    // and no phantom credit balance left behind.
    expect(updated?.balancePaisa).toBe(0);
  });

  it('does not restock when the line is marked as not returned to shelf', async () => {
    await createReturn({
      invoiceId: invoice.id,
      lines: [{ lineId: invoice.lines[0].id, qty: 2, restock: false }],
      refundMethod: 'credit',
      reason: 'Damaged in fitting',
      actor: owner,
      opId: 'op-return-3'
    });
    const stock = await dbGet<Part>('parts', part.id);
    expect(stock?.qty).toBe(6); // nothing put back
  });

  it('caps the return quantity at what was sold', async () => {
    await expect(
      createReturn({
        invoiceId: invoice.id,
        lines: [{ lineId: invoice.lines[0].id, qty: 5, restock: true }],
        refundMethod: 'cash',
        reason: 'Too many',
        actor: owner,
        opId: 'op-return-over'
      })
    ).rejects.toThrow(/remain|exceed|quantity/i);
  });

  it('subtracts earlier returns from the remaining quantity', async () => {
    await createReturn({
      invoiceId: invoice.id,
      lines: [{ lineId: invoice.lines[0].id, qty: 3, restock: true }],
      refundMethod: 'cash',
      reason: 'Partial return',
      actor: owner,
      opId: 'op-return-a'
    });
    await expect(
      createReturn({
        invoiceId: invoice.id,
        lines: [{ lineId: invoice.lines[0].id, qty: 2, restock: true }],
        refundMethod: 'cash',
        reason: 'Second return',
        actor: owner,
        opId: 'op-return-b'
      })
    ).rejects.toThrow(/remain|exceed|quantity/i);
  });

  it('is idempotent for a repeated opId', async () => {
    const input = {
      invoiceId: invoice.id,
      lines: [{ lineId: invoice.lines[0].id, qty: 1, restock: true }],
      refundMethod: 'cash' as const,
      reason: 'Repeat click',
      actor: owner,
      opId: 'op-return-idem'
    };
    const first = await createReturn(input);
    const second = await createReturn(input);
    expect(second.id).toBe(first.id);
    const stock = await dbGet<Part>('parts', part.id);
    expect(stock?.qty).toBe(7);
  });
});

describe('purchases', () => {
  it('adds stock only when a purchase is received', async () => {
    const supplier = await createSupplier({ name: 'Pak Lubricants Depot' }, owner);
    const purchase = await createPurchase(
      {
        supplierId: supplier.id,
        lines: [{ partId: part.id, name: part.name, sku: part.sku, qty: 20, costPaisa: 50_000 }]
      },
      owner
    );

    expect(purchase.number).toBe('PO-0001');
    let stock = await dbGet<Part>('parts', part.id);
    expect(stock?.qty).toBe(6); // draft — unchanged

    await receivePurchase(purchase.id, owner);
    stock = await dbGet<Part>('parts', part.id);
    expect(stock?.qty).toBe(26);

    await expect(receivePurchase(purchase.id, owner)).rejects.toThrow(/already/i);
    const after = await dbGet<Part>('parts', part.id);
    expect(after?.qty).toBe(26);
  });

  it('tracks the supplier balance until the purchase is paid', async () => {
    const supplier = await createSupplier({ name: 'Parts House' }, owner);
    const purchase = await createPurchase(
      { supplierId: supplier.id, lines: [{ partId: part.id, name: part.name, sku: part.sku, qty: 2, costPaisa: 50_000 }] },
      owner
    );
    await receivePurchase(purchase.id, owner);

    const owed = await dbGet<{ balancePaisa: number }>('suppliers', supplier.id);
    expect(owed?.balancePaisa).toBe(100_000);

    const paid = await payPurchase(purchase.id, [{ method: 'bank', amountPaisa: 60_000 }], owner, 'op-po-pay');
    expect(paid.paidPaisa).toBe(60_000);
    const after = await dbGet<{ balancePaisa: number }>('suppliers', supplier.id);
    expect(after?.balancePaisa).toBe(40_000);
  });
});

describe('cash shift reconciliation', () => {
  it('computes the expected drawer from cash activity only', async () => {
    const shift = await openShift(500_000, 'Morning float', owner);

    await sell({
      customerId: customer.id,
      vehicleId: vehicle.id,
      lines: [{ kind: 'labor', name: 'Labour', qty: 1, ratePaisa: 200_000, taxRate: 0 }],
      payments: [{ method: 'cash', amountPaisa: 200_000 }],
      actor: owner,
      opId: 'op-shift-sale',
      shiftId: shift.id
    });
    await sell({
      customerId: customer.id,
      vehicleId: vehicle.id,
      lines: [{ kind: 'labor', name: 'Labour', qty: 1, ratePaisa: 300_000, taxRate: 0 }],
      payments: [{ method: 'card', amountPaisa: 300_000 }],
      actor: owner,
      opId: 'op-shift-card',
      shiftId: shift.id
    });

    const totals = await computeShiftTotals(shift);
    expect(totals.openingPaisa).toBe(500_000);
    expect(totals.cashSales).toBe(200_000);
    expect(totals.otherSales).toBe(300_000);
    expect(totals.expectedPaisa).toBe(700_000);

    const closed = await closeShift(shift.id, 690_000, 'Ten rupees short', owner);
    expect(closed.status).toBe('closed');
    expect(closed.variancePaisa).toBe(-10_000);
    expect(closed.countedPaisa).toBe(690_000);
  });

  it('refuses a second open shift for the same user', async () => {
    await openShift(100_000, '', owner);
    await expect(openShift(100_000, '', owner)).rejects.toThrow(/already have an open shift/i);
  });

  it('keeps invoices and shifts numbered independently', async () => {
    const shift = await openShift(0, '', owner);
    expect(shift.number).toBe('SH-0001');
    expect((await dbAll<Purchase>('purchases')).length).toBe(0);
  });
});
