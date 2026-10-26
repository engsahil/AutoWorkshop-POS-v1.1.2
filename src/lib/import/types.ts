/**
 * Types for the bulk inventory import pipeline.
 *
 * The pipeline is deliberately split into pure stages:
 *   file bytes → SourceTable[] (csv.ts / xlsx.ts / pdf.ts + layout.ts)
 *              → DraftItem[]  (pipeline.ts, mapping.ts, validate.ts)
 *              → Part[]       (apply.ts, through the same repo layer as the UI)
 *
 * Nothing in the parsing stages touches IndexedDB, so every stage is unit
 * testable in Node and nothing is written before the user confirms.
 */

/** Fields the importer can fill on a Part. */
export type FieldKey =
  | 'name'
  | 'sku'
  | 'barcode'
  | 'category'
  | 'subcategory'
  | 'brand'
  | 'partNumber'
  | 'unit'
  | 'cost'
  | 'price'
  | 'qty'
  | 'description'
  | 'supplier'
  | 'reorderLevel'
  | 'taxRate'
  | 'location'
  | 'compatibility'
  | 'warrantyMonths';

export const FIELD_KEYS: FieldKey[] = [
  'name', 'sku', 'barcode', 'category', 'subcategory', 'brand', 'partNumber', 'unit',
  'cost', 'price', 'qty', 'reorderLevel', 'taxRate', 'description', 'supplier',
  'location', 'compatibility', 'warrantyMonths'
];

/** Human labels used by the mapping step and the review table. */
export const FIELD_LABELS: Record<FieldKey, string> = {
  name: 'Item name',
  sku: 'SKU / item code',
  barcode: 'Barcode',
  category: 'Category',
  subcategory: 'Subcategory',
  brand: 'Brand',
  partNumber: 'Part number',
  unit: 'Unit',
  cost: 'Purchase cost',
  price: 'Selling price',
  qty: 'Quantity / opening stock',
  description: 'Description',
  supplier: 'Supplier',
  reorderLevel: 'Reorder level',
  taxRate: 'Tax rate %',
  location: 'Location',
  compatibility: 'Compatibility',
  warrantyMonths: 'Warranty (months)'
};

/** Fields that must be present before an item can be written. */
export const REQUIRED_FIELDS: FieldKey[] = ['name', 'sku'];

export type SourceKind = 'pdf' | 'csv' | 'tsv' | 'txt' | 'xlsx';

export interface SourceTable {
  /** Stable id for React keys. */
  id: string;
  fileName: string;
  kind: SourceKind;
  /** Excel sheet name or PDF page range, when known. */
  sheet?: string;
  headers: string[];
  rows: string[][];
  /** False when no header row could be recognised (columns are synthesised). */
  headerFound: boolean;
  notes: string[];
  /** Non-fatal extraction statistics worth showing in the review header. */
  stats?: { pages?: number; repeatedHeaders?: number; skippedLines?: number };
}

/** columnIndex → field (or null when the column is ignored). */
export type ColumnMapping = Record<number, FieldKey | null>;

export interface MappingResult {
  mapping: ColumnMapping;
  /** 0–1 heuristic; low scores surface a warning in the mapping step. */
  confidence: number;
  unmapped: string[];
  duplicateFields: FieldKey[];
}

export type IssueCode =
  | 'missing-name'
  | 'missing-sku'
  | 'duplicate-sku-in-batch'
  | 'duplicate-barcode-in-batch'
  | 'duplicate-existing'
  | 'possible-duplicate'
  | 'invalid-cost'
  | 'invalid-price'
  | 'invalid-qty'
  | 'invalid-tax'
  | 'price-below-cost'
  | 'new-category'
  | 'unknown-supplier'
  | 'removed';

export interface Issue {
  level: 'error' | 'warning' | 'info';
  code: IssueCode;
  field?: FieldKey;
  message: string;
}

/** One row as the user reviews it. All values stay raw strings. */
export interface DraftItem {
  id: string;
  /** 1-based row number in the source table, for reporting. */
  sourceRow: number;
  source: string;
  values: Partial<Record<FieldKey, string>>;
  selected: boolean;
  removed: boolean;
  /** What happens on import for this row. */
  decision: 'create' | 'skip' | 'update';
  duplicate?: {
    kind: 'barcode' | 'sku' | 'partNumber' | 'name';
    partId: string;
    label: string;
    existingQty: number;
  };
  issues: Issue[];
  /** True once the user has edited the row (keeps edits across re-validation). */
  edited?: boolean;
}

export interface ImportSummary {
  total: number;
  selected: number;
  blocked: number;
  duplicates: number;
  removable: number;
  newCategories: string[];
  categoriesInUse: number;
}

export interface RowOutcome {
  rowId: string;
  sourceRow: number;
  status: 'imported' | 'updated' | 'skipped' | 'failed';
  message?: string;
  partId?: string;
}

export interface ImportReport {
  startedAt: number;
  finishedAt: number;
  fileName: string;
  imported: number;
  updated: number;
  skipped: number;
  failed: number;
  flagged: number;
  outcomes: RowOutcome[];
  cancelled: boolean;
}

export interface ImportHistoryEntry {
  id: string;
  at: number;
  fileName: string;
  kind: SourceKind;
  fingerprint: string;
  total: number;
  imported: number;
  updated: number;
  skipped: number;
  failed: number;
  userName: string;
}

export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_ROWS = 10000;
export const MAX_PDF_PAGES = 250;
export const REVIEW_PAGE_SIZE = 50;
export const CHUNK_SIZE = 200;

export class ImportError extends Error {}
