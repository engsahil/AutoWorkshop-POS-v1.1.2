/**
 * Repository: validation, numbering, notifications, audit and CRUD for master data.
 * Financial/idempotent operations live in transactions.ts.
 */
import { DEFAULT_SETTINGS, getSettings, saveSettings as persistSettings, STORE_NAMES, withTx, type StoreName, type Tx } from './db';
import { hashPassword, passwordIssues, randomSalt } from './auth';
import { pad, uid } from './ids';
import { todayISO } from './money';
import type {
  AppNotification, AppSettings, AuditEvent, CashMovement, Customer, JobCard, MetaRecord,
  NotificationType, Part, Permission, PublicUser, Sequence, Service, Labor, Supplier, Vehicle, Warranty,
  User
} from './types';

export interface Actor {
  id: string;
  name: string;
  role?: string;
}

export class ValidationError extends Error {}
export class PermissionError extends Error {}
export class ConflictError extends Error {}

/* ------------------------------ tx plumbing ------------------------------- */
const BASE_WRITE: StoreName[] = ['meta', 'settings', 'audit', 'notifications'];

/**
 * Runs a write transaction.
 *
 * `stores` documents which records the caller touches, and is kept for
 * readability and future narrowing. The transaction is nevertheless opened
 * across every store: IndexedDB throws `NotFoundError` when a callback reads a
 * store the transaction did not declare, and a single missed declaration would
 * abort an otherwise valid sale. Servixa is a single-user local application, so
 * the extra scope costs nothing measurable and removes a whole class of
 * data-integrity bugs. Reads still use narrow, explicit transactions.
 */
export async function mutate<T>(_stores: StoreName[], fn: (tx: Tx) => Promise<T>): Promise<T> {
  return withTx([...STORE_NAMES], 'readwrite', fn);
}

export async function nextNumber(tx: Tx, key: string): Promise<string> {
  const seq = await tx.get<Sequence>('sequences', key);
  if (!seq) throw new ValidationError(`Missing document sequence "${key}".`);
  const value = seq.next;
  await tx.put('sequences', { ...seq, next: seq.next + 1, updatedAt: Date.now() });
  return `${seq.prefix}${pad(value, seq.padding)}`;
}

export async function audit(
  tx: Tx,
  action: AuditEvent['action'],
  entity: string,
  entityId: string,
  summary: string,
  actor?: Actor,
  meta?: Record<string, unknown>
) {
  await tx.put('audit', {
    id: uid('aud'),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    action,
    entity,
    entityId,
    summary,
    userId: actor?.id ?? 'system',
    userName: actor?.name ?? 'System',
    ...(meta ? { meta } : {})
  });
}

export async function notify(
  tx: Tx,
  type: NotificationType,
  title: string,
  message: string,
  link?: string
): Promise<void> {
  const settings = await readSettings(tx);
  const prefs = settings.notifications;
  const gate: Partial<Record<NotificationType, boolean>> = {
    low_stock: prefs.lowStock,
    sale: prefs.sales,
    payment: prefs.sales,
    job_assigned: prefs.jobs,
    job_ready: prefs.jobs,
    warranty_expiry: prefs.warranty,
    shift_warning: prefs.shift,
    purchase_received: prefs.lowStock
  };
  if (gate[type] === false) return;
  const record: AppNotification = {
    id: uid('ntf'),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    type,
    title,
    message,
    link,
    read: false
  };
  await tx.put('notifications', record);
}

/**
 * Settings snapshot for notification gating.
 *
 * A write transaction that does not include the `settings` store cannot read it.
 * Instead of opening a second transaction (which can auto-commit the first), we
 * keep a process-level snapshot refreshed by getSettings/updateSettings.
 */
let settingsSnapshot: AppSettings | null = null;

export function primeSettingsSnapshot(next: AppSettings) {
  settingsSnapshot = next;
}

async function readSettings(tx: Tx): Promise<AppSettings> {
  try {
    const rec = await tx.get<{ key: string; value: AppSettings }>('settings', 'app');
    if (rec) {
      settingsSnapshot = rec.value;
      return rec.value;
    }
  } catch {
    /* store not part of this transaction — use the snapshot */
  }
  return settingsSnapshot ?? DEFAULT_SETTINGS;
}

/* ------------------------------- bootstrap -------------------------------- */

export async function hasAnyUser(): Promise<boolean> {
  const count = await withTx(['users'], 'readonly', (tx) => tx.count('users'));
  return count > 0;
}

export interface SetupInput {
  fullName: string;
  username: string;
  password: string;
  confirmPassword: string;
  businessName?: string;
}

