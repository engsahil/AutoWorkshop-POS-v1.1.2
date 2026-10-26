/**
 * Single-file backup / restore.
 *
 * Format (v1): JSON document
 *  { format: 'servixa-backup', version: 1, appVersion, createdAt, checksum,
 *    manifest: { counts, businessName, lastInvoiceNumber },
 *    data: { settings, sequences, users(depersonalised), customers, ... },
 *    assets: { logo, loginArt, heroArt } }
 *
 * Credentials: password hashes and salts are deliberately NOT exported. After a
 * restore you must set a new password for the administrator account (the import
 * dialog collects it). Other staff accounts are restored disabled until an
 * administrator resets their password.
 *
 * Restores are full-replace inside one IndexedDB transaction; on failure nothing
 * is committed. Existing data should be exported first (the UI offers this).
 */
import { DB_NAME, STORE_NAMES, openDB, withTx, type Tx, type StoreName } from './db';
import { hashPassword, passwordIssues, randomSalt } from './auth';
import { uid } from './ids';
import { BACKUP_FORMAT, BACKUP_VERSION, APP_VERSION, type AppSettings, type Sequence, type User } from './types';
import { getSettings } from './db';

export const MAX_BACKUP_BYTES = 30 * 1024 * 1024;

const DATA_STORES: StoreName[] = [
  'customers', 'vehicles', 'parts', 'services', 'labor', 'suppliers', 'purchases', 'invoices',
  'payments', 'jobcards', 'returns', 'warranty', 'expenses', 'cashShifts', 'cashMovements',
  'stockMoves', 'audit', 'notifications'
];

export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  version: number;
  appVersion: string;
  createdAt: number;
  checksum: string;
  manifest: {
    counts: Record<string, number>;
    businessName: string;
    lastInvoiceNumber?: string;
    exportedBy?: string;
  };
  data: {
    settings: AppSettings;
    sequences: Sequence[];
    users: Partial<User>[];
    /** Every other business store, keyed by store name. */
    [store: string]: unknown;
  };
  assets?: Record<string, string | null>;
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

export function sanitizeUser(u: User): Partial<User> {
  return {
    id: u.id, createdAt: u.createdAt, updatedAt: u.updatedAt, username: u.username, name: u.name,
    role: u.role, email: u.email, phone: u.phone, active: u.active, isOwner: u.isOwner,
    avatar: u.avatar ?? null, preferences: u.preferences, lastLogin: u.lastLogin
  };
}

export async function buildBackup(exportedBy: string): Promise<BackupFile> {
  await openDB();
  let settings = await getSettings();
  let sequences: Sequence[] = [];
  let users: Partial<User>[] = [];
  await withTx(['settings', 'sequences', 'users'], 'readonly', async (tx) => {
    const settingsRec = await tx.get<{ key: string; value: AppSettings }>('settings', 'app');
    if (settingsRec?.value) settings = settingsRec.value;
    sequences = await tx.all<Sequence>('sequences');
    users = (await tx.all<User>('users')).map(sanitizeUser);
  });
  const counts: Record<string, number> = {};
  const stores: Record<string, unknown[]> = {};
  for (const store of DATA_STORES) {
    const rows = await withTx([store], 'readonly', (tx) => tx.all<unknown>(store));
    stores[store] = rows;
    counts[store] = rows.length;
  }
  counts.users = users.length;
  const data = { settings, sequences, users, ...stores } as unknown as BackupFile['data'];
  const invoices = (stores.invoices as { number: string; date: number }[]) ?? [];
  const lastInvoice = [...invoices].sort((a, b) => b.date - a.date)[0];
  const manifest: BackupFile['manifest'] = {
    counts,
    businessName: settings?.profile?.name ?? 'Servixa',
    lastInvoiceNumber: lastInvoice?.number,
    exportedBy
  };
  const checksum = await sha256Hex(JSON.stringify(data));
  const file: BackupFile = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    appVersion: APP_VERSION,
    createdAt: Date.now(),
    checksum,
    manifest,
    data
  };
  return file;
}

