import { describe, expect, it } from 'vitest';
import type { Part, Supplier } from '../types';
import { buildIndex, emptyBatch, validateAll, validateItem } from '../import/validate';
import { parseMoney, parseQuantity, parseRate, normalizeUnit, codeKey } from '../import/values';
import { suggestCategory } from '../import/mapping';
import { assignMissingSkus, draftsFromSources, reviewCategories, summarise } from '../import/pipeline';
import type { DraftItem, SourceTable } from '../import/types';

const now = Date.now();
const part = (over: Partial<Part>): Part => ({
  id: over.id ?? 'prt_1', createdAt: now, updatedAt: now, sku: 'SKU-1', name: 'Part',
  category: 'General', costPaisa: 1000, pricePaisa: 2000, qty: 5, reorderLevel: 2, unit: 'pcs',
  taxRate: 0, archived: false, ...over
});

const supplier = (id: string, name: string): Supplier => ({
  id, createdAt: now, updatedAt: now, name, phone: '', address: '', balancePaisa: 0, archived: false
});

const index = buildIndex(
  [
    part({ id: 'p1', sku: 'BP-1001', barcode: '8901111111111', name: 'Brake Pad Set', category: 'Brakes', brand: 'Bosch' }),
    part({ id: 'p2', sku: 'OF-2201', name: 'Oil Filter', category: 'Filters' })
  ],
  [supplier('sup1', 'Metro Auto Parts')],
  ['Brakes', 'Filters']
);

const draft = (values: DraftItem['values']): DraftItem => ({
  id: 'row-1', sourceRow: 2, source: 'x.csv', values, selected: true, removed: false,
  decision: 'create', issues: []
});

describe('value parsing', () => {
  it('reads the money formats suppliers actually send', () => {
    expect(parseMoney('Rs. 1,234.50')).toEqual({ ok: true, value: 123450 });
    expect(parseMoney('PKR 987')).toEqual({ ok: true, value: 98700 });
    expect(parseMoney('1.234,50')).toEqual({ ok: true, value: 123450 });
    expect(parseMoney('1200/-')).toEqual({ ok: true, value: 120000 });
    expect(parseMoney('(500)')).toEqual({ ok: true, value: -50000 });
    expect(parseMoney('')).toEqual({ ok: false, reason: 'empty' });
    expect(parseMoney('call us').ok).toBe(false);
  });

  it('accepts unit suffixes on quantities and rejects negatives', () => {
    expect(parseQuantity('12 pcs')).toEqual({ ok: true, value: 12 });
    expect(parseQuantity('3.5')).toEqual({ ok: true, value: 3.5 });
    expect(parseQuantity('-2').ok).toBe(false);
  });

  it('bounds tax rates and normalises units', () => {
    expect(parseRate('17%')).toEqual({ ok: true, value: 17 });
    expect(parseRate('120').ok).toBe(false);
    expect(normalizeUnit('Nos')).toBe('pcs');
    expect(normalizeUnit('litres')).toBe('litre');
    expect(normalizeUnit('bundle')).toBe('bundle');
    expect(codeKey(' bp-1001 ')).toBe('BP-1001');
  });
});

describe('row validation', () => {
  it('blocks rows without a name or SKU and explains why', () => {
    const item = validateItem(draft({ sku: '', name: '' }), { index, batch: emptyBatch() });
    const codes = item.issues.map((i) => i.code);
    expect(codes).toContain('missing-name');
    expect(codes).toContain('missing-sku');
    expect(item.selected).toBe(false);
    expect(item.decision).toBe('skip');
  });

  it('accepts a part number as the SKU and never invents a price', () => {
    const item = validateItem(draft({ name: 'Wiper Blade', partNumber: 'WB-1' }), { index, batch: emptyBatch() });
    expect(item.issues.some((i) => i.level === 'error')).toBe(false);
    expect(item.issues.find((i) => i.code === 'invalid-price')?.level).toBe('warning');
    expect(item.values.price).toBeUndefined();
  });

  it('flags unreadable numbers as errors rather than importing zero', () => {
    const item = validateItem(draft({ name: 'X', sku: 'X-1', cost: 'ask Ahmed', qty: 'lots' }), { index, batch: emptyBatch() });
    expect(item.issues.filter((i) => i.level === 'error').map((i) => i.code)).toEqual(
      expect.arrayContaining(['invalid-cost', 'invalid-qty'])
    );
  });

  it('warns when the selling price is below cost', () => {
    const item = validateItem(draft({ name: 'X', sku: 'X-2', cost: '500', price: '400' }), { index, batch: emptyBatch() });
    expect(item.issues.some((i) => i.code === 'price-below-cost')).toBe(true);
  });

  it('matches suppliers by name and warns about unknown ones', () => {
    const known = validateItem(draft({ name: 'X', sku: 'X-3', supplier: 'metro auto parts' }), { index, batch: emptyBatch() });
    expect(known.issues.some((i) => i.code === 'unknown-supplier')).toBe(false);
    const unknown = validateItem(draft({ name: 'X', sku: 'X-4', supplier: 'Nobody Ltd' }), { index, batch: emptyBatch() });
    expect(unknown.issues.some((i) => i.code === 'unknown-supplier')).toBe(true);
  });

  it('marks a new category as information, not an error', () => {
    const item = validateItem(draft({ name: 'X', sku: 'X-5', category: 'Suspension' }), { index, batch: emptyBatch() });
    const issue = item.issues.find((i) => i.code === 'new-category');
    expect(issue?.level).toBe('info');
    expect(item.selected).toBe(true);
  });
});

