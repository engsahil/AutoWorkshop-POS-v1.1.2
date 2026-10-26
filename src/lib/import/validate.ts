/**
 * Row validation and duplicate detection.
 *
 * Duplicate priority follows the strongest reliable identifier available:
 *   barcode → SKU → part number (matched against existing SKUs) → name+category+brand.
 * A name-only match is a warning the user must decide on; it never merges by
 * itself and never overwrites an existing record.
 */
import type { Part, Supplier } from '../types';
import { normalizeKey } from './text';
import { codeKey, nameKey, normalizeUnit, parseCount, parseMoney, parseQuantity, parseRate } from './values';
import type { DraftItem, FieldKey, Issue } from './types';

export interface ExistingIndex {
  byBarcode: Map<string, Part>;
  bySku: Map<string, Part>;
  byName: Map<string, Part[]>;
  categories: string[];
  units: string[];
  suppliers: { id: string; name: string; key: string }[];
}

export function buildIndex(parts: Part[], suppliers: Supplier[], extraCategories: string[] = []): ExistingIndex {
  const byBarcode = new Map<string, Part>();
  const bySku = new Map<string, Part>();
  const byName = new Map<string, Part[]>();
  const categories = new Set<string>(extraCategories);
  const units = new Set<string>();

  for (const part of parts) {
    if (part.archived) continue;
    if (part.sku) bySku.set(codeKey(part.sku), part);
    if (part.barcode) byBarcode.set(codeKey(part.barcode), part);
    const key = nameKey(part.name, part.category, part.brand ?? '');
    const list = byName.get(key) ?? [];
    list.push(part);
    byName.set(key, list);
    if (part.category) categories.add(part.category);
    if (part.unit) units.add(part.unit);
  }

  return {
    byBarcode,
    bySku,
    byName,
    categories: Array.from(categories).sort((a, b) => a.localeCompare(b)),
    units: Array.from(units),
    suppliers: suppliers.map((s) => ({ id: s.id, name: s.name, key: normalizeKey(s.name) }))
  };
}

export function matchSupplier(name: string, index: ExistingIndex): string | undefined {
  const key = normalizeKey(name);
  if (!key) return undefined;
  const exact = index.suppliers.find((s) => s.key === key);
  if (exact) return exact.id;
  const partial = index.suppliers.find((s) => s.key.includes(key) || key.includes(s.key));
  return partial?.id;
}

export interface BatchSeen {
  sku: Map<string, string>;
  barcode: Map<string, string>;
  name: Map<string, string>;
}

export function emptyBatch(): BatchSeen {
  return { sku: new Map(), barcode: new Map(), name: new Map() };
}

export interface ValidateContext {
  index: ExistingIndex;
  batch: BatchSeen;
  /** Source category → chosen existing category (set by the category review step). */
  categoryMap?: Record<string, string>;
}

function label(part: Part): string {
  return `${part.name} · ${part.sku}`;
}

/**
 * Validate one row. The returned item is a new object with `issues`,
 * `duplicate` and a default `decision` filled in. The caller decides selection.
 */
