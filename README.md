# Servixa — Auto Workshop Management POS

**Version 1.1.2** · Offline-first workshop management: POS billing, job cards, inventory, purchasing,
returns, warranty, cash shifts, staff and reporting.

Servixa runs entirely in the browser. Every record is stored in **IndexedDB on this device**; there is no
account to create on a server, no telemetry, and no data leaves the machine unless you export a backup.

---

## 1. What it does

| Module | Capability |
| --- | --- |
| **Dashboard** | Today/month totals, sales line chart, service donut, monthly bars, recent jobs/invoices, audit feed, low-stock strip |
| **POS Billing** | Scan/search items, split payments (cash/card/bank/online), change, partial payment, idempotent checkout |
| **Job Cards** | Draft → awaiting approval → approved → in progress / on hold → ready → completed, mechanic assignment, conversion to invoice |
| **Invoices** | Filters, date range, payment recording, void, CSV export, A4/80 mm/58 mm print |
| **Cash Shifts** | Opening float, cash in/out, expenses, expected vs counted drawer, closing variance |
| **Customers / Vehicles** | Owners, balances, vehicle history, warranty and invoice drill-down |
| **Inventory / Parts / Services / Labor** | Stock ledger, reorder levels, adjustments with reasons, price lists, **bulk import** from PDF/CSV/Excel |
| **Purchases / Suppliers** | Purchase orders; stock increases **only** when received; supplier balances |
| **Returns** | Line-level returns, per-line restock choice, refund by cash/card/bank/credit, balance correction |
| **Warranty** | Registration against invoice lines, claims, expiry alerts |
| **Expenses** | Categorised, dated, approve workflow, shift-linked cash expenses |
| **Mechanics & Staff** | Staff records, mechanic assignment, workload |
| **Reports / Analytics** | P&L, sales register, expense/purchase/return registers, revenue trend, payment mix, mechanic performance |
| **Users & Roles** | Five roles with granular permissions, per-role matrix editing |
| **Settings** | Business profile, documents & prefixes, appearance (logo/login artwork), security, notifications, data management: JSON backup, full CSV archive, restore & merge |

Keyboard: `Ctrl/Cmd+K` global search · `Ctrl/Cmd+N` new record in the current module (POS sale by default) ·
`Ctrl/Cmd+P` print · `Esc` close · `Alt+1/2/3` Dashboard / POS / Job cards.

---

## 2. Quick start

```bash
npm ci
npm run dev        # http://localhost:5173
```

First run opens the illustrated setup screen: workshop name, owner account, currency and (optionally)
branding. The owner account is always an administrator and cannot be disabled.

```bash
npm run typecheck  # tsc --noEmit
npm test           # vitest (60 tests over money, sales, jobs, returns, shifts, backup, auth)
npm run build      # type-check + production bundle + PWA service worker
npm run preview    # serve dist/ locally
```

### Windows

Requirements: Node.js 20 LTS (or 18+) from nodejs.org. No database, no Docker, nothing else.

1. Extract the ZIP anywhere writable (for example `C:\Servixa`). Avoid running it from inside the ZIP.
2. Open **Command Prompt** or **PowerShell** in that folder.
3. `npm ci` — installs the exact versions from `package-lock.json`.
4. `npm run build` then `npm run preview` — opens the production build at <http://localhost:4173>.
   For day-to-day use `npm run dev` is also fine.
5. Open the address in Chrome or Edge and complete the one-time setup. You can install it as an app
   (address-bar install icon, or Edge → Apps → Install this site as an app) so it opens in its own window.

If PowerShell blocks `npm.ps1`, run `cmd` first or use `npm.cmd ci`. Data is stored per browser profile, so
always open the app in the same browser on the same Windows user account. To move to another machine use
**Settings → Data management → Download backup** and restore it there.

### Loading demo data

Settings → **Data management** → **Load sample data** builds a fictional workshop through the real
transaction pipeline (24 POS sales across five months, six job cards, purchases, a restocked return,
warranties, expenses). It is refused as soon as a real invoice or job card exists, so sample records can
never mix with live books.

### Bulk inventory import

**Inventory → Bulk import** (also on the Parts page) loads a supplier price list into the catalogue.

