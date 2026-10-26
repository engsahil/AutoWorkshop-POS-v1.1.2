/**
 * Full data archive: every business record exported as a ZIP of CSV files with
 * a machine-readable manifest, and a validated restore back from that archive.
 *
 * Why a second export format when Settings already has a JSON backup?
 * - The JSON backup is the quick "move this device" format: one file, one
 *   transaction, restored whole.
 * - The archive is the "I want my data" format: one CSV per entity, openable in
 *   a spreadsheet, stable IDs and foreign keys, plus a manifest that documents
 *   columns and relationships. It restores in either clean or merge mode.
 *
 * Neither format contains credentials: password hashes, salts and lockout
 * counters never leave the database.
 *
 * Everything here is dependency-free. The ZIP writer uses the browser's own
 * CompressionStream when present and falls back to stored (uncompressed)
 * entries, which every ZIP reader accepts.
 */
import { STORE_NAMES, withTx, openDB, type StoreName } from './db';
import { hashPassword, passwordIssues, randomSalt } from './auth';
import { uid } from './ids';
import { readZipDirectory, readZipText } from './import/zip';
import { splitDelimited } from './import/csv';
import { DEFAULT_SETTINGS } from './db';
import {
  APP_VERSION,
  type AppSettings, type MetaRecord, type Sequence, type User
} from './types';
import type { ImportHistoryEntry } from './import/types';

export const ARCHIVE_FORMAT = 'servixa-data-archive';
export const ARCHIVE_VERSION = 1;
export const MAX_ARCHIVE_BYTES = 120 * 1024 * 1024;

/* ------------------------------- csv writer ------------------------------- */

/** Characters that make Excel/LibreOffice treat a cell as a formula. */
const FORMULA_START = /^[=+\-@\t\r]/;
const FORMULA_GUARD = "'";

