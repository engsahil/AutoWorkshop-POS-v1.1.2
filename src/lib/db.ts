/**
 * IndexedDB access layer for Servixa.
 *
 * Design notes
 * - One database (`servixa`), versioned schema with explicit migrations.
 * - Every business operation runs inside a single IDB transaction so stock,
 *   invoices, payments and balances stay consistent (see repo.ts).
 * - Requests are awaited as promises inside the transaction; each continuation
 *   issues the next request synchronously in the same microtask, which keeps
 *   the transaction alive in Chromium/WebKit/Gecko.
 */
import type {
  AppSettings, AppNotification, AuditEvent, CashShift, Customer, Expense, Invoice, JobCard,
  Labor, MetaRecord, Part, Payment, Purchase, ReturnDoc, Sequence, Service, StockMove, Supplier,
  User, Vehicle, Warranty
} from './types';
import { DEFAULT_ROLES } from './types';

export const DB_NAME = 'servixa';
export const DB_VERSION = 2;

export const STORE_NAMES = [
  'meta', 'settings', 'users', 'customers', 'vehicles', 'parts', 'services', 'labor', 'suppliers',
  'purchases', 'invoices', 'payments', 'jobcards', 'returns', 'warranty', 'expenses', 'cashShifts',
  'cashMovements', 'stockMoves', 'audit', 'notifications', 'sequences'
] as const;
export type StoreName = (typeof STORE_NAMES)[number];

interface StoreDef {
  name: StoreName;
  indexes?: [name: string, keyPath: string, opts?: IDBIndexParameters][];
}

const STORES: StoreDef[] = [
  { name: 'meta' },
  { name: 'settings' },
  {
    name: 'users',
    indexes: [['username', 'username', { unique: true }], ['role', 'role']]
  },
  {
    name: 'customers',
    indexes: [['code', 'code', { unique: true }], ['phone', 'phone'], ['createdAt', 'createdAt']]
  },
  {
    name: 'vehicles',
    indexes: [['regNo', 'regNo'], ['customerId', 'customerId'], ['createdAt', 'createdAt']]
  },
  {
    name: 'parts',
    indexes: [['sku', 'sku', { unique: true }], ['barcode', 'barcode'], ['category', 'category'], ['supplierId', 'supplierId']]
  },
  { name: 'services', indexes: [['code', 'code', { unique: true }], ['name', 'name']] },
  { name: 'labor', indexes: [['code', 'code', { unique: true }], ['name', 'name']] },
  { name: 'suppliers', indexes: [['name', 'name']] },
  {
    name: 'purchases',
    indexes: [['number', 'number', { unique: true }], ['supplierId', 'supplierId'], ['date', 'date'], ['status', 'status']]
  },
  {
    name: 'invoices',
    indexes: [
      ['number', 'number', { unique: true }], ['customerId', 'customerId'], ['date', 'date'],
      ['status', 'status'], ['paymentStatus', 'paymentStatus'], ['shiftId', 'shiftId'],
      ['jobCardId', 'jobCardId'], ['vehicleId', 'vehicleId']
    ]
  },
  {
    name: 'payments',
    indexes: [
      ['invoiceId', 'invoiceId'], ['purchaseId', 'purchaseId'], ['customerId', 'customerId'],
      ['supplierId', 'supplierId'], ['shiftId', 'shiftId'], ['date', 'date'], ['kind', 'kind'], ['method', 'method']
    ]
  },
  {
    name: 'jobcards',
    indexes: [
      ['number', 'number', { unique: true }], ['customerId', 'customerId'], ['vehicleId', 'vehicleId'],
      ['status', 'status'], ['mechanicId', 'mechanicId'], ['createdAt', 'createdAt'], ['invoiceId', 'invoiceId']
    ]
  },
  { name: 'returns', indexes: [['number', 'number', { unique: true }], ['invoiceId', 'invoiceId'], ['customerId', 'customerId'], ['date', 'date'], ['shiftId', 'shiftId']] },
  { name: 'warranty', indexes: [['customerId', 'customerId'], ['vehicleId', 'vehicleId'], ['status', 'status'], ['endDate', 'endDate'], ['invoiceId', 'invoiceId']] },
  { name: 'expenses', indexes: [['date', 'date'], ['category', 'category'], ['shiftId', 'shiftId']] },
  { name: 'cashShifts', indexes: [['userId', 'userId'], ['status', 'status'], ['openedAt', 'openedAt']] },
  { name: 'cashMovements', indexes: [['shiftId', 'shiftId'], ['at', 'at']] },
  { name: 'stockMoves', indexes: [['partId', 'partId'], ['date', 'date'], ['refId', 'refId'], ['type', 'type']] },
  { name: 'audit', indexes: [['at', 'at'], ['action', 'action'], ['entityId', 'entityId'], ['userId', 'userId']] },
  { name: 'notifications', indexes: [['at', 'at'], ['type', 'type']] },
  { name: 'sequences' }
];