export async function createInitialAdmin(input: SetupInput): Promise<PublicUser> {
  const fullName = input.fullName.trim();
  const username = input.username.trim().toLowerCase();
  if (fullName.length < 2) throw new ValidationError('Enter your full name.');
  if (!/^[a-z0-9._-]{3,32}$/.test(username)) throw new ValidationError('Username must be 3–32 characters (letters, numbers, dot, dash, underscore).');
  if (input.password !== input.confirmPassword) throw new ValidationError('Passwords do not match.');

  const settings = await getSettings();
  const issues = passwordIssues(input.password, settings.security);
  if (issues.length) throw new ValidationError(issues.join(' · '));

  const salt = randomSalt();
  const passwordHash = await hashPassword(input.password, salt);

  const user = await mutate(['users', 'settings', 'audit', 'notifications'], async (tx) => {
    const existing = await tx.count('users');
    if (existing > 0) throw new ConflictError('Setup has already been completed on this device. Sign in instead.');
    const now = Date.now();
    const owner: User = {
      id: uid('usr'),
      createdAt: now,
      updatedAt: now,
      username,
      name: fullName,
      role: 'Administrator',
      active: true,
      isOwner: true,
      passwordHash,
      salt,
      iterations: 150_000,
      preferences: { sound: true, volume: 70, density: 'comfortable' }
    };
    await tx.put('users', owner);
    const record = await tx.get<{ key: string; value: AppSettings }>('settings', 'app');
    const base = record?.value ?? settings;
    const next: AppSettings = {
      ...base,
      setupComplete: true,
      profile: {
        ...base.profile,
        name: input.businessName?.trim() || base.profile.name || 'Servixa Auto Workshop'
      }
    };
    await tx.put('settings', { key: 'app', value: next });
    await audit(tx, 'setup', 'user', owner.id, `Initial administrator "${owner.username}" created`, { id: owner.id, name: owner.name });
    await tx.put('meta', {
      key: 'setup.completedAt',
      value: now
    } satisfies MetaRecord);
    await notify(tx, 'system', 'Welcome to Servixa', 'Initial setup is complete. Open Settings to add your business details.', '/settings');
    return publicUser(owner);
  });
  return user;
}

/* -------------------------------- settings -------------------------------- */

export async function updateSettings(next: AppSettings, actor: Actor): Promise<void> {
  primeSettingsSnapshot(next);
  await mutate(['settings', 'sequences', 'audit'], async (tx) => {
    await tx.put('settings', { key: 'app', value: next });
    // Keep number sequences in sync with document settings without resetting counters.
    const seqKeys: [string, string, number][] = [
      ['invoice', next.documents.invoicePrefix, next.documents.invoicePadding],
      ['job', next.documents.jobPrefix, 4],
      ['purchase', next.documents.purchasePrefix, 4],
      ['return', next.documents.returnPrefix, 4],
      ['shift', next.documents.shiftPrefix, 4],
      ['warranty', next.documents.warrantyPrefix, 4]
    ];
    for (const [key, prefix, padding] of seqKeys) {
      const seq = await tx.get<Sequence>('sequences', key);
      if (!seq) continue;
      if (seq.prefix !== prefix || seq.padding !== padding) {
        await tx.put('sequences', { ...seq, prefix, padding, updatedAt: Date.now() });
      }
    }
    await audit(tx, 'settings.update', 'settings', 'app', 'Application settings updated', actor);
  });
}

export async function getSequences(): Promise<Sequence[]> {
  return withTx(['sequences'], 'readonly', (tx) => tx.all<Sequence>('sequences'));
}

export async function updateSequences(sequences: Sequence[], actor: Actor): Promise<void> {
  await mutate(['sequences', 'audit'], async (tx) => {
    for (const seq of sequences) {
      if (seq.next < 1) throw new ValidationError('Next number must be at least 1.');
      if (seq.padding < 3 || seq.padding > 10) throw new ValidationError('Padding must be between 3 and 10 digits.');
      await tx.put('sequences', { ...seq, updatedAt: Date.now() });
    }
    await audit(tx, 'settings.update', 'sequence', 'all', 'Document numbering sequences updated', actor);
  });
}

/* ---------------------------------- users --------------------------------- */

export function publicUser(user: User): PublicUser {
  const { passwordHash: _hash, salt: _salt, iterations: _iterations, ...rest } = user;
  return rest;
}

export async function listUsers(): Promise<PublicUser[]> {
  const users = await withTx(['users'], 'readonly', (tx) => tx.all<User>('users'));
  return users.map(publicUser).sort((a, b) => a.name.localeCompare(b.name));
}

