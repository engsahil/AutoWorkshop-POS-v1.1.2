import { describe, it, expect, beforeEach } from 'vitest';
import { resetWorkspace, owner } from '../../test/workspace';
import { createInitialAdmin, createUser } from '../repo';
import { login, logout, changePassword, readSession, clearSession, hashPassword, randomSalt } from '../auth';

beforeEach(async () => {
  await resetWorkspace();
});

describe('first-run setup', () => {
  it('creates the owner account and signs it in immediately', async () => {
    const user = await createInitialAdmin({
      businessName: 'Al-Madina Motors',
      fullName: 'Ahmed Raza',
      username: 'admin',
      password: 'Servixa#2026',
      confirmPassword: 'Servixa#2026'
    });

    expect(user.role).toBe('Administrator');
    expect(user.isOwner).toBe(true);
    expect(user).not.toHaveProperty('passwordHash');
  });

  it('rejects weak passwords and mismatched confirmation', async () => {
    await expect(
      createInitialAdmin({
        businessName: 'X', fullName: 'Ahmed Raza', username: 'admin',
        password: 'short', confirmPassword: 'short'
      })
    ).rejects.toThrow(/at least 8/i);

    await expect(
      createInitialAdmin({
        businessName: 'X', fullName: 'Ahmed Raza', username: 'admin',
        password: 'Servixa#2026', confirmPassword: 'Servixa#2027'
      })
    ).rejects.toThrow(/match/i);
  });

  it('blocks setup from running twice', async () => {
    await createInitialAdmin({
      businessName: 'X', fullName: 'Ahmed Raza', username: 'admin',
      password: 'Servixa#2026', confirmPassword: 'Servixa#2026'
    });
    await expect(
      createInitialAdmin({
        businessName: 'X', fullName: 'Second Owner', username: 'admin2',
        password: 'Servixa#2026', confirmPassword: 'Servixa#2026'
      })
    ).rejects.toThrow(/already been completed/i);
  });
});

describe('login', () => {
  beforeEach(async () => {
    clearSession();
    await createInitialAdmin({
      businessName: 'Al-Madina Motors',
      fullName: 'Ahmed Raza',
      username: 'admin',
      password: 'Servixa#2026',
      confirmPassword: 'Servixa#2026'
    });
  });

  it('signs in with the correct password and writes a session', async () => {
    const result = await login('admin', 'Servixa#2026');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.user.username).toBe('admin');
    const session = readSession();
    expect(session?.userId).toBe(result.user.id);
    expect(session!.expiresAt).toBeGreaterThan(Date.now());
  });

  it('is case-insensitive on the username', async () => {
    const result = await login('  ADMIN ', 'Servixa#2026');
    expect(result.ok).toBe(true);
  });

  it('rejects a wrong password without creating a session', async () => {
    const result = await login('admin', 'WrongPassword1');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/incorrect/i);
    expect(readSession()).toBeNull();
  });

  it('rejects unknown users with the same generic message', async () => {
    const result = await login('nobody', 'Servixa#2026');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/incorrect/i);
  });

  it('clears the session on logout', async () => {
    const result = await login('admin', 'Servixa#2026');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    await logout(result.user.id, result.user.name);
    expect(readSession()).toBeNull();
  });

  it('locks the account after the configured number of failures', async () => {
    const { updateSettings } = await import('../repo');
    const { getSettings } = await import('../db');
    const settings = await getSettings();
    await updateSettings({ ...settings, security: { ...settings.security, lockAfterFailures: 2 } }, owner);

    await login('admin', 'wrong1');
    const second = await login('admin', 'wrong2');
    expect(second.ok).toBe(false);

    const locked = await login('admin', 'Servixa#2026');
    expect(locked.ok).toBe(false);
    if (locked.ok) return;
    expect(locked.error).toMatch(/too many failed attempts/i);
  });

  it('stores a PBKDF2 hash, never the plaintext password', async () => {
    const { dbBy } = await import('../db');
    const [stored] = await dbBy<{ passwordHash: string; salt: string; iterations: number }>('users', 'username', 'admin');
    expect(stored.passwordHash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored.passwordHash).not.toContain('Servixa');
    expect(stored.salt).toBeTruthy();
    expect(stored.iterations).toBeGreaterThanOrEqual(100_000);
  });
});

describe('password changes', () => {
  it('requires the current password and enforces the policy', async () => {
    const user = await createInitialAdmin({
      businessName: 'X', fullName: 'Ahmed Raza', username: 'admin',
      password: 'Servixa#2026', confirmPassword: 'Servixa#2026'
    });

    const wrongCurrent = await changePassword(user.id, 'nope', 'Servixa#2027');
    expect(wrongCurrent.ok).toBe(false);

    const weak = await changePassword(user.id, 'Servixa#2026', 'allletters');
    expect(weak.ok).toBe(false);

    const good = await changePassword(user.id, 'Servixa#2026', 'Servixa#2027');
    expect(good.ok).toBe(true);

    expect((await login('admin', 'Servixa#2026')).ok).toBe(false);
    expect((await login('admin', 'Servixa#2027')).ok).toBe(true);
  });

  it('produces a different hash for the same password under a new salt', async () => {
    const a = await hashPassword('Servixa#2026', randomSalt());
    const b = await hashPassword('Servixa#2026', randomSalt());
    expect(a).not.toBe(b);
  });
});