/**
 * Stores that earlier builds created and this build no longer uses. They are
 * dropped during the upgrade so an existing installation does not keep an
 * orphaned, ever-growing table. No business record lives here.
 */
const LEGACY_STORES = ['syncQueue'];

let dbPromise: Promise<IDBDatabase> | null = null;

/**
 * Test-only helper: closes the cached connection and deletes the database so a
 * suite starts from a genuinely empty workspace. Not used by the app.
 */
export async function resetDatabase(): Promise<void> {
  if (dbPromise) {
    const db = await dbPromise.catch(() => null);
    db?.close();
    dbPromise = null;
  }
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    const done = () => resolve();
    req.onsuccess = done;
    req.onerror = done;
    req.onblocked = done;
  });
}

export function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available in this browser. Servixa requires IndexedDB for offline storage.'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const def of STORES) {
        let store: IDBObjectStore;
        if (!db.objectStoreNames.contains(def.name)) {
          store = db.createObjectStore(def.name, { keyPath: def.name === 'meta' || def.name === 'settings' || def.name === 'sequences' ? 'key' : 'id' });
        } else {
          store = req.transaction!.objectStore(def.name);
        }
        for (const [idxName, keyPath, opts] of def.indexes ?? []) {
          if (!store.indexNames.contains(idxName)) store.createIndex(idxName, keyPath, opts);
        }
      }
      for (const legacy of LEGACY_STORES) {
        if (db.objectStoreNames.contains(legacy)) db.deleteObjectStore(legacy);
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = () => reject(req.error ?? new Error('Unable to open local database'));
  });
  return dbPromise;
}

export interface Tx {
  get<T>(store: StoreName, key: IDBValidKey): Promise<T | undefined>;
  put<T>(store: StoreName, value: T): Promise<void>;
  del(store: StoreName, key: IDBValidKey): Promise<void>;
  all<T>(store: StoreName): Promise<T[]>;
  by<T>(store: StoreName, index: string, query?: IDBValidKey | IDBKeyRange | null): Promise<T[]>;
  count(store: StoreName): Promise<number>;
  clear(store: StoreName): Promise<void>;
}

function reqToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function makeTx(tx: IDBTransaction): Tx {
  return {
    get: <T,>(store: StoreName, key: IDBValidKey) => reqToPromise(tx.objectStore(store).get(key)) as Promise<T | undefined>,
    put: async <T,>(store: StoreName, value: T) => {
      await reqToPromise(tx.objectStore(store).put(value as unknown));
    },
    del: async (store, key) => {
      await reqToPromise(tx.objectStore(store).delete(key));
    },
    all: <T,>(store: StoreName) => reqToPromise(tx.objectStore(store).getAll()) as Promise<T[]>,
    by: <T,>(store: StoreName, index: string, query?: IDBValidKey | IDBKeyRange | null) => {
      const idx = tx.objectStore(store).index(index);
      return reqToPromise(query === undefined ? idx.getAll() : idx.getAll(query)) as Promise<T[]>;
    },
    count: (store) => reqToPromise(tx.objectStore(store).count()),
    clear: async (store) => {
      await reqToPromise(tx.objectStore(store).clear());
    }
  };
}

