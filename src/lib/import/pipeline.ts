/**
 * File → tables → drafts.
 *
 * Type detection prefers magic bytes over the file extension, so a renamed
 * .csv is still read as CSV and a legacy .xls gets an accurate message instead
 * of a parser crash.
 */
import { parseDelimitedBytes } from './csv';
import { parseXlsx, looksLikeZip } from './xlsx';
import { pdfToTable } from './pdf';
import { fingerprintBytes } from './fingerprint';
import { suggestCategory } from './mapping';
import { readZipDirectory } from './zip';
import { codeKey } from './values';
import { normalizeKey } from './text';
import {
  ImportError, MAX_FILE_BYTES, MAX_ROWS, type ColumnMapping, type DraftItem, type FieldKey,
  type SourceKind, type SourceTable
} from './types';

export interface ParsedFile {
  fileName: string;
  kind: SourceKind;
  fingerprint: string;
  tables: SourceTable[];
  notes: string[];
}

function kindFromName(name: string): SourceKind | null {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  if (ext === 'pdf') return 'pdf';
  if (ext === 'csv') return 'csv';
  if (ext === 'tsv' || ext === 'tab') return 'tsv';
  if (ext === 'txt') return 'txt';
  if (ext === 'xlsx') return 'xlsx';
  return null;
}

export interface ParseOptions {
  onProgress?: (done: number, total: number) => void;
  signal?: { aborted: boolean };
}

export async function parseInventoryFile(name: string, bytes: Uint8Array, options: ParseOptions = {}): Promise<ParsedFile> {
  if (!bytes.length) throw new ImportError(`“${name}” is empty.`);
  if (bytes.length > MAX_FILE_BYTES) {
    throw new ImportError(`“${name}” is ${(bytes.length / 1024 / 1024).toFixed(1)} MB. The limit is 25 MB — split the file and import in parts.`);
  }

  const fingerprint = await fingerprintBytes(bytes);
  const head = bytes.subarray(0, 8);
  const isPdf = head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46; // %PDF
  const isOle = head[0] === 0xd0 && head[1] === 0xcf && head[2] === 0x11 && head[3] === 0xe0;
  const declared = kindFromName(name);

  if (isPdf) {
    const { table } = await pdfToTable(bytes, name, { onProgress: options.onProgress, signal: options.signal });
    if (table.rows.length > MAX_ROWS) {
      table.notes.push(`Only the first ${MAX_ROWS} rows are used.`);
      table.rows = table.rows.slice(0, MAX_ROWS);
    }
    return { fileName: name, kind: 'pdf', fingerprint, tables: [table], notes: table.notes };
  }

  if (isOle) {
    throw new ImportError(
      'Legacy .xls workbooks are not supported. Open the file in Excel/LibreOffice and “Save as” .xlsx or CSV, then import that.'
    );
  }

  if (looksLikeZip(bytes)) {
    let entries: string[] = [];
    try {
      entries = readZipDirectory(bytes).map((e) => e.name.toLowerCase());
    } catch {
      throw new ImportError(`“${name}” looks like a compressed file but could not be read.`);
    }
    if (entries.some((e) => e === 'word/document.xml')) {
      throw new ImportError('Word documents are not supported. Save the list as .xlsx or CSV and import that.');
    }
    if (!entries.some((e) => e === 'xl/workbook.xml')) {
      throw new ImportError(`“${name}” is a ZIP archive, not an Excel workbook.`);
    }
    const { sheets } = await parseXlsx(bytes, name, MAX_ROWS);
    if (!sheets.length) throw new ImportError(`“${name}” contains no sheet with data.`);
    return { fileName: name, kind: 'xlsx', fingerprint, tables: sheets, notes: [] };
  }

  // Everything else is treated as delimited text.
  const kind: 'csv' | 'tsv' | 'txt' = declared === 'tsv' ? 'tsv' : declared === 'txt' ? 'txt' : 'csv';
  const table = parseDelimitedBytes(bytes, { fileName: name, kind, maxRows: MAX_ROWS });
  if (!table.rows.length) throw new ImportError(`“${name}” has a header but no data rows.`);
  return { fileName: name, kind, fingerprint, tables: [table], notes: table.notes };
}

export interface PlannedSource {
  table: SourceTable;
  mapping: ColumnMapping;
}