export interface NewUserInput {
  name: string;
  username: string;
  password: string;
  role: User['role'];
  email?: string;
  phone?: string;
}

/** Finds a code that is not yet used in the given store (unique index). */
async function uniqueCode(tx: Tx, store: StoreName, index: string, prefix: string, base: number): Promise<string> {
  let n = base;
  for (let guard = 0; guard < 500; guard++) {
    const candidate = `${prefix}-${String(n % 100000).padStart(5, '0')}`;
    const clash = await tx.by<Record<string, unknown>>(store, index, candidate);
    if (!clash.length) return candidate;
    n++;
  }
  return `${prefix}-${uid('').slice(-6).toUpperCase()}`;
}

export async function createUser(input: NewUserInput, actor: Actor): Promise<PublicUser> {
  const username = input.username.trim().toLowerCase();
  if (input.name.trim().length < 2) throw new ValidationError('Enter the staff member’s name.');
  if (!/^[a-z0-9._-]{3,32}$/.test(username)) throw new ValidationError('Username must be 3–32 characters (letters, numbers, dot, dash, underscore).');
  const settings = await getSettings();
  const issues = passwordIssues(input.password, settings.security);
  if (issues.length) throw new ValidationError(issues.join(' · '));
  const salt = randomSalt();
  const passwordHash = await hashPassword(input.password, salt);

  return mutate(['users', 'audit'], async (tx) => {
    const existing = await tx.by<User>('users', 'username', username);
    if (existing.length) throw new ConflictError('That username is already in use.');
    const now = Date.now();
    const user: User = {
      id: uid('usr'), createdAt: now, updatedAt: now, username,
      name: input.name.trim(), role: input.role, email: input.email?.trim(), phone: input.phone?.trim(),
      active: true, passwordHash, salt, iterations: 150_000,
      preferences: { sound: true, volume: 70, density: 'comfortable' }
    };
    await tx.put('users', user);
    await audit(tx, 'user.create', 'user', user.id, `Staff account created for ${user.name} (${user.role})`, actor);
    return publicUser(user);
  });
}

export async function updateUser(id: string, patch: Partial<Pick<User, 'name' | 'email' | 'phone' | 'role' | 'active' | 'avatar'>>, actor: Actor): Promise<User> {
  return mutate(['users', 'audit'], async (tx) => {
    const user = await tx.get<User>('users', id);
    if (!user) throw new ValidationError('Account not found.');
    if (patch.role && patch.role !== user.role) {
      const all = await tx.all<User>('users');
      const admins = all.filter((u) => u.role === 'Administrator' && u.active);
      if (user.role === 'Administrator' && admins.length <= 1) throw new ValidationError('At least one active administrator must remain.');
      if (user.isOwner && patch.role !== 'Administrator') throw new ValidationError('The account owner must remain an administrator.');
    }
    if (patch.active === false && user.isOwner) throw new ValidationError('The account owner cannot be deactivated.');
    const next: User = { ...user, ...patch, updatedAt: Date.now() };
    await tx.put('users', next);
    await audit(tx, 'user.update', 'user', id, `Account "${user.username}" updated`, actor);
    return next;
  });
}

export async function resetUserPassword(id: string, password: string, actor: Actor): Promise<void> {
  const settings = await getSettings();
  const issues = passwordIssues(password, settings.security);
  if (issues.length) throw new ValidationError(issues.join(' · '));
  const salt = randomSalt();
  const passwordHash = await hashPassword(password, salt);
  await mutate(['users', 'audit'], async (tx) => {
    const user = await tx.get<User>('users', id);
    if (!user) throw new ValidationError('Account not found.');
    await tx.put('users', { ...user, salt, passwordHash, iterations: 150_000, updatedAt: Date.now() });
    await audit(tx, 'user.update', 'user', id, `Password reset for "${user.username}"`, actor);
  });
}

export async function updateOwnProfile(id: string, patch: { name?: string; email?: string; phone?: string; avatar?: string | null; preferences?: Partial<User['preferences']> }, actor: Actor): Promise<User> {
  return mutate(['users', 'audit'], async (tx) => {
    const user = await tx.get<User>('users', id);
    if (!user) throw new ValidationError('Account not found.');
    if (user.id !== actor.id && actor.role !== 'Administrator') throw new PermissionError('You can only edit your own profile.');
    const next: User = {
      ...user,
      ...('name' in patch ? { name: patch.name?.trim() || user.name } : {}),
      ...('email' in patch ? { email: patch.email?.trim() } : {}),
      ...('phone' in patch ? { phone: patch.phone?.trim() } : {}),
      ...('avatar' in patch ? { avatar: patch.avatar ?? null } : {}),
      ...(patch.preferences ? { preferences: { ...user.preferences, ...patch.preferences } } : {}),
      updatedAt: Date.now()
    };
    await tx.put('users', next);
    await audit(tx, 'user.update', 'user', id, `${user.name} updated their profile`, actor);
    return next;
  });
}

