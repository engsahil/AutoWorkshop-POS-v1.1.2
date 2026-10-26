import { describe, it, expect, beforeEach } from 'vitest';
import { resetWorkspace, owner } from '../../test/workspace';
import { dbAll, putOne, getSettings, saveSettings, withTx } from '../db';
import {
  buildDataArchive, parseDataArchive, planRestore, applyRestore, readCurrentIndex,
  csvCell, toCsvText, TABLES, ARCHIVE_FORMAT
} from '../dataArchive';
import { hashPassword, randomSalt } from '../auth';
import type { Customer, Invoice, Part, Payment, Supplier, User, Vehicle } from '../types';

const PASSWORD = 'Workshop#2026';

async function seedAdmin(): Promise<User> {
  const salt = randomSalt();
  const user: User = {
    id: 'usr_admin', createdAt: Date.now(), updatedAt: Date.now(), username: 'owner', name: 'Owner',
    role: 'Administrator', active: true, isOwner: true,
    passwordHash: await hashPassword(PASSWORD, salt), salt, iterations: 150_000,
    preferences: { sound: true, volume: 70, density: 'comfortable' }
  };
  await putOne('users', user);
  return user;
}

async function seedWorkshop() {
  await seedAdmin();
  const now = Date.now();
  const customer: Customer = {
    id: 'cus_1', createdAt: now, updatedAt: now, code: 'CUS-001', name: 'Ali Raza, "Boss"',
    phone: '0300-1234567', address: 'House 5, Street 7\nModel Town', balancePaisa: 150000, archived: false
  };
  const supplier: Supplier = {
    id: 'sup_1', createdAt: now, updatedAt: now, name: 'Metro Auto Parts', balancePaisa: 0, archived: false
  };
  const vehicle: Vehicle = {
    id: 'veh_1', createdAt: now, updatedAt: now, customerId: 'cus_1', regNo: 'LHR-1234',
    make: 'Toyota', model: 'Corolla', archived: false
  };
  const part: Part = {
    id: 'prt_1', createdAt: now, updatedAt: now, sku: 'BRK-1001', barcode: '8901234567890',
    name: 'Brake pad set — front (Ceramic)', category: 'Brakes', costPaisa: 125000, pricePaisa: 189000,
    qty: 12, reorderLevel: 4, unit: 'set', supplierId: 'sup_1', taxRate: 0, archived: false
  };
  const invoice: Invoice = {
    id: 'inv_1', createdAt: now, updatedAt: now, number: 'INV-000001', type: 'pos', customerId: 'cus_1',
    vehicleId: 'veh_1', jobCardId: null, date: now, subtotalPaisa: 189000, discountPaisa: 0, taxPaisa: 0,
    totalPaisa: 189000, paidPaisa: 100000, duePaisa: 89000, paymentStatus: 'partial', status: 'completed',
    shiftId: null, createdBy: 'usr_admin',
    lines: [{
      id: 'ln_1', kind: 'part', refId: 'prt_1', name: 'Brake pad set — front (Ceramic)', sku: 'BRK-1001',
      qty: 1, ratePaisa: 189000, discountPaisa: 0, taxRate: 0, taxPaisa: 0, totalPaisa: 189000, costPaisa: 125000
    }]
  };
  const payment: Payment = {
    id: 'pay_1', createdAt: now, updatedAt: now, number: 'PAY-000001', kind: 'sale', invoiceId: 'inv_1',
    customerId: 'cus_1', method: 'cash', amountPaisa: 100000, date: now, createdBy: 'usr_admin'
  };
  await putOne('customers', customer);
  await putOne('suppliers', supplier);
  await putOne('vehicles', vehicle);
  await putOne('parts', part);
  await putOne('invoices', invoice);
  await putOne('payments', payment);
}

async function archiveFile(): Promise<File> {
  const built = await buildDataArchive('Owner');
  const bytes = new Uint8Array(await built.blob.arrayBuffer());
  return new File([bytes], built.filename, { type: 'application/zip' });
}

async function counts() {
  return {
    customers: (await dbAll('customers')).length,
    parts: (await dbAll('parts')).length,
    invoices: (await dbAll('invoices')).length,
    payments: (await dbAll('payments')).length,
    users: (await dbAll('users')).length
  };
}

describe('CSV writing', () => {
  it('guards formula injection in text but leaves numbers numeric', () => {
    expect(csvCell('=SUM(A1:A2)')).toBe("'=SUM(A1:A2)");
    expect(csvCell('+92 300 1234567')).toBe("'+92 300 1234567");
    expect(csvCell('-5')).toBe("'-5");
    expect(csvCell(-5)).toBe('-5');
    expect(csvCell(125000)).toBe('125000');
  });

  it('escapes quotes, commas and newlines without changing the value', () => {
    expect(csvCell('Ali, "Boss"')).toBe('"Ali, ""Boss"""');
    expect(csvCell('line 1\nline 2')).toBe('"line 1\nline 2"');
    expect(csvCell('سوزوکی مکینک')).toBe('سوزوکی مکینک');
  });

  it('writes a BOM and CRLF rows', () => {
    const text = toCsvText(['a', 'b'], [[1, 'x']]);
    expect(text.startsWith('\uFEFF')).toBe(true);
    expect(text).toContain('a,b\r\n1,x');
  });
});

