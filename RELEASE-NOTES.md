# Servixa — Auto Workshop POS · release notes

**Product:** Servixa Auto Workshop Management POS
**Version:** 1.1.2
**Release date:** 26 October 2026
**Architecture:** static React + TypeScript + Vite PWA, IndexedDB, no backend, no database server, no sync

---

## Version 1.1.2

### New — complete data export and restore

- **Settings → Data management → Export all data (.zip)** writes every application-owned record as one CSV
  per entity, plus `manifest.json` (files, columns, row counts, relationships) and uploaded artwork in
  `assets/`. Nested collections are exported as separate files keyed by parent id, so invoice lines, purchase
  lines, job-card lines, job history, return lines and warranty claims keep their foreign keys.
- **Restore reads that ZIP back**, validates columns and references, previews a per-entity plan (add /
  already present / conflicting key) and then writes in a single transaction.
  - **Merge** adds only records whose id and business key (SKU, invoice number, customer code …) are missing.
    It never overwrites, never deletes and never changes stock on existing rows. Merging the same archive
    twice adds nothing.
  - **Clean install** replaces the workspace, its settings and its accounts; the administrator you choose gets
    a new password and every other account is restored disabled.
- Safety properties: UTF-8 with BOM, RFC 4180 quoting, integer paisa, millisecond timestamps, formula-injection
  guard on text cells, no credentials in any file, whole-restore rollback on failure.

### Changed — interface

- **Dashboard**: the stock-photo banner and slogan are gone. The summary strip now carries only the greeting,
  the month's invoice and job counts, and the two primary actions. Owners can still upload their own
  dashboard artwork in Settings → Appearance, and nothing is shown when they have not.
- **Inventory and Parts** lists are paginated (50 rows). At 2,000 parts the page renders in 0.66 s and shows a
  single page of rows instead of the whole catalogue.
- **Settings → Data management** is four cards instead of six: backup file + full export, local storage,
  one restore card that accepts both formats, and a compact maintenance card. Save/reset moved into that card.
- **POS**: removed the developer note under the charge button and shortened the page subtitle.
- **Login**: removed a duplicated Help/Privacy row and a duplicate version badge; one footer line remains.
- Version strings come from a single constant (`APP_VERSION`), now 1.1.2.

### Verified

`npx tsc --noEmit` clean · `npx vitest run` **11 files / 125 tests** (16 new for the archive) ·
`npm run build` success, 82 precache entries / 1,657 KiB. Browser suites: archive export→restore 22 checks,
module audit 16 checks, bulk-import E2E 27 checks, regression 24 checks, scale 2,000 parts. Numbers and
scope in `docs/TEST-REPORT.md`.

### Known limitations (unchanged, deliberate)

No OCR for scanned PDFs, no camera barcode scanning, no sync of any kind, Chromium-only verification, local
sign-in is not server-grade security, physical printer output not tested.

---

## Version 1.1.0 — bulk inventory import

A supplier price list can now be imported instead of typed. New page: **Inventory → Bulk import**
(Parts header too), guarded by the existing `inventory.manage` permission.

- **PDF (text layer)** through pdf.js, loaded lazily on first use and cached afterwards. Columns are
  reconstructed from the header row's x-positions, so a short or blank cell does not shift the rest of the
  line. Multi-page documents, repeated headers, page footers and "Total" lines are handled.
- **CSV / TSV / TXT** with a hand-written RFC 4180 reader: quoted commas, embedded newlines, BOM, and
  delimiter sniffing for comma, semicolon, tab and pipe.
