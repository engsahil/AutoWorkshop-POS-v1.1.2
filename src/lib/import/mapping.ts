/**
 * Header → Part field mapping.
 *
 * Deterministic and local: a synonym table is scored against each header. No
 * AI calls, no network. Every automatic decision is shown in the mapping step
 * and can be overridden by the user before anything is imported.
 */
import { normalizeKey, similarity } from './text';
import { FIELD_KEYS, type ColumnMapping, type FieldKey, type MappingResult } from './types';

interface Alias {
  field: FieldKey;
  /** Normalised aliases, most specific first. */
  names: string[];
  /** Shown in the mapping step when the match is a guess. */
  weak?: boolean;
}

const ALIASES: Alias[] = [
  {
    field: 'name',
    names: [
      'item name', 'product name', 'part name', 'name of item', 'name of product', 'item description',
      'description of goods', 'goods description', 'particulars', 'name', 'item', 'product', 'article',
      'material', 'description'
    ]
  },
  {
    field: 'sku',
    names: [
      'sku', 'sku code', 'item code', 'product code', 'item no', 'item number', 'code', 'code no',
      'catalogue no', 'catalog no', 'cat no', 'article no', 'article code', 'stock code', 'ref', 'reference'
    ]
  },
  {
    field: 'partNumber',
    names: ['part number', 'part no', 'part no.', 'mpn', 'oem', 'oem no', 'oem number', 'manufacturer part number', 'part']
  },
  { field: 'barcode', names: ['barcode', 'bar code', 'barcode no', 'ean', 'ean13', 'upc', 'gtin', 'scan code'] },
  { field: 'category', names: ['category', 'item category', 'product category', 'group', 'item group', 'department', 'dept', 'class', 'type'] },
  { field: 'subcategory', names: ['sub category', 'subcategory', 'sub group', 'subgroup', 'sub type', 'subtype'] },
  { field: 'brand', names: ['brand', 'make', 'manufacturer', 'mfg', 'manufacturer name', 'company'] },
  { field: 'unit', names: ['unit', 'uom', 'unit of measure', 'unit of measurement', 'units', 'measure', 'pack', 'packing', 'u o m'] },
  {
    field: 'cost',
    names: [
      'purchase cost', 'purchase price', 'cost price', 'buy price', 'buying price', 'purchase rate',
      'landed cost', 'net cost', 'supplier price', 'dealer price', 'wholesale price', 'cost', 'cp'
    ]
  },
  {
    field: 'price',
    names: [
      'selling price', 'sale price', 'sale rate', 'retail price', 'retail', 'mrp', 'list price',
      'unit price', 'price', 'sp', 'sell price'
    ]
  },
  { field: 'cost', names: ['rate', 'amount'], weak: true },
  {
    field: 'qty',
    names: [
      'quantity', 'opening stock', 'opening qty', 'opening balance', 'stock qty', 'stock on hand',
      'on hand', 'onhand', 'available qty', 'qty available', 'balance qty', 'in stock', 'instock',
      'stock', 'qty', 'qnty', 'units in stock', 'available'
    ]
  },
  { field: 'description', names: ['long description', 'item details', 'details', 'remarks', 'remark', 'notes', 'note', 'specification', 'specifications'] },
  { field: 'supplier', names: ['supplier', 'supplier name', 'vendor', 'vendor name', 'party', 'distributor', 'source'] },
  { field: 'reorderLevel', names: ['reorder level', 'reorder point', 'reorder qty', 'reorder', 'min stock', 'minimum stock', 'min qty', 'minimum qty', 'rop', 'low stock level'] },
  { field: 'taxRate', names: ['tax rate', 'tax %', 'gst rate', 'gst %', 'vat rate', 'vat %', 'sales tax', 'gst', 'vat', 'tax'] },
  { field: 'location', names: ['location', 'shelf', 'rack', 'bin', 'aisle', 'store location', 'godown', 'warehouse'] },
  { field: 'compatibility', names: ['compatibility', 'fits', 'suitable for', 'application', 'vehicle model', 'vehicle compatibility'] },
  { field: 'warrantyMonths', names: ['warranty months', 'warranty period', 'warranty', 'guarantee'] }
];

interface Candidate {
  field: FieldKey;
  score: number;
  weak: boolean;
}

function words(value: string): string[] {
  return normalizeKey(value).split(' ').filter(Boolean);
}

/**
 * Score how well a header cell matches an alias.
 *   exact phrase                      → 1.0
 *   alias words all present, few extra → 0.85 – 0.65 depending on the ratio
 *   strong character similarity        → ≤ 0.62
 * A long unrelated header that merely contains a keyword ("Warehouse bay
 * temperature") therefore does not become a "location" column.
 */