| Format | How it is read | Notes |
| --- | --- | --- |
| **PDF** (text layer) | pdf.js, lazily loaded (~460 KB gzip 139 KB), columns positioned from the header row | Multi-page, repeated headers, footers and totals are handled. **Scanned PDFs are refused** — OCR is not bundled. |
| **CSV / TSV / TXT** | Built-in RFC 4180 reader with delimiter sniffing (comma, semicolon, tab, pipe) | Handles quoted commas, embedded newlines, UTF-8 BOM and European decimals (`1.250,50`). |
| **Excel .xlsx** | Built-in ZIP + XML reader, every non-empty sheet | Legacy `.xls` is rejected with a “save as .xlsx/CSV” message. |

Flow: upload → **column mapping** (auto-detected, editable) → **review** (search, filter, edit any cell, per-row
duplicates, remove, restore) → **confirm** → report. Nothing is written before confirmation.

Rules the importer follows:

- Item name and SKU are required; a **part number is accepted as the SKU**. Optional fields stay empty when the
  file does not contain them — no invented prices, stock, categories or barcodes.
- Duplicates are matched barcode → SKU → part number → exact name+category+brand. Each duplicate can be skipped,
  created anyway, or explicitly updated (prices/descriptive fields only — **stock is never overwritten**).
- Rows are written in chunks of 200 inside one IndexedDB transaction each, re-checking conflicts inside the
  transaction. A failed row is reported, not silently dropped.
- Import history (file name, time, counts, fingerprint) is kept in the local `meta` store; source files are never stored.

Measured in this repository (Chromium, headless, this machine): 2,000-row CSV — extract 0.1 s, review 0.1 s,
commit 2.4 s; 2,000-row **200-page PDF** — extract 1.7 s, review 0.2 s, commit 1.8 s; the review table renders 50
rows per page regardless of file size. Numbers are indicative, not a guarantee.

---

## 3. Data, money and numbering

- **Money is integer paisa.** Rupees are only produced for display; no floating-point currency arithmetic
  is persisted. `formatMoney(…, { decimals: false })` rounds to whole units for headline figures.
- **Sequences are independent per document type:** `INV-000001`, `JC-0001`, `PO-0001`, `RTN-0001`,
  `SH-0001`, `WR-0001`, plus customer/supplier/payment series. Invoices always start at `000001`.
- **Formulas** (also shown in-app under Reports → Definitions):
  - `gross = Σ(qty × rate − line discount)`
  - `net = gross − invoice discount`
  - `total = net + tax`
  - `net revenue = net sales − returns`
  - `COGS = parts cost sold − cost of returned parts`
  - `gross profit = net revenue − COGS`
  - `operating result = gross profit − approved expenses`
  - `expected drawer = opening + cash sales − cash refunds − cash expenses + cash in − cash out`

  Sales figures are **revenue, not profit**; profit always subtracts parts cost and is labelled as such.
- **Stock rules:** a POS sale deducts immediately; an open job card does not touch stock; invoicing a job
  deducts exactly once (guarded by `job.invoiceId`); purchases add stock only on receipt; returns restock
  only the lines you mark for restock.
- Every mutating call carries an `opId`; retries and double-clicks return the original document instead of
  creating a duplicate.

---

## 4. Offline behaviour and limits

- The app is a PWA: after the first load the shell, fonts, artwork and chime are cached by a service
  worker, so billing keeps working with no network.
- **No background sync.** Records stay on the device until you export a backup. Two devices do not share
  data, and clearing site data deletes the workshop unless you have an export.
- Browsers may evict IndexedDB under storage pressure; use **Settings → Data → Download backup** regularly.
- Printing uses the browser dialog — in a PWA "Save as PDF" gives an archival copy. Each document declares
  its own `@page` size (A4 with 12 mm margins, 80 mm/58 mm thermal with 3/2 mm margins) and the app shell,
  sidebar and dialogs are suppressed, so only the document reaches the sheet.

---

## 5. Backups

`Settings → Data management` exports a single versioned JSON file containing business records, settings,
sequences and staff accounts **with passwords excluded**.

Restoring is validation-first: format marker, version, checksum (SHA-256), referential integrity and value
sanity are checked before anything is written. The restore itself runs in one IndexedDB transaction and
replaces the workspace atomically; it requires an administrator that exists inside the file **and a new
password** for that account, because credentials are not in the backup.

