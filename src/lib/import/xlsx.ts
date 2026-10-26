/**
 * .xlsx reader built on the local ZIP reader and XML scanner.
 *
 * Reads every non-empty worksheet, resolves shared strings, inline strings and
 * numeric cells, and returns one SourceTable per sheet. Formulas are ignored:
 * only their cached values are read, and nothing from the file is executed.
 */
import { extractZipEntry, readZipDirectory, readZipText, type ZipEntry } from './zip';
import { columnIndex, firstElement, iterateElements, textOf } from './xml';
import { cleanCell } from './text';
import type { SourceTable } from './types';

interface SheetPart {
  name: string;
  path: string;
}

function naturalSheetOrder(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true });
}

function sharedStringsFrom(xml: string | null): string[] {
  if (!xml) return [];
  const out: string[] = [];
  for (const si of iterateElements(xml, 'si')) out.push(textOf(si.inner));
  return out;
}

function sheetList(workbook: string | null, entries: ZipEntry[]): SheetPart[] {
  const sheetFiles = entries
    .map((e) => e.name)
    .filter((n) => /^xl\/worksheets\/[^/]+\.xml$/i.test(n))
    .sort(naturalSheetOrder);
  const names: string[] = [];
  if (workbook) {
    for (const sheet of iterateElements(workbook, 'sheet')) {
      names.push(sheet.attrs.name || `Sheet ${names.length + 1}`);
    }
  }
  if (!sheetFiles.length) return [];
  // Sheet order in workbook.xml normally matches sheet1.xml … sheetN.xml.
  return sheetFiles.map((path, i) => ({ name: names[i] ?? `Sheet ${i + 1}`, path }));
}

function readSheetXml(xml: string, shared: string[]): string[][] {
  const rows: string[][] = [];
  for (const row of iterateElements(xml, 'row')) {
    const cells: string[] = [];
    let nextIndex = 0;
    for (const cell of iterateElements(row.inner, 'c')) {
      const ref = cell.attrs.r;
      const index = ref ? columnIndex(ref) : nextIndex;
      nextIndex = index + 1;
      const type = cell.attrs.t;
      let value = '';
      if (type === 's') {
        const v = firstElement(cell.inner, 'v');
        const n = v ? Number(textOf(v.inner)) : NaN;
        value = Number.isFinite(n) ? shared[n] ?? '' : '';
      } else if (type === 'inlineStr') {
        const is = firstElement(cell.inner, 'is');
        value = is ? textOf(is.inner) : '';
      } else if (type === 'str') {
        const v = firstElement(cell.inner, 'v');
        value = v ? textOf(v.inner) : '';
      } else if (type === 'b') {
        const v = firstElement(cell.inner, 'v');
        value = v && textOf(v.inner) === '1' ? 'TRUE' : 'FALSE';
      } else {
        const v = firstElement(cell.inner, 'v');
        value = v ? textOf(v.inner) : '';
      }
      while (cells.length < index) cells.push('');
      cells[index] = cleanCell(value);
    }
    if (cells.some((c) => c !== '')) rows.push(cells);
    if (rows.length > 20000) break;
  }
  return rows;
}

export interface XlsxResult {
  sheets: SourceTable[];
  sheetNames: string[];
}

export async function parseXlsx(bytes: Uint8Array, fileName: string, maxRows = 10000): Promise<XlsxResult> {
  const entries = readZipDirectory(bytes);
  const byName = new Map(entries.map((e) => [e.name.toLowerCase(), e]));

  const read = async (path: string): Promise<string | null> => {
    const entry = byName.get(path.toLowerCase());
    if (!entry) return null;
    return readZipText(bytes, entry);
  };

  const shared = sharedStringsFrom(await read('xl/sharedStrings.xml'));
  const workbook = await read('xl/workbook.xml');
  const parts = sheetList(workbook, entries);
  if (!parts.length) throw new Error('The workbook contains no worksheets.');

  const sheets: SourceTable[] = [];
  for (const part of parts) {
    const entry = byName.get(part.path.toLowerCase());
    if (!entry) continue;
    const xml = await readZipText(bytes, entry);
    const rows = readSheetXml(xml, shared);
    if (rows.length < 1) continue;

    const width = Math.max(...rows.map((r) => r.length));
    const padded = rows.map((r) => {
      const next = r.slice();
      while (next.length < width) next.push('');
      return next;
    });
    const headers = padded[0].map((h, i) => (h ? h : `Column ${i + 1}`));
    const notes: string[] = [];
    if (padded.length - 1 > maxRows) notes.push(`Only the first ${maxRows} rows were read.`);
    sheets.push({
      id: `src-${fileName}-${part.name}`,
      fileName,
      kind: 'xlsx',
      sheet: part.name,
      headers,
      rows: padded.slice(1, maxRows + 1),
      headerFound: true,
      notes
    });
  }

  return { sheets, sheetNames: parts.map((p) => p.name) };
}

/** Exposed for the file-type guard in the UI. */
export function looksLikeZip(bytes: Uint8Array): boolean {
  return bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b;
}

export { extractZipEntry };
