# Servixa v1.1.2 — verification report

Everything below was executed in this environment against the build produced from this source tree. Nothing is
reported as passed unless it actually ran. Earlier 1.x results are kept in §10 for traceability.

Environment: Debian, Node 20.20.2, Chromium (headless via Playwright), 1500 × 1000 viewport,
`vite preview` serving `dist/` on port 4173.

---

## 0. Summary

| Check | Command | Result |
| --- | --- | --- |
| TypeScript | `npx tsc --noEmit` | clean, no errors |
| Unit / integration | `npx vitest run` | **11 files, 125 tests passed** |
| Production build | `npm run build` | success — 82 precache entries, 1,657 KiB (PDF engine excluded) |
| Data archive E2E | `/tmp/archive_e2e.py` | 22 checks passed (export → clear → clean restore → merge) |
| Module audit | `/tmp/audit2.py` | 16 checks passed (purchases, shifts, barcode, scanner, users, logout, permissions) |
| Bulk-import E2E | `/tmp/imp_deep.py` | 27 checks passed |
| Regression over existing modules | `/tmp/regress.py` | 24 checks passed |
| Scale, 2,000 parts | `/tmp/perf2.py`, `/tmp/merge_time.py` | import OK, inventory 50 rows in 0.66 s, export 0.2 s / 136 KiB, merge restore 0.9 s |

---

## 1. Unit and integration tests (vitest + fake-indexeddb)

125 tests in 11 files. The new file is `data-archive.test.ts` (16 tests):

| Test | What it proves |
| --- | --- |
| CSV writing | `=SUM()`, `+92…`, `-5` are guarded in text; `-5` as a number stays numeric; quotes/commas/newlines/Urdu text round-trip; BOM + CRLF |
| export | one CSV per entity + manifest with counts and relationships; unicode and embedded newlines survive; no `passwordHash`, `salt` or `iterations` anywhere in the ZIP bytes; every store present |
| clean restore | replaces the workspace, restores invoice totals, line items, payment → invoice links, part barcode and stock; refuses to run without an administrator password and leaves the database untouched |
| merge restore | same archive twice adds nothing; adds missing rows into an empty database; a same-SKU/different-id part is reported as a conflict and the local row (and its stock/price) is untouched; local settings and users survive |
| validation | a ZIP without a manifest is rejected; a missing required column blocks the restore; a failing write aborts the whole transaction and the previous data is still there |

Existing suites (109 tests) are unchanged and still pass: import parsing/validation/apply, barcode, money, stock,
numbering, permissions, backup, printing, dates.

## 2. Data archive end to end (`/tmp/archive_e2e.py`, real browser)

Fresh profile, real setup, records created through the UI, file chosen through the page's own input.

- Download produces a ZIP containing `manifest.json`, `parts.csv`, `customers.csv`, `invoices.csv`,
  `invoice_lines.csv`, `payments.csv`, `settings.csv`, `users.csv`, `stock_moves.csv`.
- The manifest carries the format marker and the correct part count.
- CSVs start with a UTF-8 BOM; a customer name with a comma, quotes and Urdu text (`Ali Raza, "Boss" — لاہور`)
  survives the export and reappears after restore.
- `users.csv` has no credential columns.
- Clear business data → clean restore → the part and the customer are back in the UI.
- Re-importing the same archive with **Merge** leaves exactly one part row (22/22 checks, no console errors).

## 3. Module audit (`/tmp/audit2.py`)

Purchases: supplier created, part selectable in the purchase form, draft saved, **Receive** adds stock (5 → 6).
Cash shift opens. Barcode: a part with barcode `1234567890123` is created, a second part with the same barcode is
**rejected by the form**; typing the barcode into the inventory search and pressing Enter opens that part.
Users: a cashier account is created and listed. Logout returns to `/login`; the cashier can sign in; `/users` and
`/inventory/import` show the permission-denied screen instead of the module. No console errors.

## 4. Scale and performance

| Operation | Result |
| --- | --- |
| Import 2,000-row CSV through the UI | completed, 2,000 parts, 2,000 stock movements |
| Inventory page at 2,000 parts | 50 rows rendered in **0.66 s** (was 2,000 rows in 1.47 s before pagination) |
| Search a part among 2,000 | 0.62 s |
| Export all data at 2,000 parts | 0.2 s, 136 KiB ZIP |
| Parse + merge restore of that archive | parse 0.3 s, merge 0.9 s, no duplicate rows |
| 2,000-row / 200-page PDF import (1.1.0 run, same code path) | extract 1.7 s, review 0.2 s, commit 2.3 s |

## 5. Bulk import, still green

`/tmp/imp_deep.py` — semicolon CSV with European decimals, quoted commas, multi-sheet XLSX, scanned-PDF
refusal, duplicate handling with update-without-stock, cancel leaves the database unchanged, repeat-import
warning, cashier blocked, no console errors (27/27).

