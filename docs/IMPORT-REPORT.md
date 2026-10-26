# Bulk inventory import — implementation report

**Feature:** Inventory → Bulk import (also linked from Parts)
**Version:** 1.1.2 · **Date:** 26 October 2026
**Scope:** one new page, one new library module and small additions to the existing parts repository. No new
backend, no external service, no new runtime dependency.

---

## 1. Supported formats

| Priority | Format | Reader | Limits and behaviour |
| --- | --- | --- | --- |
| 1 | **PDF with a text layer** | `pdfjs-dist@5.4.149`, legacy build, loaded lazily as its own chunk when the first PDF is chosen | 250 pages, 25 MB per file. Multi-page lists, repeated headers per page, footers/“Page n of m”, totals rows. Columns are assigned from header x-positions, so an empty cell never shifts the row. |
| 2 | **CSV / TSV / TXT** | hand-written RFC 4180 reader (`csv.ts`, `text.ts`) | 10,000 rows. Delimiter sniffing for comma, semicolon, tab and pipe; quoted commas, quoted newlines, UTF-8 BOM, `1.250,50` and `1,250.50` decimals. |
| 3 | **Excel .xlsx** | hand-written ZIP + SpreadsheetML reader (`zip.ts`, `xml.ts`, `xlsx.ts`) using the browser's `DecompressionStream` | Every non-empty sheet is read; shared strings, inline strings and numeric cells. 25 MB / 10,000 rows. |
| — | `.xls`, `.doc`, images, scanned PDFs | refused with a specific message | No macro, script or embedded object is ever evaluated: the file is treated as bytes only. |

Barcode is a normal column; a part number can stand in for a SKU when a list has no code column.

## 2. Workflow (as shipped)

**Upload → Map columns → Review → Confirm → Result.** The database is not touched before the confirm dialog is
accepted; the only write path is `apply.ts → writeChunk()`, called after that click.

- **Upload** — drag-drop or picker, several files at once, per-file progress, size/type/row guards, import history
  (file name, time, counts, status, fingerprint — never the file).
- **Map columns** — deterministic synonym matching, editable, with a warning when a sheet has no identifying
  column; such a sheet is skipped rather than imported as blank rows.
- **Review** — searchable, filterable (all / ready / duplicate / attention), 50 rows per page, every cell editable,
  per-row detail editor, select/deselect, remove and **restore removed**, duplicate actions per row
  (skip / create anyway / update existing), category panel listing unmatched category names with counts.
- **Confirm** — summary of add / update / skip / attention, plus a warning when the same file fingerprint was
  imported before.
- **Result** — added, updated, skipped, failed; a downloadable CSV of rows that were not imported; a link back to
  inventory.

## 3. Extraction limitations (deliberate)

1. **No OCR.** Scanned/image-only PDFs are refused with an explanation. OCR would mean a large extra download and
   would guess at prices and quantities, which contradicts “never fabricate”.
2. **PDF layout must have a header row.** Documents with no header, or with columns that overlap after whitespace
   normalisation, produce a warning and rows for review rather than silent guesses.
3. **Legacy formats are not parsed** (.xls binary, .doc). The UI tells the user to save as .xlsx or CSV.
4. **No header-less files.** A file whose first row is data cannot be mapped and is reported as such.
5. **Numbers are not repaired.** `12.5x` stays an error and is flagged; it is not rounded to 12 or 0.
6. **Category creation is bounded.** Unmatched categories are listed with counts and must be accepted or
   redirected; nothing creates hundreds of near-duplicates, and no taxonomy is invented.
7. **Import history is metadata only.** Source documents are not stored anywhere after parsing.

## 4. Files

**New — library (15 files, 2,275 lines):** `src/lib/import/`
`types.ts` (field keys, limits, draft model) · `text.ts` · `csv.ts` · `zip.ts` · `xml.ts` · `xlsx.ts` · `pdf.ts`
(lazy pdf.js, `isEvalSupported: false`) · `layout.ts` (PDF geometry, repeated headers, footer/total detection) ·
`mapping.ts` (aliases, scoring, category suggestion) · `values.ts` (numbers, UoM, quantities) · `validate.ts`
(required fields, duplicate resolution order) · `pipeline.ts` (orchestration, drafts, summaries) ·
`apply.ts` (prepare/commit, chunking, lock) · `fingerprint.ts` · `history.ts`.