/* -------------------------------- customers -------------------------------- */

export async function createCustomer(input: Partial<Customer>, actor: Actor): Promise<Customer> {
  if (!input.name?.trim()) throw new ValidationError('Customer name is required.');
  if (!input.phone?.trim()) throw new ValidationError('Phone number is required.');
  return mutate(['customers', 'sequences', 'audit'], async (tx) => {
    const code = await nextNumber(tx, 'customer');
    const now = Date.now();
    const customer: Customer = {
      id: uid('cus'), createdAt: now, updatedAt: now, code,
      name: input.name!.trim(), phone: input.phone!.trim(), email: input.email?.trim(),
      address: input.address?.trim(), cnic: input.cnic?.trim(), notes: input.notes?.trim(),
      balancePaisa: 0, archived: false
    };
    await tx.put('customers', customer);
    await audit(tx, 'customer.update', 'customer', customer.id, `Customer "${customer.name}" created`, actor);
    return customer;
  });
}

export async function updateCustomer(id: string, patch: Partial<Customer>, actor: Actor): Promise<Customer> {
  return mutate(['customers', 'audit'], async (tx) => {
    const customer = await tx.get<Customer>('customers', id);
    if (!customer) throw new ValidationError('Customer not found.');
    const next: Customer = { ...customer, ...patch, id, balancePaisa: customer.balancePaisa, updatedAt: Date.now() };
    if (!next.name.trim()) throw new ValidationError('Customer name is required.');
    if (!next.phone.trim()) throw new ValidationError('Phone number is required.');
    await tx.put('customers', next);
    await audit(tx, 'customer.update', 'customer', id, `Customer "${next.name}" updated`, actor);
    return next;
  });
}

/** Recomputes the customer's outstanding balance from invoices, payments and returns. */
export async function recomputeCustomerBalance(tx: Tx, customerId: string): Promise<number> {
  const invoices = await tx.by<import('./types').Invoice>('invoices', 'customerId', customerId);
  const payments = await tx.by<import('./types').Payment>('payments', 'customerId', customerId);
  const returns = await tx.by<import('./types').ReturnDoc>('returns', 'customerId', customerId);
  let balance = 0;
  for (const inv of invoices) {
    if (inv.status === 'void') continue;
    balance += inv.totalPaisa;
  }
  for (const p of payments) {
    if (p.voided) continue;
    // Sales reduce what the customer owes. A refund paid back in cash or by
    // card re-opens exactly the amount the related return closed, so the two
    // cancel out and no phantom credit balance is left behind.
    if (p.kind === 'sale' || p.kind === 'credit') balance -= p.amountPaisa;
    else if (p.kind === 'refund') balance += p.amountPaisa;
  }
  for (const r of returns) {
    balance -= r.totalPaisa;
  }
  const customer = await tx.get<Customer>('customers', customerId);
  if (customer) await tx.put('customers', { ...customer, balancePaisa: Math.round(balance), updatedAt: Date.now() });
  return Math.round(balance);
}

/* --------------------------------- vehicles -------------------------------- */

export async function createVehicle(input: Partial<Vehicle>, actor: Actor): Promise<Vehicle> {
  const regNo = input.regNo?.trim().toUpperCase();
  if (!regNo) throw new ValidationError('Registration number is required.');
  if (!input.customerId) throw new ValidationError('Select the vehicle owner.');
  if (!input.make?.trim() || !input.model?.trim()) throw new ValidationError('Make and model are required.');
  return mutate(['vehicles', 'customers', 'audit'], async (tx) => {
    const owner = await tx.get<Customer>('customers', input.customerId!);
    if (!owner) throw new ValidationError('Selected customer does not exist.');
    const dupe = (await tx.by<Vehicle>('vehicles', 'regNo', regNo)).filter((v) => !v.archived);
    if (dupe.length) throw new ConflictError(`Registration ${regNo} is already registered to ${owner.id === dupe[0].customerId ? 'this customer' : 'another customer'}.`);
    const now = Date.now();
    const vehicle: Vehicle = {
      id: uid('veh'), createdAt: now, updatedAt: now, customerId: input.customerId!,
      regNo, make: input.make!.trim(), model: input.model!.trim(),
      year: input.year, vin: input.vin?.trim(), engineNo: input.engineNo?.trim(),
      color: input.color?.trim(), odometer: input.odometer, notes: input.notes?.trim(), archived: false
    };
    await tx.put('vehicles', vehicle);
    await audit(tx, 'vehicle.update', 'vehicle', vehicle.id, `Vehicle ${vehicle.regNo} added`, actor);
    return vehicle;
  });
}

