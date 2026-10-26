/** Small text helpers shared by the CSV, Excel and PDF readers. */

/** Case/punctuation-insensitive key used for header and category matching. */
export function normalizeKey(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function collapseSpaces(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/** Trim, drop wrapping quotes and normalise exotic spaces without changing content. */
export function cleanCell(value: string): string {
  return value
    .replace(/\u00a0/g, ' ')
    .replace(/[\u2000-\u200b\u202f]/g, ' ')
    .replace(/\r\n?/g, '\n')
    .trim();
}

/** Decode bytes as UTF-8, tolerating a BOM and falling back to Latin-1 for invalid sequences. */
export function decodeText(bytes: Uint8Array): string {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    text = new TextDecoder('windows-1252').decode(bytes);
  }
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * Similarity of two short strings (Dice coefficient over character bigrams).
 * Used only to *suggest* category matches — never to merge records silently.
 */
export function similarity(a: string, b: string): number {
  const x = normalizeKey(a);
  const y = normalizeKey(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.length < 2 || y.length < 2) return x === y ? 1 : 0;
  const bigrams = new Map<string, number>();
  for (let i = 0; i < x.length - 1; i++) {
    const g = x.slice(i, i + 2);
    bigrams.set(g, (bigrams.get(g) ?? 0) + 1);
  }
  let hits = 0;
  for (let i = 0; i < y.length - 1; i++) {
    const g = y.slice(i, i + 2);
    const n = bigrams.get(g) ?? 0;
    if (n > 0) {
      hits++;
      bigrams.set(g, n - 1);
    }
  }
  return (2 * hits) / (x.length - 1 + y.length - 1);
}
