import { DEFAULT_SETTINGS, ensureInitialised, resetDatabase } from '../lib/db';
import { primeSettingsSnapshot, type Actor } from '../lib/repo';

export const owner: Actor = { id: 'usr_test_owner', name: 'Test Owner', role: 'Administrator' };

/** Empty database with default settings and document sequences in place. */
export async function resetWorkspace(): Promise<void> {
  await resetDatabase();
  await ensureInitialised();
  primeSettingsSnapshot(DEFAULT_SETTINGS);
}