/** Turn mapped tables into review rows. Nothing is written here. */
export function draftsFromSources(sources: PlannedSource[]): { items: DraftItem[]; blankRows: number } {
  const items: DraftItem[] = [];
  let blankRows = 0;
  sources.forEach((source, sourceIndex) => {
    const fields = Object.entries(source.mapping)
      .map(([index, field]) => ({ index: Number(index), field }))
      .filter((entry): entry is { index: number; field: FieldKey } => !!entry.field);
    // A sheet without a name or code column cannot describe inventory (an
    // "Instructions" or "Notes" tab, for example). It contributes no rows.
    const identifies = fields.some((f) => f.field === 'name' || f.field === 'sku' || f.field === 'partNumber');
    if (!fields.length || !identifies) return;

    source.table.rows.forEach((row, rowIndex) => {
      const values: Partial<Record<FieldKey, string>> = {};
      for (const { index, field } of fields) {
        const cell = (row[index] ?? '').trim();
        if (!cell) continue;
        if (!values[field]) values[field] = cell;
      }
      if (!Object.keys(values).length) {
        blankRows++;
        return;
      }
      items.push({
        id: `row-${sourceIndex}-${rowIndex}`,
        sourceRow: rowIndex + 1,
        source: source.table.sheet ? `${source.table.fileName} · ${source.table.sheet}` : source.table.fileName,
        values,
        selected: true,
        removed: false,
        decision: 'create',
        issues: []
      });
    });
  });
  return { items, blankRows };
}

export interface CategoryReview {
  name: string;
  key: string;
  count: number;
  suggestion: string | null;
  score: number;
  existing: boolean;
}

export function reviewCategories(items: DraftItem[], existing: string[]): CategoryReview[] {
  const map = new Map<string, CategoryReview>();
  for (const item of items) {
    if (item.removed) continue;
    const name = (item.values.category ?? '').trim();
    if (!name) continue;
    const key = normalizeKey(name);
    const entry = map.get(key);
    if (entry) {
      entry.count++;
      continue;
    }
    const exact = existing.find((c) => normalizeKey(c) === key) ?? null;
    const suggestion = exact ? { match: exact, score: 1 } : suggestCategory(name, existing);
    map.set(key, {
      name, key, count: 1, suggestion: suggestion.match, score: suggestion.score,
      existing: !!exact
    });
  }
  return Array.from(map.values()).sort((a, b) => b.count - a.count);
}

/**
 * Explicit, user-invoked code generation for rows that carry a name but no SKU.
 * The scheme is visible in the button that triggers it; nothing is generated
 * silently and no existing SKU can be reused.
 */
export function assignMissingSkus(
  items: DraftItem[],
  existingSkus: string[],
  prefix = 'IMP'
): { items: DraftItem[]; assigned: number } {
  const taken = new Set(existingSkus.map((s) => codeKey(s)));
  let counter = 0;
  for (const sku of taken) {
    const match = new RegExp(`^${prefix}-(\\d+)$`).exec(sku);
    if (match) counter = Math.max(counter, Number(match[1]));
  }
  let assigned = 0;
  const next = items.map((item) => {
    if (item.removed) return item;
    if ((item.values.sku ?? '').trim() || (item.values.partNumber ?? '').trim()) return item;
    if (!(item.values.name ?? '').trim()) return item;
    let candidate: string;
    do {
      counter++;
      candidate = `${prefix}-${String(counter).padStart(5, '0')}`;
    } while (taken.has(codeKey(candidate)));
    taken.add(codeKey(candidate));
    assigned++;
    return { ...item, values: { ...item.values, sku: candidate }, edited: true };
  });
  return { items: next, assigned };
}

/** Rows summarised for the confirmation step. */
export function summarise(items: DraftItem[]) {
  const active = items.filter((i) => !i.removed);
  const selected = active.filter((i) => i.selected && i.decision !== 'skip');
  return {
    total: active.length,
    selected: selected.length,
    creates: selected.filter((i) => i.decision === 'create').length,
    updates: selected.filter((i) => i.decision === 'update').length,
    skipped: active.filter((i) => !i.selected || i.decision === 'skip').length,
    blocked: active.filter((i) => i.issues.some((x) => x.level === 'error')).length,
    duplicates: active.filter((i) => !!i.duplicate && i.duplicate.kind !== 'name').length,
    removed: items.length - active.length,
    warnings: active.filter((i) => i.issues.some((x) => x.level === 'warning')).length,
    units: selected.reduce((sum, i) => sum + (Number(i.values.qty ?? 0) || 0), 0)
  };
}