export async function updateVehicle(id: string, patch: Partial<Vehicle>, actor: Actor): Promise<Vehicle> {
  return mutate(['vehicles', 'audit'], async (tx) => {
    const vehicle = await tx.get<Vehicle>('vehicles', id);
    if (!vehicle) throw new ValidationError('Vehicle not found.');
    const regNo = (patch.regNo ?? vehicle.regNo).trim().toUpperCase();
    if (regNo !== vehicle.regNo) {
      const dupe = (await tx.by<Vehicle>('vehicles', 'regNo', regNo)).filter((v) => v.id !== id && !v.archived);
      if (dupe.length) throw new ConflictError(`Registration ${regNo} is already in use.`);
    }
    const next: Vehicle = { ...vehicle, ...patch, regNo, id, updatedAt: Date.now() };
    if (patch.customerId && patch.customerId !== vehicle.customerId) {
      const owner = await tx.get<Customer>('customers', patch.customerId);
      if (!owner) throw new ValidationError('Selected customer does not exist.');
    }
    await tx.put('vehicles', next);
    await audit(tx, 'vehicle.update', 'vehicle', id, `Vehicle ${next.regNo} updated`, actor);
    return next;
  });
}

/* ---------------------------------- catalog -------------------------------- */

export async function createPart(input: Partial<Part>, actor: Actor): Promise<Part> {
  if (!input.name?.trim()) throw new ValidationError('Part name is required.');
  if (!input.sku?.trim()) throw new ValidationError('SKU / part number is required.');
  if (input.pricePaisa == null || input.pricePaisa < 0) throw new ValidationError('Enter a valid selling price.');
  return mutate(['parts', 'stockMoves', 'audit'], async (tx) => {
    const sku = input.sku!.trim().toUpperCase();
    const dupe = await tx.by<Part>('parts', 'sku', sku);
    if (dupe.length) throw new ConflictError(`SKU ${sku} already exists.`);
    const barcode = input.barcode?.trim() || undefined;
    if (barcode) {
      const clash = (await tx.by<Part>('parts', 'barcode', barcode))[0];
      if (clash) throw new ConflictError(`Barcode ${barcode} is already used by ${clash.name} (${clash.sku}). One barcode can point to one part.`);
    }
    const now = Date.now();
    const part: Part = {
      id: uid('prt'), createdAt: now, updatedAt: now, sku,
      barcode: input.barcode?.trim(), name: input.name!.trim(), category: input.category?.trim() || 'General',
      subcategory: input.subcategory?.trim() || undefined,
      brand: input.brand?.trim(), compatibility: input.compatibility?.trim(),
      description: input.description?.trim() || undefined,
      costPaisa: Math.round(input.costPaisa ?? 0), pricePaisa: Math.round(input.pricePaisa ?? 0),
      minPricePaisa: input.minPricePaisa, qty: Number(input.qty ?? 0), reorderLevel: Number(input.reorderLevel ?? 0),
      unit: input.unit?.trim() || 'pcs', supplierId: input.supplierId, location: input.location?.trim(),
      taxRate: Number(input.taxRate ?? 0), warrantyMonths: input.warrantyMonths, archived: false
    };
    if (part.qty !== 0) {
      await tx.put('stockMoves', {
        id: uid('stm'), createdAt: now, updatedAt: now, partId: part.id, type: 'adjustment',
        qty: part.qty, unitCostPaisa: part.costPaisa, note: 'Opening stock', date: now, createdBy: actor.name
      });
    }
    await tx.put('parts', part);
    await audit(tx, 'stock.adjust', 'part', part.id, `Part ${part.sku} created with opening stock ${part.qty}`, actor);
    return part;
  });
}

export async function updatePart(id: string, patch: Partial<Part>, actor: Actor): Promise<Part> {
  return mutate(['parts', 'audit'], async (tx) => {
    const part = await tx.get<Part>('parts', id);
    if (!part) throw new ValidationError('Part not found.');
    if (patch.sku && patch.sku.trim().toUpperCase() !== part.sku) {
      const dupe = await tx.by<Part>('parts', 'sku', patch.sku.trim().toUpperCase());
      if (dupe.length) throw new ConflictError('That SKU already exists.');
    }
    const nextBarcode = patch.barcode?.trim() || undefined;
    if (nextBarcode && nextBarcode !== part.barcode) {
      const clash = (await tx.by<Part>('parts', 'barcode', nextBarcode)).find((p) => p.id !== id);
      if (clash) throw new ConflictError(`Barcode ${nextBarcode} is already used by ${clash.name} (${clash.sku}). One barcode can point to one part.`);
    }
    const next: Part = { ...part, ...patch, id, qty: part.qty, updatedAt: Date.now(), sku: (patch.sku ?? part.sku).trim().toUpperCase() };
    await tx.put('parts', next);
    return next;
  });
}