/** Run a set of operations inside one transaction. Rolls back on throw. */
export async function withTx<T>(stores: StoreName[], mode: IDBTransactionMode, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const db = await openDB();
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    let completed = false;
    let fnDone = false;
    let result: T;
    let fnError: unknown = null;

    const settle = () => {
      if (settled) return;
      if (fnError) {
        settled = true;
        reject(fnError);
        return;
      }
      if (fnDone && completed) {
        settled = true;
        resolve(result);
      }
    };

    const tx = db.transaction(stores, mode, { durability: 'strict' });
    const ctx = makeTx(tx);

    // A transaction can complete before the async callback's promise settles
    // (for example when the callback awaits WebCrypto). Resolve only once both
    // the callback value and the transaction completion are known.
    tx.oncomplete = () => { completed = true; settle(); };
    tx.onerror = () => {
      if (settled) return;
      settled = true;
      reject(tx.error ?? new Error('Local database transaction failed'));
    };
    tx.onabort = () => {
      if (settled) return;
      settled = true;
      reject(fnError ?? tx.error ?? new Error('Local database transaction aborted'));
    };

    fn(ctx)
      .then((r) => {
        result = r;
        fnDone = true;
        settle();
      })
      .catch((err) => {
        fnError = err;
        fnDone = true;
        try {
          tx.abort();
        } catch {
          /* already finished */
        }
        settle();
      });
  });
}

/* ------------------------------- read helpers ------------------------------ */

export async function dbGet<T>(store: StoreName, key: IDBValidKey): Promise<T | undefined> {
  return withTx([store], 'readonly', (tx) => tx.get<T>(store, key));
}

export async function dbAll<T>(store: StoreName): Promise<T[]> {
  return withTx([store], 'readonly', (tx) => tx.all<T>(store));
}

export async function dbBy<T>(store: StoreName, index: string, query?: IDBValidKey | IDBKeyRange | null): Promise<T[]> {
  return withTx([store], 'readonly', (tx) => tx.by<T>(store, index, query));
}

export async function dbCount(store: StoreName): Promise<number> {
  return withTx([store], 'readonly', (tx) => tx.count(store));
}

export async function putOne<T extends { id: string }>(store: StoreName, value: T): Promise<T> {
  return withTx([store], 'readwrite', async (tx) => {
    await tx.put(store, value);
    return value;
  });
}

/* --------------------------------- defaults -------------------------------- */

export const DEFAULT_SEQUENCES: Sequence[] = [
  { key: 'invoice', prefix: 'INV-', next: 1, padding: 6 },
  { key: 'job', prefix: 'JC-', next: 1, padding: 4 },
  { key: 'purchase', prefix: 'PO-', next: 1, padding: 4 },
  { key: 'return', prefix: 'RTN-', next: 1, padding: 4 },
  { key: 'shift', prefix: 'SH-', next: 1, padding: 4 },
  { key: 'warranty', prefix: 'WR-', next: 1, padding: 4 },
  { key: 'payment', prefix: 'PMT-', next: 1, padding: 5 },
  { key: 'customer', prefix: 'CUS-', next: 1, padding: 4 },
  { key: 'supplier', prefix: 'SUP-', next: 1, padding: 4 }
];

