import { beforeEach, describe, expect, it } from 'vitest';
import { dbAll, dbBy } from '../db';
import { createPart } from '../repo';
import { applyImport, isImportRunning } from '../import/apply';
import { listImports } from '../import/history';
import { owner, resetWorkspace } from '../../test/workspace';
import type { AuditEvent, Part, StockMove } from '../types';
import type { DraftItem } from '../import/types';

const draft = (over: Partial<DraftItem> & { values: DraftItem['values'] }, i = 1): DraftItem => ({
  id: `row-${i}`, sourceRow: i, source: 'test.csv', selected: true,
  removed: false, decision: 'create', issues: [], ...over, values: over.values
});

const opts = (name = 'test.csv') => ({ fileName: name, kind: 'csv' as const, fingerprint: 'fp-1' });

describe('applying an import', () => {
  beforeEach(async () => {
    await resetWorkspace();
  });

  it('writes approved rows with opening stock movements, one audit entry and a history record', async () => {
    const existing = await createPart({ name: 'Existing Part', sku: 'EX-1', pricePaisa: 5000, costPaisa: 3000, qty: 4 }, owner);

    const items = [
      draft({ values: { name: 'Brake Pad', sku: 'BP-1', category: 'Brakes', cost: '1250.50', price: '1890', qty: '24', unit: 'pcs' } }, 1),
      draft({ values: { name: 'Oil Filter', sku: 'OF-1', cost: '320', price: '480', qty: '0' } }, 2),
      draft({ values: { name: 'Wiper', sku: 'WB-1', price: '650' } }, 3)
    ];
    const report = await applyImport(items, owner, opts());

    expect(report.imported).toBe(3);
    expect(report.failed).toBe(0);

    const parts = await dbAll<Part>('parts');
    expect(parts).toHaveLength(4);
    const brake = parts.find((p) => p.sku === 'BP-1')!;
    expect(brake.costPaisa).toBe(125050);
    expect(brake.pricePaisa).toBe(189000);
    expect(brake.qty).toBe(24);
    expect(brake.category).toBe('Brakes');

    const moves = await dbAll<StockMove>('stockMoves');
    // Two opening-stock movements (the zero-quantity part has none) plus the
    // one created by createPart for the pre-existing part.
    expect(moves.filter((m) => m.partId === brake.id)).toHaveLength(1);
    expect(moves.find((m) => m.partId === brake.id)!.note).toContain('Opening stock');
    expect(moves.some((m) => m.partId === existing.id)).toBe(true);

    const audit = await dbAll<AuditEvent>('audit');
    const importAudits = audit.filter((a) => a.action === 'part.import');
    expect(importAudits).toHaveLength(1);
    expect(importAudits[0].summary).toContain('3 added');

    const history = await listImports();
    expect(history[0].imported).toBe(3);
    expect(history[0].fingerprint).toBe('fp-1');
  });

  it('leaves the preview alone until it is applied, and leaves existing items untouched', async () => {
    const existing = await createPart({ name: 'Keep Me', sku: 'KEEP-1', pricePaisa: 1000, costPaisa: 700, qty: 9 }, owner);
    const before = await dbAll<Part>('parts');
    expect(before).toHaveLength(1);

    const items = [draft({ values: { name: 'New One', sku: 'NEW-1', price: '100', qty: '3' } })];
    // Nothing is written by validation or by building the draft list.
    expect((await dbAll<Part>('parts')).length).toBe(1);

    await applyImport(items, owner, opts());
    const after = await dbAll<Part>('parts');
    expect(after).toHaveLength(2);
    const kept = after.find((p) => p.id === existing.id)!;
    expect(kept.qty).toBe(9);
    expect(kept.pricePaisa).toBe(1000);
  });

  it('skips a row that became a duplicate after review instead of overwriting it', async () => {
    await createPart({ name: 'Brake Pad', sku: 'BP-1', pricePaisa: 1000, costPaisa: 500, qty: 7 }, owner);
    const report = await applyImport(
      [draft({ values: { name: 'Brake Pad', sku: 'bp-1', price: '9999', qty: '50' } })],
      owner, opts()
    );
    expect(report.skipped).toBe(1);
    expect(report.imported).toBe(0);
    const part = (await dbBy<Part>('parts', 'sku', 'BP-1'))[0];
    expect(part.pricePaisa).toBe(1000);
    expect(part.qty).toBe(7);
  });

  it('updates descriptive fields only when the user explicitly chose update', async () => {
    const existing = await createPart({ name: 'Old Name', sku: 'UPD-1', pricePaisa: 1000, costPaisa: 500, qty: 12 }, owner);
    const report = await applyImport(
      [draft({
        values: { name: 'New Name', sku: 'UPD-1', barcode: '12345', price: '1500', cost: '800', qty: '999' },
        decision: 'update',
        duplicate: { kind: 'sku', partId: existing.id, label: 'Old Name · UPD-1', existingQty: 12 }
      })],
      owner, opts()
    );
    expect(report.updated).toBe(1);
    const part = (await dbAll<Part>('parts'))[0];
    expect(part.name).toBe('New Name');
    expect(part.pricePaisa).toBe(150000);
    expect(part.barcode).toBe('12345');
    // Stock is never written by an update.
    expect(part.qty).toBe(12);
    expect(await dbAll<StockMove>('stockMoves')).toHaveLength(1);
  });

  it('reports a bad row as failed and still writes the good ones', async () => {
    const report = await applyImport(
      [
        draft({ values: { name: 'Good', sku: 'G-1', price: '100', qty: '1' } }, 1),
        draft({ values: { name: 'Bad cost', sku: 'B-1', cost: 'not a number', price: '100' } }, 2),
        draft({ values: { name: 'Good two', sku: 'G-2', price: '200', qty: '2' } }, 3)
      ],
      owner, opts()
    );
    expect(report.imported).toBe(2);
    expect(report.failed).toBe(1);
    expect(report.outcomes.find((o) => o.sourceRow === 2)?.status).toBe('failed');
    expect((await dbAll<Part>('parts')).map((p) => p.sku).sort()).toEqual(['G-1', 'G-2']);
  });

  it('works at 2,000 items through chunked transactions', async () => {
    const items: DraftItem[] = [];
    for (let i = 0; i < 2000; i++) {
      items.push(draft({
        values: {
          name: `Bulk Part ${i + 1}`, sku: `BLK-${String(i + 1).padStart(5, '0')}`,
          category: i % 2 ? 'Brakes' : 'Filters', cost: `${100 + i}`, price: `${150 + i}`,
          qty: `${i % 9}`, barcode: `8900000${String(i).padStart(6, '0')}`
        }
      }, i + 1));
    }
    const started = Date.now();
    const progress: number[] = [];
    const report = await applyImport(items, owner, { ...opts('big.csv'), onProgress: (done) => progress.push(done) });
    const elapsed = Date.now() - started;

    expect(report.imported).toBe(2000);
    expect(report.failed).toBe(0);
    expect((await dbAll<Part>('parts')).length).toBe(2000);
    expect(progress.length).toBeGreaterThanOrEqual(10); // 2,000 / 200 per chunk
    expect(progress[progress.length - 1]).toBe(2000);
    expect(elapsed).toBeLessThan(60000);
    // A single audit row, not 2,000 of them.
    const audit = (await dbAll<AuditEvent>('audit')).filter((a) => a.action === 'part.import');
    expect(audit).toHaveLength(1);
  }, 120000);

  it('can be cancelled before the commit starts, leaving inventory unchanged', async () => {
    const signal = { aborted: true };
    const report = await applyImport(
      [draft({ values: { name: 'Nope', sku: 'N-1', price: '10', qty: '1' } })],
      owner, { ...opts(), signal }
    );
    expect(report.cancelled).toBe(true);
    expect(report.imported).toBe(0);
    expect(await dbAll<Part>('parts')).toHaveLength(0);
  });

  it('refuses a second concurrent commit', async () => {
    const items = [draft({ values: { name: 'A', sku: 'A-1', price: '10', qty: '1' } })];
    const first = applyImport(items, owner, opts('a.csv'));
    expect(isImportRunning()).toBe(true);
    await expect(applyImport(items, owner, opts('b.csv'))).rejects.toThrow(/already running/i);
    await first;
    expect(isImportRunning()).toBe(false);
  });

  it('does nothing when every row is unselected', async () => {
    const report = await applyImport(
      [draft({ values: { name: 'A', sku: 'A-1', price: '10' }, selected: false }, 1),
       draft({ values: { name: 'B', sku: 'B-1', price: '10' }, decision: 'skip' }, 2)],
      owner, opts()
    );
    expect(report.imported).toBe(0);
    expect(await dbAll<Part>('parts')).toHaveLength(0);
  });
});