describe('duplicate detection', () => {
  it('prefers barcode, then SKU, then part number, then a name warning', () => {
    const byBarcode = validateItem(draft({ name: 'Different name', sku: 'NEW-1', barcode: '8901111111111' }), { index, batch: emptyBatch() });
    expect(byBarcode.duplicate?.kind).toBe('barcode');
    expect(byBarcode.decision).toBe('skip');
    expect(byBarcode.selected).toBe(false);

    const bySku = validateItem(draft({ name: 'Different', sku: 'bp-1001' }), { index, batch: emptyBatch() });
    expect(bySku.duplicate?.kind).toBe('sku');

    const byPartNo = validateItem(draft({ name: 'Filter thing', partNumber: 'OF-2201' }), { index, batch: emptyBatch() });
    expect(byPartNo.duplicate?.kind).toBe('partNumber');

    const byName = validateItem(draft({ name: 'Brake Pad Set', sku: 'NEW-2', category: 'Brakes', brand: 'Bosch' }), { index, batch: emptyBatch() });
    expect(byName.duplicate?.kind).toBe('name');
    // A name alone never blocks or merges: it stays selectable with a warning.
    expect(byName.decision).toBe('create');
    expect(byName.selected).toBe(true);
    expect(byName.issues.some((i) => i.code === 'possible-duplicate')).toBe(true);
  });

  it('treats the same SKU twice in one file as an error on the later row', () => {
    const items = validateAll(
      [draft({ name: 'A', sku: 'DUP-1' }), { ...draft({ name: 'B', sku: 'dup-1' }), id: 'row-2', sourceRow: 3 }],
      { index }
    );
    expect(items[0].issues.some((i) => i.code === 'duplicate-sku-in-batch')).toBe(false);
    expect(items[1].issues.some((i) => i.code === 'duplicate-sku-in-batch')).toBe(true);
    expect(items[1].selected).toBe(false);
  });

  it('re-runs cleanly: validation does not accumulate in-batch state', () => {
    const rows = [draft({ name: 'A', sku: 'SAME-1' })];
    expect(validateAll(rows, { index })[0].issues).toHaveLength(1); // the "no price" warning only
    expect(validateAll(rows, { index })[0].issues).toHaveLength(1);
  });
});

describe('categories', () => {
  it('suggests an existing category for close names and ignores unrelated ones', () => {
    expect(suggestCategory('filters', ['Brakes', 'Filters']).match).toBe('Filters');
    expect(suggestCategory('Brake Pads', ['Brakes', 'Filters']).match).toBe('Brakes');
    expect(suggestCategory('Hydraulic Hoses', ['Brakes', 'Filters']).match).toBeNull();
  });

  it('lists incoming categories with counts and suggestions', () => {
    const items = [
      draft({ name: 'A', sku: 'A-1', category: 'filters' }),
      draft({ name: 'B', sku: 'B-1', category: 'Filters' }),
      draft({ name: 'C', sku: 'C-1', category: 'Body Work' })
    ];
    const review = reviewCategories(items, ['Brakes', 'Filters']);
    const filters = review.find((r) => r.name.toLowerCase() === 'filters');
    expect(filters?.count).toBe(2);
    expect(filters?.suggestion).toBe('Filters');
    expect(review.find((r) => r.name === 'Body Work')?.suggestion).toBeNull();
  });

  it('applies a category decision to every row it covers', () => {
    const items = validateAll([draft({ name: 'A', sku: 'A-1', category: 'filters' })], {
      index, categoryMap: { filters: 'Filters' }
    });
    expect(items[0].values.category).toBe('Filters');
  });
});

describe('drafts and codes', () => {
  const table: SourceTable = {
    id: 't1', fileName: 'list.csv', kind: 'csv', headerFound: true, notes: [],
    headers: ['Code', 'Name', 'Qty'],
    rows: [['A-1', 'Filter', '4'], ['', '', ''], ['A-2', 'Belt', '2']]
  };

  it('maps cells to fields and skips blank rows', () => {
    const { items, blankRows } = draftsFromSources([{ table, mapping: { 0: 'sku', 1: 'name', 2: 'qty' } }]);
    expect(items).toHaveLength(2);
    expect(blankRows).toBe(1);
    expect(items[1].values).toEqual({ sku: 'A-2', name: 'Belt', qty: '2' });
    expect(items[0].sourceRow).toBe(1);
  });

  it('assigns codes only when asked, without reusing an existing one', () => {
    const items = draftsFromSources([{ table, mapping: { 1: 'name' } }]).items;
    const { items: withCodes, assigned } = assignMissingSkus(items, ['IMP-00007']);
    expect(assigned).toBe(2);
    expect(withCodes.map((i) => i.values.sku)).toEqual(['IMP-00008', 'IMP-00009']);
  });

  it('summarises what will happen before anything is written', () => {
    const items: DraftItem[] = [
      { ...draft({ name: 'A', sku: 'A-1' }), selected: true },
      { ...draft({ name: 'B', sku: 'B-1' }), id: 'r2', selected: false },
      { ...draft({ name: '', sku: '' }), id: 'r3', selected: false, issues: [{ level: 'error', code: 'missing-name', message: 'x' }] },
      { ...draft({ name: 'D', sku: 'D-1' }), id: 'r4', removed: true }
    ];
    const summary = summarise(items);
    expect(summary.total).toBe(3);
    expect(summary.removed).toBe(1);
    expect(summary.selected).toBe(1);
    expect(summary.blocked).toBe(1);
  });
});