export async function exportBackup(exportedBy: string): Promise<{ blob: Blob; filename: string; manifest: BackupFile['manifest'] }> {
  const file = await buildBackup(exportedBy);
  const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' });
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  return { blob, filename: `servixa-backup-${stamp}.json`, manifest: file.manifest };
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/* ------------------------------ validation -------------------------------- */

export interface ValidationIssue {
  level: 'error' | 'warning';
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
  file?: BackupFile;
}

export async function validateBackup(input: unknown): Promise<ValidationResult> {
  const issues: ValidationIssue[] = [];
  if (!input || typeof input !== 'object') {
    return { ok: false, issues: [{ level: 'error', message: 'The file is not a Servixa backup (invalid JSON structure).' }] };
  }
  const file = input as BackupFile;
  if (file.format !== BACKUP_FORMAT) issues.push({ level: 'error', message: 'This file is not a Servixa backup (unrecognised format marker).' });
  if (file.version == null) issues.push({ level: 'error', message: 'Missing backup version.' });
  else if (file.version > BACKUP_VERSION) issues.push({ level: 'error', message: `Backup version ${file.version} is newer than this app supports (${BACKUP_VERSION}). Update Servixa first.` });
  if (!file.data || typeof file.data !== 'object') issues.push({ level: 'error', message: 'Backup contains no data section.' });

  if (issues.length) return { ok: false, issues };

  const stores = file.data as unknown as Record<string, unknown[]>;
  const requiredArrays = [...DATA_STORES, 'users', 'sequences'];
  for (const key of requiredArrays) {
    if (!Array.isArray(stores[key])) issues.push({ level: 'error', message: `Backup is missing the "${key}" collection.` });
  }
  if (!file.data.settings || typeof file.data.settings !== 'object') {
    issues.push({ level: 'error', message: 'Backup is missing application settings.' });
  }
  if (issues.length) return { ok: false, issues };

  // checksum
  try {
    const checksum = await sha256Hex(JSON.stringify(file.data));
    if (file.checksum && checksum !== file.checksum) {
      issues.push({ level: 'error', message: 'Checksum mismatch — the backup file is corrupted or was modified after export.' });
    }
    if (!file.checksum) issues.push({ level: 'warning', message: 'Backup has no checksum; integrity could not be verified.' });
  } catch {
    issues.push({ level: 'warning', message: 'Checksum verification was not possible in this browser.' });
  }

  // referential integrity
  const ids = (rows: { id?: string }[]) => new Set(rows.map((r) => r.id).filter(Boolean) as string[]);
  const customerIds = ids(stores.customers as { id: string }[]);
  const vehicleIds = ids(stores.vehicles as { id: string }[]);
  const invoiceIds = ids(stores.invoices as { id: string }[]);
  const supplierIds = ids(stores.suppliers as { id: string }[]);
  const partIds = ids(stores.parts as { id: string }[]);
  const userIds = ids(stores.users as { id: string }[]);
  const purchaseIds = ids(stores.purchases as { id: string }[]);

  const check = (rows: unknown[], fn: (r: Record<string, unknown>) => string | null, label: string) => {
    let bad = 0;
    for (const row of rows as Record<string, unknown>[]) {
      const problem = fn(row);
      if (problem) bad++;
    }
    if (bad) issues.push({ level: 'error', message: `${bad} ${label} reference${bad > 1 ? 's' : ''} point to records that are not in the backup.` });
  };

  check(stores.vehicles, (v) => (customerIds.has(v.customerId as string) ? null : 'customer'), 'vehicle');
  check(stores.invoices, (i) => (i.customerId && !customerIds.has(i.customerId as string) ? 'customer' : null), 'invoice customer');
  check(stores.invoices, (i) => (i.vehicleId && !vehicleIds.has(i.vehicleId as string) ? 'vehicle' : null), 'invoice vehicle');
  check(stores.jobcards, (j) => (!customerIds.has(j.customerId as string) || !vehicleIds.has(j.vehicleId as string) ? 'customer/vehicle' : null), 'job card');
  check(stores.payments, (p) => (p.invoiceId && !invoiceIds.has(p.invoiceId as string) ? 'invoice' : null), 'payment invoice');
  check(stores.payments, (p) => (p.purchaseId && !purchaseIds.has(p.purchaseId as string) ? 'purchase' : null), 'payment purchase');
  check(stores.returns, (r) => (r.invoiceId && !invoiceIds.has(r.invoiceId as string) ? 'invoice' : null), 'return invoice');
  check(stores.purchases, (p) => (!supplierIds.has(p.supplierId as string) ? 'supplier' : null), 'purchase supplier');
  check(stores.stockMoves, (m) => (!partIds.has(m.partId as string) ? 'part' : null), 'stock movement');
  check(stores.warranty, (w) => (!customerIds.has(w.customerId as string) ? 'customer' : null), 'warranty customer');
  check(stores.jobcards, (j) => (j.mechanicId && !userIds.has(j.mechanicId as string) ? 'user' : null), 'job mechanic');
  check(stores.expenses, (e) => (!userIds.has(e.createdBy as unknown as string) && typeof e.createdBy === 'string' && e.createdBy.startsWith('usr_') ? 'user' : null), 'expense user');

  if (!file.data.users.length) issues.push({ level: 'error', message: 'Backup contains no user accounts.' });
  const admins = (file.data.users as Partial<User>[]).filter((u) => u.role === 'Administrator');
  if (!admins.length) issues.push({ level: 'warning', message: 'Backup has no administrator account; you will become the administrator after restore.' });

  // basic value sanity
  const items = stores.invoices as { totalPaisa?: number; paidPaisa?: number }[];
  if (items.some((i) => typeof i.totalPaisa !== 'number' || i.totalPaisa < 0)) {
    issues.push({ level: 'error', message: 'Invoice totals contain invalid values.' });
  }
  if (items.some((i) => (i.paidPaisa ?? 0) > (i.totalPaisa ?? 0) + 1)) {
    issues.push({ level: 'warning', message: 'Some invoices are paid above their total — check the source data.' });
  }
  if (issues.some((i) => i.level === 'error')) return { ok: false, issues, file };
  return { ok: true, issues, file };
}

export async function parseBackupFile(file: File): Promise<ValidationResult> {
  if (file.size > MAX_BACKUP_BYTES) {
    return { ok: false, issues: [{ level: 'error', message: `File is larger than ${Math.round(MAX_BACKUP_BYTES / 1024 / 1024)} MB.` }] };
  }
  if (!/\.json$/i.test(file.name) && file.type !== 'application/json') {
    return { ok: false, issues: [{ level: 'error', message: 'Only .json Servixa backup files can be imported.' }] };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    return { ok: false, issues: [{ level: 'error', message: 'The file is not valid JSON.' }] };
  }
  return validateBackup(parsed);
}

export interface RestoreOptions {
  adminUserId: string;
  newPassword: string;
  actorName?: string;
}

export async function importBackup(result: ValidationResult, options: RestoreOptions): Promise<void> {
  if (!result.ok || !result.file) throw new Error('Backup did not pass validation.');
  const file = result.file;
  const settings = file.data.settings;
  const issues = passwordIssues(options.newPassword, settings.security ?? (await getSettings()).security);
  if (issues.length) throw new Error(`Administrator password: ${issues.join(' · ')}`);

  const salt = randomSalt();
  const passwordHash = await hashPassword(options.newPassword, salt);
  const chosenAdmin = (file.data.users as Partial<User>[]).find((u) => u.id === options.adminUserId);

  const users: User[] = (file.data.users as Partial<User>[]).map((u) => {
    const isChosen = u.id === options.adminUserId;
    return {
      id: u.id ?? uid('usr'),
      createdAt: u.createdAt ?? Date.now(),
      updatedAt: Date.now(),
      username: (u.username ?? 'user').toLowerCase(),
      name: u.name ?? 'Staff',
      role: isChosen ? 'Administrator' : u.role ?? 'Cashier',
      email: u.email,
      phone: u.phone,
      active: isChosen ? true : false,
      isOwner: isChosen,
      passwordHash: isChosen ? passwordHash : '',
      salt: isChosen ? salt : '',
      iterations: 150_000,
      avatar: u.avatar ?? null,
      preferences: u.preferences ?? { sound: true, volume: 70, density: 'comfortable' as const },
      lastLogin: u.lastLogin
    };
  });
  if (!users.length) throw new Error('Backup contained no users.');
  if (!users.some((u) => u.id === options.adminUserId)) {
    throw new Error('Choose an administrator account that exists in this backup.');
  }

  const restoredSettings: AppSettings = {
    ...settings,
    setupComplete: true
  };

  const db = await openDB();
  const allStores: StoreName[] = [...STORE_NAMES];
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(allStores, 'readwrite', { durability: 'strict' });
    let failed: unknown = null;
    tx.oncomplete = () => (failed ? reject(failed) : resolve());
    tx.onerror = () => reject(tx.error ?? new Error('Restore failed'));
    tx.onabort = () => reject(failed ?? tx.error ?? new Error('Restore aborted'));
    (async () => {
      try {
        for (const store of DATA_STORES) {
          const obj = tx.objectStore(store);
          obj.clear();
          for (const row of ((file.data as unknown as Record<string, unknown[]>)[store] as { id?: string }[]) ?? []) {
            if (row && row.id) obj.put(row);
          }
        }
        tx.objectStore('settings').clear();
        tx.objectStore('settings').put({ key: 'app', value: restoredSettings });
        tx.objectStore('sequences').clear();
        for (const seq of file.data.sequences ?? []) tx.objectStore('sequences').put(seq);
        tx.objectStore('users').clear();
        for (const u of users) tx.objectStore('users').put(u);
        tx.objectStore('meta').clear();
        tx.objectStore('meta').put({ key: 'restore.at', value: Date.now() });
        tx.objectStore('meta').put({ key: 'restore.source', value: file.manifest?.businessName ?? 'unknown' });
        tx.objectStore('notifications').put({
          id: uid('ntf'), createdAt: Date.now(), updatedAt: Date.now(), type: 'backup',
          title: 'Backup restored',
          message: `Restored ${file.manifest?.counts?.invoices ?? 0} invoices and ${file.manifest?.counts?.customers ?? 0} customers from ${new Date(file.createdAt).toLocaleString()}.`,
          read: false, link: '/settings'
        });
        tx.objectStore('audit').put({
          id: uid('aud'), createdAt: Date.now(), updatedAt: Date.now(), action: 'backup.import',
          entity: 'application', entityId: 'all',
          summary: `Full restore from backup created ${new Date(file.createdAt).toLocaleString()}`,
          userId: options.adminUserId, userName: options.actorName ?? 'Administrator'
        });
      } catch (err) {
        failed = err;
        try {
          tx.abort();
        } catch {
          /* noop */
        }
      }
    })();
  });
}

