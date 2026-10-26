/**
 * Import history.
 *
 * Kept in the existing `meta` store rather than a new object store: it is a
 * short list of metadata records (never the source files), it travels with the
 * database, and it avoids a schema migration for a convenience feature.
 */
import { withTx } from '../db';
import type { ImportHistoryEntry } from './types';

const KEY = 'import.history';
const LIMIT = 25;

export async function listImports(): Promise<ImportHistoryEntry[]> {
  return withTx(['meta'], 'readonly', async (tx) => {
    const rec = await tx.get<{ key: string; value: ImportHistoryEntry[] }>('meta', KEY);
    return Array.isArray(rec?.value) ? rec!.value : [];
  });
}

export async function recordImport(entry: ImportHistoryEntry): Promise<void> {
  await withTx(['meta'], 'readwrite', async (tx) => {
    const rec = await tx.get<{ key: string; value: ImportHistoryEntry[] }>('meta', KEY);
    const existing = Array.isArray(rec?.value) ? rec!.value : [];
    const next = [entry, ...existing.filter((e) => e.id !== entry.id)].slice(0, LIMIT);
    await tx.put('meta', { key: KEY, value: next });
  });
}

/** Most recent import of the same bytes, if any. */
export async function findPreviousImport(fingerprint: string): Promise<ImportHistoryEntry | undefined> {
  const history = await listImports();
  return history.find((h) => h.fingerprint === fingerprint);
}

export async function clearImportHistory(): Promise<void> {
  await withTx(['meta'], 'readwrite', async (tx) => {
    await tx.put('meta', { key: KEY, value: [] });
  });
}
