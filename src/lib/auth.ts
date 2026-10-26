/**
 * Local authentication.
 *
 * SECURITY MODEL (documented, deliberately conservative)
 * ------------------------------------------------------
 * Servixa v1.1.2 is offline-first: accounts live in IndexedDB on this device.
 * Passwords are stored as PBKDF2-SHA-256 hashes (per-user random salt, 150,000
 * iterations), never in plaintext, and are excluded from backups and logs.
 * A client-side store cannot protect against someone with full control of the
 * browser profile or OS account — it protects against casual inspection and
 * password reuse. Authentication is local to this browser; there is no server-side auth in
 * front of it and treat this local layer as a convenience cache only.
 */
import { getSettings, withTx, type Tx } from './db';
import type { AppSettings, PublicUser, SecuritySettings, User } from './types';
import { uid } from './ids';
import { publicUser } from './repo';

const SESSION_KEY = 'servixa.session.v1';
const ITERATIONS = 150_000;

export interface Session {
  userId: string;
  token: string;
  issuedAt: number;
  expiresAt: number;
}

export function randomSalt(): string {
  const arr = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function hashPassword(password: string, salt: string, iterations = ITERATIONS): Promise<string> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: enc.encode(salt), iterations, hash: 'SHA-256' },
    keyMaterial,
    256
  );
  return Array.from(new Uint8Array(bits), (b) => b.toString(16).padStart(2, '0')).join('');
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function passwordIssues(password: string, policy: SecuritySettings): string[] {
  const issues: string[] = [];
  if (password.length < policy.minPasswordLength) issues.push(`At least ${policy.minPasswordLength} characters`);
  if (policy.requireUppercase && !/[A-Z]/.test(password)) issues.push('At least one uppercase letter');
  if (policy.requireNumber && !/[0-9]/.test(password)) issues.push('At least one number');
  return issues;
}

export function readSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Session;
    if (!s.userId || !s.token) return null;
    if (Date.now() > s.expiresAt) {
      localStorage.removeItem(SESSION_KEY);
      return null;
    }
    return s;
  } catch {
    return null;
  }
}

export function writeSession(userId: string, hours: number): Session {
  const session: Session = {
    userId,
    token: uid('sess'),
    issuedAt: Date.now(),
    expiresAt: Date.now() + Math.max(1, hours) * 3600_000
  };
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  return session;
}

export function clearSession(): void {
  localStorage.removeItem(SESSION_KEY);
}

export type LoginResult = { ok: true; user: PublicUser; settings: AppSettings } | { ok: false; error: string };

export async function login(username: string, password: string): Promise<LoginResult> {
  const uname = username.trim().toLowerCase();
  if (!uname || !password) return { ok: false, error: 'Enter your username and password.' };
  const settings = await getSettings();

  // Phase 1 — read the account and any lockout record.
  const pre = await withTx(['users', 'meta'], 'readonly', async (tx) => {
    const users = await tx.by<User>('users', 'username', uname);
    const lock = await tx.get<{ key: string; value: { fails: number; until: number } }>('meta', `lock:${uname}`);
    return { user: users[0] ?? null, lock: lock?.value ?? null };
  });

  if (pre.lock && pre.lock.until > Date.now()) {
    return { ok: false, error: 'Too many failed attempts. Try again in 15 minutes.' };
  }
  if (!pre.user || !pre.user.active) {
    return { ok: false, error: 'Incorrect username or password.' };
  }

  // Phase 2 — derive the hash OUTSIDE any transaction. Awaiting WebCrypto inside
  // a live IndexedDB transaction lets the transaction auto-commit.
  const hash = await hashPassword(password, pre.user.salt, pre.user.iterations || ITERATIONS);
  if (!timingSafeEqual(hash, pre.user.passwordHash)) {
    await withTx(['meta', 'audit'], 'readwrite', async (tx) => {
      if (settings.security.lockAfterFailures > 0) {
        const fails = (pre.lock?.fails ?? 0) + 1;
        const until = fails >= settings.security.lockAfterFailures ? Date.now() + 15 * 60_000 : 0;
        await tx.put('meta', { key: `lock:${uname}`, value: { fails: until ? 0 : fails, until } });
      }
      await tx.put('audit', {
        id: uid('aud'), createdAt: Date.now(), updatedAt: Date.now(), action: 'login_failed',
        entity: 'user', entityId: pre.user!.id, summary: `Failed sign-in for "${pre.user!.username}"`,
        userId: pre.user!.id, userName: pre.user!.username
      });
    });
    return { ok: false, error: 'Incorrect username or password.' };
  }

  // Phase 3 — persist the successful sign-in.
  const updated = await withTx(['users', 'meta', 'audit'], 'readwrite', async (tx) => {
    const fresh = await tx.get<User>('users', pre.user!.id);
    if (!fresh || !fresh.active) throw new Error('This account is no longer active.');
    const next: User = { ...fresh, lastLogin: Date.now(), updatedAt: Date.now() };
    await tx.put('users', next);
    await tx.del('meta', `lock:${uname}`);
    await tx.put('audit', {
      id: uid('aud'), createdAt: Date.now(), updatedAt: Date.now(), action: 'login',
      entity: 'user', entityId: next.id, summary: `${next.name} signed in`, userId: next.id, userName: next.name
    });
    return next;
  });

  writeSession(updated.id, settings.security.sessionHours);
  return { ok: true, user: publicUser(updated), settings };
}

export async function logout(userId?: string, userName?: string): Promise<void> {
  clearSession();
  if (userId) {
    await withTx(['audit'], 'readwrite', async (tx) => {
      await tx.put('audit', {
        id: uid('aud'), createdAt: Date.now(), updatedAt: Date.now(), action: 'logout',
        entity: 'user', entityId: userId, summary: `${userName ?? 'User'} signed out`, userId, userName
      });
    });
  }
}

export async function changePassword(userId: string, currentPassword: string, nextPassword: string): Promise<{ ok: boolean; error?: string }> {
  const settings = await getSettings();
  const issues = passwordIssues(nextPassword, settings.security);
  if (issues.length) return { ok: false, error: issues.join(' · ') };
  const user = await withTx(['users'], 'readonly', (tx) => tx.get<User>('users', userId));
  if (!user) return { ok: false, error: 'Account not found.' };
  const currentHash = await hashPassword(currentPassword, user.salt, user.iterations || ITERATIONS);
  if (!timingSafeEqual(currentHash, user.passwordHash)) return { ok: false, error: 'Your current password is incorrect.' };
  const salt = randomSalt();
  const passwordHash = await hashPassword(nextPassword, salt, ITERATIONS);
  await withTx(['users', 'audit'], 'readwrite', async (tx) => {
    await tx.put('users', { ...user, salt, passwordHash, iterations: ITERATIONS, updatedAt: Date.now() });
    await tx.put('audit', {
      id: uid('aud'), createdAt: Date.now(), updatedAt: Date.now(), action: 'user.update',
      entity: 'user', entityId: user.id, summary: `${user.name} changed their password`, userId: user.id, userName: user.name
    });
  });
  return { ok: true };
}

export function auditRecord(tx: Tx, action: string, entity: string, entityId: string, summary: string, actor?: { id: string; name: string }) {
  return tx.put('audit', {
    id: uid('aud'), createdAt: Date.now(), updatedAt: Date.now(), action,
    entity, entityId, summary, userId: actor?.id ?? 'system', userName: actor?.name ?? 'System'
  });
}