function phraseScore(headerKey: string, headerWords: string[], alias: string): number {
  if (headerKey === alias) return 1;
  const aliasWords = alias.split(' ').filter(Boolean);
  const allPresent = aliasWords.every((w) => headerWords.includes(w));
  if (allPresent && headerWords.length > 0) {
    const extra = headerWords.length - aliasWords.length;
    const maxExtra = aliasWords.length >= 2 ? 2 : 1;
    if (extra === 0) return 0.95;
    if (extra <= maxExtra) return 0.85 - extra * 0.08;
  }
  if (alias.length >= 6 && headerKey.includes(alias) && headerWords.length <= aliasWords.length + 1) return 0.7;
  const sim = similarity(headerKey, alias);
  return sim >= 0.86 ? sim * 0.7 : 0;
}

function scoreHeader(header: string): Candidate | null {
  const key = normalizeKey(header);
  if (!key) return null;
  const headerWords = words(header);
  let best: Candidate | null = null;
  for (const alias of ALIASES) {
    for (let i = 0; i < alias.names.length; i++) {
      const name = alias.names[i];
      let score = phraseScore(key, headerWords, name);
      // Later aliases in the list are less canonical than earlier ones.
      score -= i * 0.01;
      if (score > 0 && (!best || score > best.score)) best = { field: alias.field, score, weak: !!alias.weak };
    }
  }
  return best;
}

/** True when a line looks like a table header (≥2 recognised columns). */
export function headerScore(cells: string[]): { score: number; fields: FieldKey[] } {
  const fields: FieldKey[] = [];
  let score = 0;
  for (const cell of cells) {
    const hit = scoreHeader(cell);
    if (hit && hit.score >= 0.6) {
      score += hit.score;
      if (!fields.includes(hit.field)) fields.push(hit.field);
    }
  }
  return { score, fields };
}

export function mapHeaders(headers: string[]): MappingResult {
  const mapping: ColumnMapping = {};
  const used = new Set<FieldKey>();
  const unmatched: number[] = [];

  // First pass: strongest match per column, strongest columns first.
  const scored = headers.map((header, index) => ({ index, header, hit: scoreHeader(header) }));
  scored.sort((a, b) => (b.hit?.score ?? 0) - (a.hit?.score ?? 0));

  for (const { index, hit } of scored) {
    if (!hit || hit.score < 0.55) {
      mapping[index] = null;
      unmatched.push(index);
      continue;
    }
    if (used.has(hit.field)) {
      mapping[index] = null;
      unmatched.push(index);
      continue;
    }
    used.add(hit.field);
    mapping[index] = hit.field;
  }

  const matched = Object.values(mapping).filter((v): v is FieldKey => !!v);
  const confidence = matched.length ? Math.min(1, matched.reduce((sum, f) => {
    const hit = scored.find((s) => s.header && scoreHeader(s.header)?.field === f && mapping[s.index] === f);
    return sum + (hit?.hit?.score ?? 0.6);
  }, 0) / matched.length) : 0;

  const duplicateFields = FIELD_KEYS.filter((field) => {
    const hits = headers.filter((h) => scoreHeader(h)?.field === field && (scoreHeader(h)?.score ?? 0) >= 0.55);
    return hits.length > 1;
  });

  return {
    mapping,
    confidence,
    unmapped: unmatched.map((i) => headers[i]).filter(Boolean),
    duplicateFields
  };
}

export function fieldsInMapping(mapping: ColumnMapping): FieldKey[] {
  return Object.values(mapping).filter((v): v is FieldKey => !!v);
}

/** Human-friendly label for a mapping select. */
export function mappingLabel(field: FieldKey, headers: string[], mapping: ColumnMapping): string {
  const index = Object.keys(mapping).find((k) => mapping[Number(k)] === field);
  if (index == null) return '';
  return headers[Number(index)] ?? '';
}

/**
 * Suggest an existing category for an incoming name.
 * Exact normalised equality wins; then a containment match; then high similarity.
 * Never merges automatically — the UI asks, and the default keeps the source value.
 */
export function suggestCategory(incoming: string, existing: string[]): { match: string | null; score: number } {
  const key = normalizeKey(incoming);
  if (!key) return { match: null, score: 0 };
  for (const candidate of existing) {
    if (normalizeKey(candidate) === key) return { match: candidate, score: 1 };
  }
  const incomingWords = key.split(' ').filter(Boolean);
  let best: { match: string | null; score: number } = { match: null, score: 0 };
  for (const candidate of existing) {
    const other = normalizeKey(candidate);
    let score = similarity(incoming, candidate);
    if (other && key.includes(other) && other.length >= 4) score = Math.max(score, 0.9);
    // "Brake Pads" → "Brakes": a shared word stem on a short category name.
    const otherWords = other.split(' ').filter(Boolean);
    const stem = incomingWords.length <= 2 && otherWords.length <= 2 &&
      incomingWords.some((w) => w.length >= 4 && otherWords.some((o) => o.length >= 4 && (o.startsWith(w) || w.startsWith(o))));
    if (stem) score = Math.max(score, 0.86);
    if (score > best.score) best = { match: candidate, score };
  }
  return best.score >= 0.84 ? best : { match: null, score: best.score };
}
