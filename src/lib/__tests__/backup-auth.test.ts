import { describe, it, expect, beforeEach } from 'vitest';
import { resetWorkspace, owner } from '../../test/workspace';
import { createCustomer, createPart, createUser, createVehicle, createSupplier } from '../repo';
import { sell } from '../transactions';
import { buildBackup, validateBackup, importBackup, sanitizeUser } from '../backup';
import { dbAll, dbCount, dbGet } from '../db';
import type { Customer, Invoice, Part } from '../types';

beforeEach(async () => {
  await resetWorkspace();
  const customer = await createCustomer({ name: 'Ayesha Butt', phone: '0301 556 7788' }, owner);
  const vehicle = await createVehicle({ customerId: customer.id, regNo: 'LEC-2211', make: 'Honda', model: 'City' }, owner);
  const part = await createPart({ name: 'Battery 55Ah', sku: 'BAT-55', costPaisa: 2_050_000, pricePaisa: 2_680_000, qty: 5 }, owner);
  await createSupplier({ name: 'Al-Madina Auto Parts' }, owner);
  // A real workspace always has accounts; create the administrator that a
  // restore is required to find inside the file.
  await createUser(
    { name: 'Ahmed Raza', username: 'admin', password: 'Servixa#2026', role: 'Administrator' },
    owner
  );
  await sell({
    customerId: customer.id,
    vehicleId: vehicle.id,
    lines: [{ kind: 'part', refId: part.id, name: part.name, qty: 1, ratePaisa: 2_680_000, taxRate: 0 }],
    payments: [{ method: 'card', amountPaisa: 2_680_000 }],
    actor: owner,
    opId: 'op-backup-sale'
  });
});

describe('backup export', () => {
  it('collects business records and reports counts', async () => {
    const file = await buildBackup('Owner');
    expect(file.manifest.counts.invoices).toBe(1);
    expect(file.manifest.counts.customers).toBe(1);
    expect(file.manifest.counts.parts).toBe(1);
    expect(file.manifest.lastInvoiceNumber).toBe('INV-000001');
    expect(file.data.sequences.length).toBeGreaterThan(0);
  });

  it('never includes password hashes, salts or session tokens', async () => {
    // a second account with its own credentials, so there is a hash to leak
    await createUser(
      { name: 'Cashier One', username: 'cashier1', password: 'Servixa#2026', role: 'Cashier' },
      owner
    );
    const file = await buildBackup('Owner');
    const serialised = JSON.stringify(file);

    expect(serialised).not.toMatch(/passwordHash/i);
    expect(serialised).not.toMatch(/"salt"/i);
    expect(serialised).not.toMatch(/iterations/i);
    expect(serialised).not.toMatch(/Servixa#2026/);

    for (const user of file.data.users) {
      expect(user).not.toHaveProperty('passwordHash');
      expect(user).not.toHaveProperty('salt');
    }
    expect(file.data.users.some((u) => u.username === 'cashier1')).toBe(true);
  });

  it('sanitizeUser keeps identity fields but drops credentials', () => {
    const sanitised = sanitizeUser({
      id: 'usr_1', createdAt: 1, updatedAt: 2, username: 'admin', name: 'Admin', role: 'Administrator',
      passwordHash: 'deadbeef', salt: 'abc', iterations: 150000, active: true, isOwner: true
    } as never);
    expect(sanitised.username).toBe('admin');
    expect(sanitised).not.toHaveProperty('passwordHash');
    expect(sanitised).not.toHaveProperty('salt');
  });
});

describe('backup validation', () => {
  it('accepts a freshly exported file', async () => {
    const result = await validateBackup(await buildBackup('Owner'));
    expect(result.issues.filter((i) => i.level === 'error')).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('rejects a file with a broken checksum', async () => {
    const file = await buildBackup('Owner');
    (file.data.parts as Part[])[0].pricePaisa = 1;
    const result = await validateBackup(file);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => /checksum/i.test(i.message))).toBe(true);
  });

  it('rejects a file that is not a Servixa backup', async () => {
    const result = await validateBackup({ hello: 'world' });
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => /not a Servixa backup/i.test(i.message))).toBe(true);
  });

  it('rejects dangling references', async () => {
    const file = await buildBackup('Owner');
    (file.data.invoices as Invoice[])[0].customerId = 'cus_does_not_exist';
    // re-sign so the failure is referential, not checksum
    const { sha256Hex } = await import('../backup');
    file.checksum = await sha256Hex(JSON.stringify(file.data));
    const result = await validateBackup(file);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => /invoice customer/i.test(i.message))).toBe(true);
  });

  it('rejects a backup from a newer app version', async () => {
    const file = await buildBackup('Owner');
    file.version = 99;
    const result = await validateBackup(file);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => /newer than this app/i.test(i.message))).toBe(true);
  });
});

describe('backup restore', () => {
  it('replaces the workspace atomically and keeps the records', async () => {
    const file = await buildBackup('Owner');
    const result = await validateBackup(file);
    expect(result.ok).toBe(true);

    // The restoring account must exist inside the backup file.
    const admin = file.data.users.find((u) => u.role === 'Administrator');
    expect(admin?.id).toBeTruthy();
    await importBackup(result, { adminUserId: admin!.id!, newPassword: 'Servixa#2027', actorName: 'Owner' });

    expect(await dbCount('invoices')).toBe(1);
    expect(await dbCount('customers')).toBe(1);
    const restored = await dbAll<Customer>('customers');
    expect(restored[0].name).toBe('Ayesha Butt');
    const invoice = await dbGet<Invoice>('invoices', (await dbAll<Invoice>('invoices'))[0].id);
    expect(invoice?.number).toBe('INV-000001');
  });

  it('refuses to restore with a password that breaks the rules', async () => {
    const result = await validateBackup(await buildBackup('Owner'));
    await expect(
      importBackup(result, { adminUserId: owner.id, newPassword: 'short' })
    ).rejects.toThrow(/password/i);
  });

  it('rejects an invalid backup before touching existing data', async () => {
    const bad = await validateBackup({ nonsense: true });
    await expect(
      importBackup(bad, { adminUserId: owner.id, newPassword: 'Servixa#2027' })
    ).rejects.toThrow(/validation/i);
    // existing data untouched
    expect(await dbCount('invoices')).toBe(1);
  });
});
