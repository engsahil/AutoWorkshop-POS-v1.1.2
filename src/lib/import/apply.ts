/**
 * Writing an approved import through the same repository layer the UI uses.
 *
 * - Writes happen in chunks of CHUNK_SIZE inside one IndexedDB transaction per
 *   chunk, so 2,000 items are ~10 transactions rather than 2,000.
 * - Every row is re-checked for SKU/barcode conflicts *inside* the transaction,
 *   so a row that became a duplicate while the user was reviewing is skipped
 *   rather than overwriting anything.
 * - `decision: 'update'` only touches descriptive fields and prices. Quantity is
 *   never written on an update: stock only moves through movements.
 * - If a chunk fails, the chunk is retried row by row so one bad record cannot
 *   discard the rest, and every outcome is reported honestly.
 */
import { uid } from '../ids';
import { mutate, type Actor } from '../repo';
import type { Part } from '../types';
import { recordImport } from './history';
import { parseCount, parseMoney, parseQuantity, parseRate, normalizeUnit, codeKey } from './values';
import {
  CHUNK_SIZE, type DraftItem, type ImportReport, type RowOutcome
} from './types';

export interface ApplyOptions {
  fileName: string;
  kind: 'pdf' | 'csv' | 'tsv' | 'txt' | 'xlsx';
  fingerprint: string;
  description?: string;
  onProgress?: (done: number, total: number) => void;
  signal?: { aborted: boolean };
}

let running = false;

export function isImportRunning(): boolean {
  return running;
}

interface Prepared {
  item: DraftItem;
  name: string;
  sku: string;
  barcode?: string;
  category: string;
  subcategory?: string;
  brand?: string;
  compatibility?: string;
  description?: string;
  unit: string;
  costPaisa: number;
  pricePaisa: number;
  qty: number;
  reorderLevel: number;
  taxRate: number;
  warrantyMonths?: number;
  location?: string;
  decision: 'create' | 'update';
  targetId?: string;
}

function prepare(item: DraftItem): Prepared | string {
  const v = item.values;
  const name = (v.name ?? '').trim();
  if (!name) return 'No item name.';
  const sku = ((v.sku ?? '').trim() || (v.partNumber ?? '').trim()).toUpperCase();
  if (!sku) return 'No SKU.';

  const cost = v.cost?.trim() ? parseMoney(v.cost) : null;
  if (cost && !cost.ok) return `Purchase cost ${cost.reason}.`;
  const price = v.price?.trim() ? parseMoney(v.price) : null;
  if (price && !price.ok) return `Selling price ${price.reason}.`;
  const qty = v.qty?.trim() ? parseQuantity(v.qty) : { ok: true as const, value: 0 };
  if (!qty.ok) return `Quantity ${qty.reason}.`;
  const tax = v.taxRate?.trim() ? parseRate(v.taxRate) : { ok: true as const, value: 0 };
  if (!tax.ok) return `Tax rate ${tax.reason}.`;
  const reorder = v.reorderLevel?.trim() ? parseCount(v.reorderLevel) : { ok: true as const, value: 0 };
  if (!reorder.ok) return `Reorder level ${reorder.reason}.`;
  const warranty = v.warrantyMonths?.trim() ? parseCount(v.warrantyMonths) : null;
  if (warranty && !warranty.ok) return `Warranty ${warranty.reason}.`;

  return {
    item,
    name,
    sku,
    barcode: v.barcode?.trim() || undefined,
    category: v.category?.trim() || 'General',
    subcategory: v.subcategory?.trim() || undefined,
    brand: v.brand?.trim() || undefined,
    compatibility: v.compatibility?.trim() || undefined,
    description: v.description?.trim() || undefined,
    unit: normalizeUnit(v.unit ?? '') || 'pcs',
    costPaisa: cost?.ok ? cost.value : 0,
    pricePaisa: price?.ok ? price.value : 0,
    qty: qty.value,
    reorderLevel: reorder.value,
    taxRate: tax.value,
    warrantyMonths: warranty?.ok ? warranty.value : undefined,
    location: v.location?.trim() || undefined,
    decision: item.decision === 'update' ? 'update' : 'create',
    targetId: item.decision === 'update' ? item.duplicate?.partId : undefined
  };
}