export function validateItem(item: DraftItem, ctx: ValidateContext): DraftItem {
  const issues: Issue[] = [];
  const values = { ...item.values };
  if (values.category && ctx.categoryMap?.[values.category]) values.category = ctx.categoryMap[values.category];

  const name = (values.name ?? '').trim();
  const sku = (values.sku ?? '').trim();
  const barcode = (values.barcode ?? '').trim();
  const partNumber = (values.partNumber ?? '').trim();

  if (!name) issues.push({ level: 'error', code: 'missing-name', field: 'name', message: 'No item name — this row cannot be imported.' });

  const effectiveSku = sku || partNumber;
  if (!effectiveSku) {
    issues.push({ level: 'error', code: 'missing-sku', field: 'sku', message: 'No SKU or part number. Type one, or use “Assign codes”.' });
  }

  // Money and quantity parsing. Absent cost is 0 (the catalogue default);
  // an unreadable value is an error so nothing is silently changed.
  if (values.cost && values.cost.trim()) {
    const parsed = parseMoney(values.cost);
    if (!parsed.ok) issues.push({ level: 'error', code: 'invalid-cost', field: 'cost', message: `Purchase cost: ${parsed.reason}.` });
    else if (parsed.value < 0) issues.push({ level: 'error', code: 'invalid-cost', field: 'cost', message: 'Purchase cost cannot be negative.' });
  }
  if (values.price && values.price.trim()) {
    const parsed = parseMoney(values.price);
    if (!parsed.ok) issues.push({ level: 'error', code: 'invalid-price', field: 'price', message: `Selling price: ${parsed.reason}.` });
    else if (parsed.value < 0) issues.push({ level: 'error', code: 'invalid-price', field: 'price', message: 'Selling price cannot be negative.' });
  } else {
    issues.push({ level: 'warning', code: 'invalid-price', field: 'price', message: 'No selling price — the item imports at 0 and cannot be sold until priced.' });
  }
  if (values.qty && values.qty.trim()) {
    const parsed = parseQuantity(values.qty);
    if (!parsed.ok) issues.push({ level: 'error', code: 'invalid-qty', field: 'qty', message: `Quantity: ${parsed.reason}.` });
  }
  if (values.taxRate && values.taxRate.trim()) {
    const parsed = parseRate(values.taxRate);
    if (!parsed.ok) issues.push({ level: 'error', code: 'invalid-tax', field: 'taxRate', message: `Tax rate: ${parsed.reason}.` });
  }
  if (values.reorderLevel && values.reorderLevel.trim()) {
    const parsed = parseCount(values.reorderLevel);
    if (!parsed.ok) issues.push({ level: 'error', code: 'invalid-qty', field: 'reorderLevel', message: `Reorder level: ${parsed.reason}.` });
  }
  if (values.warrantyMonths && values.warrantyMonths.trim()) {
    const parsed = parseCount(values.warrantyMonths);
    if (!parsed.ok) issues.push({ level: 'error', code: 'invalid-qty', field: 'warrantyMonths', message: `Warranty months: ${parsed.reason}.` });
  }

  const costPaisa = values.cost?.trim() ? parseMoney(values.cost) : null;
  const pricePaisa = values.price?.trim() ? parseMoney(values.price) : null;
  if (costPaisa?.ok && pricePaisa?.ok && pricePaisa.value > 0 && pricePaisa.value < costPaisa.value) {
    issues.push({ level: 'warning', code: 'price-below-cost', field: 'price', message: 'Selling price is below purchase cost.' });
  }

  if (values.category && !ctx.index.categories.some((c) => normalizeKey(c) === normalizeKey(values.category!))) {
    issues.push({ level: 'info', code: 'new-category', field: 'category', message: `New category “${values.category}”.` });
  }
  if (values.unit) values.unit = normalizeUnit(values.unit);
  if (values.supplier && !matchSupplier(values.supplier, ctx.index)) {
    issues.push({ level: 'warning', code: 'unknown-supplier', field: 'supplier', message: `Supplier “${values.supplier}” is not in the supplier list — the item imports without a supplier link.` });
  }

  let duplicate: DraftItem['duplicate'] | undefined;
  const skuKey = codeKey(effectiveSku);
  const barcodeKey = codeKey(barcode);
  const compositeKey = nameKey(name, values.category ?? '', values.brand ?? '');

  const byBarcode = barcodeKey ? ctx.index.byBarcode.get(barcodeKey) : undefined;
  const bySku = skuKey ? ctx.index.bySku.get(skuKey) : undefined;
  const byPartNumber = !sku && partNumber ? ctx.index.bySku.get(codeKey(partNumber)) : undefined;
  const byNameMatch = name ? (ctx.index.byName.get(compositeKey) ?? [])[0] : undefined;

  if (byBarcode) duplicate = { kind: 'barcode', partId: byBarcode.id, label: label(byBarcode), existingQty: byBarcode.qty };
  else if (!sku && byPartNumber) duplicate = { kind: 'partNumber', partId: byPartNumber.id, label: label(byPartNumber), existingQty: byPartNumber.qty };
  else if (bySku) duplicate = { kind: 'sku', partId: bySku.id, label: label(bySku), existingQty: bySku.qty };
  else if (byNameMatch) duplicate = { kind: 'name', partId: byNameMatch.id, label: label(byNameMatch), existingQty: byNameMatch.qty };

  // In-batch duplicates: the first occurrence wins, later rows are blocked.
  const priorSku = skuKey ? ctx.batch.sku.get(skuKey) : undefined;
  if (skuKey && priorSku) {
    issues.push({ level: 'error', code: 'duplicate-sku-in-batch', field: 'sku', message: `SKU ${effectiveSku} also appears on row ${priorSku} of this import.` });
  } else if (skuKey) {
    ctx.batch.sku.set(skuKey, String(item.sourceRow));
  }
  const priorBarcode = barcodeKey ? ctx.batch.barcode.get(barcodeKey) : undefined;
  if (barcodeKey && priorBarcode) {
    issues.push({ level: 'error', code: 'duplicate-barcode-in-batch', field: 'barcode', message: `Barcode ${barcode} also appears on row ${priorBarcode} of this import.` });
  } else if (barcodeKey) {
    ctx.batch.barcode.set(barcodeKey, String(item.sourceRow));
  }

  if (duplicate && (duplicate.kind === 'barcode' || duplicate.kind === 'sku' || duplicate.kind === 'partNumber')) {
    issues.push({
      level: 'warning', code: 'duplicate-existing', field: duplicate.kind === 'barcode' ? 'barcode' : 'sku',
      message: `Already in inventory: ${duplicate.label} (${duplicate.existingQty} on hand).`
    });
  } else if (duplicate && duplicate.kind === 'name') {
    issues.push({
      level: 'warning', code: 'possible-duplicate', field: 'name',
      message: `A part with this name, category and brand exists: ${duplicate.label}. Check before importing.`
    });
  }

  const blocked = issues.some((i) => i.level === 'error');
  const hardDuplicate = !!duplicate && duplicate.kind !== 'name';

  return {
    ...item,
    values,
    issues,
    duplicate,
    decision: blocked || hardDuplicate ? 'skip' : 'create',
    selected: item.edited ? item.selected : !blocked && !hardDuplicate
  };
}

/** Re-run validation over a whole batch, resetting the in-batch duplicate map. */
export function validateAll(items: DraftItem[], ctx: Omit<ValidateContext, 'batch'>): DraftItem[] {
  const batch = emptyBatch();
  return items.map((item) => validateItem(item, { ...ctx, batch }));
}

export function isBlocked(item: DraftItem): boolean {
  return item.issues.some((i) => i.level === 'error');
}

export function countIssues(items: DraftItem[]) {
  let errors = 0;
  let warnings = 0;
  for (const item of items) {
    if (item.removed) continue;
    if (item.issues.some((i) => i.level === 'error')) errors++;
    else if (item.issues.some((i) => i.level === 'warning')) warnings++;
  }
  return { errors, warnings };
}

/** Fields a user may edit in the review step, in display order. */
export const EDITABLE_FIELDS: FieldKey[] = [
  'name', 'sku', 'barcode', 'category', 'subcategory', 'brand', 'unit',
  'cost', 'price', 'qty', 'reorderLevel', 'taxRate', 'supplier', 'partNumber',
  'description', 'location', 'compatibility', 'warrantyMonths'
];