export async function adjustStock(input: { partId: string; delta?: number; absoluteQty?: number; reason: string }, actor: Actor) {
  if (!input.reason.trim()) throw new ValidationError('A reason is required for stock adjustments.');
  return mutate(['parts', 'stockMoves', 'audit', 'notifications'], async (tx) => {
    const part = await tx.get<Part>('parts', input.partId);
    if (!part) throw new ValidationError('Part not found.');
    const newQty = input.absoluteQty != null ? input.absoluteQty : part.qty + (input.delta ?? 0);
    if (newQty < 0) throw new ValidationError('Stock cannot go below zero.');
    const delta = newQty - part.qty;
    if (delta === 0) throw new ValidationError('No stock change entered.');
    const now = Date.now();
    await tx.put('parts', { ...part, qty: newQty, updatedAt: now });
    await tx.put('stockMoves', {
      id: uid('stm'), createdAt: now, updatedAt: now, partId: part.id,
      type: input.absoluteQty != null ? 'count' : 'adjustment', qty: delta,
      unitCostPaisa: part.costPaisa, note: input.reason, date: now, createdBy: actor.name
    });
    await audit(tx, 'stock.adjust', 'part', part.id, `Stock for ${part.sku} adjusted by ${delta > 0 ? '+' : ''}${delta} (${input.reason})`, actor);
    if (newQty <= part.reorderLevel) {
      await notify(tx, 'low_stock', 'Low stock alert', `${part.name} (${part.sku}) is at ${newQty} ${part.unit} — reorder level ${part.reorderLevel}.`, '/inventory');
    }
    return newQty;
  });
}

export async function createService(input: Partial<Service>, actor: Actor): Promise<Service> {
  if (!input.name?.trim()) throw new ValidationError('Service name is required.');
  return mutate(['services', 'sequences', 'audit'], async (tx) => {
    const now = Date.now();
    const code = input.code?.trim().toUpperCase() || await uniqueCode(tx, 'services', 'code', 'SVC', now % 100000);
    const service: Service = {
      id: uid('svc'), createdAt: now, updatedAt: now, code, name: input.name!.trim(),
      category: input.category?.trim() || 'General Service', description: input.description?.trim(),
      pricePaisa: Math.round(input.pricePaisa ?? 0), taxRate: Number(input.taxRate ?? 0),
      durationMins: input.durationMins, archived: false
    };
    await tx.put('services', service);
    await audit(tx, 'settings.update', 'service', service.id, `Service "${service.name}" created`, actor);
    return service;
  });
}

export async function updateService(id: string, patch: Partial<Service>, actor: Actor): Promise<Service> {
  return mutate(['services'], async (tx) => {
    const svc = await tx.get<Service>('services', id);
    if (!svc) throw new ValidationError('Service not found.');
    const next = { ...svc, ...patch, id, updatedAt: Date.now() };
    await tx.put('services', next);
    return next;
  });
}

export async function createLabor(input: Partial<Labor>, actor: Actor): Promise<Labor> {
  if (!input.name?.trim()) throw new ValidationError('Labor item name is required.');
  return mutate(['labor'], async (tx) => {
    const now = Date.now();
    const code = input.code?.trim().toUpperCase() || await uniqueCode(tx, 'labor', 'code', 'LAB', now % 100000);
    const labor: Labor = {
      id: uid('lab'), createdAt: now, updatedAt: now, code, name: input.name!.trim(),
      ratePaisa: Math.round(input.ratePaisa ?? 0), category: input.category?.trim() || 'Labor',
      description: input.description?.trim(), archived: false
    };
    await tx.put('labor', labor);
    return labor;
  });
}

export async function updateLabor(id: string, patch: Partial<Labor>, actor: Actor): Promise<Labor> {
  return mutate(['labor'], async (tx) => {
    const item = await tx.get<Labor>('labor', id);
    if (!item) throw new ValidationError('Labor item not found.');
    const next = { ...item, ...patch, id, updatedAt: Date.now() };
    await tx.put('labor', next);
    return next;
  });
}