- **Excel .xlsx** with a hand-written ZIP + XML reader (uses the browser's own `DecompressionStream`), all
  sheets, shared strings, inline strings and numeric cells. Legacy `.xls` gets a clear "save as .xlsx" message.
- **Mapping → review → confirm.** Auto-mapping is a synonym table, fully editable. The review table is
  paginated (50 rows), searchable, filterable, and every cell is editable; rows can be removed and restored;
  the confirm dialog states exactly how many rows will be added, updated or skipped.
- **Duplicates** matched by barcode → SKU → part number → name+category+brand, each with an explicit choice:
  skip, create anyway, or update the existing item. An update never changes stock on hand. A row that becomes
  a duplicate while the user is reviewing is skipped inside the transaction, not merged.
- **Repeat-import protection** by SHA-256 file fingerprint (FNV-1a fallback outside a secure context): a banner
  names the previous import of the same bytes, and every row is still matched normally.
- **Safe writes**: chunks of 200 rows, one strict transaction per chunk, per-row outcomes, a single audit entry
  per import, an import-history record in the local `meta` store (metadata only, never the file).
- **Cancellation** at any point before confirming leaves the database untouched. A second concurrent commit is
  refused.
- **Barcodes**: the importer fills barcodes; the catalogue now refuses assigning one barcode to two parts, and
  pressing <kbd>Enter</kbd> in the inventory search opens the matched part's movement history for scanner use.

Data model additions (all optional, backward compatible): `Part.subcategory`, `Part.description`, and the
`part.import` audit action. Existing records are untouched; no migration is required.

### Not included, deliberately

- **OCR for scanned PDFs.** It needs a large download and misfires on price/quantity columns. Such files are
  refused with an explanation instead of producing a half-correct import.
- **Camera barcode scanning.** It would add a decoder library and a camera permission to an app that needs
  neither; USB scanners already work because they type into a focused field.

### Fixes found while building the importer

- **Clear business data** could leave its confirmation dialog open: the sequence reset read the `sequences`
  store through a second transaction, which let the write transaction commit and the reset then throw. It now
  reads inside the same transaction, so clearing finishes cleanly.
- The service worker no longer precaches the PDF engine. It is fetched on first use and cached by a
  `CacheFirst` rule, keeping the first visit at ~1.6 MB precache instead of ~2.7 MB.

### Verification (v1.1.0 build)

See `docs/TEST-REPORT.md` §9 for the numbers. In summary: typecheck clean, **10 test files / 109 tests**,
production build green, bulk-import E2E 27 checks, regression pass over the existing workflows 24 checks,
2,000-row CSV and 2,000-row/200-page PDF imports measured end to end in the browser.

---

## Appendix — original v1.1.0 release notes (previous build, kept as history)

### Original v1.1.0 notes

**Product:** Servixa Auto Workshop Management POS
**Version (historical):** 1.1.0
**Release date (historical):** 22 October 2026
**Architecture:** static React + TypeScript + Vite PWA, IndexedDB, no backend, no database server, no sync

---

### Original build — what it is

A complete, working workshop POS: 21 modules, real transactions, integer-paisa money, offline-first
storage in the browser, exact thermal/A4 print output, versioned backup and restore.

It is a **single-device application by design**. Records live in the browser's IndexedDB on the machine that
created them. Moving a workshop to another machine is done with the backup file, not with a server.

### Interrupted-work recovery

The previous implementation pass ended mid-verification of an optional PostgreSQL sync service. That work was
removed in this release, deliberately:

| Removed | Reason |
| --- | --- |
| `src/lib/sync.ts`, `src/hooks/useSync.ts`, `SyncBadge`, `SyncSettings` | Synchronization is out of scope for this release |
| Change-capture hooks in `src/lib/db.ts` | Only existed to feed the sync queue |
| `api/workshops.ts`, `api/sync/push.ts`, `api/sync/pull.ts`, `api/_lib/*` | New backend surface, explicitly not wanted |
| `db/migrations`, `scripts/migrate.mjs`, `scripts/sync-dev-server.mjs`, `scripts/test-sync-api.mjs` | Server tooling |
| `pg`, `@types/pg`, `@types/node` dependencies | No server to run them |
| Sync tab in Settings, sync badge in the top bar, auto-sync effect | No engine to drive them |

What replaced them is the honest boundary that existed before: `GET /api/sync` answers `200 {available:false}`,
`POST /api/sync` answers `501 SYNC_NOT_AVAILABLE` with `accepted: 0`, and `GET /api/health` reports
`mode: "local-only"`. Nothing ever claims a record left the browser.

Everything else from the v1.1.0 line is intact; the full acceptance suite was re-run after the removal (see
`docs/TEST-REPORT.md`).

### Printing

Receipts and documents print through the browser dialog, but the sheet is fully controlled by CSS:

- `@page` sizes: A4 with 12 mm margins; thermal-80 (80 mm, 3 mm margins); thermal-58 (58 mm, 2 mm margins).
- Print media hides the app shell, sidebar, dialogs and toasts, so only the document reaches the sheet.
- `html, body, #root` are reset to `height:auto` in print, which removes the blank first page that a
  full-height app shell produces.
- Refunds print signed and labelled ("Cash refund · INV-000024 · −Rs. 11,500.00"); a receipt can no longer
  appear to have been paid twice its value.
- 58 mm receipts use a compact table (rate folded under the item name) so money columns never collide.
- Long orders paginate; line rows avoid page breaks.

Verified by generating real PDFs in Chromium: 80 mm → **1 page, 80.1 × 279.4 mm**; 58 mm → **1 page,
58.3 × 279.4 mm**; A4 → **1 page, 210.2 × 297.3 mm**. Physical printer output is not verified — see
`docs/PRINTER-SETUP.md`.

### Modules

Dashboard · POS Billing · Job Cards · Invoices · Cash Shifts · Customers · Vehicles · Inventory · Parts ·
Services · Labor · Purchases · Suppliers · Returns · Warranty · Expenses · Mechanics & Staff · Reports ·
Analytics · Users & Roles · Settings, plus the administrator profile drawer.

Every screen reads and writes the same IndexedDB stores through the same transaction layer; there is no mock
data in the shipped app (the optional sample workshop is clearly labelled and only loadable into an empty
workspace).

### Changes in the original build

- Removed the entire backend/sync layer described above; restored the documented 501 boundary.
- Print: refund amounts signed on receipts and A4 invoices; app shell suppressed in print media; page height
  reset (blank-page fix); 58 mm compact item table; refund references shortened.
- Keyboard: `Ctrl/Cmd+N` now creates a record in the current module (sale, job card, purchase, user) and
  restarts a sale on POS even when POS is already open.
- Job cards: converting a job to an invoice now names the invoice in the confirmation and opens it.
- Branding: the workspace is white-labelled. The sidebar, login panel, setup artwork, Help/Privacy header and
  their footers show the workshop's own name; business documents carry the owner's name, address and phone only.
  The product name appears exactly once inside the app, in Settings → Data management
  ("Servixa — Auto Workshop POS · Version 1.1.0").
- IndexedDB schema v2: the unused `syncQueue` object store is gone. It was written by an earlier build but
  never read; it is dropped during the upgrade, and every business store is carried over untouched.
- Removed the top-bar Online/Offline pill and the sidebar connection dot. In a local-only build they implied a
  service that does not exist; the sidebar now says only "Saved in this browser" beside the version.
- Setup: the two password fields share one "Show passwords" / "Hide passwords" control (aria-pressed), instead
  of two independent eye buttons. Login keeps its single toggle.
- Policy and help copy now says "this application" rather than repeating the vendor name in body text.
- Removed a leftover `console.error('DEMO_FAIL', …)` debug statement.
- Docs: README sync/deployment sections rewritten for the local-only architecture.

### Known limitations (original build)

- **Single device.** No sync, no server, no shared data between browsers or machines.
- **Browser storage is the database.** Clearing site data deletes the workshop; browsers may evict IndexedDB
  under storage pressure. Export backups regularly (Settings → Data management).
- **Local authentication is not server-grade.** PBKDF2-derived hashes with per-user salts in IndexedDB; anyone
  with access to the OS profile and devtools can read the database. Backups exclude password hashes.
- **No physical printer verification.** Output was verified as PDF geometry in Chromium, not on hardware.
- **No 24-hour soak test.** See `docs/TEST-REPORT.md` for exactly what was run and for how long.

### Installing

```bash
npm ci
npm run build        # production bundle in dist/
npm run preview      # serve dist/
```

Deploy `dist/` to any static host, or use the included `vercel.json`. No environment variables are required.
