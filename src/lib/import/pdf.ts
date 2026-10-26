/**
 * PDF text extraction (text-layer PDFs).
 *
 * pdf.js is loaded lazily the first time a PDF is selected, so the engine's
 * ~1.7 MB never touches the initial page load. The same legacy build is used
 * by the browser and by the unit tests, which keeps one code path verified.
 *
 * Safety: `isEvalSupported: false` (embedded JS in a PDF is never executed),
 * fonts are never rendered, and pages are released after each read.
 */
import { pdfLayoutToTable, type PdfPageData } from './layout';
import { ImportError, MAX_PDF_PAGES, type SourceTable } from './types';

type PdfJsModule = typeof import('pdfjs-dist/legacy/build/pdf.mjs');

let pdfjsPromise: Promise<PdfJsModule> | null = null;
let workerReady = false;

async function loadPdfJs(): Promise<PdfJsModule> {
  if (!pdfjsPromise) {
    pdfjsPromise = import('pdfjs-dist/legacy/build/pdf.mjs').catch((err) => {
      pdfjsPromise = null;
      throw new ImportError(`The PDF engine could not be loaded: ${err instanceof Error ? err.message : String(err)}`);
    });
  }
  const pdfjs = await pdfjsPromise;
  if (!workerReady && typeof window !== 'undefined') {
    workerReady = true;
    try {
      // Vite emits the worker as its own asset; only the URL is bundled here.
      const worker = await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url');
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
    } catch {
      // Without a worker pdf.js falls back to running on the main thread.
    }
  }
  return pdfjs;
}

export interface PdfReadOptions {
  maxPages?: number;
  onProgress?: (done: number, total: number) => void;
  signal?: { aborted: boolean };
}

export interface PdfReadResult {
  pages: PdfPageData[];
  pageCount: number;
  emptyPages: number[];
  truncated: boolean;
}

export async function readPdfPages(bytes: Uint8Array, options: PdfReadOptions = {}): Promise<PdfReadResult> {
  const pdfjs = await loadPdfJs();
  const maxPages = options.maxPages ?? MAX_PDF_PAGES;
  // pdf.js takes ownership of the buffer it is given; hand it a copy so the
  // caller can still hash the original bytes.
  const data = new Uint8Array(bytes);

  let doc: Awaited<ReturnType<PdfJsModule['getDocument']>['promise']> | null = null;
  try {
    doc = await pdfjs.getDocument({
      data,
      isEvalSupported: false,
      useSystemFonts: false,
      disableFontFace: true,
      stopAtErrors: false,
      verbosity: 0
    }).promise;
  } catch (err) {
    const name = (err as { name?: string })?.name ?? '';
    if (name === 'PasswordException') {
      throw new ImportError('This PDF is password-protected. Open it, remove the password, and try again.');
    }
    if (name === 'InvalidPDFException') {
      throw new ImportError('This file is not a readable PDF. If it is a scan, export the inventory as CSV instead.');
    }
    throw new ImportError(`The PDF could not be opened: ${err instanceof Error ? err.message : String(err)}`);
  }

  const pageCount = doc.numPages;
  const total = Math.min(pageCount, maxPages);
  const pages: PdfPageData[] = [];
  const emptyPages: number[] = [];

  try {
    for (let i = 1; i <= total; i++) {
      if (options.signal?.aborted) throw new ImportError('Extraction cancelled.');
      const page = await doc.getPage(i);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      const runs = content.items
        .filter((item): item is Extract<typeof item, { str: string }> => 'str' in item && item.str !== '')
        .map((item) => {
          const [a, b, c, d, e, f] = item.transform as number[];
          const width = item.width || 0;
          const height = Math.abs(d || b || 0) || item.height || 9;
          return { str: item.str, x: e, y: f, w: width, h: height };
        });
      if (!runs.length) emptyPages.push(i);
      pages.push({ index: i, width: viewport.width, height: viewport.height, runs });
      page.cleanup();
      options.onProgress?.(i, total);
      // Yield so the UI can paint progress on long documents.
      if (i % 5 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
    }
  } finally {
    await doc.destroy().catch(() => undefined);
  }

  return { pages, pageCount, emptyPages, truncated: pageCount > total };
}

export interface PdfTableResult {
  table: SourceTable;
  pageCount: number;
  scanned: boolean;
}

/** Full PDF path: bytes → positioned runs → table → SourceTable. */
export async function pdfToTable(bytes: Uint8Array, fileName: string, options: PdfReadOptions = {}): Promise<PdfTableResult> {
  const { pages, pageCount, emptyPages, truncated } = await readPdfPages(bytes, options);
  const withText = pages.filter((p) => p.runs.length > 0);

  if (!withText.length) {
    throw new ImportError(
      'This PDF has no text layer, so it is almost certainly a scan or a photograph. ' +
      'Optical character recognition is not bundled (it would add a large download and is unreliable for price columns). ' +
      'Ask the supplier for a CSV/Excel export, or type the items in — nothing is imported from an unreadable file.'
    );
  }

  const table = pdfLayoutToTable(withText, fileName);
  if (truncated) table.notes.push(`Only the first ${options.maxPages ?? MAX_PDF_PAGES} pages were read.`);
  if (emptyPages.length && withText.length) {
    table.notes.push(`${emptyPages.length} page${emptyPages.length === 1 ? '' : 's'} contained no text and ${emptyPages.length === 1 ? 'was' : 'were'} skipped.`);
  }
  return { table, pageCount, scanned: false };
}
