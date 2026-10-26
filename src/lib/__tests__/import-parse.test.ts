import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseDelimitedBytes, sniffDelimiter, splitDelimited } from '../import/csv';
import { parseXlsx } from '../import/xlsx';
import { pdfToTable } from '../import/pdf';
import { buildLines, detectHeaderLine, tableFromPages, type PdfPageData } from '../import/layout';
import { mapHeaders } from '../import/mapping';
import { parseInventoryFile } from '../import/pipeline';

const fixture = (name: string) =>
  new Uint8Array(readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))));

const encode = (text: string) => new TextEncoder().encode(text);

describe('CSV reader', () => {
  it('handles quoted commas, escaped quotes and embedded newlines', () => {
    const rows = splitDelimited('a,b\n"x,1","he said ""hi""\nyes"\n', ',');
    expect(rows).toEqual([['a', 'b'], ['x,1', 'he said "hi"\nyes']]);
  });

  it('sniffs semicolons and honours a BOM', () => {
    const csv = '\ufeffItem Code;Name;Qty\nA-1;Filter;4\n';
    expect(sniffDelimiter(csv.replace('\ufeff', ''))).toBe(';');
    const table = parseDelimitedBytes(encode(csv), { fileName: 'x.csv', kind: 'csv' });
    expect(table.headers).toEqual(['Item Code', 'Name', 'Qty']);
    expect(table.rows).toEqual([['A-1', 'Filter', '4']]);
  });

  it('reads a real semicolon fixture with European decimals', () => {
    const table = parseDelimitedBytes(fixture('inventory-semicolon.csv'), { fileName: 'inventory-semicolon.csv', kind: 'csv' });
    expect(table.headers[0]).toBe('Item Code');
    expect(table.rows).toHaveLength(3);
    expect(table.rows[0][1]).toBe('Oil Seal, Front');
    expect(table.rows[0][5]).toBe('1.250,50');
    expect(table.rows[2][1]).toBe('Hose "Radiator"');
  });

  it('keeps short rows padded instead of shifting columns', () => {
    const table = parseDelimitedBytes(encode('A,B,C\n1,2\n'), { fileName: 'x.csv', kind: 'csv' });
    expect(table.rows[0]).toEqual(['1', '2', '']);
  });
});

describe('Excel reader', () => {
  it('reads shared strings, numbers and every sheet of a real workbook', async () => {
    const { sheets, sheetNames } = await parseXlsx(fixture('inventory.xlsx'), 'inventory.xlsx');
    expect(sheetNames).toEqual(['Inventory', 'Notes']);
    expect(sheets).toHaveLength(2);
    const inventory = sheets[0];
    expect(inventory.headers).toEqual([
      'Item Code', 'Description', 'Brand', 'Category', 'Sub Category', 'UOM',
      'Cost Price', 'Selling Price', 'Opening Stock', 'Barcode', 'Tax %', 'Reorder Level'
    ]);
    expect(inventory.rows).toHaveLength(5);
    expect(inventory.rows[0][0]).toBe('FLT-001');
    expect(inventory.rows[0][6]).toBe('280');
    expect(inventory.rows[2][9]).toBe('');
  });
});

describe('PDF layout', () => {
  const page = (runs: { str: string; x: number; y: number }[]): PdfPageData => ({
    index: 1,
    width: 595,
    height: 842,
    runs: runs.map((r) => ({ ...r, w: r.str.length * 4.6, h: 9 }))
  });

  it('groups runs into lines and splits columns at wide gaps', () => {
    const lines = buildLines(page([
      { str: 'Code', x: 40, y: 700 }, { str: 'Name', x: 120, y: 700 }, { str: 'Qty', x: 300, y: 700 },
      { str: 'A-1', x: 40, y: 680 }, { str: 'Brake Pad', x: 120, y: 680 }, { str: '7', x: 300, y: 680 }
    ]));
    expect(lines).toHaveLength(2);
    expect(lines[0].cells.map((c) => c.text)).toEqual(['Code', 'Name', 'Qty']);
    expect(lines[1].cells.map((c) => c.text)).toEqual(['A-1', 'Brake Pad', '7']);
  });

  it('splits fixed-width text that uses runs of spaces', () => {
    const lines = buildLines(page([{ str: 'A-1    Brake Pad    7', x: 40, y: 700 }]));
    expect(lines[0].cells.map((c) => c.text)).toEqual(['A-1', 'Brake Pad', '7']);
  });

  it('detects a header and assigns cells by position, not by arrival order', () => {
    const lines = buildLines(page([
      { str: 'Code', x: 40, y: 700 }, { str: 'Item Name', x: 120, y: 700 }, { str: 'Price', x: 400, y: 700 },
      { str: 'A-1', x: 40, y: 680 }, { str: 'Brake Pad', x: 120, y: 680 }, { str: '990', x: 400, y: 680 },
      { str: 'A-2', x: 40, y: 660 }, { str: 'No price here', x: 120, y: 660 }
    ]));
    expect(detectHeaderLine(lines)?.index).toBe(0);
    const table = tableFromPages([page([
      { str: 'Code', x: 40, y: 700 }, { str: 'Item Name', x: 120, y: 700 }, { str: 'Price', x: 400, y: 700 },
      { str: 'A-1', x: 40, y: 680 }, { str: 'Brake Pad', x: 120, y: 680 }, { str: '990', x: 400, y: 680 },
      { str: 'A-2', x: 40, y: 660 }, { str: 'No price here', x: 120, y: 660 }
    ])]);
    expect(table.headers).toEqual(['Code', 'Item Name', 'Price']);
    expect(table.rows).toEqual([['A-1', 'Brake Pad', '990'], ['A-2', 'No price here', '']]);
  });
});

