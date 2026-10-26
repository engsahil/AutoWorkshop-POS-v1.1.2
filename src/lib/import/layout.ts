/**
 * PDF layout reconstruction.
 *
 * pdf.js gives text as positioned runs. This module turns those runs into
 * lines, finds the table header, derives column boundaries from the header's
 * x-positions, and assigns every later line's cells to those columns. It also
 * copes with repeated headers across pages, page footers and totals rows.
 *
 * Pure functions only — no PDF library import here, so the logic is unit
 * tested in Node against synthetic positions.
 */
import { headerScore } from './mapping';
import { collapseSpaces, normalizeKey } from './text';
import type { SourceTable } from './types';

export interface TextRun {
  str: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PdfPageData {
  index: number;
  width: number;
  height: number;
  runs: TextRun[];
}

export interface Cell {
  text: string;
  x: number;
  end: number;
}

export interface Line {
  page: number;
  y: number;
  cells: Cell[];
  text: string;
}

export interface ColumnSpan {
  header: string;
  start: number;
  end: number;
  center: number;
}

const FOOTER = /^(page\s+\d+(\s*(of|\/)\s*\d+)?|\d+\s*(of|\/)\s*\d+|-\s*\d+\s*-|continued( on next page)?\.?)$/i;
const TOTALS = /^(grand\s+)?(total|subtotal|sub total|net total|sum)\b/i;

/** Group positioned runs into visual lines, then into cells split at column gaps. */
export function buildLines(page: PdfPageData, tolerance = 2.6): Line[] {
  // pdf.js emits whitespace-only runs whose width spans the whole gap between
  // columns; they carry no text, and counting their width would merge columns.
  const runs = page.runs
    .filter((r) => /\S/.test(r.str) && r.w >= 0)
    .slice()
    .sort((a, b) => (Math.abs(b.y - a.y) > tolerance ? b.y - a.y : a.x - b.x));
  if (!runs.length) return [];

  const buckets: { y: number; runs: TextRun[] }[] = [];
  for (const run of runs) {
    const bucket = buckets.find((b) => Math.abs(b.y - run.y) <= tolerance);
    if (bucket) {
      bucket.runs.push(run);
      bucket.y = (bucket.y * (bucket.runs.length - 1) + run.y) / bucket.runs.length;
    } else {
      buckets.push({ y: run.y, runs: [run] });
    }
  }

  const lines: Line[] = [];
  for (const bucket of buckets) {
    const ordered = bucket.runs.slice().sort((a, b) => a.x - b.x);
    const cells: Cell[] = [];
    let current: Cell | null = null;
    let prevEnd = -Infinity;
    let prevH = 9;

    for (const run of ordered) {
      const gap = run.x - prevEnd;
      const breakGap = Math.max(2.4, prevH * 0.42);
      const text = run.str;
      if (!current || gap > breakGap) {
        current = { text, x: run.x, end: run.x + run.w };
        cells.push(current);
      } else {
        const joiner = gap > Math.max(0.6, prevH * 0.12) ? ' ' : '';
        current.text = `${current.text}${joiner}${text}`;
        current.end = Math.max(current.end, run.x + run.w);
      }
      prevEnd = Math.max(prevEnd, run.x + run.w);
      prevH = run.h || prevH;
    }

    const expanded = cells.flatMap(splitPaddedCell);
    const cleaned = expanded
      .map((c) => ({ ...c, text: collapseSpacesForCell(c.text) }))
      .filter((c) => c.text !== '');
    if (!cleaned.length) continue;
    lines.push({ page: page.index, y: bucket.y, cells: cleaned, text: cleaned.map((c) => c.text).join(' ') });
  }

  return lines.sort((a, b) => (a.page === b.page ? b.y - a.y : a.page - b.page));
}

function collapseSpacesForCell(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Fixed-width exports put several columns in one run separated by runs of
 * spaces. Split those and approximate each sub-cell's x by character offset so
 * column assignment still has usable geometry.
 */
function splitPaddedCell(cell: Cell): Cell[] {
  const parts = cell.text.split(/\s{2,}/);
  if (parts.length < 2) return [cell];
  const span = cell.end - cell.x;
  const total = cell.text.length || 1;
  const out: Cell[] = [];
  let cursor = 0;
  for (const part of parts) {
    const offset = cell.text.indexOf(part, cursor);
    cursor = offset + part.length;
    const x = cell.x + (offset / total) * span;
    const end = cell.x + (cursor / total) * span;
    out.push({ text: part, x, end: Math.max(end, x + 1) });
  }
  return out;
}

export function detectHeaderLine(lines: Line[], maxScan = 30): { line: Line; index: number } | null {
  for (let i = 0; i < Math.min(lines.length, maxScan); i++) {
    const line = lines[i];
    if (line.cells.length < 2) continue;
    const { score, fields } = headerScore(line.cells.map((c) => c.text));
    if (fields.length >= 2 && score >= 1.2) return { line, index: i };
  }
  return null;
}

export function columnsFromHeader(header: Line): ColumnSpan[] {
  const cells = header.cells;
  return cells.map((cell, i) => {
    const prev = cells[i - 1];
    const next = cells[i + 1];
    const start = prev ? (prev.end + cell.x) / 2 : Number.NEGATIVE_INFINITY;
    const end = next ? (cell.end + next.x) / 2 : Number.POSITIVE_INFINITY;
    return { header: cell.text, start, end, center: (cell.x + cell.end) / 2 };
  });
}

function assignCells(cells: Cell[], columns: ColumnSpan[]): string[] {
  const values = new Array<string>(columns.length).fill('');
  for (const cell of cells) {
    let bestIndex = -1;
    let bestScore = -Infinity;
    for (let i = 0; i < columns.length; i++) {
      const col = columns[i];
      const overlap = Math.min(cell.end, col.end) - Math.max(cell.x, col.start);
      const distance = Math.abs((cell.x + cell.end) / 2 - col.center);
      const score = overlap > 0 ? 1000 + overlap - distance / 1000 : -distance;
      if (score > bestScore) {
        bestScore = score;
        bestIndex = i;
      }
    }
    if (bestIndex < 0) continue;
    values[bestIndex] = values[bestIndex] ? `${values[bestIndex]} ${cell.text}` : cell.text;
  }
  return values;
}

function isRepeatedHeader(line: Line, headerText: string): boolean {
  const current = normalizeKey(line.cells.map((c) => c.text).join(' '));
  return current === headerText || (!!current && headerText.startsWith(current) && current.length > headerText.length * 0.7);
}

function modalCellCount(lines: Line[]): number {
  const counts = new Map<number, number>();
  for (const line of lines) counts.set(line.cells.length, (counts.get(line.cells.length) ?? 0) + 1);
  let best = 1;
  let bestCount = -1;
  for (const [count, freq] of counts) {
    if (freq > bestCount || (freq === bestCount && count > best)) {
      best = count;
      bestCount = freq;
    }
  }
  return Math.max(1, best);
}

export interface LayoutResult {
  headers: string[];
  rows: string[][];
  headerFound: boolean;
  repeatedHeaders: number;
  skippedLines: number;
}

/** Reconstruct one table across every page of a document. */
export function tableFromPages(pages: PdfPageData[]): LayoutResult {
  const pageLines = pages.map((page) => buildLines(page)).filter((lines) => lines.length > 0);
  let repeatedHeaders = 0;
  let skippedLines = 0;

  // Pass 1 — find the header on the first page that has one.
  let headerCells: string[] | null = null;
  for (const lines of pageLines) {
    const found = detectHeaderLine(lines);
    if (found) {
      headerCells = found.line.cells.map((c) => c.text);
      break;
    }
  }

  const synthesised = !headerCells;
  if (!headerCells) {
    const widest = pageLines.reduce((max, lines) => Math.max(max, modalCellCount(lines)), 1);
    headerCells = Array.from({ length: widest }, (_, i) => `Column ${i + 1}`);
  }
  const headers: string[] = headerCells;
  const headerText = synthesised ? '' : normalizeKey(headers.join(' '));

  // Pass 2 — walk every page, skipping repeated headers and footers.
  let columns: ColumnSpan[] | null = null;
  const rows: string[][] = [];

  for (const lines of pageLines) {
    let startIndex = 0;
    if (!synthesised) {
      const found = detectHeaderLine(lines);
      if (found && (columns === null || isRepeatedHeader(found.line, headerText) || normalizeKey(found.line.cells.map((c) => c.text).join(' ')) === headerText)) {
        if (columns !== null) repeatedHeaders++;
        columns = columnsFromHeader(found.line);
        startIndex = found.index + 1;
      }
    }

    for (let i = startIndex; i < lines.length; i++) {
      const line = lines[i];
      if (!synthesised && isRepeatedHeader(line, headerText)) {
        repeatedHeaders++;
        continue;
      }
      if (line.cells.length === 1 && FOOTER.test(line.cells[0].text.trim())) {
        skippedLines++;
        continue;
      }
      if (TOTALS.test(line.cells[0]?.text ?? '') && line.cells.length > 1 && line.cells.some((c) => /\d/.test(c.text))) {
        skippedLines++;
        continue;
      }
      const values = columns ? assignCells(line.cells, columns) : line.cells.map((c) => c.text);
      while (values.length < headers.length) values.push('');
      if (values.slice(0, headers.length).every((v) => !v)) continue;
      rows.push(values.slice(0, headers.length));
    }
  }

  return {
    headers,
    rows,
    headerFound: !synthesised,
    repeatedHeaders,
    skippedLines
  };
}

/** Convenience wrapper used by the pipeline and by tests. */
export function pdfLayoutToTable(pages: PdfPageData[], fileName: string): SourceTable {
  const result = tableFromPages(pages);
  const notes: string[] = [];
  if (!result.headerFound) notes.push('No header row was recognised — check the column mapping before importing.');
  if (result.repeatedHeaders) notes.push(`${result.repeatedHeaders} repeated header row${result.repeatedHeaders === 1 ? '' : 's'} skipped.`);
  if (result.skippedLines) notes.push(`${result.skippedLines} footer or totals line${result.skippedLines === 1 ? '' : 's'} skipped.`);
  return {
    id: `src-${fileName}`,
    fileName,
    kind: 'pdf',
    headers: result.headers,
    rows: result.rows,
    headerFound: result.headerFound,
    notes,
    stats: { pages: pages.length, repeatedHeaders: result.repeatedHeaders, skippedLines: result.skippedLines }
  };
}