export function csvCell(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  let s = String(value);
  // CSV formula injection: a text cell that begins with = + - @ or a control
  // character is prefixed with an apostrophe. Numbers are written unquoted and
  // never reach this branch, so negative amounts stay numeric.
  if (FORMULA_START.test(s)) s = FORMULA_GUARD + s;
  if (/[",\r\n]/.test(s) || s !== s.trim()) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function csvCellValue(raw: string): string {
  // Undo the guard on read, but only for the exact shape we write.
  if (raw.length > 1 && raw[0] === FORMULA_GUARD && FORMULA_START.test(raw.slice(1))) return raw.slice(1);
  return raw;
}

export function toCsvText(header: string[], rows: unknown[][]): string {
  const head = header.map(csvCell).join(',');
  const body = rows.map((r) => r.map(csvCell).join(','));
  return `\uFEFF${[head, ...body].join('\r\n')}\r\n`;
}

/* ------------------------------- zip writer ------------------------------- */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

async function deflateRaw(bytes: Uint8Array): Promise<Uint8Array | null> {
  if (typeof CompressionStream === 'undefined') return null;
  try {
    const stream = new Blob([bytes as unknown as BlobPart]).stream()
      .pipeThrough(new CompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    return null;
  }
}

export interface ZipFileInput {
  name: string;
  bytes: Uint8Array;
}

/** Minimal store/deflate ZIP writer. Returns the archive as a Blob. */
export async function buildZip(files: ZipFileInput[]): Promise<Blob> {
  const encoder = new TextEncoder();
  const entries: { name: Uint8Array; crc: number; method: number; data: Uint8Array; size: number; offset: number }[] = [];
  const chunks: Uint8Array[] = [];
  let offset = 0;

  const push = (bytes: Uint8Array) => {
    chunks.push(bytes);
    offset += bytes.length;
  };
  const u16 = (n: number) => new Uint8Array([n & 0xff, (n >>> 8) & 0xff]);
  const u32 = (n: number) => new Uint8Array([n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff]);

  const now = new Date();
  const dosTime = ((now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2)) & 0xffff;
  const dosDate = (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xffff;

  for (const file of files) {
    const nameBytes = encoder.encode(file.name);
    const crc = crc32(file.bytes);
    const compressed = file.bytes.length > 512 ? await deflateRaw(file.bytes) : null;
    const method = compressed && compressed.length < file.bytes.length ? 8 : 0;
    const data = method === 8 ? compressed! : file.bytes;
    entries.push({ name: nameBytes, crc, method, data, size: file.bytes.length, offset });
    push(u32(0x04034b50));
    push(u16(20));
    push(u16(0x0800));
    push(u16(method));
    push(u16(dosTime));
    push(u16(dosDate));
    push(u32(crc));
    push(u32(data.length));
    push(u32(file.bytes.length));
    push(u16(nameBytes.length));
    push(u16(0));
    push(nameBytes);
    push(data);
  }

  const cdStart = offset;
  for (const entry of entries) {
    push(u32(0x02014b50));
    push(u16(20));
    push(u16(20));
    push(u16(0x0800));
    push(u16(entry.method));
    push(u16(dosTime));
    push(u16(dosDate));
    push(u32(entry.crc));
    push(u32(entry.data.length));
    push(u32(entry.size));
    push(u16(entry.name.length));
    push(u16(0));
    push(u16(0));
    push(u16(0));
    push(u16(0));
    push(u32(0));
    push(u32(entry.offset));
    push(entry.name);
  }
  const cdSize = offset - cdStart;
  push(u32(0x06054b50));
  push(u16(0));
  push(u16(0));
  push(u16(entries.length));
  push(u16(entries.length));
  push(u32(cdSize));
  push(u32(cdStart));
  push(u16(0));

  return new Blob(chunks as unknown as BlobPart[], { type: 'application/zip' });
}

/* ----------------------------- table definitions --------------------------- */

type Kind = 's' | 'n' | 'b' | 'j';

interface ColumnDef {
  name: string;
  kind: Kind;
}

export interface TableDef {
  entity: string;
  file: string;
  label: string;
  columns: ColumnDef[];
  /** Column(s) with a unique business meaning, used for merge conflicts. */
  businessKey?: string[];
  store?: StoreName;
}

const col = (name: string, kind: Kind = 's'): ColumnDef => ({ name, kind });

const BASE_COLS = [col('id'), col('createdAt', 'n'), col('updatedAt', 'n')];

export const TABLES: TableDef[] = [
  {
    entity: 'customers', file: 'customers.csv', label: 'Customers', store: 'customers', businessKey: ['code'],
    columns: [...BASE_COLS, col('code'), col('name'), col('phone'), col('email'), col('address'), col('cnic'),
      col('notes'), col('balancePaisa', 'n'), col('archived', 'b')]
  },
  {
    entity: 'vehicles', file: 'vehicles.csv', label: 'Vehicles', store: 'vehicles',
    columns: [...BASE_COLS, col('customerId'), col('regNo'), col('make'), col('model'), col('year', 'n'),
      col('vin'), col('engineNo'), col('color'), col('odometer', 'n'), col('notes'), col('archived', 'b')]
  },
  {
    entity: 'parts', file: 'parts.csv', label: 'Parts', store: 'parts', businessKey: ['sku'],
    columns: [...BASE_COLS, col('sku'), col('barcode'), col('name'), col('category'), col('subcategory'),
      col('brand'), col('compatibility'), col('description'), col('costPaisa', 'n'), col('pricePaisa', 'n'),
      col('minPricePaisa', 'n'), col('qty', 'n'), col('reorderLevel', 'n'), col('unit'), col('supplierId'),
      col('location'), col('taxRate', 'n'), col('warrantyMonths', 'n'), col('archived', 'b')]
  },
  {
    entity: 'services', file: 'services.csv', label: 'Services', store: 'services', businessKey: ['code'],
    columns: [...BASE_COLS, col('code'), col('name'), col('category'), col('description'),
      col('pricePaisa', 'n'), col('taxRate', 'n'), col('durationMins', 'n'), col('archived', 'b')]
  },
  {
    entity: 'labor', file: 'labor.csv', label: 'Labour', store: 'labor', businessKey: ['code'],
    columns: [...BASE_COLS, col('code'), col('name'), col('ratePaisa', 'n'), col('category'),
      col('description'), col('archived', 'b')]
  },
  {
    entity: 'suppliers', file: 'suppliers.csv', label: 'Suppliers', store: 'suppliers',
    columns: [...BASE_COLS, col('name'), col('contactPerson'), col('phone'), col('email'), col('address'),
      col('balancePaisa', 'n'), col('notes'), col('archived', 'b')]
  },
  {
    entity: 'purchases', file: 'purchases.csv', label: 'Purchases', store: 'purchases', businessKey: ['number'],
    columns: [...BASE_COLS, col('number'), col('supplierId'), col('date', 'n'), col('status'),
      col('subtotalPaisa', 'n'), col('taxPaisa', 'n'), col('discountPaisa', 'n'), col('totalPaisa', 'n'),
      col('paidPaisa', 'n'), col('receivedAt', 'n'), col('notes'), col('createdBy'), col('opId')]
  },
  {
    entity: 'purchase_lines', file: 'purchase_lines.csv', label: 'Purchase lines',
    columns: [col('purchaseId'), col('lineId'), col('partId'), col('name'), col('sku'), col('qty', 'n'),
      col('costPaisa', 'n'), col('taxRate', 'n'), col('totalPaisa', 'n')]
  },
  {
    entity: 'invoices', file: 'invoices.csv', label: 'Invoices', store: 'invoices', businessKey: ['number'],
    columns: [...BASE_COLS, col('number'), col('type'), col('customerId'), col('vehicleId'), col('jobCardId'),
      col('date', 'n'), col('subtotalPaisa', 'n'), col('discountPaisa', 'n'), col('taxPaisa', 'n'),
      col('totalPaisa', 'n'), col('paidPaisa', 'n'), col('duePaisa', 'n'), col('paymentStatus'), col('status'),
      col('shiftId'), col('notes'), col('createdBy'), col('opId')]
  },
  {
    entity: 'invoice_lines', file: 'invoice_lines.csv', label: 'Invoice lines',
    columns: [col('invoiceId'), col('lineId'), col('kind'), col('refId'), col('name'), col('sku'),
      col('qty', 'n'), col('ratePaisa', 'n'), col('discountPaisa', 'n'), col('taxRate', 'n'),
      col('taxPaisa', 'n'), col('totalPaisa', 'n'), col('costPaisa', 'n')]
  },
  {
    entity: 'payments', file: 'payments.csv', label: 'Payments', store: 'payments', businessKey: ['number'],
    columns: [...BASE_COLS, col('number'), col('kind'), col('invoiceId'), col('purchaseId'), col('customerId'),
      col('supplierId'), col('method'), col('amountPaisa', 'n'), col('date', 'n'), col('shiftId'),
      col('reference'), col('notes'), col('createdBy'), col('voided', 'b'), col('opId')]
  },
  {
    entity: 'jobcards', file: 'jobcards.csv', label: 'Job cards', store: 'jobcards', businessKey: ['number'],
    columns: [...BASE_COLS, col('number'), col('customerId'), col('vehicleId'), col('odometer', 'n'),
      col('complaint'), col('findings'), col('recommendation'), col('priority'), col('mechanicId'),
      col('estimatePaisa', 'n'), col('dueDate'), col('status'), col('customerApproved', 'b'),
      col('completedAt', 'n'), col('invoiceId'), col('notes'), col('createdBy'), col('opId')]
  },
  {
    entity: 'job_lines', file: 'job_lines.csv', label: 'Job card lines',
    columns: [col('jobCardId'), col('lineId'), col('kind'), col('refId'), col('name'), col('qty', 'n'),
      col('ratePaisa', 'n'), col('taxRate', 'n')]
  },
  {
    entity: 'job_history', file: 'job_history.csv', label: 'Job card history',
    columns: [col('jobCardId'), col('at', 'n'), col('by'), col('status'), col('action'), col('note')]
  },
  {
    entity: 'returns', file: 'returns.csv', label: 'Returns', store: 'returns', businessKey: ['number'],
    columns: [...BASE_COLS, col('number'), col('invoiceId'), col('customerId'), col('date', 'n'),
      col('subtotalPaisa', 'n'), col('taxPaisa', 'n'), col('totalPaisa', 'n'), col('refundMethod'),
      col('refundPaisa', 'n'), col('reason'), col('shiftId'), col('createdBy'), col('opId')]
  },
  {
    entity: 'return_lines', file: 'return_lines.csv', label: 'Return lines',
    columns: [col('returnId'), col('lineId'), col('invoiceLineId'), col('partId'), col('kind'), col('name'),
      col('qty', 'n'), col('ratePaisa', 'n'), col('totalPaisa', 'n'), col('restock', 'b')]
  },
  {
    entity: 'warranty', file: 'warranty.csv', label: 'Warranty', store: 'warranty', businessKey: ['number'],
    columns: [...BASE_COLS, col('number'), col('customerId'), col('vehicleId'), col('invoiceId'), col('partId'),
      col('serviceId'), col('itemName'), col('startDate'), col('endDate'), col('terms'), col('status')]
  },
  {
    entity: 'warranty_claims', file: 'warranty_claims.csv', label: 'Warranty claims',
    columns: [col('warrantyId'), col('at', 'n'), col('description'), col('resolution'), col('by')]
  },
  {
    entity: 'expenses', file: 'expenses.csv', label: 'Expenses', store: 'expenses',
    columns: [...BASE_COLS, col('category'), col('date', 'n'), col('amountPaisa', 'n'), col('method'),
      col('description'), col('shiftId'), col('status'), col('createdBy'), col('approvedBy')]
  },
  {
    entity: 'cash_shifts', file: 'cash_shifts.csv', label: 'Cash shifts', store: 'cashShifts', businessKey: ['number'],
    columns: [...BASE_COLS, col('number'), col('userId'), col('openedAt', 'n'), col('openingPaisa', 'n'),
      col('closedAt', 'n'), col('countedPaisa', 'n'), col('expectedPaisa', 'n'), col('variancePaisa', 'n'),
      col('status'), col('notes'), col('closingNotes')]
  },
  {
    entity: 'cash_movements', file: 'cash_movements.csv', label: 'Cash movements', store: 'cashMovements',
    columns: [...BASE_COLS, col('shiftId'), col('type'), col('amountPaisa', 'n'), col('reason'),
      col('at', 'n'), col('createdBy')]
  },
  {
    entity: 'stock_moves', file: 'stock_moves.csv', label: 'Stock movements', store: 'stockMoves',
    columns: [...BASE_COLS, col('partId'), col('type'), col('qty', 'n'), col('unitCostPaisa', 'n'),
      col('refType'), col('refId'), col('note'), col('date', 'n'), col('createdBy')]
  },
  {
    entity: 'sequences', file: 'sequences.csv', label: 'Numbering sequences',
    columns: [col('key'), col('prefix'), col('next', 'n'), col('padding', 'n')]
  },
  {
    entity: 'users', file: 'users.csv', label: 'Users (no credentials)',
    columns: [...BASE_COLS, col('username'), col('name'), col('role'), col('email'), col('phone'),
      col('active', 'b'), col('isOwner', 'b'), col('avatar'), col('preferences', 'j'), col('lastLogin', 'n')]
  },
  {
    entity: 'audit', file: 'audit.csv', label: 'Audit log', store: 'audit',
    columns: [...BASE_COLS, col('action'), col('entity'), col('entityId'), col('summary'), col('userId'),
      col('userName'), col('meta', 'j')]
  },
  {
    entity: 'notifications', file: 'notifications.csv', label: 'Notifications', store: 'notifications',
    columns: [...BASE_COLS, col('type'), col('title'), col('message'), col('link'), col('read', 'b')]
  },
  {
    entity: 'import_history', file: 'import_history.csv', label: 'Inventory import history',
    columns: [col('id'), col('at', 'n'), col('fileName'), col('kind'), col('fingerprint'), col('total', 'n'),
      col('imported', 'n'), col('updated', 'n'), col('skipped', 'n'), col('failed', 'n'), col('userName')]
  }
];

export const TABLE_BY_ENTITY = new Map(TABLES.map((t) => [t.entity, t]));

/* ------------------------------ value helpers ------------------------------ */

function cast(raw: string | undefined, kind: Kind): unknown {
  if (raw == null || raw === '') return undefined;
  if (kind === 'n') {
    const n = Number(raw);
    return Number.isFinite(n) ? n : undefined;
  }
  if (kind === 'b') return raw === 'true' || raw === '1' || raw === 'yes';
  if (kind === 'j') {
    try {
      return JSON.parse(raw);
    } catch {
      return undefined;
    }
  }
  return csvCellValue(raw);
}

function rowFromRecord(record: Record<string, unknown>, columns: ColumnDef[]): unknown[] {
  return columns.map((c) => {
    const value = record[c.name];
    if (c.kind === 'j') return value == null ? '' : JSON.stringify(value);
    return value as unknown;
  });
}

function recordFromRow(row: Record<string, string | undefined>, columns: ColumnDef[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const c of columns) {
    const value = cast(row[c.name], c.kind);
    if (value !== undefined) out[c.name] = value;
  }
  return out;
}

/* --------------------------------- export --------------------------------- */

const ASSET_KEYS = ['logo', 'loginArt', 'heroArt', 'setupArt'] as const;

function assetExtension(dataUri: string): string {
  const match = /^data:image\/(png|jpeg|jpg|webp|svg\+xml|gif);base64,/i.exec(dataUri);
  if (!match) return 'bin';
  const kind = match[1].toLowerCase();
  if (kind === 'jpeg' || kind === 'jpg') return 'jpg';
  if (kind === 'svg+xml') return 'svg';
  return kind;
}

function base64Of(dataUri: string): string {
  const idx = dataUri.indexOf(',');
  return idx >= 0 ? dataUri.slice(idx + 1) : dataUri;
}

export interface ArchiveManifest {
  format: typeof ARCHIVE_FORMAT;
  version: number;
  appVersion: string;
  createdAt: number;
  businessName: string;
  exportedBy: string;
  counts: Record<string, number>;
  files: { file: string; entity: string; label: string; rows: number; columns: string[]; businessKey?: string[] }[];
  relationships: { from: string; column: string; to: string }[];
  assets: { key: string; file: string; mime: string; bytes: number }[];
  notes: string;
}

export interface ArchiveBuild {
  blob: Blob;
  filename: string;
  manifest: ArchiveManifest;
}

export async function buildDataArchive(exportedBy: string): Promise<ArchiveBuild> {
  await openDB();

  const data: Record<string, Record<string, unknown>[]> = {};
  for (const table of TABLES) {
    if (!table.store) continue;
    data[table.entity] = await withTx([table.store], 'readonly', (tx) => tx.all<Record<string, unknown>>(table.store!));
  }

  const settingsValue = await withTx(['settings', 'sequences', 'users', 'meta'], 'readonly', async (tx) => {
    const app = await tx.get<{ key: string; value: AppSettings }>('settings', 'app');
    return {
      settings: app?.value ?? DEFAULT_SETTINGS,
      sequences: await tx.all<Sequence>('sequences'),
      users: await tx.all<User>('users'),
      history: (await tx.get<MetaRecord>('meta', 'import.history'))?.value as ImportHistoryEntry[] | undefined
    };
  });

  const files: ZipFileInput[] = [];
  const encoder = new TextEncoder();
  const manifest: ArchiveManifest = {
    format: ARCHIVE_FORMAT,
    version: ARCHIVE_VERSION,
    appVersion: APP_VERSION,
    createdAt: Date.now(),
    businessName: settingsValue.settings.profile?.name ?? 'Workshop',
    exportedBy,
    counts: {},
    files: [],
    relationships: [
      { from: 'vehicles', column: 'customerId', to: 'customers' },
      { from: 'parts', column: 'supplierId', to: 'suppliers' },
      { from: 'purchases', column: 'supplierId', to: 'suppliers' },
      { from: 'purchase_lines', column: 'purchaseId', to: 'purchases' },
      { from: 'purchase_lines', column: 'partId', to: 'parts' },
      { from: 'invoices', column: 'customerId', to: 'customers' },
      { from: 'invoices', column: 'vehicleId', to: 'vehicles' },
      { from: 'invoices', column: 'jobCardId', to: 'jobcards' },
      { from: 'invoice_lines', column: 'invoiceId', to: 'invoices' },
      { from: 'payments', column: 'invoiceId', to: 'invoices' },
      { from: 'payments', column: 'purchaseId', to: 'purchases' },
      { from: 'jobcards', column: 'customerId', to: 'customers' },
      { from: 'jobcards', column: 'vehicleId', to: 'vehicles' },
      { from: 'job_lines', column: 'jobCardId', to: 'jobcards' },
      { from: 'job_history', column: 'jobCardId', to: 'jobcards' },
      { from: 'returns', column: 'invoiceId', to: 'invoices' },
      { from: 'return_lines', column: 'returnId', to: 'returns' },
      { from: 'warranty', column: 'customerId', to: 'customers' },
      { from: 'warranty_claims', column: 'warrantyId', to: 'warranty' },
      { from: 'stock_moves', column: 'partId', to: 'parts' },
      { from: 'cash_movements', column: 'shiftId', to: 'cash_shifts' }
    ],
    assets: [],
    notes:
      'One CSV per entity. Nested collections are separate files keyed by their parent id. ' +
      'Money is integer paisa; timestamps are Unix milliseconds. Password hashes and salts are never exported.'
  };

  for (const table of TABLES) {
    let rows: unknown[][];
    if (table.entity === 'sequences') {
      rows = settingsValue.sequences.map((s) => rowFromRecord(s as unknown as Record<string, unknown>, table.columns));
    } else if (table.entity === 'users') {
      rows = settingsValue.users.map((u) => rowFromRecord(
        { ...u, avatar: u.avatar ?? '' } as unknown as Record<string, unknown>, table.columns));
    } else if (table.entity === 'import_history') {
      rows = (settingsValue.history ?? []).map((h) => rowFromRecord(h as unknown as Record<string, unknown>, table.columns));
    } else if (['invoice_lines', 'purchase_lines', 'job_lines', 'job_history', 'return_lines', 'warranty_claims'].includes(table.entity)) {
      rows = childRows(table.entity, data);
    } else {
      rows = (data[table.entity] ?? []).map((r) => rowFromRecord(r, table.columns));
    }
    const text = toCsvText(table.columns.map((c) => c.name), rows);
    files.push({ name: table.file, bytes: encoder.encode(text) });
    manifest.counts[table.entity] = rows.length;
    manifest.files.push({
      file: table.file, entity: table.entity, label: table.label, rows: rows.length,
      columns: table.columns.map((c) => c.name), businessKey: table.businessKey
    });
  }

  /* settings: one row per key, complex values JSON-encoded */
  const { attachments, ...restSettings } = settingsValue.settings;
  const settingsRows: unknown[][] = Object.entries(restSettings).map(([key, value]) => [key, JSON.stringify(value)]);
  files.push({ name: 'settings.csv', bytes: encoder.encode(toCsvText(['key', 'value'], settingsRows)) });

  /* artwork lives beside the CSVs, never inside a cell */
  const assetRows: unknown[][] = [];
  for (const key of ASSET_KEYS) {
    const value = attachments?.[key];
    if (!value || typeof value !== 'string' || !value.startsWith('data:')) continue;
    const ext = assetExtension(value);
    const fileName = `assets/${key}.${ext}`;
    const mime = /^data:([^;,]+)/.exec(value)?.[1] ?? 'application/octet-stream';
    const bytes = Uint8Array.from(atob(base64Of(value)), (ch) => ch.charCodeAt(0));
    files.push({ name: fileName, bytes });
    assetRows.push([key, fileName, mime, bytes.length]);
    manifest.assets.push({ key, file: fileName, mime, bytes: bytes.length });
  }
  files.push({ name: 'assets.csv', bytes: encoder.encode(toCsvText(['key', 'file', 'mime', 'bytes'], assetRows)) });

  manifest.counts.settings = settingsRows.length;
  manifest.counts.assets = assetRows.length;
  files.push({ name: 'manifest.json', bytes: encoder.encode(JSON.stringify(manifest, null, 2)) });

  const blob = await buildZip(files);
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  return { blob, filename: `servixa-data-${stamp}.zip`, manifest };
}

function childRows(entity: string, data: Record<string, Record<string, unknown>[]>): unknown[][] {
  const rows: unknown[][] = [];
  const table = TABLE_BY_ENTITY.get(entity)!;
  const cols = table.columns.map((c) => c.name);
  const push = (record: Record<string, unknown>) => rows.push(rowFromRecord(record, table.columns));
  if (entity === 'invoice_lines') {
    for (const inv of data.invoices ?? []) {
      for (const line of (inv.lines as Record<string, unknown>[] | undefined) ?? []) {
        push({ ...line, lineId: line.id, invoiceId: inv.id } as Record<string, unknown>);
      }
    }
  } else if (entity === 'purchase_lines') {
    for (const p of data.purchases ?? []) {
      for (const line of (p.lines as Record<string, unknown>[] | undefined) ?? []) {
        push({ ...line, lineId: line.id, purchaseId: p.id } as Record<string, unknown>);
      }
    }
  } else if (entity === 'job_lines') {
    for (const j of data.jobcards ?? []) {
      for (const line of (j.lines as Record<string, unknown>[] | undefined) ?? []) {
        push({ ...line, lineId: line.id, jobCardId: j.id } as Record<string, unknown>);
      }
    }
  } else if (entity === 'job_history') {
    for (const j of data.jobcards ?? []) {
      for (const h of (j.history as Record<string, unknown>[] | undefined) ?? []) {
        push({ ...h, jobCardId: j.id } as Record<string, unknown>);
      }
    }
  } else if (entity === 'return_lines') {
    for (const r of data.returns ?? []) {
      for (const line of (r.lines as Record<string, unknown>[] | undefined) ?? []) {
        push({ ...line, lineId: line.id, invoiceLineId: line.lineId, returnId: r.id } as Record<string, unknown>);
      }
    }
  } else if (entity === 'warranty_claims') {
    for (const w of data.warranty ?? []) {
      for (const claim of (w.claims as Record<string, unknown>[] | undefined) ?? []) {
        push({ ...claim, warrantyId: w.id } as Record<string, unknown>);
      }
    }
  }
  void cols;
  return rows;
}

/* --------------------------------- restore -------------------------------- */

export interface ArchiveTableData {
  entity: string;
  rows: Record<string, unknown>[];
}

export interface ParsedArchive {
  manifest: ArchiveManifest;
  tables: Record<string, Record<string, unknown>[]>;
  settings: Partial<AppSettings>;
  assets: Record<string, string>;
  issues: { level: 'error' | 'warning'; message: string }[];
}

function parseCsv(text: string): { header: string[]; rows: Record<string, string>[] } {
  const clean = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const delimiter = clean.includes(';') && !clean.includes(',') ? ';' : ',';
  const matrix = splitDelimited(clean, delimiter);
  if (!matrix.length) return { header: [], rows: [] };
  const header = matrix[0].map((h) => h.trim());
  const rows = matrix.slice(1)
    .filter((r) => r.some((cell) => cell !== ''))
    .map((r) => {
      const obj: Record<string, string> = {};
      header.forEach((h, i) => { obj[h] = r[i] ?? ''; });
      return obj;
    });
  return { header, rows };
}

export async function parseDataArchive(file: File): Promise<ParsedArchive> {
  if (file.size > MAX_ARCHIVE_BYTES) {
    throw new Error(`Archive is larger than ${Math.round(MAX_ARCHIVE_BYTES / 1024 / 1024)} MB.`);
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const entries = readZipDirectory(bytes);
  const byName = new Map(entries.map((e) => [e.name, e]));
  const manifestEntry = byName.get('manifest.json');
  if (!manifestEntry) throw new Error('This ZIP has no manifest.json, so it is not a Servixa data archive.');

  const issues: ParsedArchive['issues'] = [];
  let manifest: ArchiveManifest;
  try {
    manifest = JSON.parse(await readZipText(bytes, manifestEntry)) as ArchiveManifest;
  } catch {
    throw new Error('manifest.json could not be read as JSON.');
  }
  if (manifest.format !== ARCHIVE_FORMAT) throw new Error('Unrecognised archive format marker.');
  if (manifest.version > ARCHIVE_VERSION) {
    throw new Error(`Archive version ${manifest.version} is newer than this app supports (${ARCHIVE_VERSION}).`);
  }

  const tables: Record<string, Record<string, unknown>[]> = {};
  for (const table of TABLES) {
    const entry = byName.get(table.file);
    if (!entry) {
      issues.push({ level: 'warning', message: `${table.file} is missing from the archive; ${table.label.toLowerCase()} will be restored empty.` });
      tables[table.entity] = [];
      continue;
    }
    const { header, rows } = parseCsv(await readZipText(bytes, entry));
    const missing = table.columns.map((c) => c.name).filter((name) => !header.includes(name));
    if (missing.length) {
      issues.push({ level: 'error', message: `${table.file} is missing column(s): ${missing.join(', ')}.` });
      continue;
    }
    tables[table.entity] = rows.map((r) => recordFromRow(r, table.columns));
  }

  const settings: Partial<AppSettings> = {};
  const settingsEntry = byName.get('settings.csv');
  if (settingsEntry) {
    const { rows } = parseCsv(await readZipText(bytes, settingsEntry));
    for (const row of rows) {
      const key = row.key;
      if (!key) continue;
      try {
        (settings as Record<string, unknown>)[key] = row.value ? JSON.parse(csvCellValue(row.value)) : undefined;
      } catch {
        issues.push({ level: 'warning', message: `Setting “${key}” could not be parsed and was skipped.` });
      }
    }
  } else {
    issues.push({ level: 'warning', message: 'settings.csv is missing; current settings will be kept.' });
  }

  const assets: Record<string, string> = {};
  const assetsEntry = byName.get('assets.csv');
  if (assetsEntry) {
    const { rows } = parseCsv(await readZipText(bytes, assetsEntry));
    for (const row of rows) {
      const entry = byName.get(row.file ?? '');
      if (!entry || !row.key) continue;
      const data = await extractEntryBytes(bytes, entry);
      assets[row.key] = `data:${row.mime || 'application/octet-stream'};base64,${toBase64(data)}`;
    }
  }

  return { manifest, tables, settings, assets, issues };
}

async function extractEntryBytes(bytes: Uint8Array, entry: { name: string; method: number; compressedSize: number; offset: number }): Promise<Uint8Array> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(entry.offset, true) !== 0x04034b50) throw new Error(`Damaged ZIP entry: ${entry.name}`);
  const nameLen = view.getUint16(entry.offset + 26, true);
  const extraLen = view.getUint16(entry.offset + 28, true);
  const start = entry.offset + 30 + nameLen + extraLen;
  const data = bytes.subarray(start, start + entry.compressedSize);
  if (entry.method === 0) return data;
  if (entry.method !== 8) throw new Error(`Unsupported ZIP compression in ${entry.name}.`);
  if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot decompress the archive.');
  const stream = new Blob([data as unknown as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/* ------------------------------- planning --------------------------------- */

export type RestoreMode = 'clean' | 'merge';

export interface EntityPlan {
  entity: string;
  label: string;
  inArchive: number;
  willAdd: number;
  willSkip: number;
  conflicts: number;
}

export interface RestorePlan {
  mode: RestoreMode;
  entities: EntityPlan[];
  totals: { add: number; skip: number; conflict: number };
  warnings: string[];
  errors: string[];
  adminCandidates: { id: string; name: string; username: string }[];
  settingsWillBeReplaced: boolean;
  assetsWillBeReplaced: boolean;
}

interface CurrentIndex {
  ids: Record<string, Set<string>>;
  businessKeys: Record<string, Set<string>>;
}

function businessKeyOf(table: TableDef, row: Record<string, unknown>): string | null {
  if (!table.businessKey?.length) return null;
  const parts = table.businessKey.map((k) => String(row[k] ?? '').toLowerCase());
  return parts.every((p) => p !== '') ? parts.join('␟') : null;
}

export async function readCurrentIndex(): Promise<CurrentIndex> {
  const index: CurrentIndex = { ids: {}, businessKeys: {} };
  for (const table of TABLES) {
    if (!table.store) continue;
    const rows = await withTx([table.store], 'readonly', (tx) => tx.all<Record<string, unknown>>(table.store!));
    index.ids[table.entity] = new Set(rows.map((r) => String(r.id)));
    index.businessKeys[table.entity] = new Set(
      rows.map((r) => businessKeyOf(table, r)).filter((k): k is string => !!k));
  }
  return index;
}

export function planRestore(archive: ParsedArchive, mode: RestoreMode, current: CurrentIndex): RestorePlan {
  const warnings: string[] = [];
  const errors: string[] = [...archive.issues.filter((i) => i.level === 'error').map((i) => i.message)];
  warnings.push(...archive.issues.filter((i) => i.level === 'warning').map((i) => i.message));

  const entities: EntityPlan[] = [];
  for (const table of TABLES) {
    if (!table.store && !['sequences', 'users'].includes(table.entity)) continue;
    const rows = archive.tables[table.entity] ?? [];
    let add = 0;
    let skip = 0;
    let conflicts = 0;
    for (const row of rows) {
      const id = String(row.id ?? '');
      if (!id) { conflicts++; continue; }
      const exists = current.ids[table.entity]?.has(id) ?? false;
      const key = businessKeyOf(table, row);
      const keyExists = key ? (current.businessKeys[table.entity]?.has(key) ?? false) : false;
      if (mode === 'clean') { add++; continue; }
      if (exists) { skip++; continue; }
      if (keyExists) { conflicts++; continue; }
      add++;
    }
    if (mode === 'clean') { skip = 0; conflicts = 0; }
    entities.push({ entity: table.entity, label: table.label, inArchive: rows.length, willAdd: add, willSkip: skip, conflicts });
  }

  const totals = entities.reduce((acc, e) => ({
    add: acc.add + e.willAdd, skip: acc.skip + e.willSkip, conflict: acc.conflict + e.conflicts
  }), { add: 0, skip: 0, conflict: 0 });

  const admins = (archive.tables.users ?? [])
    .filter((u) => u.role === 'Administrator' || u.isOwner)
    .map((u) => ({ id: String(u.id), name: String(u.name ?? 'Administrator'), username: String(u.username ?? '') }));

  if (mode === 'merge' && archive.tables.settings && Object.keys(archive.settings).length) {
    warnings.push('Merge keeps the settings and users already on this device; only missing records are added.');
  }
  if (mode === 'clean' && !admins.length) {
    errors.push('The archive contains no administrator account, so a clean restore cannot issue a sign-in.');
  }
  if (mode === 'clean' && totals.add === 0) {
    errors.push('The archive contains no records to restore.');
  }

  return {
    mode,
    entities,
    totals,
    warnings,
    errors,
    adminCandidates: admins,
    settingsWillBeReplaced: mode === 'clean',
    assetsWillBeReplaced: mode === 'clean'
  };
}

/* ------------------------------- applying --------------------------------- */

export interface ApplyRestoreOptions {
  mode: RestoreMode;
  adminUserId?: string;
  newPassword?: string;
  actorName?: string;
  actorId?: string;
}

function assemble(archive: ParsedArchive): Record<string, Record<string, unknown>[]> {
  const t = archive.tables;
  const byParent = (entity: string, parentKey: string) => {
    const map = new Map<string, Record<string, unknown>[]>();
    for (const row of t[entity] ?? []) {
      const parent = String(row[parentKey] ?? '');
      if (!parent) continue;
      const list = map.get(parent) ?? [];
      list.push(row);
      map.set(parent, list);
    }
    return map;
  };

  const invoiceLines = byParent('invoice_lines', 'invoiceId');
  const purchaseLines = byParent('purchase_lines', 'purchaseId');
  const jobLines = byParent('job_lines', 'jobCardId');
  const jobHistory = byParent('job_history', 'jobCardId');
  const returnLines = byParent('return_lines', 'returnId');
  const claims = byParent('warranty_claims', 'warrantyId');

  const strip = (row: Record<string, unknown>, keys: string[]) => {
    const out = { ...row };
    for (const k of keys) delete out[k];
    return out;
  };

  return {
    ...t,
    invoices: (t.invoices ?? []).map((row) => ({
      ...row,
      lines: (invoiceLines.get(String(row.id)) ?? []).map((l) => ({
        id: String(l.lineId ?? uid('ln')),
        kind: l.kind, refId: l.refId, name: l.name, sku: l.sku,
        qty: Number(l.qty ?? 0), ratePaisa: Number(l.ratePaisa ?? 0),
        discountPaisa: Number(l.discountPaisa ?? 0), taxRate: Number(l.taxRate ?? 0),
        taxPaisa: Number(l.taxPaisa ?? 0), totalPaisa: Number(l.totalPaisa ?? 0),
        costPaisa: Number(l.costPaisa ?? 0)
      }))
    })),
    purchases: (t.purchases ?? []).map((row) => ({
      ...row,
      lines: (purchaseLines.get(String(row.id)) ?? []).map((l) => ({
        id: String(l.lineId ?? uid('pl')),
        partId: l.partId, name: l.name, sku: l.sku,
        qty: Number(l.qty ?? 0), costPaisa: Number(l.costPaisa ?? 0),
        taxRate: Number(l.taxRate ?? 0), totalPaisa: Number(l.totalPaisa ?? 0)
      }))
    })),
    jobcards: (t.jobcards ?? []).map((row) => ({
      ...row,
      lines: (jobLines.get(String(row.id)) ?? []).map((l) => ({
        id: String(l.lineId ?? uid('jl')), kind: l.kind, refId: l.refId, name: l.name,
        qty: Number(l.qty ?? 0), ratePaisa: Number(l.ratePaisa ?? 0), taxRate: Number(l.taxRate ?? 0)
      })),
      history: (jobHistory.get(String(row.id)) ?? []).map((h) => ({
        at: Number(h.at ?? 0), by: String(h.by ?? ''), status: h.status ?? undefined,
        action: String(h.action ?? ''), note: h.note ?? undefined
      }))
    })),
    returns: (t.returns ?? []).map((row) => ({
      ...row,
      lines: (returnLines.get(String(row.id)) ?? []).map((l) => ({
        id: String(l.lineId ?? uid('rl')), lineId: l.invoiceLineId, partId: l.partId, kind: l.kind,
        name: l.name, qty: Number(l.qty ?? 0), ratePaisa: Number(l.ratePaisa ?? 0),
        totalPaisa: Number(l.totalPaisa ?? 0), restock: l.restock === true
      }))
    })),
    warranty: (t.warranty ?? []).map((row) => ({
      ...row,
      claims: (claims.get(String(row.id)) ?? []).map((c) => ({
        at: Number(c.at ?? 0), description: String(c.description ?? ''),
        resolution: String(c.resolution ?? ''), by: String(c.by ?? '')
      }))
    })),
    payments: t.payments ?? [],
    expenses: t.expenses ?? [],
    cash_shifts: t.cash_shifts ?? [],
    cash_movements: t.cash_movements ?? [],
    stock_moves: t.stock_moves ?? [],
    customers: t.customers ?? [],
    vehicles: t.vehicles ?? [],
    parts: t.parts ?? [],
    services: t.services ?? [],
    labor: t.labor ?? [],
    suppliers: t.suppliers ?? [],
    audit: t.audit ?? [],
    notifications: t.notifications ?? []
  } as unknown as Record<string, Record<string, unknown>[]>;
}

export interface ApplyResult {
  mode: RestoreMode;
  written: Record<string, number>;
  total: number;
}

export async function applyRestore(
  archive: ParsedArchive, plan: RestorePlan, options: ApplyRestoreOptions
): Promise<ApplyResult> {
  if (plan.errors.length) throw new Error(plan.errors[0]);
  const mode = options.mode;
  const assembled = assemble(archive);
  const written: Record<string, number> = {};

  let restoreSettings: AppSettings | null = null;
  let restoreUsers: User[] = [];

  if (mode === 'clean') {
    const adminId = options.adminUserId;
    if (!adminId) throw new Error('Choose the administrator account to restore.');
    const password = options.newPassword ?? '';
    const targetSettings = { ...DEFAULT_SETTINGS, ...archive.settings } as AppSettings;
    const issues = passwordIssues(password, targetSettings.security ?? DEFAULT_SETTINGS.security);
    if (issues.length) throw new Error(`Administrator password: ${issues.join(' · ')}`);

    const salt = randomSalt();
    const passwordHash = await hashPassword(password, salt);
    const archiveUsers = (archive.tables.users ?? []) as unknown as Partial<User>[];
    if (!archiveUsers.some((u) => String(u.id) === adminId)) {
      throw new Error('That administrator account is not present in the archive.');
    }
    restoreUsers = archiveUsers.map((u) => {
      const isChosen = String(u.id) === adminId;
      return {
        id: String(u.id), createdAt: Number(u.createdAt ?? Date.now()), updatedAt: Date.now(),
        username: String(u.username ?? 'user').toLowerCase(), name: String(u.name ?? 'Staff'),
        role: (isChosen ? 'Administrator' : u.role ?? 'Cashier') as User['role'],
        email: u.email, phone: u.phone, active: isChosen, isOwner: isChosen,
        passwordHash: isChosen ? passwordHash : '', salt: isChosen ? salt : '', iterations: 150_000,
        avatar: u.avatar || null,
        preferences: (u.preferences as User['preferences']) ?? { sound: true, volume: 70, density: 'comfortable' },
        lastLogin: u.lastLogin
      } as User;
    });
    restoreSettings = {
      ...targetSettings,
      setupComplete: true,
      attachments: { ...targetSettings.attachments, ...archive.assets }
    };
  }

  const db = await openDB();
  const stores: StoreName[] = [...STORE_NAMES];

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(stores, 'readwrite', { durability: 'strict' });
    let failure: unknown = null;
    tx.oncomplete = () => (failure ? reject(failure) : resolve());
    tx.onerror = () => reject(tx.error ?? new Error('Restore failed'));
    tx.onabort = () => reject(failure ?? tx.error ?? new Error('Restore aborted'));

    (async () => {
      try {
        const storeMap: [string, StoreName][] = [
          ['customers', 'customers'], ['vehicles', 'vehicles'], ['parts', 'parts'], ['services', 'services'],
          ['labor', 'labor'], ['suppliers', 'suppliers'], ['purchases', 'purchases'], ['invoices', 'invoices'],
          ['payments', 'payments'], ['jobcards', 'jobcards'], ['returns', 'returns'], ['warranty', 'warranty'],
          ['expenses', 'expenses'], ['cash_shifts', 'cashShifts'], ['cash_movements', 'cashMovements'],
          ['stock_moves', 'stockMoves'], ['audit', 'audit'], ['notifications', 'notifications']
        ];

        if (mode === 'clean') {
          for (const [, store] of storeMap) tx.objectStore(store).clear();
          tx.objectStore('users').clear();
          tx.objectStore('settings').clear();
          tx.objectStore('sequences').clear();
          tx.objectStore('meta').clear();
        }

        for (const [key, store] of storeMap) {
          const rows = (assembled[key] ?? []) as Record<string, unknown>[];
          const currentIds = mode === 'merge'
            ? new Set<string>((await reqIds(tx, store)))
            : new Set<string>();
          const currentKeys = mode === 'merge'
            ? new Set<string>((await reqBusinessKeys(tx, store, key)))
            : new Set<string>();
          let count = 0;
          for (const row of rows) {
            const id = String(row.id ?? '');
            if (!id) continue;
            if (mode === 'merge') {
              if (currentIds.has(id)) continue;
              const table = TABLES.find((t) => t.entity === key);
              const bk = table ? businessKeyOf(table, row) : null;
              if (bk && currentKeys.has(bk)) continue;
              if (bk) currentKeys.add(bk);
              currentIds.add(id);
            }
            tx.objectStore(store).put(row);
            count++;
          }
          written[key] = count;
        }

        if (mode === 'clean' && restoreSettings) {
          tx.objectStore('settings').put({ key: 'app', value: restoreSettings });
          for (const seq of (assembled.sequences ?? []) as unknown as Sequence[]) tx.objectStore('sequences').put(seq);
          for (const u of restoreUsers) tx.objectStore('users').put(u);
          written.settings = 1;
          written.sequences = (assembled.sequences ?? []).length;
          written.users = restoreUsers.length;
          tx.objectStore('meta').put({ key: 'restore.at', value: Date.now() });
          tx.objectStore('meta').put({ key: 'restore.source', value: archive.manifest.businessName ?? 'archive' });
        }

        if (mode === 'merge') {
          const archiveUsers = (archive.tables.users ?? []) as unknown as Partial<User>[];
          const existing = await reqAll<User>(tx, 'users');
          const names = new Set(existing.map((u) => u.username.toLowerCase()));
          let added = 0;
          for (const u of archiveUsers) {
            const username = String(u.username ?? '').toLowerCase();
            if (!username || names.has(username)) continue;
            names.add(username);
            tx.objectStore('users').put({
              id: String(u.id ?? uid('usr')), createdAt: Number(u.createdAt ?? Date.now()), updatedAt: Date.now(),
              username, name: String(u.name ?? 'Staff'), role: u.role ?? 'Cashier', email: u.email, phone: u.phone,
              active: false, isOwner: false, passwordHash: '', salt: '', iterations: 150_000,
              avatar: (u.avatar as string) || null,
              preferences: (u.preferences as User['preferences']) ?? { sound: true, volume: 70, density: 'comfortable' }
            } as User);
            added++;
          }
          written.users = added;
          const sequences = (assembled.sequences ?? []) as unknown as Sequence[];
          for (const seq of sequences) {
            const current = await reqGet<Sequence>(tx, 'sequences', seq.key);
            if (!current) {
              tx.objectStore('sequences').put(seq);
              written.sequences = (written.sequences ?? 0) + 1;
            }
          }
        }

        tx.objectStore('audit').put({
          id: uid('aud'), createdAt: Date.now(), updatedAt: Date.now(), action: 'backup.import',
          entity: 'application', entityId: 'all',
          summary: `${mode === 'clean' ? 'Clean restore' : 'Merge restore'} from data archive created ${new Date(
            archive.manifest.createdAt).toLocaleString()} — ${Object.values(written).reduce((a, b) => a + b, 0)} records`,
          userId: options.actorId ?? options.adminUserId ?? 'system', userName: options.actorName ?? 'Administrator'
        });
        tx.objectStore('notifications').put({
          id: uid('ntf'), createdAt: Date.now(), updatedAt: Date.now(), type: 'backup',
          title: mode === 'clean' ? 'Data archive restored' : 'Data archive merged',
          message: `${archive.manifest.counts.parts ?? 0} parts and ${archive.manifest.counts.invoices ?? 0} invoices in the archive.`,
          read: false, link: '/settings'
        });
      } catch (err) {
        failure = err;
        try { tx.abort(); } catch { /* already finished */ }
      }
    })();
  });

  return { mode, written, total: Object.values(written).reduce((a, b) => a + b, 0) };
}

/* Small direct-IDB helpers: the restore transaction must stay alive, so these
 * read through the raw transaction instead of opening a second one. */

function reqIds(tx: IDBTransaction, store: StoreName): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const req = tx.objectStore(store).getAllKeys();
    req.onsuccess = () => resolve((req.result as IDBValidKey[]).map(String));
    req.onerror = () => reject(req.error);
  });
}

function reqAll<T>(tx: IDBTransaction, store: StoreName): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const req = tx.objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result as T[]);
    req.onerror = () => reject(req.error);
  });
}

function reqGet<T>(tx: IDBTransaction, store: StoreName, key: IDBValidKey): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const req = tx.objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

function reqBusinessKeys(tx: IDBTransaction, store: StoreName, entity: string): Promise<string[]> {
  const table = TABLES.find((t) => t.entity === entity);
  if (!table?.businessKey?.length) return Promise.resolve([]);
  return reqAll<Record<string, unknown>>(tx, store)
    .then((rows) => rows.map((r) => businessKeyOf(table, r)).filter((k): k is string => !!k));
}

export function archiveSummary(manifest: ArchiveManifest): string {
  const parts = manifest.counts.parts ?? 0;
  const invoices = manifest.counts.invoices ?? 0;
  const customers = manifest.counts.customers ?? 0;
  return `${parts} parts · ${invoices} invoices · ${customers} customers`;
}

