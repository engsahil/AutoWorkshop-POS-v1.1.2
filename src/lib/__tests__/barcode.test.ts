import { beforeEach, describe, expect, it } from 'vitest';
import { dbAll } from '../db';
import { createPart, updatePart, ConflictError } from '../repo';
import { owner, resetWorkspace } from '../../test/workspace';
import type { Part } from '../types';

describe('barcode integrity', () => {
  beforeEach(async () => {
    await resetWorkspace();
  });

  it('refuses a second part with the same barcode', async () => {
    await createPart({ name: 'Filter A', sku: 'FA-1', barcode: '890111', pricePaisa: 1000, qty: 1 }, owner);
    await expect(
      createPart({ name: 'Filter B', sku: 'FB-1', barcode: '890111', pricePaisa: 1000 }, owner)
    ).rejects.toBeInstanceOf(ConflictError);
    expect((await dbAll<Part>('parts')).length).toBe(1);
  });

  it('allows several parts without a barcode', async () => {
    await createPart({ name: 'A', sku: 'A-1', pricePaisa: 100 }, owner);
    await createPart({ name: 'B', sku: 'B-1', pricePaisa: 100 }, owner);
    expect(await dbAll<Part>('parts')).toHaveLength(2);
  });

  it('refuses moving an existing barcode onto a part that already has one', async () => {
    const a = await createPart({ name: 'A', sku: 'A-1', barcode: '111', pricePaisa: 100 }, owner);
    await createPart({ name: 'B', sku: 'B-1', barcode: '222', pricePaisa: 100 }, owner);
    await expect(updatePart(a.id, { barcode: '222' }, owner)).rejects.toBeInstanceOf(ConflictError);
    const kept = (await dbAll<Part>('parts')).find((p) => p.id === a.id)!;
    expect(kept.barcode).toBe('111');
  });

  it('lets a part keep its own barcode on edit', async () => {
    const a = await createPart({ name: 'A', sku: 'A-1', barcode: '111', pricePaisa: 100 }, owner);
    const updated = await updatePart(a.id, { barcode: '111', name: 'A renamed', pricePaisa: 150 }, owner);
    expect(updated.barcode).toBe('111');
    expect(updated.name).toBe('A renamed');
  });

  it('finds a part by barcode through the parts list search', async () => {
    await createPart({ name: 'Filter A', sku: 'FA-1', barcode: '8901234567890', pricePaisa: 100 }, owner);
    const { listParts } = await import('../queries');
    const hits = await listParts({ search: '8901234567890' });
    expect(hits.map((p) => p.sku)).toEqual(['FA-1']);
  });
});