export async function createSupplier(input: Partial<Supplier>, actor: Actor): Promise<Supplier> {
  if (!input.name?.trim()) throw new ValidationError('Supplier name is required.');
  return mutate(['suppliers', 'sequences', 'audit'], async (tx) => {
    const now = Date.now();
    const supplier: Supplier = {
      id: uid('sup'), createdAt: now, updatedAt: now, name: input.name!.trim(),
      contactPerson: input.contactPerson?.trim(), phone: input.phone?.trim(), email: input.email?.trim(),
      address: input.address?.trim(), balancePaisa: 0, notes: input.notes?.trim(), archived: false
    };
    await tx.put('suppliers', supplier);
    await audit(tx, 'settings.update', 'supplier', supplier.id, `Supplier "${supplier.name}" created`, actor);
    return supplier;
  });
}

export async function updateSupplier(id: string, patch: Partial<Supplier>, actor: Actor): Promise<Supplier> {
  return mutate(['suppliers'], async (tx) => {
    const sup = await tx.get<Supplier>('suppliers', id);
    if (!sup) throw new ValidationError('Supplier not found.');
    const next = { ...sup, ...patch, id, balancePaisa: sup.balancePaisa, updatedAt: Date.now() };
    await tx.put('suppliers', next);
    return next;
  });
}

/* -------------------------------- warranty --------------------------------- */

export async function createWarranty(input: Partial<Warranty>, actor: Actor): Promise<Warranty> {
  if (!input.customerId) throw new ValidationError('Select a customer for this warranty.');
  if (!input.itemName?.trim()) throw new ValidationError('Describe the covered item.');
  if (!input.startDate || !input.endDate) throw new ValidationError('Start and end dates are required.');
  if (input.endDate < input.startDate) throw new ValidationError('Expiry date must be after the start date.');
  return mutate(['warranty', 'sequences', 'audit'], async (tx) => {
    const number = await nextNumber(tx, 'warranty');
    const now = Date.now();
    const record: Warranty = {
      id: uid('war'), createdAt: now, updatedAt: now, number,
      customerId: input.customerId!, vehicleId: input.vehicleId ?? null, invoiceId: input.invoiceId ?? null,
      partId: input.partId ?? null, serviceId: input.serviceId ?? null, itemName: input.itemName!.trim(),
      startDate: input.startDate!, endDate: input.endDate!, terms: input.terms?.trim(),
      status: 'active', claims: []
    };
    await tx.put('warranty', record);
    await audit(tx, 'warranty.create', 'warranty', record.id, `Warranty ${record.number} created for ${record.itemName}`, actor);
    return record;
  });
}

export async function claimWarranty(id: string, description: string, resolution: string, actor: Actor): Promise<Warranty> {
  if (!description.trim()) throw new ValidationError('Describe the claim.');
  return mutate(['warranty', 'audit'], async (tx) => {
    const record = await tx.get<Warranty>('warranty', id);
    if (!record) throw new ValidationError('Warranty not found.');
    if (record.endDate < todayISO()) throw new ValidationError('This warranty has expired.');
    const next: Warranty = {
      ...record,
      status: resolution === 'rejected' ? 'active' : 'claimed',
      claims: [...record.claims, { at: Date.now(), description: description.trim(), resolution: resolution.trim() || 'Approved', by: actor.name }],
      updatedAt: Date.now()
    };
    await tx.put('warranty', next);
    await audit(tx, 'warranty.claim', 'warranty', id, `Warranty claim logged for ${record.number}`, actor);
    return next;
  });
}

/* ------------------------------ notifications ------------------------------ */

export async function listNotifications(limit = 60): Promise<AppNotification[]> {
  const all = await withTx(['notifications'], 'readonly', (tx) => tx.all<AppNotification>('notifications'));
  return all.sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
}

export async function markNotificationRead(id: string, read = true): Promise<void> {
  await withTx(['notifications'], 'readwrite', async (tx) => {
    const n = await tx.get<AppNotification>('notifications', id);
    if (n) await tx.put('notifications', { ...n, read, updatedAt: Date.now() });
  });
}

export async function markAllNotificationsRead(): Promise<void> {
  await withTx(['notifications'], 'readwrite', async (tx) => {
    const all = await tx.all<AppNotification>('notifications');
    for (const n of all) if (!n.read) await tx.put('notifications', { ...n, read: true, updatedAt: Date.now() });
  });
}

export async function clearNotifications(): Promise<void> {
  await withTx(['notifications'], 'readwrite', async (tx) => {
    await tx.clear('notifications');
  });
}