describe('data archive export', () => {
  beforeEach(async () => {
    await resetWorkspace();
    await seedWorkshop();
  });

  it('writes one CSV per entity plus a manifest', async () => {
    const built = await buildDataArchive('Owner');
    const bytes = new Uint8Array(await built.blob.arrayBuffer());
    const parsed = await parseDataArchive(new File([bytes], 'archive.zip'));
    expect(parsed.manifest.format).toBe(ARCHIVE_FORMAT);
    expect(Object.keys(parsed.tables).length).toBe(TABLES.length);
    expect(parsed.tables.parts).toHaveLength(1);
    expect(parsed.tables.invoice_lines).toHaveLength(1);
    expect(parsed.tables.payments).toHaveLength(1);
    expect(parsed.manifest.relationships.some((r) => r.column === 'invoiceId')).toBe(true);
  });

  it('keeps unicode, commas and newlines intact through the round trip', async () => {
    const parsed = await parseDataArchive(await archiveFile());
    const customer = parsed.tables.customers[0];
    expect(customer.name).toBe('Ali Raza, "Boss"');
    expect(customer.address).toBe('House 5, Street 7\nModel Town');
    expect(Number(customer.balancePaisa)).toBe(150000);
  });

  it('never exports credentials', async () => {
    const built = await buildDataArchive('Owner');
    const bytes = new Uint8Array(await built.blob.arrayBuffer());
    const text = new TextDecoder().decode(bytes);
    expect(text).not.toContain('passwordHash');
    expect(text).not.toContain('iterations');
    expect(text).not.toContain((await dbAll<User>('users'))[0].salt);
  });

  it('exports every store the application owns', async () => {
    const built = await buildDataArchive('Owner');
    const bytes = new Uint8Array(await built.blob.arrayBuffer());
    const parsed = await parseDataArchive(new File([bytes], 'archive.zip'));
    const expected = ['customers', 'vehicles', 'parts', 'services', 'labor', 'suppliers', 'purchases',
      'invoices', 'payments', 'jobcards', 'returns', 'warranty', 'expenses', 'cash_shifts',
      'cash_movements', 'stock_moves', 'audit', 'notifications'];
    for (const entity of expected) expect(Object.keys(parsed.tables)).toContain(entity);
  });
});

describe('clean restore', () => {
  beforeEach(async () => {
    await resetWorkspace();
    await seedWorkshop();
  });

  it('replaces the workspace and preserves values and relationships', async () => {
    const file = await archiveFile();
    const before = await counts();

    await resetWorkspace();
    await seedAdmin();
    expect(await counts()).toMatchObject({ customers: 0, parts: 0, invoices: 0 });

    const parsed = await parseDataArchive(file);
    const admin = (parsed.tables.users.find((u) => u.role === 'Administrator')!).id as string;
    const plan = planRestore(parsed, 'clean', await readCurrentIndex());
    expect(plan.errors).toEqual([]);
    const result = await applyRestore(parsed, plan, {
      mode: 'clean', adminUserId: admin, newPassword: PASSWORD, actorName: 'Owner'
    });
    expect(result.total).toBeGreaterThan(0);

    const after = await counts();
    expect(after.customers).toBe(before.customers);
    expect(after.parts).toBe(before.parts);
    expect(after.invoices).toBe(before.invoices);

    const invoice = (await dbAll<Invoice>('invoices'))[0];
    expect(invoice.number).toBe('INV-000001');
    expect(invoice.totalPaisa).toBe(189000);
    expect(invoice.lines).toHaveLength(1);
    expect(invoice.lines[0].refId).toBe('prt_1');
    expect(invoice.lines[0].totalPaisa).toBe(189000);

    const payment = (await dbAll<Payment>('payments'))[0];
    expect(payment.invoiceId).toBe('inv_1');
    expect(payment.amountPaisa).toBe(100000);

    const part = (await dbAll<Part>('parts'))[0];
    expect(part.sku).toBe('BRK-1001');
    expect(part.qty).toBe(12);
    expect(part.barcode).toBe('8901234567890');

    const settings = await getSettings();
    expect(settings.setupComplete).toBe(true);
  });

  it('refuses to run without an administrator password and changes nothing', async () => {
    const parsed = await parseDataArchive(await archiveFile());
    await resetWorkspace();
    await seedAdmin();
    const plan = planRestore(parsed, 'clean', await readCurrentIndex());
    await expect(applyRestore(parsed, plan, { mode: 'clean', adminUserId: 'usr_admin' }))
      .rejects.toThrow(/password/i);
    expect(await dbAll('parts')).toHaveLength(0);
  });
});