export const DEFAULT_SETTINGS: AppSettings = {
  profile: {
    name: 'Servixa Auto Workshop',
    legalName: '',
    address: '',
    phone: '',
    email: '',
    taxNumber: '',
    regNumber: '',
    currency: 'Rs.',
    locale: 'en-PK',
    timezone: 'Asia/Karachi',
    hours: 'Mon–Sat, 9:00 AM – 8:00 PM'
  },
  documents: {
    invoicePrefix: 'INV-',
    invoicePadding: 6,
    jobPrefix: 'JC-',
    purchasePrefix: 'PO-',
    returnPrefix: 'RTN-',
    shiftPrefix: 'SH-',
    warrantyPrefix: 'WR-',
    receiptWidth: '80',
    footerNote: 'Thank you for choosing Servixa. Drive safe.',
    showLogoOnReceipt: true,
    defaultTaxRate: 0,
    allowDiscounts: true,
    maxDiscountPercent: 20,
    negativeStock: false,
    deductStockOnJobComplete: true,
    paymentMethods: ['cash', 'card', 'bank', 'online']
  },
  security: {
    minPasswordLength: 8,
    sessionHours: 12,
    requireUppercase: false,
    requireNumber: true,
    lockAfterFailures: 0
  },
  notifications: { soundEnabled: true, volume: 70, lowStock: true, sales: true, jobs: true, warranty: true, shift: true },
  loginCopy: {
    heading: 'Welcome back',
    subtitle: 'Access your workshop to continue',
    tagline: 'Workshop Management System'
  },
  attachments: { logo: null, loginArt: null, heroArt: null, setupArt: null, loginArtPosition: '50% 50%', heroArtPosition: '50% 50%' },
  roles: DEFAULT_ROLES,
  setupComplete: false,
  onboardingDismissed: false
};

export async function getSettings(): Promise<AppSettings> {
  const rec = await dbGet<{ key: string; value: AppSettings }>('settings', 'app');
  if (!rec) return DEFAULT_SETTINGS;
  // Shallow-merge defaults so new fields in upgrades don't break old installs.
  return {
    ...DEFAULT_SETTINGS,
    ...rec.value,
    profile: { ...DEFAULT_SETTINGS.profile, ...rec.value.profile },
    documents: { ...DEFAULT_SETTINGS.documents, ...rec.value.documents },
    security: { ...DEFAULT_SETTINGS.security, ...rec.value.security },
    notifications: { ...DEFAULT_SETTINGS.notifications, ...rec.value.notifications },
    loginCopy: { ...DEFAULT_SETTINGS.loginCopy, ...rec.value.loginCopy },
    attachments: { ...DEFAULT_SETTINGS.attachments, ...rec.value.attachments },
    roles: { ...DEFAULT_SETTINGS.roles, ...(rec.value.roles ?? {}) }
  };
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  await withTx(['settings'], 'readwrite', async (tx) => {
    await tx.put('settings', { key: 'app', value: settings });
  });
}

/** Called once per boot: creates default sequences/settings if missing. */
export async function ensureInitialised(): Promise<void> {
  await withTx(['settings', 'sequences'], 'readwrite', async (tx) => {
    const s = await tx.get<{ key: string }>('settings', 'app');
    if (!s) await tx.put('settings', { key: 'app', value: DEFAULT_SETTINGS });
    for (const seq of DEFAULT_SEQUENCES) {
      const existing = await tx.get<Sequence>('sequences', seq.key);
      if (!existing) await tx.put('sequences', seq);
    }
  });
}

export async function getMeta<T>(key: string): Promise<T | undefined> {
  const rec = await dbGet<MetaRecord>('meta', key);
  return rec?.value as T | undefined;
}

export async function setMeta(key: string, value: unknown, tx?: Tx): Promise<void> {
  const record: MetaRecord = { key, value };
  if (tx) {
    await tx.put('meta', record);
    return;
  }
  await withTx(['meta'], 'readwrite', async (t) => {
    await t.put('meta', record);
  });
}

export type { User, Customer, Vehicle, Part, Service, Labor, Supplier, Purchase, Invoice, Payment, JobCard, ReturnDoc, Warranty, Expense, CashShift, StockMove, AuditEvent, AppNotification };