/** Scheduled local checks: low stock, expiring warranties, stale open shifts. */
export async function runAutomatedChecks(now = Date.now()): Promise<number> {
  const dayKey = new Date(now).toISOString().slice(0, 10);
  return withTx(['parts', 'warranty', 'cashShifts', 'notifications', 'meta'], 'readwrite', async (tx) => {
    let created = 0;

    const lowStock = (await tx.all<Part>('parts')).filter((p) => !p.archived && p.qty <= p.reorderLevel);
    if (lowStock.length) {
      const guard = await tx.get<MetaRecord>('meta', `check:low:${dayKey}`);
      if (!guard) {
        const names = lowStock.slice(0, 3).map((p) => p.name).join(', ');
        await notify(tx, 'low_stock', 'Low stock alert',
          `${lowStock.length} item${lowStock.length > 1 ? 's are' : ' is'} at or below reorder level: ${names}${lowStock.length > 3 ? '…' : ''}.`,
          '/inventory');
        await tx.put('meta', { key: `check:low:${dayKey}`, value: true });
        created++;
      }
    }

    const in30 = todayISO(new Date(now + 30 * 86400000));
    const expiring = (await tx.all<Warranty>('warranty')).filter((w) => w.status === 'active' && w.endDate <= in30 && w.endDate >= todayISO(new Date(now)));
    if (expiring.length) {
      const guard = await tx.get<MetaRecord>('meta', `check:warranty:${dayKey}`);
      if (!guard) {
        await notify(tx, 'warranty_expiry', 'Warranties expiring soon',
          `${expiring.length} warrant${expiring.length > 1 ? 'ies expire' : 'y expires'} within 30 days.`, '/warranty');
        await tx.put('meta', { key: `check:warranty:${dayKey}`, value: true });
        created++;
      }
    }

    const openShifts = (await tx.all<CashShiftLike>('cashShifts')).filter((s) => s.status === 'open');
    const stale = openShifts.filter((s) => now - s.openedAt > 16 * 3600_000);
    if (stale.length) {
      const guard = await tx.get<MetaRecord>('meta', `check:shift:${dayKey}`);
      if (!guard) {
        await notify(tx, 'shift_warning', 'Shift open for over 16 hours', 'Reconcile and close the shift to keep cash reports accurate.', '/shifts');
        await tx.put('meta', { key: `check:shift:${dayKey}`, value: true });
        created++;
      }
    }
    return created;
  });
}

interface CashShiftLike {
  id: string;
  status: 'open' | 'closed';
  openedAt: number;
}

/* ------------------------------- misc reads -------------------------------- */

export async function listAudit(limit = 100): Promise<AuditEvent[]> {
  const all = await withTx(['audit'], 'readonly', (tx) => tx.all<AuditEvent>('audit'));
  return all.sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
}

export async function addCashMovement(input: { shiftId: string; type: 'in' | 'out'; amountPaisa: number; reason: string }, actor: Actor): Promise<CashMovement> {
  if (!input.reason.trim()) throw new ValidationError('Enter a reason for the cash movement.');
  if (!input.amountPaisa || input.amountPaisa <= 0) throw new ValidationError('Enter an amount greater than zero.');
  return mutate(['cashShifts', 'cashMovements', 'audit'], async (tx) => {
    const shift = await tx.get<{ id: string; status: string }>('cashShifts', input.shiftId);
    if (!shift || shift.status !== 'open') throw new ValidationError('Cash movements require an open shift.');
    const now = Date.now();
    const movement: CashMovement = {
      id: uid('cm'), createdAt: now, updatedAt: now, shiftId: input.shiftId,
      type: input.type, amountPaisa: Math.round(input.amountPaisa), reason: input.reason.trim(), at: now, createdBy: actor.name
    };
    await tx.put('cashMovements', movement);
    await audit(tx, 'shift.open', 'shift', input.shiftId, `Cash ${input.type === 'in' ? 'in' : 'out'} of ${input.reason}`, actor);
    return movement;
  });
}

export async function listUsersForAssign(): Promise<{ id: string; name: string; role: string }[]> {
  const users = await listUsers();
  return users.filter((u) => u.active && (u.role === 'Mechanic' || u.role === 'Manager' || u.role === 'Administrator'))
    .map((u) => ({ id: u.id, name: u.name, role: u.role }));
}

export async function listJobsForMechanic(mechanicId: string): Promise<JobCard[]> {
  return withTx(['jobcards'], 'readonly', (tx) => tx.by<JobCard>('jobcards', 'mechanicId', mechanicId));
}

export function can(role: string, permission: Permission, roles: Record<string, Permission[]>): boolean {
  return (roles[role] ?? []).includes(permission);
}

export { persistSettings };