const UPDATABLE: (keyof Part)[] = [
  'name', 'sku', 'barcode', 'category', 'subcategory', 'brand', 'description', 'unit',
  'costPaisa', 'pricePaisa', 'taxRate', 'reorderLevel', 'location', 'warrantyMonths',
  'compatibility'
];

async function writeChunk(rows: Prepared[], actor: Actor): Promise<RowOutcome[]> {
  return mutate(['parts', 'stockMoves', 'audit'], async (tx) => {
    const outcomes: RowOutcome[] = [];
    for (const row of rows) {
      const now = Date.now();
      const skuKey = codeKey(row.sku);
      const existingBySku = await tx.by<Part>('parts', 'sku', row.sku);
      const existingByBarcode = row.barcode ? (await tx.by<Part>('parts', 'barcode', row.barcode))[0] : undefined;

      if (row.decision === 'update' && row.targetId) {
        const target = await tx.get<Part>('parts', row.targetId);
        if (!target) {
          outcomes.push({ rowId: row.item.id, sourceRow: row.item.sourceRow, status: 'failed', message: 'The item to update no longer exists.' });
          continue;
        }
        const skuOwner = existingBySku.find((p) => p.id !== target.id);
        if (skuOwner) {
          outcomes.push({ rowId: row.item.id, sourceRow: row.item.sourceRow, status: 'failed', message: `SKU ${row.sku} belongs to another item (${skuOwner.name}).` });
          continue;
        }
        const barcodeOwner = existingByBarcode && existingByBarcode.id !== target.id ? existingByBarcode : undefined;
        if (barcodeOwner) {
          outcomes.push({ rowId: row.item.id, sourceRow: row.item.sourceRow, status: 'failed', message: `Barcode ${row.barcode} belongs to another item (${barcodeOwner.name}).` });
          continue;
        }
        const patch: Partial<Part> = {
          name: row.name, sku: row.sku, barcode: row.barcode, category: row.category,
          subcategory: row.subcategory, brand: row.brand, description: row.description, unit: row.unit,
          costPaisa: row.costPaisa, pricePaisa: row.pricePaisa, taxRate: row.taxRate,
          reorderLevel: row.reorderLevel, location: row.location, warrantyMonths: row.warrantyMonths,
          compatibility: row.compatibility, updatedAt: now
        };
        for (const key of Object.keys(patch) as (keyof Part)[]) {
          if (!UPDATABLE.includes(key)) delete patch[key];
        }
        await tx.put('parts', { ...target, ...patch, qty: target.qty });
        outcomes.push({ rowId: row.item.id, sourceRow: row.item.sourceRow, status: 'updated', partId: target.id, message: `Updated ${row.name}` });
        continue;
      }

      // Create. A row that turns out to already exist is skipped, never merged.
      const conflict = existingBySku[0] ?? (row.barcode ? existingByBarcode : undefined);
      if (conflict) {
        outcomes.push({
          rowId: row.item.id, sourceRow: row.item.sourceRow, status: 'skipped',
          partId: conflict.id, message: `Already in inventory: ${conflict.name} (${conflict.sku}).`
        });
        continue;
      }

      const part: Part = {
        id: uid('prt'), createdAt: now, updatedAt: now,
        sku: row.sku, barcode: row.barcode, name: row.name, category: row.category,
        subcategory: row.subcategory, brand: row.brand, compatibility: row.compatibility,
        description: row.description, costPaisa: row.costPaisa, pricePaisa: row.pricePaisa,
        qty: row.qty, reorderLevel: row.reorderLevel, unit: row.unit, location: row.location,
        taxRate: row.taxRate, warrantyMonths: row.warrantyMonths, archived: false
      };
      if (part.qty !== 0) {
        await tx.put('stockMoves', {
          id: uid('stm'), createdAt: now, updatedAt: now, partId: part.id, type: 'adjustment',
          qty: part.qty, unitCostPaisa: part.costPaisa, note: 'Opening stock (bulk import)',
          date: now, createdBy: actor.name
        });
      }
      await tx.put('parts', part);
      outcomes.push({ rowId: row.item.id, sourceRow: row.item.sourceRow, status: 'imported', partId: part.id });
    }
    return outcomes;
  });
}

