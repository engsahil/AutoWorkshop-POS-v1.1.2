import { describe, it, expect, beforeEach } from 'vitest';
import { resetWorkspace, owner } from '../../test/workspace';
import { createCustomer, createPart, createVehicle } from '../repo';
import { sell, computeInvoice, payInvoice } from '../transactions';
import { dbGet, dbAll } from '../db';
import type { Customer, Invoice, Part, Vehicle } from '../types';

let customer: Customer;
let vehicle: Vehicle;
let part: Part;

beforeEach(async () => {
  await resetWorkspace();
  customer = await createCustomer({ name: 'Ahmed Raza', phone: '0300 111 2233' }, owner);
  vehicle = await createVehicle({ customerId: customer.id, regNo: 'LEB-1234', make: 'Toyota', model: 'Corolla' }, owner);
  part = await createPart({ name: 'Brake Pad Set', sku: 'BRK-001', costPaisa: 300_000, pricePaisa: 600_000, qty: 10 }, owner);
});

describe('computeInvoice', () => {
  it('adds tax on the discounted base and keeps paisa integral', () => {
    const c = computeInvoice([{ kind: 'part', refId: part.id, name: part.name, qty: 2, ratePaisa: 600_000, taxRate: 17, discountPaisa: 50_000 }]);
    expect(c.subtotalPaisa).toBe(1_150_000);
    expect(c.taxPaisa).toBe(195_500);
    expect(c.totalPaisa).toBe(1_345_500);
    expect(c.lines[0].qty).toBe(2);
  });

  it('rejects an empty basket instead of producing a zero invoice', () => {
    expect(() => computeInvoice([])).toThrow(/at least one item/i);
  });

  it('caps a line discount at the line value', () => {
    const c = computeInvoice([{ kind: 'labor', name: 'Labour', qty: 1, ratePaisa: 1000, taxRate: 0, discountPaisa: 5000 }]);
    expect(c.subtotalPaisa).toBe(0);
  });
});

describe('sell', () => {
  it('numbers the first invoice 000001 and deducts stock once', async () => {
    const inv = await sell({
      customerId: customer.id,
      vehicleId: vehicle.id,
      lines: [{ kind: 'part', refId: part.id, name: part.name, qty: 3, ratePaisa: 600_000, taxRate: 0 }],
      payments: [{ method: 'cash', amountPaisa: 1_800_000 }],
      actor: owner,
      opId: 'op-sale-1'
    });

    expect(inv.number).toBe('INV-000001');
    expect(inv.totalPaisa).toBe(1_800_000);
    expect(inv.paidPaisa).toBe(1_800_000);
    expect(inv.paymentStatus).toBe('paid');

    const stock = await dbGet<Part>('parts', part.id);
    expect(stock?.qty).toBe(7);

    const moves = await dbAll('stockMoves' as never) as Array<{ refId?: string; qty: number }>;
    const saleMoves = moves.filter((m) => m.refId === inv.id);
    expect(saleMoves).toHaveLength(1);
    expect(saleMoves[0].qty).toBe(-3);

    const updated = await dbGet<Customer>('customers', customer.id);
    expect(updated?.balancePaisa).toBe(0);
  });

  it('is idempotent for a repeated opId', async () => {
    const input = {
      customerId: customer.id,
      vehicleId: vehicle.id,
      lines: [{ kind: 'part' as const, refId: part.id, name: part.name, qty: 1, ratePaisa: 600_000, taxRate: 0 }],
      payments: [{ method: 'cash' as const, amountPaisa: 600_000 }],
      actor: owner,
      opId: 'op-repeat'
    };
    const first = await sell(input);
    const second = await sell(input);

    expect(second.id).toBe(first.id);
    const stock = await dbGet<Part>('parts', part.id);
    expect(stock?.qty).toBe(9); // deducted once only
    const invoices = await dbAll<Invoice>('invoices');
    expect(invoices).toHaveLength(1);
  });

  it('refuses to oversell when negative stock is disabled', async () => {
    await expect(
      sell({
        customerId: customer.id,
        vehicleId: vehicle.id,
        lines: [{ kind: 'part', refId: part.id, name: part.name, qty: 11, ratePaisa: 600_000, taxRate: 0 }],
        payments: [{ method: 'cash', amountPaisa: 6_600_000 }],
        actor: owner,
        opId: 'op-oversell'
      })
    ).rejects.toThrow(/stock/i);

    const stock = await dbGet<Part>('parts', part.id);
    expect(stock?.qty).toBe(10);
  });

  it('records a partial payment and leaves the balance on the customer', async () => {
    const inv = await sell({
      customerId: customer.id,
      vehicleId: vehicle.id,
      lines: [{ kind: 'service', name: 'General Service', qty: 1, ratePaisa: 1_000_000, taxRate: 0 }],
      payments: [{ method: 'cash', amountPaisa: 400_000 }],
      actor: owner,
      opId: 'op-partial'
    });

    expect(inv.paymentStatus).toBe('partial');
    expect(inv.duePaisa).toBe(600_000);

    const owed = await dbGet<Customer>('customers', customer.id);
    expect(owed?.balancePaisa).toBe(600_000);

    const settled = await payInvoice(inv.id, [{ method: 'card', amountPaisa: 600_000 }], owner, 'op-pay-1');
    expect(settled.paymentStatus).toBe('paid');
    expect(settled.duePaisa).toBe(0);

    const cleared = await dbGet<Customer>('customers', customer.id);
    expect(cleared?.balancePaisa).toBe(0);
  });

  it('rejects a payment larger than the invoice total', async () => {
    await expect(
      sell({
        customerId: customer.id,
        vehicleId: vehicle.id,
        lines: [{ kind: 'labor', name: 'Labour', qty: 1, ratePaisa: 100_000, taxRate: 0 }],
        payments: [{ method: 'cash', amountPaisa: 200_000 }],
        actor: owner,
        opId: 'op-overpay'
      })
    ).rejects.toThrow(/exceed/i);
  });

  it('keeps separate sequences for invoices and job cards', async () => {
    await sell({
      customerId: customer.id,
      vehicleId: vehicle.id,
      lines: [{ kind: 'labor', name: 'Labour', qty: 1, ratePaisa: 100_000, taxRate: 0 }],
      payments: [],
      actor: owner,
      opId: 'op-seq-1'
    });
    const second = await sell({
      customerId: customer.id,
      vehicleId: vehicle.id,
      lines: [{ kind: 'labor', name: 'Labour', qty: 1, ratePaisa: 100_000, taxRate: 0 }],
      payments: [],
      actor: owner,
      opId: 'op-seq-2'
    });
    expect(second.number).toBe('INV-000002');
  });
});
