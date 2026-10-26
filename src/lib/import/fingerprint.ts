/**
 * File fingerprints for repeat-import protection.
 *
 * SHA-256 through WebCrypto when the page is a secure context (localhost or
 * HTTPS), with a small FNV-1a fallback so the feature still works on a plain
 * http:// LAN address. The fingerprint is only used to warn "you already
 * imported this file"; it never blocks an import on its own.
 */

function fnv1a(bytes: Uint8Array): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    hash ^= bytes[i];
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `fnv1a-${hash.toString(16).padStart(8, '0')}-${bytes.length.toString(16)}`;
}

export async function fingerprintBytes(bytes: Uint8Array): Promise<string> {
  const subtle = typeof crypto !== 'undefined' ? crypto.subtle : undefined;
  if (subtle?.digest) {
    try {
      const digest = await subtle.digest('SHA-256', bytes as unknown as BufferSource);
      const hex = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
      return `sha256-${hex}`;
    } catch {
      /* fall through to the cheap hash */
    }
  }
  return fnv1a(bytes);
}