### Full data archive (CSV + manifest)

**Settings → Data management → Export all data (.zip)** writes every entity as its own CSV, plus
`manifest.json` (file list, columns, row counts, relationships) and any uploaded artwork under `assets/`.
Nested collections are separate files keyed by parent id — `invoice_lines.csv`, `purchase_lines.csv`,
`job_lines.csv`, `job_history.csv`, `return_lines.csv`, `warranty_claims.csv`.

| Aspect | Behaviour |
| --- | --- |
| Encoding | UTF-8 with a byte-order mark, CRLF rows, RFC 4180 quoting |
| Money / time | integer paisa; Unix milliseconds |
| Formula injection | text cells that start with `= + - @` are prefixed with `'`; numbers stay numeric |
| Secrets | password hashes, salts and lockout records are never written |
| Restore modes | **Merge** adds only missing IDs/business keys and never overwrites or deletes; **Clean install** replaces the workspace and issues a new administrator password |
| Preview | per-entity add / already-present / conflicting counts before anything is written |
| Failure | one transaction per restore; an error rolls the whole restore back |
| Measured | 2,000 parts: export 0.2 s (136 KiB), merge restore 0.9 s |

The JSON backup remains the quickest single-file transfer; the CSV archive is the one to open in a
spreadsheet or hand to an accountant. Neither format transfers browser state (installed app, notifications
permission) or the authentication secrets.

---

## 6. Security — honest scope

Accounts are local. Passwords are stored as **PBKDF2-SHA-256** hashes with a per-user random salt and
150,000 iterations, are never written to logs, and are stripped from backups and from every object that
reaches the UI. Failed sign-ins are audited, with an optional lockout.

This is **not** server-grade security. Anyone with access to the browser profile or the operating-system
account can read the database, and HTTPS cannot protect a local file store. Servixa v1.1.2 is designed for
a single workshop workstation; do not treat it as multi-tenant or tamper-proof.

---

## 7. `/api` is a refusal, not a service

There is **no backend, no database and no synchronization** in this release. The client keeps a `syncQueue`
store in IndexedDB that stays unused; nothing ever uploads it.

| Endpoint | Behaviour |
| --- | --- |
| `GET /api/health` | `200 { ok, mode: "local-only", syncConfigured: false }` |
| `GET /api/sync` | `200 { available: false, mode: "local-only", message }` |
| `POST /api/sync` | Always `501 SYNC_NOT_AVAILABLE`, `accepted: 0` — never acknowledges data |

The endpoints exist so a browser or monitor gets an honest answer instead of a 404. They must not be wired to
a queue that pretends records were stored remotely.

**Moving data between devices is done with backups**, not sync: *Settings → Data management → Download
backup* on the source device, then *Restore* on the target. See §5.

---

## 8. Deployment (Vercel)

`vercel.json` is included: Vite framework preset, SPA rewrites that leave `/api` alone, immutable caching for
`/assets`, no-cache for `sw.js`, and basic security headers.

```bash
npm i -g vercel
vercel            # preview
vercel --prod     # production
```

No environment variables are required, and none are read at runtime — the app is a static bundle. Because data
lives in the visitor's browser, two people opening the same deployed URL see two independent workshops; that
is a property of local-only storage, not a bug.

---

## 9. Project layout

```
src/
  lib/          money, ids, db (IndexedDB), repo (CRUD/rules), transactions (sales, jobs,
                purchases, returns, shifts, expenses), analytics, queries, backup, auth, sound
  state/        AppContext — session, settings, permissions, toasts, notifications
  components/   ui kit, charts, shell, POS billing, invoice detail, item picker, print templates
  pages/        21 modules + setup, login, help, privacy
  styles/       theme, ui, layout, pages, print  (Manrope + IBM Plex Mono, Lucide icons)
api/            health.ts, sync.ts  (Edge functions; honest 501 stub)
public/         artwork, icons, notification chime
```

### Browser support

Chromium, Firefox and Safari (desktop) plus Chromium-based Android and iOS Safari 16+. Requires IndexedDB,
WebCrypto and service workers; private windows may block storage.

---

## 10. Licence and attribution

Bundled fonts: Manrope and IBM Plex Mono (SIL Open Font License, via `@fontsource`). Icons: Lucide (ISC).