`/tmp/regress.py` — setup, part create, POS sale `INV-000001` with stock 50 → 49, print geometry A4 210.2 mm and
80 mm 80.1 mm, customer/vehicle/job card, backup export, clear → restore, reports, offline reload (24/24).

## 6. Bugs found and fixed in this build

| Bug | Cause | Fix |
| --- | --- | --- |
| Inventory and Parts rendered the entire catalogue | Lists mapped every row with no pagination; 2,000 parts produced a 2,000-row DOM and a 1.47 s paint | 50-row pages with the existing `Pager`, page reset on search/filter change |
| Restore card only accepted JSON | The archive feature did not exist | One restore card now accepts `.json` and `.zip`, with a per-entity preview and merge/clean modes |

Bugs fixed in the previous build and still covered by tests: "Clear business data" never completed (second
transaction inside `mutate()`), and `createPart` dropping `description`/`subcategory`.

## 7. Artifact verification (clean extraction of the delivered archive)

The archive was extracted into an empty directory and checked from scratch:

| Step | Command | Result |
| --- | --- | --- |
| Install | `npm ci` | 394 packages, no errors |
| TypeScript | `npx tsc --noEmit` | clean |
| Unit / integration | `npx vitest run` | 11 files, 125 tests passed |
| Build | `npm run build` | success — 82 precache entries, 1,657 KiB |
| Serve | `npx vite preview` | `index.html` 200, `manifest.webmanifest` 200 |
| Smoke, clean profile | setup → dashboard → `/inventory/import` → `/inventory` | workshop name shown, badge `v1.1.2`, import page loads, bulk-import entry point present, no console errors |
| Data archive E2E on the extracted build | `/tmp/archive_e2e_112.py`, port 4210 | 22/22 |
| Module audit on the extracted build | `/tmp/audit2_112.py` | 16/16 |
| Regression on the extracted build | `/tmp/regress_112.py` | 24/24 |
| Bulk import on the extracted build | `/tmp/imp_deep_112.py` | 27/27 |

The archive contains 121 files and no `node_modules`, `dist`, test output, caches or environment files.

## 8. What was NOT tested

| Area | Status |
| --- | --- |
| Scanned / image-only PDFs | Not supported. OCR is not bundled; such files are refused with an explanation. |
| Camera barcode scanning | Not implemented. USB/Bluetooth keyboard-wedge scanners work and were tested by typing a full code. |
| Legacy `.xls`, `.doc` | Not supported; rejected with a message naming the format to save as. |
| Physical thermal printer output | Not tested — only PDF page geometry in Chromium. |
| 24-hour soak | Not run. |
| Firefox / Safari | Not tested; `DecompressionStream` is required for `.xlsx` and for compressed archive entries. |
| Vercel deployment | Config included, no deployment executed here. |
| Interrupted power loss mid-restore | Not simulated at the OS level; the code path relies on IndexedDB's own transaction abort, which is covered by an injected failure test. |

## 9. Reproducing

```bash
npm ci
npx tsc --noEmit
npx vitest run
npm run build
npm run preview   # then open http://localhost:4173
```

The Playwright acceptance scripts live outside this repository and are described step by step in §2–§5.

---

## 10. v1.1.0 baseline records

The sections below are the original 1.x checks, kept for traceability. They ran against earlier builds and were
not re-run here; §0–§7 above are the current results.

### Artifact verification (clean extraction) — v1.1.0

The delivered archive was extracted into an empty directory and verified from scratch — not from the workspace:

| Step | Command | Result |
| --- | --- | --- |
| Install | `npm ci` | 390 packages, no errors |
| TypeScript | `npx tsc --noEmit` | clean |
| Unit/integration | `npx vitest run` | 6 files, 60 tests passed |
| Build | `npm run build` | success — 80 precache entries |
| Serve | `npx vite preview` | `index.html` 200, manifest 200 |
| Full E2E | `/tmp/final_accept.py` (same 14 checks, port 4182) | 14/14, 0 console errors |
| Print | `/tmp/zip_print.py` | 80 mm 1 p 80.1 × 279.4 mm · 58 mm 1 p 58.3 × 279.4 mm · A4 1 p 210.2 × 297.3 mm, shell hidden |
| Setup, clean profile | `/tmp/zip_smoke2.py` | setup renders, shared toggle flips both password fields, dashboard shows the workshop name |
| IndexedDB v1 → v2 upgrade | `/tmp/upgrade_check.py` on a profile created by the previous build | `syncQueue` dropped, 22 stores retained, 25 invoices and 6 customers intact, dashboard loads |

The archive contains 107 files and no `node_modules`, `dist`, test output or environment files.

### Static checks (v1.1.0)

| Check | Command | Result |
| --- | --- | --- |
| TypeScript (app) | `npx tsc --noEmit` | clean, 0 errors |
| Production build | `npm run build` | success — 80 precache entries, 1548.95 KiB |
| Unit/integration tests | `npx vitest run` | **6 files, 60 tests passed** |
| Full E2E re-run after branding/print changes | `/tmp/full_accept.py` | 14/14 checks, 0 console errors |
| Backup → clear → restore re-run | `/tmp/accept3.py` | store counts match manifest |
| Print geometry re-run | `/tmp/print_verify.py` | 80 mm / 58 mm / A4 each 1 page, sizes unchanged |