describe('PDF extraction (pdf.js, real file)', () => {
  it('reads every page of a multi-page price list and skips repeated headers, footers and totals', async () => {
    const { table, pageCount } = await pdfToTable(fixture('parts-list.pdf'), 'parts-list.pdf');
    expect(pageCount).toBe(3);
    expect(table.headerFound).toBe(true);
    expect(table.headers).toEqual(['Code', 'Item Name', 'Brand', 'Category', 'Qty', 'Cost', 'Price']);
    expect(table.rows).toHaveLength(24);
    expect(table.rows[0]).toEqual(['BP-1001', 'Brake Pad Set Front', 'Bosch', 'Brakes', '24', '1250.00', '1890.00']);
    expect(table.rows[23]).toEqual(['RM-1401', 'Rear View Mirror', 'Suzuki', 'Body', '7', '1450.00', '2100.00']);
    expect(table.stats?.repeatedHeaders).toBeGreaterThanOrEqual(2);
    expect(table.stats?.skippedLines).toBeGreaterThanOrEqual(3);
    // No page title, page number or total row leaked into the data.
    expect(table.rows.some((r) => /page \d/i.test(r.join(' ')))).toBe(false);
    expect(table.rows.some((r) => /^total$/i.test(r[0]))).toBe(false);
  });

  it('refuses a PDF with no text layer instead of importing nothing silently', async () => {
    await expect(pdfToTable(fixture('scanned.pdf'), 'scanned.pdf')).rejects.toThrow(/no text layer/i);
  });
});

describe('file type routing', () => {
  it('detects the format from magic bytes, not the extension', async () => {
    const csvNamedPdf = await parseInventoryFile('misleading.pdf', encode('SKU,Name,Price\nA-1,Filter,100\n'));
    expect(csvNamedPdf.kind).toBe('csv');
    expect(csvNamedPdf.tables[0].rows).toEqual([['A-1', 'Filter', '100']]);
  });

  it('explains legacy .xls instead of failing inside the zip reader', async () => {
    const ole = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0]);
    await expect(parseInventoryFile('old.xls', ole)).rejects.toThrow(/Legacy \.xls/i);
  });

  it('rejects an empty file', async () => {
    await expect(parseInventoryFile('empty.csv', new Uint8Array())).rejects.toThrow(/empty/i);
  });

  it('produces a stable fingerprint for identical bytes', async () => {
    const a = await parseInventoryFile('a.csv', encode('SKU,Name\nA-1,Filter\n'));
    const b = await parseInventoryFile('b.csv', encode('SKU,Name\nA-1,Filter\n'));
    expect(a.fingerprint).toBe(b.fingerprint);
    expect(a.fingerprint).toMatch(/^(sha256|fnv1a)-/);
  });
});

describe('header mapping', () => {
  it('maps common supplier columns and keeps price and cost apart', () => {
    const { mapping } = mapHeaders([
      'Item Code', 'Description', 'Brand', 'Category', 'UOM', 'Cost Price', 'Selling Price', 'Opening Stock'
    ]);
    expect(mapping[0]).toBe('sku');
    expect(mapping[1]).toBe('name');
    expect(mapping[2]).toBe('brand');
    expect(mapping[3]).toBe('category');
    expect(mapping[4]).toBe('unit');
    expect(mapping[5]).toBe('cost');
    expect(mapping[6]).toBe('price');
    expect(mapping[7]).toBe('qty');
  });

  it('does not map the same field twice', () => {
    const { mapping, duplicateFields } = mapHeaders(['SKU', 'Item Code', 'Name']);
    expect(Object.values(mapping).filter((v) => v === 'sku')).toHaveLength(1);
    expect(duplicateFields).toContain('sku');
  });

  it('leaves genuinely unknown columns unmapped', () => {
    const { mapping, unmapped } = mapHeaders(['SKU', 'Name', 'Warehouse Bay Temperature']);
    expect(mapping[2]).toBeNull();
    expect(unmapped).toContain('Warehouse Bay Temperature');
  });
});