/**
 * Write the approved rows. Throws if another import is already committing;
 * otherwise always resolves with a report, including partial failures.
 */
export async function applyImport(items: DraftItem[], actor: Actor, options: ApplyOptions): Promise<ImportReport> {
  if (running) throw new Error('An import is already running. Wait for it to finish.');
  running = true;
  const startedAt = Date.now();
  const outcomes: RowOutcome[] = [];
  let cancelled = false;

  try {
    const planned = items.filter((i) => !i.removed && i.selected && i.decision !== 'skip');
    const prepared: Prepared[] = [];
    for (const item of planned) {
      const result = prepare(item);
      if (typeof result === 'string') {
        outcomes.push({ rowId: item.id, sourceRow: item.sourceRow, status: 'failed', message: result });
      } else {
        prepared.push(result);
      }
    }

    let done = 0;
    for (let i = 0; i < prepared.length; i += CHUNK_SIZE) {
      if (options.signal?.aborted) {
        cancelled = true;
        break;
      }
      const chunk = prepared.slice(i, i + CHUNK_SIZE);
      try {
        const rows = await writeChunk(chunk, actor);
        outcomes.push(...rows);
      } catch (err) {
        // Isolate the failure: retry this chunk one row per transaction.
        for (const row of chunk) {
          if (options.signal?.aborted) {
            cancelled = true;
            break;
          }
          try {
            outcomes.push(...(await writeChunk([row], actor)));
          } catch (rowErr) {
            outcomes.push({
              rowId: row.item.id, sourceRow: row.item.sourceRow, status: 'failed',
              message: rowErr instanceof Error ? rowErr.message : 'Row could not be written.'
            });
          }
        }
      }
      done = Math.min(prepared.length, i + chunk.length);
      options.onProgress?.(done, prepared.length);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    const imported = outcomes.filter((o) => o.status === 'imported').length;
    const updated = outcomes.filter((o) => o.status === 'updated').length;
    const skipped = outcomes.filter((o) => o.status === 'skipped').length;
    const failed = outcomes.filter((o) => o.status === 'failed').length;
    const flagged = items.filter((i) => !i.removed && i.selected && i.issues.some((x) => x.level === 'error')).length;

    const report: ImportReport = {
      startedAt, finishedAt: Date.now(), fileName: options.fileName,
      imported, updated, skipped, failed, flagged, outcomes, cancelled
    };

    if (imported || updated || skipped) {
      await mutate(['audit'], async (tx) => {
        await tx.put('audit', {
          id: uid('aud'), createdAt: Date.now(), updatedAt: Date.now(), action: 'part.import',
          entity: 'inventory', entityId: options.fingerprint.slice(0, 24),
          summary: `Bulk import from ${options.fileName}: ${imported} added, ${updated} updated, ${skipped} skipped, ${failed} failed`,
          userId: actor.id, userName: actor.name,
          meta: { fileName: options.fileName, imported, updated, skipped, failed, flagged }
        });
      });
    }

    await recordImport({
      id: uid('imp'), at: Date.now(), fileName: options.fileName, kind: options.kind,
      fingerprint: options.fingerprint, total: items.length, imported, updated, skipped, failed,
      userName: actor.name
    });

    return report;
  } finally {
    running = false;
  }
}