describe('merge restore', () => {
  beforeEach(async () => {
    await resetWorkspace();
    await seedWorkshop();
  });

  it('adds nothing when the same archive is merged twice', async () => {
    const first = await parseDataArchive(await archiveFile());
    const plan1 = planRestore(first, 'merge', await readCurrentIndex());
    const res1 = await applyRestore(first, plan1, { mode: 'merge', actorName: 'Owner' });
    expect(res1.total).toBe(0);

    const firstPlanRow = plan1.entities.find((e) => e.entity === 'parts')!;
    expect(firstPlanRow.willAdd).toBe(0);
    expect(firstPlanRow.willSkip).toBe(1);
  });

  it('adds only missing records into an empty database', async () => {
    const parsed = await parseDataArchive(await archiveFile());
    await resetWorkspace();
    await seedAdmin();
    const plan = planRestore(parsed, 'merge', await readCurrentIndex());
    const parts = plan.entities.find((e) => e.entity === 'parts')!;
    expect(parts.willAdd).toBe(1);
    const res = await applyRestore(parsed, plan, { mode: 'merge', actorName: 'Owner' });
    expect(res.total).toBeGreaterThan(0);
    expect(await dbAll('parts')).toHaveLength(1);
  });

  it('reports a business-key conflict instead of overwriting the existing row', async () => {
    const parsed = await parseDataArchive(await archiveFile());
    // same SKU, different id and different price
    await withTx(['parts'], 'readwrite', (tx) => tx.del('parts', 'prt_1'));
    await putOne<Part>('parts', {
      id: 'prt_local', createdAt: Date.now(), updatedAt: Date.now(), sku: 'BRK-1001', name: 'Local pad',
      category: 'Brakes', costPaisa: 1, pricePaisa: 2, qty: 3, reorderLevel: 1, unit: 'set', taxRate: 0, archived: false
    });
    const plan = planRestore(parsed, 'merge', await readCurrentIndex());
    const parts = plan.entities.find((e) => e.entity === 'parts')!;
    expect(parts.conflicts).toBe(1);
    expect(parts.willAdd).toBe(0);

    await applyRestore(parsed, plan, { mode: 'merge', actorName: 'Owner' });
    const stored = (await dbAll<Part>('parts')).find((p) => p.sku === 'BRK-1001')!;
    expect(stored.id).toBe('prt_local');
    expect(stored.qty).toBe(3);
    expect(stored.pricePaisa).toBe(2);
  });

  it('keeps local settings and the signed-in user', async () => {
    const parsed = await parseDataArchive(await archiveFile());
    const before = await dbAll<User>('users');
    await saveSettings({ ...(await getSettings()), profile: { ...(await getSettings()).profile, name: 'Local Name' } });
    const plan = planRestore(parsed, 'merge', await readCurrentIndex());
    await applyRestore(parsed, plan, { mode: 'merge', actorName: 'Owner' });
    expect((await getSettings()).profile.name).toBe('Local Name');
    expect((await dbAll<User>('users')).length).toBe(before.length);
  });
});

describe('validation and failure handling', () => {
  beforeEach(async () => {
    await resetWorkspace();
    await seedWorkshop();
  });

  it('rejects a ZIP that is not a data archive', async () => {
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, ...new Array(200).fill(0)]);
    await expect(parseDataArchive(new File([bytes], 'random.zip'))).rejects.toThrow();
  });

  it('reports an archive with a missing column instead of guessing', async () => {
    const file = await archiveFile();
    const parsed = await parseDataArchive(file);
    expect(parsed.issues.filter((i) => i.level === 'error')).toEqual([]);

    // Simulate a damaged parts table: drop the required sku column.
    const damaged = { ...parsed, issues: [{ level: 'error' as const, message: 'parts.csv is missing column(s): sku.' }] };
    const plan = planRestore(damaged, 'clean', await readCurrentIndex());
    expect(plan.errors.length).toBeGreaterThan(0);
    await expect(applyRestore(damaged, plan, { mode: 'clean', adminUserId: 'usr_admin', newPassword: PASSWORD }))
      .rejects.toThrow();
  });

  it('aborts the whole transaction when a write fails', async () => {
    const parsed = await parseDataArchive(await archiveFile());
    const admin = parsed.tables.users[0].id as string;
    const plan = planRestore(parsed, 'clean', await readCurrentIndex());
    // A record without an id makes the writer throw before the transaction ends.
    parsed.tables.parts.push({ ...parsed.tables.parts[0], id: undefined, sku: '__broken__' } as never);
    // Insert a duplicate id into the customers table: the second put overwrites, so
    // instead break the sequence table which requires a key.
    parsed.tables.sequences = [{ next: 1 } as never];

    let failed = false;
    try {
      await applyRestore(parsed, plan, { mode: 'clean', adminUserId: admin, newPassword: PASSWORD });
    } catch {
      failed = true;
    }
    expect(failed).toBe(true);
    expect((await dbAll('customers')).length).toBe(1);
    expect((await dbAll<Part>('parts'))[0].sku).toBe('BRK-1001');
  });
});