Test files: `money`, `sales`, `jobs`, `returns-shifts`, `backup-auth`, `auth`.

### End-to-end workflow (`/tmp/full_accept.py`, fresh profile)

14 steps, no console or page errors:

1. First-run setup creates the workshop and owner account
2. Part created with opening stock
3. Customer + vehicle created
4. Cash shift opened
5. POS sale with split payment
6. Stock deducted exactly once (8 × 3,000 = 24,000)
7. Job card created from the vehicle
8. Job progressed and converted to invoice `INV-000002`
9. Returns page loads with the new invoice available
10. Shift closed and reconciled
11. Keyboard shortcuts respond (`Ctrl+K`, `Alt+1/2/3`)
12. Backup export produces a 23,073-byte JSON file
13. Print is invoked for the open invoice
14. Offline reload still boots the app (PWA shell cached)

`CONSOLE ERRORS: []` · `FAILURES: []`

### Second pass — returns, purchases, warranty, expenses, users, settings, backup (`/tmp/accept3.py`)

- Sample workshop loaded (counts: 6 customers, 6 vehicles, 14 parts, 6 services, 3 labor, 3 suppliers,
  2 purchases, 25 invoices, 26 payments, 6 job cards, 2 returns, 3 warranty, 4 expenses, 54 stock moves)
- Return processed against a real invoice
- Purchase received (stock increases only on receipt)
- Warranty registered, expense recorded, user `bilal` created
- Role-permission matrix renders and is editable
- Settings save shows the saved confirmation
- Backup exported, business data cleared (**0 customer rows** afterwards), backup restored

Restore verification compares **IndexedDB store counts against the backup manifest**, not page text:
every business store matches exactly. `audit` and `notifications` are append-only and are expected to grow by
the restore's own entries plus boot checks (newest after restore: "Warranties expiring soon",
"Low stock alert", "Backup restored", "Purchase received").

`CONSOLE: []` · `FAILURES: []`

### Print geometry (`/tmp/print_verify.py`)

The receipt/print surface is measured in the browser under `@media print`, and a real PDF is generated for
each paper size:

| Target | On-screen print width | PDF pages | PDF page size |
| --- | --- | --- | --- |
| 80 mm thermal | 302 px (80 mm @ 96 dpi) | 1 | 80.1 × 279.4 mm |
| 58 mm thermal | 219 px (58 mm @ 96 dpi) | 1 | 58.3 × 279.4 mm |
| A4 invoice | `.doc-paper` with `paper=a4` | 1 | 210.2 × 297.3 mm |

The app shell is `display: none` under print media, so the list view behind the document cannot bleed onto
the sheet. Content check: each PDF's extracted text begins with the workshop name and the invoice number.

### `/api` boundary

Handlers bundled and executed under Node:

| Request | Response |
| --- | --- |
| `GET /api/health` | `200 {"ok":true,"mode":"local-only","syncConfigured":false}` |
| `GET /api/sync` | `200 {"ok":false,"available":false,"mode":"local-only",…}` |
| `POST /api/sync` | `501 {"code":"SYNC_NOT_AVAILABLE","accepted":0,…}` |
| `PUT /api/sync` | `405` |

### Reports and exports

- Reports page renders P&L, sales register, expenses, purchases and returns registers for Today / 7 days /
  30 days / This month / Last month / This year / custom range.
- Formulas are printed on the page ("Net sales = gross sales − invoice discounts…"), so revenue is never
  labelled as profit.
- CSV export downloaded a real file (`servixa-profit-loss.csv`, 320 bytes) from the filtered period.
- Analytics renders 39 SVG chart nodes from stored data; no console errors.

### Branding, setup controls and connection indicators (`/tmp/brand_audit.py`)

A fresh browser profile was driven through first-run setup → dashboard → Help → Privacy → Settings →
sign-out, reading `inner_text('body')` after each step:

| Check | Result |
| --- | --- |
| Business name shown in sidebar, login panel, Help/Privacy bar | pass — "Al-Madina Motors" in all four |
| Product name absent from setup, dashboard, login, Help, Privacy body text | pass — 0 occurrences |
| Product name present once, in Settings → Data management | pass — "Servixa — Auto Workshop POS", "Version 1.1.0" |
| Setup password/confirm share one control | pass — single button, labels "Show passwords" / "Hide passwords", `aria-pressed` |
| Login password has one toggle | pass |
| Online/Offline pill and sidebar connection dot | removed — no `online-pill`/`offline-pill` markup or CSS remains |
| Console errors during the walk-through | none |

Static confirmation: `grep -rn "Servixa" src --include=*.tsx` returns one line (the Settings software block).
The browser tab title and PWA manifest still carry the product name, which is the software's own identity.