/** Deliberate factory reset. Requires typing a confirmation phrase in the UI. */
export async function factoryReset(): Promise<void> {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([...STORE_NAMES], 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    for (const s of STORE_NAMES) tx.objectStore(s).clear();
  });
  localStorage.removeItem('servixa.session.v1');
  localStorage.removeItem('servixa.notif.sound');
}

export function estimateStorage(): { usage?: number; quota?: number } {
  // navigator.storage.estimate is optional and not available everywhere
  return {};
}

export async function storageInfo(): Promise<{ usage: number; quota: number } | null> {
  try {
    if (!navigator.storage?.estimate) return null;
    const est = await navigator.storage.estimate();
    return { usage: est.usage ?? 0, quota: est.quota ?? 0 };
  } catch {
    return null;
  }
}

export const BACKUP_DB_NAME = DB_NAME;

export async function integrityReport(): Promise<{ level: 'ok' | 'warning' | 'error'; message: string }[]> {
  const out: { level: 'ok' | 'warning' | 'error'; message: string }[] = [];
  const [invoices, payments, customers, parts, jobs] = await Promise.all([
    withTx(['invoices'], 'readonly', (t) => t.all<{ id: string; totalPaisa: number; paidPaisa: number; duePaisa: number; customerId: string | null }>('invoices')),
    withTx(['payments'], 'readonly', (t) => t.all<{ id: string; invoiceId: string | null; amountPaisa: number; voided?: boolean; kind: string }>('payments')),
    withTx(['customers'], 'readonly', (t) => t.all<{ id: string; balancePaisa: number }>('customers')),
    withTx(['parts'], 'readonly', (t) => t.all<{ id: string; qty: number }>('parts')),
    withTx(['jobcards'], 'readonly', (t) => t.all<{ id: string; invoiceId?: string }>('jobcards'))
  ]);
  const badTotals = invoices.filter((i) => Math.abs(i.totalPaisa - (i.paidPaisa + i.duePaisa)) > 1);
  out.push(badTotals.length
    ? { level: 'error', message: `${badTotals.length} invoice(s) where paid + due ≠ total.` }
    : { level: 'ok', message: 'Invoice totals reconcile with paid and due amounts.' });

  const negative = parts.filter((p) => p.qty < 0);
  out.push(negative.length
    ? { level: 'warning', message: `${negative.length} part(s) have negative stock.` }
    : { level: 'ok', message: 'No negative stock quantities.' });

  const invoiceIds = new Set(invoices.map((i) => i.id));
  const orphanPayments = payments.filter((p) => p.invoiceId && !invoiceIds.has(p.invoiceId));
  out.push(orphanPayments.length
    ? { level: 'error', message: `${orphanPayments.length} payment(s) reference missing invoices.` }
    : { level: 'ok', message: 'All payments reference existing invoices.' });

  const unlinkedJobs = jobs.filter((j) => j.invoiceId && !invoiceIds.has(j.invoiceId));
  out.push(unlinkedJobs.length
    ? { level: 'error', message: `${unlinkedJobs.length} job card(s) reference missing invoices.` }
    : { level: 'ok', message: 'Job card invoice links are intact.' });

  const balanceDrift = customers.filter((c) => !Number.isFinite(c.balancePaisa));
  out.push(balanceDrift.length
    ? { level: 'error', message: 'Customer balances contain invalid values.' }
    : { level: 'ok', message: 'Customer balances are numeric and consistent.' });
  return out;
}

export type { Tx };