**New — UI:** `src/pages/ImportItems.tsx` (four-phase page, 1,040 lines).

**New — tests and fixtures:** `import-parse.test.ts` (17), `import-validate.test.ts` (18), `import-apply.test.ts`
(9), `barcode.test.ts` (5); `fixtures/parts-list.pdf`, `scanned.pdf`, `inventory.xlsx`, `inventory-semicolon.csv`,
`inventory-plain.csv`, `make_fixtures.py` (synthetic generator, no real business data).

**Changed:**

| File | Change |
| --- | --- |
| `src/App.tsx` | lazy route `/inventory/import` behind `inventory.manage` |
| `src/pages/Inventory.tsx` | “Bulk import” action; Enter in search opens a single exact SKU/barcode match |
| `src/pages/Parts.tsx` | “Bulk import” action; scanner hint under the barcode field |
| `src/lib/repo.ts` | `createPart` persists `subcategory` + `description` and enforces unique barcodes; `updatePart` rejects a barcode owned by another part |
| `src/lib/demo.ts` | fixed the sequence reset in “Clear business data” (read through the open transaction) |
| `src/styles/pages.css` | import page layout, cell editor widths |
| `vite.config.ts` | `pdf-engine` manual chunk; PDF engine and worker excluded from precache, `CacheFirst` at runtime |
| `src/components/Shell.tsx`, `AuthShell.tsx` | version badge reads `APP_VERSION` instead of a hard-coded string |
| `src/pages/Help.tsx` | new “Bulk inventory import” section, renumbered guide |
| `README.md`, `RELEASE-NOTES.md`, `docs/TEST-REPORT.md` | feature documentation and results |

## 5. Tests actually run

| What | Result |
| --- | --- |
| `npx tsc --noEmit` | clean |
| `npx vitest run` | **10 files, 109 tests passed** (49 of them import-specific) |
| `npm run build` | success, 81 precache entries, 1,624 KiB |
| Browser E2E, import (`/tmp/imp_deep.py`) | 27/27 checks — semicolon CSV, European decimals, quoted commas, XLSX multi-sheet, scanned-PDF refusal, duplicates, update-without-stock, cancel, repeat-import banner, permission enforcement, no console errors |
| Browser E2E, import smoke (`/tmp/imp_smoke.py`) | 24 rows → 24 parts, restore-removed works, no console errors |
| Browser E2E, scale (`/tmp/imp_scale.py`) | 2,000-row CSV and 2,000-row / 200-page PDF → 4,000 parts; extract 0.1 s / 1.7 s, review 0.1 s / 0.2 s, commit 2.4 s / 1.8 s; no console errors |
| Regression (`/tmp/regress.py`) | 24/24 — setup, part create, POS sale `INV-000001` with stock 50 → 49, print geometry A4 210.2 mm and 80 mm 80.1 mm, customer/vehicle/job card, backup export, clear → restore, reports, offline reload |
| Physical printer | **not tested** — automated checks are PDF page geometry only |

## 6. Manual setup needed

None. No migration, no configuration, no account, no key.

- Existing installations open the new page directly; `IndexedDB` stays at version 2 with the same 22 stores.
- `Part.subcategory` and `Part.description` are optional; records without them keep working.
- The PDF engine (≈460 KB, 139 KB gzip) downloads the first time a PDF is chosen and is cached for offline use
  afterwards. CSV and Excel need no download.
- Permissions: the page is gated by `inventory.manage`, editable per role in **Users & roles**.

## 7. Known limitations

Single-device local storage; local sign-in is not server-grade security; Chromium-only verification; no OCR; no
camera scanning; no sync of any kind (backups are the only way to move data between devices).
