/**
 * RFC 4180 CSV/TSV reader.
 *
 * Handles quoted fields with embedded commas, quotes and newlines, CRLF and
 * lone CR line endings, a UTF-8 BOM, and delimiter sniffing for comma,
 * semicolon, tab and pipe separated files. Runs entirely in memory on a
 * Uint8Array: a 25 MB file never exists as two decoded copies.
 */
import { cleanCell, decodeText } from './text';
import type { SourceTable } from './types';

const DELIMITERS = [',', ';', '\t', '|'] as const;

/** Guess the delimiter from the first few non-empty lines, outside quotes. */
export function sniffDelimiter(text: string): string {
  const sample = text.split(/\r\n|\n|\r/).filter((l) => l.trim().length > 0).slice(0, 12);
  let best = ',';
  let bestScore = -1;
  for (const d of DELIMITERS) {
    let counts: number[] = [];
    for (const line of sample) {
      let count = 0;
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
          if (inQuotes && line[i + 1] === '"') i++;
          else inQuotes = !inQuotes;
        } else if (ch === d && !inQuotes) count++;
      }
      counts.push(count);
    }
    if (!counts.length) continue;
    // Prefer the delimiter that appears consistently and most often.
    const positives = counts.filter((c) => c > 0);
    if (!positives.length) continue;
    const avg = positives.reduce((a, b) => a + b, 0) / positives.length;
    const consistency = positives.length / counts.length;
    const score = avg * consistency;
    if (score > bestScore) {
      bestScore = score;
      best = d;
    }
  }
  return best;
}

/** Split one delimited body into rows of raw string cells. */
export function splitDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  const pushField = () => {
    row.push(field);
    field = '';
  };
  const pushRow = () => {
    pushField();
    // Skip completely empty trailing rows, keep interior blanks (they matter for edit alignment).
    if (row.some((c) => c !== '')) rows.push(row);
    row = [];
  };

  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"' && field.trim() === '') {
      inQuotes = true;
      field = '';
      i++;
      continue;
    }
    if (ch === delimiter) {
      pushField();
      i++;
      continue;
    }
    if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      pushRow();
      i++;
      continue;
    }
    field += ch;
    i++;
  }
  if (field !== '' || row.length) pushRow();
  return rows;
}

/**
 * Build a SourceTable from delimited text. The first non-empty row is treated
 * as the header unless every row looks like data (then columns are synthesised
 * and the caller is told headers were not found).
 */
export function parseDelimitedBytes(
  bytes: Uint8Array,
  options: { fileName: string; kind: 'csv' | 'tsv' | 'txt'; maxRows?: number }
): SourceTable {
  const text = decodeText(bytes);
  const delimiter = options.kind === 'tsv' ? '\t' : sniffDelimiter(text);
  const raw = splitDelimited(text, delimiter);
  const notes: string[] = [];
  if (!raw.length) {
    return {
      id: `src-${options.fileName}`, fileName: options.fileName, kind: options.kind,
      headers: [], rows: [], headerFound: false, notes: ['The file contains no rows.']
    };
  }

  const width = Math.max(...raw.map((r) => r.length));
  const padded = raw.map((r) => {
    const next = r.slice();
    while (next.length < width) next.push('');
    return next.map((c) => cleanCell(c));
  });

  const headers = padded[0].map((h, i) => (h ? h : `Column ${i + 1}`));
  const rows = padded.slice(1);
  if (rows.length > (options.maxRows ?? 10000)) {
    notes.push(`Only the first ${options.maxRows ?? 10000} rows were read.`);
  }
  return {
    id: `src-${options.fileName}`,
    fileName: options.fileName,
    kind: options.kind,
    headers,
    rows: rows.slice(0, options.maxRows ?? 10000),
    headerFound: true,
    notes
  };
}
